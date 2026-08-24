# Clear Skies Portal — implementation handoff for GPT-5.6 Sol (high)

Date: 2026-08-23
Target repository: `RileyG44/clear-skies-portal`  
Target branch: `main`  
Starting release: build `2026-08-23f` (the terrain correctness and reliability checkpoint)

## Operating instruction

Read this entire document, `README.md`, `TODO.md`, `lidar-research.md`, and the current tests before editing. Work in small reviewable commits, but complete and verify each phase end to end. Do not remove existing features. Do not put credentials or private Tailscale URLs in source, fixtures, logs, or screenshots. Keep the server dependency-free unless there is a measured, documented reason to change that constraint. Browser libraries may be pinned and vendored with their license when necessary.

The product goal is a fast research-grade imagery, lidar, terrain, landscape, and geology viewer. “Working” means the visible live workflow is reliable, not merely that code compiles. Preserve the last good rendered frame/layer while replacements load; empty, failed, or unavailable data must be transparent and explained, never black.

## What release 2026-08-22e already ships

Do not reimplement these items:

- `mosaic-core.js` contains tested, dependency-free mosaic geometry and identity helpers: Polygon/MultiPolygon containment with holes, dateline-safe ring unwrapping, antimeridian bbox splitting, coverage grids, GSD/zoom helpers, footprint/patch identity, and cross-provider product identity.
- Fill Surroundings now uses real footprint geometry rather than bbox-only coverage; splits STAC searches at the antimeridian; does not collapse disjoint acquisitions that share one MGRS tile; deduplicates exact Sentinel/Landsat products across providers; ranks low-cloud acquisitions before date/provider delivery preference; and uses bounded scene budgets.
- Both fill entry points work: the checkbox is continuous, while the top-right button is one-shot but survives a pan/zoom cancellation and restarts for the final viewport before turning itself off.
- At coarse screen resolution, MODIS Terra 250 m is explicitly used as a contextual LOD layer instead of issuing dozens of pointless 10 m requests. It is a context/safety fallback, not part of the same-dataset mosaic.
- At detail zooms, neighbor layers are staged with bounded concurrency, per-provider catalog timeouts, provider health scoring, cancellation, bounded retries, footprint bounds, readiness thresholds, and a context safety underlay when geometry or visible tile health indicates a gap.
- TileJSON and mosaic catalogs have bounded in-memory TTL caches. Failed or removed tile layers cancel their retry timers. Basemap failover is deferred outside Leaflet's `tileerror` callback so layer removal cannot crash `_tileReady`.
- Search results render 12 rows per provider with Show More rather than constructing hundreds of DOM rows at once.
- GIBS/NISAR layers expose native maximum zoom so Leaflet stops requesting nonexistent native tiles and scales the last valid level.
- `test-mosaic.js` covers polygon-vs-bbox behavior, holes, disjoint MGRS patches, cross-provider product identity, dateline containment/coverage, bbox splitting, and LOD math. `scripts/check-static.js` executes a normal STAC feature through `norm()` to catch runtime scope mistakes.

Known boundary: a true same-collection multiresolution overview service does not yet exist. MODIS fills coarse/gap context only and must always be labeled as such. The long-term same-dataset strategy is specified below.

## What release 2026-08-23f adds

Treat these as tested foundations; extend them rather than reintroducing older rendering paths.

