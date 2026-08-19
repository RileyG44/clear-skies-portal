# Satellite Imagery Portal — Work Queue

**File:** `TODO.md` — lives at `C:\Users\CTR3\Downloads\satportal\TODO.md` and in the Claude project as `claude/TODO.md`.

**How to use:** say *"check the TODO"* or *"next item from the TODO"* and I'll read this file instead of us re-deriving it in conversation. Say *"add X to the TODO"* or *"mark X done"* and I'll edit it in place.

Priorities below marked **[proposed]** are my suggestion, not your decision — reorder freely.
Last updated: 2026-08-18

---

## P0 — Next up

- [ ] **CDSE Sentinel Hub instance** — *in progress (you).* Register at dataspace.copernicus.eu → Sentinel Hub dashboard at `shapps.dataspace.copernicus.eu/dashboard` → Configuration Utility → create a configuration → add layers (`S1-VV`, `S2-TRUE`, `S2-NDSI`, `LS-TRUE`) → send me the instance ID. Wires in as `https://sh.dataspace.copernicus.eu/ogc/wmts/<INSTANCE_ID>`, no OAuth needed for tiles. Unlocks Sentinel-1 rendering and arbitrary band math (1 PU per 512×512 tile, 10k/month free — use as a specialist layer, not the default).

## Done

- [x] **Default to a daylight true-colour scene** (2026-08-18) — the old auto-pick fell through to radar and then night-lights when no sharp natural-colour scene passed its filter, which is why the map sometimes opened black. Now there's an explicit `isPhoto` test (true-colour, daylight, drawable) and a tiered `bestPhoto`: newest under 20% cloud → under 50% → any sharp → coarse true-colour. It **never** auto-selects SAR, night lights, false colour or terrain; if there's no photo it says so rather than opening something unreadable. New **Open on natural colour** toggle in Filters (on by default) to force or release the behaviour, and the Overview rows are now clickable — "Best photo" jumps straight to it. Verified at Rainier: picks Sentinel-2 at 4% cloud over a Sentinel-1 pass that was 18 h newer.
- [x] **WA lidar now composites every covering project** (2026-08-18) — the "only a third of the tiles load" bug. It rendered `waCover[0]` only, i.e. the single newest project; Crab Creek is covered by **four** (Adams County 2024, Grant/Douglas/Okanogan 2022, Columbia Valley FEMA South 2020, Pasco Basin 2020). Now all of them composite, newest first, capped at 14. Each WA raster layer publishes an EPSG:3857 extent, so each tile only requests the projects that actually overlap it. Measured on a 20-tile view: coverage 13% (1 layer) → 42% (2) → **60% (4)**, with wall time essentially unchanged — the service, not the layer count, is the bottleneck. Concurrency 6→10 and tile timeout 12s→18s: 24.5s → **18.6s cold, 0.1s cached**.
- [x] **Sidebar right gutter** (2026-08-18) — the terrain pane body had no horizontal padding at all. All panes now share a consistent right gutter; right-aligned text sits 19px from the edge instead of ~4px.

- [x] **Fixed terrain tiles vanishing on pan** (2026-08-18) — the real cause of "loads, then disappears, then reloads". Every `moveend` re-ran the coverage check, which rebuilt the tile layer, which threw away every tile Leaflet had already loaded. Now the layer is only rebuilt when the chosen source/project/style actually changes; otherwise Leaflet keeps its tiles. Also added `keepBuffer:4` (tiles just off-screen survive a pan), `updateWhenZooming:false`, a transparent `errorTileUrl`, and coverage re-queries are skipped while the view stays inside the last queried box. Verified: same layer object across three pans, tile count grows 20 → 29 → 40 instead of resetting to 0.
- [x] **Area pre-cache + 3DEP through the proxy** (2026-08-18) — `Cache this area` button in the Terrain pane with a +1/+2/+3 zoom-depth selector, a live progress bar, and a 6,000-tile guard. `GET /api/3dep` now proxies and caches terrain tiles too, so a cached area works with **no network at all**. Measured on your machine: 3DEP tile **343 ms cold → 55 ms cached**; WA DNR **239 ms → 123 ms**. Endpoints: `POST /api/warm`, `GET /api/warm/status`, `GET /api/warm/stop`.

