const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const ExcelJS = require('exceljs');

let webpush = null;
try {
    webpush = require('web-push');
} catch (_) {
    webpush = null;
}

const requestedPort = Number(process.env.PORT || 4173);
const rootDir = __dirname;
const TEMP_DIR = path.join(__dirname, 'temp');
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fygvulgffhxrimaeyoep.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'sb_publishable_YOksHoWnkBBt74lnKFqc8g_XyP3EyQF';
const supabaseServer = createClient(SUPABASE_URL, SUPABASE_KEY);
const PUSH_POLL_MS = Number(process.env.PUSH_POLL_MS || 30000);

if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

function readPushConfig() {
    const configPath = path.join(rootDir, 'push-config.json');
    let fileConfig = {};
    if (fs.existsSync(configPath)) {
        try {
            fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        } catch (error) {
            console.warn('[push] No se pudo leer push-config.json:', error.message);
        }
    }

    return {
        publicKey: process.env.VAPID_PUBLIC_KEY || fileConfig.publicKey || '',
        privateKey: process.env.VAPID_PRIVATE_KEY || fileConfig.privateKey || '',
        subject: process.env.VAPID_SUBJECT || fileConfig.subject || 'mailto:admin@planify.local'
    };
}

const pushConfig = readPushConfig();
const pushReady = Boolean(webpush && pushConfig.publicKey && pushConfig.privateKey);
if (pushReady) {
    webpush.setVapidDetails(pushConfig.subject, pushConfig.publicKey, pushConfig.privateKey);
} else {
    console.warn('[push] Push remoto desactivado. Falta web-push o claves VAPID.');
}

const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.ico': 'image/x-icon',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
};

function resolvePath(urlPath) {
    const cleanPath = decodeURIComponent((urlPath || '/').split('?')[0]);
    const relativePath = cleanPath === '/' ? '/index.html' : cleanPath;
    const requestedPath = path.normalize(path.join(rootDir, relativePath));
    return requestedPath.startsWith(rootDir) ? requestedPath : null;
}

function getPythonCandidates() {
    const candidates = [];
    const explicitPython = process.env.PYTHON || process.env.PYTHON_PATH;

    if (explicitPython) {
        candidates.push(explicitPython);
    }

    if (process.platform === 'win32') {
        const localPrograms = process.env.LOCALAPPDATA
            ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Python')
            : null;

        if (localPrograms && fs.existsSync(localPrograms)) {
            const installs = fs.readdirSync(localPrograms, { withFileTypes: true })
                .filter((entry) => entry.isDirectory() && /^Python\d+/i.test(entry.name))
                .map((entry) => path.join(localPrograms, entry.name, 'python.exe'))
                .filter((candidate) => fs.existsSync(candidate))
                .sort()
                .reverse();

            candidates.push(...installs);
        }

        candidates.push('py');
    }

    candidates.push('python', 'python3');
    return [...new Set(candidates.filter(Boolean))];
}

function runPython(scriptPath, inputFile, outputFile) {
    return new Promise((resolve, reject) => {
        const candidates = getPythonCandidates();

        function tryCmd(index) {
            if (index >= candidates.length) {
                reject(new Error(
                    'No se encontro una instalacion utilizable de Python. ' +
                    'Configura la variable PYTHON o agrega Python al PATH.'
                ));
                return;
            }

            const cmd = candidates[index];
            execFile(cmd, [scriptPath, inputFile, outputFile], { timeout: 60000 }, (err, stdout, stderr) => {
                if (!err) {
                    resolve({ stdout, stderr });
                } else {
                    const retryable = err.code === 'ENOENT' || err.code === 'EACCES';
                    if (retryable) {
                        tryCmd(index + 1);
                        return;
                    }

                    reject(new Error(stderr || err.message));
                }
            });
        }

        tryCmd(0);
    });
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try { resolve(JSON.parse(body)); }
            catch (e) { reject(e); }
        });
        req.on('error', reject);
    });
}

// ── Generador de planillas MONCON (server-side con exceljs) ──────────────
const FORMATOS_DIR = path.join(__dirname, 'formatos');

const PLANTILLAS_MONCON = [
    { tipo: 'BOMBAS 15D', match: /BOMBAS\s+U\d.*15\s*D/i, archivo: 'Formato MONCON BOMBAS 15D.xlsx', hoja: r => `BBAS U${(r.unidad||'').replace(/\D/g,'')} 15D` },
    { tipo: 'VENTILADORES 15D', match: /VENTILADORES\s+U\d.*15\s*D/i, archivo: 'Formato MONCON VENTILADORES 15D.xlsx', hoja: r => `VENTILADORES U${(r.unidad||'').replace(/\D/g,'')} 15D` },
    { tipo: 'TURBINA 15D', match: /TURBINA.*15\s*D/i, archivo: 'Formato MONCON TURBINA 15D.xlsx', hoja: 'TURBINA GEN 15D' },
    { tipo: 'VENTILADORES 60D', match: /VENTILADORES\s+U\d.*60\s*D/i, archivo: 'Formato MONCON VENTILADORES 60D.xlsx', hoja: r => `VENTILADORES U${(r.unidad||'').replace(/\D/g,'')} 60D` },
    { tipo: 'SC BBA PRETRA 90D', match: /SISTEMAS?\s+COMUNES?.*BOMBAS?\s+PRETRA.*90\s*D/i, archivo: 'Formato MONCON SC BBA PRET 90D.xlsx', hoja: 'BBA PRETRA 90D' },
    { tipo: 'SC RETROFIT 90D', match: /CONDIC.*TRANSP.*RETRO.*90|SC.*RETROFIT.*90/i, archivo: 'Formato MONCON SC RETROFIT 90D.xlsx', hoja: 'BBA PRETRA 90D' },
    { tipo: 'BOMBAS RETROFIT 90D', match: /BOMBAS?\s+RETROFIT.*90\s*D/i, archivo: 'Formato MONCON BOMBAS RETROFIT 90 D.xlsx', hoja: 'BBA RETROFIT 90D' },
    { tipo: 'BOMBAS 90D', match: /BOMBAS\s+U\d.*90\s*D/i, archivo: 'Formato MONCON BOMBAS BOMBAS 90 D.xlsx', hoja: r => `RUTA BOMBAS U${(r.unidad||'').replace(/\D/g,'')} 90D` },
    { tipo: 'CAR 90D', match: /\bCAR\s+U\d.*90\s*D/i, archivo: 'Formato MONCON CAR 90D.xlsx', hoja: 'RUTA CAR 90D' },
    { tipo: 'PLANTA AGUA BOMBAS 180D', match: /PLANTA.*AGUAS?.*BOMBAS.*180/i, archivo: 'Formato MONCON PLANTA DE AGUA BOMBAS 180D.xlsx', hoja: 'BBAS U5 180D' },
    { tipo: 'BOMBAS 180D', match: /BOMBAS\s+U\d.*180\s*D/i, archivo: 'Formato MONCON BOMBAS 180D.xlsx', hoja: r => { const m = String(r.nombre||'').match(/U(\d)/i); return m ? `BBAS U${m[1]} 180D` : null; } },
    { tipo: 'ESCORIA 180D', match: /ESCORIA\s+U\d.*180/i, archivo: 'Formato MONCON ESCORIA 180D.xlsx', hoja: r => { const m = String(r.nombre||'').match(/U(\d)/i); return m ? [`ESCORIA U${m[1]} 180D`, 'ESCORIA U2 180D'] : 'ESCORIA U2 180D'; } },
    { tipo: 'COMPRESORES 1M', match: /PLANTA.*AGUAS?.*COMPRESORES.*(30\s*D|1\s*M)|COMPRESORES.*(30\s*D|1\s*M)/i, archivo: 'Formato MONCON COMPRESORES 1M.xlsx', hoja: 'COMPRESORES DESAL' },
    { tipo: 'LLENADO SILO 1M', match: /LLENADO\s+SILO|SILO\s+LLENADO|CONDICIONES\s+LLENADO/i, archivo: 'Formato LLENADO DE SILO 1M.xlsx', hoja: 'LLENADO DE SILO' },
    { tipo: 'PUERTO 1M', match: /PUERTO.*(30\s*D|1\s*M)/i, archivo: 'Formato MONCON PUERTO 1M.xlsx', hoja: 'RUTA PUERTO' },
];

function detectarPlantillaServer(rutaNombre) {
    for (const p of PLANTILLAS_MONCON) {
        if (p.match.test(rutaNombre || '')) return p;
    }
    return null;
}

function normStr(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
}

// Clave de sufijo: último token reducido a alfanumérico (A/B/1/2/8…). Sirve
// para desempatar equipos que solo se distinguen por su sufijo (VDLL -A vs -B,
// GRÚA -1 vs -2) cuando el resto del nombre es idéntico y el matcher difuso
// empataría, quedándose con la primera fila (colapsando A y B en una sola).
function sufijoAlnum(nombre) {
    const toks = normStr(nombre).split(/\s+/);
    if (!toks.length) return '';
    return toks[toks.length - 1].replace(/[^A-Z0-9]/g, '');
}

// Algunos equipos vienen del seed con nomenclatura SAP que no calza con el
// nombre "humano" de la plantilla. Mapeo explícito nombre_seed → nombre_hoja
// para que el matcher los ubique en la fila correcta.
// ⚠ El pareo U1 (QEH05→1A, QEH08→1B) se asume por orden; validar en terreno.
const ALIAS_FILA_PLANILLA = {
    'VENTILADOR DILUCION -1 QEH05AN001 U1': 'VENTILADOR DILUCION AMONIACO 1A',
    'VENTILADOR DILUCION -2 QEH08AN001 U1': 'VENTILADOR DILUCION AMONIACO 1B',
    'VENTILADOR DILUCION AMON -4A HSA02AN101': 'VENTILADOR DILUCION AMONIACO 4A',
    'VENTILADOR DILUCION AMON -4B HSA02AN102': 'VENTILADOR DILUCION AMONIACO 4B',
    // Compresores de desaladora: el seed usa la UT (GBG20AN001 DESn) y la hoja
    // el correlativo. Sin alias el matcher solo comparte "COMPRESOR VAPOR" y no
    // llega al umbral, así que estos cuatro quedaban fuera de la planilla.
    'COMPRESOR VAPOR GBG20AN001 DES8': 'COMPRESOR VAPOR DESALADORA -8',
    'COMPRESOR VAPOR GBG20AN001 DES9': 'COMPRESOR VAPOR DESALADORA -9',
    'COMPRESOR VAPOR GBG20AN001 DES10': 'COMPRESOR VAPOR DESALADORA -10',
    'COMPRESOR VAPOR GBG20AN001 DES11': 'COMPRESOR VAPOR DESALADORA -11',
};

