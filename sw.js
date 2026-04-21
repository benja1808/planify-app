// Service Worker — Planify Offline v5
const CACHE_NAME = 'planify-offline-v8';

// En localhost no cacheamos nada — siempre red directa
const IS_LOCAL = self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1';

// Archivos locales: se cachean atómicamente (si uno falla, todo falla — intencional)
const LOCAL_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './localDB.js',
  './syncQueue.js',
  './favicon.ico',
  './icon-512.png',
  './manifest.json',
];

// Librerías de CDN: se cachean individualmente (best-effort, un fallo no rompe el install)
const CDN_RESOURCES = [
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://cdn.jsdelivr.net/npm/pizzip@3.1.1/dist/pizzip.min.js',
  'https://cdn.jsdelivr.net/npm/docxtemplater@3.37.2/build/docxtemplater.js',
  'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
];

// ── INSTALL: precachear shell ────────────────────────────────────────────────
self.addEventListener('install', event => {
  // En localhost: activar inmediatamente sin cachear nada
  if (IS_LOCAL) { self.skipWaiting(); return; }

  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      // 1) Archivos locales: atómico (crítico)
      await cache.addAll(LOCAL_SHELL);

      // 2) CDN: cada URL se cachea por separado — un fallo no cancela el resto
      await Promise.allSettled(
        CDN_RESOURCES.map(url =>
          fetch(url, { mode: 'cors', credentials: 'omit' })
            .then(res => {
              if (res.ok || res.type === 'opaque') return cache.put(url, res);
            })
            .catch(err => console.warn('[SW] No se pudo cachear CDN:', url, err.message))
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: limpiar caches viejos ─────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── FETCH: estrategia por tipo de recurso ───────────────────────────────────
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  // En localhost: pasar todo directo a la red, sin interceptar
  if (IS_LOCAL) return;

  const url = new URL(event.request.url);

  // ① Supabase API → NetworkFirst (datos frescos, caché como fallback)
  if (url.hostname.includes('supabase.co')) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // ② Navegación (HTML) → NetworkFirst con fallback a index.html cacheado
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // ③ Assets locales (JS/CSS) → NetworkFirst para capturar cambios
  const isLocalAsset = url.hostname === self.location.hostname;
  if (isLocalAsset) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // ④ CDN externos (fonts, FontAwesome, librerías) → CacheFirst
  event.respondWith(cacheFirst(event.request));
});

// ── Estrategia NetworkFirst ──────────────────────────────────────────────────
async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const res = await fetch(request);
    // Guardar respuesta exitosa en caché
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    // Sin red → devolver caché
    const cached = await cache.match(request);
    return cached || new Response(
      JSON.stringify({ error: 'Sin conexión y sin caché disponible' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// ── Estrategia CacheFirst ────────────────────────────────────────────────────
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    return new Response('', { status: 503 });
  }
}

// ── Mensajes desde la app (ej: forzar skipWaiting) ──────────────────────────
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
