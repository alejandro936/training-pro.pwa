// service-worker.js
const CACHE = 'tp-v8'; // súbelo cuando cambies algo del SW

// Activos estáticos que sí quieres en caché (no HTML de sesión)
const ASSETS = [
  '/', '/index.html',
  '/manifest.json',
  '/icon-192.png', '/icon-512.png',
  '/apple-touch-icon-120.png',
  '/apple-touch-icon-152.png',
  '/apple-touch-icon-167.png',
  '/apple-touch-icon-180.png'
];

// Rutas que NUNCA debe interceptar (puertas/sesión/diagnóstico)
const NO_INTERCEPT = new Set([
  '/go-lib.html', '/go-lib-v2.html',
  '/save.html', '/save-v2.html',
  '/debug.html', '/install.html'
]);

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // No interceptar nada de sesión ni HTML sensibles
  if (url.origin === location.origin) {
    if (NO_INTERCEPT.has(url.pathname) || url.pathname.endsWith('.html')) {
      return; // deja pasar a la red directamente
    }
  }

  // Estáticos: cache-first con actualización
  e.respondWith(
    caches.match(req).then(hit =>
      hit || fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return res;
      }).catch(() => hit)
    )
  );
});
