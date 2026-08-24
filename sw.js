/* Offline shell for the installed app. Deliberately small: imagery and terrain
   tiles are not cached here — server.js already keeps a disk cache, and a
   single 3 MB elevation read would blow the origin's storage budget for no
   benefit. This exists so the app opens when the network (or the Mac) is
   unreachable, rather than showing a browser error page. */
/* Bump this on every deploy. Keeping the build literal here, plus a versioned
   page-script URL, prevents an older worker from serving a stale version.js
   while a newer HTML shell is already live. */
const CSP_BUILD = "2026-08-23f";
const SHELL = `clear-skies-shell-${CSP_BUILD}`;
const ASSETS = ["./", "./index.html", "./manifest.json", "./mosaic-core.js", "./terrain-core.js",
                "./elevation-bands.js", "./elevation-tile-core.js",
                `./version.js?build=${CSP_BUILD}`, "./icon-180.png", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== SHELL).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // tiles and STAC go straight out
  if (url.pathname.startsWith("/api/")) return;      // never serve stale data

  // Navigation: fresh when we can reach the server, cached shell when we cannot.
  if (req.mode === "navigate"){
    /* cache:"reload" so this bypasses the HTTP cache as well. Pages serves the
       page with its own max-age, and without this the worker could fetch
       "fresh" and still be handed a stale copy by the browser cache. */
    e.respondWith(fetch(req, {cache:"reload"})
      .then(r => { const c=r.clone(); caches.open(SHELL).then(x=>x.put("./index.html", c)); return r })
      .catch(() => caches.match("./index.html")));
    return;
  }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req)));
});
