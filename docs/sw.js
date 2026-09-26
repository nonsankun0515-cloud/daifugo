// Cards Table — オフラインでも遊べるようにするキャッシュ
const CACHE = 'daifugo-0854994865';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const put = (res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res; };
  if (url.origin === location.origin) {
    // 自分のファイル：つながっていれば最新、つながらなければ保存済み
    e.respondWith(fetch(req).then(put).catch(() => caches.match(req).then((r) => r || caches.match('./index.html'))));
  } else if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    // フォント：保存済みを優先
    e.respondWith(caches.match(req).then((r) => r || fetch(req).then(put)));
  }
});
