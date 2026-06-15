// ════════════════════════════════════════════════════════════════════
// Generador de planillas MONCON (Excel)
// ════════════════════════════════════════════════════════════════════
// Toma una ruta cerrada (o activa) y rellena la plantilla MONCON
// correspondiente con los datos capturados: vibración, dir, temperaturas
// (2 puntos por componente), observaciones y kizeo (tick si notificado).
//
// Detección de plantilla por nombre de la ruta:
//   contiene "BOMBAS"       → Formato MONCON BOMBAS 15D.xlsx
//   contiene "VENTILADORES" → Formato MONCON VENTILADORES 15D.xlsx
//   contiene "TURBINA"      → Formato MONCON TURBINA 15D.xlsx
//
// La hoja dentro del libro se elige por la unidad y frecuencia
// (ej. "BBAS U1 15D" para bombas U1 15D).
//
// El mapeo equipo→fila se RESUELVE EN TIEMPO DE EJECUCIÓN buscando el
// nombre del equipo en la columna A de la hoja. Esto evita hardcodear
// y permite que las plantillas se editen sin tocar código.
//
// Expone:
//   window.generarPlanillaDeRuta(rutaIdx, opts?)
//   window.tienePlantillaDisponible(ruta)  → boolean
// ════════════════════════════════════════════════════════════════════