- `terrain-core.js` is now the shared, Node-testable terrain math module. It implements Horn gradients, slope in degrees/percent, true compass downslope aspect (north 0°, east 90°), flat masking, single-direction hillshade, and the Mark/GDAL four-direction multidirectional method. `usgs.js` uses it.
- `elevation-tile-core.js` decodes packed Terrarium RGB into Float32 elevation before crop/resampling. This is mandatory: interpolating packed bytes produced false roughly 128 m steps at byte carries. Masked bilinear interpolation renormalizes valid neighbors rather than choosing an arbitrary corner.
- `elevation-bands.js` supplies canonical-metre, testable below/above/between band logic with independent colors, opacity, feather, and outline. The current UI exposes simultaneous above and below bands in feet by default and persists them in `clearskies.terrain.v2`.
- Elevation spectrum and bands share one elevation tile layer and one WebGL2 shader, with a tested CPU fallback. Threshold/color/opacity changes repaint cached Float32 tiles without refetching. At zooms below 13, browser-direct Terrarium data produces the complete first frame and deliberately avoids duplicate Mac decoding. At zoom 13 and closer, national 3DEP and raw 1 m data progressively refine that same tile canvas.
- National terrain is always present as a baseline; WA DNR or raw USGS data refines valid pixels in the same `CompositeTerrainLayer` canvas. Do not stack two translucent full terrain layers. Analytical terrain is z-index 440 and elevation shading 450, above primary imagery 400.
- Terrain replacement is viewport-atomic: the old layer remains visible while the new layer preloads, then swaps after completion or at least 90% current-tile readiness. Deep zoom stretches the last native tile instead of requesting nonexistent detail or showing black.
- WA DNR is used only for its published DTM hillshade (`hs`). Slope, aspect, tint, multidirectional shade, and contours require actual elevation. DSM is never substituted for bare-earth DTM.
- Raw COG candidates are opened and sorted by measured native resolution first, with acquisition recency as a tie-breaker. Server cache keys use `terrain-v2`, so corrected renders cannot collide with legacy cached pixels.
- The terrain worker pool retains warm M2 workers when an aborted job exits within a two-second grace period. The dedicated service runs six workers. Rapid pan/zoom/style changes now remove abandoned upstream requests from the four-request remote-service semaphore immediately; the regression test dropped a 47-request stale queue to zero.
- Transient proxy tile failures return a quiet 204 plus `X-CSP-Error: upstream`; browser clients still retry with bounded exponential backoff. Optional WA coverage timeouts degrade to national terrain rather than a visible 500.
- Automated coverage now includes synthetic plane cardinal-aspect tests, flat/no-data behavior, multidirectional lighting, terrain renderer pixels, elevation-band boundaries, packed-elevation resampling, worker cancellation/timeout/queue pressure, static integration assertions, and server integration.

Verified release acceptance evidence:

- Moses Lake search returned 237 current scenes and opened a complete Landsat natural-color view; both Fill Surroundings entry points completed and continuous fill recomputed after pan.
- At zoom 17, imagery and multidirectional terrain both completed every requested visible tile; the replacement was no longer pending and the layer order was imagery 400, terrain 440.
- Overview elevation shading produced 30 stored tiles in about 2.5 seconds with zero server elevation requests. Changing its color produced zero additional tile requests.
- Terrain rendered at zoom 2 and stretched at zoom 24 with a complete image and no black terminal state.
- A 390×844 mobile viewport used the full height for both map and sidebar with zero document overflow.
- Clean-browser console checks were error-free; the six-worker health check ended with zero queued work and zero worker restarts in the fresh run.

### Highest-priority work after this checkpoint

1. Replace raster contour presets with real Float32-derived, edge-stitched contour geometry (marching squares with one-tile halos, stable labels, and export). Preserve the current presets as a temporary compatibility option until parity is proven.
2. Make raw-USGS sampling deterministic across UTM zone/project boundaries. Split requests by zone, sample every intersecting source in a measured-resolution order, and test seams/nodata with synthetic fixtures.
3. Add bounded cache maintenance. The current disk cache has a minimum-free-space write guard but no age/size LRU. Implement an indexed manifest, atomic eviction, pinned downloaded areas, user-visible usage, and a safe repair command.
4. Continue Phase 2.1 below toward one shared decoded DEM store/worker. Do not replace the fast overview path until a measured browser-direct LERC implementation is faster and equally reliable.
5. Implement the raw EPT 3D lidar workspace and measurement suite in Phase 2.4. This is the major missing capability between the current excellent 2D derived raster viewer and the requested full lidar research workstation.
6. Complete centralized durable state and the remaining scene-group reordering work. Existing terrain, pane, overlay, map-theme, tool-dock, and server preferences already persist in separate versioned keys; migration must preserve all of them.
7. Run a longer mixed-layer soak (at least 30 minutes on the M2 service and Safari/iOS) with automated pan/zoom/style churn, heap snapshots, server queue/worker telemetry, WebGL context-loss injection, offline transitions, and recovery assertions.

Performance boundary: the Mac server is optimized for parallel CPU COG decode/render and persistent disk caching. Browser elevation recoloring uses WebGL2. There is no honest general-purpose Node GPU path in this release; do not claim GPU acceleration for COG fetching, PNG encoding, or server-side derivatives without a measured Metal/WebGPU implementation and CPU fallback.

## Current architecture and important anchors

