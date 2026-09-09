/* ─────────────────────────────────────────────────────────────────────────────
   Alarm — Service Worker  v2
   • Caches app shell for offline use
   • Handles showNotification() calls from the app (background notifications)
   • Handles notificationclick to open/focus the app
   ───────────────────────────────────────────────────────────────────────────── */

const CACHE_NAME   = "alarm-v2";
const CACHE_ASSETS = [
  "./index.html",
  "./manifest.webmanifest",
  "./icon-128.png",
  "./jsqr.min.js"
];

/* ── Install: pre-cache app shell ────────────────────────────────────────── */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(
        CACHE_ASSETS.map((url) =>
          cache.add(url).catch((err) =>
            console.warn("[sw] failed to cache", url, err)
          )
        )
      )
    )
  );
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

/* ── Fetch: cache-first for app shell ───────────────────────────────────── */
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  const isCached = CACHE_ASSETS.some((a) =>
    url.pathname.endsWith(a.replace(".", ""))
  );

  if (isCached) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
          }
          return res;
        });
      })
    );
  } else {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
  }
});

/* ── Notification click: open / focus the app ───────────────────────────── */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // If app is already open, focus it
        for (const client of clientList) {
          if ("focus" in client) return client.focus();
        }
        // Otherwise open a new window
        return clients.open("./index.html");
      })
  );
});

/* ── Push event (future use) ─────────────────────────────────────────────── */
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let data = {};
  try { data = event.data.json(); } catch (e) { data = { title: event.data.text() }; }
  event.waitUntil(
    self.registration.showNotification(data.title || "⏰ Alarm", {
      body:    data.body || "",
      icon:    "./icon-128.png",
      badge:   "./icon-128.png",
      vibrate: [200, 100, 200],
      tag:     data.tag  || "alvaria-alarm"
    })
  );
});
