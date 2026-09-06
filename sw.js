// Ward 14A service worker
// ⚠ ทุกครั้งที่แก้ index.html ต้องเพิ่มเลข VERSION ไม่งั้นเครื่องที่ติดตั้งไว้จะยังเห็นของเก่า
const VERSION = 'ward14a-v1';
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(VERSION)
      .then(c => c.addAll(SHELL).catch(() => null))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // ข้อมูลสด (Firestore / Google / LINE) ห้าม cache เด็ดขาด
  if (url.origin !== self.location.origin) return;

  // network-first: ได้ของใหม่เสมอเมื่อออนไลน์ ออฟไลน์จึงใช้ cache
  e.respondWith(
    fetch(req)
      .then(res => {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
  );
});
