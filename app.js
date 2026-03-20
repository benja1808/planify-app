// Configuración de Supabase
const supabaseUrl = 'https://fygvulgffhxrimaeyoep.supabase.co';
const supabaseKey = 'sb_publishable_YOksHoWnkBBt74lnKFqc8g_XyP3EyQF'; // Clave Anon Key de Supabase
const supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);

// ── Helper de escritura offline-safe ────────────────────────────────────────
// Mapea tabla Supabase → store de localDB
function _storeLocal(tabla) {
    const map = {
        tareas: 'tareas', trabajadores: 'trabajadores', equipos: 'equipos',
        historial_tareas: 'historial', tareas_historial: 'historial',
        mediciones: 'mediciones', historial_mediciones: 'mediciones'
    };
    return map[tabla] || null;
}

const _db = {
    async insert(tabla, payload) {
        const sn = _storeLocal(tabla);
        if (window.localDB && sn) await window.localDB[sn].upsert(payload).catch(() => {});
        if (navigator.onLine) {
            const { data, error } = await supabaseClient.from(tabla).insert([payload]).select().single();
            if (error) {
                console.warn(`[_db] INSERT ${tabla} online falló, encolando:`, error.message);
                await window.syncQueue?.add(tabla, 'INSERT', payload);
                return { data: payload, error: null };
            }
            if (window.localDB && sn && data) await window.localDB[sn].upsert(data).catch(() => {});
            return { data, error: null };
        }
        await window.syncQueue?.add(tabla, 'INSERT', payload);
        return { data: payload, error: null };
    },
    async update(tabla, id, data) {
        const sn = _storeLocal(tabla);
        if (window.localDB && sn) {
            const existing = await window.localDB[sn].get(id).catch(() => null);
            if (existing) await window.localDB[sn].upsert({ ...existing, ...data }).catch(() => {});
        }
        if (navigator.onLine) {
            const { error } = await supabaseClient.from(tabla).update(data).eq('id', id);
            if (error) await window.syncQueue?.add(tabla, 'UPDATE', { id, data });
        } else {
            await window.syncQueue?.add(tabla, 'UPDATE', { id, data });
        }
    },
    async delete(tabla, id) {
        const sn = _storeLocal(tabla);
        if (window.localDB && sn) await window.localDB[sn].delete(id).catch(() => {});
        if (navigator.onLine) {
            const { error } = await supabaseClient.from(tabla).delete().eq('id', id);
            if (error) await window.syncQueue?.add(tabla, 'DELETE', { id });
        } else {
            await window.syncQueue?.add(tabla, 'DELETE', { id });
        }
    }
};

// Estado de la aplicación
let estado = {
    trabajadores: [],
    tareas: [],
    historialTareas: [],
    historialMediciones: [],
    equipos: [],
    usuarioActual: 'visita', // 'visita', 'admin', 'trabajador'
    trabajadorLogueado: null  // objeto trabajador cuando rol === 'trabajador'
};

let vistaActual = 'checkin'; // 'checkin', 'dashboard', 'trabajadores', 'historial', 'semanal', 'perfil'

// Habilidades / tipos de trabajo (deben coincidir exactamente con las habilidades en la BD)
const tipicosTrabajos = [
    "Medición de vibraciones",
    "Termografía",
    "Lubricación",
    "Cambios de aceite",
    "Medición de espesores",
    "Medición de dureza",
    "END (Tintas penetrantes)",
    "Inspección visual",
    "OTRO"
];

const ubicacionesDisponibles = [
    "Unidad 1",
    "Unidad 2",
    "Unidad 3",
    "Unidad 4",
    "Unidad 5",
    "TG3",
    "TG4",
    "TG5",
    "Pta.Agua",
    "PUERTO",
    "LLENADO DE SILO",
    "Retrofit",
    "Comunes"
];

// Compatibilidad de nombres de tablas entre distintas versiones del esquema.
const tablasDb = {
    historial: 'historial_tareas',
    mediciones: 'mediciones'
};

function esErrorTablaNoExiste(error) {
    if (!error) return false;
    const msg = String(error.message || error.details || '').toLowerCase();
    return (
        error.code === '42P01'    || // postgres: relation does not exist
        error.code === 'PGRST200' || // postgrest: relation not in schema cache
        error.code === 'PGRST205' || // postgrest: table/view missing
        error.status === 404 ||
        error.status === 400 ||      // PostgREST 400 también puede indicar tabla inexistente
        msg.includes('does not exist') ||
        msg.includes('not found') ||
        msg.includes('could not find') ||
        msg.includes('schema cache')
    );
}

async function resolverTabla(candidatas) {
    for (const nombre of candidatas) {
        const { error } = await supabaseClient.from(nombre).select('*').limit(1);
        if (!error) return nombre;
        if (!esErrorTablaNoExiste(error)) throw error;
    }
    return null;
}

// --- FUNCIONES DE PERSISTENCIA (SUPABASE) ---

async function inicializarDatos() {
    // Inicializar IndexedDB y mostrar estado de conexión
    if (window.localDB) await window.localDB.init();
    if (window.syncQueue) window.syncQueue.actualizar();

    try {
        console.log('Cargando datos desde Supabase...');

        const _timeout = ms => new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Timeout de conexión')), ms)
        );

        // Cargar datos principales en paralelo (timeout 8s)
        const [
            { data: trabajadores, error: errT },
            { data: tareas,       error: errTr },
            { data: equipos,      error: errEq }
        ] = await Promise.race([
            Promise.all([
                supabaseClient.from('trabajadores').select('*'),
                supabaseClient.from('tareas').select('*'),
                supabaseClient.from('equipos').select('*')
            ]),
            _timeout(8000)
        ]);
        if (errT)  throw errT;
        if (errTr) throw errTr;
        if (errEq) throw errEq;

        estado.trabajadores = trabajadores || [];
        estado.tareas = (tareas || []).map(t => ({
            id: t.id, tipo: t.tipo,
            liderId: t.lider_id, liderNombre: t.lider_nombre,
            ayudantesIds: t.ayudantes_ids || [], ayudantesNombres: t.ayudantes_nombres || [],
            estadoTarea: t.estado_tarea, otNumero: t.ot_numero,
            horaAsignacion: t.hora_asignacion,
            fechaAsignacion: t.created_at || null,
            estadoEjecucion: t.estado_ejecucion || 'activo',
            fechaExpiracion: t.fecha_expiracion || null
        }));
        estado.equipos = equipos || [];

        // Resolver tablas opcionales en paralelo
        const [tablaMediciones, tablaHistorial] = await Promise.all([
            resolverTabla(['mediciones', 'historial_mediciones']),
            resolverTabla(['historial_tareas', 'tareas_historial'])
        ]);
        if (tablaMediciones) tablasDb.mediciones = tablaMediciones;
        if (tablaHistorial)  tablasDb.historial  = tablaHistorial;

        // Cargar historial en paralelo, limitando a 200 registros más recientes
        const [medResult, histResult] = await Promise.all([
            tablaMediciones
                ? supabaseClient.from(tablasDb.mediciones).select('*').order('fecha', { ascending: false }).limit(200)
                : Promise.resolve({ data: [], error: null }),
            tablaHistorial
                ? supabaseClient.from(tablasDb.historial).select('*').order('created_at', { ascending: false }).limit(200)
                : Promise.resolve({ data: [], error: null })
        ]);
        estado.historialMediciones = medResult.data  || [];
        estado.historialTareas     = histResult.data || [];

        console.log('Datos inicializados correctamente.');

        // Persistir datos en localDB para uso offline futuro
        if (window.localDB) {
            window.localDB.trabajadores.bulk(estado.trabajadores).catch(() => {});
            window.localDB.tareas.bulk(estado.tareas).catch(() => {});
            window.localDB.equipos.bulk(estado.equipos).catch(() => {});
            if (estado.historialTareas.length)    window.localDB.historial.bulk(estado.historialTareas).catch(() => {});
            if (estado.historialMediciones.length) window.localDB.mediciones.bulk(estado.historialMediciones).catch(() => {});
        }

        // Reset automático del check-in pasadas las 20:00
        await resetCheckInSiNecesario();

        // Suscribirse a cambios en tiempo real
        configurarRealtime();

        renderizarVistaActual();
    } catch (error) {
        console.error('Error al inicializar datos:', error);

        // Sin conexión → intentar cargar desde localDB
        if (window.localDB) {
            console.log('[offline] Cargando datos desde IndexedDB...');
            try {
                const [trabajadores, tareas, equipos, historial, mediciones] = await Promise.all([
                    window.localDB.trabajadores.getAll(),
                    window.localDB.tareas.getAll(),
                    window.localDB.equipos.getAll(),
                    window.localDB.historial.getAll(),
                    window.localDB.mediciones.getAll(),
                ]);
                estado.trabajadores       = trabajadores || [];
                estado.tareas             = (tareas || []).map(t => ({
                    id: t.id, tipo: t.tipo,
                    liderId: t.lider_id || t.liderId, liderNombre: t.lider_nombre || t.liderNombre,
                    ayudantesIds: t.ayudantes_ids || t.ayudantesIds || [],
                    ayudantesNombres: t.ayudantes_nombres || t.ayudantesNombres || [],
                    estadoTarea: t.estado_tarea || t.estadoTarea, otNumero: t.ot_numero || t.otNumero,
                    horaAsignacion: t.hora_asignacion || t.horaAsignacion,
                    fechaAsignacion: t.created_at || t.fechaAsignacion || null,
                    estadoEjecucion: t.estado_ejecucion || t.estadoEjecucion || 'activo',
                    fechaExpiracion: t.fecha_expiracion || t.fechaExpiracion || null
                }));
                estado.equipos            = equipos    || [];
                estado.historialTareas    = historial  || [];
                estado.historialMediciones = mediciones || [];
                console.log('[offline] Datos locales cargados correctamente.');
                if (window.syncQueue) window.syncQueue.actualizar();
                window.syncQueue?.procesar();
                renderizarVistaActual();
                return;
            } catch (localErr) {
                console.error('[offline] Error cargando datos locales:', localErr);
            }
        }
        alert('Hubo un error al conectar con la base de datos. Se usarán datos de respaldo.');
    }
}

// Resetea todos los check-in si estamos pasadas las 20:00 y no se ha reseteado hoy
async function resetCheckInSiNecesario() {
    const ahora = new Date();
    if (ahora.getHours() < 20) return;

    const hoy = ahora.toDateString();
    const ultimoReset = localStorage.getItem('ultimo_reset_checkin');
    if (ultimoReset === hoy) return;
    if (!navigator.onLine) return;

    console.log('Reseteando check-in automático (pasadas las 20:00)...');
    const { error } = await supabaseClient
        .from('trabajadores')
        .update({ disponible: false, ocupado: false })
        .neq('id', '00000000-0000-0000-0000-000000000000');

    if (!error) {
        localStorage.setItem('ultimo_reset_checkin', hoy);
        estado.trabajadores = estado.trabajadores.map(t => ({ ...t, disponible: false, ocupado: false }));
        console.log('Check-in reseteado correctamente.');
    }
}

function configurarRealtime() {
    // Debounce: agrupa múltiples eventos seguidos en un solo re-render
    let realtimeTimer = null;
    let pendingTareas = false;
    let pendingTrabajadores = false;

    async function flushRealtime() {
        const fetches = [];
        if (pendingTareas) fetches.push(
            supabaseClient.from('tareas').select('*').then(({ data }) => {
                estado.tareas = (data || []).map(t => ({
                    id: t.id, tipo: t.tipo,
                    liderId: t.lider_id, liderNombre: t.lider_nombre,
                    ayudantesIds: t.ayudantes_ids || [], ayudantesNombres: t.ayudantes_nombres || [],
                    estadoTarea: t.estado_tarea, otNumero: t.ot_numero,
                    horaAsignacion: t.hora_asignacion,
                    fechaAsignacion: t.created_at || null,
                    estadoEjecucion: t.estado_ejecucion || 'activo'
                }));
            })
        );
        if (pendingTrabajadores) fetches.push(
            supabaseClient.from('trabajadores').select('*').then(({ data }) => {
                estado.trabajadores = data || [];
            })
        );
        pendingTareas = false;
        pendingTrabajadores = false;
        await Promise.all(fetches);
        renderizarVistaActual();
    }

    function scheduleFlush() {
        clearTimeout(realtimeTimer);
        realtimeTimer = setTimeout(flushRealtime, 300);
    }

    supabaseClient
        .channel('schema-db-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tareas' }, () => {
            pendingTareas = true;
            scheduleFlush();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'trabajadores' }, () => {
            pendingTrabajadores = true;
            scheduleFlush();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'equipos' }, async () => {
            const { data: equipos } = await supabaseClient.from('equipos').select('*');
            estado.equipos = equipos || [];
        })
        .subscribe();
}

async function updateTrabajadorDisponibilidad(id, disponible) {
    await _db.update('trabajadores', id, { disponible, ocupado: false });
}

async function asignarTarea(tipo, liderId, ayudantesIds, estadoTarea = 'en_curso', otNumero = null, estadoEjecucion = 'activo', fechaExpiracion = null) {
    const lider = estado.trabajadores.find(t => t.id === liderId);
    const ayudantesNombres = ayudantesIds.map(id => {
        const t = estado.trabajadores.find(x => x.id === id);
        return t ? t.nombre : 'Desconocido';
    });

    // UUID generado en cliente: funciona igual online y offline
    const tareaId = crypto.randomUUID();
    const hora = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

    // Solo incluir columnas opcionales si tienen valor real (evita errores de columna inexistente)
    const nuevaTarea = {
        id: tareaId,
        tipo,
        lider_id: liderId || null,
        lider_nombre: lider ? lider.nombre : '',
        ayudantes_ids: ayudantesIds,
        ayudantes_nombres: ayudantesNombres,
        estado_tarea: estadoTarea,
        ot_numero: otNumero || null,
        hora_asignacion: hora
    };
    if (estadoEjecucion && estadoEjecucion !== 'activo') nuevaTarea.estado_ejecucion = estadoEjecucion;
    if (fechaExpiracion) nuevaTarea.fecha_expiracion = fechaExpiracion;

    // Optimistic update: actualizar UI inmediatamente
    const tareaLocal = {
        id: tareaId, tipo, liderId,
        liderNombre: lider ? lider.nombre : '',
        ayudantesIds, ayudantesNombres, estadoTarea, otNumero,
        horaAsignacion: hora,
        fechaAsignacion: new Date().toISOString(),
        estadoEjecucion: estadoEjecucion || 'activo',
        fechaExpiracion: fechaExpiracion || null
    };
    estado.tareas.push(tareaLocal);
    // Solo los ayudantes se bloquean — el líder puede estar en múltiples tareas
    if (estadoTarea === 'en_curso' && (estadoEjecucion === 'activo' || !estadoEjecucion)) {
        estado.trabajadores = estado.trabajadores.map(w =>
            ayudantesIds.includes(w.id) ? { ...w, ocupado: true } : w
        );
    }
    renderizarVistaActual();

    // Persistir (online → Supabase, offline → cola)
    await _db.insert('tareas', nuevaTarea);
    if (estadoTarea === 'en_curso' && ayudantesIds.length > 0) {
        await Promise.all(ayudantesIds.map(aid => _db.update('trabajadores', aid, { ocupado: true })));
    }
}

async function eliminarTarea(id) {
    if (!confirm('¿Eliminar este trabajo?')) return;
    const tarea = estado.tareas.find(t => t.id === id);

    // Optimistic: quitar del estado y liberar trabajadores inmediatamente
    estado.tareas = estado.tareas.filter(t => t.id !== id);
    if (tarea) {
        const idsALiberar = [tarea.liderId, ...(tarea.ayudantesIds || [])].filter(Boolean);
        estado.trabajadores = estado.trabajadores.map(w =>
            idsALiberar.includes(w.id) ? { ...w, ocupado: false } : w
        );
    }
    renderizarVistaActual();

    // Persistir (offline-safe)
    await _db.delete('tareas', id);
    if (tarea) {
        const idsALiberar = [tarea.liderId, ...(tarea.ayudantesIds || [])].filter(Boolean);
        await Promise.all(idsALiberar.map(wid => _db.update('trabajadores', wid, { ocupado: false })));
    }
}

async function eliminarTodasLasTareas() {
    if (!confirm("¿ESTÁS SEGURO? Esto borrará todos los trabajos en curso y programados de forma permanente.")) return;
    if (!navigator.onLine) { alert('Se requiere conexión a internet para esta acción.'); return; }
    
    // Liberar a todos los trabajadores antes de borrar
    await supabaseClient.from('trabajadores').update({ ocupado: false }).neq('id', '00000000-0000-0000-0000-000000000000');
    
    const { error } = await supabaseClient.from('tareas').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) alert("Error: " + error.message);
}

function completarTarea(id, liderId, ayudantesIdsStr) {
    const tarea = estado.tareas.find(t => t.id === id);
    if (!tarea) return;

    const modal = document.getElementById('modal-finalizar-tarea');
    if (!modal) {
        completarTareaConPrompts(id, liderId, ayudantesIdsStr);
        return;
    }

    document.getElementById('modal-tarea-id').value = id;
    document.getElementById('modal-lider-id').value = liderId;
    document.getElementById('modal-ayudantes-ids').value = ayudantesIdsStr || '';
    document.getElementById('modal-numero-aviso').value = '';
    document.getElementById('modal-hh-trabajo').value = '';
    document.getElementById('modal-acciones').value = '';
    document.getElementById('modal-observaciones').value = '';
    document.getElementById('modal-analisis').value = '';
    document.getElementById('modal-recomendacion-analista').value = '';
    modal.style.display = 'flex';
}

async function completarTareaConPrompts(id, liderId, ayudantesIdsStr) {
    const observaciones = prompt("Ingrese breve reporte/observaciones del trabajo finalizado:");
    const numeroAviso = prompt("Ingrese nÃºmero de Aviso / NotificaciÃ³n SAP (Opcional):");
    const hhTrabajo = prompt("Ingrese Horas Hombre (HH) consumidas:");

    await guardarTareaFinalizada({
        id,
        liderId,
        ayudantesIdsStr,
        accionesRealizadas: observaciones || '',
        observaciones: observaciones || '',
        numeroAviso: numeroAviso || '',
        hhTrabajo: hhTrabajo || '',
        analisisTecnico: '',
        recomendacionAnalista: ''
    });
}

