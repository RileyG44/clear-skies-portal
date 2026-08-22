/* Offline shell for the installed app. Deliberately small: imagery and terrain
   tiles are not cached here — server.js already keeps a disk cache, and a
   single 3 MB elevation read would blow the origin's storage budget for no
   benefit. This exists so the app opens when the network (or the Mac) is
   unreachable, rather than showing a browser error page. */
/* Bump this on every deploy. activate() deletes every cache whose name does
   not match, so a new name is what actually evicts the old shell. With a fixed
   name there was no way to invalidate anything: an installed copy could serve
   a months-old page for ever and look like the features had never shipped. */
importScripts("./version.js");
const SHELL = `clear-skies-shell-${globalThis.CSP_BUILD}`;
const ASSETS = ["./", "./index.html", "./manifest.json",
                "./version.js", "./icon-180.png", "./icon-192.png", "./icon-512.png"];

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
