/* Service worker for the Sydney Marathon Training Plan.
   Strategy: network-first for everything same-origin, falling back to cache when
   offline. This keeps the app fresh whenever there's a connection (important —
   GitHub Pages + hourly Strava sync means content changes often) while still
   letting you open and read the plan with no signal (e.g. mid-run).
   Cross-origin requests (Supabase reads/writes, Edge Functions) bypass the SW
   and always go to the network. */
const CACHE = "smtp-v2";
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
      .catch(() => {})       // a missing asset shouldn't block install
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
  if (req.method !== "GET") return;                 // never touch writes
  if (new URL(req.url).origin !== self.location.origin) return; // Supabase etc. → network
  e.respondWith(networkFirst(req));
});
