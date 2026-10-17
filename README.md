# Clear Skies Portal

A local web app that finds the most recent satellite imagery for any location on Earth,
plus lidar terrain. Everything it uses is free and needs no API key.

## Run it

```
node server.js
```

Then open **http://localhost:8765**

Run `npm install` after cloning or changing dependencies. The browser-ready
MapLibre and Leaflet rotation files are checked into `vendor/`, so ordinary
launches do not need a build step or a package download. Leave the terminal
open; it's the server *and* the cache.

*(The code itself uses nothing newer than Node 18 APIs; 22 is simply the oldest
release line still getting security updates.)*

You can also open `index.html` straight from disk, but two things break that way:
the WA DNR lidar layers (they need the proxy) and the locate button (browsers only
grant geolocation on `https://` or `localhost`).

## Search coordinates

The search box accepts place names, decimal latitude/longitude, and coordinates
copied from Google Earth or Google Maps in degrees/minutes/seconds (DMS):

```
47.661614, -118.707269
47°39'41.81"N 118°42'26.17"W
47°39′41.81″N, 118°42′26.17″W
```

Hemisphere letters may appear before or after each angle; labelled pairs can
also be longitude first. Degrees/decimal minutes and decimal degrees with
hemisphere letters are supported. Unlabelled pairs remain latitude first.
Search, Copy coordinates, Google Maps and Google Earth use the same parser;
copying and external links always use decimal coordinates. Searching retains the
original pasted text so copying a searched coordinate does not lose precision.
Invalid ranges or
minutes/seconds of 60 or greater show an error instead of searching for a place.
Regression tests live in `test-coordinate-search.js` and run with `npm test`.

## Map tool popovers

Markup, camera export, Layers, Map view and the terrain engine use dock-anchored
popovers. Opening another tool closes the previous one. The panels share the
theme's glass surface and stay inside the viewport, including mobile safe areas.

The drawing button opens the markup tools. Drawing on the map dismisses the
controls without turning off the pen; press the drawing button to reopen them.
The close button hides the controls, while **Done** ends drawing mode. Opening a
different dock popover also ends drawing mode without deleting the annotations.

Click the layer name or description, or its pencil icon, to edit those details
in place. Save with the checkmark or Enter (Command/Ctrl+Enter in a multiline
description); Escape cancels. Descriptions are optional, limited to 1,000
characters, and persist with the layer in IndexedDB and on the terrain engine.
The small layer selector switches the active drawing layer and saves any pending
details to their original layer before switching.

Stroke and outline widths have a logarithmic slider alongside exact feet entry.
The number field can extend the slider beyond 10,000 ft. Dragging the slider
updates a selected mark live and remains one undo operation. Keyboard steps keep
focus, and shape outlines can be reduced to zero.

