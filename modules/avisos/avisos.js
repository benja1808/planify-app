// ════════════════════════════════════════════════════════════════════
// Módulo Avisos SAP
// ════════════════════════════════════════════════════════════════════
// Renderiza la vista "Avisos SAP" en mainContent. Conecta directamente
// con la tabla `avisos_sap` de Supabase. Permite:
//   - Listado con filtros (búsqueda libre, prioridad, status, parada)
//   - Importar nuevos avisos desde Excel SAP (.xlsx)
//   - Ver detalle por aviso + link a la ficha técnica del equipo (si está vinculado)
//   - Vincular automáticamente con equipos por ubicacion_tecnica
//
// Expone:
//   window.renderAvisosSapView()
//   window.avisosSapImportarExcel()  — usado por el botón
// ════════════════════════════════════════════════════════════════════

(function () {
    'use strict';

    const TABLA = 'avisos_sap';
    const state = {
        avisos: [],
        loaded: false,
        loading: false,
        filtroBusqueda: '',
        filtroPrioridad: '',
        filtroStatus: '',
        filtroParada: false
    };

    function esc(v) {
        return String(v ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
    function fmtFecha(s) {
        if (!s) return '—';
        const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
        return m ? `${m[3]}-${m[2]}-${m[1]}` : String(s);
    }
    function abcCls(v) {
        return ['A', 'B', 'C'].includes(v) ? `avisos-pill avisos-pill--abc-${v}` : 'avisos-pill avisos-pill--st-default';
    }
    function prioCls(v) {
        return ['Alta', 'Media', 'Baja'].includes(v) ? `avisos-pill avisos-pill--prio-${v}` : 'avisos-pill avisos-pill--st-default';
    }
    function stCls(v) {
        const first = String(v || '').split(/\s+/)[0];
        return ['CRTD', 'OUTR', 'TOPV'].includes(first)
            ? `avisos-pill avisos-pill--st-${first}`
            : 'avisos-pill avisos-pill--st-default';
    }

    async function cargarAvisos(force = false) {
        if (state.loaded && !force) return state.avisos;
        if (state.loading) return state.avisos;
        if (!window.supabaseClient) {
            console.warn('[avisos] supabaseClient no disponible');
            return [];
        }
        state.loading = true;
        const all = [];
        let from = 0;
        const ps = 1000;
        while (true) {
            const { data, error } = await window.supabaseClient
                .from(TABLA)
                .select('*')
                .order('fecha_notif', { ascending: false })
                .range(from, from + ps - 1);
            if (error) {
                console.warn('[avisos] error cargando:', error.message);
                state.loading = false;
                return [];
            }
            if (!data || !data.length) break;
            all.push(...data);
            if (data.length < ps) break;
            from += ps;
        }
        state.avisos = all;
        state.loaded = true;
        state.loading = false;
        return all;
    }

    function aplicarFiltros(items) {
        const q = state.filtroBusqueda.toLowerCase().trim();
        return items.filter(a => {
            if (state.filtroPrioridad && a.prioridad !== state.filtroPrioridad) return false;
            if (state.filtroStatus) {
                const st = String(a.status_usuario || '').toUpperCase();
                if (!st.includes(state.filtroStatus)) return false;
            }
            if (state.filtroParada && !a.parada) return false;
            if (q) {
                const blob = `${a.nro_notificacion} ${a.orden} ${a.ubicacion_tecnica} ${a.descripcion_original} ${a.descripcion_mejorada || ''} ${a.autor} ${a.pto_trabajo}`.toLowerCase();
                if (!blob.includes(q)) return false;
            }
            return true;
        });
    }

    function buildToolbar() {
        return `
            <div class="avisos-toolbar">
                <input id="avisos-search" type="text" class="form-control"
                    placeholder="Buscar por notificación, orden, UT, descripción, autor…"
                    value="${esc(state.filtroBusqueda)}">
                <select id="avisos-prio" class="form-control">
                    <option value="">Prioridad: todas</option>
                    <option value="Alta"  ${state.filtroPrioridad === 'Alta'  ? 'selected' : ''}>Alta</option>
                    <option value="Media" ${state.filtroPrioridad === 'Media' ? 'selected' : ''}>Media</option>
                    <option value="Baja"  ${state.filtroPrioridad === 'Baja'  ? 'selected' : ''}>Baja</option>
                </select>
                <select id="avisos-status" class="form-control">
                    <option value="">Status: todos</option>
                    <option value="CRTD" ${state.filtroStatus === 'CRTD' ? 'selected' : ''}>CRTD (creado)</option>
                    <option value="OUTR" ${state.filtroStatus === 'OUTR' ? 'selected' : ''}>OUTR</option>
                    <option value="TOPV" ${state.filtroStatus === 'TOPV' ? 'selected' : ''}>TOPV</option>
                </select>
                <label style="display:inline-flex; align-items:center; gap:0.35rem; padding:0.4rem 0.65rem; border:1px solid #e5e7eb; border-radius:8px; background:#fff; cursor:pointer; font-size:0.85rem;">
                    <input id="avisos-parada" type="checkbox" ${state.filtroParada ? 'checked' : ''}>
                    Solo paradas
                </label>
                <button id="avisos-crear" class="btn btn-success">
                    <i class="fa-solid fa-plus"></i> Crear aviso
                </button>
                <button id="avisos-importar" class="btn btn-primary">
                    <i class="fa-solid fa-cloud-arrow-up"></i> Importar Excel SAP
                </button>
                <button id="avisos-vincular" class="btn btn-outline" title="Vincular avisos con equipos del maestro por UT">
                    <i class="fa-solid fa-link"></i> Vincular equipos
                </button>
                <input id="avisos-file" type="file" accept=".xlsx, .xls" style="display:none;">
            </div>
        `;
    }

    // Índice de equipos por UT, regenerado al renderizar la tabla
    let _equiposIdxUT = null;
    function obtenerEquipoPorUT(ut) {
        if (!_equiposIdxUT) {
            const map = new Map();
            const arr = (typeof estado !== 'undefined' && estado.equipos) ? estado.equipos : [];
            arr.forEach(e => {
                const k = String(e.ubicacion_tecnica || '').trim().toUpperCase();
                if (k && !map.has(k)) map.set(k, e);
            });
            _equiposIdxUT = map;
        }
        return _equiposIdxUT.get(String(ut || '').trim().toUpperCase()) || null;
    }
    function nombreEquipoFromUT(ut) {
        const eq = obtenerEquipoPorUT(ut);
        if (!eq) return null;
        return eq.activo + (eq.componente ? ` · ${eq.componente}` : '');
    }

    function renderFila(a) {
        const parado = a.parada ? `<span class="avisos-pill avisos-pill--parada"><i class="fa-solid fa-triangle-exclamation"></i> PARADA</span>` : '';
        const eqLink = a.equipo_id
            ? `<a class="avisos-cell-link" href="#" onclick="event.stopPropagation(); window.abrirFichaTecnica && window.abrirFichaTecnica('${a.equipo_id}'); return false;">Ver ficha</a>`
            : '<span style="color:#94a3b8;">—</span>';
        const nombreEq = nombreEquipoFromUT(a.ubicacion_tecnica);
        const utCell = `
            <span class="avisos-cell-mono">${esc(a.ubicacion_tecnica || '')}</span>
            ${nombreEq ? `<div style="margin-top:0.2rem; font-size:0.78rem; color:#475569; font-weight:600;">${esc(nombreEq)}</div>` : ''}
        `;
        return `
            <tr data-aviso-id="${esc(a.id)}">
                <td><span class="avisos-cell-mono">${esc(a.nro_notificacion)}</span></td>
                <td>${fmtFecha(a.fecha_notif)}</td>
                <td><span class="${abcCls(a.indicador_abc)}">${esc(a.indicador_abc || '—')}</span></td>
                <td><span class="${prioCls(a.prioridad)}">${esc(a.prioridad || '—')}</span></td>
                <td>${esc(a.clase_aviso || '')} ${parado}</td>
                <td>${esc(a.pto_trabajo || '')}</td>
                <td style="min-width:240px;">${utCell}</td>
                <td style="max-width:280px;">${esc(a.descripcion_original || '')}</td>
                <td>${a.orden ? `<span class="avisos-cell-mono">${esc(a.orden)}</span>` : '<span style="color:#94a3b8;">—</span>'}</td>
                <td><span class="${stCls(a.status_usuario)}">${esc(a.status_usuario || '—')}</span></td>
                <td>${eqLink}</td>
            </tr>`;
    }

    async function render() {
        const host = document.getElementById('main-content') || (typeof mainContent !== 'undefined' ? mainContent : null);
        if (!host) return;
        _equiposIdxUT = null; // refrescar el índice equipos→UT por si cargaron nuevos

        const totalCargados = state.avisos.length;
        host.innerHTML = `
            <div class="fade-in avisos-view">
                <section class="avisos-hero">
                    <div class="avisos-hero-top">
                        <div>
                            <div class="avisos-eyebrow">SAP — Mantenimiento</div>
                            <h1><i class="fa-solid fa-clipboard-list" style="color:#0369a1;"></i> Avisos SAP</h1>
                            <p>Registro y seguimiento de avisos generados en SAP. Vincula automáticamente cada aviso con el equipo del maestro por ubicación técnica.</p>
                        </div>
                        <div class="avisos-hero-actions">
                            <span class="avisos-chip"><i class="fa-solid fa-bell"></i> ${totalCargados} aviso(s)</span>
                            <span class="avisos-chip" id="avisos-vinculados-chip" style="display:none;"><i class="fa-solid fa-link"></i> <span></span> vinculados</span>
                        </div>
                    </div>
                </section>

                ${buildToolbar()}

                <div id="avisos-table-host" class="avisos-table-wrap">
                    <p class="avisos-empty"><i class="fa-solid fa-spinner fa-spin"></i> Cargando avisos…</p>
                </div>
            </div>

            <div id="aviso-detail-modal" class="aviso-detail-overlay"></div>
            <div id="aviso-create-modal" class="aviso-detail-overlay"></div>
            <datalist id="avisos-datalist-equipos"></datalist>
        `;

        // Cargar y renderizar tabla
        const data = await cargarAvisos();
        renderTablaInPlace();

        // Actualizar contador de vinculados
        const vinc = data.filter(a => a.equipo_id).length;
        const chip = document.getElementById('avisos-vinculados-chip');
        if (chip && vinc) {
            chip.style.display = '';
            chip.querySelector('span').textContent = vinc;
        }

        // Listeners
        document.getElementById('avisos-search')?.addEventListener('input', (e) => {
            state.filtroBusqueda = e.target.value;
            renderTablaInPlace();
        });
        document.getElementById('avisos-prio')?.addEventListener('change', (e) => {
            state.filtroPrioridad = e.target.value;
            renderTablaInPlace();
        });
        document.getElementById('avisos-status')?.addEventListener('change', (e) => {
            state.filtroStatus = e.target.value;
            renderTablaInPlace();
        });
        document.getElementById('avisos-parada')?.addEventListener('change', (e) => {
            state.filtroParada = e.target.checked;
            renderTablaInPlace();
        });
        document.getElementById('avisos-importar')?.addEventListener('click', () => {
            document.getElementById('avisos-file')?.click();
        });
        document.getElementById('avisos-file')?.addEventListener('change', importarExcel);
        document.getElementById('avisos-vincular')?.addEventListener('click', vincularConEquipos);
        document.getElementById('avisos-crear')?.addEventListener('click', abrirCrearAviso);
        // Poblamos el datalist con todos los UTs del maestro (autocompletado)
        const dl = document.getElementById('avisos-datalist-equipos');
        if (dl) {
            const arr = (typeof estado !== 'undefined' && estado.equipos) ? estado.equipos : [];
            const utsUnicos = new Map();
            for (const e of arr) {
                const ut = String(e.ubicacion_tecnica || '').trim();
                if (!ut || utsUnicos.has(ut)) continue;
                utsUnicos.set(ut, e);
            }
            dl.innerHTML = [...utsUnicos.entries()].slice(0, 1500)
                .map(([ut, e]) => `<option value="${esc(ut)}">${esc(e.activo || '')}${e.componente ? ' · ' + esc(e.componente) : ''}</option>`)
                .join('');
        }
    }

    function renderTablaInPlace() {
        const host = document.getElementById('avisos-table-host');
        if (!host) return;
        const filtrados = aplicarFiltros(state.avisos);
        if (!filtrados.length) {
            host.innerHTML = `
                <p class="avisos-empty">
                    ${state.avisos.length === 0
                        ? '<i class="fa-solid fa-inbox"></i> Sin avisos cargados todavía. Importa tu Excel SAP para empezar.'
                        : '<i class="fa-solid fa-filter-circle-xmark"></i> Sin avisos para los filtros actuales.'}
                </p>`;
            return;
        }
        host.innerHTML = `
            <table class="avisos-table">
                <thead>
                    <tr>
                        <th>Notif.</th>
                        <th>Fecha</th>
                        <th>ABC</th>
                        <th>Prioridad</th>
                        <th>Clase</th>
                        <th>Pto. Tbjo.</th>
                        <th>Ubic. Técnica</th>
                        <th>Descripción</th>
                        <th>Orden</th>
                        <th>Status</th>
                        <th>Equipo</th>
                    </tr>
                </thead>
                <tbody>
                    ${filtrados.map(renderFila).join('')}
                </tbody>
            </table>
        `;
        host.querySelectorAll('tr[data-aviso-id]').forEach(tr => {
            tr.addEventListener('click', () => {
                const aviso = state.avisos.find(a => a.id === tr.dataset.avisoId);
                if (aviso) abrirDetalle(aviso);
            });
        });
    }

    function abrirDetalle(a) {
        const modal = document.getElementById('aviso-detail-modal');
        if (!modal) return;
        const eqBtn = a.equipo_id
            ? `<button class="btn btn-primary" onclick="document.getElementById('aviso-detail-modal').classList.remove('is-open'); window.abrirFichaTecnica && window.abrirFichaTecnica('${a.equipo_id}');"><i class="fa-solid fa-arrow-up-right-from-square"></i> Abrir ficha técnica</button>`
            : '';
        modal.innerHTML = `
            <div class="aviso-detail-card">
                <div class="aviso-detail-head">
                    <div>
                        <h2><i class="fa-solid fa-bell" style="color:#0369a1;"></i> Aviso ${esc(a.nro_notificacion)}</h2>
                        <p style="margin:0.25rem 0 0; color:#64748b; font-size:0.85rem;">${esc(a.pto_trabajo || '')} · ${fmtFecha(a.fecha_notif)}</p>
                    </div>
                    <button type="button" class="aviso-detail-close" data-close-aviso="1">&times;</button>
                </div>
                <div class="aviso-detail-grid">
                    <div class="aviso-detail-item"><label>ABC</label><span><span class="${abcCls(a.indicador_abc)}">${esc(a.indicador_abc || '—')}</span></span></div>
                    <div class="aviso-detail-item"><label>Prioridad</label><span><span class="${prioCls(a.prioridad)}">${esc(a.prioridad || '—')}</span></span></div>
                    <div class="aviso-detail-item"><label>Clase aviso</label><span>${esc(a.clase_aviso || '—')}</span></div>
                    <div class="aviso-detail-item"><label>Parada</label><span>${a.parada ? 'Sí — equipo parado' : 'No'}</span></div>
                    <div class="aviso-detail-item"><label>Orden</label><span class="avisos-cell-mono">${esc(a.orden || '—')}</span></div>
                    <div class="aviso-detail-item"><label>Status sistema</label><span>${esc(a.status_sistema || '—')}</span></div>
                    <div class="aviso-detail-item"><label>Status usuario</label><span><span class="${stCls(a.status_usuario)}">${esc(a.status_usuario || '—')}</span></span></div>
                    <div class="aviso-detail-item"><label>Autor</label><span>${esc(a.autor || '—')}</span></div>
                    <div class="aviso-detail-item"><label>Autor del aviso</label><span>${esc(a.autor_aviso || '—')}</span></div>
                    <div class="aviso-detail-item"><label>Fe. creación</label><span>${fmtFecha(a.fecha_creacion)}</span></div>
                    <div class="aviso-detail-item" style="grid-column:1/-1;"><label>Ubicación técnica</label><span class="avisos-cell-mono">${esc(a.ubicacion_tecnica || '—')}</span></div>
                </div>
                <div class="aviso-detail-desc">
                    <label>Descripción original (Excel SAP)</label>
                    <p>${esc(a.descripcion_original || 'Sin descripción.')}</p>
                </div>
                ${a.descripcion_mejorada ? `
                <div class="aviso-detail-desc" style="background:#ecfdf5; border-color:#bbf7d0;">
                    <label style="color:#047857;"><i class="fa-solid fa-wand-magic-sparkles"></i> Descripción mejorada</label>
                    <p>${esc(a.descripcion_mejorada)}</p>
                </div>` : ''}
                <div class="aviso-detail-actions">
                    ${eqBtn}
                    <button class="btn btn-outline" data-mejorar-aviso="${esc(a.id)}" title="Próximamente: mejorar descripción con IA">
                        <i class="fa-solid fa-wand-magic-sparkles"></i> Mejorar con IA
                    </button>
                    <button class="btn" data-close-aviso="1" style="background:transparent; color:#64748b; border:1px solid #e5e7eb;">Cerrar</button>
                </div>
            </div>
        `;
        modal.classList.add('is-open');
        modal.querySelectorAll('[data-close-aviso]').forEach(b => b.addEventListener('click', () => modal.classList.remove('is-open')));
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('is-open'); }, { once: true });
        modal.querySelector('[data-mejorar-aviso]')?.addEventListener('click', () => {
            alert('La mejora de descripción con IA aún no está disponible. Pasa la especificación de prompts y se activa.');
        });
    }

    function abrirCrearAviso() {
        const modal = document.getElementById('aviso-create-modal');
        if (!modal) return;
        const hoy = new Date().toISOString().slice(0, 10);
        const usuario = (typeof estado !== 'undefined' && estado.trabajadorLogueado?.nombre)
            ? estado.trabajadorLogueado.nombre
            : (typeof window.esRolGestion === 'function' && window.esRolGestion()
                ? (typeof estado !== 'undefined' && estado.usuarioActual === 'administrador' ? 'Administrador' : 'Planificador')
                : '');
        modal.innerHTML = `
            <div class="aviso-detail-card" style="max-width:760px;">
                <div class="aviso-detail-head">
                    <div>
                        <h2><i class="fa-solid fa-plus" style="color:#16a34a;"></i> Crear nuevo aviso SAP</h2>
                        <p style="margin:0.25rem 0 0; color:#64748b; font-size:0.85rem;">
                            Si el aviso ya tiene un número de notificación asignado en SAP, ingrésalo. Si aún no lo tienes, deja el campo vacío y se generará un código temporal "MAN-…".
                        </p>
                    </div>
                    <button type="button" class="aviso-detail-close" data-close-create="1">&times;</button>
                </div>

                <form id="form-aviso-create" style="display:grid; grid-template-columns:repeat(2, 1fr); gap:0.85rem;">
                    <div style="grid-column:1/-1;">
                        <label style="font-size:0.8rem; font-weight:700; color:#475569; display:block; margin-bottom:0.3rem;">
                            <i class="fa-solid fa-diagram-project" style="color:#0ea5e9;"></i> Ubicación técnica (KKS) — escribe para buscar
                        </label>
                        <input id="aviso-c-ut" type="text" class="form-control" list="avisos-datalist-equipos"
                            placeholder="Ej: 2893-12-LAC01-AP101-MG01" autocomplete="off">
                        <small id="aviso-c-eq-info" style="display:block; margin-top:0.25rem; font-size:0.78rem; color:#16a34a;"></small>
                    </div>

                    <div>
                        <label style="font-size:0.8rem; font-weight:700; color:#475569; display:block; margin-bottom:0.3rem;">Descripción <span style="color:#dc2626;">*</span></label>
                        <textarea id="aviso-c-desc" rows="3" class="form-control" placeholder="Ej: Aumento de vibraciones en motor bba yeso 5B"></textarea>
                    </div>

                    <div>
                        <label style="font-size:0.8rem; font-weight:700; color:#475569; display:block; margin-bottom:0.3rem;">Nro. notificación</label>
                        <input id="aviso-c-nro" type="text" class="form-control" placeholder="Auto: MAN-{timestamp}">

                        <label style="font-size:0.8rem; font-weight:700; color:#475569; display:block; margin:0.65rem 0 0.3rem;">Orden (si existe)</label>
                        <input id="aviso-c-orden" type="text" class="form-control" placeholder="Opcional">
                    </div>

                    <div>
                        <label style="font-size:0.8rem; font-weight:700; color:#475569; display:block; margin-bottom:0.3rem;">Fecha notificación <span style="color:#dc2626;">*</span></label>
                        <input id="aviso-c-fecha" type="date" class="form-control" value="${hoy}">
                    </div>
                    <div>
                        <label style="font-size:0.8rem; font-weight:700; color:#475569; display:block; margin-bottom:0.3rem;">Indicador ABC</label>
                        <select id="aviso-c-abc" class="form-control">
                            <option value="">—</option>
                            <option value="A">A — Crítico</option>
                            <option value="B">B — Importante</option>
                            <option value="C" selected>C — Normal</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-size:0.8rem; font-weight:700; color:#475569; display:block; margin-bottom:0.3rem;">Prioridad</label>
                        <select id="aviso-c-prio" class="form-control">
                            <option value="Alta">Alta</option>
                            <option value="Media" selected>Media</option>
                            <option value="Baja">Baja</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-size:0.8rem; font-weight:700; color:#475569; display:block; margin-bottom:0.3rem;">Clase aviso</label>
                        <select id="aviso-c-clase" class="form-control">
                            <option value="M1">M1 — Avería</option>
                            <option value="M2" selected>M2 — Solicitud</option>
                            <option value="M3">M3 — Inspección</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-size:0.8rem; font-weight:700; color:#475569; display:block; margin-bottom:0.3rem;">Pto. trabajo</label>
                        <select id="aviso-c-pto" class="form-control">
                            <option value="GUAMEC" selected>GUAMEC</option>
                            <option value="GUAELE">GUAELE</option>
                            <option value="GUAINS">GUAINS</option>
                            <option value="GUALUB">GUALUB</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-size:0.8rem; font-weight:700; color:#475569; display:block; margin-bottom:0.3rem;">Status sistema</label>
                        <input id="aviso-c-status-sis" type="text" class="form-control" value="METR ORAS" placeholder="Ej: METR ORAS">
                    </div>
                    <div>
                        <label style="font-size:0.8rem; font-weight:700; color:#475569; display:block; margin-bottom:0.3rem;">Status usuario</label>
                        <select id="aviso-c-status-usr" class="form-control">
                            <option value="CRTD" selected>CRTD — Creado</option>
                            <option value="OUTR">OUTR</option>
                            <option value="TOPV">TOPV</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-size:0.8rem; font-weight:700; color:#475569; display:block; margin-bottom:0.3rem;">Autor</label>
                        <input id="aviso-c-autor" type="text" class="form-control" value="${esc(usuario)}" placeholder="Quien crea el aviso">
                    </div>

                    <div style="grid-column:1/-1; display:flex; align-items:center; gap:0.6rem; background:#fef2f2; border:1px solid #fecaca; border-radius:8px; padding:0.55rem 0.85rem;">
                        <input id="aviso-c-parada" type="checkbox" style="width:16px; height:16px; accent-color:#dc2626;">
                        <label for="aviso-c-parada" style="margin:0; font-size:0.88rem; color:#7f1d1d; font-weight:700; cursor:pointer;">
                            <i class="fa-solid fa-triangle-exclamation"></i> Equipo parado por este aviso
                        </label>
                    </div>

                    <p id="aviso-c-error" style="grid-column:1/-1; display:none; color:#dc2626; font-size:0.85rem; margin:0;"></p>
                </form>

                <div class="aviso-detail-actions" style="margin-top:1rem;">
                    <button id="aviso-c-guardar" class="btn btn-primary" style="background:#16a34a;">
                        <i class="fa-solid fa-floppy-disk"></i> Crear aviso
                    </button>
                    <button class="btn" data-close-create="1" style="background:transparent; color:#64748b; border:1px solid #e5e7eb;">Cancelar</button>
                </div>
            </div>
        `;
        modal.classList.add('is-open');
        modal.querySelectorAll('[data-close-create]').forEach(b => b.addEventListener('click', () => modal.classList.remove('is-open')));

        // Live: cuando cambia el UT, resolver el equipo
        const utInput = document.getElementById('aviso-c-ut');
        const eqInfo = document.getElementById('aviso-c-eq-info');
        utInput?.addEventListener('input', () => {
            const eq = obtenerEquipoPorUT(utInput.value);
            if (eq) {
                eqInfo.innerHTML = `<i class="fa-solid fa-link"></i> Vinculado a: <strong>${esc(eq.activo)}${eq.componente ? ' · ' + esc(eq.componente) : ''}</strong>`;
                eqInfo.style.color = '#16a34a';
            } else if (utInput.value.trim()) {
                eqInfo.innerHTML = '<i class="fa-solid fa-circle-question"></i> No encontrado en el maestro de equipos (puedes crear el aviso igual)';
                eqInfo.style.color = '#b45309';
            } else {
                eqInfo.textContent = '';
            }
        });

        document.getElementById('aviso-c-guardar')?.addEventListener('click', guardarAvisoCreado);
    }

    async function guardarAvisoCreado() {
        const errEl = document.getElementById('aviso-c-error');
        errEl.style.display = 'none';
        const mostrarErr = (msg) => { errEl.textContent = msg; errEl.style.display = ''; };

        const desc = (document.getElementById('aviso-c-desc')?.value || '').trim();
        const fecha = document.getElementById('aviso-c-fecha')?.value;
        if (!desc) return mostrarErr('La descripción es obligatoria.');
        if (!fecha) return mostrarErr('La fecha de notificación es obligatoria.');

        let nro = (document.getElementById('aviso-c-nro')?.value || '').trim();
        if (!nro) nro = `MAN-${Date.now()}`;

        const ut = (document.getElementById('aviso-c-ut')?.value || '').trim();
        const equipoVinculado = ut ? obtenerEquipoPorUT(ut) : null;

        const payload = {
            fecha_notif: fecha,
            indicador_abc: document.getElementById('aviso-c-abc')?.value || null,
            prioridad: document.getElementById('aviso-c-prio')?.value || null,
            clase_aviso: document.getElementById('aviso-c-clase')?.value || null,
            pto_trabajo: document.getElementById('aviso-c-pto')?.value || null,
            parada: !!document.getElementById('aviso-c-parada')?.checked,
            nro_notificacion: nro,
            orden: (document.getElementById('aviso-c-orden')?.value || '').trim() || null,
            ubicacion_tecnica: ut || null,
            descripcion_original: desc,
            autor: (document.getElementById('aviso-c-autor')?.value || '').trim() || null,
            fecha_creacion: fecha,
            status_sistema: (document.getElementById('aviso-c-status-sis')?.value || '').trim() || null,
            autor_aviso: (document.getElementById('aviso-c-autor')?.value || '').trim() || null,
            status_usuario: document.getElementById('aviso-c-status-usr')?.value || null,
            equipo_id: equipoVinculado?.id || null
        };

        const btn = document.getElementById('aviso-c-guardar');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Guardando…'; }
        try {
            const { data, error } = await window.supabaseClient
                .from(TABLA).insert([payload]).select('*').single();
            if (error) {
                if (error.code === '23505' || /duplicate/i.test(error.message)) {
                    return mostrarErr(`Ya existe un aviso con el número "${nro}". Usa otro o deja el campo vacío.`);
                }
                throw error;
            }
            // Insertar en el state local + cerrar + re-render
            state.avisos.unshift(data);
            document.getElementById('aviso-create-modal').classList.remove('is-open');
            renderTablaInPlace();
            alert(`Aviso ${data.nro_notificacion} creado correctamente.`);
        } catch (e) {
            console.error('[avisos] crear:', e);
            mostrarErr('Error al crear el aviso: ' + e.message);
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Crear aviso'; }
        }
    }

    function parseFechaNotif(s) {
        const v = String(s || '').trim();
        if (/^\d{8}$/.test(v)) return `${v.slice(0,4)}-${v.slice(4,6)}-${v.slice(6,8)}`;
        if (typeof s === 'number') {
            const d = new Date((s - 25569) * 86400000);
            return !isNaN(d.getTime()) ? d.toISOString().slice(0,10) : null;
        }
        if (s instanceof Date && !isNaN(s.getTime())) return s.toISOString().slice(0,10);
        return null;
    }
    function parseFechaCreacion(s) {
        if (typeof s === 'number' && isFinite(s)) {
            const d = new Date((s - 25569) * 86400000);
            return !isNaN(d.getTime()) ? d.toISOString().slice(0,10) : null;
        }
        if (s instanceof Date && !isNaN(s.getTime())) return s.toISOString().slice(0,10);
        if (typeof s === 'string' && s.trim()) return parseFechaNotif(s);
        return null;
    }

    async function importarExcel(e) {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!window.XLSX || !window.supabaseClient) {
            alert('XLSX o Supabase no están disponibles.');
            return;
        }
        const reader = new FileReader();
        reader.onload = async (evt) => {
            try {
                const data = new Uint8Array(evt.target.result);
                const wb = window.XLSX.read(data, { type: 'array', cellDates: true });
                const ws = wb.Sheets[wb.SheetNames[0]];
                const rows = window.XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
                const lote = [];
                for (let i = 1; i < rows.length; i++) {
                    const r = rows[i];
                    const nro = String(r[6] || '').trim();
                    if (!nro) continue;
                    const fecha = parseFechaNotif(r[0]);
                    if (!fecha) continue;
                    lote.push({
                        fecha_notif: fecha,
                        indicador_abc: String(r[1] || '').trim() || null,
                        prioridad: String(r[2] || '').trim() || null,
                        clase_aviso: String(r[3] || '').trim() || null,
                        pto_trabajo: String(r[4] || '').trim() || null,
                        parada: !!String(r[5] || '').trim(),
                        nro_notificacion: nro,
                        orden: String(r[7] || '').trim() || null,
                        ubicacion_tecnica: String(r[8] || '').trim() || null,
                        descripcion_original: String(r[12] || '').trim() || null,
                        autor: String(r[13] || '').trim() || null,
                        fecha_creacion: parseFechaCreacion(r[14]),
                        status_sistema: String(r[15] || '').trim() || null,
                        autor_aviso: String(r[16] || '').trim() || null,
                        status_usuario: String(r[17] || '').trim() || null
                    });
                }
                if (!lote.length) { alert('No se encontraron filas válidas en el Excel.'); return; }

                const btn = document.getElementById('avisos-importar');
                if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Importando…'; }

                let insertados = 0, errores = 0;
                const CHUNK = 200;
                for (let i = 0; i < lote.length; i += CHUNK) {
                    const bloque = lote.slice(i, i + CHUNK);
                    const { data, error } = await window.supabaseClient.from(TABLA)
                        .upsert(bloque, { onConflict: 'nro_notificacion', ignoreDuplicates: true })
                        .select('id');
                    if (error) {
                        errores++;
                        console.warn('[avisos] upsert error:', error.message);
                    } else {
                        insertados += (data?.length || 0);
                    }
                }
                alert(`Importación: ${insertados} aviso(s) nuevos · ${lote.length - insertados} ya existían${errores ? ` · ${errores} error(es)` : ''}`);
                state.loaded = false;
                await render();
            } catch (err) {
                console.error('[avisos] importarExcel:', err);
                alert('Error al procesar el Excel: ' + err.message);
            } finally {
                e.target.value = '';
                const btn = document.getElementById('avisos-importar');
                if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Importar Excel SAP'; }
            }
        };
        reader.readAsArrayBuffer(file);
    }

    async function vincularConEquipos() {
        if (!window.supabaseClient) return;
        const btn = document.getElementById('avisos-vincular');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Vinculando…'; }
        try {
            // Cargar equipos del state global (ya en memoria) o desde DB
            const equiposLocal = (typeof estado !== 'undefined' && estado.equipos) ? estado.equipos : [];
            const idxEq = new Map();
            equiposLocal.forEach(e => {
                const ut = String(e.ubicacion_tecnica || '').trim().toUpperCase();
                if (ut && !idxEq.has(ut)) idxEq.set(ut, e.id);
            });
            // Encontrar avisos sin equipo_id que tienen match
            const candidatos = state.avisos.filter(a => !a.equipo_id && a.ubicacion_tecnica && idxEq.has(String(a.ubicacion_tecnica).trim().toUpperCase()));
            let ok = 0;
            for (const a of candidatos) {
                const eqId = idxEq.get(String(a.ubicacion_tecnica).trim().toUpperCase());
                const { error } = await window.supabaseClient.from(TABLA).update({ equipo_id: eqId }).eq('id', a.id);
                if (!error) { a.equipo_id = eqId; ok++; }
            }
            alert(`Vinculados ${ok} aviso(s) con equipos del maestro.`);
            await render();
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-link"></i> Vincular equipos'; }
        }
    }

    // API pública
    window.renderAvisosSapView = render;
    window.avisosSapEstado = state; // útil para depuración

    console.log('[avisos] módulo cargado');
})();
