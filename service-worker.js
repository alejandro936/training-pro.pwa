self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => self.clients.claim());
// Sin cachés manuales: siempre la última versión desde el servidor