Popover entrances/exits and tool selection use brief native browser animations,
following [Apple's motion guidance](https://developer.apple.com/design/human-interface-guidelines/motion)
and [spring-animation principles](https://developer.apple.com/videos/play/wwdc2023/10158/),
not SwiftUI APIs. Reduced Motion disables the spatial feedback and exit delay;
browsers without discrete display transitions keep the simple fallback.

The camera opens export settings first: a resolution, a **Map info** switch, and
two side-by-side actions. **Capture** saves the whole map view at that
resolution straight away. **Select Area** opens only the draggable rectangle,
with Cancel and Capture beside it; resolution and map info come from the panel.
The sidebar's Export entry opens the same settings, rather than relocating the
live controls.

Switches and sliders share one style: an outlined groove (black in dark mode)
with a round knob slightly larger than it, and a thin slider groove with a
white thumb that gains a soft halo while hovered or dragged. Their colours are
chosen under **Appearance** at the bottom of the sidebar: five theme presets
(Meadow, Ocean, Sunset, Berry, Graphite) set the toggle/slider colour, the
slider track colour and the button colour together, and each can then be
changed on its own with swatches or the system picker. Appearance also carries
the font, text colour and text size. The bundle is stored in this browser
(`clearskies.appearance.v1`, with the toggle colour mirrored to
`clearskies.controlAccent.v1` for older builds) and applied before first paint.

The separate **Settings** item below Appearance is the foundation for
app-level preferences: the secure terrain engine (status and a shortcut to
its dock controls, which hold the Tailscale address), the default export
resolution and map-info choice, a Reduce Motion override, and a reset for
all saved preferences on the device.

Browser regressions: `node scripts/ui-map-popovers.js` covers light/dark desktop,
mobile, narrow phones, landscape, editing, layer switching, drawing, keyboard
focus, panel transitions, Reduced Motion, the camera's two actions and the
Appearance colours and presets (including after a reload). `test-markup-controls.js` exercises
metadata drafts, slider math, exact units and one-step width undo in `npm test`.
`node scripts/ui-snapshot.js` checks whole-view Capture, area selection and exported pixels.
Both accept a local server URL and the optional `PLAYWRIGHT_MODULE` environment
variable; browser tooling is not an application dependency.

## Run it in a Codespace

Press **`.`** on the GitHub repo page, or *Code → Codespaces → Create codespace*.
`.devcontainer/devcontainer.json` provisions Node 24 and Python 3.14, installs the
Python requirements, starts the server, and forwards port **8765** — the preview opens
by itself. The container sets `HOST=0.0.0.0` so the forwarded port reaches the server;
locally it still binds to `127.0.0.1` only.

The same file works in VS Code locally via *Dev Containers: Reopen in Container*.

## Hosted page and the terrain engine

The [GitHub Pages app](https://rileyg44.github.io/clear-skies-portal/) draws
CORS-enabled satellite imagery, basemaps, and national 3DEP directly from their
providers. It does not host a compute backend.

That direct-first rule also applies locally: national 3DEP avoids an unnecessary
proxy hop, then automatically falls back to the terrain engine if the provider
fails or a cached tile is needed offline. Existing imagery/terrain stays visible
until a replacement has rendered, so a slow source cannot blank the map.

For visitors who do not run the local engine, the hosted page requests USGS 3DEP
as compressed LERC/F32 elevation tiles and decodes them in a worker on the device.
An AWS Terrarium tile is kept as an overview fallback so the first view remains
usable while a higher-fidelity 3DEP tile refines it. The Terrain pane's **Rendered
data & source details** card reports the sources that actually contributed pixels
to the current view, with percentages based on rendered samples rather than a
misleading coverage claim. It can also query USGS mosaic metadata at the map
center. USGS 3DEP is a national service with mixed native resolutions; a 1 m
capability does not mean every location has 1 m data, so the UI states that
limitation instead of advertising a resolution the provider did not return. The
source popup and Terrain pane show both native/provider spacing and the current
display sampling (m/pixel); a fine display sampling number can still be an
upsampled overview when the provider has no finer survey at that point.

`server.js` is the optional local terrain engine. It is required for providers
that do not allow browser requests (WA DNR, Macrostrat, and SNODAS), for rendering
raw USGS 1 m DEMs, and for resumable offline-area downloads. When the page itself
comes from `server.js` or Electron, it connects automatically.

The engine limits disposable disk cache files to 15 GiB (`CSP_CACHE_MAX_GB`);
the macOS service installer raises its own engine to 20 GiB.
Background sweeps evict the least recently used tiles and USGS COG ranges down
to 90% of that cap. Saved offline areas are pinned, even if they exceed the
cap; the WA DNR store is separate and excluded. `CSP_CACHE_MIN_FREE_GB` (default
8 GiB) still stops cache writes near the disk's free-space reserve. Cache usage,
pinned bytes and the last sweep appear in `/api/health` under `cacheBudget`.

Raw 1 m DEM discovery defaults to Washington so a fresh launch indexes tens of
projects instead of the entire national archive. National rendered 3DEP still works
everywhere. Set `CSP_USGS_STATES=ALL` before starting the engine for nationwide raw
1 m discovery, or use a regional list such as `CSP_USGS_STATES=WA_,OR_,ID_`.

Tailscale is **not required** for normal local or desktop use. It is only a secure
bridge when the hosted Pages app on another device needs to reach the terrain
engine running on your Mac. On macOS, run this once from the checkout:

```
scripts/install-mac-service.sh
scripts/share-terrain-engine.sh
```

The installer keeps the engine alive as your user, restarts it after a failed
health check, stores its runtime and cache under `~/Library/Application Support/
ClearSkiesPortal`, and binds it only to `127.0.0.1`. Tailscale Serve is therefore
the sole network bridge and remains tailnet-authenticated; do not use Funnel for
this private analysis service. Check the bridge with `tailscale serve status`.

The sharing script adds only Clear Skies API routes on HTTPS port 443. It
preserves the root page and other services, so T3 Code can share the same Mac
address. Replacing the root Serve target previously made Clear Skies health
requests return another application's HTML even though the local engine was
healthy. The API routes avoid that collision.
On a shared Mac, setting `CSP_MAINTAIN_TAILSCALE=1` in the maintained service's
environment also checks those routes during normal health checks and restores
missing API handlers without changing other applications' handlers.

### WA DNR elevation

**WA DNR LiDAR** downloads official bare-earth DTM files on demand through the
DNR portal's normal download workflow. Once prepared, the same numeric
elevation supports hillshade, multidirectional lighting, slope, aspect,
northness, tint, contours, elevation spectrum/bands, surface analysis, landform
measurements, and the 3D mesh/drape. **WA DNR elevation only** leaves missing
analytical pixels blank; 3D meshes require complete DNR tiles. **WA DNR
published hillshade** retains the original fixed-light rendered image.

Automatic source selection uses already cached DNR data and starts no archive
downloads. Explicit DNR selection acquires small areas in a separate worker;
USGS/global pixels can display during preparation and remain individually
labeled. Layers reports actual contributing pixels, survey/dataset identifiers,
native spacing, and display sampling. Selecting DNR is not proof of DNR coverage.
Download this view acquires DNR rasters when DNR is explicitly selected.

The first download can take minutes because DNR provides ZIP archives containing
large TIFFs. A single ingestion worker streams downloads to disk and builds
small numeric overviews; map requests use bounded windows and share cached
requests. The default DNR cache budget is 4 GiB, the per-archive limit 2 GiB, and
the normal 8 GiB free-disk reserve remains enforced. Configure
`CSP_DNR_CACHE_GB` and `CSP_DNR_ARCHIVE_GB` if needed. View downloads are limited
to 32 acquisition cells; zoom in if the view exceeds that bound. Completed
rasters persist across restarts and styles. Existing imagery, markup, and USGS
caches remain intact.

Discovery now uses a cached official project catalogue; bounds identify
candidates. The expensive file-intersection query runs only for acquisition.
Provider errors return errors, never a successful empty coverage result.
Horizontal and vertical units are read separately; unknown units or unsupported
raster geometry produce an explicit error. Dataset 1543 (Columbia Valley Fema
North 2020) has a conflicting TIFF metre tag: DNR's official metadata dataset
1547 contains the survey report and WGS QA report specifying US survey feet.
That documented correction is applied before overview generation and numeric
sampling and is included in rendered provenance.

On the hosted page, paste the shown Tailscale HTTPS URL in *Secure terrain engine*
and choose **Connect**. **Copy private setup link** gives another signed-in
Tailscale device a one-time `#engine=` setup link: the fragment is not sent to
GitHub Pages, and the page only saves the engine after validating it. The browser
cannot safely start software on a different Mac, so the installed local service
provides the practical one-click behaviour by starting and self-healing before any
device connects. Cross-origin access defaults to this repository's GitHub Pages
origin. Add other trusted origins explicitly with a comma-separated
`CSP_CORS_ORIGINS` environment variable.

## Preview UI changes on your tailnet

`scripts/preview.sh` runs a second, non-live copy of the portal from any
branch, so a proposed change can be reviewed on your devices before it ships.
It is separate from the live copy in every way: it has its own git worktree,
port (8766), cache and launch agent, and its own Tailscale Serve entry on
HTTPS port 8443. The live engine on 8765, its `:443` Serve entry, and GitHub
Pages are never touched.

```
scripts/preview.sh up claude/happy-brahmagupta-7mvo7a   # or any branch; defaults to this checkout's
scripts/preview.sh update    # pull the same branch again after new pushes
scripts/preview.sh status    # branch, commit, health, and the URL
scripts/preview.sh down      # stop it and remove the :8443 entry
```

It prints `https://<this-mac>.<tailnet>.ts.net:8443/`, which opens on any
device signed in to your tailnet. It is tailnet-only; never use Funnel for it.
Preview pages show a **Preview** badge beside the build stamp and in the tab
title, and they skip the offline service worker so every reload shows the latest
push. Append `?ui=classic` to compare against the previous interface. The
branch has to include this script's server support (merge `main` into older
branches first).

## Develop it

```
npm start          # same as `node server.js`
npm run check      # syntax-check JS plus static assets and source catalog
npm test           # terrain unit tests plus black-box server tests
npm run verify     # all checks, tests, and dependency audit
pip install -r requirements.txt
```

`npm run vendor` refreshes the checked-in browser bundles from the installed
packages. CI (`.github/workflows/ci.yml`) syntax-checks the JavaScript and Python,
validates the static bundle and source catalog, exercises the renderer and server,
audits dependencies, and boots the service to confirm `/api/health` answers.

## 2D rotation and 3D terrain

The portal still opens in **2D**. Rotate the 2D map with a right-button drag on a
mouse or a two-finger twist on touch. The compass button on the right shows the
current bearing and returns the map to north-up.

Open **Terrain · lidar** and choose **3D terrain** for a pitched, orbitable view.
Drag to pan, right-drag or Control-drag to orbit, use the wheel or pinch to zoom,
and use two fingers to pitch and rotate. The selected hillshade, elevation tint,
slope, aspect, exposure, contour, or WA DNR project is draped onto the terrain;
the 3D canvas is destroyed when returning to 2D so it does not keep GPU memory.

The same controls drive both renderers:

- **Sun azimuth** rotates the illumination around the landscape.
- **Sun altitude** moves the light from a low grazing angle to overhead.
- **Ambient light** controls shadow depth.
- **3D relief** adjusts vertical exaggeration without altering source elevation.

Raw/national elevation products relight immediately from the cached DEM. WA DNR's
published hillshade can be draped in 3D, but its shadows are baked into the source
image and cannot be moved. 3D requires WebGL2; unsupported or GPU-blocked browsers
stay safely in 2D and explain why in the Terrain pane. See `THREE_D_TERRAIN.md` for
the implementation and maintenance handoff.

## Linked 3D point clouds

Open **Terrain · lidar → 3D point cloud** for the optional USGS 3DEP point-cloud
viewer. It lazy-loads only when requested and keeps the ordinary 2D map visible
as the geographic reference. The two cameras are linked by default; unlink them
to inspect the cloud without moving the map.

The panel streams the covering Washington EPT project directly from the USGS
public archive and provides a 1–10 million point budget, fixed/adaptive sizing,
elevation/intensity/classification/RGB/return colouring, Eye-Dome Lighting, and
ASPRS class filters. **Bare earth** shows class 2 only; **All returns** restores
the full cloud. Width and view/control split persist locally. Closing the panel
destroys its WebGL context and workers.

On narrow desktops the left and right panels share a collision boundary: the
panel being expanded gently takes space from the other while preserving a gutter
for the sidebar toggle. On phones, opening one workspace closes the other. See
`POINT_CLOUD_3D.md` for architecture, provenance, maintenance details, and QA.

## Export a map image

Use the camera button. Drag a rectangle over the map (or **Full view**), pick a
resolution and **Save**. It renders a **PNG** directly from the source tiles; it never
captures a window, screen or browser tab.

Resolution is output pixels per screen point: **1×, 2×, 4×, 8×, 16× and 32×**. Each step
up requests source tiles one zoom level finer for that area, so the extra pixels are real
detail wherever a provider publishes it. Where a source ends at a lower native zoom it is
enlarged, never invented, and 16× and 32× are only offered when some layer on the map
has finer tiles to give. Vector overlays are rasterized at full output resolution;
locally rendered terrain canvases come in at their on-screen resolution.

Large exports (over about 12 MP, or wider than 8,192 px) are drawn in blocks of at most
4,096 px and streamed into the PNG a band of rows at a time (`png-stream.js`, using the
browser's own zlib compressor). No canvas ever holds the whole picture, so the browser
canvas caps (16.7 MP on iPhone, 16,384 px per side everywhere) no longer apply. Each
block fetches only the tiles it overlaps, every layer's tiles for a band are fetched
together, the next band is fetched while the current one is drawn, and a tile is
released after the last band that needs it.

Where the file goes:

- **Chrome or Edge on a computer:** a large export opens a save dialog and is written
  straight to disk as it is made, up to 2,000 MP.
- **Other desktop browsers:** downloaded at the end, up to 600 MP.
- **iPhone / iPad:** handed to the share sheet (Save Image or Save to Files), up to
  200 MP, since the finished file has to fit in the phone's memory first.

Source requests run eight at a time from the browser cache first, with a ceiling of
30,000 tiles per export. A tile a source answers with "no data" (outside a scene's
footprint) is left empty rather than reported as a failure.

A PNG is still a finite raster image: you can zoom into it until you reach the chosen
pixel resolution, not indefinitely. A future research-grade export for continued
map-like zoom would be a tiled package or Cloud-Optimized GeoTIFF rather than one PNG.

## Markup layers

**Markup** (under Layer groups) holds your own drawings in named layers. Choose **New
markup layer**, name it and pick its colour (the layer's tag and default ink), or press
the pencil in the map-button column to draw straight away on the last layer you used.
Click a layer's title to rename it; **Clear** empties a layer after asking, **Delete**
removes it after asking.

The drawing bar works like a paint program:

- **Pen** and **Highlighter**, each with its own colour, width and transparency.
- **Shapes**: line, arrow and double arrow; rectangle, rounded rectangle, oval, triangles,
  diamond, polygons, stars, block arrow, heart, lightning and freeform. Shapes have an
  outline colour, width (0 for none) and transparency, and a fill colour and
  transparency, or no fill. Hold Shift for squares, circles and 15° lines.
- **Text** and **Pin**, with colour, size and transparency.
- **Eraser**: cuts pen and highlighter strokes where it passes; anything else it touches
  is removed whole.
- **Select**: click a mark to select it, drag to move it, drag the frame's handles to
  resize (Shift keeps proportions) or the round handle to rotate. The bar restyles the
  selection; **Edit points** reshapes polygons; duplicate (Ctrl/⌘+D) and delete
  (Delete key) sit beside it. **Undo**/**Redo** (Ctrl/⌘+Z, Shift for redo) step through
  changes. Keys: V select, H pan, P pen, I highlighter, E eraser, S shapes, T text.

Marks are anchored to the ground: positions are latitude/longitude and every size is in
metres, so they grow and shrink with the map like writing on a paper map and stay put
at any zoom or rotation. Each layer has its own switch, opacity and place in **Layers**,
so projects can be shown one at a time or together, and they come through in PNG
exports.

Where they live:

- **This device:** every layer is kept in the browser (IndexedDB), so markup works with
  no engine, offline, in the field.
- **Your computer:** when the terrain engine is reachable, each layer is also saved as
  `markup/<layer-id>.geojson` beside `server.js` (or `CSP_MARKUP_DIR`). That folder is
  in `.gitignore`, so markup is never committed. The files are plain GeoJSON and open in
  QGIS or Google Earth.
- **Between devices:** the engine copy is the shared one. The newer copy of a layer
  wins; a deleted layer goes to `markup/.trash/` and leaves a tombstone so an older
  offline copy cannot bring it back. An engine started from code older than markup
  answers 404; the app says so and keeps the layers on the device until the engine is
  updated and restarted.

## What's in the box

| File | What it is |
|---|---|
| `index.html` | The whole app — one self-contained file, Leaflet inlined |
| `ui-system.js` / `ui-system.css` | Task-oriented navigation shell, active-layer stack, category isolation, and responsive visual system |
| `vendor/` | Pinned browser bundles for MapLibre GL JS and Leaflet rotation |
| `terrain-raster.js` | Shared deterministic CPU terrain styling used by 2D, 3D protocol tiles, and tests |
| `point-cloud-viewer.js` | Lazy Potree viewer, EPT loading, controls, linked cameras, cleanup, and panel sizing |
| `point-cloud-core.js` | Tested Web Mercator camera, coverage selection, and synchronization helpers |
| `point-cloud-catalog.json` | Generated index of the 30 Washington USGS EPT projects |
| `mosaic-core.js` | Tested footprint geometry, antimeridian, identity, coverage and imagery LOD helpers |
| `server.js` | Local terrain engine: static files, validated proxying, request coalescing, retries and disk cache |
| `scripts/install-mac-service.sh` | Installs a loopback-only, self-healing macOS terrain-engine service |
| `SOL_HIGH_IMPLEMENTATION_HANDOFF.md` | Detailed implementation plan for the remaining lidar, landscape, geology, sidebar, persistence and imagery work |
| `test-server.js` | Offline black-box checks for CORS, request limits, traversal protection and server health |
| `version.js` | One build identifier shared by the page and service worker cache |
| `TODO.md` | Work queue. Say "check the TODO" to a fresh Claude session and it picks up from there |
| `THREE_D_TERRAIN.md` | 2D rotation, 3D terrain, lighting architecture, limitations, and QA handoff |
| `POINT_CLOUD_3D.md` | Linked point-cloud architecture, verified data facts, as-built notes, and QA handoff |
| `UI_REDESIGN.md` | Interface information architecture, visual authority, integration boundaries, and maintenance checklist |
| `source-catalog.md` | ~50 free imagery sources with endpoints, licences, resolutions |
| `sources.json` | Machine-readable version of the catalog |
| `hiking-stack.md` | The Western-US subset: snow, fire, route-finding |
| `lidar-research.md` | Lidar sources, verified endpoints, coverage gaps |
| `trailcheck.py` | Standalone: snow line from Sentinel-2 NDSI + fire + SNOTEL |
| `snowline.py` | Earlier snow-line-only version |
| `probe.py` | Tiny script that reports scene freshness at a few test points |
| `cog.js` | COG/GeoTIFF reader — TIFF LZW + floating-point predictor, geodesy. No dependencies |
| `usgs.js` | USGS 3DEP 1 m DEM source: S3 index, range reads, terrain rendering, PNG encoder |
| `nadi1-cordilleran.json` | NADI-1 Cordilleran ice margins, 25–10.5 ka, clipped to the Pacific Northwest (Dalton et al. 2023, CC BY 4.0). Rebuild with `scripts/build-nadi1-cordilleran.py` |
| `test-cog.js` | Offline checks: LZW, predictor, geodesy, cell maths, PNG. `node test-cog.js` |
| `.devcontainer/` | Codespaces / Dev Containers setup — Node 24, Python 3.14, port 8765 |
| `.github/workflows/ci.yml` | Syntax checks, `sources.json` validation, server smoke test |
| `requirements.txt` | Python deps for the three scripts |

`.cache/` appears next to `server.js` once you run it. Safe to delete; it just rebuilds.

## Imagery sources

Copernicus Data Space · Microsoft Planetary Computer · AWS Earth Search ·
NASA GIBS · NISAR (NASA-ISRO L-band SAR)

Sentinel-2, Sentinel-1, Landsat 8/9, NAIP aerial, HLS, ASTER, Copernicus DEM,
VIIRS/MODIS near-real-time true colour and night lights, NISAR.

## Terrain / lidar

- **USGS 3DEP** — national, ~1 m where lidar exists. Hillshade, multi-directional
  hillshade, elevation-tinted, slope, aspect, and 2/5/10/25 ft contours.
- **WA DNR lidar** — Washington's own bare-earth hillshades at native project
  resolution. Every project covering the view composites together, newest first,
  as one terrain image. The ordinary basemap remains visible through genuine
  no-data instead of stacking two coloured terrain products.

- **USGS 1 m (offline-capable)** — 3DEP's staged 1 m DEMs, read straight off S3
  as Cloud-Optimised GeoTIFFs. This is the only source that hands over *elevation*
  rather than a picture of it, so hillshade, slope, aspect and contours are all
  computed locally, at any zoom, with no upsampling artefacts — and it is the only
  one that survives with the network off. 25 Washington projects, ~2,548 tiles,
  ~474 GiB (against 53 TiB for the WA DNR archive). Coverage is real but partial:
  **Mount Rainier National Park is a genuine gap**, which is why WA DNR stays.

- **Elevation spectrum** — the geology overlay reads real elevation values, not
  a pre-coloured image. One adaptive layer uses raw USGS 1 m lidar for close
  views, national 3DEP at broad scales, and browser-direct AWS Terrain Tiles if
  the private engine is unavailable. This single-source-per-pixel design avoids
  the dark or reddish cast caused by stacking independently coloured elevation
  tiles. The chosen height is white, lower ground grades red, and higher ground
  grades blue; controls default to feet, accept any custom colour span, and
  include a saved shader-strength control so the basemap remains legible.
  Recolouring runs in one shared
  WebGL2 GPU context, with an allocation-free CPU fallback, so moving the
  threshold never refetches terrain and does not create a context per tile.

*Best available* prefers WA DNR where it has data — 345 projects to USGS's 25, and
some resolving finer than 1 m — then USGS 1 m, then 3DEP. Only one styled terrain
product is painted at a time; at close zooms its last native tile is enlarged
through z28 rather than disappearing or fetching nonexistent detail.
The light Esri Canvas basemap is the default so translucent geology colours remain
readable. A saved sun/moon control switches only the basemap between light and
dark; the sidebar, controls, imagery and analysis layers do not change.

## Labels & overlays

Reference layers drawn over whatever imagery is selected, each independently
toggleable, with a shared opacity slider. All keyless.

| Overlay | Source |
|---|---|
| Roads & streets | Esri World Transportation |
| Cities & boundaries | Esri World Boundaries and Places |
| Place labels | Esri Canvas Reference (follows the light/dark map theme) |
| Rivers & lakes | USGS National Hydrography Dataset |
| Peaks & landforms | USGS GNIS — summits, ridges, gaps, glaciers (zoom 10+) |
| Named places | USGS GNIS populated places (zoom 9+) |
| **Continental ice limits** | Washington Geological Survey 1:250k layer 0 |
| **Ice Age flood affected area** | WGS-hosted regional reference polygon |
| **Pleistocene lakes** | EWU / Ice Age Floods Institute reconstruction |
| **Bedrock geology** | Macrostrat (proxied — sends no CORS; zoom ≤16) |
| **State geologic map** | USGS SGMC via Mineral Resources (zoom ≤14) |
| **WA surface geology** | Washington Geological Survey 1:100k WA GeMS |
| **WA Quaternary active faults** | Washington Geological Survey DDS-1 |
| **WA volcanic vents** | Washington Geological Survey vent locations |
| **Snow depth (current)** | NOAA NOHRSC National Snow Analysis (M2 cache + direct fallback; zoom ≤14) |
| **Snow water equivalent** | NOAA NOHRSC National Snow Analysis (M2 cache + direct fallback; zoom ≤14) |
| **Snow cover** | NASA GIBS MODIS Terra NDSI (zoom ≤8) |

Not OpenStreetMap's own tiles: their tile-usage policy forbids this use and the
server answers HTTP 418. Esri's free reference layers are the keyless substitute.

CARTO's raster basemaps were used until 2026-08-26, when CARTO began requiring an
API key and watermarking unkeyed tiles. They are also retiring raster basemaps,
so the portal moved to Esri Canvas rather than take a key with a shelf life.

The two geology layers carry their own default opacity (55%) because they are
opaque polygon fills rather than line work; the shared slider scales them
instead of overriding. Macrostrat sends no CORS header, so it routes through
`/api/geo/macrostrat/...` and is cached for 30 days — bedrock is not news.

Snow depth and SWE are NOHRSC's modeled National Snow Analysis — *current
conditions* in inches for CONUS at about 1 km resolution, refreshed four times
per day. A connected M2 serves its two-hour warm cache first; if it is absent,
the browser uses NOAA's CORS-enabled export directly. MODIS NDSI is the
satellite view beside it. Current GIBS searches deliberately start with the last
completed UTC day, rather than advertising today's still-partial global mosaic.
A layer outside its native zoom range says that it is enlarged instead of
silently turning blank.

## Things worth knowing

- **Download this view** (Terrain pane) pre-downloads terrain tiles for the current
  view, so the area then works with **no network at all** — the point at a trailhead.
  WA DNR generates uncached composites slowly; the engine deliberately limits
  concurrency so it finishes them instead of overwhelming ArcGIS. Tiles appear
  progressively over the always-visible 3DEP fallback and are instant once cached.
  - *Depth*: **Native lidar** (z18, 1.35 ft/px) is the default and matches roughly what
    the sharper projects actually resolve; **Maximum** (z19, 0.66 ft/px) and the old
    **Screen +2** are also there. Only the finest three zoom levels are fetched —
    coarser ones are cheap and already cached from browsing.
  - *Extent*: this view, +50% margin, or +a full screen of margin.
  - The estimate is shown before you commit — e.g. `z14–18 · 1.35 ft/px · 4,957 tiles ·
    ~89 MB`. Above 8,000 tiles it asks to confirm; above 40,000 it declines and names
    the zoom that would fit.
  - *Staleness*: the DNR portal sends no `ETag`, `Last-Modified` or `Accept-Ranges`, so
    there is nothing to validate against. Each download instead records the catalogue as
    it stood in `.cache/areas/<id>.json`; a new `dataset_id` means a new flight and a
    changed byte count means a re-issue. Washington flies about ten new projects a year,
    so this is checked once per session, not on every pan.
- **Offline terrain.** With *USGS 1 m* selected, **Download this view** fetches the
  DEM byte ranges behind the view. Stopping and restarting resumes — rendered tiles
  and the ranges behind them are both cached, so a restart skips what already
  arrived. Because these objects carry `ETag` and `Last-Modified` (which the WA DNR
  portal omits entirely), staleness is a HEAD request rather than a catalogue diff.
- **M2 terrain engine.** COG range fetching uses persistent, bounded HTTP
  connections. TIFF decoding, reprojection, elevation encoding, hillshade,
  multidirectional relief, tint, slope, aspect, contours, and landscape fabric
  analysis run in a priority-aware worker pool instead of blocking the server's
  request loop. Interactive tiles outrank offline downloads; abandoned viewport
  work is cancelled; timed-out workers are replaced. The dedicated Mac service
  uses six workers on this 8-core M2, four concurrent S3 range reads per worker,
  and four low-priority warming lanes. Manual launches still auto-size more
  conservatively. `CSP_TERRAIN_WORKERS` supports 1–8 and per-worker
  `CSP_S3_INFLIGHT` supports 1–12. Rendered tiles and every downloaded COG byte
  range persist on the SSD; writes pause before free space drops below 8 GiB,
  while uncached content continues to render normally.
- **Open on natural colour** (**Satellite imagery → Search filters**, on by default) keeps the map from landing on a
  radar or night-lights scene just because it happens to be the newest.
- **Time window** (**Satellite imagery → Search filters**) takes either a preset — last 14/30/90 days, last year,
  5 years, all time — or **Custom range…**, which reveals two date pickers for an
  explicit start and end (say 2025-07-01 → 2025-07-31). Leave one side empty for an
  open-ended range: only a start means "from then on", only an end means "up to then",
  both empty is all time. Quick buttons cover this month, last month, year to date and
  last calendar year. The active window shows on the Filters header even when collapsed.
  A named range is applied everywhere — including the GIBS daily layers, which are
  generated from the *end* of the range (or the last completed UTC day for a current
  search) rather than an incomplete live day, and the *Fill surroundings*
  mosaic, so neighbouring scenes come from the same era rather than from last week.
- **Touch, viewport, and layer controls.** The map shell uses CSS `100dvh` rather
  than JavaScript visual-viewport offsets, so it fills the current iPhone display;
  attribution and floating controls account for the safe area without shortening
  the map. A single map click/tap now only selects a location. Double-click or
  double-tap to begin an imagery search, which prevents panning from accidentally
  fetching scenes. The map uses the normal pointer at rest and changes to the
  closed hand only while it is actually being dragged.
- Every adjustable render layer has an opacity control that accepts 0–100%, and
  its own reset: terrain, imagery, elevation spectrum, elevation highlights,
  surface analysis, and overlays. Resetting a layer returns only that layer to its
  documented defaults and does not reset unrelated work.
- The elevation spectrum keeps its red/white/blue legend directly beneath the
  ramp, followed by a separately labelled **Spectrum opacity** control. In the
  Ice Age group, the continental ice-limit and Pleistocene-lake overlays expose
  independent border-width sliders; their vector linework is cached for the
  session and can be thinned or thickened without another data request.
- Sidebar panes collapse or expand when any non-control part of their header is
  clicked/tapped. Resize from the bottom edge. To reorder, press and hold the
  header for 260 ms, then drag; a normal tap will not move the pane. Layout
  persists, and "Reset layout" in the footer restores the stock arrangement.
- Map tools other than the panel toggle live at the right edge. The standalone
  panel toggle remains beside the sidebar, stays outside it while the sidebar is
  resized, and sidebar control text scales from the panel's own width to prevent
  action buttons from wrapping or changing height.
- Sidebar select controls use the platform's native menu treatment instead of a
  simulated dropdown, including on iPhone and iPad.
- Right-click any scene on the map to swap its source or date.
- **Ctrl+B** toggles the sidebar.

## Python scripts

```
pip install rasterio numpy gpxpy
python3 trailcheck.py --lat 46.8523 --lon -121.7603 --name "Rainier"
python3 trailcheck.py --gpx myroute.gpx
```

## Stop the server

Match on the port, not the command line — the process is just `node server.js`,
with `satportal` only as its working directory, so filtering on the path finds nothing.

```powershell
Get-NetTCPConnection -LocalPort 8765 -State Listen |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

### Map annotation layers

Use **Markup → New markup layer** or the pencil button to draw on either the 2D map or 3D terrain. Pen, highlighter, shapes, arrows, notes, and pins use geographic positions and fixed ground dimensions. Width and text size are entered in feet; orbiting or zooming does not change the saved position or size. In 3D the marks follow the terrain surface. The camera includes visible markup in PNGs, including large 2D exports. Hide a layer to exclude it from the image. Existing markup layers work in both views without conversion.

On desktop, the lower-left map corner shows the cursor’s latitude/longitude and approximate ground elevation in feet, plus color keys for visible terrain, elevation, surface-analysis and snow layers. The readout stays fixed in the screen’s lower-left corner and is covered when the sidebar opens. In the camera/export controls, **Include coordinates, elevation and color keys** adds these details to the saved image’s lower-left corner; the choice is remembered. The location is frozen when area selection starts, and a selection-center reading is used if no cursor location has been chosen.
