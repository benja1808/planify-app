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

    // Busca en col A de la hoja la fila donde aparece el nombre del equipo.
    // Match flexible: normaliza ambos y compara substring case/accent-insensitive.
    function encontrarFilaEquipo(ws, nombreEquipo) {
        const nombreNorm = normalizar(nombreEquipo);
        if (!nombreNorm) return null;
        const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
        for (let r = range.s.r; r <= range.e.r; r++) {
            const cell = ws[XLSX.utils.encode_cell({ r, c: 0 })];
            if (!cell || !cell.v) continue;
            const v = normalizar(cell.v);
            if (!v) continue;
            // Match exacto o ambos lados se contienen (para variaciones menores)
            if (v === nombreNorm || v.includes(nombreNorm) || nombreNorm.includes(v)) {
                return r + 1; // SheetJS usa 0-based row, devolvemos 1-based
            }
        }
        return null;
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

        // ── 1) Cargar plantilla ─────────────────────────────────────────
        let workbook;
        try {
            const resp = await fetch(`formatos/${encodeURIComponent(plantilla.archivo)}`);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const buf = await resp.arrayBuffer();
            workbook = XLSX.read(buf, { type: 'array', cellStyles: true, cellNF: true });
        } catch (e) {
            alert('No pude cargar la plantilla:\n' + e.message);
            return;
        }

        // La hoja se resuelve CONTRA el workbook: si la plantilla define
        // varios candidatos (ej. ESCORIA U1 no existe → cae a U2), se usa
        // el primero que realmente exista en el archivo.
        const hoja = resolverHoja(plantilla, ruta, workbook);
        if (!hoja) {
            alert(`No encontré una hoja válida en la plantilla para esta ruta.\nPlantilla: ${plantilla.archivo}\nHojas disponibles: ${workbook.SheetNames.join(', ')}`);
            return;
        }
        const ws = workbook.Sheets[hoja];

        // ── 2) Rellenar encabezado ──────────────────────────────────────
        const hoyStr = fmtFecha(ej.fechaCierre || ej.fechaInicio || new Date());

        // Header genérico: localiza los labels "Fecha entrega..." y "Orden de
        // trabajo" en la fila 1 (posición varía por formato) y escribe el
        // valor después del merge del label.
        // Para turbina los encabezados se repiten por unidad → omitir por ahora.
        const esTurbina = /TURBINA/i.test(plantilla.tipo);
        if (!esTurbina) {
            escribirHeader(ws, hoyStr, ej.ot || '');
        }

        // ── 3) Rellenar equipos ─────────────────────────────────────────
        // Cada equipo de la ruta intenta vincular con su fila en la plantilla
        // buscando el nombre en col A. Si no aparece, lo saltamos y avisamos.
        const noEncontrados = [];
        const equiposRuta = ruta.equipos || [];

        equiposRuta.forEach((eq, eqIdx) => {
            const filaBase = encontrarFilaEquipo(ws, eq.nombre);
            if (!filaBase) {
                noEncontrados.push(eq.nombre);
                return;
            }
            // Iterar cada componente (motor / ventilador / bomba / amp)
            const comps = eq.componentes || [];
            comps.forEach((comp, compIdx) => {
                const fila = filaBase + compIdx;
                const k = `${eqIdx}.${compIdx}`;
                const estado = ej.componentesEstado?.[k] || '';
                const med = ej.mediciones?.[k] || null;
                const obs = ej.observaciones?.[k] || '';

                // Columnas: A=Activo B=Comp C=Vib D=Dir E=T°1 F=T°2 G=T°3 H=T°4 I=Obs J=Fecha K=Kizeo
                if (!med && estado === 'no-ejecutado') {
                    // Componente marcado como no ejecutado: solo escribir Obs = "No ejecutado"
                    setCell(ws, `I${fila}`, obs || 'No ejecutado');
                    return;
                }
                if (!med) return; // sin datos capturados → dejar la fila en blanco

                // Vibración + Dir (Punto)
                if (med.vibracion != null) {
                    setCell(ws, `C${fila}`, med.vibracion === 'N/A' ? 'N/A' : Number(med.vibracion) || med.vibracion);
                }
                if (med.punto) setCell(ws, `D${fila}`, med.punto);

                // Temperaturas: el componente 0 (motor) usa T°1+T°2 (cols E,F)
                //               el componente 1 (bomba/vent) usa T°3+T°4 (cols G,H)
                //               (válido para 2 componentes por equipo, que es lo común)
                const colT_A = compIdx === 0 ? 'E' : 'G';
                const colT_B = compIdx === 0 ? 'F' : 'H';
                if (Array.isArray(med.temperaturas) && med.temperaturas.length) {
                    // Si es N/A explícito, escribir "N/A" en col A del par
                    if (med.temperaturas.length === 1 && med.temperaturas[0].valor === 'N/A') {
                        setCell(ws, `${colT_A}${fila}`, 'N/A');
                    } else {
                        med.temperaturas.forEach((t, idx) => {
                            const col = idx === 0 ? colT_A : colT_B;
                            setCell(ws, `${col}${fila}`, isNaN(Number(t.valor)) ? t.valor : Number(t.valor));
                        });
                    }
                } else if (med.temperatura != null) {
                    // Formato viejo de temperatura única
                    setCell(ws, `${colT_A}${fila}`, isNaN(Number(med.temperatura)) ? med.temperatura : Number(med.temperatura));
                }

                if (obs) setCell(ws, `I${fila}`, obs);

                // Fecha + Kizeo solo en la fila del primer componente del equipo
                if (compIdx === 0) {
                    const fechaComp = ej.componentesAt?.[k] || ej.fechaInicio || ej.fechaCierre;
                    setCell(ws, `J${fila}`, fmtFecha(fechaComp));
                    if (med.kizeo && med.kizeo.notificado) {
                        setCell(ws, `K${fila}`, '✓');
                    } else {
                        clearCell(ws, `K${fila}`);
                    }
                }
            });
        });

        // ── 4) Descargar ────────────────────────────────────────────────
        const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
        const d = new Date();
        const fechaArchivo = `${d.getDate()} ${meses[d.getMonth()]}`;
        const filename = `MONCON ${plantilla.tipo} ${ruta.unidad || ''} — OT ${ej.ot || 'sn'} — ${fechaArchivo}.xlsx`
            .replace(/\s+/g, ' ')
            .replace(/[\\/:*?"<>|]/g, '-');

        XLSX.writeFile(workbook, filename);

        // Aviso si hubo equipos sin match
        if (noEncontrados.length) {
            console.warn('[planilla] equipos sin fila en la plantilla:', noEncontrados);
            // Toast suave
            const t = document.createElement('div');
            t.style.cssText = 'position:fixed; bottom:24px; right:24px; background:#f59e0b; color:#fff; padding:0.7rem 1.1rem; border-radius:10px; font-weight:600; box-shadow:0 12px 24px rgba(245,158,11,0.35); z-index:11000; max-width:380px; font-size:0.85rem;';
            t.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Planilla generada — ${noEncontrados.length} equipo(s) sin fila en la plantilla:<br><small style="opacity:0.9;">${noEncontrados.slice(0,3).join(', ')}${noEncontrados.length > 3 ? '...' : ''}</small>`;
            document.body.appendChild(t);
            setTimeout(() => t.remove(), 5000);
        } else {
            const t = document.createElement('div');
            t.style.cssText = 'position:fixed; bottom:24px; right:24px; background:#16a34a; color:#fff; padding:0.7rem 1.1rem; border-radius:10px; font-weight:600; box-shadow:0 12px 24px rgba(22,163,74,0.35); z-index:11000;';
            t.innerHTML = `<i class="fa-solid fa-circle-check"></i> Planilla generada y descargada`;
            document.body.appendChild(t);
            setTimeout(() => t.remove(), 3000);
        }
    };

    // Comprueba si hay plantilla disponible para esta ruta
    window.tienePlantillaDisponible = function(ruta) {
        if (!ruta) return false;
        return !!detectarPlantilla(ruta.nombre);
    };

    console.log('[planillas] generador cargado');
})();
