
const CACHE = 'yijia-sc-5.90';
const STATIC = [
  './',
  './index.html',
  './style-5.90.css',
  './sc-login-background-5.90.png',
  './app.js',
  './db.js',
  './core.js',
  './ops.js',
  './revenue.js',
  './barcode.js',
  './sync.js',
  './version.js'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(STATIC).catch(()=>{})));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put('./index.html', copy));
        return res;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }
  event.respondWith(
    caches.match(req).then(hit => hit || fetch(req))
  );
});
