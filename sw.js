// ให้แอปเปิดได้แม้ไม่มีเน็ต: ดึงไฟล์ใหม่จากเน็ตก่อนเสมอ ถ้าไม่มีเน็ตค่อยใช้ไฟล์ที่เก็บไว้
// การอ่านใบเสร็จยังต้องใช้เน็ต (ดู docs/decisions/0002)
const CACHE = 'food-cost-shell';
const SHELL = [
  './',
  'index.html',
  'css/app.css',
  'js/app.js',
  'js/calc.js',
  'js/store.js',
  'js/receipt.js',
  'manifest.webmanifest',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'fonts/mali-thai-400-normal.woff2',
  'fonts/mali-thai-600-normal.woff2',
  'fonts/mali-thai-700-normal.woff2',
  'fonts/mali-latin-400-normal.woff2',
  'fonts/mali-latin-600-normal.woff2',
  'fonts/mali-latin-700-normal.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html')))
  );
});
