# Build spec — linked 3D point-cloud panel

Implementation handoff. Self-contained: paste this whole file as the opening
prompt. It describes a feature that does **not** exist yet.

Everything under "Verified" was measured against the live services on
2026-08-26. Trust those numbers rather than re-deriving them, and do not
"correct" them from memory — several are counter-intuitive and one of them
(Rainier) contradicts what the raster research says.

---

## 0. What is being built

A **3D point-cloud viewer in a right-hand panel, camera-linked to the existing
2D map.** The 2D Leaflet map is not replaced, restyled, or re-parented.

- Turning on 3D slides a panel in from the right.
- The top of that panel is a Potree view of whatever the 2D map is currently
  looking at.
- Below it are display controls: point budget, point size, colour mode
  (elevation / intensity / classification / RGB), Eye-Dome Lighting, and the
  **class filter** — the "hide the trees" control.
- Dragging either view moves the other. A link toggle can break the coupling so
  a 3D inspection does not drag the 2D map around.

This is the linked-view pattern QGIS and ArcGIS Pro use. It is deliberately
**not** an interleaved single scene: the point cloud is not composited into
MapLibre's depth buffer. That decision is what makes this tractable — see §6.

---

## 1. Verified — the data

Source: `https://s3-us-west-2.amazonaws.com/usgs-lidar-public/`
USGS 3DEP public lidar, stored as **EPT** (Entwine Point Tile) octrees.

| Fact | Value | Why it matters |
|---|---|---|
| Washington projects | **30** | listed via `?list-type=2&delimiter=/&prefix=WA_` |
| Points advertised, WA total | **2.2 trillion** | the LOD scheduler is the product |
| `dataType` | `laszip` | nodes are LAZ; needs laz-perf (Potree bundles it) |
| `hierarchyType` | `json` | `ept-hierarchy/<key>.json`, paged |
| `span` | 128 | octree node resolution |
| **SRS** | **EPSG:3857** | already Web Mercator — no reprojection to the map |
| **CORS** | **`Access-Control-Allow-Origin: *`** | **the browser fetches direct. Do not add a proxy route.** |

Schema (per `ept.json`):

```
X, Y, Z, Intensity, ReturnNumber, NumberOfReturns, ScanDirectionFlag,
EdgeOfFlightLine, Classification, ScanAngleRank, UserData, PointSourceId,
GpsTime, ScanChannel, ClassFlags
```

`Classification` is present and already populated with ASPRS classes, so the
tree filter needs no reclassification: **2** ground, **3/4/5** low/medium/high
vegetation, **6** building, **7** noise, **9** water.

Sample node fetch, `WA_CentralWildfire_1_D22`:

- `ept-hierarchy/0-0-0-0.json` → 200, 456,943 B, **20,227 entries**
- `ept-data/0-0-0-0.laz` → 200, 67,581 B, magic `4c415346` (`LASF`)

### Coverage, measured

Bounding-box test against all 30 `ept.json` files:

| Location | Project | Points |
|---|---|---|
| **Rainier summit** | `WA_CentralWildfire_2_D22` | 248.3 B |
| **Paradise** | `WA_CentralWildfire_2_D22` | 248.3 B |
| Mt Baker | `WA_CentralWildfire_1_D22` | 240.3 B |
| Hurricane Ridge | `WA_ElwhaRiver_2012` | 1.4 B |
| Snoqualmie Pass | 3 overlapping projects | up to 248.3 B |
| Seattle | `WA_KingCo_1_2021` | 31.0 B |

**Rainier has point-cloud coverage.** This contradicts `lidar-research.md`
Addendum 3, which correctly reports Mount Rainier National Park as a gap in the
**1 m raster DEM** (`prd-tnm`, `StagedProducts/Elevation/1m`). Both are true:
different products, different footprints. Confirmed by walking the octree —
`0-0-0-0` → `1-0-1-0` → `2-1-2-1` → `3-2-4-3`, non-zero point counts at every
level. Deeper nodes live in separate hierarchy pages, which is why the root page
stops at depth 3.

Use **Rainier as the primary test location.** It is the app's canonical example
and it exercises the case where points exist but the raster DEM does not.

---

## 2. User controls

**Enable:** a control in the Terrain pane, alongside the existing 2D/3D terrain
buttons. Label it for what it shows — `3D point cloud` — not just "3D". The
existing MapLibre `3D terrain` mode stays; see §7.

**Panel:** slides in from the right. Top ~60% is the Potree canvas, below it the
display controls. Resizable by dragging the divider; width and split persist.

**Display controls, below the view:**

