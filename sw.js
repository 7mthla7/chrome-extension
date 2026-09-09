/* ─────────────────────────────────────────────────────────────────────────────
   Alarm — Service Worker
   Provides offline support by caching the app shell on install and serving it
   from cache on subsequent requests.  Cache-first for app shell assets,
   network-first for anything else.
   ───────────────────────────────────────────────────────────────────────────── */

const CACHE_NAME   = "alarm-v1";
const CACHE_ASSETS = [
  "./schedule-view.html",
  "./manifest.webmanifest",
  "./icon-128.png",
  "./jsqr.min.js"
];

/* ── Install: pre-cache app shell ────────────────────────────────────────── */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // addAll fails atomically — if any asset is missing the SW won't activate.
      // Use individual adds so a missing icon doesn't break offline for the HTML.
      return Promise.allSettled(
        CACHE_ASSETS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn("[sw] failed to cache", url, err);
          })
        )
      );
    })
  );
  // Take control immediately without waiting for existing clients to close.
  self.skipWaiting();
});

/* ── Activate: clean up old caches ──────────────────────────────────────── */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

/* ── Fetch: cache-first for app shell, network-first otherwise ───────────── */
self.addEventListener("fetch", (event) => {
  // Only handle GET requests to same origin.
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // Ignore cross-origin requests (e.g. jsQR CDN).
  if (url.origin !== self.location.origin) return;

  // Cache-first strategy for the app shell assets.
  const isCached = CACHE_ASSETS.some((asset) => url.pathname.endsWith(asset.replace(".", "")));

  if (isCached) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          // Cache a fresh copy for next time.
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
  } else {
    // Network-first for everything else (not cached); fall back to cache.
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
  }
});
