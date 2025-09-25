const CACHE_NAME = 'entrenamiento-cache-v1';
const urlsToCache = [
  './index.html',
  './icono-equipo-tacho-120.png',
  './icono-equipo-tacho-128.png',
  // Añade aquí tus otros archivos JS, CSS, imágenes...
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response => response || fetch(event.request))
  );
});
