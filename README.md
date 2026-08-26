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

`server.js` is the optional local terrain engine. It is required for providers
that do not allow browser requests (WA DNR, Macrostrat, and SNODAS), for rendering
raw USGS 1 m DEMs, and for resumable offline-area downloads. When the page itself
comes from `server.js` or Electron, it connects automatically.

Raw 1 m DEM discovery defaults to Washington so a fresh launch indexes tens of
projects instead of the entire national archive. National rendered 3DEP still works
everywhere. Set `CSP_USGS_STATES=ALL` before starting the engine for nationwide raw
1 m discovery, or use a regional list such as `CSP_USGS_STATES=WA_,OR_,ID_`.

Tailscale is **not required** for normal local or desktop use. It is only a secure
bridge when the hosted Pages app on another device needs to reach the terrain
engine running on your Mac. On macOS, run this once from the checkout:

```
scripts/install-mac-service.sh
tailscale serve --bg 8765
```

The installer keeps the engine alive as your user, restarts it after a failed
health check, stores its runtime and cache under `~/Library/Application Support/
ClearSkiesPortal`, and binds it only to `127.0.0.1`. Tailscale Serve is therefore
the sole network bridge and remains tailnet-authenticated; do not use Funnel for
this private analysis service. Check the bridge with `tailscale serve status`.

On the hosted page, paste the shown Tailscale HTTPS URL in *Secure terrain engine*
and choose **Connect**. **Copy private setup link** gives another signed-in
Tailscale device a one-time `#engine=` setup link: the fragment is not sent to
GitHub Pages, and the page only saves the engine after validating it. The browser
cannot safely start software on a different Mac, so the installed local service
provides the practical one-click behaviour by starting and self-healing before any
device connects. Cross-origin access defaults to this repository's GitHub Pages
origin. Add other trusted origins explicitly with a comma-separated
`CSP_CORS_ORIGINS` environment variable.

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

## Export a map image

Use the camera button beside the map-panel toggle. It opens a direct **PNG** exporter;
it never asks macOS to capture a window, screen, or browser tab. On desktop the finished
file is downloaded to the browser's Downloads folder. On touch devices the system share
sheet is used when the browser supports sharing files.

The exporter preserves the exact geographic extent currently visible on the map and
offers three output sizes:

- **Screen** uses the current display density and current source zoom.
- **Detail** doubles each output dimension and requests one additional source-tile zoom.
- **Archive** quadruples each output dimension and requests two additional source-tile
  zooms, bounded to 24 megapixels, an 8,192-pixel edge, and 720 source-tile requests.

The panel states the resulting pixel dimensions, megapixels, and source-tile count
before anything is downloaded. Higher modes obtain actual smaller-area source tiles for
ordinary tiled imagery, basemaps, and reference layers whenever the provider publishes
them. If a source ends at a lower native zoom, it is enlarged honestly rather than
inventing detail. Vector overlays remain sharp; locally rendered canvas/WebGL terrain
and elevation layers are included at their currently rendered viewport resolution.

A PNG is still a finite raster image: you can zoom into it until you reach the chosen
pixel resolution, not indefinitely. A future research-grade export for continued
map-like zoom would be a tiled package or Cloud-Optimized GeoTIFF rather than one PNG.

## What's in the box

| File | What it is |
|---|---|
| `index.html` | The whole app — one self-contained file, Leaflet inlined |
| `vendor/` | Pinned browser bundles for MapLibre GL JS and Leaflet rotation |
| `terrain-raster.js` | Shared deterministic CPU terrain styling used by 2D, 3D protocol tiles, and tests |
| `mosaic-core.js` | Tested footprint geometry, antimeridian, identity, coverage and imagery LOD helpers |
| `server.js` | Local terrain engine: static files, validated proxying, request coalescing, retries and disk cache |
| `scripts/install-mac-service.sh` | Installs a loopback-only, self-healing macOS terrain-engine service |
| `SOL_HIGH_IMPLEMENTATION_HANDOFF.md` | Detailed implementation plan for the remaining lidar, landscape, geology, sidebar, persistence and imagery work |
| `test-server.js` | Offline black-box checks for CORS, request limits, traversal protection and server health |
| `version.js` | One build identifier shared by the page and service worker cache |
| `TODO.md` | Work queue. Say "check the TODO" to a fresh Claude session and it picks up from there |
| `THREE_D_TERRAIN.md` | 2D rotation, 3D terrain, lighting architecture, limitations, and QA handoff |
| `source-catalog.md` | ~50 free imagery sources with endpoints, licences, resolutions |
| `sources.json` | Machine-readable version of the catalog |
| `hiking-stack.md` | The Western-US subset: snow, fire, route-finding |
| `lidar-research.md` | Lidar sources, verified endpoints, coverage gaps |
| `trailcheck.py` | Standalone: snow line from Sentinel-2 NDSI + fire + SNOTEL |
| `snowline.py` | Earlier snow-line-only version |
| `probe.py` | Tiny script that reports scene freshness at a few test points |
| `cog.js` | COG/GeoTIFF reader — TIFF LZW + floating-point predictor, geodesy. No dependencies |
| `usgs.js` | USGS 3DEP 1 m DEM source: S3 index, range reads, terrain rendering, PNG encoder |
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
- **Open on natural colour** (Filters, on by default) keeps the map from landing on a
  radar or night-lights scene just because it happens to be the newest.
- **Time window** (Filters) takes either a preset — last 14/30/90 days, last year,
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
