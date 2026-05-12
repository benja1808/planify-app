// ═══════════════════════════════════════════════════════════════════════════
// MÓDULO RUTAS DE VIBRACIÓN
// Datos de seed embebidos para que el módulo funcione sin DB.
// Las ejecuciones (avance por equipo) se guardan en localStorage para no
// requerir migración de la base de datos remota.
// ═══════════════════════════════════════════════════════════════════════════

const RUTAS_COLOR_UNIDAD = {
    'U1':   '#3B82F6',
    'U2':   '#10B981',
    'U3':   '#F59E0B',
    'U4':   '#EF4444',
    'U5':   '#8B5CF6',
    'U1-2': '#0EA5E9',
    'U3-4-5': '#A855F7',
    'SC':   '#6B7280',
    'SMC':  '#475569',
    'DESAL':'#06B6D4'
};

const RUTAS_FRECUENCIA_LABEL = {
    '2S': 'Quincenal',
    '1M': 'Mensual',
    '2M': 'Bimestral',
    '3M': 'Trimestral',
    '6M': 'Semestral',
    'U1': 'Semestral'  // Caso especial en la planilla
};

const vistaRutasEstado = {
    rutaActivaIdx: null,
    filtroUnidad: '',
    filtroFrecuencia: '',
    busqueda: ''
};

