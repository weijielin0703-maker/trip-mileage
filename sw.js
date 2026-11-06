// Paths are resolved against the service worker scope, so /trip-mileage/ works
// the same as hosting at the domain root. Do not prefix these with "/".
const CACHE = 'trip-v17';
const FILES = ['./', './index.html', './app.js', './routing.js', './geocode.js', './expense-sheet.js', './invoice.js', './vendor/jsQR.js', './style.css', './manifest.json', './icon.svg', './icon-180.png', './icon-192.png', './icon-512.png', './company-template.xls', './vendor/xlsx.full.min.js', './vendor/leaflet/leaflet.js', './vendor/leaflet/leaflet.css'];

function scoped(path) {
  return new URL(path, self.registration.scope).href;
}

async function putFresh(cache, request, response) {
  const body = await response.blob();
  const copy = new Response(body, {status: response.status, statusText: response.statusText, headers: response.headers});
  await cache.put(request, copy);
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(FILES.map(async path => {
      const url = scoped(path);
      try {
        const res = await fetch(url, {cache: 'reload'});
        if (res.status !== 200) return;
        await putFresh(cache, url, res);
      } catch (e) {}
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

// Network first. The cached copy is used when the network fails or answers with an error page
// (e.g. mid-deploy), and a failed cache write never fails the response itself.
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return;
  const scopePath = new URL(self.registration.scope).pathname;
  if (!url.pathname.startsWith(scopePath)) return;
  event.respondWith((async () => {
    const cached = () => caches.match(event.request, {ignoreSearch: true}).then(hit => hit || (event.request.mode === 'navigate' ? caches.match(scoped('./')) : null));
    let res;
    try {
      res = await fetch(event.request);
    } catch (e) {
      const hit = await cached();
      if (hit) return hit;
      throw e;
    }
    if (res.status === 200 && res.type === 'basic') {
      const copy = res.clone();
      event.waitUntil(caches.open(CACHE).then(cache => putFresh(cache, event.request, copy)).catch(() => {}));
      return res;
    }
    if (res.status >= 400) {
      const hit = await cached();
      if (hit) return hit;
    }
    return res;
  })());
});
