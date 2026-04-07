// syncQueue.js - Cola de sincronizacion offline -> Supabase
// Requiere: localDB.js cargado antes y supabaseClient disponible en window

(function() {
  'use strict';

  const MAX_INTENTOS = 3;
  const LAST_SYNC_KEY = 'planify_last_sync_at';
  let sincronizando = false;
  let ultimoExitoSync = Number(localStorage.getItem(LAST_SYNC_KEY) || 0);

  async function _obtenerEstado() {
    let pendientes = 0;
    let errores = 0;

    try {
      const [cola, colaErr] = await Promise.all([
        window.localDB?.cola.getPendientes() || [],
        window.localDB?.cola.getErrores() || []
      ]);
      pendientes = (cola || []).length;
      errores = (colaErr || []).length;
    } catch (error) {
      console.warn('[syncQueue] No se pudo leer la cola local:', error?.message || error);
    }

    return {
      online: navigator.onLine,
      sincronizando,
      pendientes,
      errores,
      lastSyncAt: ultimoExitoSync || null
    };
  }

  async function _emitirEstado() {
    const estado = await _obtenerEstado();
    window.dispatchEvent(new CustomEvent('planify:sync-status', { detail: estado }));
    return estado;
  }

  function _guardarUltimoExito(timestamp) {
    ultimoExitoSync = timestamp;
    try {
      localStorage.setItem(LAST_SYNC_KEY, String(timestamp));
    } catch {}
  }

  async function addToQueue(tabla, operacion, payload) {
    if (!window.localDB) return;
    await window.localDB.cola.add({ tabla, operacion, payload });
    console.log(`[syncQueue] Encolado: ${operacion} en ${tabla}`);
    await _actualizarBanner();
  }

  async function procesarCola() {
    if (sincronizando) return;
    if (!navigator.onLine) return;
    if (!window.localDB || !window.supabaseClient) return;

    const pendientes = await window.localDB.cola.getPendientes();
    if (pendientes.length === 0) {
      await _actualizarBanner();
      return;
    }

    sincronizando = true;
    console.log(`[syncQueue] Procesando ${pendientes.length} operacion(es) pendiente(s)...`);
    await _actualizarBanner();

    pendientes.sort((a, b) => a.timestamp - b.timestamp);

    for (const item of pendientes) {
      const exito = await _ejecutarOperacion(item);
      if (exito) {
        await window.localDB.cola.delete(item.id);
      } else {
        item.intentos = (item.intentos || 0) + 1;
        if (item.intentos >= MAX_INTENTOS) {
          item.synced = 'error';
          console.error(`[syncQueue] Item ${item.id} fallo ${MAX_INTENTOS} veces. Marcado como error.`);
        }
        await window.localDB.cola.update(item);
      }
    }

    sincronizando = false;

    const estadoFinal = await _obtenerEstado();
    if (estadoFinal.online && estadoFinal.pendientes === 0 && estadoFinal.errores === 0) {
      _guardarUltimoExito(Date.now());
    }

    await _actualizarBanner();
    console.log('[syncQueue] Cola procesada.');
  }

  async function _ejecutarOperacion(item) {
    const { tabla, operacion, payload } = item;
    try {
      let error;
      if (operacion === 'INSERT') {
        ({ error } = await window.supabaseClient.from(tabla).insert([payload]));
      } else if (operacion === 'UPDATE') {
        ({ error } = await window.supabaseClient.from(tabla).update(payload.data).eq('id', payload.id));
      } else if (operacion === 'DELETE') {
        ({ error } = await window.supabaseClient.from(tabla).delete().eq('id', payload.id));
      } else if (operacion === 'UPSERT') {
        ({ error } = await window.supabaseClient.from(tabla).upsert([payload]));
      }

      if (error) {
        console.warn(`[syncQueue] Error en ${operacion} ${tabla}:`, error.message);
        return false;
      }
      return true;
    } catch (err) {
      console.warn(`[syncQueue] Excepcion en ${operacion} ${tabla}:`, err.message);
      return false;
    }
  }

  window.addEventListener('online', () => {
    console.log('[syncQueue] Conexion restaurada. Sincronizando...');
    _actualizarBanner();
    setTimeout(procesarCola, 1500);
  });

  window.addEventListener('offline', () => {
    console.log('[syncQueue] Sin conexion. Modo offline activado.');
    _actualizarBanner();
  });

  async function _actualizarBanner() {
    const banner = document.getElementById('offline-banner');
    const estado = await _emitirEstado();

    if (!banner) return estado;

    if (!estado.online) {
      banner.style.display = 'flex';
      banner.style.background = '#dc2626';
      let msg = 'Sin conexion';
      if (estado.pendientes > 0) msg += ` - <strong>${estado.pendientes}</strong> cambio(s) pendiente(s)`;
      if (estado.errores > 0) msg += ` - <strong>${estado.errores}</strong> con error permanente`;
      banner.innerHTML = `
        <i class="fa-solid fa-wifi-slash" style="font-size:1rem;"></i>
        <span>${msg}</span>
      `;
      return estado;
    }

    if (estado.sincronizando) {
      banner.style.display = 'flex';
      banner.style.background = '#d97706';
      banner.innerHTML = `
        <i class="fa-solid fa-spinner fa-spin" style="font-size:1rem;"></i>
        <span>Sincronizando cambios...</span>
      `;
      return estado;
    }

    if (estado.errores > 0) {
      banner.style.display = 'flex';
      banner.style.background = '#d97706';
      banner.innerHTML = `
        <i class="fa-solid fa-triangle-exclamation" style="font-size:1rem;"></i>
        <span><strong>${estado.errores}</strong> cambio(s) no pudieron sincronizarse. Revisa la conexion o recarga la app.</span>
      `;
      return estado;
    }

    banner.style.display = 'none';
    return estado;
  }

  window.syncQueue = {
    add: addToQueue,
    procesar: procesarCola,
    actualizar: _actualizarBanner,
    resumen: _obtenerEstado
  };

  console.log('[syncQueue] Modulo cargado.');
})();
