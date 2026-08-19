# Adding Lidar to Clear Skies Portal — research findings

**Date:** 18 August 2026 · Every endpoint below was probed live; results are quoted from actual responses.

---

## Summary

There are three separable things people mean by "lidar," and they have very different costs:

| What | Effort | Verdict |
|---|---|---|
| **Derived terrain rasters** — hillshade, slope, contours | **Low** — a tile layer, keyless, CORS-clean | **Do this first** |
| **Coverage metadata** — what was flown here, and when | Medium — needs a local proxy | Worth it in Washington |
| **Raw point clouds** — the actual returns | High — new renderer, ~GB per area | Defer |

The first one is a genuinely small change with a large payoff, and it works nationally rather than only in Washington.

---

## 1. USGS 3DEP ImageServer — the recommended integration

`https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer`

The national bare-earth DEM as a dynamic image service. **Verified: `Access-Control-Allow-Origin: *`**, no key, no account.

- **Resolution:** reports `pixelSize` 1.0 — multi-resolution, serving the best available data per location (1 m where lidar exists, 1/3 arc-second elsewhere)
- **Coverage:** national, including places the federal point-cloud bucket misses
- **Rendering rules** (server-side, pick per request):
  `Hillshade Gray` · `Hillshade Multidirectional` · `Hillshade Elevation Tinted` · `Slope Map` · `Slope Degrees` · `Aspect Map` · `Aspect Degrees` · **`Preset 2ft Contour Interval`** · `Preset 5ft` · `Preset 10ft` · `Contour 25` · `Contour Smoothed 25`

Those contour presets are the sleeper feature — 2 ft contours over a route is better terrain detail than most paper maps.

**Verified working as XYZ tiles.** ArcGIS wants a bbox, so each tile converts its z/x/y to Web Mercator metres. Live results at Mt Rainier:

```
z12 662/1443    -> 200 image/png 46635b
z14 2650/5772   -> 200 image/png 34694b
z16 10602/23090 -> 200 image/png 26629b
```

Leaflet integration is a ~15-line `L.TileLayer` subclass:

```js
const R = 20037508.342789244;
const ThreeDEP = L.TileLayer.extend({
  getTileUrl(c){
    const n = Math.pow(2, c.z), s = 2*R/n;
    const x0 = -R + c.x*s, y1 = R - c.y*s, x1 = x0 + s, y0 = y1 - s;
    const rr = encodeURIComponent(JSON.stringify({rasterFunction: this.options.rule}));
    return "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer"
         + `/exportImage?bbox=${x0},${y0},${x1},${y1}&bboxSR=3857&imageSR=3857`
         + `&size=256,256&format=png&transparent=true&f=image&renderingRule=${rr}`;
  }
});
// new ThreeDEP("", {rule:"Hillshade Gray", opacity:.55, maxZoom:17})
```

**Portal fit:** this is a *terrain* layer, not a dated scene, so it belongs as a persistent overlay toggle — hillshade under the imagery, contours over it — rather than as a row in the scene list. A small "Terrain" pane with layer + opacity would do it.

---

## 2. Washington Lidar Portal (WA DNR) — best local metadata

`https://lidarportal.dnr.wa.gov`

Undocumented but working JSON API, found by reading the portal's own `js/lidar.js`.

**Coverage query** — POST `/query` with a `geojson` form field. Live result for a box around Mt Rainier:

```
POST /query  ->  200, 15 datasets
  Rainier 2007 · DTM              4 files   3,129,102,234 bytes
  Rainier 2007 · DTM Hillshade    4 files     732,344,815
  Rainier 2012 · DSM              1 file      483,681,897
  Rainier 2012 · DTM              1 file      476,101,077
  Rainier 2012 · DTM Hillshade    1 file      129,407,729
  ...
```

That's exactly the "what lidar exists here and when was it flown" answer, with per-dataset download sizes.

**Downloads:** `GET /download?ids=<dataset_id>` for a whole project, or `GET /download?geojson=<geom>` for a custom clip.

**Hillshade service:** `.../arcgis/services/lidar/wadnr_hillshade/MapServer/WMSServer` — WMS 1.3.0, EPSG:3857/4326, PNG/JPEG/TIFF.

**⚠️ Two real obstacles:**

1. **No CORS header.** Verified — the browser cannot call this directly. It needs a `/wadnr` proxy route in `server.js`, the same pattern FIRMS needs. About 15 lines, and one route can serve both.
2. **The hillshade is not a mosaic.** The service advertises itself as a "statewide composite" but is actually **962 layers across 345 per-project groups** (`mason_county_refresh24_2025`, `tacoma_pud_riffe_lake_2025`, …). A full-extent `export` **timed out** in testing because it tries to draw all of them. Any integration must request specific project layers, which means querying coverage first, then rendering just those. That's real work — and it's why 3DEP is the better rendering source even inside Washington.

