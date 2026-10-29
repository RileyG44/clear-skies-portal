# Zoom detail investigation, 2026-10-29

Scope: follow-up to PR #46 and Riley's IMG_2959 persistent sharp/blurry
boundary. This is implementation evidence. SPEC.md 0.1.0-draft remains
unapproved; accepted CR-001, CR-011 r1 and CR-012 r1 govern this repair.
ENGINEERING_REVIEW scientific/loading contracts remain in force.

## Available DNR imagery was omitted

The earlier conclusion that no high-resolution product covered this patch was
wrong. Riley confirmed that it had rendered sharply in Clear Skies before.
Federal elevation has a real gap here, but published WA DNR hillshade does not.
Auto had stopped selecting the app's retained published-image route. It chose
cached numeric DNR, then USGS and national elevation; neither of the two cached
DNR rasters covers this patch. Repeating or retrying those numeric requests
therefore left the patch coarse even though detailed DNR imagery was available.
The precise build Riley last saw sharply is unknown.

At screenshot marker **45.97929,-121.14818**, DNR MapServer layer **944**,
Gorge East Wali 2022, returns detailed hillshade and identify value **221**.
Direct 256- and 512-pixel exports visibly contain fine terrain. A catalog
footprint alone would not establish coverage; actual image/identify evidence
establishes this published product. Gray image values are not elevations.

The two indexed federal 1 m files really contain nodata at this point:

| Federal source | Independent result |
| --- | --- |
| WA_FEMAHQ_2018_D18 | -999999, declared nodata; no valid pixels in 500 m window |
| WA_Mount_Adams_LiDAR_2016_D16 | -999999, declared nodata; no valid pixels in 500 m window |
| National ImageServer, three cataloged 1 m items | Each identifies as NoData |
| Third legacy MountAdams file URL | HTTP 404; unavailable, not a verified file-content sample |

Rasterio/GDAL independently confirms the two current COGs' values, EPSG:26910
and 1 m transforms. National ImageServer's coarser elevation returns about
821.532 m. These facts explain the federal fallback; they do not establish
absence of DNR imagery. Numeric DNR analysis here still requires suitable
cached/user-downloaded elevation; ordinary hillshade can use the published
product immediately without acquiring a source archive.

## Repaired image selection and measured result

Build `2026-10-29e` restores published DNR only for Auto, close-view, ordinary
unmodified **2D hs**. One image tile composites valid cached numeric DNR above
published DNR and numeric USGS/national/overview below actual transparent
image pixels. Source percentages count actual contributions. Images remain
separate from numeric grids, readout, measurements, analytical/colored/modified
Studio styles, elevation spectrum and 3D. Explicit National/USGS choices stay
numeric. Source and lighting notes explain fixed provider lighting.

Same iPhone 17 Pro / iOS 26 simulator camera before and after:
center **45.9796901,-121.1442121**, zoom **15.5**, bearing 0. The actual Classic
preset is active, Auto, hs, 100% opacity. At 25 seconds without another pan,
build `d` displays 51% USGS and 49% national samples, reproducing the soft
patch. Build `e` displays 100% published DNR at this view, all 50 resident tiles
settled, none failed, and the formerly soft ground visibly sharp. These are
simulator display samples, not a physical-phone performance or native-spacing
claim. Nearby catalog projects are candidates; the mosaic does not identify
the supplying survey for each displayed pixel.

[Before screenshot](assets/2026-10-29-hillshade-before.png) ·
[After screenshot](assets/2026-10-29-hillshade-after.png).

Published requests share a four-slot pool with a 16 MiB decoded-image cache.
Transient errors retry while stationary with exponential backoff capped at
30 seconds; valid transparent PNGs are final absence. Numeric grids survive
retry, useful pixels remain visible, late numeric DNR keeps priority, departing
consumers cancel only their own work, and failed staging retains the old map.

Raw evidence: `/tmp/csp-detail-recheck/patch-before.json`, `patch-after.json`,
matching PNGs, `dnr-point-identify3.json`, `dnr-sharp-512.png`,
`national-point-query2.json`, `national-identify2.json`, and `dnr-mapserver.json`.
The earlier federal raster evidence remains in `/tmp/csp-dnr-finish/`:
`stuck-rasterio.json`, `tnm-point.json` and `all-projects.xml`. The earlier
unfiltered `national-point-catalog.json` is not used as query evidence.
Diagnosis did not mutate the live numeric DNR index or acquire/restore an archive.

## A distinct retry defect is repaired

An incomplete index deliberately returns a provisional result. The previous
engine translated that into HTTP 200, `X-Coverage:none`, `Cache-Control:no-store`.
The previous shared client treated it as confirmed absence and kept a 1 x 1
NaN tile in the resident store for the life of that source/view session. No
request remained eligible for retry, even after source discovery recovered.

Both raw elevation and styled USGS routes now return 503 / unknown / no-store
with Retry-After for provisional results. The shared elevation fetch helper
also recognizes the older engine's none/no-store response and rejects it.
The existing bounded retry path keeps useful fallback coverage and retries
while the camera is stationary. Genuine immutable USGS nodata stays final;
DNR cache-only misses keep their final no-store behavior.

`test-elevation-recovery.js` exercises the real shared request pool, fetch
helper, GPU adapter and elevation store, plus both engine routes. It verifies
automatic recovery without another want(), preservation of national data,
no poisoned decoded cache and no endless retry of genuine nodata. The test
fails on the previous client and passes on the repair.

The actual simulator comparison injects the older provisional response for
2.5 seconds, then permits real USGS elevation requests at the same Moses Lake
view. Build c remains 100% national at 20 s, with no recovery requests. Build d
reaches 100% USGS at 12 s without any further camera event, and has no pending
or failed work at 20 s. This is a controlled failure/recovery fixture, not a
claim about the cause of IMG_2959 or physical-phone latency.

Evidence: `provisional-before.json`, `provisional-after.json`, matching PNGs,
and `provisional-before-test.log` in the same scratch directory. All 68 Node
test files, static checks, 13 iOS Python checks and both simulator and Release
archive builds pass. Source/progress evidence and remaining scientific,
physical-device and offline-storage limits are recorded in CR-011.