| File | Responsibility / anchors |
|---|---|
| `index.html` | UI and Leaflet runtime. Search: `run`, `stacSearch`, `norm`, `render`, `select`. Imagery: `ResilientTileLayer`, `tileUrl`, `imageryLayerOptions`. Mosaic: `stacBbox`, `fillMosaic`, `waitForLayerTiles`, `loadNeighbour`. Panes: `loadPanes`, `applyPanes`, `paneUnder`. Terrain: `chooseTerrain`, `applyTerrain`, `refreshTerrainCoverage`. Overlays: `OVERLAYS`, `ovBuild`, `ovApply`, `ovRender`. Elevation/fabric: `ElevLayer`, `applyElev`, `runFabric`. |
| `mosaic-core.js` | Pure/testable geometry, coverage, identity, antimeridian, and LOD logic. Keep UI-independent. |
| `server.js` | Static allowlist, cache/proxy, WA DNR, raw USGS COG terrain, downloads, fabric/elevation endpoints, snow/geology/fire proxy routes. |
| `usgs.js` | Raw USGS 1 m COG discovery, range reads, rendering, encoded elevation, area warming, and landform fabric. `sampleGrid`, `sampleUTMGrid`, `fabric`, `elevTile`. |
| `cog.js` | TIFF/COG parsing, LZW/predictor, geodesy, slippy/UTM math. |
| `electron/main.js` | Electron shell and local engine. It currently uses a random port every launch. |
| `sw.js` | Shell cache only; cross-origin imagery/terrain is intentionally not cached today. |
| `version.js` | Visible build and service-worker namespace; bump for every deployment. |
| `test-mosaic.js`, `test-cog.js`, `test-server.js` | Current Node/static/server coverage. Add focused pure tests rather than testing math through the DOM. |

Whenever a new browser module is added, also add it to `server.js` `PUBLIC_FILES`, Electron `extraResources`, `sw.js` shell assets when appropriate, and `scripts/check-static.js` parsing/asset assertions.

## Required work order

### Phase 1 — central durable state and sidebar interaction (P0)

This is first because nearly every new lidar/geology control needs persistence and the Electron app currently appears to forget even settings that were saved.

#### 1.1 Add `ui-state.js`

Create a dependency-free UMD/browser module with pure Node-testable functions:

- `defaultState()`
- `sanitizeState(raw)`
- `migrateLegacy({v2, panesV1, overlaysV1, serverV1})`
- `reconcileOrder(saved, defaults)`
- `moveKey(order, moving, target, before)`
- storage adapters with `read`, `write`, and an in-memory fallback
- debounced patch/subscription support, with an explicit `flush()` on `pagehide`

Use one versioned key, `clearskies.state.v2`. Required schema:

```json
{
  "version": 2,
  "updatedAt": "ISO timestamp",
  "ui": {
    "sidebar": {
      "collapsed": false,
      "widthPx": 430,
      "order": ["filters", "summary", "passes", "terrain", "overlays", "results"],
      "fillPane": "results",
      "panes": {
        "filters": {"collapsed": true, "basisPx": null},
        "summary": {"collapsed": false, "basisPx": null},
        "passes": {"collapsed": false, "basisPx": null},
        "terrain": {"collapsed": true, "basisPx": null},
        "overlays": {"collapsed": true, "basisPx": null},
        "results": {"collapsed": false, "basisPx": 240}
      }
    },
    "sceneControlCollapsed": false,
    "sceneBrowser": {
      "groupBy": "dataset",
      "groupOrder": [],
      "providerOrder": ["es", "pc", "cdse", "gibs", "nisar"],
      "collapsedGroups": {},
      "favoriteDatasets": [],
      "favoriteProviders": [],
      "savedSceneIds": []
    }
  },
  "map": {"center": [47.1301, -119.2781], "zoom": 9, "query": "", "selectedLocation": null},
  "search": {
    "days": "365", "from": "", "to": "", "cloud": "101", "imageType": "all",
    "sort": "date", "viewableOnly": false, "naturalColorFirst": true, "autoFill": false
  },
  "imagery": {"opacity": 100, "lastScene": null},
  "terrain": {
    "style": "off", "source": "auto", "opacity": 70,
    "downloadDepth": "native", "downloadExtent": "view", "fabricBand": [50, 300],
    "elevationBands": {
      "unit": "m",
      "below": {"enabled": false, "thresholdM": 500, "color": "#367ed6", "opacity": 0.51},
      "above": {"enabled": false, "thresholdM": 2000, "color": "#ed684f", "opacity": 0.51}
    }
  },
  "overlays": {"enabled": {}, "opacity": 90},
  "tools": {"fire": false},
  "connection": {"serverUrl": ""}
}
```