// Equipos de la ruta de Puerto cuyo reductor lleva 4 puntos de temperatura.
// Debe calzar con EQUIPOS_REDUCTOR_4_PUNTOS de app.js.
const EQUIPOS_REDUCTOR_4_PUNTOS = new Set([
    'MECANISMO ELEVACION GRUA PANTOGRAFICA -1',
    'MECANISMO CIERRE GRUA PANTOGRAFICA -1',
    'MECANISMO ELEVACION GRUA PANTOGRAFICA -2',
    'MECANISMO CIERRE GRUA PANTOGRAFICA -2',
    'TRANSPORTADOR 9-1',
    'TRANSPORTADOR 9-2',
    'TRANSPORTADOR 9-3',
    'CORREA TRANSPORTADORA C1',
    'CORREA TRANSPORTADORA C2',
    'CORREA TRANSPORTADORA C3'
]);

function encontrarFilaEnHoja(ws, nombreEquipo, filasUsadas = null) {
    const nombreBusqueda = ALIAS_FILA_PLANILLA[normStr(nombreEquipo)] || nombreEquipo;
    const target = normStr(nombreBusqueda);
    if (!target) return null;
    const targetWords = target.split(/\s+/).filter(w => w.length > 1);
    const targetSufijo = sufijoAlnum(nombreBusqueda);
    const colA = ws.getColumn(1);
    let found = null;
    let bestScore = 0;
    let foundSufijoOk = false;
    colA.eachCell({ includeEmpty: false }, (cell, rowNum) => {
        // La col A combina verticalmente el nombre del equipo sobre sus filas de
        // componente (Motor+Vent). Las celdas hijas de la combinación reportan el
        // MISMO valor que la maestra, así que un nombre más largo ("VAS -3A FGD")
        // agarraría la fila hija de uno más corto ("VAS -3A") vía includes.
        // Solo consideramos la celda maestra de cada combinación.
        if (cell.isMerged && cell.master && cell.master.row !== rowNum) return;
        // Saltar filas ya asignadas a otro equipo (evita doble asignación y
        // separa -A/-B, 3A/3B, etc.).
        if (filasUsadas && filasUsadas.has(rowNum)) return;
        if (rowNum <= 3 || bestScore >= 100) return;
        const v = normStr(cell.value);
        if (!v) return;
        if (v === target) { found = rowNum; bestScore = 999; return; }
        if (v.includes(target) || target.includes(v)) {
            found = rowNum; bestScore = 100;
            return;
        }
        const cellWords = v.split(/\s+/).filter(w => w.length > 1);
        const shorter = cellWords.length < targetWords.length ? cellWords : targetWords;
        const longer = cellWords.length < targetWords.length ? targetWords : cellWords;
        const matches = shorter.filter(w => longer.includes(w)).length;
        const score = matches / shorter.length;
        if (score < 0.6 || matches < 2) return;
        const cellSufijo = sufijoAlnum(cell.value);
        const sufijoOk = !!(targetSufijo && cellSufijo && targetSufijo === cellSufijo);
        // Mejor score gana; ante empate, prefiere la fila cuyo sufijo también
        // calce (desambigua -A/-B, -1/-2, etc.).
        if (score > bestScore || (score === bestScore && sufijoOk && !foundSufijoOk)) {
            found = rowNum;
            bestScore = score;
            foundSufijoOk = sufijoOk;
        }
    });
    return found;
}

function fmtFechaPlanilla(d) {
    if (!d) return '';
    try {
        const date = typeof d === 'string' ? new Date(d + 'T12:00:00') : new Date(d);
        const dd = String(date.getDate()).padStart(2, '0');
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        return `${dd}/${mm}/${date.getFullYear()}`;
    } catch (e) { return String(d); }
}

function setCellSafe(ws, row, col, valor) {
    if (valor === undefined || valor === null || valor === '') return;
    const cell = ws.getCell(row, col);
    cell.value = valor;
}

function detectarColumnasHoja(ws) {
    const cols = { obs: 10, fecha: 11, kizeo: 12, apertura: 9, pInt: null, pBalance: null, pSalida: null, pSuccion: null };
    for (let r = 1; r <= 5; r++) {
        const row = ws.getRow(r);
        for (let c = 1; c <= 20; c++) {
            const raw = row.getCell(c).value;
            const v = normStr(raw);
            if (!v) continue;
            if (/OBSERVAC/i.test(v)) cols.obs = c;
            else if (/^FECHA$/i.test(v) || (/^FECHA\b/i.test(v) && !/ENTREGA/i.test(v))) cols.fecha = c;
            else if (/KIZEO/i.test(v)) cols.kizeo = c;
            else if (/APERTURA/i.test(v)) cols.apertura = c;
            // Presiones BBA Agua Alim. P.INT debe excluir P.INTERNA → match exacto
            // o "P INT" / "P. INT" sin otras letras. BALANCE/SALIDA/SUCCION son
            // suficientemente únicos como para usar substring.
            else if (/\bP\.?\s*INT\b/i.test(v) && !/INTERNA/i.test(v)) cols.pInt = c;
            else if (/\bP\.?\s*BALANCE\b/i.test(v)) cols.pBalance = c;
            else if (/\bP\.?\s*SALIDA\b/i.test(v)) cols.pSalida = c;
            else if (/\bP\.?\s*SUCC?I[OÓ]N\b/i.test(v)) cols.pSuccion = c;
        }
    }
    return cols;
}

const ES_TEXTO_KIZEO = (s) => /notificad[oa]\s+en\s+kizeo/i.test(String(s || ''));

function escribirHeaderPlanilla(ws, fecha, ot) {
    const row1 = ws.getRow(1);
    const visitados = new Set();
    for (let c = 1; c <= 15; c++) {
        if (visitados.has(c)) continue;
        const cell = row1.getCell(c);
        // Saltar celdas que son parte de un merge pero NO el master
        if (cell.isMerged && cell.master && cell.master.col !== c) continue;
        const v = normStr(cell.value);
        if (!v) continue;
        if (!v.includes('FECHA ENTREGA') && !v.includes('ORDEN DE TRABAJO')) continue;

        // Encontrar el ancho del merge (si es master)
        let mergeEnd = c;
        for (let mc = c + 1; mc <= c + 8; mc++) {
            const mcell = ws.getCell(1, mc);
            if (mcell.isMerged && mcell.master && mcell.master.col === c) {
                mergeEnd = mc;
                visitados.add(mc);
            } else break;
        }

        // La primera celda libre después del merge es donde va el valor
        let destino = mergeEnd + 1;
        // Si el destino está merged con otra cosa, buscar el master de ese merge
        const destCell = ws.getCell(1, destino);
        if (destCell.isMerged && destCell.master) destino = destCell.master.col;

        setCellSafe(ws, 1, destino, v.includes('FECHA ENTREGA') ? fecha : ot);
    }
}

