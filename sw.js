// Офлайн-кэш оболочки приложения. При выпуске новой версии меняйте VERSION.
const VERSION = 'carlog-1.3.1';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/store.js', 'js/stats.js', 'js/ce-import.js', 'js/yadisk.js', 'js/sync.js', 'js/config.js', 'js/events.js', 'js/parts.js', 'js/report.js', 'js/catalog.js', 'js/ce-db.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Свои файлы: сначала сеть (чтобы обновления приходили сразу), без сети — из кэша.
// Запросы к Яндексу не трогаем.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const fromCache = () => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'));
  const network = fetch(e.request).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
    return res;
  });
  // при плохой связи не ждём дольше 3 секунд — отдаём из кэша
  const timeout = new Promise(resolve => setTimeout(() => fromCache().then(r => r && resolve(r)), 3000));
  e.respondWith(Promise.race([network.catch(fromCache), timeout]));
});