Do not persist signed tile URLs, runtime layer objects, results arrays, abort controllers, cache contents, provider health, or download job state. `lastScene` is only `{srcKey, collection, id, date}` and must be re-resolved after one restored search.

Hydration must be ordered: load/migrate/sanitize; set form/layout values without firing handlers; initialize map/server/layers; restore map/overlay/terrain intent; perform at most one search; restore the selected scene; then start auto-fill; only then enable save listeners. Use a `hydrating` guard. Debounce sliders, map movement, sidebar width, and resize writes. Flush on page hide. Save completed drops/toggles immediately.

Legacy migration requirements:

- Read `clearskies.panes.v1`, `clearskies.overlays.v1`, and `cspServer` only when valid v2 does not exist.
- Deep-merge nested defaults, de-duplicate arrays, remove unknown IDs, append newly introduced IDs, and retain aliases for renamed IDs.
- Convert `min` to `collapsed`, `h` to validated `basisPx`, `grow` to `fillPane`, overlay `on/op`, and server URL.
- If JSON is corrupt, keep a quarantined copy, load defaults, and show a small warning rather than swallowing it.
- If storage is unavailable, continue with memory state and visibly state that settings will not survive reload.
- Never clear downloaded terrain cache during a UI reset. Provide separate Reset sidebar, Reset scene organization, and Reset all preferences actions.

#### 1.2 Fix Electron persistence

Root cause: `electron/main.js` calls `freePort()` on every launch and localStorage is scoped by port, so every launch creates a new origin.

Keep the collision-safe random server port, but add `electron/preload.js` and `electron/settings-store.js`. Expose only:

```js
window.cspSettings.read()
window.cspSettings.write(serializedState)
```

Register validated IPC handlers in `electron/main.js`; verify the sender is the current internal origin; enforce a payload limit; parse/validate before accepting; write `${app.getPath("userData")}/settings-v2.json` through temp-file plus atomic rename; use user-only permissions where supported. Browser builds use localStorage. Add Export/Import settings because GitHub Pages, localhost, Tailscale, and Electron are deliberately separate origins. Redact the terrain-engine URL by default on export.

#### 1.3 Rebuild pane interactions

Separate controls: `.pane-drag` is the only reorder handle; `.pane-toggle` is a real button with `aria-expanded`/`aria-controls`; `.pane-rz` is a keyboard-focusable separator. Use sentence-case 12–13 px pane titles and real SVG chevrons with 36 px desktop / 44 px touch targets. Support Enter/Space disclosure and Alt+Arrow reorder with a polite live-region announcement.

During drag, create a fixed cursor-following ghost and same-height placeholder. Move the placeholder live so surrounding panes reflow before release. Batch reads/writes once per animation frame. Add edge auto-scroll. Exclude hidden pane, ghost, and placeholder from hit testing. `pointercancel`, lost capture, Escape, blur, and window deactivation must restore the exact original order without saving. Apply `touch-action:none` only to drag/resize handles.

Replace implicit `.grow` fallback with `reconcilePaneLayout()` after hydration, show/hide, collapse, reorder, resize, reset, and `ResizeObserver`. Exactly one visible expanded pane may fill space: saved fill pane, else Scenes, else most recently expanded, else last eligible visible pane. Hidden Summary/Passes must never receive fill space. Clamp saved sizes to current viewport/header constraints; do not let stale absolute heights create nested-scroll or blank-space failures. Use `#panes` as the primary stack scroller and only the selected fill pane body as an internal long-content scroller. Add the missing Overlays resize affordance or intentionally remove resize from all finite panes.

#### 1.4 Scene browser organization

Default to dataset-first groups (Sentinel-2, Landsat C2, NAIP, HLS, Sentinel-1, NISAR, VIIRS/MODIS, elevation/static), with provider as a secondary badge. Offer Group by Dataset/Provider. Stable keys:

- dataset `collection:${it.coll}`
- provider `provider:${it.srcKey}`
- dataset/provider favorite `${it.coll}|${it.srcKey}`
- saved acquisition `${it.srcKey}|${it.coll}|${it.id}`

