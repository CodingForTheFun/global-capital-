const CACHE = 'oblige-props-shell-v1';
const STATIC = new Set([
  '/manifest.webmanifest',
  '/icon.svg',
  '/assets/autoscout-home.css',
  '/assets/autoscout-home.js',
  '/assets/autoscout-reference-ui.css?v=20260913b',
  '/assets/autoscout-reference-ui-fixes.css?v=20260913b',
  '/assets/autoscout-tacos.js',
]);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all([...STATIC].map((url) => cache.add(url).catch(() => null)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith('oblige-props-shell-') && key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Never cache account/admin/API responses or navigations. Live sports data,
  // permissions and billing state must always come from the network.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/owner') || request.mode === 'navigate') return;

  const key = url.pathname + url.search;
  if (!STATIC.has(key)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request);
    const fresh = fetch(request).then((response) => {
      if (response.ok) cache.put(request, response.clone()).catch(() => {});
      return response;
    }).catch(() => null);
    return cached || await fresh || new Response('', { status: 504 });
  })());
});
