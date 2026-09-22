/* Existing offline queue remains in the app. Never cache Supabase/auth/private data. */
const CACHE = 'buymore-static-v3';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('buymore-') && key !== CACHE).map(key => caches.delete(key)))),
    self.clients.claim(),
  ]));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || request.headers.has('authorization')) return;
  // Only Vite's content-hashed public assets are safe for cache-first.
  if (!/^\/assets\/[^/]+-[\w-]+\.(js|css|woff2?)$/.test(url.pathname)) return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    const saved = await cache.match(request);
    if (saved) return saved;
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') await cache.put(request,response.clone());
    return response;
  }));
});