Add independent group drag handle, disclosure button, persistent order, and star/pin controls. Preserve absent saved groups for future searches. Keep date/resolution sorting inside groups. Drive order from state; DOM-only reorder is invalid because `render()` rebuilds markup. Preserve scroll/focus and keep the selected item reachable.

### Phase 2 — browser-native elevation and lidar foundation (P0)

Tailscale must not be required for national terrain, elevation bands, probes, profiles, or public USGS EPT lidar.

#### 2.1 Shared elevation stack

Add:

- `elevation-store.js`: key `{source,z,x,y}`, request coalescing, view-generation AbortController, decoded in-memory LRU, encoded persistent cache.
- `elevation-worker.js`: pinned/vendored Esri MIT LERC decoder and derivative kernels; transfer ArrayBuffers.
- `terrain-core.js`: dual browser/Node pure math for gradients, slope, aspect, shade, color ramps, contours, derivatives. Reuse it from `usgs.js` and the worker.
- `analysis-tools.js`: one active capture tool at a time (probe, transect, AOI, watershed, geology identify).

Direct national source:

```text
https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage
  ?bbox={xmin},{ymin},{xmax},{ymax}
  &bboxSR=3857&imageSR=3857
  &size=256,256&format=lerc&pixelType=F32&f=image
```

It is CORS-clean. Source priority is local raw 1 m COG when available, then direct national 3DEP LERC, then no data. One decoded elevation tile must feed all band shading, probes, profiles, slope/aspect, hillshade, and derived layers. Target about 96 decoded 256² float tiles plus canvases, bounded near 64 MB. Add a bounded encoded CacheStorage/IndexedDB cache by quota and age; do not create an unlimited cache.

Correct terrain native zooms while implementing: direct 3DEP `maxNativeZoom:17,maxZoom:22`; WA derived lidar `19,22`; local raw USGS 1 m `18,22`. Preserve current hillshade, multidirectional hillshade, elevation tint, slope, aspect, and 2/5/10/25 ft contours. WA DNR only supplies bare-earth hillshade: do not label the same WA render as true multidirectional or tinted output. Either restrict WA to `hs`, or label it as a hillshade detail blend over the actual 3DEP/local style.

#### 2.2 Elevation bands

Replace the current server-only `ElevLayer` and fixed blue `<=` control. Support a reorderable list of simultaneous bands. Each band has enabled, operator `below|above|between`, inclusive-boundary rule, min/max, m/ft/yd, color, opacity, optional feather width, and optional outline. At minimum, the user can independently shade all ground below one threshold and above another with separately chosen colors.

Changing threshold, color, order, units, or opacity after elevation tiles load must cause zero network requests and repaint on the next animation frame. Permit below-zero and >4500 m typed values. Auto-range from visible min/max but never clamp valid extremes. Presets such as sea level/flood datum/treeline/snowline are user labels, not scientific claims. Persist every band.

If a fast interim path is needed before LERC decoding, 3DEP also supports a browser-direct `Colormap(Remapped DEM)` rendering rule with PNG32; however the final shared decoded DEM is required for the full tool suite.

#### 2.3 Probe, profile, and hillshade lab

- Cursor/click probe: elevation, slope degrees/percent, aspect degrees/cardinal, source, effective pixel size, acquisition/service metadata, and quality. Never claim 1 m where the effective source is coarser.
- Editable transect: screen/source-aware sampling; SVG/canvas chart; distance, min/max/relief, cumulative ascent/descent, mean/max slope; linked map/chart cursor; CSV and GeoJSON export; stale-job abort on edit.
- Hillshade lab: sun azimuth/altitude, vertical exaggeration, ambient intensity, multidirectional toggle; local repaint without refetch. Provide explicit legends and adaptive contour interval readout.

#### 2.4 Raw 3D lidar workspace

Build `lidar-viewer.js` as a lazy isolated workspace so unopened 3D adds zero initial JS/network cost. Use a pinned/licensed proven EPT loader (Potree EPT support is acceptable). USGS public EPT is browser-direct/keyless:

```text
https://s3-us-west-2.amazonaws.com/usgs-lidar-public/{dataset}/ept.json
```

Build a compact coverage index in CI from official USGS WESM / 3DEP spatial metadata; do not download a full national boundary dataset on every launch. Open from current point/selected project. Render hierarchy coarse-first and refine by screen-space error. Use 4 concurrent EPT nodes desktop, 2 mobile; adapt point budget to frame time/device memory; abort irrelevant nodes on camera movement; retain the last good frame if a node fails.

