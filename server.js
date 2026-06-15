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

function encontrarFilaEnHoja(ws, nombreEquipo) {
    const target = normStr(nombreEquipo);
    if (!target) return null;
    const targetWords = target.split(/\s+/).filter(w => w.length > 1);
    const colA = ws.getColumn(1);
    let found = null;
    let bestScore = 0;
    colA.eachCell({ includeEmpty: false }, (cell, rowNum) => {
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
        if (score >= 0.6 && matches >= 2 && score > bestScore) {
            found = rowNum;
            bestScore = score;
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

    equipos.forEach((eq, eqIdx) => {
        const filaBase = encontrarFilaEnHoja(ws, eq.nombre);
        if (!filaBase) { noEncontrados.push(eq.nombre); return; }

        // La plantilla tenía nombres con "UNIDAD" prefijo por error. Sobrescribimos
        // la columna A con el nombre limpio del seed para que la planilla quede
        // consistente con la app.
        const nombreLimpio = String(eq.nombre || '').replace(/^UNIDAD\s+/i, '').trim();
        if (nombreLimpio) setCellSafe(ws, filaBase, 1, nombreLimpio);

        const comps = eq.componentes || [];
        comps.forEach((comp, compIdx) => {
            const fila = filaBase + compIdx;
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

            const colTA = compIdx === 0 ? 5 : 7;
            const colTB = compIdx === 0 ? 6 : 8;
            if (Array.isArray(med.temperaturas) && med.temperaturas.length) {
                if (med.temperaturas.length === 1 && med.temperaturas[0].valor === 'N/A') {
                    setCellSafe(ws, fila, colTA, 'N/A');
                } else {
                    med.temperaturas.forEach((t, idx) => {
                        const col = idx === 0 ? colTA : colTB;
                        const tv = Number(String(t.valor).replace(',', '.'));
                        setCellSafe(ws, fila, col, Number.isFinite(tv) ? tv : t.valor);
                    });
                }
            } else if (med.temperatura != null) {
                const tv = Number(String(med.temperatura).replace(',', '.'));
                setCellSafe(ws, fila, colTA, Number.isFinite(tv) ? tv : med.temperatura);
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
    workbook.worksheets.forEach(sheet => {
        sheet.pageSetup = {
            ...(sheet.pageSetup || {}),
            orientation: 'landscape',
            fitToPage: true,
            fitToWidth: 1,
            fitToHeight: 0,
            margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
            horizontalCentered: true,
            paperSize: 9 // A4
        };
    });

    const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
    const d = new Date();
    const fechaArchivo = `${d.getDate()} ${meses[d.getMonth()]}`;
    const filename = `MONCON ${plantilla.tipo} ${ruta.unidad || ''} — OT ${ejecucion.ot || 'sn'} — ${fechaArchivo}.xlsx`
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