**Where WA DNR wins:** it has Mt Rainier. The federal point-cloud bucket does not (see below). It also carries project names and flight years, which 3DEP's blended mosaic hides.

---

## 3. Raw point clouds — USGS 3DEP EPT on AWS

`https://s3-us-west-2.amazonaws.com/usgs-lidar-public/<name>/ept.json` · **CORS `*` verified**

Entwine Point Tile format — a spatial index letting you stream a subset instead of downloading everything. Index of all datasets: [`hobuinc/usgs-lidar` boundaries GeoJSON](https://raw.githubusercontent.com/hobuinc/usgs-lidar/master/boundaries/resources.geojson) (8.7 MB, **2,277 datasets nationally, 30 in Washington**).

Sample dataset `WA_EasternCascades_1_2019`: **70,566,788,832 points**, EPSG:3857, full LAS schema including `Classification` (ground / vegetation / building).

**⚠️ Coverage is patchy, and the gaps are where you'd hike.** Point-in-polygon against the index:

```
Snoqualmie Pass    -> WA_EasternCascades_5_2019
Seattle            -> WA_KingCo_1_2021
Mt Adams           -> no EPT coverage
Rainier Paradise   -> no EPT coverage
```

National parks are largely absent from the public federal bucket, while WA DNR *does* hold Rainier. If point clouds ever matter here, the state portal is the source, not the federal one.

**Rendering cost is the real blocker.** Nothing in the current stack draws points — it would mean adding deck.gl (~200 KB) or Potree, plus a loader for EPT/COPC, plus a 3D camera. That's a different application, not a layer.

---

## 4. OpenTopography — dataset discovery

`https://portal.opentopography.org/API/otCatalog` · **CORS `*` verified**, keyless for catalog queries

Live query over Mt Rainier returned 2 point-cloud datasets:

```
Southwest Flank of Mt.Rainier, WA   (WA12_Legg)   2013-05-28
West Rainier Seismic Zone, WA       (Rainier)     2005-06-02
```

Includes academic and NCALM collections that never reach 3DEP. Good as a "what else exists here" lookup; actual downloads need a free API key.

---

## Recommended sequence

**Step 1 — 3DEP terrain overlays.** Hillshade, slope, and 2 ft contours as toggleable layers with an opacity slider, in a new Terrain pane. Keyless, CORS-clean, national, and already proven to tile correctly. This is a small, self-contained change and delivers most of the practical value.

**Step 2 — WA lidar coverage lookup.** Add the `/wadnr` proxy route, POST the current view to `/query`, and list what's available with flight year and download size, linking to `/download?ids=…`. Pairs naturally with the FIRMS proxy already parked in P4 — build the proxy once, use it twice.

**Step 3 — point clouds.** Only if you actually want 3D terrain inspection. Coverage gaps at Rainier and Adams undercut the case for hiking use, and it's a much larger build.

---

## Licensing

Not a constraint for personal use. 3DEP is USGS public domain; WA DNR lidar is state public data. If this ever became public-facing, both want attribution and WA DNR's terms should be re-read.

## Endpoints (verified 2026-08-18)

```
3DEP image service   https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer
  exportImage        /exportImage?bbox=&bboxSR=3857&imageSR=3857&size=256,256&format=png&f=image&renderingRule={"rasterFunction":"Hillshade Gray"}
  point elevation    https://epqs.nationalmap.gov/v1/json?x={lon}&y={lat}&units=Meters&wkid=4326
WA DNR coverage      POST https://lidarportal.dnr.wa.gov/query          (form field: geojson)   [no CORS]
WA DNR download      GET  https://lidarportal.dnr.wa.gov/download?ids=<id>  |  ?geojson=<geom>  [no CORS]
WA DNR hillshade WMS https://lidarportal.dnr.wa.gov/arcgis/services/lidar/wadnr_hillshade/MapServer/WMSServer
EPT index            https://raw.githubusercontent.com/hobuinc/usgs-lidar/master/boundaries/resources.geojson
EPT dataset          https://s3-us-west-2.amazonaws.com/usgs-lidar-public/<name>/ept.json
OpenTopography       https://portal.opentopography.org/API/otCatalog?productFormat=PointCloud&minx=&miny=&maxx=&maxy=&outputFormat=json
```
