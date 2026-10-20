// Офлайн-кэш оболочки приложения. При выпуске новой версии меняйте VERSION.
const VERSION = 'carlog-1.3.2';
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

// Свои файлы: сначала сеть (с проверкой свежести, мимо HTTP-кэша браузера — иначе после обновления
// часть модулей может прийти из старой версии), без сети — из кэша. Запросы к Яндексу не трогаем.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const nav = e.request.mode === 'navigate';
  const fromCache = () => caches.match(e.request, { ignoreSearch: true })
    .then(r => r || (nav ? caches.match('index.html') : undefined))
    .then(r => r || Response.error());
  const network = (nav ? fetch(e.request) : fetch(url.href, { cache: 'no-cache', credentials: 'same-origin' })).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
    return res;
  });
  // при плохой связи не ждём дольше 4 секунд — отдаём из кэша, если там есть
  const timeout = new Promise(resolve => setTimeout(() => caches.match(e.request, { ignoreSearch: true }).then(r => r && resolve(r)), 4000));
  e.respondWith(Promise.race([network.catch(fromCache), timeout]));
});