- Point budget (1 M – 10 M, default 3 M)
- Point size + size mode (fixed / adaptive)
- Colour by: elevation, intensity, classification, RGB, return number
- Eye-Dome Lighting on/off, strength, radius
- **Class filter** — per-class checkboxes, with two presets doing the real work:
  - **Bare earth** — class 2 only
  - **All returns** — everything (default)
  - and vegetation (3/4/5) individually toggleable, because "how thick is the
    canopy here" is a different question from "what does the ground look like"

**Sync:** on by default, with a visible link/unlink toggle. Dragging either view
moves the other.

---

## 3. Architecture

### Panel layout

`#app` is a fixed full-bleed shell. `#map` is `position:absolute; inset:0` and
fills it. `#side` is **not** a flex column — it is an absolutely positioned
floating glass panel over the map (`z-index:1200`, `backdrop-filter`, safe-area
insets, and a `body.collapsed #side` transform for the slide-out).

**Mirror `#side` exactly** for the new panel on the right. Do not convert the
shell to flex; do not re-parent `#map`. Reuse the same glass tokens, radius,
shadow and safe-area handling so it reads as the same product.

### Potree

Lazy-loaded, exactly like MapLibre is today: nothing is imported, and no WebGL
context is created, until the panel is first enabled. Leaving 3D disposes the
viewer and releases the context.

Potree supplies the parts that would otherwise dominate this work:

- the octree LOD scheduler and point budget
- EPT loading and LAZ decoding
- Eye-Dome Lighting
- per-class visibility (the tree filter)
- adaptive point sizing
- measurement, clipping volumes, colour ramps

Wire the panel's controls to Potree's existing API. **Do not reimplement any of
the above.** If a control seems to need custom rendering code, stop and check
whether Potree already exposes it.

### Coverage lookup

Cache the 30 `ept.json` documents (30-day TTL is fine; the archive changes
yearly). For the current viewport centre, test against `boundsConforming` and
pick the covering project, newest first, preferring more points on a tie.

Mirror the existing `usgs.js` index pattern — same shape as `findCells`. When
nothing covers the view, say so in the panel the way the terrain pane says "No
federal 1 m DEM for this cell". An empty black panel is indistinguishable from a
broken one.

### Camera sync

The only genuinely new engineering.

- **2D → 3D:** viewport bounds → look-at target at the map centre; camera
  distance from the bbox extent and the vertical FOV; carry `map.getBearing()`.
- **3D → 2D:** ray from the camera through the target to the ground plane →
  `setView` centre; derive zoom from camera distance and extent.
- **Guard:** a single `syncing` flag, set for the duration of an applied update,
  so the two views cannot drive each other in a loop. This is the whole bug
  class; get it right once.
- **Debounce the 3D side** (~120 ms). Potree's scheduler should not re-plan on
  every `mousemove`.
- Sync **bearing** as well as position. The 2D map already rotates
  (`leaflet-rotate`, `map.setBearing`), and a compass that disagrees between the
  two views is worse than no sync.
- Respect the link toggle: when unlinked, neither view drives the other, but
  re-linking snaps 3D to the 2D view (not the reverse — 2D is the reference).

---

## 4. Dependencies and vendoring

Add `potree` to `package.json` and vendor its browser artifacts through the
existing mechanism:

- `npm run vendor` runs `scripts/sync-vendor.js`, which copies from
  `node_modules` into `vendor/`. Add the Potree entries to the `files` array
  there — including its workers, laz-perf WASM, and any shader/resource assets
  it loads at runtime.
- Commit refreshed `vendor/` files with the dependency bump.
- Record the licence in `THIRD_PARTY_NOTICES.md`.

**The Pages deploy uses an explicit file list.** `.github/workflows/ci.yml`
copies named files into `_site/` plus `cp -R vendor _site/vendor`. Any new
top-level runtime file must be added to that `cp` line or the deployed site
breaks while local development keeps working. This is the easiest way to ship a
broken deploy in this repo.

`sw.js` precaches an **explicit, individually listed** asset array — the
existing MapLibre and leaflet-rotate files are each named in it. Potree's
runtime files must be added the same way.

Two traps here:

- **`cache.addAll` is atomic.** One 404 fails the whole install, which takes
  offline support down for the entire app, not just the new panel. Verify every
  path you add actually serves.
- Potree resolves several assets **at runtime** — workers, the laz-perf WASM,
  shaders and resource files — rather than through a static import graph. Find
  the real set by loading the panel with the network panel open, not by reading
  the package layout. If the set is large or version-volatile, prefer a runtime
  `fetch`-handler rule scoped to `./vendor/potree/` over enumerating it in
  `ASSETS`, and say so in the as-built notes.

---

## 5. Verification

`npm run verify` must pass: `vendor` → `check` → `test` → `audit`.

Add to `scripts/check-static.js`:

- the point-cloud panel markup and its controls exist
- Potree vendor artifacts are present in `vendor/`
- the class-filter presets are wired
- the sync guard flag exists and is declared before its first use (see §6)

