// syncQueue.js — Cola de sincronización offline → Supabase
// Requiere: localDB.js cargado antes, supabaseClient disponible como supabaseClient

(function() {
  'use strict';

  const MAX_INTENTOS = 3;
  let sincronizando  = false;

  // ── Agregar operación a la cola ─────────────────────────────────────────────
  async function addToQueue(tabla, operacion, payload) {
    if (!window.localDB) return;
    await window.localDB.cola.add({ tabla, operacion, payload });
    console.log(`[syncQueue] Encolado: ${operacion} en ${tabla}`);
  }

  // ── Procesar toda la cola ───────────────────────────────────────────────────
  async function procesarCola() {
    if (sincronizando) return;
    if (!navigator.onLine) return;
    if (!window.localDB || !window.supabaseClient) return;

    const pendientes = await window.localDB.cola.getPendientes();
    if (pendientes.length === 0) return;

    sincronizando = true;
    console.log(`[syncQueue] Procesando ${pendientes.length} operación(es) pendiente(s)...`);
    _actualizarBanner();

    // Ordenar por timestamp (FIFO)
    pendientes.sort((a, b) => a.timestamp - b.timestamp);

    for (const item of pendientes) {
      const exito = await _ejecutarOperacion(item);
      if (exito) {
        await window.localDB.cola.delete(item.id);
      } else {
        // Incrementar intentos
        item.intentos = (item.intentos || 0) + 1;
        if (item.intentos >= MAX_INTENTOS) {
          item.synced = 'error';
          console.error(`[syncQueue] Item ${item.id} falló ${MAX_INTENTOS} veces. Marcado como error.`);
        }
        await window.localDB.cola.update(item);
      }
    }

    sincronizando = false;
    _actualizarBanner();
    console.log('[syncQueue] Cola procesada.');
  }

  // ── Ejecutar una operación individual contra Supabase ──────────────────────
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
      console.warn(`[syncQueue] Excepción en ${operacion} ${tabla}:`, err.message);
      return false;
    }
  }

  // ── Detectar online/offline y sincronizar automáticamente ──────────────────
  window.addEventListener('online', () => {
    console.log('[syncQueue] Conexión restaurada. Sincronizando...');
    _actualizarBanner();
    // Pequeño delay para asegurar conexión estable
    setTimeout(procesarCola, 1500);
  });

  window.addEventListener('offline', () => {
    console.log('[syncQueue] Sin conexión. Modo offline activado.');
    _actualizarBanner();
  });

  // ── Actualizar el banner visual ─────────────────────────────────────────────
  async function _actualizarBanner() {
    const banner = document.getElementById('offline-banner');
    if (!banner) return;

    let pendientes = 0;
    let errores = 0;
    try {
      const [cola, colaErr] = await Promise.all([
        window.localDB?.cola.getPendientes() || [],
        window.localDB?.cola.getErrores() || []
      ]);
      pendientes = (cola || []).length;
      errores    = (colaErr || []).length;
    } catch {}

    if (!navigator.onLine) {
      banner.style.display = 'flex';
      banner.style.background = '#dc2626';
      let msg = 'Sin conexión';
      if (pendientes > 0) msg += ` — <strong>${pendientes}</strong> cambio(s) pendiente(s)`;
      if (errores > 0)    msg += ` · <strong>${errores}</strong> con error permanente`;
      banner.innerHTML = `
        <i class="fa-solid fa-wifi-slash" style="font-size:1rem;"></i>
        <span>${msg}</span>
      `;
      return;
    }

    if (sincronizando) {
      banner.style.display = 'flex';
      banner.innerHTML = `
        <i class="fa-solid fa-spinner fa-spin" style="font-size:1rem;"></i>
        <span>Sincronizando cambios...</span>
      `;
      banner.style.background = '#d97706';
      return;
    }

    if (errores > 0) {
      banner.style.display = 'flex';
      banner.style.background = '#d97706';
      banner.innerHTML = `
        <i class="fa-solid fa-triangle-exclamation" style="font-size:1rem;"></i>
        <span><strong>${errores}</strong> cambio(s) no pudieron sincronizarse. Revisa la conexión o recarga la app.</span>
      `;
      return;
    }

    // Online, sin errores, sin pendientes → ocultar banner
    banner.style.display = 'none';
  }

  // ── API pública ─────────────────────────────────────────────────────────────
  window.syncQueue = {
    add:      addToQueue,
    procesar: procesarCola,
    actualizar: _actualizarBanner,
  };

  console.log('[syncQueue] Módulo cargado.');
})();
