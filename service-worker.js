const CACHE_NAME = 'tp-v9';
const AVOID_CACHE = new Set(['/save.html','/go-lib.html','/debug.html']);

self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(self.clients.claim()); });

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Nunca interceptes navegaciones (HTML)
  if (event.request.mode === 'navigate') return;

  // Ni nuestras páginas de sesión/diagnóstico
  if (AVOID_CACHE.has(url.pathname)) return;

  // Tu estrategia mínima para estáticos (o lo que uses)
  event.respondWith(fetch(event.request));
});