Required display modes: elevation, classification, intensity, RGB when present, return number, number of returns, point source ID; ground/vegetation/building/water filters; point size; EDL; orthographic/perspective; reset/top/side views.

Required tools: point XYZ/elevation, distance/polyline, height, area, clipping box, vertical profile, point-count/classification histogram in clip, and synchronized 2D/3D position/selection. Close must dispose WebGL resources, workers, listeners, and pending requests. WA raw downloads are not EPT/CORS-fast; keep them optional through the engine and later support local conversion of a user-downloaded project to EPT/COPC.

### Phase 3 — landscape and geology research tools (P1)

#### 3.1 Landscape derivatives and statistics

From the shared DEM/worker add local relief model, terrain ruggedness index, roughness, TPI, profile curvature, plan curvature, openness/sky-view factor, slope classes, hypsometric curve, slope histogram, aspect rose, and polygon elevation/slope zonal statistics. Every operation exposes kernel radius, effective resolution, CRS, source, and coverage. Use a one-tile halo for seam-free derivatives.

Add a user-drawn AOI with area/perimeter/3D surface area. Hydrology tools: depression fill, D8 direction/accumulation, click-to-trace downslope path, and watershed delineation. Cap cell count and show resolution before running. Label all outputs DEM-derived, not surveyed hydrology.

Improve `usgs.fabric()`:

- `sampleUTMGrid` currently awaits COG blocks during per-pixel loops; precompute all touched blocks and fetch with a bounded pool before synchronous sampling, matching the faster `sampleGrid` pattern.
- Add Quick/Balanced/Detailed grids (`n=128/192/256`), 15-minute coalesced cache, timeout, abort/generation tokens, and explicit AOI/effective resolution.
- Add p10/p50/p90/mean elevation, hypsometric integral, slope classes, ruggedness, and coverage.
- Rename hardcoded `isotropicPct:1.7` to `isotropicBaselinePct`; compute and test a normalized excess anisotropy. It is not a measured isotropy value.
- Replace definitive material/geologic conclusions with cautious observational language. Add synthetic plane/ridge/noise fixtures before describing results as research-grade.

#### 3.2 Layer registry and direct Macrostrat

Add `geo-layer-registry.js` with declarative entries `{id,group,label,kind,url,minZoom,maxZoom,attribution,license,ttl,requiresEngine,identify,create}`. Replace branching in `OVERLAYS`/`ovBuild`/`ovApply`/`ovRender`. Instantiate/query only enabled layers. Persist favorites/order. Show zoom/coverage/source-health notes.

Macrostrat now returns CORS `*`; remove the stale proxy requirement for normal use:

- raster `https://tiles.macrostrat.org/carto/{z}/{x}/{y}.png`
- vector `https://tiles.macrostrat.org/carto/{z}/{x}/{y}.mvt`
- identify `https://macrostrat.org/api/v2/geologic_units/map?lat={lat}&lng={lon}`

Keep attribution and CC BY 4.0/source citations. Use raster first; vector later for units, contacts, faults, folds, anticlines, and moraines. Keep existing USGS SGMC (`.../sgmc/default/GoogleMapsCompatible/{z}/{y}/{x}.png`, note z/y/x).

Add browser-direct, keyless layers lazily:

- Quaternary faults/folds: `https://earthquake.usgs.gov/arcgis/rest/services/haz/Qfaults/MapServer/export`, layers 21/22; query layer 21 for popup name/age/source.
- Earthquakes: official `all_day.geojson`/`all_week.geojson` feeds; FDSN viewport/history only for custom queries.
- Volcano status: `https://volcanoes.usgs.gov/vsc/api/volcanoApi/geojson`; cache and fail closed because the API is not guaranteed permanently.
- US landslide susceptibility tiles: `https://tiles.arcgis.com/tiles/v01gqwM5QqNysAAi/arcgis/rest/services/US_Landslide_Susceptibility/MapServer/tile/{z}/{y}/{x}`; inventory points/polygons by viewport only.
- Plate boundaries: `https://earthquake.usgs.gov/arcgis/rest/services/eq/map_plateboundaries/MapServer/tile/{z}/{y}/{x}`.
- Slab2 depth/dip/strike: `https://earthquake.usgs.gov/arcgis/rest/services/eq/slab2_{depth|dip|strike}/MapServer/tile/{z}/{y}/{x}`; mutually exclusive styles.
- Vs30: `https://earthquake.usgs.gov/arcgis/rest/services/eq/vs30_mosaic/MapServer/tile/{z}/{y}/{x}`; label as seismic site-condition proxy, never lithology.
- SSURGO WMS at `https://SDMDataAccess.sc.egov.usda.gov/Spatial/SDM.wms`, `mapunitpoly`, only at useful detail zoom.
- MRDS occurrences: `https://energy.usgs.gov/arcgis/rest/services/MRData/Mineral_Resource_Data_System/MapServer/3/query`; bbox, pagination/clustering, and explicit legacy/incomplete/non-resource-estimate warning.
- Airborne surveys: `https://energy.usgs.gov/arcgis/rest/services/Airborne_Geophysical_Surveys/MapServer/0/query`.
- Earth MRI acquisition footprints: `https://energy.usgs.gov/arcgis/rest/services/MRData/Earth_MRI_Acquisitions/MapServer/{0..8}/query`.
- NGMDB catalog footprints for general/bedrock/surficial newest maps; present as “find the best detailed source map here,” not another opaque truth layer.

