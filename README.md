# Clear Skies Portal

A local web app that finds the most recent satellite imagery for any location on Earth,
plus lidar terrain. Everything it uses is free and needs no API key.

## Run it

```
node server.js
```

Then open **http://localhost:8765**

Node 22+ is all you need — no `npm install`, no dependencies.
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

## Develop it

```
npm start          # same as `node server.js`
npm run check      # syntax-check the server
pip install -r requirements.txt
```

There is no build step and no runtime dependency — `npm` here is a task runner and a
place to declare `engines`, nothing more. CI (`.github/workflows/ci.yml`) syntax-checks
`server.js` and the Python scripts, validates `sources.json`, and boots the server to
confirm `/api/health` answers.

## What's in the box

| File | What it is |
|---|---|
| `index.html` | The whole app — one self-contained file, Leaflet inlined |
| `server.js` | Local server: static files + caching proxy for WA DNR lidar and NASA FIRMS |
| `TODO.md` | Work queue. Say "check the TODO" to a fresh Claude session and it picks up from there |
| `source-catalog.md` | ~50 free imagery sources with endpoints, licences, resolutions |
| `sources.json` | Machine-readable version of the catalog |
| `hiking-stack.md` | The Western-US subset: snow, fire, route-finding |
| `lidar-research.md` | Lidar sources, verified endpoints, coverage gaps |
| `trailcheck.py` | Standalone: snow line from Sentinel-2 NDSI + fire + SNOTEL |
| `snowline.py` | Earlier snow-line-only version |
| `probe.py` | Tiny script that reports scene freshness at a few test points |
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

*Best available* picks WA DNR where it exists and 3DEP everywhere else.

## Things worth knowing

- **Download this view** (Terrain pane) pre-downloads terrain tiles for the current
  view, so the area then works with **no network at all** — the point at a trailhead.
  WA DNR is slow cold (around 19 s for a 20-tile view) and instant once cached.
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
