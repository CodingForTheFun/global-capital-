export const APP_RELEASE = 'oblige-installable-20260918';

export const appManifest = {
  id: '/', name: 'Oblige Props', short_name: 'Oblige Props',
  description: 'Player prop research, verified game logs and sportsbook line comparison.',
  start_url: '/board', scope: '/', display: 'standalone',
  background_color: '#050b13', theme_color: '#050b13',
  categories: ['sports', 'utilities'], prefer_related_applications: false,
  icons: [192, 512].map(size => ({ src: `/app-icons/${size}.png`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'any' })),
  shortcuts: [{ name: 'Research board', url: '/board' }, { name: 'My account', url: '/account' }],
};

// Intentionally no offline document or data cache. Auth, billing, research,
// navigation and live streams must always use the network, including when
// installed. Only the three public application icons are cacheable.
export const appWorker = `const CACHE = '${APP_RELEASE}';
const ICONS = new Set(['/app-icons/180.png','/app-icons/192.png','/app-icons/512.png']);
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter(key => (key.startsWith('oblige-installable-') || key.startsWith('oblige-props-shell-')) && key !== CACHE).map(key => caches.delete(key)));
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || request.mode === 'navigate' || url.origin !== self.location.origin || url.search || !ICONS.has(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(request);
      if (response.ok && response.headers.get('content-type')?.startsWith('image/png')) await cache.put(request, response.clone()).catch(() => {});
      return response;
    } catch {
      return await cache.match(request) || new Response('', { status: 503 });
    }
  })());
});`;
