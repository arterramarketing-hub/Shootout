/**
 * Offline cache for Shootout.
 *
 * Runtime caching rather than a precache manifest: the bundler hashes asset
 * names on every build, and a stale hard-coded list is worse than no list.
 *
 * The page itself is fetched network-first and the hashed assets cache-first.
 * That split matters: asset filenames contain a content hash, so a cached one
 * is never wrong and never needs revalidating, while the page is the only
 * thing that names the current build. Serving the page from cache first is
 * what leaves a returning player on last week's version of the game with no
 * way to notice.
 */
const CACHE = "shootout-v3";

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

/** The page, rather than one of its hashed assets. */
const isPageRequest = (request) =>
  request.mode === "navigate" ||
  (request.destination === "document") ||
  request.headers.get("accept")?.includes("text/html");

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);

      if (isPageRequest(request)) {
        // Network first, so a new deploy is picked up on the next visit.
        try {
          const response = await fetch(request);
          if (response.ok) cache.put(request, response.clone()).catch(() => undefined);
          return response;
        } catch {
          return (
            (await cache.match(request)) ??
            (await cache.match("./")) ??
            Response.error()
          );
        }
      }

      // Hashed assets never change under the same name, so cache wins.
      const cached = await cache.match(request);
      if (cached) return cached;

      try {
        const response = await fetch(request);
        // Only whole, successful responses are worth keeping.
        if (response.ok && response.status === 200) {
          cache.put(request, response.clone()).catch(() => undefined);
        }
        return response;
      } catch {
        return Response.error();
      }
    })(),
  );
});
