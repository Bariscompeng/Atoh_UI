/* SIMSOFT ATOH Teleop — service worker
 * App-shell + tile caching for offline / installed use.
 * Never touches the rosbridge websocket (cross-origin, non-GET, ws:// are ignored).
 */
const VERSION = "atoh-v1";
const SHELL = `${VERSION}-shell`;
const TILES = `${VERSION}-tiles`;
const SHELL_URLS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(SHELL).then((c) => c.addAll(SHELL_URLS)).catch(() => {}).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

const isTile = (url) =>
  url.pathname.includes("/offline-tiles/") ||
  url.pathname.includes("/gps_ortho_tiles/") ||
  /\.(png|jpg|jpeg|webp)$/i.test(url.pathname);

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // leave rosbridge / external alone

  // SPA navigations: network-first, fall back to cached shell when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.match("./index.html").then((r) => r || caches.match("./")))
    );
    return;
  }

  // Map tiles: cache-first, refresh in background (stale-while-revalidate).
  if (isTile(url)) {
    event.respondWith(
      caches.open(TILES).then(async (cache) => {
        const cached = await cache.match(req);
        const network = fetch(req).then((res) => {
          if (res && res.status === 200) cache.put(req, res.clone());
          return res;
        }).catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // Built assets & everything else same-origin: stale-while-revalidate.
  event.respondWith(
    caches.open(SHELL).then(async (cache) => {
      const cached = await cache.match(req);
      const network = fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === "basic") cache.put(req, res.clone());
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
