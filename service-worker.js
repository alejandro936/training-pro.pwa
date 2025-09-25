// versión de caches (súbela cuando cambies algo)
const CACHE_NAME = 'tp-v6';
const AVOID_CACHE = new Set(['/save.html','/go-lib.html','/debug.html']);

// instala cache básico (si quieres pre-cachear algo público)
self.addEventListener('install', (e) => { self.skipWaiting(); });

// activa SW nuevo
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k!==CACHE_NAME ? caches.delete(k) : null)));
    self.clients.claim();
  })());
});

// estrategia: network-first para HTML excepto las páginas de sesión (que se dejan sin interceptar)
// y cache-first para estáticos (icons, css, js), si lo deseas.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Nunca interceptar estas páginas de sesión
  if (AVOID_CACHE.has(url.pathname)) return;

  // Solo ejemplo mínimo: deja pasar todo (si quieres, añade tu lógica de caché)
  // event.respondWith(fetch(event.request));
});
