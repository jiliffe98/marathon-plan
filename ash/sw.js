/* Service worker for the training-block app (root).
   Strategy: network-first for everything same-origin, falling back to cache when
   offline. Content changes often (hourly Strava sync), so fresh wins whenever
   there's a connection; the cached shell lets you read the plan with no signal.
   Cross-origin requests (Supabase, Edge Functions) bypass the SW entirely.
   The archived marathon app under /marathon/ has its own worker and cache. */
const CACHE = "ash-block1-v1";
const SHELL = [
  "./",
  "index.html",
  "config.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "apple-touch-icon.png",
  "data/activities.json",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" }))))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch (err) {
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;
    if (req.mode === "navigate") {
      const shell = (await cache.match("index.html", { ignoreSearch: true })) ||
                    (await cache.match("./"));
      if (shell) return shell;
    }
    throw err;
  }
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // leave the archived app to its own worker
  if (url.pathname.includes("/marathon/")) return;
  e.respondWith(networkFirst(req));
});
