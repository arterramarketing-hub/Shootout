/**
 * Offline cache for Shootout.
 *
 * Runtime caching rather than a precache manifest: the bundler hashes asset
 * names on every build, and a stale hard-coded list is worse than no list. The
 * first visit fills the cache; later visits are served from it and refreshed in
 * the background, so the game opens with no network at all.
 */
const CACHE = "shootout-v2";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request);

      const network = fetch(request)
        .then((response) => {
          // Only whole, successful responses are worth keeping.
          if (response.ok && response.status === 200) {
            cache.put(request, response.clone()).catch(() => undefined);
          }
          return response;
        })
        .catch(() => null);

      if (cached) return cached;
      const response = await network;
      if (response) return response;
      // Offline with nothing cached: fall back to the page itself so a
      // navigation still lands somewhere rather than failing outright.
      return (await cache.match("./")) ?? Response.error();
    })(),
  );
});