// ── Persistencia localStorage ─────────────────────────────────────────────
const RUTAS_EJECUCIONES_KEY = 'planify_rutas_ejecuciones';
function getRutasEjecuciones() {
    try {
        const raw = localStorage.getItem(RUTAS_EJECUCIONES_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
}
function saveRutasEjecuciones(data) {
    try { localStorage.setItem(RUTAS_EJECUCIONES_KEY, JSON.stringify(data)); }
    catch (e) { /* noop */ }
}
function getEjecucionActiva(rutaIdx) {
    const all = getRutasEjecuciones();
    return all[rutaIdx] || null;
}
function setEjecucionActiva(rutaIdx, ejecucion) {
    const all = getRutasEjecuciones();
    if (ejecucion === null) delete all[rutaIdx];
    else all[rutaIdx] = ejecucion;
    saveRutasEjecuciones(all);
}

// ── Color helper ──────────────────────────────────────────────────────────
function colorUnidad(unidad) {
    return RUTAS_COLOR_UNIDAD[unidad] || '#64748b';
}

// ── Match con equipos existentes por ubicación técnica ────────────────────
// Construye y cachea un índice por UT para resolver rápido.
let _rutasEquiposIndex = null;
function normalizarRutaUT(valor) {
    return String(valor || '')
        .toUpperCase()
        .replace(/\s+/g, '')
        .replace(/--+/g, '-')
        .trim();
}
function obtenerBaseRutaUT(valor) {
    const ut = normalizarRutaUT(valor);
    const match = ut.match(/^(.+-AP\d+)/);
    return match ? match[1] : '';
}
function _construirIndiceEquiposPorUT() {
    const exacto = new Map();
    const base = new Map();
    (estado.equipos || []).forEach(e => {
        [e.ubicacion_tecnica, e.kks].forEach(valor => {
            const ut = normalizarRutaUT(valor);
            if (ut && !exacto.has(ut)) exacto.set(ut, e);
            const baseUT = obtenerBaseRutaUT(ut);
            if (baseUT && !base.has(baseUT)) base.set(baseUT, e);
        });
    });
    return { exacto, base };
}
function obtenerEquipoPorUT(ubicacionTecnica) {
    if (!ubicacionTecnica) return null;
    if (!_rutasEquiposIndex) _rutasEquiposIndex = _construirIndiceEquiposPorUT();
    const ut = normalizarRutaUT(ubicacionTecnica);
    const exacto = _rutasEquiposIndex.exacto.get(ut);
    if (exacto) return exacto;
    const baseUT = obtenerBaseRutaUT(ut);
    return baseUT ? (_rutasEquiposIndex.base.get(baseUT) || null) : null;
}
function normalizarRutasTexto(valor) {
    return String(valor || '').trim().toLowerCase();
}
function obtenerPartesEquipoVinculado(equipo) {
    if (!equipo) return [];
    return (estado.equipos || []).filter(item =>
        normalizarRutasTexto(item.activo) === normalizarRutasTexto(equipo.activo) &&
        normalizarRutasTexto(item.ubicacion) === normalizarRutasTexto(equipo.ubicacion)
    );
}
function invalidarIndiceEquipos() { _rutasEquiposIndex = null; }
function labelFrecuencia(frec) {
    return RUTAS_FRECUENCIA_LABEL[frec] || frec;
}

// ── Vista principal ───────────────────────────────────────────────────────
function renderRutasView() {
    if (vistaRutasEstado.rutaActivaIdx !== null) {
        renderRutasDetalle(vistaRutasEstado.rutaActivaIdx);
    } else {
        renderRutasLista();
    }
}

function renderRutasLista() {
    const isAdmin = estado.usuarioActual === 'admin';
    const ejecuciones = getRutasEjecuciones();

    const unidadesUnicas = [...new Set(RUTAS_VIBRACION_SEED.map(r => r.unidad))];
    const frecuenciasUnicas = [...new Set(RUTAS_VIBRACION_SEED.map(r => r.frecuencia))];

    const filtradas = RUTAS_VIBRACION_SEED
        .map((r, idx) => ({ ...r, idx }))
        .filter(r => {
            if (vistaRutasEstado.filtroUnidad && r.unidad !== vistaRutasEstado.filtroUnidad) return false;
            if (vistaRutasEstado.filtroFrecuencia && r.frecuencia !== vistaRutasEstado.filtroFrecuencia) return false;
            if (vistaRutasEstado.busqueda) {
                const q = vistaRutasEstado.busqueda.toLowerCase();
                if (!r.nombre.toLowerCase().includes(q) && !(r.plan || '').toLowerCase().includes(q)) return false;
            }
            return true;
        });

    const totalRutas = RUTAS_VIBRACION_SEED.length;
    const totalEquipos = RUTAS_VIBRACION_SEED.reduce((acc, r) => acc + r.equipos.length, 0);
    const enProgreso = Object.keys(ejecuciones).length;

    const renderCard = (r) => {
        const ej = ejecuciones[r.idx];
        const total = r.equipos.length;
        const completados = ej?.equiposCompletados?.length || 0;
        const pct = total ? Math.round((completados / total) * 100) : 0;
        const color = colorUnidad(r.unidad);
        const tieneEjecucion = !!ej;

        return `<article class="rutas-card" data-ruta-idx="${r.idx}"
            onclick="window.rutasAbrirDetalle(${r.idx})"
            style="cursor:pointer; background:#fff; border:1px solid #e5e7eb; border-radius:14px; padding:1rem 1.1rem; box-shadow:0 1px 3px rgba(15,23,42,0.06); transition:transform 150ms, box-shadow 150ms;"
            onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 8px 22px rgba(15,23,42,0.1)'"
            onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 1px 3px rgba(15,23,42,0.06)'">
            <div style="display:flex; align-items:center; gap:0.5rem; margin-bottom:0.45rem; flex-wrap:wrap;">
                <span style="background:${color}; color:#fff; font-size:0.74rem; font-weight:800; padding:0.25rem 0.6rem; border-radius:999px;">${r.unidad}</span>
                <span style="background:#f1f5f9; color:#475569; font-size:0.74rem; font-weight:600; padding:0.25rem 0.6rem; border-radius:999px;">${labelFrecuencia(r.frecuencia)}</span>
                ${tieneEjecucion ? `<span style="background:#dbeafe; color:#1e40af; font-size:0.7rem; font-weight:700; padding:0.2rem 0.55rem; border-radius:999px;"><i class="fa-solid fa-circle-play"></i> En progreso</span>` : ''}
            </div>
            <div style="font-size:0.94rem; font-weight:700; color:#0f172a; line-height:1.3; margin-bottom:0.35rem;">${escapeHtml(r.nombre)}</div>
            <div style="font-size:0.78rem; color:#64748b; margin-bottom:0.6rem;">
                <i class="fa-solid fa-clipboard-check"></i> Plan ${escapeHtml(r.plan || '—')} · ${total} equipo${total !== 1 ? 's' : ''}
            </div>
            ${tieneEjecucion ? `
                <div style="margin-top:0.45rem;">
                    <div style="display:flex; justify-content:space-between; font-size:0.74rem; color:#64748b; margin-bottom:0.2rem;">
                        <span><i class="fa-solid fa-hashtag"></i> OT ${escapeHtml(ej.ot || '—')}</span>
                        <span><strong style="color:${color};">${completados}/${total}</strong> (${pct}%)</span>
                    </div>
                    <div style="height:8px; background:#f1f5f9; border-radius:999px; overflow:hidden;">
                        <div style="height:100%; width:${pct}%; background:${color}; transition:width 250ms;"></div>
                    </div>
                </div>
            ` : `
                <div style="font-size:0.76rem; color:#94a3b8;"><i class="fa-regular fa-circle-pause"></i> Sin ejecución activa</div>
            `}
        </article>`;
    };

    const filtroBtn = (label, value, key) => {
        const activo = vistaRutasEstado[key] === value;
        return `<button type="button" data-ruta-filtro-key="${key}" data-ruta-filtro-value="${value}"
            style="border:1px solid ${activo ? '#FF6900' : '#e5e7eb'}; background:${activo ? '#fff7f0' : '#fff'}; color:${activo ? '#9a3412' : '#475569'}; padding:0.4rem 0.85rem; border-radius:999px; font-size:0.8rem; font-weight:600; cursor:pointer;">
            ${escapeHtml(label)}
        </button>`;
    };

    mainContent.innerHTML = `
        <div class="fade-in" style="padding:1rem;">
            <section class="panel" style="background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%); border-color: rgba(251,191,36,0.4); margin-bottom:1.2rem;">
                <div class="dashboard-hero-head">
                    <div>
                        <div style="font-size:0.78rem; font-weight:700; color:#92400e; text-transform:uppercase; letter-spacing:0.05em;">Programa de vibración</div>
                        <h1 style="margin:0.3rem 0 0.4rem 0; color:#0f172a;"><i class="fa-solid fa-route" style="color:#FF6900;"></i> Rutas VIB</h1>
                        <p style="color:#64748b; margin:0;">Recorre cada ruta marcando los equipos que ya fueron medidos. El avance se guarda automáticamente.</p>
                    </div>
                    <div style="display:flex; gap:0.5rem; flex-wrap:wrap; align-items:flex-start;">
                        <span class="dashboard-hero-badge" style="background:#fff; border:1px solid rgba(0,0,0,0.06);"><i class="fa-solid fa-route" style="color:#FF6900;"></i> ${totalRutas} rutas</span>
                        <span class="dashboard-hero-badge" style="background:#fff; border:1px solid rgba(0,0,0,0.06);"><i class="fa-solid fa-gears" style="color:#0ea5e9;"></i> ${totalEquipos} equipos</span>
                        <span class="dashboard-hero-badge" style="background:#fff; border:1px solid rgba(0,0,0,0.06);"><i class="fa-solid fa-circle-play" style="color:#10b981;"></i> ${enProgreso} en curso</span>
                    </div>
                </div>
            </section>

            <section class="panel" style="margin-bottom:1.2rem; padding:1rem;">
                <div style="display:flex; flex-direction:column; gap:0.7rem;">
                    <input id="rutas-search" type="text" class="form-control" placeholder="Buscar por nombre o plan SAP…" value="${escapeHtml(vistaRutasEstado.busqueda)}" style="font-size:0.9rem;">
                    <div style="display:flex; flex-direction:column; gap:0.5rem;">
                        <div>
                            <div style="font-size:0.74rem; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:0.04em; margin-bottom:0.35rem;">Unidad</div>
                            <div style="display:flex; flex-wrap:wrap; gap:0.4rem;">
                                ${filtroBtn('Todas', '', 'filtroUnidad')}
                                ${unidadesUnicas.map(u => filtroBtn(u, u, 'filtroUnidad')).join('')}
                            </div>
                        </div>
                        <div>
                            <div style="font-size:0.74rem; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:0.04em; margin-bottom:0.35rem;">Frecuencia</div>
                            <div style="display:flex; flex-wrap:wrap; gap:0.4rem;">
                                ${filtroBtn('Todas', '', 'filtroFrecuencia')}
                                ${frecuenciasUnicas.map(f => filtroBtn(labelFrecuencia(f), f, 'filtroFrecuencia')).join('')}
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <section>
                <div style="font-size:0.85rem; color:#64748b; margin-bottom:0.7rem;">
                    Mostrando <strong style="color:#0f172a;">${filtradas.length}</strong> de ${totalRutas} ruta${totalRutas !== 1 ? 's' : ''}
                </div>
                <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:0.85rem;">
                    ${filtradas.length
                        ? filtradas.map(renderCard).join('')
                        : `<div class="empty-state" style="grid-column:1/-1;"><div><strong>Sin rutas</strong><p>Ajusta los filtros para ver más resultados.</p></div></div>`}
                </div>
            </section>
        </div>
    `;

    // Wire filtros
    document.querySelectorAll('[data-ruta-filtro-key]').forEach(btn => {
        btn.addEventListener('click', () => {
            const k = btn.dataset.rutaFiltroKey;
            const v = btn.dataset.rutaFiltroValue;
            vistaRutasEstado[k] = vistaRutasEstado[k] === v ? '' : v;
            renderRutasView();
        });
    });
    const search = document.getElementById('rutas-search');
    if (search) {
        search.addEventListener('input', (e) => {
            vistaRutasEstado.busqueda = e.target.value;
            renderRutasView();
            setTimeout(() => document.getElementById('rutas-search')?.focus(), 0);
        });
    }
}

function renderRutasDetalle(idx) {
    const r = RUTAS_VIBRACION_SEED[idx];
    if (!r) { vistaRutasEstado.rutaActivaIdx = null; renderRutasView(); return; }
    const isAdmin = estado.usuarioActual === 'admin';
    const ej = getEjecucionActiva(idx);
    const completadosSet = new Set(ej?.equiposCompletados || []);
    const total = r.equipos.length;
    const completados = completadosSet.size;
    const pct = total ? Math.round((completados / total) * 100) : 0;
    const color = colorUnidad(r.unidad);
    const observaciones = ej?.observaciones || {};

    const renderEquipo = (eq, eqIdx) => {
        const done = completadosSet.has(eqIdx);
        const obs = observaciones[eqIdx] || '';
        const equipoVinculado = obtenerEquipoPorUT(eq.ubicacion_tecnica);
        const tieneFicha = !!equipoVinculado?.id;
        const partesEquipo = obtenerPartesEquipoVinculado(equipoVinculado);
        const totalPartes = partesEquipo.length;
        const fichaTitle = totalPartes > 1 ? 'Elegir parte del equipo para abrir su ficha' : 'Click para abrir la ficha del equipo';
        const fichaLabel = totalPartes > 1 ? `Ver partes (${totalPartes})` : 'Ver ficha';
        const datosGuardados = Array.isArray(ej?.mediciones?.[eqIdx]) ? ej.mediciones[eqIdx] : [];
        return `<article class="ruta-equipo" style="border:1px solid ${done ? '#bbf7d0' : '#e5e7eb'}; background:${done ? '#f0fdf4' : '#fff'}; border-radius:10px; padding:0.7rem 0.9rem; margin-bottom:0.5rem; transition:all 150ms;">
            <div style="display:flex; align-items:flex-start; gap:0.65rem;">
                <input type="checkbox" ${done ? 'checked' : ''} ${!ej ? 'disabled' : ''}
                    onchange="window.rutasToggleEquipo(${idx}, ${eqIdx}, this.checked)"
                    style="width:18px; height:18px; accent-color:#10b981; margin-top:2px; flex-shrink:0; cursor:${ej ? 'pointer' : 'not-allowed'};">
                <div style="flex:1; min-width:0; ${tieneFicha ? 'cursor:pointer;' : ''}"
                    ${tieneFicha ? `onclick="window.rutasAbrirFichaEquipo('${equipoVinculado.id}')" title="${fichaTitle}"` : ''}>
                    <div style="font-weight:600; color:#0f172a; font-size:0.92rem; line-height:1.35; ${done ? 'text-decoration:line-through; color:#64748b;' : ''} display:flex; align-items:center; gap:0.45rem; flex-wrap:wrap;">
                        <span>${escapeHtml(eq.nombre)}</span>
                        ${tieneFicha
                            ? `<span style="display:inline-flex; align-items:center; gap:0.25rem; font-size:0.68rem; font-weight:700; background:#dbeafe; color:#1e40af; padding:0.15rem 0.5rem; border-radius:999px; text-transform:uppercase; letter-spacing:0.04em;"><i class="fa-solid fa-link"></i> ${fichaLabel}</span>`
                            : `<span style="display:inline-flex; align-items:center; gap:0.25rem; font-size:0.68rem; font-weight:700; background:#fef3c7; color:#92400e; padding:0.15rem 0.5rem; border-radius:999px; text-transform:uppercase; letter-spacing:0.04em;" title="Equipo no encontrado en el maestro"><i class="fa-solid fa-circle-question"></i> Sin vincular</span>`
                        }
                        ${datosGuardados.length ? `<span style="display:inline-flex; align-items:center; gap:0.25rem; font-size:0.68rem; font-weight:700; background:#dcfce7; color:#047857; padding:0.15rem 0.5rem; border-radius:999px; text-transform:uppercase; letter-spacing:0.04em;"><i class="fa-solid fa-floppy-disk"></i> Datos ${datosGuardados.length}</span>` : ''}
                    </div>
                    <div style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:0.75rem; color:#64748b; margin-top:0.15rem;">
                        <i class="fa-solid fa-diagram-project"></i> ${escapeHtml(eq.ubicacion_tecnica || '—')}
                    </div>
                </div>
                ${done ? `<i class="fa-solid fa-check-circle" style="color:#10b981; font-size:1.1rem; flex-shrink:0;"></i>` : ''}
            </div>
            ${ej ? `
                <input type="text" class="form-control" placeholder="Observación (opcional)"
                    value="${escapeHtml(obs)}"
                    oninput="window.rutasSetObservacion(${idx}, ${eqIdx}, this.value)"
                    style="margin-top:0.5rem; font-size:0.82rem; padding:0.4rem 0.6rem;">
            ` : ''}
        </article>`;
    };

    mainContent.innerHTML = `
        <div class="fade-in" style="padding:1rem;">
            <button onclick="window.rutasVolver()" style="background:none; border:none; color:#FF6900; font-size:0.88rem; font-weight:600; cursor:pointer; display:inline-flex; align-items:center; gap:0.35rem; margin-bottom:0.7rem; padding:0.35rem 0;">
                <i class="fa-solid fa-arrow-left"></i> Volver a rutas
            </button>

            <section class="panel" style="background: linear-gradient(135deg, #fff7f0 0%, #fef3c7 100%); border-color: ${color}55; margin-bottom:1.1rem;">
                <div style="display:flex; gap:0.5rem; flex-wrap:wrap; margin-bottom:0.45rem;">
                    <span style="background:${color}; color:#fff; font-size:0.78rem; font-weight:800; padding:0.3rem 0.75rem; border-radius:999px;">${r.unidad}</span>
                    <span style="background:#fff; color:#475569; font-size:0.78rem; font-weight:600; padding:0.3rem 0.75rem; border-radius:999px; border:1px solid #e5e7eb;">${labelFrecuencia(r.frecuencia)}</span>
                    <span style="background:#fff; color:#475569; font-size:0.78rem; font-weight:600; padding:0.3rem 0.75rem; border-radius:999px; border:1px solid #e5e7eb;"><i class="fa-solid fa-clipboard-check"></i> Plan ${escapeHtml(r.plan || '—')}</span>
                </div>
                <h1 style="margin:0 0 0.4rem 0; color:#0f172a; font-size:1.3rem;">${escapeHtml(r.nombre)}</h1>
                <p style="color:#64748b; margin:0;">${total} equipo${total !== 1 ? 's' : ''} en esta ruta.</p>
            </section>

            ${ej ? `
                <section class="panel" style="margin-bottom:1.1rem; padding:1rem 1.1rem;">
                    <div style="display:flex; justify-content:space-between; align-items:center; gap:0.7rem; flex-wrap:wrap; margin-bottom:0.5rem;">
                        <div>
                            <div style="font-size:0.78rem; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:0.04em;">Ejecución activa</div>
                            <div style="font-size:1rem; font-weight:700; color:#0f172a; margin-top:0.15rem;">
                                <i class="fa-solid fa-hashtag" style="color:#FF6900;"></i> OT ${escapeHtml(ej.ot || '—')}
                            </div>
                            <div style="font-size:0.78rem; color:#64748b; margin-top:0.15rem;">
                                Iniciada el ${ej.fechaInicio || '—'}
                            </div>
                        </div>
                        <div style="text-align:right;">
                            <div style="font-size:1.6rem; font-weight:800; color:${color};">${pct}%</div>
                            <div style="font-size:0.78rem; color:#64748b;">${completados} de ${total}</div>
                        </div>
                    </div>
                    <div style="height:10px; background:#f1f5f9; border-radius:999px; overflow:hidden; margin-bottom:0.7rem;">
                        <div style="height:100%; width:${pct}%; background:${color}; transition:width 250ms;"></div>
                    </div>
                    <div style="display:flex; gap:0.5rem; flex-wrap:wrap; justify-content:flex-end;">
                        ${isAdmin && completados === total ? `
                            <button onclick="window.rutasCerrarEjecucion(${idx})" class="btn btn-success" style="font-size:0.85rem;">
                                <i class="fa-solid fa-flag-checkered"></i> Cerrar ruta
                            </button>
                        ` : ''}
                        ${isAdmin ? `
                            <button onclick="window.rutasCancelarEjecucion(${idx})" class="btn btn-outline" style="font-size:0.85rem; border-color:#fecaca; color:#dc2626;">
                                <i class="fa-solid fa-xmark"></i> Cancelar
                            </button>
                        ` : ''}
                    </div>
                </section>
            ` : `
                <section class="panel" style="margin-bottom:1.1rem; padding:1rem 1.1rem; background:#f8fafc; text-align:center;">
                    <p style="color:#64748b; margin:0 0 0.7rem 0;">Esta ruta no tiene una ejecución activa.</p>
                    ${isAdmin ? `
                        <button onclick="window.rutasIniciarEjecucion(${idx})" class="btn btn-primary">
                            <i class="fa-solid fa-circle-play"></i> Iniciar Ejecución
                        </button>
                    ` : '<p style="color:#94a3b8; font-size:0.82rem;">Espera a que un planificador inicie una ejecución.</p>'}
                </section>
            `}

            <section>
                <div style="font-size:0.85rem; font-weight:700; color:#0f172a; margin-bottom:0.5rem;">
                    <i class="fa-solid fa-list-check" style="color:#FF6900;"></i> Equipos de la ruta
                </div>
                ${r.equipos.map(renderEquipo).join('')}
            </section>
        </div>
    `;
}

// ── Acciones expuestas en window ──────────────────────────────────────────
window.rutasAbrirDetalle = function(idx) {
    invalidarIndiceEquipos(); // refrescar match cada vez que entras a un detalle
    vistaRutasEstado.rutaActivaIdx = idx;
    renderRutasView();
    window.scrollTo({ top: 0, behavior: 'smooth' });
};
window.rutasAbrirFichaEquipo = function(equipoId) {
    if (!equipoId) return;
    const equipo = (estado.equipos || []).find(item => String(item.id) === String(equipoId));
    if (typeof window.elegirComponenteYAbrirFicha === 'function') {
        window.elegirComponenteYAbrirFicha(equipoId, equipo?.ubicacion || '');
        return;
    }
    if (typeof window.abrirFichaTecnica === 'function') {
        window.abrirFichaTecnica(equipoId);
    } else {
        alert('La ficha técnica no está disponible.');
    }
};
window.rutasAbrirCapturaEquipo = function(idx, eqIdx) {
    const ruta = RUTAS_VIBRACION_SEED[idx];
    const equipoRuta = ruta?.equipos?.[eqIdx];
    if (!ruta || !equipoRuta) return;

    const equipoVinculado = obtenerEquipoPorUT(equipoRuta.ubicacion_tecnica);
    const partes = equipoVinculado
        ? (obtenerPartesEquipoVinculado(equipoVinculado).length
            ? obtenerPartesEquipoVinculado(equipoVinculado)
            : [equipoVinculado])
        : [];

    document.getElementById('modal-ruta-captura-equipo')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'modal-ruta-captura-equipo';
    overlay.className = 'modal-overlay-base';
    overlay.style.cssText = 'display:flex; z-index:11000;';
    overlay.innerHTML = `
        <div class="modal-shell modal-shell--medium" style="width:min(100%, 620px);">
            <div class="modal-head">
                <div class="modal-title-wrap">
                    <span class="modal-eyebrow"><i class="fa-solid fa-route"></i> Datos de ruta</span>
                    <h2 class="modal-title" id="ruta-captura-titulo">Equipo listo</h2>
                    <p class="modal-subtitle" id="ruta-captura-subtitulo"></p>
                </div>
                <button id="ruta-captura-cerrar" class="modal-close" type="button" aria-label="Cerrar">&times;</button>
            </div>
            <div id="ruta-captura-body" class="modal-body"></div>
        </div>
    `;
    document.body.appendChild(overlay);

    const body = overlay.querySelector('#ruta-captura-body');
    const titulo = overlay.querySelector('#ruta-captura-titulo');
    const subtitulo = overlay.querySelector('#ruta-captura-subtitulo');
    const cerrar = () => overlay.remove();
    overlay.querySelector('#ruta-captura-cerrar')?.addEventListener('click', cerrar);
    overlay.addEventListener('click', event => { if (event.target === overlay) cerrar(); });

    const renderPregunta = () => {
        titulo.textContent = 'Equipo marcado como listo';
        subtitulo.textContent = `${equipoRuta.nombre} · ${equipoRuta.ubicacion_tecnica || ruta.nombre}`;
        body.innerHTML = `
            <div class="modal-callout" style="margin:0;">
                ¿Necesitas guardar datos de vibración o temperatura para este equipo?
            </div>
            <div class="modal-actions" style="padding:0; border-top:0; background:transparent;">
                <button id="ruta-captura-no" class="btn btn-outline" type="button">
                    <i class="fa-solid fa-check"></i> No, solo dejar listo
                </button>
                <button id="ruta-captura-si" class="btn btn-primary" type="button">
                    <i class="fa-solid fa-floppy-disk"></i> Sí, guardar datos
                </button>
            </div>
        `;
        body.querySelector('#ruta-captura-no')?.addEventListener('click', cerrar);
        body.querySelector('#ruta-captura-si')?.addEventListener('click', renderPartes);
    };

    const renderPartes = () => {
        titulo.textContent = 'Seleccionar parte';
        subtitulo.textContent = `${equipoRuta.nombre} · ${partes.length || 0} parte(s) disponibles`;
        if (!partes.length) {
            body.innerHTML = `
                <div class="modal-callout" style="background:#fef2f2; border-color:#fecaca; color:#991b1b;">
                    Este equipo no tiene partes vinculadas en el maestro. Puedes dejarlo listo sin guardar mediciones.
                </div>
                <div class="modal-actions" style="padding:0; border-top:0; background:transparent;">
                    <button id="ruta-captura-volver" class="btn btn-outline" type="button">Volver</button>
                    <button id="ruta-captura-cerrar2" class="btn btn-primary" type="button">Cerrar</button>
                </div>
            `;
            body.querySelector('#ruta-captura-volver')?.addEventListener('click', renderPregunta);
            body.querySelector('#ruta-captura-cerrar2')?.addEventListener('click', cerrar);
            return;
        }

        body.innerHTML = `
            <div style="display:grid; gap:0.55rem;">
                ${partes.map(parte => `
                    <button class="ruta-parte-btn" type="button" data-parte-id="${escapeHtml(parte.id)}"
                        style="display:flex; align-items:center; gap:0.7rem; width:100%; text-align:left; cursor:pointer; border:1.5px solid #e2e8f0; background:#f8fafc; border-radius:12px; padding:0.75rem 0.9rem;">
                        <i class="fa-solid fa-gears" style="color:#FF6900;"></i>
                        <span style="flex:1; min-width:0;">
                            <strong style="display:block; color:#0f172a;">${escapeHtml(parte.componente || parte.activo || 'Sin componente')}</strong>
                            <span style="display:block; color:#64748b; font-size:0.78rem; margin-top:0.12rem;">${escapeHtml(parte.kks || parte.ubicacion_tecnica || 'Sin KKS')}</span>
                        </span>
                        <i class="fa-solid fa-angle-right" style="color:#94a3b8;"></i>
                    </button>
                `).join('')}
            </div>
            <div class="modal-actions" style="padding:0; border-top:0; background:transparent;">
                <button id="ruta-captura-volver" class="btn btn-outline" type="button">Volver</button>
            </div>
        `;
        body.querySelector('#ruta-captura-volver')?.addEventListener('click', renderPregunta);
        body.querySelectorAll('.ruta-parte-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const parte = partes.find(item => String(item.id) === String(btn.dataset.parteId));
                if (parte) renderFormulario(parte);
            });
        });
    };

    const renderContinuar = ({ parteNombre, vibracion, temperatura, totalRegistros }) => {
        titulo.textContent = 'Medición guardada';
        subtitulo.textContent = `${equipoRuta.nombre} · ${totalRegistros || 1} punto(s) registrado(s)`;
        body.innerHTML = `
            <div class="modal-callout" style="margin:0; background:#ecfdf5; border-color:#a7f3d0; color:#065f46;">
                Se guardó ${escapeHtml(parteNombre)}: ${escapeHtml(vibracion)} mm/s · ${escapeHtml(temperatura)} °C.
            </div>
            <div style="font-size:0.95rem; color:#334155; line-height:1.55;">
                ¿Quieres guardar datos de otro punto de este equipo?
            </div>
            <div class="modal-actions" style="padding:0; border-top:0; background:transparent;">
                <button id="ruta-med-terminar" class="btn btn-outline" type="button">
                    <i class="fa-solid fa-check"></i> No, terminar
                </button>
                <button id="ruta-med-otro" class="btn btn-primary" type="button">
                    <i class="fa-solid fa-plus"></i> Sí, agregar otro punto
                </button>
            </div>
        `;
        body.querySelector('#ruta-med-terminar')?.addEventListener('click', cerrar);
        body.querySelector('#ruta-med-otro')?.addEventListener('click', renderPartes);
    };

    const renderFormulario = (parte) => {
        const parteNombre = parte.componente || parte.activo || 'Parte seleccionada';
        titulo.textContent = 'Guardar medición';
        subtitulo.textContent = `${parteNombre} · ${parte.kks || equipoRuta.ubicacion_tecnica || ''}`;
        body.innerHTML = `
            <div style="display:grid; gap:1rem;">
                <div style="display:grid; grid-template-columns:minmax(0, 1fr) minmax(0, 1fr); gap:0.75rem;">
                    <div class="form-group" style="margin:0;">
                        <label>Vibración más alta (mm/s)</label>
                        <input id="ruta-med-vibracion" class="form-control" type="number" min="0" step="0.01" placeholder="Ej: 4.50">
                    </div>
                    <div class="form-group" style="margin:0;">
                        <label>Punto</label>
                        <input id="ruta-med-punto" class="form-control" type="text" placeholder="Ej: Lado acople">
                    </div>
                </div>
                <div class="form-group" style="margin:0;">
                    <label>Temperatura (°C)</label>
                    <input id="ruta-med-temperatura" class="form-control" type="number" step="0.1" placeholder="Ej: 64.5">
                </div>
                <div class="form-group" style="margin:0;">
                    <label>Observación <span style="font-weight:400; color:#64748b;">(opcional)</span></label>
                    <textarea id="ruta-med-observacion" class="form-control" rows="3" placeholder="Ej: leve ruido, condición normal, revisar tendencia..." style="resize:vertical;"></textarea>
                </div>
                <p id="ruta-med-error" class="form-helper" style="display:none; color:#dc2626; margin:0;"></p>
            </div>
            <div class="modal-actions" style="padding:0; border-top:0; background:transparent;">
                <button id="ruta-med-volver" class="btn btn-outline" type="button">Cambiar parte</button>
                <button id="ruta-med-guardar" class="btn btn-primary" type="button">
                    <i class="fa-solid fa-floppy-disk"></i> Guardar medición
                </button>
            </div>
        `;
        body.querySelector('#ruta-med-volver')?.addEventListener('click', renderPartes);
        body.querySelector('#ruta-med-guardar')?.addEventListener('click', async () => {
            const errorEl = body.querySelector('#ruta-med-error');
            const btn = body.querySelector('#ruta-med-guardar');
            const vibracion = Number(String(body.querySelector('#ruta-med-vibracion')?.value || '').replace(',', '.'));
            const punto = String(body.querySelector('#ruta-med-punto')?.value || '').trim();
            const temperatura = Number(String(body.querySelector('#ruta-med-temperatura')?.value || '').replace(',', '.'));
            const observacion = String(body.querySelector('#ruta-med-observacion')?.value || '').trim();

            const mostrarError = (mensaje) => {
                if (!errorEl) return;
                errorEl.textContent = mensaje;
                errorEl.style.display = 'block';
            };
            if (!Number.isFinite(vibracion) || vibracion < 0) return mostrarError('Ingresa la vibración más alta.');
            if (!punto) return mostrarError('Ingresa el punto donde se tomó la vibración.');
            if (!Number.isFinite(temperatura)) return mostrarError('Ingresa la temperatura.');

            const original = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Guardando...';
            try {
                const fecha = new Date().toISOString().slice(0, 10);
                await guardarMedicion({
                    equipo_id: parte.id,
                    tipo: 'vibracion',
                    valor: vibracion,
                    punto_medicion: punto,
                    componente: parte.componente || null,
                    fecha,
                    observaciones: observacion
                });
                await guardarMedicion({
                    equipo_id: parte.id,
                    tipo: 'termografia',
                    valor: temperatura,
                    punto_medicion: punto,
                    componente: parte.componente || null,
                    fecha,
                    observaciones: observacion
                });

                const ej = getEjecucionActiva(idx);
                if (ej) {
                    ej.mediciones = ej.mediciones || {};
                    const registros = Array.isArray(ej.mediciones[eqIdx]) ? ej.mediciones[eqIdx] : [];
                    registros.unshift({
                        fecha: new Date().toISOString(),
                        equipo: equipoRuta.nombre,
                        ubicacionTecnica: equipoRuta.ubicacion_tecnica || '',
                        parteId: parte.id,
                        parte: parteNombre,
                        kks: parte.kks || '',
                        vibracion,
                        punto,
                        temperatura,
                        observacion
                    });
                    ej.mediciones[eqIdx] = registros;
                    setEjecucionActiva(idx, ej);
                }

                mostrarToastNotificacion('Medición guardada', `${parteNombre}: ${vibracion} mm/s · ${temperatura} °C`, { type: 'success', duration: 2600 });
                renderRutasView();
                const ejActualizado = getEjecucionActiva(idx);
                const totalRegistros = Array.isArray(ejActualizado?.mediciones?.[eqIdx]) ? ejActualizado.mediciones[eqIdx].length : 1;
                renderContinuar({ parteNombre, vibracion, temperatura, totalRegistros });
            } catch (error) {
                console.warn('[Rutas] No se pudo guardar medición:', error);
                mostrarError(error?.message || 'No se pudo guardar la medición.');
                btn.disabled = false;
                btn.innerHTML = original;
            }
        });
        setTimeout(() => body.querySelector('#ruta-med-vibracion')?.focus(), 0);
    };

    renderPregunta();
};
window.rutasVolver = function() {
    vistaRutasEstado.rutaActivaIdx = null;
    renderRutasView();
};
window.rutasIniciarEjecucion = function(idx) {
    const r = RUTAS_VIBRACION_SEED[idx];
    if (!r) return;
    const ot = prompt(`Iniciar ejecución de:\n${r.nombre}\n\nIngresa el número de OT (Orden de Trabajo):`, '');
    if (ot === null) return; // cancelado
    const otTrim = String(ot).trim();
    if (!otTrim) {
        alert('El número de OT es obligatorio para iniciar la ejecución.');
        return;
    }
    setEjecucionActiva(idx, {
        ot: otTrim,
        fechaInicio: new Date().toISOString().slice(0, 10),
        equiposCompletados: [],
        observaciones: {}
    });
    renderRutasView();
};
window.rutasToggleEquipo = function(idx, eqIdx, checked) {
    const ej = getEjecucionActiva(idx);
    if (!ej) return;
    const set = new Set(ej.equiposCompletados || []);
    const yaEstabaListo = set.has(eqIdx);
    if (checked) set.add(eqIdx); else set.delete(eqIdx);
    ej.equiposCompletados = [...set];
    setEjecucionActiva(idx, ej);
    renderRutasView();
    if (checked && !yaEstabaListo) {
        setTimeout(() => window.rutasAbrirCapturaEquipo?.(idx, eqIdx), 0);
    }
};
window.rutasSetObservacion = function(idx, eqIdx, valor) {
    const ej = getEjecucionActiva(idx);
    if (!ej) return;
    ej.observaciones = ej.observaciones || {};
    if (valor) ej.observaciones[eqIdx] = valor;
    else delete ej.observaciones[eqIdx];
    setEjecucionActiva(idx, ej);
    // No re-render para no perder el foco del input
};
window.rutasCerrarEjecucion = function(idx) {
    const r = RUTAS_VIBRACION_SEED[idx];
    const ej = getEjecucionActiva(idx);
    if (!ej || !r) return;
    if (!confirm(`¿Cerrar la ruta "${r.nombre}"?\n\nEsto archivará la ejecución actual (OT ${ej.ot}). Podrás iniciar una nueva.`)) return;
    // Guardar al historial local (simple: appendear a "planify_rutas_historial")
    try {
        const histRaw = localStorage.getItem('planify_rutas_historial');
        const hist = histRaw ? JSON.parse(histRaw) : [];
        hist.push({
            rutaIdx: idx,
            rutaNombre: r.nombre,
            ot: ej.ot,
            fechaInicio: ej.fechaInicio,
            fechaCierre: new Date().toISOString().slice(0, 10),
            totalEquipos: r.equipos.length,
            completados: ej.equiposCompletados.length,
            observaciones: ej.observaciones || {}
        });
        localStorage.setItem('planify_rutas_historial', JSON.stringify(hist));
    } catch (e) { /* noop */ }
    setEjecucionActiva(idx, null);
    renderRutasView();
};
window.rutasCancelarEjecucion = function(idx) {
    if (!confirm('¿Cancelar la ejecución actual?\nSe perderá el avance registrado.')) return;
    setEjecucionActiva(idx, null);
    renderRutasView();
};