Add geology-aware cross sections: sample topography plus Macrostrat surface-unit identity along a transect; draw a geologic color strip under the profile; cite each unit/source; mark mapped faults/contacts; make vertical exaggeration explicit; never infer subsurface contacts from surface polygons.

### Phase 4 — imagery mosaic completion (P1, after state/elevation)

The current release is robust enough to use, but complete these production improvements:

- Extract catalog planning, quality scoring, request scheduling, and layer health from `index.html` into testable modules.
- Return provider results progressively in the initial search rather than awaiting all providers before the first useful scene. Auto-select once, then improve only when a materially better candidate arrives; never flash between near-equal scenes.
- Separate acquisition quality from delivery health. Quality order: visual type compatibility, actual polygon coverage, cloud/SCL clear fraction, resolution meaningful at screen m/px, date/date-coherence, then provider delivery score. Delivery health must never make a cloudy scene “better”; it only chooses the rendition of the same product or the next fetch route.
- Add Sentinel-2 SCL cloud masking so a partially cloudy acquisition can contribute only clear pixels. Report masked coverage, not scene-level cloud metadata alone.
- Replace the public `titiler.xyz` dependency with a controlled renderer or documented multi-provider route before claiming an SLA.
- Resolve Earth Search non-renderable Sentinel-1/Landsat listings through an exact Planetary Computer twin, proper band math, or hide them by default when Map-viewable only is enabled.
- Build or adopt a same-collection multiresolution overview strategy. At coarse zoom prefer overviews derived from the selected collection/date window. MODIS remains a clearly labeled context safety layer only. Do not describe mixed MODIS/Sentinel output as one Sentinel dataset.
- Add a coverage-gap diagnostic overlay that outlines unresolved cells and identifies whether the cause is catalog, cloud mask, tile delivery, zoom limit, or true no-data.
- Persist bounded provider health/negative cache for the session only. Never persist signed URLs.

### Phase 5 — performance scheduler and offline policy

Implement a central scheduler shared by imagery, elevation, geology, and EPT:

- Visible selected imagery and elevation have highest priority.
- At most 6 requests per host; EPT nodes 4 desktop/2 mobile.
- Abort stale view generations immediately.
- Two retries only for transient status/network failures; no retry for deterministic 4xx/no-data; negative cache 5–10 minutes.
- Keep old rendered layer/frame until the replacement has a credible first frame.
- Prefetch only one tile ring after 500 ms stable using idle time; disable for Save-Data or slow connections.
- Use workers for LERC decode, derivatives, clustering, profiles, statistics, and large vector parsing.
- Runtime caches must be bounded by bytes/count/age and expose Clear cache without clearing settings or downloads.

Tailscale decision: it is not necessary for normal imagery, national 3DEP LERC, slope/aspect/contours, elevation bands, profiles/probes, Macrostrat/USGS research layers, or USGS EPT 3D. Keep the engine/Tailscale optional for WA DNR no-CORS services, raw-COG offline downloads, cached trip areas, highest-resolution local analysis, and future WA conversion. The hosted page must remain useful with the engine URL empty.

## Acceptance and performance contract

Add pure Node tests plus real-browser Playwright integration tests. Playwright may be a dev dependency; runtime remains dependency-free.

### Imagery/fill matrix

Test z7, z8, z9, z10, z12, z16 at Rainier and at least one non-US point; also an antimeridian viewport, a polygon with a hole, a scene edge, and a true no-data location.

