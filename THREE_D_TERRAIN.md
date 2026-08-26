# 2D rotation, 3D terrain, and lighting

This is the implementation handoff for the optional spatial-viewing modes added
in build `2026-08-26b`. The normal startup mode remains Leaflet 2D.

## User controls

- **2D map:** right-drag with a mouse or twist with two fingers. The right-side
  compass returns to north-up. Leaflet's map click still requires a double click,
  so a drag or rotation cannot accidentally start an imagery search.
- **3D terrain:** open **Terrain · lidar**, select a terrain layer, then choose
  **3D terrain**. MapLibre supplies direct pan, orbit, pitch, zoom, mouse, trackpad,
  and multitouch interaction. Returning to 2D removes the MapLibre instance and
  its WebGL allocations.
- **Lighting:** sun azimuth, sun altitude, and ambient light are shared by 2D and
  3D. Relief exaggeration only affects the 3D geometry. Values persist in
  `clearskies.terrain.v2`; **Reset lighting** restores 315 degrees, 45 degrees,
  12 percent ambient, and 1.25x relief.

## Architecture

`@tomickigrzegorz/leaflet-rotate` augments the existing inlined Leaflet build. It
keeps every existing marker, raster, canvas, and sidebar integration on the same
2D map while adding a bearing transform and direct gestures.

MapLibre GL JS is imported only when 3D is requested. Its style contains:

1. the normal Esri Canvas raster basemap, matching the 2D light/dark theme;
2. a `raster-dem` elevation source for the geometry — the portal's national 3DEP
   tile (`/api/elev/national/...`) when the local server is up, and AWS Terrarium
   only as the no-server fallback;
3. either MapLibre's native hillshade or a custom analytical raster layer.

**Geometry and colour come from different tiles, deliberately.** The mesh uses
the national 3DEP tile and is capped at zoom 14; the analytical drape keeps the
full-detail path including raw 1 m lidar. Measured cold, the raw path costs
2–16 s per tile upstream and a 36-tile burst took p50 50 s, which is unusable
while panning — national alone halved it and the zoom cap cut the tile count
again. Over-zooming the mesh is invisible on relief and very visible in load
time. This split is also what MapLibre asks for when it warns against sharing
one source between terrain and a hillshade layer.

The custom `cspterrain://` protocol fetches the portal's combined elevation tile,
decodes Terrarium elevations, renders through `terrain-raster.js`, and returns a
PNG tile to MapLibre. That makes elevation tint, slope, aspect, north/south
exposure, and 2/5/10/25-foot contours available in 3D without maintaining a
second set of color formulas. `cspwa://` routes WA DNR project hillshade through
the local terrain engine when it is connected.

The 2D WebGL renderer and shared CPU raster both receive the same normalized
lighting values. Native MapLibre hillshade receives matching paint properties.

Lighting changes never rebuild the style. Sun azimuth, altitude and ambient are
paint state; relief is a terrain property. Both are set in place, so dragging a
slider does not tear down and refetch every source. Only the analytical styles
need new tiles, because their colour is baked into the raster — and even then
the decoded elevation is cached per tile, so the repaint skips the fetch and the
Terrarium unpack.

## Dependencies and vendoring

Runtime packages are pinned in `package-lock.json`:

- `maplibre-gl` 6.6.0
- `@tomickigrzegorz/leaflet-rotate` 0.2.4

`npm run vendor` copies the required browser artifacts into `vendor/`. Commit the
refreshed vendor files together with any dependency bump. GitHub Pages, the Node
server, the macOS service installer, Electron packaging, and the service worker
all include these files. `THIRD_PARTY_NOTICES.md` records their licenses.

## Performance choices

- 3D is lazy: no MapLibre code, worker, or WebGL context is created during normal
  2D use.
- The 3D map uses the browser's high-performance WebGL preference and MapLibre's
  worker renderer.
- Color and lighting changes reuse fetched elevation. They change style state or
  protocol URLs instead of changing the geographic source.
- Returning to 2D calls `remove()` on MapLibre to release workers and GPU memory.
- The existing Mac terrain service remains the high-resolution and offline data
  path; national geometry can still render directly in the browser.

## Fixes applied after the first pass

- **3D could never start.** The entry guard called `module.supported?.()`, which
  MapLibre removed in v5. The vendored 6.6.0 does not export it, so the optional
  call returned `undefined` and the guard threw on every device regardless of
  hardware — while reporting itself as a WebGL2 limitation, which is why it read
  as environmental. Replaced with a real WebGL2 probe.
- **A −32768 m pit wherever elevation ran out.** The DEM route answered
  no-coverage with the 1×1 transparent PNG used for 2D overlays. That is correct
  for an overlay and catastrophic as geometry: Terrarium reads RGB(0,0,0) as
  −32768 m, and it was cached `immutable` for a week. The route now returns a
  real 256×256 tile encoding sea level. Covered by a regression test.
- **Seams across every analytical tile.** The `cspterrain` handler passed a bare
  256×256 grid, so the 3×3 gradient kernel clamped at the tile border. The
  renderer already accepted a skirted surface; it now gets one, assembled from
  the four neighbours. Measured on adjacent slope tiles, the mean boundary
  discontinuity fell 26%.
- **An orphaned MapLibre instance.** Leaving 3D before the lazy import finished
  returned early, because `map3d` was still null — the loader then built a map
  nothing pointed at, holding WebGL and workers for the rest of the session.
- **503s under a cold pan.** The national decode had an 8 s task timeout while
  the worker pool averages 1.6 s per task with four workers, so ordinary
  queueing became a failure and a hole in the mesh. Raised to 25 s, and the tile
  fetch now retries a 503 twice, honouring `Retry-After`. A 24-tile cold burst
  went from 6% 503s to none.
- A single scratch canvas is reused instead of allocating one per tile.

## Honest limitations

- WebGL2 is required. The interface falls back to 2D when browser policy, remote
  rendering, or hardware does not expose it.
- WA DNR currently publishes a baked hillshade image through the portal. It can
  conform to the 3D surface, but its original shadow direction cannot be relit.
- AWS Terrarium supplies broad 3D geometry while the selected analytical colors
  may come from higher-resolution portal elevation. The service can be extended
  later with a raw 1 m DEM protocol if sub-meter geometry is required everywhere.
- Satellite imagery remains in the established 2D imagery workflow. This release
  makes every Terrain/LiDAR visualization available in 3D; it does not present a
  selected satellite scene as the 3D texture.

## Verification

Run:

```text
npm run verify
```

The static checks confirm that rotation, 3D mode, lighting, and required vendor
artifacts are wired. Renderer tests prove that opposing azimuths produce different
hillshade while the documented default remains stable. Server tests request the
vendored modules through the actual static route. Final manual QA should use a
hardware-accelerated WebGL2 browser: open a familiar LiDAR-covered location, cycle
all terrain styles in 3D, move every lighting slider, orbit/pitch/zoom, return to
2D, and confirm the bearing and terrain selection survive the transition.
