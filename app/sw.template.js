// Service worker (built by the `pwa` plugin in vite.config.ts, which fills in VERSION and SHELL).
// App shell: precached, served cache-first, so the app opens offline. Game data (JSON): network first, falling back
// to the copy from the last successful load, so games seen before stay readable offline.
const VERSION = __VERSION__;
const SHELL = __SHELL__;
const SHELL_CACHE = `shell-${VERSION}`, DATA_CACHE = 'data-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (req.mode === 'navigate') {
    // any page URL (with ?game=…) gets the cached app shell
    e.respondWith(caches.match('./index.html', { ignoreSearch: true }).then((r) => r || fetch(req)));
  } else if (url.pathname.endsWith('.json')) {
    e.respondWith(
      fetch(req)
        .then((r) => {
          if (r.ok) { const copy = r.clone(); caches.open(DATA_CACHE).then((c) => c.put(req, copy)); }
          return r;
        })
        .catch(() => caches.match(req).then((r) => r || new Response(null, { status: 504, statusText: 'offline' }))),
    );
  } else {
    e.respondWith(caches.match(req).then((r) => r || fetch(req)));
  }
});
