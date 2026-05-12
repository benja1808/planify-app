(() => {
    const TABLE_PERIODOS = 'seguimiento_vib_periodos';
    const TABLE_EQUIPOS = 'seguimiento_vib_equipos';
    const CACHE_PERIODOS = 'planify_seguimiento_vib_periodos';
    const CACHE_EQUIPOS_PREFIX = 'planify_seguimiento_vib_equipos_';
    const CACHE_MAESTRO = 'planify_seguimiento_vib_maestro_equipos';

    const RUTAS_BASE = [
        'R.BBA.TG',
        'R.BBAS.380.V',
        'R.PTA.DE.AGUA',
        'R.VENT.380.V',
        'RUTA.FGD.U3',
        'RUTA.FGD.U5',
        'RUTA.MOLINOS',
        'RUTA.RETROFIT',
        'RUTA.S.ESCORIA'
    ];

    const ESTADOS = {
        PENDIENTE: { label: 'Pendiente', className: 'seg-badge--pendiente' },
        MEDIDO: { label: 'Medido', className: 'seg-badge--medido' },
        FUERA_SERVICIO: { label: 'Fuera de servicio', className: 'seg-badge--fuera' },
        MANTENIMIENTO: { label: 'Mantenimiento', className: 'seg-badge--mantenimiento' },
        INDISPONIBLE: { label: 'Indisponible', className: 'seg-badge--indisponible' }
    };

    const CRITICIDAD_COLOR = { A: '#EF4444', B: '#F59E0B', C: '#6B7280' };
    const UNIDAD_COLOR = {
        'UNIDAD 1': '#3B82F6',
        'UNIDAD 2': '#10B981',
        'UNIDAD 3': '#F59E0B',
        'UNIDAD 4': '#EF4444',
        'UNIDAD 5': '#8B5CF6',
        RETROFIT: '#6B7280',
        SC: '#6B7280',
        'PTA.AGUA': '#06B6D4'
    };

    const state = {
        onBack: null,
        periodos: [],
        equipos: [],
        equiposMaestro: [],
        periodoId: '',
        loading: false,
        error: '',
        selected: new Set(),
        filtros: {
            ruta: '',
            ubicacion: '',
            estado: '',
            criticidad: '',
            busqueda: '',
            fechaDesde: '',
            fechaHasta: ''
        }
    };

    function rootEl() {
        return document.getElementById('main-content');
    }

    function h(value) {
        return String(value ?? '').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[char]));
    }

    function toast(title, body, type = 'success') {
        try {
            if (typeof mostrarToastNotificacion === 'function') {
                mostrarToastNotificacion(title, body, { type, duration: 3200 });
                return;
            }
        } catch (error) {
            console.warn('[Seguimiento VIB] Toast fallback:', error);
        }
        if (type === 'danger') alert(`${title}\n${body}`);
    }

    function getRol() {
        try {
            if (typeof estado !== 'undefined' && estado?.usuarioActual) return estado.usuarioActual;
        } catch (error) {
            return 'visita';
        }
        return 'visita';
    }

    function puedeEditar() {
        return ['admin', 'supervisor'].includes(String(getRol()).toLowerCase());
    }

    function getSupabase() {
        return window.supabaseClient || null;
    }

    function online() {
        return navigator.onLine && !!getSupabase();
    }

    function readCache(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch (error) {
            return fallback;
        }
    }

    function writeCache(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (error) {
            console.warn('[Seguimiento VIB] No se pudo guardar cache local:', error);
        }
    }

    function periodoActivo() {
        return state.periodos.find((p) => p.id === state.periodoId) || null;
    }

    function equipoEstado(equipo) {
        const estadoActual = String(equipo.estado_actual || 'PENDIENTE').toUpperCase();
        return ESTADOS[estadoActual] ? estadoActual : 'PENDIENTE';
    }

    function unique(values) {
        return [...new Set(values.map((v) => String(v || '').trim()).filter(Boolean))]
            .sort((a, b) => a.localeCompare(b, 'es'));
    }

    function formatDate(value) {
        if (!value) return '';
        const text = String(value).slice(0, 10);
        const parts = text.split('-');
        if (parts.length !== 3) return text;
        return `${parts[2]}-${parts[1]}-${parts[0]}`;
    }

    function pct(part, total) {
        return total ? Math.round((part / total) * 100) : 0;
    }

    function todayIso() {
        return new Date().toISOString().slice(0, 10);
    }

    function fechaSeguimiento(item) {
        return String(item.medicion_fecha || item.actualizado_at || item.historial_at || item.fecha_ultimo_intento || item.created_at || '').slice(0, 10);
    }

    function hayFiltroFecha() {
        return Boolean(state.filtros.fechaDesde || state.filtros.fechaHasta);
    }

    function dentroRangoFecha(item) {
        const fecha = fechaSeguimiento(item);
        if (!fecha) return false;
        if (state.filtros.fechaDesde && fecha < state.filtros.fechaDesde) return false;
        if (state.filtros.fechaHasta && fecha > state.filtros.fechaHasta) return false;
        return true;
    }

    function labelRangoFecha() {
        if (!hayFiltroFecha()) return 'Periodo completo';
        const desde = state.filtros.fechaDesde ? formatDate(state.filtros.fechaDesde) : 'inicio';
        const hasta = state.filtros.fechaHasta ? formatDate(state.filtros.fechaHasta) : 'hoy';
        return desde === hasta ? desde : `${desde} a ${hasta}`;
    }

    function normalizarUT(value) {
        return String(value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toUpperCase()
            .replace(/\s+/g, '')
            .replace(/--+/g, '-')
            .trim();
    }

    function construirIndiceMaestro() {
        const exacto = new Map();
        (state.equiposMaestro || []).forEach((equipo) => {
            [equipo.ubicacion_tecnica, equipo.kks].forEach((raw) => {
                const ut = normalizarUT(raw);
                if (ut && !exacto.has(ut)) exacto.set(ut, equipo);
            });
        });
        return exacto;
    }

    function equipoMaestroParaSeguimiento(item) {
        const index = construirIndiceMaestro();
        return index.get(normalizarUT(item.ubicacion_tecnica)) || null;
    }

    function getMedicionDetalle(item) {
        const detalle = item?.medicion_detalle;
        return detalle && typeof detalle === 'object' && !Array.isArray(detalle) ? detalle : {};
    }

    function getLecturasDesdeModal(modal) {
        const fecha = modal.querySelector('#seg-med-fecha')?.value || todayIso();
        const observacion = modal.querySelector('#seg-med-observacion')?.value.trim()
            || modal.querySelector('#seg-edit-observacion')?.value.trim()
            || null;
        const vibraciones = [1, 2].map((n) => ({
            valor: modal.querySelector(`#seg-vib-${n}`)?.value.trim() || '',
            punto: modal.querySelector(`#seg-vib-punto-${n}`)?.value.trim() || ''
        })).filter((item) => item.valor || item.punto);
        const temperaturas = [1, 2].map((n) => ({
            valor: modal.querySelector(`#seg-temp-${n}`)?.value.trim() || '',
            punto: modal.querySelector(`#seg-temp-punto-${n}`)?.value.trim() || ''
        })).filter((item) => item.valor || item.punto);
        return { fecha, observacion, vibraciones, temperaturas };
    }

    function validarLecturas(lecturas) {
        const validarGrupo = (items, label) => {
            for (const item of items) {
                const valor = Number(String(item.valor).replace(',', '.'));
                if (!Number.isFinite(valor) || valor < 0) return `${label}: ingresa un valor valido.`;
                if (!item.punto) return `${label}: ingresa el punto de medicion.`;
            }
            return '';
        };
        return validarGrupo(lecturas.vibraciones, 'Vibracion') || validarGrupo(lecturas.temperaturas, 'Temperatura');
    }

    function getEquiposFiltrados() {
        const q = state.filtros.busqueda.trim().toLowerCase();
        return state.equipos.filter((item) => {
            if (state.filtros.ruta && item.ruta !== state.filtros.ruta) return false;
            if (state.filtros.ubicacion && item.ubicacion !== state.filtros.ubicacion) return false;
            if (state.filtros.estado && equipoEstado(item) !== state.filtros.estado) return false;
            if (state.filtros.criticidad && String(item.criticidad || '').toUpperCase() !== state.filtros.criticidad) return false;
            if (q) {
                const target = `${item.activo || ''} ${item.componente || ''} ${item.ubicacion_tecnica || ''}`.toLowerCase();
                if (!target.includes(q)) return false;
            }
            return true;
        });
    }

    function estadoBadge(value) {
        const key = ESTADOS[value] ? value : 'PENDIENTE';
        const meta = ESTADOS[key];
        return `<span class="seg-badge ${meta.className}">${meta.label}</span>`;
    }

    function criticidadBadge(value) {
        const key = String(value || '').toUpperCase();
        const color = CRITICIDAD_COLOR[key] || '#94a3b8';
        return key
            ? `<span class="seg-crit" style="--crit-color:${color};">${h(key)}</span>`
            : '<span class="seg-muted">-</span>';
    }

    function unidadBadge(value) {
        const raw = String(value || '').trim();
        if (!raw) return '<span class="seg-muted">-</span>';
        const key = raw.toUpperCase();
        const color = UNIDAD_COLOR[key] || (key.includes('PTA') ? UNIDAD_COLOR['PTA.AGUA'] : '#64748b');
        return `<span class="seg-unidad" style="--unidad-color:${color};">${h(raw)}</span>`;
    }

    function renderKpis() {
        const total = state.equipos.length;
        const medidos = state.equipos.filter((item) => equipoEstado(item) === 'MEDIDO').length;
        const medidosRango = state.equipos.filter((item) => equipoEstado(item) === 'MEDIDO' && dentroRangoFecha(item)).length;
        const pendientes = state.equipos.filter((item) => equipoEstado(item) === 'PENDIENTE').length;
        const bloqueados = state.equipos.filter((item) => ['FUERA_SERVICIO', 'MANTENIMIENTO', 'INDISPONIBLE'].includes(equipoEstado(item))).length;
        const historiales = state.equipos.filter((item) => item.historial_id).length;
        const items = [
            { label: 'Total equipos', value: total, hint: 'no monitoreados', icon: 'fa-gears' },
            { label: '% Medidos', value: `${pct(medidos, total)}%`, hint: `${medidos} equipos`, icon: 'fa-circle-check' },
            { label: 'Avance rango', value: `${pct(medidosRango, total)}%`, hint: `${medidosRango} medidos en ${labelRangoFecha()}`, icon: 'fa-calendar-day' },
            { label: '% Pendientes', value: `${pct(pendientes, total)}%`, hint: `${pendientes} equipos`, icon: 'fa-clock' },
            { label: 'Fuera / Mant.', value: `${pct(bloqueados, total)}%`, hint: `${bloqueados} equipos`, icon: 'fa-triangle-exclamation' },
            { label: 'En historial', value: historiales, hint: 'registros creados', icon: 'fa-clock-rotate-left' }
        ];
        return `<section class="seg-kpis">${items.map((item) => `
            <article class="seg-kpi-card">
                <span class="seg-kpi-icon"><i class="fa-solid ${item.icon}"></i></span>
                <div>
                    <div class="seg-kpi-label">${h(item.label)}</div>
                    <div class="seg-kpi-value">${h(item.value)}</div>
                    <div class="seg-kpi-hint">${h(item.hint)}</div>
                </div>
            </article>
        `).join('')}</section>`;
    }

    function renderRutaBars() {
        const extras = unique(state.equipos.map((item) => item.ruta)).filter((ruta) => !RUTAS_BASE.includes(ruta));
        const rutas = [...RUTAS_BASE, ...extras].filter((ruta) => state.equipos.some((item) => item.ruta === ruta));
        if (!rutas.length) {
            return '<section class="seg-panel"><h2>Avance por ruta</h2><p class="seg-empty-inline">Sin datos para graficar.</p></section>';
        }

        return `<section class="seg-panel">
            <div class="seg-section-head">
                <div>
                    <h2>Avance por ruta</h2>
                    <p>${hayFiltroFecha() ? `Medidos en ${h(labelRangoFecha())} versus total de la ruta.` : 'Medidos versus pendientes del periodo activo.'}</p>
                </div>
            </div>
            <div class="seg-route-bars">
                ${rutas.map((ruta) => {
                    const items = state.equipos.filter((item) => item.ruta === ruta);
                    const total = items.length;
                    const medidos = items.filter((item) => equipoEstado(item) === 'MEDIDO' && (!hayFiltroFecha() || dentroRangoFecha(item))).length;
                    const pendientes = total - medidos;
                    const medidoPct = pct(medidos, total);
                    return `<div class="seg-route-row">
                        <div class="seg-route-label">${h(ruta)}</div>
                        <div class="seg-route-track" title="${medidos} medidos / ${pendientes} pendientes">
                            <span class="seg-route-fill seg-route-fill--medido" style="width:${medidoPct}%;"></span>
                            <span class="seg-route-fill seg-route-fill--pendiente" style="left:${medidoPct}%; width:${100 - medidoPct}%;"></span>
                        </div>
                        <div class="seg-route-count"><strong>${medidos}</strong>/<span>${total}</span></div>
                    </div>`;
                }).join('')}
            </div>
            <div class="seg-legend">
                <span><i class="seg-dot seg-dot--medido"></i> Medidos</span>
                <span><i class="seg-dot seg-dot--pendiente"></i> Pendientes / no medidos</span>
            </div>
        </section>`;
    }

    function renderFilters() {
        const rutas = unique(state.equipos.map((item) => item.ruta));
        const ubicaciones = unique(state.equipos.map((item) => item.ubicacion));
        const criticidades = unique(state.equipos.map((item) => String(item.criticidad || '').toUpperCase()));
        return `<section class="seg-panel seg-filters">
            <label>
                <span>Ruta</span>
                <select id="seg-filter-ruta">
                    <option value="">Todas</option>
                    ${rutas.map((ruta) => `<option value="${h(ruta)}" ${state.filtros.ruta === ruta ? 'selected' : ''}>${h(ruta)}</option>`).join('')}
                </select>
            </label>
            <label>
                <span>Ubicacion</span>
                <select id="seg-filter-ubicacion">
                    <option value="">Todas</option>
                    ${ubicaciones.map((ubicacion) => `<option value="${h(ubicacion)}" ${state.filtros.ubicacion === ubicacion ? 'selected' : ''}>${h(ubicacion)}</option>`).join('')}
                </select>
            </label>
            <label>
                <span>Estado</span>
                <select id="seg-filter-estado">
                    <option value="">Todos</option>
                    ${Object.entries(ESTADOS).map(([key, meta]) => `<option value="${key}" ${state.filtros.estado === key ? 'selected' : ''}>${h(meta.label)}</option>`).join('')}
                </select>
            </label>
            <label>
                <span>Criticidad</span>
                <select id="seg-filter-criticidad">
                    <option value="">Todas</option>
                    ${criticidades.map((criticidad) => `<option value="${h(criticidad)}" ${state.filtros.criticidad === criticidad ? 'selected' : ''}>${h(criticidad)}</option>`).join('')}
                </select>
            </label>
            <label class="seg-search">
                <span>Buscar activo</span>
                <input id="seg-filter-busqueda" type="search" value="${h(state.filtros.busqueda)}" placeholder="Nombre, componente o UT">
            </label>
        </section>`;
    }

    function renderTable() {
        const filtrados = getEquiposFiltrados();
        const canEdit = puedeEditar();
        const allSelected = filtrados.length > 0 && filtrados.every((item) => state.selected.has(item.id));
        const pendientesHistorial = state.equipos.filter((item) => equipoEstado(item) === 'MEDIDO' && !item.historial_id).length;

        return `<section class="seg-panel">
            <div class="seg-table-toolbar">
                <div>
                    <h2>Equipos</h2>
                    <p>${filtrados.length} de ${state.equipos.length} equipos visibles</p>
                </div>
                ${canEdit ? `<div class="seg-toolbar-actions">
                    <button id="seg-sync-historial" class="seg-btn seg-btn--secondary" type="button" ${pendientesHistorial ? '' : 'disabled'}>
                        <i class="fa-solid fa-clock-rotate-left"></i> Subir medidos a historial (${pendientesHistorial})
                    </button>
                    <button id="seg-bulk-edit" class="seg-btn seg-btn--secondary" type="button" ${state.selected.size ? '' : 'disabled'}>
                        <i class="fa-solid fa-pen-to-square"></i> Actualizar seleccionados (${state.selected.size})
                    </button>
                </div>` : ''}
            </div>
            <div class="seg-table-wrap">
                <table class="seg-table">
                    <thead>
                        <tr>
                            ${canEdit ? `<th class="seg-col-check"><input id="seg-select-all" type="checkbox" ${allSelected ? 'checked' : ''} aria-label="Seleccionar todos"></th>` : ''}
                            <th>Dias</th>
                            <th>Ruta</th>
                            <th>Ubicacion</th>
                            <th>Activo</th>
                            <th>Componente</th>
                            <th>Crit.</th>
                            <th>Razon</th>
                            <th>Estado</th>
                            <th>Acciones</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${filtrados.length ? filtrados.map((item) => {
                            const estadoActual = equipoEstado(item);
                            return `<tr>
                                ${canEdit ? `<td><input class="seg-row-check" type="checkbox" value="${h(item.id)}" ${state.selected.has(item.id) ? 'checked' : ''} aria-label="Seleccionar equipo"></td>` : ''}
                                <td>${item.dias_transcurridos ?? '-'}</td>
                                <td><strong>${h(item.ruta || '-')}</strong></td>
                                <td>${unidadBadge(item.ubicacion)}</td>
                                <td>
                                    <div class="seg-asset-name">${h(item.activo || '-')}</div>
                                    <div class="seg-asset-sub">${h(item.ubicacion_tecnica || '')}</div>
                                    ${item.plan ? `<div class="seg-asset-sub">Plan ${h(item.plan)}</div>` : ''}
                                </td>
                                <td>${h(item.componente || '-')}</td>
                                <td>${criticidadBadge(item.criticidad)}</td>
                                <td class="seg-reason">${h(item.razon || item.observacion_original || '-')}</td>
                                <td>${estadoBadge(estadoActual)}</td>
                                <td>
                                    ${canEdit
                                        ? `<div class="seg-row-actions">
                                            <button class="seg-icon-btn seg-edit-row" type="button" data-id="${h(item.id)}" title="Editar estado y mediciones"><i class="fa-solid fa-pen"></i></button>
                                            ${estadoActual === 'MEDIDO' && !item.historial_id ? `<button class="seg-icon-btn seg-history-row" type="button" data-id="${h(item.id)}" title="Subir a historial"><i class="fa-solid fa-clock-rotate-left"></i></button>` : ''}
                                            ${item.historial_id ? `<span class="seg-mini-ok" title="Ya esta en historial"><i class="fa-solid fa-check"></i></span>` : ''}
                                        </div>`
                                        : '<span class="seg-muted">Solo lectura</span>'}
                                </td>
                            </tr>`;
                        }).join('') : `<tr><td colspan="${canEdit ? 10 : 9}" class="seg-empty-cell">Sin equipos para los filtros seleccionados.</td></tr>`}
                    </tbody>
                </table>
            </div>
        </section>`;
    }

    function renderEmpty() {
        const canEdit = puedeEditar();
        return `<div class="seg-page fade-in">
            ${renderHeader()}
            <section class="seg-empty-state">
                <span><i class="fa-solid fa-file-excel"></i></span>
                <h2>Aun no hay periodos importados</h2>
                <p>Importa la planilla mensual para comenzar el seguimiento del backlog VIB.</p>
                ${canEdit ? `<button id="seg-import-empty" class="seg-btn seg-btn--primary" type="button"><i class="fa-solid fa-upload"></i> Importar Excel</button>` : ''}
            </section>
        </div>`;
    }

    function renderHeader() {
        const canEdit = puedeEditar();
        const activo = periodoActivo();
        return `<div class="seg-header">
            <button id="seg-back" class="seg-back" type="button"><i class="fa-solid fa-arrow-left"></i> Volver a Vibraciones</button>
            <section class="seg-hero">
                <div>
                    <div class="seg-eyebrow">Programa de vibracion</div>
                    <h1><i class="fa-solid fa-chart-line"></i> Seguimiento VIB</h1>
                    <p>Backlog de equipos no monitoreados, avance por ruta y gestion de estados desde Planify.</p>
                </div>
                <div class="seg-header-actions">
                    ${state.periodos.length ? `<label class="seg-period-select">
                        <span>Periodo</span>
                        <select id="seg-periodo-select">
                            ${state.periodos.map((p) => `<option value="${h(p.id)}" ${p.id === state.periodoId ? 'selected' : ''}>${h(p.nombre)}</option>`).join('')}
                        </select>
                    </label>` : ''}
                    <label class="seg-period-select">
                        <span>Desde</span>
                        <input id="seg-fecha-desde" type="date" value="${h(state.filtros.fechaDesde)}">
                    </label>
                    <label class="seg-period-select">
                        <span>Hasta</span>
                        <input id="seg-fecha-hasta" type="date" value="${h(state.filtros.fechaHasta)}">
                    </label>
                    <button id="seg-hoy" class="seg-btn seg-btn--secondary" type="button"><i class="fa-regular fa-calendar-check"></i> Hoy</button>
                    ${hayFiltroFecha() ? `<button id="seg-limpiar-fecha" class="seg-btn seg-btn--ghost" type="button"><i class="fa-solid fa-xmark"></i> Limpiar fechas</button>` : ''}
                    ${canEdit ? `<button id="seg-import" class="seg-btn seg-btn--primary" type="button"><i class="fa-solid fa-file-import"></i> Importar Excel</button>` : ''}
                </div>
            </section>
            ${activo ? `<div class="seg-period-meta">
                <span><i class="fa-regular fa-calendar"></i> Cargado: ${h(formatDate(activo.fecha_carga || activo.created_at))}</span>
                <span><i class="fa-solid fa-file-excel"></i> ${h(activo.archivo_origen || 'Sin archivo')}</span>
                <span><i class="fa-solid fa-list-check"></i> ${Number(activo.total_equipos || state.equipos.length)} equipos</span>
            </div>` : ''}
        </div>`;
    }

    function render() {
        const el = rootEl();
        if (!el) return;

        if (state.loading) {
            el.innerHTML = `<div class="seg-page fade-in">
                ${renderHeader()}
                <section class="seg-loading"><i class="fa-solid fa-circle-notch fa-spin"></i> Cargando seguimiento VIB...</section>
            </div>`;
            bindCommon();
            return;
        }

        if (state.error && !state.periodos.length) {
            el.innerHTML = `<div class="seg-page fade-in">
                ${renderHeader()}
                <section class="seg-empty-state seg-empty-state--error">
                    <span><i class="fa-solid fa-database"></i></span>
                    <h2>No se pudo cargar el seguimiento</h2>
                    <p>${h(state.error)}</p>
                    <p class="seg-note">Verifica que la migracion <strong>supabase/migrations/seguimiento_vib.sql</strong> este aplicada en Supabase.</p>
                </section>
            </div>`;
            bindCommon();
            return;
        }

        if (!state.periodos.length) {
            el.innerHTML = renderEmpty();
            bindCommon();
            return;
        }

        el.innerHTML = `<div class="seg-page fade-in">
            ${renderHeader()}
            ${state.error ? `<div class="seg-warning"><i class="fa-solid fa-triangle-exclamation"></i> ${h(state.error)}</div>` : ''}
            ${renderKpis()}
            ${renderRutaBars()}
            ${renderFilters()}
            ${renderTable()}
        </div>`;
        bindCommon();
        bindFilters();
        bindTable();
    }

    function bindCommon() {
        document.getElementById('seg-back')?.addEventListener('click', () => {
            if (typeof state.onBack === 'function') state.onBack();
            else if (typeof window.seguimientoVibVolverHub === 'function') window.seguimientoVibVolverHub();
        });
        document.getElementById('seg-periodo-select')?.addEventListener('change', async (event) => {
            state.periodoId = event.target.value;
            state.selected.clear();
            await cargarEquiposPeriodo();
        });
        document.getElementById('seg-fecha-desde')?.addEventListener('input', (event) => {
            state.filtros.fechaDesde = event.target.value;
            if (state.filtros.fechaHasta && state.filtros.fechaDesde > state.filtros.fechaHasta) {
                state.filtros.fechaHasta = state.filtros.fechaDesde;
            }
            render();
        });
        document.getElementById('seg-fecha-hasta')?.addEventListener('input', (event) => {
            state.filtros.fechaHasta = event.target.value;
            if (state.filtros.fechaDesde && state.filtros.fechaHasta < state.filtros.fechaDesde) {
                state.filtros.fechaDesde = state.filtros.fechaHasta;
            }
            render();
        });
        document.getElementById('seg-hoy')?.addEventListener('click', () => {
            const hoy = todayIso();
            state.filtros.fechaDesde = hoy;
            state.filtros.fechaHasta = hoy;
            render();
        });
        document.getElementById('seg-limpiar-fecha')?.addEventListener('click', () => {
            state.filtros.fechaDesde = '';
            state.filtros.fechaHasta = '';
            render();
        });
        document.getElementById('seg-import')?.addEventListener('click', abrirSelectorImportacion);
        document.getElementById('seg-import-empty')?.addEventListener('click', abrirSelectorImportacion);
    }

    function bindFilters() {
        const pairs = [
            ['seg-filter-ruta', 'ruta'],
            ['seg-filter-ubicacion', 'ubicacion'],
            ['seg-filter-estado', 'estado'],
            ['seg-filter-criticidad', 'criticidad'],
            ['seg-filter-busqueda', 'busqueda']
        ];
        pairs.forEach(([id, key]) => {
            const node = document.getElementById(id);
            if (!node) return;
            node.addEventListener('input', (event) => {
                state.filtros[key] = event.target.value;
                render();
                if (key === 'busqueda') {
                    setTimeout(() => {
                        const input = document.getElementById(id);
                        input?.focus();
                        input?.setSelectionRange(input.value.length, input.value.length);
                    }, 0);
                }
            });
        });
    }

    function bindTable() {
        document.getElementById('seg-select-all')?.addEventListener('change', (event) => {
            getEquiposFiltrados().forEach((item) => {
                if (event.target.checked) state.selected.add(item.id);
                else state.selected.delete(item.id);
            });
            render();
        });
        document.querySelectorAll('.seg-row-check').forEach((checkbox) => {
            checkbox.addEventListener('change', (event) => {
                if (event.target.checked) state.selected.add(event.target.value);
                else state.selected.delete(event.target.value);
                render();
            });
        });
        document.querySelectorAll('.seg-edit-row').forEach((btn) => {
            btn.addEventListener('click', () => abrirModalEdicion([btn.dataset.id]));
        });
        document.querySelectorAll('.seg-history-row').forEach((btn) => {
            btn.addEventListener('click', () => subirMedidosAHistorial([btn.dataset.id]));
        });
        document.getElementById('seg-bulk-edit')?.addEventListener('click', () => {
            if (state.selected.size) abrirModalEdicion([...state.selected]);
        });
        document.getElementById('seg-sync-historial')?.addEventListener('click', () => {
            const ids = state.equipos
                .filter((item) => equipoEstado(item) === 'MEDIDO' && !item.historial_id)
                .map((item) => item.id);
            subirMedidosAHistorial(ids);
        });
    }

    async function cargarInicial() {
        state.loading = true;
        state.error = '';
        render();
        try {
            await cargarPeriodos();
            if (state.periodoId) await cargarEquiposPeriodo();
            await cargarEquiposMaestro();
        } finally {
            state.loading = false;
            render();
        }
    }

    async function cargarPeriodos() {
        const cached = readCache(CACHE_PERIODOS, []);
        if (!online()) {
            state.periodos = cached;
            state.periodoId = state.periodoId || cached[0]?.id || '';
            state.error = cached.length ? 'Mostrando cache local. Conectate para importar o editar.' : '';
            return;
        }

        const { data, error } = await getSupabase()
            .from(TABLE_PERIODOS)
            .select('*')
            .order('fecha_carga', { ascending: false })
            .order('created_at', { ascending: false });

        if (error) {
            state.periodos = cached;
            state.periodoId = state.periodoId || cached[0]?.id || '';
            state.error = error.message || 'No se pudo consultar Supabase.';
            return;
        }

        state.periodos = data || [];
        writeCache(CACHE_PERIODOS, state.periodos);
        if (!state.periodos.some((p) => p.id === state.periodoId)) {
            state.periodoId = state.periodos[0]?.id || '';
        }
    }

    async function cargarEquiposPeriodo() {
        const cacheKey = `${CACHE_EQUIPOS_PREFIX}${state.periodoId}`;
        const cached = readCache(cacheKey, []);
        if (!state.periodoId) {
            state.equipos = [];
            render();
            return;
        }
        if (!online()) {
            state.equipos = cached;
            state.error = cached.length ? 'Mostrando cache local. Conectate para editar.' : state.error;
            render();
            return;
        }

        state.loading = true;
        render();
        const { data, error } = await getSupabase()
            .from(TABLE_EQUIPOS)
            .select('*')
            .eq('periodo_id', state.periodoId)
            .order('ruta', { ascending: true })
            .order('activo', { ascending: true });

        if (error) {
            state.equipos = cached;
            state.error = error.message || 'No se pudieron cargar los equipos.';
        } else {
            state.equipos = data || [];
            state.error = '';
            writeCache(cacheKey, state.equipos);
        }
        state.loading = false;
        render();
    }

    async function cargarEquiposMaestro() {
        const cached = readCache(CACHE_MAESTRO, []);
        if (!online()) {
            state.equiposMaestro = cached;
            return;
        }
        const todos = [];
        for (let from = 0; ; from += 1000) {
            const { data, error } = await getSupabase()
                .from('equipos')
                .select('id,ruta,kks,ubicacion,activo,componente,ubicacion_tecnica,criticidad,denominacion_ut')
                .range(from, from + 999);
            if (error) {
                state.equiposMaestro = cached;
                return;
            }
            todos.push(...(data || []));
            if (!data || data.length < 1000) break;
        }
        state.equiposMaestro = todos;
        writeCache(CACHE_MAESTRO, state.equiposMaestro);
    }

    function abrirSelectorImportacion() {
        if (!puedeEditar()) return;
        if (!window.XLSX) {
            toast('SheetJS no disponible', 'No se pudo cargar la libreria para leer Excel.', 'danger');
            return;
        }
        if (!online()) {
            toast('Sin conexion', 'Necesitas conexion para importar datos a Supabase.', 'warning');
            return;
        }
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        input.addEventListener('change', () => {
            const file = input.files?.[0];
            if (file) abrirModalPeriodo(file);
        }, { once: true });
        input.click();
    }

    function sugerirPeriodo(fileName) {
        const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
        const upper = String(fileName || '').toUpperCase();
        const mes = meses.find((m) => upper.includes(m.toUpperCase()));
        const year = upper.match(/20\d{2}/)?.[0] || new Date().getFullYear();
        return `${mes || meses[new Date().getMonth()]} ${year}`;
    }

    function abrirModalPeriodo(file) {
        openModal(`
            <div class="seg-modal-card">
                <button class="seg-modal-close" type="button" data-close>&times;</button>
                <div class="seg-modal-title">
                    <span><i class="fa-solid fa-file-excel"></i></span>
                    <div>
                        <h2>Importar Excel</h2>
                        <p>${h(file.name)}</p>
                    </div>
                </div>
                <label class="seg-modal-field">
                    <span>Nombre del periodo</span>
                    <input id="seg-periodo-nombre" type="text" value="${h(sugerirPeriodo(file.name))}" placeholder="Ej: Mayo 2026">
                </label>
                <div class="seg-modal-actions">
                    <button class="seg-btn seg-btn--ghost" type="button" data-close>Cancelar</button>
                    <button id="seg-confirm-import" class="seg-btn seg-btn--primary" type="button"><i class="fa-solid fa-upload"></i> Importar</button>
                </div>
            </div>
        `, (modal) => {
            const input = modal.querySelector('#seg-periodo-nombre');
            input?.focus();
            input?.select();
            modal.querySelector('#seg-confirm-import')?.addEventListener('click', async () => {
                const nombre = input.value.trim();
                if (!nombre) {
                    input.focus();
                    return;
                }
                await importarExcel(file, nombre, modal);
            });
        });
    }

    async function importarExcel(file, nombrePeriodo, modal) {
        const btn = modal.querySelector('#seg-confirm-import');
        const original = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Importando...';
        try {
            const filas = await leerExcel(file);
            if (!filas.length) throw new Error('La hoja ACTIVOS NO MONITOREADOS no tiene filas validas.');

            const userId = await getUserId();

            // Usar el servidor local que bypasea RLS con service role key
            const res = await fetch('/api/seguimiento-vib/importar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    nombrePeriodo,
                    archivoOrigen: file.name,
                    totalEquipos: filas.length,
                    creado_por: userId || undefined,
                    equipos: filas
                })
            });

            const result = await res.json();
            if (!res.ok || !result.ok) throw new Error(result.error || 'Error al importar en el servidor.');

            const periodo = result.periodo;
            modal.remove();
            state.periodoId = periodo.id;
            state.selected.clear();
            toast('Importacion lista', `${filas.length} equipos cargados para ${nombrePeriodo}.`);
            await cargarInicial();
        } catch (error) {
            console.error('[Seguimiento VIB] Importacion fallida:', error);
            toast('No se pudo importar', error.message || 'Revisa el archivo e intentalo nuevamente.', 'danger');
            btn.disabled = false;
            btn.innerHTML = original;
        }
    }

    async function leerExcel(file) {
        const buffer = await file.arrayBuffer();
        const workbook = window.XLSX.read(buffer, { type: 'array', cellDates: false });
        const sheetName = workbook.SheetNames.find((name) => normalizar(name) === normalizar('ACTIVOS NO MONITOREADOS'));
        if (!sheetName) throw new Error('No se encontro la hoja "ACTIVOS NO MONITOREADOS".');
        const sheet = workbook.Sheets[sheetName];
        const rows = window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        const headerIdx = rows.findIndex((row) => {
            const text = row.map(normalizar).join('|');
            return text.includes('dias transcurridos') && text.includes('plan') && text.includes('activo');
        });
        const start = headerIdx >= 0 ? headerIdx + 1 : 1;
        return rows.slice(start).map(rowToEquipo).filter(Boolean);
    }

    function normalizar(value) {
        return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
    }

    function cell(row, idx) {
        const value = row[idx];
        return value === null || value === undefined ? '' : String(value).trim();
    }

    function toInt(value) {
        if (value === '' || value === null || value === undefined) return null;
        const n = Number(String(value).replace(',', '.'));
        return Number.isFinite(n) ? Math.round(n) : null;
    }

    function excelDateToIso(value) {
        if (value === '' || value === null || value === undefined) return null;
        if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
        const numeric = Number(value);
        if (Number.isFinite(numeric) && numeric > 0) {
            const parsed = window.XLSX?.SSF?.parse_date_code?.(numeric);
            if (parsed?.y && parsed?.m && parsed?.d) {
                return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d)).toISOString().slice(0, 10);
            }
        }
        const text = String(value).trim();
        const ymd = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
        if (ymd) return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`;
        const dmy = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
        if (dmy) {
            const year = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
            return `${year}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
        }
        return null;
    }

    function inferEstado(observacion) {
        const text = normalizar(observacion).toUpperCase();
        if (text.includes('MEDIDO')) return 'MEDIDO';
        if (text.includes('MANT')) return 'MANTENIMIENTO';
        if (text.includes('INDISP')) return 'INDISPONIBLE';
        if (text.includes('FUERA') || text.includes('SERVICIO')) return 'FUERA_SERVICIO';
        return 'PENDIENTE';
    }

    function rowToEquipo(row) {
        const payload = {
            dias_transcurridos: toInt(row[0]),
            plan: cell(row, 1),
            cant_intentos: toInt(row[2]),
            fecha_ultimo_intento: excelDateToIso(row[3]),
            observacion_original: cell(row, 4),
            ruta: cell(row, 5),
            ubicacion: cell(row, 6),
            activo: cell(row, 7),
            componente: cell(row, 8),
            ubicacion_tecnica: cell(row, 9),
            criticidad: cell(row, 10).toUpperCase(),
            razon: cell(row, 11)
        };
        const hasData = payload.ruta && payload.activo && payload.ubicacion_tecnica;
        if (!hasData) return null;
        payload.estado_actual = inferEstado(payload.observacion_original);
        return payload;
    }

    async function getUserId() {
        try {
            const { data } = await getSupabase().auth.getUser();
            return data?.user?.id || null;
        } catch (error) {
            return null;
        }
    }

    function fechaATimestamp(fecha) {
        const safe = fecha || todayIso();
        return new Date(`${safe}T12:00:00`).toISOString();
    }

    function horaCorta() {
        return new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
    }

    function armarDetalleLecturas(lecturas) {
        return {
            fecha: lecturas?.fecha || todayIso(),
            vibraciones: (lecturas?.vibraciones || []).map((item) => ({
                valor: Number(String(item.valor).replace(',', '.')),
                punto: item.punto
            })),
            temperaturas: (lecturas?.temperaturas || []).map((item) => ({
                valor: Number(String(item.valor).replace(',', '.')),
                punto: item.punto
            })),
            observacion: lecturas?.observacion || null
        };
    }

    async function crearHistorialSeguimiento(item, equipoMaestro, detalle) {
        const fecha = detalle?.fecha || item.medicion_fecha || item.fecha_ultimo_intento || todayIso();
        const observacion = detalle?.observacion || item.observacion_planify || 'Registro generado desde Seguimiento VIB.';
        const lecturasTexto = [
            ...(detalle?.vibraciones || []).map((v, idx) => `Vib ${idx + 1}: ${v.valor} mm/s (${v.punto})`),
            ...(detalle?.temperaturas || []).map((t, idx) => `Temp ${idx + 1}: ${t.valor} C (${t.punto})`)
        ];
        const acciones = [
            `Equipo marcado como medido desde Seguimiento VIB.`,
            `Ruta: ${item.ruta || 'Sin ruta'}`,
            `Ubicacion tecnica: ${item.ubicacion_tecnica || 'Sin UT'}`,
            lecturasTexto.length ? `Lecturas: ${lecturasTexto.join(' | ')}` : ''
        ].filter(Boolean).join('\n');
        const payload = {
            id: crypto.randomUUID(),
            tipo: `Seguimiento VIB - ${item.activo || 'Equipo'}${item.componente ? ` (${item.componente})` : ''}`,
            lider_nombre: 'Planify',
            ayudantes_nombres: [],
            hora_asignacion: '',
            hora_termino: horaCorta(),
            created_at: new Date().toISOString(),
            fecha_med: fecha,
            equipo_id: equipoMaestro?.id || null,
            seguimiento_vib_equipo_id: item.id,
            acciones_realizadas: acciones,
            observaciones: observacion,
            numero_aviso: '',
            hh_trabajo: ''
        };
        const { data, error } = await getSupabase()
            .from('historial_tareas')
            .insert([payload])
            .select()
            .single();
        if (error) throw error;
        return data || payload;
    }

    async function insertarMedicionesSeguimiento(item, equipoMaestro, detalle) {
        if (!equipoMaestro?.id) return 0;
        const fecha = detalle?.fecha || item.medicion_fecha || item.fecha_ultimo_intento || todayIso();
        const observacion = detalle?.observacion || null;
        const rows = [];
        (detalle?.vibraciones || []).forEach((lectura) => {
            rows.push({
                id: crypto.randomUUID(),
                equipo_id: equipoMaestro.id,
                tipo: 'vibracion',
                valor: lectura.valor,
                unidad: 'mm/s',
                punto_medicion: lectura.punto,
                componente: item.componente || equipoMaestro.componente || null,
                fecha,
                notas: observacion
            });
        });
        (detalle?.temperaturas || []).forEach((lectura) => {
            rows.push({
                id: crypto.randomUUID(),
                equipo_id: equipoMaestro.id,
                tipo: 'termografia',
                valor: lectura.valor,
                unidad: '°C',
                punto_medicion: lectura.punto,
                componente: item.componente || equipoMaestro.componente || null,
                fecha,
                notas: observacion
            });
        });
        if (!rows.length) return 0;
        const { error } = await getSupabase().from('mediciones').insert(rows);
        if (error) throw error;
        return rows.length;
    }

    async function registrarHistorialYMediciones(items, detallePorId = new Map()) {
        const updates = new Map();
        for (const item of items) {
            if (!item) continue;
            const detalle = detallePorId.get(item.id) || armarDetalleLecturas({ fecha: item.medicion_fecha || item.fecha_ultimo_intento || todayIso() });
            const equipoMaestro = equipoMaestroParaSeguimiento(item);
            let historialId = item.historial_id;
            if (!historialId) {
                const historial = await crearHistorialSeguimiento(item, equipoMaestro, detalle);
                historialId = historial.id;
            }
            await insertarMedicionesSeguimiento(item, equipoMaestro, detalle);
            const update = {
                historial_id: historialId,
                historial_at: item.historial_at || new Date().toISOString(),
                medicion_fecha: detalle.fecha,
                medicion_detalle: detalle
            };
            const { error } = await getSupabase().from(TABLE_EQUIPOS).update(update).eq('id', item.id);
            if (error) throw error;
            updates.set(item.id, update);
        }
        return updates;
    }

    async function subirMedidosAHistorial(ids) {
        if (!ids?.length) return;
        if (!online()) {
            toast('Sin conexion', 'Necesitas conexion para crear registros en historial.', 'warning');
            return;
        }
        const items = state.equipos.filter((item) => ids.includes(item.id) && equipoEstado(item) === 'MEDIDO' && !item.historial_id);
        if (!items.length) {
            toast('Sin pendientes', 'No hay equipos medidos pendientes de subir a historial.', 'warning');
            return;
        }
        try {
            const updates = await registrarHistorialYMediciones(items);
            state.equipos = state.equipos.map((item) => updates.has(item.id) ? { ...item, ...updates.get(item.id) } : item);
            writeCache(`${CACHE_EQUIPOS_PREFIX}${state.periodoId}`, state.equipos);
            toast('Historial actualizado', `${updates.size} equipo${updates.size !== 1 ? 's' : ''} enviado${updates.size !== 1 ? 's' : ''} a historial.`);
            render();
        } catch (error) {
            console.error('[Seguimiento VIB] Error subiendo a historial:', error);
            toast('No se pudo subir a historial', error.message || 'Intentalo otra vez.', 'danger');
        }
    }

    function abrirModalEdicion(ids) {
        if (!puedeEditar()) return;
        const items = state.equipos.filter((item) => ids.includes(item.id));
        if (!items.length) return;
        const first = items[0];
        const multi = items.length > 1;
        const detalle = getMedicionDetalle(first);
        const lecturaVib = Array.isArray(detalle.vibraciones) ? detalle.vibraciones : [];
        const lecturaTemp = Array.isArray(detalle.temperaturas) ? detalle.temperaturas : [];
        const tieneLecturasGuardadas = lecturaVib.length > 0 || lecturaTemp.length > 0;
        const fechaMed = tieneLecturasGuardadas ? (first.medicion_fecha || todayIso()) : todayIso();
        const observacionMed = detalle.observacion || first.observacion_planify || '';
        openModal(`
            <div class="seg-modal-card">
                <button class="seg-modal-close" type="button" data-close>&times;</button>
                <div class="seg-modal-title">
                    <span><i class="fa-solid fa-pen-to-square"></i></span>
                    <div>
                        <h2>${multi ? `Actualizar ${items.length} equipos` : 'Editar estado'}</h2>
                        <p>${multi ? 'Cambio masivo de seguimiento VIB' : h(first.activo || first.ubicacion_tecnica || '')}</p>
                    </div>
                </div>
                <label class="seg-modal-field">
                    <span>Estado actual</span>
                    <select id="seg-edit-estado">
                        ${Object.entries(ESTADOS).map(([key, meta]) => `<option value="${key}" ${equipoEstado(first) === key ? 'selected' : ''}>${h(meta.label)}</option>`).join('')}
                    </select>
                </label>
                <label class="seg-modal-field">
                    <span>Observacion Planify ${multi ? '(se aplicara a todos)' : '(opcional)'}</span>
                    <textarea id="seg-edit-observacion" rows="4" placeholder="Detalle opcional para el seguimiento">${multi ? '' : h(first.observacion_planify || '')}</textarea>
                </label>
                ${!multi ? `<div id="seg-mediciones-box" class="seg-mediciones-box">
                    <div class="seg-modal-subhead">
                        <strong><i class="fa-solid fa-wave-square"></i> Lecturas al marcar medido</strong>
                        <span>Opcional, pero queda en ficha e historial si lo completas.</span>
                    </div>
                    <label class="seg-modal-field">
                        <span>Fecha de medicion</span>
                        <input id="seg-med-fecha" type="date" value="${h(fechaMed)}">
                    </label>
                    <div class="seg-measure-grid">
                        <label class="seg-modal-field">
                            <span>Vibracion 1 (mm/s)</span>
                            <input id="seg-vib-1" type="number" min="0" step="0.01" value="${h(lecturaVib[0]?.valor ?? '')}" placeholder="Ej: 4.2">
                        </label>
                        <label class="seg-modal-field">
                            <span>Punto Vib. 1</span>
                            <input id="seg-vib-punto-1" type="text" value="${h(lecturaVib[0]?.punto ?? '')}" placeholder="Ej: LA">
                        </label>
                        <label class="seg-modal-field">
                            <span>Vibracion 2 (mm/s)</span>
                            <input id="seg-vib-2" type="number" min="0" step="0.01" value="${h(lecturaVib[1]?.valor ?? '')}" placeholder="Ej: 3.1">
                        </label>
                        <label class="seg-modal-field">
                            <span>Punto Vib. 2</span>
                            <input id="seg-vib-punto-2" type="text" value="${h(lecturaVib[1]?.punto ?? '')}" placeholder="Ej: LOA">
                        </label>
                        <label class="seg-modal-field">
                            <span>Temperatura 1 (C)</span>
                            <input id="seg-temp-1" type="number" min="0" step="0.1" value="${h(lecturaTemp[0]?.valor ?? '')}" placeholder="Ej: 48">
                        </label>
                        <label class="seg-modal-field">
                            <span>Punto Temp. 1</span>
                            <input id="seg-temp-punto-1" type="text" value="${h(lecturaTemp[0]?.punto ?? '')}" placeholder="Ej: Rodamiento LA">
                        </label>
                        <label class="seg-modal-field">
                            <span>Temperatura 2 (C)</span>
                            <input id="seg-temp-2" type="number" min="0" step="0.1" value="${h(lecturaTemp[1]?.valor ?? '')}" placeholder="Ej: 52">
                        </label>
                        <label class="seg-modal-field">
                            <span>Punto Temp. 2</span>
                            <input id="seg-temp-punto-2" type="text" value="${h(lecturaTemp[1]?.punto ?? '')}" placeholder="Ej: Rodamiento LOA">
                        </label>
                    </div>
                    <label class="seg-modal-field seg-med-observacion">
                        <span>Observacion de medicion (opcional)</span>
                        <textarea id="seg-med-observacion" rows="3" placeholder="Detalle opcional de la medicion">${h(observacionMed)}</textarea>
                    </label>
                    <p id="seg-med-error" class="seg-form-error"></p>
                </div>` : ''}
                <div class="seg-modal-actions">
                    <button class="seg-btn seg-btn--ghost" type="button" data-close>Cancelar</button>
                    <button id="seg-save-edit" class="seg-btn seg-btn--primary" type="button"><i class="fa-solid fa-floppy-disk"></i> Guardar</button>
                </div>
            </div>
        `, (modal) => {
            const estadoSelect = modal.querySelector('#seg-edit-estado');
            const box = modal.querySelector('#seg-mediciones-box');
            const syncVisibility = () => {
                if (box) box.style.display = estadoSelect?.value === 'MEDIDO' ? 'block' : 'none';
            };
            estadoSelect?.addEventListener('change', syncVisibility);
            syncVisibility();
            modal.querySelector('#seg-save-edit')?.addEventListener('click', async () => {
                await guardarEstado(ids, modal);
            });
        });
    }

    async function guardarEstado(ids, modal) {
        if (!online()) {
            toast('Sin conexion', 'Necesitas conexion para actualizar estados.', 'warning');
            return;
        }
        const estadoNuevo = modal.querySelector('#seg-edit-estado')?.value || 'PENDIENTE';
        const observacion = modal.querySelector('#seg-edit-observacion')?.value.trim() || null;
        const btn = modal.querySelector('#seg-save-edit');
        const original = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Guardando...';
        try {
            const userId = await getUserId();
            const detallePorId = new Map();
            let detalleSingle = null;
            if (estadoNuevo === 'MEDIDO' && ids.length === 1) {
                const lecturas = getLecturasDesdeModal(modal);
                const errorLecturas = validarLecturas(lecturas);
                if (errorLecturas) {
                    const errorEl = modal.querySelector('#seg-med-error');
                    if (errorEl) {
                        errorEl.textContent = errorLecturas;
                        errorEl.style.display = 'block';
                    }
                    btn.disabled = false;
                    btn.innerHTML = original;
                    return;
                }
                detalleSingle = armarDetalleLecturas(lecturas);
                detallePorId.set(ids[0], detalleSingle);
            }
            const update = {
                estado_actual: estadoNuevo,
                observacion_planify: observacion,
                actualizado_at: new Date().toISOString()
            };
            if (detalleSingle) {
                update.medicion_fecha = detalleSingle.fecha;
                update.medicion_detalle = detalleSingle;
            }
            if (userId) update.actualizado_por = userId;

            const { error } = await getSupabase().from(TABLE_EQUIPOS).update(update).in('id', ids);
            if (error) throw error;

            state.equipos = state.equipos.map((item) => ids.includes(item.id) ? { ...item, ...update } : item);
            if (estadoNuevo === 'MEDIDO') {
                const itemsActualizados = state.equipos.filter((item) => ids.includes(item.id));
                const updatesHistorial = await registrarHistorialYMediciones(itemsActualizados, detallePorId);
                state.equipos = state.equipos.map((item) => updatesHistorial.has(item.id) ? { ...item, ...updatesHistorial.get(item.id) } : item);
            }
            state.selected.clear();
            writeCache(`${CACHE_EQUIPOS_PREFIX}${state.periodoId}`, state.equipos);
            modal.remove();
            toast('Estados actualizados', `${ids.length} equipo${ids.length !== 1 ? 's' : ''} actualizado${ids.length !== 1 ? 's' : ''}.`);
            render();
        } catch (error) {
            console.error('[Seguimiento VIB] Error al guardar:', error);
            toast('No se pudo guardar', error.message || 'Intentalo otra vez.', 'danger');
            btn.disabled = false;
            btn.innerHTML = original;
        }
    }

    function openModal(html, onReady) {
        const modal = document.createElement('div');
        modal.className = 'seg-modal-backdrop';
        modal.innerHTML = html;
        document.body.appendChild(modal);
        const close = () => modal.remove();
        modal.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', close));
        modal.addEventListener('click', (event) => {
            if (event.target === modal) close();
        });
        onReady?.(modal);
    }

    window.renderSeguimientoVibView = function renderSeguimientoVibView(options = {}) {
        state.onBack = options.onBack || null;
        cargarInicial();
    };

    window.seguimientoVibAbrirMedicionesDesdeHistorial = async function seguimientoVibAbrirMedicionesDesdeHistorial(id) {
        if (!puedeEditar()) return;
        let item = state.equipos.find((equipo) => String(equipo.id) === String(id));
        if (!item && online()) {
            const { data, error } = await getSupabase().from(TABLE_EQUIPOS).select('*').eq('id', id).single();
            if (error) {
                toast('No se pudo abrir', error.message || 'No se encontro el equipo de seguimiento.', 'danger');
                return;
            }
            item = data;
            state.equipos = [item, ...state.equipos.filter((equipo) => String(equipo.id) !== String(item.id))];
        }
        if (!state.equiposMaestro.length) await cargarEquiposMaestro();
        if (item) abrirModalEdicion([item.id]);
    };
})();