async function guardarTareaFinalizada({
    id,
    liderId,
    ayudantesIdsStr,
    accionesRealizadas,
    observaciones,
    numeroAviso,
    hhTrabajo,
    analisisTecnico,
    recomendacionAnalista
}) {
    const tarea = estado.tareas.find(t => t.id === id);
    if (!tarea) return;

    const ayudantesIds = ayudantesIdsStr ? ayudantesIdsStr.split(',').filter(Boolean) : [];
    const histId = crypto.randomUUID();
    const registroHistorial = {
        id: histId,
        tipo: tarea.tipo,
        lider_nombre: tarea.liderNombre,
        ayudantes_nombres: tarea.ayudantesNombres,
        hora_asignacion: tarea.horaAsignacion,
        hora_termino: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}),
        acciones_realizadas: accionesRealizadas || '',
        observaciones: observaciones || '',
        numero_aviso: numeroAviso || '',
        hh_trabajo: hhTrabajo || '',
        ot_numero: tarea.otNumero,
        analisis: analisisTecnico || '',
        recomendacion_analista: recomendacionAnalista || '',
        created_at: new Date().toISOString()
    };

    // Optimistic update: actualizar UI inmediatamente
    const idsALiberar = [liderId, ...ayudantesIds].filter(Boolean);
    estado.tareas = estado.tareas.filter(t => t.id !== id);
    estado.trabajadores = estado.trabajadores.map(w =>
        idsALiberar.includes(w.id) ? { ...w, ocupado: false, disponible: true } : w
    );
    estado.historialTareas = [registroHistorial, ...estado.historialTareas];
    renderizarVistaActual();

    // Persistir tareas y trabajadores (offline-safe)
    await Promise.all([
        _db.delete('tareas', id),
        ...idsALiberar.map(wid => _db.update('trabajadores', wid, { ocupado: false, disponible: true }))
    ]);

    // Historial: guardar local siempre; online con fallback de columnas opcionales
    if (window.localDB) await window.localDB.historial.upsert(registroHistorial).catch(() => {});
    if (navigator.onLine) {
        let { error: errH } = await supabaseClient.from(tablasDb.historial).insert([registroHistorial]);
        if (errH) {
            // Reintentar sin columnas opcionales (compatibilidad de esquema)
            const base = {
                id: histId,
                tipo: registroHistorial.tipo,
                lider_nombre: registroHistorial.lider_nombre,
                ayudantes_nombres: registroHistorial.ayudantes_nombres,
                hora_asignacion: registroHistorial.hora_asignacion,
                hora_termino: registroHistorial.hora_termino,
                ot_numero: registroHistorial.ot_numero,
                numero_aviso: registroHistorial.numero_aviso,
                hh_trabajo: registroHistorial.hh_trabajo
            };
            ({ error: errH } = await supabaseClient.from(tablasDb.historial).insert([base]));
        }
        if (errH) await window.syncQueue?.add(tablasDb.historial, 'INSERT', registroHistorial);
    } else {
        await window.syncQueue?.add(tablasDb.historial, 'INSERT', registroHistorial);
    }
}

// Exponer a global para los onclick de los botones
window.completarTareaExposed = completarTarea;
window.eliminarTareaExposed = eliminarTarea;
window.eliminarTodasLasTareasExposed = eliminarTodasLasTareas;


// --- COMPONENTES Y VISTAS ---

const mainContent = document.getElementById('main-content');

// COMPONENTE: Vista Check-In
function renderCheckInView() {
    const trabajadoresHoy = estado.trabajadores.filter(t => t.disponible).length;
    
    let html = `
        <div class="checkin-view fade-in">
            <div class="panel text-center" style="max-width: 500px">
                <div style="font-size: 4rem; color: var(--primary-color); margin-bottom: 1rem;">
                    <i class="fa-solid fa-clipboard-check"></i>
                </div>
                <h1 style="margin-bottom: 0.5rem">Check-In Jornada</h1>
                <p style="color:var(--text-muted); margin-bottom: 2rem;">Confirma tu presencia para aparecer en el listado de personal disponible para asignación de tareas hoy.</p>
                
                <div class="form-group">
                    <label>Busca tu nombre:</label>
                    <select id="select-checkin" class="form-control">
                        <option value="">-- Selecciona un trabajador --</option>
                        ${estado.trabajadores
                            .sort((a,b) => a.nombre.localeCompare(b.nombre))
                            .map(t => `<option value="${t.id}" ${t.disponible ? 'disabled' : ''}>${t.nombre} ${t.disponible ? '(Ya Validado)' : ''}</option>`).join('')}
                    </select>
                </div>

                <div style="display:flex; gap:0.75rem; justify-content:center; flex-wrap:wrap;">
                    <button id="btn-validar-presencia" class="btn btn-primary giant-btn" disabled style="flex:1; min-width:200px;">
                        Confirmar Presencia
                    </button>
                    <button id="btn-checkin-todos" class="btn giant-btn" title="Solo para pruebas"
                        style="flex:0; white-space:nowrap; background:#f1f5f9; color:var(--text-muted); border:1px solid var(--border-color); padding:0 1.2rem;">
                        <i class="fa-solid fa-users-gear"></i> Todos
                    </button>
                </div>

                <div style="margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid var(--glass-border);">
                    <p style="font-size: 0.9rem; color: var(--text-muted);">
                        <i class="fa-solid fa-users"></i> Personal validado hoy: <strong>${trabajadoresHoy}</strong>
                    </p>
                </div>
            </div>
        </div>
    `;
    mainContent.innerHTML = html;

    const select = document.getElementById('select-checkin');
    const btn    = document.getElementById('btn-validar-presencia');
    const btnTodos = document.getElementById('btn-checkin-todos');

    select.addEventListener('change', () => {
        btn.disabled = select.value === '';
    });

    btn.addEventListener('click', async () => {
        const id = select.value;
        const nombre = select.options[select.selectedIndex].text;

        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Validando...';
        btn.disabled = true;

        await updateTrabajadorDisponibilidad(id, true);

        estado.trabajadores = estado.trabajadores.map(t =>
            t.id === id ? { ...t, disponible: true } : t
        );

        btn.innerHTML = '<i class="fa-solid fa-circle-check"></i> ¡Presencia Confirmada!';
        btn.style.backgroundColor = 'var(--success-color)';

        setTimeout(() => {
            vistaActual = 'dashboard';
            renderizarVistaActual();
        }, 1000);
    });

    btnTodos.addEventListener('click', async () => {
        const pendientes = estado.trabajadores.filter(t => !t.disponible);
        if (!pendientes.length) return;

        btnTodos.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        btnTodos.disabled = true;

        await Promise.all(pendientes.map(t => updateTrabajadorDisponibilidad(t.id, true)));

        estado.trabajadores = estado.trabajadores.map(t => ({ ...t, disponible: true }));

        btnTodos.innerHTML = '<i class="fa-solid fa-circle-check"></i> ¡Listo!';
        btnTodos.style.background = 'var(--success-color)';
        btnTodos.style.color = 'white';

        setTimeout(() => {
            vistaActual = 'dashboard';
            renderizarVistaActual();
        }, 900);
    });
}