Add a `test-point-cloud.js` covering the pure logic, with no network:

- viewport bbox → camera position and back is stable (round-trip within
  tolerance) at several latitudes and zooms
- the sync guard prevents recursive updates
- coverage lookup picks the right project for the table in §1, and returns
  nothing for a point outside all 30

**Manual QA** on a hardware-accelerated WebGL2 browser, at Rainier:

1. Enable the panel; points load and the view matches the 2D map.
2. Drag the 2D map; the 3D view follows. Drag/orbit the 3D view; the 2D map
   follows. No oscillation, no drift after ten alternating drags.
3. **Bare earth** removes the canopy and leaves ground; **All returns** restores
   it. The change is immediate — no refetch.
4. Unlink, move 3D, re-link: 3D snaps back to the 2D view.
5. Disable the panel: the WebGL context is released and the 2D map is unchanged.
6. Pan somewhere with no coverage: the panel says so.

---

## 6. Gotchas already paid for

Do not rediscover these.

- **A guard that always fired.** The 3D terrain entry point called
  `module.supported?.()`; MapLibre removed `supported()` in v5, so the optional
  call returned `undefined` and the guard threw on every device — while
  reporting itself as a WebGL2 hardware limitation. Never gate a feature on an
  optional call whose absence is indistinguishable from failure. Probe the
  capability directly.
- **Temporal dead zone at top level.** `setMapTheme` runs during load and calls
  into overlay code, but `OVERLAYS` is a `const` declared much later. Touching
  it in its TDZ throws — and `typeof` does **not** protect you, because typeof
  on a TDZ binding throws too. Because this is top-level, it aborted the rest of
  the script and killed the whole page from one console line. Any new
  initialisation that runs early and reaches late-declared state needs an
  explicit readiness flag declared before the call site. `check-static.js`
  asserts this for the existing case; do the same for yours.
- **Float32 precision.** EPT coordinates are EPSG:3857 metres in the millions.
  Potree offsets to a local origin internally — do not fight it, and do not pass
  raw 3857 coordinates into shader math yourself.
- **A transparent tile is not "no data" when it is geometry.** The elevation
  route once answered no-coverage with a 1×1 transparent PNG; decoded as
  Terrarium that is −32768 m, a 32 km pit in the mesh. If you touch elevation,
  return a real tile encoding sea level.
- **Esri tile axis order** is `/tile/{z}/{row}/{col}` — y before x — with no
  `{s}` shard and no `{r}` retina variant.
- **CARTO is gone.** Its basemaps require an API key as of 2026-08-26 and are
  being retired; `check-static.js` fails if `cartocdn` reappears. Note that
  `carto.nationalmap.gov` (USGS GNIS) and `tiles.macrostrat.org/carto` are
  unrelated — the name is a coincidence.
- **Never use OSM Foundation tiles.** Their usage policy forbids it and the
  server answers HTTP 418.
- **Testing in a headless pane:** `requestAnimationFrame` does not fire when the
  browser pane is hidden, so MapLibre and Potree render loops never advance and
  `map.setView(..., z)` never commits its zoom animation. Pass `{animate:false}`
  in 2D, and shim rAF onto timers if a render loop must run. This is a harness
  artifact, not an app bug.

---

## 7. Scope boundaries

- **Do not** replace or remove the existing MapLibre `3D terrain` mode. It works
  everywhere from the national DEM; the point cloud exists for 30 Washington
  projects. Two clearly labelled affordances, not one that behaves differently
  by location.
- **Do not** interleave the point cloud into MapLibre's depth buffer. The
  separate panel is the design, and it is what removes the projection matching,
  depth compositing and renderer-compatibility risk.
- **Do not** add a server proxy route for the point cloud. The bucket sends
  `Access-Control-Allow-Origin: *`; a proxy would add latency and a failure mode
  for nothing.
- **Do not** change the 2D map's parenting, projection, or Leaflet version.
- **Do not** add a build step. The page is served as static files.
- Derived products — DSM/DTM rasters from points, horizon maps, solar
  irradiance — are **out of scope here.** They belong on the Mac terrain service
  with PDAL, and are a separate spec.

---

## 8. Definition of done

- The panel opens, loads points over Rainier, and both views stay in sync in
  both directions with no oscillation.
- The class filter removes and restores vegetation instantly, with no refetch.
- Disabling releases the WebGL context; the 2D app is byte-for-byte unaffected
  in behaviour.
- No coverage is reported as such, not as an empty view.
- `npm run verify` passes; the build stamp in `version.js` is bumped and matched
  in `sw.js`; new runtime files are in the Pages `cp` list.
- A short `POINT_CLOUD_3D.md` "as built" section records what changed, anything
  measured, and anything that turned out differently from this spec.
