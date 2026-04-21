// localDB.js — Capa de persistencia local con IndexedDB
// Expone window.localDB con métodos CRUD para cada store

(function() {
  'use strict';

  const DB_NAME    = 'planify_local';
  const DB_VERSION = 4;

  // ── Stores y sus índices ────────────────────────────────────────────────────
  const STORES = {
    tareas:       { keyPath: 'id', indexes: [{ name: 'estadoTarea', key: 'estadoTarea' }, { name: 'synced', key: 'synced' }] },
    trabajadores: { keyPath: 'id', indexes: [{ name: 'disponible', key: 'disponible' }] },
    historial:    { keyPath: 'id', indexes: [{ name: 'created_at', key: 'created_at' }, { name: 'synced', key: 'synced' }] },
    equipos:      { keyPath: 'id', indexes: [] },
    mediciones:   { keyPath: 'id', indexes: [{ name: 'equipoId', key: 'equipo_id' }, { name: 'synced', key: 'synced' }] },
    cola_sync:    { keyPath: 'id', autoIncrement: true, indexes: [{ name: 'synced', key: 'synced' }, { name: 'timestamp', key: 'timestamp' }] },
    horas_extra:  { keyPath: 'id', indexes: [{ name: 'trabajador_id', key: 'trabajador_id' }, { name: 'fecha', key: 'fecha' }, { name: 'synced', key: 'synced' }] },
    informes_diarios: { keyPath: 'id', indexes: [{ name: 'fecha', key: 'fecha' }, { name: 'updated_at', key: 'updated_at' }] },
    insumos:      { keyPath: 'id', indexes: [{ name: 'codigo', key: 'codigo' }, { name: 'activo', key: 'activo' }] },
    solicitudes_insumos: {
      keyPath: 'id',
      indexes: [
        { name: 'trabajador_id', key: 'trabajador_id' },
        { name: 'estado', key: 'estado' },
        { name: 'fecha_solicitud', key: 'fecha_solicitud' }
      ]
    },
    movimientos_inventario: {
      keyPath: 'id',
      indexes: [
        { name: 'insumo_id', key: 'insumo_id' },
        { name: 'fecha', key: 'fecha' }
      ]
    },
  };

  let _db = null;

  // ── Abrir / crear la DB ─────────────────────────────────────────────────────
  function abrirDB() {
    if (_db) return Promise.resolve(_db);

    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = e => {
        const db = e.target.result;
        for (const [storeName, config] of Object.entries(STORES)) {
          if (!db.objectStoreNames.contains(storeName)) {
            const store = config.autoIncrement
              ? db.createObjectStore(storeName, { keyPath: config.keyPath, autoIncrement: true })
              : db.createObjectStore(storeName, { keyPath: config.keyPath });

            (config.indexes || []).forEach(idx => {
              store.createIndex(idx.name, idx.key, { unique: false });
            });
          }
        }
      };

      req.onsuccess = e => { _db = e.target.result; resolve(_db); };
      req.onerror   = e => reject(e.target.error);
    });
  }

  // ── Helpers de transacción ──────────────────────────────────────────────────
  async function getStore(storeName, mode = 'readonly') {
    const db = await abrirDB();
    return db.transaction(storeName, mode).objectStore(storeName);
  }

  function promisify(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = e => reject(e.target.error);
    });
  }

  // ── CRUD genérico ───────────────────────────────────────────────────────────
  async function getAll(storeName) {
    const store = await getStore(storeName);
    return promisify(store.getAll());
  }

  async function getById(storeName, id) {
    const store = await getStore(storeName);
    return promisify(store.get(id));
  }

  async function upsert(storeName, item) {
    const store = await getStore(storeName, 'readwrite');
    return promisify(store.put(item));
  }

  async function upsertMany(storeName, items) {
    const db = await abrirDB();
    return new Promise((resolve, reject) => {
      const tx    = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      items.forEach(item => store.put(item));
      tx.oncomplete = () => resolve();
      tx.onerror    = e  => reject(e.target.error);
    });
  }

  async function eliminar(storeName, id) {
    const store = await getStore(storeName, 'readwrite');
    return promisify(store.delete(id));
  }

  async function limpiar(storeName) {
    const store = await getStore(storeName, 'readwrite');
    return promisify(store.clear());
  }

  async function getByIndex(storeName, indexName, value) {
    const fieldKey = (STORES[storeName]?.indexes || []).find(idx => idx.name === indexName)?.key || indexName;
    const shouldFallback = typeof value === 'boolean' || indexName === 'synced';

    if (shouldFallback) {
      const items = await getAll(storeName);
      return items.filter(item => item?.[fieldKey] === value);
    }

    try {
      const store = await getStore(storeName);
      const index = store.index(indexName);
      return typeof value === 'undefined'
        ? promisify(index.getAll())
        : promisify(index.getAll(value));
    } catch (error) {
      const items = await getAll(storeName);
      return typeof value === 'undefined'
        ? items
        : items.filter(item => item?.[fieldKey] === value);
    }
  }

  // ── API pública ─────────────────────────────────────────────────────────────
  window.localDB = {
    // Tareas
    tareas: {
      getAll:  ()           => getAll('tareas'),
      get:     (id)         => getById('tareas', id),
      upsert:  (item)       => upsert('tareas', item),
      bulk:    (items)      => upsertMany('tareas', items),
      delete:  (id)         => eliminar('tareas', id),
      clear:   ()           => limpiar('tareas'),
    },
    // Trabajadores
    trabajadores: {
      getAll:  ()           => getAll('trabajadores'),
      get:     (id)         => getById('trabajadores', id),
      upsert:  (item)       => upsert('trabajadores', item),
      bulk:    (items)      => upsertMany('trabajadores', items),
      delete:  (id)         => eliminar('trabajadores', id),
      clear:   ()           => limpiar('trabajadores'),
    },
    // Historial
    historial: {
      getAll:  ()           => getAll('historial'),
      get:     (id)         => getById('historial', id),
      upsert:  (item)       => upsert('historial', item),
      bulk:    (items)      => upsertMany('historial', items),
      delete:  (id)         => eliminar('historial', id),
      clear:   ()           => limpiar('historial'),
      getPendientes: ()     => getByIndex('historial', 'synced', false),
    },
    // Equipos
    equipos: {
      getAll:  ()           => getAll('equipos'),
      get:     (id)         => getById('equipos', id),
      upsert:  (item)       => upsert('equipos', item),
      bulk:    (items)      => upsertMany('equipos', items),
      clear:   ()           => limpiar('equipos'),
    },
    // Mediciones
    mediciones: {
      getAll:  ()           => getAll('mediciones'),
      get:     (id)         => getById('mediciones', id),
      upsert:  (item)       => upsert('mediciones', item),
      bulk:    (items)      => upsertMany('mediciones', items),
      delete:  (id)         => eliminar('mediciones', id),
      getPendientes: ()     => getByIndex('mediciones', 'synced', false),
    },
    // Horas extra
    horas_extra: {
      getAll:           ()           => getAll('horas_extra'),
      get:              (id)         => getById('horas_extra', id),
      upsert:           (item)       => upsert('horas_extra', item),
      bulk:             (items)      => upsertMany('horas_extra', items),
      delete:           (id)         => eliminar('horas_extra', id),
      clear:            ()           => limpiar('horas_extra'),
      getByTrabajador:  (wId)        => getByIndex('horas_extra', 'trabajador_id', wId),
      getPendientes:    ()           => getByIndex('horas_extra', 'synced', false),
    },
    // Informes diarios
    informes_diarios: {
      getAll:           ()           => getAll('informes_diarios'),
      get:              (id)         => getById('informes_diarios', id),
      upsert:           (item)       => upsert('informes_diarios', item),
      bulk:             (items)      => upsertMany('informes_diarios', items),
      delete:           (id)         => eliminar('informes_diarios', id),
      clear:            ()           => limpiar('informes_diarios'),
      getByFecha:       (fecha)      => getByIndex('informes_diarios', 'fecha', fecha),
    },
    // Cola de sincronización
    // Catalogo de insumos
    insumos: {
      getAll:           ()           => getAll('insumos'),
      get:              (id)         => getById('insumos', id),
      upsert:           (item)       => upsert('insumos', item),
      bulk:             (items)      => upsertMany('insumos', items),
      delete:           (id)         => eliminar('insumos', id),
      clear:            ()           => limpiar('insumos'),
      getActivos:       ()           => getByIndex('insumos', 'activo', true),
    },
    // Solicitudes de insumos
    solicitudes_insumos: {
      getAll:           ()           => getAll('solicitudes_insumos'),
      get:              (id)         => getById('solicitudes_insumos', id),
      upsert:           (item)       => upsert('solicitudes_insumos', item),
      bulk:             (items)      => upsertMany('solicitudes_insumos', items),
      delete:           (id)         => eliminar('solicitudes_insumos', id),
      clear:            ()           => limpiar('solicitudes_insumos'),
      getByTrabajador:  (id)         => getByIndex('solicitudes_insumos', 'trabajador_id', id),
      getByEstado:      (estado)     => getByIndex('solicitudes_insumos', 'estado', estado),
    },
    // Movimientos de inventario
    movimientos_inventario: {
      getAll:           ()           => getAll('movimientos_inventario'),
      get:              (id)         => getById('movimientos_inventario', id),
      upsert:           (item)       => upsert('movimientos_inventario', item),
      bulk:             (items)      => upsertMany('movimientos_inventario', items),
      delete:           (id)         => eliminar('movimientos_inventario', id),
      clear:            ()           => limpiar('movimientos_inventario'),
      getByInsumo:      (id)         => getByIndex('movimientos_inventario', 'insumo_id', id),
    },
    cola: {
      getAll:       ()      => getAll('cola_sync'),
      add:          (item)  => upsert('cola_sync', { ...item, timestamp: Date.now(), synced: false, intentos: 0 }),
      update:       (item)  => upsert('cola_sync', item),
      delete:       (id)    => eliminar('cola_sync', id),
      getPendientes:()      => getByIndex('cola_sync', 'synced', false),
      getErrores:   ()      => getByIndex('cola_sync', 'synced', 'error'),
      clear:        ()      => limpiar('cola_sync'),
    },
    // Inicializar DB
    init: abrirDB,
  };

  console.log('[localDB] Módulo cargado.');
})();