(function () {
    'use strict';

    // ── Helpers ─────────────────────────────────────────────────────────
    const normalizar = (s) => String(s || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();

    // ── Catálogo de plantillas conocidas ────────────────────────────────
    // Cada entrada matchea por regex sobre el NOMBRE de la ruta. El primer
    // patrón que matchea gana, por eso se ordenan de MÁS específico a MENOS.
    // `hoja` puede ser string o función (ruta → string).
    const PLANTILLAS = [
        // ── 15D (Quincenal) ─────────────────────────────────────────
        {
            tipo: 'BOMBAS 15D',
            match: /BOMBAS\s+U\d.*15\s*D/i,
            archivo: 'Formato MONCON BOMBAS 15D.xlsx',
            hoja: r => `BBAS U${(r.unidad || '').replace(/\D/g, '')} 15D`,
        },
        {
            tipo: 'VENTILADORES 15D',
            match: /VENTILADORES\s+U\d.*15\s*D/i,
            archivo: 'Formato MONCON VENTILADORES 15D.xlsx',
            hoja: r => `VENTILADORES U${(r.unidad || '').replace(/\D/g, '')} 15D`,
        },
        {
            tipo: 'TURBINA 15D',
            match: /TURBINA.*15\s*D/i,
            archivo: 'Formato MONCON TURBINA 15D.xlsx',
            hoja: 'TURBINA GEN 15D',
        },

        // ── 60D (Bimensual) ─────────────────────────────────────────
        {
            tipo: 'VENTILADORES 60D',
            match: /VENTILADORES\s+U\d.*60\s*D/i,
            archivo: 'Formato MONCON VENTILADORES 60D.xlsx',
            hoja: r => `VENTILADORES U${(r.unidad || '').replace(/\D/g, '')} 60D`,
        },

        // ── 90D (Trimestral) ────────────────────────────────────────
        // ⚠️ Más específicos primero (RETROFIT/PRETRA antes que BOMBAS genérico)
        {
            tipo: 'SC BBA PRETRA 90D',
            match: /SISTEMAS?\s+COMUNES?.*BOMBAS?\s+PRETRA.*90\s*D/i,
            archivo: 'Formato MONCON SC BBA PRET 90D.xlsx',
            hoja: 'BBA PRETRA 90D',
        },
        {
            tipo: 'SC RETROFIT 90D',
            match: /CONDIC.*TRANSP.*RETRO.*90|SC.*RETROFIT.*90/i,
            archivo: 'Formato MONCON SC RETROFIT 90D.xlsx',
            hoja: 'BBA PRETRA 90D',  // sí, en este archivo la hoja se llama así
        },
        {
            tipo: 'BOMBAS RETROFIT 90D',
            match: /BOMBAS?\s+RETROFIT.*90\s*D/i,
            archivo: 'Formato MONCON BOMBAS RETROFIT 90 D.xlsx',
            hoja: 'BBA RETROFIT 90D',
        },
        {
            tipo: 'BOMBAS 90D',
            match: /BOMBAS\s+U\d.*90\s*D/i,
            archivo: 'Formato MONCON BOMBAS BOMBAS 90 D.xlsx',
            hoja: r => `RUTA BOMBAS U${(r.unidad || '').replace(/\D/g, '')} 90D`,
        },
        {
            tipo: 'CAR 90D',
            match: /\bCAR\s+U\d.*90\s*D/i,
            archivo: 'Formato MONCON CAR 90D.xlsx',
            hoja: 'RUTA CAR 90D',
        },

        // ── 180D (Semestral) ────────────────────────────────────────
        // ⚠️ PLANTA DE AGUAS antes que BOMBAS genérico
        {
            tipo: 'PLANTA AGUA BOMBAS 180D',
            match: /PLANTA.*AGUAS?.*BOMBAS.*180/i,
            archivo: 'Formato MONCON PLANTA DE AGUA BOMBAS 180D.xlsx',
            hoja: 'BBAS U5 180D',  // nombre de hoja heredado, contiene todo el listado PA
        },
        {
            tipo: 'BOMBAS 180D',
            match: /BOMBAS\s+U\d.*180\s*D/i,
            archivo: 'Formato MONCON BOMBAS 180D.xlsx',
            // El número se saca del NOMBRE de la ruta (el campo unidad a veces
            // trae "U1-2" u otros agregados que no calzan con la hoja).
            hoja: r => {
                const m = String(r.nombre || '').match(/U(\d)/i);
                return m ? `BBAS U${m[1]} 180D` : null;
            },
        },
        {
            tipo: 'ESCORIA 180D',
            match: /ESCORIA\s+U\d.*180/i,
            archivo: 'Formato MONCON ESCORIA 180D.xlsx',
            // No existe hoja U1 — el formato agrupa U1 dentro de la hoja "U2".
            // Devolvemos candidatos en orden y el generador usa el primero que exista.
            hoja: r => {
                const m = String(r.nombre || '').match(/U(\d)/i);
                const n = m ? m[1] : '';
                return [`ESCORIA U${n} 180D`, 'ESCORIA U2 180D'];
            },
        },

        // ── 1M / 30D (Mensual) ──────────────────────────────────────
        {
            tipo: 'COMPRESORES 1M',
            match: /PLANTA.*AGUAS?.*COMPRESORES.*(30\s*D|1\s*M)|COMPRESORES.*(30\s*D|1\s*M)/i,
            archivo: 'Formato MONCON COMPRESORES 1M.xlsx',
            hoja: 'COMPRESORES DESAL',
        },
        {
            tipo: 'LLENADO SILO 1M',
            match: /LLENADO\s+SILO|SILO\s+LLENADO|CONDICIONES\s+LLENADO/i,
            archivo: 'Formato LLENADO DE SILO 1M.xlsx',
            hoja: 'LLENADO DE SILO',
        },
        {
            tipo: 'PUERTO 1M',
            match: /PUERTO.*(30\s*D|1\s*M)/i,
            archivo: 'Formato MONCON PUERTO 1M.xlsx',
            hoja: 'RUTA PUERTO',
        },
    ];

    function detectarPlantilla(rutaNombre) {
        const n = String(rutaNombre || '');
        for (const p of PLANTILLAS) {
            if (p.match.test(n)) return p;
        }
        return null;
    }

    // Devuelve el nombre de la hoja a usar. `plantilla.hoja` puede ser:
    //   - string fija
    //   - función(ruta) → string o ARRAY de candidatos en orden de preferencia
    // Si recibe el workbook, valida existencia y elige el primer candidato real.
    function resolverHoja(plantilla, ruta, workbook) {
        let candidatos = typeof plantilla.hoja === 'function' ? plantilla.hoja(ruta) : plantilla.hoja;
        if (!candidatos) return null;
        if (!Array.isArray(candidatos)) candidatos = [candidatos];
        if (!workbook) return candidatos[0];
        for (const c of candidatos) {
            if (c && workbook.Sheets[c]) return c;
        }
        return null;
    }

    // ── Header genérico ─────────────────────────────────────────────────
    // Las plantillas varían la posición del label "Orden de trabajo" (D1 en
    // los 15D, F1 en los 180D...). Localizamos cada label en la fila 1 y
    // escribimos el valor justo DESPUÉS del merge que contiene el label.
    function escribirHeader(ws, fecha, ot) {
        const merges = ws['!merges'] || [];
        const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:Z3');

        const colDespuesDelLabel = (rowIdx, colIdx) => {
            // Si el label está en un merge, saltar al final del merge + 1
            for (const m of merges) {
                if (m.s.r === rowIdx && colIdx >= m.s.c && colIdx <= m.e.c) {
                    return m.e.c + 1;
                }
            }
            return colIdx + 1;
        };

        for (let c = 0; c <= Math.min(range.e.c, 14); c++) {
            const addr = XLSX.utils.encode_cell({ r: 0, c });
            const cell = ws[addr];
            if (!cell || typeof cell.v !== 'string') continue;
            const v = normalizar(cell.v);
            if (v.includes('FECHA ENTREGA')) {
                const target = XLSX.utils.encode_cell({ r: 0, c: colDespuesDelLabel(0, c) });
                setCell(ws, target, fecha);
            } else if (v.includes('ORDEN DE TRABAJO')) {
                const target = XLSX.utils.encode_cell({ r: 0, c: colDespuesDelLabel(0, c) });
                setCell(ws, target, ot);
            }
        }
        // Limpiar restos de F1/F2 (firmas booleanas) en fila 2 si existen
        ['J2', 'K2', 'L2'].forEach(a => {
            if (ws[a] && ws[a].v === false) clearCell(ws, a);
        });
    }

    function encontrarFilaEquipo(ws, nombreEquipo) {
        const target = normalizar(nombreEquipo);
        if (!target) return null;
        const targetWords = target.split(/\s+/).filter(w => w.length > 1);
        const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
        let found = null, bestScore = 0;
        for (let r = Math.max(range.s.r, 3); r <= range.e.r; r++) {
            const cell = ws[XLSX.utils.encode_cell({ r, c: 0 })];
            if (!cell || !cell.v) continue;
            const v = normalizar(cell.v);
            if (!v) continue;
            if (v === target) return r + 1;
            if (v.includes(target) || target.includes(v)) {
                if (bestScore < 100) { found = r + 1; bestScore = 100; }
                continue;
            }
            const cellWords = v.split(/\s+/).filter(w => w.length > 1);
            const shorter = cellWords.length < targetWords.length ? cellWords : targetWords;
            const longer = cellWords.length < targetWords.length ? targetWords : cellWords;
            const matches = shorter.filter(w => longer.includes(w)).length;
            const score = matches / shorter.length;
            if (score >= 0.6 && matches >= 2 && score > bestScore) {
                found = r + 1;
                bestScore = score;
            }
        }
        return found;
    }

    // Escribe valor en celda manejando ref vacía. NO toca celdas merged
    // (el formato del template las preserva).
    function setCell(ws, addr, valor, tipo) {
        if (valor === undefined || valor === null || valor === '') return;
        const t = tipo || (typeof valor === 'number' ? 'n' : 's');
        ws[addr] = { t, v: valor };
        // Asegurar que !ref incluya esta celda
        const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
        const cell = XLSX.utils.decode_cell(addr);
        if (cell.r > range.e.r) range.e.r = cell.r;
        if (cell.c > range.e.c) range.e.c = cell.c;
        ws['!ref'] = XLSX.utils.encode_range(range);
    }

    // Limpia una celda (la deja sin valor pero respeta el formato).
    function clearCell(ws, addr) {
        if (ws[addr]) {
            delete ws[addr].v;
            delete ws[addr].w;
            delete ws[addr].t;
        }
    }

    // Convierte fecha "2026-06-10" o Date → "10/06/2026"
    function fmtFecha(d) {
        if (!d) return '';
        try {
            const date = typeof d === 'string' ? new Date(d + 'T12:00:00') : new Date(d);
            const dd = String(date.getDate()).padStart(2, '0');
            const mm = String(date.getMonth() + 1).padStart(2, '0');
            const yy = date.getFullYear();
            return `${dd}/${mm}/${yy}`;
        } catch (e) { return String(d); }
    }

    // Recupera los datos de una ejecución (activa o cerrada del histórico)
    function obtenerDatosEjecucion(rutaIdx, opts = {}) {
        // 1) Activa
        if (!opts.preferirHistorial && typeof getEjecucionActiva === 'function') {
            const ej = getEjecucionActiva(rutaIdx);
            if (ej) return ej;
        }
        // 2) Historial local
        try {
            const hist = JSON.parse(localStorage.getItem('planify_rutas_historial') || '[]');
            // Buscar la más reciente para esa ruta
            const candidatas = hist.filter(h => Number(h.rutaIdx) === Number(rutaIdx));
            if (candidatas.length) {
                return candidatas[candidatas.length - 1]; // la más reciente (push order)
            }
        } catch (e) {}
        return null;
    }

    // ── URL del backend (Render en prod, localhost en dev) ──────────
    // Usa la URL global declarada en index.html (window.PLANIFY_PDF_BACKEND)
    // como fuente única — evita que se desincronicen entre archivos.
    const PLANILLA_SERVER = (() => {
        const h = window.location.hostname;
        if (h === 'localhost' || h === '127.0.0.1') return '';
        return window.PLANIFY_PDF_BACKEND || 'https://planify-backend-lfq3.onrender.com';
    })();

    // ── Función principal ──────────────────────────────────────────────
    window.generarPlanillaDeRuta = async function(rutaIdx, opts = {}) {
        if (typeof RUTAS_VIBRACION_SEED === 'undefined') {
            alert('Datos de rutas no disponibles todavía.');
            return;
        }
        const ruta = RUTAS_VIBRACION_SEED[rutaIdx];
        if (!ruta) { alert('Ruta no encontrada.'); return; }

        const plantilla = detectarPlantilla(ruta.nombre);
        if (!plantilla) {
            alert(`No hay plantilla disponible para esta ruta:\n${ruta.nombre}\n\nLas plantillas se mapean por nombre — si esta ruta debería tener una, avísame con el formato correcto y la agrego.`);
            return;
        }

        const ej = obtenerDatosEjecucion(rutaIdx, opts);
        if (!ej) {
            alert('Esta ruta no tiene datos capturados aún.');
            return;
        }

        // Mostrar indicador de carga
        const loading = document.createElement('div');
        loading.style.cssText = 'position:fixed; bottom:24px; right:24px; background:#1e40af; color:#fff; padding:0.7rem 1.1rem; border-radius:10px; font-weight:600; box-shadow:0 12px 24px rgba(30,64,175,0.35); z-index:11000; display:flex; align-items:center; gap:0.5rem;';
        loading.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generando planilla…';
        document.body.appendChild(loading);

        try {
            const resp = await fetch(`${PLANILLA_SERVER}/generar-planilla`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ruta, ejecucion: ej })
            });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                throw new Error(err.error || `HTTP ${resp.status}`);
            }

            const blob = await resp.blob();
            const cd = resp.headers.get('Content-Disposition') || '';
            const fnMatch = cd.match(/filename="?([^"]+)"?/);
            const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
            const d = new Date();
            const fechaArchivo = `${d.getDate()} ${meses[d.getMonth()]}`;
            const fallbackName = `MONCON ${plantilla.tipo} ${ruta.unidad || ''} — OT ${ej.ot || 'sn'} — ${fechaArchivo}.xlsx`
                .replace(/\s+/g, ' ').replace(/[\\/:*?"<>|]/g, '-');
            const filename = fnMatch ? decodeURIComponent(fnMatch[1]) : fallbackName;

            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);

            loading.remove();
            const t = document.createElement('div');
            t.style.cssText = 'position:fixed; bottom:24px; right:24px; background:#16a34a; color:#fff; padding:0.7rem 1.1rem; border-radius:10px; font-weight:600; box-shadow:0 12px 24px rgba(22,163,74,0.35); z-index:11000;';
            t.innerHTML = '<i class="fa-solid fa-circle-check"></i> Planilla generada y descargada';
            document.body.appendChild(t);
            setTimeout(() => t.remove(), 3000);
        } catch (e) {
            loading.remove();
            console.error('[planilla] Error:', e);
            alert('Error generando planilla:\n' + e.message);
        }
    };

    // Comprueba si hay plantilla disponible para esta ruta
    window.tienePlantillaDisponible = function(ruta) {
        if (!ruta) return false;
        return !!detectarPlantilla(ruta.nombre);
    };

    console.log('[planillas] generador cargado');
})();
