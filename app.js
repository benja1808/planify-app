// Configuración de Supabase
const supabaseUrl = 'https://fygvulgffhxrimaeyoep.supabase.co';
const supabaseKey = 'sb_publishable_YOksHoWnkBBt74lnKFqc8g_XyP3EyQF'; // Clave Anon Key de Supabase

// Guard: si el SDK no cargó (offline sin caché), no crashear toda la app
const supabaseClient = window.supabase
    ? window.supabase.createClient(supabaseUrl, supabaseKey)
    : null;

// Exponer en window para que syncQueue.js pueda accederlo
window.supabaseClient = supabaseClient;

// ── Helper de escritura offline-safe ────────────────────────────────────────
// Mapea tabla Supabase → store de localDB
function _storeLocal(tabla) {
    const map = {
        tareas: 'tareas', trabajadores: 'trabajadores', equipos: 'equipos',
        historial_tareas: 'historial', tareas_historial: 'historial',
        mediciones: 'mediciones', historial_mediciones: 'mediciones',
        horas_extra: 'horas_extra',
        insumos: 'insumos',
        solicitudes_insumos: 'solicitudes_insumos',
        movimientos_inventario: 'movimientos_inventario'
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
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char]));
}

let estado = {
    trabajadores: [],
    tareas: [],
    historialTareas: [],
    historialMediciones: [],
    equipos: [],
    insumos: [],
    solicitudesInsumos: [],
    movimientosInventario: [],
    horasExtra: [],
    informeNovedadesDiarias: null,
    usuarioActual: 'visita', // 'visita', 'admin', 'trabajador'
    trabajadorLogueado: null  // objeto trabajador cuando rol === 'trabajador'
};

let semanalExcelImportState = {
    fileName: '',
    total: 0,
    items: [],
    message: '',
    tone: 'info'
};
let tareasEliminandose = new Set();

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
    mediciones: 'mediciones',
    insumos: 'insumos',
    solicitudesInsumos: 'solicitudes_insumos',
    movimientosInventario: 'movimientos_inventario'
};

const insumosFeatureState = {
    tablasRemotas: {
        insumos: false,
        solicitudes: false,
        movimientos: false
    },
    aprobadoresPersistentes: false
};

const INSUMOS_DEMO = [
    { codigo: 1, nombre: 'Amortiguador de caida', marca: 'SEGMA WORK ON TOP', unidad: 'UNI', stock_inicial: 12, stock_actual: 12, activo: true },
    { codigo: 2, nombre: 'Antiparra ductile', marca: 'Libus', unidad: 'UNI', stock_inicial: 12, stock_actual: 2, activo: true },
    { codigo: 3, nombre: 'Arnes 4 argollas', marca: 'MSA', unidad: 'UNI', stock_inicial: 8, stock_actual: 5, activo: true },
    { codigo: 4, nombre: 'Bala auditiva reusable', marca: '3M', unidad: 'PARES', stock_inicial: 40, stock_actual: 18, activo: true },
    { codigo: 5, nombre: 'Guante nitrilo', marca: 'Ansell', unidad: 'PARES', stock_inicial: 30, stock_actual: 26, activo: true },
    { codigo: 6, nombre: 'Casco con barbiquejo', marca: 'Steelpro', unidad: 'UNI', stock_inicial: 10, stock_actual: 7, activo: true },
    { codigo: 7, nombre: 'Lubricante cadena alta temperatura', marca: 'Mobil', unidad: 'UNI', stock_inicial: 14, stock_actual: 9, activo: true },
    { codigo: 8, nombre: 'Grasa multiproposito', marca: 'Shell', unidad: 'UNI', stock_inicial: 20, stock_actual: 11, activo: true },
    { codigo: 9, nombre: 'Paño industrial absorbente', marca: 'Kimberly', unidad: 'UNI', stock_inicial: 50, stock_actual: 17, activo: true },
    { codigo: 10, nombre: 'Respirador media cara', marca: '3M', unidad: 'UNI', stock_inicial: 16, stock_actual: 6, activo: true }
];

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

async function fetchAllEquipos() {
    const pageSize = 1000;
    let all = [];
    let from = 0;
    while (true) {
        const { data, error } = await supabaseClient
            .from('equipos')
            .select('*')
            .range(from, from + pageSize - 1);
        if (error || !data || data.length === 0) break;
        all = all.concat(data);
        if (data.length < pageSize) break;
        from += pageSize;
    }
    return all;
}

async function resolverTabla(candidatas) {
    for (const nombre of candidatas) {
        const { error } = await supabaseClient.from(nombre).select('*').limit(1);
        if (!error) return nombre;
        if (!esErrorTablaNoExiste(error)) throw error;
    }
    return null;
}

function enteroSeguro(valor, fallback = 0) {
    const numero = Number(valor);
    return Number.isFinite(numero) ? Math.round(numero) : fallback;
}

function normalizarTextoPlano(valor) {
    return String(valor || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toUpperCase();
}

function normalizarClaveExcel(valor) {
    return String(valor || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();
}

function obtenerValorFilaExcel(row, aliases = []) {
    if (!row || typeof row !== 'object') return '';
    const entries = Object.entries(row);
    for (const alias of aliases) {
        const exacto = row[alias];
        if (exacto !== undefined && exacto !== null && String(exacto).trim()) {
            return String(exacto).trim();
        }
        const aliasNormalizado = normalizarClaveExcel(alias);
        const encontrado = entries.find(([key, value]) =>
            normalizarClaveExcel(key) === aliasNormalizado &&
            value !== undefined &&
            value !== null &&
            String(value).trim()
        );
        if (encontrado) return String(encontrado[1]).trim();
    }
    return '';
}

function resolverUbicacionFilaSemanal(row, equipoTexto = '') {
    const ubicacionDirecta = obtenerValorFilaExcel(row, [
        'Ubicación',
        'Ubicacion',
        'Unidad',
        'Área',
        'Area',
        'Centro',
        'Ubicación trabajo',
        'Ubicacion trabajo'
    ]);
    if (ubicacionDirecta) return ubicacionDirecta;

    const ubicacionTecnica = obtenerValorFilaExcel(row, [
        'Ubicación Técnica',
        'Ubicacion Tecnica',
        'Ubicación tecnica',
        'Ubicacion tecnica'
    ]);

    const candidatos = [equipoTexto, ubicacionTecnica]
        .map(valor => normalizarTextoPlano(valor))
        .filter(Boolean);

    if (!candidatos.length) return '';

    const matchEquipo = estado.equipos.find((equipo) => {
        const referencias = [
            equipo.activo,
            equipo.componente,
            `${equipo.activo || ''} ${equipo.componente || ''}`.trim(),
            `${equipo.activo || ''} - ${equipo.componente || ''}`.trim()
        ]
            .map(valor => normalizarTextoPlano(valor))
            .filter(Boolean);

        return candidatos.some(candidato => referencias.some(referencia =>
            referencia === candidato ||
            referencia.includes(candidato) ||
            candidato.includes(referencia)
        ));
    });

    return matchEquipo?.ubicacion || '';
}

function normalizarUnidadInsumo(valor) {
    const base = normalizarTextoPlano(valor);
    if (!base) return 'UNI';
    return base.includes('PAR') ? 'PARES' : 'UNI';
}

const CATEGORIAS_INSUMO = [
    { id: 'epp_cabeza',     label: 'EPP Cabeza',       icon: 'fa-hard-hat',         color: '#2563eb', keywords: ['casco', 'barbiquejo', 'balaclava', 'cortaviento', 'gorro'] },
    { id: 'epp_ojos',       label: 'EPP Ojos/Cara',    icon: 'fa-glasses',          color: '#0891b2', keywords: ['antiparra', 'lente', 'careta', 'mascara', 'mascarilla facial', 'facial'] },
    { id: 'epp_respirat',   label: 'EPP Respiratorio', icon: 'fa-head-side-mask',   color: '#0d9488', keywords: ['respirador', 'filtro', 'mascarilla', 'n95', 'barbijo'] },
    { id: 'epp_auditivo',   label: 'EPP Auditivo',     icon: 'fa-deaf',             color: '#7c3aed', keywords: ['auditiv', 'tapon', 'tapones', 'bala', 'orejeras', 'protector oido'] },
    { id: 'epp_manos',      label: 'EPP Manos',        icon: 'fa-hand',             color: '#9333ea', keywords: ['guante', 'manopla'] },
    { id: 'epp_pies',       label: 'EPP Pies',         icon: 'fa-shoe-prints',      color: '#b45309', keywords: ['bota', 'zapato', 'calzado', 'polaina', 'cubrecalzado'] },
    { id: 'epp_cuerpo',     label: 'Ropa/Cuerpo',      icon: 'fa-shirt',            color: '#ea580c', keywords: ['buzo', 'chaleco', 'polera', 'pantalon', 'camisa', 'overol', 'traje', 'pechera', 'delantal', 'parka', 'chaqueta', 'ropa'] },
    { id: 'epp_altura',     label: 'Trabajo en altura', icon: 'fa-person-falling',  color: '#dc2626', keywords: ['arnes', 'amortiguador', 'linea de vida', 'mosqueton', 'eslinga', 'retract', 'cabo de vida'] },
    { id: 'lubricantes',    label: 'Lubricantes',      icon: 'fa-oil-can',          color: '#eab308', keywords: ['lubricante', 'aceite', 'grasa', 'solvente', 'desengrasante', 'silicona'] },
    { id: 'limpieza',       label: 'Limpieza',         icon: 'fa-spray-can',        color: '#14b8a6', keywords: ['pano', 'paño', 'wype', 'trapo', 'absorbente', 'detergente', 'jabon', 'escoba', 'virutilla'] },
    { id: 'herramientas',   label: 'Herramientas',     icon: 'fa-screwdriver-wrench', color: '#475569', keywords: ['llave', 'martillo', 'alicate', 'destornillador', 'herramienta', 'broca', 'lija'] },
    { id: 'consumibles',    label: 'Consumibles',      icon: 'fa-box-open',         color: '#f97316', keywords: [] }
];

function inferirCategoriaInsumo(nombre = '') {
    const texto = normalizarTextoPlano(nombre).toLowerCase();
    if (!texto) return 'consumibles';
    for (const cat of CATEGORIAS_INSUMO) {
        if (cat.keywords.some((kw) => texto.includes(kw))) return cat.id;
    }
    return 'consumibles';
}

function escHtml(valor) {
    return String(valor ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function abrirModalInsumo({ eyebrow = 'Insumo', titulo = 'Editar', bodyHtml = '', confirmLabel = 'Guardar', onConfirm }) {
    const modal = document.getElementById('modal-insumo-editar');
    const eyebrowEl = document.getElementById('insumo-editar-eyebrow');
    const titleEl = document.getElementById('insumo-editar-titulo');
    const bodyEl = document.getElementById('insumo-editar-body');
    const errorEl = document.getElementById('insumo-editar-error');
    const btnOk = document.getElementById('btn-insumo-editar-confirmar');
    const btnCancel = document.getElementById('btn-insumo-editar-cancelar');
    if (!modal || !bodyEl || !btnOk || !btnCancel) return;

    eyebrowEl.textContent = eyebrow;
    titleEl.textContent = titulo;
    bodyEl.innerHTML = bodyHtml;
    errorEl.style.display = 'none';
    errorEl.textContent = '';
    btnOk.innerHTML = confirmLabel;
    btnOk.disabled = false;
    modal.style.display = 'flex';

    const cerrar = () => { modal.style.display = 'none'; };
    btnCancel.onclick = cerrar;
    btnOk.onclick = async () => {
        errorEl.style.display = 'none';
        btnOk.disabled = true;
        const originalLabel = btnOk.innerHTML;
        btnOk.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Guardando...';
        try {
            await onConfirm?.();
            cerrar();
            vistaActual = 'insumos';
            renderizarVistaActual();
        } catch (error) {
            errorEl.textContent = error?.message || 'No se pudo guardar.';
            errorEl.style.display = 'block';
            btnOk.disabled = false;
            btnOk.innerHTML = originalLabel;
        }
    };
}

function obtenerCategoriaInsumoMeta(id) {
    return CATEGORIAS_INSUMO.find((cat) => cat.id === id) || CATEGORIAS_INSUMO[CATEGORIAS_INSUMO.length - 1];
}

function calcularStockMinimoEfectivo(item) {
    const min = enteroSeguro(item?.stock_minimo, 0);
    if (min > 0) return min;
    return Math.max(1, Math.round(enteroSeguro(item?.stock_inicial, 0) * 0.3));
}

function normalizarRegistroInsumo(item = {}, fallback = {}) {
    const stockInicial = enteroSeguro(
        item.stock_inicial ?? item.stockInicial ?? fallback.stock_inicial ?? fallback.stockInicial ?? item.stock_actual ?? item.stockActual,
        0
    );
    const stockActual = enteroSeguro(
        item.stock_actual ?? item.stockActual ?? fallback.stock_actual ?? fallback.stockActual ?? stockInicial,
        stockInicial
    );
    const codigo = enteroSeguro(item.codigo ?? fallback.codigo ?? 0, 0);
    const nombre = String(item.nombre ?? fallback.nombre ?? '').trim();
    const categoriaRaw = String(item.categoria ?? fallback.categoria ?? '').trim();
    const categoria = CATEGORIAS_INSUMO.some((cat) => cat.id === categoriaRaw)
        ? categoriaRaw
        : (categoriaRaw ? 'consumibles' : inferirCategoriaInsumo(nombre));
    return {
        id: item.id || fallback.id || crypto.randomUUID(),
        codigo: codigo || null,
        nombre,
        marca: String(item.marca ?? fallback.marca ?? '').trim(),
        unidad: normalizarUnidadInsumo(item.unidad ?? fallback.unidad),
        stock_actual: stockActual,
        stock_inicial: stockInicial,
        stock_minimo: enteroSeguro(item.stock_minimo ?? fallback.stock_minimo, 0),
        categoria,
        ubicacion: String(item.ubicacion ?? fallback.ubicacion ?? '').trim(),
        observaciones: String(item.observaciones ?? fallback.observaciones ?? '').trim(),
        activo: item.activo !== false && fallback.activo !== false,
        created_at: item.created_at || fallback.created_at || new Date().toISOString()
    };
}

function normalizarSolicitudInsumo(item = {}) {
    return {
        id: item.id || crypto.randomUUID(),
        trabajador_id: item.trabajador_id || item.user_id || item.userId || null,
        insumo_id: item.insumo_id || item.insumoId || null,
        cantidad: enteroSeguro(item.cantidad, 0),
        estado: String(item.estado || 'pendiente').toLowerCase(),
        aprobado_por: item.aprobado_por || null,
        fecha_solicitud: item.fecha_solicitud || item.created_at || new Date().toISOString(),
        fecha_aprobacion: item.fecha_aprobacion || null,
        observaciones: item.observaciones || item.motivo_rechazo || null,
        created_at: item.created_at || item.fecha_solicitud || new Date().toISOString()
    };
}

function normalizarMovimientoInventario(item = {}) {
    return {
        id: item.id || crypto.randomUUID(),
        insumo_id: item.insumo_id || item.insumoId || null,
        tipo: String(item.tipo || 'salida').toLowerCase(),
        cantidad: enteroSeguro(item.cantidad, 0),
        referencia_id: item.referencia_id || item.referenciaId || null,
        creado_por: item.creado_por || null,
        motivo: String(item.motivo || item.observaciones || '').trim(),
        stock_antes: item.stock_antes != null ? enteroSeguro(item.stock_antes, 0) : null,
        stock_despues: item.stock_despues != null ? enteroSeguro(item.stock_despues, 0) : null,
        fecha: item.fecha || item.created_at || new Date().toISOString(),
        created_at: item.created_at || item.fecha || new Date().toISOString()
    };
}

function construirCatalogoDemoInsumos() {
    return INSUMOS_DEMO.map((item) => normalizarRegistroInsumo(item, {
        id: `ins_demo_${String(item.codigo).padStart(3, '0')}`
    }));
}

function ordenarCatalogoInsumos(a, b) {
    const codigoA = Number(a?.codigo || 0);
    const codigoB = Number(b?.codigo || 0);
    if (codigoA && codigoB && codigoA !== codigoB) return codigoA - codigoB;
    return String(a?.nombre || '').localeCompare(String(b?.nombre || ''), 'es');
}

function obtenerTrabajadorActual() {
    if (!estado.trabajadorLogueado?.id) return estado.trabajadorLogueado;
    return estado.trabajadores.find((trabajador) => trabajador.id === estado.trabajadorLogueado.id) || estado.trabajadorLogueado;
}

function usuarioPuedeAprobarInsumos() {
    if (estado.usuarioActual === 'admin') return true;
    return Boolean(obtenerTrabajadorActual()?.puede_aprobar_insumos);
}

function usuarioSolicitanteActualId() {
    return estado.usuarioActual === 'trabajador' ? obtenerTrabajadorActual()?.id || null : null;
}

function nombreAprobadorActual() {
    if (estado.usuarioActual === 'admin') return 'Planificador';
    return obtenerTrabajadorActual()?.nombre || 'Supervisor';
}

function formatearFechaCorta(valor) {
    if (!valor) return '--';
    const fecha = new Date(valor);
    if (Number.isNaN(fecha.getTime())) return '--';
    return fecha.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatearFechaHora(valor) {
    if (!valor) return '--';
    const fecha = new Date(valor);
    if (Number.isNaN(fecha.getTime())) return '--';
    return fecha.toLocaleString('es-CL', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
}

function formatearCantidadInsumo(cantidad, unidad) {
    const numero = enteroSeguro(cantidad, 0);
    return `${numero} ${normalizarUnidadInsumo(unidad) === 'PARES' ? 'pares' : 'uni'}`;
}

function obtenerNombreTrabajadorPorId(id) {
    const trabajador = estado.trabajadores.find((item) => String(item.id) === String(id));
    return trabajador?.nombre || 'Sin asignar';
}

function obtenerInsumosActivos() {
    return [...(estado.insumos || [])]
        .filter((item) => item && item.activo !== false && item.nombre)
        .sort(ordenarCatalogoInsumos);
}

function obtenerInsumosStockBajo() {
    return obtenerInsumosActivos()
        .filter((item) => {
            const minimo = calcularStockMinimoEfectivo(item);
            if (minimo <= 0) return false;
            return enteroSeguro(item.stock_actual, 0) <= minimo;
        })
        .sort((a, b) => {
            const minA = Math.max(calcularStockMinimoEfectivo(a), 1);
            const minB = Math.max(calcularStockMinimoEfectivo(b), 1);
            const ratioA = enteroSeguro(a.stock_actual, 0) / minA;
            const ratioB = enteroSeguro(b.stock_actual, 0) / minB;
            return ratioA - ratioB || enteroSeguro(a.stock_actual, 0) - enteroSeguro(b.stock_actual, 0);
        });
}

const PLANIFY_NOTIFICATIONS_ENABLED_KEY = 'planify_notificaciones_activas';
const PLANIFY_NOTIFICATIONS_SENT_KEY = 'planify_notificaciones_enviadas_v1';
const PLANIFY_PUSH_REMOTE_KEY = 'planify_push_remoto_activo';
const PLANIFY_NOTIFICATION_LEAD_MS = 2 * 60 * 60 * 1000;

const planifyNotifications = {
    initialized: false,
    intervalId: null,
    syncInFlight: false,
    lastSyncAt: 0,
    taskIds: new Set(),
    heEstados: new Map(),
    solicitudesEstados: new Map(),
    hePendientes: 0,
    solicitudesPendientes: 0,
    stockBajo: 0
};

function navegadorSoportaNotificaciones() {
    return typeof window !== 'undefined' && 'Notification' in window;
}

function notificacionesActivadas() {
    return navegadorSoportaNotificaciones() &&
        Notification.permission === 'granted' &&
        localStorage.getItem(PLANIFY_NOTIFICATIONS_ENABLED_KEY) === 'true';
}

function pushRemotoActivo() {
    return localStorage.getItem(PLANIFY_PUSH_REMOTE_KEY) === 'true';
}

function urlBase64AUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

function obtenerAudienciaNotificaciones() {
    if (estado.usuarioActual === 'trabajador') {
        return `trabajador:${obtenerTrabajadorActual()?.id || 'sin-id'}`;
    }
    return estado.usuarioActual || 'visita';
}

function cargarNotificacionesEnviadas() {
    try {
        const raw = localStorage.getItem(PLANIFY_NOTIFICATIONS_SENT_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return new Set(Array.isArray(parsed) ? parsed : []);
    } catch {
        return new Set();
    }
}

function guardarNotificacionesEnviadas(items) {
    const list = Array.from(items).slice(-250);
    localStorage.setItem(PLANIFY_NOTIFICATIONS_SENT_KEY, JSON.stringify(list));
}

function notificacionFueEnviada(key) {
    return cargarNotificacionesEnviadas().has(key);
}

function marcarNotificacionEnviada(key) {
    if (!key) return;
    const sent = cargarNotificacionesEnviadas();
    sent.add(key);
    guardarNotificacionesEnviadas(sent);
}

// Contenedor único para stackear toasts
function _toastContainer() {
    let c = document.getElementById('planify-toast-stack');
    if (!c) {
        c = document.createElement('div');
        c.id = 'planify-toast-stack';
        Object.assign(c.style, {
            position: 'fixed',
            right: '1rem',
            bottom: '1rem',
            zIndex: '10000',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.55rem',
            pointerEvents: 'none',
            maxHeight: 'calc(100vh - 2rem)',
            overflow: 'hidden'
        });
        document.body.appendChild(c);
    }
    return c;
}

const TOAST_STYLES = {
    info:    { bg: '#111827', fg: '#fff',    border: '#1f2937', icon: 'fa-circle-info'           },
    success: { bg: '#065f46', fg: '#ecfdf5', border: '#047857', icon: 'fa-circle-check'          },
    warning: { bg: '#78350f', fg: '#fffbeb', border: '#b45309', icon: 'fa-triangle-exclamation'  },
    danger:  { bg: '#7f1d1d', fg: '#fef2f2', border: '#b91c1c', icon: 'fa-circle-exclamation'    }
};

function mostrarToastNotificacion(titulo, cuerpo, opts = {}) {
    const { type = 'info', duration = 6000, onClick = null } = opts;
    const theme = TOAST_STYLES[type] || TOAST_STYLES.info;
    const c = _toastContainer();

    const toast = document.createElement('div');
    toast.setAttribute('role', 'status');
    Object.assign(toast.style, {
        width: 'min(380px, calc(100vw - 2rem))',
        background: theme.bg,
        color: theme.fg,
        padding: '0.8rem 0.95rem 0.8rem 1rem',
        borderRadius: '12px',
        borderLeft: `4px solid ${theme.border}`,
        boxShadow: '0 16px 36px rgba(15,23,42,0.28)',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '0.7rem',
        pointerEvents: 'auto',
        cursor: onClick ? 'pointer' : 'default',
        transform: 'translateX(110%)',
        transition: 'transform 220ms cubic-bezier(.4,0,.2,1), opacity 220ms'
    });
    toast.innerHTML = `
        <i class="fa-solid ${theme.icon}" style="font-size:1rem; margin-top:2px; opacity:0.95;"></i>
        <div style="flex:1; min-width:0;">
            <div style="font-weight:800; margin-bottom:0.15rem; font-size:0.93rem;">${escapeHtml(titulo)}</div>
            <div style="font-size:0.85rem; opacity:0.92; line-height:1.35;">${escapeHtml(cuerpo)}</div>
        </div>
        <button class="toast-close" aria-label="Cerrar"
            style="background:transparent; border:none; color:${theme.fg}; opacity:0.7; cursor:pointer; font-size:0.95rem; padding:0 0.1rem; line-height:1;">&times;</button>
    `;
    c.appendChild(toast);
    // animar entrada
    requestAnimationFrame(() => { toast.style.transform = 'translateX(0)'; });

    const dismiss = () => {
        toast.style.transform = 'translateX(110%)';
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 260);
    };
    toast.querySelector('.toast-close')?.addEventListener('click', (ev) => {
        ev.stopPropagation();
        dismiss();
    });
    if (onClick) {
        toast.addEventListener('click', () => { try { onClick(); } catch {} dismiss(); });
    }
    if (duration > 0) setTimeout(dismiss, duration);
}

async function enviarNotificacionPlanify({ key = '', title, body, tag = 'planify-alert', type = 'info', onClick = null }) {
    // Dedup por key
    if (key && notificacionFueEnviada(key)) return false;
    if (key) marcarNotificacionEnviada(key);

    // ① Toast in-app SIEMPRE se muestra (no requiere permiso del SO)
    mostrarToastNotificacion(title, body, { type, onClick });

    // ② Notificación nativa del SO solo si el usuario otorgó permiso + activó el flag
    if (!notificacionesActivadas()) return true; // toast suficiente

    const options = {
        body,
        tag,
        icon: './icon-512.png',
        badge: './icon-512.png',
        renotify: false
    };

    try {
        const registration = await navigator.serviceWorker?.ready;
        if (registration?.showNotification) {
            await registration.showNotification(title, options);
            return true;
        }
    } catch (error) {
        console.warn('[notificaciones] Service worker no disponible:', error);
    }

    try {
        new Notification(title, options);
        return true;
    } catch (error) {
        console.warn('[notificaciones] No se pudo mostrar notificacion:', error);
        return false;
    }
}

async function registrarPushRemotoPlanify() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        localStorage.setItem(PLANIFY_PUSH_REMOTE_KEY, 'false');
        return false;
    }
    try {
        const keyResponse = await fetch('./push/vapid-public-key', { cache: 'no-store' });
        if (!keyResponse.ok) throw new Error('Servidor push no configurado');
        const keyData = await keyResponse.json();
        if (!keyData?.enabled || !keyData.publicKey) throw new Error(keyData?.message || 'Servidor push no configurado');

        const registration = await navigator.serviceWorker.ready;
        let subscription = await registration.pushManager.getSubscription();
        if (!subscription) {
            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64AUint8Array(keyData.publicKey)
            });
        }
        const trabajador = obtenerTrabajadorActual();
        const saveResponse = await fetch('./push/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                subscription,
                role: estado.usuarioActual || 'visita',
                trabajadorId: estado.usuarioActual === 'trabajador' ? trabajador?.id || null : null,
                trabajadorNombre: estado.usuarioActual === 'trabajador' ? trabajador?.nombre || null : null,
                userAgent: navigator.userAgent
            })
        });
        if (!saveResponse.ok) throw new Error('No se pudo guardar la suscripcion push');
        localStorage.setItem(PLANIFY_PUSH_REMOTE_KEY, 'true');
        return true;
    } catch (error) {
        console.warn('[push] Push remoto no disponible:', error.message);
        localStorage.setItem(PLANIFY_PUSH_REMOTE_KEY, 'false');
        return false;
    }
}

async function desregistrarPushRemotoPlanify() {
    localStorage.setItem(PLANIFY_PUSH_REMOTE_KEY, 'false');
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (!subscription) return;
        await fetch('./push/unsubscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: subscription.endpoint })
        }).catch(() => {});
        await subscription.unsubscribe();
    } catch (error) {
        console.warn('[push] No se pudo desregistrar push remoto:', error.message);
    }
}

function tareaNotificableParaUsuario(tarea) {
    if (!tarea || estado.usuarioActual === 'visita') return false;
    if (estado.usuarioActual === 'admin') return true;
    const trabajadorId = obtenerTrabajadorActual()?.id;
    if (!trabajadorId) return false;
    return String(tarea.liderId) === String(trabajadorId) ||
        (tarea.ayudantesIds || []).some((id) => String(id) === String(trabajadorId)) ||
        String(tarea.vigiaId || '') === String(trabajadorId);
}

function tareaEstaActivaParaNotificar(tarea) {
    const estadoTarea = String(tarea?.estadoTarea || '').toLowerCase();
    const estadoEjecucion = String(tarea?.estadoEjecucion || 'activo').toLowerCase();
    if (estadoEjecucion === 'finalizado' || estadoEjecucion === 'cerrado') return false;
    return ['en_curso', 'programada_semana', 'pendiente', 'programada'].includes(estadoTarea);
}

function tareasRelevantesParaNotificar() {
    return (estado.tareas || [])
        .filter(tareaEstaActivaParaNotificar)
        .filter(tareaNotificableParaUsuario);
}

function describirTareaParaNotificacion(tarea) {
    const partes = [
        tarea.otNumero ? `OT ${tarea.otNumero}` : '',
        tarea.tipo || 'Trabajo',
        tarea.ubicacion || ''
    ].filter(Boolean);
    return partes.join(' - ');
}

function obtenerConteosNotificables() {
    const hePendientes = estado.usuarioActual === 'admin'
        ? (estado.horasExtra || []).filter((item) => item.estado === 'pendiente').length
        : 0;
    const solicitudesPendientes = usuarioPuedeAprobarInsumos()
        ? (estado.solicitudesInsumos || []).filter((item) => item.estado === 'pendiente').length
        : 0;
    const stockBajo = estado.usuarioActual === 'admin'
        ? obtenerInsumosStockBajo().length
        : 0;
    return { hePendientes, solicitudesPendientes, stockBajo };
}

function horasExtraNotificables() {
    const registros = estado.horasExtra || [];
    if (estado.usuarioActual === 'admin') return registros;
    const trabajadorId = obtenerTrabajadorActual()?.id;
    if (!trabajadorId) return [];
    return registros.filter((item) => String(item.trabajador_id || '') === String(trabajadorId));
}

function solicitudesInsumosNotificables() {
    const solicitudes = estado.solicitudesInsumos || [];
    if (estado.usuarioActual === 'admin' || usuarioPuedeAprobarInsumos()) return solicitudes;
    const trabajadorId = usuarioSolicitanteActualId();
    if (!trabajadorId) return [];
    return solicitudes.filter((item) => String(item.trabajador_id || '') === String(trabajadorId));
}

function crearMapaEstados(items = []) {
    return new Map(items.map((item) => [String(item.id), String(item.estado || 'pendiente')]));
}

function prepararLineaBaseNotificaciones() {
    planifyNotifications.taskIds = new Set(tareasRelevantesParaNotificar().map((tarea) => String(tarea.id)));
    planifyNotifications.heEstados = crearMapaEstados(horasExtraNotificables());
    planifyNotifications.solicitudesEstados = crearMapaEstados(solicitudesInsumosNotificables());
    const conteos = obtenerConteosNotificables();
    planifyNotifications.hePendientes = conteos.hePendientes;
    planifyNotifications.solicitudesPendientes = conteos.solicitudesPendientes;
    planifyNotifications.stockBajo = conteos.stockBajo;
    planifyNotifications.initialized = true;
}

function normalizarTareaPlanify(t) {
    return {
        id: t.id, tipo: t.tipo,
        liderId: t.lider_id || t.liderId, liderNombre: t.lider_nombre || t.liderNombre,
        ayudantesIds: t.ayudantes_ids || t.ayudantesIds || [],
        ayudantesNombres: t.ayudantes_nombres || t.ayudantesNombres || [],
        estadoTarea: t.estado_tarea || t.estadoTarea, otNumero: t.ot_numero || t.otNumero,
        horaAsignacion: t.hora_asignacion || t.horaAsignacion,
        fechaAsignacion: t.created_at || t.fechaAsignacion || null,
        estadoEjecucion: t.estado_ejecucion || t.estadoEjecucion || 'activo',
        fechaExpiracion: t.fecha_expiracion || t.fechaExpiracion || null,
        equipoId: t.equipo_id || t.equipoId || null,
        tiposSeleccionados: t.tipos_trabajo || t.tiposSeleccionados || [],
        componentesSeleccionados: t.componentes_trabajo || t.componentesSeleccionados || [],
        ubicacion: t.ubicacion || null,
        espacioConfinado: !!(t.espacio_confinado ?? t.espacioConfinado),
        vigiaId: t.vigia_id || t.vigiaId || null,
        vigiaNombre: t.vigia_nombre || t.vigiaNombre || null,
        orden: t.orden || 0
    };
}

function crearFirmaDatosNotificables() {
    const tareas = (estado.tareas || [])
        .map((tarea) => `${tarea.id}:${tarea.estadoTarea}:${tarea.estadoEjecucion}:${tarea.fechaExpiracion || ''}:${tarea.liderId || ''}:${(tarea.ayudantesIds || []).join(',')}`)
        .sort()
        .join('|');
    const he = (estado.horasExtra || [])
        .map((item) => `${item.id}:${item.estado || 'pendiente'}`)
        .sort()
        .join('|');
    const solicitudes = (estado.solicitudesInsumos || [])
        .map((item) => `${item.id}:${item.estado || 'pendiente'}`)
        .sort()
        .join('|');
    const stock = obtenerInsumosStockBajo().map((item) => `${item.id}:${item.stock_actual}`).sort().join('|');
    return `${tareas}::${he}::${solicitudes}::${stock}`;
}

async function sincronizarDatosParaNotificaciones({ force = false, renderOnChange = true } = {}) {
    if (!notificacionesActivadas() || estado.usuarioActual === 'visita') return false;
    if (!navigator.onLine || !supabaseClient) {
        await evaluarNotificacionesPlanify();
        return false;
    }
    const ahora = Date.now();
    if (!force && ahora - planifyNotifications.lastSyncAt < 25000) return false;
    if (planifyNotifications.syncInFlight) return false;

    planifyNotifications.syncInFlight = true;
    planifyNotifications.lastSyncAt = ahora;
    const firmaAnterior = crearFirmaDatosNotificables();

    try {
        const fetches = [
            supabaseClient.from('tareas').select('*').then(({ data, error }) => {
                if (error || !Array.isArray(data)) return;
                estado.tareas = data.map(normalizarTareaPlanify);
                if (window.localDB) window.localDB.tareas.bulk(estado.tareas).catch(() => {});
            })
        ];

        fetches.push(
            supabaseClient.from('horas_extra').select('*').order('created_at', { ascending: false }).then(({ data }) => {
                if (!Array.isArray(data)) return;
                estado.horasExtra = data.map((item) => ({ ...item, estado: item.estado || 'pendiente', synced: true }));
                if (window.localDB) window.localDB.horas_extra.bulk(estado.horasExtra).catch(() => {});
            }).catch(() => {})
        );

        if (estado.usuarioActual === 'admin' || usuarioPuedeAprobarInsumos() || estado.usuarioActual === 'trabajador') {
            fetches.push(refrescarDatosInsumos({ preferRemote: true }).catch(() => null));
        }

        await Promise.all(fetches);
        await evaluarNotificacionesPlanify();

        const huboCambios = crearFirmaDatosNotificables() !== firmaAnterior;
        if (huboCambios) {
            if (estado.usuarioActual === 'admin') actualizarBadgeHE();
            actualizarBadgeInsumos();
            if (renderOnChange && document.visibilityState === 'visible') {
                solicitarRenderRealtimeNoIntrusivo();
            }
        }
        return huboCambios;
    } catch (error) {
        console.warn('[notificaciones] No se pudo refrescar datos:', error);
        return false;
    } finally {
        planifyNotifications.syncInFlight = false;
    }
}

async function evaluarNotificacionesPlanify() {
    if (!notificacionesActivadas() || estado.usuarioActual === 'visita') return;
    if (!planifyNotifications.initialized) prepararLineaBaseNotificaciones();

    const audiencia = obtenerAudienciaNotificaciones();
    const tareas = tareasRelevantesParaNotificar();
    const idsActuales = new Set(tareas.map((tarea) => String(tarea.id)));

    for (const tarea of tareas) {
        const tareaId = String(tarea.id);
        if (!planifyNotifications.taskIds.has(tareaId)) {
            const esTrabajador = estado.usuarioActual === 'trabajador';
            await enviarNotificacionPlanify({
                key: `${audiencia}:tarea-nueva:${tareaId}`,
                title: esTrabajador ? 'Nuevo trabajo asignado' : 'Nuevo trabajo en Planify',
                body: describirTareaParaNotificacion(tarea),
                tag: `planify-task-${tareaId}`,
                type: 'info',
                onClick: () => { try { window.mostrarVista?.('dashboard'); } catch {} }
            });
        }

        if (tarea.fechaExpiracion) {
            const vence = new Date(tarea.fechaExpiracion);
            const restante = vence.getTime() - Date.now();
            if (!Number.isNaN(vence.getTime()) && restante > 0 && restante <= PLANIFY_NOTIFICATION_LEAD_MS) {
                await enviarNotificacionPlanify({
                    key: `${audiencia}:tarea-vence:${tareaId}:${tarea.fechaExpiracion}`,
                    title: 'Trabajo por vencer',
                    body: `${describirTareaParaNotificacion(tarea)} vence ${formatearFechaHora(tarea.fechaExpiracion)}.`,
                    tag: `planify-due-${tareaId}`,
                    type: 'warning'
                });
            } else if (!Number.isNaN(vence.getTime()) && restante <= 0) {
                await enviarNotificacionPlanify({
                    key: `${audiencia}:tarea-vencida:${tareaId}:${tarea.fechaExpiracion}`,
                    title: 'Trabajo vencido',
                    body: `${describirTareaParaNotificacion(tarea)} supero su fecha limite.`,
                    tag: `planify-expired-${tareaId}`,
                    type: 'danger'
                });
            }
        }
    }

    const conteos = obtenerConteosNotificables();
    if (conteos.hePendientes > planifyNotifications.hePendientes) {
        await enviarNotificacionPlanify({
            key: `${audiencia}:he-pendientes:${conteos.hePendientes}`,
            title: 'Horas extra pendientes',
            body: `Hay ${conteos.hePendientes} solicitud(es) esperando revision.`,
            tag: 'planify-he-pendientes',
            type: 'warning',
            onClick: () => { try { window.mostrarVista?.('horas-extra'); } catch {} }
        });
    }
    if (conteos.solicitudesPendientes > planifyNotifications.solicitudesPendientes) {
        await enviarNotificacionPlanify({
            key: `${audiencia}:insumos-pendientes:${conteos.solicitudesPendientes}`,
            title: 'Solicitudes de insumos pendientes',
            body: `Hay ${conteos.solicitudesPendientes} solicitud(es) de insumos por resolver.`,
            tag: 'planify-insumos-pendientes',
            type: 'warning',
            onClick: () => { try { window.mostrarVista?.('insumos'); } catch {} }
        });
    }
    if (conteos.stockBajo > planifyNotifications.stockBajo) {
        const primero = obtenerInsumosStockBajo()[0];
        await enviarNotificacionPlanify({
            key: `${audiencia}:stock-bajo:${conteos.stockBajo}:${primero?.id || 'catalogo'}`,
            title: 'Stock bajo en inventario',
            body: primero
                ? `${primero.nombre}: quedan ${enteroSeguro(primero.stock_actual, 0)} ${normalizarUnidadInsumo(primero.unidad).toLowerCase()}.`
                : `Hay ${conteos.stockBajo} insumo(s) bajo minimo.`,
            tag: 'planify-stock-bajo',
            type: 'danger',
            onClick: () => { try { window.mostrarVista?.('insumos'); } catch {} }
        });
    }

    for (const registro of horasExtraNotificables()) {
        const id = String(registro.id);
        const estadoAnterior = planifyNotifications.heEstados.get(id);
        const estadoActual = String(registro.estado || 'pendiente');
        if (estado.usuarioActual === 'trabajador' && estadoAnterior === 'pendiente' && estadoActual !== 'pendiente') {
            await enviarNotificacionPlanify({
                key: `${audiencia}:he-estado:${id}:${estadoActual}`,
                title: estadoActual === 'aprobado' ? 'Horas extra aprobadas' : 'Horas extra rechazadas',
                body: `${formatearFechaCorta(registro.fecha)} - ${registro.horas || 0} hora(s).`,
                tag: `planify-he-${id}`,
                type: estadoActual === 'aprobado' ? 'success' : 'danger'
            });
        }
    }

    for (const solicitud of solicitudesInsumosNotificables()) {
        const id = String(solicitud.id);
        const estadoAnterior = planifyNotifications.solicitudesEstados.get(id);
        const estadoActual = String(solicitud.estado || 'pendiente');
        if (estado.usuarioActual === 'trabajador' && estadoAnterior === 'pendiente' && estadoActual !== 'pendiente') {
            await enviarNotificacionPlanify({
                key: `${audiencia}:insumo-estado:${id}:${estadoActual}`,
                title: estadoActual === 'aprobada' ? 'Solicitud de insumo aprobada' : 'Solicitud de insumo rechazada',
                body: `${solicitud.insumo_nombre || 'Insumo'} - ${formatearCantidadInsumo(solicitud.cantidad || 0, solicitud.unidad || 'UNI')}.`,
                tag: `planify-insumo-${id}`,
                type: estadoActual === 'aprobada' ? 'success' : 'danger'
            });
        }
    }

    planifyNotifications.taskIds = idsActuales;
    planifyNotifications.heEstados = crearMapaEstados(horasExtraNotificables());
    planifyNotifications.solicitudesEstados = crearMapaEstados(solicitudesInsumosNotificables());
    planifyNotifications.hePendientes = conteos.hePendientes;
    planifyNotifications.solicitudesPendientes = conteos.solicitudesPendientes;
    planifyNotifications.stockBajo = conteos.stockBajo;
}

function iniciarMonitorNotificaciones({ resetBaseline = false } = {}) {
    if (resetBaseline || !planifyNotifications.initialized) prepararLineaBaseNotificaciones();
    if (planifyNotifications.intervalId) clearInterval(planifyNotifications.intervalId);
    planifyNotifications.intervalId = setInterval(() => {
        sincronizarDatosParaNotificaciones();
    }, 60000);
    setTimeout(() => sincronizarDatosParaNotificaciones({ force: true, renderOnChange: false }), 1200);
}

async function activarNotificacionesPlanify() {
    if (!navegadorSoportaNotificaciones()) {
        alert('Este navegador no soporta notificaciones.');
        return;
    }
    const permiso = Notification.permission === 'granted'
        ? 'granted'
        : await Notification.requestPermission();
    if (permiso !== 'granted') {
        localStorage.setItem(PLANIFY_NOTIFICATIONS_ENABLED_KEY, 'false');
        alert('Las notificaciones quedaron bloqueadas. Puedes habilitarlas desde los permisos del navegador.');
        renderizarVistaActual();
        return;
    }
    localStorage.setItem(PLANIFY_NOTIFICATIONS_ENABLED_KEY, 'true');
    iniciarMonitorNotificaciones({ resetBaseline: true });
    const pushRemoto = await registrarPushRemotoPlanify();
    await enviarNotificacionPlanify({
        title: 'Notificaciones activadas',
        body: pushRemoto
            ? 'Planify tambien podra avisarte cuando no estes dentro de la app.'
            : 'Planify te avisara mientras la app este abierta o en segundo plano.',
        tag: 'planify-notificaciones-activadas',
        type: 'success'
    });
    renderizarVistaActual();
}

async function desactivarNotificacionesPlanify() {
    localStorage.setItem(PLANIFY_NOTIFICATIONS_ENABLED_KEY, 'false');
    if (planifyNotifications.intervalId) clearInterval(planifyNotifications.intervalId);
    planifyNotifications.intervalId = null;
    planifyNotifications.initialized = false;
    await desregistrarPushRemotoPlanify();
    renderizarVistaActual();
}

function renderNotificacionesPerfilHtml() {
    const soportadas = navegadorSoportaNotificaciones();
    const permiso = soportadas ? Notification.permission : 'unsupported';
    const activas = notificacionesActivadas();
    const bloqueadas = permiso === 'denied';
    const titulo = !soportadas
        ? 'No soportadas'
        : activas
            ? 'Activas'
            : bloqueadas
                ? 'Bloqueadas'
                : 'Disponibles';
    const detalle = !soportadas
        ? 'Este navegador no permite notificaciones.'
        : activas
            ? (pushRemotoActivo()
                ? 'Push remoto activo: recibiras avisos aunque no estes dentro de la app.'
                : 'Recibiras avisos mientras Planify este abierta o en segundo plano. Falta servidor push para app cerrada.')
            : bloqueadas
                ? 'El permiso esta bloqueado desde el navegador. Revisa la configuracion del sitio para habilitarlo.'
                : 'Activalas para recibir avisos; si el servidor push esta disponible tambien llegaran con la app cerrada.';
    const icono = activas ? 'fa-bell' : bloqueadas ? 'fa-bell-slash' : 'fa-bell';
    const boton = activas
        ? `<button id="btn-notificaciones-toggle" type="button" class="btn btn-outline"><i class="fa-solid fa-bell-slash"></i> Desactivar</button>`
        : `<button id="btn-notificaciones-toggle" type="button" class="btn btn-primary" ${!soportadas || bloqueadas ? 'disabled' : ''}><i class="fa-solid fa-bell"></i> Activar notificaciones</button>`;

    return `
        <section class="panel">
            <div class="profile-header">
                <div class="profile-header-main">
                    <div style="width:48px;height:48px;border-radius:12px;background:#fff7ed;color:var(--primary-color);display:flex;align-items:center;justify-content:center;font-size:1.25rem;flex-shrink:0;">
                        <i class="fa-solid ${icono}"></i>
                    </div>
                    <div>
                        <h2 style="margin:0;font-size:1.05rem;">Notificaciones</h2>
                        <div class="profile-role">${titulo}</div>
                        <p style="margin:0.35rem 0 0;color:var(--text-muted);font-size:0.92rem;">${detalle}</p>
                    </div>
                </div>
                <div class="profile-actions">
                    ${boton}
                    ${activas ? `<button id="btn-notificaciones-test" type="button" class="btn btn-outline"><i class="fa-solid fa-paper-plane"></i> Probar</button>` : ''}
                </div>
            </div>
        </section>
    `;
}

function conectarBotonesNotificacionesPerfil() {
    document.getElementById('btn-notificaciones-toggle')?.addEventListener('click', () => {
        if (notificacionesActivadas()) {
            desactivarNotificacionesPlanify();
        } else {
            activarNotificacionesPlanify();
        }
    });
    document.getElementById('btn-notificaciones-test')?.addEventListener('click', () => {
        enviarNotificacionPlanify({
            title: 'Prueba de Planify',
            body: 'Las notificaciones estan funcionando correctamente.',
            tag: 'planify-test'
        });
    });
}

function registrarResyncNotificaciones() {
    if (registrarResyncNotificaciones.instalado) return;
    registrarResyncNotificaciones.instalado = true;

    const resync = (force = false) => {
        if (!notificacionesActivadas() || estado.usuarioActual === 'visita') return;
        sincronizarDatosParaNotificaciones({ force });
    };

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') resync(true);
    });
    window.addEventListener('focus', () => resync(true));
    window.addEventListener('pageshow', () => resync(true));
    window.addEventListener('online', () => resync(true));
}

async function refrescarDatosInsumos({ preferRemote = true } = {}) {
    let catalogoLocal = [];
    let solicitudesLocal = [];
    let movimientosLocal = [];

    if (window.localDB) {
        [catalogoLocal, solicitudesLocal, movimientosLocal] = await Promise.all([
            window.localDB.insumos.getAll().catch(() => []),
            window.localDB.solicitudes_insumos.getAll().catch(() => []),
            window.localDB.movimientos_inventario.getAll().catch(() => [])
        ]);
    }

    let catalogo = (catalogoLocal || []).map((item) => normalizarRegistroInsumo(item)).filter((item) => item.nombre);
    let solicitudes = (solicitudesLocal || []).map((item) => normalizarSolicitudInsumo(item));
    let movimientos = (movimientosLocal || []).map((item) => normalizarMovimientoInventario(item));

    if (preferRemote && navigator.onLine && supabaseClient) {
        if (insumosFeatureState.tablasRemotas.insumos) {
            const { data, error } = await supabaseClient
                .from(tablasDb.insumos)
                .select('*')
                .order('codigo', { ascending: true });
            if (!error && Array.isArray(data)) {
                const merged = new Map();
                data.map((item) => normalizarRegistroInsumo(item)).forEach((item) => {
                    merged.set(String(item.codigo || item.id), item);
                });
                catalogo.forEach((item) => {
                    const key = String(item.codigo || item.id);
                    if (!merged.has(key)) merged.set(key, item);
                });
                catalogo = [...merged.values()];
                if (window.localDB) {
                    await window.localDB.insumos.clear().catch(() => {});
                    if (catalogo.length) await window.localDB.insumos.bulk(catalogo).catch(() => {});
                }
            }
        }

        if (insumosFeatureState.tablasRemotas.solicitudes) {
            const { data, error } = await supabaseClient
                .from(tablasDb.solicitudesInsumos)
                .select('*')
                .order('created_at', { ascending: false });
            if (!error && Array.isArray(data)) {
                const merged = new Map();
                data.map((item) => normalizarSolicitudInsumo(item)).forEach((item) => {
                    merged.set(String(item.id), item);
                });
                solicitudes.forEach((item) => {
                    if (!merged.has(String(item.id))) merged.set(String(item.id), item);
                });
                solicitudes = [...merged.values()];
                if (window.localDB) {
                    await window.localDB.solicitudes_insumos.clear().catch(() => {});
                    if (solicitudes.length) await window.localDB.solicitudes_insumos.bulk(solicitudes).catch(() => {});
                }
            }
        }

        if (insumosFeatureState.tablasRemotas.movimientos) {
            const { data, error } = await supabaseClient
                .from(tablasDb.movimientosInventario)
                .select('*')
                .order('fecha', { ascending: false })
                .limit(200);
            if (!error && Array.isArray(data)) {
                const merged = new Map();
                data.map((item) => normalizarMovimientoInventario(item)).forEach((item) => {
                    merged.set(String(item.id), item);
                });
                movimientos.forEach((item) => {
                    if (!merged.has(String(item.id))) merged.set(String(item.id), item);
                });
                movimientos = [...merged.values()];
                if (window.localDB) {
                    await window.localDB.movimientos_inventario.clear().catch(() => {});
                    if (movimientos.length) await window.localDB.movimientos_inventario.bulk(movimientos).catch(() => {});
                }
            }
        }
    }

    estado.insumos = [...catalogo].sort(ordenarCatalogoInsumos);
    estado.solicitudesInsumos = [...solicitudes].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    estado.movimientosInventario = [...movimientos].sort((a, b) => new Date(b.fecha || b.created_at || 0) - new Date(a.fecha || a.created_at || 0));

    return {
        insumos: estado.insumos,
        solicitudes: estado.solicitudesInsumos,
        movimientos: estado.movimientosInventario
    };
}

// --- FUNCIONES DE PERSISTENCIA (SUPABASE) ---

async function inicializarDatos() {
    // Inicializar IndexedDB y mostrar estado de conexión
    if (window.localDB) await window.localDB.init();
    if (window.syncQueue) window.syncQueue.actualizar();

    try {
        // Si el SDK de Supabase no se cargó (offline sin caché de CDN), ir directo a IndexedDB
        if (!supabaseClient) throw new Error('Supabase SDK no disponible — modo offline sin caché CDN');

        console.log('Cargando datos desde Supabase...');

        const _timeout = ms => new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Timeout de conexión')), ms)
        );

        // Cargar datos principales en paralelo (timeout 8s)
        const [
            { data: trabajadores, error: errT },
            { data: tareas,       error: errTr },
            equipos
        ] = await Promise.race([
            Promise.all([
                supabaseClient.from('trabajadores').select('*'),
                supabaseClient.from('tareas').select('*'),
                fetchAllEquipos()
            ]),
            _timeout(8000)
        ]);
        if (errT)  throw errT;
        if (errTr) throw errTr;

        estado.trabajadores = (trabajadores || []).map(t => ({
            ...t,
            disponible: _checkinVigente(t)
        }));
        estado.tareas = (tareas || []).map(t => ({
            id: t.id, tipo: t.tipo,
            liderId: t.lider_id, liderNombre: t.lider_nombre,
            ayudantesIds: t.ayudantes_ids || [], ayudantesNombres: t.ayudantes_nombres || [],
            estadoTarea: t.estado_tarea, otNumero: t.ot_numero,
            horaAsignacion: t.hora_asignacion,
            fechaAsignacion: t.created_at || null,
            estadoEjecucion: t.estado_ejecucion || 'activo',
            fechaExpiracion: t.fecha_expiracion || null,
            equipoId: t.equipo_id || null,
            tiposSeleccionados: t.tipos_trabajo || [],
            componentesSeleccionados: t.componentes_trabajo || [],
            ubicacion: t.ubicacion || null,
            espacioConfinado: !!t.espacio_confinado,
            vigiaId: t.vigia_id || null,
            vigiaNombre: t.vigia_nombre || null,
            orden: t.orden || 0
        }));
        estado.equipos = equipos || [];

        // Resolver tablas opcionales en paralelo
        const [tablaMediciones, tablaHistorial, tablaInsumos, tablaSolicitudesInsumos, tablaMovimientosInventario, permisosAprobadores] = await Promise.all([
            resolverTabla(['mediciones', 'historial_mediciones']),
            resolverTabla(['historial_tareas', 'tareas_historial']),
            resolverTabla(['insumos']),
            resolverTabla(['solicitudes_insumos']),
            resolverTabla(['movimientos_inventario']),
            supabaseClient
                .from('trabajadores')
                .select('id, puede_aprobar_insumos')
                .limit(1)
                .then(({ error }) => !error)
                .catch(() => false)
        ]);
        if (tablaMediciones) tablasDb.mediciones = tablaMediciones;
        if (tablaHistorial)  tablasDb.historial  = tablaHistorial;
        if (tablaInsumos) tablasDb.insumos = tablaInsumos;
        if (tablaSolicitudesInsumos) tablasDb.solicitudesInsumos = tablaSolicitudesInsumos;
        if (tablaMovimientosInventario) tablasDb.movimientosInventario = tablaMovimientosInventario;
        insumosFeatureState.tablasRemotas.insumos = Boolean(tablaInsumos);
        insumosFeatureState.tablasRemotas.solicitudes = Boolean(tablaSolicitudesInsumos);
        insumosFeatureState.tablasRemotas.movimientos = Boolean(tablaMovimientosInventario);
        insumosFeatureState.aprobadoresPersistentes = Boolean(permisosAprobadores);

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
        await refrescarDatosInsumos({ preferRemote: true });

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

        // Timer: a las 20:00 hace el reset UNA SOLA VEZ por día (turnos de noche pueden loguear después)
        setInterval(() => {
            const ahora = new Date();
            const hoy = ahora.toDateString();
            const ultimoReset = localStorage.getItem('ultimo_reset_checkin');
            if (ahora.getHours() >= 20 && ultimoReset !== hoy) {
                // Primera vez que llegamos a las 20:00 hoy → reset
                estado.trabajadores = estado.trabajadores.map(t => ({ ...t, disponible: false }));
                resetCheckInSiNecesario();
                renderizarVistaActual();
            }
        }, 60000);

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
                estado.trabajadores = (trabajadores || []).map(t => ({
                    ...t,
                    disponible: _checkinVigente(t)
                }));
                estado.tareas             = (tareas || []).map(t => ({
                    id: t.id, tipo: t.tipo,
                    liderId: t.lider_id || t.liderId, liderNombre: t.lider_nombre || t.liderNombre,
                    ayudantesIds: t.ayudantes_ids || t.ayudantesIds || [],
                    ayudantesNombres: t.ayudantes_nombres || t.ayudantesNombres || [],
                    estadoTarea: t.estado_tarea || t.estadoTarea, otNumero: t.ot_numero || t.otNumero,
                    horaAsignacion: t.hora_asignacion || t.horaAsignacion,
                    fechaAsignacion: t.created_at || t.fechaAsignacion || null,
                    estadoEjecucion: t.estado_ejecucion || t.estadoEjecucion || 'activo',
                    fechaExpiracion: t.fecha_expiracion || t.fechaExpiracion || null,
                    equipoId: t.equipo_id || t.equipoId || null,
                    tiposSeleccionados: t.tipos_trabajo || t.tiposSeleccionados || [],
                    componentesSeleccionados: t.componentes_trabajo || t.componentesSeleccionados || [],
                    ubicacion: t.ubicacion || null,
                    espacioConfinado: !!(t.espacio_confinado ?? t.espacioConfinado),
                    vigiaId: t.vigia_id || t.vigiaId || null,
                    vigiaNombre: t.vigia_nombre || t.vigiaNombre || null
                }));
                estado.equipos            = equipos    || [];
                estado.historialTareas    = historial  || [];
                estado.historialMediciones = mediciones || [];
                await refrescarDatosInsumos({ preferRemote: false });
                console.log('[offline] Datos locales cargados correctamente.');
                if (window.syncQueue) window.syncQueue.actualizar();
                window.syncQueue?.procesar();
                renderizarVistaActual();
                return;
            } catch (localErr) {
                console.error('[offline] Error cargando datos locales:', localErr);
            }
        }
        await refrescarDatosInsumos({ preferRemote: false });
        alert('Hubo un error al conectar con la base de datos: ' + (error?.message || error) + '. Se usaran datos de respaldo.');
    }
}

// Verifica si el check-in de un trabajador sigue vigente (mismo día)
// No bloquea por hora — el reset de las 20:00 ocurre una sola vez y permite turnos de noche
function _checkinVigente(t) {
    if (!t.disponible) return false;
    if (!t.checkin_fecha) return false;
    const hoy = new Date().toISOString().slice(0, 10);
    return (t.checkin_fecha.slice(0, 10) === hoy);
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
    let pendingInsumos = false;
    let pendingSolicitudesInsumos = false;
    let pendingMovimientosInventario = false;
    let pendingHistorial = false;
    let pendingMediciones = false;
    let pendingHorasExtra = false;
    let pendingEquipos = false;

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
                    estadoEjecucion: t.estado_ejecucion || 'activo',
                    fechaExpiracion: t.fecha_expiracion || null,
                    equipoId: t.equipo_id || null,
                    tiposSeleccionados: t.tipos_trabajo || [],
                    componentesSeleccionados: t.componentes_trabajo || [],
                    ubicacion: t.ubicacion || null,
                    espacioConfinado: !!t.espacio_confinado,
                    vigiaId: t.vigia_id || null,
                    vigiaNombre: t.vigia_nombre || null
                }));
            })
        );
        if (pendingTrabajadores) fetches.push(
            supabaseClient.from('trabajadores').select('*').then(({ data }) => {
                estado.trabajadores = data || [];
            })
        );
        if (pendingInsumos && insumosFeatureState.tablasRemotas.insumos) fetches.push(
            supabaseClient.from(tablasDb.insumos).select('*').order('codigo', { ascending: true }).then(({ data }) => {
                estado.insumos = (data || []).map((item) => normalizarRegistroInsumo(item)).sort(ordenarCatalogoInsumos);
                window.localDB?.insumos.clear().catch(() => {});
                if (data?.length) window.localDB?.insumos.bulk(estado.insumos).catch(() => {});
            })
        );
        if (pendingSolicitudesInsumos && insumosFeatureState.tablasRemotas.solicitudes) fetches.push(
            supabaseClient.from(tablasDb.solicitudesInsumos).select('*').order('created_at', { ascending: false }).then(({ data }) => {
                estado.solicitudesInsumos = (data || []).map((item) => normalizarSolicitudInsumo(item));
                window.localDB?.solicitudes_insumos.clear().catch(() => {});
                if (data?.length) window.localDB?.solicitudes_insumos.bulk(estado.solicitudesInsumos).catch(() => {});
            })
        );
        if (pendingMovimientosInventario && insumosFeatureState.tablasRemotas.movimientos) fetches.push(
            supabaseClient.from(tablasDb.movimientosInventario).select('*').order('fecha', { ascending: false }).limit(200).then(({ data }) => {
                estado.movimientosInventario = (data || []).map((item) => normalizarMovimientoInventario(item));
                window.localDB?.movimientos_inventario.clear().catch(() => {});
                if (data?.length) window.localDB?.movimientos_inventario.bulk(estado.movimientosInventario).catch(() => {});
            })
        );
        if (pendingHistorial && tablasDb.historial) fetches.push(
            supabaseClient.from(tablasDb.historial).select('*').order('created_at', { ascending: false }).limit(200).then(({ data }) => {
                estado.historialTareas = data || [];
                if (data?.length) window.localDB?.historial.bulk(data).catch(() => {});
            })
        );
        if (pendingMediciones && tablasDb.mediciones) fetches.push(
            supabaseClient.from(tablasDb.mediciones).select('*').order('fecha', { ascending: false }).limit(200).then(({ data }) => {
                estado.historialMediciones = data || [];
                if (data?.length) window.localDB?.mediciones.bulk(data).catch(() => {});
            })
        );
        if (pendingHorasExtra) fetches.push(
            supabaseClient.from('horas_extra').select('*').then(({ data }) => {
                if (Array.isArray(data)) {
                    estado.horasExtra = data;
                    window.localDB?.horas_extra.bulk(data).catch(() => {});
                }
            }).catch(() => {})
        );
        if (pendingEquipos) fetches.push(
            fetchAllEquipos().then((equipos) => { estado.equipos = equipos || []; })
        );
        pendingTareas = false;
        pendingTrabajadores = false;
        pendingInsumos = false;
        pendingSolicitudesInsumos = false;
        pendingMovimientosInventario = false;
        pendingHistorial = false;
        pendingMediciones = false;
        pendingHorasExtra = false;
        pendingEquipos = false;
        await Promise.all(fetches);
        evaluarNotificacionesPlanify();
        solicitarRenderRealtimeNoIntrusivo();
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
        .on('postgres_changes', { event: '*', schema: 'public', table: 'insumos' }, () => {
            pendingInsumos = true;
            scheduleFlush();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'solicitudes_insumos' }, () => {
            pendingSolicitudesInsumos = true;
            pendingInsumos = true;
            pendingMovimientosInventario = true;
            scheduleFlush();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'movimientos_inventario' }, () => {
            pendingMovimientosInventario = true;
            scheduleFlush();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'equipos' }, () => {
            pendingEquipos = true;
            scheduleFlush();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'historial_tareas' }, () => {
            pendingHistorial = true;
            scheduleFlush();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tareas_historial' }, () => {
            pendingHistorial = true;
            scheduleFlush();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'mediciones' }, () => {
            pendingMediciones = true;
            scheduleFlush();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'historial_mediciones' }, () => {
            pendingMediciones = true;
            scheduleFlush();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'horas_extra' }, () => {
            pendingHorasExtra = true;
            scheduleFlush();
        })
        .subscribe();
}

async function updateTrabajadorDisponibilidad(id, disponible) {
    const payload = { disponible, ocupado: false };
    if (disponible) payload.checkin_fecha = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
    await _db.update('trabajadores', id, payload);
}

async function asignarTarea(tipo, liderId, ayudantesIds, estadoTarea = 'en_curso', otNumero = null, estadoEjecucion = 'activo', fechaExpiracion = null, equipoId = null, tiposSeleccionados = [], componentesSeleccionados = [], ubicacion = null, espacioConfinado = false, vigiaId = null) {
    const lider = estado.trabajadores.find(t => t.id === liderId);
    const ayudantesNombres = ayudantesIds.map(id => {
        const t = estado.trabajadores.find(x => x.id === id);
        return t ? t.nombre : 'Desconocido';
    });

    // Si algún ayudante ya tiene tarea activa → forzar a cola (programada_semana)
    if (estadoTarea === 'en_curso' && ayudantesIds.length > 0) {
        const idsEnTarea = new Set(
            estado.tareas
                .filter(t => t.estadoTarea === 'en_curso')
                .flatMap(t => [t.liderId, ...(t.ayudantesIds || [])].filter(Boolean))
        );
        const ocupados = ayudantesIds.filter(aid => idsEnTarea.has(aid));
        if (ocupados.length > 0) {
            estadoTarea = 'programada_semana';
            estadoEjecucion = 'activo';
            const nombres = ocupados.map(aid => estado.trabajadores.find(t => t.id === aid)?.nombre).join(', ');
            const toast = document.createElement('div');
            toast.textContent = `⚡ ${nombres} ya tiene trabajo activo. Tarea enviada a cola.`;
            Object.assign(toast.style, {
                position:'fixed', bottom:'1.5rem', left:'50%', transform:'translateX(-50%)',
                background:'#92400e', color:'white', padding:'0.75rem 1.25rem',
                borderRadius:'10px', fontSize:'0.88rem', zIndex:'9999',
                boxShadow:'0 4px 16px rgba(0,0,0,0.2)', maxWidth:'90vw', textAlign:'center'
            });
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 4000);
        }
    }

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
    if (equipoId) nuevaTarea.equipo_id = equipoId;
    if (tiposSeleccionados.length) nuevaTarea.tipos_trabajo = tiposSeleccionados;
    if (componentesSeleccionados.length) nuevaTarea.componentes_trabajo = componentesSeleccionados;
    if (ubicacion) nuevaTarea.ubicacion = ubicacion;
    const vigia = vigiaId ? estado.trabajadores.find(t => t.id === vigiaId) : null;
    if (espacioConfinado) {
        nuevaTarea.espacio_confinado = true;
        if (vigiaId) {
            nuevaTarea.vigia_id = vigiaId;
            nuevaTarea.vigia_nombre = vigia?.nombre || null;
        }
    }

    // Optimistic update: actualizar UI inmediatamente
    const tareaLocal = {
        id: tareaId, tipo, liderId,
        liderNombre: lider ? lider.nombre : '',
        ayudantesIds, ayudantesNombres, estadoTarea, otNumero,
        horaAsignacion: hora,
        fechaAsignacion: new Date().toISOString(),
        estadoEjecucion: estadoEjecucion || 'activo',
        fechaExpiracion: fechaExpiracion || null,
        equipoId: equipoId || null,
        tiposSeleccionados,
        componentesSeleccionados,
        ubicacion: ubicacion || null,
        espacioConfinado: !!espacioConfinado,
        vigiaId: espacioConfinado ? (vigiaId || null) : null,
        vigiaNombre: espacioConfinado ? (vigia?.nombre || null) : null,
        orden: 0
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
    if (!tarea) {
        renderizarVistaActual();
        return;
    }
    if (tareasEliminandose.has(id)) return;
    tareasEliminandose.add(id);
    const tareasPrevias = [...estado.tareas];
    const trabajadoresPrevios = [...estado.trabajadores];

    try {
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
        renderizarVistaActual();
    } catch (error) {
        estado.tareas = tareasPrevias;
        estado.trabajadores = trabajadoresPrevios;
        renderizarVistaActual();
        alert(error?.message || 'No se pudo eliminar el trabajo.');
    } finally {
        tareasEliminandose.delete(id);
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

    // Construir formulario dinámico de mediciones
    _buildMedicionesForm(tarea.tiposSeleccionados || [], tarea.componentesSeleccionados || []);

    modal.style.display = 'flex';
}

async function completarTareaConPrompts(id, liderId, ayudantesIdsStr) {
    const observaciones = prompt("Ingrese breve reporte/observaciones del trabajo finalizado:");
    const numeroAviso = prompt("Ingrese n\u00famero de Aviso / Notificaci\u00f3n SAP (Opcional):");
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
    recomendacionAnalista,
    medicionesData = []
}) {
    const tarea = estado.tareas.find(t => t.id === id);
    if (!tarea) return;

    // Combinar acciones por componente con las acciones globales
    const accionesComp = medicionesData
        .filter(m => m.activo !== false && m.acciones)
        .map(m => m.componente ? `[${m.componente}] ${m.acciones}` : m.acciones)
        .join('\n');
    if (accionesComp && !accionesRealizadas) {
        accionesRealizadas = accionesComp;
    } else if (accionesComp) {
        accionesRealizadas = accionesComp + '\n\n' + accionesRealizadas;
    }

    const ayudantesIds = ayudantesIdsStr ? ayudantesIdsStr.split(',').filter(Boolean) : [];
    const histId = crypto.randomUUID();
    const fechaTermino = new Date().toISOString();
    const registroHistorial = {
        id: histId,
        tipo: tarea.tipo,
        lider_nombre: tarea.liderNombre,
        ayudantes_nombres: tarea.ayudantesNombres,
        hora_asignacion: tarea.horaAsignacion,
        fecha_inicio: tarea.fechaAsignacion || null,
        fecha_termino: fechaTermino,
        hora_termino: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}),
        acciones_realizadas: accionesRealizadas || '',
        observaciones: observaciones || '',
        numero_aviso: numeroAviso || '',
        hh_trabajo: hhTrabajo || '',
        ot_numero: tarea.otNumero,
        analisis: analisisTecnico || '',
        recomendacion_analista: recomendacionAnalista || '',
        equipo_id: tarea.equipoId || tarea.equipo_id || null,
        fecha_med: fechaTermino.slice(0, 10),
        created_at: fechaTermino
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

    // ── Guardar mediciones numéricas (vibración / temperatura) ───────────────
    const equipoIdMed = tarea.equipoId || tarea.equipo_id;
    if (equipoIdMed && medicionesData.length > 0) {
        const fechaHoy = new Date().toISOString().slice(0, 10);
        const equipoObj = estado.equipos.find(e => e.id === equipoIdMed);
        const equipoBase = equipoObj?.activo || '';
        const equipoUbic = equipoObj?.ubicacion || '';
        await Promise.all(
            medicionesData.filter(m => m.activo !== false).map(async m => {
                // Buscar la fila exacta: mismo nombre, misma ubicación, mismo componente
                const eqParaComp = m.componente
                    ? estado.equipos.find(e =>
                        e.activo === equipoBase &&
                        e.ubicacion === equipoUbic &&
                        e.componente === m.componente)
                    : null;
                const equipoIdComp = eqParaComp?.id || equipoIdMed;

                if (m.vibracion !== null && m.vibracion !== '') {
                    await guardarMedicion({
                        equipo_id: equipoIdComp,
                        tipo: 'vibracion',
                        valor: parseFloat(m.vibracion),
                        punto_medicion: m.componente || equipoBase || 'General',
                        componente: m.componente || null,
                        fecha: fechaHoy
                    });
                }
                if (m.temperatura !== null && m.temperatura !== '') {
                    await guardarMedicion({
                        equipo_id: equipoIdComp,
                        tipo: 'termografia',
                        valor: parseFloat(m.temperatura),
                        punto_medicion: m.componente || equipoBase || 'General',
                        componente: m.componente || null,
                        fecha: fechaHoy
                    });
                }
            })
        );
    }
}

// ── Guardar una medición en Supabase + localDB ────────────────────────────────
async function guardarMedicion({ equipo_id, tipo, valor, punto_medicion, componente, fecha }) {
    const unidad = tipo === 'vibracion' ? 'mm/s' : tipo === 'termografia' ? '°C' : '';
    const id = crypto.randomUUID();
    const payload = { id, equipo_id, tipo, valor, unidad, punto_medicion, componente: componente || null, fecha, synced: false };
    if (window.localDB) await window.localDB.mediciones.upsert(payload).catch(() => {});
    estado.historialMediciones = [payload, ...estado.historialMediciones];

    if (navigator.onLine && supabaseClient) {
        const insertData = { equipo_id, tipo, valor, unidad, punto_medicion, fecha };
        if (componente) insertData.componente = componente;
        const { error } = await supabaseClient.from(tablasDb.mediciones).insert([insertData]);
        if (error) {
            await window.syncQueue?.add(tablasDb.mediciones, 'INSERT', payload);
        } else {
            await window.localDB?.mediciones.upsert({ ...payload, synced: true }).catch(() => {});
        }
    } else {
        await window.syncQueue?.add(tablasDb.mediciones, 'INSERT', payload);
    }
}

// Exponer a global para los onclick de los botones
window.completarTareaExposed = completarTarea;
window.eliminarTareaExposed = eliminarTarea;
window.eliminarTodasLasTareasExposed = eliminarTodasLasTareas;

// Iniciar tarea que estaba en cola (programada_semana → en_curso)
window.iniciarTareaColaExposed = async function(tareaId) {
    const tarea = estado.tareas.find(t => t.id === tareaId);
    if (!tarea) return;
    const ahora = new Date();
    const hora = ahora.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    // Actualizar estado local
    tarea.estadoTarea = 'en_curso';
    tarea.horaAsignacion = hora;
    tarea.fechaAsignacion = ahora.toISOString();
    // Marcar ayudantes como ocupados
    if (tarea.ayudantesIds?.length) {
        estado.trabajadores = estado.trabajadores.map(w =>
            tarea.ayudantesIds.includes(w.id) ? { ...w, ocupado: true } : w
        );
        await Promise.all(tarea.ayudantesIds.map(aid => _db.update('trabajadores', aid, { ocupado: true })));
    }
    await _db.update('tareas', tareaId, {
        estado_tarea: 'en_curso',
        hora_asignacion: hora,
        fecha_inicio: ahora.toISOString()
    });
    renderizarVistaActual();
};

function badgeEstadoSolicitudInsumoHtml(estadoSolicitud) {
    if (estadoSolicitud === 'aprobada') {
        return '<span class="overtime-status approved"><i class="fa-solid fa-circle-check"></i> Aprobada</span>';
    }
    if (estadoSolicitud === 'rechazada') {
        return '<span class="overtime-status rejected"><i class="fa-solid fa-circle-xmark"></i> Rechazada</span>';
    }
    return '<span class="overtime-status pending"><i class="fa-solid fa-hourglass-half"></i> Pendiente</span>';
}

function obtenerInsumoPorId(insumoId) {
    return estado.insumos.find((item) => String(item.id) === String(insumoId)) || null;
}

function obtenerSolicitudInsumoPorId(solicitudId) {
    return estado.solicitudesInsumos.find((item) => String(item.id) === String(solicitudId)) || null;
}

async function persistirSolicitudInsumoLocal(registro) {
    estado.solicitudesInsumos = [
        normalizarSolicitudInsumo(registro),
        ...estado.solicitudesInsumos.filter((item) => String(item.id) !== String(registro.id))
    ].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    await window.localDB?.solicitudes_insumos.upsert(normalizarSolicitudInsumo(registro)).catch(() => {});
}

async function persistirInsumoLocal(insumo) {
    const normalizado = normalizarRegistroInsumo(insumo);
    estado.insumos = [
        normalizado,
        ...estado.insumos.filter((item) => String(item.id) !== String(normalizado.id))
    ].sort(ordenarCatalogoInsumos);
    await window.localDB?.insumos.upsert(normalizado).catch(() => {});
}

async function registrarMovimientoInventarioLocal(movimiento) {
    const normalizado = normalizarMovimientoInventario(movimiento);
    estado.movimientosInventario = [
        normalizado,
        ...estado.movimientosInventario.filter((item) => String(item.id) !== String(normalizado.id))
    ].sort((a, b) => new Date(b.fecha || b.created_at || 0) - new Date(a.fecha || a.created_at || 0));
    await window.localDB?.movimientos_inventario.upsert(normalizado).catch(() => {});
}

async function sincronizarInsumoRemoto(insumo) {
    if (!navigator.onLine || !supabaseClient || !insumosFeatureState.tablasRemotas.insumos) return false;
    const payload = {
        id: insumo.id,
        codigo: insumo.codigo,
        nombre: insumo.nombre,
        marca: insumo.marca,
        unidad: insumo.unidad,
        stock_actual: insumo.stock_actual,
        stock_inicial: insumo.stock_inicial,
        stock_minimo: insumo.stock_minimo,
        categoria: insumo.categoria,
        ubicacion: insumo.ubicacion,
        observaciones: insumo.observaciones,
        activo: insumo.activo
    };
    const { error } = await supabaseClient.from(tablasDb.insumos).upsert(payload, { onConflict: 'id' });
    if (error) {
        console.warn('[insumos] No se pudo sincronizar insumo:', error.message);
        return false;
    }
    return true;
}

async function sincronizarMovimientoRemoto(movimiento) {
    if (!navigator.onLine || !supabaseClient || !insumosFeatureState.tablasRemotas.movimientos) return false;
    const { error } = await supabaseClient.from(tablasDb.movimientosInventario).insert([movimiento]);
    if (error) {
        console.warn('[insumos] No se pudo sincronizar movimiento:', error.message);
        return false;
    }
    return true;
}

async function actualizarConfiguracionInsumo(insumoId, patch = {}) {
    const actual = obtenerInsumoPorId(insumoId);
    if (!actual) throw new Error('Insumo no encontrado.');
    const nuevo = normalizarRegistroInsumo({ ...actual, ...patch }, actual);
    await persistirInsumoLocal(nuevo);
    await sincronizarInsumoRemoto(nuevo);
    return nuevo;
}

async function ajustarStockInsumo(insumoId, nuevoStock, motivo = '') {
    const insumo = obtenerInsumoPorId(insumoId);
    if (!insumo) throw new Error('Insumo no encontrado.');
    const antes = enteroSeguro(insumo.stock_actual, 0);
    const despues = enteroSeguro(nuevoStock, antes);
    if (antes === despues) return { insumo, movimiento: null };
    const delta = despues - antes;
    const actualizado = { ...insumo, stock_actual: despues };
    await persistirInsumoLocal(actualizado);
    await sincronizarInsumoRemoto(actualizado);

    const movimiento = normalizarMovimientoInventario({
        id: crypto.randomUUID(),
        insumo_id: insumoId,
        tipo: delta > 0 ? 'entrada' : 'ajuste',
        cantidad: Math.abs(delta),
        creado_por: nombreAprobadorActual(),
        motivo: motivo || (delta > 0 ? 'Ingreso manual' : 'Ajuste manual'),
        stock_antes: antes,
        stock_despues: despues,
        fecha: new Date().toISOString()
    });
    await registrarMovimientoInventarioLocal(movimiento);
    await sincronizarMovimientoRemoto(movimiento);
    return { insumo: actualizado, movimiento };
}

async function registrarMovimientoManual(insumoId, tipo, cantidad, motivo = '') {
    const insumo = obtenerInsumoPorId(insumoId);
    if (!insumo) throw new Error('Insumo no encontrado.');
    const qty = enteroSeguro(cantidad, 0);
    if (qty <= 0) throw new Error('La cantidad debe ser mayor a cero.');
    const antes = enteroSeguro(insumo.stock_actual, 0);
    const signo = (tipo === 'entrada') ? 1 : -1;
    const despues = antes + signo * qty;
    return ajustarStockInsumo(insumoId, despues, motivo || (tipo === 'entrada' ? 'Ingreso' : 'Salida manual'));
}

async function eliminarInsumoCatalogo(insumoId) {
    const insumo = obtenerInsumoPorId(insumoId);
    if (!insumo) return;
    const actualizado = { ...insumo, activo: false };
    await persistirInsumoLocal(actualizado);
    await sincronizarInsumoRemoto(actualizado);
}

async function guardarSolicitudInsumo(trabajadorId, insumoId, cantidad) {
    const solicitud = normalizarSolicitudInsumo({
        id: crypto.randomUUID(),
        trabajador_id: trabajadorId,
        insumo_id: insumoId,
        cantidad,
        estado: 'pendiente',
        aprobado_por: null,
        fecha_solicitud: new Date().toISOString(),
        fecha_aprobacion: null,
        observaciones: null,
        created_at: new Date().toISOString()
    });

    await persistirSolicitudInsumoLocal(solicitud);

    if (navigator.onLine && supabaseClient && insumosFeatureState.tablasRemotas.solicitudes) {
        const payload = {
            id: solicitud.id,
            trabajador_id: solicitud.trabajador_id,
            insumo_id: solicitud.insumo_id,
            cantidad: solicitud.cantidad,
            estado: solicitud.estado,
            aprobado_por: solicitud.aprobado_por,
            fecha_solicitud: solicitud.fecha_solicitud,
            fecha_aprobacion: solicitud.fecha_aprobacion,
            observaciones: solicitud.observaciones
        };
        const { error } = await supabaseClient.from(tablasDb.solicitudesInsumos).insert([payload]);
        if (error) console.warn('[insumos] No se pudo sincronizar la solicitud:', error.message);
    }

    actualizarBadgeInsumos();

    return solicitud;
}

async function aprobarSolicitudInsumo(solicitudId) {
    const solicitud = obtenerSolicitudInsumoPorId(solicitudId);
    const insumo = obtenerInsumoPorId(solicitud?.insumo_id);
    if (!solicitud || !insumo || solicitud.estado !== 'pendiente') return;

    const ahora = new Date().toISOString();
    const actualizada = {
        ...solicitud,
        estado: 'aprobada',
        aprobado_por: nombreAprobadorActual(),
        fecha_aprobacion: ahora,
        observaciones: null,
        created_at: solicitud.created_at || ahora
    };
    await persistirSolicitudInsumoLocal(actualizada);

    const insumoActualizado = {
        ...insumo,
        stock_actual: enteroSeguro(insumo.stock_actual, 0) - enteroSeguro(solicitud.cantidad, 0)
    };
    await persistirInsumoLocal(insumoActualizado);

    const usaTriggerRemoto = navigator.onLine
        && insumosFeatureState.tablasRemotas.insumos
        && insumosFeatureState.tablasRemotas.solicitudes
        && insumosFeatureState.tablasRemotas.movimientos;

    if (!usaTriggerRemoto) {
        await registrarMovimientoInventarioLocal({
            id: crypto.randomUUID(),
            insumo_id: solicitud.insumo_id,
            tipo: 'salida',
            cantidad: solicitud.cantidad,
            referencia_id: solicitud.id,
            creado_por: nombreAprobadorActual(),
            fecha: ahora,
            created_at: ahora
        });
    }

    if (navigator.onLine && supabaseClient && insumosFeatureState.tablasRemotas.solicitudes) {
        const { error } = await supabaseClient
            .from(tablasDb.solicitudesInsumos)
            .update({
                estado: 'aprobada',
                aprobado_por: actualizada.aprobado_por,
                fecha_aprobacion: ahora,
                observaciones: null
            })
            .eq('id', solicitudId);
        if (error) console.warn('[insumos] No se pudo aprobar remotamente:', error.message);
    }

    actualizarBadgeInsumos();
}

async function rechazarSolicitudInsumo(solicitudId, observaciones) {
    const solicitud = obtenerSolicitudInsumoPorId(solicitudId);
    if (!solicitud || solicitud.estado !== 'pendiente') return;

    const ahora = new Date().toISOString();
    const actualizada = {
        ...solicitud,
        estado: 'rechazada',
        aprobado_por: nombreAprobadorActual(),
        fecha_aprobacion: ahora,
        observaciones,
        created_at: solicitud.created_at || ahora
    };
    await persistirSolicitudInsumoLocal(actualizada);

    if (navigator.onLine && supabaseClient && insumosFeatureState.tablasRemotas.solicitudes) {
        const { error } = await supabaseClient
            .from(tablasDb.solicitudesInsumos)
            .update({
                estado: 'rechazada',
                aprobado_por: actualizada.aprobado_por,
                fecha_aprobacion: ahora,
                observaciones
            })
            .eq('id', solicitudId);
        if (error) console.warn('[insumos] No se pudo rechazar remotamente:', error.message);
    }

    actualizarBadgeInsumos();
}

async function actualizarPermisoAprobadorInsumos(trabajadorId, puedeAprobar) {
    const trabajador = estado.trabajadores.find((item) => String(item.id) === String(trabajadorId));
    if (!trabajador) return;

    const actualizado = { ...trabajador, puede_aprobar_insumos: puedeAprobar };
    estado.trabajadores = estado.trabajadores.map((item) =>
        String(item.id) === String(trabajadorId) ? actualizado : item
    );
    if (estado.trabajadorLogueado?.id === trabajadorId) estado.trabajadorLogueado = actualizado;
    await window.localDB?.trabajadores.upsert(actualizado).catch(() => {});

    if (navigator.onLine && supabaseClient && insumosFeatureState.aprobadoresPersistentes) {
        const { error } = await supabaseClient
            .from('trabajadores')
            .update({ puede_aprobar_insumos: puedeAprobar })
            .eq('id', trabajadorId);
        if (error) console.warn('[insumos] No se pudo actualizar permiso remoto:', error.message);
    }
}

function obtenerValorFilaInventario(fila, alias = []) {
    for (const clave of alias) {
        const normalizada = normalizarTextoPlano(clave);
        if (Object.prototype.hasOwnProperty.call(fila, normalizada)) {
            return fila[normalizada];
        }
    }
    return '';
}

function extraerFilasInventarioDesdeLibro(libro) {
    const nombreHoja = libro.SheetNames.find((nombre) => normalizarTextoPlano(nombre) === 'INVENTARIO') || libro.SheetNames[0];
    if (!nombreHoja) throw new Error('El archivo no contiene hojas para importar.');
    const hoja = libro.Sheets[nombreHoja];
    const matriz = window.XLSX.utils.sheet_to_json(hoja, { header: 1, defval: '' });
    const indiceHeader = matriz.findIndex((fila) => {
        const headers = fila.map((celda) => normalizarTextoPlano(celda));
        return headers.includes('CODIGO') && (headers.includes('PRODUCTO') || headers.includes('NOMBRE'));
    });
    if (indiceHeader === -1) {
        throw new Error('No se encontro la cabecera esperada en la hoja INVENTARIO.');
    }
    const headers = matriz[indiceHeader].map((celda) => normalizarTextoPlano(celda));
    return matriz
        .slice(indiceHeader + 1)
        .map((fila) => headers.reduce((acc, header, index) => {
            if (header) acc[header] = fila[index];
            return acc;
        }, {}))
        .filter((fila) => Object.values(fila).some((valor) => String(valor || '').trim() !== ''));
}

async function importarCatalogoInsumosDesdeExcel(file) {
    if (!file) throw new Error('Selecciona un archivo Excel primero.');
    if (!window.XLSX) throw new Error('SheetJS no esta disponible en el navegador.');

    const workbook = window.XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const filas = extraerFilasInventarioDesdeLibro(workbook);
    const existentesPorCodigo = new Map((estado.insumos || []).map((item) => [String(item.codigo || ''), item]));

    const catalogo = filas.map((fila) => {
        const codigo = enteroSeguro(obtenerValorFilaInventario(fila, ['CODIGO', 'COD']));
        const nombre = String(obtenerValorFilaInventario(fila, ['PRODUCTO', 'NOMBRE', 'INSUMO']) || '').trim();
        if (!codigo || !nombre) return null;
        const base = existentesPorCodigo.get(String(codigo)) || { id: crypto.randomUUID() };
        const stockInicial = enteroSeguro(obtenerValorFilaInventario(fila, ['STOCK INICIAL', 'STOCK', 'STOCK_INICIAL']));
        const stockFinalRaw = obtenerValorFilaInventario(fila, ['STOCK FINAL', 'STOCK ACTUAL']);
        const stockActual = stockFinalRaw !== '' && stockFinalRaw != null
            ? enteroSeguro(stockFinalRaw, stockInicial)
            : stockInicial;
        return normalizarRegistroInsumo({
            id: base.id,
            codigo,
            nombre,
            marca: String(obtenerValorFilaInventario(fila, ['MARCA']) || '').trim(),
            unidad: obtenerValorFilaInventario(fila, ['UNIDAD DE MEDIDA', 'UNIDAD', 'UNIDAD MEDIDA']),
            stock_inicial: stockInicial,
            stock_actual: stockActual,
            categoria: base.categoria,
            stock_minimo: base.stock_minimo,
            ubicacion: base.ubicacion,
            observaciones: base.observaciones,
            activo: true,
            created_at: base.created_at || new Date().toISOString()
        }, base);
    }).filter(Boolean);

    if (!catalogo.length) throw new Error('No se encontraron insumos validos en la hoja INVENTARIO.');

    estado.insumos = [...catalogo].sort(ordenarCatalogoInsumos);
    await window.localDB?.insumos.clear().catch(() => {});
    await window.localDB?.insumos.bulk(estado.insumos).catch(() => {});

    let remoteSynced = false;
    if (navigator.onLine && supabaseClient && insumosFeatureState.tablasRemotas.insumos) {
        const { error } = await supabaseClient
            .from(tablasDb.insumos)
            .upsert(estado.insumos, { onConflict: 'codigo' });
        remoteSynced = !error;
        if (error) console.warn('[insumos] El catalogo se importo solo en local:', error.message);
    }

    return {
        total: estado.insumos.length,
        remoteSynced
    };
}

function renderDashboardInsumosOverviewHtml() {
    const bajos = obtenerInsumosStockBajo().slice(0, 4);
    const pendientes = (estado.solicitudesInsumos || []).filter((item) => item.estado === 'pendiente').length;
    const totalCatalogo = obtenerInsumosActivos().length;

    return `
        <section class="panel" style="margin-bottom:1rem;">
            <div class="panel-header" style="justify-content:space-between; align-items:flex-start; gap:1rem; flex-wrap:wrap;">
                <div>
                    <h2 style="margin-bottom:0.25rem;"><i class="fa-solid fa-boxes-stacked" style="color:#f97316;"></i> Stock de insumos</h2>
                    <p style="margin:0; color:var(--text-muted); font-size:0.86rem;">Resumen rapido del inventario, solicitudes pendientes y alertas de reposicion.</p>
                </div>
                <button id="btn-open-insumos-dashboard" class="btn btn-outline" type="button" style="white-space:nowrap;">
                    <i class="fa-solid fa-arrow-up-right-from-square"></i> Ir al modulo
                </button>
            </div>
            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:0.9rem; margin-top:1rem;">
                <article class="overtime-kpi-card">
                    <span class="overtime-kpi-label"><i class="fa-solid fa-box-open"></i> Catalogo activo</span>
                    <div class="overtime-kpi-value">${totalCatalogo}</div>
                    <div class="overtime-kpi-meta">Items listos para solicitud</div>
                </article>
                <article class="overtime-kpi-card">
                    <span class="overtime-kpi-label"><i class="fa-solid fa-hourglass-half"></i> Pendientes</span>
                    <div class="overtime-kpi-value">${pendientes}</div>
                    <div class="overtime-kpi-meta">Solicitudes esperando revision</div>
                </article>
                <article class="overtime-kpi-card">
                    <span class="overtime-kpi-label"><i class="fa-solid fa-triangle-exclamation"></i> Stock bajo</span>
                    <div class="overtime-kpi-value">${obtenerInsumosStockBajo().length}</div>
                    <div class="overtime-kpi-meta">Items bajo 30% del stock inicial</div>
                </article>
            </div>
            <div style="margin-top:1rem;">
                ${bajos.length
                    ? bajos.map((item) => `
                        <div style="display:flex; justify-content:space-between; gap:1rem; padding:0.7rem 0; border-top:1px solid var(--border-color);">
                            <div>
                                <strong>${item.nombre}</strong>
                                <div style="color:var(--text-muted); font-size:0.8rem;">Codigo ${item.codigo || '--'} · ${item.marca || 'Sin marca'}</div>
                            </div>
                            <div style="text-align:right;">
                                <strong style="color:#dc2626;">${item.stock_actual}</strong>
                                <div style="color:var(--text-muted); font-size:0.8rem;">de ${item.stock_inicial}</div>
                            </div>
                        </div>
                    `).join('')
                    : '<div class="empty-state empty-state--compact"><div><strong>Sin alertas de stock bajo</strong><p>El inventario actual esta por sobre el umbral critico.</p></div></div>'}
            </div>
        </section>
    `;
}


// --- COMPONENTES Y VISTAS ---

const mainContent = document.getElementById('main-content');
let pendingRealtimeRender = false;
let realtimeResumeTimer = null;

// ── Force refresh: re-baja todo y re-renderiza ──────────────────────────────
window.forzarRefrescoPlanify = async function forzarRefrescoPlanify() {
    if (window._planifyRefreshing) return;
    window._planifyRefreshing = true;
    try {
        if (!navigator.onLine || !window.supabaseClient) {
            mostrarToastNotificacion('Sin conexión', 'No se pueden actualizar los datos ahora.', { type: 'warning', duration: 3000 });
            return;
        }
        const sb = window.supabaseClient;
        const [tareasRes, trabajadoresRes, insumosRes, equiposRes] = await Promise.allSettled([
            sb.from('tareas').select('*'),
            sb.from('trabajadores').select('*'),
            sb.from('insumos').select('*'),
            fetchAllEquipos()
        ]);
        if (tareasRes.status === 'fulfilled' && tareasRes.value?.data) {
            estado.tareas = (tareasRes.value.data || []).map(t => ({
                id: t.id, tipo: t.tipo,
                liderId: t.lider_id, liderNombre: t.lider_nombre,
                ayudantesIds: t.ayudantes_ids || [], ayudantesNombres: t.ayudantes_nombres || [],
                estadoTarea: t.estado_tarea, otNumero: t.ot_numero,
                horaAsignacion: t.hora_asignacion,
                fechaAsignacion: t.created_at || null,
                estadoEjecucion: t.estado_ejecucion || 'activo',
                fechaExpiracion: t.fecha_expiracion || null,
                equipoId: t.equipo_id || null,
                tiposSeleccionados: t.tipos_trabajo || [],
                componentesSeleccionados: t.componentes_trabajo || [],
                ubicacion: t.ubicacion || null,
                espacioConfinado: !!t.espacio_confinado,
                vigiaId: t.vigia_id || null,
                vigiaNombre: t.vigia_nombre || null,
                orden: t.orden || 0
            }));
        }
        if (trabajadoresRes.status === 'fulfilled' && trabajadoresRes.value?.data) {
            estado.trabajadores = (trabajadoresRes.value.data || []).map(t => ({ ...t, disponible: _checkinVigente(t) }));
        }
        if (insumosRes.status === 'fulfilled' && insumosRes.value?.data) {
            estado.insumos = insumosRes.value.data || [];
        }
        if (equiposRes.status === 'fulfilled') {
            estado.equipos = equiposRes.value || [];
        }
        try { evaluarNotificacionesPlanify?.(); } catch {}
        renderizarVistaActual();
        mostrarToastNotificacion('Actualizado', 'Datos sincronizados.', { type: 'success', duration: 1500 });
    } catch (err) {
        console.error('[refresh]', err);
        mostrarToastNotificacion('Error al actualizar', err?.message || 'Reintenta en unos segundos.', { type: 'danger', duration: 3500 });
    } finally {
        window._planifyRefreshing = false;
    }
};

// ── Pull-to-refresh (gesto vertical desde el tope) ──────────────────────────
(function instalarPullToRefresh() {
    let startY = 0;
    let pulling = false;
    let pulled = 0;
    const UMBRAL = 75;            // px que hay que arrastrar para gatillar
    const MAX_PULL = 130;
    let indicator = null;

    function getIndicator() {
        if (indicator) return indicator;
        indicator = document.createElement('div');
        indicator.id = 'planify-ptr-indicator';
        Object.assign(indicator.style, {
            position: 'fixed',
            top: '0',
            left: '50%',
            transform: 'translate(-50%, -60px)',
            zIndex: '9997',
            background: '#FF6900',
            color: '#fff',
            borderRadius: '999px',
            padding: '0.45rem 0.95rem',
            fontSize: '0.82rem',
            fontWeight: '700',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.45rem',
            boxShadow: '0 8px 22px rgba(255,105,0,0.35)',
            transition: 'transform 0ms',
            pointerEvents: 'none',
            opacity: '0'
        });
        document.body.appendChild(indicator);
        return indicator;
    }
    function setIndicator(progress, ready) {
        const el = getIndicator();
        const offsetY = Math.min(progress * 0.6, 30);
        el.style.transform = `translate(-50%, ${offsetY}px)`;
        el.style.opacity = String(Math.min(progress / UMBRAL, 1));
        el.innerHTML = ready
            ? '<i class="fa-solid fa-arrows-rotate"></i> Suelta para actualizar'
            : '<i class="fa-solid fa-arrow-down"></i> Desliza para actualizar';
    }
    function hideIndicator() {
        const el = document.getElementById('planify-ptr-indicator');
        if (!el) return;
        el.style.transition = 'transform 220ms, opacity 220ms';
        el.style.transform = 'translate(-50%, -60px)';
        el.style.opacity = '0';
        setTimeout(() => { el.style.transition = 'transform 0ms'; }, 240);
    }
    function showLoading() {
        const el = getIndicator();
        el.style.transition = 'transform 220ms';
        el.style.transform = 'translate(-50%, 14px)';
        el.style.opacity = '1';
        el.innerHTML = '<i class="fa-solid fa-arrows-rotate fa-spin"></i> Actualizando...';
    }

    document.addEventListener('touchstart', (e) => {
        if (window.scrollY > 2) return;
        if (e.touches.length !== 1) return;
        // No activar si el touch empieza dentro de un overlay/modal
        const target = e.target;
        if (target?.closest?.('.modal-overlay-base, #asign-drawer, #asign-backdrop, #planify-toast-stack')) return;
        startY = e.touches[0].clientY;
        pulling = true;
        pulled = 0;
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
        if (!pulling) return;
        if (window.scrollY > 2) { pulling = false; hideIndicator(); return; }
        const dy = e.touches[0].clientY - startY;
        if (dy <= 0) { pulled = 0; return; }
        pulled = Math.min(dy, MAX_PULL);
        setIndicator(pulled, pulled >= UMBRAL);
    }, { passive: true });

    document.addEventListener('touchend', async () => {
        if (!pulling) return;
        const wasReady = pulled >= UMBRAL;
        pulling = false;
        if (wasReady) {
            showLoading();
            try {
                await window.forzarRefrescoPlanify();
            } finally {
                setTimeout(hideIndicator, 350);
            }
        } else {
            hideIndicator();
        }
        pulled = 0;
    });
})();

// Atajo de teclado: F5 o Ctrl/Cmd+R intercepta para usar nuestro refresh suave
document.addEventListener('keydown', (e) => {
    if ((e.key === 'F5') || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r')) {
        // Si hay shift, dejar que el navegador haga reload duro
        if (e.shiftKey) return;
        e.preventDefault();
        window.forzarRefrescoPlanify();
    }
});

function esElementoVisibleUI(elemento) {
    if (!elemento) return false;
    const estilo = window.getComputedStyle(elemento);
    return estilo.display !== 'none' && estilo.visibility !== 'hidden' && estilo.opacity !== '0';
}

function hayUIBloqueandoRealtime() {
    const activeElement = document.activeElement;
    const tag = (activeElement?.tagName || '').toLowerCase();
    if (document.hidden) return true;
    // Solo bloquear si el usuario realmente está escribiendo o en un textarea.
    // Un <select> o un input de búsqueda ya poblado no debería bloquear el refresh.
    if (tag === 'textarea' || activeElement?.isContentEditable) return true;
    if (tag === 'input') {
        const type = (activeElement?.type || '').toLowerCase();
        // Solo bloquear inputs de texto/número donde el usuario probablemente esté tecleando
        if (['text','number','password','email','tel','url','search','date','time','datetime-local'].includes(type)) {
            // Si el input tiene valor ya escrito, dar margen al usuario
            const val = String(activeElement.value || '');
            if (val.length > 0) return true;
        }
    }

    const overlays = [
        ...document.querySelectorAll('.modal-overlay-base'),
        document.getElementById('asign-backdrop')
    ].filter(Boolean);

    return overlays.some(esElementoVisibleUI);
}

// Pill "Hay cambios nuevos" — visible cuando un render se difiere
function _mostrarPillCambios() {
    let pill = document.getElementById('planify-pending-pill');
    if (pill) return;
    pill = document.createElement('button');
    pill.id = 'planify-pending-pill';
    pill.type = 'button';
    pill.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> Hay cambios nuevos · toca para aplicar';
    Object.assign(pill.style, {
        position: 'fixed',
        top: '1rem',
        left: '50%',
        transform: 'translateX(-50%) translateY(-80px)',
        zIndex: '9998',
        background: '#FF6900',
        color: '#ffffff',
        border: 'none',
        borderRadius: '999px',
        padding: '0.55rem 1.1rem',
        fontSize: '0.85rem',
        fontWeight: '700',
        cursor: 'pointer',
        boxShadow: '0 8px 24px rgba(255,105,0,0.35)',
        transition: 'transform 280ms cubic-bezier(.4,0,.2,1)',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.5rem'
    });
    pill.addEventListener('click', () => {
        _ocultarPillCambios();
        pendingRealtimeRender = false;
        clearTimeout(realtimeResumeTimer);
        realtimeResumeTimer = null;
        renderizarVistaActualPreservandoViewport();
    });
    document.body.appendChild(pill);
    requestAnimationFrame(() => { pill.style.transform = 'translateX(-50%) translateY(0)'; });
}
function _ocultarPillCambios() {
    const pill = document.getElementById('planify-pending-pill');
    if (!pill) return;
    pill.style.transform = 'translateX(-50%) translateY(-80px)';
    setTimeout(() => pill.remove(), 280);
}

function renderizarVistaActualPreservandoViewport() {
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    renderizarVistaActual();
    window.requestAnimationFrame(() => window.scrollTo(scrollX, scrollY));
}

function intentarAplicarRealtimePendiente() {
    if (!pendingRealtimeRender) return;
    if (document.hidden) {
        clearTimeout(realtimeResumeTimer);
        realtimeResumeTimer = null;
        return;
    }
    if (hayUIBloqueandoRealtime()) {
        clearTimeout(realtimeResumeTimer);
        realtimeResumeTimer = setTimeout(intentarAplicarRealtimePendiente, 900);
        _mostrarPillCambios();
        return;
    }

    pendingRealtimeRender = false;
    clearTimeout(realtimeResumeTimer);
    realtimeResumeTimer = null;
    _ocultarPillCambios();
    renderizarVistaActualPreservandoViewport();
}

function solicitarRenderRealtimeNoIntrusivo() {
    if (document.hidden) {
        pendingRealtimeRender = true;
        clearTimeout(realtimeResumeTimer);
        realtimeResumeTimer = null;
        return;
    }
    if (hayUIBloqueandoRealtime()) {
        pendingRealtimeRender = true;
        clearTimeout(realtimeResumeTimer);
        realtimeResumeTimer = setTimeout(intentarAplicarRealtimePendiente, 900);
        _mostrarPillCambios();
        return;
    }

    pendingRealtimeRender = false;
    clearTimeout(realtimeResumeTimer);
    realtimeResumeTimer = null;
    _ocultarPillCambios();
    renderizarVistaActualPreservandoViewport();
}

['focusout', 'pointerup', 'keyup', 'visibilitychange'].forEach((eventName) => {
    document.addEventListener(eventName, () => {
        if (!pendingRealtimeRender) return;
        clearTimeout(realtimeResumeTimer);
        realtimeResumeTimer = setTimeout(intentarAplicarRealtimePendiente, 120);
    }, true);
});

window.addEventListener('focus', () => {
    if (!pendingRealtimeRender) return;
    clearTimeout(realtimeResumeTimer);
    realtimeResumeTimer = setTimeout(intentarAplicarRealtimePendiente, 120);
});

async function renderInsumosView() {
    mainContent.innerHTML = '<div class="fade-in" style="max-width:1180px; margin:0 auto;"><div class="panel" style="text-align:center; padding:2rem;"><p style="color:var(--text-muted);">Cargando inventario...</p></div></div>';

    await refrescarDatosInsumos({ preferRemote: true });

    const trabajador = obtenerTrabajadorActual();
    const esAdmin = estado.usuarioActual === 'admin';
    const puedeAprobar = usuarioPuedeAprobarInsumos();
    const puedeSolicitar = estado.usuarioActual === 'trabajador';
    const catalogoActivo = obtenerInsumosActivos();
    const stockBajo = obtenerInsumosStockBajo();
    const solicitudesBase = (esAdmin || puedeAprobar)
        ? [...estado.solicitudesInsumos]
        : estado.solicitudesInsumos.filter((item) => String(item.trabajador_id) === String(trabajador?.id));
    const pendientes = solicitudesBase.filter((item) => item.estado === 'pendiente').length;
    const movimientosTotales = estado.movimientosInventario.length;
    const aprobadasMes = solicitudesBase.filter((item) => item.estado === 'aprobada' && String(item.fecha_aprobacion || '').slice(0, 7) === new Date().toISOString().slice(0, 7)).length;

    const opcionesTrabajadores = [
        '<option value="">Todos los solicitantes</option>',
        ...estado.trabajadores
            .slice()
            .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es'))
            .map((item) => `<option value="${item.id}">${item.nombre}</option>`)
    ].join('');

    const categoriasPresentes = Array.from(new Set(catalogoActivo.map((i) => i.categoria))).filter(Boolean);
    const categoriasDisponibles = CATEGORIAS_INSUMO.filter((cat) => categoriasPresentes.includes(cat.id));
    const marcasDisponibles = Array.from(new Set(catalogoActivo.map((i) => i.marca).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'es'));
    const ubicacionesExistentes = Array.from(new Set(catalogoActivo.map((i) => i.ubicacion).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'es'));

    const hayCatalogo = catalogoActivo.length > 0;
    const defaultTab = (esAdmin || puedeAprobar) ? 'catalogo' : (puedeSolicitar ? 'solicitudes' : 'catalogo');

    mainContent.innerHTML = `
        <div class="fade-in overtime-view inv-view" style="max-width:1180px; margin:0 auto;">
            <section class="panel overtime-hero inv-hero">
                <div class="dashboard-hero-head">
                    <div>
                        <div class="overtime-eyebrow">Inventario operacional</div>
                        <h1 style="margin:0 0 0.4rem 0;"><i class="fa-solid fa-boxes-stacked"></i> Inventario &amp; Insumos</h1>
                        <p class="overtime-subtitle">Controla stock, categorias y solicitudes de EPP, lubricantes y consumibles.</p>
                    </div>
                    <div class="dashboard-hero-badges">
                        <span class="dashboard-hero-badge"><i class="fa-solid fa-box-open"></i> ${catalogoActivo.length} items</span>
                        <span class="dashboard-hero-badge" style="${stockBajo.length ? 'background:rgba(220,38,38,0.12); color:#dc2626;' : ''}"><i class="fa-solid fa-triangle-exclamation"></i> ${stockBajo.length} stock bajo</span>
                        <span class="dashboard-hero-badge"><i class="fa-solid fa-hourglass-half"></i> ${pendientes} pendientes</span>
                    </div>
                </div>
                <div class="inv-kpi-grid">
                    <article class="inv-kpi-card" data-kpi="catalogo" role="button" tabindex="0" title="Ver catalogo completo" style="cursor:pointer;">
                        <span class="inv-kpi-label"><i class="fa-solid fa-box"></i> Catalogo activo</span>
                        <div class="inv-kpi-value">${catalogoActivo.length}</div>
                        <div class="inv-kpi-meta">${categoriasDisponibles.length} categoria(s) · ${marcasDisponibles.length} marca(s)</div>
                    </article>
                    <article class="inv-kpi-card inv-kpi-card--danger" data-kpi="stock_bajo" role="button" tabindex="0" title="Ver items con stock bajo" style="cursor:pointer;">
                        <span class="inv-kpi-label"><i class="fa-solid fa-triangle-exclamation"></i> Stock bajo</span>
                        <div class="inv-kpi-value" style="color:#dc2626;">${stockBajo.length}</div>
                        <div class="inv-kpi-meta">Items en o bajo su minimo</div>
                    </article>
                    <article class="inv-kpi-card" data-kpi="pendientes" role="button" tabindex="0" title="Ver solicitudes pendientes" style="cursor:pointer;">
                        <span class="inv-kpi-label"><i class="fa-solid fa-hourglass-half"></i> Pendientes</span>
                        <div class="inv-kpi-value">${pendientes}</div>
                        <div class="inv-kpi-meta">${esAdmin || puedeAprobar ? 'Esperando revision' : 'Tus solicitudes'}</div>
                    </article>
                    <article class="inv-kpi-card" data-kpi="aprobadas_mes" role="button" tabindex="0" title="Ver solicitudes aprobadas este mes" style="cursor:pointer;">
                        <span class="inv-kpi-label"><i class="fa-solid fa-circle-check"></i> Aprobadas mes</span>
                        <div class="inv-kpi-value">${aprobadasMes}</div>
                        <div class="inv-kpi-meta">Solicitudes cerradas</div>
                    </article>
                </div>
            </section>

            <nav class="inv-tabs" role="tablist">
                <button class="inv-tab" data-tab="catalogo" role="tab"><i class="fa-solid fa-warehouse"></i> Catalogo <span class="inv-tab-count">${catalogoActivo.length}</span></button>
                <button class="inv-tab" data-tab="solicitudes" role="tab"><i class="fa-solid fa-list-check"></i> Solicitudes <span class="inv-tab-count">${pendientes}</span></button>
                ${(esAdmin || puedeAprobar) ? `<button class="inv-tab" data-tab="movimientos" role="tab"><i class="fa-solid fa-arrow-right-arrow-left"></i> Movimientos <span class="inv-tab-count">${movimientosTotales}</span></button>` : ''}
                ${esAdmin ? '<button class="inv-tab" data-tab="aprobadores" role="tab"><i class="fa-solid fa-user-shield"></i> Aprobadores</button>' : ''}
            </nav>

            <section class="inv-panel" data-tab-panel="catalogo">
                <div class="inv-toolbar">
                    <div class="inv-toolbar-row">
                        <input id="inv-search" type="search" class="form-control" placeholder="Buscar por nombre, marca o codigo..." autocomplete="off">
                        ${marcasDisponibles.length ? `
                            <select id="inv-marca" class="form-control" style="max-width:200px;">
                                <option value="">Todas las marcas</option>
                                ${marcasDisponibles.map((m) => `<option value="${m}">${m}</option>`).join('')}
                            </select>
                        ` : ''}
                        <label class="inv-toggle">
                            <input id="inv-solo-bajo" type="checkbox">
                            <span>Solo stock bajo</span>
                        </label>
                        ${esAdmin ? `
                            <div class="inv-toolbar-actions">
                                <input id="input-insumos-excel" type="file" accept=".xlsx,.xls" style="display:none;">
                                <button id="btn-importar-insumos-excel" class="btn btn-outline" type="button"><i class="fa-solid fa-file-arrow-up"></i> Importar Excel</button>
                                <button id="btn-nuevo-insumo" class="btn btn-primary" type="button"><i class="fa-solid fa-plus"></i> Nuevo item</button>
                            </div>
                        ` : ''}
                    </div>
                    ${categoriasDisponibles.length ? `
                        <div class="inv-chip-row" id="inv-chips-cat">
                            <button class="inv-chip is-active" data-cat="">Todas <span>${catalogoActivo.length}</span></button>
                            ${categoriasDisponibles.map((cat) => {
                                const count = catalogoActivo.filter((i) => i.categoria === cat.id).length;
                                return `<button class="inv-chip" data-cat="${cat.id}" style="--chip-color:${cat.color};"><i class="fa-solid ${cat.icon}"></i> ${cat.label} <span>${count}</span></button>`;
                            }).join('')}
                        </div>
                    ` : ''}
                </div>
                <div id="inv-catalogo-list"></div>
            </section>

            <section class="inv-panel" data-tab-panel="solicitudes" hidden>
                ${puedeSolicitar ? `
                    <div class="inv-solicitud-form panel">
                        <div class="panel-header"><h2 style="margin:0;"><i class="fa-solid fa-plus"></i> Nueva solicitud</h2></div>
                        <form id="form-insumo-solicitud" class="inv-solicitud-grid">
                            <div class="form-group">
                                <label for="insumo-select">Insumo</label>
                                <select id="insumo-select" class="form-control">
                                    <option value="">Selecciona un insumo...</option>
                                    ${catalogoActivo.map((item) => `<option value="${item.id}">${item.codigo || '--'} · ${item.nombre}</option>`).join('')}
                                </select>
                            </div>
                            <div class="form-group">
                                <label for="insumo-cantidad">Cantidad</label>
                                <input id="insumo-cantidad" type="number" min="1" step="1" class="form-control" placeholder="Ej: 2">
                            </div>
                            <div id="insumo-select-meta" class="inv-meta-box">
                                <strong>Selecciona un item para ver el stock actual.</strong>
                                <p>Veras marca, unidad y alerta de disponibilidad antes de enviar.</p>
                            </div>
                            <p id="insumo-cantidad-hint" class="inv-hint">No se permite solicitar mas del doble del stock disponible.</p>
                            <button id="btn-enviar-solicitud-insumo" class="btn btn-primary" type="submit">
                                <i class="fa-solid fa-paper-plane"></i> Enviar solicitud
                            </button>
                        </form>
                    </div>
                ` : ''}
                <div class="inv-toolbar">
                    <div class="inv-toolbar-row">
                        <select id="insumos-filtro-estado" class="form-control" style="max-width:180px;">
                            <option value="todos">Todos</option>
                            <option value="pendiente" ${(esAdmin || puedeAprobar) ? 'selected' : ''}>Pendientes</option>
                            <option value="aprobada">Aprobadas</option>
                            <option value="rechazada">Rechazadas</option>
                        </select>
                        ${(esAdmin || puedeAprobar) ? `<select id="insumos-filtro-trabajador" class="form-control" style="max-width:220px;">${opcionesTrabajadores}</select>` : ''}
                        <input id="insumos-filtro-texto" type="search" class="form-control" placeholder="Buscar por insumo o solicitante...">
                        ${esAdmin ? `<button id="btn-insumos-limpiar-resueltas" type="button" class="btn btn-outline btn-small"><i class="fa-solid fa-broom"></i> Limpiar resueltas</button>` : ''}
                    </div>
                </div>
                <div id="inv-solicitudes-contexto" style="display:none;"></div>
                <div id="inv-solicitudes-list"></div>
            </section>

            ${(esAdmin || puedeAprobar) ? `
            <section class="inv-panel" data-tab-panel="movimientos" hidden>
                <div class="inv-toolbar">
                    <div class="inv-toolbar-row">
                        <input id="inv-mov-search" type="search" class="form-control" placeholder="Buscar por insumo o motivo...">
                        <select id="inv-mov-tipo" class="form-control" style="max-width:180px;">
                            <option value="">Todos los tipos</option>
                            <option value="entrada">Entradas</option>
                            <option value="salida">Salidas</option>
                            <option value="ajuste">Ajustes</option>
                        </select>
                    </div>
                </div>
                <div id="inv-movimientos-list"></div>
            </section>
            ` : ''}

            ${esAdmin ? `
                <section class="inv-panel" data-tab-panel="aprobadores" hidden>
                    <div class="inv-toolbar">
                        <p style="margin:0; color:var(--text-muted); font-size:0.82rem;">
                            ${insumosFeatureState.aprobadoresPersistentes
                                ? 'Los cambios quedan guardados tambien en Supabase.'
                                : 'Los cambios quedan disponibles en modo local. Ejecuta el SQL de permisos en Supabase para persistirlos.'}
                        </p>
                    </div>
                    <div id="inv-aprobadores-list"></div>
                </section>
            ` : ''}
        </div>

        ${puedeSolicitar ? `<button class="inv-fab" id="inv-fab-solicitud" type="button" title="Nueva solicitud"><i class="fa-solid fa-plus"></i></button>` : ''}
    `;

    let filtroEstado = (esAdmin || puedeAprobar) ? 'pendiente' : 'todos';
    let filtroTrabajador = '';
    let filtroTexto = '';
    let filtroCat = '';
    let filtroMarca = '';
    let filtroBusqueda = '';
    let soloBajo = false;
    let filtroSolicitudesMes = '';
    let filtroMovTipo = '';
    let filtroMovTexto = '';
    let tabActiva = defaultTab;

    const existeTab = (t) => Boolean(mainContent.querySelector(`[data-tab-panel="${t}"]`));
    if (!existeTab(tabActiva)) tabActiva = 'catalogo';

    function activarTab(tab) {
        if (!existeTab(tab)) return;
        tabActiva = tab;
        mainContent.querySelectorAll('.inv-tab').forEach((btn) => {
            btn.classList.toggle('is-active', btn.dataset.tab === tab);
        });
        mainContent.querySelectorAll('[data-tab-panel]').forEach((panel) => {
            panel.hidden = panel.dataset.tabPanel !== tab;
        });
        if (tab === 'catalogo') {
            sincronizarFiltrosCatalogoUI();
            renderCatalogoCards();
        }
        if (tab === 'solicitudes') {
            sincronizarFiltrosSolicitudesUI();
            renderTablaSolicitudes();
        }
        if (tab === 'movimientos') renderMovimientos();
        if (tab === 'aprobadores') renderAprobadores();
    }

    function sincronizarFiltrosCatalogoUI() {
        const searchEl = document.getElementById('inv-search');
        const marcaEl = document.getElementById('inv-marca');
        const soloBajoEl = document.getElementById('inv-solo-bajo');
        if (searchEl) searchEl.value = filtroBusqueda;
        if (marcaEl) marcaEl.value = filtroMarca;
        if (soloBajoEl) soloBajoEl.checked = soloBajo;
        mainContent.querySelectorAll('#inv-chips-cat .inv-chip').forEach((chip) => {
            chip.classList.toggle('is-active', (chip.dataset.cat || '') === filtroCat);
        });
    }

    function descripcionMesFiltroSolicitudes() {
        if (!filtroSolicitudesMes) return '';
        const fecha = new Date(`${filtroSolicitudesMes}-01T12:00:00`);
        if (Number.isNaN(fecha.getTime())) return filtroSolicitudesMes;
        return fecha.toLocaleDateString('es-CL', { month: 'long', year: 'numeric' });
    }

    function sincronizarFiltrosSolicitudesUI() {
        const estadoEl = document.getElementById('insumos-filtro-estado');
        const trabajadorEl = document.getElementById('insumos-filtro-trabajador');
        const textoEl = document.getElementById('insumos-filtro-texto');
        const contextoEl = document.getElementById('inv-solicitudes-contexto');
        if (estadoEl) estadoEl.value = filtroEstado;
        if (trabajadorEl) trabajadorEl.value = filtroTrabajador;
        if (textoEl) textoEl.value = filtroTexto;
        if (!contextoEl) return;

        if (!filtroSolicitudesMes) {
            contextoEl.style.display = 'none';
            contextoEl.innerHTML = '';
            return;
        }

        const descripcionMes = descripcionMesFiltroSolicitudes();
        contextoEl.style.display = 'block';
        contextoEl.innerHTML = `
            <div style="display:flex; align-items:center; justify-content:space-between; gap:0.8rem; flex-wrap:wrap; margin-bottom:0.85rem; padding:0.75rem 0.9rem; border:1px solid rgba(59,130,246,0.18); border-radius:14px; background:rgba(59,130,246,0.06); color:#1d4ed8;">
                <span style="font-size:0.82rem; font-weight:600;"><i class="fa-solid fa-filter"></i> Mostrando solicitudes aprobadas de ${descripcionMes}.</span>
                <button id="btn-limpiar-filtro-mes-insumos" type="button" class="btn btn-outline btn-small" style="white-space:nowrap;"><i class="fa-solid fa-xmark"></i> Quitar filtro</button>
            </div>
        `;
        document.getElementById('btn-limpiar-filtro-mes-insumos')?.addEventListener('click', () => {
            filtroSolicitudesMes = '';
            sincronizarFiltrosSolicitudesUI();
            renderTablaSolicitudes();
        });
    }

    function enfocarDetalleTab(tab) {
        const tabBtn = mainContent.querySelector(`.inv-tab[data-tab="${tab}"]`);
        const panel = mainContent.querySelector(`[data-tab-panel="${tab}"]`);
        if (tabBtn) {
            tabBtn.focus({ preventScroll: true });
            tabBtn.style.boxShadow = '0 0 0 4px rgba(249,115,22,0.18)';
            setTimeout(() => { tabBtn.style.boxShadow = ''; }, 900);
        }
        if (panel) {
            panel.style.scrollMarginTop = '112px';
            panel.style.outline = '2px solid rgba(249,115,22,0.22)';
            panel.style.outlineOffset = '6px';
            panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
            setTimeout(() => {
                panel.style.outline = '';
                panel.style.outlineOffset = '';
            }, 1100);
        } else if (tabBtn) {
            tabBtn.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
        }
    }

    function abrirDetalleKpiInventario(tipo) {
        if (tipo === 'catalogo') {
            filtroBusqueda = '';
            filtroMarca = '';
            filtroCat = '';
            soloBajo = false;
            activarTab('catalogo');
            enfocarDetalleTab('catalogo');
            return;
        }

        if (tipo === 'stock_bajo') {
            filtroBusqueda = '';
            filtroMarca = '';
            filtroCat = '';
            soloBajo = true;
            activarTab('catalogo');
            enfocarDetalleTab('catalogo');
            return;
        }

        if (tipo === 'pendientes') {
            filtroEstado = 'pendiente';
            filtroTrabajador = '';
            filtroTexto = '';
            filtroSolicitudesMes = '';
            activarTab('solicitudes');
            enfocarDetalleTab('solicitudes');
            return;
        }

        if (tipo === 'aprobadas_mes') {
            filtroEstado = 'aprobada';
            filtroTrabajador = '';
            filtroTexto = '';
            filtroSolicitudesMes = new Date().toISOString().slice(0, 7);
            activarTab('solicitudes');
            enfocarDetalleTab('solicitudes');
        }
    }

    function renderCatalogoCards() {
        const container = document.getElementById('inv-catalogo-list');
        if (!container) return;
        if (!hayCatalogo) {
            container.innerHTML = `
                <div class="empty-state">
                    <div>
                        <strong>Aun no hay catalogo cargado</strong>
                        <p>${esAdmin ? 'Importa tu Excel de inventario para comenzar.' : 'El planificador debe importar el Excel de inventario.'}</p>
                        ${esAdmin ? '<button class="btn btn-primary" type="button" onclick="document.getElementById(\'btn-importar-insumos-excel\').click();"><i class="fa-solid fa-file-arrow-up"></i> Importar Excel</button>' : ''}
                    </div>
                </div>`;
            return;
        }
        const texto = filtroBusqueda.toLowerCase();
        const items = catalogoActivo.filter((item) => {
            if (filtroCat && item.categoria !== filtroCat) return false;
            if (filtroMarca && item.marca !== filtroMarca) return false;
            if (soloBajo) {
                const min = calcularStockMinimoEfectivo(item);
                if (enteroSeguro(item.stock_actual, 0) > min) return false;
            }
            if (!texto) return true;
            return [item.nombre, item.marca, item.ubicacion, String(item.codigo || '')]
                .some((v) => String(v || '').toLowerCase().includes(texto));
        });
        if (!items.length) {
            container.innerHTML = '<div class="empty-state empty-state--compact"><div><strong>Sin resultados</strong><p>Ajusta los filtros o la busqueda.</p></div></div>';
            return;
        }
        container.innerHTML = `<div class="inv-card-grid">${items.map((item) => renderCatalogoCardHtml(item)).join('')}</div>`;
    }

    function renderCatalogoCardHtml(item) {
        const meta = obtenerCategoriaInsumoMeta(item.categoria);
        const stock = enteroSeguro(item.stock_actual, 0);
        const inicial = enteroSeguro(item.stock_inicial, 0);
        const minimo = calcularStockMinimoEfectivo(item);
        const pct = inicial > 0 ? Math.min(100, Math.max(0, Math.round((stock / inicial) * 100))) : 0;
        const bajo = stock <= minimo && minimo > 0;
        const criticoColor = stock <= 0 ? '#7f1d1d' : bajo ? '#dc2626' : 'var(--text-main)';
        const barColor = stock <= 0 ? '#7f1d1d' : bajo ? '#dc2626' : '#cbd5e1';
        const acciones = esAdmin ? `
            <div class="inv-card-actions">
                <button type="button" class="btn btn-outline btn-small" onclick="window._invAjustarStock('${item.id}')"><i class="fa-solid fa-pen-to-square"></i> Ajustar</button>
                <button type="button" class="btn btn-outline btn-small" onclick="window._invEditar('${item.id}')"><i class="fa-solid fa-sliders"></i> Editar</button>
                <button type="button" class="btn btn-outline btn-small inv-danger-btn" onclick="window._invEliminar('${item.id}')" title="Archivar"><i class="fa-solid fa-trash"></i></button>
            </div>
        ` : '';
        return `
            <article class="inv-card ${bajo ? 'inv-card--bajo' : ''}">
                <header class="inv-card-head">
                    <span class="inv-cat-tag" style="--chip-color:${meta.color};"><i class="fa-solid ${meta.icon}"></i> ${meta.label}</span>
                    <span class="inv-code">#${item.codigo || '--'}</span>
                </header>
                <h3 class="inv-card-title">${item.nombre}</h3>
                <div class="inv-card-sub">${item.marca || 'Sin marca'} · ${item.unidad}${item.ubicacion ? ` · <i class="fa-solid fa-location-dot"></i> ${item.ubicacion}` : ''}</div>
                <div class="inv-card-stock">
                    <div class="inv-stock-big" style="color:${criticoColor};">${stock}</div>
                    <div class="inv-stock-meta">
                        <span>de ${inicial} inicial</span>
                        <span>minimo ${minimo}</span>
                    </div>
                </div>
                <div class="inv-bar"><div class="inv-bar-fill" style="width:${pct}%; background:${barColor};"></div></div>
                ${bajo ? '<div class="inv-alert"><i class="fa-solid fa-triangle-exclamation"></i> Reponer: bajo el minimo.</div>' : ''}
                ${item.observaciones ? `<p class="inv-card-note">${item.observaciones}</p>` : ''}
                ${acciones}
            </article>
        `;
    }

    function renderMovimientos() {
        const container = document.getElementById('inv-movimientos-list');
        if (!container) return;
        const texto = filtroMovTexto.toLowerCase();
        const items = estado.movimientosInventario.filter((mov) => {
            if (filtroMovTipo && mov.tipo !== filtroMovTipo) return false;
            if (!texto) return true;
            const ins = obtenerInsumoPorId(mov.insumo_id);
            return [ins?.nombre, ins?.marca, mov.motivo, mov.creado_por]
                .some((v) => String(v || '').toLowerCase().includes(texto));
        });
        if (!items.length) {
            container.innerHTML = '<div class="empty-state empty-state--compact"><div><strong>Sin movimientos</strong><p>Ingresos, salidas y ajustes apareceran aqui.</p></div></div>';
            return;
        }
        container.innerHTML = `
            <div class="inv-mov-list">
                ${items.map((mov) => {
                    const ins = obtenerInsumoPorId(mov.insumo_id);
                    const esIngreso = mov.tipo === 'entrada';
                    const esAjuste = mov.tipo === 'ajuste';
                    const color = esIngreso ? '#16a34a' : esAjuste ? '#b45309' : '#dc2626';
                    const icon = esIngreso ? 'fa-arrow-down' : esAjuste ? 'fa-wrench' : 'fa-arrow-up';
                    const sign = esIngreso ? '+' : esAjuste ? '±' : '-';
                    // Para salidas, resolver el solicitante vía referencia_id → solicitudes_insumos → trabajador
                    let solicitanteNombre = '';
                    if (mov.tipo === 'salida' && mov.referencia_id) {
                        const sol = estado.solicitudesInsumos?.find((s) => String(s.id) === String(mov.referencia_id));
                        if (sol) {
                            const tr = estado.trabajadores?.find((t) => String(t.id) === String(sol.trabajador_id));
                            solicitanteNombre = tr?.nombre || sol.trabajador_nombre || '';
                        }
                    }
                    return `
                        <div class="inv-mov-row">
                            <div class="inv-mov-icon" style="background:${color}1a; color:${color};"><i class="fa-solid ${icon}"></i></div>
                            <div class="inv-mov-body">
                                <strong>${ins?.nombre || 'Insumo eliminado'}</strong>
                                <div class="inv-mov-meta">
                                    <span>${formatearFechaHora(mov.fecha)}</span>
                                    ${solicitanteNombre ? `<span>· Solicitó: <strong>${solicitanteNombre}</strong></span>` : ''}
                                    ${mov.creado_por ? `<span>· Aprobó: ${mov.creado_por}</span>` : ''}
                                    ${mov.motivo ? `<span>· ${mov.motivo}</span>` : ''}
                                </div>
                            </div>
                            <div class="inv-mov-qty" style="color:${color};">${sign}${mov.cantidad}</div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    function renderAprobadores() {
        const container = document.getElementById('inv-aprobadores-list');
        if (!container) return;
        const trabajadoresOrdenados = estado.trabajadores.slice().sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es'));
        container.innerHTML = `
            <div class="inv-aprob-list">
                ${trabajadoresOrdenados.map((item) => `
                    <div class="inv-aprob-row">
                        <div>
                            <strong>${item.nombre}</strong>
                            <div style="font-size:0.76rem; color:var(--text-muted);">${item.puesto || 'Sin cargo'}</div>
                        </div>
                        <label class="inv-switch">
                            <input type="checkbox" ${item.puede_aprobar_insumos ? 'checked' : ''} onchange="window._insToggleAprobador('${item.id}', this.checked)">
                            <span>${item.puede_aprobar_insumos ? 'Puede aprobar' : 'Solo solicita'}</span>
                        </label>
                    </div>
                `).join('')}
            </div>
        `;
    }

    function actualizarMetaInsumoSeleccionado() {
        const select = document.getElementById('insumo-select');
        const cantidadInput = document.getElementById('insumo-cantidad');
        const meta = document.getElementById('insumo-select-meta');
        const hint = document.getElementById('insumo-cantidad-hint');
        if (!select || !meta || !hint) return;
        const insumo = obtenerInsumoPorId(select.value);
        const cantidad = enteroSeguro(cantidadInput?.value, 0);
        if (!insumo) {
            meta.innerHTML = '<strong style="display:block; margin-bottom:0.3rem;">Selecciona un item para ver el stock actual.</strong><p style="margin:0; color:var(--text-muted); font-size:0.82rem;">Veras marca, unidad de medida y alerta de disponibilidad antes de enviar.</p>';
            hint.textContent = 'No se permite solicitar mas del doble del stock disponible.';
            hint.style.color = 'var(--text-muted)';
            return;
        }

        const stock = enteroSeguro(insumo.stock_actual, 0);
        const stockInicial = enteroSeguro(insumo.stock_inicial, 0);
        const superaStock = cantidad > stock && stock > 0;
        const superaDoble = cantidad > (stock * 2) && stock > 0;
        meta.innerHTML = `
            <strong style="display:block; margin-bottom:0.25rem;">${insumo.nombre}</strong>
            <div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:0.45rem;">${insumo.marca || 'Sin marca'} · ${insumo.unidad}</div>
            <div style="display:flex; gap:0.9rem; flex-wrap:wrap;">
                <span><strong>${stock}</strong> disponibles</span>
                <span><strong>${stockInicial}</strong> stock inicial</span>
            </div>
        `;
        if (superaDoble) {
            hint.textContent = 'La cantidad supera el maximo permitido (doble del stock actual).';
            hint.style.color = '#dc2626';
        } else if (superaStock) {
            hint.textContent = 'La solicitud supera el stock actual. Se permitira, pero quedara visible para revision.';
            hint.style.color = '#b45309';
        } else {
            hint.textContent = 'No se permite solicitar mas del doble del stock disponible.';
            hint.style.color = 'var(--text-muted)';
        }
    }

    function renderTablaSolicitudes() {
        const container = document.getElementById('inv-solicitudes-list');
        if (!container) return;

        const filas = solicitudesBase.filter((item) => {
            if (filtroEstado !== 'todos' && item.estado !== filtroEstado) return false;
            if (filtroSolicitudesMes) {
                const fechaBase = String(item.fecha_aprobacion || item.fecha_solicitud || item.created_at || '');
                if (!fechaBase.startsWith(filtroSolicitudesMes)) return false;
            }
            if (filtroTrabajador && String(item.trabajador_id) !== String(filtroTrabajador)) return false;
            if (!filtroTexto) return true;
            const insumo = obtenerInsumoPorId(item.insumo_id);
            const nombreSolicitante = obtenerNombreTrabajadorPorId(item.trabajador_id);
            const textoBase = `${insumo?.nombre || ''} ${insumo?.marca || ''} ${nombreSolicitante}`.toLowerCase();
            return textoBase.includes(filtroTexto);
        });

        if (!filas.length) {
            container.innerHTML = '<div class="empty-state empty-state--compact"><div><strong>Sin solicitudes para este filtro</strong><p>Ajusta el estado o crea una nueva solicitud.</p></div></div>';
            return;
        }

        container.innerHTML = `
            <div class="inv-sol-list">
                ${filas.map((item) => {
                    const insumo = obtenerInsumoPorId(item.insumo_id);
                    const stockActual = enteroSeguro(insumo?.stock_actual, 0);
                    const observaciones = item.observaciones
                        ? `<div class="inv-sol-note">${item.observaciones}</div>`
                        : item.aprobado_por
                            ? `<div class="inv-sol-note">Gestionado por ${item.aprobado_por}</div>`
                            : '';
                    const botonesEstado = (esAdmin || puedeAprobar) && item.estado === 'pendiente'
                        ? `
                                <button type="button" class="btn btn-small inv-btn-approve" onclick="window._insAprobar('${item.id}')"><i class="fa-solid fa-check"></i> Aprobar</button>
                                <button type="button" class="btn btn-small inv-btn-reject" onclick="window._insRechazar('${item.id}')"><i class="fa-solid fa-ban"></i> Rechazar</button>
                        ` : '';
                    const botonEliminar = esAdmin
                        ? `<button type="button" class="btn btn-outline btn-small inv-danger-btn" onclick="window._insEliminar('${item.id}')" title="Eliminar solicitud"><i class="fa-solid fa-trash"></i></button>`
                        : '';
                    const acciones = (botonesEstado || botonEliminar)
                        ? `<div class="inv-sol-actions">${botonesEstado}${botonEliminar}</div>`
                        : '';
                    return `
                        <div class="inv-sol-row">
                            <div class="inv-sol-main">
                                <div class="inv-sol-head">
                                    <strong>${insumo?.nombre || 'Insumo no disponible'}</strong>
                                    ${badgeEstadoSolicitudInsumoHtml(item.estado)}
                                </div>
                                <div class="inv-sol-sub">
                                    ${(esAdmin || puedeAprobar) ? `<span><i class="fa-solid fa-user"></i> ${obtenerNombreTrabajadorPorId(item.trabajador_id)}</span>` : ''}
                                    <span>${insumo?.marca || 'Sin marca'} · ${insumo?.unidad || 'UNI'}</span>
                                    <span><i class="fa-solid fa-calendar"></i> ${formatearFechaCorta(item.fecha_solicitud)}</span>
                                </div>
                                ${observaciones}
                            </div>
                            <div class="inv-sol-qty">
                                <div class="inv-sol-qty-big">${formatearCantidadInsumo(item.cantidad, insumo?.unidad)}</div>
                                <div class="inv-sol-qty-meta">stock: ${stockActual}</div>
                            </div>
                            ${acciones}
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    document.getElementById('insumo-select')?.addEventListener('change', actualizarMetaInsumoSeleccionado);
    document.getElementById('insumo-cantidad')?.addEventListener('input', actualizarMetaInsumoSeleccionado);
    actualizarMetaInsumoSeleccionado();

    document.getElementById('form-insumo-solicitud')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const select = document.getElementById('insumo-select');
        const cantidadInput = document.getElementById('insumo-cantidad');
        const boton = document.getElementById('btn-enviar-solicitud-insumo');
        const insumo = obtenerInsumoPorId(select?.value);
        const cantidad = enteroSeguro(cantidadInput?.value, 0);

        if (!insumo || !insumo.activo) {
            alert('Selecciona un insumo activo.');
            return;
        }
        if (cantidad <= 0) {
            alert('La cantidad debe ser mayor a cero.');
            return;
        }
        if (cantidad > Math.max(enteroSeguro(insumo.stock_actual, 0) * 2, 1)) {
            alert('La cantidad solicitada supera el maximo permitido para este item.');
            return;
        }

        const textoOriginal = boton.innerHTML;
        boton.disabled = true;
        boton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Enviando...';
        try {
            await guardarSolicitudInsumo(usuarioSolicitanteActualId(), insumo.id, cantidad);
            vistaActual = 'insumos';
            renderizarVistaActual();
        } catch (error) {
            alert(error?.message || 'No se pudo guardar la solicitud.');
            boton.disabled = false;
            boton.innerHTML = textoOriginal;
        }
    });

    document.getElementById('insumos-filtro-estado')?.addEventListener('change', (event) => {
        filtroEstado = event.target.value;
        if (filtroEstado !== 'aprobada') filtroSolicitudesMes = '';
        sincronizarFiltrosSolicitudesUI();
        renderTablaSolicitudes();
    });
    document.getElementById('insumos-filtro-trabajador')?.addEventListener('change', (event) => {
        filtroTrabajador = event.target.value;
        renderTablaSolicitudes();
    });
    document.getElementById('insumos-filtro-texto')?.addEventListener('input', (event) => {
        filtroTexto = String(event.target.value || '').trim().toLowerCase();
        renderTablaSolicitudes();
    });

    document.getElementById('btn-importar-insumos-excel')?.addEventListener('click', () => {
        document.getElementById('input-insumos-excel')?.click();
    });
    document.getElementById('input-insumos-excel')?.addEventListener('change', async (event) => {
        const archivo = event.target.files?.[0];
        if (!archivo) return;
        try {
            const resumen = await importarCatalogoInsumosDesdeExcel(archivo);
            alert(`Catalogo importado: ${resumen.total} item(s).${resumen.remoteSynced ? ' Supabase actualizado.' : ' Guardado en modo local.'}`);
            vistaActual = 'insumos';
            renderizarVistaActual();
        } catch (error) {
            alert(error?.message || 'No se pudo importar el Excel.');
        } finally {
            event.target.value = '';
        }
    });

    window._insAprobar = async (id) => {
        await aprobarSolicitudInsumo(id);
        vistaActual = 'insumos';
        renderizarVistaActual();
    };

    window._insRechazar = (id) => {
        const modal = document.getElementById('modal-insumos-rechazo');
        const textarea = document.getElementById('insumos-rechazo-observaciones');
        const error = document.getElementById('insumos-rechazo-error');
        const btnConfirmar = document.getElementById('btn-insumos-rechazo-confirmar');
        const btnCancelar = document.getElementById('btn-insumos-rechazo-cancelar');
        if (!modal || !textarea || !error || !btnConfirmar || !btnCancelar) return;

        textarea.value = '';
        error.style.display = 'none';
        modal.style.display = 'flex';

        btnCancelar.onclick = () => { modal.style.display = 'none'; };
        btnConfirmar.onclick = async () => {
            const motivo = textarea.value.trim();
            if (!motivo) {
                error.style.display = 'block';
                return;
            }
            btnConfirmar.disabled = true;
            btnConfirmar.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Guardando...';
            await rechazarSolicitudInsumo(id, motivo);
            modal.style.display = 'none';
            btnConfirmar.disabled = false;
            btnConfirmar.innerHTML = 'Guardar rechazo';
            vistaActual = 'insumos';
            renderizarVistaActual();
        };
    };

    window._insToggleAprobador = async (trabajadorId, checked) => {
        await actualizarPermisoAprobadorInsumos(trabajadorId, checked);
        vistaActual = 'insumos';
        renderizarVistaActual();
    };

    // Revierte el efecto de una solicitud aprobada: devuelve stock y borra el movimiento
    const revertirSolicitudAprobada = async (solicitud) => {
        if (!solicitud || solicitud.estado !== 'aprobada') return;
        const cant = enteroSeguro(solicitud.cantidad, 0);
        if (cant <= 0) return;
        const insumo = estado.insumos?.find((i) => String(i.id) === String(solicitud.insumo_id));
        const stockNuevo = enteroSeguro(insumo?.stock_actual, 0) + cant;
        if (insumo && window.localDB) {
            await window.localDB.insumos.put({ ...insumo, stock_actual: stockNuevo }).catch(() => {});
        }
        if (window.supabaseClient) {
            try { await window.supabaseClient.from('insumos').update({ stock_actual: stockNuevo }).eq('id', solicitud.insumo_id); } catch (e) { console.warn('[insumos] revertir stock', e); }
            try { await window.supabaseClient.from('movimientos_inventario').delete().eq('referencia_id', solicitud.id); } catch (e) { console.warn('[insumos] borrar movimiento', e); }
        }
        if (window.localDB?.movimientos_inventario) {
            try {
                const movs = await window.localDB.movimientos_inventario.getAll();
                for (const m of (movs || [])) {
                    if (String(m.referencia_id) === String(solicitud.id)) await window.localDB.movimientos_inventario.delete(m.id);
                }
            } catch (e) { /* ignore */ }
        }
    };

    window._insEliminar = async (id) => {
        const solicitud = estado.solicitudesInsumos?.find((s) => String(s.id) === String(id));
        const msg = solicitud?.estado === 'aprobada'
            ? '¿Eliminar esta solicitud? Se devolverá el stock descontado como si no hubiera existido.'
            : '¿Eliminar esta solicitud del historial? Esta acción no se puede deshacer.';
        if (!confirm(msg)) return;
        try {
            await revertirSolicitudAprobada(solicitud);
            await localDB.solicitudes_insumos.delete(id);
            if (window.supabaseClient) {
                try { await window.supabaseClient.from('solicitudes_insumos').delete().eq('id', id); } catch (e) { console.warn('[insumos] remote delete fallo', e); }
            }
            await refrescarDatosInsumos();
            vistaActual = 'insumos';
            renderizarVistaActual();
        } catch (error) {
            alert(error?.message || 'No se pudo eliminar la solicitud.');
        }
    };

    document.getElementById('btn-insumos-limpiar-resueltas')?.addEventListener('click', async () => {
        const resueltas = solicitudesBase.filter((s) => s.estado !== 'pendiente');
        if (!resueltas.length) {
            alert('No hay solicitudes resueltas para limpiar.');
            return;
        }
        if (!confirm(`Se eliminarán ${resueltas.length} solicitudes aprobadas/rechazadas. ¿Continuar?`)) return;
        try {
            for (const s of resueltas) {
                await revertirSolicitudAprobada(s);
                await localDB.solicitudes_insumos.delete(s.id);
                if (window.supabaseClient) {
                    try { await window.supabaseClient.from('solicitudes_insumos').delete().eq('id', s.id); } catch (e) { /* ignore */ }
                }
            }
            await refrescarDatosInsumos();
            vistaActual = 'insumos';
            renderizarVistaActual();
        } catch (error) {
            alert(error?.message || 'No se pudieron limpiar las solicitudes.');
        }
    });

    window._invAjustarStock = (insumoId) => {
        const insumo = obtenerInsumoPorId(insumoId);
        if (!insumo) return;
        abrirModalInsumo({
            eyebrow: 'Movimiento manual',
            titulo: `Ajustar stock: ${insumo.nombre}`,
            bodyHtml: `
                <p class="inv-modal-info">Stock actual: <strong>${insumo.stock_actual}</strong> · Minimo: <strong>${calcularStockMinimoEfectivo(insumo)}</strong></p>
                <div class="form-group">
                    <label>Tipo de movimiento</label>
                    <div class="inv-seg">
                        <label><input type="radio" name="inv-mov" value="entrada" checked> <span>Ingreso (+)</span></label>
                        <label><input type="radio" name="inv-mov" value="salida"> <span>Salida (-)</span></label>
                        <label><input type="radio" name="inv-mov" value="ajuste"> <span>Fijar total</span></label>
                    </div>
                </div>
                <div class="form-group">
                    <label for="inv-ajuste-cantidad">Cantidad</label>
                    <input id="inv-ajuste-cantidad" type="number" min="0" step="1" class="form-control" placeholder="Ej: 5">
                </div>
                <div class="form-group">
                    <label for="inv-ajuste-motivo">Motivo</label>
                    <input id="inv-ajuste-motivo" type="text" class="form-control" placeholder="Ej: Compra, correccion de inventario, entrega a cuadrilla...">
                </div>
            `,
            onConfirm: async () => {
                const tipo = document.querySelector('input[name="inv-mov"]:checked')?.value || 'entrada';
                const cantidad = enteroSeguro(document.getElementById('inv-ajuste-cantidad')?.value, 0);
                const motivo = String(document.getElementById('inv-ajuste-motivo')?.value || '').trim();
                if (cantidad <= 0) throw new Error('La cantidad debe ser mayor a cero.');
                if (!motivo) throw new Error('Indica un motivo para el movimiento.');
                if (tipo === 'ajuste') {
                    await ajustarStockInsumo(insumoId, cantidad, motivo);
                } else {
                    await registrarMovimientoManual(insumoId, tipo, cantidad, motivo);
                }
            }
        });
    };

    window._invEditar = (insumoId) => {
        const insumo = obtenerInsumoPorId(insumoId);
        if (!insumo) return;
        const categoriasOpts = CATEGORIAS_INSUMO.map((cat) => `<option value="${cat.id}" ${insumo.categoria === cat.id ? 'selected' : ''}>${cat.label}</option>`).join('');
        abrirModalInsumo({
            eyebrow: 'Configuracion',
            titulo: `Editar: ${insumo.nombre}`,
            bodyHtml: `
                <div class="form-group">
                    <label for="inv-ed-nombre">Nombre</label>
                    <input id="inv-ed-nombre" type="text" class="form-control" value="${escHtml(insumo.nombre)}">
                </div>
                <div class="inv-form-row">
                    <div class="form-group">
                        <label for="inv-ed-marca">Marca</label>
                        <input id="inv-ed-marca" type="text" class="form-control" value="${escHtml(insumo.marca)}">
                    </div>
                    <div class="form-group">
                        <label for="inv-ed-cat">Categoria</label>
                        <select id="inv-ed-cat" class="form-control">${categoriasOpts}</select>
                    </div>
                </div>
                <div class="inv-form-row">
                    <div class="form-group">
                        <label for="inv-ed-min">Stock minimo</label>
                        <input id="inv-ed-min" type="number" min="0" step="1" class="form-control" value="${insumo.stock_minimo || ''}" placeholder="30% del inicial por defecto">
                    </div>
                    <div class="form-group">
                        <label for="inv-ed-inicial">Stock inicial</label>
                        <input id="inv-ed-inicial" type="number" min="0" step="1" class="form-control" value="${insumo.stock_inicial}">
                    </div>
                </div>
                <div class="form-group">
                    <label for="inv-ed-ubic">Ubicacion</label>
                    <input id="inv-ed-ubic" type="text" class="form-control" value="${escHtml(insumo.ubicacion)}" placeholder="Ej: Bodega B - Estante 3">
                </div>
                <div class="form-group">
                    <label for="inv-ed-obs">Observaciones</label>
                    <textarea id="inv-ed-obs" class="form-control" rows="2" placeholder="Notas internas...">${escHtml(insumo.observaciones)}</textarea>
                </div>
            `,
            onConfirm: async () => {
                const nombre = String(document.getElementById('inv-ed-nombre')?.value || '').trim();
                if (!nombre) throw new Error('El nombre es obligatorio.');
                await actualizarConfiguracionInsumo(insumoId, {
                    nombre,
                    marca: String(document.getElementById('inv-ed-marca')?.value || '').trim(),
                    categoria: document.getElementById('inv-ed-cat')?.value || insumo.categoria,
                    stock_minimo: enteroSeguro(document.getElementById('inv-ed-min')?.value, 0),
                    stock_inicial: enteroSeguro(document.getElementById('inv-ed-inicial')?.value, insumo.stock_inicial),
                    ubicacion: String(document.getElementById('inv-ed-ubic')?.value || '').trim(),
                    observaciones: String(document.getElementById('inv-ed-obs')?.value || '').trim()
                });
            }
        });
    };

    window._invEliminar = async (insumoId) => {
        const insumo = obtenerInsumoPorId(insumoId);
        if (!insumo) return;
        if (!confirm(`¿Archivar "${insumo.nombre}"? Se ocultara del catalogo pero se conservara el historial.`)) return;
        await eliminarInsumoCatalogo(insumoId);
        vistaActual = 'insumos';
        renderizarVistaActual();
    };

    window._invNuevoItem = () => {
        const codigosUsados = new Set(estado.insumos.map((i) => Number(i.codigo)).filter(Boolean));
        let nextCodigo = 1;
        while (codigosUsados.has(nextCodigo)) nextCodigo++;
        const categoriasOpts = CATEGORIAS_INSUMO.map((cat) => `<option value="${cat.id}">${cat.label}</option>`).join('');
        abrirModalInsumo({
            eyebrow: 'Catalogo',
            titulo: 'Nuevo item de inventario',
            bodyHtml: `
                <div class="inv-form-row">
                    <div class="form-group">
                        <label for="inv-nv-codigo">Codigo</label>
                        <input id="inv-nv-codigo" type="number" min="1" step="1" class="form-control" value="${nextCodigo}">
                    </div>
                    <div class="form-group">
                        <label for="inv-nv-cat">Categoria</label>
                        <select id="inv-nv-cat" class="form-control">${categoriasOpts}</select>
                    </div>
                </div>
                <div class="form-group">
                    <label for="inv-nv-nombre">Nombre</label>
                    <input id="inv-nv-nombre" type="text" class="form-control" placeholder="Ej: Guante nitrilo talla M">
                </div>
                <div class="inv-form-row">
                    <div class="form-group">
                        <label for="inv-nv-marca">Marca</label>
                        <input id="inv-nv-marca" type="text" class="form-control">
                    </div>
                    <div class="form-group">
                        <label for="inv-nv-unidad">Unidad</label>
                        <select id="inv-nv-unidad" class="form-control">
                            <option value="UNI">UNI</option>
                            <option value="PARES">PARES</option>
                        </select>
                    </div>
                </div>
                <div class="inv-form-row">
                    <div class="form-group">
                        <label for="inv-nv-inicial">Stock inicial</label>
                        <input id="inv-nv-inicial" type="number" min="0" step="1" class="form-control" value="0">
                    </div>
                    <div class="form-group">
                        <label for="inv-nv-min">Stock minimo</label>
                        <input id="inv-nv-min" type="number" min="0" step="1" class="form-control" placeholder="opcional">
                    </div>
                </div>
                <div class="form-group">
                    <label for="inv-nv-ubic">Ubicacion</label>
                    <input id="inv-nv-ubic" type="text" class="form-control" placeholder="Ej: Bodega B">
                </div>
            `,
            onConfirm: async () => {
                const nombre = String(document.getElementById('inv-nv-nombre')?.value || '').trim();
                if (!nombre) throw new Error('El nombre es obligatorio.');
                const codigo = enteroSeguro(document.getElementById('inv-nv-codigo')?.value, 0);
                if (!codigo) throw new Error('El codigo es obligatorio.');
                if (estado.insumos.some((i) => Number(i.codigo) === codigo)) throw new Error('Ya existe un item con ese codigo.');
                const nuevo = normalizarRegistroInsumo({
                    id: crypto.randomUUID(),
                    codigo,
                    nombre,
                    marca: String(document.getElementById('inv-nv-marca')?.value || '').trim(),
                    unidad: document.getElementById('inv-nv-unidad')?.value || 'UNI',
                    categoria: document.getElementById('inv-nv-cat')?.value || 'consumibles',
                    stock_inicial: enteroSeguro(document.getElementById('inv-nv-inicial')?.value, 0),
                    stock_actual: enteroSeguro(document.getElementById('inv-nv-inicial')?.value, 0),
                    stock_minimo: enteroSeguro(document.getElementById('inv-nv-min')?.value, 0),
                    ubicacion: String(document.getElementById('inv-nv-ubic')?.value || '').trim(),
                    activo: true,
                    created_at: new Date().toISOString()
                });
                await persistirInsumoLocal(nuevo);
                await sincronizarInsumoRemoto(nuevo);
            }
        });
    };

    // Tabs
    mainContent.querySelectorAll('.inv-tab').forEach((btn) => {
        btn.addEventListener('click', () => activarTab(btn.dataset.tab));
    });
    mainContent.querySelectorAll('.inv-kpi-card[data-kpi]').forEach((card) => {
        const abrir = () => abrirDetalleKpiInventario(card.dataset.kpi || '');
        card.addEventListener('click', abrir);
        card.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                abrir();
            }
        });
    });

    // Catalogo filters
    document.getElementById('inv-search')?.addEventListener('input', (e) => {
        filtroBusqueda = String(e.target.value || '').trim();
        renderCatalogoCards();
    });
    document.getElementById('inv-marca')?.addEventListener('change', (e) => {
        filtroMarca = e.target.value;
        renderCatalogoCards();
    });
    document.getElementById('inv-solo-bajo')?.addEventListener('change', (e) => {
        soloBajo = e.target.checked;
        renderCatalogoCards();
    });
    mainContent.querySelectorAll('#inv-chips-cat .inv-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
            filtroCat = chip.dataset.cat || '';
            mainContent.querySelectorAll('#inv-chips-cat .inv-chip').forEach((c) => c.classList.toggle('is-active', c === chip));
            renderCatalogoCards();
        });
    });
    document.getElementById('btn-nuevo-insumo')?.addEventListener('click', () => window._invNuevoItem());

    // Movimientos filters
    document.getElementById('inv-mov-search')?.addEventListener('input', (e) => {
        filtroMovTexto = String(e.target.value || '').trim();
        renderMovimientos();
    });
    document.getElementById('inv-mov-tipo')?.addEventListener('change', (e) => {
        filtroMovTipo = e.target.value;
        renderMovimientos();
    });

    // FAB
    document.getElementById('inv-fab-solicitud')?.addEventListener('click', () => activarTab('solicitudes'));

    // Activar tab inicial
    activarTab(tabActiva);
    actualizarBadgeInsumos();
}

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
async function renderMisHorasView() {
    const trabajador = estado.trabajadorLogueado;
    if (!trabajador) return;
    mainContent.innerHTML = `
        <div style="max-width:700px; margin:0 auto; padding:1.5rem 1rem;">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:1.5rem; flex-wrap:wrap; gap:0.8rem;">
                <h2 style="margin:0; font-size:1.2rem; color:var(--text-main); display:flex; align-items:center; gap:0.5rem;">
                    <i class="fa-regular fa-clock"></i> Mis Horas Extra
                </h2>
                <div style="display:flex; gap:0.6rem; flex-wrap:wrap;">
                    <button onclick="window.mostrarCalendarioHorasExtra('${trabajador.id}')"
                        style="background:transparent; border:1px solid var(--border-color); color:var(--text-muted); border-radius:8px; padding:0.5rem 1rem; font-size:0.85rem; cursor:pointer; display:flex; align-items:center; gap:0.4rem;">
                        <i class="fa-regular fa-calendar"></i> Calendario
                    </button>
                    <button onclick="window.abrirModalHorasExtraManual('${trabajador.id}')"
                        class="btn btn-primary" style="font-size:0.85rem; padding:0.5rem 1.1rem; border-radius:8px;">
                        + Agregar horas extra
                    </button>
                </div>
            </div>
            <div class="panel" id="mis-horas-contenido">
                <p style="color:var(--text-muted); font-size:0.85rem;">Cargando...</p>
            </div>
        </div>`;

    const registros = await cargarHorasExtraTrabajador(trabajador.id);
    const contenedor = document.getElementById('mis-horas-contenido');
    if (!contenedor) return;

    if (registros.length === 0) {
        contenedor.innerHTML = `<div class="empty-state empty-state--compact"><div><strong>Sin horas extra registradas</strong><p>Cuando registres horas extra aparecerán aquí con su estado y motivo.</p></div></div>`;
        return;
    }

    const ahora = new Date();
    const mesActual = ahora.getFullYear() + '-' + String(ahora.getMonth() + 1).padStart(2, '0');
    const totalMes = registros
        .filter(r => r.fecha && r.fecha.startsWith(mesActual) && r.estado === 'aprobado')
        .reduce((s, r) => s + (parseFloat(r.horas) || 0), 0);
    const totalHistorico = registros
        .filter(r => r.estado === 'aprobado')
        .reduce((s, r) => s + (parseFloat(r.horas) || 0), 0);

    const filas = registros.map(r => {
        const fechaFmt = r.fecha ? new Date(r.fecha + 'T12:00:00').toLocaleDateString('es-CL', { day:'2-digit', month:'short', year:'numeric' }) : '—';
        const est = r.estado || 'pendiente';
        const badgeStyle = est === 'aprobado'
            ? 'background:#dcfce7; color:#16a34a;'
            : est === 'rechazado'
            ? 'background:#fee2e2; color:#dc2626;'
            : 'background:#fef9c3; color:#b45309;';
        const badgeLabel = est === 'aprobado' ? 'Aprobado' : est === 'rechazado' ? 'Rechazado' : 'Pendiente';
        const notaRechazo = est === 'rechazado' && r.motivo_rechazo
            ? `<div style="font-size:0.7rem; color:#dc2626; margin-top:0.2rem;"><i class="fa-solid fa-circle-info"></i> ${r.motivo_rechazo}</div>` : '';
        return `<tr style="${est === 'rechazado' ? 'opacity:0.65;' : ''}">
            <td style="font-size:0.83rem; padding:0.5rem 0.6rem; color:var(--text-muted);">${fechaFmt}</td>
            <td style="font-size:0.83rem; padding:0.5rem 0.6rem; font-weight:600; color:var(--primary-color); ${est === 'rechazado' ? 'text-decoration:line-through; color:var(--text-muted);' : ''}">${r.horas} hrs</td>
            <td style="font-size:0.83rem; padding:0.5rem 0.6rem; color:var(--text-muted);">${r.motivo || '—'}</td>
            <td style="font-size:0.83rem; padding:0.5rem 0.6rem;">
                <span style="border-radius:6px; padding:0.15rem 0.55rem; font-size:0.7rem; font-weight:600; ${badgeStyle}">${badgeLabel}</span>
                ${notaRechazo}
            </td>
            <td style="padding:0.5rem 0.6rem;">
                <button onclick="window._eliminarHoraExtra('${r.id}')"
                    style="background:none; border:none; cursor:pointer; color:#dc2626; font-size:0.95rem; padding:2px 6px; border-radius:6px; transition:background 150ms;"
                    onmouseover="this.style.background='#fee2e2'" onmouseout="this.style.background='none'"
                    title="Eliminar">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </td>
        </tr>`;
    }).join('');

    contenedor.innerHTML = `
        <div style="display:flex; gap:1.5rem; margin-bottom:1.2rem; flex-wrap:wrap;">
            <div style="background:var(--glass-bg); border-radius:8px; padding:0.8rem 1.1rem; min-width:130px;">
                <div style="font-size:1.5rem; font-weight:700; color:var(--primary-color);">${totalMes.toFixed(1)} hrs</div>
                <div style="font-size:0.72rem; color:var(--text-muted); margin-top:0.1rem;">Este mes (aprobadas)</div>
            </div>
            <div style="background:var(--glass-bg); border-radius:8px; padding:0.8rem 1.1rem; min-width:130px;">
                <div style="font-size:1.5rem; font-weight:700; color:var(--text-main);">${totalHistorico.toFixed(1)} hrs</div>
                <div style="font-size:0.72rem; color:var(--text-muted); margin-top:0.1rem;">Histórico aprobado</div>
            </div>
        </div>
        <div class="table-shell">
            <table class="table-clean" style="width:100%; border-collapse:collapse;">
                <thead>
                    <tr style="border-bottom:1px solid var(--border-color);">
                        <th style="text-align:left; font-size:0.75rem; color:var(--text-muted); padding:0.4rem 0.6rem; font-weight:600;">Fecha</th>
                        <th style="text-align:left; font-size:0.75rem; color:var(--text-muted); padding:0.4rem 0.6rem; font-weight:600;">Horas</th>
                        <th style="text-align:left; font-size:0.75rem; color:var(--text-muted); padding:0.4rem 0.6rem; font-weight:600;">Motivo</th>
                        <th style="text-align:left; font-size:0.75rem; color:var(--text-muted); padding:0.4rem 0.6rem; font-weight:600;">Estado</th>
                    </tr>
                </thead>
                <tbody>${filas}</tbody>
            </table>
        </div>`;
}

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
                        <span class="badge" style="background:${esLider?'var(--primary-color)':'#64748b'}; color:white; font-size:0.68rem;">${esLider?'Líder':'Técnico'}</span>
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
                </div>

` : `<p style="color:var(--text-muted); text-align:center; padding:2rem 0;">Selecciona un trabajador para ver su perfil.</p>`}
            </div>`;

            mainContent.innerHTML = html;

            document.getElementById('select-perfil-admin').addEventListener('change', (e) => {
                renderAdminPerfil(e.target.value || null);
            });

            if (w) {
                document.getElementById('btn-marcar-salida-admin').addEventListener('click', async () => {
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
    // Incluye: activas (en_curso) + en cola con trabajadores asignados (programada_semana + liderId)
    const tareasDiarias = estado.tareas.filter(t =>
        (t.estadoTarea === 'en_curso' || (t.estadoTarea === 'programada_semana' && t.liderId)) &&
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
                        ${esLider ? 'Líder' : 'Técnico'}
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

// ── Helper: volver al login limpiando estado ─────────────────────────────────
function _volverAlLogin() {
    estado.usuarioActual = 'visita';
    estado.trabajadorLogueado = null;
    if (planifyNotifications.intervalId) clearInterval(planifyNotifications.intervalId);
    planifyNotifications.intervalId = null;
    planifyNotifications.initialized = false;
    document.getElementById('login-overlay').style.display = 'flex';
    document.getElementById('app').style.display = 'none';
    document.querySelector('.role-cards').style.display = 'block';
    const wlc = document.getElementById('worker-login-container');
    if (wlc) wlc.style.display = 'none';
    const rutEl = document.getElementById('input-worker-rut');
    const pinEl = document.getElementById('input-worker-pin');
    if (rutEl) rutEl.value = '';
    if (pinEl) pinEl.value = '';
}

window.marcarSalidaTrabajador = async function(id) {
    await updateTrabajadorDisponibilidad(id, false);
    mostrarModalHorasExtra(id);
};

// ── HORAS EXTRA: guardar registro ────────────────────────────────────────────
async function guardarHorasExtra(trabajadorId, fecha, horas, motivo) {
    const id = `he_${trabajadorId}_${Date.now()}`;
    const payload = {
        id,
        trabajador_id: trabajadorId,
        fecha,
        horas: parseFloat(horas),
        motivo: motivo || '',
        estado: 'pendiente',
        aprobado_por: null,
        fecha_aprobacion: null,
        motivo_rechazo: null,
        created_at: new Date().toISOString(),
        synced: false
    };
    // Guardar en local primero
    if (window.localDB) await window.localDB.horas_extra.upsert(payload).catch(() => {});
    // Intentar sync con Supabase
    if (navigator.onLine && supabaseClient) {
        const { data, error } = await supabaseClient.from('horas_extra').insert([{
            trabajador_id: trabajadorId,
            fecha,
            horas: parseFloat(horas),
            motivo: motivo || '',
            estado: 'pendiente'
        }]).select().single();
        if (!error && data) {
            // Actualizar local con el id real de Supabase
            await window.localDB?.horas_extra.delete(id).catch(() => {});
            await window.localDB?.horas_extra.upsert({ ...data, synced: true }).catch(() => {});
        } else {
            await window.syncQueue?.add('horas_extra', 'INSERT', payload);
        }
    } else {
        await window.syncQueue?.add('horas_extra', 'INSERT', payload);
    }
}

// ── HORAS EXTRA: aprobar registro ────────────────────────────────────────────
async function aprobarHorasExtra(heId) {
    const planificadorNombre = estado.usuarioActual === 'admin' ? 'Planificador' : 'Admin';
    const updates = {
        estado: 'aprobado',
        aprobado_por: planificadorNombre,
        fecha_aprobacion: new Date().toISOString(),
        motivo_rechazo: null
    };
    const local = await window.localDB?.horas_extra.get(heId).catch(() => null);
    if (local) await window.localDB?.horas_extra.upsert({ ...local, ...updates }).catch(() => {});
    if (navigator.onLine && supabaseClient) {
        await supabaseClient.from('horas_extra').update(updates).eq('id', heId);
    } else {
        await window.syncQueue?.add('horas_extra', 'UPDATE', { id: heId, ...updates });
    }
}

// ── HORAS EXTRA: rechazar registro ───────────────────────────────────────────
async function rechazarHorasExtra(heId, motivo) {
    const planificadorNombre = estado.usuarioActual === 'admin' ? 'Planificador' : 'Admin';
    const updates = {
        estado: 'rechazado',
        aprobado_por: planificadorNombre,
        fecha_aprobacion: new Date().toISOString(),
        motivo_rechazo: motivo
    };
    const local = await window.localDB?.horas_extra.get(heId).catch(() => null);
    if (local) await window.localDB?.horas_extra.upsert({ ...local, ...updates }).catch(() => {});
    if (navigator.onLine && supabaseClient) {
        await supabaseClient.from('horas_extra').update(updates).eq('id', heId);
    } else {
        await window.syncQueue?.add('horas_extra', 'UPDATE', { id: heId, ...updates });
    }
}

// ── HORAS EXTRA: cargar TODOS los registros (para planificador) ───────────────
async function cargarTodasHorasExtra() {
    // Siempre leer localDB primero (incluye records pendientes de sync)
    const local = await window.localDB?.horas_extra.getAll().catch(() => []) || [];

    if (navigator.onLine && supabaseClient) {
        const { data } = await supabaseClient
            .from('horas_extra')
            .select('*')
            .order('created_at', { ascending: false });

        if (data) {
            // Guardar en local los synced de Supabase
            if (data.length > 0) {
                await window.localDB?.horas_extra.bulk(data.map(r => ({ ...r, synced: true }))).catch(() => {});
            }
            // Merge: Supabase tiene prioridad; agregar los de localDB que aún no llegaron a Supabase
            const supabaseIds = new Set(data.map(r => String(r.id)));
            const soloLocal = local.filter(r => !supabaseIds.has(String(r.id)));
            const merged = [...data, ...soloLocal];
            return merged.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
        }
    }

    return local.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
}

// ── HORAS EXTRA: badge de pendientes en nav ───────────────────────────────────
async function limpiarColaHorasExtra(filtroFn = null) {
    const cola = await window.localDB?.cola.getAll().catch(() => []) || [];
    const items = cola.filter(item => {
        if (item.tabla !== 'horas_extra') return false;
        return typeof filtroFn === 'function' ? filtroFn(item) : true;
    });
    await Promise.all(items.map(item => window.localDB?.cola.delete(item.id).catch(() => {})));
}

async function eliminarRegistrosHorasExtra(ids = null) {
    if (!navigator.onLine || !supabaseClient) {
        throw new Error('Se requiere conexion a internet para eliminar horas extra.');
    }

    if (Array.isArray(ids) && ids.length > 0) {
        const idsUnicos = [...new Set(ids.map(id => String(id)))];
        const { error } = await supabaseClient.from('horas_extra').delete().in('id', idsUnicos);
        if (error) throw error;

        await Promise.all(idsUnicos.map(id => window.localDB?.horas_extra.delete(id).catch(() => {})));
        await limpiarColaHorasExtra(item => idsUnicos.includes(String(item.payload?.id)));
    } else {
        const { error } = await supabaseClient.from('horas_extra').delete().not('id', 'is', null);
        if (error) throw error;

        await window.localDB?.horas_extra.clear().catch(() => {});
        await limpiarColaHorasExtra();
    }

    await window.syncQueue?.actualizar?.();
}

async function actualizarBadgeHE() {
    const badge = document.getElementById('badge-he-pendientes');
    if (!badge) return;
    let todos = [];
    if (navigator.onLine && supabaseClient) {
        const { data } = await supabaseClient.from('horas_extra').select('id, estado').eq('estado', 'pendiente');
        todos = data || [];
    } else {
        const all = await window.localDB?.horas_extra.getAll().catch(() => []) || [];
        todos = all.filter(r => (r.estado || 'pendiente') === 'pendiente');
    }
    const n = todos.length;
    if (n > 0) {
        badge.textContent = n;
        badge.style.display = 'inline-block';
    } else {
        badge.style.display = 'none';
    }
}

async function actualizarBadgeInsumos() {
    const badge = document.getElementById('badge-insumos-pendientes');
    if (!badge) return;

    let solicitudes = estado.solicitudesInsumos || [];
    if (!solicitudes.length && window.localDB?.solicitudes_insumos) {
        solicitudes = await window.localDB.solicitudes_insumos.getAll().catch(() => []);
    }

    const pendientes = (solicitudes || []).filter((item) => {
        if (String(item.estado || 'pendiente') !== 'pendiente') return false;
        if (estado.usuarioActual === 'admin' || usuarioPuedeAprobarInsumos()) return true;
        return String(item.trabajador_id || '') === String(usuarioSolicitanteActualId() || '');
    }).length;

    if (pendientes > 0) {
        badge.textContent = pendientes;
        badge.style.display = 'inline-block';
    } else {
        badge.style.display = 'none';
    }
}

// ── HORAS EXTRA: vista de gestión para planificador ───────────────────────────
async function renderHorasExtraAdminView() {
    mainContent.innerHTML = `<div class="fade-in" style="max-width:1100px; margin:0 auto;">
        <div class="panel" style="text-align:center; padding:2rem;"><p style="color:var(--text-muted);">Cargando horas extra...</p></div>
    </div>`;

    const todos = await cargarTodasHorasExtra();
    const trabajadores = estado.trabajadores || [];
    const mesActual = new Date().toISOString().slice(0, 7);

    // Enricher: join con nombre de trabajador
    const enriched = todos.map(r => ({
        ...r,
        nombreTrabajador: trabajadores.find(t => t.id === r.trabajador_id)?.nombre || 'Desconocido',
        estado: r.estado || 'pendiente'
    }));

    const pendientes  = enriched.filter(r => r.estado === 'pendiente');
    const aprobadosMes = enriched.filter(r => r.estado === 'aprobado' && r.fecha && r.fecha.startsWith(mesActual));
    const totalMesHrs = aprobadosMes.reduce((s, r) => s + (parseFloat(r.horas) || 0), 0);
    const totalTodasMes = enriched.filter(r => r.fecha && r.fecha.startsWith(mesActual))
        .reduce((s, r) => s + (parseFloat(r.horas) || 0), 0);

    // Estado de filtros (en closure)
    let filtroEstado = 'todos';
    let filtroTrabajador = '';
    let filtroMes = '';

    function badgeEstado(est) {
        if (est === 'aprobado')  return `<span style="background:#dcfce7; color:#16a34a; border-radius:6px; padding:0.15rem 0.55rem; font-size:0.72rem; font-weight:600;">Aprobado</span>`;
        if (est === 'rechazado') return `<span style="background:#fee2e2; color:#dc2626; border-radius:6px; padding:0.15rem 0.55rem; font-size:0.72rem; font-weight:600;">Rechazado</span>`;
        return `<span style="background:#fef9c3; color:#b45309; border-radius:6px; padding:0.15rem 0.55rem; font-size:0.72rem; font-weight:600;">Pendiente</span>`;
    }

    function renderTabla() {
        let filtrados = enriched;
        if (filtroEstado !== 'todos') filtrados = filtrados.filter(r => r.estado === filtroEstado);
        if (filtroTrabajador) filtrados = filtrados.filter(r => r.trabajador_id === filtroTrabajador);
        if (filtroMes) filtrados = filtrados.filter(r => r.fecha && r.fecha.startsWith(filtroMes));

        // Recalcular métricas según el trabajador seleccionado (o todos si no hay filtro)
        const base = filtroTrabajador ? enriched.filter(r => r.trabajador_id === filtroTrabajador) : enriched;
        const statPend = base.filter(r => r.estado === 'pendiente').length;
        const statAprobHrs = base.filter(r => r.estado === 'aprobado' && r.fecha && r.fecha.startsWith(mesActual))
            .reduce((s, r) => s + (parseFloat(r.horas) || 0), 0);
        const statTotal = base.filter(r => r.fecha && r.fecha.startsWith(mesActual))
            .reduce((s, r) => s + (parseFloat(r.horas) || 0), 0);
        const elPend = document.getElementById('he-stat-pendientes');
        const elAprob = document.getElementById('he-stat-aprobadas');
        const elTotal = document.getElementById('he-stat-total');
        if (elPend) elPend.textContent = statPend;
        if (elAprob) elAprob.textContent = statAprobHrs.toFixed(1) + ' hrs';
        if (elTotal) elTotal.textContent = statTotal.toFixed(1) + ' hrs';

        const tabla = document.getElementById('he-admin-tabla-body');
        if (!tabla) return;
        if (filtrados.length === 0) {
            tabla.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:2rem; color:var(--text-muted); font-size:0.88rem;">Sin registros para los filtros seleccionados.</td></tr>`;
            return;
        }
        tabla.innerHTML = filtrados.map(r => {
            const fechaFmt = r.fecha ? new Date(r.fecha + 'T12:00:00').toLocaleDateString('es-CL', { day:'2-digit', month:'short', year:'numeric' }) : '—';
            const btnAprobar = r.estado === 'pendiente'
                ? `<button onclick="window._heAprobar('${r.id}')" class="btn" style="font-size:0.72rem; padding:0.25rem 0.7rem; border-radius:6px; background:#dcfce7; color:#16a34a; border:1px solid #bbf7d0; margin-right:0.35rem;">✓ Aprobar</button>` : '';
            const btnRechazar = r.estado === 'pendiente'
                ? `<button onclick="window._heRechazar('${r.id}')" class="btn" style="font-size:0.72rem; padding:0.25rem 0.7rem; border-radius:6px; background:#fee2e2; color:#dc2626; border:1px solid #fecaca;">✗ Rechazar</button>` : '';
            const notaRechazo = r.estado === 'rechazado' && r.motivo_rechazo
                ? `<div style="font-size:0.7rem; color:#dc2626; margin-top:0.2rem;">${r.motivo_rechazo}</div>` : '';
            return `<tr id="he-row-${r.id}" style="border-bottom:1px solid var(--border-color); ${r.estado === 'rechazado' ? 'opacity:0.6;' : ''}">
                <td style="padding:0.55rem 0.6rem; font-size:0.83rem; font-weight:600;">${r.nombreTrabajador}</td>
                <td style="padding:0.55rem 0.6rem; font-size:0.83rem; color:var(--text-muted);">${fechaFmt}</td>
                <td style="padding:0.55rem 0.6rem; font-size:0.83rem; font-weight:700; color:var(--primary-color);">${r.horas} hrs</td>
                <td style="padding:0.55rem 0.6rem; font-size:0.83rem; color:var(--text-muted); max-width:160px;">${r.motivo || '—'}</td>
                <td style="padding:0.55rem 0.6rem;">${badgeEstado(r.estado)}${notaRechazo}</td>
                <td style="padding:0.55rem 0.6rem; white-space:nowrap;">
                    ${btnAprobar}${btnRechazar}
                    <button onclick="window._heEliminar('${r.id}')" title="Eliminar"
                        style="background:none; border:none; cursor:pointer; color:#dc2626; font-size:0.95rem; padding:2px 6px; border-radius:6px; transition:background 150ms;"
                        onmouseover="this.style.background='#fee2e2'" onmouseout="this.style.background='none'">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </td>
            </tr>`;
        }).join('');
    }

    const opcionesTrabajadores = [
        `<option value="">Todos los trabajadores</option>`,
        ...trabajadores.map(t => `<option value="${t.id}">${t.nombre}</option>`)
    ].join('');

    mainContent.innerHTML = `
    <div class="fade-in" style="max-width:1100px; margin:0 auto;">

        <!-- Resumen métricas -->
        <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:1rem; margin-bottom:1.2rem;">
            <div class="panel" style="text-align:center; padding:1.2rem 1rem;">
                <div id="he-stat-pendientes" style="font-size:2rem; font-weight:700; color:#b45309;">${pendientes.length}</div>
                <div style="font-size:0.78rem; color:var(--text-muted); margin-top:0.2rem;">Pendientes de aprobación</div>
            </div>
            <div class="panel" style="text-align:center; padding:1.2rem 1rem;">
                <div id="he-stat-aprobadas" style="font-size:2rem; font-weight:700; color:#16a34a;">${aprobadosMes.reduce((s,r)=>s+(parseFloat(r.horas)||0),0).toFixed(1)} hrs</div>
                <div style="font-size:0.78rem; color:var(--text-muted); margin-top:0.2rem;">Aprobadas este mes</div>
            </div>
            <div class="panel" style="text-align:center; padding:1.2rem 1rem;">
                <div id="he-stat-total" style="font-size:2rem; font-weight:700; color:var(--text-main);">${totalTodasMes.toFixed(1)} hrs</div>
                <div style="font-size:0.78rem; color:var(--text-muted); margin-top:0.2rem;">Total solicitado este mes</div>
            </div>
        </div>

        <!-- Filtros -->
        <div class="panel" style="margin-bottom:1rem; display:flex; gap:0.75rem; flex-wrap:wrap; align-items:center;">
            <select id="he-filtro-estado" class="form-control" style="flex:1; min-width:140px; max-width:180px;">
                <option value="todos">Todos</option>
                <option value="pendiente">Pendientes</option>
                <option value="aprobado">Aprobados</option>
                <option value="rechazado">Rechazados</option>
            </select>
            <select id="he-filtro-trabajador" class="form-control" style="flex:1; min-width:180px;">
                ${opcionesTrabajadores}
            </select>
            <input type="month" id="he-filtro-mes" class="form-control" style="flex:1; min-width:140px; max-width:180px;" placeholder="Mes">
            <button id="btn-he-eliminar-todo" class="btn" style="margin-left:auto; background:#fee2e2; color:#dc2626; border:1px solid #fecaca; font-size:0.82rem; white-space:nowrap;">
                <i class="fa-solid fa-trash-can"></i> Eliminar todas
            </button>
        </div>

        <!-- Tabla -->
        <div class="panel" style="padding:0;">
            <div class="table-shell" style="border:none; border-radius:18px;">
            <table class="table-clean" style="width:100%; border-collapse:collapse;">
                <thead>
                    <tr style="border-bottom:2px solid var(--border-color); background:var(--glass-bg);">
                        <th style="text-align:left; font-size:0.75rem; color:var(--text-muted); padding:0.6rem 0.6rem; font-weight:600;">Trabajador</th>
                        <th style="text-align:left; font-size:0.75rem; color:var(--text-muted); padding:0.6rem 0.6rem; font-weight:600;">Fecha</th>
                        <th style="text-align:left; font-size:0.75rem; color:var(--text-muted); padding:0.6rem 0.6rem; font-weight:600;">Horas</th>
                        <th style="text-align:left; font-size:0.75rem; color:var(--text-muted); padding:0.6rem 0.6rem; font-weight:600;">Motivo</th>
                        <th style="text-align:left; font-size:0.75rem; color:var(--text-muted); padding:0.6rem 0.6rem; font-weight:600;">Estado</th>
                        <th style="text-align:left; font-size:0.75rem; color:var(--text-muted); padding:0.6rem 0.6rem; font-weight:600;">Acciones</th>
                    </tr>
                </thead>
                <tbody id="he-admin-tabla-body"></tbody>
            </table>
            </div>
        </div>

    </div>`;

    renderTabla();

    // Filtros listeners
    document.getElementById('he-filtro-estado').addEventListener('change', e => { filtroEstado = e.target.value; renderTabla(); });
    document.getElementById('he-filtro-trabajador').addEventListener('change', e => { filtroTrabajador = e.target.value; renderTabla(); });
    document.getElementById('he-filtro-mes').addEventListener('change', e => { filtroMes = e.target.value; renderTabla(); });

    // Aprobar inline
    window._heAprobar = async (id) => {
        const row = document.getElementById(`he-row-${id}`);
        if (row) {
            row.querySelector('button') && (row.querySelector('button').textContent = '...');
        }
        await aprobarHorasExtra(id);
        // Actualizar registro en enriched y re-render
        const idx = enriched.findIndex(r => r.id === id);
        if (idx >= 0) enriched[idx] = { ...enriched[idx], estado: 'aprobado', aprobado_por: 'Planificador', fecha_aprobacion: new Date().toISOString() };
        renderTabla();
        actualizarBadgeHE();
    };

    // Rechazar — abre modal
    window._heRechazar = (id) => {
        const modal = document.getElementById('modal-he-rechazo');
        document.getElementById('he-rechazo-motivo').value = '';
        document.getElementById('he-rechazo-error').style.display = 'none';
        modal.style.display = 'flex';

        document.getElementById('btn-he-rechazo-cancelar').onclick = () => { modal.style.display = 'none'; };
        document.getElementById('btn-he-rechazo-confirmar').onclick = async () => {
            const motivo = document.getElementById('he-rechazo-motivo').value.trim();
            if (!motivo) { document.getElementById('he-rechazo-error').style.display = 'block'; return; }
            document.getElementById('btn-he-rechazo-confirmar').textContent = 'Guardando...';
            document.getElementById('btn-he-rechazo-confirmar').disabled = true;
            await rechazarHorasExtra(id, motivo);
            modal.style.display = 'none';
            document.getElementById('btn-he-rechazo-confirmar').textContent = 'Confirmar Rechazo';
            document.getElementById('btn-he-rechazo-confirmar').disabled = false;
            const idx = enriched.findIndex(r => r.id === id);
            if (idx >= 0) enriched[idx] = { ...enriched[idx], estado: 'rechazado', motivo_rechazo: motivo };
            renderTabla();
            actualizarBadgeHE();
        };
    };

    window._heEliminar = async (id) => {
        if (!confirm('¿Eliminar este registro de horas extra?')) return;
        try {
            await eliminarRegistrosHorasExtra([id]);
            const idx = enriched.findIndex(r => r.id === id);
            if (idx >= 0) enriched.splice(idx, 1);
            renderTabla();
            actualizarBadgeHE();
        } catch (error) {
            alert(error?.message || 'No se pudo eliminar el registro.');
        }
    };

    document.getElementById('btn-he-eliminar-todo')?.addEventListener('click', async () => {
        if (enriched.length === 0) {
            alert('No hay horas extra para eliminar.');
            return;
        }
        if (!confirm(`\u00bfEliminar TODAS las horas extra (${enriched.length} registro(s))? Esta acci\u00f3n no se puede deshacer.`)) return;

        const btn = document.getElementById('btn-he-eliminar-todo');
        const textoOriginal = btn?.innerHTML;
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Eliminando...';
        }

        try {
            await eliminarRegistrosHorasExtra();
            enriched.splice(0, enriched.length);
            renderTabla();
            actualizarBadgeHE();
        } catch (error) {
            alert(error?.message || 'No se pudieron eliminar las horas extra.');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = textoOriginal;
            }
        }
    });

    window._heEliminar = async (id) => {
        if (!confirm('Eliminar este registro de horas extra?')) return;
        try {
            await eliminarRegistrosHorasExtra([id]);
            const idx = enriched.findIndex(r => r.id === id);
            if (idx >= 0) enriched.splice(idx, 1);
            renderTabla();
            actualizarBadgeHE();
        } catch (error) {
            alert(error?.message || 'No se pudo eliminar el registro.');
        }
    };

    const btnEliminarTodoOriginal = document.getElementById('btn-he-eliminar-todo');
    if (btnEliminarTodoOriginal) {
        const btnEliminarTodo = btnEliminarTodoOriginal.cloneNode(true);
        btnEliminarTodoOriginal.parentNode.replaceChild(btnEliminarTodo, btnEliminarTodoOriginal);

        btnEliminarTodo.addEventListener('click', async () => {
            if (enriched.length === 0) {
                alert('No hay horas extra para eliminar.');
                return;
            }
            if (!confirm(`Eliminar TODAS las horas extra (${enriched.length} registro(s))? Esta accion no se puede deshacer.`)) return;

            const textoOriginal = btnEliminarTodo.innerHTML;
            btnEliminarTodo.disabled = true;
            btnEliminarTodo.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Eliminando...';

            try {
                await eliminarRegistrosHorasExtra();
                enriched.splice(0, enriched.length);
                renderTabla();
                actualizarBadgeHE();
            } catch (error) {
                alert(error?.message || 'No se pudieron eliminar las horas extra.');
            } finally {
                btnEliminarTodo.disabled = false;
                btnEliminarTodo.innerHTML = textoOriginal;
            }
        });
    }
}

// ── HORAS EXTRA: cargar del trabajador (local + remoto si online) ────────────
async function cargarHorasExtraTrabajador(trabajadorId) {
    let registros = [];
    if (window.localDB) {
        registros = await window.localDB.horas_extra.getByTrabajador(trabajadorId).catch(() => []);
    }
    if (navigator.onLine && supabaseClient) {
        const { data } = await supabaseClient
            .from('horas_extra')
            .select('*')
            .eq('trabajador_id', trabajadorId)
            .order('fecha', { ascending: false });
        if (data && data.length > 0) {
            await window.localDB?.horas_extra.bulk(data.map(r => ({ ...r, synced: true }))).catch(() => {});
            registros = data;
        }
    }
    return registros.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
}

// ── HORAS EXTRA: helper para resetear estado del modal ───────────────────────
function _resetModalHE() {
    document.getElementById('he-pregunta').style.display = 'block';
    document.getElementById('he-form').style.display = 'none';
    document.getElementById('he-horas').value = '';
    document.getElementById('he-motivo').value = '';
    document.getElementById('he-fecha').value = new Date().toISOString().split('T')[0];
    document.getElementById('he-error').style.display = 'none';
    const btn = document.getElementById('btn-he-guardar');
    btn.disabled = false;
    btn.textContent = 'Guardar';
}

// ── HORAS EXTRA: modal de checkout (pregunta si tiene HE antes de cerrar) ────
function mostrarModalHorasExtra(trabajadorId) {
    _resetModalHE();
    document.getElementById('modal-horas-extra').style.display = 'flex';

    document.getElementById('btn-he-no').onclick = () => {
        document.getElementById('modal-horas-extra').style.display = 'none';
        _volverAlLogin();
    };

    document.getElementById('btn-he-si').onclick = () => {
        document.getElementById('he-pregunta').style.display = 'none';
        document.getElementById('he-form').style.display = 'block';
    };

    document.getElementById('btn-he-guardar').onclick = async () => {
        const horas = parseFloat(document.getElementById('he-horas').value);
        const fecha = document.getElementById('he-fecha').value;
        const motivo = document.getElementById('he-motivo').value.trim();
        if (!fecha || isNaN(horas) || horas <= 0) {
            document.getElementById('he-error').style.display = 'block';
            return;
        }
        const btn = document.getElementById('btn-he-guardar');
        btn.disabled = true; btn.textContent = 'Guardando...';
        await guardarHorasExtra(trabajadorId, fecha, horas, motivo);
        document.getElementById('modal-horas-extra').style.display = 'none';
        _volverAlLogin();
    };

    document.getElementById('btn-he-cancelar').onclick = () => {
        document.getElementById('he-pregunta').style.display = 'block';
        document.getElementById('he-form').style.display = 'none';
    };
}

// ── HORAS EXTRA: agregar desde perfil (sin cerrar sesión) ────────────────────
window.abrirModalHorasExtraManual = function(trabajadorId) {
    _resetModalHE();
    // Ir directo al formulario, sin mostrar la pregunta
    document.getElementById('he-pregunta').style.display = 'none';
    document.getElementById('he-form').style.display = 'block';
    document.getElementById('modal-horas-extra').style.display = 'flex';

    document.getElementById('btn-he-si').onclick = null;

    // "No, salir" no aplica aquí — el botón visible es "Volver" (btn-he-cancelar)
    document.getElementById('btn-he-no').onclick = () => {
        document.getElementById('modal-horas-extra').style.display = 'none';
        _resetModalHE();
    };

    document.getElementById('btn-he-guardar').onclick = async () => {
        const horas = parseFloat(document.getElementById('he-horas').value);
        const fecha = document.getElementById('he-fecha').value;
        const motivo = document.getElementById('he-motivo').value.trim();
        if (!fecha || isNaN(horas) || horas <= 0) {
            document.getElementById('he-error').style.display = 'block';
            return;
        }
        const btn = document.getElementById('btn-he-guardar');
        btn.disabled = true; btn.textContent = 'Guardando...';
        await guardarHorasExtra(trabajadorId, fecha, horas, motivo);
        document.getElementById('modal-horas-extra').style.display = 'none';
        _resetModalHE();
        vistaActual = 'mis_horas';
        renderizarVistaActual();
    };

    document.getElementById('btn-he-cancelar').onclick = () => {
        document.getElementById('modal-horas-extra').style.display = 'none';
        _resetModalHE();
    };
};

// ── HORAS EXTRA: Vista Calendario ────────────────────────────────────────────
window.mostrarCalendarioHorasExtra = function(trabajadorId, registros) {
    // Cargar fresh si no se pasan registros
    if (!registros) {
        cargarHorasExtraTrabajador(trabajadorId).then(r => window.mostrarCalendarioHorasExtra(trabajadorId, r));
        return;
    }

    // Eliminar modal anterior si existe
    const viejo = document.getElementById('modal-he-calendario');
    if (viejo) viejo.remove();

    let mesViendo = new Date();
    mesViendo.setDate(1);

    function renderCalendario() {
        const anio = mesViendo.getFullYear();
        const mes = mesViendo.getMonth(); // 0-indexed
        const mesStr = `${anio}-${String(mes + 1).padStart(2, '0')}`;
        const nombresMes = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
        const diasSemana = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];

        // Indexar horas por día del mes visible
        const porDia = {};
        registros.forEach(r => {
            if (r.fecha && r.fecha.startsWith(mesStr)) {
                const dia = parseInt(r.fecha.split('-')[2]);
                porDia[dia] = (porDia[dia] || 0) + (parseFloat(r.horas) || 0);
            }
        });

        const totalMes = Object.values(porDia).reduce((s, v) => s + v, 0);
        const primerDia = new Date(anio, mes, 1).getDay(); // 0=Dom
        const offsetLunes = (primerDia === 0 ? 6 : primerDia - 1); // ajustar a Lun=0
        const diasEnMes = new Date(anio, mes + 1, 0).getDate();

        // Cabecera días semana
        const cabeceraHTML = diasSemana.map(d =>
            `<div style="text-align:center;font-size:0.72rem;font-weight:600;color:var(--text-muted);padding:0.3rem 0;">${d}</div>`
        ).join('');

        // Celdas vacías iniciales
        let celdasHTML = '';
        for (let i = 0; i < offsetLunes; i++) {
            celdasHTML += `<div></div>`;
        }

        // Días del mes
        for (let d = 1; d <= diasEnMes; d++) {
            const hrs = porDia[d];
            const tieneHoras = hrs !== undefined;
            celdasHTML += `
                <div style="
                    aspect-ratio:1;
                    display:flex;
                    flex-direction:column;
                    align-items:center;
                    justify-content:center;
                    border-radius:8px;
                    font-size:0.82rem;
                    font-weight:${tieneHoras ? '700' : '400'};
                    background:${tieneHoras ? 'var(--primary-color)' : 'transparent'};
                    color:${tieneHoras ? 'white' : 'var(--text-main)'};
                    cursor:${tieneHoras ? 'default' : 'default'};
                    position:relative;
                ">
                    <span>${d}</span>
                    ${tieneHoras ? `<span style="font-size:0.6rem;margin-top:1px;">${hrs.toFixed(1)}h</span>` : ''}
                </div>`;
        }

        const modal = document.getElementById('modal-he-calendario');
        modal.querySelector('#cal-titulo').textContent = `${nombresMes[mes]} ${anio}`;
        modal.querySelector('#cal-total-mes').textContent = `${totalMes.toFixed(1)} hrs en ${nombresMes[mes]}`;
        modal.querySelector('#cal-grid').innerHTML = cabeceraHTML + celdasHTML;
    }

    // Crear modal
    const modal = document.createElement('div');
    modal.id = 'modal-he-calendario';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:10000;display:flex;align-items:center;justify-content:center;padding:1rem;';
    modal.innerHTML = `
        <div style="background:#fff;border-radius:16px;padding:1.5rem;max-width:380px;width:100%;box-shadow:0 20px 50px rgba(0,0,0,0.2);">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;">
                <button id="cal-prev" style="background:none;border:none;cursor:pointer;font-size:1.2rem;color:var(--text-muted);padding:0.2rem 0.5rem;">&#8592;</button>
                <div style="text-align:center;">
                    <div id="cal-titulo" style="font-weight:700;font-size:1rem;"></div>
                    <div id="cal-total-mes" style="font-size:0.75rem;color:var(--primary-color);margin-top:0.1rem;"></div>
                </div>
                <button id="cal-next" style="background:none;border:none;cursor:pointer;font-size:1.2rem;color:var(--text-muted);padding:0.2rem 0.5rem;">&#8594;</button>
            </div>
            <div id="cal-grid" style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;"></div>
            <button id="cal-cerrar" style="width:100%;margin-top:1.2rem;padding:0.65rem;border-radius:10px;border:1px solid #e5e7eb;background:transparent;color:var(--text-muted);cursor:pointer;font-size:0.88rem;">Cerrar</button>
        </div>`;
    document.body.appendChild(modal);

    renderCalendario();

    modal.querySelector('#cal-prev').onclick = () => { mesViendo.setMonth(mesViendo.getMonth() - 1); renderCalendario(); };
    modal.querySelector('#cal-next').onclick = () => { mesViendo.setMonth(mesViendo.getMonth() + 1); renderCalendario(); };
    modal.querySelector('#cal-cerrar').onclick = () => modal.remove();
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
};

// COMPONENTE: Vista Trabajadores (2 tabs: Equipo Disponible | Equipo Trabajando)
function renderEquiposView() {
    const normalizar = (valor) => String(valor || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();

    const criticidadColor = { A: '#ef4444', B: '#f59e0b', C: '#22c55e' };
    const equiposRaw = estado.equipos || [];

    // Agrupar por activo + ubicación → una tarjeta por grupo
    const gruposMap = new Map();
    equiposRaw.forEach(eq => {
        const key = `${String(eq.activo || '').trim().toLowerCase()}__${String(eq.ubicacion || '').trim().toLowerCase()}`;
        if (!gruposMap.has(key)) gruposMap.set(key, []);
        gruposMap.get(key).push(eq);
    });
    const grupos = [...gruposMap.values()].sort((a, b) => {
        const na = String(a[0].activo || '').localeCompare(String(b[0].activo || ''), 'es');
        if (na !== 0) return na;
        return String(a[0].ubicacion || '').localeCompare(String(b[0].ubicacion || ''), 'es');
    });

    const renderTarjetaEquipo = (comps) => {
        // Elegir equipo representativo (el de mayor criticidad, o el primero)
        const orderCrit = { A: 0, B: 1, C: 2 };
        const rep = [...comps].sort((a, b) =>
            (orderCrit[String(a.criticidad||'').toUpperCase()] ?? 9) -
            (orderCrit[String(b.criticidad||'').toUpperCase()] ?? 9)
        )[0];
        const crit = String(rep.criticidad || '').toUpperCase();
        const critColor = criticidadColor[crit] || '#64748b';
        const componentes = comps.map(c => c.componente).filter(Boolean);
        const componentesStr = componentes.length ? componentes.join(' · ') : 'Sin componentes';
        const ubicacionEsc = String(rep.ubicacion || '').replace(/'/g, "\\'");
        const onclick = comps.length > 1
            ? `window.elegirComponenteYAbrirFicha('${rep.id}','${ubicacionEsc}')`
            : `window.abrirFichaTecnica('${rep.id}')`;
        const searchText = normalizar(comps.flatMap(eq => [
            eq.activo, eq.componente, eq.kks, eq.ubicacion, eq.ubicacion_original, eq.frecuencia_nueva
        ]).join(' '));

        return `
            <article class="equipment-card" data-equipo-card data-search="${searchText}" onclick="${onclick}">
                <div class="equipment-card-head">
                    <div>
                        <div class="equipment-card-title">${rep.activo || 'Equipo sin nombre'}</div>
                        <div class="equipment-card-subtitle">${componentesStr}${comps.length > 1 ? ` <span style="color:#FF6900;font-weight:700;">(${comps.length})</span>` : ''}</div>
                    </div>
                    ${crit ? `<span class="equipment-card-badge" style="background:${critColor}18;color:${critColor};border-color:${critColor}55;">Crit. ${crit}</span>` : ''}
                </div>
                <div class="equipment-card-meta">
                    <span><i class="fa-solid fa-location-dot"></i> ${rep.ubicacion || 'Sin ubicación'}</span>
                    <span><i class="fa-solid fa-hashtag"></i> ${rep.kks || 'KKS no informado'}</span>
                    ${rep.frecuencia_nueva ? `<span><i class="fa-solid fa-rotate"></i> ${rep.frecuencia_nueva}</span>` : ''}
                </div>
                <div class="equipment-card-footer">
                    <span><i class="fa-solid fa-arrow-up-right-from-square"></i> ${comps.length > 1 ? 'Elegir componente' : 'Abrir ficha técnica'}</span>
                </div>
            </article>
        `;
    };

    const ubicaciones = [...new Set(equiposRaw.map(eq => eq.ubicacion).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));

    mainContent.innerHTML = `
        <div class="fade-in equipment-view">
            <section class="panel equipment-hero">
                <div class="dashboard-hero-head">
                    <div>
                        <div class="crew-eyebrow">Consulta tecnica</div>
                        <h1 style="margin:0 0 0.4rem 0;"><i class="fa-solid fa-gears"></i> Equipos</h1>
                        <p class="crew-subtitle">Busca activos por nombre, componente, KKS o ubicación y entra directo a su ficha técnica.</p>
                    </div>
                    <div class="dashboard-hero-badges">
                        <span class="dashboard-hero-badge"><i class="fa-solid fa-microchip"></i> ${grupos.length} equipos</span>
                        <span class="dashboard-hero-badge"><i class="fa-solid fa-location-dot"></i> ${ubicaciones.length} ubicaciones</span>
                    </div>
                </div>
                <div class="equipment-toolbar">
                    <div class="equipment-search-shell">
                        <i class="fa-solid fa-magnifying-glass equipment-search-icon"></i>
                        <input id="equipos-search" type="text" class="form-control equipment-search-input" placeholder="Buscar equipo, componente, KKS o ubicación...">
                        <button id="equipos-search-clear" class="search-clear-btn" type="button" aria-label="Limpiar búsqueda">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>
                </div>
            </section>

            <section class="panel">
                <div class="panel-header" style="justify-content:space-between; gap:1rem; flex-wrap:wrap;">
                    <h2 style="margin:0;"><i class="fa-solid fa-layer-group"></i> Inventario de equipos</h2>
                    <div id="equipos-search-status" style="color:var(--text-muted); font-size:0.88rem;">${grupos.length} resultado(s)</div>
                </div>
                <div id="equipos-grid" class="equipment-grid">
                    ${grupos.length ? grupos.map(renderTarjetaEquipo).join('') : `<div class="empty-state" style="grid-column:1/-1;"><div><strong>Sin equipos cargados</strong><p>Cuando existan equipos en la base, aparecerán aquí para búsqueda y consulta.</p></div></div>`}
                </div>
            </section>
        </div>
    `;

    const input = document.getElementById('equipos-search');
    const clearBtn = document.getElementById('equipos-search-clear');
    const cards = Array.from(document.querySelectorAll('[data-equipo-card]'));
    const status = document.getElementById('equipos-search-status');

    const aplicarFiltro = () => {
        const query = normalizar(input?.value || '');
        let visibles = 0;
        cards.forEach((card) => {
            const match = !query || (card.dataset.search || '').includes(query);
            card.style.display = match ? '' : 'none';
            if (match) visibles += 1;
        });
        if (status) status.textContent = `${visibles} resultado(s)`;
        if (clearBtn) clearBtn.style.display = query ? 'inline-flex' : 'none';
    };

    input?.addEventListener('input', aplicarFiltro);
    clearBtn?.addEventListener('click', () => {
        input.value = '';
        aplicarFiltro();
        input.focus();
    });
}

function renderTrabajadoresView() {
    const tareasActivas = estado.tareas.filter(t => t.estadoTarea === 'en_curso');

    // IDs de todos los que tienen al menos una tarea activa (como lider o ayudante)
    const idsEnTarea = new Set(tareasActivas.flatMap(t =>
        [t.liderId, ...(t.ayudantesIds || [])].filter(Boolean)
    ));

    // "Trabajando" = tiene tarea activa Y hizo check-in
    const ocupados    = estado.trabajadores.filter(t => t.disponible && idsEnTarea.has(t.id));
    // "Disponible" = hizo check-in Y NO tiene tarea activa
    const disponibles = estado.trabajadores.filter(t => t.disponible && !idsEnTarea.has(t.id));
    const ausentes    = estado.trabajadores.filter(t => !t.disponible);


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
        // ── Extraer partes del título ─────────────────────────────────────────
        const tipoStr = tarea.tipo || '';
        // Unidad: primer [...]
        const matchUnidad = tipoStr.match(/^\[([^\]]+)\]/);
        const ubicacion = tarea.ubicacion || (matchUnidad ? matchUnidad[1] : '');
        // Tipos de trabajo: de tiposSeleccionados o de (...) al final
        let tipos = tarea.tipos_trabajo?.length ? tarea.tipos_trabajo
                  : tarea.tiposSeleccionados?.length ? tarea.tiposSeleccionados
                  : (() => { const m = tipoStr.match(/\(([^)]+)\)\s*$/); return m ? m[1].split(',').map(s=>s.trim()) : []; })();
        // Nombre limpio: sin [Unidad] prefijo ni (Tipo) sufijo
        let nombreLimpio = tipoStr
            .replace(/^\[[^\]]+\]\s*/, '')
            .replace(/\s*\([^)]+\)\s*$/, '')
            .trim();
        // Enlace a ficha técnica respetando la unidad del registro de historial.
        // Si hay varios componentes del mismo activo en esa unidad, abrir el selector de componente.
        const ubicacionNormalizada = (ubicacion || '').trim().toLowerCase();
        const nombreNormalizado = (nombreLimpio || tipoStr).trim().toLowerCase();
        const equiposMismaUnidad = estado.equipos.filter(e =>
            (e.activo || '').trim().toLowerCase() === nombreNormalizado &&
            (!ubicacionNormalizada || (e.ubicacion || '').trim().toLowerCase() === ubicacionNormalizada)
        );
        const eqObj = equiposMismaUnidad[0] || estado.equipos.find(e =>
            (e.activo || '').trim().toLowerCase() === nombreNormalizado
        );
        const ubicacionEscapada = (ubicacion || '').replace(/'/g, '');
        const nombreHtml = eqObj
            ? `<a href="#" onclick="${equiposMismaUnidad.length > 1 ? `window.elegirComponenteYAbrirFicha('${eqObj.id}','${ubicacionEscapada}')` : `window.abrirFichaTecnica('${eqObj.id}')`}; return false;" style="color:var(--primary-color); text-decoration:none; font-weight:700;">${nombreLimpio || tipoStr}</a>`
            : `<span style="font-weight:700; color:var(--text-main);">${nombreLimpio || tipoStr}</span>`;

        // ── Acciones: tipos automáticos + texto manual ────────────────────────
        const accionesAuto = tipos.length ? tipos.join(', ') : '';
        const accionesManual = tarea.acciones_realizadas || '';
        // Evitar duplicar si el texto manual ya es igual a los tipos
        const mostrarManual = accionesManual && accionesManual !== accionesAuto;

        // ── Fechas ────────────────────────────────────────────────────────────
        const fmtFecha = (iso, fallbackDate, fallbackHora) => iso
            ? new Date(iso).toLocaleString('es-CL', {day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'})
            : (new Date(fallbackDate).toLocaleDateString('es-CL') + ' ' + (fallbackHora || '—'));

        return `
        <div class="list-item" data-id="${tarea.id}" data-tipo="${tipoStr}" style="border-left: 5px solid var(--success-color); display:block; background:#fff; position:relative; padding:1rem 1rem 0.9rem 1.1rem;">
            <button onclick="window._borrarHistorial('${tarea.id}')"
                title="Eliminar este registro"
                style="position:absolute; top:0.6rem; right:0.6rem; background:none; border:none; cursor:pointer; color:#cbd5e1; font-size:1rem; padding:0.2rem 0.4rem; border-radius:4px;"
                onmouseover="this.style.color='#ef4444'" onmouseout="this.style.color='#cbd5e1'">
                <i class="fa-solid fa-trash"></i>
            </button>

            <div style="padding-right:2rem;">
                <!-- 1. Nombre + OT -->
                <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap; margin-bottom:0.35rem;">
                    <span style="font-size:1rem;">${nombreHtml}</span>
                    ${tarea.ot_numero ? `<span class="badge" style="background:var(--primary-color); color:white; font-size:0.72rem;"><i class="fa-solid fa-hashtag"></i> ${tarea.ot_numero}</span>` : ''}
                </div>

                <!-- 2. Badges de tipo -->
                ${tipos.length ? `<div style="display:flex; flex-wrap:wrap; gap:0.35rem; margin-bottom:0.4rem;">
                    ${tipos.map(t => `<span onclick="window.abrirModalTipoBadge('${t.replace(/'/g,"\\'")}', '${tarea.id}')"
                        style="background:#f1f5f9; color:#475569; border-radius:999px; font-size:0.72rem; font-weight:600; padding:2px 9px; border:1px solid #e2e8f0; cursor:pointer; transition:background 150ms;"
                        onmouseover="this.style.background='#e2e8f0'" onmouseout="this.style.background='#f1f5f9'">${t}</span>`).join('')}
                </div>` : ''}

                <!-- 3. Ubicación -->
                ${ubicacion ? `<div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:0.4rem;">
                    <i class="fa-solid fa-location-dot" style="font-size:0.75rem; margin-right:3px;"></i>${ubicacion}
                </div>` : ''}

                <!-- 4. Líder + apoyo -->
                <div style="font-size:0.85rem; color:var(--text-main); margin-bottom:0.45rem;">
                    <i class="fa-solid fa-user-tie" style="color:var(--text-muted); margin-right:3px;"></i>
                    <strong>${tarea.lider_nombre || '—'}</strong>
                    ${tarea.ayudantes_nombres?.length ? `<span style="color:var(--text-muted);"> · ${tarea.ayudantes_nombres.join(', ')}</span>` : ''}
                </div>

                <!-- 5. Acciones -->
                <div style="font-size:0.82rem; color:var(--text-main); margin-bottom:0.45rem; padding:0.45rem 0.6rem; background:#f9fafb; border-radius:6px; border:1px solid #f1f5f9;">
                    ${accionesAuto ? `<span style="color:#475569;"><strong>Acciones:</strong> ${accionesAuto}</span>` : ''}
                    ${mostrarManual ? `<div style="margin-top:${accionesAuto ? '0.25rem' : '0'}; color:var(--text-muted); font-style:italic;">${accionesManual}</div>` : ''}
                    ${!accionesAuto && !mostrarManual ? `<em style="opacity:0.5;">Sin documentar</em>` : ''}
                    ${tarea.numero_aviso ? `<div style="margin-top:0.25rem;"><strong>Aviso:</strong> ${tarea.numero_aviso} &nbsp;|&nbsp; <strong>HH:</strong> ${tarea.hh_trabajo || '-'}</div>` : ''}
                    ${tarea.observaciones ? `<div style="margin-top:0.25rem; color:var(--text-muted); font-style:italic;">${tarea.observaciones}</div>` : ''}
                    ${tarea.analisis ? `<div style="margin-top:0.25rem;"><strong>Análisis:</strong> ${tarea.analisis}</div>` : ''}
                </div>

                <!-- 6. Fechas + 7. Botón Informe -->
                <div style="display:flex; gap:1rem; flex-wrap:wrap; align-items:center;">
                    <span style="color:var(--text-muted); font-size:0.75rem;">
                        <i class="fa-regular fa-clock"></i> ${fmtFecha(tarea.fecha_inicio, tarea.created_at, tarea.hora_asignacion)}
                    </span>
                    <span style="color:var(--success-color); font-size:0.75rem; font-weight:600;">
                        <i class="fa-solid fa-flag-checkered"></i> ${fmtFecha(tarea.fecha_termino, tarea.created_at, tarea.hora_termino)}
                    </span>
                    <button onclick="window._generarInformeTarea('${tarea.id}')" style="margin-left:auto; padding:0.3rem 0.85rem; background:linear-gradient(135deg,#6366f1,#4f46e5); color:white; border:none; border-radius:8px; font-size:0.78rem; cursor:pointer; font-weight:600;">
                        <i class="fa-solid fa-file-lines"></i> Informe
                    </button>
                </div>
            </div>
        </div>`;
    }

    function renderLista(tareas) {
        if (tareas.length === 0) return `<div class="empty-state"><div><strong>Sin registros</strong><p>No encontramos movimientos para esta pestaña con los filtros actuales.</p></div></div>`;
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
        if (!confirm('¿Eliminar este registro del historial? También se borrarán las mediciones asociadas.')) return;
        if (!navigator.onLine) { alert('Se requiere conexión a internet para eliminar del historial.'); return; }
        const { error } = await supabaseClient.from(tablasDb.historial).delete().eq('id', id);
        if (error) { alert('Error al eliminar: ' + error.message); return; }

        // Borrar mediciones asociadas si el registro tiene equipo_id y fecha_med
        const registro = estado.historialTareas.find(t => t.id === id);
        if (registro?.equipo_id && registro?.fecha_med) {
            // Obtener todos los equipos con el mismo activo (para borrar mediciones de cualquier unidad)
            const equipoObj = estado.equipos.find(e => e.id === registro.equipo_id);
            const idsGrupo = equipoObj
                ? estado.equipos.filter(e => e.activo === equipoObj.activo).map(e => e.id)
                : [registro.equipo_id];
            await supabaseClient.from(tablasDb.mediciones)
                .delete()
                .in('equipo_id', idsGrupo)
                .eq('fecha', registro.fecha_med);
            // Limpiar del estado local también
            estado.historialMediciones = estado.historialMediciones.filter(
                m => !(idsGrupo.includes(m.equipo_id) && m.fecha?.slice(0,10) === registro.fecha_med)
            );
        }

        estado.historialTareas = estado.historialTareas.filter(t => t.id !== id);
        const card = document.querySelector(`.list-item[data-id="${id}"]`);
        if (card) card.remove();
    };
}

// La API key de Gemini vive en los secretos de Supabase — no se necesita en el frontend.

// ── GENERADOR DE INFORMES CON IA (via Supabase Edge Function → Gemini) ───────
function renderHistorialView() {
    const filtrosTipo = [
        { id: 'todos', label: 'Todos', icon: 'fa-layer-group', bg: '#ffffff', color: '#475569', border: 'rgba(203,213,225,0.95)' },
        { id: 'vibraciones', label: 'Vibraciones', icon: 'fa-wave-square', bg: '#fff7ed', color: '#9a3412', border: 'rgba(249,115,22,0.22)' },
        { id: 'termografia', label: 'Termografia', icon: 'fa-temperature-three-quarters', bg: '#ecfeff', color: '#0f766e', border: 'rgba(13,148,136,0.22)' },
        { id: 'lubricacion', label: 'Lubricacion / Aceite', icon: 'fa-oil-can', bg: '#eff6ff', color: '#1d4ed8', border: 'rgba(59,130,246,0.2)' },
        { id: 'end', label: 'END', icon: 'fa-flask-vial', bg: '#f5f3ff', color: '#6d28d9', border: 'rgba(139,92,246,0.22)' },
        { id: 'espesores', label: 'Espesores', icon: 'fa-ruler-horizontal', bg: '#ecfccb', color: '#3f6212', border: 'rgba(132,204,22,0.24)' },
        { id: 'dureza', label: 'Dureza', icon: 'fa-gem', bg: '#fdf2f8', color: '#be185d', border: 'rgba(236,72,153,0.22)' }
    ];
    const tipoMap = Object.fromEntries(filtrosTipo.map(tipo => [tipo.id, tipo]));
    const historialBase = Array.isArray(estado.historialTareas) ? [...estado.historialTareas] : [];

    const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char]));

    const normalizar = (valor) => String(valor || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();

    const capitalizar = (texto) => {
        const limpio = String(texto || '').trim();
        return limpio ? limpio.charAt(0).toUpperCase() + limpio.slice(1) : '';
    };

    const formatearNumero = (valor, maxDecimals = 1) => new Intl.NumberFormat('es-CL', {
        minimumFractionDigits: 0,
        maximumFractionDigits: maxDecimals
    }).format(Number(valor || 0));

    const formatearFechaCorta = (fecha) => (
        fecha && !Number.isNaN(fecha.getTime())
            ? fecha.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' })
            : '--'
    );

    const formatearHora = (fecha) => (
        fecha && !Number.isNaN(fecha.getTime())
            ? fecha.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
            : '--'
    );

    const formatearFechaLarga = (fecha) => {
        if (!fecha || Number.isNaN(fecha.getTime())) return 'Sin fecha';
        return capitalizar(fecha.toLocaleDateString('es-CL', {
            weekday: 'long',
            day: '2-digit',
            month: 'long',
            year: 'numeric'
        }));
    };

    const inputDate = (fecha) => (
        fecha && !Number.isNaN(fecha.getTime())
            ? `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`
            : ''
    );

    const inicioDia = (valor) => {
        if (!valor) return null;
        const fecha = new Date(`${valor}T00:00:00`);
        return Number.isNaN(fecha.getTime()) ? null : fecha;
    };

    const finDia = (valor) => {
        if (!valor) return null;
        const fecha = new Date(`${valor}T23:59:59.999`);
        return Number.isNaN(fecha.getTime()) ? null : fecha;
    };

    const obtenerFechaRegistro = (item) => item.created_at || item.fecha_creacion || item.fecha_termino || item.fecha_inicio || item.fecha || null;

    const parseAyudantes = (valor) => {
        if (Array.isArray(valor)) return valor.map(item => String(item || '').trim()).filter(Boolean);
        if (typeof valor === 'string') return valor.split(',').map(item => item.trim()).filter(Boolean);
        return [];
    };

    const parseTipos = (item) => {
        if (Array.isArray(item.tipos_trabajo) && item.tipos_trabajo.length) return item.tipos_trabajo.filter(Boolean);
        if (Array.isArray(item.tiposSeleccionados) && item.tiposSeleccionados.length) return item.tiposSeleccionados.filter(Boolean);
        const base = String(item.tipo || item.tarea || '');
        const match = base.match(/\(([^)]+)\)\s*$/);
        if (match?.[1]) {
            return match[1]
                .split(',')
                .map(parte => parte.trim())
                .filter(Boolean);
        }
        return [];
    };

    const detectarTipoPrincipal = (item, tipos) => {
        const texto = normalizar([
            item.tipo,
            item.tarea,
            item.acciones_realizadas,
            item.observaciones,
            item.analisis,
            tipos.join(' ')
        ].filter(Boolean).join(' '));

        if (texto.includes('vibrac')) return 'vibraciones';
        if (texto.includes('termog')) return 'termografia';
        if (texto.includes('lubric') || texto.includes('aceite')) return 'lubricacion';
        if (texto.includes('tintas') || texto.includes('penetrantes') || texto.includes(' end')) return 'end';
        if (texto.includes('espesor')) return 'espesores';
        if (texto.includes('dureza')) return 'dureza';
        if (tipos.length) return detectarTipoPrincipal({ tipo: tipos.join(' ') }, []);
        return 'todos';
    };

    const parseRegistro = (item) => {
        const fecha = new Date(obtenerFechaRegistro(item) || 0);
        const equipoExacto = item.equipo_id
            ? estado.equipos.find(e => String(e.id) === String(item.equipo_id))
            : null;
        const tipoRaw = String(item.tipo || item.tarea || 'Registro historial').trim();
        const unidadMatch = tipoRaw.match(/^\[([^\]]+)\]/);
        const nombreLimpio = tipoRaw
            .replace(/^\[[^\]]+\]\s*/, '')
            .replace(/\s*\([^)]+\)\s*$/, '')
            .trim();
        const tipos = parseTipos(item);
        const tipoPrincipal = detectarTipoPrincipal(item, tipos);
        const unidad = item.ubicacion || equipoExacto?.ubicacion || (unidadMatch ? unidadMatch[1].trim() : '');
        const nombreActivo = equipoExacto?.activo || nombreLimpio || tipoRaw;
        const componente = equipoExacto?.componente || item.componente || item.punto_medicion || '';
        const ayudantes = parseAyudantes(item.ayudantes_nombres);
        const hh = parseFloat(String(item.hh_trabajo ?? '').replace(',', '.')) || 0;
        const activosMismaUnidad = estado.equipos.filter(e =>
            normalizar(e.activo) === normalizar(nombreActivo) &&
            normalizar(e.ubicacion) === normalizar(unidad)
        );
        const equipoFallback = equipoExacto || activosMismaUnidad[0] || estado.equipos.find(e =>
            normalizar(e.activo) === normalizar(nombreActivo)
        ) || null;

        return {
            original: item,
            id: item.id,
            fecha,
            fechaClave: fecha && !Number.isNaN(fecha.getTime()) ? inputDate(fecha) : 'sin-fecha',
            fechaLabel: formatearFechaLarga(fecha),
            horaLabel: formatearHora(fecha),
            unidad: unidad || 'Sin unidad',
            nombre: nombreActivo || 'Registro historial',
            componente: componente || '',
        lider: item.lider_nombre || 'Sin técnico',
            ayudantes,
            hh,
            otNumero: String(item.ot_numero || '').trim(),
            aviso: String(item.numero_aviso || '').trim(),
            tipos,
            tipoPrincipal,
            acciones: String(item.acciones_realizadas || '').trim(),
            observaciones: String(item.observaciones || item.descripcion || '').trim(),
            analisis: String(item.analisis || item.accion_analista || item.recomendacion_analista || '').trim(),
            equipo: equipoFallback,
            equipoAccion: equipoExacto
                ? { mode: 'direct', id: equipoExacto.id, unidad: equipoExacto.ubicacion || unidad || '' }
                : (
                    equipoFallback
                        ? { mode: activosMismaUnidad.length > 1 ? 'group' : 'direct', id: equipoFallback.id, unidad: unidad || equipoFallback.ubicacion || '' }
                        : null
                )
        };
    };

    const registrosBase = historialBase
        .sort((a, b) => new Date(obtenerFechaRegistro(b) || 0) - new Date(obtenerFechaRegistro(a) || 0))
        .map(parseRegistro);

    const fechasValidas = registrosBase
        .map(registro => registro.fecha)
        .filter(fecha => fecha && !Number.isNaN(fecha.getTime()));
    const fechaMin = fechasValidas.length ? new Date(Math.min(...fechasValidas.map(fecha => fecha.getTime()))) : new Date();
    const fechaMax = fechasValidas.length ? new Date(Math.max(...fechasValidas.map(fecha => fecha.getTime()))) : new Date();

    const opcionesUnidad = [...new Set(registrosBase.map(registro => registro.unidad).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    const opcionesLider = [...new Set(registrosBase.map(registro => registro.lider).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));

    const getPresetRange = (preset) => {
        const hoy = new Date();
        const fin = new Date(hoy);
        fin.setHours(23, 59, 59, 999);
        const inicio = new Date(hoy);
        inicio.setHours(0, 0, 0, 0);

        if (preset === 'hoy') {
            return { desde: inputDate(inicio), hasta: inputDate(fin) };
        }
        if (preset === 'semana') {
            const desde = new Date(fin);
            desde.setDate(desde.getDate() - 6);
            desde.setHours(0, 0, 0, 0);
            return { desde: inputDate(desde), hasta: inputDate(fin) };
        }
        if (preset === 'mes') {
            const desde = new Date(fin);
            desde.setDate(desde.getDate() - 29);
            desde.setHours(0, 0, 0, 0);
            return { desde: inputDate(desde), hasta: inputDate(fin) };
        }
        return { desde: inputDate(fechaMin), hasta: inputDate(fechaMax) };
    };

    let presetActivo = 'mes';
    let filtroTipo = 'todos';
    let filtroUnidad = 'todos';
    let filtroLider = 'todos';
    let textoBusqueda = '';
    let rango = getPresetRange(presetActivo);

    const coincideFiltroTipo = (registro, filtro) => filtro === 'todos' || registro.tipoPrincipal === filtro || registro.tipos.some(tipo => {
        const tipoNorm = normalizar(tipo);
        if (filtro === 'vibraciones') return tipoNorm.includes('vibrac');
        if (filtro === 'termografia') return tipoNorm.includes('termog');
        if (filtro === 'lubricacion') return tipoNorm.includes('lubric') || tipoNorm.includes('aceite');
        if (filtro === 'end') return tipoNorm.includes('end') || tipoNorm.includes('tintas') || tipoNorm.includes('penetrantes');
        if (filtro === 'espesores') return tipoNorm.includes('espesor');
        if (filtro === 'dureza') return tipoNorm.includes('dureza');
        return true;
    });

    const getBusquedaTexto = (registro) => normalizar([
        registro.nombre,
        registro.unidad,
        registro.componente,
        registro.lider,
        registro.ayudantes.join(' '),
        registro.otNumero,
        registro.aviso,
        registro.acciones,
        registro.observaciones,
        registro.analisis,
        registro.tipos.join(' '),
        registro.equipo?.kks || ''
    ].join(' '));

    const getRegistrosFiltrados = ({ omitTipo = false } = {}) => registrosBase.filter((registro) => {
        const fecha = registro.fecha;
        const desde = inicioDia(rango.desde);
        const hasta = finDia(rango.hasta);

        if (desde && (!fecha || Number.isNaN(fecha.getTime()) || fecha < desde)) return false;
        if (hasta && (!fecha || Number.isNaN(fecha.getTime()) || fecha > hasta)) return false;
        if (filtroUnidad !== 'todos' && normalizar(registro.unidad) !== filtroUnidad) return false;
        if (filtroLider !== 'todos' && normalizar(registro.lider) !== filtroLider) return false;
        if (textoBusqueda && !getBusquedaTexto(registro).includes(normalizar(textoBusqueda))) return false;
        if (!omitTipo && !coincideFiltroTipo(registro, filtroTipo)) return false;
        return true;
    });

    const getTopEspecialidad = (registros) => {
        const contador = new Map();
        registros.forEach((registro) => {
            const clave = registro.tipoPrincipal || 'todos';
            contador.set(clave, (contador.get(clave) || 0) + 1);
        });
        const top = [...contador.entries()].sort((a, b) => b[1] - a[1])[0];
        if (!top) return null;
        return {
            tipo: top[0],
            total: top[1],
            label: tipoMap[top[0]]?.label || 'Sin clasificar'
        };
    };

    const getTopLider = (registros) => {
        const contador = new Map();
        registros.forEach((registro) => {
            const clave = registro.lider || 'Sin técnico';
            contador.set(clave, (contador.get(clave) || 0) + 1);
        });
        const top = [...contador.entries()].sort((a, b) => b[1] - a[1])[0];
        return top ? { nombre: top[0], total: top[1] } : null;
    };

    const tipoModalMap = {
        vibraciones: 'medición de vibraciones',
        termografia: 'termografía',
        lubricacion: 'lubricación',
        end: 'end',
        espesores: 'medición de espesores',
        dureza: 'dureza',
        todos: 'inspección visual'
    };

    const renderTipoPills = (registros) => {
        const host = document.getElementById('historial-type-pills');
        if (!host) return;
        const conteos = new Map();
        filtrosTipo.forEach(tipo => conteos.set(tipo.id, 0));
        registros.forEach((registro) => {
            const clave = registro.tipoPrincipal || 'todos';
            conteos.set(clave, (conteos.get(clave) || 0) + 1);
        });
        conteos.set('todos', registros.length);

        host.innerHTML = filtrosTipo.map((tipo) => `
            <button type="button"
                class="history-type-pill ${filtroTipo === tipo.id ? 'is-active' : ''}"
                data-history-type="${tipo.id}">
                <i class="fa-solid ${tipo.icon}"></i>
                <span>${tipo.label}</span>
                <strong>${conteos.get(tipo.id) || 0}</strong>
            </button>
        `).join('');
    };

    const renderMetrics = (registros) => {
        const host = document.getElementById('historial-kpis');
        if (!host) return;

        const hhTotal = registros.reduce((acum, registro) => acum + registro.hh, 0);
        const equipos = new Set(registros.map(registro => `${normalizar(registro.unidad)}|${normalizar(registro.nombre)}`));
        const unidades = new Set(registros.map(registro => normalizar(registro.unidad)).filter(Boolean));
        const unidadesPreview = [...new Set(registros.map(registro => registro.unidad).filter(Boolean))].slice(0, 2).join(' · ');
        const topEspecialidad = getTopEspecialidad(registros);
        const topLider = getTopLider(registros);

        host.innerHTML = `
            <article class="history-kpi">
                <span class="history-kpi-label"><i class="fa-solid fa-book-open"></i> Registros</span>
                <div class="history-kpi-value">${registros.length}</div>
                <div class="history-kpi-meta">Visibles</div>
            </article>
            <article class="history-kpi">
                <span class="history-kpi-label"><i class="fa-solid fa-user-clock"></i> HH</span>
                <div class="history-kpi-value">${formatearNumero(hhTotal)}</div>
                <div class="history-kpi-meta">Acumuladas</div>
            </article>
            <article class="history-kpi">
                <span class="history-kpi-label"><i class="fa-solid fa-gears"></i> Equipos</span>
                <div class="history-kpi-value">${equipos.size}</div>
                <div class="history-kpi-meta">Intervenidos</div>
            </article>
            <article class="history-kpi">
                <span class="history-kpi-label"><i class="fa-solid fa-location-dot"></i> Unidades</span>
                <div class="history-kpi-value">${unidades.size}</div>
                <div class="history-kpi-meta">${unidadesPreview || 'Sin unidad'}</div>
            </article>
            <article class="history-kpi">
                <span class="history-kpi-label"><i class="fa-solid fa-chart-pie"></i> Especialidad</span>
                <div class="history-kpi-value">${escapeHtml(topEspecialidad?.label || 'Sin dato')}</div>
                <div class="history-kpi-meta">${topEspecialidad ? `${topEspecialidad.total} registro(s)` : 'Sin dominante'}</div>
            </article>
            <article class="history-kpi">
                <span class="history-kpi-label"><i class="fa-solid fa-user-tie"></i> Lider</span>
                <div class="history-kpi-value">${escapeHtml(topLider?.nombre || 'Sin dato')}</div>
                <div class="history-kpi-meta">${topLider ? `${topLider.total} cierre(s)` : 'Sin registros'}</div>
            </article>
        `;
    };

    const renderBadgeTipo = (tipoId, recordId, labelOverride = '') => {
        const tipo = tipoMap[tipoId] || tipoMap.todos;
        return `
            <button type="button"
                class="history-type-badge"
                data-action="type-info"
                data-type="${tipoId}"
                data-record="${recordId}"
                style="background:${tipo.bg}; color:${tipo.color}; border:1px solid ${tipo.border};">
                <i class="fa-solid ${tipo.icon}"></i>
                <span>${escapeHtml(labelOverride || tipo.label)}</span>
            </button>
        `;
    };

    const renderRegistro = (registro) => {
        const stats = [];
        if (registro.otNumero) stats.push(`<span class="history-stat-chip"><i class="fa-solid fa-hashtag"></i> OT ${escapeHtml(registro.otNumero)}</span>`);
        if (registro.aviso) stats.push(`<span class="history-stat-chip"><i class="fa-solid fa-bell"></i> Aviso ${escapeHtml(registro.aviso)}</span>`);
        stats.push(`<span class="history-stat-chip"><i class="fa-regular fa-clock"></i> ${formatearHora(registro.fecha)}</span>`);
        if (registro.hh > 0) stats.push(`<span class="history-stat-chip"><i class="fa-solid fa-user-clock"></i> ${formatearNumero(registro.hh)} HH</span>`);
        if (registro.ayudantes.length) stats.push(`<span class="history-stat-chip"><i class="fa-solid fa-users"></i> ${registro.ayudantes.length} técnico(s)</span>`);

        const resumenLineas = [
            registro.acciones ? `<p><strong>Acciones:</strong> ${escapeHtml(registro.acciones)}</p>` : '',
            registro.observaciones ? `<p><strong>Observacion:</strong> ${escapeHtml(registro.observaciones)}</p>` : '',
            registro.analisis ? `<p><strong>Analisis:</strong> ${escapeHtml(registro.analisis)}</p>` : ''
        ].filter(Boolean).join('');

        const botonesTipo = (registro.tipos.length ? registro.tipos : [tipoMap[registro.tipoPrincipal]?.label || 'General'])
            .slice(0, 3)
            .map((tipoTexto) => renderBadgeTipo(registro.tipoPrincipal, registro.id, tipoTexto))
            .join('');

        const botonEquipo = registro.equipoAccion
            ? `<button type="button" class="btn btn-outline" data-action="open-equipo" data-id="${registro.equipoAccion.id}" data-mode="${registro.equipoAccion.mode}" data-unidad="${escapeHtml(registro.equipoAccion.unidad || '')}">
                    <i class="fa-solid fa-arrow-up-right-from-square"></i> Abrir equipo
               </button>`
            : '';

        return `
            <article class="history-record" data-record-id="${registro.id}">
                <div class="history-record-top">
                    <div class="history-record-main">
                        <div class="history-record-title-row">
                            <div class="history-record-title">${escapeHtml(registro.nombre)}</div>
                            ${renderBadgeTipo(registro.tipoPrincipal, registro.id)}
                        </div>
                        <div class="history-record-meta">
                            <span><i class="fa-regular fa-calendar"></i> ${formatearFechaCorta(registro.fecha)}, ${registro.horaLabel}</span>
                            <span><i class="fa-solid fa-location-dot"></i> ${escapeHtml(registro.unidad)}</span>
                            ${registro.componente ? `<span><i class="fa-solid fa-screwdriver-wrench"></i> ${escapeHtml(registro.componente)}</span>` : ''}
                            <span><i class="fa-solid fa-user-tie"></i> ${escapeHtml(registro.lider)}</span>
                        </div>
                        <div class="history-record-stats">
                            ${stats.join('')}
                        </div>
                        <div class="history-record-actions">
                            ${botonesTipo}
                        </div>
                        <div class="history-record-summary">
                ${resumenLineas || '<p>Sin detalle técnico adicional para este cierre.</p>'}
                        </div>
                    </div>
                    <div class="history-record-side">
                        ${botonEquipo}
                        <button type="button" class="btn btn-outline" data-action="report" data-id="${registro.id}">
                            <i class="fa-solid fa-file-lines"></i> Informe
                        </button>
                        <button type="button" class="btn btn-outline btn-icon" title="Eliminar registro" data-action="delete" data-id="${registro.id}" style="border-color:#fecaca;color:#dc2626;background:#fff5f5;">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </div>
            </article>
        `;
    };

    const renderContenido = (registros) => {
        const host = document.getElementById('historial-contenido');
        if (!host) return;
        if (!registros.length) {
            host.innerHTML = `
                <div class="panel">
                    <div class="empty-state">
                        <div>
                            <strong>Sin registros en este rango</strong>
                            <p>Ajusta las fechas o los filtros para revisar actividad historica con mas detalle.</p>
                        </div>
                    </div>
                </div>
            `;
            return;
        }

        const grupos = registros.reduce((acum, registro) => {
            if (!acum[registro.fechaClave]) {
                acum[registro.fechaClave] = {
                    label: registro.fechaLabel,
                    items: []
                };
            }
            acum[registro.fechaClave].items.push(registro);
            return acum;
        }, {});

        host.innerHTML = `
            <div class="history-groups">
                ${Object.entries(grupos).map(([clave, grupo]) => `
                    <section class="history-group" data-group="${clave}">
                        <div class="history-group-head">
                            <div class="history-group-title">
                                <h3>${escapeHtml(grupo.label)}</h3>
                            </div>
                            <div class="history-group-count">
                                <i class="fa-solid fa-layer-group"></i>
                                <span>${grupo.items.length} registro(s)</span>
                            </div>
                        </div>
                        <div class="history-record-list">
                            ${grupo.items.map(renderRegistro).join('')}
                        </div>
                    </section>
                `).join('')}
            </div>
        `;
    };

    const renderResumenRango = (registros) => {
        const host = document.getElementById('historial-resumen-rango');
        if (!host) return;
        const equipos = new Set(registros.map(registro => `${normalizar(registro.unidad)}|${normalizar(registro.nombre)}`));
        const desde = rango.desde ? formatearFechaCorta(inicioDia(rango.desde)) : formatearFechaCorta(fechaMin);
        const hasta = rango.hasta ? formatearFechaCorta(finDia(rango.hasta)) : formatearFechaCorta(fechaMax);
        host.innerHTML = `
            <i class="fa-regular fa-calendar-check"></i>
            <span>${registros.length} registro(s) · ${equipos.size} equipo(s) · ${desde} al ${hasta}</span>
        `;
    };

    const syncPresetButtons = () => {
        document.querySelectorAll('[data-history-preset]').forEach((button) => {
            button.classList.toggle('is-active', button.dataset.historyPreset === presetActivo);
        });
    };

    const updateLimpiarButton = (registros) => {
        const button = document.getElementById('btn-limpiar-historial');
        if (!button) return;
        button.disabled = registros.length === 0;
        button.innerHTML = `<i class="fa-solid fa-trash-can"></i> Limpiar visibles (${registros.length})`;
    };

    const renderTodo = () => {
        const visibles = getRegistrosFiltrados();
        const visiblesSinTipo = getRegistrosFiltrados({ omitTipo: true });
        renderMetrics(visibles);
        renderTipoPills(visiblesSinTipo);
        renderContenido(visibles);
        renderResumenRango(visibles);
        syncPresetButtons();
        updateLimpiarButton(visibles);
    };

    window._borrarHistorial = async (id) => {
        if (!confirm('Eliminar este registro del historial? Tambien se borraran las mediciones asociadas.')) return;
        if (!navigator.onLine) {
            alert('Se requiere conexion a internet para eliminar del historial.');
            return;
        }

        const { error } = await supabaseClient.from(tablasDb.historial).delete().eq('id', id);
        if (error) {
            alert('Error al eliminar: ' + error.message);
            return;
        }

        const registro = estado.historialTareas.find(t => t.id === id);
        if (registro?.equipo_id && registro?.fecha_med) {
            const equipoObj = estado.equipos.find(e => String(e.id) === String(registro.equipo_id));
            const idsGrupo = equipoObj
                ? estado.equipos.filter(e => e.activo === equipoObj.activo).map(e => e.id)
                : [registro.equipo_id];
            await supabaseClient.from(tablasDb.mediciones)
                .delete()
                .in('equipo_id', idsGrupo)
                .eq('fecha', registro.fecha_med);
            estado.historialMediciones = estado.historialMediciones.filter(
                med => !(idsGrupo.includes(med.equipo_id) && med.fecha?.slice(0, 10) === registro.fecha_med)
            );
        }

        estado.historialTareas = estado.historialTareas.filter(t => t.id !== id);
        renderHistorialView();
    };

    mainContent.innerHTML = `
        <div class="fade-in history-view">
            <section class="panel history-hero">
                <div class="history-hero-top">
                    <div>
                        <div class="history-eyebrow">Bitacora tecnica</div>
                        <h1 style="margin:0 0 0.4rem 0;">Historial</h1>
        <p class="history-subtitle">Seguimiento consolidado de trabajos cerrados, analisis técnicos y actividad por fecha.</p>
                    </div>
                    <button id="btn-limpiar-historial" type="button" class="btn btn-outline" style="border-color:#fecaca;color:#dc2626;background:#fff5f5;">
                        <i class="fa-solid fa-trash-can"></i> Limpiar visibles
                    </button>
                </div>
                <div class="history-toolbar">
                    <div class="history-presets">
                        <button type="button" class="history-preset" data-history-preset="hoy">Hoy</button>
                        <button type="button" class="history-preset" data-history-preset="semana">Ultimos 7 dias</button>
                        <button type="button" class="history-preset" data-history-preset="mes">Ultimos 30 dias</button>
                        <button type="button" class="history-preset" data-history-preset="todo">Todo</button>
                    </div>
                    <div id="historial-resumen-rango" class="history-group-count"></div>
                </div>
            </section>

            <section id="historial-kpis" class="history-kpi-grid"></section>

            <section class="panel">
                <div class="history-filter-grid">
                    <div class="form-group">
                        <label for="input-buscar-historial">Busqueda tecnica</label>
                        <input id="input-buscar-historial" class="form-control" type="text" placeholder="Equipo, OT, aviso, KKS, lider...">
                    </div>
                    <div class="form-group">
                        <label for="historial-filtro-unidad">Unidad</label>
                        <select id="historial-filtro-unidad" class="form-control">
                            <option value="todos">Todas</option>
                            ${opcionesUnidad.map(unidad => `<option value="${escapeHtml(normalizar(unidad))}">${escapeHtml(unidad)}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="historial-filtro-lider">Lider</label>
                        <select id="historial-filtro-lider" class="form-control">
                            <option value="todos">Todos</option>
                            ${opcionesLider.map(lider => `<option value="${escapeHtml(normalizar(lider))}">${escapeHtml(lider)}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="historial-fecha-desde">Desde</label>
                        <input id="historial-fecha-desde" class="form-control" type="date" value="${escapeHtml(rango.desde)}">
                    </div>
                    <div class="form-group">
                        <label for="historial-fecha-hasta">Hasta</label>
                        <input id="historial-fecha-hasta" class="form-control" type="date" value="${escapeHtml(rango.hasta)}">
                    </div>
                </div>
                <div id="historial-type-pills" class="history-type-pills" style="margin-top:1rem;"></div>
            </section>

            <section id="historial-contenido"></section>
        </div>
    `;

    document.querySelectorAll('[data-history-preset]').forEach((button) => {
        button.addEventListener('click', () => {
            presetActivo = button.dataset.historyPreset;
            rango = getPresetRange(presetActivo);
            const inputDesde = document.getElementById('historial-fecha-desde');
            const inputHasta = document.getElementById('historial-fecha-hasta');
            if (inputDesde) inputDesde.value = rango.desde;
            if (inputHasta) inputHasta.value = rango.hasta;
            renderTodo();
        });
    });

    document.getElementById('input-buscar-historial')?.addEventListener('input', (event) => {
        textoBusqueda = event.target.value || '';
        renderTodo();
    });

    document.getElementById('historial-filtro-unidad')?.addEventListener('change', (event) => {
        filtroUnidad = event.target.value || 'todos';
        renderTodo();
    });

    document.getElementById('historial-filtro-lider')?.addEventListener('change', (event) => {
        filtroLider = event.target.value || 'todos';
        renderTodo();
    });

    document.getElementById('historial-fecha-desde')?.addEventListener('change', (event) => {
        presetActivo = 'custom';
        rango.desde = event.target.value || '';
        renderTodo();
    });

    document.getElementById('historial-fecha-hasta')?.addEventListener('change', (event) => {
        presetActivo = 'custom';
        rango.hasta = event.target.value || '';
        renderTodo();
    });

    document.getElementById('historial-type-pills')?.addEventListener('click', (event) => {
        const button = event.target.closest('[data-history-type]');
        if (!button) return;
        filtroTipo = button.dataset.historyType || 'todos';
        renderTodo();
    });

    document.getElementById('historial-contenido')?.addEventListener('click', (event) => {
        const button = event.target.closest('[data-action]');
        if (!button) return;

        const action = button.dataset.action;
        if (action === 'open-equipo') {
            const id = button.dataset.id;
            const mode = button.dataset.mode;
            const unidad = button.dataset.unidad || '';
            if (!id) return;
            if (mode === 'group') {
                window.elegirComponenteYAbrirFicha(id, unidad);
            } else {
                window.abrirFichaTecnica(id);
            }
            return;
        }

        if (action === 'report') {
            const id = button.dataset.id;
            if (id) window._generarInformeTarea(id);
            return;
        }

        if (action === 'delete') {
            const id = button.dataset.id;
            if (id) window._borrarHistorial(id);
            return;
        }

        if (action === 'type-info') {
            const tipo = button.dataset.type;
            const recordId = button.dataset.record;
            if (!tipo || !recordId) return;
            const textoBadge = button.querySelector('span')?.textContent?.trim();
            const label = tipoModalMap[tipo] || textoBadge || tipoMap[tipo]?.label || tipo;
            window.abrirModalTipoBadge(label, recordId);
        }
    });

    document.getElementById('btn-limpiar-historial')?.addEventListener('click', async () => {
        const visibles = getRegistrosFiltrados();
        if (!visibles.length) return;
        const mensaje = visibles.length === registrosBase.length
            ? `Se eliminaran todos los registros visibles del historial (${visibles.length}).`
            : `Se eliminaran ${visibles.length} registros visibles segun los filtros actuales.`;
        if (!confirm(`${mensaje} Esta accion no se puede deshacer.`)) return;
        if (!navigator.onLine) {
            alert('Se requiere conexion a internet para limpiar el historial.');
            return;
        }

        const idsABorrar = visibles.map(registro => registro.id);
        const { error } = await supabaseClient.from(tablasDb.historial).delete().in('id', idsABorrar);
        if (error) {
            alert('Error al eliminar: ' + error.message);
            return;
        }

        estado.historialTareas = estado.historialTareas.filter(t => !idsABorrar.includes(t.id));
        renderHistorialView();
    });

    renderTodo();
}

async function renderHorasExtraAdminView() {
    mainContent.innerHTML = `<div class="fade-in" style="max-width:1180px; margin:0 auto;"><div class="panel" style="text-align:center; padding:2rem;"><p style="color:var(--text-muted);">Cargando horas extra...</p></div></div>`;

    const todos = await cargarTodasHorasExtra();
    const trabajadores = estado.trabajadores || [];
    const hoy = new Date();
    const mesActual = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;

    const normalizar = (valor) => String(valor || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
    const formatHoras = (valor) => new Intl.NumberFormat('es-CL', { minimumFractionDigits: 0, maximumFractionDigits: 1 }).format(Number(valor || 0));
    const formatFecha = (valor) => valor
        ? new Date(`${valor}T12:00:00`).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' })
        : '--';

    const enriched = todos.map((registro) => ({
        ...registro,
        nombreTrabajador: trabajadores.find(t => t.id === registro.trabajador_id)?.nombre || 'Desconocido',
        estado: registro.estado || 'pendiente',
        horasNumero: parseFloat(registro.horas) || 0
    }));

    let filtroEstado = 'todos';
    let filtroTrabajador = '';
    let filtroMes = '';
    let textoBusqueda = '';

    const getStatusHtml = (estado, motivoRechazo = '') => {
        const base = estado === 'aprobado'
            ? `<span class="overtime-status approved"><i class="fa-solid fa-circle-check"></i> Aprobado</span>`
            : estado === 'rechazado'
            ? `<span class="overtime-status rejected"><i class="fa-solid fa-circle-xmark"></i> Rechazado</span>`
            : `<span class="overtime-status pending"><i class="fa-solid fa-hourglass-half"></i> Pendiente</span>`;
        return `${base}${estado === 'rechazado' && motivoRechazo ? `<div class="overtime-note" style="margin-top:0.35rem; color:#dc2626;">${motivoRechazo}</div>` : ''}`;
    };

    const getFiltrados = () => enriched.filter((registro) => {
        if (filtroEstado !== 'todos' && registro.estado !== filtroEstado) return false;
        if (filtroTrabajador && registro.trabajador_id !== filtroTrabajador) return false;
        if (filtroMes && !(registro.fecha || '').startsWith(filtroMes)) return false;
        if (textoBusqueda) {
            const texto = normalizar([
                registro.nombreTrabajador,
                registro.motivo,
                registro.estado,
                registro.fecha
            ].join(' '));
            if (!texto.includes(normalizar(textoBusqueda))) return false;
        }
        return true;
    });

    const renderTabla = () => {
        const tabla = document.getElementById('he-admin-tabla-body');
        const filtrados = getFiltrados();
        const baseMetricas = filtroTrabajador
            ? enriched.filter(r => r.trabajador_id === filtroTrabajador)
            : enriched;
        const pendientes = baseMetricas.filter(r => r.estado === 'pendiente').length;
        const aprobadasMes = baseMetricas
            .filter(r => r.estado === 'aprobado' && (r.fecha || '').startsWith(mesActual))
            .reduce((acum, r) => acum + r.horasNumero, 0);
        const totalSolicitadoMes = baseMetricas
            .filter(r => (r.fecha || '').startsWith(mesActual))
            .reduce((acum, r) => acum + r.horasNumero, 0);
        const trabajadoresConSolicitudes = new Set(baseMetricas.map(r => r.trabajador_id)).size;

        const statPend = document.getElementById('he-stat-pendientes');
        const statApr = document.getElementById('he-stat-aprobadas');
        const statTot = document.getElementById('he-stat-total');
        const statTrab = document.getElementById('he-stat-trabajadores');
        const statVisible = document.getElementById('he-visible-count');
        if (statPend) statPend.textContent = String(pendientes);
        if (statApr) statApr.textContent = `${formatHoras(aprobadasMes)} hrs`;
        if (statTot) statTot.textContent = `${formatHoras(totalSolicitadoMes)} hrs`;
        if (statTrab) statTrab.textContent = String(trabajadoresConSolicitudes);
        if (statVisible) statVisible.textContent = `${filtrados.length} registro(s) visibles`;

        if (!tabla) return;
        if (!filtrados.length) {
            tabla.innerHTML = `<tr><td colspan="6" style="padding:2rem;"><div class="empty-state empty-state--compact"><div><strong>Sin registros para este filtro</strong><p>Ajusta el estado, trabajador, mes o busqueda para revisar otras solicitudes.</p></div></div></td></tr>`;
            return;
        }

        tabla.innerHTML = filtrados.map((registro) => {
            const btnAprobar = registro.estado === 'pendiente'
                ? `<button type="button" class="btn btn-outline" style="border-color:#bbf7d0;color:#15803d;background:#f0fdf4;" onclick="window._heAprobar('${registro.id}')"><i class="fa-solid fa-check"></i> Aprobar</button>`
                : '';
            const btnRechazar = registro.estado === 'pendiente'
                ? `<button type="button" class="btn btn-outline" style="border-color:#fecaca;color:#dc2626;background:#fff5f5;" onclick="window._heRechazar('${registro.id}')"><i class="fa-solid fa-xmark"></i> Rechazar</button>`
                : '';

            return `
                <tr id="he-row-${registro.id}" style="${registro.estado === 'rechazado' ? 'opacity:0.72;' : ''}">
                    <td data-label="Trabajador">
                        <div style="font-weight:700; color:#0f172a;">${registro.nombreTrabajador}</div>
                        <div class="overtime-note">${registro.aprobado_por ? `Gestionado por ${registro.aprobado_por}` : 'Sin resolucion aun'}</div>
                    </td>
                    <td data-label="Fecha">
                        <div style="font-weight:700; color:#0f172a;">${formatFecha(registro.fecha)}</div>
                        <div class="overtime-note">${registro.created_at ? new Date(registro.created_at).toLocaleDateString('es-CL') : 'Sin fecha de carga'}</div>
                    </td>
                    <td data-label="Horas">
                        <div style="font-weight:800; color:var(--primary-color);">${formatHoras(registro.horasNumero)} hrs</div>
                    </td>
                    <td data-label="Motivo" style="max-width:260px;">
                        <div style="color:#475569; font-size:0.83rem; line-height:1.55;">${registro.motivo || 'Sin motivo registrado.'}</div>
                    </td>
                    <td data-label="Estado">${getStatusHtml(registro.estado, registro.motivo_rechazo)}</td>
                    <td data-label="Acciones">
                        <div style="display:flex; flex-wrap:wrap; gap:0.45rem;">
                            ${btnAprobar}
                            ${btnRechazar}
                            <button type="button" class="btn btn-outline btn-icon" title="Eliminar" onclick="window._heEliminar('${registro.id}')" style="border-color:#fecaca;color:#dc2626;background:#fff5f5;">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    };

    const opcionesTrabajadores = [
        `<option value="">Todos los trabajadores</option>`,
        ...trabajadores
            .slice()
            .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
            .map(t => `<option value="${t.id}">${t.nombre}</option>`)
    ].join('');

    const pendientesInicial = enriched.filter(r => r.estado === 'pendiente').length;
    const aprobadasInicial = enriched.filter(r => r.estado === 'aprobado' && (r.fecha || '').startsWith(mesActual)).reduce((a, r) => a + r.horasNumero, 0);
    const totalInicial = enriched.filter(r => (r.fecha || '').startsWith(mesActual)).reduce((a, r) => a + r.horasNumero, 0);
    const trabajadoresActivos = new Set(enriched.map(r => r.trabajador_id)).size;

    mainContent.innerHTML = `
        <div class="fade-in overtime-view" style="max-width:1180px; margin:0 auto;">
            <section class="panel overtime-hero">
                <div class="dashboard-hero-head">
                    <div>
                        <div class="overtime-eyebrow">Gestion administrativa</div>
                        <h1 style="margin:0 0 0.4rem 0;"><i class="fa-regular fa-clock"></i> Horas Extra</h1>
                        <p class="overtime-subtitle">Revision centralizada de solicitudes, aprobaciones y trazabilidad mensual del sobretiempo del equipo.</p>
                    </div>
                    <div class="dashboard-hero-badges">
                        <span class="dashboard-hero-badge"><i class="fa-solid fa-hourglass-half"></i> ${pendientesInicial} pendientes</span>
                        <span class="dashboard-hero-badge"><i class="fa-solid fa-users"></i> ${trabajadoresActivos} trabajador(es)</span>
                    </div>
                </div>

                <div class="overtime-kpi-grid">
                    <article class="overtime-kpi-card">
                        <span class="overtime-kpi-label"><i class="fa-solid fa-hourglass-half"></i> Pendientes</span>
                        <div id="he-stat-pendientes" class="overtime-kpi-value">${pendientesInicial}</div>
                        <div class="overtime-kpi-meta">Por resolver</div>
                    </article>
                    <article class="overtime-kpi-card">
                        <span class="overtime-kpi-label"><i class="fa-solid fa-circle-check"></i> Aprobadas mes</span>
                        <div id="he-stat-aprobadas" class="overtime-kpi-value">${formatHoras(aprobadasInicial)} hrs</div>
                        <div class="overtime-kpi-meta">Este mes</div>
                    </article>
                    <article class="overtime-kpi-card">
                        <span class="overtime-kpi-label"><i class="fa-solid fa-chart-column"></i> Solicitadas mes</span>
                        <div id="he-stat-total" class="overtime-kpi-value">${formatHoras(totalInicial)} hrs</div>
                        <div class="overtime-kpi-meta">Este mes</div>
                    </article>
                    <article class="overtime-kpi-card">
                        <span class="overtime-kpi-label"><i class="fa-solid fa-user-group"></i> Trabajadores</span>
                        <div id="he-stat-trabajadores" class="overtime-kpi-value">${trabajadoresActivos}</div>
                        <div class="overtime-kpi-meta">Con registros</div>
                    </article>
                </div>

                <div class="overtime-toolbar">
                    <div class="overtime-toolbar-note">
                        <i class="fa-solid fa-circle-info"></i>
                        <span>${pendientesInicial > 0 ? `Hay ${pendientesInicial} solicitud(es) esperando resolucion.` : 'No hay solicitudes pendientes por revisar.'}</span>
                    </div>
                    <div id="he-visible-count" class="overtime-toolbar-note">${enriched.length} registro(s) visibles</div>
                </div>
            </section>

            <section class="panel">
                <div class="overtime-filter-grid">
                    <div class="form-group">
                        <label for="he-busqueda">Busqueda</label>
                        <input id="he-busqueda" type="text" class="form-control" placeholder="Trabajador, motivo o fecha...">
                    </div>
                    <div class="form-group">
                        <label for="he-filtro-estado">Estado</label>
                        <select id="he-filtro-estado" class="form-control">
                            <option value="todos">Todos</option>
                            <option value="pendiente">Pendientes</option>
                            <option value="aprobado">Aprobados</option>
                            <option value="rechazado">Rechazados</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="he-filtro-trabajador">Trabajador</label>
                        <select id="he-filtro-trabajador" class="form-control">${opcionesTrabajadores}</select>
                    </div>
                    <div class="form-group">
                        <label for="he-filtro-mes">Mes</label>
                        <input type="month" id="he-filtro-mes" class="form-control">
                    </div>
                    <button id="btn-he-eliminar-todo" class="btn btn-outline" style="border-color:#fecaca;color:#dc2626;background:#fff5f5;">
                        <i class="fa-solid fa-trash-can"></i> Eliminar todas
                    </button>
                </div>
            </section>

            <section class="panel" style="padding:0;">
                <div class="table-shell" style="border:none; border-radius:18px;">
                    <table class="table-clean table-clean--stacked" style="width:100%;">
                        <thead>
                            <tr>
                                <th>Trabajador</th>
                                <th>Fecha</th>
                                <th>Horas</th>
                                <th>Motivo</th>
                                <th>Estado</th>
                                <th>Acciones</th>
                            </tr>
                        </thead>
                        <tbody id="he-admin-tabla-body"></tbody>
                    </table>
                </div>
            </section>
        </div>
    `;

    document.getElementById('he-filtro-estado')?.addEventListener('change', (event) => {
        filtroEstado = event.target.value || 'todos';
        renderTabla();
    });
    document.getElementById('he-filtro-trabajador')?.addEventListener('change', (event) => {
        filtroTrabajador = event.target.value || '';
        renderTabla();
    });
    document.getElementById('he-filtro-mes')?.addEventListener('change', (event) => {
        filtroMes = event.target.value || '';
        renderTabla();
    });
    document.getElementById('he-busqueda')?.addEventListener('input', (event) => {
        textoBusqueda = event.target.value || '';
        renderTabla();
    });

    window._heAprobar = async (id) => {
        await aprobarHorasExtra(id);
        const idx = enriched.findIndex(r => r.id === id);
        if (idx >= 0) {
            enriched[idx] = {
                ...enriched[idx],
                estado: 'aprobado',
                aprobado_por: 'Planificador',
                fecha_aprobacion: new Date().toISOString(),
                motivo_rechazo: null
            };
        }
        renderTabla();
        actualizarBadgeHE();
    };

    window._heRechazar = (id) => {
        const modal = document.getElementById('modal-he-rechazo');
        document.getElementById('he-rechazo-motivo').value = '';
        document.getElementById('he-rechazo-error').style.display = 'none';
        modal.style.display = 'flex';

        document.getElementById('btn-he-rechazo-cancelar').onclick = () => {
            modal.style.display = 'none';
        };
        document.getElementById('btn-he-rechazo-confirmar').onclick = async () => {
            const motivo = document.getElementById('he-rechazo-motivo').value.trim();
            if (!motivo) {
                document.getElementById('he-rechazo-error').style.display = 'block';
                return;
            }
            const boton = document.getElementById('btn-he-rechazo-confirmar');
            boton.disabled = true;
            boton.textContent = 'Guardando...';
            await rechazarHorasExtra(id, motivo);
            boton.disabled = false;
            boton.textContent = 'Confirmar Rechazo';
            modal.style.display = 'none';
            const idx = enriched.findIndex(r => r.id === id);
            if (idx >= 0) {
                enriched[idx] = {
                    ...enriched[idx],
                    estado: 'rechazado',
                    aprobado_por: 'Planificador',
                    fecha_aprobacion: new Date().toISOString(),
                    motivo_rechazo: motivo
                };
            }
            renderTabla();
            actualizarBadgeHE();
        };
    };

    window._heEliminar = async (id) => {
        if (!confirm('Eliminar este registro de horas extra?')) return;
        try {
            await eliminarRegistrosHorasExtra([id]);
            const idx = enriched.findIndex(r => r.id === id);
            if (idx >= 0) enriched.splice(idx, 1);
            renderTabla();
            actualizarBadgeHE();
        } catch (error) {
            alert(error?.message || 'No se pudo eliminar el registro.');
        }
    };

    document.getElementById('btn-he-eliminar-todo')?.addEventListener('click', async () => {
        if (!enriched.length) {
            alert('No hay horas extra para eliminar.');
            return;
        }
        if (!confirm(`Eliminar TODAS las horas extra (${enriched.length} registro(s))? Esta accion no se puede deshacer.`)) return;
        const btn = document.getElementById('btn-he-eliminar-todo');
        const textoOriginal = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Eliminando...';
        try {
            await eliminarRegistrosHorasExtra();
            enriched.splice(0, enriched.length);
            renderTabla();
            actualizarBadgeHE();
        } catch (error) {
            alert(error?.message || 'No se pudieron eliminar las horas extra.');
        } finally {
            btn.disabled = false;
            btn.innerHTML = textoOriginal;
        }
    });

    renderTabla();
}

function renderTrabajadoresView() {
    const tareasActivas = estado.tareas.filter(t => t.estadoTarea === 'en_curso');
    const idsEnTarea = new Set(tareasActivas.flatMap(t => [t.liderId, ...(t.ayudantesIds || [])].filter(Boolean)));
    const ocupados = estado.trabajadores.filter(t => t.disponible && idsEnTarea.has(t.id));
    const disponibles = estado.trabajadores.filter(t => t.disponible && !idsEnTarea.has(t.id));
    const ausentes = estado.trabajadores.filter(t => !t.disponible);

    const normalizar = (valor) => String(valor || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();

    const totalTrabajadores = estado.trabajadores.length;
    const cobertura = totalTrabajadores > 0
        ? Math.round(((disponibles.length + ocupados.length) / totalTrabajadores) * 100)
        : 0;
    const habilidadesActivas = new Set([...disponibles, ...ocupados].flatMap(t => t.habilidades || [])).size;
    const topHabilidad = (() => {
        const conteo = new Map();
        [...disponibles, ...ocupados].forEach((trabajador) => {
            (trabajador.habilidades || []).forEach((habilidad) => {
                conteo.set(habilidad, (conteo.get(habilidad) || 0) + 1);
            });
        });
        return [...conteo.entries()].sort((a, b) => b[1] - a[1])[0] || null;
    })();
    const opcionesHabilidad = tipicosTrabajos.filter((habilidad) => habilidad !== 'OTRO');
    const normalizarRut = (valor) => String(valor || '')
        .replace(/[.\-\s]/g, '')
        .toUpperCase()
        .trim();
    const dividirEspecialidades = (valor) => String(valor || '')
        .split(/[\n,;]+/)
        .map((item) => item.trim())
        .filter(Boolean);
    const obtenerHabilidadesExtrasExistentes = (habilidades = []) =>
        (habilidades || []).filter((habilidad) => !opcionesHabilidad.includes(habilidad));
    const skillOptionHtml = opcionesHabilidad.map((habilidad) => `
        <label style="display:flex; gap:0.55rem; align-items:flex-start; padding:0.7rem 0.8rem; border:1px solid var(--border-color); border-radius:14px; background:#fff;">
            <input type="checkbox" name="nuevo-trabajador-habilidades" value="${habilidad}" style="margin-top:0.18rem;">
            <span style="font-size:0.9rem; color:var(--text-main); line-height:1.35;">${habilidad}</span>
        </label>
    `).join('');

    const getTareasTrabajador = (trabajadorId) => tareasActivas.filter(t =>
        t.liderId === trabajadorId || (t.ayudantesIds || []).includes(trabajadorId)
    );

    const renderEstado = (tipo) => {
        if (tipo === 'disponible') return { label: 'Disponible', color: 'var(--success-color)', bg: 'var(--success-color)' };
        if (tipo === 'ocupado') return { label: 'Trabajando', color: 'var(--warning-color)', bg: 'var(--warning-color)' };
        return { label: 'Sin check-in', color: '#64748b', bg: '#64748b' };
    };

    const renderCard = (trabajador, estadoTipo) => {
        const estadoCfg = renderEstado(estadoTipo);
        const tareas = getTareasTrabajador(trabajador.id);
        const principal = tareas[0] || null;
        const rolPrincipal = principal
                            ? (principal.liderId === trabajador.id ? 'Lider de frente' : 'Técnico en terreno')
            : (estadoTipo === 'disponible' ? 'Listo para ser asignado' : 'Sin jornada activa');
        const resumen = principal
            ? `${principal.tipo || 'Trabajo activo'}${principal.otNumero || principal.ot_numero ? ` · OT ${(principal.otNumero || principal.ot_numero)}` : ''}`
            : (estadoTipo === 'ausente'
                ? 'Aun no registra check-in hoy.'
                : `Disponible con ${(trabajador.habilidades || []).length} habilidad(es) cargadas.`);
        const searchText = normalizar([
            trabajador.nombre,
            trabajador.puesto,
            (trabajador.habilidades || []).join(' '),
            rolPrincipal,
            resumen,
            (principal?.tipo || ''),
            (principal?.otNumero || principal?.ot_numero || '')
        ].join(' '));

        return `
            <article class="crew-card ${estadoTipo === 'ausente' ? 'is-muted' : ''}" data-crew-card data-crew-panel="${estadoTipo}" data-search="${searchText}" style="border-left-color:${estadoCfg.color};">
                <div class="crew-card-top">
                    <div class="crew-card-main">
                        <div class="crew-avatar" style="background:${estadoCfg.color};">${(trabajador.nombre || '?').charAt(0).toUpperCase()}</div>
                        <div>
                            <div class="crew-card-title">${trabajador.nombre}</div>
                            <div class="crew-card-role">${trabajador.puesto}</div>
                        </div>
                    </div>
                    <span class="crew-status-badge" style="background:${estadoCfg.bg};">${estadoCfg.label}</span>
                </div>
                <div class="crew-card-meta">
                    <span><i class="fa-solid fa-user-gear"></i> ${rolPrincipal}</span>
                    <span><i class="fa-solid fa-layer-group"></i> ${(trabajador.habilidades || []).length} habilidad(es)</span>
                    ${principal ? `<span><i class="fa-solid fa-briefcase"></i> ${tareas.length} tarea(s) activa(s)</span>` : ''}
                </div>
                <div class="crew-summary"><strong>Resumen:</strong> ${resumen}</div>
                <div class="crew-card-actions">
                    ${(principal?.otNumero || principal?.ot_numero) ? `<span class="crew-chip"><i class="fa-solid fa-hashtag"></i> ${principal.otNumero || principal.ot_numero}</span>` : ''}
                    ${principal?.horaAsignacion ? `<span class="crew-chip"><i class="fa-regular fa-clock"></i> ${principal.horaAsignacion}</span>` : ''}
                </div>
                <div class="crew-skills">
                    ${(trabajador.habilidades || []).length
                        ? (trabajador.habilidades || []).map(habilidad => `<span class="crew-skill">${habilidad}</span>`).join('')
                        : `<span class="crew-chip">Sin habilidades cargadas</span>`}
                </div>
                <div class="crew-card-actions" style="margin-top:0.9rem; justify-content:flex-end;">
                    <button type="button" class="btn btn-outline btn-icon" title="Editar trabajador" data-worker-edit="${trabajador.id}">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    <button type="button" class="btn btn-outline btn-icon" title="Eliminar trabajador" data-worker-delete="${trabajador.id}" style="border-color:#fecaca;color:#dc2626;background:#fff5f5;">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </article>
        `;
    };

    mainContent.innerHTML = `
        <div class="fade-in crew-view">
            <section class="panel crew-hero">
                <div class="dashboard-hero-head">
                    <div>
                        <div class="crew-eyebrow">Operacion de personal</div>
                        <h1 style="margin:0 0 0.4rem 0;"><i class="fa-solid fa-users"></i> Trabajadores</h1>
                        <p class="crew-subtitle">Lectura rapida de disponibilidad, carga activa y cobertura de habilidades del equipo en terreno.</p>
                    </div>
                    <div class="crew-hero-actions">
                        <div class="dashboard-hero-badges">
                            <span class="dashboard-hero-badge"><i class="fa-solid fa-user-check"></i> Cobertura ${cobertura}%</span>
                            <span class="dashboard-hero-badge"><i class="fa-solid fa-screwdriver-wrench"></i> ${habilidadesActivas} habilidades</span>
                        </div>
                        <button id="btn-nuevo-trabajador" class="btn btn-primary" type="button" style="white-space:nowrap;">
                            <i class="fa-solid fa-user-plus"></i> Agregar trabajador
                        </button>
                    </div>
                </div>

                <div class="crew-kpi-grid">
                    <article class="crew-kpi-card">
                        <span class="crew-kpi-label"><i class="fa-solid fa-circle-check"></i> Disponibles</span>
                        <div class="crew-kpi-value">${disponibles.length}</div>
                        <div class="crew-kpi-meta">Con check-in libre</div>
                    </article>
                    <article class="crew-kpi-card">
                        <span class="crew-kpi-label"><i class="fa-solid fa-person-digging"></i> Trabajando</span>
                        <div class="crew-kpi-value">${ocupados.length}</div>
                        <div class="crew-kpi-meta">En ejecucion</div>
                    </article>
                    <article class="crew-kpi-card">
                        <span class="crew-kpi-label"><i class="fa-solid fa-user-clock"></i> Sin check-in</span>
                        <div class="crew-kpi-value">${ausentes.length}</div>
                        <div class="crew-kpi-meta">Fuera de jornada</div>
                    </article>
                    <article class="crew-kpi-card">
                        <span class="crew-kpi-label"><i class="fa-solid fa-star"></i> Habilidad dominante</span>
                        <div class="crew-kpi-value">${topHabilidad ? topHabilidad[0] : 'Sin dato'}</div>
                        <div class="crew-kpi-meta">${topHabilidad ? `${topHabilidad[1]} persona(s)` : 'Sin registros'}</div>
                    </article>
                </div>

                <div class="crew-toolbar">
                    <div class="crew-tabs">
                        <button type="button" class="crew-tab is-active" data-crew-tab="disponible" style="background:var(--success-color);">Disponibles (${disponibles.length})</button>
                        <button type="button" class="crew-tab" data-crew-tab="ocupado">Trabajando (${ocupados.length})</button>
                        <button type="button" class="crew-tab" data-crew-tab="ausente">Sin check-in (${ausentes.length})</button>
                    </div>
                    <div style="display:flex; gap:0.65rem; align-items:center; flex-wrap:wrap;">
                        <div class="crew-toolbar-note">
                            <i class="fa-solid fa-circle-info"></i>
                            <span>${ocupados.length > 0 ? `${ocupados.length} persona(s) estan en ejecucion ahora.` : 'No hay personal trabajando en este momento.'}</span>
                        </div>
                        <input id="trabajadores-search" type="text" class="form-control crew-search-input" placeholder="Buscar trabajador, puesto o habilidad...">
                    </div>
                </div>
            </section>

            <section class="panel">
                <div id="crew-panel-disponible" class="crew-grid" data-crew-container="disponible">
                    ${disponibles.length ? disponibles.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')).map(trabajador => renderCard(trabajador, 'disponible')).join('') : `<div class="empty-state" style="grid-column:1/-1;"><div><strong>Sin personal disponible</strong><p>Todos los trabajadores con check-in estan ejecutando trabajo o aun no hay ingreso registrado.</p></div></div>`}
                </div>
                <div id="crew-panel-ocupado" class="crew-grid" data-crew-container="ocupado" style="display:none;">
                    ${ocupados.length ? ocupados.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')).map(trabajador => renderCard(trabajador, 'ocupado')).join('') : `<div class="empty-state" style="grid-column:1/-1;"><div><strong>Sin personal trabajando</strong><p>Cuando una tarea pase a ejecucion aparecera aqui el equipo en terreno.</p></div></div>`}
                </div>
                <div id="crew-panel-ausente" class="crew-grid" data-crew-container="ausente" style="display:none;">
                    ${ausentes.length ? ausentes.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')).map(trabajador => renderCard(trabajador, 'ausente')).join('') : `<div class="empty-state" style="grid-column:1/-1;"><div><strong>Sin ausencias</strong><p>Todo el personal ya marco check-in hoy.</p></div></div>`}
                </div>
            </section>

            <div id="modal-nuevo-trabajador" class="modal-overlay-base" style="z-index:9600;">
                <div class="modal-shell modal-shell--medium">
                    <div class="modal-head">
                        <div class="modal-title-wrap">
                            <span class="modal-eyebrow"><i class="fa-solid fa-id-badge"></i> Maestro de personal</span>
                            <h2 id="trabajador-modal-title" class="modal-title"><i class="fa-solid fa-user-plus"></i> Agregar trabajador</h2>
                            <p id="trabajador-modal-subtitle" class="modal-subtitle">Crea un perfil operativo con nombre, RUT, cargo y especializaciones para dejarlo disponible en la planificacion.</p>
                        </div>
                        <button id="btn-nuevo-trabajador-cerrar" class="modal-close" type="button" aria-label="Cerrar modal">&times;</button>
                    </div>
                    <form id="form-nuevo-trabajador">
                        <div class="modal-body">
                            <div class="form-group">
                                <label for="nuevo-trabajador-nombre">Nombre completo <span style="color:var(--danger-color)">*</span></label>
                                <input id="nuevo-trabajador-nombre" type="text" class="form-control" placeholder="Ej: Juan Perez Rojas" maxlength="120" autocomplete="off">
                            </div>
                            <div class="form-group">
                                <label for="nuevo-trabajador-rut">RUT <span style="color:var(--danger-color)">*</span></label>
                                <input id="nuevo-trabajador-rut" type="text" class="form-control" placeholder="Ej: 12345678K o 12.345.678-K" maxlength="16" autocomplete="off">
                                <p class="form-helper">Se normaliza automaticamente para el acceso por RUT.</p>
                            </div>
                            <div class="form-group">
                                <label for="nuevo-trabajador-puesto">Cargo <span style="color:var(--danger-color)">*</span></label>
                                <input id="nuevo-trabajador-puesto" type="text" class="form-control" placeholder="Ej: Inspector Predictivo" maxlength="90" autocomplete="off">
                            </div>
                            <div class="form-group">
                                <label for="nuevo-trabajador-pin">Clave de acceso (4 dígitos) <span style="color:var(--danger-color)">*</span></label>
                                <input id="nuevo-trabajador-pin" type="text" inputmode="numeric" pattern="[0-9]*" class="form-control" placeholder="Ej: 0510 (día 05, mes 10)" maxlength="4" autocomplete="off">
                                <p class="form-helper">Formato DDMM (día + mes). Se recomienda usar fecha de nacimiento. El trabajador usará esta clave para ingresar.</p>
                            </div>
                            <div class="form-group">
                                <label>Especializaciones <span style="color:var(--danger-color)">*</span></label>
                                <div class="skill-option-grid">
                                    ${skillOptionHtml}
                                </div>
                                <input id="nuevo-trabajador-habilidades-extra" type="text" class="form-control" placeholder="Especializaciones extra separadas por coma (opcional)" maxlength="200" autocomplete="off">
                            </div>
                            <p id="nuevo-trabajador-error" style="display:none; color:var(--danger-color); font-size:0.84rem; margin:0;"></p>
                        </div>
                        <div class="modal-actions">
                            <button id="btn-nuevo-trabajador-cancelar" class="btn btn-outline" type="button">Cancelar</button>
                            <button id="btn-nuevo-trabajador-guardar" class="btn btn-primary" type="submit">
                                <i class="fa-solid fa-floppy-disk"></i> Guardar trabajador
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    `;

    window._trabTab = function(tab) {
        document.querySelectorAll('[data-crew-tab]').forEach((button) => {
            const active = button.dataset.crewTab === tab;
            button.classList.toggle('is-active', active);
            button.style.background = active
                ? (tab === 'disponible' ? 'var(--success-color)' : tab === 'ocupado' ? 'var(--warning-color)' : '#64748b')
                : '#ffffff';
            button.style.color = active ? '#ffffff' : '#475569';
        });
        document.querySelectorAll('[data-crew-container]').forEach((panel) => {
            panel.style.display = panel.dataset.crewContainer === tab ? 'grid' : 'none';
        });
    };

    document.querySelectorAll('[data-crew-tab]').forEach((button) => {
        button.addEventListener('click', () => window._trabTab(button.dataset.crewTab));
    });

    document.getElementById('trabajadores-search')?.addEventListener('input', (event) => {
        const query = normalizar(event.target.value);
        document.querySelectorAll('[data-crew-container]').forEach((panel) => {
            let visibles = 0;
            panel.querySelectorAll('[data-crew-card]').forEach((card) => {
                const match = !query || (card.dataset.search || '').includes(query);
                card.style.display = match ? '' : 'none';
                if (match) visibles += 1;
            });
            const empty = panel.querySelector('.empty-state');
            if (empty && panel.querySelectorAll('[data-crew-card]').length > 0) {
                empty.style.display = visibles === 0 ? '' : 'none';
            }
            if (!empty && visibles === 0 && panel.querySelectorAll('[data-crew-card]').length > 0) {
                const helperId = `crew-empty-${panel.dataset.crewContainer}`;
                let helper = panel.querySelector(`[data-helper-id="${helperId}"]`);
                if (!helper) {
                    helper = document.createElement('div');
                    helper.dataset.helperId = helperId;
                    helper.className = 'empty-state';
                    helper.style.gridColumn = '1/-1';
                    panel.appendChild(helper);
                }
                helper.innerHTML = '<div><strong>Sin coincidencias</strong><p>Ajusta la busqueda para encontrar el perfil que necesitas.</p></div>';
            } else {
                panel.querySelectorAll('[data-helper-id]').forEach((helper) => helper.remove());
            }
        });
    });

    const modalNuevoTrabajador = document.getElementById('modal-nuevo-trabajador');
    const formNuevoTrabajador = document.getElementById('form-nuevo-trabajador');
    const errorNuevoTrabajador = document.getElementById('nuevo-trabajador-error');
    const btnGuardarNuevoTrabajador = document.getElementById('btn-nuevo-trabajador-guardar');
    const tituloModalTrabajador = document.getElementById('trabajador-modal-title');
    const subtituloModalTrabajador = document.getElementById('trabajador-modal-subtitle');
    let trabajadorEnEdicion = null;
    const mostrarToastTrabajadores = (mensaje, tone = 'success') => {
        const colors = tone === 'danger'
            ? { bg: '#991b1b', shadow: 'rgba(153, 27, 27, 0.28)' }
            : { bg: '#0f766e', shadow: 'rgba(15, 118, 110, 0.28)' };
        const toast = document.createElement('div');
        toast.textContent = mensaje;
        Object.assign(toast.style, {
            position: 'fixed',
            bottom: '1.5rem',
            right: '1.5rem',
            background: colors.bg,
            color: '#fff',
            padding: '0.85rem 1.1rem',
            borderRadius: '12px',
            fontSize: '0.9rem',
            zIndex: '10000',
            boxShadow: `0 12px 30px ${colors.shadow}`,
            maxWidth: '320px',
            lineHeight: '1.4'
        });
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3200);
    };
    const limpiarErrorNuevoTrabajador = () => {
        if (!errorNuevoTrabajador) return;
        errorNuevoTrabajador.style.display = 'none';
        errorNuevoTrabajador.textContent = '';
    };
    const setSeleccionHabilidades = (habilidades = []) => {
        const seleccionadas = new Set(habilidades || []);
        document.querySelectorAll('input[name="nuevo-trabajador-habilidades"]').forEach((input) => {
            input.checked = seleccionadas.has(input.value);
        });
        const inputExtras = document.getElementById('nuevo-trabajador-habilidades-extra');
        if (inputExtras) inputExtras.value = obtenerHabilidadesExtrasExistentes(habilidades).join(', ');
    };
    const abrirModalNuevoTrabajador = (trabajadorEditar = null) => {
        if (!modalNuevoTrabajador || !formNuevoTrabajador) return;
        trabajadorEnEdicion = trabajadorEditar;
        formNuevoTrabajador.reset();
        limpiarErrorNuevoTrabajador();
        setSeleccionHabilidades(trabajadorEditar?.habilidades || []);
        if (trabajadorEditar) {
            document.getElementById('nuevo-trabajador-nombre').value = trabajadorEditar.nombre || '';
            document.getElementById('nuevo-trabajador-rut').value = trabajadorEditar.rut || '';
            document.getElementById('nuevo-trabajador-puesto').value = trabajadorEditar.puesto || '';
            const fechaNacimiento = String(trabajadorEditar.fecha_nacimiento || '');
            const pinActual = /^\d{4}-\d{2}-\d{2}$/.test(fechaNacimiento)
                ? `${fechaNacimiento.slice(8, 10)}${fechaNacimiento.slice(5, 7)}`
                : '';
            document.getElementById('nuevo-trabajador-pin').value = pinActual;
            if (tituloModalTrabajador) tituloModalTrabajador.innerHTML = '<i class="fa-solid fa-pen-to-square"></i> Editar trabajador';
            if (subtituloModalTrabajador) subtituloModalTrabajador.textContent = 'Actualiza nombre, RUT, cargo, clave y especializaciones del trabajador seleccionado.';
            btnGuardarNuevoTrabajador.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Guardar cambios';
        } else {
            if (tituloModalTrabajador) tituloModalTrabajador.innerHTML = '<i class="fa-solid fa-user-plus"></i> Agregar trabajador';
            if (subtituloModalTrabajador) subtituloModalTrabajador.textContent = 'Crea un perfil operativo con nombre, RUT, cargo y especializaciones para dejarlo disponible en la planificacion.';
            btnGuardarNuevoTrabajador.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Guardar trabajador';
        }
        modalNuevoTrabajador.style.display = 'flex';
        setTimeout(() => document.getElementById('nuevo-trabajador-nombre')?.focus(), 60);
    };
    const cerrarModalNuevoTrabajador = () => {
        if (!modalNuevoTrabajador || !formNuevoTrabajador) return;
        trabajadorEnEdicion = null;
        formNuevoTrabajador.reset();
        limpiarErrorNuevoTrabajador();
        setSeleccionHabilidades([]);
        if (tituloModalTrabajador) tituloModalTrabajador.innerHTML = '<i class="fa-solid fa-user-plus"></i> Agregar trabajador';
        if (subtituloModalTrabajador) subtituloModalTrabajador.textContent = 'Crea un perfil operativo con nombre, RUT, cargo y especializaciones para dejarlo disponible en la planificacion.';
        btnGuardarNuevoTrabajador.disabled = false;
        btnGuardarNuevoTrabajador.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Guardar trabajador';
        modalNuevoTrabajador.style.display = 'none';
    };
    const obtenerHabilidadesNuevoTrabajador = () => {
        const seleccionadas = [...document.querySelectorAll('input[name="nuevo-trabajador-habilidades"]:checked')]
            .map((input) => input.value.trim())
            .filter(Boolean);
        const extras = dividirEspecialidades(document.getElementById('nuevo-trabajador-habilidades-extra')?.value || '');
        return [...new Set([...seleccionadas, ...extras])];
    };
    const sincronizarAsignacionesTrabajador = async (trabajadorId, nombreActualizado) => {
        const mapaNombres = new Map(estado.trabajadores.map((item) => [item.id, item.nombre]));
        const tareasAfectadas = estado.tareas.filter((tarea) =>
            tarea.liderId === trabajadorId || (tarea.ayudantesIds || []).includes(trabajadorId)
        );
        if (!tareasAfectadas.length) return;

        estado.tareas = estado.tareas.map((tarea) => {
            if (tarea.liderId !== trabajadorId && !(tarea.ayudantesIds || []).includes(trabajadorId)) return tarea;
            const liderNombre = tarea.liderId
                ? (mapaNombres.get(tarea.liderId) || (tarea.liderId === trabajadorId ? nombreActualizado : tarea.liderNombre || ''))
                : '';
            const ayudantesNombres = (tarea.ayudantesIds || []).map((id) => mapaNombres.get(id) || '').filter(Boolean);
            return { ...tarea, liderNombre, ayudantesNombres };
        });

        await Promise.all(tareasAfectadas.map((tarea) => {
            const actualizada = estado.tareas.find((item) => item.id === tarea.id);
            return _db.update('tareas', tarea.id, {
                lider_nombre: actualizada?.liderNombre || '',
                ayudantes_nombres: actualizada?.ayudantesNombres || []
            });
        }));
    };

    document.getElementById('btn-nuevo-trabajador')?.addEventListener('click', () => abrirModalNuevoTrabajador());
    document.getElementById('btn-nuevo-trabajador-cerrar')?.addEventListener('click', cerrarModalNuevoTrabajador);
    document.getElementById('btn-nuevo-trabajador-cancelar')?.addEventListener('click', cerrarModalNuevoTrabajador);
    modalNuevoTrabajador?.addEventListener('click', (event) => {
        if (event.target === modalNuevoTrabajador) cerrarModalNuevoTrabajador();
    });
    formNuevoTrabajador?.addEventListener('submit', async (event) => {
        event.preventDefault();
        limpiarErrorNuevoTrabajador();

        const nombre = String(document.getElementById('nuevo-trabajador-nombre')?.value || '')
            .trim()
            .replace(/\s+/g, ' ');
        const rut = normalizarRut(document.getElementById('nuevo-trabajador-rut')?.value || '');
        const puesto = String(document.getElementById('nuevo-trabajador-puesto')?.value || '')
            .trim()
            .replace(/\s+/g, ' ');
        const habilidades = obtenerHabilidadesNuevoTrabajador();
        const pinInput = String(document.getElementById('nuevo-trabajador-pin')?.value || '').trim();

        if (nombre.length < 3) {
            errorNuevoTrabajador.textContent = 'Ingresa un nombre valido para el trabajador.';
            errorNuevoTrabajador.style.display = 'block';
            return;
        }
        if (rut.length < 7) {
            errorNuevoTrabajador.textContent = 'Ingresa un RUT valido.';
            errorNuevoTrabajador.style.display = 'block';
            return;
        }
        if (!puesto) {
            errorNuevoTrabajador.textContent = 'Ingresa el cargo del trabajador.';
            errorNuevoTrabajador.style.display = 'block';
            return;
        }
        if (!habilidades.length) {
            errorNuevoTrabajador.textContent = 'Selecciona al menos una especializacion.';
            errorNuevoTrabajador.style.display = 'block';
            return;
        }
        if (!/^\d{4}$/.test(pinInput)) {
            errorNuevoTrabajador.textContent = 'Ingresa una clave de 4 dígitos (formato DDMM).';
            errorNuevoTrabajador.style.display = 'block';
            return;
        }
        const pinDia = parseInt(pinInput.slice(0, 2), 10);
        const pinMes = parseInt(pinInput.slice(2, 4), 10);
        if (pinDia < 1 || pinDia > 31 || pinMes < 1 || pinMes > 12) {
            errorNuevoTrabajador.textContent = 'La clave debe tener formato DDMM (día 01-31, mes 01-12).';
            errorNuevoTrabajador.style.display = 'block';
            return;
        }
        const fechaNacimiento = `2000-${pinInput.slice(2, 4)}-${pinInput.slice(0, 2)}`;
        const rutDuplicado = estado.trabajadores.some((trabajador) =>
            trabajador.id !== trabajadorEnEdicion?.id &&
            normalizarRut(trabajador.rut) === rut
        );
        if (rutDuplicado) {
            errorNuevoTrabajador.textContent = 'Ya existe un trabajador registrado con ese RUT.';
            errorNuevoTrabajador.style.display = 'block';
            return;
        }

        const payloadTrabajador = {
            nombre,
            rut,
            puesto,
            habilidades,
            fecha_nacimiento: fechaNacimiento
        };

        const textoOriginal = btnGuardarNuevoTrabajador.innerHTML;
        btnGuardarNuevoTrabajador.disabled = true;
        btnGuardarNuevoTrabajador.innerHTML = trabajadorEnEdicion
            ? '<i class="fa-solid fa-spinner fa-spin"></i> Guardando cambios...'
            : '<i class="fa-solid fa-spinner fa-spin"></i> Guardando...';

        try {
            if (trabajadorEnEdicion) {
                await _db.update('trabajadores', trabajadorEnEdicion.id, payloadTrabajador);
                const guardado = { ...trabajadorEnEdicion, ...payloadTrabajador };
                estado.trabajadores = estado.trabajadores.map((trabajador) =>
                    trabajador.id === trabajadorEnEdicion.id ? guardado : trabajador
                );
                await sincronizarAsignacionesTrabajador(trabajadorEnEdicion.id, guardado.nombre);
                cerrarModalNuevoTrabajador();
                renderizarVistaActual();
                mostrarToastTrabajadores(`${guardado.nombre} fue actualizado correctamente.`);
                return;
            }

            const nuevoTrabajador = {
                id: crypto.randomUUID(),
                ...payloadTrabajador,
                disponible: false,
                ocupado: false,
                puede_aprobar_insumos: false
            };
            const { data, error } = await _db.insert('trabajadores', nuevoTrabajador);
            if (error) throw error;

            const guardado = {
                ...nuevoTrabajador,
                ...(data || {}),
                rut,
                puesto,
                habilidades
            };
            estado.trabajadores = [
                ...estado.trabajadores.filter((trabajador) => trabajador.id !== guardado.id),
                guardado
            ];

            cerrarModalNuevoTrabajador();
            renderizarVistaActual();
            mostrarToastTrabajadores(`${guardado.nombre} fue agregado al equipo.`);
        } catch (error) {
            errorNuevoTrabajador.textContent = error?.message || 'No se pudo guardar el trabajador.';
            errorNuevoTrabajador.style.display = 'block';
            btnGuardarNuevoTrabajador.disabled = false;
            btnGuardarNuevoTrabajador.innerHTML = textoOriginal;
        }
    });

    const eliminarTrabajador = async (trabajadorId) => {
        const trabajador = estado.trabajadores.find((item) => item.id === trabajadorId);
        if (!trabajador) return;
        const tareasAsignadas = estado.tareas.filter((tarea) =>
            tarea.liderId === trabajadorId || (tarea.ayudantesIds || []).includes(trabajadorId)
        );
        if (tareasAsignadas.length > 0) {
            mostrarToastTrabajadores(`No puedes eliminar a ${trabajador.nombre} mientras tenga tareas activas o semanales asignadas.`, 'danger');
            return;
        }
        if (!confirm(`Eliminar a ${trabajador.nombre} del maestro de personal?`)) return;
        try {
            await _db.delete('trabajadores', trabajadorId);
            estado.trabajadores = estado.trabajadores.filter((item) => item.id !== trabajadorId);
            if (trabajadorEnEdicion?.id === trabajadorId) cerrarModalNuevoTrabajador();
            renderizarVistaActual();
            mostrarToastTrabajadores(`${trabajador.nombre} fue eliminado del equipo.`);
        } catch (error) {
            mostrarToastTrabajadores(error?.message || 'No se pudo eliminar el trabajador.', 'danger');
        }
    };

    document.querySelectorAll('[data-worker-edit]').forEach((button) => {
        button.addEventListener('click', () => {
            const trabajador = estado.trabajadores.find((item) => item.id === button.dataset.workerEdit);
            if (trabajador) abrirModalNuevoTrabajador(trabajador);
        });
    });
    document.querySelectorAll('[data-worker-delete]').forEach((button) => {
        button.addEventListener('click', () => eliminarTrabajador(button.dataset.workerDelete));
    });
}

async function renderMisHorasView() {
    const trabajador = estado.trabajadorLogueado;
    if (!trabajador) return;

    mainContent.innerHTML = `<div class="fade-in overtime-view" style="max-width:980px; margin:0 auto;"><div class="panel" style="text-align:center; padding:2rem;"><p style="color:var(--text-muted);">Cargando horas extra...</p></div></div>`;

    const registros = await cargarHorasExtraTrabajador(trabajador.id);
    const hoy = new Date();
    const mesActual = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
    const formatHoras = (valor) => new Intl.NumberFormat('es-CL', { minimumFractionDigits: 0, maximumFractionDigits: 1 }).format(Number(valor || 0));
    const formatFecha = (valor) => valor
        ? new Date(`${valor}T12:00:00`).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' })
        : '--';

    const totalMesAprobado = registros
        .filter(r => r.estado === 'aprobado' && (r.fecha || '').startsWith(mesActual))
        .reduce((acum, r) => acum + (parseFloat(r.horas) || 0), 0);
    const totalHistorico = registros
        .filter(r => r.estado === 'aprobado')
        .reduce((acum, r) => acum + (parseFloat(r.horas) || 0), 0);
    const pendientes = registros.filter(r => (r.estado || 'pendiente') === 'pendiente').length;
    const rechazadas = registros.filter(r => r.estado === 'rechazado').length;

    window._eliminarHoraExtra = async (id) => {
        if (!confirm('Eliminar este registro de horas extra?')) return;
        try {
            await eliminarRegistrosHorasExtra([id]);
            vistaActual = 'mis_horas';
            renderizarVistaActual();
        } catch (error) {
            alert(error?.message || 'No se pudo eliminar el registro.');
        }
    };

    mainContent.innerHTML = `
        <div class="fade-in overtime-view" style="max-width:980px; margin:0 auto;">
            <section class="panel overtime-hero">
                <div class="dashboard-hero-head">
                    <div>
                        <div class="overtime-eyebrow">Seguimiento personal</div>
                        <h1 style="margin:0 0 0.4rem 0;"><i class="fa-regular fa-clock"></i> Mis Horas Extra</h1>
                        <p class="overtime-subtitle">Consulta tu historico, el estado de aprobacion y registra nuevas horas extra cuando corresponda.</p>
                    </div>
                    <div class="dashboard-hero-badges">
                        <span class="dashboard-hero-badge"><i class="fa-solid fa-hourglass-half"></i> ${pendientes} pendientes</span>
                        <span class="dashboard-hero-badge"><i class="fa-solid fa-circle-check"></i> ${formatHoras(totalHistorico)} hrs aprobadas</span>
                    </div>
                </div>

                <div class="overtime-kpi-grid">
                    <article class="overtime-kpi-card">
                        <span class="overtime-kpi-label"><i class="fa-solid fa-calendar-days"></i> Mes actual</span>
                        <div class="overtime-kpi-value">${formatHoras(totalMesAprobado)} hrs</div>
                        <div class="overtime-kpi-meta">Aprobadas</div>
                    </article>
                    <article class="overtime-kpi-card">
                        <span class="overtime-kpi-label"><i class="fa-solid fa-chart-line"></i> Historico</span>
                        <div class="overtime-kpi-value">${formatHoras(totalHistorico)} hrs</div>
                        <div class="overtime-kpi-meta">Acumuladas</div>
                    </article>
                    <article class="overtime-kpi-card">
                        <span class="overtime-kpi-label"><i class="fa-solid fa-hourglass-half"></i> Pendientes</span>
                        <div class="overtime-kpi-value">${pendientes}</div>
                        <div class="overtime-kpi-meta">En revision</div>
                    </article>
                    <article class="overtime-kpi-card">
                        <span class="overtime-kpi-label"><i class="fa-solid fa-circle-xmark"></i> Rechazadas</span>
                        <div class="overtime-kpi-value">${rechazadas}</div>
                        <div class="overtime-kpi-meta">Con observacion</div>
                    </article>
                </div>

                <div class="overtime-toolbar">
                    <div class="overtime-toolbar-note">
                        <i class="fa-solid fa-circle-info"></i>
                        <span>${registros.length ? `${registros.length} registro(s) en tu historial personal.` : 'Aun no tienes horas extra registradas.'}</span>
                    </div>
                    <div style="display:flex; gap:0.65rem; flex-wrap:wrap;">
                        <button type="button" class="btn btn-outline" onclick="window.mostrarCalendarioHorasExtra('${trabajador.id}')">
                            <i class="fa-regular fa-calendar"></i> Calendario
                        </button>
                        <button type="button" class="btn btn-primary" onclick="window.abrirModalHorasExtraManual('${trabajador.id}')">
                            <i class="fa-solid fa-plus"></i> Agregar horas extra
                        </button>
                    </div>
                </div>
            </section>

            <section class="panel">
                ${registros.length === 0 ? `
                    <div class="empty-state">
                        <div>
                            <strong>Sin horas extra registradas</strong>
                            <p>Cuando registres horas extra apareceran aqui con su fecha, motivo y estado de revision.</p>
                        </div>
                    </div>
                ` : `
                    <div class="table-shell">
                        <table class="table-clean table-clean--stacked" style="width:100%;">
                            <thead>
                                <tr>
                                    <th>Fecha</th>
                                    <th>Horas</th>
                                    <th>Motivo</th>
                                    <th>Estado</th>
                                    <th>Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${registros.map((registro) => `
                                    <tr style="${registro.estado === 'rechazado' ? 'opacity:0.72;' : ''}">
                                        <td data-label="Fecha">
                                            <div style="font-weight:700; color:#0f172a;">${formatFecha(registro.fecha)}</div>
                                            <div class="overtime-note">${registro.created_at ? new Date(registro.created_at).toLocaleDateString('es-CL') : 'Sin fecha de carga'}</div>
                                        </td>
                                        <td data-label="Horas"><div style="font-weight:800; color:var(--primary-color);">${formatHoras(registro.horas)} hrs</div></td>
                                        <td data-label="Motivo" style="max-width:280px;"><div style="color:#475569; font-size:0.83rem; line-height:1.55;">${registro.motivo || 'Sin motivo registrado.'}</div></td>
                                        <td data-label="Estado">
                                            ${registro.estado === 'aprobado'
                                                ? `<span class="overtime-status approved"><i class="fa-solid fa-circle-check"></i> Aprobado</span>`
                                                : registro.estado === 'rechazado'
                                                ? `<span class="overtime-status rejected"><i class="fa-solid fa-circle-xmark"></i> Rechazado</span>${registro.motivo_rechazo ? `<div class="overtime-note" style="margin-top:0.35rem; color:#dc2626;">${registro.motivo_rechazo}</div>` : ''}`
                                                : `<span class="overtime-status pending"><i class="fa-solid fa-hourglass-half"></i> Pendiente</span>`}
                                        </td>
                                        <td data-label="Acciones">
                                            <button type="button" class="btn btn-outline btn-icon" title="Eliminar" onclick="window._eliminarHoraExtra('${registro.id}')" style="border-color:#fecaca;color:#dc2626;background:#fff5f5;">
                                                <i class="fa-solid fa-trash"></i>
                                            </button>
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                `}
            </section>
        </div>
    `;
}

function renderPerfilView() {
    const trabajador = estado.trabajadorLogueado;

    if (!trabajador) {
        const todos = estado.trabajadores || [];
        const renderAdminPerfil = (wId) => {
            const seleccionado = wId ? todos.find(t => t.id === wId) : null;

            mainContent.innerHTML = `
                <div class="fade-in profile-layout" style="max-width:980px; margin:0 auto;">
                    <section class="panel crew-hero">
                        <div class="dashboard-hero-head">
                            <div>
                                <div class="crew-eyebrow">Perfil operativo</div>
                                <h1 style="margin:0 0 0.4rem 0;"><i class="fa-solid fa-id-badge"></i> Mi Perfil</h1>
                                <p class="crew-subtitle">Consulta la carga de cada trabajador y su estado operativo del dia sin exponer datos sensibles.</p>
                            </div>
                        </div>
                        <div class="profile-header" style="margin-top:1rem;">
                            <label style="font-weight:700; color:#475569;">Ver perfil de</label>
                            <select id="select-perfil-admin" class="form-control profile-select">
                                <option value="">-- Selecciona un trabajador --</option>
                                ${todos.map(t => `<option value="${t.id}" ${t.id === wId ? 'selected' : ''}>${t.nombre} - ${t.puesto}</option>`).join('')}
                            </select>
                        </div>
                    </section>

                    ${renderNotificacionesPerfilHtml()}

                    ${seleccionado ? `
                        <section class="panel">
                            <div class="profile-header">
                                <div class="profile-header-main">
                                    <div class="profile-avatar">${seleccionado.nombre.charAt(0).toUpperCase()}</div>
                                    <div>
                                        <h2 style="margin:0;">${seleccionado.nombre}</h2>
                                        <div class="profile-role">${seleccionado.puesto}</div>
                                        <div class="crew-card-actions" style="margin-top:0.5rem;">
                                            <span class="crew-chip"><i class="fa-solid fa-circle-check"></i> ${seleccionado.disponible ? 'Con check-in' : 'Sin check-in'}</span>
                                            <span class="crew-chip"><i class="fa-solid fa-screwdriver-wrench"></i> ${(seleccionado.habilidades || []).length} habilidad(es)</span>
                                        </div>
                                    </div>
                                </div>
                                <button id="btn-marcar-salida-admin" class="btn btn-outline" style="border-color:#fecaca;color:#dc2626;background:#fff5f5;">
                                    <i class="fa-solid fa-door-open"></i> Marcar salida
                                </button>
                            </div>
                            <div class="crew-skills" style="margin-top:1rem;">
                                ${(seleccionado.habilidades || []).length
                                    ? (seleccionado.habilidades || []).map(h => `<span class="crew-skill">${h}</span>`).join('')
                                    : '<span class="crew-chip">Sin habilidades cargadas</span>'}
                            </div>
                        </section>

                        <section class="panel">
                            <div class="empty-state empty-state--compact">
                                <div>
                                    <strong>Carga operativa visible en Inicio</strong>
                                    <p>Los bloques de trabajos de hoy y de la semana se muestran en la pantalla principal para no repetir informacion dentro del perfil.</p>
                                </div>
                            </div>
                        </section>
                    ` : `
                        <section class="panel">
                            <div class="empty-state">
                                <div>
                                    <strong>Selecciona un trabajador</strong>
                                    <p>Elige una persona para ver su perfil, habilidades y carga operativa.</p>
                                </div>
                            </div>
                        </section>
                    `}
                </div>
            `;

            document.getElementById('select-perfil-admin')?.addEventListener('change', (event) => {
                renderAdminPerfil(event.target.value || null);
            });
            conectarBotonesNotificacionesPerfil();

            if (seleccionado) {
                document.getElementById('btn-marcar-salida-admin')?.addEventListener('click', async () => {
                    await updateTrabajadorDisponibilidad(seleccionado.id, false);
                    estado.trabajadores = estado.trabajadores.map(t => t.id === seleccionado.id ? { ...t, disponible: false } : t);
                    renderAdminPerfil(null);
                });
            }
        };

        renderAdminPerfil(null);
        return;
    }

    mainContent.innerHTML = `
        <div class="fade-in profile-layout" style="max-width:980px; margin:0 auto;">
            <section class="panel crew-hero">
                <div class="dashboard-hero-head">
                    <div>
                        <div class="crew-eyebrow">Perfil operativo</div>
                        <h1 style="margin:0 0 0.4rem 0;"><i class="fa-solid fa-id-badge"></i> Mi Perfil</h1>
                        <p class="crew-subtitle">Tu resumen de jornada, habilidades y carga actual de trabajo dentro de Planify.</p>
                    </div>
                </div>

                <div class="profile-header" style="margin-top:1rem;">
                    <div class="profile-header-main">
                        <div class="profile-avatar">${trabajador.nombre.charAt(0).toUpperCase()}</div>
                        <div>
                            <h2 style="margin:0;">${trabajador.nombre}</h2>
                            <div class="profile-role">${trabajador.puesto}</div>
                            <div class="crew-card-actions" style="margin-top:0.5rem;">
                                <span class="crew-chip"><i class="fa-solid fa-circle-check"></i> ${trabajador.disponible ? 'Con check-in' : 'Sin check-in'}</span>
                                <span class="crew-chip"><i class="fa-solid fa-screwdriver-wrench"></i> ${(trabajador.habilidades || []).length} habilidad(es)</span>
                            </div>
                        </div>
                    </div>
                    <div class="profile-actions">
                        <button type="button" class="btn btn-outline" onclick="vistaActual='mis_horas'; renderizarVistaActual();">
                            <i class="fa-regular fa-clock"></i> Mis horas extra
                        </button>
                        <button type="button" class="btn btn-outline" style="border-color:#fecaca;color:#dc2626;background:#fff5f5;" onclick="window.marcarSalidaTrabajador('${trabajador.id}')">
                            <i class="fa-solid fa-door-open"></i> Marcar salida
                        </button>
                    </div>
                </div>
            </section>

            ${renderNotificacionesPerfilHtml()}

            <section class="panel">
                <div class="crew-skills">
                    ${(trabajador.habilidades || []).length
                        ? (trabajador.habilidades || []).map(h => `<span class="crew-skill">${h}</span>`).join('')
                        : '<span class="crew-chip">Sin habilidades cargadas</span>'}
                </div>
            </section>

            <section class="panel">
                <div class="empty-state empty-state--compact">
                    <div>
                        <strong>La carga operativa se revisa desde Inicio</strong>
                        <p>Quitamos de tu perfil los paneles de trabajos de hoy y de la semana para evitar duplicar la misma informacion.</p>
                    </div>
                </div>
            </section>
        </div>
    `;
    conectarBotonesNotificacionesPerfil();
}

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
        if (t.ayudantes_nombres?.length) datosCrudos += `  Técnicos: ${t.ayudantes_nombres.join(', ')}\n`;
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
Lista cada trabajo con horario, supervisor, técnicos asignados y HH consumidas. Luego resumen consolidado: total de trabajos, total HH, avisos SAP, personal participante.

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
                if (t.ayudantes_nombres?.length) xml += p(`Técnicos: ${t.ayudantes_nombres.join(', ')}`, { indent: true });
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

function injectPlanifyEnhancementStyles() {
    if (document.getElementById('planify-enhancement-styles')) return;
    const style = document.createElement('style');
    style.id = 'planify-enhancement-styles';
    style.textContent = `
.planify-ficha-overlay{backdrop-filter:blur(3px)}
.planify-ficha-panel{max-width:1280px;width:min(1280px,97vw);display:flex;flex-direction:column;padding:0;border-radius:24px;overflow:hidden;background:#fff;box-shadow:0 30px 70px rgba(15,23,42,.22)}
.planify-ficha-header{padding:1.35rem 1.5rem 1.2rem;background:linear-gradient(135deg,#fffaf5 0%,#ffffff 45%,#eff6ff 100%);border-bottom:1px solid #e5e7eb}
.planify-ficha-breadcrumb{display:flex;align-items:center;flex-wrap:wrap;gap:.45rem;font-size:.78rem;color:#64748b;margin-bottom:.8rem}
.planify-ficha-breadcrumb strong{color:#0f172a}
.planify-ficha-title-row{display:flex;justify-content:space-between;align-items:flex-start;gap:1rem}
.planify-ficha-title-wrap{min-width:0;flex:1}
.planify-ficha-title{margin:0;font-size:1.85rem;line-height:1.08;letter-spacing:-.04em;color:#0f172a;overflow-wrap:anywhere}
.planify-ficha-meta{display:flex;gap:.7rem 1rem;flex-wrap:wrap;margin-top:.6rem;font-size:.87rem;color:#475569}
.planify-ficha-meta span{display:inline-flex;align-items:center;gap:.38rem}
.planify-ficha-actions{display:flex;justify-content:flex-end;gap:.55rem;flex-wrap:wrap}
.planify-ficha-action-btn{padding:.62rem .95rem;border-radius:999px;font-size:.82rem;border:1px solid #e5e7eb;background:#fff;color:#334155;box-shadow:0 8px 18px rgba(15,23,42,.05)}
.planify-ficha-action-btn:hover{background:#fff7ed;border-color:#fed7aa;color:#9a3412}
.planify-ficha-overview{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.85rem;margin-top:1rem}
.planify-ficha-stat{background:rgba(255,255,255,.92);border:1px solid rgba(226,232,240,.94);border-radius:18px;padding:.95rem 1rem;box-shadow:0 10px 26px rgba(15,23,42,.05);display:flex;flex-direction:column;gap:.3rem;min-height:142px}
.planify-ficha-stat.is-normal{background:linear-gradient(135deg,rgba(236,253,245,.9),#fff);border-color:rgba(16,185,129,.22)}
.planify-ficha-stat.is-watch{background:linear-gradient(135deg,rgba(255,247,237,.94),#fff);border-color:rgba(245,158,11,.25)}
.planify-ficha-stat.is-critical{background:linear-gradient(135deg,rgba(254,242,242,.95),#fff);border-color:rgba(239,68,68,.24)}
.planify-ficha-stat-label{display:flex;align-items:center;gap:.45rem;font-size:.74rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#64748b;margin-bottom:.45rem}
.planify-ficha-stat-value{font-size:1.45rem;font-weight:900;line-height:1.1;letter-spacing:-.03em;color:#0f172a;overflow-wrap:anywhere}
.planify-ficha-stat-meta{font-size:.8rem;line-height:1.45;color:#475569;margin-top:.35rem}
.planify-ficha-tabs{display:flex;gap:.4rem;flex-wrap:wrap;padding:.8rem 1.2rem;background:#fff;border-bottom:1px solid #e5e7eb}
.planify-ficha-tab-btn{padding:.78rem 1rem;border:none;background:transparent;color:#64748b;font-weight:700;border-radius:12px;cursor:pointer;transition:all .18s ease}
.planify-ficha-tab-btn:hover{background:#f8fafc;color:#0f172a}
.planify-ficha-tab-btn.active{background:#fff7ed;color:#9a3412;box-shadow:inset 0 0 0 1px #fed7aa}
.planify-ficha-body{flex:0 0 auto;overflow:visible;padding:1.2rem;background:#f8fafc}
.planify-ficha-grid{display:grid;grid-template-columns:minmax(0,2.2fr) minmax(280px,.78fr);gap:1rem}
.planify-ficha-stack{display:grid;gap:1rem}
.planify-ficha-card{background:#fff;border:1px solid #e5e7eb;border-radius:18px;padding:1rem;box-shadow:0 12px 28px rgba(15,23,42,.04)}
.planify-ficha-card-head{display:flex;justify-content:space-between;align-items:flex-start;gap:.8rem;margin-bottom:.85rem}
.planify-ficha-card-head h3{margin:0;font-size:1rem;font-weight:800;color:#0f172a}
.planify-ficha-card-head span{font-size:.8rem;color:#64748b;line-height:1.45}
.planify-ficha-subgrid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.75rem;margin-bottom:.9rem}
.planify-ficha-mini{padding:.82rem .85rem;border-radius:16px;background:#f8fafc;border:1px solid #e2e8f0}
.planify-ficha-mini.is-normal{background:linear-gradient(135deg,rgba(236,253,245,.88),#fff);border-color:rgba(16,185,129,.18)}
.planify-ficha-mini.is-watch{background:linear-gradient(135deg,rgba(255,247,237,.92),#fff);border-color:rgba(245,158,11,.2)}
.planify-ficha-mini.is-critical{background:linear-gradient(135deg,rgba(254,242,242,.95),#fff);border-color:rgba(239,68,68,.2)}
.planify-ficha-mini-label{font-size:.72rem;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:#64748b;margin-bottom:.28rem}
.planify-ficha-mini-value{font-size:1.08rem;font-weight:800;color:#0f172a;line-height:1.15}
.planify-ficha-mini-meta{font-size:.77rem;color:#64748b;margin-top:.28rem;line-height:1.4}
.planify-ficha-chart{height:400px}
.planify-ficha-reading-list,.planify-ficha-activity-list,.planify-ficha-related-list{display:grid;gap:.75rem}
.planify-ficha-reading{display:grid;gap:.45rem;padding:.88rem .95rem;border-radius:16px;background:#f8fafc;border:1px solid #e2e8f0}
.planify-ficha-reading.is-normal{background:linear-gradient(135deg,rgba(236,253,245,.88),#fff);border-color:rgba(16,185,129,.2)}
.planify-ficha-reading.is-watch{background:linear-gradient(135deg,rgba(255,247,237,.92),#fff);border-color:rgba(245,158,11,.22)}
.planify-ficha-reading.is-critical{background:linear-gradient(135deg,rgba(254,242,242,.95),#fff);border-color:rgba(239,68,68,.22)}
.planify-ficha-reading-top{display:flex;justify-content:space-between;gap:.8rem;align-items:flex-start}
.planify-ficha-reading-title{font-size:.95rem;font-weight:800;color:#0f172a}
.planify-ficha-reading-value{font-size:1rem;font-weight:900;text-align:right;white-space:nowrap}
.planify-ficha-reading-value.is-vib{color:#ea580c}
.planify-ficha-reading-value.is-temp{color:#0f766e}
.planify-ficha-reading-meta{display:flex;gap:.35rem .65rem;flex-wrap:wrap;font-size:.78rem;color:#64748b}
.planify-ficha-reading-note{font-size:.8rem;color:#475569;line-height:1.45}
.planify-status-badge{display:inline-flex;align-items:center;gap:.35rem;padding:.3rem .58rem;border-radius:999px;font-size:.72rem;font-weight:800;border:1px solid transparent}
.planify-status-badge.is-normal{background:#ecfdf5;color:#047857;border-color:#a7f3d0}
.planify-status-badge.is-watch{background:#fff7ed;color:#b45309;border-color:#fdba74}
.planify-status-badge.is-critical{background:#fef2f2;color:#b91c1c;border-color:#fca5a5}
.planify-ficha-empty{display:grid;place-items:center;text-align:center;min-height:140px;padding:1.1rem;color:#64748b;background:linear-gradient(135deg,#ffffff,#f8fafc);border:1px dashed #cbd5e1;border-radius:16px}
.planify-ficha-loading{min-height:220px}
.planify-ficha-activity{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(280px,.8fr);gap:1rem}
.planify-ficha-task{padding:.9rem .95rem;border-radius:16px;background:#fff;border:1px solid #e2e8f0;display:grid;gap:.4rem}
.planify-ficha-task-top{display:flex;justify-content:space-between;gap:.75rem;align-items:flex-start}
.planify-ficha-task-title{font-size:.93rem;font-weight:800;color:#0f172a}
.planify-ficha-task-meta{display:flex;gap:.4rem .7rem;flex-wrap:wrap;font-size:.78rem;color:#64748b}
.planify-ficha-link{background:none;border:none;padding:0;color:#ea580c;font:inherit;font-weight:800;cursor:pointer;text-align:left}
.planify-ficha-link:hover{text-decoration:underline}
.planify-ficha-related{display:flex;justify-content:space-between;gap:.7rem;align-items:flex-start;padding:.82rem .88rem;border-radius:16px;background:#fff;border:1px solid #e2e8f0}
.planify-ficha-related-main{min-width:0;flex:1}
.planify-ficha-related-main strong{display:block;color:#0f172a;font-size:.9rem}
.planify-ficha-related-main span{display:block;font-size:.78rem;color:#64748b;line-height:1.45}
.planify-ficha-chip{display:inline-flex;align-items:center;gap:.35rem;padding:.28rem .52rem;border-radius:999px;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;font-size:.72rem;font-weight:800}
.planify-ficha-inline-actions{display:flex;gap:.5rem;flex-wrap:wrap}
.planify-ficha-source{display:inline-flex;align-items:center;gap:.35rem;padding:.32rem .56rem;border-radius:999px;background:#eef2ff;border:1px solid #c7d2fe;color:#3730a3;font-size:.72rem;font-weight:800}
@media (max-width: 980px){.planify-ficha-overview{grid-template-columns:repeat(2,minmax(0,1fr))}.planify-ficha-grid,.planify-ficha-activity{grid-template-columns:1fr}.planify-ficha-subgrid{grid-template-columns:1fr 1fr}.planify-ficha-title-row{flex-direction:column}.planify-ficha-actions{justify-content:flex-start}}
@media (max-width: 720px){.planify-ficha-panel{width:100vw;border-radius:0}.planify-ficha-body{padding:1rem}.planify-ficha-header{padding:1.1rem 1rem}.planify-ficha-tabs{padding:.7rem .8rem}.planify-ficha-overview,.planify-ficha-subgrid{grid-template-columns:1fr}.planify-ficha-meta,.planify-ficha-actions{gap:.55rem}.planify-ficha-chart{height:280px}}
`;
    document.head.appendChild(style);
}

function normalizarFechaFicha(value) {
    const date = value instanceof Date ? value : new Date(value);
    return date && !Number.isNaN(date.getTime()) ? date : null;
}

function formatearFechaFicha(value) {
    const date = normalizarFechaFicha(value);
    return date ? date.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'Sin fecha';
}

function formatearFechaHoraFicha(value) {
    const date = normalizarFechaFicha(value);
    return date ? date.toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Sin fecha';
}

function numeroFicha(value, decimals = 0) {
    return Number(value || 0).toLocaleString('es-CL', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    });
}

function getEstadoCondicionFicha(tipo, valor) {
    const number = Number(valor || 0);
    if (tipo === 'vibracion') {
        if (number >= 4.5) return { label: 'Crítico', className: 'is-critical', tone: 'is-critical', color: '#dc2626' };
        if (number >= 3.2) return { label: 'Seguimiento', className: 'is-watch', tone: 'is-watch', color: '#d97706' };
        return { label: 'Controlado', className: 'is-normal', tone: 'is-normal', color: '#059669' };
    }
    if (number >= 80) return { label: 'Crítico', className: 'is-critical', tone: 'is-critical', color: '#dc2626' };
    if (number >= 65) return { label: 'Seguimiento', className: 'is-watch', tone: 'is-watch', color: '#d97706' };
    return { label: 'Controlado', className: 'is-normal', tone: 'is-normal', color: '#059669' };
}

function resumirTendenciaFicha(registros, tipo) {
    const sorted = [...registros].sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
    if (sorted.length < 2) {
        return { label: sorted.length ? 'Primera lectura' : 'Sin tendencia', meta: 'Aún no hay comparación.', className: 'is-normal', icon: 'fa-wave-square' };
    }
    const last = Number(sorted[sorted.length - 1].valor || 0);
    const prev = Number(sorted[sorted.length - 2].valor || 0);
    const diff = last - prev;
    const threshold = tipo === 'vibracion' ? 0.05 : 0.5;
    if (Math.abs(diff) <= threshold) {
        return { label: 'Estable', meta: 'Sin cambio relevante frente a la lectura anterior.', className: 'is-normal', icon: 'fa-minus' };
    }
    if (diff > 0) {
        return {
            label: 'Al alza',
            meta: `Sube ${numeroFicha(Math.abs(diff), tipo === 'vibracion' ? 2 : 1)} ${tipo === 'vibracion' ? 'mm/s' : '°C'} vs. la lectura anterior.`,
            className: 'is-watch',
            icon: 'fa-arrow-trend-up'
        };
    }
    return {
        label: 'A la baja',
        meta: `Baja ${numeroFicha(Math.abs(diff), tipo === 'vibracion' ? 2 : 1)} ${tipo === 'vibracion' ? 'mm/s' : '°C'} vs. la lectura anterior.`,
        className: 'is-normal',
        icon: 'fa-arrow-trend-down'
    };
}

function obtenerResumenMedicionesFicha(registros, tipo) {
    const items = [...registros]
        .filter(item => item.tipo === tipo)
        .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
    if (!items.length) {
        return {
            count: 0,
            avg: 0,
            max: 0,
            latest: null,
            status: { label: 'Sin datos', className: 'is-normal', tone: '', color: '#64748b' },
            trend: { label: 'Sin tendencia', meta: 'No hay registros todavía.', className: 'is-normal', icon: 'fa-minus' }
        };
    }
    const latest = items[items.length - 1];
    const avg = items.reduce((sum, item) => sum + Number(item.valor || 0), 0) / items.length;
    const max = Math.max(...items.map(item => Number(item.valor || 0)));
    return {
        count: items.length,
        avg,
        max,
        latest,
        status: getEstadoCondicionFicha(tipo, latest.valor),
        trend: resumirTendenciaFicha(items, tipo)
    };
}

function consolidarEstadoFicha(estados) {
    if (estados.some(item => item?.className === 'is-critical')) return { label: 'Crítico', className: 'is-critical', tone: 'is-critical' };
    if (estados.some(item => item?.className === 'is-watch')) return { label: 'Seguimiento', className: 'is-watch', tone: 'is-watch' };
    return { label: 'Controlado', className: 'is-normal', tone: 'is-normal' };
}

function getThresholdConfigFicha(tipo) {
    if (tipo === 'vibracion') return { watch: 3.2, critical: 4.5, decimals: 2, unit: 'mm/s' };
    return { watch: 65, critical: 80, decimals: 1, unit: 'C' };
}

function priorizarToneFicha(...tones) {
    if (tones.includes('is-critical')) return 'is-critical';
    if (tones.includes('is-watch')) return 'is-watch';
    if (tones.includes('is-normal')) return 'is-normal';
    return '';
}

function getBrechaUmbralFicha(tipo, summary) {
    if (!summary?.latest) {
        return { value: 'Sin dato', meta: 'No hay lectura vigente para comparar.', tone: '' };
    }
    const cfg = getThresholdConfigFicha(tipo);
    const latestValue = Number(summary.latest.valor || 0);
    if (latestValue >= cfg.critical) {
        return {
            value: `+${numeroFicha(latestValue - cfg.critical, cfg.decimals)} ${cfg.unit}`,
            meta: `Sobre atencion (${numeroFicha(cfg.critical, cfg.decimals)} ${cfg.unit})`,
            tone: 'is-critical'
        };
    }
    if (latestValue >= cfg.watch) {
        return {
            value: `+${numeroFicha(latestValue - cfg.watch, cfg.decimals)} ${cfg.unit}`,
            meta: `Sobre seguimiento (${numeroFicha(cfg.watch, cfg.decimals)} ${cfg.unit})`,
            tone: 'is-watch'
        };
    }
    return {
        value: `${numeroFicha(cfg.watch - latestValue, cfg.decimals)} ${cfg.unit}`,
        meta: 'Margen hasta seguimiento',
        tone: 'is-normal'
    };
}

function getPulsoActivoFicha(equipo, summaries, tareasRelacionadas) {
    const latestDates = [
        summaries?.vibracion?.latest?.fecha,
        summaries?.termografia?.latest?.fecha,
        tareasRelacionadas?.[0]?.created_at,
        tareasRelacionadas?.[0]?.fecha_termino,
        tareasRelacionadas?.[0]?.fecha_inicio
    ]
        .filter(Boolean)
        .map(value => new Date(value))
        .filter(date => !Number.isNaN(date.getTime()))
        .sort((a, b) => b - a);

    if (!latestDates.length) {
        return {
            value: 'Sin actividad',
            meta: 'No hay mediciones ni cierres recientes asociados a este activo.',
            tone: ''
        };
    }

    const lastDate = latestDates[0];
    const diffDays = Math.max(0, Math.floor((Date.now() - lastDate.getTime()) / 86400000));
    const cycleDays = Number(equipo.frecuencia_nueva || 30);
    const totalMeasures = (summaries?.vibracion?.count || 0) + (summaries?.termografia?.count || 0);
    let value = 'Al dia';
    let tone = 'is-normal';

    if (diffDays > cycleDays * 1.5) {
        value = 'Atrasado';
        tone = 'is-critical';
    } else if (diffDays > cycleDays) {
        value = 'Revisar';
        tone = 'is-watch';
    }

    return {
        value,
        meta: `Ultimo movimiento hace ${numeroFicha(diffDays)} dia(s) / ${numeroFicha(totalMeasures)} medicion(es) y ${numeroFicha(tareasRelacionadas.length)} cierre(s).`,
        tone
    };
}

function getComparativaGrupoFicha(equipo, siblingEquipos, medicionesGrupo, tipo) {
    const cfg = getThresholdConfigFicha(tipo);
    const tolerance = tipo === 'vibracion' ? 0.05 : 0.5;
    const latestByComponent = siblingEquipos.map(item => {
        const latest = medicionesGrupo
            .filter(med => String(med.equipo_id) === String(item.id) && med.tipo === tipo)
            .sort((a, b) => new Date(b.fecha) - new Date(a.fecha))[0];
        return latest ? { id: item.id, value: Number(latest.valor || 0), component: item.componente || item.activo } : null;
    }).filter(Boolean);

    const current = latestByComponent.find(item => String(item.id) === String(equipo.id));
    const peers = latestByComponent.filter(item => String(item.id) !== String(equipo.id));

    if (!current) {
        return { value: 'Sin dato', meta: 'No hay lectura vigente para comparar contra componentes hermanos.', tone: '' };
    }
    if (!peers.length) {
        return {
            value: `${numeroFicha(latestByComponent.length)}`,
            meta: latestByComponent.length > 1 ? 'Aun no hay suficientes lecturas hermanas para comparar.' : 'Solo existe este componente con lectura vigente.',
            tone: 'is-normal'
        };
    }

    const avg = peers.reduce((sum, item) => sum + item.value, 0) / peers.length;
    const diff = current.value - avg;
    const currentTone = getEstadoCondicionFicha(tipo, current.value).tone;

    if (Math.abs(diff) <= tolerance) {
        return {
            value: 'En linea',
            meta: `Muy cerca del promedio de ${numeroFicha(peers.length)} componente(s): ${numeroFicha(avg, cfg.decimals)} ${cfg.unit}.`,
            tone: 'is-normal'
        };
    }
    if (diff > 0) {
        return {
            value: `+${numeroFicha(diff, cfg.decimals)} ${cfg.unit}`,
            meta: `Sobre el promedio del activo (${numeroFicha(avg, cfg.decimals)} ${cfg.unit}).`,
            tone: currentTone
        };
    }
    return {
        value: `-${numeroFicha(Math.abs(diff), cfg.decimals)} ${cfg.unit}`,
        meta: `Bajo el promedio del activo (${numeroFicha(avg, cfg.decimals)} ${cfg.unit}).`,
        tone: 'is-normal'
    };
}

function crearTarjetaResumenFicha({ label, value, meta, icon, tone = '' }) {
    return `
        <article class="planify-ficha-stat ${tone}">
            <div class="planify-ficha-stat-label"><i class="fa-solid ${icon}"></i> ${label}</div>
            <div class="planify-ficha-stat-value">${value}</div>
            <div class="planify-ficha-stat-meta">${meta}</div>
        </article>
    `;
}

function crearTarjetaMiniFicha({ label, value, meta, tone = '' }) {
    return `
        <article class="planify-ficha-mini ${tone}">
            <div class="planify-ficha-mini-label">${label}</div>
            <div class="planify-ficha-mini-value">${value}</div>
            <div class="planify-ficha-mini-meta">${meta}</div>
        </article>
    `;
}

function emptyFichaState(title, copy) {
    return `<div class="planify-ficha-empty"><div><div style="font-weight:800;color:#0f172a;margin-bottom:.35rem;">${title}</div><div style="font-size:.85rem;line-height:1.5;">${copy}</div></div></div>`;
}

function getEstadoCondicionFicha(tipo, valor) {
    const number = Number(valor || 0);
    if (tipo === 'vibracion') {
        if (number >= 4.5) return { label: 'Critico', className: 'is-critical', tone: 'is-critical', color: '#dc2626' };
        if (number >= 3.2) return { label: 'Seguimiento', className: 'is-watch', tone: 'is-watch', color: '#d97706' };
        return { label: 'Controlado', className: 'is-normal', tone: 'is-normal', color: '#059669' };
    }
    if (number >= 80) return { label: 'Critico', className: 'is-critical', tone: 'is-critical', color: '#dc2626' };
    if (number >= 65) return { label: 'Seguimiento', className: 'is-watch', tone: 'is-watch', color: '#d97706' };
    return { label: 'Controlado', className: 'is-normal', tone: 'is-normal', color: '#059669' };
}

function resumirTendenciaFicha(registros, tipo) {
    const sorted = [...registros].sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
    if (sorted.length < 2) {
        return { label: sorted.length ? 'Primera lectura' : 'Sin tendencia', meta: 'Aun no hay comparacion.', className: 'is-normal', icon: 'fa-wave-square' };
    }
    const last = Number(sorted[sorted.length - 1].valor || 0);
    const prev = Number(sorted[sorted.length - 2].valor || 0);
    const diff = last - prev;
    const threshold = tipo === 'vibracion' ? 0.05 : 0.5;
    if (Math.abs(diff) <= threshold) {
        return { label: 'Estable', meta: 'Sin cambio relevante frente a la lectura anterior.', className: 'is-normal', icon: 'fa-minus' };
    }
    if (diff > 0) {
        return {
            label: 'Al alza',
            meta: `Sube ${numeroFicha(Math.abs(diff), tipo === 'vibracion' ? 2 : 1)} ${tipo === 'vibracion' ? 'mm/s' : 'C'} vs. la lectura anterior.`,
            className: 'is-watch',
            icon: 'fa-arrow-trend-up'
        };
    }
    return {
        label: 'A la baja',
        meta: `Baja ${numeroFicha(Math.abs(diff), tipo === 'vibracion' ? 2 : 1)} ${tipo === 'vibracion' ? 'mm/s' : 'C'} vs. la lectura anterior.`,
        className: 'is-normal',
        icon: 'fa-arrow-trend-down'
    };
}

function obtenerResumenMedicionesFicha(registros, tipo) {
    const items = [...registros]
        .filter(item => item.tipo === tipo)
        .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
    if (!items.length) {
        return {
            count: 0,
            avg: 0,
            max: 0,
            latest: null,
            status: { label: 'Sin datos', className: 'is-normal', tone: '', color: '#64748b' },
            trend: { label: 'Sin tendencia', meta: 'No hay registros todavia.', className: 'is-normal', icon: 'fa-minus' }
        };
    }
    const latest = items[items.length - 1];
    const avg = items.reduce((sum, item) => sum + Number(item.valor || 0), 0) / items.length;
    const max = Math.max(...items.map(item => Number(item.valor || 0)));
    return {
        count: items.length,
        avg,
        max,
        latest,
        status: getEstadoCondicionFicha(tipo, latest.valor),
        trend: resumirTendenciaFicha(items, tipo)
    };
}

function consolidarEstadoFicha(estados) {
    if (estados.some(item => item?.className === 'is-critical')) return { label: 'Critico', className: 'is-critical', tone: 'is-critical' };
    if (estados.some(item => item?.className === 'is-watch')) return { label: 'Seguimiento', className: 'is-watch', tone: 'is-watch' };
    return { label: 'Controlado', className: 'is-normal', tone: 'is-normal' };
}

window.irAHistorialDeEquipo = function(equipoId) {
    const equipo = estado.equipos.find(item => item.id === equipoId);
    vistaActual = 'historial';
    renderizarVistaActual();
    setTimeout(() => {
        const input = document.getElementById('input-buscar-historial');
        if (!input) return;
        input.value = equipo ? `${equipo.activo} ${equipo.ubicacion}` : '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
    }, 120);
};

window.irAControlConBusqueda = function(equipoId) {
    const equipo = estado.equipos.find(item => item.id === equipoId);
    if (!equipo) return;
    vistaActual = 'control';
    renderizarVistaActual();
    setTimeout(() => {
        const input = document.getElementById('input-buscar-ot') || searchInput;
        if (!input) return;
        input.value = equipo.kks || equipo.activo;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
    }, 120);
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

// ── Helpers: clasificación y card para vista Diario ──────────────────────────

function _clasificarTareasPorEspecialidad(tareas) {
    const VIBR = ['medición de vibraciones','termografía','end','ensayos no destructivos','tintas penetrantes','medición de espesores','espesores','dureza','balanceo'];
    const LUBR = ['lubricación','cambio de aceite','cambios de aceite','aceite','lubs','análisis de aceite','engrase','lubric'];
    function getTipos(t) {
        if (Array.isArray(t.tiposSeleccionados) && t.tiposSeleccionados.length > 0)
            return t.tiposSeleccionados.map(x => x.toLowerCase());
        return [(t.tipo || '').toLowerCase()];
    }
    const vibraciones = [], lubricacion = [], otros = [];
    tareas.forEach(t => {
        const tipos = getTipos(t);
        const esVibr = tipos.some(tp => VIBR.some(v => tp.includes(v)));
        const esLubr = tipos.some(tp => LUBR.some(l => tp.includes(l)));
        if (esVibr) vibraciones.push(t);
        if (esLubr) lubricacion.push(t);
        if (!esVibr && !esLubr) otros.push(t);
    });
    return { vibraciones, lubricacion, otros };
}

function _htmlTareaCard(tarea, isAdmin, colaTareas) {
    // Extraer ubicación primero (se usa tanto en el link como en el HTML)
    let ubicacionTexto = tarea.ubicacion || '';
    if (!ubicacionTexto) {
        const bracketMatch = tarea.tipo.match(/^\[([^\]]+)\]/);
        if (bracketMatch) ubicacionTexto = bracketMatch[1];
    }
    // Resolver enlace a equipo en el título
    let eqId = '', nombreEqEncontrado = '';
    const _ubicTarea = ubicacionTexto.toLowerCase();
    const matches = tarea.tipo.matchAll(/\[(.*?)\]/g);
    for (const match of matches) {
        const candidato = match[1];
        let res = estado.equipos.find(e => (e.activo.toLowerCase() === candidato.toLowerCase() || e.kks === candidato) && e.ubicacion && e.ubicacion.toLowerCase() === _ubicTarea);
        if (!res) res = estado.equipos.find(e => e.activo.toLowerCase() === candidato.toLowerCase() || e.kks === candidato);
        if (res) { eqId = res.id; nombreEqEncontrado = candidato; break; }
    }
    if (!eqId) {
        let res = estado.equipos.find(e => tarea.tipo.toLowerCase().includes(e.activo.toLowerCase()) && e.ubicacion && e.ubicacion.toLowerCase() === _ubicTarea);
        if (!res) res = estado.equipos.find(e => tarea.tipo.toLowerCase().includes(e.activo.toLowerCase()));
        if (res) { eqId = res.id; nombreEqEncontrado = res.activo; }
    }
    let tituloHtml = tarea.tipo;
    if (eqId) {
        const partes = tarea.tipo.split(new RegExp('(\\[?' + nombreEqEncontrado.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\]?)', 'i'));
        // ubicacionTexto ya está disponible aquí
        const _ubSafe = ubicacionTexto.replace(/'/g, '');
        tituloHtml = partes.map(p => (p.toLowerCase() === nombreEqEncontrado.toLowerCase() || p.toLowerCase() === '[' + nombreEqEncontrado.toLowerCase() + ']')
            ? '<a href="#" onclick="window.elegirComponenteYAbrirFicha(\'' + eqId + '\',\'' + _ubSafe + '\'); return false;" style="color:var(--primary-color); text-decoration:none; cursor:pointer;" onmouseover="this.style.textDecoration=\'underline\'" onmouseout="this.style.textDecoration=\'none\'">' + p + '</a>'
            : p).join('');
    }
    // Strip [Unidad] prefix and (Tipo de trabajo) suffix from displayed title
    tituloHtml = tituloHtml.replace(/^\s*\[[^\]]+\]\s*/, '').replace(/\s*\([^)]+\)\s*$/, '');
    const esParticipante = estado.usuarioActual === 'trabajador' &&
        (tarea.liderId === estado.trabajadorLogueado?.id || (tarea.ayudantesIds || []).includes(estado.trabajadorLogueado?.id));
    const puedeGestionar = isAdmin || esParticipante;
    const posActual = colaTareas.findIndex(t => t.id === tarea.id);
    // Build type badges — use tiposSeleccionados or extract from parentheses in title
    let tipos = Array.isArray(tarea.tiposSeleccionados) && tarea.tiposSeleccionados.length > 0
        ? tarea.tiposSeleccionados : [];
    if (tipos.length === 0) {
        const parenMatches = [...tarea.tipo.matchAll(/\(([^)]+)\)/g)];
        if (parenMatches.length > 0) tipos = parenMatches.map(m => m[1]);
    }
    const tiposBadgesHtml = tipos.map(t =>
        `<span class="daily-task-type-pill" onclick="window.abrirModalTipoBadge('${t.replace(/'/g,"\\'")}', '${tarea.id}')"
            style="display:inline-block; background:#f1f5f9; color:#475569; border:1px solid #e2e8f0; border-radius:999px; font-size:0.72rem; font-weight:600; padding:2px 10px; letter-spacing:0.01em; cursor:pointer; transition:background 150ms;"
            onmouseover="this.style.background='#e2e8f0'" onmouseout="this.style.background='#f1f5f9'">${t}</span>`
    ).join('');
    const _ubSafeHtml = ubicacionTexto.replace(/'/g, '');
    const ubicacionHtml = ubicacionTexto
        ? `<div class="daily-task-location" style="display:flex; align-items:center; gap:0.35rem; font-size:0.85rem; color:#64748b; margin-top:0.35rem;">
               <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#FF6900" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
               <a href="#" onclick="window.abrirVistaUnidad('${_ubSafeHtml}'); return false;" style="color:#64748b; text-decoration:none; font-weight:600;" onmouseover="this.style.color='#FF6900'" onmouseout="this.style.color='#64748b'">${ubicacionTexto}</a>
           </div>` : '';
    const fechaStr = tarea.fechaAsignacion
        ? new Date(tarea.fechaAsignacion).toLocaleString('es-CL', {day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'})
        : (tarea.horaAsignacion || '');
    return `
    <div class="list-item daily-task-card ${tarea._enCola ? 'is-queue' : 'is-active'}" style="border-left: 3px solid ${tarea._enCola ? '#9ca3af' : 'var(--warning-color)'}; padding: 1rem 1.1rem; display:flex; flex-direction:column; gap:0; align-items:stretch;">
        <!-- 1. Nombre del equipo / trabajo -->
        <div class="daily-task-title" style="font-size:1.05rem; font-weight:700; color:var(--primary-color); line-height:1.3;">${tituloHtml}${tarea.otNumero ? `&nbsp;<span class="daily-task-inline-pill" style="font-size:0.78rem; font-weight:600; background:#fff3e0; color:#e65100; border-radius:6px; padding:1px 7px; vertical-align:middle;"><i class="fa-solid fa-hashtag" style="font-size:0.7rem;"></i> ${tarea.otNumero}</span>` : ''}</div>

        <!-- 2. Tipos de trabajo (chips) -->
        ${tiposBadgesHtml ? `<div class="daily-task-badges" style="display:flex; flex-wrap:wrap; gap:0.3rem; margin-top:0.45rem;">${tiposBadgesHtml}</div>` : ''}

        <!-- 3. Ubicación -->
        ${ubicacionHtml}

        <!-- Separator -->
        <div class="daily-task-divider" style="margin:0.7rem 0 0.6rem; border-top:1px solid #f1f5f9;"></div>

        <!-- 4. Líder -->
        <div class="daily-task-crew-row" style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:0.5rem;">
            <div class="daily-task-crew-copy">
                <div class="daily-task-lead-row" style="display:flex; align-items:center; gap:0.4rem; font-size:0.9rem; color:var(--text-main);">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--primary-color)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                    <span style="color:#64748b; font-size:0.82rem;">Líder</span>
                    <strong style="font-size:0.92rem;">${tarea.liderNombre || 'Sin asignar'}</strong>
                </div>
                <!-- 5. Apoyo -->
                ${tarea.ayudantesNombres && tarea.ayudantesNombres.length > 0 ? `
                <div class="daily-task-support-row" style="display:flex; align-items:center; gap:0.4rem; font-size:0.85rem; color:#64748b; margin-top:0.35rem;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                    <span>Técnicos: ${tarea.ayudantesNombres.join(', ')}</span>
                </div>` : ''}
                ${tarea.espacioConfinado ? `
                <div class="daily-task-vigia-row" style="display:flex; align-items:center; gap:0.4rem; font-size:0.85rem; color:#92400e; margin-top:0.35rem; background:#fef3c7; border:1px solid #fcd34d; border-radius:8px; padding:0.3rem 0.6rem;">
                    <i class="fa-solid fa-triangle-exclamation" style="color:#b45309;"></i>
                    <span><strong>Espacio confinado</strong>${tarea.vigiaNombre ? ` — Vigía: <strong>${tarea.vigiaNombre}</strong>` : ' — Vigía: <em>sin asignar</em>'}</span>
                </div>` : ''}
            </div>
            ${isAdmin && !tarea.liderId ? `
            <button class="daily-task-assign-inline" onclick="asignarPersonalATarea('${tarea.id}')" style="background:#FF6900; color:#fff; border:none; border-radius:8px; padding:0.4rem 0.9rem; font-size:0.82rem; font-weight:600; cursor:pointer; white-space:nowrap; flex-shrink:0;">
                <i class="fa-solid fa-user-plus"></i> Asignar personal
            </button>` : ''}
        </div>

        <!-- 6. Fecha de asignación + badge de estado -->
        <div class="daily-task-status-row" style="display:flex; align-items:center; gap:0.5rem; margin-top:0.65rem; flex-wrap:wrap;">
            <span class="daily-task-date" style="font-size:0.78rem; color:#94a3b8; display:flex; align-items:center; gap:0.3rem;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                ${fechaStr}
            </span>
            <span class="daily-task-status-wrap" style="margin-left:auto;">
                ${tarea._enCola
                    ? `<span class="daily-task-status-pill is-queue" style="display:inline-flex; align-items:center; gap:0.3rem; background:#f3f4f6; color:#6b7280; border-radius:999px; font-size:0.72rem; font-weight:700; padding:3px 10px; border:1px solid #e5e7eb;"><span class="daily-task-status-order" style="display:inline-flex; align-items:center; justify-content:center; width:18px; height:18px; background:#6b7280; color:#fff; border-radius:50%; font-size:0.68rem; font-weight:700;">${tarea._pos}</span> EN COLA</span>`
                    : `<span class="daily-task-status-pill is-active" style="display:inline-flex; align-items:center; gap:0.3rem; background:#fff3e0; color:#FF6900; border-radius:999px; font-size:0.72rem; font-weight:700; padding:3px 10px; border:1px solid #ffd0a8;"><i class="fa-solid fa-circle-play" style="font-size:0.72rem;"></i> ACTIVO</span>`}
            </span>
        </div>

        <!-- 7. Botones de acción -->
        <div class="daily-task-actions" style="display:flex; gap:0.5rem; margin-top:0.75rem; align-items:center; flex-wrap:wrap;">
            ${isAdmin ? `
            <button class="btn btn-outline daily-task-action-icon" style="border-color: var(--danger-color); color: var(--danger-color);" onclick="window.eliminarTareaExposed('${tarea.id}')" title="Eliminar / Cancelar">
                <i class="fa-solid fa-trash"></i>
            </button>` : ''}
            ${tarea._enCola && puedeGestionar ? `
            <div class="daily-task-order-stack" style="display:flex; flex-direction:column; gap:2px;">
                <button title="Subir en cola" onclick="window.moverOrdenExposed('${tarea.id}', 'up')" class="daily-task-order-btn" style="background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); border-radius:4px; color:var(--text-main); padding:2px 6px; cursor:pointer; font-size:0.75rem; line-height:1;" ${posActual === 0 ? 'disabled style="opacity:0.35; cursor:default;"' : ''}>▲</button>
                <button title="Bajar en cola" onclick="window.moverOrdenExposed('${tarea.id}', 'down')" class="daily-task-order-btn" style="background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); border-radius:4px; color:var(--text-main); padding:2px 6px; cursor:pointer; font-size:0.75rem; line-height:1;" ${posActual === colaTareas.length - 1 ? 'disabled style="opacity:0.35; cursor:default;"' : ''}>▼</button>
            </div>
            <button class="btn btn-primary daily-task-main-btn" style="flex:1;" onclick="window.iniciarDesdeColaExposed('${tarea.id}')">
                <i class="fa-solid fa-play"></i> Iniciar
            </button>` : ''}
            ${!tarea._enCola && puedeGestionar ? `
            <button onclick="window.ponerEnColaExposed('${tarea.id}')" class="daily-task-secondary-btn" style="flex:1; background:#4b5563; color:#fff; border:none; border-radius:8px; padding:0.5rem 1rem; font-size:0.88rem; font-weight:600; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:0.4rem;" onmouseover="this.style.background='#374151'" onmouseout="this.style.background='#4b5563'">
                <i class="fa-solid fa-clock-rotate-left"></i> Poner en Cola
            </button>
            <button class="btn btn-success daily-task-main-btn" style="flex:1;" onclick="window.completarTareaExposed('${tarea.id}', '${tarea.liderId || ''}', '${(tarea.ayudantesIds || []).join(',')}')">
                <i class="fa-solid fa-flag-checkered"></i> Terminar
            </button>` : ''}
            ${tarea._enCola && !puedeGestionar ? `
            <span style="font-size:0.8rem; color:var(--text-muted);">Posición #${tarea._pos} en cola</span>` : ''}
        </div>
    </div>`;
}

function _htmlTareaCardPremium(tarea, isAdmin, colaTareas) {
    let ubicacionTexto = tarea.ubicacion || '';
    if (!ubicacionTexto) {
        const bracketMatch = tarea.tipo.match(/^\[([^\]]+)\]/);
        if (bracketMatch) ubicacionTexto = bracketMatch[1];
    }

    let eqId = '', nombreEqEncontrado = '';
    const ubicacionTarea = ubicacionTexto.toLowerCase();
    const matches = tarea.tipo.matchAll(/\[(.*?)\]/g);
    for (const match of matches) {
        const candidato = match[1];
        let res = estado.equipos.find(e => (e.activo.toLowerCase() === candidato.toLowerCase() || e.kks === candidato) && e.ubicacion && e.ubicacion.toLowerCase() === ubicacionTarea);
        if (!res) res = estado.equipos.find(e => e.activo.toLowerCase() === candidato.toLowerCase() || e.kks === candidato);
        if (res) { eqId = res.id; nombreEqEncontrado = candidato; break; }
    }

    if (!eqId) {
        let res = estado.equipos.find(e => tarea.tipo.toLowerCase().includes(e.activo.toLowerCase()) && e.ubicacion && e.ubicacion.toLowerCase() === ubicacionTarea);
        if (!res) res = estado.equipos.find(e => tarea.tipo.toLowerCase().includes(e.activo.toLowerCase()));
        if (res) { eqId = res.id; nombreEqEncontrado = res.activo; }
    }

    let tituloHtml = tarea.tipo;
    if (eqId) {
        const partes = tarea.tipo.split(new RegExp('(\\[?' + nombreEqEncontrado.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\]?)', 'i'));
        const ubicacionSafe = ubicacionTexto.replace(/'/g, '');
        tituloHtml = partes.map(p => (p.toLowerCase() === nombreEqEncontrado.toLowerCase() || p.toLowerCase() === '[' + nombreEqEncontrado.toLowerCase() + ']')
            ? '<a href="#" onclick="window.elegirComponenteYAbrirFicha(\'' + eqId + '\',\'' + ubicacionSafe + '\'); return false;" style="color:var(--primary-color); text-decoration:none; cursor:pointer;" onmouseover="this.style.textDecoration=\'underline\'" onmouseout="this.style.textDecoration=\'none\'">' + p + '</a>'
            : p).join('');
    }

    tituloHtml = tituloHtml.replace(/^\s*\[[^\]]+\]\s*/, '').replace(/\s*\([^)]+\)\s*$/, '');

    const esParticipante = estado.usuarioActual === 'trabajador' &&
        (tarea.liderId === estado.trabajadorLogueado?.id || (tarea.ayudantesIds || []).includes(estado.trabajadorLogueado?.id));
    const puedeGestionar = isAdmin || esParticipante;
    const posActual = colaTareas.findIndex(t => t.id === tarea.id);
    const ayudantes = Array.isArray(tarea.ayudantesNombres) ? tarea.ayudantesNombres : [];
    const apoyoTexto = ayudantes.length > 0 ? ayudantes.join(', ') : 'Sin técnicos asignados';
    const dotacion = (tarea.liderNombre ? 1 : 0) + ayudantes.length;

    let tipos = Array.isArray(tarea.tiposSeleccionados) && tarea.tiposSeleccionados.length > 0 ? tarea.tiposSeleccionados : [];
    if (tipos.length === 0) {
        const parenMatches = [...tarea.tipo.matchAll(/\(([^)]+)\)/g)];
        if (parenMatches.length > 0) tipos = parenMatches.map(m => m[1]);
    }

    const tiposBadgesHtml = tipos.map(t =>
        `<button type="button" class="daily-task-type-badge" onclick="window.abrirModalTipoBadge('${t.replace(/'/g, "\\'")}', '${tarea.id}')">${t}</button>`
    ).join('');

    const ubicacionSafeHtml = ubicacionTexto.replace(/'/g, '');
    const fechaStr = tarea.fechaAsignacion
        ? new Date(tarea.fechaAsignacion).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : (tarea.horaAsignacion || '');

    const estadoHtml = tarea._enCola
        ? `<span class="daily-task-status-pill is-queue"><span class="daily-task-status-order">${tarea._pos}</span> En cola</span>`
        : `<span class="daily-task-status-pill is-active"><i class="fa-solid fa-circle-play" style="font-size:0.72rem;"></i> Activo</span>`;
    const otHtml = tarea.otNumero
        ? `<span class="daily-task-meta-pill is-accent"><i class="fa-solid fa-hashtag"></i> OT ${tarea.otNumero}</span>`
        : '';
    const ubicacionHtml = ubicacionTexto
        ? `<a href="#" onclick="window.abrirVistaUnidad('${ubicacionSafeHtml}'); return false;" class="daily-task-meta-pill is-link"><i class="fa-solid fa-location-dot"></i> ${ubicacionTexto}</a>`
        : '';
    const dotacionHtml = `<span class="daily-task-meta-pill"><i class="fa-solid fa-users"></i> ${dotacion} persona(s)</span>`;
    const asignarBtnHtml = isAdmin && !tarea.liderId
        ? `<button onclick="asignarPersonalATarea('${tarea.id}')" class="daily-task-assign-btn"><i class="fa-solid fa-user-plus"></i> Asignar personal</button>`
        : '';

    return `
    <article class="list-item daily-task-card ${tarea._enCola ? 'is-queue' : 'is-active'}">
        <div class="daily-task-top">
            <div class="daily-task-top-main">
                <div class="daily-task-kicker">${tarea._enCola ? 'Trabajo en espera' : 'Trabajo en ejecucion'}</div>
                <div class="daily-task-title-row">
                    <div class="daily-task-title">${tituloHtml}</div>
                    ${estadoHtml}
                </div>
                <div class="daily-task-meta-row">
                    ${otHtml}
                    ${ubicacionHtml}
                    ${dotacionHtml}
                </div>
            </div>
            ${asignarBtnHtml}
        </div>

        ${tiposBadgesHtml ? `<div class="daily-task-badges">${tiposBadgesHtml}</div>` : ''}

        <div class="daily-task-info-grid">
            <div class="daily-task-info-card">
                <span class="daily-task-info-label">Lider</span>
                <strong class="daily-task-info-value">${tarea.liderNombre || 'Sin asignar'}</strong>
            </div>
            <div class="daily-task-info-card">
                        <span class="daily-task-info-label">Técnicos</span>
                <span class="daily-task-info-value is-muted">${apoyoTexto}</span>
            </div>
            <div class="daily-task-info-card">
                <span class="daily-task-info-label">Programacion</span>
                <span class="daily-task-info-value is-muted">${fechaStr || 'Sin horario registrado'}</span>
            </div>
        </div>

        <div class="daily-task-footer-note">${tarea._enCola ? `Posicion ${tarea._pos} en cola para esta cuadrilla.` : 'Trabajo disponible para cierre o reasignacion operativa.'}</div>

        <div class="daily-task-actions">
            ${isAdmin ? `
            <button class="btn btn-outline daily-task-action-icon" style="border-color: var(--danger-color); color: var(--danger-color);" onclick="window.eliminarTareaExposed('${tarea.id}')" title="Eliminar / Cancelar">
                <i class="fa-solid fa-trash"></i>
            </button>` : ''}
            ${tarea._enCola && puedeGestionar ? `
            <div class="daily-task-order-stack">
                <button title="Subir en cola" onclick="window.moverOrdenExposed('${tarea.id}', 'up')" class="daily-task-order-btn" ${posActual === 0 ? 'disabled style="opacity:0.35; cursor:default;"' : ''}>&#9650;</button>
                <button title="Bajar en cola" onclick="window.moverOrdenExposed('${tarea.id}', 'down')" class="daily-task-order-btn" ${posActual === colaTareas.length - 1 ? 'disabled style="opacity:0.35; cursor:default;"' : ''}>&#9660;</button>
            </div>
            <button class="btn btn-primary daily-task-main-btn" onclick="window.iniciarDesdeColaExposed('${tarea.id}')">
                <i class="fa-solid fa-play"></i> Iniciar
            </button>` : ''}
            ${!tarea._enCola && puedeGestionar ? `
            <button onclick="window.ponerEnColaExposed('${tarea.id}')" class="daily-task-secondary-btn">
                <i class="fa-solid fa-clock-rotate-left"></i> Poner en Cola
            </button>
            <button class="btn btn-success daily-task-main-btn" onclick="window.completarTareaExposed('${tarea.id}', '${tarea.liderId || ''}', '${(tarea.ayudantesIds || []).join(',')}')">
                <i class="fa-solid fa-flag-checkered"></i> Terminar
            </button>` : ''}
            ${tarea._enCola && !puedeGestionar ? `
            <span class="daily-task-queue-note">Posicion #${tarea._pos} en cola</span>` : ''}
        </div>
    </article>`;
}

function renderControlView() {
    const tareasDiarias = estado.tareas.filter(t =>
        t.estadoTarea === 'en_curso' ||
        (t.estadoTarea === 'programada_semana' && t.liderId)
    ).sort((a, b) => {
        const aEnCola = a.estadoEjecucion === 'en_cola' || a.estadoTarea === 'programada_semana';
        const bEnCola = b.estadoEjecucion === 'en_cola' || b.estadoTarea === 'programada_semana';
        if (!aEnCola && bEnCola) return -1;
        if (aEnCola && !bEnCola) return 1;
        return (a.orden || 0) - (b.orden || 0);
    });

    let colaPosCounter = 0;
    const tareasConPos = tareasDiarias.map(t => {
        const enCola = t.estadoEjecucion === 'en_cola' || t.estadoTarea === 'programada_semana';
        return { ...t, _enCola: enCola, _pos: enCola ? ++colaPosCounter : 0 };
    });

    const colaTareas = tareasConPos.filter(t => t._enCola);
    const tareasActivas = tareasConPos.filter(t => !t._enCola);
    const { vibraciones, lubricacion, otros } = _clasificarTareasPorEspecialidad(tareasConPos);
    const trabajadoresConCheckIn = estado.trabajadores.filter(t => t.disponible).length;
    const trabajadoresOcupados = estado.trabajadores.filter(t => t.ocupado).length;
    const trabajadoresSinCheckIn = Math.max(estado.trabajadores.length - trabajadoresConCheckIn, 0);
    const coberturaTurno = estado.trabajadores.length > 0
        ? Math.round((trabajadoresConCheckIn / estado.trabajadores.length) * 100)
        : 0;
    const equiposCriticosActivos = new Set(
        tareasConPos
            .map(t => estado.equipos.find(eq => String(eq.id) === String(t.equipoId)))
            .filter(eq => eq && ['A', 'B'].includes(String(eq.criticidad || '').toUpperCase()))
            .map(eq => eq.id)
    ).size;
    const resumenEspecialidades = [
        { label: 'Vibraciones', count: vibraciones.length, icon: 'fa-gear' },
        { label: 'Lubricacion', count: lubricacion.length, icon: 'fa-droplet' },
        { label: 'Otros', count: otros.length, icon: 'fa-list-check' }
    ].sort((a, b) => b.count - a.count);
    const focoPrincipal = resumenEspecialidades[0];
    const proximaEnCola = colaTareas[0] || null;
    const hoyClave = new Date().toISOString().slice(0, 10);
    const ultimoCierreHoy = [...estado.historialTareas]
        .filter(t => String(t.created_at || '').slice(0, 10) === hoyClave)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0] || null;
    const resumenFecha = new Date().toLocaleDateString('es-CL', {
        weekday: 'long',
        day: 'numeric',
        month: 'long'
    });
    const trabajadorActual = obtenerTrabajadorActual();

    function tituloTareaDashboard(tarea) {
        if (!tarea) return 'Sin informacion';
        return tarea.otNumero || tarea.ot_numero || tarea.tipo || 'Trabajo sin titulo';
    }

    function subtituloTareaDashboard(tarea) {
        if (!tarea) return 'Sin trabajos pendientes por ahora.';
        const partes = [tarea.tipo || null, tarea.ubicacion || null, tarea.liderNombre || tarea.lider_nombre || null].filter(Boolean);
        return partes.length > 0 ? partes.join(' · ') : 'Trabajo listo para revisar';
    }

    mainContent.innerHTML = `
        <div class="dashboard-grid fade-in" style="grid-template-columns:1fr; ${estado.usuarioActual !== 'admin' ? 'max-width:800px; margin:0 auto;' : ''}">
            <div class="dashboard-lists">
                <div class="panel dashboard-hero">
                    <div class="dashboard-hero-head">
                        <div>
                            <div class="dashboard-eyebrow">Centro de control diario</div>
                            <h2 style="margin-bottom:0.4rem;"><i class="fa-solid fa-chart-column"></i> Dashboard Operativo</h2>
                            <p class="dashboard-hero-copy">${resumenFecha}. ${tareasActivas.length > 0 ? `Hay ${tareasActivas.length} trabajo(s) activo(s)` : 'No hay trabajos activos'}${colaTareas.length > 0 ? ` y ${colaTareas.length} en cola` : ''}.</p>
                        </div>
                        <div class="dashboard-hero-badges">
                            <span class="dashboard-hero-badge"><i class="fa-solid fa-user-check"></i> Cobertura ${coberturaTurno}%</span>
                            <span class="dashboard-hero-badge"><i class="fa-solid fa-shield-halved"></i> Criticos atendidos ${equiposCriticosActivos}</span>
                        </div>
                    </div>

                    <div class="dashboard-metrics">
                        <article class="dashboard-metric-card">
                            <span class="dashboard-metric-icon" style="background:#fff7ed; color:#c2410c;"><i class="fa-solid fa-person-digging"></i></span>
                            <div class="dashboard-metric-value">${tareasActivas.length}</div>
                            <div class="dashboard-metric-label">Trabajos activos</div>
                        </article>
                        <article class="dashboard-metric-card">
                            <span class="dashboard-metric-icon" style="background:#eff6ff; color:#1d4ed8;"><i class="fa-solid fa-clock-rotate-left"></i></span>
                            <div class="dashboard-metric-value">${colaTareas.length}</div>
                            <div class="dashboard-metric-label">Trabajos en cola</div>
                        </article>
                        <article class="dashboard-metric-card">
                            <span class="dashboard-metric-icon" style="background:#ecfdf5; color:#047857;"><i class="fa-solid fa-user-check"></i></span>
                            <div class="dashboard-metric-value">${trabajadoresConCheckIn}</div>
                            <div class="dashboard-metric-label">Personal con check-in</div>
                        </article>
                        <article class="dashboard-metric-card">
                            <span class="dashboard-metric-icon" style="background:#fef2f2; color:#b91c1c;"><i class="fa-solid fa-user-clock"></i></span>
                            <div class="dashboard-metric-value">${trabajadoresSinCheckIn}</div>
                            <div class="dashboard-metric-label">Sin check-in hoy</div>
                        </article>
                    </div>

                    <div class="dashboard-focus-grid">
                        <article class="dashboard-focus-card">
                            <div class="dashboard-focus-title"><i class="fa-solid ${focoPrincipal.icon}"></i> Foco del dia</div>
                            <div class="dashboard-focus-main">${focoPrincipal.label}</div>
                            <div class="dashboard-focus-sub">${focoPrincipal.count > 0 ? `${focoPrincipal.count} trabajo(s) concentrados en esta especialidad` : 'Sin carga marcada por especialidad todavia'}</div>
                        </article>
                        <article class="dashboard-focus-card">
                            <div class="dashboard-focus-title"><i class="fa-solid fa-forward-step"></i> Siguiente en cola</div>
                            <div class="dashboard-focus-main">${tituloTareaDashboard(proximaEnCola)}</div>
                            <div class="dashboard-focus-sub">${subtituloTareaDashboard(proximaEnCola)}</div>
                        </article>
                        <article class="dashboard-focus-card">
                            <div class="dashboard-focus-title"><i class="fa-solid fa-flag-checkered"></i> Ultimo cierre del dia</div>
                            <div class="dashboard-focus-main">${ultimoCierreHoy ? tituloTareaDashboard(ultimoCierreHoy) : 'Sin cierres registrados'}</div>
                            <div class="dashboard-focus-sub">${ultimoCierreHoy ? `${(ultimoCierreHoy.lider_nombre || ultimoCierreHoy.liderNombre || 'Sin lider')} - ${new Date(ultimoCierreHoy.created_at).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}` : 'Cuando se cierre una OT hoy aparecera aqui.'}</div>
                        </article>
                        <article class="dashboard-focus-card">
                            <div class="dashboard-focus-title"><i class="fa-solid fa-helmet-safety"></i> Cobertura de personal</div>
                            <div class="dashboard-focus-main">${trabajadoresOcupados} trabajando ahora</div>
                            <div class="dashboard-focus-sub">${estado.trabajadores.length > 0 ? `${trabajadoresConCheckIn} de ${estado.trabajadores.length} personas disponibles hoy` : 'Aun no hay personal cargado'}</div>
                        </article>
                    </div>
                </div>
            </div>
        </div>
    `;
}

// COMPONENTE: Vista Dashboard
function renderDashboardView() {
    // Todos los trabajadores son asignables — los ocupados/sin check-in van automáticamente a cola
    const trabajadoresValidados = estado.trabajadores;
    // Incluye activas + en cola (programada_semana con personal ya asignado)
    const tareasDiarias = estado.tareas.filter(t =>
        t.estadoTarea === 'en_curso' ||
        (t.estadoTarea === 'programada_semana' && t.liderId)
    ).sort((a, b) => {
        // Activas primero, luego cola por orden
        const aEnCola = a.estadoEjecucion === 'en_cola' || a.estadoTarea === 'programada_semana';
        const bEnCola = b.estadoEjecucion === 'en_cola' || b.estadoTarea === 'programada_semana';
        if (!aEnCola && bEnCola) return -1;
        if (aEnCola && !bEnCola) return 1;
        return (a.orden || 0) - (b.orden || 0);
    });
    // Calcular posición en cola para cada tarea
    let _colaPosCounter = 0;
    const _tareasConPos = tareasDiarias.map(t => {
        const enCola = t.estadoEjecucion === 'en_cola' || t.estadoTarea === 'programada_semana';
        return { ...t, _enCola: enCola, _pos: enCola ? ++_colaPosCounter : 0 };
    });
    const colaTareas = _tareasConPos.filter(t => t._enCola);
    const tareasActivas = _tareasConPos.filter(t => !t._enCola);
    const { vibraciones, lubricacion, otros } = _clasificarTareasPorEspecialidad(_tareasConPos);
    const trabajadoresConCheckIn = estado.trabajadores.filter(t => t.disponible).length;
    const trabajadoresOcupados = estado.trabajadores.filter(t => t.ocupado).length;
    const trabajadoresSinCheckIn = Math.max(estado.trabajadores.length - trabajadoresConCheckIn, 0);
    const coberturaTurno = estado.trabajadores.length > 0
        ? Math.round((trabajadoresConCheckIn / estado.trabajadores.length) * 100)
        : 0;
    const equiposCriticosActivos = new Set(
        _tareasConPos
            .map(t => estado.equipos.find(eq => String(eq.id) === String(t.equipoId)))
            .filter(eq => eq && ['A', 'B'].includes(String(eq.criticidad || '').toUpperCase()))
            .map(eq => eq.id)
    ).size;
    const resumenEspecialidades = [
        { label: 'Vibraciones', count: vibraciones.length, icon: 'fa-gear' },
        { label: 'Lubricacion', count: lubricacion.length, icon: 'fa-droplet' },
        { label: 'Otros', count: otros.length, icon: 'fa-list-check' }
    ].sort((a, b) => b.count - a.count);
    const focoPrincipal = resumenEspecialidades[0];
    const proximaEnCola = colaTareas[0] || null;
    const hoyClave = new Date().toISOString().slice(0, 10);
    const ultimoCierreHoy = [...estado.historialTareas]
        .filter(t => String(t.created_at || '').slice(0, 10) === hoyClave)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0] || null;
    const resumenFecha = new Date().toLocaleDateString('es-CL', {
        weekday: 'long',
        day: 'numeric',
        month: 'long'
    });

    function tituloTareaDashboard(tarea) {
        if (!tarea) return 'Sin informacion';
        return tarea.otNumero || tarea.ot_numero || tarea.tipo || 'Trabajo sin titulo';
    }

    function subtituloTareaDashboard(tarea) {
        if (!tarea) return 'Sin trabajos pendientes por ahora.';
        const partes = [tarea.tipo || null, tarea.ubicacion || null, tarea.liderNombre || tarea.lider_nombre || null].filter(Boolean);
        return partes.length > 0 ? partes.join(' · ') : 'Trabajo listo para revisar';
    }
    
    function extraerUbicacionDesdeTexto(texto) {
        if (!texto) return '';
        const bracketMatch = String(texto).match(/^\[([^\]]+)\]/);
        return bracketMatch ? bracketMatch[1] : '';
    }

    function obtenerUbicacionTarea(tarea) {
        if (!tarea) return 'Sin unidad';
        if (tarea.ubicacion) return tarea.ubicacion;
        if (tarea.equipoId) {
            const equipo = estado.equipos.find(eq => String(eq.id) === String(tarea.equipoId));
            if (equipo?.ubicacion) return equipo.ubicacion;
        }
        return extraerUbicacionDesdeTexto(tarea.tipo) || 'Sin unidad';
    }

    function obtenerFechaRegistro(...valores) {
        for (const valor of valores) {
            if (!valor) continue;
            const fecha = new Date(valor);
            if (!Number.isNaN(fecha.getTime())) return fecha;
        }
        return null;
    }

    function resolverEspecialidadUnidad(tarea) {
        const tipos = Array.isArray(tarea?.tiposSeleccionados) && tarea.tiposSeleccionados.length > 0
            ? tarea.tiposSeleccionados.map(tipo => String(tipo || '').toLowerCase())
            : [String(tarea?.tipo || '').toLowerCase()];
        const esVibracion = tipos.some(tipo =>
            ['vibracion', 'termografia', 'end', 'espesores', 'dureza', 'balanceo', 'tintas penetrantes']
                .some(valor => tipo.includes(valor))
        );
        if (esVibracion) return 'Vibraciones';
        const esLubricacion = tipos.some(tipo =>
            ['lubricacion', 'aceite', 'engrase', 'lubs']
                .some(valor => tipo.includes(valor))
        );
        if (esLubricacion) return 'Lubricacion';
        return 'Otros';
    }

    function clasificarLecturaUnidad(tipo, valor) {
        const numero = Number(valor || 0);
        if (String(tipo || '').toLowerCase() === 'vibracion') {
            if (numero >= 4.5) return 'critical';
            if (numero >= 3.2) return 'watch';
            return 'normal';
        }
        if (numero >= 80) return 'critical';
        if (numero >= 65) return 'watch';
        return 'normal';
    }

    const inicioHoy = new Date();
    inicioHoy.setHours(0, 0, 0, 0);
    const cierresHoy = (estado.historialTareas || []).filter(item => {
        const fecha = obtenerFechaRegistro(item.created_at, item.fecha_creacion, item.fecha_completada);
        return fecha && fecha >= inicioHoy;
    });
    const medicionesHoy = (estado.historialMediciones || []).filter(item => {
        const fecha = obtenerFechaRegistro(item.fecha, item.creado_en, item.created_at);
        return fecha && fecha >= inicioHoy;
    });
    const mapaUnidades = new Map();
    const asegurarUnidad = nombreUnidad => {
        const nombre = nombreUnidad || 'Sin unidad';
        if (!mapaUnidades.has(nombre)) {
            mapaUnidades.set(nombre, {
                nombre,
                active: 0,
                queue: 0,
                closedToday: 0,
                measuresToday: 0,
                crew: new Set(),
                specialties: new Map(),
                criticalMeasures: 0,
                watchMeasures: 0,
                criticalAssets: 0,
                lastEvent: null
            });
        }
        return mapaUnidades.get(nombre);
    };
    const registrarUltimaActividad = (bucket, fecha) => {
        if (!fecha) return;
        if (!bucket.lastEvent || fecha > bucket.lastEvent) bucket.lastEvent = fecha;
    };

    _tareasConPos.forEach(tarea => {
        const unidad = asegurarUnidad(obtenerUbicacionTarea(tarea));
        if (tarea._enCola) unidad.queue += 1;
        else unidad.active += 1;
        if (tarea.liderNombre || tarea.lider_nombre) unidad.crew.add(tarea.liderNombre || tarea.lider_nombre);
        (tarea.ayudantesNombres || tarea.ayudantes_nombres || []).forEach(nombre => unidad.crew.add(nombre));
        const especialidad = resolverEspecialidadUnidad(tarea);
        unidad.specialties.set(especialidad, (unidad.specialties.get(especialidad) || 0) + 1);
        const equipo = estado.equipos.find(eq => String(eq.id) === String(tarea.equipoId));
        if (equipo && ['A', 'B'].includes(String(equipo.criticidad || '').toUpperCase())) unidad.criticalAssets += 1;
        registrarUltimaActividad(unidad, obtenerFechaRegistro(tarea.fechaAsignacion, tarea.created_at, tarea.horaAsignacion));
    });

    cierresHoy.forEach(registro => {
        const unidad = asegurarUnidad(registro.ubicacion || extraerUbicacionDesdeTexto(registro.tipo));
        unidad.closedToday += 1;
        if (registro.lider_nombre || registro.liderNombre) unidad.crew.add(registro.lider_nombre || registro.liderNombre);
        registrarUltimaActividad(unidad, obtenerFechaRegistro(registro.created_at, registro.fecha_creacion, registro.fecha_completada));
    });

    medicionesHoy.forEach(medicion => {
        const equipo = estado.equipos.find(eq => String(eq.id) === String(medicion.equipo_id || medicion.equipoId));
        const unidad = asegurarUnidad(equipo?.ubicacion || medicion.ubicacion || 'Sin unidad');
        unidad.measuresToday += 1;
        const clasificacion = clasificarLecturaUnidad(medicion.tipo, medicion.valor);
        if (clasificacion === 'critical') unidad.criticalMeasures += 1;
        else if (clasificacion === 'watch') unidad.watchMeasures += 1;
        registrarUltimaActividad(unidad, obtenerFechaRegistro(medicion.fecha, medicion.created_at, medicion.creado_en));
    });

    const resumenUnidades = [...mapaUnidades.values()].map(unidad => {
        const topSpecialty = [...unidad.specialties.entries()].sort((a, b) => b[1] - a[1])[0] || ['Otros', 0];
        let statusClass = 'is-normal';
        let statusLabel = 'Normal';
        if (unidad.criticalMeasures > 0 || (unidad.criticalAssets > 0 && unidad.active > 0)) {
            statusClass = 'is-critical';
            statusLabel = 'Critica';
        } else if (unidad.watchMeasures > 0 || unidad.queue > 0 || unidad.active >= 3) {
            statusClass = 'is-watch';
            statusLabel = 'Seguimiento';
        }
        return {
            ...unidad,
            topSpecialty: topSpecialty[0],
            statusClass,
            statusLabel,
            ultimaActividad: unidad.lastEvent
                ? unidad.lastEvent.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
                : '--:--',
            score: (unidad.active * 4) + (unidad.queue * 2) + unidad.closedToday + (unidad.measuresToday * 0.5) + (unidad.criticalMeasures * 5) + (unidad.watchMeasures * 2)
        };
    }).sort((a, b) => b.score - a.score || a.nombre.localeCompare(b.nombre));

    const unidadFocoDiaria = resumenUnidades[0] || null;
    const unidadesConActividad = resumenUnidades.length;
    const unidadesConAlerta = resumenUnidades.filter(unidad => unidad.statusClass !== 'is-normal').length;
    const metricasMapaUnidad = [
        {
            value: unidadesConActividad,
            label: 'Unidad(es) activas',
            meta: unidadFocoDiaria ? `Foco: ${unidadFocoDiaria.nombre}` : 'Sin unidades con carga',
            tone: 'orange',
            icon: 'fa-layer-group'
        },
        {
            value: medicionesHoy.length,
            label: 'Mediciones hoy',
            meta: `${cierresHoy.length} cierre(s) registrados`,
            tone: 'teal',
            icon: 'fa-wave-square'
        },
        {
            value: unidadesConAlerta,
            label: 'Unidad(es) con alerta',
            meta: unidadesConAlerta > 0 ? 'Requieren revision o seguimiento' : 'Sin alertas relevantes',
            tone: 'red',
            icon: 'fa-triangle-exclamation'
        },
        {
            value: trabajadoresOcupados,
            label: 'Personal desplegado',
            meta: `${trabajadoresConCheckIn} con check-in hoy`,
            tone: 'slate',
            icon: 'fa-users'
        }
    ];
    const metricasMapaUnidadHtml = metricasMapaUnidad.map(item => `
        <article class="dashboard-metric-card dashboard-metric-card--${item.tone}">
            <span class="dashboard-metric-icon"><i class="fa-solid ${item.icon}"></i></span>
            <div class="dashboard-metric-value">${item.value}</div>
            <div class="dashboard-metric-label">${item.label}</div>
            <div class="dashboard-metric-meta">${item.meta}</div>
        </article>
    `).join('');
    const isAdmin = estado.usuarioActual === 'admin';
    const saludoDashboard = (() => {
        const hora = new Date().getHours();
        if (hora < 12) return 'Buen dia';
        if (hora < 20) return 'Buenas tardes';
        return 'Buenas noches';
    })();
    const trabajadorActual = isAdmin ? null : obtenerTrabajadorActual();
    const nombreUsuarioDashboard = isAdmin ? 'Planificador' : (trabajadorActual?.nombre || 'Equipo');
    const nombreUsuarioCorto = String(nombreUsuarioDashboard).trim().split(/\s+/).slice(0, 2).join(' ');
    const rolUsuarioDashboard = isAdmin ? 'Centro de control del turno' : (trabajadorActual?.puesto || 'Personal en terreno');
    const tareasPersonales = !isAdmin && trabajadorActual
        ? _tareasConPos.filter((tarea) =>
            tarea.liderId === trabajadorActual.id ||
            (tarea.ayudantesIds || []).includes(trabajadorActual.id)
        )
        : [];
    const tareasPersonalesActivas = tareasPersonales.filter((tarea) => !tarea._enCola);
    const tareasPersonalesCola = tareasPersonales.filter((tarea) => tarea._enCola);
    const tareasPersonalesSemana = !isAdmin && trabajadorActual
        ? estado.tareas
            .filter((tarea) =>
                tarea.estadoTarea === 'programada_semana' &&
                (tarea.liderId === trabajadorActual.id || (tarea.ayudantesIds || []).includes(trabajadorActual.id))
            )
            .sort((a, b) => (a.orden || 0) - (b.orden || 0))
        : [];
    const estadoUsuarioDashboard = isAdmin
        ? `${trabajadoresConCheckIn} con check-in hoy`
        : (trabajadorActual?.disponible
            ? (trabajadorActual?.ocupado ? 'En terreno ahora' : 'Disponible para asignacion')
            : 'Sin check-in registrado');
    const ubicacionUsuarioDashboard = isAdmin
        ? (unidadFocoDiaria?.nombre || 'Sin unidad foco')
        : (tareasPersonales[0] ? obtenerUbicacionTarea(tareasPersonales[0]) : 'Sin unidad asignada');
    const mobilePrimaryStats = isAdmin
        ? [
            { label: 'Activos', value: tareasActivas.length, meta: 'OT en ejecucion', icon: 'fa-person-digging' },
            { label: 'En cola', value: colaTareas.length, meta: 'Listas para partir', icon: 'fa-layer-group' },
            { label: 'Cobertura', value: `${coberturaTurno}%`, meta: 'Personal con check-in', icon: 'fa-user-check' },
            { label: 'Alertas', value: unidadesConAlerta, meta: 'Unidades a revisar', icon: 'fa-triangle-exclamation' }
        ]
        : [
            { label: 'Hoy', value: tareasPersonales.length, meta: tareasPersonalesActivas.length ? `${tareasPersonalesActivas.length} activas` : 'Sin carga activa', icon: 'fa-briefcase' },
            { label: 'En cola', value: tareasPersonalesCola.length, meta: tareasPersonalesCola.length ? 'Pendientes del turno' : 'Sin tareas en cola', icon: 'fa-list-check' },
            { label: 'Semana', value: tareasPersonalesSemana.length, meta: tareasPersonalesSemana.length ? 'Planificacion asignada' : 'Sin plan semanal', icon: 'fa-calendar-week' },
            { label: 'Estado', value: trabajadorActual?.disponible ? 'Listo' : 'Pend.', meta: estadoUsuarioDashboard, icon: 'fa-circle-check' }
        ];
    const mobileQuickActions = isAdmin
        ? [
            { view: 'control', icon: 'fa-sliders', label: 'Control' },
            { view: 'semanal', icon: 'fa-calendar-week', label: 'Semana' },
            { view: 'trabajadores', icon: 'fa-users', label: 'Equipo' },
            { view: 'insumos', icon: 'fa-box-open', label: 'Insumos' }
        ]
        : [
            { view: 'dashboard', icon: 'fa-helmet-safety', label: 'Trabajos' },
            { view: 'semanal', icon: 'fa-calendar-week', label: 'Semana' },
            { view: 'mis_horas', icon: 'fa-clock', label: 'Horas' },
            { view: 'perfil', icon: 'fa-id-badge', label: 'Perfil' }
        ];
    const mobileHighlights = isAdmin
        ? [
            {
                label: 'Unidad foco',
                value: unidadFocoDiaria?.nombre || 'Sin foco',
                meta: unidadFocoDiaria ? `${unidadFocoDiaria.active} activa(s) y ${unidadFocoDiaria.queue} en cola` : 'Aun no hay actividad relevante'
            },
            {
                label: 'Siguiente OT',
                value: tituloTareaDashboard(proximaEnCola),
                meta: subtituloTareaDashboard(proximaEnCola)
            },
            {
                label: 'Ultimo cierre',
                value: ultimoCierreHoy ? tituloTareaDashboard(ultimoCierreHoy) : 'Sin cierres',
                meta: ultimoCierreHoy ? new Date(ultimoCierreHoy.created_at).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) : 'Se mostrara cuando se cierre una OT'
            }
        ]
        : [
            {
                label: 'Trabajo actual',
                value: tituloTareaDashboard(tareasPersonalesActivas[0] || tareasPersonales[0] || null),
                meta: subtituloTareaDashboard(tareasPersonalesActivas[0] || tareasPersonales[0] || null)
            },
            {
                label: 'Lo que sigue',
                value: tituloTareaDashboard(tareasPersonalesCola[0] || tareasPersonalesSemana[0] || null),
                meta: subtituloTareaDashboard(tareasPersonalesCola[0] || tareasPersonalesSemana[0] || null)
            }
        ];
    const tareasPreviewMobile = (isAdmin ? _tareasConPos : tareasPersonales).slice(0, 3);
    const tareaActualMobile = !isAdmin ? (tareasPersonalesActivas[0] || null) : null;
    const siguienteTareaMobile = !isAdmin ? (tareasPersonalesCola[0] || tareasPersonalesSemana[0] || null) : null;
    const tareaActualTitulo = tituloTareaDashboard(tareaActualMobile);
    const tareaActualSubtitulo = subtituloTareaDashboard(tareaActualMobile);
    const tareaActualTecnicos = tareaActualMobile
        ? [tareaActualMobile.liderNombre, ...(tareaActualMobile.ayudantesNombres || [])].filter(Boolean).join(', ')
        : '';
    const workerPrimaryActionHtml = !isAdmin
        ? (tareaActualMobile
            ? `<button type="button" class="worker-now-primary" onclick="window.completarTareaExposed('${tareaActualMobile.id}', '${tareaActualMobile.liderId || ''}', '${(tareaActualMobile.ayudantesIds || []).join(',')}')"><i class="fa-solid fa-flag-checkered"></i> Terminar trabajo</button>`
            : `<button type="button" class="worker-now-primary" onclick="window.dashboardMobileNavigate('${trabajadorActual?.disponible ? 'semanal' : 'perfil'}')"><i class="fa-solid ${trabajadorActual?.disponible ? 'fa-calendar-week' : 'fa-circle-check'}"></i> ${trabajadorActual?.disponible ? 'Ver trabajos' : 'Revisar jornada'}</button>`)
        : '';
    const workerNowPanelHtml = !isAdmin
        ? `
            <div class="worker-now-card ${tareaActualMobile ? 'has-task' : 'is-empty'}">
                <div class="worker-now-head">
                    <span class="worker-now-label">${tareaActualMobile ? 'Trabajo actual' : 'Jornada sin trabajo activo'}</span>
                    <span class="worker-now-state">${trabajadorActual?.disponible ? 'Con check-in' : 'Sin check-in'}</span>
                </div>
                <strong>${escapeHtml(tareaActualMobile ? tareaActualTitulo : 'Sin OT activa por ahora')}</strong>
                <p>${escapeHtml(tareaActualMobile ? tareaActualSubtitulo : 'Cuando te asignen una tarea, aparecera aqui con su accion principal.')}</p>
                ${tareaActualMobile ? `
                    <div class="worker-now-meta">
                        <span><i class="fa-solid fa-location-dot"></i> ${escapeHtml(obtenerUbicacionTarea(tareaActualMobile))}</span>
                        ${tareaActualTecnicos ? `<span><i class="fa-solid fa-users"></i> ${escapeHtml(tareaActualTecnicos)}</span>` : ''}
                    </div>
                ` : ''}
                ${siguienteTareaMobile ? `
                    <div class="worker-next-line">
                        <span>Siguiente</span>
                        <strong>${escapeHtml(tituloTareaDashboard(siguienteTareaMobile))}</strong>
                    </div>
                ` : ''}
                ${workerPrimaryActionHtml}
            </div>
        `
        : '';
    const tareasSemanaFuturas = !isAdmin
        ? tareasPersonalesSemana.filter((tarea) => !tareasPersonales.some((actual) => actual.id === tarea.id)).slice(0, 3)
        : [];
    const mobilePreviewAction = isAdmin
        ? { view: 'control', label: 'Abrir control' }
        : { view: 'perfil', label: 'Abrir jornada' };
    const workerWeekPanelHtml = !isAdmin
        ? `
            <div class="dashboard-mobile-panel">
                <div class="dashboard-mobile-panel-head">
                    <div>
                        <span class="dashboard-mobile-panel-label">Semana en vista</span>
                        <h3>Lo que viene despues de hoy</h3>
                    </div>
                    <button type="button" class="dashboard-mobile-inline-link" onclick="window.dashboardMobileNavigate('semanal')">Abrir semana</button>
                </div>
                ${tareasSemanaFuturas.length
                    ? `<div class="dashboard-mobile-task-list">
                        ${tareasSemanaFuturas.map((tarea) => `
                            <article class="dashboard-mobile-task-item">
                                <div class="dashboard-mobile-task-copy">
                                    <strong>${escapeHtml(tituloTareaDashboard(tarea))}</strong>
                                    <span>${escapeHtml(subtituloTareaDashboard(tarea))}</span>
                                </div>
                                <span class="dashboard-mobile-task-state is-queue">Programado</span>
                            </article>
                        `).join('')}
                    </div>`
                    : `<div class="empty-state empty-state--compact"><div><strong>Sin proxima carga semanal</strong><p>Cuando te asignen trabajos futuros los veras aqui antes de que bajen a tu jornada.</p></div></div>`
                }
            </div>
        `
        : '';
    const mobileHomeHtml = `
        <section class="dashboard-mobile-shell">
            <div class="dashboard-mobile-hero">
                <div class="dashboard-mobile-kicker">${saludoDashboard}</div>
                <div class="dashboard-mobile-profile">
                    <div class="dashboard-mobile-profile-main">
                        <span class="dashboard-mobile-avatar">${escapeHtml(String(nombreUsuarioCorto || 'P').charAt(0).toUpperCase())}</span>
                        <div class="dashboard-mobile-profile-copy">
                            <strong>${escapeHtml(nombreUsuarioCorto || 'Planify')}</strong>
                            <span>${escapeHtml(rolUsuarioDashboard)}</span>
                        </div>
                    </div>
                    <span class="dashboard-mobile-status-pill">${escapeHtml(estadoUsuarioDashboard)}</span>
                </div>
                <div class="dashboard-mobile-meta-row">
                    <span><i class="fa-regular fa-calendar"></i> ${escapeHtml(resumenFecha)}</span>
                    <span><i class="fa-solid fa-location-dot"></i> ${escapeHtml(ubicacionUsuarioDashboard)}</span>
                </div>
            </div>

            ${workerNowPanelHtml}

            <div class="dashboard-mobile-stats">
                ${mobilePrimaryStats.map((item) => `
                    <article class="dashboard-mobile-stat-card">
                        <span class="dashboard-mobile-stat-icon"><i class="fa-solid ${item.icon}"></i></span>
                        <strong>${escapeHtml(String(item.value))}</strong>
                        <span>${escapeHtml(item.label)}</span>
                        <small>${escapeHtml(item.meta)}</small>
                    </article>
                `).join('')}
            </div>

            <div class="dashboard-mobile-panel">
                <div class="dashboard-mobile-panel-head">
                    <div>
                        <span class="dashboard-mobile-panel-label">Accesos rapidos</span>
                        <h3>${isAdmin ? 'Gestiona el turno' : 'Tu jornada'}</h3>
                    </div>
                </div>
                <div class="dashboard-mobile-actions-grid">
                    ${mobileQuickActions.map((item) => `
                        <button type="button" class="dashboard-mobile-action-btn" onclick="window.dashboardMobileNavigate('${item.view}')">
                            <i class="fa-solid ${item.icon}"></i>
                            <span>${escapeHtml(item.label)}</span>
                        </button>
                    `).join('')}
                </div>
            </div>

            <div class="dashboard-mobile-panel">
                <div class="dashboard-mobile-panel-head">
                    <div>
                        <span class="dashboard-mobile-panel-label">${isAdmin ? 'Panorama rapido' : 'Tu foco de hoy'}</span>
                        <h3>${isAdmin ? 'Lo mas importante del turno' : 'Tus trabajos y proximos pasos'}</h3>
                    </div>
                </div>
                <div class="dashboard-mobile-highlight-grid">
                    ${mobileHighlights.map((item) => `
                        <article class="dashboard-mobile-highlight-card">
                            <span>${escapeHtml(item.label)}</span>
                            <strong>${escapeHtml(item.value)}</strong>
                            <small>${escapeHtml(item.meta)}</small>
                        </article>
                    `).join('')}
                </div>
            </div>

            <div class="dashboard-mobile-panel">
                <div class="dashboard-mobile-panel-head">
                    <div>
                        <span class="dashboard-mobile-panel-label">${isAdmin ? 'Radar de tareas' : 'Tus trabajos'}</span>
                        <h3>${isAdmin ? 'Vista rapida del tablero' : 'Lo que tienes asignado ahora'}</h3>
                    </div>
                    <button type="button" class="dashboard-mobile-inline-link" onclick="window.dashboardMobileNavigate('${mobilePreviewAction.view}')">${mobilePreviewAction.label}</button>
                </div>
                ${tareasPreviewMobile.length
                    ? `<div class="dashboard-mobile-task-list">
                        ${tareasPreviewMobile.map((tarea) => `
                            <article class="dashboard-mobile-task-item">
                                <div class="dashboard-mobile-task-copy">
                                    <strong>${escapeHtml(tituloTareaDashboard(tarea))}</strong>
                                    <span>${escapeHtml(subtituloTareaDashboard(tarea))}</span>
                                </div>
                                <span class="dashboard-mobile-task-state ${tarea._enCola ? 'is-queue' : 'is-active'}">${tarea._enCola ? 'En cola' : 'Activo'}</span>
                            </article>
                        `).join('')}
                    </div>`
                    : `<div class="empty-state empty-state--compact"><div><strong>${isAdmin ? 'Sin movimiento aun' : 'Sin trabajos asignados'}</strong><p>${isAdmin ? 'Cuando entren OTs o mediciones veras el resumen del turno aqui.' : 'Cuando te asignen trabajo o una OT entre en cola aparecera aqui.'}</p></div></div>`
                }
            </div>
            ${workerWeekPanelHtml}
        </section>
    `;
    const esWorkerHomeMovil = !isAdmin && window.matchMedia('(max-width: 768px)').matches;
    if (esWorkerHomeMovil) {
        mainContent.innerHTML = `
            <div class="dashboard-grid fade-in" style="grid-template-columns:1fr; max-width:800px; margin:0 auto;">
                <div class="dashboard-lists">
                    ${mobileHomeHtml}
                </div>
            </div>
        `;
        window.dashboardMobileNavigate = function(view) {
            vistaActual = view;
            renderizarVistaActual();
        };
        return;
    }
    const mapaUnidadHtml = resumenUnidades.length > 0
        ? `<div class="daily-unit-map-grid">
            ${resumenUnidades.map(unidad => {
                const unidadSafe = String(unidad.nombre || '').replace(/'/g, "\\'");
                const segmentos = [
                    unidad.active ? `<span class="daily-unit-map-band-segment is-active" style="flex:${unidad.active}"></span>` : '',
                    unidad.queue ? `<span class="daily-unit-map-band-segment is-queue" style="flex:${unidad.queue}"></span>` : '',
                    unidad.closedToday ? `<span class="daily-unit-map-band-segment is-closed" style="flex:${unidad.closedToday}"></span>` : '',
                    unidad.measuresToday ? `<span class="daily-unit-map-band-segment is-measure" style="flex:${unidad.measuresToday}"></span>` : ''
                ].join('');
                return `
                <button type="button" class="daily-unit-map-card ${unidad.statusClass}" onclick="window.abrirVistaUnidad('${unidadSafe}')">
                    <div class="daily-unit-map-top">
                        <div>
                            <span class="daily-unit-map-label">${unidad.topSpecialty}</span>
                            <h3>${unidad.nombre}</h3>
                        </div>
                        <span class="daily-unit-map-status ${unidad.statusClass}">${unidad.statusLabel}</span>
                    </div>
                    <div class="daily-unit-map-main">
                        <div class="daily-unit-map-number">${unidad.active}</div>
                        <div>
                            <strong>${unidad.active === 1 ? 'Activo ahora' : 'Activos ahora'}</strong>
                            <span>${unidad.active + unidad.queue} trabajo(s) del turno</span>
                        </div>
                    </div>
                    <div class="daily-unit-map-stats">
                        <div><strong>${unidad.queue}</strong><span>En cola</span></div>
                        <div><strong>${unidad.closedToday}</strong><span>Cierres hoy</span></div>
                        <div><strong>${unidad.measuresToday}</strong><span>Mediciones</span></div>
                        <div><strong>${unidad.crew.size}</strong><span>Personal</span></div>
                    </div>
                    <div class="daily-unit-map-band">${segmentos || '<span class="daily-unit-map-band-segment is-empty" style="flex:1"></span>'}</div>
                    <div class="daily-unit-map-foot">
                        <span><i class="fa-regular fa-clock"></i> Ult. ${unidad.ultimaActividad}</span>
                        <span><i class="fa-solid fa-arrow-up-right-from-square"></i> Ver equipos</span>
                    </div>
                </button>`;
            }).join('')}
        </div>`
        : `<div class="empty-state"><div><strong>Sin unidades con movimiento hoy</strong><p>Cuando entren trabajos, cierres o mediciones del dia, el mapa operacional aparecera aqui.</p></div></div>`;

    // Panel de Asignación — Drawer deslizable (solo admin)
    let panelAsignacionHtml = '';
    if (isAdmin) {
        const _lbl  = 'font-size:14px; font-weight:600; color:#1e293b; display:block; margin-bottom:0.4rem;';
        const _div  = 'padding-top:1.1rem; margin-top:1.1rem; border-top:1px solid #e2e8f0;';
        const _inp  = 'width:100%; padding:0.55rem 0.8rem; border:1.5px solid #cbd5e1; border-radius:8px; font-size:14px; color:#1e293b; background:#fff; box-sizing:border-box;';
        panelAsignacionHtml = `
            <!-- Backdrop -->
            <div id="asign-backdrop" onclick="window.cerrarDrawerAsignacion()"
                style="display:none; position:fixed; inset:0; background:rgba(0,0,0,0.35); z-index:499;"></div>

            <!-- Drawer lateral — desliza desde la IZQUIERDA -->
            <div id="asign-drawer"
                style="position:fixed; top:0; left:0; width:380px; max-width:100vw; height:100vh;
                       background:#ffffff; z-index:500; transform:translateX(-100%);
                       transition:transform 0.3s cubic-bezier(.4,0,.2,1);
                       box-shadow:6px 0 32px rgba(0,0,0,0.18); display:flex; flex-direction:column;">

                <!-- Header -->
                <div style="padding:1.1rem 1.4rem; border-bottom:1px solid #e2e8f0; display:flex; align-items:center; justify-content:space-between; flex-shrink:0; background:#fff;">
                    <h2 style="margin:0; font-size:1.05rem; font-weight:700; color:#1e293b;">
                        <i class="fa-solid fa-clipboard-user" style="color:var(--primary-color);"></i> Asignar técnicos
                    </h2>
                    <button onclick="window.cerrarDrawerAsignacion()"
                        style="background:#f1f5f9; border:none; cursor:pointer; color:#475569; font-size:1rem; font-weight:700; width:32px; height:32px; border-radius:8px; display:flex; align-items:center; justify-content:center;"
                        onmouseover="this.style.background='#e2e8f0'" onmouseout="this.style.background='#f1f5f9'">✕</button>
                </div>

                <div class="assignment-stepper">
                    <span><strong>1</strong> Trabajo</span>
                    <span><strong>2</strong> Líder</span>
                    <span><strong>3</strong> Técnicos</span>
                    <span><strong>4</strong> Confirmar</span>
                </div>

                <!-- Cuerpo scrolleable -->
                <div style="padding:1.2rem 1.4rem; flex:1; overflow-y:auto; background:#fff;">

                <div style="margin-bottom:1rem;">
                    <label style="${_lbl}"><i class="fa-solid fa-hashtag" style="color:var(--primary-color);"></i> Número de OT <span style="font-weight:400; color:#64748b;">(Opcional)</span></label>
                    <input type="text" id="input-ot-trabajo" class="form-control" placeholder="Ej: OT-1052" style="${_inp} text-transform:uppercase;">
                </div>

                <div style="${_div}">
                    <label style="${_lbl}"><i class="fa-solid fa-map-marker-alt" style="color:var(--primary-color);"></i> Ubicación</label>
                    <select id="select-ubicacion" class="form-control" style="${_inp}">
                        <option value="">-- Seleccione una ubicación --</option>
                        ${[...new Set([...ubicacionesDisponibles, ...estado.equipos.map(e => e.ubicacion).filter(Boolean)])].sort((a,b) => a.localeCompare(b,'es')).map(u => `<option value="${u}">${u}</option>`).join('')}
                    </select>
                </div>

                <div style="${_div}">
                    <label style="${_lbl}"><i class="fa-solid fa-gears" style="color:var(--primary-color);"></i> Equipo / Activo</label>
                    <div style="position:relative;">
                        <div style="position:relative;">
                            <i class="fa-solid fa-magnifying-glass" style="position:absolute; left:0.75rem; top:50%; transform:translateY(-50%); color:#94a3b8; pointer-events:none; font-size:0.85rem;"></i>
                            <input type="text" id="equipo-search" placeholder="Seleccione ubicación primero..." disabled autocomplete="off"
                                style="${_inp} padding-left:2.2rem;">
                        </div>
                        <div id="equipo-dropdown" style="display:none; position:absolute; z-index:600; width:100%; background:#ffffff; border:1.5px solid #cbd5e1; border-radius:8px; max-height:240px; overflow-y:auto; box-shadow:0 8px 24px rgba(0,0,0,0.12); margin-top:3px;"></div>
                        <input type="hidden" id="select-equipo" value="">
                    </div>
                    <button id="btn-agregar-equipo" type="button" class="btn btn-outline" style="width:100%; margin-top:0.5rem; font-size:0.82rem; color:#6366f1; border-color:#a5b4fc;">
                        <i class="fa-solid fa-plus"></i> No encuentro el equipo, agregar nuevo
                    </button>
                </div>

                <div style="${_div}">
                    <label style="${_lbl}">Tipo de Especialidad <span style="font-weight:400; color:#64748b; font-size:13px;">(elige uno o varios)</span></label>
                    <div id="select-trabajo" style="border:1.5px solid #e2e8f0; border-radius:8px; padding:0.3rem 0; background:#f8fafc;"></div>
                    <div id="tipos-trabajo-badges" style="display:flex; flex-wrap:wrap; gap:0.4rem; margin-top:0.5rem; min-height:20px;"></div>
                </div>

                <div id="dashboard-comp-section" style="display:none; ${_div}">
                    <label style="${_lbl}">Componentes <span style="font-weight:400; color:#64748b;">(desmarcar los que no aplican)</span></label>
                    <div id="dashboard-comp-list" style="display:flex; flex-wrap:wrap; gap:0.5rem; padding:0.6rem; background:#f8fafc; border-radius:8px; border:1.5px solid #e2e8f0;"></div>
                </div>

                <div style="${_div}">
                    <label style="${_lbl}"><i class="fa-solid fa-user-tie" style="color:var(--primary-color);"></i> Líder / Supervisor</label>
                    <select id="select-empleado" class="form-control" disabled style="${_inp}">
                        <option value="">Seleccione trabajo primero...</option>
                    </select>
                    <small id="empleado-hint" style="display:block; margin-top:0.4rem; color:#64748b; font-size:13px;"></small>
                </div>

                <div id="ayudantes-container" style="display:none; ${_div}">
        <label style="${_lbl}"><i class="fa-solid fa-users" style="color:var(--primary-color);"></i> Técnicos asignados <span style="font-weight:400; color:#64748b;">(Opcional)</span></label>
                    <p style="font-size:13px; color:#64748b; margin:0 0 0.5rem 0;">Primero veras los mejores candidatos por habilidad y disponibilidad.</p>
                    <div id="tecnicos-recomendados" class="assignment-recommended"></div>
                    <div id="lista-ayudantes" class="assignment-tech-list">
                        <!-- checkboxes via JS -->
                    </div>
                </div>

                <div style="${_div}">
                    <label style="${_lbl}"><i class="fa-solid fa-triangle-exclamation" style="color:var(--warning-color);"></i> ¿Espacio confinado?</label>
                    <div style="display:flex; gap:1.2rem; padding:0.35rem 0;">
                        <label style="display:flex; align-items:center; gap:0.4rem; cursor:pointer; font-size:14px; color:#1e293b;">
                            <input type="radio" name="confinado-asign" value="no" checked style="accent-color:#FF6900;"> No
                        </label>
                        <label style="display:flex; align-items:center; gap:0.4rem; cursor:pointer; font-size:14px; color:#1e293b;">
                            <input type="radio" name="confinado-asign" value="si" style="accent-color:#FF6900;"> Sí
                        </label>
                    </div>
                    <div id="asign-vigia-wrap" style="display:none; margin-top:0.7rem;">
                        <div style="background:#fef3c7; color:#92400e; border:1px solid #fcd34d; border-radius:8px; padding:0.55rem 0.8rem; font-size:13px; margin-bottom:0.6rem;">
                            <i class="fa-solid fa-triangle-exclamation"></i> Se requiere vigía para espacios confinados.
                        </div>
                        <label style="${_lbl}">Vigía asignado</label>
                        <select id="asign-vigia" class="form-control" style="${_inp}">
                            <option value="">— Seleccionar —</option>
                        </select>
                    </div>
                </div>

                <div id="queuing-option-container" style="${_div}">
                    <label style="display:flex; align-items:center; cursor:pointer; gap:0.6rem; font-size:14px; color:#1e293b;">
                        <input type="checkbox" id="check-poner-en-cola" style="transform: scale(1.3);">
                        <span><i class="fa-solid fa-clock-rotate-left" style="color:var(--warning-color)"></i> Poner esta tarea <strong>En Cola</strong></span>
                    </label>
                    <p style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.4rem;">Si marcas esto, los trabajadores verán la tarea pero no aparecerán como bloqueados.</p>
                </div>

                <div style="${_div} display:flex; gap:0.8rem;">
                    <button id="btn-asignar" class="btn btn-primary" style="flex:1; font-size:15px; padding:0.65rem;" disabled>
                        <i class="fa-solid fa-paper-plane"></i> Asignar Trabajo
                    </button>
                </div>

                </div><!-- /body scroll -->
            </div><!-- /drawer -->
        `;
    }

    // Template
    let html = `
        ${panelAsignacionHtml}
        <div class="dashboard-grid fade-in" style="grid-template-columns:1fr; ${!isAdmin ? 'max-width:800px; margin:0 auto;' : ''}">

            <!-- Lista de trabajos (ocupa todo el ancho) -->
            <div class="dashboard-lists">
                ${mobileHomeHtml}
                <div class="worker-home-secondary">

                <section class="panel daily-news-entry-panel">
                    <div class="daily-news-entry-copy">
                        <span class="dashboard-eyebrow">Documento operativo</span>
                        <h2>&#x1F4CB; Informe de Novedades Diarias</h2>
                        <p>Completa categorías, OTs, actividades, observaciones y fotos manualmente. La exportación usa el Word de referencia APPLUS como plantilla real.</p>
                    </div>
                    <div class="daily-news-entry-actions">
                        <button type="button" class="btn btn-success" onclick="window.abrirInformeNovedadesDiarias()">
                            <i class="fa-solid fa-file-word"></i> Abrir informe
                        </button>
                    </div>
                </section>

                <div class="panel">
                    <div class="panel-header" style="justify-content: space-between;">
                        <h2><i class="fa-solid fa-person-digging" style="color:var(--warning-color)"></i> Trabajos Efectivos (${tareasDiarias.length})</h2>
                        <div style="display:flex; gap:0.6rem; align-items:center; flex-wrap:wrap;">
                        ${isAdmin ? `
                            <button onclick="window.abrirDrawerAsignacion()" class="btn btn-primary" style="font-size:0.85rem; padding:0.45rem 1rem; border-radius:8px; display:flex; align-items:center; gap:0.4rem;">
                                <i class="fa-solid fa-plus"></i> Asignar trabajo
                            </button>
                        ` : ''}
                        ${isAdmin && tareasDiarias.length > 0 ? `
                            <button class="btn btn-outline" style="border-color: var(--danger-color); color: var(--danger-color); font-size: 0.8rem; padding: 0.3rem 0.6rem;" onclick="window.eliminarTodasLasTareasExposed()">
                                <i class="fa-solid fa-trash-can"></i> Vaciar Tablero
                            </button>
                        ` : ''}
                        </div>
                    </div>
                    ${(() => {
                        if (_tareasConPos.length === 0) return `<div class="empty-state"><div><strong>Sin trabajos activos</strong><p>Cuando se asignen o inicien tareas aparecerán aquí con su estado y prioridad.</p></div></div>`;
                        const _svgGear = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--primary-color)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
                        const _svgDrop = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--primary-color)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>`;
                        function colHTML(tareas, titulo, svgIcon, subtitulo, emptyMsg) {
                            return `<div class="daily-squad-column" style="flex:1; min-width:280px; border-top:3px solid var(--primary-color); padding-top:1.1rem; padding-bottom:0.25rem;">
                                <div class="daily-squad-header">
                                    <div class="daily-squad-heading">
                                        <span class="daily-squad-icon">${svgIcon}</span>
                                        <div class="daily-squad-heading-copy">
                                            <span class="daily-squad-title">${titulo}</span>
                                            <span class="daily-squad-subtitle">${tareas.length > 0 ? `${activos} activo(s) · ${enCola} en cola` : subtitulo}</span>
                                        </div>
                                    </div>
                                    <div class="daily-squad-summary">
                                        <span class="daily-squad-kpi is-active">${activos} activos</span>
                                        <span class="daily-squad-kpi is-queue">${enCola} cola</span>
                                        <span class="daily-squad-total">${tareas.length}</span>
                                    </div>
                                </div>
                                ${tareas.length === 0
                                    ? `<div class="empty-state empty-state--compact"><div><strong>${emptyMsg}</strong><p>Esta columna se llenará automáticamente cuando entren trabajos de esa especialidad.</p></div></div>`
                                    : `<div class="items-list daily-squad-list">${tareas.map(t => _htmlTareaCard(t, isAdmin, colaTareas)).join('')}</div>`}
                            </div>`;
                        }
                        function colHTMLLegacy(tareas, titulo, svgIcon, subtitulo, emptyMsg) {
                            return `<div class="daily-squad-column" style="flex:1; min-width:280px; border-top:3px solid var(--primary-color); padding-top:1.1rem; padding-bottom:0.25rem;">
                                <div class="daily-squad-header" style="display:flex; align-items:center; gap:0.55rem; margin-bottom:0.85rem;">
                                    ${svgIcon}
                                    <span class="daily-squad-title" style="font-weight:700; font-size:1rem; color:var(--text-main);">${titulo}</span>
                                    <span class="daily-squad-total" style="background:var(--primary-color); color:#fff; border-radius:999px; padding:0.1rem 0.55rem; font-size:0.72rem; font-weight:700; margin-left:0.1rem;">${tareas.length}</span>
                                </div>
                                ${tareas.length === 0
                                    ? `<div class="empty-state empty-state--compact"><div><strong>${emptyMsg}</strong><p>Esta columna se llenar\u00e1 autom\u00e1ticamente cuando entren trabajos de esa especialidad.</p></div></div>`
                                    : `<div class="items-list daily-squad-list">${tareas.map(t => _htmlTareaCard(t, isAdmin, colaTareas)).join('')}</div>`}
                            </div>`;
                        }
                        return `<div class="daily-squad-grid" style="display:flex; gap:1.5rem; flex-wrap:wrap; align-items:flex-start;">
                            ${colHTMLLegacy(vibraciones, 'Equipo Vibraciones', _svgGear, '', 'Sin trabajos de vibraciones')}
                            ${colHTMLLegacy(lubricacion, 'Equipo Lubricación', _svgDrop, '', 'Sin trabajos de lubricación')}
                        </div>
                        ${otros.length > 0 ? `<div class="daily-squad-extra" style="margin-top:1.25rem; border-top:1px solid var(--border-color); padding-top:0.85rem;">
                            <h3 class="daily-squad-extra-title" style="font-size:0.95rem; margin:0 0 0.75rem 0; display:flex; align-items:center; gap:0.5rem; color:var(--text-muted);">
                                <span>📋</span><span>Otros trabajos</span>
                                <span class="daily-squad-extra-count" style="background:#6b728022; color:#6b7280; border-radius:999px; padding:0.1rem 0.55rem; font-size:0.75rem; font-weight:700;">${otros.length}</span>
                            </h3>
                            <div class="items-list daily-squad-list">${otros.map(t => _htmlTareaCard(t, isAdmin, colaTareas)).join('')}</div>
                        </div>` : ''}`;
                    })()}
                </div>
                </div>

            </div>
        </div>
    `;
    mainContent.innerHTML = html;
    window.dashboardMobileNavigate = function(view) {
        vistaActual = view;
        renderizarVistaActual();
    };

    // --- Funciones del drawer de asignación ---
    document.getElementById('btn-open-insumos-dashboard')?.addEventListener('click', () => {
        vistaActual = 'insumos';
        renderizarVistaActual();
    });

    window.abrirDrawerAsignacion = function() {
        const drawer   = document.getElementById('asign-drawer');
        const backdrop = document.getElementById('asign-backdrop');
        if (drawer)   drawer.style.transform = 'translateX(0)';
        if (backdrop) backdrop.style.display = 'block';
    };
    window.cerrarDrawerAsignacion = function() {
        const drawer   = document.getElementById('asign-drawer');
        const backdrop = document.getElementById('asign-backdrop');
        if (drawer)   drawer.style.transform = 'translateX(-100%)';
        if (backdrop) backdrop.style.display = 'none';
    };

    // --- LOGICA DE FORMULARIO DE ASIGNACIÓN (Solo si existe) ---
    if (isAdmin) {
        const selectUbicacion = document.getElementById('select-ubicacion');
        const selectEquipo   = document.getElementById('select-equipo');   // hidden input
        const equipoSearch   = document.getElementById('equipo-search');
        const equipoDropdown = document.getElementById('equipo-dropdown');
        let equipoGruposData = [];     // [{id, activo, ids, componentes:[]}]
        let selectedEquipoData = null; // el grupo actualmente seleccionado

        const selectTrabajoContainer = document.getElementById('select-trabajo');
        const tiposBadgesEl = document.getElementById('tipos-trabajo-badges');
        const selectEmpleado = document.getElementById('select-empleado');
        const hintEmpleado = document.getElementById('empleado-hint');
        const btnAsignar = document.getElementById('btn-asignar');
        const btnAgregarEquipo = document.getElementById('btn-agregar-equipo');
        const inputOt = document.getElementById('input-ot-trabajo');

        // ── Espacio confinado + vigía ────────────────────────────────────────
        const vigiaWrap = document.getElementById('asign-vigia-wrap');
        const vigiaSel  = document.getElementById('asign-vigia');
        if (vigiaSel) {
            vigiaSel.innerHTML = '<option value="">— Seleccionar —</option>' +
                estado.trabajadores.map(t =>
                    `<option value="${t.id}">${t.nombre}${t.cargo ? ` — ${t.cargo}` : ''}</option>`
                ).join('');
        }
        document.querySelectorAll('input[name="confinado-asign"]').forEach(r => {
            r.addEventListener('change', () => {
                if (vigiaWrap) vigiaWrap.style.display = (r.value === 'si' && r.checked) ? 'block' : 'none';
            });
        });

        // Estado local de tipos seleccionados
        let tiposSeleccionados = [];

        // ── Chips multi-select para tipos de trabajo ──────────────────────────
        function buildTipoChips() {
            selectTrabajoContainer.innerHTML = tipicosTrabajos.map(t => {
                const sel = tiposSeleccionados.includes(t);
                return `<label style="display:flex; align-items:center; gap:0.7rem; padding:0.5rem 0.8rem; cursor:pointer;
                        font-size:14px; font-weight:${sel?'600':'400'}; color:#1e293b;
                        background:${sel ? 'rgba(255,105,0,0.08)' : '#fff'}; transition:background 120ms;
                        border-bottom:1px solid #f1f5f9;"
                        onmouseover="this.style.background='${sel ? 'rgba(255,105,0,0.12)' : '#f8fafc'}'"
                        onmouseout="this.style.background='${sel ? 'rgba(255,105,0,0.08)' : '#fff'}'">
                    <input type="checkbox" class="tipo-chip-check" value="${t}" ${sel ? 'checked' : ''}
                        style="accent-color:#FF6900; width:18px; height:18px; flex-shrink:0; cursor:pointer;">
                    <span style="flex:1;">${t}</span>
                    ${sel ? '<i class="fa-solid fa-check" style="color:#FF6900; font-size:12px;"></i>' : ''}
                </label>`;
            }).join('');
            selectTrabajoContainer.querySelectorAll('.tipo-chip-check').forEach(cb => {
                cb.addEventListener('change', onTipoChange);
            });
        }

        function renderTiposBadges() {
            tiposBadgesEl.innerHTML = tiposSeleccionados.map(t =>
                `<span style="display:inline-flex; align-items:center; background:rgba(255,105,0,0.15);
                    color:#FF6900; border:1px solid rgba(255,105,0,0.4); border-radius:999px;
                    font-size:0.75rem; font-weight:600; padding:2px 10px;">${t}</span>`
            ).join('');
        }

        function onTipoChange(e) {
            if (e.target.checked) {
                if (!tiposSeleccionados.includes(e.target.value)) tiposSeleccionados.push(e.target.value);
            } else {
                tiposSeleccionados = tiposSeleccionados.filter(t => t !== e.target.value);
            }
            buildTipoChips();
            renderTiposBadges();
            onTipoSelectionChange();
        }

        function onTipoSelectionChange() {
            if (tiposSeleccionados.length === 0) {
                selectEmpleado.innerHTML = '<option value="">Seleccione trabajo primero...</option>';
                selectEmpleado.disabled = true;
                hintEmpleado.textContent = '';
                actualizarAyudantes('');
                validarFormulario();
                return;
            }
            const aptos = trabajadoresValidados.filter(t =>
                tiposSeleccionados.some(tipo => t.habilidades.includes(tipo))
            );
            if (aptos.length > 0) {
                selectEmpleado.disabled = false;
                selectEmpleado.innerHTML = `<option value="">-- Elija al Líder / Responsable --</option>` +
                    aptos.map(t => {
                        const sufijo = t.ocupado ? ' ⚠ (Trabajando→Cola)' : (!t.disponible ? ' ○ (Sin check-in→Cola)' : '');
                        return `<option value="${t.id}">${t.nombre}${sufijo}</option>`;
                    }).join('');
                hintEmpleado.innerHTML = `<span style="color:var(--success-color)"><i class="fa-solid fa-circle-check"></i> ${aptos.length} persona(s) capacitada(s).</span>`;
                actualizarAyudantes('');
            } else {
                selectEmpleado.disabled = true;
                selectEmpleado.innerHTML = '<option value="">Sin empleados capacitados para este trabajo</option>';
                hintEmpleado.innerHTML = `<span style="color:var(--danger-color)"><i class="fa-solid fa-triangle-exclamation"></i> Nadie tiene esta especialidad.</span>`;
                actualizarAyudantes('');
                validarFormulario();
            }
        }

        buildTipoChips();

        // Validación para habilitar el botón de asignar
        function validarFormulario() {
            const ubicacionValid = selectUbicacion.value !== '';
            const equipoValid = selectEquipo.value !== '';
            const empleadoValid = selectEmpleado.value !== '';
            const tipoValid = tiposSeleccionados.length > 0;
            btnAsignar.disabled = !(ubicacionValid && equipoValid && empleadoValid && tipoValid);
        }

        // Actualizar la lista de ayudantes
        function actualizarAyudantes(liderIdSeleccionado) {
            const container = document.getElementById('ayudantes-container');
            const lista = document.getElementById('lista-ayudantes');
            const recomendados = document.getElementById('tecnicos-recomendados');

            if (!liderIdSeleccionado) {
                container.style.display = 'none';
                lista.innerHTML = '';
                if (recomendados) recomendados.innerHTML = '';
                return;
            }

            // Mostrar todos los validados (excepto el líder) con habilidad en al menos un tipo
            const elegibles = trabajadoresValidados.filter(t => {
                if (t.id === liderIdSeleccionado) return false;
                if (tiposSeleccionados.length === 0) return true;
                return tiposSeleccionados.some(tipo => t.habilidades.includes(tipo));
            });

            if (elegibles.length === 0) {
                if (recomendados) recomendados.innerHTML = '';
                lista.innerHTML = '<p style="color:var(--text-muted); font-size:0.9rem; text-align:center; margin:0;">No hay personal con esta especialidad.</p>';
            } else {
                if (recomendados) {
                    const ordenados = elegibles.slice().sort((a, b) => {
                        const score = (t) => (t.disponible ? 2 : 0) + (!t.ocupado ? 1 : 0) + (t.habilidades || []).filter(h => tiposSeleccionados.includes(h)).length;
                        return score(b) - score(a) || a.nombre.localeCompare(b.nombre, 'es');
                    });
                    recomendados.innerHTML = ordenados.slice(0, 3).map(t => {
                        const estadoLabel = t.ocupado ? 'Trabajando' : (!t.disponible ? 'Sin check-in' : 'Disponible');
                        const estadoClass = t.ocupado ? 'is-busy' : (!t.disponible ? 'is-away' : 'is-ready');
                        return `<button type="button" class="assignment-recommended-card" data-tech-id="${t.id}">
                            <span class="assignment-recommended-copy">
                                <span class="assignment-recommended-name">${t.nombre}</span>
                                <span class="assignment-recommended-meta">${t.puesto || 'Técnico'}</span>
                            </span>
                            <span class="assignment-status ${estadoClass}">${estadoLabel}</span>
                        </button>`;
                    }).join('');
                }
                lista.innerHTML = elegibles.map(t => {
                    const badge = t.ocupado
                        ? `<small style="color:#d97706; font-weight:600;">[→Cola]</small>`
                        : (!t.disponible ? `<small style="color:#94a3b8;">[Sin check-in]</small>` : '');
                    return `
                    <label style="display:flex; align-items:center; cursor:pointer; padding:0.45rem 0.4rem;
                            border-bottom:1px solid #f1f5f9; margin:0; font-size:14px; color:#1e293b;">
                        <input type="checkbox" class="ayudante-checkbox" value="${t.id}"
                            style="accent-color:#FF6900; width:18px; height:18px; flex-shrink:0; margin-right:0.7rem; cursor:pointer;">
                        <span>${t.nombre} ${badge} <small style="color:#64748b;">(${t.puesto})</small></span>
                    </label>`;
                }).join('');
            }
            container.style.display = 'block';

            document.querySelectorAll('.assignment-recommended-card').forEach(btn => {
                btn.addEventListener('click', () => {
                    const checkbox = document.querySelector(`.ayudante-checkbox[value="${btn.dataset.techId}"]`);
                    if (!checkbox) return;
                    checkbox.checked = !checkbox.checked;
                    btn.classList.toggle('is-selected', checkbox.checked);
                    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
                });
            });

            // Agregar listeners
            document.querySelectorAll('.ayudante-checkbox').forEach(cb => {
                cb.addEventListener('change', () => {
                    const recommended = document.querySelector(`.assignment-recommended-card[data-tech-id="${cb.value}"]`);
                    if (recommended) recommended.classList.toggle('is-selected', cb.checked);
                    verificarNecesidadCola();
                });
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

        // ── Mostrar componentes al seleccionar un equipo ──────────────────────
        function onEquipoSelected(data) {
            selectedEquipoData = data;
            selectEquipo.value  = data.id;
            equipoSearch.value  = data.activo;
            equipoDropdown.style.display = 'none';
            validarFormulario();

            const compSection = document.getElementById('dashboard-comp-section');
            const compList    = document.getElementById('dashboard-comp-list');
            if (data.componentes.length > 0) {
                compList.innerHTML = data.componentes.map(c =>
                    `<label style="display:flex; align-items:center; gap:0.5rem; padding:0.35rem 0.65rem;
                        background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1);
                        border-radius:6px; cursor:pointer; font-size:0.88rem; color:var(--text-main); font-weight:500;"
                        onmouseover="this.style.background='rgba(255,255,255,0.1)'"
                        onmouseout="this.style.background='rgba(255,255,255,0.05)'">
                        <input type="checkbox" class="comp-dash-check" value="${c}" checked
                            style="accent-color:#FF6900; width:14px; height:14px;">
                        ${c}
                    </label>`
                ).join('');
                compSection.style.display = 'block';
            } else {
                compSection.style.display = 'none';
                compList.innerHTML = '';
            }
        }

        // ── Renderizar lista filtrada en el dropdown ──────────────────────────
        function renderDropdown(query) {
            const q = query.toLowerCase().trim();
            const filtrados = q
                ? equipoGruposData.filter(d => d.activo.toLowerCase().includes(q))
                : equipoGruposData;

            if (filtrados.length === 0) {
                equipoDropdown.innerHTML = `<div style="padding:0.7rem 1rem; font-size:0.88rem; color:var(--text-muted);">Sin resultados</div>`;
            } else {
                equipoDropdown.innerHTML = filtrados.map(d =>
                    `<div class="eq-opt" data-id="${d.id}" style="padding:0.5rem 1rem; cursor:pointer; font-size:0.9rem; color:#111827; border-bottom:1px solid rgba(0,0,0,0.06);"
                        onmouseover="this.style.background='rgba(255,105,0,0.1)'"
                        onmouseout="this.style.background=''">
                        ${d.activo}
                        ${d.componentes.length ? `<span style="font-size:0.75rem; color:#6b7280; margin-left:0.4rem;">${d.componentes.join(' · ')}</span>` : ''}
                    </div>`
                ).join('');
                equipoDropdown.querySelectorAll('.eq-opt').forEach(el => {
                    el.addEventListener('click', () => {
                        const data = equipoGruposData.find(d => d.id === el.dataset.id);
                        if (data) onEquipoSelected(data);
                    });
                });
            }
            equipoDropdown.style.display = 'block';
        }

        // Cerrar dropdown al hacer click fuera
        document.addEventListener('click', (e) => {
            if (!equipoSearch.contains(e.target) && !equipoDropdown.contains(e.target)) {
                equipoDropdown.style.display = 'none';
            }
        }, true);

        equipoSearch.addEventListener('input', () => {
            selectEquipo.value = '';
            selectedEquipoData = null;
            validarFormulario();
            renderDropdown(equipoSearch.value);
        });

        equipoSearch.addEventListener('focus', () => {
            if (equipoGruposData.length > 0) renderDropdown(equipoSearch.value);
        });

        // ── Cascade: Ubicación → poblar grupos ───────────────────────────────
        selectUbicacion.addEventListener('change', (e) => {
            const ubicacion = e.target.value;
            const compSection = document.getElementById('dashboard-comp-section');
            const compList    = document.getElementById('dashboard-comp-list');

            // Reset equipo
            equipoSearch.value  = '';
            selectEquipo.value  = '';
            selectedEquipoData  = null;
            equipoDropdown.style.display = 'none';
            compSection.style.display = 'none';
            compList.innerHTML = '';

            if (!ubicacion) {
                equipoSearch.placeholder = 'Seleccione ubicación primero...';
                equipoSearch.disabled = true;
                equipoGruposData = [];
                validarFormulario();
                return;
            }

            const equiposDeLaUbicacion = estado.equipos.filter(eq => eq.ubicacion === ubicacion);

            // Agrupar por nombre de activo
            const grupos = {};
            equiposDeLaUbicacion.forEach(eq => {
                if (!grupos[eq.activo]) grupos[eq.activo] = [];
                grupos[eq.activo].push(eq);
            });

            equipoGruposData = Object.entries(grupos)
                .sort(([a],[b]) => a.localeCompare(b))
                .map(([activo, eqs]) => ({
                    id: eqs[0].id,
                    activo,
                    ids: eqs.map(e => e.id),
                    componentes: [...new Set(
                        eqs.flatMap(eq => (eq.componente || '').split(',').map(c => c.trim()).filter(Boolean))
                    )]
                }));

            equipoSearch.placeholder = `Buscar entre ${equipoGruposData.length} equipos...`;
            equipoSearch.disabled = false;
            equipoSearch.focus();
            validarFormulario();
        });

        selectEmpleado.addEventListener('change', (e) => {
            validarFormulario();
            actualizarAyudantes(e.target.value);
            verificarNecesidadCola();
        });

        // Botón "Agregar nuevo equipo"
        btnAgregarEquipo.addEventListener('click', () => {
            const ubicPreseleccionada = selectUbicacion.value;
            document.getElementById('nuevo-equipo-ubicacion').value = ubicPreseleccionada;
            document.getElementById('modal-nuevo-equipo').style.display = 'flex';
        });

        btnAsignar.addEventListener('click', () => {
            const ubicacion = selectUbicacion.value;
            const liderId = selectEmpleado.value;
            const otNumero = inputOt.value.trim().toUpperCase();
            const equipoId = selectEquipo.value;

            const activo = selectedEquipoData?.activo || '';

            // Componentes seleccionados (checkboxes de la sección dinámica)
            const componentesSeleccionados = [...document.querySelectorAll('.comp-dash-check:checked')].map(cb => cb.value);

            const checkboxes = document.querySelectorAll('.ayudante-checkbox:checked');
            const ayudantesIds = Array.from(checkboxes).map(cb => cb.value);

            if (ubicacion && equipoId && liderId && tiposSeleccionados.length > 0) {
                const tiposStr = tiposSeleccionados.join(', ');
                // Título sin componente: los componentes se registran por separado
                const tituloFinal = `[${ubicacion}] ${activo} (${tiposStr})`;

                const enCola = document.getElementById('check-poner-en-cola').checked;
                const estadoEjecucion = enCola ? 'en_cola' : 'activo';

                const confinadoSel = document.querySelector('input[name="confinado-asign"]:checked')?.value === 'si';
                const vigiaId = confinadoSel ? (document.getElementById('asign-vigia')?.value || null) : null;
                if (confinadoSel && !vigiaId) {
                    alert('Selecciona un vigía — es obligatorio en espacio confinado.');
                    return;
                }

                asignarTarea(tituloFinal, liderId, ayudantesIds, 'en_curso', otNumero, estadoEjecucion, null, equipoId, tiposSeleccionados, componentesSeleccionados, null, confinadoSel, vigiaId);
                window.cerrarDrawerAsignacion?.();
            } else {
                if (tiposSeleccionados.length === 0) alert('Selecciona al menos un tipo de trabajo.');
            }
        });
    }
}

// COMPONENTE: Vista Semanal
function renderSemanalView() {
    // Validar si el usuario actual es admin
    const isAdmin = estado.usuarioActual === 'admin';
    const trabajador = estado.trabajadorLogueado;

    // Workers solo ven SUS tareas; admin ve todas
    // Excluir tareas con personal asignado: ya aparecen en Diario como "En Cola"
    const tareasSemanales = estado.tareas.filter(t => {
        if (t.estadoTarea !== 'programada_semana') return false;
        if (isAdmin && t.liderId) return false; // tiene personal asignado → aparece en Diario
        if (isAdmin) return true;
        return t.liderId === trabajador?.id || (t.ayudantesIds || []).includes(trabajador?.id);
    });

    const normalizarSemanal = (valor) => String(valor || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
    const formatearNumeroSemanal = (valor, maxDecimals = 1) => new Intl.NumberFormat('es-CL', {
        minimumFractionDigits: 0,
        maximumFractionDigits: maxDecimals
    }).format(Number(valor || 0));
    const getUbicSemanal = (tarea) => tarea.ubicacion || (String(tarea.tipo || '').match(/^\[([^\]]+)\]/) || [])[1] || 'Sin unidad';
    const getNombreSemanal = (tarea) => String(tarea.tipo || 'Trabajo programado')
        .replace(/^\s*\[[^\]]+\]\s*/, '')
        .replace(/\s*\([^)]+\)\s*$/, '')
        .trim();
    const getTiposSemanal = (tarea) => {
        if (Array.isArray(tarea.tiposSeleccionados) && tarea.tiposSeleccionados.length > 0) return tarea.tiposSeleccionados;
        const match = String(tarea.tipo || '').match(/\(([^)]+)\)/);
        return match?.[1] ? match[1].split(',').map(tipo => tipo.trim()).filter(Boolean) : [];
    };
    const getFechaExpSemanal = (tarea) => {
        if (!tarea.fechaExpiracion) return null;
        const fecha = new Date(`${tarea.fechaExpiracion}T00:00:00`);
        return Number.isNaN(fecha.getTime()) ? null : fecha;
    };
    const hoySemanal = new Date();
    hoySemanal.setHours(0, 0, 0, 0);
    const limiteSemanal = new Date(hoySemanal);
    limiteSemanal.setDate(limiteSemanal.getDate() + 2);
    const { vibraciones: semanalPredictivo, lubricacion: semanalLubricacion, otros: semanalOtros } = _clasificarTareasPorEspecialidad(tareasSemanales);
    const tareasVencidas = tareasSemanales.filter(t => {
        const fecha = getFechaExpSemanal(t);
        return fecha && fecha < hoySemanal;
    });
    const tareasPorVencer = tareasSemanales.filter(t => {
        const fecha = getFechaExpSemanal(t);
        return fecha && fecha >= hoySemanal && fecha <= limiteSemanal;
    });
    const unidadesSemanales = [...new Set(tareasSemanales.map(getUbicSemanal))];
    const otsSemanales = tareasSemanales.filter(t => String(t.otNumero || t.ot_numero || '').trim()).length;
    const especialidadesResumenSemanal = [
        { label: 'Predictivo', count: semanalPredictivo.length, icon: 'fa-wave-square' },
        { label: 'Lubricacion', count: semanalLubricacion.length, icon: 'fa-oil-can' },
        { label: 'Otros', count: semanalOtros.length, icon: 'fa-list-check' }
    ].sort((a, b) => b.count - a.count);
    const focoSemanal = especialidadesResumenSemanal[0] || { label: 'Sin foco', count: 0, icon: 'fa-compass' };
    const supervisorPendiente = tareasSemanales.filter(t => !t.liderNombre && !t.liderId).length;

    function getTipoBadgeStyleSemanal(tipo) {
        const normalizado = normalizarSemanal(tipo);
        if (normalizado.includes('vibrac') || normalizado.includes('termog') || normalizado.includes('espesor') || normalizado.includes('dureza') || normalizado.includes('end')) {
            return 'background:#fff7ed;color:#9a3412;border-color:rgba(249,115,22,0.22);';
        }
        if (normalizado.includes('lubric') || normalizado.includes('aceite')) {
            return 'background:#eff6ff;color:#1d4ed8;border-color:rgba(59,130,246,0.20);';
        }
        return 'background:#f8fafc;color:#475569;border-color:rgba(203,213,225,0.95);';
    }

    function renderTipoSemanal(tipo, tareaId) {
        return `<button type="button" class="weekly-task-type" onclick="window.abrirModalTipoBadge('${String(tipo).replace(/'/g, "\\'")}', '${tareaId}')" style="${getTipoBadgeStyleSemanal(tipo)}">${tipo}</button>`;
    }

    function renderCardSemanal(tarea) {
        const nombreLimpio = getNombreSemanal(tarea);
        const tipos = getTiposSemanal(tarea);
        const fechaExp = getFechaExpSemanal(tarea);
        const vencida = fechaExp && fechaExp < hoySemanal;
        const porVencer = fechaExp && fechaExp >= hoySemanal && fechaExp <= limiteSemanal;
        const supervisor = tarea.liderNombre || 'Pendiente por asignar';
        const ayudantes = Array.isArray(tarea.ayudantesNombres) ? tarea.ayudantesNombres : [];
        const otNumero = tarea.otNumero || tarea.ot_numero || '';
        const equipoId = tarea.equipoId || tarea.equipo_id || '';
        const equipoBtn = equipoId
            ? `<button class="btn btn-outline" type="button" onclick="window.abrirFichaTecnica('${equipoId}')"><i class="fa-solid fa-arrow-up-right-from-square"></i> Equipo</button>`
            : '';

        return `<article class="weekly-task-card list-item" data-weekly-card data-weekly-search="${normalizarSemanal([
            nombreLimpio,
            getUbicSemanal(tarea),
            otNumero,
            supervisor,
            ayudantes.join(' '),
            tipos.join(' ')
        ].join(' '))}">
            <div class="weekly-task-top">
                <div class="weekly-task-main">
                    <div class="weekly-task-title">${nombreLimpio}</div>
                    <div class="weekly-task-flags">
                        ${otNumero ? `<span class="weekly-group-badge"><i class="fa-solid fa-hashtag"></i> ${otNumero}</span>` : ''}
                        ${vencida ? `<span class="weekly-group-badge" style="background:#fef2f2;color:#b91c1c;border-color:rgba(239,68,68,0.22);"><i class="fa-solid fa-triangle-exclamation"></i> Vencido</span>` : ''}
                        ${!vencida && porVencer ? `<span class="weekly-group-badge" style="background:#fffbeb;color:#b45309;border-color:rgba(245,158,11,0.22);"><i class="fa-solid fa-hourglass-half"></i> Por vencer</span>` : ''}
                    </div>
                    <div class="weekly-task-meta">
                        <span><i class="fa-solid fa-location-dot"></i> ${getUbicSemanal(tarea)}</span>
                        <span><i class="fa-solid fa-user-tie"></i> ${supervisor}</span>
                        ${fechaExp ? `<span><i class="fa-regular fa-calendar"></i> ${fechaExp.toLocaleDateString('es-CL')}</span>` : `<span><i class="fa-regular fa-calendar"></i> Sin vencimiento</span>`}
                    </div>
                    ${tipos.length ? `<div class="weekly-task-types">${tipos.map(tipo => renderTipoSemanal(tipo, tarea.id)).join('')}</div>` : ''}
                    <div class="weekly-task-summary">
                        <strong>${ayudantes.length ? 'Técnicos:' : 'Estado:'}</strong>
                        ${ayudantes.length ? ayudantes.join(', ') : 'Trabajo en espera de asignacion operativa.'}
                    </div>
                    <div class="weekly-task-actions">
                        ${equipoBtn}
                        ${otNumero ? `<span class="weekly-task-chip"><i class="fa-solid fa-clipboard-list"></i> OT registrada</span>` : `<span class="weekly-task-chip"><i class="fa-regular fa-clipboard"></i> Sin OT</span>`}
                    </div>
                </div>
                <div class="weekly-task-side">
                    ${isAdmin ? `
                        <button class="btn btn-outline btn-icon" type="button" title="Eliminar" onclick="window.eliminarTareaExposed('${tarea.id}')" style="border-color:#fecaca;color:#dc2626;background:#fff5f5;">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                        <button class="btn btn-outline" type="button" onclick="asignarPersonalATarea('${tarea.id}')">
                            <i class="fa-solid fa-user-plus"></i> Asignar
                        </button>
                        <button class="btn btn-primary" type="button" onclick="comenzarTrabajoProgramado('${tarea.id}')">
                            <i class="fa-solid fa-play"></i> Iniciar hoy
                        </button>
                    ` : `
                        <button class="btn btn-primary" type="button" onclick="iniciarTareaDirecto('${tarea.id}')">
                            <i class="fa-solid fa-play"></i> Iniciar hoy
                        </button>
                        <button class="btn btn-success" type="button" onclick="window.completarTareaExposed('${tarea.id}','${tarea.liderId || ''}','${(tarea.ayudantesIds || []).join(',')}')">
                            <i class="fa-solid fa-flag-checkered"></i> Finalizar
                        </button>
                    `}
                </div>
            </div>
        </article>`;
    }
    
    // Panel de Asignación Semanal (Solo para Admin)
    let panelAsignacionHtml = '';
    if (isAdmin) {
        const excelToneStyles = {
            info: 'color:var(--primary-color);',
            warning: 'color:var(--warning-color);',
            danger: 'color:var(--danger-color);',
            success: 'color:var(--success-color);'
        };
        const excelItemsPendientes = semanalExcelImportState.items || [];
        const excelStatusHtml = semanalExcelImportState.message
            ? `<div id="excel-status" class="weekly-import-status" style="${excelToneStyles[semanalExcelImportState.tone] || excelToneStyles.info}">${escapeHtml(semanalExcelImportState.message)}</div>`
            : `<div id="excel-status" class="weekly-import-status"></div>`;
        const excelPendientesHtml = excelItemsPendientes.length
            ? `
                <div class="weekly-import-queue">
                    <div class="weekly-import-head">
                        <div>
                            <strong>${excelItemsPendientes.length} pendiente(s)</strong>
                            <span>${escapeHtml(semanalExcelImportState.fileName || 'Archivo cargado')}</span>
                        </div>
                        <button id="btn-limpiar-excel-semanal" class="btn btn-outline" type="button">
                            <i class="fa-solid fa-broom"></i> Limpiar lista
                        </button>
                    </div>
                    <div class="weekly-import-list">
                        ${excelItemsPendientes.map((t) => `
                            <article class="weekly-import-item" data-weekly-import-item="${t.id}">
                                <div class="weekly-import-copy">
                                    <div class="weekly-import-title">${escapeHtml(t.titulo)}</div>
                                    <div class="weekly-import-meta">
                                        ${t.ot ? `<span class="weekly-task-chip"><i class="fa-solid fa-hashtag"></i> ${escapeHtml(t.ot)}</span>` : ''}
                                        ${t.ubicacion ? `<span class="weekly-task-chip"><i class="fa-solid fa-location-dot"></i> ${escapeHtml(t.ubicacion)}</span>` : ''}
                                    </div>
                                </div>
                                <button data-weekly-import-id="${t.id}" class="btn btn-primary" type="button">
                                    <i class="fa-solid fa-plus"></i> Agregar
                                </button>
                            </article>
                        `).join('')}
                    </div>
                </div>
            `
            : '';
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
                    ${excelStatusHtml}
                    ${excelPendientesHtml}
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
                        ${[...new Set([...ubicacionesDisponibles, ...estado.equipos.map(e => e.ubicacion).filter(Boolean)])].sort((a,b) => a.localeCompare(b,'es')).map(u => `<option value="${u}">${u}</option>`).join('')}
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
    const gruposSemanales = tareasSemanales.reduce((acum, tarea) => {
        const unidad = getUbicSemanal(tarea);
        if (!acum[unidad]) acum[unidad] = [];
        acum[unidad].push(tarea);
        return acum;
    }, {});
    const unidadesOrdenadas = Object.keys(gruposSemanales).sort((a, b) => {
        const diff = gruposSemanales[b].length - gruposSemanales[a].length;
        return diff !== 0 ? diff : a.localeCompare(b, 'es');
    });

    let html = `
        <div class="dashboard-grid fade-in" style="${isAdmin ? '' : 'grid-template-columns: 1fr; max-width: 980px; margin: 0 auto;'}">
            ${panelAsignacionHtml}

            <div class="dashboard-lists weekly-view">
                <section class="panel weekly-hero">
                    <div class="dashboard-hero-head">
                        <div>
                            <div class="weekly-eyebrow">Planificacion operativa</div>
                            <h1 style="margin:0 0 0.4rem 0;"><i class="fa-solid fa-calendar-week"></i> Semanal</h1>
                            <p class="weekly-subtitle">${isAdmin ? 'Centraliza la carga de la semana, detecta vencimientos y mueve rapido los trabajos a asignacion diaria.' : 'Revisa la planificacion semanal disponible y prepara el trabajo de la proxima ventana operativa.'}</p>
                        </div>
                        <div class="dashboard-hero-badges">
                            <span class="dashboard-hero-badge"><i class="fa-solid fa-layer-group"></i> ${tareasSemanales.length} trabajo(s)</span>
                            <span class="dashboard-hero-badge"><i class="fa-solid fa-location-dot"></i> ${unidadesSemanales.length} unidad(es)</span>
                            <span class="dashboard-hero-badge"><i class="fa-solid ${focoSemanal.icon}"></i> Foco ${focoSemanal.label}</span>
                        </div>
                    </div>

                    <div class="weekly-kpi-grid">
                        <article class="weekly-kpi-card">
                            <span class="weekly-kpi-label"><i class="fa-solid fa-list-check"></i> Carga semanal</span>
                            <div class="weekly-kpi-value">${tareasSemanales.length}</div>
                            <div class="weekly-kpi-meta">${otsSemanales} OT</div>
                        </article>
                        <article class="weekly-kpi-card">
                            <span class="weekly-kpi-label"><i class="fa-solid fa-triangle-exclamation"></i> Vencimientos</span>
                            <div class="weekly-kpi-value">${tareasVencidas.length}</div>
                            <div class="weekly-kpi-meta">${tareasPorVencer.length} por vencer</div>
                        </article>
                        <article class="weekly-kpi-card">
                            <span class="weekly-kpi-label"><i class="fa-solid ${focoSemanal.icon}"></i> Foco</span>
                            <div class="weekly-kpi-value">${focoSemanal.label}</div>
                            <div class="weekly-kpi-meta">${focoSemanal.count} trabajo(s)</div>
                        </article>
                        <article class="weekly-kpi-card">
                            <span class="weekly-kpi-label"><i class="fa-solid fa-map"></i> Cobertura</span>
                            <div class="weekly-kpi-value">${unidadesSemanales.length}</div>
                            <div class="weekly-kpi-meta">${supervisorPendiente} sin supervisor</div>
                        </article>
                    </div>

                    <div class="weekly-toolbar">
                        <div class="weekly-toolbar-note">
                            <i class="fa-solid fa-circle-info"></i>
                            <span>${tareasVencidas.length > 0 ? `Hay ${tareasVencidas.length} trabajo(s) vencido(s) que conviene bajar primero.` : 'Sin atrasos criticos en la planificacion actual.'}</span>
                        </div>
                        <div style="display:flex; gap:0.65rem; align-items:center; flex-wrap:wrap;">
                            <input type="text" id="input-buscar-semanal" placeholder="Buscar OT, equipo, unidad..." class="form-control" style="min-width:260px; max-width:320px;">
                            ${isAdmin && tareasSemanales.length > 0 ? `
                                <button class="btn btn-outline" style="border-color: var(--danger-color); color: var(--danger-color);" onclick="window.eliminarTodasLasTareasExposed()">
                                    <i class="fa-solid fa-trash-can"></i> Vaciar plan
                                </button>
                            ` : ''}
                        </div>
                    </div>
                </section>

                <section class="panel weekly-board">
                    ${tareasSemanales.length === 0 ? `
                        <div class="empty-state">
                            <div>
                                <strong>Sin trabajos programados</strong>
                                <p>La planificacion semanal aparecera aqui apenas cargues o programes nuevas actividades.</p>
                            </div>
                        </div>
                    ` : `
                        <div id="lista-semanal-items" class="weekly-board">
                            ${unidadesOrdenadas.map(unidad => {
                                const itemsUnidad = gruposSemanales[unidad].slice().sort((a, b) => {
                                    const aFecha = getFechaExpSemanal(a);
                                    const bFecha = getFechaExpSemanal(b);
                                    const aVencida = aFecha && aFecha < hoySemanal;
                                    const bVencida = bFecha && bFecha < hoySemanal;
                                    if (aVencida && !bVencida) return -1;
                                    if (!aVencida && bVencida) return 1;
                                    if (aFecha && bFecha) return aFecha - bFecha;
                                    if (aFecha && !bFecha) return -1;
                                    if (!aFecha && bFecha) return 1;
                                    return getNombreSemanal(a).localeCompare(getNombreSemanal(b), 'es');
                                });
                                const vencidasUnidad = itemsUnidad.filter(item => {
                                    const fecha = getFechaExpSemanal(item);
                                    return fecha && fecha < hoySemanal;
                                }).length;
                                return `
                                    <section class="weekly-group" data-weekly-group>
                                        <div class="weekly-group-head">
                                            <div class="weekly-group-title">
                                                <i class="fa-solid fa-location-dot" style="color:var(--primary-color);"></i>
                                                <h3>${unidad}</h3>
                                            </div>
                                            <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
                                                <span class="weekly-group-badge"><i class="fa-solid fa-layer-group"></i> ${itemsUnidad.length} trabajo(s)</span>
                                                ${vencidasUnidad > 0 ? `<span class="weekly-group-badge" style="background:#fef2f2;color:#b91c1c;border-color:rgba(239,68,68,0.22);"><i class="fa-solid fa-triangle-exclamation"></i> ${vencidasUnidad} vencido(s)</span>` : ''}
                                            </div>
                                        </div>
                                        <div class="weekly-group-grid">
                                            ${itemsUnidad.map(renderCardSemanal).join('')}
                                        </div>
                                    </section>
                                `;
                            }).join('')}
                        </div>
                    `}
                </section>
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
             const tiposSel = sTrab.value ? [sTrab.value] : [];
             asignarTarea(tit, sEmpl.value, ays, 'programada_semana', sInputOt.value.trim().toUpperCase(), 'activo', fechaExp, sEq.value, tiposSel, [], sUbic.value);
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
                        semanalExcelImportState = {
                            fileName: file.name,
                            total: 0,
                            items: [],
                            message: 'No se encontraron tareas para APPLUS+ en este archivo.',
                            tone: 'warning'
                        };
                        renderizarVistaActual();
                        return;
                    }

                    // Construir lista de tareas encontradas para que el usuario las agregue manualmente
                    const tareasExtraidas = tareasAppus.map(row => {
                        const ot = obtenerValorFilaExcel(row, ['OT', 'Orden', 'Nro OT']);
                        const desc = row['Descripción'] || row['Texto breve'] || row['Tarea'] || '';
                        const eq  = row['Equipo'] || row['Activo'] || row['Ubicación Técnica'] || '';
                        const tit = `${ot ? '['+ot+'] ' : ''}${eq ? eq + ' - ' : ''}${desc}`;
                        const ubicacion = resolverUbicacionFilaSemanal(row, eq);
                        const tituloNormalizado = `${ubicacion ? `[${ubicacion}] ` : ''}${eq ? `${eq}${desc ? ' - ' : ''}` : ''}${desc}`.trim();
                        return {
                            id: crypto.randomUUID(),
                            ot: String(ot || '').trim(),
                            titulo: tituloNormalizado,
                            ubicacion: String(ubicacion || '').trim()
                        };
                    }).filter(t => t.titulo);

                    status.innerHTML = `<span style="color:var(--primary-color);font-weight:600;">${tareasExtraidas.length} tarea(s) encontradas. Agrégalas al plan:</span>`;

                    semanalExcelImportState = {
                        fileName: file.name,
                        total: tareasExtraidas.length,
                        items: tareasExtraidas,
                        message: `${tareasExtraidas.length} tarea(s) encontradas. Agrégalas al plan sin volver a subir el archivo.`,
                        tone: 'info'
                    };
                    renderizarVistaActual();
                    return;
                } catch (err) {
                    console.error("Error leyendo Excel:", err);
                    semanalExcelImportState = {
                        fileName: file.name,
                        total: 0,
                        items: [],
                        message: 'Error al procesar el archivo.',
                        tone: 'danger'
                    };
                    renderizarVistaActual();
                }
            };
            reader.readAsArrayBuffer(file);
            inputExcel.value = '';
        });

        document.getElementById('btn-limpiar-excel-semanal')?.addEventListener('click', () => {
            semanalExcelImportState = {
                fileName: '',
                total: 0,
                items: [],
                message: '',
                tone: 'info'
            };
            renderizarVistaActual();
        });

        document.querySelectorAll('[data-weekly-import-id]').forEach((button) => {
            button.addEventListener('click', async () => {
                const itemId = button.dataset.weeklyImportId;
                const tareaImportada = semanalExcelImportState.items.find(item => item.id === itemId);
                if (!tareaImportada) return;

                button.disabled = true;
                button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

                semanalExcelImportState.items = semanalExcelImportState.items.filter(item => item.id !== itemId);
                if (semanalExcelImportState.items.length > 0) {
                    semanalExcelImportState.message = `${semanalExcelImportState.items.length} tarea(s) pendientes de ${semanalExcelImportState.total}.`;
                    semanalExcelImportState.tone = 'info';
                } else {
                    semanalExcelImportState.message = `Todas las tareas de ${semanalExcelImportState.fileName || 'este archivo'} fueron agregadas al plan.`;
                    semanalExcelImportState.tone = 'success';
                }

                await asignarTarea(
                    tareaImportada.titulo,
                    null,
                    [],
                    'programada_semana',
                    tareaImportada.ot || null,
                    'activo',
                    null,
                    null,
                    [],
                    [],
                    tareaImportada.ubicacion || null
                );
            });
        });
    }

    // Buscador en lista semanal
    const searchInput = document.getElementById('input-buscar-semanal');
    if(searchInput) {
        searchInput.addEventListener('input', (e) => {
            const val = normalizarSemanal(e.target.value);
            const groups = document.querySelectorAll('[data-weekly-group]');
            groups.forEach(group => {
                const items = group.querySelectorAll('[data-weekly-card]');
                let visibles = 0;
                items.forEach(it => {
                    const texto = it.dataset.weeklySearch || normalizarSemanal(it.textContent);
                    const show = !val || texto.includes(val);
                    it.style.display = show ? '' : 'none';
                    if (show) visibles += 1;
                });
                group.style.display = visibles > 0 ? '' : 'none';
            });
        });
    }
}

function asignarPersonalATarea(id) {
    const tarea = estado.tareas.find(t => t.id === id);
    if (!tarea) return;

    _abrirModalIniciar(id, false);
}

// Para trabajadores: iniciar directo sin modal, usando asignación ya existente
async function iniciarTareaDirecto(id) {
    const tarea = estado.tareas.find(t => t.id === id);
    if (!tarea) return;
    const hora = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    estado.tareas = estado.tareas.map(t => t.id === id
        ? { ...t, estadoTarea: 'en_curso', estadoEjecucion: 'activo', horaAsignacion: hora }
        : t
    );
    vistaActual = 'dashboard';
    renderizarVistaActual();
    await _db.update('tareas', id, { estado_tarea: 'en_curso', hora_asignacion: hora });
}

// Iniciar desde cola diaria (estadoEjecucion en_cola → activo)
async function iniciarDesdeColaExposed(id) {
    const tarea = estado.tareas.find(t => t.id === id);
    if (!tarea) return;
    // Si es programada_semana, usar el flujo existente
    if (tarea.estadoTarea === 'programada_semana') {
        return window.iniciarTareaColaExposed(id);
    }
    const hora = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    estado.tareas = estado.tareas.map(t => t.id === id
        ? { ...t, estadoEjecucion: 'activo', horaAsignacion: hora }
        : t
    );
    renderizarVistaActual();
    await _db.update('tareas', id, { estado_ejecucion: 'activo', hora_asignacion: hora });
}
window.iniciarDesdeColaExposed = iniciarDesdeColaExposed;

// Poner tarea activa en cola
async function ponerEnColaExposed(id) {
    const tarea = estado.tareas.find(t => t.id === id);
    if (!tarea) return;
    // Calcular el próximo número de orden
    const maxOrden = estado.tareas
        .filter(t => t._enCola || t.estadoEjecucion === 'en_cola' || t.estadoTarea === 'programada_semana')
        .reduce((max, t) => Math.max(max, t.orden || 0), 0);
    const nuevoOrden = maxOrden + 1;
    estado.tareas = estado.tareas.map(t => t.id === id
        ? { ...t, estadoEjecucion: 'en_cola', orden: nuevoOrden }
        : t
    );
    renderizarVistaActual();
    await _db.update('tareas', id, { estado_ejecucion: 'en_cola', orden: nuevoOrden });
}
window.ponerEnColaExposed = ponerEnColaExposed;

// Mover tarea en la cola (up/down)
async function moverOrdenExposed(id, direccion) {
    // Solo tareas en cola, ordenadas
    const enCola = estado.tareas
        .filter(t => t.estadoEjecucion === 'en_cola' || t.estadoTarea === 'programada_semana')
        .sort((a, b) => (a.orden || 0) - (b.orden || 0));
    const idx = enCola.findIndex(t => t.id === id);
    if (idx === -1) return;
    const idxDestino = direccion === 'up' ? idx - 1 : idx + 1;
    if (idxDestino < 0 || idxDestino >= enCola.length) return;
    // Intercambiar órdenes
    const ordenA = enCola[idx].orden || 0;
    const ordenB = enCola[idxDestino].orden || 0;
    const idA = enCola[idx].id;
    const idB = enCola[idxDestino].id;
    // Si los órdenes son iguales, asignar valores distintos
    const nuevoA = ordenB === ordenA ? ordenA + (direccion === 'up' ? -1 : 1) : ordenB;
    const nuevoB = ordenA;
    estado.tareas = estado.tareas.map(t => {
        if (t.id === idA) return { ...t, orden: nuevoA };
        if (t.id === idB) return { ...t, orden: nuevoB };
        return t;
    });
    renderizarVistaActual();
    await Promise.all([
        _db.update('tareas', idA, { orden: nuevoA }),
        _db.update('tareas', idB, { orden: nuevoB })
    ]);
}
window.moverOrdenExposed = moverOrdenExposed;

function comenzarTrabajoProgramado(id) {
    _abrirModalIniciar(id, true);
}

function _abrirModalIniciar(id, cambiarADashboard) {
    const tarea = estado.tareas.find(t => t.id === id);
    if (!tarea) return;

    const modal = document.getElementById('modal-iniciar-trabajo');
    document.getElementById('modal-iniciar-tarea-id').value = id;
    document.getElementById('modal-iniciar-tipo').textContent = tarea.tipo;

    // ── Encontrar equipo asociado a esta tarea ────────────────────────────────
    let equipo = null;
    const eqIdGuardado = tarea.equipoId || tarea.equipo_id;
    if (eqIdGuardado) {
        equipo = estado.equipos.find(e => e.id === eqIdGuardado);
    }
    if (!equipo) {
        // Fallback: intentar encontrar por prefijo del título
        equipo = estado.equipos.find(e => {
            const pref = `[${e.ubicacion}] ${e.activo}`;
            return tarea.tipo.startsWith(pref);
        });
    }
    document.getElementById('modal-iniciar-equipo-id').value = equipo?.id || '';

    // ── UBICACIÓN ─────────────────────────────────────────────────────────────
    const ubicSel = document.getElementById('modal-iniciar-ubicacion');
    const ubicaciones = [...new Set([...ubicacionesDisponibles, ...estado.equipos.map(e => e.ubicacion).filter(Boolean)])].sort((a,b) => a.localeCompare(b,'es'));
    const ubicActual = tarea.ubicacion || equipo?.ubicacion || (tarea.tipo.match(/^\[([^\]]+)\]/) || [])[1] || '';
    ubicSel.innerHTML = `<option value="">— Seleccionar —</option>` +
        ubicaciones.map(u => `<option value="${u}" ${u === ubicActual ? 'selected' : ''}>${u}</option>`).join('');

    // ── TIPOS DE TRABAJO: multi-select chips ──────────────────────────────────
    const tipoContainer = document.getElementById('modal-iniciar-tipo-trabajo');
    const tiposBadges  = document.getElementById('modal-iniciar-tipos-badges');

    // Pre-seleccionar tipos ya guardados en la tarea, o detectar del título
    let tiposSeleccionados = tarea.tiposSeleccionados?.length
        ? [...tarea.tiposSeleccionados]
        : tipicosTrabajos.filter(t => tarea.tipo.toLowerCase().includes(t.toLowerCase()));

    function renderTipoChips() {
        tipoContainer.innerHTML = tipicosTrabajos.map(t => {
            const sel = tiposSeleccionados.includes(t);
            return `<label style="display:flex; align-items:center; gap:0.6rem; padding:0.45rem 0.8rem; cursor:pointer;
                    font-size:0.88rem; color:#374151; background:${sel ? '#fff7f0' : ''}; transition:background 150ms;"
                    onmouseover="this.style.background='${sel ? '#ffecd9' : '#f9fafb'}'"
                    onmouseout="this.style.background='${sel ? '#fff7f0' : ''}'">
                <input type="checkbox" class="tipo-trabajo-check" value="${t}" ${sel ? 'checked' : ''}
                    style="width:15px; height:15px; accent-color:#FF6900; cursor:pointer; flex-shrink:0;">
                <span style="flex:1;">${t}</span>
                ${sel ? '<span style="font-size:0.7rem; color:#FF6900; font-weight:700; white-space:nowrap;">✓</span>' : ''}
            </label>`;
        }).join('');

        tipoContainer.querySelectorAll('.tipo-trabajo-check').forEach(cb => {
            cb.addEventListener('change', () => {
                if (cb.checked) {
                    if (!tiposSeleccionados.includes(cb.value)) tiposSeleccionados.push(cb.value);
                } else {
                    tiposSeleccionados = tiposSeleccionados.filter(t => t !== cb.value);
                }
                renderTipoChips();
                renderTiposBadges();
            });
        });
    }

    function renderTiposBadges() {
        tiposBadges.innerHTML = tiposSeleccionados.map(t =>
            `<span style="display:inline-flex; align-items:center; gap:0.3rem; background:#fff7f0;
                color:#FF6900; border:1px solid #fdc898; border-radius:999px;
                font-size:0.75rem; font-weight:600; padding:2px 10px;">${t}</span>`
        ).join('');
    }

    renderTipoChips();
    renderTiposBadges();

    // ── COMPONENTES: checkboxes si el equipo tiene componentes ────────────────
    const compContainer = document.getElementById('modal-iniciar-componentes');
    const compList      = document.getElementById('modal-iniciar-comp-list');

    const componentesStr  = equipo?.componente || '';
    const componentesDisp = componentesStr.split(',').map(c => c.trim()).filter(Boolean);
    // Pre-seleccionar componentes guardados
    const compPrevios = tarea.componentesSeleccionados || [];

    if (componentesDisp.length > 0) {
        compList.innerHTML = componentesDisp.map(c => {
            const checked = compPrevios.length === 0 || compPrevios.includes(c);
            return `<label style="display:flex; align-items:center; gap:0.5rem; padding:0.35rem 0.65rem;
                    background:#fff; border:1px solid #d1d5db; border-radius:6px; cursor:pointer;
                    font-size:0.88rem; color:#374151; font-weight:500; transition:background 150ms;"
                    onmouseover="this.style.background='#f9fafb'" onmouseout="this.style.background='#fff'">
                <input type="checkbox" class="comp-check" value="${c}" ${checked ? 'checked' : ''}
                    style="accent-color:#FF6900; width:14px; height:14px;">
                ${c}
            </label>`;
        }).join('');
        compContainer.style.display = 'block';
    } else {
        compContainer.style.display = 'none';
    }

    // ── LÍDER Y AYUDANTES ─────────────────────────────────────────────────────
    const todos = estado.trabajadores.filter(t => t.disponible);
    const tareasActivas = estado.tareas.filter(t => t.estadoTarea === 'en_curso');
    const idsEnTarea = new Set(tareasActivas.flatMap(t =>
        [t.liderId, ...(t.ayudantesIds || [])].filter(Boolean)
    ));

    const liderSel = document.getElementById('modal-iniciar-lider');
    liderSel.innerHTML = '<option value="">— Seleccionar —</option>' +
        todos.map(t => {
            const enTarea = idsEnTarea.has(t.id);
            return `<option value="${t.id}">${t.nombre} — ${t.cargo || ''}${enTarea ? ' ⚡ trabajando' : ''}</option>`;
        }).join('');

    const ayudContainer = document.getElementById('modal-iniciar-ayudantes');

    function poblarAyudantes(liderIdActual) {
        const lista = todos.filter(t => t.id !== liderIdActual);
        ayudContainer.innerHTML = lista.map(t => {
            const enTarea = idsEnTarea.has(t.id);
            return `
                <label style="display:flex; align-items:center; gap:0.6rem; padding:0.45rem 0.8rem; cursor:pointer;
                    font-size:0.88rem; color:#374151; transition:background 150ms;"
                    onmouseover="this.style.background='#f9fafb'" onmouseout="this.style.background=''">
                    <input type="checkbox" value="${t.id}" style="width:15px; height:15px; accent-color:#FF6900; cursor:pointer;">
                    ${t.nombre}${t.cargo ? ` <span style="color:#9ca3af; font-size:0.78rem;">— ${t.cargo}</span>` : ''}
                    ${enTarea ? `<span style="font-size:0.72rem; color:#f59e0b; font-weight:600; margin-left:auto;">⚡ trabajando → cola</span>` : ''}
                </label>`;
        }).join('');
        if (!lista.length)
            ayudContainer.innerHTML = '<p style="padding:0.6rem 0.9rem; font-size:0.83rem; color:#9ca3af; margin:0;">Sin trabajadores disponibles</p>';
    }

    liderSel.onchange = () => poblarAyudantes(liderSel.value);
    poblarAyudantes(liderSel.value);
    modal.style.display = 'flex';

    // ── CONFIRMAR ─────────────────────────────────────────────────────────────
    document.getElementById('modal-iniciar-confirmar').onclick = async () => {
        const liderId = liderSel.value;
        if (!liderId) { alert('Selecciona un líder.'); return; }
        if (tiposSeleccionados.length === 0) { alert('Selecciona al menos un tipo de trabajo.'); return; }

        const componentesSeleccionados = [...compList.querySelectorAll('.comp-check:checked')].map(cb => cb.value);
        const ayudantesIds = [...ayudContainer.querySelectorAll('input[type=checkbox]:checked')]
            .map(cb => cb.value).filter(v => v !== liderId);
        const lider = estado.trabajadores.find(t => t.id === liderId);
        const ayudantesNombres = ayudantesIds.map(aid => estado.trabajadores.find(t => t.id === aid)?.nombre || '');
        const hora = new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
        const eqId = document.getElementById('modal-iniciar-equipo-id').value || null;
        const ubicacionElegida = document.getElementById('modal-iniciar-ubicacion').value || null;

        // Cola: si algún ayudante ya tiene tarea activa → forzar cola
        const tareasActivasActual = estado.tareas.filter(t => t.estadoTarea === 'en_curso');
        const idsEnTareaActual = new Set(tareasActivasActual.flatMap(t =>
            [t.liderId, ...(t.ayudantesIds || [])].filter(Boolean)
        ));
        const ayudantesOcupados = ayudantesIds.filter(aid => idsEnTareaActual.has(aid));
        const hayOcupados = ayudantesOcupados.length > 0;
        let iniciarAhora = cambiarADashboard && !hayOcupados;

        modal.style.display = 'none';

        if (hayOcupados && cambiarADashboard) {
            const nombres = ayudantesOcupados.map(aid => estado.trabajadores.find(t => t.id === aid)?.nombre).join(', ');
            const toast = document.createElement('div');
            toast.textContent = `⚡ ${nombres} ya tiene trabajo activo. Tarea asignada en cola para todos.`;
            Object.assign(toast.style, {
                position:'fixed', bottom:'1.5rem', left:'50%', transform:'translateX(-50%)',
                background:'#92400e', color:'white', padding:'0.75rem 1.25rem',
                borderRadius:'10px', fontSize:'0.88rem', zIndex:'9999',
                boxShadow:'0 4px 16px rgba(0,0,0,0.2)', maxWidth:'90vw', textAlign:'center'
            });
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 4000);
        }

        // Construir nuevo título incorporando todos los tipos seleccionados
        const tiposStr  = tiposSeleccionados.join(', ');
        const tipoBase  = tarea.tipo.replace(/\s*\([^)]*\)\s*$/, '').trim();
        const nuevoTipo = `${tipoBase} (${tiposStr})`;

        estado.tareas = estado.tareas.map(t => t.id === id ? {
            ...t,
            ...(iniciarAhora ? { estadoTarea: 'en_curso', estadoEjecucion: 'activo', horaAsignacion: hora } : {}),
            liderId, liderNombre: lider?.nombre || '',
            ayudantesIds, ayudantesNombres,
            tipo: nuevoTipo,
            tiposSeleccionados,
            componentesSeleccionados,
            equipoId: eqId,
            ...(ubicacionElegida ? { ubicacion: ubicacionElegida } : {})
        } : t);

        if (iniciarAhora) vistaActual = 'dashboard';
        renderizarVistaActual();

        const dbUpdate = {
            lider_id: liderId, lider_nombre: lider?.nombre || '',
            ayudantes_ids: ayudantesIds, ayudantes_nombres: ayudantesNombres,
            tipo: nuevoTipo,
            tipos_trabajo: tiposSeleccionados,
            componentes_trabajo: componentesSeleccionados,
            ...(eqId ? { equipo_id: eqId } : {}),
            ...(ubicacionElegida ? { ubicacion: ubicacionElegida } : {}),
            ...(iniciarAhora ? { estado_tarea: 'en_curso', hora_asignacion: hora } : {})
        };
        await _db.update('tareas', id, dbUpdate);
    };
}

// --- SISTEMA DE NAVEGACIÓN Y RENDER ---

// Eventos de Navegación
const navConfig = {
    'nav-control': 'control',
    'nav-dashboard': 'dashboard',
    'nav-mis-horas': 'mis_horas',
    'nav-semanal': 'semanal',
    'nav-historial': 'historial',
    'nav-equipos': 'equipos',
    'nav-trabajadores': 'trabajadores',
    'nav-horas-extra-admin': 'horas_extra_admin',
    'nav-insumos': 'insumos',
    'nav-mobile-dashboard': 'dashboard',
    'nav-mobile-semanal': 'semanal',
    'nav-mobile-hours': 'mis_horas',
    'nav-mobile-perfil': 'perfil',
    'nav-mobile-insumos': 'insumos',
    'nav-perfil': 'perfil',
    'nav-checkin': 'checkin'
};

function renderizarVistaActual() {
    pendingRealtimeRender = false;
    clearTimeout(realtimeResumeTimer);
    realtimeResumeTimer = null;
    // Limpiar contenido
    mainContent.innerHTML = '';
    document.body.dataset.view = vistaActual;
    document.body.dataset.role = estado.usuarioActual || 'visita';
    const syncStrip = document.getElementById('sync-status-strip');
    const searchToolbar = document.getElementById('search-container');
    const searchOverlay = document.getElementById('search-results-overlay');
    const ocultarChromeGlobal = true;
    if (syncStrip) syncStrip.style.display = ocultarChromeGlobal ? 'none' : '';
    if (searchToolbar) searchToolbar.style.display = ocultarChromeGlobal ? 'none' : '';
    if (ocultarChromeGlobal && searchOverlay) searchOverlay.style.display = 'none';
    
    // Actualizar clases activas en nav
    Object.keys(navConfig).forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.classList.toggle('active', navConfig[id] === vistaActual);
    });

    // Renderizar según estado
    switch (vistaActual) {
        case 'control':
            renderControlView();
            break;
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
        case 'equipos':
            renderEquiposView();
            break;
        case 'semanal':
            renderSemanalView();
            break;
        case 'mis_horas':
            renderMisHorasView();
            break;
        case 'horas_extra_admin':
            renderHorasExtraAdminView();
            break;
        case 'insumos':
            renderInsumosView();
            break;
        case 'perfil':
            renderPerfilView();
            break;
    }

    // (El menú móvil no se cierra automáticamente al navegar)
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
const btnMobileMenu = document.getElementById('nav-mobile-menu');

if (btnMenu && sidebar) {
    // Backdrop para el drawer móvil
    let navBackdrop = document.querySelector('.nav-backdrop');
    if (!navBackdrop) {
        navBackdrop = document.createElement('div');
        navBackdrop.className = 'nav-backdrop';
        document.body.appendChild(navBackdrop);
    }

    const closeMobileNav = () => {
        sidebar.classList.remove('open');
        navBackdrop.classList.remove('show');
        btnMenu.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
    };

    btnMenu.addEventListener('click', (event) => {
        event.stopPropagation();
        const nextState = !sidebar.classList.contains('open');
        sidebar.classList.toggle('open', nextState);
        navBackdrop.classList.toggle('show', nextState);
        btnMenu.setAttribute('aria-expanded', nextState ? 'true' : 'false');
        document.body.style.overflow = nextState ? 'hidden' : '';
    });

    navBackdrop.addEventListener('click', closeMobileNav);
    document.getElementById('btn-menu-close')?.addEventListener('click', (e) => {
        e.stopPropagation();
        closeMobileNav();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeMobileNav();
    });

    window.addEventListener('resize', () => {
        if (window.innerWidth > 768) closeMobileNav();
    });
}

if (btnMobileMenu && btnMenu) {
    btnMobileMenu.addEventListener('click', () => {
        btnMenu.click();
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
            const equiposAll = await fetchAllEquipos();
            estado.equipos = equiposAll || [];
        } else {
            estado.equipos = [...estado.equipos, equipoGuardado];
        }
        
        btnSave.disabled = false;
        btnSave.innerHTML = originalText;
    });
}


// --- LÓGICA DE FICHA TÉCNICA (DETALLES Y GRÁFICOS) ---

// ── Construir formulario dinámico de mediciones en modal-finalizar ────────────
function _buildMedicionesForm(tipos, componentes) {
    const container = document.getElementById('modal-mediciones-container');
    if (!container) return;

    const necesitaVibr    = tipos.some(t => t.toLowerCase().includes('vibrac'));
    const necesitaTermo   = tipos.some(t => t.toLowerCase().includes('termog'));
    const necesitaAccComp = tipos.some(t => !t.toLowerCase().includes('vibrac') && !t.toLowerCase().includes('termog'));

    // Si no hay mediciones numéricas y no hay componentes con acciones → contenedor vacío
    const showContainer = necesitaVibr || necesitaTermo || (necesitaAccComp && componentes.length > 0);
    if (!showContainer) { container.innerHTML = ''; return; }

    const items = componentes.length > 0 ? componentes : [null];

    let html = `<div>
        <div style="font-size:0.85rem; font-weight:600; color:#374151; margin-bottom:0.9rem;
            padding-bottom:0.45rem; border-bottom:2px solid #FF6900; display:flex; align-items:center; gap:0.5rem;">
            <i class="fa-solid fa-chart-line" style="color:#FF6900;"></i>
            Mediciones y Registros${componentes.length > 0 ? ' por Componente' : ''}
        </div>`;

    for (const comp of items) {
        html += `<div class="med-comp-section" data-comp="${comp || ''}"
            style="margin-bottom:0.9rem; padding:1rem; background:#f9fafb; border-radius:10px; border:1px solid #e5e7eb;">`;

        if (comp) {
            html += `<div style="margin-bottom:0.8rem;">
                <label style="display:flex; align-items:center; gap:0.55rem; cursor:pointer;
                    font-weight:600; color:#374151; font-size:0.92rem;">
                    <input type="checkbox" class="comp-activo-check" data-comp="${comp}" checked
                        style="width:15px; height:15px; accent-color:#FF6900;">
                    <i class="fa-solid fa-cog" style="color:#FF6900; font-size:0.82rem;"></i> ${comp}
                </label>
            </div>`;
        }

        html += `<div class="comp-fields" data-comp="${comp || ''}">`;

        if (necesitaVibr) {
            html += `<div style="margin-bottom:0.65rem;">
                <label style="font-size:0.8rem; font-weight:500; color:#6b7280; display:block; margin-bottom:0.25rem;">
                    <i class="fa-solid fa-wave-square" style="color:#6366f1;"></i> Vibración máx. (mm/s)
                </label>
                <input type="number" class="form-control med-vibr" data-comp="${comp || ''}"
                    min="0" step="0.01" placeholder="Ej: 4.50" style="font-size:0.9rem;">
            </div>`;
        }

        if (necesitaTermo) {
            html += `<div style="margin-bottom:0.65rem;">
                <label style="font-size:0.8rem; font-weight:500; color:#6b7280; display:block; margin-bottom:0.25rem;">
                    <i class="fa-solid fa-temperature-half" style="color:#ef4444;"></i> Temperatura máx. (°C)
                </label>
                <input type="number" class="form-control med-termo" data-comp="${comp || ''}"
                    min="-50" step="0.1" placeholder="Ej: 85.0" style="font-size:0.9rem;">
            </div>`;
        }

        if (necesitaAccComp && comp !== null) {
            html += `<div>
                <label style="font-size:0.8rem; font-weight:500; color:#6b7280; display:block; margin-bottom:0.25rem;">
                    <i class="fa-solid fa-wrench" style="color:#f59e0b;"></i> Acciones en este componente
                </label>
                <textarea class="form-control med-acciones" data-comp="${comp}"
                    rows="2" placeholder="Ej: Lubricación realizada, ajuste de pernos..."
                    style="font-size:0.85rem; resize:vertical;"></textarea>
            </div>`;
        }

        html += `</div></div>`; // .comp-fields  .med-comp-section
    }

    html += `</div>`;
    container.innerHTML = html;

    // Toggle colapsar/expandir sección de componente al desmarcar
    container.querySelectorAll('.comp-activo-check').forEach(cb => {
        cb.addEventListener('change', () => {
            const fields = container.querySelector(`.comp-fields[data-comp="${cb.dataset.comp}"]`);
            if (!fields) return;
            const on = cb.checked;
            fields.style.opacity  = on ? '1' : '0.4';
            fields.style.pointerEvents = on ? '' : 'none';
            fields.querySelectorAll('input, textarea').forEach(el => {
                el.disabled = !on;
                if (!on) el.value = '';
            });
            cb.closest('.med-comp-section').style.borderColor = on ? '#e5e7eb' : '#d1d5db';
        });
    });
}

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

        // Recolectar datos de medición del formulario dinámico
        const medicionesData = [];
        const medContainer = document.getElementById('modal-mediciones-container');
        if (medContainer) {
            medContainer.querySelectorAll('.med-comp-section').forEach(section => {
                const comp = section.dataset.comp || null;
                const activoChk = section.querySelector('.comp-activo-check');
                const activo = activoChk ? activoChk.checked : true;
                const vibrInput  = section.querySelector('.med-vibr');
                const termoInput = section.querySelector('.med-termo');
                const accionesInput = section.querySelector('.med-acciones');
                medicionesData.push({
                    componente: comp || null,
                    activo,
                    vibracion:   vibrInput  && vibrInput.value  !== '' ? vibrInput.value  : null,
                    temperatura: termoInput && termoInput.value !== '' ? termoInput.value : null,
                    acciones: accionesInput ? accionesInput.value.trim() : null
                });
            });
        }

        // Acciones requeridas si no hay campos de acciones por componente con contenido
        const tieneAccionesComp = medicionesData.some(m => m.activo && m.acciones);
        if (!acciones && !tieneAccionesComp) {
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
                recomendacionAnalista: document.getElementById('modal-recomendacion-analista').value.trim(),
                medicionesData
            });
            cerrarModalFinalizarTarea();
        } finally {
            btnConfirmarFinalizar.disabled = false;
            btnConfirmarFinalizar.innerHTML = originalHtml;
        }
    });
}

// Muestra un selector de componentes del mismo equipo antes de abrir la ficha
window.elegirComponenteYAbrirFicha = function(eqId, ubicacionForzada) {
    const equipo = estado.equipos.find(e => e.id === eqId);
    if (!equipo) return;
    // Usar la ubicación de la tarea si fue pasada, si no la del equipo
    const ubicFiltro = ubicacionForzada || equipo.ubicacion;
    // Buscar todos los componentes del mismo activo y misma ubicación
    const componentes = estado.equipos.filter(e => e.activo === equipo.activo && e.ubicacion === ubicFiltro);
    if (componentes.length <= 1) {
        window.abrirFichaTecnica(eqId);
        return;
    }
    // Construir modal selector
    let existente = document.getElementById('modal-selector-componente');
    if (existente) existente.remove();
    const overlay = document.createElement('div');
    overlay.id = 'modal-selector-componente';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9999;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
        <div style="background:#fff;border-radius:16px;padding:1.5rem 1.6rem;max-width:360px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,0.18);">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;">
                <span style="font-weight:700;font-size:1rem;color:#1e293b;">Seleccionar componente</span>
                <button onclick="document.getElementById('modal-selector-componente').remove()" style="background:none;border:none;font-size:1.2rem;cursor:pointer;color:#64748b;line-height:1;">✕</button>
            </div>
            <p style="font-size:0.85rem;color:#64748b;margin:0 0 1rem;">${equipo.activo} · ${ubicFiltro}</p>
            <div style="display:flex;flex-direction:column;gap:0.5rem;">
                ${componentes.map(c => `
                <button onclick="document.getElementById('modal-selector-componente').remove(); window.abrirFichaTecnica('${c.id}')"
                    style="background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:10px;padding:0.7rem 1rem;text-align:left;cursor:pointer;font-size:0.92rem;font-weight:600;color:#1e293b;display:flex;align-items:center;gap:0.6rem;transition:border-color 0.15s;"
                    onmouseover="this.style.borderColor='#FF6900';this.style.background='#fff7f0'"
                    onmouseout="this.style.borderColor='#e2e8f0';this.style.background='#f8fafc'">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FF6900" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M4.93 4.93a10 10 0 0 0 0 14.14"/></svg>
                    ${c.componente || 'Sin componente'}
                    ${c.kks ? `<span style="margin-left:auto;font-size:0.75rem;color:#94a3b8;font-weight:400;">${c.kks}</span>` : ''}
                </button>`).join('')}
            </div>
        </div>`;
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
};

// Modal con todos los equipos de una unidad
window.abrirVistaUnidad = function(ubicacion) {
    // Agrupar equipos por nombre (activo), ignorar duplicados por componente
    const equiposDeLaUnidad = estado.equipos.filter(e => e.ubicacion === ubicacion);
    const grupos = {};
    equiposDeLaUnidad.forEach(e => {
        if (!grupos[e.activo]) grupos[e.activo] = [];
        grupos[e.activo].push(e);
    });
    const nombresUnicos = Object.keys(grupos).sort();

    let existente = document.getElementById('modal-vista-unidad');
    if (existente) existente.remove();
    const overlay = document.createElement('div');
    overlay.id = 'modal-vista-unidad';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9999;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
        <div style="background:#fff;border-radius:16px;padding:1.5rem 1.6rem;max-width:480px;width:92%;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,0.18);">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.3rem;flex-shrink:0;">
                <div>
                    <span style="font-weight:700;font-size:1rem;color:#1e293b;">Equipos · ${ubicacion}</span>
                    <span style="margin-left:0.5rem;background:#FF6900;color:#fff;border-radius:999px;font-size:0.72rem;font-weight:700;padding:2px 9px;">${nombresUnicos.length}</span>
                </div>
                <button onclick="document.getElementById('modal-vista-unidad').remove()" style="background:none;border:none;font-size:1.2rem;cursor:pointer;color:#64748b;line-height:1;">✕</button>
            </div>
            <p style="font-size:0.8rem;color:#94a3b8;margin:0 0 1rem;">Toca un equipo para ver su ficha técnica</p>
            <div style="overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:0.45rem;padding-right:2px;">
                ${nombresUnicos.map(nombre => {
                    const comps = grupos[nombre];
                    const primerEq = comps[0];
                    const critColors = { 'A': '#ef4444', 'B': '#f59e0b', 'C': '#22c55e' };
                    const critColor = critColors[primerEq.criticidad] || '#94a3b8';
                    return `<button onclick="document.getElementById('modal-vista-unidad').remove(); ${comps.length > 1 ? `window.elegirComponenteYAbrirFicha('${primerEq.id}','${ubicacion.replace(/'/g,'')}')` : `window.abrirFichaTecnica('${primerEq.id}')`}"
                        style="background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:10px;padding:0.65rem 1rem;text-align:left;cursor:pointer;display:flex;align-items:center;gap:0.7rem;transition:border-color 0.15s;"
                        onmouseover="this.style.borderColor='#FF6900';this.style.background='#fff7f0'"
                        onmouseout="this.style.borderColor='#e2e8f0';this.style.background='#f8fafc'">
                        <div style="flex:1;min-width:0;">
                            <div style="font-weight:600;font-size:0.9rem;color:#1e293b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${nombre}</div>
                            ${primerEq.kks ? `<div style="font-size:0.75rem;color:#94a3b8;margin-top:1px;">${primerEq.kks}</div>` : ''}
                        </div>
                        ${primerEq.criticidad ? `<span style="font-size:0.7rem;font-weight:700;color:${critColor};background:${critColor}18;border-radius:6px;padding:2px 7px;flex-shrink:0;">Crit. ${primerEq.criticidad}</span>` : ''}
                        ${comps.length > 1 ? `<span style="font-size:0.72rem;color:#64748b;flex-shrink:0;">${comps.length} comp.</span>` : ''}
                    </button>`;
                }).join('')}
            </div>
        </div>`;
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
};

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

    // 3. Obtener mediciones — fetch directo a Supabase, caché local como fallback
    const equipoNombre = equipo.activo;
    const equipoUbicacion = equipo.ubicacion;
    // Incluir TODOS los IDs del mismo equipo (mismo nombre, cualquier unidad)
    // para no perder mediciones guardadas bajo la unidad incorrecta por el bug anterior
    const idsDelGrupo = [...new Set([
        ...estado.equipos.filter(e => e.activo === equipoNombre).map(e => e.id),
        equipoId
    ])];

    let mediciones = [];
    if (navigator.onLine && supabaseClient) {
        // Intentar las dos variantes de nombre de tabla
        for (const tabla of ['mediciones', 'historial_mediciones']) {
            const { data, error } = await supabaseClient
                .from(tabla)
                .select('*')
                .in('equipo_id', idsDelGrupo)
                .order('fecha', { ascending: false })
                .limit(100);
            if (!error && data) { mediciones = data; break; }
            console.warn('[Ficha] Error fetching', tabla, error?.message);
        }
    }
    // Fallback 1: estado en memoria
    if (mediciones.length === 0) {
        const idsSet = new Set(idsDelGrupo);
        mediciones = estado.historialMediciones.filter(m => idsSet.has(m.equipo_id));
    }
    // Fallback 2: IndexedDB local
    if (mediciones.length === 0 && window.localDB) {
        try {
            const todas = await window.localDB.mediciones.getAll();
            const idsSet = new Set(idsDelGrupo);
            mediciones = (todas || []).filter(m => idsSet.has(m.equipo_id));
        } catch(e) { /* localDB no disponible */ }
    }
    // Filtrar por componente si corresponde (solo cuando la medición tiene campo componente)
    if (equipo.componente) {
        mediciones = mediciones.filter(m => !m.componente || m.componente === equipo.componente);
    }

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

    const btnBorrarMed = (m) => `<button onclick="window._borrarMedicion('${m.id}')" title="Eliminar medición"
        style="background:none;border:none;cursor:pointer;color:#cbd5e1;padding:2px 4px;font-size:0.8rem;line-height:1;"
        onmouseover="this.style.color='#ef4444'" onmouseout="this.style.color='#cbd5e1'">
        <i class="fa-solid fa-trash"></i></button>`;

    // Vibraciones
    const vibs = mediciones.filter(m => m.tipo === 'vibracion').slice(0, 5);
    listVib.innerHTML = vibs.length > 0 ? vibs.map(m => `
        <div id="med-${m.id}" style="background:#f1f5f9; padding:0.6rem; border-radius:8px; display:flex; justify-content:space-between; align-items:center;">
            <div>
                <span style="font-weight:700; color:var(--primary-color)">${m.valor} ${m.unidad || 'mm/s'}</span>
                <div style="font-size:0.75rem; color:var(--text-muted)">${new Date(m.fecha).toLocaleDateString()} · ${m.punto_medicion}</div>
            </div>
            <div style="display:flex;align-items:center;gap:0.5rem;">
                <i class="fa-solid fa-chart-line" style="color:#cbd5e1"></i>
                ${btnBorrarMed(m)}
            </div>
        </div>
    `).join('') : '<p style="color:var(--text-muted); font-size:0.85rem">Sin mediciones recientes.</p>';

    // Termografía
    const termos = mediciones.filter(m => m.tipo === 'termografia').slice(0, 5);
    listTermo.innerHTML = termos.length > 0 ? termos.map(m => `
        <div id="med-${m.id}" style="background:#fff1f2; padding:0.6rem; border-radius:8px; display:flex; justify-content:space-between; align-items:center; border: 1px solid #fecdd3;">
            <div>
                <span style="font-weight:700; color:#e11d48">${m.valor} °C</span>
                <div style="font-size:0.75rem; color:var(--text-muted)">${new Date(m.fecha).toLocaleDateString()}</div>
            </div>
            <div style="display:flex;align-items:center;gap:0.5rem;">
                <i class="fa-solid fa-temperature-high" style="color:#fb7185"></i>
                ${btnBorrarMed(m)}
            </div>
        </div>
    `).join('') : '<p style="color:var(--text-muted); font-size:0.85rem">Sin inspecciones térmicas.</p>';

    // Lubricación
    const lubs = mediciones.filter(m => m.tipo === 'lubricacion').slice(0, 4);
    listLid.innerHTML = lubs.length > 0 ? lubs.map(m => `
        <div id="med-${m.id}" style="background:rgba(255,165,0,0.08); padding:0.8rem; border-radius:8px; border: 1px solid rgba(255,105,0,0.2); margin-bottom:0.5rem; display:flex; justify-content:space-between; align-items:center;">
            <div>
                <div style="font-weight:600; font-size:0.9rem; color:var(--text-main);">${m.punto_medicion}</div>
                <p style="margin:0.25rem 0 0; font-size:0.85rem; color:var(--primary-color);">${m.valor}</p>
                <div style="font-size:0.7rem; color:var(--text-muted); margin-top:0.4rem;">${new Date(m.fecha).toLocaleDateString()}</div>
            </div>
            ${btnBorrarMed(m)}
        </div>
    `).join('') : '<p style="color:var(--text-muted); font-size:0.85rem; padding:0.5rem;">No se registran cambios de aceite o engrase.</p>';
}

// ── Modal informativo de tipo de trabajo ────────────────────────────────────
function renderFichaTecnicaModal() {
    injectPlanifyEnhancementStyles();
    const existingModal = document.getElementById('modal-ficha-tecnica');
    if (existingModal) {
        const esModalNuevo = existingModal.querySelector('#ficha-equipo-breadcrumb') &&
            existingModal.querySelector('#ficha-equipo-overview') &&
            existingModal.querySelector('.planify-ficha-panel');
        if (esModalNuevo) return;
        existingModal.remove();
    }
    const html = `
        <div id="modal-ficha-tecnica" class="login-overlay planify-ficha-overlay" style="display:none; align-items:flex-start;">
            <div class="login-panel planify-ficha-panel">
                <div class="planify-ficha-header">
                    <div id="ficha-equipo-breadcrumb" class="planify-ficha-breadcrumb"></div>
                    <div class="planify-ficha-title-row">
                        <div class="planify-ficha-title-wrap">
                            <h2 id="ficha-equipo-nombre" class="planify-ficha-title"></h2>
                            <div class="planify-ficha-meta">
                                <span><i class="fa-solid fa-location-dot"></i> <span id="ficha-equipo-ubicacion"></span></span>
                                <span><i class="fa-solid fa-barcode"></i> KKS: <span id="ficha-equipo-kks"></span></span>
                                <span id="ficha-equipo-criticidad" class="badge"></span>
                                <span id="ficha-equipo-source" class="planify-ficha-source" style="display:none;"></span>
                            </div>
                            <div id="ficha-equipo-extra" class="planify-ficha-meta" style="margin-top:.45rem;"></div>
                        </div>
                        <div class="planify-ficha-actions">
                            <div id="ficha-equipo-actions" class="planify-ficha-inline-actions"></div>
                            <button id="btn-cerrar-ficha" class="btn btn-outline planify-ficha-action-btn"><i class="fa-solid fa-xmark"></i> Cerrar</button>
                        </div>
                    </div>
                    <div id="ficha-equipo-overview" class="planify-ficha-overview"></div>
                </div>
                <div class="planify-ficha-tabs">
                    <button class="tab-btn planify-ficha-tab-btn active" data-target="tab-vibraciones">Vibraciones</button>
                    <button class="tab-btn planify-ficha-tab-btn" data-target="tab-termografia">Termografía</button>
                    <button class="tab-btn planify-ficha-tab-btn" data-target="tab-lubricacion">Lubricación / Aceite</button>
                    <button class="tab-btn planify-ficha-tab-btn" data-target="tab-actividad">Actividad</button>
                </div>
                <div class="planify-ficha-body">
                    <div id="tab-vibraciones" class="tab-pane">
                        <div class="planify-ficha-grid">
                            <div class="planify-ficha-stack">
                                <div id="ficha-resumen-vibracion" class="planify-ficha-subgrid"></div>
                                <div class="planify-ficha-card">
                                    <div class="planify-ficha-card-head">
                                        <div>
                                            <h3>Tendencia de vibración global</h3>
                                            <span id="ficha-vib-subtitulo">Comparación histórica del activo seleccionado.</span>
                                        </div>
                                    </div>
                                    <div class="planify-ficha-chart"><canvas id="chart-vibraciones"></canvas></div>
                                </div>
                            </div>
                            <aside class="planify-ficha-card">
                                <div class="planify-ficha-card-head">
                                    <div>
                                        <h3>Últimas mediciones</h3>
                                        <span>Lecturas recientes y condición del activo.</span>
                                    </div>
                                </div>
                                <div id="lista-mediciones-vibracion" class="planify-ficha-reading-list"></div>
                            </aside>
                        </div>
                    </div>
                    <div id="tab-termografia" class="tab-pane" style="display:none;">
                        <div class="planify-ficha-grid">
                            <div class="planify-ficha-stack">
                                <div id="ficha-resumen-termografia" class="planify-ficha-subgrid"></div>
                                <div class="planify-ficha-card">
                                    <div class="planify-ficha-card-head">
                                        <div>
                                            <h3>Tendencia térmica</h3>
                                            <span id="ficha-termo-subtitulo">Puntos calientes y evolución del activo.</span>
                                        </div>
                                    </div>
                                    <div class="planify-ficha-chart"><canvas id="chart-termografia"></canvas></div>
                                </div>
                            </div>
                            <aside class="planify-ficha-card">
                                <div class="planify-ficha-card-head">
                                    <div>
                                        <h3>Inspecciones térmicas</h3>
                                        <span>Últimos hallazgos y técnico responsable.</span>
                                    </div>
                                </div>
                                <div id="lista-mediciones-termografia" class="planify-ficha-reading-list"></div>
                            </aside>
                        </div>
                    </div>
                    <div id="tab-lubricacion" class="tab-pane" style="display:none;">
                        <div class="planify-ficha-card">
                            <div class="planify-ficha-card-head">
                                <div>
                                    <h3>Registro de lubricación y aceite</h3>
                                    <span>Cambios, observaciones y registros asociados al activo.</span>
                                </div>
                            </div>
                            <div id="lista-mediciones-lubricacion" class="planify-ficha-reading-list"></div>
                        </div>
                    </div>
                    <div id="tab-actividad" class="tab-pane" style="display:none;">
                        <div class="planify-ficha-activity">
                            <section class="planify-ficha-card">
                                <div class="planify-ficha-card-head">
                                    <div>
                                        <h3>Trabajos recientes</h3>
                                        <span>Últimos cierres e intervenciones asociadas a este activo.</span>
                                    </div>
                                </div>
                                <div id="ficha-actividad-trabajos" class="planify-ficha-activity-list"></div>
                            </section>
                            <section class="planify-ficha-card">
                                <div class="planify-ficha-card-head">
                                    <div>
                                        <h3>Componentes relacionados</h3>
                                        <span>Comparación rápida dentro del mismo activo y unidad.</span>
                                    </div>
                                </div>
                                <div id="ficha-componentes-relacionados" class="planify-ficha-related-list"></div>
                            </section>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);
}

function getTareasRelacionadasFicha(equipo, siblingIds) {
    const ids = new Set([...siblingIds].map(String));
    return (estado.historialTareas || [])
        .filter(task => {
            if (task.equipo_id && ids.has(String(task.equipo_id))) return true;
            const tipo = String(task.tipo || '').toLowerCase();
            return tipo.includes(String(equipo.activo || '').toLowerCase()) &&
                (tipo.includes(`[${String(equipo.ubicacion || '').toLowerCase()}]`) || (task.ubicacion && task.ubicacion === equipo.ubicacion));
        })
        .sort((a, b) => new Date(b.created_at || b.fecha_termino || b.fecha_inicio || 0) - new Date(a.created_at || a.fecha_termino || a.fecha_inicio || 0))
        .slice(0, 8);
}

function renderFichaLoadingState(equipo) {
    if (!document.getElementById('ficha-equipo-breadcrumb') || !document.getElementById('ficha-equipo-overview')) {
        document.getElementById('modal-ficha-tecnica')?.remove();
        renderFichaTecnicaModal();
    }
    if (!document.getElementById('ficha-equipo-breadcrumb') || !document.getElementById('ficha-equipo-overview')) return;
    document.getElementById('ficha-equipo-nombre').textContent = `${equipo.activo}${equipo.componente ? ' · ' + equipo.componente : ''}`;
    document.getElementById('ficha-equipo-ubicacion').textContent = equipo.ubicacion || 'Sin ubicación';
    document.getElementById('ficha-equipo-kks').textContent = equipo.kks || 'N/A';
    document.getElementById('ficha-equipo-breadcrumb').innerHTML = `<span>Control</span><i class="fa-solid fa-angle-right"></i><span>${equipo.ubicacion || 'Sin unidad'}</span><i class="fa-solid fa-angle-right"></i><strong>${equipo.activo}</strong>`;
    document.getElementById('ficha-equipo-overview').innerHTML = `<div class="planify-ficha-empty planify-ficha-loading" style="grid-column:1 / -1;"><div><div style="font-weight:800;color:#0f172a;margin-bottom:.35rem;">Cargando condición del activo...</div><div style="font-size:.85rem;line-height:1.5;">Recopilando mediciones, historial y componentes relacionados.</div></div></div>`;
    document.getElementById('ficha-resumen-vibracion').innerHTML = emptyFichaState('Preparando tendencia', 'Se están consolidando las mediciones de vibración.');
    document.getElementById('ficha-resumen-termografia').innerHTML = emptyFichaState('Preparando tendencia', 'Se están consolidando las mediciones térmicas.');
    document.getElementById('lista-mediciones-vibracion').innerHTML = emptyFichaState('Cargando vibraciones', 'En unos segundos verás las últimas lecturas.');
    document.getElementById('lista-mediciones-termografia').innerHTML = emptyFichaState('Cargando termografía', 'En unos segundos verás las últimas inspecciones.');
    document.getElementById('lista-mediciones-lubricacion').innerHTML = emptyFichaState('Cargando actividad de lubricación', 'Buscando cambios de aceite y registros asociados.');
    document.getElementById('ficha-actividad-trabajos').innerHTML = emptyFichaState('Cargando historial', 'Revisando los últimos cierres relacionados con este activo.');
    document.getElementById('ficha-componentes-relacionados').innerHTML = emptyFichaState('Cargando componentes', 'Buscando componentes del mismo activo dentro de la unidad.');
}

function renderLecturaFicha(item, tipo) {
    const status = getEstadoCondicionFicha(tipo, item.valor);
    const isVib = tipo === 'vibracion';
    return `
        <article id="med-${item.id}" class="planify-ficha-reading ${status.tone}">
            <div class="planify-ficha-reading-top">
                <div>
                    <div class="planify-ficha-reading-title">${item.punto_medicion || item.componente || 'Punto general'}</div>
                    <div class="planify-ficha-reading-meta">
                        <span><i class="fa-regular fa-calendar"></i> ${formatearFechaHoraFicha(item.fecha)}</span>
                        <span><i class="fa-solid fa-user-gear"></i> ${item.tecnico_nombre || 'Sin técnico'}</span>
                    </div>
                </div>
                <div class="planify-ficha-reading-value ${isVib ? 'is-vib' : 'is-temp'}">${numeroFicha(item.valor, isVib ? 2 : 1)} ${item.unidad || (isVib ? 'mm/s' : '°C')}</div>
            </div>
            <div style="display:flex;justify-content:space-between;gap:.75rem;align-items:flex-start;">
                <div class="planify-ficha-reading-note">${item.observaciones || 'Sin observaciones registradas.'}</div>
                <div style="display:flex;flex-direction:column;align-items:flex-end;gap:.45rem;">
                    <span class="planify-status-badge ${status.className}"><i class="fa-solid fa-circle"></i> ${status.label}</span>
                    <button onclick="window._borrarMedicion('${item.id}')" title="Eliminar medición" style="background:none;border:none;cursor:pointer;color:#94a3b8;padding:2px 4px;font-size:0.84rem;line-height:1;" onmouseover="this.style.color='#ef4444'" onmouseout="this.style.color='#94a3b8'"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>
        </article>
    `;
}

function renderActividadFicha(task, equipo) {
    const fecha = task.created_at || task.fecha_termino || task.fecha_inicio;
    return `
        <article class="planify-ficha-task">
            <div class="planify-ficha-task-top">
                <div>
                    <div class="planify-ficha-task-title">${String(task.tipo || 'Trabajo registrado').replace(/^\s*\[[^\]]+\]\s*/, '').replace(/\s*\([^)]+\)\s*$/, '')}</div>
                    <div class="planify-ficha-task-meta">
                        <span><i class="fa-regular fa-calendar"></i> ${formatearFechaHoraFicha(fecha)}</span>
                        <span><i class="fa-solid fa-user-tie"></i> ${task.lider_nombre || 'Sin líder'}</span>
                    </div>
                </div>
                ${task.ot_numero ? `<span class="planify-ficha-chip"><i class="fa-solid fa-hashtag"></i> ${task.ot_numero}</span>` : ''}
            </div>
            <div class="planify-ficha-reading-note">${task.acciones_realizadas || task.observaciones || 'Sin detalle operativo.'}</div>
            <div class="planify-ficha-task-meta">
                <span><i class="fa-regular fa-bell"></i> ${task.numero_aviso || 'Sin aviso'}</span>
                <span><i class="fa-solid fa-business-time"></i> ${task.hh_trabajo || '0'} HH</span>
                <button class="planify-ficha-link" onclick="window.irAHistorialDeEquipo('${equipo.id}')">Ver en historial</button>
            </div>
        </article>
    `;
}

function renderComponenteRelacionadoFicha(item, medicionesGrupo, siblingIds) {
    const ids = new Set([...siblingIds].map(String));
    const mismas = medicionesGrupo.filter(m => ids.has(String(m.equipo_id)) && String(m.equipo_id) === String(item.id));
    const vib = mismas.filter(m => m.tipo === 'vibracion').sort((a, b) => new Date(b.fecha) - new Date(a.fecha))[0] || null;
    const termo = mismas.filter(m => m.tipo === 'termografia').sort((a, b) => new Date(b.fecha) - new Date(a.fecha))[0] || null;
    const estados = [vib ? getEstadoCondicionFicha('vibracion', vib.valor) : null, termo ? getEstadoCondicionFicha('termografia', termo.valor) : null].filter(Boolean);
    const estado = estados.length ? consolidarEstadoFicha(estados) : { label: 'Sin datos', className: 'is-normal', tone: '' };
    return `
        <article class="planify-ficha-related">
            <div class="planify-ficha-related-main">
                <button class="planify-ficha-link" onclick="window.abrirFichaTecnica('${item.id}')">${item.componente || item.activo}</button>
                <span>${item.kks || 'Sin KKS'} · ${vib ? `Vib ${numeroFicha(vib.valor, 2)} mm/s` : 'Sin vib'} · ${termo ? `Temp ${numeroFicha(termo.valor, 1)} °C` : 'Sin termo'}</span>
            </div>
            <span class="planify-status-badge ${estado.className}"><i class="fa-solid fa-circle"></i> ${estado.label}</span>
        </article>
    `;
}

function renderListasFicha(equipo, medicionesEquipo, medicionesGrupo, tareasRelacionadas, fuenteMediciones) {
    const vibs = medicionesEquipo.filter(m => m.tipo === 'vibracion').sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    const termos = medicionesEquipo.filter(m => m.tipo === 'termografia').sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    const lubs = medicionesEquipo.filter(m => m.tipo === 'lubricacion').sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    const siblingEquipos = estado.equipos.filter(item => item.activo === equipo.activo && item.ubicacion === equipo.ubicacion);
    const siblingIds = new Set(siblingEquipos.map(item => String(item.id)));
    const vibSummary = obtenerResumenMedicionesFicha(medicionesEquipo, 'vibracion');
    const termoSummary = obtenerResumenMedicionesFicha(medicionesEquipo, 'termografia');
    const overallStatus = consolidarEstadoFicha([vibSummary.count ? vibSummary.status : null, termoSummary.count ? termoSummary.status : null].filter(Boolean));
    const ultimaActividad = tareasRelacionadas[0] || null;
    const pulsoActivo = getPulsoActivoFicha(equipo, { vibracion: vibSummary, termografia: termoSummary }, tareasRelacionadas);
    const brechaVib = getBrechaUmbralFicha('vibracion', vibSummary);
    const brechaTermo = getBrechaUmbralFicha('termografia', termoSummary);
    const comparativaVib = getComparativaGrupoFicha(equipo, siblingEquipos, medicionesGrupo, 'vibracion');
    const comparativaTermo = getComparativaGrupoFicha(equipo, siblingEquipos, medicionesGrupo, 'termografia');
    const comparativaTone = priorizarToneFicha(comparativaVib.tone, comparativaTermo.tone);
    const comparativaValue = comparativaVib.value !== 'Sin dato'
        ? `Vib ${comparativaVib.value}`
        : (comparativaTermo.value !== 'Sin dato' ? `Temp ${comparativaTermo.value}` : numeroFicha(siblingEquipos.length));
    const comparativaMeta = [
        comparativaVib.value !== 'Sin dato' ? `Vibracion: ${comparativaVib.meta}` : '',
        comparativaTermo.value !== 'Sin dato' ? `Termografia: ${comparativaTermo.meta}` : ''
    ].filter(Boolean).join(' / ') || (siblingEquipos.length > 1
        ? 'Hay componentes hermanos, pero aun no existe una base comparable.'
        : 'Activo sin componentes comparables en esta unidad.');
    const totalLecturas = vibSummary.count + termoSummary.count + lubs.length;
    const critStyles = {
        A: { text: 'Criticidad A', bg: '#fef2f2', color: '#b91c1c', border: '#fecaca' },
        B: { text: 'Criticidad B', bg: '#fff7ed', color: '#b45309', border: '#fdba74' },
        C: { text: 'Criticidad C', bg: '#ecfdf5', color: '#047857', border: '#a7f3d0' }
    };
    const crit = critStyles[equipo.criticidad] || { text: equipo.criticidad || 'Sin criticidad', bg: '#f8fafc', color: '#475569', border: '#cbd5e1' };
    const badgeCrit = document.getElementById('ficha-equipo-criticidad');
    badgeCrit.className = 'badge';
    badgeCrit.textContent = crit.text;
    badgeCrit.style.background = crit.bg;
    badgeCrit.style.color = crit.color;
    badgeCrit.style.border = `1px solid ${crit.border}`;
    document.getElementById('ficha-equipo-nombre').textContent = `${equipo.activo}${equipo.componente ? ' · ' + equipo.componente : ''}`;
    document.getElementById('ficha-equipo-ubicacion').textContent = equipo.ubicacion || 'Sin ubicación';
    document.getElementById('ficha-equipo-kks').textContent = equipo.kks || 'N/A';
    document.getElementById('ficha-equipo-breadcrumb').innerHTML = `<span>Control</span><i class="fa-solid fa-angle-right"></i><span>${equipo.ubicacion || 'Sin unidad'}</span><i class="fa-solid fa-angle-right"></i><strong>${equipo.activo}</strong>${equipo.componente ? `<i class="fa-solid fa-angle-right"></i><span>${equipo.componente}</span>` : ''}`;
    document.getElementById('ficha-equipo-extra').innerHTML = [
        equipo.denominacion_ut ? `<span><i class="fa-solid fa-tag"></i> ${equipo.denominacion_ut}</span>` : '',
        equipo.frecuencia_nueva ? `<span><i class="fa-solid fa-clock-rotate-left"></i> Frecuencia: ${equipo.frecuencia_nueva} días</span>` : '',
        equipo.ruta ? `<span><i class="fa-solid fa-route"></i> ${equipo.ruta}</span>` : '',
        equipo.ubicacion_tecnica ? `<span><i class="fa-solid fa-diagram-project"></i> ${equipo.ubicacion_tecnica}</span>` : ''
    ].filter(Boolean).join('');
    const sourceEl = document.getElementById('ficha-equipo-source');
    const sourceMap = {
        online: '<i class="fa-solid fa-cloud-arrow-down"></i> Datos online',
        estado: '<i class="fa-solid fa-bolt"></i> Cache de sesión',
        local: '<i class="fa-solid fa-hard-drive"></i> Cache local',
        none: '<i class="fa-solid fa-circle-info"></i> Sin mediciones'
    };
    sourceEl.innerHTML = sourceMap[fuenteMediciones] || sourceMap.none;
    sourceEl.style.display = 'inline-flex';
    document.getElementById('ficha-equipo-actions').innerHTML = `
        <button class="btn btn-outline planify-ficha-action-btn" onclick="window.irAHistorialDeEquipo('${equipo.id}')"><i class="fa-solid fa-clock-rotate-left"></i> Historial</button>
        <button class="btn btn-outline planify-ficha-action-btn" onclick="window.irAControlConBusqueda('${equipo.id}')"><i class="fa-solid fa-magnifying-glass"></i> Buscar</button>
        <button class="btn btn-outline planify-ficha-action-btn" onclick="window.abrirVistaUnidad('${String(equipo.ubicacion || '').replace(/'/g, "\\'")}')"><i class="fa-solid fa-location-dot"></i> Unidad</button>
    `;
    document.getElementById('ficha-equipo-overview').innerHTML = [
        crearTarjetaResumenFicha({ label: 'Estado actual', value: overallStatus.label, meta: vibSummary.count || termoSummary.count ? `Vibración ${vibSummary.count ? vibSummary.status.label : 'sin dato'} · Termografía ${termoSummary.count ? termoSummary.status.label : 'sin dato'}` : 'Aun no existen mediciones registradas para este activo.', icon: 'fa-shield-heart', tone: overallStatus.tone }),
        crearTarjetaResumenFicha({ label: 'Ultima vibración', value: vibSummary.latest ? `${numeroFicha(vibSummary.latest.valor, 2)} ${vibSummary.latest.unidad || 'mm/s'}` : 'Sin dato', meta: vibSummary.latest ? `${formatearFechaFicha(vibSummary.latest.fecha)} · ${vibSummary.latest.punto_medicion || 'General'}` : 'Sin lecturas de vibración.', icon: 'fa-wave-square', tone: vibSummary.count ? vibSummary.status.tone : '' }),
        crearTarjetaResumenFicha({ label: 'Ultima termografía', value: termoSummary.latest ? `${numeroFicha(termoSummary.latest.valor, 1)} ${termoSummary.latest.unidad || '°C'}` : 'Sin dato', meta: termoSummary.latest ? `${formatearFechaFicha(termoSummary.latest.fecha)} · ${termoSummary.latest.punto_medicion || 'General'}` : 'Sin lecturas térmicas.', icon: 'fa-temperature-three-quarters', tone: termoSummary.count ? termoSummary.status.tone : '' }),
        crearTarjetaResumenFicha({ label: 'Intervenciones', value: numeroFicha(tareasRelacionadas.length), meta: ultimaActividad ? `Ultimo cierre: ${formatearFechaFicha(ultimaActividad.created_at || ultimaActividad.fecha_termino || ultimaActividad.fecha_inicio)}` : 'Sin cierres registrados en historial.', icon: 'fa-screwdriver-wrench' }),
        crearTarjetaResumenFicha({ label: 'Componentes', value: numeroFicha(siblingEquipos.length), meta: siblingEquipos.length > 1 ? 'Hay otros componentes del mismo activo en la unidad.' : 'Activo sin componentes adicionales visibles en la unidad.', icon: 'fa-gears' })
    ].join('');
    document.getElementById('ficha-resumen-vibracion').innerHTML = vibSummary.count ? [crearTarjetaMiniFicha({ label: 'Tendencia', value: vibSummary.trend.label, meta: vibSummary.trend.meta }), crearTarjetaMiniFicha({ label: 'Promedio', value: `${numeroFicha(vibSummary.avg, 2)} mm/s`, meta: `${numeroFicha(vibSummary.count)} lectura(s) en el rango` }), crearTarjetaMiniFicha({ label: 'Maximo', value: `${numeroFicha(vibSummary.max, 2)} mm/s`, meta: `Estado actual: ${vibSummary.status.label}` })].join('') : emptyFichaState('Sin vibraciones registradas', 'Cuando se agreguen lecturas de vibración aparecerán aqui con tendencia, promedio y maximo.');
    document.getElementById('ficha-resumen-termografia').innerHTML = termoSummary.count ? [crearTarjetaMiniFicha({ label: 'Tendencia', value: termoSummary.trend.label, meta: termoSummary.trend.meta }), crearTarjetaMiniFicha({ label: 'Promedio', value: `${numeroFicha(termoSummary.avg, 1)} °C`, meta: `${numeroFicha(termoSummary.count)} lectura(s) en el rango` }), crearTarjetaMiniFicha({ label: 'Maximo', value: `${numeroFicha(termoSummary.max, 1)} °C`, meta: `Estado actual: ${termoSummary.status.label}` })].join('') : emptyFichaState('Sin termografía registrada', 'Cuando se agreguen lecturas térmicas aparecerán aqui con tendencia, promedio y maximo.');
    document.getElementById('lista-mediciones-vibracion').innerHTML = vibs.length ? vibs.slice(0, 6).map(item => renderLecturaFicha(item, 'vibracion')).join('') : emptyFichaState('Sin vibraciones recientes', 'No hay lecturas de vibración para este equipo en el rango disponible.');
    document.getElementById('lista-mediciones-termografia').innerHTML = termos.length ? termos.slice(0, 6).map(item => renderLecturaFicha(item, 'termografia')).join('') : emptyFichaState('Sin inspecciones térmicas', 'Aun no se registran inspecciones térmicas para este equipo.');
    document.getElementById('lista-mediciones-lubricacion').innerHTML = lubs.length ? lubs.slice(0, 6).map(item => `<article id="med-${item.id}" class="planify-ficha-reading"><div class="planify-ficha-reading-top"><div><div class="planify-ficha-reading-title">${item.punto_medicion || 'Actividad de lubricación'}</div><div class="planify-ficha-reading-meta"><span><i class="fa-regular fa-calendar"></i> ${formatearFechaHoraFicha(item.fecha)}</span><span><i class="fa-solid fa-user-gear"></i> ${item.tecnico_nombre || 'Sin técnico'}</span></div></div><div class="planify-ficha-reading-value">${item.valor || 'Registro'}</div></div><div style="display:flex;justify-content:space-between;gap:.75rem;align-items:flex-start;"><div class="planify-ficha-reading-note">${item.observaciones || 'Sin observaciones registradas.'}</div><button onclick="window._borrarMedicion('${item.id}')" title="Eliminar medición" style="background:none;border:none;cursor:pointer;color:#94a3b8;padding:2px 4px;font-size:0.84rem;line-height:1;" onmouseover="this.style.color='#ef4444'" onmouseout="this.style.color='#94a3b8'"><i class="fa-solid fa-trash"></i></button></div></article>`).join('') : emptyFichaState('Sin cambios de aceite o engrase', 'Esta pestaña mostrará registros de lubricación cuando existan.');
    document.getElementById('ficha-actividad-trabajos').innerHTML = tareasRelacionadas.length ? tareasRelacionadas.map(task => renderActividadFicha(task, equipo)).join('') : emptyFichaState('Sin cierres relacionados', 'No se encontraron trabajos finalizados asociados a este activo.');
    document.getElementById('ficha-componentes-relacionados').innerHTML = siblingEquipos.length ? siblingEquipos.map(item => renderComponenteRelacionadoFicha(item, medicionesGrupo, siblingIds)).join('') : emptyFichaState('Sin componentes relacionados', 'No se encontraron otros componentes del mismo activo en esta unidad.');
    document.getElementById('ficha-vib-subtitulo').textContent = vibSummary.count ? `${numeroFicha(vibSummary.count)} lectura(s) registradas para ${equipo.componente || equipo.activo}.` : 'No hay tendencia suficiente para este componente.';
    document.getElementById('ficha-termo-subtitulo').textContent = termoSummary.count ? `${numeroFicha(termoSummary.count)} inspección(es) térmicas registradas para ${equipo.componente || equipo.activo}.` : 'No hay tendencia térmica disponible para este componente.';
}

function renderListasFicha(equipo, medicionesEquipo, medicionesGrupo, tareasRelacionadas, fuenteMediciones) {
    const vibs = medicionesEquipo.filter(m => m.tipo === 'vibracion').sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    const termos = medicionesEquipo.filter(m => m.tipo === 'termografia').sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    const lubs = medicionesEquipo.filter(m => m.tipo === 'lubricacion').sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    const siblingEquipos = estado.equipos.filter(item => item.activo === equipo.activo && item.ubicacion === equipo.ubicacion);
    const siblingIds = new Set(siblingEquipos.map(item => String(item.id)));
    const vibSummary = obtenerResumenMedicionesFicha(medicionesEquipo, 'vibracion');
    const termoSummary = obtenerResumenMedicionesFicha(medicionesEquipo, 'termografia');
    const overallStatus = consolidarEstadoFicha([vibSummary.count ? vibSummary.status : null, termoSummary.count ? termoSummary.status : null].filter(Boolean));
    const ultimaActividad = tareasRelacionadas[0] || null;
    const pulsoActivo = getPulsoActivoFicha(equipo, { vibracion: vibSummary, termografia: termoSummary }, tareasRelacionadas);
    const brechaVib = getBrechaUmbralFicha('vibracion', vibSummary);
    const brechaTermo = getBrechaUmbralFicha('termografia', termoSummary);
    const comparativaVib = getComparativaGrupoFicha(equipo, siblingEquipos, medicionesGrupo, 'vibracion');
    const comparativaTermo = getComparativaGrupoFicha(equipo, siblingEquipos, medicionesGrupo, 'termografia');
    const comparativaTone = priorizarToneFicha(comparativaVib.tone, comparativaTermo.tone);
    const comparativaValue = comparativaVib.value !== 'Sin dato'
        ? `Vib ${comparativaVib.value}`
        : (comparativaTermo.value !== 'Sin dato' ? `Temp ${comparativaTermo.value}` : numeroFicha(siblingEquipos.length));
    const comparativaMeta = [
        comparativaVib.value !== 'Sin dato' ? `Vibracion: ${comparativaVib.meta}` : '',
        comparativaTermo.value !== 'Sin dato' ? `Termografia: ${comparativaTermo.meta}` : ''
    ].filter(Boolean).join(' / ') || (siblingEquipos.length > 1
        ? 'Hay componentes hermanos, pero aun no existe una base comparable.'
        : 'Activo sin componentes comparables en esta unidad.');
    const totalLecturas = vibSummary.count + termoSummary.count + lubs.length;

    const critStyles = {
        A: { text: 'Criticidad A', bg: '#fef2f2', color: '#b91c1c', border: '#fecaca' },
        B: { text: 'Criticidad B', bg: '#fff7ed', color: '#b45309', border: '#fdba74' },
        C: { text: 'Criticidad C', bg: '#ecfdf5', color: '#047857', border: '#a7f3d0' }
    };
    const crit = critStyles[equipo.criticidad] || { text: equipo.criticidad || 'Sin criticidad', bg: '#f8fafc', color: '#475569', border: '#cbd5e1' };
    const badgeCrit = document.getElementById('ficha-equipo-criticidad');
    badgeCrit.className = 'badge';
    badgeCrit.textContent = crit.text;
    badgeCrit.style.background = crit.bg;
    badgeCrit.style.color = crit.color;
    badgeCrit.style.border = `1px solid ${crit.border}`;
    document.getElementById('ficha-equipo-nombre').textContent = `${equipo.activo}${equipo.componente ? ' - ' + equipo.componente : ''}`;
    document.getElementById('ficha-equipo-ubicacion').textContent = equipo.ubicacion || 'Sin ubicacion';
    document.getElementById('ficha-equipo-kks').textContent = equipo.kks || 'N/A';
    document.getElementById('ficha-equipo-breadcrumb').innerHTML = `<span>Control</span><i class="fa-solid fa-angle-right"></i><span>${equipo.ubicacion || 'Sin unidad'}</span><i class="fa-solid fa-angle-right"></i><strong>${equipo.activo}</strong>${equipo.componente ? `<i class="fa-solid fa-angle-right"></i><span>${equipo.componente}</span>` : ''}`;
    document.getElementById('ficha-equipo-extra').innerHTML = [
        equipo.denominacion_ut ? `<span><i class="fa-solid fa-tag"></i> ${equipo.denominacion_ut}</span>` : '',
        equipo.frecuencia_nueva ? `<span><i class="fa-solid fa-clock-rotate-left"></i> Frecuencia: ${equipo.frecuencia_nueva} dias</span>` : '',
        equipo.ruta ? `<span><i class="fa-solid fa-route"></i> ${equipo.ruta}</span>` : '',
        equipo.ubicacion_tecnica ? `<span><i class="fa-solid fa-diagram-project"></i> ${equipo.ubicacion_tecnica}</span>` : ''
    ].filter(Boolean).join('');

    const sourceEl = document.getElementById('ficha-equipo-source');
    const sourceMap = {
        online: '<i class="fa-solid fa-cloud-arrow-down"></i> Datos online',
        estado: '<i class="fa-solid fa-bolt"></i> Cache de sesion',
        local: '<i class="fa-solid fa-hard-drive"></i> Cache local',
        none: '<i class="fa-solid fa-circle-info"></i> Sin mediciones'
    };
    sourceEl.innerHTML = sourceMap[fuenteMediciones] || sourceMap.none;
    sourceEl.style.display = 'inline-flex';

    document.getElementById('ficha-equipo-actions').innerHTML = `
        <button class="btn btn-outline planify-ficha-action-btn" onclick="window.irAHistorialDeEquipo('${equipo.id}')"><i class="fa-solid fa-clock-rotate-left"></i> Historial</button>
        <button class="btn btn-outline planify-ficha-action-btn" onclick="window.irAControlConBusqueda('${equipo.id}')"><i class="fa-solid fa-magnifying-glass"></i> Buscar</button>
        <button class="btn btn-outline planify-ficha-action-btn" onclick="window.abrirVistaUnidad('${String(equipo.ubicacion || '').replace(/'/g, "\\'")}')"><i class="fa-solid fa-location-dot"></i> Unidad</button>
    `;

    document.getElementById('ficha-equipo-overview').innerHTML = [
        crearTarjetaResumenFicha({ label: 'Estado actual', value: overallStatus.label, meta: vibSummary.count || termoSummary.count ? `Vibracion ${vibSummary.count ? vibSummary.status.label : 'sin dato'} / Termografia ${termoSummary.count ? termoSummary.status.label : 'sin dato'}` : 'Aun no existen mediciones registradas para este activo.', icon: 'fa-shield-heart', tone: overallStatus.tone }),
        crearTarjetaResumenFicha({ label: 'Pulso del activo', value: pulsoActivo.value, meta: pulsoActivo.meta, icon: 'fa-heart-pulse', tone: pulsoActivo.tone }),
        crearTarjetaResumenFicha({ label: 'Ultima vibracion', value: vibSummary.latest ? `${numeroFicha(vibSummary.latest.valor, 2)} ${vibSummary.latest.unidad || 'mm/s'}` : 'Sin dato', meta: vibSummary.latest ? `${formatearFechaFicha(vibSummary.latest.fecha)} / ${vibSummary.latest.punto_medicion || 'General'} / ${vibSummary.status.label}` : 'Sin lecturas de vibracion.', icon: 'fa-wave-square', tone: vibSummary.count ? vibSummary.status.tone : '' }),
        crearTarjetaResumenFicha({ label: 'Ultima termografia', value: termoSummary.latest ? `${numeroFicha(termoSummary.latest.valor, 1)} ${termoSummary.latest.unidad || 'C'}` : 'Sin dato', meta: termoSummary.latest ? `${formatearFechaFicha(termoSummary.latest.fecha)} / ${termoSummary.latest.punto_medicion || 'General'} / ${termoSummary.status.label}` : 'Sin lecturas termicas.', icon: 'fa-temperature-three-quarters', tone: termoSummary.count ? termoSummary.status.tone : '' }),
        crearTarjetaResumenFicha({ label: 'Intervenciones', value: numeroFicha(tareasRelacionadas.length), meta: ultimaActividad ? `Ultimo cierre: ${formatearFechaFicha(ultimaActividad.created_at || ultimaActividad.fecha_termino || ultimaActividad.fecha_inicio)} / ${numeroFicha(totalLecturas)} lectura(s) asociadas` : `${numeroFicha(totalLecturas)} lectura(s) en el historial del activo.`, icon: 'fa-screwdriver-wrench' }),
        crearTarjetaResumenFicha({ label: 'Comparativa del activo', value: comparativaValue, meta: comparativaMeta, icon: 'fa-code-compare', tone: comparativaTone })
    ].join('');

    document.getElementById('ficha-resumen-vibracion').innerHTML = vibSummary.count ? [
        crearTarjetaMiniFicha({ label: 'Tendencia', value: vibSummary.trend.label, meta: vibSummary.trend.meta, tone: vibSummary.trend.className }),
        crearTarjetaMiniFicha({ label: 'Promedio', value: `${numeroFicha(vibSummary.avg, 2)} mm/s`, meta: `${numeroFicha(vibSummary.count)} lectura(s) en el rango`, tone: vibSummary.status.tone }),
        crearTarjetaMiniFicha({ label: 'Maximo', value: `${numeroFicha(vibSummary.max, 2)} mm/s`, meta: `Estado actual: ${vibSummary.status.label}`, tone: getEstadoCondicionFicha('vibracion', vibSummary.max).tone }),
        crearTarjetaMiniFicha({ label: 'Brecha al umbral', value: brechaVib.value, meta: brechaVib.meta, tone: brechaVib.tone })
    ].join('') : emptyFichaState('Sin vibraciones registradas', 'Cuando se agreguen lecturas de vibracion apareceran aqui con tendencia, promedio, maximo y brecha al umbral.');

    document.getElementById('ficha-resumen-termografia').innerHTML = termoSummary.count ? [
        crearTarjetaMiniFicha({ label: 'Tendencia', value: termoSummary.trend.label, meta: termoSummary.trend.meta, tone: termoSummary.trend.className }),
        crearTarjetaMiniFicha({ label: 'Promedio', value: `${numeroFicha(termoSummary.avg, 1)} C`, meta: `${numeroFicha(termoSummary.count)} lectura(s) en el rango`, tone: termoSummary.status.tone }),
        crearTarjetaMiniFicha({ label: 'Maximo', value: `${numeroFicha(termoSummary.max, 1)} C`, meta: `Estado actual: ${termoSummary.status.label}`, tone: getEstadoCondicionFicha('termografia', termoSummary.max).tone }),
        crearTarjetaMiniFicha({ label: 'Brecha al umbral', value: brechaTermo.value, meta: brechaTermo.meta, tone: brechaTermo.tone })
    ].join('') : emptyFichaState('Sin termografia registrada', 'Cuando se agreguen lecturas termicas apareceran aqui con tendencia, promedio, maximo y brecha al umbral.');

    document.getElementById('lista-mediciones-vibracion').innerHTML = vibs.length ? vibs.slice(0, 6).map(item => renderLecturaFicha(item, 'vibracion')).join('') : emptyFichaState('Sin vibraciones recientes', 'No hay lecturas de vibracion para este equipo en el rango disponible.');
    document.getElementById('lista-mediciones-termografia').innerHTML = termos.length ? termos.slice(0, 6).map(item => renderLecturaFicha(item, 'termografia')).join('') : emptyFichaState('Sin inspecciones termicas', 'Aun no se registran inspecciones termicas para este equipo.');
document.getElementById('lista-mediciones-lubricacion').innerHTML = lubs.length ? lubs.slice(0, 6).map(item => `<article id="med-${item.id}" class="planify-ficha-reading"><div class="planify-ficha-reading-top"><div><div class="planify-ficha-reading-title">${item.punto_medicion || 'Actividad de lubricacion'}</div><div class="planify-ficha-reading-meta"><span><i class="fa-regular fa-calendar"></i> ${formatearFechaHoraFicha(item.fecha)}</span><span><i class="fa-solid fa-user-gear"></i> ${item.tecnico_nombre || 'Sin técnico'}</span></div></div><div class="planify-ficha-reading-value">${item.valor || 'Registro'}</div></div><div style="display:flex;justify-content:space-between;gap:.75rem;align-items:flex-start;"><div class="planify-ficha-reading-note">${item.observaciones || 'Sin observaciones registradas.'}</div><button onclick="window._borrarMedicion('${item.id}')" title="Eliminar medicion" style="background:none;border:none;cursor:pointer;color:#94a3b8;padding:2px 4px;font-size:0.84rem;line-height:1;" onmouseover="this.style.color='#ef4444'" onmouseout="this.style.color='#94a3b8'"><i class="fa-solid fa-trash"></i></button></div></article>`).join('') : emptyFichaState('Sin cambios de aceite o engrase', 'Esta pestana mostrara registros de lubricacion cuando existan.');
    document.getElementById('ficha-actividad-trabajos').innerHTML = tareasRelacionadas.length ? tareasRelacionadas.map(task => renderActividadFicha(task, equipo)).join('') : emptyFichaState('Sin cierres relacionados', 'No se encontraron trabajos finalizados asociados a este activo.');
    document.getElementById('ficha-componentes-relacionados').innerHTML = siblingEquipos.length ? siblingEquipos.map(item => renderComponenteRelacionadoFicha(item, medicionesGrupo, siblingIds)).join('') : emptyFichaState('Sin componentes relacionados', 'No se encontraron otros componentes del mismo activo en esta unidad.');
    document.getElementById('ficha-vib-subtitulo').textContent = vibSummary.count ? `${numeroFicha(vibSummary.count)} lectura(s) registradas / ultima ${String(vibSummary.status.label || '').toLowerCase()} / pico ${numeroFicha(vibSummary.max, 2)} mm/s.` : 'No hay tendencia suficiente para este componente.';
    document.getElementById('ficha-termo-subtitulo').textContent = termoSummary.count ? `${numeroFicha(termoSummary.count)} lectura(s) termicas / ultima ${String(termoSummary.status.label || '').toLowerCase()} / pico ${numeroFicha(termoSummary.max, 1)} C.` : 'No hay tendencia termica disponible para este componente.';
}

window.abrirFichaTecnica = async function(equipoId) {
    const equipo = estado.equipos.find(item => String(item.id) === String(equipoId));
    if (!equipo) return;

    renderFichaTecnicaModal();
    const modal = document.getElementById('modal-ficha-tecnica');
    if (!modal) return;

    const siblingEquipos = estado.equipos.filter(item =>
        item.activo === equipo.activo && item.ubicacion === equipo.ubicacion
    );
    const siblingIds = siblingEquipos.length
        ? siblingEquipos.map(item => item.id)
        : [equipo.id];

    const getMedEquipoId = med => med?.equipo_id ?? med?.equipoId ?? null;
    const normalize = value => String(value || '').trim().toLowerCase();
    const idsSet = new Set(siblingIds.map(id => String(id)));
    const filtroGrupo = items => (items || []).filter(med => idsSet.has(String(getMedEquipoId(med))));

    renderFichaLoadingState(equipo);
    modal.style.display = 'flex';
    setupFichaEvents();

    let medicionesGrupo = [];
    let fuenteMediciones = 'none';

    if (navigator.onLine && supabaseClient) {
        const tablas = [...new Set([tablasDb.mediciones, 'mediciones', 'historial_mediciones'].filter(Boolean))];
        for (const tabla of tablas) {
            try {
                const { data, error } = await supabaseClient
                    .from(tabla)
                    .select('*')
                    .in('equipo_id', siblingIds)
                    .order('fecha', { ascending: false })
                    .limit(300);

                if (!error && Array.isArray(data) && data.length) {
                    medicionesGrupo = data;
                    fuenteMediciones = 'online';
                    break;
                }

                if (error && !esErrorTablaNoExiste(error)) {
                    console.warn('[Ficha] Error obteniendo mediciones desde', tabla, error.message);
                }
            } catch (error) {
                console.warn('[Ficha] Error inesperado consultando mediciones:', error);
            }
        }
    }

    if (!medicionesGrupo.length) {
        medicionesGrupo = filtroGrupo(estado.historialMediciones);
        if (medicionesGrupo.length) fuenteMediciones = 'estado';
    }

    if (!medicionesGrupo.length && window.localDB?.mediciones) {
        try {
            const locales = await window.localDB.mediciones.getAll();
            medicionesGrupo = filtroGrupo(locales);
            if (medicionesGrupo.length) fuenteMediciones = 'local';
        } catch (error) {
            console.warn('[Ficha] No fue posible leer mediciones locales:', error);
        }
    }

    let medicionesEquipo = medicionesGrupo.filter(med => String(getMedEquipoId(med)) === String(equipo.id));

    if (!medicionesEquipo.length && equipo.componente) {
        medicionesEquipo = medicionesGrupo.filter(med =>
            normalize(med.componente || med.punto_medicion) === normalize(equipo.componente)
        );
    }

    if (!medicionesEquipo.length) {
        medicionesEquipo = medicionesGrupo.filter(med => {
            const equipoAsociado = estado.equipos.find(item => String(item.id) === String(getMedEquipoId(med)));
            return equipoAsociado &&
                equipoAsociado.activo === equipo.activo &&
                equipoAsociado.ubicacion === equipo.ubicacion;
        });
    }

    const tareasRelacionadas = getTareasRelacionadasFicha(equipo, siblingIds);
    renderListasFicha(equipo, medicionesEquipo, medicionesGrupo, tareasRelacionadas, fuenteMediciones);

    setTimeout(() => initFichaCharts(medicionesEquipo), 40);
};

window.abrirModalTipoBadge = function(tipo, tareaId) {
    const TIPOS_INFO = {
        'medición de vibraciones': {
            icon: '📳',
            titulo: 'Medición de vibraciones',
            descripcion: 'Análisis del nivel de vibración global de un equipo rotativo, expresado en mm/s. Se mide con un vibrómetro o analizador de vibraciones colocado sobre el equipo en operación.',
            tecnica: 'Se toman lecturas en puntos definidos del equipo (rodamientos, carcasa, base) con el sensor apoyado firmemente. Los valores se registran en mm/s RMS y se comparan con mediciones anteriores para detectar tendencias anómalas.'
        },
        'termografía': {
            icon: '🌡️',
            titulo: 'Termografía',
            descripcion: 'Inspección con cámara infrarroja para detectar puntos calientes en equipos eléctricos y mecánicos. Permite identificar fallas antes de que generen una detención imprevista.',
            tecnica: 'Se escanea el equipo con la cámara termográfica mientras opera en condiciones normales de carga. Se identifican asimetrías térmicas entre fases eléctricas o puntos calientes en rodamientos, acoplamientos y conexiones.'
        },
        'lubricación': {
            icon: '🛢️',
            titulo: 'Lubricación',
            descripcion: 'Aplicación de lubricante en puntos de engrase para reducir fricción y desgaste en equipos rotativos, extendiéndoles la vida útil.',
            tecnica: 'Se aplica la cantidad indicada de grasa o aceite según la ficha técnica del equipo, usando engrasadora manual o automática. Se purgan los puntos si corresponde y se verifica la ausencia de contaminantes.'
        },
        'cambio de aceite': {
            icon: '🔄',
            titulo: 'Cambio de aceite',
            descripcion: 'Sustitución del aceite en cárter o sistema hidráulico para mantener las propiedades lubricantes y evitar daño por degradación.',
            tecnica: 'Se drena el aceite usado con el equipo en temperatura de operación, se limpia el cárter, se reemplaza el filtro si aplica, y se rellena con el tipo y volumen de aceite indicado en la ficha técnica.'
        },
        'cambios de aceite': {
            icon: '🔄',
            titulo: 'Cambio de aceite',
            descripcion: 'Sustitución del aceite en cárter o sistema hidráulico para mantener las propiedades lubricantes y evitar daño por degradación.',
            tecnica: 'Se drena el aceite usado con el equipo en temperatura de operación, se limpia el cárter, se reemplaza el filtro si aplica, y se rellena con el tipo y volumen de aceite indicado en la ficha técnica.'
        },
        'end (tintas penetrantes)': {
            icon: '🔬',
            titulo: 'END / Tintas Penetrantes',
            descripcion: 'Ensayo no destructivo para detectar discontinuidades superficiales como grietas o porosidades en componentes metálicos, sin dañar la pieza.',
            tecnica: 'Se limpia la superficie, se aplica el líquido penetrante, se espera el tiempo de penetración, se elimina el exceso y se aplica revelador. Las indicaciones visibles señalan discontinuidades.'
        },
        'end': {
            icon: '🔬',
            titulo: 'Ensayo No Destructivo',
            descripcion: 'Técnica de inspección que evalúa la integridad de un componente sin alterarlo ni dañarlo, detectando defectos internos o superficiales.',
            tecnica: 'Dependiendo del método (ultrasonido, partículas magnéticas, tintas penetrantes), se prepara la superficie y se aplica el procedimiento normalizado correspondiente para obtener indicaciones interpretables.'
        },
        'tintas penetrantes': {
            icon: '🔬',
            titulo: 'Tintas Penetrantes',
            descripcion: 'Método de inspección no destructivo que detecta fisuras y discontinuidades abiertas a la superficie en materiales no porosos.',
            tecnica: 'Se aplica el líquido penetrante sobre la zona limpia, se deja actuar, se elimina el exceso y se aplica revelador en polvo. Las indicaciones coloreadas revelan la ubicación y forma de los defectos.'
        },
        'medición de espesores': {
            icon: '📏',
            titulo: 'Medición de Espesores',
            descripcion: 'Medición ultrasónica del espesor de paredes metálicas para detectar y monitorear pérdida de material por corrosión o erosión.',
            tecnica: 'Se aplica gel acoplante en la superficie limpia y se apoya la sonda ultrasónica perpendicularmente. El equipo mide el tiempo de vuelo del pulso ultrasónico para calcular el espesor real de la pared.'
        },
        'balanceo': {
            icon: '⚖️',
            titulo: 'Balanceo',
            descripcion: 'Corrección del desbalance dinámico en rotores para reducir vibración, ruido y desgaste prematuro de rodamientos y sellos.',
            tecnica: 'Se miden las vibraciones del rotor en operación, se identifica el plano y ángulo de corrección mediante el analizador, y se agregan o retiran masas de corrección hasta alcanzar niveles de vibración aceptables.'
        },
        'dureza': {
            icon: '💎',
            titulo: 'Medición de Dureza',
            descripcion: 'Medición de la resistencia superficial de un material a la deformación, para verificar tratamientos térmicos o detectar cambios metalúrgicos por temperatura o fatiga.',
            tecnica: 'Se aplica una carga controlada sobre la superficie preparada con un indentador calibrado. El tamaño de la huella resultante determina el valor de dureza en la escala correspondiente (HB, HRC, HV).'
        },
        'inspección visual': {
            icon: '👁️',
            titulo: 'Inspección Visual',
            descripcion: 'Revisión directa del estado externo del equipo para detectar anomalías visibles como fugas, corrosión, desgaste, daños o condiciones inseguras.',
            tecnica: 'El técnico recorre el equipo siguiendo una lista de verificación, registrando hallazgos con descripción y fotografías si aplica. Se evalúa el estado general y se determina si se requieren acciones correctivas.'
        },
    };

    const key = tipo.toLowerCase().trim();
    const info = TIPOS_INFO[key] || {
        icon: '🔧', titulo: tipo,
        descripcion: 'Trabajo de mantenimiento preventivo o correctivo.',
        tecnica: ''
    };

    // ── Construir HTML del modal ──────────────────────────────────────────────
    const tecnicaHtml = info.tecnica ? `
        <div style="font-size:0.7rem; font-weight:700; color:#94a3b8; letter-spacing:0.08em; margin:1rem 0 0.4rem;">TÉCNICA</div>
        <p style="font-size:0.87rem; color:#475569; margin:0; line-height:1.55;">${info.tecnica}</p>` : '';

    // Crear/reemplazar modal
    document.getElementById('modal-tipo-badge')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'modal-tipo-badge';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9000;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity 200ms;';
    overlay.innerHTML = `
        <div style="background:#fff;border-radius:16px;width:95%;max-width:440px;padding:1.5rem 1.5rem 1.3rem;box-shadow:0 20px 50px rgba(0,0,0,0.2);max-height:90vh;overflow-y:auto;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:0.9rem;">
                <div>
                    <div style="font-size:1.8rem;line-height:1;">${info.icon}</div>
                    <div style="font-size:1.1rem;font-weight:700;color:#111827;margin-top:0.3rem;">${info.titulo}</div>
                </div>
                <button onclick="document.getElementById('modal-tipo-badge').remove()"
                    style="background:#f3f4f6;border:none;border-radius:8px;width:30px;height:30px;cursor:pointer;font-size:1rem;color:#6b7280;flex-shrink:0;">&times;</button>
            </div>
            <div style="font-size:0.7rem;font-weight:700;color:#94a3b8;letter-spacing:0.08em;margin-bottom:0.4rem;">DESCRIPCIÓN</div>
            <p style="font-size:0.87rem;color:#475569;margin:0 0 0.2rem;line-height:1.55;">${info.descripcion}</p>
            ${tecnicaHtml}
        </div>`;
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
    requestAnimationFrame(() => { overlay.style.opacity = '1'; });
};

window._borrarMedicion = async (id) => {
    if (!confirm('¿Eliminar esta medición?')) return;
    if (supabaseClient) {
        await supabaseClient.from(tablasDb.mediciones).delete().eq('id', id);
    }
    estado.historialMediciones = estado.historialMediciones.filter(m => m.id !== id);
    if (window.localDB) await window.localDB.mediciones.delete(id).catch(() => {});
    const el = document.getElementById(`med-${id}`);
    if (el) el.remove();
};

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

function initFichaCharts(mediciones) {
    activeCharts.forEach(chart => chart?.destroy?.());
    activeCharts = [];

    if (!window.Chart) return;

    const ordenadas = [...(mediciones || [])].sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
    const vibraciones = ordenadas.filter(item => item.tipo === 'vibracion');
    const termografias = ordenadas.filter(item => item.tipo === 'termografia');

    const crearLineaUmbral = (labels, valor, color, texto) => ({
        label: texto,
        data: labels.map(() => valor),
        borderColor: color,
        borderDash: [6, 6],
        borderWidth: 1.2,
        pointRadius: 0,
        fill: false,
        tension: 0,
        order: 99
    });

    const canvasVib = document.getElementById('chart-vibraciones');
    if (canvasVib) {
        const ctxVib = canvasVib.getContext('2d');
        const gradientVib = ctxVib.createLinearGradient(0, 0, 0, 280);
        gradientVib.addColorStop(0, 'rgba(255, 105, 0, 0.28)');
        gradientVib.addColorStop(1, 'rgba(255, 105, 0, 0.02)');
        const labelsVib = vibraciones.map(item => formatearFechaFicha(item.fecha));

        activeCharts.push(new window.Chart(ctxVib, {
            type: 'line',
            data: {
                labels: labelsVib,
                datasets: [
                    {
                        label: 'Vibración global',
                        data: vibraciones.map(item => Number(item.valor || 0)),
                        borderColor: '#ff6900',
                        backgroundColor: gradientVib,
                        fill: true,
                        tension: 0.34,
                        borderWidth: 3,
                        pointRadius: 4,
                        pointHoverRadius: 5,
                        pointBackgroundColor: '#ffffff',
                        pointBorderColor: '#ff6900',
                        pointBorderWidth: 2,
                        order: 1
                    },
                    ...(labelsVib.length ? [
                        crearLineaUmbral(labelsVib, 3.2, 'rgba(217,119,6,0.9)', 'Seguimiento'),
                        crearLineaUmbral(labelsVib, 4.5, 'rgba(220,38,38,0.9)', 'Crítico')
                    ] : [])
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        labels: {
                            color: '#475569',
                            usePointStyle: true,
                            boxWidth: 10
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: context => `${context.dataset.label}: ${numeroFicha(context.parsed.y, 2)} mm/s`
                        }
                    }
                },
                scales: {
                    x: {
                        ticks: { color: '#64748b' },
                        grid: { color: 'rgba(226,232,240,0.75)' }
                    },
                    y: {
                        ticks: {
                            color: '#64748b',
                            callback: value => `${numeroFicha(value, 1)} mm/s`
                        },
                        grid: { color: 'rgba(226,232,240,0.75)' },
                        suggestedMin: 0,
                        suggestedMax: Math.max(5, ...vibraciones.map(item => Number(item.valor || 0) + 0.6))
                    }
                }
            }
        }));
    }

    const canvasTermo = document.getElementById('chart-termografia');
    if (canvasTermo) {
        const ctxTermo = canvasTermo.getContext('2d');
        const gradientTermo = ctxTermo.createLinearGradient(0, 0, 0, 280);
        gradientTermo.addColorStop(0, 'rgba(13, 148, 136, 0.26)');
        gradientTermo.addColorStop(1, 'rgba(13, 148, 136, 0.03)');
        const labelsTermo = termografias.map(item => formatearFechaFicha(item.fecha));

        activeCharts.push(new window.Chart(ctxTermo, {
            type: 'line',
            data: {
                labels: labelsTermo,
                datasets: [
                    {
                        label: 'Temperatura máxima',
                        data: termografias.map(item => Number(item.valor || 0)),
                        borderColor: '#0f766e',
                        backgroundColor: gradientTermo,
                        fill: true,
                        tension: 0.28,
                        borderWidth: 3,
                        pointRadius: 4,
                        pointHoverRadius: 5,
                        pointBackgroundColor: '#ffffff',
                        pointBorderColor: '#0f766e',
                        pointBorderWidth: 2,
                        order: 1
                    },
                    ...(labelsTermo.length ? [
                        crearLineaUmbral(labelsTermo, 65, 'rgba(217,119,6,0.9)', 'Seguimiento'),
                        crearLineaUmbral(labelsTermo, 80, 'rgba(220,38,38,0.9)', 'Crítico')
                    ] : [])
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        labels: {
                            color: '#475569',
                            usePointStyle: true,
                            boxWidth: 10
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: context => `${context.dataset.label}: ${numeroFicha(context.parsed.y, 1)} °C`
                        }
                    }
                },
                scales: {
                    x: {
                        ticks: { color: '#64748b' },
                        grid: { color: 'rgba(226,232,240,0.75)' }
                    },
                    y: {
                        ticks: {
                            color: '#64748b',
                            callback: value => `${numeroFicha(value, 0)} °C`
                        },
                        grid: { color: 'rgba(226,232,240,0.75)' },
                        suggestedMin: 0,
                        suggestedMax: Math.max(85, ...termografias.map(item => Number(item.valor || 0) + 4))
                    }
                }
            }
        }));
    }
}

function setupFichaEvents() {
    const modal = document.getElementById('modal-ficha-tecnica');
    if (!modal) return;

    const panes = [...modal.querySelectorAll('.tab-pane')];
    const tabs = [...modal.querySelectorAll('.tab-btn')];
    const closeFicha = () => {
        modal.style.display = 'none';
    };

    const btnCerrar = document.getElementById('btn-cerrar-ficha');
    if (btnCerrar) btnCerrar.onclick = closeFicha;

    modal.onclick = event => {
        if (event.target === modal) closeFicha();
    };

    if (window._planifyFichaEscHandler) {
        document.removeEventListener('keydown', window._planifyFichaEscHandler);
    }
    window._planifyFichaEscHandler = event => {
        if (event.key === 'Escape' && modal.style.display !== 'none') {
            closeFicha();
        }
    };
    document.addEventListener('keydown', window._planifyFichaEscHandler);

    const activarTab = target => {
        tabs.forEach(tab => tab.classList.toggle('active', tab.dataset.target === target));
        panes.forEach(pane => {
            pane.style.display = pane.id === target ? 'block' : 'none';
        });
    };

    tabs.forEach(tab => {
        tab.onclick = () => activarTab(tab.dataset.target);
    });

    activarTab('tab-vibraciones');
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

            // Ordenar: primero por nombre de activo, luego por número de unidad (menor primero)
            const extractUnitNum = ubicacion => {
                const m = (ubicacion || '').match(/(\d+)/);
                return m ? parseInt(m[1]) : 9999;
            };
            const gruposOrdenados = Object.entries(grupos).sort(([keyA, eqsA], [keyB, eqsB]) => {
                const nombreA = eqsA[0].activo || '';
                const nombreB = eqsB[0].activo || '';
                if (nombreA !== nombreB) return nombreA.localeCompare(nombreB);
                return extractUnitNum(eqsA[0].ubicacion) - extractUnitNum(eqsB[0].ubicacion);
            });

            const tarjetas = gruposOrdenados.map(([_key, eqs]) => {
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
                        <div onclick="window.abrirFichaTecnica('${eq.id}')" style="
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

function formatearMomentoSyncUI(timestamp) {
    if (!timestamp) return 'Ultima sincronizacion: aun no registrada';

    const diff = Date.now() - timestamp;
    if (diff < 60_000) return 'Ultima sincronizacion: hace un momento';
    if (diff < 3_600_000) return `Ultima sincronizacion: hace ${Math.max(1, Math.floor(diff / 60_000))} min`;

    return 'Ultima sincronizacion: ' + new Date(timestamp).toLocaleString('es-CL', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function renderSyncStatusStripUI(status = {}) {
    const chip = document.getElementById('sync-strip-state');
    const queue = document.getElementById('sync-strip-queue');
    const last = document.getElementById('sync-strip-last');
    const button = document.getElementById('btn-sync-now');
    if (!chip || !queue || !last || !button) return;

    const online = status.online !== false;
    const pendientes = Number(status.pendientes || 0);
    const errores = Number(status.errores || 0);
    const sincronizando = Boolean(status.sincronizando);

    let icon = 'fa-circle-check';
    let text = 'Conectado';
    let chipClass = 'sync-chip is-online';
    let queueText = 'Todo al dia';

    if (!online) {
        icon = 'fa-wifi-slash';
        text = 'Modo offline';
        chipClass = 'sync-chip is-offline';
        queueText = pendientes > 0
            ? `${pendientes} cambio(s) esperando conexion`
            : 'Sin conexion, trabajando localmente';
    } else if (sincronizando) {
        icon = 'fa-rotate fa-spin';
        text = 'Sincronizando';
        chipClass = 'sync-chip is-syncing';
        queueText = pendientes > 0
            ? `Procesando ${pendientes} cambio(s) pendiente(s)`
            : 'Actualizando datos en segundo plano';
    } else if (errores > 0) {
        icon = 'fa-triangle-exclamation';
        text = 'Revision necesaria';
        chipClass = 'sync-chip is-warning';
        queueText = `${errores} cambio(s) con error de sincronizacion`;
    } else if (pendientes > 0) {
        icon = 'fa-clock';
        text = 'Pendiente de sincronizar';
        chipClass = 'sync-chip is-warning';
        queueText = `${pendientes} cambio(s) listos para enviar`;
    }

    chip.className = chipClass;
    chip.innerHTML = `<i class="fa-solid ${icon}"></i><span>${text}</span>`;
    queue.textContent = queueText;
    last.textContent = formatearMomentoSyncUI(status.lastSyncAt);

    button.disabled = !online || sincronizando;
    button.innerHTML = sincronizando
        ? '<i class="fa-solid fa-rotate fa-spin"></i><span>Sincronizando...</span>'
        : '<i class="fa-solid fa-rotate-right"></i><span>Sincronizar</span>';
}

async function actualizarEstadoSyncStripUI() {
    try {
        const status = await window.syncQueue?.resumen?.();
        renderSyncStatusStripUI(status || { online: navigator.onLine });
    } catch {
        renderSyncStatusStripUI({ online: navigator.onLine });
    }
}

window.addEventListener('planify:sync-status', event => renderSyncStatusStripUI(event.detail || {}));
window.addEventListener('online', actualizarEstadoSyncStripUI);
window.addEventListener('offline', actualizarEstadoSyncStripUI);

document.getElementById('btn-sync-now')?.addEventListener('click', async () => {
    if (!navigator.onLine) {
        alert('Necesitas conexion para sincronizar cambios.');
        return;
    }

    await window.syncQueue?.procesar?.();
    await actualizarEstadoSyncStripUI();
});

setInterval(() => {
    if (document.getElementById('app')?.style.display !== 'none') {
        actualizarEstadoSyncStripUI();
    }
}, 60_000);

const searchInputOriginal = document.getElementById('input-buscar-ot');
const searchCloseOriginal = document.getElementById('btn-cerrar-busqueda');

if (searchInputOriginal) {
    const improvedSearchInput = searchInputOriginal.cloneNode(true);
    searchInputOriginal.parentNode.replaceChild(improvedSearchInput, searchInputOriginal);

    const improvedCloseButton = searchCloseOriginal ? searchCloseOriginal.cloneNode(true) : null;
    if (searchCloseOriginal && improvedCloseButton) {
        searchCloseOriginal.parentNode.replaceChild(improvedCloseButton, searchCloseOriginal);
    }

    const improvedSearchResults = document.getElementById('search-results-list');
    const improvedSearchOverlay = document.getElementById('search-results-overlay');
    const improvedSearchContainer = document.getElementById('search-container');
    const clearSearchButton = document.getElementById('btn-clear-search');
    let improvedSearchTimer = null;

    function actualizarControlesBusquedaUI() {
        if (!clearSearchButton) return;
        clearSearchButton.style.display = improvedSearchInput.value.trim() ? 'inline-flex' : 'none';
    }

    function cerrarBusquedaUI({ limpiar = false, mantenerFoco = false } = {}) {
        if (improvedSearchOverlay) improvedSearchOverlay.style.display = 'none';
        if (improvedSearchResults) improvedSearchResults.innerHTML = '';
        if (limpiar) improvedSearchInput.value = '';
        actualizarControlesBusquedaUI();
        if (mantenerFoco) improvedSearchInput.focus();
    }

    function construirResumenBusquedaUI(tareasOT, historialOT, equipos) {
        const chips = [];
        if (tareasOT.length > 0) chips.push(`<span class="search-summary-chip"><i class="fa-solid fa-person-digging"></i> ${tareasOT.length} OT en curso</span>`);
        if (historialOT.length > 0) chips.push(`<span class="search-summary-chip"><i class="fa-solid fa-flag-checkered"></i> ${historialOT.length} OT completada(s)</span>`);
        if (equipos.length > 0) chips.push(`<span class="search-summary-chip"><i class="fa-solid fa-microchip"></i> ${equipos.length} equipo(s)</span>`);
        return chips.length ? `<div class="search-summary">${chips.join('')}</div>` : '';
    }

    function renderResultadosOTUI(tareasOT, historialOT) {
        let html = '';

        if (tareasOT.length > 0) {
            html += `<p style="font-size:0.8rem; font-weight:600; color:var(--warning-color); margin:0 0 0.5rem 0;"><i class="fa-solid fa-person-digging"></i> OT EN CURSO</p>`;
            html += tareasOT.map(t => `
                <div style="background:#fffbeb; border:1px solid #fde68a; border-radius:10px; padding:0.8rem 1rem; margin-bottom:0.6rem;">
                    <div style="font-weight:700; color:var(--text-main);">OT ${t.otNumero}</div>
                    <div style="font-size:0.85rem; color:var(--text-muted); margin-top:0.2rem;">${t.tipo}</div>
                    <div style="font-size:0.8rem; color:var(--text-muted); margin-top:0.2rem;">
                        <i class="fa-solid fa-user-tie"></i> ${t.liderNombre || 'Sin lider'} &nbsp;
                        <span class="badge" style="background:var(--warning-color); color:white; font-size:0.7rem;">EN CURSO</span>
                    </div>
                </div>`).join('');
        }

        if (historialOT.length > 0) {
            html += `<p style="font-size:0.8rem; font-weight:600; color:var(--success-color); margin:${tareasOT.length > 0 ? '0.8rem' : '0'} 0 0.5rem 0;"><i class="fa-solid fa-flag-checkered"></i> OT COMPLETADAS</p>`;
            html += historialOT.map(t => `
                <div style="background:#f0fdf4; border:1px solid #86efac; border-radius:10px; padding:0.8rem 1rem; margin-bottom:0.6rem;">
                    <div style="font-weight:700; color:var(--text-main);">OT ${t.ot_numero}</div>
                    <div style="font-size:0.85rem; color:var(--text-muted); margin-top:0.2rem;">${t.tipo}</div>
                    <div style="font-size:0.8rem; color:var(--text-muted); margin-top:0.2rem;">
                        <i class="fa-solid fa-user-tie"></i> ${t.lider_nombre || 'Sin lider'} &nbsp;
                        <i class="fa-regular fa-calendar"></i> ${new Date(t.created_at).toLocaleDateString('es-CL')} &nbsp;
                        <span class="badge" style="background:var(--success-color); color:white; font-size:0.7rem;">COMPLETADA</span>
                    </div>
                </div>`).join('');
        }

        return html;
    }

    function renderResultadosEquiposUI(equipos) {
        if (equipos.length === 0) return '';

        const criticidadColor = { A: '#ef4444', B: '#f59e0b', C: '#22c55e' };
        const grupos = {};

        equipos.forEach(eq => {
            const key = (eq.activo || '') + '||' + (eq.ubicacion || '');
            if (!grupos[key]) grupos[key] = [];
            grupos[key].push(eq);
        });

        const extractUnitNum = ubicacion => {
            const match = (ubicacion || '').match(/(\d+)/);
            return match ? parseInt(match[1], 10) : 9999;
        };

        const gruposOrdenados = Object.entries(grupos).sort(([, eqsA], [, eqsB]) => {
            const nombreA = eqsA[0].activo || '';
            const nombreB = eqsB[0].activo || '';
            if (nombreA !== nombreB) return nombreA.localeCompare(nombreB);
            return extractUnitNum(eqsA[0].ubicacion) - extractUnitNum(eqsB[0].ubicacion);
        });

        const tarjetas = gruposOrdenados.map(([_key, eqs]) => {
            const eq0 = eqs[0];
            const nombre = eq0.activo || 'Equipo sin nombre';
            const crit = (eq0.criticidad || '').toUpperCase();
            const critColor = criticidadColor[crit] || '#6b7280';

            if (eqs.length === 1) {
                return `
                <div onclick="window.abrirFichaTecnica('${eq0.id}')" style="
                    background:var(--card-bg); border:1px solid var(--glass-border); border-radius:12px;
                    padding:1rem; cursor:pointer; transition:box-shadow 0.2s,transform 0.2s; position:relative; overflow:hidden;
                " onmouseenter="this.style.boxShadow='0 4px 20px rgba(0,0,0,0.12)';this.style.transform='translateY(-2px)'"
                   onmouseleave="this.style.boxShadow='none';this.style.transform='translateY(0)'">
                    ${crit ? `<span style="position:absolute;top:0.8rem;right:0.8rem;background:${critColor}22;color:${critColor};border:1px solid ${critColor}66;border-radius:6px;font-size:0.7rem;font-weight:700;padding:2px 7px;">Crit. ${crit}</span>` : ''}
                    <div style="font-weight:700;font-size:0.95rem;color:var(--text-main);margin-bottom:0.3rem;padding-right:3rem;line-height:1.3;">${nombre}</div>
                    ${eq0.componente ? `<div style="font-size:0.82rem;color:var(--primary-color);font-weight:600;margin-bottom:0.6rem;">${eq0.componente}</div>` : ''}
                    <div style="display:flex;flex-direction:column;gap:0.25rem;font-size:0.78rem;color:var(--text-muted);">
                        <span><i class="fa-solid fa-location-dot" style="width:14px;"></i> ${eq0.ubicacion || 'Sin ubicacion'}</span>
                        <span><i class="fa-solid fa-hashtag" style="width:14px;"></i> KKS: ${eq0.kks || 'N/A'}</span>
                        ${eq0.frecuencia_nueva ? `<span><i class="fa-solid fa-rotate" style="width:14px;"></i> Frec: ${eq0.frecuencia_nueva}</span>` : ''}
                    </div>
                    <div style="margin-top:0.8rem;font-size:0.72rem;color:var(--primary-color);font-weight:500;"><i class="fa-solid fa-arrow-right"></i> Ver ficha tecnica</div>
                </div>`;
            }

            const compItems = eqs.map(eq => `
                <div onclick="window.abrirFichaTecnica('${eq.id}')" style="
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
                    <i class="fa-solid fa-location-dot" style="width:14px;"></i> ${eq0.ubicacion || 'Sin ubicacion'}
                </div>
                <div style="display:flex;align-items:center;gap:0.4rem;margin-bottom:0.6rem;">
                    <span style="background:var(--primary-color);color:white;border-radius:999px;font-size:0.7rem;font-weight:700;padding:2px 8px;">${eqs.length} componentes</span>
                </div>
                ${compItems}
            </div>`;
        }).join('');

        return `
            <p style="font-size:0.8rem; color:var(--text-muted); margin: 0 0 1rem 0;">${equipos.length} equipo(s) encontrado(s)</p>
            <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap:1rem;">
                ${tarjetas}
            </div>`;
    }

    function ejecutarBusquedaMejorada(rawQuery) {
        const query = rawQuery.trim().toLowerCase();
        actualizarControlesBusquedaUI();

        if (query.length < 2) {
            cerrarBusquedaUI();
            return;
        }

        const tareasOT = estado.tareas.filter(t => t.otNumero && t.otNumero.toLowerCase().includes(query));
        const historialOT = estado.historialTareas.filter(t => t.ot_numero && t.ot_numero.toLowerCase().includes(query));
        const equipos = estado.equipos.filter(eq =>
            (eq.activo || '').toLowerCase().includes(query) ||
            (eq.componente || '').toLowerCase().includes(query) ||
            (eq.kks || '').toLowerCase().includes(query) ||
            (eq.ubicacion || '').toLowerCase().includes(query) ||
            (eq.ubicacion_original || '').toLowerCase().includes(query)
        );

        const sections = [];
        const otHtml = renderResultadosOTUI(tareasOT, historialOT);
        const equiposHtml = renderResultadosEquiposUI(equipos);

        if (otHtml) sections.push(otHtml);
        if (equiposHtml) sections.push(equiposHtml);

        if (sections.length === 0) {
            improvedSearchResults.innerHTML = `<p style="padding:1rem; color:var(--text-muted); font-size:0.9rem;"><i class="fa-solid fa-circle-xmark"></i> No se encontraron resultados para "<strong>${query}</strong>"</p>`;
            improvedSearchOverlay.style.display = 'block';
            return;
        }

        improvedSearchResults.innerHTML = construirResumenBusquedaUI(tareasOT, historialOT, equipos) +
            sections.join('<hr style="margin:1rem 0; border-color:var(--glass-border);">');
        improvedSearchOverlay.style.display = 'block';
    }

    function esCampoEditableUI(elemento) {
        if (!elemento) return false;
        const tag = (elemento.tagName || '').toLowerCase();
        return tag === 'input' || tag === 'textarea' || elemento.isContentEditable;
    }

    improvedSearchInput.addEventListener('input', event => {
        clearTimeout(improvedSearchTimer);
        improvedSearchTimer = setTimeout(() => ejecutarBusquedaMejorada(event.target.value || ''), 160);
    });

    improvedSearchInput.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            cerrarBusquedaUI({ limpiar: true, mantenerFoco: true });
        }
    });

    clearSearchButton?.addEventListener('click', () => {
        cerrarBusquedaUI({ limpiar: true, mantenerFoco: true });
    });

    improvedCloseButton?.addEventListener('click', () => {
        cerrarBusquedaUI({ limpiar: true });
    });

    document.addEventListener('keydown', event => {
        if (event.key === '/' && !esCampoEditableUI(event.target) && document.getElementById('app')?.style.display !== 'none') {
            event.preventDefault();
            improvedSearchInput.focus();
            improvedSearchInput.select();
        } else if (event.key === 'Escape' && improvedSearchOverlay?.style.display === 'block') {
            cerrarBusquedaUI();
        }
    });

    document.addEventListener('click', event => {
        if (improvedSearchOverlay?.style.display !== 'block') return;
        const target = event.target;
        if (improvedSearchOverlay.contains(target) || improvedSearchContainer?.contains(target)) return;
        cerrarBusquedaUI();
    });

    actualizarControlesBusquedaUI();
}

const loginOverlay = document.getElementById('login-overlay');
const pinModal = document.getElementById('pin-container');
const pinInput = document.getElementById('input-pin');

// Botón Planificador
document.getElementById('btn-login-admin')?.addEventListener('click', () => {
    pinModal.style.display = 'block';
    document.querySelector('.role-cards').style.display = 'none';
    pinInput?.focus();
});

// Cancelar PIN planificador
document.getElementById('btn-cancel-pin')?.addEventListener('click', () => {
    pinModal.style.display = 'none';
    document.querySelector('.role-cards').style.display = 'block';
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
    document.querySelector('.role-cards').style.display = 'none';
    document.getElementById('worker-login-error').style.display = 'none';
    document.getElementById('input-worker-rut').value = '';
    document.getElementById('input-worker-pin').value = '';
    setTimeout(() => document.getElementById('input-worker-rut').focus(), 100);
});

document.getElementById('btn-cancel-worker')?.addEventListener('click', () => {
    document.getElementById('worker-login-container').style.display = 'none';
    document.querySelector('.role-cards').style.display = 'block';
    document.getElementById('worker-login-error').style.display = 'none';
    document.getElementById('input-worker-rut').value = '';
    document.getElementById('input-worker-pin').value = '';
});

// Permitir Enter en el campo PIN para enviar
document.getElementById('input-worker-pin')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') validarWorkerLogin();
});

document.getElementById('btn-submit-worker')?.addEventListener('click', validarWorkerLogin);

// Normaliza RUT: mayúsculas, sin puntos/guiones, y dígito verificador '0' → 'K'
// (permite que trabajadores con RUT terminado en K también ingresen usando 0)
function _rutCanon(valor) {
    let r = String(valor || '').replace(/[.\-\s]/g, '').toUpperCase();
    if (r.length > 0 && r.endsWith('0')) r = r.slice(0, -1) + 'K';
    return r;
}

async function validarWorkerLogin() {
    const rutInput = _rutCanon(document.getElementById('input-worker-rut')?.value || '');
    const pinInput = (document.getElementById('input-worker-pin')?.value || '').trim();
    const errEl   = document.getElementById('worker-login-error');
    const btn     = document.getElementById('btn-submit-worker');

    if (!rutInput || !pinInput) {
        errEl.textContent = 'Ingresa tu RUT y PIN.';
        errEl.style.display = 'block';
        return;
    }
    if (pinInput.length !== 4) {
        errEl.textContent = 'El PIN debe ser de 4 dígitos.';
        errEl.style.display = 'block';
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Verificando...';
    errEl.style.display = 'none';

    // Buscar trabajador por RUT (local primero, luego Supabase). Canónico trata K==0.
    let trabajador = estado.trabajadores.find(t => _rutCanon(t.rut) === rutInput);

    if (!trabajador && navigator.onLine && supabaseClient) {
        try {
            const { data: lista } = await supabaseClient
                .from('trabajadores')
                .select('*');
            const data = (lista || []).find(t => _rutCanon(t.rut) === rutInput) || null;
            if (data) {
                trabajador = data;
                // Incorporar al estado local si no estaba
                if (!estado.trabajadores.find(t => t.id === data.id)) {
                    estado.trabajadores = [...estado.trabajadores, data];
                }
            }
        } catch(e) { /* sin conexión */ }
    }

    // Calcular PIN esperado desde fecha_nacimiento (formato: YYYY-MM-DD → DDMM)
    let pinCorrecto = false;
    if (trabajador?.fecha_nacimiento) {
        const partes = trabajador.fecha_nacimiento.split('-'); // ['YYYY','MM','DD']
        const dia = (partes[2] || '').substring(0, 2).padStart(2, '0');
        const mes = (partes[1] || '').padStart(2, '0');
        pinCorrecto = pinInput === `${dia}${mes}`;
    }

    if (!trabajador || !pinCorrecto) {
        errEl.textContent = 'RUT o PIN incorrecto. Consulta al planificador.';
        errEl.style.display = 'block';
        document.getElementById('input-worker-pin').value = '';
        document.getElementById('input-worker-pin').focus();
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-clipboard-check"></i> Ingresar y hacer Check-in';
        return;
    }

    await updateTrabajadorDisponibilidad(trabajador.id, true);
    estado.trabajadores = estado.trabajadores.map(t =>
        t.id === trabajador.id ? { ...t, disponible: true } : t
    );

    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-clipboard-check"></i> Ingresar y hacer Check-in';

    accederApp('trabajador', { ...trabajador, disponible: true });
}

function accederApp(rol, trabajadorObj = null) {
    estado.usuarioActual = rol;
    estado.trabajadorLogueado = trabajadorObj;
    loginOverlay.style.display = 'none';
    document.getElementById('app').style.display = 'block';
    actualizarEstadoSyncStripUI();

    // Visibilidad de nav según rol
    const navRoles = {
        'nav-mis-horas':          ['trabajador'],
        'nav-control':            ['admin'],
        'nav-semanal':            ['admin'],
        'nav-historial':          ['admin'],
        'nav-trabajadores':       ['admin'],
        'nav-checkin':            ['admin'],
        'nav-horas-extra-admin':  ['admin'],
        'nav-insumos':            ['admin', 'trabajador'],
        'nav-mobile-semanal':     ['admin', 'trabajador'],
        'nav-mobile-hours':       ['trabajador'],
        'nav-mobile-perfil':      ['trabajador'],
        'nav-mobile-insumos':     ['admin', 'trabajador'],
        'nav-mobile-menu':        [],
        'nav-perfil':             ['trabajador'],
        'btn-copy-link':          ['admin']
    };
    Object.entries(navRoles).forEach(([id, roles]) => {
        const el = document.getElementById(id);
        if (!el) return;
        const visibleDisplay = id.startsWith('nav-mobile') ? 'inline-flex' : 'inline-block';
        el.style.display = roles.includes(rol) ? visibleDisplay : 'none';
    });
    const setMobileDockItem = (id, icon, label) => {
        const el = document.getElementById(id);
        if (!el) return;
        const iconEl = el.querySelector('i');
        const labelEl = el.querySelector('span');
        if (iconEl) iconEl.className = `fa-solid ${icon}`;
        if (labelEl) labelEl.textContent = label;
    };
    if (rol === 'trabajador') {
        setMobileDockItem('nav-mobile-dashboard', 'fa-house', 'Inicio');
        setMobileDockItem('nav-mobile-semanal', 'fa-helmet-safety', 'Trabajos');
        setMobileDockItem('nav-mobile-hours', 'fa-clock', 'Horas');
        setMobileDockItem('nav-mobile-perfil', 'fa-id-badge', 'Perfil');
        setMobileDockItem('nav-mobile-insumos', 'fa-box-open', 'Insumos');
    } else {
        setMobileDockItem('nav-mobile-dashboard', 'fa-house', 'Inicio');
        setMobileDockItem('nav-mobile-semanal', 'fa-calendar-week', 'Semana');
        setMobileDockItem('nav-mobile-insumos', 'fa-box-open', 'Insumos');
    }

    // Badge de pendientes solo para planificador
    if (rol === 'admin') actualizarBadgeHE();
    actualizarBadgeInsumos();
    // Monitor SIEMPRE arranca → así los toasts in-app funcionan sin permisos del SO
    iniciarMonitorNotificaciones({ resetBaseline: true });
    // Push remoto (servidor → SO) solo si el usuario ya activó permisos
    if (notificacionesActivadas()) {
        registrarPushRemotoPlanify();
    }

    const esPantallaMovil = window.matchMedia('(max-width: 768px)').matches;
    vistaActual = rol === 'admin'
        ? (esPantallaMovil ? 'dashboard' : 'control')
        : 'dashboard';
    renderizarVistaActual();
}

// Inicialización
window.addEventListener('DOMContentLoaded', () => {
    inicializarDatos();
    actualizarEstadoSyncStripUI();
    registrarResyncNotificaciones();
});

// Registrar Service Worker para PWA
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => {
                console.log('SW registrado:', reg.scope);
                // Activar inmediatamente si hay un SW nuevo esperando
                if (reg.waiting) reg.waiting.postMessage('SKIP_WAITING');
                reg.addEventListener('updatefound', () => {
                    const nw = reg.installing;
                    nw?.addEventListener('statechange', () => {
                        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
                            nw.postMessage('SKIP_WAITING');
                        }
                    });
                });
            })
            .catch(err => console.warn('Error SW:', err));
        // Sin reload automático — evita race condition que vacía el estado
    });
}

// Copiar Link (Contexto Técnico)
function copiarEnlaceFicha(id) {
    const url = window.location.origin + window.location.pathname + '?equipo=' + id;
    navigator.clipboard.writeText(url).then(() => alert('Enlace copiado al portapapeles'));
}
window.copiarEnlaceFicha = copiarEnlaceFicha;

// Botón "Link Visitas" en la navbar — muestra modal con QR + link
document.getElementById('btn-copy-link')?.addEventListener('click', async () => {
    const url = window.location.origin + window.location.pathname;
    let qrDataUrl = '';
    try {
        if (window.QRCode && typeof window.QRCode.toDataURL === 'function') {
            qrDataUrl = await window.QRCode.toDataURL(url, { width: 260, margin: 2, color: { dark: '#0f172a', light: '#ffffff' } });
        }
    } catch (e) { console.warn('QR lib error:', e); }
    if (!qrDataUrl) {
        qrDataUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=10&data=' + encodeURIComponent(url);
    }

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';
    overlay.innerHTML = `
        <div style="background:var(--bg-card,#fff);color:var(--text-main,#0f172a);border-radius:12px;max-width:360px;width:100%;padding:1.5rem;box-shadow:0 20px 40px rgba(0,0,0,.3);text-align:center;">
            <h3 style="margin:0 0 1rem 0;font-size:1.1rem;">Link para Visitas</h3>
            ${qrDataUrl ? `<img src="${qrDataUrl}" alt="QR" style="width:260px;height:260px;max-width:100%;display:block;margin:0 auto 1rem;border-radius:8px;"/>` : '<p style="color:#dc2626;">No se pudo generar el QR</p>'}
            <div style="background:var(--bg-page,#f1f5f9);padding:.5rem .75rem;border-radius:6px;font-size:.8rem;word-break:break-all;margin-bottom:1rem;">${url}</div>
            <div style="display:flex;gap:.5rem;">
                <button id="qr-copy-btn" style="flex:1;padding:.6rem;background:var(--success-color,#16a34a);color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;"><i class="fa-solid fa-copy"></i> Copiar link</button>
                <button id="qr-close-btn" style="flex:1;padding:.6rem;background:var(--text-muted,#64748b);color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;">Cerrar</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    overlay.querySelector('#qr-close-btn').addEventListener('click', close);
    overlay.querySelector('#qr-copy-btn').addEventListener('click', () => {
        navigator.clipboard.writeText(url).then(() => {
            const b = overlay.querySelector('#qr-copy-btn');
            b.innerHTML = '<i class="fa-solid fa-check"></i> ¡Copiado!';
            setTimeout(close, 1000);
        }).catch(() => prompt('Copia este enlace:', url));
    });
});

