/* USMODE service worker: installable PWA, offline app shell, content-free push. */
const CACHE = "usmode-shell-v1";
const SHELL = ["/", "/vibe", "/arena", "/rooms", "/backchodi", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL).catch(() => undefined))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Never cache anything that isn't ours (Supabase, Spotify, encrypted media).
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
            return res;
          }),
      ),
    );
    return;
  }
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match("/"))),
    );
  }
});

// Push payloads carry only a generic title/body (never task names, notes or confessions).
self.addEventListener("push", (event) => {
  let data = { title: "USMODE", body: "Something new in your room 💛" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    /* keep default */
  }
  event.waitUntil(
    self.registration.showNotification(String(data.title).slice(0, 60), {
      body: String(data.body).slice(0, 120),
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-72.png",
      tag: "usmode",
      renotify: true,
      vibrate: [100, 50, 100],
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) if ("focus" in w) return w.focus();
      return self.clients.openWindow("/");
    }),
  );
});