- [x] **Lidar terrain, both sources** (2026-08-18) — new *Terrain · lidar* pane. Layers: hillshade, multi-directional hillshade, elevation-tinted, slope, aspect, and 2/5/10/25 ft contours. Source selector is **Best available / USGS 3DEP / WA DNR**.
  - *Best available* prefers WA DNR's native-resolution bare-earth hillshade for the newest project covering the view, and always draws **3DEP underneath** so WA's per-project gaps never read as holes.
  - Project targeting is exact: WA MapServer raster layers are named `<datasetId>h`, so `/query` results map straight onto renderable layer ids (dataset 126 → layer 418). No name guessing.
  - The pane names the project and flight year in use and lists every lidar project flown over the view.
- [x] **Local caching proxy** (`server.js`, 2026-08-18) — the app is now served by a small Node server with an on-disk cache in `.cache/`:
  - `POST /api/wadnr/query` · `GET /api/wadnr/layers` · `GET /api/wadnr/export` · `GET /api/firms` · `GET /api/health`
  - 90-day TTL on lidar tiles (they never change), 10-minute negative cache so a slow tile backs off instead of being retried forever, 12 s tile timeout, max 4 concurrent upstream requests (WA DNR 504s under load).
  - Measured on your machine: lidar tile **239 ms cold → 123 ms cached**; coverage query 2.4 s cold → ~2 ms cached.
  - **`/api/firms` is live** — the FIRMS blocker in P4 is now just wiring the client to it.

- [x] **Scrollbar styling fixed** (2026-08-18) — the custom scrollbar targeted `#results`, but after the pane rebuild `.pane-b` became the scrolling element, so it fell back to the OS default. Now applied to every scroll surface (`.pane-b`, `#panes`, `#ac`, `#menu`, `#results`) with a Firefox `scrollbar-color` fallback.
- [x] **Configurable sidebar panes** (2026-08-18) — Filters / Overview / Next overpass / Scenes are each collapsible (click header), resizable (drag bottom edge, double-click to release), and reorderable (drag header). Layout persists in `localStorage` under `clearskies.panes.v1`; "Reset panel layout" in the footer restores defaults. Panes now shrink rather than overflow, and Scenes holds a 240px floor so it can never be buried. Filters starts collapsed by default.
- [x] **Filter menu rebuilt** (2026-08-18) — two-column label/control grid instead of an inline wrapping row; toggles moved to their own group below a divider.
- [x] **Renamed to Clear Skies Portal** (2026-08-18).

- [x] **Mosaic made opt-in** (2026-08-18) — `auto-fill surroundings` now defaults off; a **Fill surroundings** button in the overlay panel does a one-shot fill for the current view without re-running on every pan.
- [x] **UI restyle to Beautiful UI tokens** (2026-08-18) — adopted the dark-theme token set from beautifului.dev (MIT, by Turbo): oklch palette, Inter, 10/8/6px radii, layered hairline shadows, tinted status chips. Hand-written CSS, since that library ships React/Tailwind and this page has no build step.

---

## P1 — High value, ready to build [proposed]


- [ ] **Deep-link / shareable URL state.** Encode lat/lon, zoom, filters and selected scene in the hash so a view can be bookmarked or reopened. Also enables browser back/forward between scenes. Small, and everything else benefits from it.
- [ ] **Swipe / split compare.** Two scenes side by side with a draggable divider, or A/B toggle on a keypress. The single most requested capability in any imagery viewer, and the natural companion to the existing date list.
- [ ] **Date stepping keyboard shortcuts.** `[` / `]` to move to the previous/next scene in the current source without touching the list.
- [ ] **Saved locations.** Named bookmarks in `localStorage` (works on localhost; would need care if ever hosted as an artifact).

## P2 — Coverage & data quality [proposed]

- [ ] **Fix "no map tiles" items.** Earth Search `sentinel-1-grd` and `landsat-c2-l2` expose no single composited RGB asset, so they list but can't render. Options: (a) silently substitute the Planetary Computer twin of the same scene, (b) build an RGB via titiler band-math params, (c) hide them behind the map-viewable filter by default.
- [ ] **CDSE tile rendering.** Copernicus items are catalog-only because Sentinel Hub needs OAuth. Adding an optional CDSE client-id/secret field would light up on-the-fly rendering of any band combination, at 10k processing units/month.
- [ ] **National aerial orthophoto routing.** NAIP is in. The best-resolution imagery for a given country often comes from its national program — see `source-catalog.md` §4 for the endpoint table (IGN France 20 cm, PDOK Netherlands 7.5 cm, swisstopo 10 cm, LINZ NZ, GSI Japan, Kartverket Norway). Needs a country→provider lookup.
- [ ] **Coverage-gap indicator.** When the mosaic can't fill part of the viewport, outline the hole rather than leaving ambiguous dark space.
- [ ] **Interpretation legend.** Short "what am I looking at" note per visual type — SAR brightness ≠ optical brightness, false-colour band meanings, night-lights radiance scale.