// COMPONENTE: Vista Perfil
function renderPerfilView() {
    const trabajador = estado.trabajadorLogueado;

    // Si no hay trabajador logueado (admin), mostrar selector para ver perfil
    if (!trabajador) {
        function renderAdminPerfil(wId) {
            const todos = estado.trabajadores;
            const w = wId ? todos.find(t => t.id === wId) : null;
            const inicial = w ? w.nombre.charAt(0).toUpperCase() : '';
            const tareasHoy = w ? estado.tareas.filter(t =>
                t.estadoTarea === 'en_curso' &&
                (t.liderId === w.id || (t.ayudantesIds && t.ayudantesIds.includes(w.id)))
            ) : [];
            const tareasSemana = w ? estado.tareas.filter(t =>
                t.estadoTarea === 'programada_semana' &&
                (t.liderId === w.id || (t.ayudantesIds && t.ayudantesIds.includes(w.id)))
            ) : [];

            function cardT(t, color) {
                const esLider = w && t.liderId === w.id;
                return `<div style="border-left:3px solid ${color}; padding:0.7rem 0.9rem; margin-bottom:0.7rem; background:var(--glass-bg); border-radius:0 8px 8px 0;">
                    <div style="font-size:0.88rem; font-weight:600; margin-bottom:0.3rem;">${t.tipo}</div>
                    <div style="display:flex; flex-wrap:wrap; gap:0.5rem; font-size:0.76rem; color:var(--text-muted); align-items:center;">
                        ${t.horaAsignacion ? `<span><i class="fa-regular fa-clock"></i> ${t.horaAsignacion}</span>` : ''}
                        ${t.otNumero ? `<span># ${t.otNumero}</span>` : ''}
                        <span class="badge" style="background:${esLider?'var(--primary-color)':'#64748b'}; color:white; font-size:0.68rem;">${esLider?'Líder':'Apoyo'}</span>
                    </div>
                </div>`;
            }

            const html = `
            <div class="fade-in" style="max-width:900px; margin:0 auto;">
                <!-- Selector -->
                <div class="panel" style="margin-bottom:1.2rem; display:flex; align-items:center; gap:1rem; flex-wrap:wrap;">
                    <label style="font-weight:600; white-space:nowrap;">Ver perfil de:</label>
                    <select id="select-perfil-admin" class="form-control" style="flex:1; min-width:200px;">
                        <option value="">-- Selecciona un trabajador --</option>
                        ${todos.map(t => `<option value="${t.id}" ${t.id===wId?'selected':''}>${t.nombre} — ${t.puesto}</option>`).join('')}
                    </select>
                </div>

                ${w ? `
                <!-- Tarjeta perfil -->
                <div class="panel" style="margin-bottom:1.2rem; display:flex; align-items:center; gap:1.2rem; flex-wrap:wrap;">
                    <div style="width:55px;height:55px;border-radius:50%;background:var(--primary-color);display:flex;align-items:center;justify-content:center;font-size:1.5rem;font-weight:700;color:white;flex-shrink:0;">${inicial}</div>
                    <div style="flex:1;">
                        <h2 style="margin:0;font-size:1.2rem;">${w.nombre}</h2>
                        <p style="margin:0.2rem 0 0 0;color:var(--text-muted);font-size:0.85rem;">${w.puesto}</p>
                    </div>
                    <button id="btn-marcar-salida-admin" class="btn" style="background:#fee2e2;color:#dc2626;border:1px solid #fecaca;font-size:0.88rem;white-space:nowrap;">
                        <i class="fa-solid fa-door-open"></i> Marcar Salida
                    </button>
                </div>

                <!-- Dos columnas -->
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.2rem;">
                    <div class="panel">
                        <h3 style="margin:0 0 0.9rem 0;font-size:0.95rem;color:var(--warning-color);display:flex;align-items:center;gap:0.4rem;">
                            <i class="fa-solid fa-person-digging"></i> Para Ejecutar Hoy
                            <span style="margin-left:auto;background:var(--warning-color);color:white;border-radius:999px;font-size:0.7rem;padding:0.1rem 0.5rem;">${tareasHoy.length}</span>
                        </h3>
                        ${tareasHoy.length===0 ? `<p style="color:var(--text-muted);font-size:0.83rem;text-align:center;padding:0.8rem 0;">Sin trabajos hoy.</p>` : tareasHoy.map(t=>cardT(t,'var(--warning-color)')).join('')}
                    </div>
                    <div class="panel">
                        <h3 style="margin:0 0 0.9rem 0;font-size:0.95rem;color:var(--primary-color);display:flex;align-items:center;gap:0.4rem;">
                            <i class="fa-solid fa-calendar-week"></i> Próximos de la Semana
                            <span style="margin-left:auto;background:var(--primary-color);color:white;border-radius:999px;font-size:0.7rem;padding:0.1rem 0.5rem;">${tareasSemana.length}</span>
                        </h3>
                        ${tareasSemana.length===0 ? `<p style="color:var(--text-muted);font-size:0.83rem;text-align:center;padding:0.8rem 0;">Sin trabajos esta semana.</p>` : tareasSemana.map(t=>cardT(t,'var(--primary-color)')).join('')}
                    </div>
                </div>` : `<p style="color:var(--text-muted); text-align:center; padding:2rem 0;">Selecciona un trabajador para ver su perfil.</p>`}
            </div>`;

            mainContent.innerHTML = html;

            document.getElementById('select-perfil-admin').addEventListener('change', (e) => {
                renderAdminPerfil(e.target.value || null);
            });

            if (w) {
                document.getElementById('btn-marcar-salida-admin').addEventListener('click', async () => {
                    if (!confirm(`¿Registrar salida de ${w.nombre}?`)) return;
                    await updateTrabajadorDisponibilidad(w.id, false);
                    estado.trabajadores = estado.trabajadores.map(t => t.id === w.id ? { ...t, disponible: false } : t);
                    renderAdminPerfil(null);
                });
            }
        }
        renderAdminPerfil(null);
        return;
    }

    // Vista de perfil para trabajador logueado
    const tareasDiarias = estado.tareas.filter(t =>
        t.estadoTarea === 'en_curso' &&
        (t.liderId === trabajador.id || (t.ayudantesIds && t.ayudantesIds.includes(trabajador.id)))
    );
    const tareasSemanales = estado.tareas.filter(t =>
        t.estadoTarea === 'programada_semana' &&
        (t.liderId === trabajador.id || (t.ayudantesIds && t.ayudantesIds.includes(trabajador.id)))
    );

    const inicial = trabajador.nombre.charAt(0).toUpperCase();

    function tarjetaTarea(t, accentColor) {
        const esLider = t.liderId === trabajador.id;
        return `
        <div style="border-left:3px solid ${accentColor}; padding:0.8rem 1rem; margin-bottom:0.8rem; background:var(--glass-bg); border-radius:0 8px 8px 0;">
            <div style="font-size:0.9rem; font-weight:600; margin-bottom:0.35rem; line-height:1.3;">${t.tipo}</div>
            <div style="display:flex; flex-wrap:wrap; gap:0.6rem; font-size:0.78rem; color:var(--text-muted); align-items:center;">
                ${t.horaAsignacion ? `<span><i class="fa-regular fa-clock"></i> ${t.horaAsignacion}</span>` : ''}
                ${t.otNumero ? `<span class="badge" style="background:rgba(255,255,255,0.1); color:var(--text-muted); font-size:0.72rem;"># ${t.otNumero}</span>` : ''}
                <span class="badge" style="background:${esLider ? 'var(--primary-color)' : '#64748b'}; color:white; font-size:0.7rem;">
                    ${esLider ? 'Líder' : 'Apoyo'}
                </span>
            </div>
        </div>`;
    }

    const html = `
        <div class="fade-in" style="max-width: 900px; margin: 0 auto;">

            <!-- Tarjeta de perfil -->
            <div class="panel" style="margin-bottom:1.5rem; display:flex; align-items:center; gap:1.2rem; flex-wrap:wrap;">
                <div style="width:60px; height:60px; border-radius:50%; background:var(--primary-color); display:flex; align-items:center; justify-content:center; font-size:1.6rem; font-weight:700; color:white; flex-shrink:0;">
                    ${inicial}
                </div>
                <div style="flex:1; min-width:160px;">
                    <h2 style="margin:0; font-size:1.3rem;">${trabajador.nombre}</h2>
                    <p style="margin:0.2rem 0 0 0; color:var(--text-muted); font-size:0.88rem;">${trabajador.puesto}</p>
                </div>
                <button onclick="window.marcarSalidaTrabajador('${trabajador.id}')" class="btn" style="background:#fee2e2; color:#dc2626; border:1px solid #fecaca; font-size:0.9rem; white-space:nowrap;">
                    <i class="fa-solid fa-door-open"></i> Marcar Salida
                </button>
            </div>

            <!-- Dos columnas: Hoy | Semana -->
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:1.2rem;">

                <!-- Columna izquierda: Trabajos de hoy -->
                <div class="panel">
                    <h3 style="margin:0 0 1rem 0; font-size:1rem; color:var(--warning-color); display:flex; align-items:center; gap:0.5rem;">
                        <i class="fa-solid fa-person-digging"></i> Para Ejecutar Hoy
                        <span style="margin-left:auto; background:var(--warning-color); color:white; border-radius:999px; font-size:0.72rem; padding:0.1rem 0.55rem;">${tareasDiarias.length}</span>
                    </h3>
                    ${tareasDiarias.length === 0
                        ? `<p style="color:var(--text-muted); font-size:0.85rem; text-align:center; padding:1rem 0;">Sin trabajos para hoy.</p>`
                        : tareasDiarias.map(t => tarjetaTarea(t, 'var(--warning-color)')).join('')}
                </div>

                <!-- Columna derecha: Semana -->
                <div class="panel">
                    <h3 style="margin:0 0 1rem 0; font-size:1rem; color:var(--primary-color); display:flex; align-items:center; gap:0.5rem;">
                        <i class="fa-solid fa-calendar-week"></i> Próximos de la Semana
                        <span style="margin-left:auto; background:var(--primary-color); color:white; border-radius:999px; font-size:0.72rem; padding:0.1rem 0.55rem;">${tareasSemanales.length}</span>
                    </h3>
                    ${tareasSemanales.length === 0
                        ? `<p style="color:var(--text-muted); font-size:0.85rem; text-align:center; padding:1rem 0;">Sin trabajos esta semana.</p>`
                        : tareasSemanales.map(t => tarjetaTarea(t, 'var(--primary-color)')).join('')}
                </div>

            </div>
        </div>`;
    mainContent.innerHTML = html;
}

window.marcarSalidaTrabajador = async function(id) {
    if (!confirm('¿Confirmas registrar tu salida?')) return;
    await updateTrabajadorDisponibilidad(id, false);
    estado.usuarioActual = 'visita';
    estado.trabajadorLogueado = null;
    // Volver al login
    document.getElementById('login-overlay').style.display = 'flex';
    document.getElementById('app').style.display = 'none';
    document.querySelector('.role-buttons').style.display = 'block';
    if (document.getElementById('worker-login-container'))
        document.getElementById('worker-login-container').style.display = 'none';
    if (document.getElementById('input-worker-rut')) document.getElementById('input-worker-rut').value = '';
    if (document.getElementById('input-worker-pin')) document.getElementById('input-worker-pin').value = '';
};

// COMPONENTE: Vista Trabajadores (2 tabs: Equipo Disponible | Equipo Trabajando)
function renderTrabajadoresView() {
    const tareasActivas = estado.tareas.filter(t => t.estadoTarea === 'en_curso');
    const disponibles = estado.trabajadores.filter(t => t.disponible && !t.ocupado);
    const ocupados    = estado.trabajadores.filter(t => t.ocupado);
    const ausentes    = estado.trabajadores.filter(t => !t.disponible && !t.ocupado);


    function cardWorker(t, borderColor, badge, badgeBg, opacity = '1', extra = '') {
        return `
        <div class="panel" style="border-left:5px solid ${borderColor}; opacity:${opacity}; padding:1rem;">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:0.5rem;">
                <div>
                    <h3 style="margin:0; font-size:1rem;">${t.nombre}</h3>
                    <p style="font-size:0.8rem; color:var(--text-muted); margin:0.2rem 0 0 0;">${t.puesto}</p>
                </div>
                <span class="badge" style="background:${badgeBg}; color:white; white-space:nowrap;">${badge}</span>
            </div>
            ${extra}
            <div style="display:flex; flex-wrap:wrap; gap:0.3rem; margin-top:0.6rem;">
                ${(t.habilidades||[]).map(h=>`<span class="badge badge-outline" style="font-size:0.68rem;">${h}</span>`).join('')}
            </div>
        </div>`;
    }

    const htmlDisponibles = disponibles.length
        ? disponibles.sort((a,b)=>a.nombre.localeCompare(b.nombre))
            .map(t => cardWorker(t,'var(--success-color)','DISPONIBLE','var(--success-color)')).join('')
        : `<p style="color:var(--text-muted); grid-column:1/-1; padding:1rem;">Sin personal con check-in hoy.</p>`;

    const htmlAusentes = ausentes.length
        ? ausentes.sort((a,b)=>a.nombre.localeCompare(b.nombre))
            .map(t => cardWorker(t,'#94a3b8','AUSENTE','#94a3b8','0.5')).join('')
        : '';

    const htmlOcupados = ocupados.length ? ocupados.map(w =>
        cardWorker(w, 'var(--warning-color)', 'TRABAJANDO', 'var(--warning-color)')
    ).join('') : `<p style="color:var(--text-muted); grid-column:1/-1; padding:1rem;">Nadie trabajando en este momento.</p>`;

    const html = `
        <div class="fade-in">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.5rem;">
                <h1 style="margin:0;"><i class="fa-solid fa-users"></i> Panel de Personal</h1>
                <div style="display:flex; gap:0.8rem;">
                    <span class="badge badge-success" style="padding:0.5rem 1rem;">Disponibles: ${disponibles.length}</span>
                    <span class="badge badge-warning" style="padding:0.5rem 1rem;">Trabajando: ${ocupados.length}</span>
                    <span class="badge" style="background:#64748b; color:white; padding:0.5rem 1rem;">Ausentes: ${ausentes.length}</span>
                </div>
            </div>

            <div style="display:flex; gap:0; margin-bottom:1.5rem; border-bottom:2px solid var(--border-color);">
                <button id="tab-disponible" onclick="window._trabTab('disponible')"
                    style="flex:1; padding:0.75rem 1rem; border:none; background:var(--success-color); color:white; font-size:1rem; font-weight:600; cursor:pointer; border-radius:8px 0 0 0; display:flex; align-items:center; justify-content:center; gap:0.5rem;">
                    <i class="fa-solid fa-circle-check"></i> Equipo Disponible
                    <span style="background:rgba(255,255,255,0.3); border-radius:20px; padding:1px 10px; font-size:0.85rem;">${disponibles.length}</span>
                </button>
                <button id="tab-trabajando" onclick="window._trabTab('trabajando')"
                    style="flex:1; padding:0.75rem 1rem; border:none; background:#f1f5f9; color:var(--text-muted); font-size:1rem; font-weight:600; cursor:pointer; border-radius:0 8px 0 0; display:flex; align-items:center; justify-content:center; gap:0.5rem;">
                    <i class="fa-solid fa-person-digging"></i> Equipo Trabajando
                    <span style="background:rgba(0,0,0,0.1); border-radius:20px; padding:1px 10px; font-size:0.85rem;">${ocupados.length}</span>
                </button>
            </div>

            <div id="panel-disponible" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(270px, 1fr)); gap:1rem;">
                ${htmlDisponibles}
            </div>
            ${htmlAusentes ? `
            <div style="margin-top:2rem; border-top:1px solid var(--border-color); padding-top:1.5rem;">
                <h3 style="margin:0 0 1rem 0; color:var(--text-muted); font-size:0.9rem; text-transform:uppercase; letter-spacing:0.05em;">
                    <i class="fa-solid fa-clock" style="margin-right:0.4rem;"></i>Sin check-in hoy (${ausentes.length})
                </h3>
                <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(270px, 1fr)); gap:1rem;">
                    ${htmlAusentes}
                </div>
            </div>` : ''}
            <div id="panel-trabajando" style="display:none; grid-template-columns:repeat(auto-fill, minmax(270px, 1fr)); gap:1rem;">
                ${htmlOcupados}
            </div>
        </div>
    `;
    mainContent.innerHTML = html;

    window._trabTab = function(tab) {
        const btnD = document.getElementById('tab-disponible');
        const btnT = document.getElementById('tab-trabajando');
        const panD = document.getElementById('panel-disponible');
        const panT = document.getElementById('panel-trabajando');
        if (tab === 'disponible') {
            btnD.style.background = 'var(--success-color)'; btnD.style.color = 'white';
            btnT.style.background = '#f1f5f9'; btnT.style.color = 'var(--text-muted)';
            panD.style.display = 'grid'; panT.style.display = 'none';
        } else {
            btnT.style.background = 'var(--warning-color)'; btnT.style.color = 'white';
            btnD.style.background = '#f1f5f9'; btnD.style.color = 'var(--text-muted)';
            panT.style.display = 'grid'; panD.style.display = 'none';
        }
    };
}

// COMPONENTE: Vista Historial (con dos tabs: Hoy / Histórico)
function renderHistorialView() {
    const hace24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const tareasHoy = estado.historialTareas.filter(t => new Date(t.created_at) >= hace24h);
    const todasTareas = estado.historialTareas;

    const filtrosTipo = [
        { id: 'todos',       label: 'Todos',        icon: 'fa-list' },
        { id: 'vibraciones', label: 'Vibraciones',  icon: 'fa-wave-square' },
        { id: 'termografia', label: 'Termografía',  icon: 'fa-temperature-half' },
        { id: 'lubricacion', label: 'Lubricación',  icon: 'fa-oil-can' },
        { id: 'end',         label: 'END',          icon: 'fa-flask-vial' },
        { id: 'espesores',   label: 'Espesores',    icon: 'fa-ruler' },
        { id: 'dureza',      label: 'Dureza',       icon: 'fa-gem' },
    ];

    function matchFiltro(tipo, filtro) {
        const t = (tipo || '').toLowerCase();
        switch (filtro) {
            case 'todos':       return true;
            case 'vibraciones': return t.includes('vibrac');
            case 'termografia': return t.includes('termog');
            case 'lubricacion': return t.includes('lubric') || t.includes('aceite');
            case 'end':         return t.includes('end') || t.includes('tintas');
            case 'espesores':   return t.includes('espes');
            case 'dureza':      return t.includes('dureza');
            default:            return true;
        }
    }

    function renderTarjeta(tarea) {
        const matchEq = tarea.tipo ? tarea.tipo.match(/\[(.*?)\]/) : null;
        let tituloHtml = tarea.tipo || '';
        if (matchEq) {
            const eqObj = estado.equipos.find(e => e.activo.toLowerCase() === matchEq[1].toLowerCase() || e.kks === matchEq[1]);
            if (eqObj) {
                const resto = tarea.tipo.replace(`[${matchEq[1]}]`, '').trim();
                tituloHtml = `[<a href="#" onclick="event.preventDefault(); window.abrirFichaTecnica('${eqObj.id}')" style="color:var(--primary-color); text-decoration:none;">${matchEq[1]}</a>] ${resto}`;
            }
        }
        return `
        <div class="list-item" data-id="${tarea.id}" data-tipo="${tarea.tipo || ''}" style="border-left: 5px solid var(--success-color); display: block; background: #fff; position:relative;">
            <button onclick="window._borrarHistorial('${tarea.id}')"
                title="Eliminar este registro"
                style="position:absolute; top:0.6rem; right:0.6rem; background:none; border:none; cursor:pointer; color:#cbd5e1; font-size:1rem; padding:0.2rem 0.4rem; border-radius:4px; transition:color 0.2s;"
                onmouseover="this.style.color='#ef4444'" onmouseout="this.style.color='#cbd5e1'">
                <i class="fa-solid fa-trash"></i>
            </button>
            <div style="flex:1; padding-right:2rem;">
                <h4 style="margin:0 0 0.5rem 0; font-size:1.05rem; color:var(--text-main); display:flex; align-items:center; gap:0.6rem; flex-wrap:wrap;">
                    ${tituloHtml}
                    ${tarea.ot_numero ? `<span class="badge" style="background:var(--primary-color); color:white; font-size:0.75rem;"><i class="fa-solid fa-hashtag"></i> ${tarea.ot_numero}</span>` : ''}
                </h4>
                <div style="background: rgba(0,0,0,0.03); padding: 0.7rem; border-radius: 6px; margin-bottom: 0.6rem;">
                    <p style="color:var(--text-main); margin:0 0 0.2rem 0; font-size:0.9rem;">
                        <i class="fa-solid fa-user-tie" style="color:var(--text-muted)"></i> <strong>${tarea.lider_nombre}</strong>
                        ${tarea.ayudantes_nombres && tarea.ayudantes_nombres.length > 0 ? `<span style="color:var(--text-muted); font-size:0.82rem;"> · ${tarea.ayudantes_nombres.join(', ')}</span>` : ''}
                    </p>
                    <div style="border-top: 1px solid #e5e7eb; padding-top: 0.4rem; margin-top: 0.4rem;">
                        <p style="color: var(--text-main); font-size: 0.85rem; margin-bottom: 0.2rem;"><strong>Acciones:</strong> ${tarea.acciones_realizadas || '<em style="opacity:0.5">Sin documentar</em>'}</p>
                        ${tarea.numero_aviso ? `<p style="color: var(--text-main); font-size: 0.82rem; margin-bottom: 0.2rem;"><strong>Aviso:</strong> ${tarea.numero_aviso} &nbsp;|&nbsp; <strong>HH:</strong> ${tarea.hh_trabajo || '-'}</p>` : ''}
                        ${tarea.observaciones ? `<p style="color: var(--text-muted); font-size: 0.82rem; margin-bottom: 0.2rem; font-style:italic;">${tarea.observaciones}</p>` : ''}
                        ${tarea.analisis ? `<p style="color:#4b5563; font-size:0.82rem; margin-bottom:0.2rem;"><strong>Análisis:</strong> ${tarea.analisis}</p>` : ''}
                    </div>
                </div>
                <div style="display:flex; gap:1.2rem; flex-wrap:wrap; align-items:center;">
                    <span style="color:var(--text-muted); font-size:0.78rem;"><i class="fa-regular fa-clock"></i> ${tarea.hora_asignacion}</span>
                    <span style="color:var(--success-color); font-size:0.78rem; font-weight:600;"><i class="fa-solid fa-flag-checkered"></i> ${tarea.hora_termino}</span>
                    <span style="color:var(--text-muted); font-size:0.78rem;"><i class="fa-regular fa-calendar"></i> ${new Date(tarea.created_at).toLocaleDateString('es-CL')}</span>
                    <button onclick="window._generarInformeTarea('${tarea.id}')" style="margin-left:auto; padding:0.3rem 0.85rem; background:linear-gradient(135deg,#6366f1,#4f46e5); color:white; border:none; border-radius:8px; font-size:0.78rem; cursor:pointer; font-weight:600;">
                        <i class="fa-solid fa-file-lines"></i> Informe
                    </button>
                </div>
            </div>
        </div>`;
    }

    function renderLista(tareas) {
        if (tareas.length === 0) return `<p style="text-align:center; padding:3rem; color:var(--text-muted);">Sin registros.</p>`;
        return `<div id="lista-historial-items" style="display:grid; gap:1rem;">${tareas.map(renderTarjeta).join('')}</div>`;
    }

    const tabBtnStyle = (activo) => `padding:0.7rem 1.5rem; border:none; cursor:pointer; font-weight:700; font-size:0.95rem;
        border-bottom: 3px solid ${activo ? 'var(--primary-color)' : 'transparent'};
        color: ${activo ? 'var(--primary-color)' : 'var(--text-muted)'}; background:transparent;`;

    mainContent.innerHTML = `
        <div class="fade-in">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem; flex-wrap:wrap; gap:1rem;">
                <h1 style="margin:0;"><i class="fa-solid fa-clock-rotate-left"></i> Historial</h1>
                <div style="display:flex; gap:0.8rem; flex-wrap:wrap; align-items:center;">
                    <input type="text" id="input-buscar-historial" placeholder="Buscar equipo, supervisor..." class="form-control" style="max-width:220px;">
                    <button id="btn-limpiar-historial" class="btn" style="background:#fee2e2; color:#dc2626; border:1px solid #fca5a5; white-space:nowrap;">
                        <i class="fa-solid fa-trash-can"></i> Limpiar tab
                    </button>
                </div>
            </div>

            <!-- Tabs -->
            <div style="display:flex; border-bottom:2px solid var(--glass-border); margin-bottom:1.2rem;">
                <button id="tab-btn-hoy" style="${tabBtnStyle(true)}">
                    <i class="fa-solid fa-calendar-day"></i> Hoy
                    <span style="background:var(--primary-color); color:white; border-radius:12px; padding:1px 8px; font-size:0.75rem; margin-left:6px;">${tareasHoy.length}</span>
                </button>
                <button id="tab-btn-historico" style="${tabBtnStyle(false)}">
                    <i class="fa-solid fa-book"></i> Histórico
                    <span style="background:#64748b; color:white; border-radius:12px; padding:1px 8px; font-size:0.75rem; margin-left:6px;">${todasTareas.length}</span>
                </button>
            </div>

            <!-- Filtros por tipo -->
            <div style="display:flex; flex-wrap:wrap; gap:0.5rem; margin-bottom:1.2rem;">
                ${filtrosTipo.map(f => `
                    <button class="btn-filtro-hist ${f.id === 'todos' ? 'activo' : ''}" data-filtro="${f.id}"
                        style="padding:0.3rem 0.85rem; border-radius:20px; border:1px solid var(--glass-border);
                               background:${f.id === 'todos' ? 'var(--primary-color)' : 'transparent'};
                               color:${f.id === 'todos' ? 'white' : 'var(--text-muted)'}; cursor:pointer; font-size:0.78rem;">
                        <i class="fa-solid ${f.icon}"></i> ${f.label}
                    </button>`).join('')}
            </div>

            <!-- Contenido del tab activo -->
            <div id="historial-contenido">
                ${renderLista(tareasHoy)}
            </div>
        </div>
    `;

    let tabActivo = 'hoy';
    let filtroActivo = 'todos';

    function tareasActivas() {
        return tabActivo === 'hoy' ? tareasHoy : todasTareas;
    }

    function aplicarFiltros() {
        const query = (document.getElementById('input-buscar-historial')?.value || '').toLowerCase().trim();
        const contenedor = document.getElementById('lista-historial-items');
        if (!contenedor) return;
        contenedor.querySelectorAll('.list-item').forEach(item => {
            const texto = item.textContent.toLowerCase();
            const tipo = item.dataset.tipo || '';
            item.style.display = (!query || texto.includes(query)) && matchFiltro(tipo, filtroActivo) ? 'block' : 'none';
        });
    }

    function switchTab(tab) {
        tabActivo = tab;
        const btnHoy = document.getElementById('tab-btn-hoy');
        const btnHist = document.getElementById('tab-btn-historico');
        if (btnHoy) btnHoy.style.cssText = tabBtnStyle(tab === 'hoy');
        if (btnHist) btnHist.style.cssText = tabBtnStyle(tab === 'historico');
        const contenido = document.getElementById('historial-contenido');
        if (contenido) contenido.innerHTML = renderLista(tareasActivas());
        // Re-aplicar búsqueda/filtro
        aplicarFiltros();
    }

    document.getElementById('tab-btn-hoy')?.addEventListener('click', () => switchTab('hoy'));
    document.getElementById('tab-btn-historico')?.addEventListener('click', () => switchTab('historico'));
    document.getElementById('input-buscar-historial')?.addEventListener('input', aplicarFiltros);

    document.querySelectorAll('.btn-filtro-hist').forEach(btn => {
        btn.addEventListener('click', () => {
            filtroActivo = btn.dataset.filtro;
            document.querySelectorAll('.btn-filtro-hist').forEach(b => {
                b.style.background = 'transparent'; b.style.color = 'var(--text-muted)';
            });
            btn.style.background = 'var(--primary-color)'; btn.style.color = 'white';
            aplicarFiltros();
        });
    });


    document.getElementById('btn-limpiar-historial')?.addEventListener('click', async () => {
        const esHoy = tabActivo === 'hoy';
        const label = esHoy ? 'las últimas 24 horas' : 'TODO el historial';
        if (!confirm(`¿Eliminar TODOS los registros de ${label}? Esta acción no se puede deshacer.`)) return;
        if (!esHoy && !confirm('Segunda confirmación: ¿Borrar TODO el historial permanentemente?')) return;

        const hace24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
        let idsABorrar;
        if (esHoy) {
            idsABorrar = estado.historialTareas.filter(t => new Date(t.created_at) >= hace24h).map(t => t.id);
        } else {
            idsABorrar = estado.historialTareas.map(t => t.id);
        }
        if (idsABorrar.length === 0) { alert('No hay registros que eliminar.'); return; }
        if (!navigator.onLine) { alert('Se requiere conexión a internet para limpiar el historial.'); return; }
        const { error } = await supabaseClient.from(tablasDb.historial).delete().in('id', idsABorrar);
        if (error) { alert('Error al eliminar: ' + error.message); return; }
        estado.historialTareas = estado.historialTareas.filter(t => !idsABorrar.includes(t.id));
        renderHistorialView();
    });

    // Borrar una entrada individual (llamado desde botón trash en tarjeta)
    window._borrarHistorial = async (id) => {
        if (!confirm('¿Eliminar este registro del historial?')) return;
        if (!navigator.onLine) { alert('Se requiere conexión a internet para eliminar del historial.'); return; }
        const { error } = await supabaseClient.from(tablasDb.historial).delete().eq('id', id);
        if (error) { alert('Error al eliminar: ' + error.message); return; }
        estado.historialTareas = estado.historialTareas.filter(t => t.id !== id);
        // Quitar la tarjeta del DOM sin re-renderizar todo
        const card = document.querySelector(`.list-item[data-id="${id}"]`);
        if (card) card.remove();
    };
}

// La API key de Gemini vive en los secretos de Supabase — no se necesita en el frontend.

// ── GENERADOR DE INFORMES CON IA (via Supabase Edge Function → Gemini) ───────
window._generarInformeTarea = function(id) {
    const tarea = estado.historialTareas.find(t => t.id === id);
    if (!tarea) return;
    generarInformeConIA([tarea]);
};

async function generarInformeConIA(tareasParam) {
    const hace24Horas = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const tareasDeHoy = tareasParam || estado.historialTareas.filter(t => new Date(t.created_at) > hace24Horas);

    if (tareasDeHoy.length === 0) {
        alert('No hay tareas registradas en las últimas 24 horas para generar un informe.');
        return;
    }

    // Abrir modal con estado de carga
    abrirModalReporteIA();

    // Construir datos brutos para el prompt
    const fechaActual = new Date().toLocaleDateString('es-CL', { day: '2-digit', month: 'long', year: 'numeric' });
    const totalHH = tareasDeHoy.reduce((s, t) => s + (parseFloat(t.hh_trabajo) || 0), 0);

    let datosCrudos = '';
    tareasDeHoy.forEach((t, i) => {
        datosCrudos += `TRABAJO ${i + 1}: ${t.tipo}${t.ot_numero ? ' | OT: ' + t.ot_numero : ''}\n`;
        datosCrudos += `  Supervisor: ${t.lider_nombre}\n`;
        if (t.ayudantes_nombres?.length) datosCrudos += `  Apoyo: ${t.ayudantes_nombres.join(', ')}\n`;
        datosCrudos += `  Horario: ${t.hora_asignacion || '-'} a ${t.hora_termino || '-'}\n`;
        if (t.numero_aviso) datosCrudos += `  Aviso SAP: ${t.numero_aviso}\n`;
        if (t.hh_trabajo)   datosCrudos += `  HH: ${t.hh_trabajo}\n`;
        datosCrudos += `  Acciones: ${t.acciones_realizadas || 'No indica'}\n`;
        if (t.analisis)      datosCrudos += `  Análisis: ${t.analisis}\n`;
        if (t.observaciones) datosCrudos += `  Observaciones: ${t.observaciones}\n`;
        if (t.recomendacion_analista) datosCrudos += `  Recomendación: ${t.recomendacion_analista}\n`;
        datosCrudos += '\n';
    });

    const systemPrompt = `Eres un ingeniero experto en mantenimiento predictivo industrial con más de 15 años de experiencia en vibroanálisis (ISO 10816/21747), termografía infrarroja, tribología y análisis de fallas en equipos rotativos. Redactas informes técnicos formales de alta calidad para plantas industriales en español.`;

    const userPrompt = `Fecha: ${fechaActual} | Preparado por: Octavio Navarrete | Total HH: ${totalHH > 0 ? totalHH.toFixed(1) : 'N/D'}

REGISTROS DE JORNADA:
${datosCrudos}
Genera un informe técnico de mantenimiento predictivo con EXACTAMENTE estas 4 secciones. Cada sección empieza en su propia línea con el encabezado exacto (número + punto + título en MAYÚSCULAS).

REGLA CRÍTICA DE CONTENIDO:
- Sección 2: SOLO metodología y acciones realizadas. CERO análisis o interpretación.
- Sección 3: TODA la interpretación técnica va aquí. Debe ser la sección más larga y detallada del informe.
- Sección 4: SOLO recomendaciones de intervención concretas y accionables.

1. RESUMEN DE ACTIVIDADES
Lista cada trabajo con horario, supervisor, personal de apoyo y HH consumidas. Luego resumen consolidado: total de trabajos, total HH, avisos SAP, personal participante.

2. DETALLE DE TRABAJOS REALIZADOS
Por cada trabajo describe: (a) descripción de la tarea, (b) metodología e instrumentos usados (normas ISO, equipos de medición), (c) acciones realizadas paso a paso, (d) estado del equipo al finalizar. SIN análisis ni causas raíz.

3. ANÁLISIS TÉCNICO DEL ANALISTA
IMPORTANTE: Esta sección debe caber en UNA SOLA PÁGINA (máximo 350 palabras). Sé preciso y directo.
PROHIBIDO ESTRICTAMENTE: No inventes ni menciones valores numéricos (RPM, mm/s, Hz, dB, °C, etc.), normas ISO específicas, ni ningún dato técnico que no esté explícitamente escrito en los registros de jornada. Si el analista no escribió un número, no lo pongas.
Solo elabora y expande lo que el analista sí escribió. Si escribió "alta vibración axial", explica qué implica ese tipo de falla en este equipo, sus posibles causas mecánicas y su impacto — sin inventar magnitudes. Para cada hallazgo incluye:
- Descripción del problema basada solo en lo registrado
- Mecanismo de falla y causa raíz probable (sin inventar datos)
- Nivel de criticidad: CRÍTICO / ALTO / MEDIO / BAJO con justificación
- Impacto en la confiabilidad del equipo
- Qué parámetros conviene monitorear en la próxima inspección

4. RECOMENDACIONES DEL ANALISTA
Máximo 200 palabras. Empieza DIRECTAMENTE con las recomendaciones, sin frase introductoria ni sub-título de ningún tipo. NO escribas frases como "Las siguientes recomendaciones..." ni ningún encabezado antes del contenido. Lista cada recomendación con: acción concreta, urgencia (INMEDIATO / CORTO PLAZO / PROGRAMADO) y plazo estimado.

Reglas de formato:
- Los encabezados de sección van exactamente como: "1. RESUMEN DE ACTIVIDADES", "2. DETALLE DE TRABAJOS REALIZADOS", "3. ANÁLISIS TÉCNICO DEL ANALISTA", "4. RECOMENDACIONES DEL ANALISTA"
- Usa español técnico formal con nomenclatura ISO
- Elabora extensamente el análisis técnico usando el contexto de los datos registrados`;

    try {
        // Llamar a la Edge Function con fetch directo para evitar problemas de JWT
        const fnUrl = `${supabaseUrl}/functions/v1/generate_report`;
        const res = await fetch(fnUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${supabaseKey}`,
                'apikey': supabaseKey
            },
            body: JSON.stringify({ prompt: systemPrompt + '\n\n' + userPrompt })
        });
        const data = await res.json();
        if (!res.ok || data?.error) throw new Error(data?.error || `HTTP ${res.status}`);

        const textoCompleto = data?.report || '';
        if (!textoCompleto) throw new Error('La IA no devolvió contenido.');

        // Mostrar resultado
        const loadingEl = document.getElementById('reporte-ia-loading');
        if (loadingEl) loadingEl.style.display = 'none';

        const contenedor = document.getElementById('reporte-ia-contenido');
        if (contenedor) contenedor.textContent = textoCompleto;

        // Guardar en estado y habilitar exportación
        estado.ultimoReporteIA = textoCompleto;
        estado.ultimoReporteTareas = tareasDeHoy;
        const btnExp = document.getElementById('btn-exportar-word-ia');
        if (btnExp) {
            btnExp.disabled = false;
            btnExp.innerHTML = '<i class="fa-solid fa-file-word"></i> Exportar a Word (.docx)';
        }

    } catch (error) {
        console.error('Error IA:', error);
        const loadingEl = document.getElementById('reporte-ia-loading');
        if (loadingEl) loadingEl.style.display = 'none';
        const contenedor = document.getElementById('reporte-ia-contenido');
        if (contenedor) contenedor.innerHTML = `<span style="color:#ef4444;"><i class="fa-solid fa-triangle-exclamation"></i> ${error.message}</span>`;
        const btnExp = document.getElementById('btn-exportar-word-ia');
        if (btnExp) {
            btnExp.disabled = false;
            btnExp.innerHTML = '<i class="fa-solid fa-file-word"></i> Exportar (sin IA)';
        }
    }
}

