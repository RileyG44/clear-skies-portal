/* Offline shell for the installed app. Deliberately small: imagery and terrain
   tiles are not cached here — server.js already keeps a disk cache, and a
   single 3 MB elevation read would blow the origin's storage budget for no
   benefit. This exists so the app opens when the network (or the Mac) is
   unreachable, rather than showing a browser error page. */
/* Bump this on every deploy. Keeping the build literal here, plus a versioned
   page-script URL, prevents an older worker from serving a stale version.js
   while a newer HTML shell is already live. */
const CSP_BUILD = "2026-10-24i";
const SHELL = `clear-skies-shell-${CSP_BUILD}`;
const POTREE = `clear-skies-potree-${CSP_BUILD}`;
const ASSETS = ["./", "./index.html", "./manifest.json", "./ui-theme.css", "./ui-system.css", "./ui-system.js", "./mosaic-core.js", "./png-stream.js", "./markup.js", "./markup-3d.js", "./terrain-core.js", "./terrain-raster.js", "./terrain-drape-core.js", "./terrain-drape-pool.js", "./terrain-drape-worker.js",
                "./public-terrain.js", "./public-terrain-worker.js", "./vendor/lerc/LercDecode.js", "./vendor/lerc/LercDecode.es.js", "./vendor/lerc/lerc-wasm.wasm",
                "./elevation-bands.js", "./elevation-tile-core.js", "./tile-pipeline.js", "./gpu-terrain-shaders.js", "./lidar-render.js", "./lidar-studio.js", "./analysis-layers.js", "./gpu-terrain-store.js", "./gpu-terrain-engine.js", "./gpu-terrain-layer.js", "./gpu-terrain-3d-cache.js", "./gpu-terrain-3d-renderer.js", "./gpu-terrain-3d-layer.js", "./wa-archaeology.js", "./glacial-research-core.js", "./glacial-segment-core.js", "./glacial-segment-features.js", "./glacial-moraine-classifier.js", "./glacial-zone-core.js", "./glacial-zone-features.js", "./glacial-belt-classifier.js", "./glacial-moraine-analysis.js", "./terrain-analysis-core.js", "./research-analysis.js", "./research-worker.js", "./point-cloud-core.js", "./point-cloud-viewer.js", "./point-cloud-catalog.json", "./maxar-catalog.json", "./nadi1-cordilleran.json",
                "./vendor/maplibre-gl.mjs", "./vendor/maplibre-gl-shared.mjs", "./vendor/maplibre-gl-worker.mjs", "./vendor/maplibre-gl.css", "./vendor/leaflet-rotate.umd.min.js",
                "./vendor/icons/arrow-left.svg", "./vendor/icons/arrow-right.svg", "./vendor/icons/navigation.svg", "./vendor/fonts/inter-latin-wght-normal.woff2", "./vendor/icons/chevron-down.svg", "./vendor/icons/chevron-right.svg", "./vendor/icons/chevron-up.svg", "./vendor/icons/cloud-sun.svg", "./vendor/icons/download.svg", "./vendor/icons/history.svg", "./vendor/icons/image.svg", "./vendor/icons/layers.svg", "./vendor/icons/map-pinned.svg", "./vendor/icons/mountain-snow.svg", "./vendor/icons/radar.svg", "./vendor/icons/radio.svg", "./vendor/icons/rotate-ccw.svg", "./vendor/icons/satellite.svg", "./vendor/icons/scan-search.svg", "./vendor/icons/search.svg", "./vendor/icons/settings-2.svg", "./vendor/icons/sliders-horizontal.svg", "./vendor/icons/tags.svg", "./vendor/icons/triangle-alert.svg", "./vendor/icons/pen-line.svg", "./vendor/icons/hand.svg", "./vendor/icons/mouse-pointer-2.svg", "./vendor/icons/pencil.svg", "./vendor/icons/minus.svg", "./vendor/icons/move-up-right.svg", "./vendor/icons/pentagon.svg", "./vendor/icons/square.svg", "./vendor/icons/circle.svg", "./vendor/icons/type.svg", "./vendor/icons/map-pin.svg", "./vendor/icons/undo-2.svg", "./vendor/icons/trash-2.svg", "./vendor/icons/check.svg", "./vendor/icons/plus.svg", "./vendor/icons/highlighter.svg", "./vendor/icons/eraser.svg", "./vendor/icons/redo-2.svg", "./vendor/icons/copy.svg",
                `./version.js?build=${CSP_BUILD}`, "./icon-180.png", "./icon-192.png", "./icon-512.png"];
const SHELL_ASSETS = ASSETS.map(asset=>/\.(?:js|css)$/.test(asset)?`${asset}?build=${CSP_BUILD}`:asset);

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== SHELL&&k !== POTREE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // tiles and STAC go straight out
  if (url.pathname.startsWith("/api/")) return;      // never serve stale data

  // The optional point-cloud runtime is intentionally not part of atomic shell
  // installation. Cache it on first use so a missing optional asset can never
  // take offline support down for the 2D application.
  if(url.pathname.includes("/vendor/potree/")){
    e.respondWith(caches.open(POTREE).then(cache=>cache.match(req).then(hit=>hit||fetch(req).then(response=>{if(response.ok)cache.put(req,response.clone());return response}))));
    return;
  }

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
  // Worker importScripts() and module dependencies keep literal file paths.
  // Resolve those to the same fresh bytes as the versioned document scripts.
  const cachedURL = new URL(req.url);
  if(!cachedURL.search&&/\.(?:js|css)$/.test(cachedURL.pathname))cachedURL.searchParams.set("build",CSP_BUILD);
  e.respondWith(caches.match(cachedURL.href).then(hit => hit || fetch(req)));
});