## P3 — Analysis features (ported from `trailcheck.py`) [proposed]

- [ ] **Snow line readout.** NDSI from Sentinel-2 B03/B11 draped over the DEM, reported as an elevation in feet. Already working as a standalone script; needs a browser port (band math client-side, or precomputed server-side).
- [ ] **GPX route overlay.** Drop a track on the map; report what fraction sits above the snow line and where it crosses.
- [ ] **Multi-year same-date comparison.** "Is this season early or late" — same location, same calendar week, back 8 years. Nothing off-the-shelf answers this.
- [ ] **SNOTEL ground truth.** Nearest station's current snow depth / SWE as a map pin. Keyless: `https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1`.

## P4 — Later / deferred

- [ ] **FIRMS active-fire hotspots.** *(Deferred by request — 2026-08-18. **Proxy blocker now removed**: `GET /api/firms?sat=J1|J2|SV` is live in `server.js` with a 20-minute cache. All that remains is drawing the points client-side.)* Global VIIRS/MODIS thermal detections, ~60 s latency at best. **Blocker: FIRMS serves no CORS header**, so the browser cannot fetch it directly. Two paths:
  1. Add a `/firms` proxy route to `server.js` (~15 lines) that fetches server-side and re-serves with `Access-Control-Allow-Origin`. Keyless option: the 24 h regional CSV at `https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_USA_contiguous_and_Hawaii_24h.csv` (verified working, ~3,600 rows/day).
  2. Free MAP_KEY from `https://firms.modaps.eosdis.nasa.gov/api/map_key/` for the global area API, still proxied.
  Note: the current NIFC/WFIGS fire layer already covers the US with official perimeters and containment %, which is better for trip planning. FIRMS adds global coverage and much lower latency.
- [ ] **Self-host or replace titiler.xyz.** Earth Search COG rendering currently depends on a public demo tiler with no SLA. Fine personally; would rate-limit under load.
- [ ] **Offline / cached tiles** for a planned trip area.
- [ ] **Sentinel-2 cloud masking** using the SCL band, so partially-cloudy scenes can still be used where clear.

---

## Known limitations (accepted, not bugs)

- **Planetary Computer dependency** — *(corrected 2026-08-18: no deprecation exists.)* The free public STAC is healthy and Planetary Computer Pro is a separate Azure product for hosting **your own** private geospatial data, not a paywall on the public catalog. The real risk is concentration, not policy: PC is currently the **only** renderer for Sentinel-1, Landsat, HLS, ASTER and NAIP tiles, because Earth Search publishes no composited RGB asset for those. If PC went down, the map loses everything except Sentinel-2 and GIBS. Mitigation is the P2 "no map tiles" item.
- **Earth Search** — explicitly best-effort, no SLA.
- **NISAR** — sparse spatial coverage; public archive starts Oct 2025 (beta) / Jun 2026 (provisional). The GIBS render layer lags the ASF catalog by a few days, so recent granules may list without tiles.
- **Pass prediction** — derived from observed acquisition history, so it needs ≥2 past passes on the same ground track. Sparse-coverage areas show nothing. Verified accurate: it recovers 10.0-day Sentinel-2, 12.0-day Sentinel-1, 16.0-day Landsat cycles.
- **Black Marble** is a 2016 composite, not current; the VIIRS day/night band layers are the current ones.
- **Geolocation** needs a secure context — works on `localhost:8765`, not from `file://`.
- **OSM tile server** must never be used as a basemap (policy violation, returns HTTP 418). CARTO is the correct choice.

## Reference files

- `lidar-research.md` — lidar sources, verified endpoints, coverage gaps, integration plan

- `source-catalog.md` — ~50 free imagery sources, tiered, with endpoints and licences
- `sources.json` — machine-readable version of the above
- `hiking-stack.md` — the Western US subset: snow, fire, route-finding
- `trailcheck.py` — working snow line + fire + SNOTEL script
- `server.js` — local server on port 8765: static files + caching proxy for WA DNR lidar and FIRMS
