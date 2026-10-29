/* Офлайн-кэш: страницы меню — cache-first (путь содержит версию), остальное — network-first с запасом из кэша.
   Пути считаются от места, где лежит sw.js, поэтому работает и в корне домена, и во вложенной папке. */
const SHELL = 'shell-v2';
const PAGES = 'pages';
const BASE = new URL('./', self.location).pathname;           // '/' или '/repo/'
const SHELL_FILES = ['./', 'style.css', 'app.js', 'manifest.webmanifest', 'icons/icon-180.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== PAGES).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || !url.pathname.startsWith(BASE) || url.pathname.startsWith(BASE + 'admin')) return;

  if (url.pathname.startsWith(BASE + 'p/')) {
    e.respondWith(
      caches.open(PAGES).then(async c => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) c.put(req, res.clone());
        return res;
      })
    );
    return;
  }

  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(SHELL).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, {ignoreSearch: true}).then(r => r || caches.match('./')))
  );
});

// После полной подгрузки новой версии клиент просит удалить старые страницы
self.addEventListener('message', e => {
  const d = e.data || {};
  if (d.keep) {
    e.waitUntil(caches.open(PAGES).then(async c => {
      const keys = await c.keys();
      await Promise.all(keys.filter(k => !new URL(k.url).pathname.startsWith(BASE + 'p/' + d.keep + '/')).map(k => c.delete(k)));
    }));
  }
});