function abrirModalReporteIA() {
    const existing = document.getElementById('modal-reporte-ia');
    if (existing) existing.remove();

    const html = `
        <div id="modal-reporte-ia" class="login-overlay" style="display:flex;">
            <div class="login-panel" style="max-width:860px;width:95%;padding:2rem;border-radius:20px;display:flex;flex-direction:column;max-height:90vh;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem;flex-shrink:0;">
                    <h2 style="margin:0;font-size:1.2rem;">
                        <i class="fa-solid fa-wand-magic-sparkles" style="color:var(--primary-color)"></i> Informe Técnico
                    </h2>
                    <button class="btn btn-outline" onclick="document.getElementById('modal-reporte-ia').remove()">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>

                <div id="reporte-ia-loading" style="display:flex;align-items:center;gap:0.8rem;padding:0.8rem 1rem;background:rgba(255,105,0,0.08);border-radius:10px;margin-bottom:1rem;flex-shrink:0;">
                    <i class="fa-solid fa-spinner fa-spin" style="color:var(--primary-color);font-size:1.1rem;"></i>
                    <div>
                        <div style="font-size:0.9rem;font-weight:600;color:var(--text-main);">Generando informe...</div>
                        <div style="font-size:0.78rem;color:var(--text-muted);">El texto aparecerá a continuación.</div>
                    </div>
                </div>

                <div id="reporte-ia-contenido"
                    style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:1.5rem;flex:1;overflow-y:auto;
                           white-space:pre-wrap;font-family:'Inter',sans-serif;font-size:0.87rem;color:#1e293b;line-height:1.75;
                           min-height:200px;"></div>

                <div style="display:flex;gap:1rem;margin-top:1.5rem;flex-shrink:0;">
                    <button id="btn-exportar-word-ia" class="btn btn-success" style="flex:1;" disabled
                        onclick="window.exportarAWordConPlantilla(event)">
                        <i class="fa-solid fa-spinner fa-spin"></i> Generando informe...
                    </button>
                    <button class="btn btn-outline" onclick="document.getElementById('modal-reporte-ia').remove()">
                        Cerrar
                    </button>
                </div>
            </div>
        </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
}

// LÓGICA DE EXPORTACIÓN A WORD (Usando Docxtemplater)
window.exportarAWordConPlantilla = async function() {
    const btn = event.target.closest('button');
    const originalHtml = btn.innerHTML;
    
    try {
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generando...';
        btn.disabled = true;

        const textoReporte = estado.ultimoReporteIA || "";
        
        // 1. Cargar la plantilla .docx
        const response = await fetch('formato_template.docx');
        if (!response.ok) throw new Error("No se pudo cargar la plantilla formato_template.docx");
        const content = await response.arrayBuffer();

        // 2. Inicializar PizZip y Docxtemplater de forma robusta
        let zip;
        try {
            zip = new window.PizZip(content);
        } catch (e) {
            console.error("Error al inicializar PizZip:", e);
            throw new Error("Error al procesar el archivo ZIP de la plantilla.");
        }

        let doc;
        try {
            doc = new window.docxtemplater(zip, {
                paragraphLoop: true,
                linebreaks: true,
            });
        } catch (e) {
            console.error("Error al inicializar Docxtemplater:", e);
            throw new Error("Error al inicializar el motor de plantillas Word.");
        }

        // 3. Definir los datos para la plantilla
        const fechaActual = new Date().toLocaleDateString('es-CL', { 
            day: '2-digit', month: 'long', year: 'numeric' 
        });

        doc.setData({
            fecha: fechaActual,
            reporte_ia: textoReporte,
            empresa: "APPLUS+",
            area: "Mantenimiento Preventivo / Predictivo"
        });

        // 4. Renderizar el documento
        try {
            doc.render();
        } catch (error) {
            console.error("Error en doc.render():", error);
            throw error;
        }

        // 5. Generar el blob y descargar
        const out = doc.getZip().generate({
            type: "blob",
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        });

        const fileName = `Informe_Mantenimiento_${new Date().toISOString().split('T')[0]}.docx`;
        const url = window.URL.createObjectURL(out);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        btn.innerHTML = '<i class="fa-solid fa-check"></i> ¡Archivo Descargado!';
        setTimeout(() => {
            btn.innerHTML = originalHtml;
            btn.disabled = false;
        }, 2000);

    } catch (error) {
        console.error("Error exportando a Word:", error);
        alert("Error al generar el documento: " + error.message);
        btn.innerHTML = originalHtml;
        btn.disabled = false;
    }
};

// COMPONENTE: Exportación Word con formato completo
window.exportarAWordConPlantilla = async function(trigger) {
    const btn = trigger?.target?.closest('button') || document.querySelector('#modal-reporte-ia .btn.btn-success');
    if (!btn) return;
    const originalHtml = btn.innerHTML;

    try {
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generando...';
        btn.disabled = true;

        // Obtener las tareas del mismo período que se usó en el modal
        const hace24Horas = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const tareasDeHoy = estado.historialTareas.filter(t => new Date(t.created_at) > hace24Horas);

        const response = await fetch('formato.docx');
        if (!response.ok) throw new Error("No se pudo cargar formato.docx");
        const content = await response.arrayBuffer();
        const zip = new window.PizZip(content);

        const fechaActual = new Date().toLocaleDateString('es-CL', { day: '2-digit', month: 'long', year: 'numeric' });

        function escXml(str) {
            return String(str || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
        }

        // Genera un párrafo Word con formato Tahoma 10pt
        function p(texto, { bold = false, color = '000000', sz = '20', indent = false } = {}) {
            const b = bold ? '<w:b/><w:bCs/>' : '';
            const ind = indent ? '<w:pPr><w:ind w:left="360"/></w:pPr>' : '';
            return `<w:p>${ind}<w:r><w:rPr><w:rFonts w:ascii="Tahoma" w:hAnsi="Tahoma" w:cs="Tahoma"/>${b}<w:color w:val="${color}"/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr><w:t xml:space="preserve">${escXml(texto)}</w:t></w:r></w:p>`;
        }
        const pVacio = () => '<w:p/>';
        const saltoHoja = () => `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
        const titulo = (txt) => p(txt, { bold: true, color: 'FF6900', sz: '24' });

        // ── Datos calculados ──────────────────────────────────────────────────
        const totalHH = tareasDeHoy.reduce((s, t) => s + (parseFloat(t.hh_trabajo) || 0), 0);
        const totalAvisos = tareasDeHoy.filter(t => t.numero_aviso).length;
        const nombresUnicos = [...new Set([
            ...tareasDeHoy.map(t => t.lider_nombre),
            ...tareasDeHoy.flatMap(t => t.ayudantes_nombres || [])
        ])].filter(Boolean);

        // ── Cuerpo del documento: usar texto de Claude si está disponible ─────
        let xml = '';
        const textoIA = estado.ultimoReporteIA || '';

        if (textoIA.trim()) {
            // Convertir el texto generado por IA a párrafos Word
            // Las 4 secciones principales que deben iniciar en hoja propia.
            // Solo estas palabras clave en la línea (limpiada de markdown) disparan salto de hoja.
            const SECCIONES_PRINCIPALES = [
                /^resumen\s+de\s+actividades/i,
                /^detalle\s+de\s+trabajos/i,
                /^an[aá]lisis\s+t[eé]cnico/i,
                /^recomendaciones\s+del\s+analista/i,
            ];
            const esSeccionPrincipal = (linea) => {
                // La línea limpia debe COMENZAR con el patrón, no solo contenerlo
                // Esto evita falsos positivos en sub-títulos que contienen esas palabras
                const limpia = linea.replace(/^[\*#\s\d.)]+/, '').trim();
                if (limpia.length > 80) return false; // los títulos de sección son cortos
                return SECCIONES_PRINCIPALES.some(re => re.test(limpia));
            };
            // Sub-encabezados internos: texto en negrita o lista (NO salto de hoja)
            const esSub = (l) => /^(\*\*[^*]{1,80}\*\*|[-•]\s|\d+\.\s+[A-Z])/.test(l.trim());

            let primerSeccion = true;

            for (const linea of textoIA.split('\n')) {
                const l = linea.trimEnd();
                if (!l.trim()) { xml += pVacio(); continue; }

                if (esSeccionPrincipal(l)) {
                    if (!primerSeccion) xml += saltoHoja();
                    primerSeccion = false;
                    const textoTitulo = l.replace(/^[\*#\s]+/, '').replace(/\*\*/g, '').trimEnd();
                    xml += titulo(textoTitulo.toUpperCase());
                } else if (esSub(l)) {
                    const textoLimpio = l.trim().replace(/\*\*/g, '');
                    xml += p(textoLimpio, { bold: true });
                } else if (l.startsWith('  ') || l.startsWith('\t')) {
                    xml += p(l.trim(), { indent: true });
                } else {
                    xml += p(l.replace(/\*\*/g, ''));
                }
            }
        } else {
            // ── Fallback: generar desde datos crudos cuando no hay texto IA ───
            const conAnalisis = tareasDeHoy.filter(t => t.analisis);
            const conRec = tareasDeHoy.filter(t => t.recomendacion_analista);

            // PÁGINA 4: Resumen de Actividades
            xml += titulo('1. Resumen de Actividades');
            xml += p(`Fecha del informe: ${fechaActual}`);
            xml += p(`Total de trabajos ejecutados: ${tareasDeHoy.length}`);
            xml += p(`Total HH registradas: ${totalHH > 0 ? totalHH.toFixed(1) + ' HH' : 'No registradas'}`);
            xml += p(`Avisos SAP generados: ${totalAvisos}`);
            xml += p(`Personal involucrado (${nombresUnicos.length}): ${nombresUnicos.join(', ')}`);
            xml += pVacio();
            xml += p('Distribución de horas por trabajo:', { bold: true });
            tareasDeHoy.forEach((t, i) => {
                const hh = parseFloat(t.hh_trabajo) || 0;
                xml += p(`Trabajo ${i + 1}: ${t.tipo} — ${hh > 0 ? hh.toFixed(1) + ' HH' : 'HH no registradas'}`, { indent: true });
            });
            if (totalHH > 0) xml += p(`TOTAL HH: ${totalHH.toFixed(1)}`, { bold: true, color: '1d4ed8' });

            // PÁGINA 5: Detalle de Trabajos Realizados
            xml += saltoHoja();
            xml += titulo('2. Detalle de Trabajos Realizados');
            tareasDeHoy.forEach((t, i) => {
                xml += p(`Trabajo ${i + 1}: ${t.tipo}${t.ot_numero ? ' | OT: ' + t.ot_numero : ''}`, { bold: true });
                xml += p(`Supervisor: ${t.lider_nombre || '-'}`, { indent: true });
                if (t.ayudantes_nombres?.length) xml += p(`Apoyo: ${t.ayudantes_nombres.join(', ')}`, { indent: true });
                xml += p(`Horario: ${t.hora_asignacion || '-'} a ${t.hora_termino || '-'}`, { indent: true });
                if (t.numero_aviso) xml += p(`Aviso SAP: ${t.numero_aviso}`, { indent: true });
                if (t.hh_trabajo)   xml += p(`HH consumidas: ${t.hh_trabajo}`, { indent: true });
                xml += p(`Acciones realizadas: ${t.acciones_realizadas || 'No documentado'}`, { indent: true });
                xml += pVacio();
            });

            // PÁGINA 6: Análisis Técnico del Analista
            xml += saltoHoja();
            xml += titulo('3. Análisis Técnico del Analista');
            if (conAnalisis.length) {
                conAnalisis.forEach((t, i) => {
                    xml += p(`${i+1}. ${t.tipo}`, { bold: true });
                    xml += p(t.analisis, { indent: true });
                    xml += pVacio();
                });
            } else xml += p('Sin análisis técnico registrado en esta jornada.', { indent: true });

            // PÁGINA 7: Recomendaciones del Analista
            xml += saltoHoja();
            xml += titulo('4. Recomendaciones del Analista');
            if (conRec.length) {
                conRec.forEach((t, i) => {
                    xml += p(`${i+1}. ${t.tipo}`, { bold: true });
                    xml += p(t.recomendacion_analista, { indent: true });
                    xml += pVacio();
                });
            } else xml += p('Sin recomendaciones adicionales para esta jornada.', { indent: true });
        }

        // ── Reemplazos en el XML del documento ───────────────────────────────
        const tocSecciones = [
            '1. Resumen de Actividades',
            '2. Detalle de Trabajos Realizados',
            '3. Análisis Técnico del Analista',
            '4. Recomendaciones del Analista'
        ];

        let docXml = zip.file('word/document.xml').asText();

        // Portada
        docXml = docXml.replace('<w:t>PRESENTATION SUBJECT</w:t>',
            '<w:t>Informe de Mantenimiento Predictivo</w:t>');
        docXml = docXml.replace('<w:t>Date and Place</w:t>',
            `<w:t>${escXml(fechaActual)} – Planta</w:t>`);
        docXml = docXml.replace('<w:t>Company name</w:t>',
            '<w:t>APPLUS+ / Mantenimiento Predictivo</w:t>');
        docXml = docXml.replace('<w:t xml:space="preserve">Prepared for: </w:t>',
            '<w:t xml:space="preserve">Prepared for: Jefatura de Mantenimiento</w:t>');
        // By y Date de la portada
        docXml = docXml.replace(/<w:t[^>]*>By:<\/w:t>/,
            `<w:t>By: Octavio Navarrete - Administrador de contrato y analista</w:t>`);
        docXml = docXml.replace(/<w:t[^>]*>\[Date\]<\/w:t>/,
            `<w:t>${escXml(fechaActual)}</w:t>`);
        docXml = docXml.replace('<w:t>Apply here the Legal Entity information needed</w:t>',
            '<w:t>Informe de actividades de mantenimiento predictivo y lubricación correspondiente a la jornada indicada.</w:t>');

        // Título de sección en el cuerpo
        docXml = docXml.replace('<w:t xml:space="preserve">Title </w:t>',
            '<w:t xml:space="preserve">Actividades de Mantenimiento – Informe de Jornada</w:t>');

        // Índice (TOC): reemplazar cada "Content…." con los nombres de sección reales
        let tocContador = 0;
        docXml = docXml.replace(/<w:t>Content….(<\/w:t>|[^<]*<\/w:t>)/g, (_match) => {
            const sec = tocSecciones[tocContador] || `Sección ${tocContador + 1}`;
            tocContador++;
            return `<w:t>${escXml(sec)}</w:t>`;
        });

        // Cuerpo principal: reemplazar el párrafo completo que contiene "Write here the information"
        // con los párrafos generados. Se usa regex con flag 's' para capturar el <w:p> entero.
        docXml = docXml.replace(
            /<w:p\b[^>]*>(?:(?!<\/w:p>)[\s\S])*?<w:t[^>]*>Write here the information<\/w:t>[\s\S]*?<\/w:p>/,
            xml
        );

        zip.file('word/document.xml', docXml);

        const out = zip.generate({
            type: 'blob',
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        });

        const fileName = `Informe_Mantenimiento_${new Date().toISOString().split('T')[0]}.docx`;
        const url = window.URL.createObjectURL(out);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        btn.innerHTML = '<i class="fa-solid fa-check"></i> Archivo descargado';
        setTimeout(() => { btn.innerHTML = originalHtml; btn.disabled = false; }, 2000);

    } catch (error) {
        console.error('Error exportando a Word:', error);
        alert('Error al generar el documento: ' + error.message);
        btn.innerHTML = originalHtml;
        btn.disabled = false;
    }
};

function renderFichaTecnicaModal() {
    // Si ya existe, no crearlo
    if (document.getElementById('modal-ficha-tecnica')) return;

    const html = `
        <div id="modal-ficha-tecnica" class="login-overlay" style="display:none; align-items: center;">
            <div class="login-panel" style="max-width: 900px; width: 95%; max-height: 90vh; display: flex; flex-direction: column; border-radius: 20px; overflow: hidden;">
                <!-- Header -->
                <div style="background: var(--dark-bg); padding: 1.5rem 2rem; border-bottom: 1px solid var(--glass-border); display: flex; justify-content: space-between; align-items: flex-start;">
                    <div>
                        <h2 id="ficha-equipo-nombre" style="margin: 0; font-size: 1.8rem; letter-spacing: -0.5px;"></h2>
                        <div style="display: flex; gap: 1rem; margin-top: 0.5rem; font-size: 0.9rem; color: var(--text-muted); flex-wrap: wrap;">
                            <span><i class="fa-solid fa-map-pin"></i> <span id="ficha-equipo-ubicacion"></span></span>
                            <span><i class="fa-solid fa-barcode"></i> KKS: <span id="ficha-equipo-kks"></span></span>
                            <span id="ficha-equipo-criticidad" class="badge"></span>
                        </div>
                        <div id="ficha-equipo-extra" style="display: flex; gap: 1rem; margin-top: 0.4rem; font-size: 0.82rem; color: var(--text-muted); flex-wrap: wrap; opacity: 0.8;"></div>
                    </div>
                    <button id="btn-cerrar-ficha" class="btn btn-outline" style="padding: 0.5rem;"><i class="fa-solid fa-xmark fa-xl"></i></button>
                </div>

                <!-- Tabs Navigation -->
                <div style="display: flex; background: #fff; padding: 0 2rem; border-bottom: 1px solid #edf2f7;">
                    <button class="tab-btn active" data-target="tab-vibraciones" style="padding: 1rem 1.5rem; border: none; background: none; font-weight: 600; cursor: pointer; color: var(--text-main); border-bottom: 2px solid var(--primary-color);">Vibraciones</button>
                    <button class="tab-btn" data-target="tab-termografia" style="padding: 1rem 1.5rem; border: none; background: none; font-weight: 600; cursor: pointer; color: var(--text-muted);">Termografía</button>
                    <button class="tab-btn" data-target="tab-lubricacion" style="padding: 1rem 1.5rem; border: none; background: none; font-weight: 600; cursor: pointer; color: var(--text-muted);">Lubricación / Aceite</button>
                    <button class="tab-btn" data-target="tab-documentos" style="padding: 1rem 1.5rem; border: none; background: none; font-weight: 600; cursor: pointer; color: var(--text-muted);">Documentación</button>
                </div>

                <!-- Tabs Content -->
                <div style="flex: 1; overflow-y: auto; padding: 2rem; background: #fdfdfd;">
                    
                    <!-- Tab Vibraciones -->
                    <div id="tab-vibraciones" class="tab-pane">
                        <div style="display: grid; grid-template-columns: 1fr 300px; gap: 2rem;">
                            <div>
                                <h3 style="margin-top:0">Tendencia de Vibración Global</h3>
                                <div style="height: 250px; background: #fff; border: 1px solid #eee; border-radius: 12px; padding: 1rem;">
                                    <canvas id="chart-vibraciones"></canvas>
                                </div>
                            </div>
                            <div>
                                <h3 style="margin-top:0">Últimas Mediciones</h3>
                                <div id="lista-mediciones-vibracion" style="display:flex; flex-direction:column; gap: 0.8rem;"></div>
                            </div>
                        </div>
                    </div>

                    <!-- Tab Termografía -->
                    <div id="tab-termografia" class="tab-pane" style="display:none;">
                        <div style="display: grid; grid-template-columns: 1fr 300px; gap: 2rem;">
                            <div>
                                <h3 style="margin-top:0">Histórico de Temperatura</h3>
                                <div style="height: 250px; background: #fff; border: 1px solid #eee; border-radius: 12px; padding: 1rem;">
                                    <canvas id="chart-termografia"></canvas>
                                </div>
                            </div>
                            <div>
                                <h3 style="margin-top:0">Puntos Calientes</h3>
                                <div id="lista-mediciones-termografia" style="display:flex; flex-direction:column; gap: 0.8rem;"></div>
                            </div>
                        </div>
                    </div>

                    <!-- Tab Lubricación -->
                    <div id="tab-lubricacion" class="tab-pane" style="display:none;">
                        <h3 style="margin-top:0">Registro de Lubricación y Análisis de Aceite</h3>
                        <div id="lista-mediciones-lubricacion" style="display:grid; grid-template-columns: 1fr 1fr; gap: 1rem;"></div>
                    </div>

                    <!-- Tab Documentos -->
                    <div id="tab-documentos" class="tab-pane" style="display:none;">
                        <div class="panel" style="background: rgba(var(--primary-color-rgb), 0.05); border-color: rgba(var(--primary-color-rgb), 0.1);">
                            <p style="text-align:center; padding: 2rem; color: var(--text-muted);">Módulo de gestión documental en desarrollo.<br>Próximamente: Manuales, Planos y Hojas de Datos.</p>
                        </div>
                    </div>

                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', html);
}

// COMPONENTE: Vista Dashboard
function renderDashboardView() {
    // Todos los trabajadores son asignables — los ocupados/sin check-in van automáticamente a cola
    const trabajadoresValidados = estado.trabajadores;
    const tareasDiarias = estado.tareas.filter(t => t.estadoTarea === 'en_curso');
    
    // Validar si el usuario actual es admin
    const isAdmin = estado.usuarioActual === 'admin';
    
    // Panel de Asignación (Oculto para Visita)
    let panelAsignacionHtml = '';
    if (isAdmin) {
        panelAsignacionHtml = `
            <!-- COLUMNA IZQUIERDA: Asignación -->
            <div class="panel">
                <div class="panel-header">
                    <h2><i class="fa-solid fa-clipboard-user"></i> Asignación Diaria</h2>
                </div>
                
                <div class="form-group">
                    <label><i class="fa-solid fa-hashtag"></i> Número de OT (Opcional)</label>
                    <input type="text" id="input-ot-trabajo" class="form-control" placeholder="Ej: OT-1052" style="text-transform: uppercase;">
                </div>

                <div class="form-group">
                    <label><i class="fa-solid fa-map-marker-alt"></i> Ubicación</label>
                    <select id="select-ubicacion" class="form-control">
                        <option value="">-- Seleccione una ubicación --</option>
                        ${[...new Set(estado.equipos.map(e => e.ubicacion).filter(Boolean))].sort((a,b) => a.localeCompare(b)).map(u => `<option value="${u}">${u}</option>`).join('')}
                    </select>
                </div>

                <div class="form-group">
                    <label><i class="fa-solid fa-gears"></i> Equipo / Activo</label>
                    <select id="select-equipo" class="form-control" disabled>
                        <option value="">Seleccione ubicación primero...</option>
                    </select>
                    <button id="btn-agregar-equipo" type="button" class="btn btn-outline" style="width:100%; margin-top:0.5rem; font-size:0.85rem; border-color: rgba(99,102,241,0.5); color: #a5b4fc;">
                        <i class="fa-solid fa-plus"></i> No encuentro el equipo, agregar nuevo
                    </button>
                </div>
                
                <div class="form-group">
                    <label>Tipo de Especialidad / Habilidad Requerida</label>
                    <select id="select-trabajo" class="form-control">
                        <option value="">Seleccione un trabajo...</option>
                        ${tipicosTrabajos.map(t => `<option value="${t}">${t}</option>`).join('')}
                    </select>
                </div>

                <div class="form-group">
                    <label><i class="fa-solid fa-user-tie"></i> Empleado Recomendado (Supervisor)</label>
                    <select id="select-empleado" class="form-control" disabled>
                        <option value="">Seleccione trabajo primero...</option>
                    </select>
                    <small id="empleado-hint" style="display:block; margin-top:0.5rem; color:var(--text-muted)"></small>
                </div>

                <div class="form-group" id="ayudantes-container" style="display: none; padding-top: 1rem; border-top: 1px solid rgba(255,255,255,0.1); margin-top: 1rem;">
                    <label><i class="fa-solid fa-users"></i> Trabajadores (Opcional)</label>
                    <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.5rem;">Cualquier persona disponible hoy. Selecciona los que se necesiten.</p>
                    <div id="lista-ayudantes" style="max-height: 150px; overflow-y: auto; background: rgba(0,0,0,0.2); border-radius: 8px; padding: 0.5rem; border: 1px solid rgba(255,255,255,0.05);">
                        <!-- Los checkboxes se añadirán por javascript -->
                    </div>
                </div>

                <div class="form-group" id="queuing-option-container" style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid rgba(255,255,255,0.1);">
                    <label style="display:flex; align-items:center; cursor:pointer; gap:0.6rem;">
                        <input type="checkbox" id="check-poner-en-cola" style="transform: scale(1.3);">
                        <span><i class="fa-solid fa-clock-rotate-left" style="color:var(--warning-color)"></i> Poner esta tarea <strong>En Cola</strong></span>
                    </label>
                    <p style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.4rem;">Si marcas esto, los trabajadores verán la tarea pero no aparecerán como bloqueados.</p>
                </div>

                <div style="display:flex; gap: 0.8rem; margin-top: 1rem;">
                    <button id="btn-asignar" class="btn btn-primary" style="flex:1;" disabled>
                        <i class="fa-solid fa-paper-plane"></i> Asignar Trabajo
                    </button>
                </div>
            </div>
        `;
    }

    // Template
    let html = `
        <div class="dashboard-grid fade-in" style="${isAdmin ? '' : 'grid-template-columns: 1fr; max-width: 800px; margin: 0 auto;'}">
            
            ${panelAsignacionHtml}

            <!-- COLUMNA DERECHA: Listas -->
            <div class="dashboard-lists">

                <div class="panel">
                    <div class="panel-header" style="justify-content: space-between;">
                        <h2><i class="fa-solid fa-person-digging" style="color:var(--warning-color)"></i> Trabajos Efectivos (${tareasDiarias.length})</h2>
                        ${isAdmin && tareasDiarias.length > 0 ? `
                            <button class="btn btn-outline" style="border-color: var(--danger-color); color: var(--danger-color); font-size: 0.8rem; padding: 0.3rem 0.6rem;" onclick="window.eliminarTodasLasTareasExposed()">
                                <i class="fa-solid fa-trash-can"></i> Vaciar Tablero
                            </button>
                        ` : ''}
                    </div>
                    ${tareasDiarias.length === 0 ? 
                        `<p style="color:var(--text-muted); text-align:center; padding: 2rem 0">No hay trabajos activos en este momento.</p>` : 
                        `<div class="items-list">
                            ${tareasDiarias.map(tarea => `
                                <div class="list-item" style="border-left: 3px solid var(--warning-color)">
                                    <div class="item-info">
                                        <h4>
                                            ${(() => {
                                                // Intentar encontrar el equipo de forma robusta
                                                let eqId = "";
                                                let nombreEqEncontrado = "";
                                                
                                                // Estrategia 1: Buscar si alguna parte entre corchetes coincide con un equipo (Excel)
                                                const matches = tarea.tipo.matchAll(/\[(.*?)\]/g);
                                                for(const match of matches) {
                                                    const candidato = match[1];
                                                    const res = estado.equipos.find(e => e.activo.toLowerCase() === candidato.toLowerCase() || e.kks === candidato);
                                                    if(res) {
                                                        eqId = res.id;
                                                        nombreEqEncontrado = candidato;
                                                        break;
                                                    }
                                                }

                                                // Estrategia 2: Si no funcionó, buscar si el nombre de algún equipo está contenido en el texto (Manual)
                                                if(!eqId) {
                                                    const res = estado.equipos.find(e => tarea.tipo.toLowerCase().includes(e.activo.toLowerCase()));
                                                    if(res) {
                                                        eqId = res.id;
                                                        nombreEqEncontrado = res.activo;
                                                    }
                                                }

                                                if (eqId) {
                                                    const partes = tarea.tipo.split(new RegExp(`(\\[?${nombreEqEncontrado.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]?)`, 'i'));
                                                    return partes.map(p => {
                                                        if(p.toLowerCase() === nombreEqEncontrado.toLowerCase() || p.toLowerCase() === `[${nombreEqEncontrado.toLowerCase()}]`) {
                                                            return `<a href="#" onclick="event.preventDefault(); window.abrirFichaTecnica('${eqId}')" style="color:var(--primary-color); text-decoration:none; cursor:pointer;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">${p}</a>`;
                                                        }
                                                        return p;
                                                    }).join('');
                                                }
                                                return tarea.tipo;
                                            })()}
                                            ${tarea.otNumero ? `<span class="badge" style="background:var(--primary-color); margin-left:0.5rem"><i class="fa-solid fa-hashtag"></i> ${tarea.otNumero}</span>` : ''}
                                        </h4>
                                        <div style="background: #f9fafb; padding: 0.8rem; border-radius: 8px; margin-top: 0.8rem; border: 1px solid #e5e7eb; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem;">
                                            <div>
                                                <p style="color:var(--text-main); margin: 0; font-size: 1.05rem;">
                                                    <i class="fa-solid fa-user-tie" style="color:var(--primary-color)"></i> Líder: <strong>${tarea.liderNombre || 'Sin asignar'}</strong>
                                                </p>
                                                ${tarea.ayudantesNombres && tarea.ayudantesNombres.length > 0 ? `
                                                <p style="color:var(--text-muted); margin: 0.5rem 0 0 0; font-size: 0.9rem;">
                                                    <i class="fa-solid fa-users"></i> Ayudantes: ${tarea.ayudantesNombres.join(', ')}
                                                </p>
                                                ` : ''}
                                            </div>
                                            ${isAdmin && !tarea.liderId ? `
                                            <button onclick="asignarPersonalATarea('${tarea.id}')" style="background:#FF6900; color:#fff; border:none; border-radius:8px; padding:0.4rem 0.9rem; font-size:0.82rem; font-weight:600; cursor:pointer; white-space:nowrap;">
                                                <i class="fa-solid fa-user-plus"></i> Asignar personal
                                            </button>` : ''}
                                        </div>
                                        <p style="margin-top: 0.8rem"><i class="fa-regular fa-clock"></i> Iniciado: ${tarea.fechaAsignacion ? new Date(tarea.fechaAsignacion).toLocaleString('es-CL', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : tarea.horaAsignacion}</p>
                                    </div>
                                    ${isAdmin ? `
                                    <div style="display:flex; gap:0.5rem; margin-top:1rem; align-items:center;">
                                        <button class="btn btn-outline" style="border-color: var(--danger-color); color: var(--danger-color);" onclick="window.eliminarTareaExposed('${tarea.id}')" title="Eliminar / Cancelar">
                                            <i class="fa-solid fa-trash"></i>
                                        </button>
                                        <button class="btn btn-success" style="flex:1;" onclick="window.completarTareaExposed('${tarea.id}', '${tarea.liderId}', '${tarea.ayudantesIds ? tarea.ayudantesIds.join(',') : ''}')">
                                            <i class="fa-solid fa-check"></i> Terminar
                                        </button>
                                    </div>
                                    ` : ''}
                                </div>
                            `).join('')}
                        </div>`
                    }
                </div>

            </div>
        </div>
    `;
    mainContent.innerHTML = html;

    // --- LOGICA DE FORMULARIO DE ASIGNACIÓN (Solo si existe) ---
    if (isAdmin) {
        const selectUbicacion = document.getElementById('select-ubicacion');
        const selectEquipo = document.getElementById('select-equipo');
        const selectTrabajo = document.getElementById('select-trabajo');
        const selectEmpleado = document.getElementById('select-empleado');
        const hintEmpleado = document.getElementById('empleado-hint');
        const btnAsignar = document.getElementById('btn-asignar');
        const btnAgregarEquipo = document.getElementById('btn-agregar-equipo');
        const inputOt = document.getElementById('input-ot-trabajo');

        // Validación para habilitar el botón de asignar
        function validarFormulario() {
            const ubicacionValid = selectUbicacion.value !== '';
            const equipoValid = selectEquipo.value !== '';
            const empleadoValid = selectEmpleado.value !== '';
            btnAsignar.disabled = !(ubicacionValid && equipoValid && empleadoValid);
        }

        // Actualizar la lista de ayudantes filtrada por habilidad del trabajo seleccionado
        function actualizarAyudantes(liderIdSeleccionado) {
            const container = document.getElementById('ayudantes-container');
            const lista = document.getElementById('lista-ayudantes');
            
            if (!liderIdSeleccionado) {
                container.style.display = 'none';
                lista.innerHTML = '';
                return;
            }

            const trabajoRequerido = selectTrabajo.value;
            // Mostrar todos los validados (excepto el líder seleccionado)
            const elegibles = trabajadoresValidados.filter(t =>
                t.id !== liderIdSeleccionado &&
                (!trabajoRequerido || t.habilidades.includes(trabajoRequerido))
            );

            if (elegibles.length === 0) {
                lista.innerHTML = '<p style="color:var(--text-muted); font-size:0.9rem; text-align:center; margin:0;">No hay personal con esta especialidad.</p>';
            } else {
                lista.innerHTML = elegibles.map(t => {
                    const badge = t.ocupado
                        ? `<small style="color:var(--warning-color); font-weight:600;">[Trabajando→Cola]</small>`
                        : (!t.disponible ? `<small style="color:#94a3b8;">[Sin check-in→Cola]</small>` : '');
                    return `
                    <label style="display: flex; align-items: center; cursor: pointer; padding: 0.4rem; border-bottom: 1px solid rgba(255,255,255,0.05); margin:0;">
                        <input type="checkbox" class="ayudante-checkbox" value="${t.id}" style="margin-right: 0.8rem; transform: scale(1.2);">
                        <span>${t.nombre} ${badge} <small style="color:var(--text-muted)">(${t.puesto})</small></span>
                    </label>`;
                }).join('');
            }
            container.style.display = 'block';

            // Agregar listeners
            document.querySelectorAll('.ayudante-checkbox').forEach(cb => {
                cb.addEventListener('change', verificarNecesidadCola);
            });
            verificarNecesidadCola();
        }

        function verificarNecesidadCola() {
            const checkCola = document.getElementById('check-poner-en-cola');
            if (!checkCola) return;

            const liderId = selectEmpleado.value;
            const ayudantesIds = Array.from(document.querySelectorAll('.ayudante-checkbox:checked')).map(cb => cb.value);
            const todos = [liderId, ...ayudantesIds].filter(Boolean);

            // Si cualquiera está ocupado o sin check-in → forzar cola
            const necesitaCola = todos.some(id => {
                const t = estado.trabajadores.find(x => x.id === id);
                return t && (t.ocupado || !t.disponible);
            });

            if (necesitaCola) {
                checkCola.checked = true;
                checkCola.disabled = true; // no se puede desmarcar si hay ocupados
            } else {
                checkCola.disabled = false;
            }
        }

        // Cascade: Ubicación → cargar equipos de esa ubicación
        selectUbicacion.addEventListener('change', (e) => {
            const ubicacion = e.target.value;
            if (!ubicacion) {
                selectEquipo.innerHTML = '<option value="">Seleccione ubicación primero...</option>';
                selectEquipo.disabled = true;
                validarFormulario();
                return;
            }

            const equiposDeLaUbicacion = estado.equipos.filter(eq => eq.ubicacion === ubicacion);
            selectEquipo.disabled = false;
            selectEquipo.innerHTML = `<option value="">-- Seleccione un equipo --</option>` +
                equiposDeLaUbicacion.map(eq => `<option value="${eq.id}" data-activo="${eq.activo}" data-componente="${eq.componente || ''}" data-kks="${eq.kks || ''}">${eq.activo}${eq.componente ? ' · ' + eq.componente : ''}</option>`).join('');
            validarFormulario();
        });

        selectEquipo.addEventListener('change', validarFormulario);

        selectEmpleado.addEventListener('change', (e) => {
            validarFormulario();
            actualizarAyudantes(e.target.value);
            verificarNecesidadCola();
        });

        selectTrabajo.addEventListener('change', (e) => {
            const trabajoRequerido = e.target.value;
            if (!trabajoRequerido) {
                selectEmpleado.innerHTML = '<option value="">Seleccione trabajo primero...</option>';
                selectEmpleado.disabled = true;
                hintEmpleado.textContent = '';
                actualizarAyudantes('');
                validarFormulario();
                return;
            }

            const aptos = trabajadoresValidados.filter(t => t.habilidades.includes(trabajoRequerido));

            if (aptos.length > 0) {
                selectEmpleado.disabled = false;
                selectEmpleado.innerHTML = `<option value="">-- Elija al Líder / Responsable --</option>` +
                    aptos.map(t => {
                        const sufijo = t.ocupado ? ' ⚠ (Trabajando→Cola)' : (!t.disponible ? ' ○ (Sin check-in→Cola)' : '');
                        return `<option value="${t.id}">${t.nombre}${sufijo}</option>`;
                    }).join('');
                hintEmpleado.innerHTML = `<span style="color:var(--success-color)"><i class="fa-solid fa-circle-check"></i> ${aptos.length} persona(s) capacitada(s). Ocupados o sin check-in irán a cola.</span>`;
                actualizarAyudantes('');
            } else {
                selectEmpleado.disabled = true;
                selectEmpleado.innerHTML = '<option value="">Sin empleados capacitados para este trabajo</option>';
                hintEmpleado.innerHTML = `<span style="color:var(--danger-color)"><i class="fa-solid fa-triangle-exclamation"></i> Nadie tiene esta especialidad.</span>`;
                actualizarAyudantes('');
                validarFormulario();
            }
        });

        // Botón "Agregar nuevo equipo"
        btnAgregarEquipo.addEventListener('click', () => {
            const ubicPreseleccionada = selectUbicacion.value;
            document.getElementById('nuevo-equipo-ubicacion').value = ubicPreseleccionada;
            document.getElementById('modal-nuevo-equipo').style.display = 'flex';
        });

        btnAsignar.addEventListener('click', () => {
            const ubicacion = selectUbicacion.value;
            const trabajo = selectTrabajo.value;
            const liderId = selectEmpleado.value;
            const otNumero = inputOt.value.trim().toUpperCase();
            const equipoId = selectEquipo.value;

            // Buscar el equipo en estado para obtener con seguridad nombre y componente
            const equipoObj = estado.equipos.find(e => e.id === equipoId);
            const activo = equipoObj ? equipoObj.activo : '';
            const componente = equipoObj ? (equipoObj.componente || '') : '';

            const checkboxes = document.querySelectorAll('.ayudante-checkbox:checked');
            const ayudantesIds = Array.from(checkboxes).map(cb => cb.value);

            console.log('[Asignar] ubicacion:', ubicacion, 'equipo:', equipoId, 'trabajo:', trabajo, 'lider:', liderId);

            if (ubicacion && equipoId && liderId) {
                const habilidadParte = trabajo ? ` (${trabajo})` : '';
                const tituloFinal = `[${ubicacion}] ${activo}${componente ? ' - ' + componente : ''}${habilidadParte}`;
                
                const enCola = document.getElementById('check-poner-en-cola').checked;
                const estadoEjecucion = enCola ? 'en_cola' : 'activo';
                
                asignarTarea(tituloFinal, liderId, ayudantesIds, 'en_curso', otNumero, estadoEjecucion);
            } else {
                console.warn('[Asignar] Faltan campos:', { ubicacion, equipoId, liderId });
            }
        });
    }
}

// COMPONENTE: Vista Semanal
function renderSemanalView() {
    // Validar si el usuario actual es admin
    const isAdmin = estado.usuarioActual === 'admin';
    const tareasSemanales = estado.tareas.filter(t => t.estadoTarea === 'programada_semana');
    
    // Panel de Asignación Semanal (Solo para Admin)
    let panelAsignacionHtml = '';
    if (isAdmin) {
        panelAsignacionHtml = `
            <!-- COLUMNA IZQUIERDA: Asignación Semanal -->
            <div style="display: flex; flex-direction: column; gap: 1.5rem;">
                
                <!-- Búsqueda / Carga Rápida de Excel -->
                <div class="panel" style="background: linear-gradient(145deg, rgba(16, 185, 129, 0.15) 0%, rgba(5, 150, 105, 0.1) 100%); border-color: rgba(16, 185, 129, 0.3);">
                    <div class="panel-header">
                        <h2 style="color: #34d399;"><i class="fa-solid fa-file-excel"></i> Importar Plan Semanal</h2>
                    </div>
                    <p style="color:var(--text-muted); font-size: 0.9rem; margin-bottom: 1rem;">
                        Sube tu archivo Excel. El sistema identificará los trabajos de <strong>APPLUS+</strong> y los agregará automáticamente.
                    </p>
                    <input type="file" id="input-excel-semanal" accept=".xlsx, .xls, .csv" style="display:none;" />
                    <button id="btn-trigger-excel" class="btn btn-success" style="width:100%;" onclick="document.getElementById('input-excel-semanal').click()">
                        <i class="fa-solid fa-cloud-arrow-up"></i> Cargar Archivo (.xlsx / .csv)
                    </button>
                    <div id="excel-status" style="margin-top: 0.5rem; font-size: 0.85rem; color: var(--text-muted); text-align:center;"></div>
                </div>

                <!-- Formulario Manual Normal -->
                <div class="panel">
                    <div class="panel-header">
                        <h2><i class="fa-solid fa-calendar-plus" style="color:var(--primary-color)"></i> Planificar Manualmente</h2>
                    </div>
                
                <div class="form-group">
                    <label><i class="fa-solid fa-hashtag"></i> Número de OT (Opcional)</label>
                    <input type="text" id="semanal-ot-trabajo" class="form-control" placeholder="Ej: OT-1052" style="text-transform: uppercase;">
                </div>

                <div class="form-group">
                    <label><i class="fa-solid fa-map-marker-alt"></i> Ubicación</label>
                    <select id="semanal-ubicacion" class="form-control">
                        <option value="">-- Seleccione una ubicación --</option>
                        ${[...new Set(estado.equipos.map(e => e.ubicacion).filter(Boolean))].sort((a,b) => a.localeCompare(b)).map(u => `<option value="${u}">${u}</option>`).join('')}
                    </select>
                </div>

                <div class="form-group">
                    <label><i class="fa-solid fa-gears"></i> Equipo / Activo</label>
                    <select id="semanal-equipo" class="form-control" disabled>
                        <option value="">Seleccione ubicación primero...</option>
                    </select>
                    <button id="semanal-btn-agregar-equipo" type="button" class="btn btn-outline" style="width:100%; margin-top:0.5rem; font-size:0.85rem; border-color: rgba(99,102,241,0.5); color: #a5b4fc;">
                        <i class="fa-solid fa-plus"></i> No encuentro el equipo, agregar nuevo
                    </button>
                </div>

                <div class="form-group">
                    <label>Tipo de Especialidad / Habilidad Requerida</label>
                    <select id="semanal-trabajo" class="form-control">
                        <option value="">Seleccione un trabajo...</option>
                        ${tipicosTrabajos.map(t => `<option value="${t}">${t}</option>`).join('')}
                    </select>
                </div>

                <div class="form-group">
                    <label><i class="fa-solid fa-user-tie"></i> Supervisor</label>
                    <select id="semanal-empleado" class="form-control" disabled>
                        <option value="">Seleccione trabajo primero...</option>
                    </select>
                    <small id="semanal-hint" style="display:block; margin-top:0.5rem; color:var(--text-muted)"></small>
                </div>

                <div class="form-group" id="semanal-ayudantes-container" style="display: none; padding-top: 1rem; border-top: 1px solid rgba(255,255,255,0.1); margin-top: 1rem;">
                    <label><i class="fa-solid fa-users"></i> Trabajadores Asociados</label>
                    <div id="semanal-lista-ayudantes" style="max-height: 150px; overflow-y: auto; background: rgba(0,0,0,0.2); border-radius: 8px; padding: 0.5rem; border: 1px solid rgba(255,255,255,0.05);">
                        <!-- Los checkboxes se añadirán por javascript -->
                    </div>
                </div>

                <div class="form-group">
                    <label><i class="fa-solid fa-calendar-xmark"></i> Fecha de Vencimiento (Opcional)</label>
                    <input type="date" id="semanal-fecha-exp" class="form-control">
                    <small style="color:var(--text-muted); font-size:0.8rem;">Si se indica, el trabajo expirará en esta fecha.</small>
                </div>

                <button id="semanal-btn-asignar" class="btn btn-primary" style="width:100%; margin-top: 1rem;" disabled>
                    <i class="fa-solid fa-calendar-check"></i> Agendar Trabajo
                </button>
            </div>
          </div>
        `;
    }

    // Template principal
    let html = `
        <div class="dashboard-grid fade-in" style="${isAdmin ? '' : 'grid-template-columns: 1fr; max-width: 800px; margin: 0 auto;'}">
            
            ${panelAsignacionHtml}

            <!-- COLUMNA DERECHA: Listado Semanal -->
            <div class="dashboard-lists">
                <div class="panel">
                    <div class="panel-header" style="justify-content: space-between;">
                        <h2><i class="fa-solid fa-calendar-week" style="color:var(--primary-color)"></i> Planificación Semanal (${tareasSemanales.length})</h2>
                        <input type="text" id="input-buscar-semanal" placeholder="Buscar OT, equipo..." class="form-control" style="max-width:200px; font-size:0.8rem;">
                    </div>
                    
                    ${tareasSemanales.length === 0 ? 
                        `<p style="color:var(--text-muted); text-align:center; padding: 2rem 0">No hay trabajos programados para la semana.</p>` : 
                        `<div class="items-list" id="lista-semanal-items">
                            ${tareasSemanales.map(tarea => `
                                <div class="list-item" style="border-left: 3px solid var(--primary-color)">
                                    <div class="item-info">
                                        <h4 style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
                                            ${tarea.tipo}
                                            ${tarea.otNumero ? `<span class="badge" style="background:var(--primary-color); color:white; font-size:0.8rem;"><i class="fa-solid fa-hashtag"></i> ${tarea.otNumero}</span>` : ''}
                                            ${tarea.fechaExpiracion && new Date(tarea.fechaExpiracion) < new Date() ? `<span class="badge" style="background:#ef4444; color:white; font-size:0.8rem;"><i class="fa-solid fa-triangle-exclamation"></i> VENCIDO</span>` : ''}
                                        </h4>
                                        <p style="margin-top:0.5rem;"><i class="fa-solid fa-user-tie" style="color:var(--text-muted)"></i> Supervisor: <strong>${tarea.liderNombre || 'Pendiente por Asignar'}</strong></p>
                                        ${tarea.ayudantesNombres && tarea.ayudantesNombres.length > 0 ? `<p style="font-size:0.85rem; color:var(--text-muted); margin-top:0.2rem;"><i class="fa-solid fa-users"></i> Apoyo: ${tarea.ayudantesNombres.join(', ')}</p>` : ''}
                                        ${tarea.fechaExpiracion ? `<p style="font-size:0.8rem; color:${new Date(tarea.fechaExpiracion)<new Date()?'#ef4444':'var(--text-muted)'}; margin-top:0.2rem;"><i class="fa-solid fa-calendar-xmark"></i> Vence: ${new Date(tarea.fechaExpiracion).toLocaleDateString('es-CL')}</p>` : ''}
                                    </div>
                                    ${isAdmin ? `
                                    <div style="display:flex; gap:0.5rem; margin-top:1rem; flex-wrap:wrap;">
                                        <button class="btn btn-outline" style="border-color: var(--danger-color); color: var(--danger-color); padding: 0.4rem;" onclick="window.eliminarTareaExposed('${tarea.id}')">
                                            <i class="fa-solid fa-trash"></i>
                                        </button>
                                        <button style="background:#FF6900; color:#fff; border:none; border-radius:8px; padding:0.4rem 0.8rem; font-size:0.82rem; font-weight:600; cursor:pointer;" onclick="asignarPersonalATarea('${tarea.id}')">
                                            <i class="fa-solid fa-user-plus"></i> Asignar
                                        </button>
                                        <button class="btn btn-primary" style="flex:1; padding: 0.4rem;" onclick="comenzarTrabajoProgramado('${tarea.id}')">
                                            <i class="fa-solid fa-play"></i> Iniciar Hoy
                                        </button>
                                    </div>
                                    ` : ''}
                                </div>
                            `).join('')}
                        </div>`
                    }
                </div>
            </div>
        </div>
    `;
    mainContent.innerHTML = html;

    // --- LOGICA FORMULARIO SEMANAL ---
    if (isAdmin) {
        const sUbic = document.getElementById('semanal-ubicacion');
        const sEq = document.getElementById('semanal-equipo');
        const sTrab = document.getElementById('semanal-trabajo');
        const sEmpl = document.getElementById('semanal-empleado');
        const sHint = document.getElementById('semanal-hint');
        const sBtnAsig = document.getElementById('semanal-btn-asignar');
        const sInputOt = document.getElementById('semanal-ot-trabajo');
        const sBtnAddEq = document.getElementById('semanal-btn-agregar-equipo');

        function vForm() {
            sBtnAsig.disabled = !(sUbic.value && sEq.value && sEmpl.value);
        }

        sUbic.addEventListener('change', (e) => {
            const u = e.target.value;
            if(!u) { sEq.disabled = true; vForm(); return; }
            sEq.disabled = false;
            const eqs = estado.equipos.filter(eq => eq.ubicacion === u);
            sEq.innerHTML = `<option value="">-- Seleccione equipo --</option>` + eqs.map(eq => `<option value="${eq.id}">${eq.activo}${eq.componente ? ' · ' + eq.componente : ''}</option>`).join('');
            vForm();
        });

        sEq.addEventListener('change', vForm);

        sTrab.addEventListener('change', (e) => {
            const tr = e.target.value;
            if(!tr) { sEmpl.disabled = true; vForm(); return; }
            const aptos = estado.trabajadores.filter(t => t.habilidades.includes(tr));
            sEmpl.disabled = false;
            sEmpl.innerHTML = `<option value="">-- Seleccione supervisor --</option>` + aptos.map(t => `<option value="${t.id}">${t.nombre}</option>`).join('');
            sHint.innerHTML = aptos.length > 0 ? `<span style="color:var(--success-color)">${aptos.length} aptos</span>` : `<span style="color:var(--danger-color)">Sin personal para esta tarea</span>`;
            vForm();
        });

        sEmpl.addEventListener('change', (e) => {
            const lid = e.target.value;
            const cont = document.getElementById('semanal-ayudantes-container');
            const list = document.getElementById('semanal-lista-ayudantes');
            if(!lid) { cont.style.display='none'; vForm(); return; }
            const eleg = estado.trabajadores.filter(t => t.id !== lid);
            list.innerHTML = eleg.map(t => `<label style="display:flex; gap:0.5rem; align-items:center; padding:0.3rem;"><input type="checkbox" class="sem-ay-check" value="${t.id}"> ${t.nombre}</label>`).join('');
            cont.style.display='block';
            vForm();
        });

        sBtnAddEq.addEventListener('click', () => {
            document.getElementById('nuevo-equipo-ubicacion').value = sUbic.value;
            document.getElementById('modal-nuevo-equipo').style.display = 'flex';
        });

        sBtnAsig.addEventListener('click', () => {
             const eqObj = estado.equipos.find(e => e.id === sEq.value);
             const ays = Array.from(document.querySelectorAll('.sem-ay-check:checked')).map(cb => cb.value);
             const tit = `[${sUbic.value}] ${eqObj.activo}${eqObj.componente ? ' - ' + eqObj.componente : ''}${sTrab.value ? ' ('+sTrab.value+')' : ''}`;
             const fechaExp = document.getElementById('semanal-fecha-exp')?.value || null;
             asignarTarea(tit, sEmpl.value, ays, 'programada_semana', sInputOt.value.trim().toUpperCase(), 'activo', fechaExp);
        });

        // Lógica de Carga de Excel (Simplificada para el ejemplo)
        const inputExcel = document.getElementById('input-excel-semanal');
        inputExcel.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if(!file) return;
            
            const status = document.getElementById('excel-status');
            status.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Procesando archivo...';

            const reader = new FileReader();
            reader.onload = async (evt) => {
                try {
                    const data = new Uint8Array(evt.target.result);
                    const workbook = XLSX.read(data, {type: 'array'});
                    const sheet = workbook.Sheets[workbook.SheetNames[0]];
                    // Parsear con letras de columna para filtrar por columna O exacta
                    const jsonRaw = XLSX.utils.sheet_to_json(sheet, { header: 'A' });
                    const json = XLSX.utils.sheet_to_json(sheet);

                    console.log("Excel cargado:", json);

                    // Filtrar solo por columna O (empresa/contratista)
                    // jsonRaw[0] es la fila de cabeceras, jsonRaw[1..] son datos
                    const filasValidas = new Set(
                        jsonRaw.slice(1)
                            .map((row, i) => String(row['O'] || '').toUpperCase().includes('APPLUS') ? i : -1)
                            .filter(i => i >= 0)
                    );
                    const tareasAppus = json.filter((_, i) => filasValidas.has(i));

                    if(tareasAppus.length === 0) {
                        status.innerHTML = '<span style="color:var(--warning-color)">No se encontraron tareas para APPLUS+ en este archivo.</span>';
                        return;
                    }

                    // Construir lista de tareas encontradas para que el usuario las agregue manualmente
                    const tareasExtraidas = tareasAppus.map(row => {
                        const ot  = row['OT'] || row['Orden'] || row['Nro OT'] || '';
                        const desc = row['Descripción'] || row['Texto breve'] || row['Tarea'] || '';
                        const eq  = row['Equipo'] || row['Activo'] || row['Ubicación Técnica'] || '';
                        const tit = `${ot ? '['+ot+'] ' : ''}${eq ? eq + ' - ' : ''}${desc}`;
                        return { ot: String(ot), titulo: tit.trim() };
                    }).filter(t => t.titulo);

                    status.innerHTML = `<span style="color:var(--primary-color);font-weight:600;">${tareasExtraidas.length} tarea(s) encontradas. Agrégalas al plan:</span>`;

                    const lista = document.createElement('div');
                    lista.style.cssText = 'margin-top:1rem; display:flex; flex-direction:column; gap:0.6rem; max-height:300px; overflow-y:auto;';

                    tareasExtraidas.forEach((t, idx) => {
                        const item = document.createElement('div');
                        item.style.cssText = 'display:flex; align-items:flex-start; gap:0.6rem; background:#f9fafb; border:1px solid #e5e7eb; border-radius:8px; padding:0.6rem 0.8rem;';
                        item.innerHTML = `
                            <div style="flex:1; font-size:0.82rem; color:#374151; line-height:1.4;">${t.titulo}</div>
                            <button data-idx="${idx}" style="flex-shrink:0; background:#FF6900; color:white; border:none; border-radius:6px; padding:0.35rem 0.75rem; font-size:0.78rem; font-weight:600; cursor:pointer; white-space:nowrap;">
                                <i class="fa-solid fa-plus"></i> Agregar
                            </button>`;
                        item.querySelector('button').addEventListener('click', async function() {
                            this.disabled = true;
                            this.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
                            await asignarTarea(t.titulo, null, [], 'programada_semana', t.ot);
                            this.closest('div').style.opacity = '0.4';
                            this.innerHTML = '<i class="fa-solid fa-check"></i> Agregado';
                        });
                        lista.appendChild(item);
                    });

                    status.parentNode.appendChild(lista);
                } catch (err) {
                    console.error("Error leyendo Excel:", err);
                    status.innerHTML = '<span style="color:var(--danger-color)">Error al procesar el archivo.</span>';
                }
            };
            reader.readAsArrayBuffer(file);
        });
    }

    // Buscador en lista semanal
    const searchInput = document.getElementById('input-buscar-semanal');
    if(searchInput) {
        searchInput.addEventListener('input', (e) => {
            const val = e.target.value.toLowerCase();
            const items = document.querySelectorAll('#lista-semanal-items .list-item');
            items.forEach(it => {
                it.style.display = it.textContent.toLowerCase().includes(val) ? 'block' : 'none';
            });
        });
    }
}

function asignarPersonalATarea(id) {
    const tarea = estado.tareas.find(t => t.id === id);
    if (!tarea) return;

    _abrirModalIniciar(id, false);
}

function comenzarTrabajoProgramado(id) {
    _abrirModalIniciar(id, true);
}

function _abrirModalIniciar(id, cambiarADashboard) {
    const tarea = estado.tareas.find(t => t.id === id);
    if (!tarea) return;

    const modal = document.getElementById('modal-iniciar-trabajo');
    document.getElementById('modal-iniciar-tarea-id').value = id;
    document.getElementById('modal-iniciar-tipo').textContent = tarea.tipo;

    // Poblar tipo de trabajo
    const tipoSel = document.getElementById('modal-iniciar-tipo-trabajo');
    // Detectar tipo actual desde el nombre de la tarea
    const tipoActual = tipicosTrabajos.find(t => tarea.tipo.toLowerCase().includes(t.toLowerCase())) || '';
    tipoSel.innerHTML = tipicosTrabajos.map(t =>
        `<option value="${t}" ${t === tipoActual ? 'selected' : ''}>${t}</option>`
    ).join('');

    const todos = estado.trabajadores.filter(t => t.disponible);
    const disponibles = estado.trabajadores.filter(t => t.disponible && !t.ocupado);

    const liderSel = document.getElementById('modal-iniciar-lider');
    liderSel.innerHTML = '<option value="">— Seleccionar —</option>' +
        todos.map(t => `<option value="${t.id}">${t.nombre} — ${t.cargo || ''}</option>`).join('');

    const ayudSel = document.getElementById('modal-iniciar-ayudantes');
    ayudSel.innerHTML = disponibles.map(t => `<option value="${t.id}">${t.nombre} — ${t.cargo || ''}</option>`).join('');

    modal.style.display = 'flex';

    document.getElementById('modal-iniciar-confirmar').onclick = async () => {
        const liderId = liderSel.value;
        if (!liderId) { alert('Selecciona un líder.'); return; }

        const tipoTrabajo = tipoSel.value;
        const ayudantesIds = [...ayudSel.selectedOptions].map(o => o.value).filter(v => v !== liderId);
        const lider = estado.trabajadores.find(t => t.id === liderId);
        const ayudantesNombres = ayudantesIds.map(aid => estado.trabajadores.find(t => t.id === aid)?.nombre || '');
        const hora = new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});

        modal.style.display = 'none';

        estado.tareas = estado.tareas.map(t => t.id === id ? {
            ...t,
            ...(cambiarADashboard ? { estadoTarea: 'en_curso', estadoEjecucion: 'activo', horaAsignacion: hora } : {}),
            liderId, liderNombre: lider?.nombre || '',
            ayudantesIds, ayudantesNombres,
            tipo: tarea.tipo.includes(tipoTrabajo) ? tarea.tipo : `${tarea.tipo} (${tipoTrabajo})`
        } : t);
        estado.trabajadores = estado.trabajadores.map(w =>
            ayudantesIds.includes(w.id) ? { ...w, ocupado: true } : w
        );
        if (cambiarADashboard) vistaActual = 'dashboard';
        renderizarVistaActual();

        const dbUpdate = {
            lider_id: liderId, lider_nombre: lider?.nombre || '',
            ayudantes_ids: ayudantesIds, ayudantes_nombres: ayudantesNombres,
            ...(cambiarADashboard ? { estado_tarea: 'en_curso', hora_asignacion: hora } : {})
        };
        await _db.update('tareas', id, dbUpdate);
        if (ayudantesIds.length > 0)
            await Promise.all(ayudantesIds.map(aid => _db.update('trabajadores', aid, { ocupado: true })));
    };
}

// --- SISTEMA DE NAVEGACIÓN Y RENDER ---

// Eventos de Navegación
const navConfig = {
    'nav-dashboard': 'dashboard',
    'nav-semanal': 'semanal',
    'nav-historial': 'historial',
    'nav-trabajadores': 'trabajadores',
    'nav-perfil': 'perfil',
    'nav-checkin': 'checkin'
};

function renderizarVistaActual() {
    // Limpiar contenido
    mainContent.innerHTML = '';
    
    // Actualizar clases activas en nav
    Object.keys(navConfig).forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.classList.toggle('active', navConfig[id] === vistaActual);
    });

    // Renderizar según estado
    switch (vistaActual) {
        case 'checkin':
            renderCheckInView();
            break;
        case 'dashboard':
            renderDashboardView();
            break;
        case 'trabajadores':
            renderTrabajadoresView();
            break;
        case 'historial':
            renderHistorialView(true);
            break;
        case 'semanal':
            renderSemanalView();
            break;
        case 'perfil':
            renderPerfilView();
            break;
    }

    // Al renderizar, cerramos sidebar si existe
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
        sidebar.classList.remove('open');
    }
}

Object.keys(navConfig).forEach(id => {
    const btn = document.getElementById(id);
    if (btn) {
        btn.addEventListener('click', () => {
            vistaActual = navConfig[id];
            renderizarVistaActual();
        });
    }
});

// Sidebar Móvil (Opcional según index.html)
const btnMenu = document.getElementById('btn-menu');
const sidebar = document.getElementById('sidebar');

if (btnMenu && sidebar) {
    btnMenu.addEventListener('click', () => {
        sidebar.classList.toggle('open');
    });
}

// --- MODALES Y UTILIDADES EXTRA ---

// Modal Nuevo Equipo (Capa de lógica)
const modalNuevoEq = document.getElementById('modal-nuevo-equipo');
const btnCerrarModalEq = document.getElementById('modal-equipo-cerrar');
const btnGuardarEq = document.getElementById('modal-equipo-guardar');
const btnCancelarEq = document.getElementById('modal-equipo-cancelar');

if (btnCerrarModalEq) {
    btnCerrarModalEq.addEventListener('click', () => {
        modalNuevoEq.style.display = 'none';
    });
}
if (btnCancelarEq) {
    btnCancelarEq.addEventListener('click', () => {
        modalNuevoEq.style.display = 'none';
    });
}

if (btnGuardarEq) {
    btnGuardarEq.addEventListener('click', async () => {
        const btnSave = btnGuardarEq;
        const originalText = btnSave.innerHTML;
        
        const nuevo = {
            id: crypto.randomUUID(),
            activo: document.getElementById('nuevo-equipo-activo').value,
            ubicacion: document.getElementById('nuevo-equipo-ubicacion').value,
            componente: document.getElementById('nuevo-equipo-componente').value || '',
            kks: document.getElementById('nuevo-equipo-kks').value || '',
            criticidad: 'MEDIA' // Valor por defecto ya que no está en el mini-modal
        };

        btnSave.disabled = true;
        btnSave.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Guardando...';

        const { data: equipoGuardado } = await _db.insert('equipos', nuevo);

        modalNuevoEq.style.display = 'none';
        // Limpiar campos
        document.getElementById('nuevo-equipo-activo').value = '';
        document.getElementById('nuevo-equipo-componente').value = '';
        document.getElementById('nuevo-equipo-kks').value = '';

        // Refrescar equipos
        if (navigator.onLine) {
            const { data } = await supabaseClient.from('equipos').select('*');
            estado.equipos = data || [];
        } else {
            estado.equipos = [...estado.equipos, equipoGuardado];
        }
        
        btnSave.disabled = false;
        btnSave.innerHTML = originalText;
    });
}


// --- LÓGICA DE FICHA TÉCNICA (DETALLES Y GRÁFICOS) ---

const modalFinalizar = document.getElementById('modal-finalizar-tarea');
const btnCerrarModalFinalizar = document.getElementById('btn-cerrar-modal-finalizar');
const btnConfirmarFinalizar = document.getElementById('btn-confirmar-finalizar');

function cerrarModalFinalizarTarea() {
    if (!modalFinalizar) return;
    modalFinalizar.style.display = 'none';
}

if (btnCerrarModalFinalizar) {
    btnCerrarModalFinalizar.addEventListener('click', cerrarModalFinalizarTarea);
}

if (btnConfirmarFinalizar) {
    btnConfirmarFinalizar.addEventListener('click', async () => {
        const acciones = document.getElementById('modal-acciones').value.trim();
        if (!acciones) {
            alert("Debes ingresar las acciones realizadas.");
            return;
        }

        const originalHtml = btnConfirmarFinalizar.innerHTML;
        btnConfirmarFinalizar.disabled = true;
        btnConfirmarFinalizar.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Guardando...';

        try {
            await guardarTareaFinalizada({
                id: document.getElementById('modal-tarea-id').value,
                liderId: document.getElementById('modal-lider-id').value,
                ayudantesIdsStr: document.getElementById('modal-ayudantes-ids').value,
                accionesRealizadas: acciones,
                observaciones: document.getElementById('modal-observaciones').value.trim(),
                numeroAviso: document.getElementById('modal-numero-aviso').value.trim(),
                hhTrabajo: document.getElementById('modal-hh-trabajo').value.trim(),
                analisisTecnico: document.getElementById('modal-analisis').value.trim(),
                recomendacionAnalista: document.getElementById('modal-recomendacion-analista').value.trim()
            });
            cerrarModalFinalizarTarea();
        } finally {
            btnConfirmarFinalizar.disabled = false;
            btnConfirmarFinalizar.innerHTML = originalHtml;
        }
    });
}

window.abrirFichaTecnica = async function(equipoId) {
    console.log('Abriendo ficha técnica para equipo:', equipoId);
    
    // 1. Obtener datos del equipo y sus mediciones
    const equipo = estado.equipos.find(e => e.id === equipoId);
    if (!equipo) return;

    // Asegurarnos de que el modal existe en el DOM
    renderFichaTecnicaModal();
    const modal = document.getElementById('modal-ficha-tecnica');
    
    // 2. Llenar datos básicos
    document.getElementById('ficha-equipo-nombre').textContent = equipo.activo + (equipo.componente ? ' · ' + equipo.componente : '');
    document.getElementById('ficha-equipo-ubicacion').textContent = equipo.ubicacion;
    document.getElementById('ficha-equipo-kks').textContent = equipo.kks || 'N/A';
    
    const badgeCrit = document.getElementById('ficha-equipo-criticidad');
    const critMap = { 'A': { label: 'Criticidad A', cls: 'badge-danger' }, 'B': { label: 'Criticidad B', cls: 'badge-warning' }, 'C': { label: 'Criticidad C', cls: 'badge-success' } };
    const crit = critMap[equipo.criticidad] || { label: equipo.criticidad || 'Sin criticidad', cls: 'badge-secondary' };
    badgeCrit.textContent = crit.label;
    badgeCrit.className = 'badge ' + crit.cls;
    // Mostrar frecuencia y UT si existen
    const fichaExtra = document.getElementById('ficha-equipo-extra');
    if (fichaExtra) {
        fichaExtra.innerHTML = [
            equipo.denominacion_ut ? `<span><i class="fa-solid fa-tag"></i> ${equipo.denominacion_ut}</span>` : '',
            equipo.frecuencia_nueva ? `<span><i class="fa-solid fa-clock-rotate-left"></i> Frecuencia: ${equipo.frecuencia_nueva} días</span>` : '',
            equipo.ruta ? `<span><i class="fa-solid fa-route"></i> ${equipo.ruta}</span>` : ''
        ].filter(Boolean).join('');
    }

    // 3. Obtener mediciones desde Supabase (o estado local)
    // Para simplificar, usamos estado.historialMediciones filtrado
    const mediciones = estado.historialMediciones.filter(m => m.equipo_id === equipoId);
    
    // 4. Renderizar listas de mediciones según tipo
    renderListasFicha(mediciones);

    // 5. Inicializar Gráficos (Usando Chart.js)
    setTimeout(() => {
        initFichaCharts(mediciones);
        modal.style.display = 'flex';
    }, 100);

    // 6. Configurar pestañas y cierre
    setupFichaEvents();
};

function renderListasFicha(mediciones) {
    const listVib = document.getElementById('lista-mediciones-vibracion');
    const listTermo = document.getElementById('lista-mediciones-termografia');
    const listLid = document.getElementById('lista-mediciones-lubricacion');

    // Vibraciones
    const vibs = mediciones.filter(m => m.tipo === 'vibracion').slice(0, 5);
    listVib.innerHTML = vibs.length > 0 ? vibs.map(m => `
        <div style="background:#f1f5f9; padding:0.6rem; border-radius:8px; display:flex; justify-content:space-between; align-items:center;">
            <div>
                <span style="font-weight:700; color:var(--primary-color)">${m.valor} ${m.unidad}</span>
                <div style="font-size:0.75rem; color:var(--text-muted)">${new Date(m.fecha).toLocaleDateString()} · ${m.punto_medicion}</div>
            </div>
            <i class="fa-solid fa-chart-line" style="color:#cbd5e1"></i>
        </div>
    `).join('') : '<p style="color:var(--text-muted); font-size:0.85rem">Sin mediciones recientes.</p>';

    // Termografía
    const termos = mediciones.filter(m => m.tipo === 'termografia').slice(0, 5);
    listTermo.innerHTML = termos.length > 0 ? termos.map(m => `
        <div style="background:#fff1f2; padding:0.6rem; border-radius:8px; display:flex; justify-content:space-between; align-items:center; border: 1px solid #fecdd3;">
            <div>
                <span style="font-weight:700; color:#e11d48">${m.valor} °C</span>
                <div style="font-size:0.75rem; color:var(--text-muted)">${new Date(m.fecha).toLocaleDateString()}</div>
            </div>
            <i class="fa-solid fa-temperature-high" style="color:#fb7185"></i>
        </div>
    `).join('') : '<p style="color:var(--text-muted); font-size:0.85rem">Sin inspecciones térmicas.</p>';

    // Lubricación
    const lubs = mediciones.filter(m => m.tipo === 'lubricacion').slice(0, 4);
    listLid.innerHTML = lubs.length > 0 ? lubs.map(m => `
        <div style="background:rgba(255,165,0,0.08); padding:0.8rem; border-radius:8px; border: 1px solid rgba(255,105,0,0.2); margin-bottom:0.5rem;">
             <div style="font-weight:600; font-size:0.9rem; color:var(--text-main);">${m.punto_medicion}</div>
             <p style="margin:0.25rem 0 0; font-size:0.85rem; color:var(--primary-color);">${m.valor}</p>
             <div style="font-size:0.7rem; color:var(--text-muted); margin-top:0.4rem;">${new Date(m.fecha).toLocaleDateString()}</div>
        </div>
    `).join('') : '<p style="color:var(--text-muted); font-size:0.85rem; padding:0.5rem;">No se registran cambios de aceite o engrase.</p>';
}

let activeCharts = []; // Para destruir antes de recrear

function initFichaCharts(mediciones) {
    // Destruir previos
    activeCharts.forEach(c => c.destroy());
    activeCharts = [];

    // Chart Vibraciones
    const ctxVib = document.getElementById('chart-vibraciones');
    if (ctxVib) {
        const dataV = mediciones.filter(m => m.tipo === 'vibracion').reverse();
        activeCharts.push(new Chart(ctxVib, {
            type: 'line',
            data: {
                labels: dataV.map(m => new Date(m.fecha).toLocaleDateString()),
                datasets: [{
                    label: 'Vibración Global (mm/s)',
                    data: dataV.map(m => m.valor),
                    borderColor: '#FF6900',
                    backgroundColor: 'rgba(255,105,0,0.12)',
                    fill: true,
                    tension: 0.4,
                    pointBackgroundColor: '#FF6900'
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { labels: { color: '#374151' } } },
                scales: {
                    x: { ticks: { color: '#6b7280' }, grid: { color: '#f3f4f6' } },
                    y: { ticks: { color: '#6b7280' }, grid: { color: '#f3f4f6' } }
                }
            }
        }));
    }

    // Chart Termografía

    const ctxTer = document.getElementById('chart-termografia');
    if (ctxTer) {
        const dataT = mediciones.filter(m => m.tipo === 'termografia').reverse();
        activeCharts.push(new Chart(ctxTer, {
            type: 'bar',
            data: {
                labels: dataT.map(m => new Date(m.fecha).toLocaleDateString()),
                datasets: [{
                    label: 'Temperatura Máx (°C)',
                    data: dataT.map(m => m.valor),
                    backgroundColor: 'rgba(251,113,133,0.7)',
                    borderColor: '#fb7185',
                    borderWidth: 1,
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { labels: { color: '#374151' } } },
                scales: {
                    x: { ticks: { color: '#6b7280' }, grid: { color: '#f3f4f6' } },
                    y: { ticks: { color: '#6b7280' }, grid: { color: '#f3f4f6' } }
                }
            }
        }));
    }
}

function setupFichaEvents() {
    const modal = document.getElementById('modal-ficha-tecnica');
    const btnCerrar = document.getElementById('btn-cerrar-ficha');
    
    btnCerrar.onclick = () => { modal.style.display = 'none'; };

    // Tabs
    const tabs = modal.querySelectorAll('.tab-btn');
    tabs.forEach(t => {
        t.onclick = () => {
            tabs.forEach(x => {
                x.classList.remove('active');
                x.style.color = 'var(--text-muted)';
                x.style.borderBottom = 'none';
            });
            t.classList.add('active');
            t.style.color = 'var(--text-main)';
            t.style.borderBottom = '2px solid var(--primary-color)';

            const target = t.dataset.target;
            modal.querySelectorAll('.tab-pane').forEach(p => p.style.display = 'none');
            document.getElementById(target).style.display = 'block';
        };
    });
}

// --- BÚSQUEDA GLOBAL (EQUIPOS Y COMPONENTES) ---

const searchInput = document.getElementById('input-buscar-ot');
const searchResults = document.getElementById('search-results-list');

if (searchInput) {
    searchInput.addEventListener('input', (e) => {
        const rawQuery = e.target.value.trim();
        const query = rawQuery.toLowerCase();
        const overlay = document.getElementById('search-results-overlay');

        if (query.length < 2) {
            overlay.style.display = 'none';
            return;
        }

        // Buscar tareas activas por OT
        const tareasOT = estado.tareas.filter(t => t.otNumero && t.otNumero.toLowerCase().includes(query));
        // Buscar historial por OT
        const historialOT = estado.historialTareas.filter(t => t.ot_numero && t.ot_numero.toLowerCase().includes(query));

        // Buscar equipos por nombre/KKS/ubicacion
        const filtered = estado.equipos.filter(eq =>
            eq.activo.toLowerCase().includes(query) ||
            (eq.componente && eq.componente.toLowerCase().includes(query)) ||
            (eq.kks && eq.kks.toLowerCase().includes(query)) ||
            (eq.ubicacion && eq.ubicacion.toLowerCase().includes(query)) ||
            (eq.ubicacion_original && eq.ubicacion_original.toLowerCase().includes(query))
        );

        // Si hay resultados de OT, mostrarlos primero
        if (tareasOT.length > 0 || historialOT.length > 0) {
            let otHtml = '';
            if (tareasOT.length > 0) {
                otHtml += `<p style="font-size:0.8rem; font-weight:600; color:var(--warning-color); margin:0 0 0.5rem 0;"><i class="fa-solid fa-person-digging"></i> OT EN CURSO</p>`;
                otHtml += tareasOT.map(t => `
                    <div style="background:#fffbeb; border:1px solid #fde68a; border-radius:10px; padding:0.8rem 1rem; margin-bottom:0.6rem;">
                        <div style="font-weight:700; color:var(--text-main);">OT ${t.otNumero}</div>
                        <div style="font-size:0.85rem; color:var(--text-muted); margin-top:0.2rem;">${t.tipo}</div>
                        <div style="font-size:0.8rem; color:var(--text-muted); margin-top:0.2rem;">
                            <i class="fa-solid fa-user-tie"></i> ${t.liderNombre} &nbsp;
                            <span class="badge" style="background:var(--warning-color); color:white; font-size:0.7rem;">EN CURSO</span>
                        </div>
                    </div>`).join('');
            }
            if (historialOT.length > 0) {
                otHtml += `<p style="font-size:0.8rem; font-weight:600; color:var(--success-color); margin:0.8rem 0 0.5rem 0;"><i class="fa-solid fa-flag-checkered"></i> OT COMPLETADAS</p>`;
                otHtml += historialOT.map(t => `
                    <div style="background:#f0fdf4; border:1px solid #86efac; border-radius:10px; padding:0.8rem 1rem; margin-bottom:0.6rem;">
                        <div style="font-weight:700; color:var(--text-main);">OT ${t.ot_numero}</div>
                        <div style="font-size:0.85rem; color:var(--text-muted); margin-top:0.2rem;">${t.tipo}</div>
                        <div style="font-size:0.8rem; color:var(--text-muted); margin-top:0.2rem;">
                            <i class="fa-solid fa-user-tie"></i> ${t.lider_nombre} &nbsp;
                            <i class="fa-regular fa-calendar"></i> ${new Date(t.created_at).toLocaleDateString('es-CL')} &nbsp;
                            <span class="badge" style="background:var(--success-color); color:white; font-size:0.7rem;">COMPLETADA</span>
                        </div>
                    </div>`).join('');
            }
            searchResults.innerHTML = otHtml + (filtered.length > 0 ? `<hr style="margin:1rem 0; border-color:var(--glass-border);">` : '');
            overlay.style.display = 'block';
            if (filtered.length === 0) return;
        }

        if (filtered.length > 0) {
            const criticidadColor = { 'A': '#ef4444', 'B': '#f59e0b', 'C': '#22c55e' };

            // Agrupar por nombre de activo + unidad (misma unidad = misma tarjeta)
            const grupos = {};
            filtered.forEach(eq => {
                const key = (eq.activo || '') + '||' + (eq.ubicacion || '');
                if (!grupos[key]) grupos[key] = [];
                grupos[key].push(eq);
            });

            const tarjetas = Object.entries(grupos).map(([_key, eqs]) => {
                const nombre = eqs[0].activo;
                const eq0 = eqs[0];
                const crit = (eq0.criticidad || '').toUpperCase();
                const critColor = criticidadColor[crit] || '#6b7280';
                const multiComponente = eqs.length > 1;

                if (!multiComponente) {
                    // Tarjeta simple — comportamiento anterior
                    return `
                    <div onclick="window.abrirFichaTecnica('${eq0.id}')" style="
                        background:var(--card-bg); border:1px solid var(--glass-border); border-radius:12px;
                        padding:1rem; cursor:pointer; transition:box-shadow 0.2s,transform 0.2s; position:relative; overflow:hidden;
                    " onmouseenter="this.style.boxShadow='0 4px 20px rgba(0,0,0,0.12)';this.style.transform='translateY(-2px)'"
                       onmouseleave="this.style.boxShadow='none';this.style.transform='translateY(0)'">
                        ${crit ? `<span style="position:absolute;top:0.8rem;right:0.8rem;background:${critColor}22;color:${critColor};border:1px solid ${critColor}66;border-radius:6px;font-size:0.7rem;font-weight:700;padding:2px 7px;">Crit. ${crit}</span>` : ''}
                        <div style="font-weight:700;font-size:0.95rem;color:var(--text-main);margin-bottom:0.3rem;padding-right:3rem;line-height:1.3;">${eq0.activo}</div>
                        ${eq0.componente ? `<div style="font-size:0.82rem;color:var(--primary-color);font-weight:600;margin-bottom:0.6rem;">${eq0.componente}</div>` : ''}
                        <div style="display:flex;flex-direction:column;gap:0.25rem;font-size:0.78rem;color:var(--text-muted);">
                            <span><i class="fa-solid fa-location-dot" style="width:14px;"></i> ${eq0.ubicacion || 'Sin ubicación'}</span>
                            <span><i class="fa-solid fa-hashtag" style="width:14px;"></i> KKS: ${eq0.kks || 'N/A'}</span>
                            ${eq0.frecuencia_nueva ? `<span><i class="fa-solid fa-rotate" style="width:14px;"></i> Frec: ${eq0.frecuencia_nueva}</span>` : ''}
                        </div>
                        <div style="margin-top:0.8rem;font-size:0.72rem;color:var(--primary-color);font-weight:500;"><i class="fa-solid fa-arrow-right"></i> Ver ficha técnica</div>
                    </div>`;
                } else {
                    // Tarjeta agrupada — muestra componentes expandibles
                    const compItems = eqs.map(eq => `
                        <div onclick="event.stopPropagation(); window.abrirFichaTecnica('${eq.id}')" style="
                            display:flex; align-items:center; gap:0.6rem; padding:0.5rem 0.7rem;
                            border-radius:8px; cursor:pointer; transition:background 0.15s;
                            border:1px solid var(--glass-border); margin-bottom:0.4rem;
                        " onmouseenter="this.style.background='rgba(255,102,0,0.08)'"
                           onmouseleave="this.style.background='transparent'">
                            <i class="fa-solid fa-microchip" style="color:var(--primary-color);font-size:0.8rem;flex-shrink:0;"></i>
                            <span style="font-size:0.82rem;font-weight:600;color:var(--text-main);flex:1;">${eq.componente || 'Sin componente'}</span>
                            <span style="font-size:0.7rem;color:var(--text-muted);">KKS: ${eq.kks || 'N/A'}</span>
                            <i class="fa-solid fa-arrow-right" style="font-size:0.7rem;color:var(--primary-color);"></i>
                        </div>`).join('');

                    return `
                    <div style="background:var(--card-bg);border:1px solid var(--primary-color)44;border-radius:12px;padding:1rem;position:relative;">
                        ${crit ? `<span style="position:absolute;top:0.8rem;right:0.8rem;background:${critColor}22;color:${critColor};border:1px solid ${critColor}66;border-radius:6px;font-size:0.7rem;font-weight:700;padding:2px 7px;">Crit. ${crit}</span>` : ''}
                        <div style="font-weight:700;font-size:0.95rem;color:var(--text-main);margin-bottom:0.25rem;padding-right:3rem;line-height:1.3;">${nombre}</div>
                        <div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:0.7rem;">
                            <i class="fa-solid fa-location-dot" style="width:14px;"></i> ${eq0.ubicacion || 'Sin ubicación'}
                        </div>
                        <div style="display:flex;align-items:center;gap:0.4rem;margin-bottom:0.6rem;">
                            <span style="background:var(--primary-color);color:white;border-radius:999px;font-size:0.7rem;font-weight:700;padding:2px 8px;">${eqs.length} componentes</span>
                        </div>
                        ${compItems}
                    </div>`;
                }
            }).join('');

            searchResults.innerHTML = `
                <p style="font-size:0.8rem; color:var(--text-muted); margin: 0 0 1rem 0;">${filtered.length} equipo(s) encontrado(s)</p>
                <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap:1rem;">
                ${tarjetas}
                </div>`;
            overlay.style.display = 'block';
        } else {
            searchResults.innerHTML = '<p style="padding:1rem; color:var(--text-muted); font-size:0.9rem;"><i class="fa-solid fa-circle-xmark"></i> No se encontraron equipos para "<strong>' + query + '</strong>"</p>';
            overlay.style.display = 'block';
        }
    });

    const btnCerrarBusqueda = document.getElementById('btn-cerrar-busqueda');
    if (btnCerrarBusqueda) {
        btnCerrarBusqueda.addEventListener('click', () => {
            document.getElementById('search-results-overlay').style.display = 'none';
            searchInput.value = '';
        });
    }
}


// --- LÓGICA DE LOGIN Y ACCESO ---

const loginOverlay = document.getElementById('login-overlay');
const pinModal = document.getElementById('pin-container');
const pinInput = document.getElementById('input-pin');

// Botón Planificador
document.getElementById('btn-login-admin')?.addEventListener('click', () => {
    pinModal.style.display = 'block';
    document.querySelector('.role-buttons').style.display = 'none';
    pinInput?.focus();
});

// Cancelar PIN planificador
document.getElementById('btn-cancel-pin')?.addEventListener('click', () => {
    pinModal.style.display = 'none';
    document.querySelector('.role-buttons').style.display = 'block';
    if (pinInput) pinInput.value = '';
    const err = document.getElementById('pin-error');
    if (err) err.style.display = 'none';
});

// Botón Visita
document.getElementById('btn-login-visita')?.addEventListener('click', () => accederApp('visita'));

// Submit PIN planificador
document.getElementById('btn-submit-pin')?.addEventListener('click', validarPin);
pinInput?.addEventListener('keypress', (e) => { if (e.key === 'Enter') validarPin(); });

function validarPin() {
    const pin = pinInput?.value || '';
    if (pin === '2025') {
        accederApp('admin');
        pinModal.style.display = 'none';
        if (pinInput) pinInput.value = '';
    } else {
        const err = document.getElementById('pin-error');
        if (err) err.style.display = 'block';
        if (pinInput) { pinInput.value = ''; pinInput.focus(); }
    }
}

// ── LOGIN TRABAJADOR con RUT + PIN ──────────────────────────────────────────

document.getElementById('btn-login-worker')?.addEventListener('click', () => {
    document.getElementById('worker-login-container').style.display = 'block';
    document.querySelector('.role-buttons').style.display = 'none';
    document.getElementById('worker-login-error').style.display = 'none';
    document.getElementById('input-worker-rut')?.focus();
});

document.getElementById('btn-cancel-worker')?.addEventListener('click', () => {
    document.getElementById('worker-login-container').style.display = 'none';
    document.querySelector('.role-buttons').style.display = 'block';
    document.getElementById('input-worker-rut').value = '';
    document.getElementById('input-worker-pin').value = '';
    document.getElementById('worker-login-error').style.display = 'none';
});

document.getElementById('btn-submit-worker')?.addEventListener('click', validarWorkerLogin);
document.getElementById('input-worker-pin')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') validarWorkerLogin();
});

async function validarWorkerLogin() {
    const rut = document.getElementById('input-worker-rut')?.value.trim() || '';
    const pin = document.getElementById('input-worker-pin')?.value.trim() || '';
    const errEl = document.getElementById('worker-login-error');
    const btn = document.getElementById('btn-submit-worker');

    if (!rut || !pin) {
        errEl.textContent = 'Ingresa tu RUT y PIN.';
        errEl.style.display = 'block';
        return;
    }

    // Normalizar RUT: quitar puntos, guión y espacios para comparación flexible
    function normRut(r) { return r.replace(/[\.\-\s]/g, '').toLowerCase(); }
    const rutNorm = normRut(rut);

    const trabajador = estado.trabajadores.find(t => {
        if (!t.rut || !t.pin_acceso) return false;
        return normRut(t.rut) === rutNorm && t.pin_acceso === pin;
    });

    if (!trabajador) {
        errEl.textContent = 'RUT o PIN incorrecto. Consulta al planificador.';
        errEl.style.display = 'block';
        document.getElementById('input-worker-pin').value = '';
        return;
    }

    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Registrando...'; }

    // Auto check-in
    await updateTrabajadorDisponibilidad(trabajador.id, true);

    // Actualizar estado local
    estado.trabajadores = estado.trabajadores.map(t =>
        t.id === trabajador.id ? { ...t, disponible: true } : t
    );

    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-clipboard-check"></i> Ingresar y hacer Check-in'; }

    accederApp('trabajador', { ...trabajador, disponible: true });
}

function accederApp(rol, trabajadorObj = null) {
    estado.usuarioActual = rol;
    estado.trabajadorLogueado = trabajadorObj;
    loginOverlay.style.display = 'none';
    document.getElementById('app').style.display = 'block';

    // Visibilidad de nav según rol
    const navRoles = {
        'nav-semanal':      ['admin'],
        'nav-trabajadores': ['admin'],
        'nav-checkin':      ['admin'],
        'nav-perfil':       ['admin', 'trabajador'],
        'btn-copy-link':    ['admin']
    };
    Object.entries(navRoles).forEach(([id, roles]) => {
        const el = document.getElementById(id);
        if (el) el.style.display = roles.includes(rol) ? '' : 'none';
    });

    vistaActual = 'dashboard';
    renderizarVistaActual();
}

// Inicialización
window.addEventListener('DOMContentLoaded', () => {
    inicializarDatos();
});

// Registrar Service Worker para PWA
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('SW registrado', reg))
            .catch(err => console.log('Error SW', err));
    });
}

// Copiar Link (Contexto Técnico)
function copiarEnlaceFicha(id) {
    const url = window.location.origin + window.location.pathname + '?equipo=' + id;
    navigator.clipboard.writeText(url).then(() => alert('Enlace copiado al portapapeles'));
}
window.copiarEnlaceFicha = copiarEnlaceFicha;

// Botón "Link Visitas" en la navbar — copia la URL de la app para compartir
document.getElementById('btn-copy-link')?.addEventListener('click', () => {
    const url = window.location.origin + window.location.pathname;
    navigator.clipboard.writeText(url).then(() => {
        const btn = document.getElementById('btn-copy-link');
        const orig = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-check"></i> ¡Enlace copiado!';
        setTimeout(() => btn.innerHTML = orig, 2000);
    }).catch(() => {
        prompt('Copia este enlace y compártelo:', window.location.href);
    });
});

