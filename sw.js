// Paths are resolved against the service worker scope, so /trip-mileage/ works
// the same as hosting at the domain root. Do not prefix these with "/".
const CACHE = 'trip-v7';
const FILES = ['./', './index.html', './app.js', './routing.js', './expense-sheet.js', './style.css', './manifest.json', './icon.svg', './icon-180.png', './icon-192.png', './icon-512.png', './company-template.xls', './vendor/xlsx.full.min.js', './vendor/leaflet/leaflet.js', './vendor/leaflet/leaflet.css'];

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

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return;
  const scopePath = new URL(self.registration.scope).pathname;
  if (!url.pathname.startsWith(scopePath)) return;
  event.respondWith((async () => {
    try {
      const res = await fetch(event.request);
      if (res.status === 200 && res.type === 'basic') {
        const cache = await caches.open(CACHE);
        await putFresh(cache, event.request, res.clone());
      }
      return res;
    } catch (e) {
      const cached = await caches.match(event.request) || (event.request.mode === 'navigate' ? await caches.match(scoped('./')) : null);
      if (cached) return cached;
      throw e;
    }
  })());
});
