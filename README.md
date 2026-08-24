# Clear Skies Portal

A local web app that finds the most recent satellite imagery for any location on Earth,
plus lidar terrain. Everything it uses is free and needs no API key.

## Run it

```
node server.js
```

Then open **http://localhost:8765**

Node 22.12+ is all you need — no `npm install` and no runtime dependencies.
Leave the terminal open; it's the server *and* the cache.

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

There is no build step and no runtime dependency — `npm` here is a task runner and a
place to declare `engines`, nothing more. CI (`.github/workflows/ci.yml`) syntax-checks
`server.js` and the Python scripts, validates `sources.json`, and boots the server to
confirm `/api/health` answers.

## Save a map snapshot

Use the camera button beside the map-panel toggle. Choose **This Tab** in the browser's
capture prompt and the portal downloads a PNG of the live map viewport, including its
currently rendered imagery, terrain, and overlays. Browsers without tab capture open
their print dialog instead, where the same viewport can be saved as a PDF.

## What's in the box

| File | What it is |
|---|---|
| `index.html` | The whole app — one self-contained file, Leaflet inlined |
| `mosaic-core.js` | Tested footprint geometry, antimeridian, identity, coverage and imagery LOD helpers |
| `server.js` | Local terrain engine: static files, validated proxying, request coalescing, retries and disk cache |
| `scripts/install-mac-service.sh` | Installs a loopback-only, self-healing macOS terrain-engine service |
| `SOL_HIGH_IMPLEMENTATION_HANDOFF.md` | Detailed implementation plan for the remaining lidar, landscape, geology, sidebar, persistence and imagery work |
| `test-server.js` | Offline black-box checks for CORS, request limits, traversal protection and server health |
| `version.js` | One build identifier shared by the page and service worker cache |
| `TODO.md` | Work queue. Say "check the TODO" to a fresh Claude session and it picks up from there |
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
  with 3DEP underneath so nothing is left blank.

- **USGS 1 m (offline-capable)** — 3DEP's staged 1 m DEMs, read straight off S3
  as Cloud-Optimised GeoTIFFs. This is the only source that hands over *elevation*
  rather than a picture of it, so hillshade, slope, aspect and contours are all
  computed locally, at any zoom, with no upsampling artefacts — and it is the only
  one that survives with the network off. 25 Washington projects, ~2,548 tiles,
  ~474 GiB (against 53 TiB for the WA DNR archive). Coverage is real but partial:
  **Mount Rainier National Park is a genuine gap**, which is why WA DNR stays.

- **Elevation spectrum** — the geology overlay reads real elevation values, not
  a pre-coloured image. It uses raw USGS 1 m lidar where that archive covers a
  tile, then automatically falls back to the national 3DEP Float32 elevation
  service. The chosen height is white, lower ground grades red, and higher
  ground grades blue; the panel states which source is serving the current view.

*Best available* prefers WA DNR where it has data — 345 projects to USGS's 25, and
some resolving finer than 1 m — then USGS 1 m, then 3DEP. 3DEP always draws
underneath, so a project edge never reads as a hole.

## Labels & overlays

Reference layers drawn over whatever imagery is selected, each independently
toggleable, with a shared opacity slider. All keyless.

| Overlay | Source |
|---|---|
| Roads & streets | Esri World Transportation |
| Cities & boundaries | Esri World Boundaries and Places |
| Place labels | CARTO (OSM-derived) |
| Rivers & lakes | USGS National Hydrography Dataset |
| Peaks & landforms | USGS GNIS — summits, ridges, gaps, glaciers (zoom 10+) |
| Named places | USGS GNIS populated places (zoom 9+) |
| **Bedrock geology** | Macrostrat (proxied — sends no CORS; zoom ≤16) |
| **State geologic map** | USGS SGMC via Mineral Resources (zoom ≤14) |
| **Snow depth (today)** | NOAA NOHRSC SNODAS (proxied; zoom ≤14) |
| **Snow water equivalent** | NOAA NOHRSC SNODAS (proxied; zoom ≤14) |
| **Snow cover** | NASA GIBS MODIS Terra NDSI (zoom ≤8) |

Not OpenStreetMap's own tiles: their tile-usage policy forbids this use and the
server answers HTTP 418. CARTO and Esri's free reference layers are the correct
substitutes.

The two geology layers carry their own default opacity (55%) because they are
opaque polygon fills rather than line work; the shared slider scales them
instead of overriding. Macrostrat sends no CORS header, so it routes through
`/api/geo/macrostrat/...` and is cached for 30 days — bedrock is not news.

Snow depth and SWE are NOHRSC's SNODAS assimilation — *current conditions* for
all of CONUS, re-run daily, so there is no cloud problem and no revisit gap.
MODIS NDSI is the satellite view beside it, which has both but sees the whole
world. NOHRSC sends no CORS either, so it routes through `/api/snow` with a
six-hour cache. A layer outside its zoom range says so, since drawing nothing
is otherwise indistinguishable from "there is no snow here".

## Things worth knowing

- **Download this view** (Terrain pane) pre-downloads terrain tiles for the current
  view, so the area then works with **no network at all** — the point at a trailhead.
  WA DNR generates uncached composites slowly; the engine deliberately limits
  concurrency so it finishes them instead of overwhelming ArcGIS. Tiles appear
  progressively over the always-visible 3DEP fallback and are instant once cached.
  - *Depth*: **Native lidar** (z18, 0.41 m/px) is the default and matches roughly what
    the sharper projects actually resolve; **Maximum** (z19, 0.20 m/px) and the old
    **Screen +2** are also there. Only the finest three zoom levels are fetched —
    coarser ones are cheap and already cached from browsing.
  - *Extent*: this view, +50% margin, or +a full screen of margin.
  - The estimate is shown before you commit — e.g. `z14–18 · 0.41 m/px · 4,957 tiles ·
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
- **Open on natural colour** (Filters, on by default) keeps the map from landing on a
  radar or night-lights scene just because it happens to be the newest.
- **Time window** (Filters) takes either a preset — last 14/30/90 days, last year,
  5 years, all time — or **Custom range…**, which reveals two date pickers for an
  explicit start and end (say 2025-07-01 → 2025-07-31). Leave one side empty for an
  open-ended range: only a start means "from then on", only an end means "up to then",
  both empty is all time. Quick buttons cover this month, last month, year to date and
  last calendar year. The active window shows on the Filters header even when collapsed.
  A named range is applied everywhere — including the GIBS daily layers, which are
  generated from the *end* of the range rather than today, and the *Fill surroundings*
  mosaic, so neighbouring scenes come from the same era rather than from last week.
- Sidebar panes collapse (click header), resize (drag bottom edge), and reorder
  (drag header). Layout persists. "Reset panel layout" in the footer.
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