async function generarPlanillaMoncon(body) {
    const { ruta, ejecucion } = body || {};
    if (!ruta || !ejecucion) throw new Error('Faltan datos: ruta y ejecucion requeridos');

    const plantilla = detectarPlantillaServer(ruta.nombre);
    if (!plantilla) throw new Error(`No hay plantilla para: ${ruta.nombre}`);

    const templatePath = path.join(FORMATOS_DIR, plantilla.archivo);
    if (!fs.existsSync(templatePath)) throw new Error(`Plantilla no encontrada: ${plantilla.archivo}`);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(templatePath);

    let hojaName = typeof plantilla.hoja === 'function' ? plantilla.hoja(ruta) : plantilla.hoja;
    if (Array.isArray(hojaName)) {
        hojaName = hojaName.find(h => workbook.getWorksheet(h)) || hojaName[0];
    }
    const ws = workbook.getWorksheet(hojaName);
    if (!ws) throw new Error(`Hoja "${hojaName}" no encontrada. Disponibles: ${workbook.worksheets.map(s => s.name).join(', ')}`);

    const fechaStr = fmtFechaPlanilla(ejecucion.fechaCierre || ejecucion.fechaInicio || new Date());
    if (!/TURBINA/i.test(plantilla.tipo)) {
        escribirHeaderPlanilla(ws, fechaStr, ejecucion.ot || '');
    }

    const equipos = ruta.equipos || [];
    const noEncontrados = [];
    const cols = detectarColumnasHoja(ws);
    const filasUsadas = new Set();

    equipos.forEach((eq, eqIdx) => {
        const filaBase = encontrarFilaEnHoja(ws, eq.nombre, filasUsadas);
        if (!filaBase) { noEncontrados.push(eq.nombre); return; }
        filasUsadas.add(filaBase);

        // La plantilla tenía nombres con "UNIDAD" prefijo por error. Sobrescribimos
        // la columna A con el nombre limpio del seed para que la planilla quede
        // consistente con la app.
        const nombreLimpio = String(eq.nombre || '').replace(/^UNIDAD\s+/i, '').trim();
        if (nombreLimpio) setCellSafe(ws, filaBase, 1, nombreLimpio);

        const comps = eq.componentes || [];
        // BBA Agua Alimentación U1/U2: en la app el orden es Motor, Amplificador,
        // Bomba; en la planilla las filas son Motor, Bomba, Amp. Mapeamos cada
        // componente a su fila por nombre. Además su amplificador tiene 4 puntos
        // de temperatura, así que esas filas usan las 4 columnas (T°1..T°4).
        const esBbaAgua = /BOMBA\s+AGUA\s+ALIMENTACION/i.test(String(eq.nombre || ''));
        const esLlenadoSilo = /LLENADO\s+SILO|SILO\s+LLENADO/i.test(String(plantilla.tipo || ''))
            || /CORREA\s+(TRANSPORTADORA|TRIPPER)/i.test(String(eq.nombre || ''));
        const esReductor4Puntos = EQUIPOS_REDUCTOR_4_PUNTOS.has(normStr(eq.nombre));
        comps.forEach((comp, compIdx) => {
            let fila = filaBase + compIdx;
            // Columnas de temperatura: por defecto el 1er componente usa T°1,T°2
            // (5,6) y el resto T°3,T°4 (7,8). En BBA Agua Alim. cada fila parte en
            // T°1 (5) y puede ocupar hasta las 4 columnas.
            let colsTemp = compIdx === 0 ? [5, 6] : [7, 8];
            if (esLlenadoSilo) {
                colsTemp = /REDUCTOR/i.test(String(comp.nombre || '')) ? [5, 6, 7, 8] : [5, 6];
            }
            // Reductores de 4 puntos (Puerto): la hoja solo tiene T°1..T°4, así
            // que los 4 puntos van en las cuatro columnas de la fila del reductor.
            if (esReductor4Puntos && /REDUCTOR/i.test(String(comp.nombre || ''))) {
                colsTemp = [5, 6, 7, 8];
            }
            if (esBbaAgua) {
                const n = normStr(comp.nombre);
                if (/^MOTOR BOMBA AGUA/.test(n))      fila = filaBase + 0;
                else if (/AMPLIFICADOR/.test(n))      fila = filaBase + 2;
                else if (/^BOMBA AGUA/.test(n))       fila = filaBase + 1;
                colsTemp = [5, 6, 7, 8];
            }
            const k = `${eqIdx}.${compIdx}`;
            const estadoComp = ejecucion.componentesEstado?.[k] || '';
            const med = ejecucion.mediciones?.[k] || null;
            const obsRaw = ejecucion.observaciones?.[k] || '';
            const obs = ES_TEXTO_KIZEO(obsRaw) ? '' : obsRaw;

            if (!med && estadoComp === 'no-ejecutado') {
                setCellSafe(ws, fila, cols.obs, obs || 'No ejecutado');
                return;
            }
            if (!med) return;

            if (med.vibracion != null && med.vibracion !== '' && med.vibracion !== 'N/A') {
                const vNum = Number(String(med.vibracion).replace(',', '.'));
                setCellSafe(ws, fila, 3, Number.isFinite(vNum) ? vNum : med.vibracion);
            } else if (med.vibracion === 'N/A') {
                setCellSafe(ws, fila, 3, 'N/A');
            }
            if (med.punto) setCellSafe(ws, fila, 4, med.punto);

            if (Array.isArray(med.temperaturas) && med.temperaturas.length) {
                if (med.temperaturas.length === 1 && med.temperaturas[0].valor === 'N/A') {
                    setCellSafe(ws, fila, colsTemp[0], 'N/A');
                } else {
                    // El punto opcional sin valor se guardó como "0": se omite para
                    // no escribir un 0 espurio en la columna de ese punto.
                    med.temperaturas
                        .filter(t => t.valor != null && t.valor !== '' && t.valor !== '0')
                        .forEach((t, idx) => {
                            if (idx >= colsTemp.length) return;
                            const tv = Number(String(t.valor).replace(',', '.'));
                            setCellSafe(ws, fila, colsTemp[idx], Number.isFinite(tv) ? tv : t.valor);
                        });
                }
            } else if (med.temperatura != null) {
                const tv = Number(String(med.temperatura).replace(',', '.'));
                setCellSafe(ws, fila, colsTemp[0], Number.isFinite(tv) ? tv : med.temperatura);
            }

            if (obs) setCellSafe(ws, fila, cols.obs, obs);

            // Apertura de lampos (solo ventiladores): la cargamos en la fila
            // base del equipo. La app sincroniza el valor entre componentes
            // del mismo equipo, así que el del compIdx 0 es la fuente.
            if (compIdx === 0 && med.apertura != null && med.apertura !== '') {
                setCellSafe(ws, fila, cols.apertura, med.apertura);
            }

            // Presiones BBA Agua Alim: 4 columnas opcionales, se escriben en
            // la fila base. Solo si la plantilla tiene la columna detectada.
            if (compIdx === 0 && med.presiones && typeof med.presiones === 'object') {
                const p = med.presiones;
                const toNum = (s) => {
                    if (s == null || s === '') return null;
                    const n = Number(String(s).replace(',', '.'));
                    return Number.isFinite(n) ? n : s;
                };
                if (cols.pInt && p.int)         setCellSafe(ws, fila, cols.pInt,     toNum(p.int));
                if (cols.pBalance && p.balance) setCellSafe(ws, fila, cols.pBalance, toNum(p.balance));
                if (cols.pSalida && p.salida)   setCellSafe(ws, fila, cols.pSalida,  toNum(p.salida));
                if (cols.pSuccion && p.succion) setCellSafe(ws, fila, cols.pSuccion, toNum(p.succion));
            }

            if (compIdx === 0) {
                const fechaCierreFmt = fmtFechaPlanilla(ejecucion.fechaCierre || new Date());
                setCellSafe(ws, fila, cols.fecha, fechaCierreFmt);
                if (med.kizeo && med.kizeo.notificado) {
                    setCellSafe(ws, fila, cols.kizeo, '✓');
                }
            }
        });
    });

    if (noEncontrados.length) {
        console.warn('[planilla] Equipos sin fila en plantilla:', noEncontrados);
    }

    // Eliminar hojas de unidades no usadas. Una hoja "VENTILADORES U3 15D"
    // tiene unidad U3 en el nombre; si la ruta no toca U3, la quitamos.
    const unidadesUsadas = new Set();
    if (ruta.unidad) unidadesUsadas.add(String(ruta.unidad).toUpperCase());
    equipos.forEach(eq => {
        const fuente = String(eq.unidad || eq.nombre || '');
        const m = fuente.match(/\bU(\d)\b/i);
        if (m) unidadesUsadas.add(`U${m[1]}`.toUpperCase());
    });

    const hojasAEliminar = [];
    workbook.worksheets.forEach(sheet => {
        const m = sheet.name.match(/\bU(\d)\b/i);
        if (!m) return; // hoja sin unidad → siempre se conserva
        const unidadHoja = `U${m[1]}`.toUpperCase();
        if (!unidadesUsadas.has(unidadHoja)) hojasAEliminar.push(sheet.name);
    });
    hojasAEliminar.forEach(name => {
        try { workbook.removeWorksheet(workbook.getWorksheet(name).id); }
        catch (e) { console.warn('[planilla] no se pudo eliminar hoja', name, ':', e.message); }
    });

    // Página apaisada + ajustar a 1 hoja de ancho (no salta de página por mitad).
    // La planilla tiene ~12 columnas (A→L) que no caben verticalmente en carta.
    // ExcelJS: setear props individuales en lugar de reasignar pageSetup completo,
    // y limpiar printArea/pageBreaks heredados del template original.
    workbook.worksheets.forEach(sheet => {
        if (!sheet.pageSetup) sheet.pageSetup = {};
        sheet.pageSetup.orientation = 'landscape';
        sheet.pageSetup.paperSize = 9;          // A4
        sheet.pageSetup.fitToPage = true;
        sheet.pageSetup.fitToWidth = 1;
        sheet.pageSetup.fitToHeight = 999;
        sheet.pageSetup.horizontalCentered = true;
        sheet.pageSetup.printArea = undefined;   // borrar área de impresión heredada del template
        sheet.pageSetup.margins = {
            left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2
        };
        // Borrar saltos de página manuales del template
        try {
            sheet.eachRow((row) => { row.pageBreak = undefined; });
        } catch (e) { /* noop */ }

        // Título en el header de impresión: quitar el salto de línea para que
        // el nombre de la ruta quede en una sola línea horizontal (no tape celdas).
        if (sheet.headerFooter) {
            ['oddHeader', 'evenHeader', 'firstHeader'].forEach(k => {
                if (typeof sheet.headerFooter[k] === 'string') {
                    sheet.headerFooter[k] = sheet.headerFooter[k].replace(/[\r\n]+\s*/g, ' ');
                }
            });
        }
    });

    const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
    const d = new Date();
    const fechaArchivo = `${d.getDate()} ${meses[d.getMonth()]}`;
    const filename = `MONCON ${plantilla.tipo} ${ruta.unidad || ''} — OT ${ejecucion.ot || 'sn'} — ${fechaArchivo}.xlsx`
        .replace(/\s+/g, ' ').replace(/[\\/:*?"<>|]/g, '-');

    const buffer = await workbook.xlsx.writeBuffer();
    return { buffer: Buffer.from(buffer), filename };
}

// ── Generador de planilla de terreno Excitatriz (escobillas) ─────────────
// A diferencia de las MONCON (mapeo equipo→fila por nombre), la excitatriz se
// rellena por POSICIÓN de escobilla (1.1, 1.2…) buscando el código en la
// columna A. Las hojas se llaman "Formato planilla exc 3/4/5".
const EXCITATRIZ_TEMPLATE = 'Formato Planilla de terreno Excitatriz.xlsx';
const EXCITATRIZ_HOJAS = { 3: 'Formato planilla exc 3', 4: 'Formato planilla exc 4', 5: 'Formato planilla exc 5' };

function buscarCeldaExcitatriz(ws, patron) {
    for (let row = 1; row <= 5; row++) {
        for (let col = 1; col <= 7; col++) {
            const cell = ws.getCell(row, col);
            if (cell.isMerged && cell.master && cell.master.address !== cell.address) continue;
            const texto = String(cell.value == null ? '' : cell.value).trim();
            if (patron.test(texto)) return { row, col };
        }
    }
    return null;
}

function escribirCabeceraExcitatriz(ws, patron, valor, opciones = {}) {
    if (valor === undefined || valor === null || valor === '') return;
    const etiqueta = buscarCeldaExcitatriz(ws, patron);
    if (!etiqueta) return;

    const row = etiqueta.row + (opciones.filaAbajo ? 1 : 0);
    const col = etiqueta.col + (opciones.filaAbajo ? 0 : 1);
    const cell = ws.getCell(row, col);
    cell.value = valor;

    // Las celdas de entrada vacías del template heredan fuente blanca. Forzamos
    // texto oscuro para que fecha, OT y técnicos sean visibles al abrir/imprimir.
    cell.font = {
        ...(cell.font || {}),
        color: { argb: 'FF111827' },
        bold: true,
        size: 11
    };
    cell.alignment = {
        ...(cell.alignment || {}),
        horizontal: opciones.centrado ? 'center' : 'left',
        vertical: 'middle',
        wrapText: true,
        shrinkToFit: true
    };
}

function parsearEscobillasHistorial(texto) {
    const porPosicion = new Map();
    const grab = (re, linea) => {
        const match = linea.match(re);
        return match ? match[1] : '';
    };

    String(texto || '').split(/\r?\n/).forEach(linea => {
        const matchPos = linea.match(/Escobilla\s+(\d+\.\d+)/i);
        if (!matchPos) return;

        const pos = matchPos[1];
        const actual = porPosicion.get(pos) || { pos, temp: '', corr: '', alta: '', norm: '' };
        const temp = grab(/Temp:\s*([\d.,]+)/i, linea);
        const corr = grab(/Corriente:\s*([\d.,]+)/i, linea);
        const alta = grab(/Alta temp:\s*(SI|NO)/i, linea);
        const norm = grab(/Normalizado:\s*(SI|NO)/i, linea);
        if (temp) actual.temp = temp.replace(',', '.');
        if (corr) actual.corr = corr.replace(',', '.');
        if (alta) actual.alta = alta.toUpperCase();
        if (norm) actual.norm = norm.toUpperCase();
        porPosicion.set(pos, actual);
    });

    return [...porPosicion.values()];
}

async function completarEscobillasDesdeHistorial({ registroId, ot, unidad, escobillas }) {
    const recibidas = Array.isArray(escobillas) ? escobillas : [];
    if (!registroId && !ot) return recibidas;

    const tablas = ['historial_tareas', 'tareas_historial'];
    let registro = null;
    for (const tabla of tablas) {
        let consulta = supabaseServer
            .from(tabla)
            .select('id, tipo, ot_numero, acciones_realizadas')
            .limit(1);
        consulta = registroId
            ? consulta.eq('id', registroId)
            : consulta.eq('ot_numero', String(ot)).order('created_at', { ascending: false });
        const { data, error } = await consulta.maybeSingle();
        if (!error && data) {
            registro = data;
            break;
        }
    }
    if (!registro) return recibidas;

    const unidadNum = Number(String(unidad || '').replace(/\D/g, ''));
    const tipo = String(registro.tipo || '');
    if (unidadNum && !new RegExp(`\\bU\\s*${unidadNum}\\b`, 'i').test(tipo)) return recibidas;

    const guardadas = parsearEscobillasHistorial(registro.acciones_realizadas);
    if (!guardadas.length) return recibidas;

    const porPosicion = new Map(guardadas.map(item => [String(item.pos), item]));
    recibidas.forEach(item => {
        const pos = String(item?.pos || '').trim();
        if (!pos) return;
        porPosicion.set(pos, { ...(porPosicion.get(pos) || {}), ...item, pos });
    });
    return [...porPosicion.values()];
}

async function generarPlanillaExcitatriz(body) {
    const { unidad, fecha, ot, tecnicos, hum, temp, gen, vcampo, icampo, registroId } = body || {};
    const escobillas = await completarEscobillasDesdeHistorial({
        registroId,
        ot,
        unidad,
        escobillas: body?.escobillas
    });
    const uNum = Number(String(unidad || '').replace(/\D/g, ''));
    const hojaName = EXCITATRIZ_HOJAS[uNum];
    if (!hojaName) throw new Error(`Unidad de excitatriz no soportada: ${unidad}. Solo U3, U4 y U5.`);

    const templatePath = path.join(FORMATOS_DIR, EXCITATRIZ_TEMPLATE);
    if (!fs.existsSync(templatePath)) throw new Error(`Plantilla no encontrada: ${EXCITATRIZ_TEMPLATE}`);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(templatePath);
    const ws = workbook.getWorksheet(hojaName);
    if (!ws) throw new Error(`Hoja "${hojaName}" no encontrada. Disponibles: ${workbook.worksheets.map(s => s.name).join(', ')}`);

    const toNum = (v) => {
        if (v === undefined || v === null || v === '') return null;
        const n = Number(String(v).replace(',', '.'));
        return Number.isFinite(n) ? n : v;
    };

    // Cabecera: localizar por etiqueta para resistir desplazamientos del template.
    escribirCabeceraExcitatriz(ws, /^fecha\s*:?$/i, fecha || '');
    escribirCabeceraExcitatriz(ws, /^ot\s*:?$/i, ot || '');
    escribirCabeceraExcitatriz(ws, /^t[eé]cnicos\s*:?$/i, tecnicos || '', {
        filaAbajo: true,
        centrado: true
    });
    setCellSafe(ws, 2, 5, toNum(hum));       // E2 Hum. [%]
    setCellSafe(ws, 3, 5, toNum(temp));      // E3 Temp. [T°]
    setCellSafe(ws, 2, 7, toNum(gen));       // G2 Gen. [MW]
    setCellSafe(ws, 3, 7, toNum(vcampo));    // G3 V Campo [V]
    setCellSafe(ws, 4, 7, toNum(icampo));    // G4 I Campo [A]

    // Mapa posición ("1.1") → fila, leyendo la columna A desde la fila 6.
    const posRow = {};
    ws.getColumn(1).eachCell({ includeEmpty: false }, (cell, rowNum) => {
        if (rowNum < 6) return;
        const v = String(cell.value == null ? '' : cell.value).trim();
        if (v) posRow[v] = rowNum;
    });

    // Temperatura (B:C) y Corriente (D:E) son celdas combinadas. Centramos el
    // valor para que quede en medio de la celda y no pegado a la derecha (que
    // hacía parecer la columna B vacía).
    const setCentrado = (r, c, val) => {
        if (val === undefined || val === null || val === '') return;
        const cell = ws.getCell(r, c);
        cell.value = val;
        // La última fila de U3 (14.4) viene en la plantilla con fuente blanca
        // sobre fondo blanco. Sin forzar el color, el dato existe en el XLSX
        // pero queda invisible al abrirlo en Excel.
        cell.font = {
            ...(cell.font || {}),
            color: { argb: 'FF000000' },
            bold: false
        };
        cell.alignment = { ...(cell.alignment || {}), horizontal: 'center', vertical: 'middle' };
    };
    (escobillas || []).forEach(e => {
        const row = posRow[String(e.pos || '').trim()];
        if (!row) return;
        setCentrado(row, 2, toNum(e.temp));  // B:C Temperatura [°C]
        setCentrado(row, 4, toNum(e.corr));  // D:E Corriente [A]
        if (e.alta) setCentrado(row, 6, String(e.alta).toUpperCase());  // F Alta Temp SI/NO
        if (e.norm) setCentrado(row, 7, String(e.norm).toUpperCase());  // G Normalizado SI/NO
    });

    // Quitar las hojas de las otras unidades (deja solo la de esta unidad).
    workbook.worksheets.slice().forEach(sheet => {
        if (sheet.name !== hojaName) {
            try { workbook.removeWorksheet(sheet.id); } catch (e) { /* noop */ }
        }
    });
    // Reapuntar la pestaña activa a la única hoja restante (evita que Excel
    // abra con una pestaña fuera de rango tras eliminar las otras).
    workbook.views = [{ activeTab: 0 }];

    // Impresión: vertical, ajustar al ancho a 1 página.
    if (!ws.pageSetup) ws.pageSetup = {};
    ws.pageSetup.orientation = 'portrait';
    ws.pageSetup.paperSize = 9;            // A4
    ws.pageSetup.fitToPage = true;
    ws.pageSetup.fitToWidth = 1;
    ws.pageSetup.fitToHeight = 999;
    ws.pageSetup.horizontalCentered = true;
    ws.pageSetup.margins = { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 };

    const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
    const d = new Date();
    const horaArchivo = [d.getHours(), d.getMinutes(), d.getSeconds()]
        .map(n => String(n).padStart(2, '0'))
        .join('-');
    const fechaArchivo = `${d.getDate()} ${meses[d.getMonth()]} ${horaArchivo}`;
    const filename = `Planilla Excitatriz U${uNum} — OT ${ot || 'sn'} — ${fechaArchivo}.xlsx`
        .replace(/\s+/g, ' ').replace(/[\\/:*?"<>|]/g, '-');

    const buffer = await workbook.xlsx.writeBuffer();
    return { buffer: Buffer.from(buffer), filename };
}

// ── Generador de planilla de TRAFOS AT (transformadores) ─────────────────
// Cada trabajo es un transformador (EXC/EST/AUX/PPAL) de una unidad. La hoja y
// las celdas dependen del tipo. La planilla EST es compartida (U1-U2, U3-U4).
function resolverHojaTrafo(tipo, uNum) {
    switch (tipo) {
        case 'EST':
            if (uNum === 1 || uNum === 2) return { archivo: 'Formato TRAFOS AT U1.xlsx', hoja: 'TRAFO EST U1-U2' };
            if (uNum === 3 || uNum === 4) return { archivo: 'Formato TRAFOS AT U3.xlsx', hoja: 'TRAFO EST U3-U4' };
            return null;
        case 'AUX':  return { archivo: `Formato TRAFOS AT U${uNum}.xlsx`, hoja: `TRAFO AUX U${uNum}` };
        case 'PPAL': return { archivo: `Formato TRAFOS AT U${uNum}.xlsx`, hoja: `TRAFO PPAL U${uNum}` };
        case 'EXC':  return { archivo: `Formato TRAFOS AT U${uNum}.xlsx`, hoja: `TRAFO EXC U${uNum}` };
        default: return null;
    }
}

function trafoTagPorUnidad(tipo, uNum) {
    const unidad = Number(uNum);
    if (!unidad || unidad < 1 || unidad > 5) return '';
    const prefijo = String(unidad).padStart(2, '0');
    const tags = {
        PPAL: `${prefijo}BAT01GT101`,
        AUX: `${prefijo}BBT00GH001`,
        EST: `G${unidad}-12.4.TRI2`,
        EXC: `${prefijo}MKC01GT101`,
    };
    return tags[String(tipo || '').toUpperCase()] || '';
}

// Mapa de celdas por tipo de transformador (dónde escribir cada dato).
const TRAFO_MAPA = {
    EST: {
        cab: { fecha: 'B1', tecnicos: 'B2', tag: 'H1', ot: 'H2' },
        radiadores: { entradaCol: 2, salidaCol: 4, filaInicio: 6, n: 8 },
        campos: { generacion: 'I4', tempAceite: 'I5', tempBobinado: 'I6', silicaGel: 'I7', nivelCuba: 'I8', nTap: 'I9' },
        fases: { R: 'H12', S: 'H13', T: 'H14' },
        relevantes: { equipoCol: 1, elementoCol: 2, identCol: 6, corrienteCol: 8, tempCol: 9, filaInicio: 20, n: 6 },
        observaciones: { col: 2, filaInicio: 28, n: 6 },
    },
    AUX: {
        cab: { fecha: 'C2', tecnicos: 'C3', tag: 'I2', ot: 'I3' },
        radiadores: { entradaCol: 3, salidaCol: 5, filaInicio: 7, n: 8 },
        campos: { generacion: 'J5', tempAceite: 'J6', tempBobinado: 'J7', silicaGelTR: 'J8', silicaGelTC: 'J9', nivelCubaPrincipal: 'J10', nivelCubaCTBC: 'J11', nTap: 'J12' },
        fases: { R: 'C17', S: 'C18', T: 'C19' },
        relevantes: { equipoCol: 2, elementoCol: 3, identCol: 6, corrienteCol: 9, tempCol: 10, filaInicio: 24, n: 6 },
        observaciones: { col: 3, filaInicio: 31, n: 6 },
    },
    PPAL: {
        cab: { fecha: 'B1', tecnicos: 'B2', tag: 'G1', ot: 'G2' },
        radiadores: { entradaCol: 7, salidaCol: 9, filaInicio: 12, n: 13 },
        campos: { generacion: 'H4', tempAceite: 'H5', tempBobinado: 'H6', silicaGel: 'H7', nivelCuba: 'H8', nTap: 'H9' },
        ventiladores: { onOffCol: 2, tempCol: 3, filaInicio: 5, n: 15 },
        bombas: { onOffCol: 2, tempCol: 3, filaInicio: 22, n: 4 },
        relevantes: { equipoCol: 1, elementoCol: 2, identCol: 5, corrienteCol: 7, tempCol: 8, filaInicio: 30, n: 6 },
        observaciones: { col: 2, filaInicio: 37, n: 6 },
    },
    EXC: {
        cab: { fecha: 'B1', tecnicos: 'B2', tag: 'F1', ot: 'F2' },
        radiadores: { entradaCol: 2, salidaCol: 3, filaInicio: 6, n: 6 },
        campos: { generacion: 'G4', tempAceite: 'G5', tempBobinado: 'G6', nivelCuba: 'G7', presionAceite: 'G8' },
        relevantes: { equipoCol: 1, elementoCol: 2, identCol: 4, corrienteCol: 6, tempCol: 7, filaInicio: 17, n: 6 },
        observaciones: { col: 2, filaInicio: 24, n: 6 },
    },
};

// Campos que son texto (no numéricos) en la planilla.
const TRAFO_CAMPOS_TEXTO = new Set(['silicaGel', 'silicaGelTR', 'silicaGelTC', 'nivelCuba', 'nivelCubaPrincipal', 'nivelCubaCTBC', 'nTap']);

async function generarPlanillaTrafo(body) {
    const { unidad, tipo, fecha, tecnicos, tag, ot,
        radiadores = [], campos = {}, fases = {}, ventiladores = [], bombas = [],
        relevantes = [], observaciones = [] } = body || {};
    const uNum = Number(String(unidad || '').replace(/\D/g, ''));
    const tipoUp = String(tipo || '').toUpperCase();
    const dest = resolverHojaTrafo(tipoUp, uNum);
    if (!dest) throw new Error(`Transformador no soportado: unidad ${unidad}, tipo ${tipo}.`);
    const mapa = TRAFO_MAPA[tipoUp];
    if (!mapa) throw new Error(`El tipo de transformador "${tipo}" todavía no está implementado.`);

    const templatePath = path.join(FORMATOS_DIR, dest.archivo);
    if (!fs.existsSync(templatePath)) throw new Error(`Plantilla no encontrada: ${dest.archivo}`);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(templatePath);
    const ws = workbook.getWorksheet(dest.hoja);
    if (!ws) throw new Error(`Hoja "${dest.hoja}" no encontrada. Disponibles: ${workbook.worksheets.map(s => s.name).join(', ')}`);

    const toNum = (v) => {
        if (v === undefined || v === null || v === '') return null;
        const n = Number(String(v).replace(',', '.'));
        return Number.isFinite(n) ? n : v;
    };
    const setA = (addr, val) => { if (val === undefined || val === null || val === '') return; ws.getCell(addr).value = val; };

    // Cabecera
    setA(mapa.cab.fecha, fecha);
    setA(mapa.cab.tecnicos, tecnicos);
    setA(mapa.cab.tag, tag || trafoTagPorUnidad(tipoUp, uNum));
    setA(mapa.cab.ot, ot);

    // Radiadores (entrada/salida)
    const rad = mapa.radiadores;
    (radiadores || []).forEach((r, i) => {
        if (i >= rad.n) return;
        const fila = rad.filaInicio + i;
        setCellSafe(ws, fila, rad.entradaCol, toNum(r && r.entrada));
        setCellSafe(ws, fila, rad.salidaCol, toNum(r && r.salida));
    });

    // Campos del transformador (generación, aceite, bobinado, silica, nivel, tap…)
    Object.entries(mapa.campos || {}).forEach(([k, addr]) => {
        const v = campos[k];
        setA(addr, TRAFO_CAMPOS_TEXTO.has(k) ? v : toNum(v));
    });

    // Fases salida (temperatura)
    if (mapa.fases) {
        setA(mapa.fases.R, toNum(fases.R));
        setA(mapa.fases.S, toNum(fases.S));
        setA(mapa.fases.T, toNum(fases.T));
    }

    // Ventiladores (On/Off + temperatura) — solo PPAL
    if (mapa.ventiladores) {
        (ventiladores || []).forEach((vt, i) => {
            if (i >= mapa.ventiladores.n) return;
            const fila = mapa.ventiladores.filaInicio + i;
            setCellSafe(ws, fila, mapa.ventiladores.onOffCol, vt && vt.onOff);
            setCellSafe(ws, fila, mapa.ventiladores.tempCol, toNum(vt && vt.temp));
        });
    }

    // Bombas de flujo (On/Off + temperatura) — solo PPAL
    if (mapa.bombas) {
        (bombas || []).forEach((bo, i) => {
            if (i >= mapa.bombas.n) return;
            const fila = mapa.bombas.filaInicio + i;
            setCellSafe(ws, fila, mapa.bombas.onOffCol, bo && bo.onOff);
            setCellSafe(ws, fila, mapa.bombas.tempCol, toNum(bo && bo.temp));
        });
    }

    // Temperaturas relevantes (tabla dinámica)
    const rel = mapa.relevantes;
    (relevantes || []).forEach((it, i) => {
        if (i >= rel.n) return;
        const fila = rel.filaInicio + i;
        setCellSafe(ws, fila, rel.equipoCol, it && it.equipo);
        setCellSafe(ws, fila, rel.elementoCol, it && it.elemento);
        setCellSafe(ws, fila, rel.identCol, it && it.identificador);
        setCellSafe(ws, fila, rel.corrienteCol, toNum(it && it.corriente));
        setCellSafe(ws, fila, rel.tempCol, toNum(it && it.temperatura));
    });

    // Observaciones (una por fila)
    const obs = mapa.observaciones;
    (observaciones || []).forEach((linea, i) => {
        if (i >= obs.n) return;
        setCellSafe(ws, obs.filaInicio + i, obs.col, linea);
    });

    // Dejar solo la hoja usada (la plantilla trae varias).
    workbook.worksheets.slice().forEach(sheet => {
        if (sheet.name !== dest.hoja) { try { workbook.removeWorksheet(sheet.id); } catch (e) {} }
    });
    workbook.views = [{ activeTab: 0 }];

    const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    const d = new Date();
    const fechaArchivo = `${d.getDate()} ${meses[d.getMonth()]}`;
    const filename = `Planilla Trafo ${tipoUp} U${uNum} — OT ${ot || 'sn'} — ${fechaArchivo}.xlsx`
        .replace(/\s+/g, ' ').replace(/[\\/:*?"<>|]/g, '-');

    const buffer = await workbook.xlsx.writeBuffer();
    return { buffer: Buffer.from(buffer), filename };
}

const SALA_RELES_TEMPLATE = 'RUTA TERMOGRAFIA SALA RELES.xlsx';
const SALA_RELES_PANELES = {
    1: [
        'PANEL DE DCS (DP) DP1 G1-13.2M11',
        'PANEL DE DCS TRP4 G1-13.2M11',
        'ATS CONTROL PANEL',
        'PANEL DE RELES DE ENCLAVAMIENTO CALDERA-TURBINA (BT-lRP1) G1-13.2M17',
        'PANEL DE RELES DE ENCLAVAMIENTO CALDERA-TURBINA (BT-Lrp2) G1-13.2M17',
        'PANEL DE RELES DE ENCLAVAMIENTO CALDERA-TURBINA (BT-lRP3) G1-13.2M17',
        'PANEL AVR CUBICLE',
        'PANEL AVR-1',
        'PANEL AVR-2',
        'PANEL AVR-3',
        'PANEL DE RELES ENCLAVAMIENTO ELECTRICO (INTERLOCK) G1-12.02G46',
        'PANEL MEDIDOR DE ENERGIA G1-12.02G49',
        'PANEL ANUNCIADOR DE ALARMA G1-12.02G47',
        'PANEL SINCRONIZADOR G1-12.02G42',
        'PANEL CONTROL DE HIDROGENO G1-12.02G45',
        'PANEL DE RELES DE PROTECCION PARA TRANSFORMADOR ESTACION G1-12.04M14',
        'PANEL RELES PROTECCION-1 GENERADOR Y TRANSF PPAL G1-12.02G43',
        'PANEL RELES PROTECCION-2 GENERADOR Y TRANSF PPAL G1-12.02G43',
        '01 BMS INTERFACE 01CAA01GH001'
    ],
    2: [
        'PANEL DE DCS (DP) DP1 G2-13.2M11',
        'PANEL DE DCS TRP4 G1-13.2M11',
        'ATS CONTROL PANEL',
        'PANEL DE RELES DE ENCLAVAMIENTO CALDERA-TURBINA (BT-lRP1) G2-13.2M17',
        'PANEL DE RELES DE ENCLAVAMIENTO CALDERA-TURBINA (BT-Lrp2) G2-13.2M17',
        'PANEL DE RELES DE ENCLAVAMIENTO CALDERA-TURBINA (BT-lRP3) G2-13.2M17',
        'PANEL AVR CUBICLE',
        'PANEL AVR-1',
        'PANEL AVR-2',
        'PANEL AVR-3',
        'PANEL DE RELES ENCLAVAMIENTO ELECTRICO (INTERLOCK) G2-12.02G46',
        'PANEL MEDIDOR DE ENERGIA G2-12.02G49',
        'PANEL ANUNCIADOR DE ALARMA G2-12.02G47',
        'PANEL SINCRONIZADOR G2-12.02G42',
        'PANEL CONTROL DE HIDROGENO G2-12.02G45',
        'PANEL RELES PROTECCION-1 GENERADOR Y TRANSF PPAL G2-12.02G43',
        'PANEL RELES PROTECCION-2 GENERADOR Y TRANSF PPAL G1-12.02G43',
        '01 BMS INTERFACE 02CAA01GH001',
        'PROTECCION RETROFIT (GABINETE) GUA1-7CHB01-GH112'
    ],
    3: [
        'TURBINE PROTECTION CABINET 03CAB00GH001',
        'TURBINE SUPERVISORY INSTRUMENT CABINET 03CFA00GH001',
        'UNIT&BOILER PROTECTIOON CABINET (1) 03CAB00GH001',
        'UNIT&BOILER PROTECTIOON CABINET (2) 03CAB00GH002',
        'INTERPOSING RELAY CABINET (1) 03CHM00GH001',
        'INTERPOSING RELAY CABINET (2) 03CHM00GH002',
        'GENERADOR PROTECTION RELAY PANEL 03CHA00GH001',
        'TRANSFORMER PROTECTION RELAY PANEL 03CHA00GH002',
        'GENERATOR CONTROL PANEL 03CHC00GH001',
        'ELECTRICAL INTERLOCK RELAY PANEL 03CHJ00GH001',
        'AVR CUBICLE 03MKC01GK101',
        'HYDROGEN GAS CONTROL PANEL 03MKV51GH001',
        'STATION TRANSFORMER PROTECTION RELAY PANEL 03CHA00GH003',
        'UNIT 3/4 COMMON EQUIPMENT SIGNAL INTERFACE CABINET (1) 03CBP00GH001',
        'UNIT 3/4 COMMON EQUIPMENT SIGNAL INTERFACE CABINET (2) 03CBP00GH002'
    ],
    // Debe calzar con SALA_RELES_PANELES de app.js.
    5: [
        'TURBINE PROTECTION INSTRUMENT 05CFA00GH001',
        'TURBINE SUPERVISORY INSTRUMENT 05CFA00GH001',
        'UNIT&BOILER PROTECTIOON CABINET (1) 05CAB00GH001',
        'UNIT&BOILER PROTECTIOON CABINET (2) 05CAB00GH002',
        'INTERPOSING RELAY CABINET (1) 05CHM00GH001',
        'INTERPOSING RELAY CABINET (2) 05CHM00GH002',
        'GENERADOR PROTECTION RELAY PANEL 05CHA00GH001',
        'TRANSFORMER PROTECTION RELAY PANEL 05CHA00GH002',
        'GENERATOR CONTROL PANEL 05CHC00GH001',
        'SYSTEM CABINET ELECTRIC 05CHF00GH001',
        'AVR CUBICLE 05MKC01GK101'
    ]
};

function salaRelesPanelesServer(unidad) {
    return SALA_RELES_PANELES[Number(unidad)] || SALA_RELES_PANELES[1];
}

function cloneCellStyle(from, to) {
    if (!from || !to) return;
    to.style = JSON.parse(JSON.stringify(from.style || {}));
    if (from.numFmt) to.numFmt = from.numFmt;
    if (from.alignment) to.alignment = { ...from.alignment };
    if (from.border) to.border = JSON.parse(JSON.stringify(from.border));
    if (from.fill) to.fill = JSON.parse(JSON.stringify(from.fill));
    if (from.font) to.font = JSON.parse(JSON.stringify(from.font));
}

async function generarPlanillaSalaReles(body) {
    const unidadNum = Number(String(body?.unidad || '').replace(/\D/g, '')) || 1;
    const templatePath = path.join(FORMATOS_DIR, SALA_RELES_TEMPLATE);
    if (!fs.existsSync(templatePath)) throw new Error(`Plantilla no encontrada: ${SALA_RELES_TEMPLATE}`);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(templatePath);
    const hoja = `SALA RELES U${unidadNum}`;
    const ws = workbook.getWorksheet(hoja) || workbook.getWorksheet('SALA RELES U1');
    if (!ws) throw new Error(`Hoja "${hoja}" no encontrada.`);

    workbook.worksheets.slice().forEach(sheet => {
        if (sheet.id !== ws.id) { try { workbook.removeWorksheet(sheet.id); } catch (e) {} }
    });
    ws.name = `SALA RELES U${unidadNum}`;
    workbook.views = [{ activeTab: 0 }];

    const panelesBase = salaRelesPanelesServer(unidadNum);
    const panelMap = new Map((body?.paneles || []).map(p => [String(p.panel || '').trim(), p]));
    const filas = panelesBase.flatMap(panel => {
        const capturados = (panelMap.get(panel)?.elementos || [])
            .filter(e => e && (e.elemento || e.temperatura));
        const elementos = capturados.length > 2 ? capturados : [...capturados, ...Array.from({ length: 2 - capturados.length }, () => ({ elemento: '', temperatura: '' }))];
        return elementos.map(e => ({ panel, elemento: e.elemento || '', temperatura: e.temperatura || '' }));
    });

    const obsRow = (() => {
        for (let r = 3; r <= ws.rowCount; r++) {
            const v = normStr(ws.getCell(r, 1).value);
            if (v.includes('OBSERVACION')) return r;
        }
        return ws.rowCount + 1;
    })();
    const dataStart = 3;
    const dataRows = Math.max(0, obsRow - dataStart);

    (ws.model.merges || []).slice().forEach(range => {
        const nums = String(range).match(/\d+/g)?.map(Number) || [];
        if (!nums.length) return;
        const minRow = Math.min(...nums);
        const maxRow = Math.max(...nums);
        if (maxRow >= dataStart && minRow < obsRow) {
            try { ws.unMergeCells(range); } catch (e) {}
        }
    });

    if (filas.length > dataRows) ws.insertRows(obsRow, Array.from({ length: filas.length - dataRows }, () => []));
    if (filas.length < dataRows) ws.spliceRows(dataStart + filas.length, dataRows - filas.length);

    const styleRow = ws.getRow(3);
    for (let i = 0; i < filas.length; i++) {
        const r = dataStart + i;
        ws.getRow(r).height = styleRow.height || 18;
        for (let c = 1; c <= 10; c++) cloneCellStyle(styleRow.getCell(c), ws.getCell(r, c));
        try { ws.mergeCells(r, 1, r, 4); } catch (e) {}
        try { ws.mergeCells(r, 5, r, 9); } catch (e) {}
        ws.getCell(r, 1).value = filas[i].panel;
        ws.getCell(r, 5).value = filas[i].elemento;
        const tempRaw = String(filas[i].temperatura || '').trim();
        const tempNum = Number(tempRaw.replace(',', '.'));
        ws.getCell(r, 10).value = tempRaw ? (Number.isFinite(tempNum) ? tempNum : tempRaw) : '';
        ws.getCell(r, 1).alignment = { ...(ws.getCell(r, 1).alignment || {}), wrapText: true, vertical: 'middle' };
        ws.getCell(r, 5).alignment = { ...(ws.getCell(r, 5).alignment || {}), wrapText: true, vertical: 'middle' };
        ws.getCell(r, 10).alignment = { ...(ws.getCell(r, 10).alignment || {}), horizontal: 'center', vertical: 'middle' };
    }

    // Observaciones: tras el insert/splice el encabezado (2 filas combinadas)
    // queda justo debajo de los datos, y el texto va en las filas siguientes,
    // una por línea. Se reescriben todas para no dejar restos de la plantilla.
    const obsHeaderRow = dataStart + filas.length;
    const primeraObs = obsHeaderRow + 2;
    const lineasObs = String(body?.observaciones || '')
        .split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const filasObsDisponibles = Math.max(0, ws.rowCount - primeraObs + 1);
    if (lineasObs.length > filasObsDisponibles && filasObsDisponibles > 0) {
        // Lo que no cabe se junta en la última fila para no perder texto.
        const sobrante = lineasObs.splice(filasObsDisponibles - 1);
        lineasObs.push(sobrante.join(' · '));
    }
    for (let r = primeraObs; r <= ws.rowCount; r++) {
        ws.getCell(r, 1).value = lineasObs[r - primeraObs] || '';
    }

    ws.getCell('C1').value = body?.fecha || '';
    ws.getCell('D1').value = body?.tecnicos ? `Tecnicos: ${body.tecnicos}` : '';
    ws.getCell('F1').value = body?.generacion ? `${body.generacion} Mw` : '';
    ws.getCell('H1').value = body?.tempAmb || '';
    ws.getCell('J2').value = 'TEMPERATURA MAX';

    const filename = `Planilla Sala Reles U${unidadNum} OT ${body?.ot || 'sn'}.xlsx`
        .replace(/\s+/g, ' ').replace(/[\\/:*?"<>|]/g, '-');
    const buffer = await workbook.xlsx.writeBuffer();
    return { buffer: Buffer.from(buffer), filename };
}

const DESALADORAS_TEMPLATE = 'RUTA DESALADORAS.xlsx';
const DESALADORAS_SHEETS = [8, 9, 10, 11];

function setTempCell(ws, address, raw) {
    const txt = String(raw ?? '').trim();
    const cell = ws.getCell(address);
    if (!txt) { cell.value = ''; return; }
    const n = Number(txt.replace(',', '.'));
    cell.value = Number.isFinite(n) ? n : txt;
}

async function generarPlanillaDesaladoras(body) {
    const templatePath = path.join(FORMATOS_DIR, DESALADORAS_TEMPLATE);
    if (!fs.existsSync(templatePath)) throw new Error(`Plantilla no encontrada: ${DESALADORAS_TEMPLATE}`);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(templatePath);

    const data = (body?.desaladoras || []).filter(d => d && DESALADORAS_SHEETS.includes(Number(d.id)));
    if (!data.length) throw new Error('No se recibieron datos de desaladoras.');
    const idsUsados = new Set(data.map(d => Number(d.id)));

    workbook.worksheets.slice().forEach(sheet => {
        const id = Number(String(sheet.name || '').match(/(\d+)$/)?.[1] || 0);
        if (!idsUsados.has(id)) {
            try { workbook.removeWorksheet(sheet.id); } catch (e) {}
        }
    });

    const fusibleCols = { A: 'B', B: 'D', C: 'F' };
    const contactorCols = { L1: 'I', L2: 'K', L3: 'M', T1: 'O', T2: 'Q', T3: 'S' };
    const portaRows = [8, 13, 18, 23, 28];
    const relRows = Array.from({ length: 12 }, (_, i) => 33 + i);

    data.forEach(d => {
        const id = Number(d.id);
        const ws = workbook.getWorksheet(`Desal ${id}`);
        if (!ws) throw new Error(`Hoja "Desal ${id}" no encontrada.`);

        setTempCell(ws, 'B4', d.regleta?.fase1);
        setTempCell(ws, 'D4', d.regleta?.fase2);
        setTempCell(ws, 'F4', d.regleta?.fase3);

        (d.portas || []).forEach(porta => {
            const rowA = portaRows[Number(porta.n) - 1];
            if (!rowA) return;
            const rowB = rowA + 1;
            Object.entries(fusibleCols).forEach(([fase, col]) => {
                setTempCell(ws, `${col}${rowA}`, porta.fusibles?.[fase]?.puntoA);
                setTempCell(ws, `${col}${rowB}`, porta.fusibles?.[fase]?.puntoB);
            });
            Object.entries(contactorCols).forEach(([fase, col]) => {
                setTempCell(ws, `${col}${rowA}`, porta.contactor?.[fase]);
            });
        });

        (d.relevantes || []).slice(0, relRows.length).forEach((rel, idx) => {
            const r = relRows[idx];
            ws.getCell(`A${r}`).value = rel.elemento || '';
            setTempCell(ws, `D${r}`, rel.temps?.[0]);
            setTempCell(ws, `F${r}`, rel.temps?.[1]);
            setTempCell(ws, `H${r}`, rel.temps?.[2]);
            setTempCell(ws, `J${r}`, rel.temps?.[3]);
            ws.getCell(`L${r}`).value = rel.comentario || '';
        });
    });

    workbook.views = [{ activeTab: 0 }];
    const hojas = [...idsUsados].sort((a, b) => a - b).join('-');
    const filename = `Planilla Desaladoras ${hojas} OT ${body?.ot || 'sn'}.xlsx`
        .replace(/\s+/g, ' ').replace(/[\\/:*?"<>|]/g, '-');
    const buffer = await workbook.xlsx.writeBuffer();
    return { buffer: Buffer.from(buffer), filename };
}

function writeJson(res, status, payload) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
}

function normalizarTareaPush(t = {}) {
    return {
        id: String(t.id || ''),
        tipo: t.tipo || 'Trabajo',
        liderId: t.lider_id || t.liderId || null,
        liderNombre: t.lider_nombre || t.liderNombre || '',
        ayudantesIds: t.ayudantes_ids || t.ayudantesIds || [],
        estadoTarea: t.estado_tarea || t.estadoTarea || '',
        estadoEjecucion: t.estado_ejecucion || t.estadoEjecucion || 'activo',
        otNumero: t.ot_numero || t.otNumero || '',
        ubicacion: t.ubicacion || '',
        fechaExpiracion: t.fecha_expiracion || t.fechaExpiracion || ''
    };
}

function tareaActivaPush(tarea) {
    const estadoTarea = String(tarea.estadoTarea || '').toLowerCase();
    const estadoEjecucion = String(tarea.estadoEjecucion || 'activo').toLowerCase();
    if (estadoEjecucion === 'finalizado' || estadoEjecucion === 'cerrado') return false;
    return ['en_curso', 'programada_semana', 'pendiente', 'programada'].includes(estadoTarea);
}

function describirTareaPush(tarea) {
    return [
        tarea.otNumero ? `OT ${tarea.otNumero}` : '',
        tarea.tipo || 'Trabajo',
        tarea.ubicacion || ''
    ].filter(Boolean).join(' - ');
}

function subscriptionParaTarea(subscription, tarea) {
    if (subscription.role === 'admin') return true;
    if (subscription.role !== 'trabajador' || !subscription.trabajador_id) return false;
    const trabajadorId = String(subscription.trabajador_id);
    return String(tarea.liderId || '') === trabajadorId ||
        (tarea.ayudantesIds || []).some((id) => String(id) === trabajadorId);
}

function subscriptionParaTrabajador(subscription, trabajadorId) {
    if (!trabajadorId) return false;
    return subscription.role === 'trabajador' && String(subscription.trabajador_id || '') === String(trabajadorId);
}

async function listarPushSubscriptions() {
    const { data, error } = await supabaseServer
        .from('push_subscriptions')
        .select('id, endpoint, subscription, role, trabajador_id, enabled')
        .eq('enabled', true);
    if (error) {
        if (['42P01', 'PGRST205'].includes(error.code)) {
            console.warn('[push] Falta tabla push_subscriptions. Ejecuta la migracion 20260425090000_push_notifications.sql.');
            return [];
        }
        throw error;
    }
    return data || [];
}

async function desactivarPushSubscription(id) {
    if (!id) return;
    await supabaseServer
        .from('push_subscriptions')
        .update({ enabled: false, updated_at: new Date().toISOString() })
        .eq('id', id)
        .catch(() => {});
}

async function enviarPushASuscripcion(row, payload) {
    if (!pushReady || !row?.subscription) return false;
    try {
        await webpush.sendNotification(row.subscription, JSON.stringify(payload), { TTL: 60 * 60 * 6 });
        return true;
    } catch (error) {
        const status = Number(error.statusCode || error.status || 0);
        if (status === 404 || status === 410) await desactivarPushSubscription(row.id);
        console.warn('[push] Error enviando push:', status || error.message);
        return false;
    }
}

async function enviarPushAFiltro(subscriptions, predicate, payload) {
    const destinatarios = subscriptions.filter(predicate);
    await Promise.allSettled(destinatarios.map((row) => enviarPushASuscripcion(row, payload)));
    return destinatarios.length;
}

const pushState = {
    initialized: false,
    inFlight: false,
    realtimeStarted: false,
    sentKeys: new Set(),
    tareas: new Map(),
    horasExtra: new Map(),
    solicitudesInsumos: new Map()
};

function recordarPushKey(key) {
    if (!key) return false;
    if (pushState.sentKeys.has(key)) return false;
    pushState.sentKeys.add(key);
    if (pushState.sentKeys.size > 1000) {
        const first = pushState.sentKeys.values().next().value;
        pushState.sentKeys.delete(first);
    }
    return true;
}

async function enviarPushUnico(eventKey, subscriptions, predicate, payload) {
    if (!recordarPushKey(eventKey)) return 0;
    return enviarPushAFiltro(subscriptions, predicate, payload);
}

function firmaAsignacionTarea(tarea) {
    return [
        tarea.estadoTarea || '',
        tarea.estadoEjecucion || '',
        tarea.liderId || '',
        ...(tarea.ayudantesIds || []).map(String).sort()
    ].join('|');
}

async function obtenerPushSnapshot() {
    const [tareasRes, heRes, insumosRes] = await Promise.all([
        supabaseServer.from('tareas').select('*'),
        Promise.resolve(
            supabaseServer.from('horas_extra').select('*').order('created_at', { ascending: false }).limit(200)
        ).catch(() => ({ data: [] })),
        Promise.resolve(
            supabaseServer.from('solicitudes_insumos').select('*').order('created_at', { ascending: false }).limit(200)
        ).catch(() => ({ data: [] }))
    ]);

    return {
        tareas: (tareasRes.data || []).map(normalizarTareaPush),
        horasExtra: heRes.data || [],
        solicitudesInsumos: insumosRes.data || []
    };
}

function aplicarPushBaseline(snapshot) {
    pushState.tareas = new Map(snapshot.tareas.map((tarea) => [String(tarea.id), tarea]));
    pushState.horasExtra = new Map(snapshot.horasExtra.map((item) => [String(item.id), String(item.estado || 'pendiente')]));
    pushState.solicitudesInsumos = new Map(snapshot.solicitudesInsumos.map((item) => [String(item.id), String(item.estado || 'pendiente')]));
    pushState.initialized = true;
}

async function revisarCambiosPush() {
    if (!pushReady || pushState.inFlight) return;
    pushState.inFlight = true;
    try {
        const snapshot = await obtenerPushSnapshot();
        if (!pushState.initialized) {
            aplicarPushBaseline(snapshot);
            return;
        }

        const subscriptions = await listarPushSubscriptions();
        if (!subscriptions.length) {
            aplicarPushBaseline(snapshot);
            return;
        }

        for (const tarea of snapshot.tareas) {
            const anterior = pushState.tareas.get(String(tarea.id));
            const cambioAsignacion = anterior && firmaAsignacionTarea(anterior) !== firmaAsignacionTarea(tarea);
            if ((!anterior || cambioAsignacion) && tareaActivaPush(tarea)) {
                await enviarPushUnico(
                    `tarea:${tarea.id}:${firmaAsignacionTarea(tarea)}`,
                    subscriptions,
                    (subscription) => subscriptionParaTarea(subscription, tarea),
                    {
                        title: 'Nuevo trabajo asignado',
                        body: describirTareaPush(tarea),
                        tag: `planify-task-${tarea.id}`,
                        url: './index.html'
                    }
                );
            }
        }

        for (const registro of snapshot.horasExtra) {
            const id = String(registro.id);
            const anterior = pushState.horasExtra.get(id);
            const actual = String(registro.estado || 'pendiente');
            if (anterior === 'pendiente' && actual !== 'pendiente') {
                await enviarPushUnico(
                    `he:${id}:${actual}`,
                    subscriptions,
                    (subscription) => subscriptionParaTrabajador(subscription, registro.trabajador_id),
                    {
                        title: actual === 'aprobado' ? 'Horas extra aprobadas' : 'Horas extra rechazadas',
                        body: `${registro.fecha || ''} - ${registro.horas || 0} hora(s).`,
                        tag: `planify-he-${id}`,
                        url: './index.html'
                    }
                );
            }
        }

        for (const solicitud of snapshot.solicitudesInsumos) {
            const id = String(solicitud.id);
            const anterior = pushState.solicitudesInsumos.get(id);
            const actual = String(solicitud.estado || 'pendiente');
            if (anterior === 'pendiente' && actual !== 'pendiente') {
                await enviarPushUnico(
                    `insumo:${id}:${actual}`,
                    subscriptions,
                    (subscription) => subscriptionParaTrabajador(subscription, solicitud.trabajador_id),
                    {
                        title: actual === 'aprobada' ? 'Solicitud de insumo aprobada' : 'Solicitud de insumo rechazada',
                        body: solicitud.insumo_nombre || 'Solicitud de insumo actualizada.',
                        tag: `planify-insumo-${id}`,
                        url: './index.html'
                    }
                );
            }
        }

        aplicarPushBaseline(snapshot);
    } catch (error) {
        console.warn('[push] No se pudieron revisar cambios:', error.message);
    } finally {
        pushState.inFlight = false;
    }
}

async function manejarCambioTareaPush(payload) {
    if (!pushReady || !pushState.initialized) return;
    const tarea = normalizarTareaPush(payload.new || {});
    if (!tarea.id) return;
    const anterior = pushState.tareas.get(String(tarea.id));
    pushState.tareas.set(String(tarea.id), tarea);

    const cambioAsignacion = anterior && firmaAsignacionTarea(anterior) !== firmaAsignacionTarea(tarea);
    if (payload.eventType !== 'INSERT' && !cambioAsignacion) return;
    if (!tareaActivaPush(tarea)) return;

    try {
        const subscriptions = await listarPushSubscriptions();
        await enviarPushUnico(
            `tarea:${tarea.id}:${firmaAsignacionTarea(tarea)}`,
            subscriptions,
            (subscription) => subscriptionParaTarea(subscription, tarea),
            {
                title: 'Nuevo trabajo asignado',
                body: describirTareaPush(tarea),
                tag: `planify-task-${tarea.id}`,
                url: './index.html'
            }
        );
    } catch (error) {
        console.warn('[push] Realtime tarea fallo:', error.message);
    }
}

async function manejarCambioHorasExtraPush(payload) {
    if (!pushReady || !pushState.initialized) return;
    const registro = payload.new || {};
    const id = String(registro.id || '');
    if (!id) return;
    const anterior = pushState.horasExtra.get(id);
    const actual = String(registro.estado || 'pendiente');
    pushState.horasExtra.set(id, actual);

    if (anterior !== 'pendiente' || actual === 'pendiente') return;

    try {
        const subscriptions = await listarPushSubscriptions();
        await enviarPushUnico(
            `he:${id}:${actual}`,
            subscriptions,
            (subscription) => subscriptionParaTrabajador(subscription, registro.trabajador_id),
            {
                title: actual === 'aprobado' ? 'Horas extra aprobadas' : 'Horas extra rechazadas',
                body: `${registro.fecha || ''} - ${registro.horas || 0} hora(s).`,
                tag: `planify-he-${id}`,
                url: './index.html'
            }
        );
    } catch (error) {
        console.warn('[push] Realtime horas_extra fallo:', error.message);
    }
}

async function manejarCambioSolicitudInsumoPush(payload) {
    if (!pushReady || !pushState.initialized) return;
    const solicitud = payload.new || {};
    const id = String(solicitud.id || '');
    if (!id) return;
    const anterior = pushState.solicitudesInsumos.get(id);
    const actual = String(solicitud.estado || 'pendiente');
    pushState.solicitudesInsumos.set(id, actual);

    if (anterior !== 'pendiente' || actual === 'pendiente') return;

    try {
        const subscriptions = await listarPushSubscriptions();
        await enviarPushUnico(
            `insumo:${id}:${actual}`,
            subscriptions,
            (subscription) => subscriptionParaTrabajador(subscription, solicitud.trabajador_id),
            {
                title: actual === 'aprobada' ? 'Solicitud de insumo aprobada' : 'Solicitud de insumo rechazada',
                body: solicitud.insumo_nombre || 'Solicitud de insumo actualizada.',
                tag: `planify-insumo-${id}`,
                url: './index.html'
            }
        );
    } catch (error) {
        console.warn('[push] Realtime solicitud insumo fallo:', error.message);
    }
}

function iniciarRealtimePush() {
    if (!pushReady || pushState.realtimeStarted) return;
    pushState.realtimeStarted = true;
    supabaseServer
        .channel('planify-push-server')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tareas' }, manejarCambioTareaPush)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'horas_extra' }, manejarCambioHorasExtraPush)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'solicitudes_insumos' }, manejarCambioSolicitudInsumoPush)
        .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                console.log('[push] Realtime activo para notificaciones inmediatas.');
            }
        });
}

const server = http.createServer(async (req, res) => {
    // CORS preflight
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('X-Planify-Server', 'planner_app');

    const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
    const pathname = requestUrl.pathname.replace(/\/+$/, '') || '/';

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    if (req.method === 'GET' && pathname === '/push/vapid-public-key') {
        writeJson(res, pushReady ? 200 : 503, {
            enabled: pushReady,
            publicKey: pushReady ? pushConfig.publicKey : '',
            message: pushReady ? 'Push remoto disponible' : 'Push remoto no configurado'
        });
        return;
    }

    if (req.method === 'GET' && pathname === '/push/status') {
        writeJson(res, 200, {
            enabled: pushReady,
            initialized: pushState.initialized,
            realtime: pushState.realtimeStarted,
            pollMs: PUSH_POLL_MS
        });
        return;
    }

    if (req.method === 'POST' && pathname === '/push/subscribe') {
        try {
            if (!pushReady) {
                writeJson(res, 503, { ok: false, error: 'Push remoto no configurado' });
                return;
            }
            const body = await readBody(req);
            if (!body?.subscription?.endpoint) {
                writeJson(res, 400, { ok: false, error: 'Suscripcion invalida' });
                return;
            }
            const payload = {
                endpoint: body.subscription.endpoint,
                subscription: body.subscription,
                role: body.role || 'visita',
                trabajador_id: body.trabajadorId || null,
                trabajador_nombre: body.trabajadorNombre || null,
                user_agent: body.userAgent || req.headers['user-agent'] || null,
                enabled: true,
                updated_at: new Date().toISOString()
            };
            const { error } = await supabaseServer
                .from('push_subscriptions')
                .upsert(payload, { onConflict: 'endpoint' });
            if (error) throw error;
            writeJson(res, 200, { ok: true });
        } catch (error) {
            writeJson(res, 500, { ok: false, error: error.message });
        }
        return;
    }

    if (req.method === 'POST' && pathname === '/push/unsubscribe') {
        try {
            const body = await readBody(req);
            const endpoint = body?.endpoint || body?.subscription?.endpoint;
            if (endpoint) {
                await supabaseServer
                    .from('push_subscriptions')
                    .update({ enabled: false, updated_at: new Date().toISOString() })
                    .eq('endpoint', endpoint);
            }
            writeJson(res, 200, { ok: true });
        } catch (error) {
            writeJson(res, 500, { ok: false, error: error.message });
        }
        return;
    }

    // POST /generar-planilla — genera Excel MONCON desde plantilla real
    if (req.method === 'POST' && pathname === '/generar-planilla') {
        try {
            const body = await readBody(req);
            const result = await generarPlanillaMoncon(body);
            res.writeHead(200, {
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition': `attachment; filename="${encodeURIComponent(result.filename)}"`,
                'Content-Length': result.buffer.length
            });
            res.end(result.buffer);
        } catch (error) {
            console.error('[server] /generar-planilla error:', error.message);
            writeJson(res, 500, { ok: false, error: error.message });
        }
        return;
    }

    // POST /generar-planilla-excitatriz — planilla de escobillas (U3/U4/U5)
    if (req.method === 'POST' && pathname === '/generar-planilla-excitatriz') {
        try {
            const body = await readBody(req);
            const result = await generarPlanillaExcitatriz(body);
            res.writeHead(200, {
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition': `attachment; filename="${encodeURIComponent(result.filename)}"`,
                'Content-Length': result.buffer.length,
                'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
                'Pragma': 'no-cache',
                'Expires': '0',
                'X-Planify-Generated-At': new Date().toISOString()
            });
            res.end(result.buffer);
        } catch (error) {
            console.error('[server] /generar-planilla-excitatriz error:', error.message);
            writeJson(res, 500, { ok: false, error: error.message });
        }
        return;
    }

    // POST /generar-planilla-trafo — planilla de transformadores AT (EXC/EST/AUX/PPAL)
    if (req.method === 'POST' && pathname === '/generar-planilla-trafo') {
        try {
            const body = await readBody(req);
            const result = await generarPlanillaTrafo(body);
            res.writeHead(200, {
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition': `attachment; filename="${encodeURIComponent(result.filename)}"`,
                'Content-Length': result.buffer.length
            });
            res.end(result.buffer);
        } catch (error) {
            console.error('[server] /generar-planilla-trafo error:', error.message);
            writeJson(res, 500, { ok: false, error: error.message });
        }
        return;
    }

    // POST /generar-planilla-sala-reles — planilla termografica Sala de Reles
    if (req.method === 'POST' && pathname === '/generar-planilla-sala-reles') {
        try {
            const body = await readBody(req);
            const result = await generarPlanillaSalaReles(body);
            res.writeHead(200, {
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition': `attachment; filename="${encodeURIComponent(result.filename)}"`,
                'Content-Length': result.buffer.length,
                'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
                'Pragma': 'no-cache',
                'Expires': '0',
                'X-Planify-Generated-At': new Date().toISOString()
            });
            res.end(result.buffer);
        } catch (error) {
            console.error('[server] /generar-planilla-sala-reles error:', error.message);
            writeJson(res, 500, { ok: false, error: error.message });
        }
        return;
    }

    // POST /generar-planilla-desaladoras — planilla termografica RUTA DESALADORAS
    if (req.method === 'POST' && pathname === '/generar-planilla-desaladoras') {
        try {
            const body = await readBody(req);
            const result = await generarPlanillaDesaladoras(body);
            res.writeHead(200, {
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition': `attachment; filename="${encodeURIComponent(result.filename)}"`,
                'Content-Length': result.buffer.length,
                'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
                'Pragma': 'no-cache',
                'Expires': '0',
                'X-Planify-Generated-At': new Date().toISOString()
            });
            res.end(result.buffer);
        } catch (error) {
            console.error('[server] /generar-planilla-desaladoras error:', error.message);
            writeJson(res, 500, { ok: false, error: error.message });
        }
        return;
    }

    // POST /api/seguimiento-vib/importar
    if (req.method === 'POST' && pathname === '/api/seguimiento-vib/importar') {
        try {
            const body = await readBody(req);
            const { nombrePeriodo, archivoOrigen, totalEquipos, creado_por, equipos } = body || {};

            if (!nombrePeriodo || !Array.isArray(equipos) || !equipos.length) {
                writeJson(res, 400, { ok: false, error: 'Faltan datos: nombrePeriodo y equipos son requeridos.' });
                return;
            }

            // 1. Insertar el periodo
            const periodoPayload = {
                nombre: nombrePeriodo,
                archivo_origen: archivoOrigen || null,
                total_equipos: totalEquipos || equipos.length
            };
            if (creado_por) periodoPayload.creado_por = creado_por;

            const { data: periodo, error: periodoError } = await supabaseServer
                .from('seguimiento_vib_periodos')
                .insert([periodoPayload])
                .select()
                .single();

            if (periodoError) throw periodoError;

            // 2. Insertar equipos en chunks de 500
            const payload = equipos.map((eq) => ({ ...eq, periodo_id: periodo.id }));
            for (let i = 0; i < payload.length; i += 500) {
                const chunk = payload.slice(i, i + 500);
                const { error: equiposError } = await supabaseServer
                    .from('seguimiento_vib_equipos')
                    .insert(chunk);
                if (equiposError) throw equiposError;
            }

            writeJson(res, 200, { ok: true, periodo });
        } catch (error) {
            console.error('[server] /api/seguimiento-vib/importar error:', error.message);
            writeJson(res, 500, { ok: false, error: error.message });
        }
        return;
    }

    // POST /generar-pdf
    if (req.method === 'POST' && pathname === '/generar-pdf') {
        const ts = Date.now();
        const inputFile = path.join(TEMP_DIR, `input_pdf_${ts}.json`);
        const outputFile = path.join(TEMP_DIR, `output_pdf_${ts}.pdf`);
        const scriptPath = path.join(__dirname, 'generar_pdf.py');
        try {
            const data = await readBody(req);
            fs.writeFileSync(inputFile, JSON.stringify(data, null, 2), 'utf8');
            await runPython(scriptPath, inputFile, outputFile);
            const pdfBuffer = fs.readFileSync(outputFile);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ pdf: pdfBuffer.toString('base64') }));
        } catch (error) {
            console.error('[server] /generar-pdf error:', error.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
        } finally {
            try { fs.unlinkSync(inputFile); } catch (_) {}
            try { fs.unlinkSync(outputFile); } catch (_) {}
        }
        return;
    }

    // POST /generar-excel
    if (req.method === 'POST' && pathname === '/generar-excel') {
        const ts = Date.now();
        const inputFile = path.join(TEMP_DIR, `input_xlsx_${ts}.json`);
        const outputFile = path.join(TEMP_DIR, `output_xlsx_${ts}.xlsx`);
        const scriptPath = path.join(__dirname, 'generar_excel.py');
        try {
            const data = await readBody(req);
            fs.writeFileSync(inputFile, JSON.stringify(data, null, 2), 'utf8');
            await runPython(scriptPath, inputFile, outputFile);
            const xlsxBuffer = fs.readFileSync(outputFile);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ xlsx: xlsxBuffer.toString('base64') }));
        } catch (error) {
            console.error('[server] /generar-excel error:', error.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
        } finally {
            try { fs.unlinkSync(inputFile); } catch (_) {}
            try { fs.unlinkSync(outputFile); } catch (_) {}
        }
        return;
    }

    // Static files
    const filePath = resolvePath(pathname);
    if (!filePath) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    fs.readFile(filePath, (error, content) => {
        if (error && error.code === 'ENOENT') {
            fs.readFile(path.join(rootDir, 'index.html'), (fallbackError, fallbackContent) => {
                if (fallbackError) {
                    res.writeHead(500);
                    res.end('Internal Server Error');
                    return;
                }
                res.writeHead(200, { 'Content-Type': mimeTypes['.html'] });
                res.end(fallbackContent);
            });
            return;
        }
        if (error) {
            res.writeHead(500);
            res.end('Internal Server Error');
            return;
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
        res.end(content);
    });
});

function listenWithFallback(port, attemptsRemaining = 10) {
    server.once('error', (error) => {
        if (error.code === 'EADDRINUSE' && !process.env.PORT && attemptsRemaining > 0) {
            const nextPort = port + 1;
            console.warn(`[server] Puerto ${port} ocupado. Reintentando en ${nextPort}...`);
            listenWithFallback(nextPort, attemptsRemaining - 1);
            return;
        }

        console.error(`[server] No se pudo iniciar en el puerto ${port}:`, error.message);
        process.exit(1);
    });

    server.listen(port, () => {
        const address = server.address();
        const activePort = typeof address === 'object' && address ? address.port : port;
        console.log(`Planner app running at http://localhost:${activePort}`);
        console.log(`PDF/Excel server integrated at http://localhost:${activePort}/generar-pdf`);
        if (activePort !== requestedPort) {
            console.log(`[server] Puerto solicitado ${requestedPort} ocupado; usando ${activePort}.`);
        }
        if (pushReady) {
            revisarCambiosPush().then(iniciarRealtimePush);
            setInterval(revisarCambiosPush, PUSH_POLL_MS);
            console.log(`[push] Push remoto activo. Realtime + respaldo cada ${PUSH_POLL_MS} ms.`);
        }
    });
}

listenWithFallback(requestedPort);
