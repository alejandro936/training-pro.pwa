// idb-helper.js
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('tp-db', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('session')) {
        db.createObjectStore('session', { keyPath: 'k' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbPut(k, v) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('session', 'readwrite');
    tx.objectStore('session').put({ k, v });
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
async function idbGet(k) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('session', 'readonly');
    const r = tx.objectStore('session').get(k);
    r.onsuccess = () => res(r.result ? r.result.v : null);
    r.onerror = () => rej(r.error);
  });
}
