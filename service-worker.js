// Sube este nombre cada cambio
const CACHE_NAME = 'tp-v8';
const AVOID_CACHE = new Set(['/save.html','/go-lib.html','/debug.html']);

self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(self.clients.claim()); });

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1) Nunca interceptes navegaciones (HTML) -> que vaya directo a red
  if (event.request.mode === 'navigate') return;

  // 2) Nunca interceptes nuestras páginas de sesión/diagnóstico
  if (AVOID_CACHE.has(url.pathname)) return;

  // 3) (opcional) tu estrategia para estáticos…
  event.respondWith(fetch(event.request));
});