- Checkbox and button both end with the final viewport filled or a precise gap reason.
- Pan/zoom during one-shot fill aborts stale work and completes the final viewport; checkbox state remains off.
- Auto-fill continuously follows pans; disabling it cancels pending work and removes neighbors/context.
- No stale request can replace a newer view/scene.
- No failed layer replaces a healthier existing layer.
- No black/broken-image tile; deterministic no-data is transparent.
- Status distinguishes footprint plan, visibly rendered tiles, context fallback, and true same-dataset coverage.
- Dateline search sends two valid STAC bboxes and merges/deduplicates results.
- DOM stays bounded with 500+ results; selected item remains visible/focusable.

Targets on a reference broadband laptop with warm browser cache: first useful scene <=2 s after first provider responds; coarse Fill context <=1.5 s; detail Fill shows useful progressive coverage <=2.5 s and reaches settled state <=8 s when providers are healthy; pan keeps an existing useful frame with no blank flash; interaction remains >=50 fps outside 3D.

### Sidebar/state matrix

At 390×620, 768×600, and 1400×900 test every collapse combination. No overlap; footer/final pane reachable; exactly one visible eligible fill pane; hidden panes never fill; expansion pushes lower panes; sizes clamp on reload/orientation; drag ghost follows pointer within 2 px and placeholder reflows before release; cancel paths restore order; keyboard/touch work; favorites/group order survive new searches and reload.

Change every persisted control and reload Pages. Hydration performs one search. Quit/relaunch Electron on a different random port and confirm state. Simulate corrupt/future/localStorage-error fixtures. Import/export across origins. Resets do not delete lidar downloads.

### Elevation/analysis matrix

- Fixed LERC fixture decodes exact pixels.
- Synthetic `z=ax+by` produces expected slope/aspect; flat grid yields zero slope/no aspect; paraboloid separates plan/profile curvature.
- Adjacent haloed tiles match at derivative/contour edges.
- Below and above bands render exact independent colors simultaneously at known pixels; unit round trips preserve metres; thresholds below 0 and above 4500 work; after initial load, slider/color edits cause zero fetches.
- Probe and profile use the same kernel/source and expose effective resolution.
- AOI jobs abort stale edits and cannot overwrite newer results.
- Fabric synthetic fixtures validate trend/anisotropy; no hardcoded baseline is presented as measurement.

### Geology/lidar matrix

- With engine stopped and URL empty on Pages, direct Macrostrat, SGMC, faults, earthquakes, volcanoes, landslides, plate boundaries, and national 3DEP remain enabled and CORS-clean.
- Viewport vector sources paginate/cluster without silently truncating completeness.
- Every popup/export includes source, date/version where available, attribution, CRS/effective resolution, parameters, and scientific caveats.
- 3D EPT opens without the engine, paints a coarse scene before refinement, survives a deliberately failed node, aborts obsolete camera requests, maintains >=30 fps on reference hardware, and disposes fully on close. Main-map initial payload/network is unchanged when 3D is never opened.

## Release procedure for every phase

1. Start from current `main`; inspect `git status` and preserve unrelated user work.
2. Implement with pure modules/tests first; update static/Electron/service-worker allowlists.
3. Run `git diff --check && npm run verify`.
4. Run local `npm start`; use a real browser to exercise changed workflows and inspect console/network. Reload after every code change.
5. Bump `version.js` once for the deployment.
6. Commit and push `main` only when tests and visible workflows pass.
7. Wait for both CI and Pages deployment to succeed.
8. Reload `https://rileyg44.github.io/clear-skies-portal/`, verify the new build stamp, perform a real search, select imagery, exercise Fill, and test the changed lidar/sidebar/geology workflow. Do not call the phase complete before this live verification.

## Explicit non-goals and guardrails

- Do not require a user API key for the core experience.
- Do not make Tailscale or the Mac engine a prerequisite for browser-native public data.
- Do not silently mix datasets while labeling the result as one acquisition/collection.
- Do not infer lithology, subsurface structure, material type, hazards, or surveyed drainage from visualization alone.
- Do not fetch national point/vector catalogs wholesale during normal map use.
- Do not add eager 3D assets or large decoders to initial map startup.
- Do not use OSM Foundation raster tiles; keep permitted CARTO/Esri alternatives and required attribution.
- Do not accept “build passes” as completion without local and live visual checks.
