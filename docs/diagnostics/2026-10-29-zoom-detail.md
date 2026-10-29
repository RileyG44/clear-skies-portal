# Zoom detail investigation, 2026-10-29

Scope: follow-up to the cached-DNR and iPhone progress repair in PR #46,
including Riley's IMG_2959 persistent sharp/blurry boundary. This is evidence,
not a specification change. SPEC.md 0.1.0-draft remains unapproved; CR-001 and
accepted CR-011 r1 govern the bounded source/progress implementation. Existing
ENGINEERING_REVIEW loading and scientific contracts still apply.

## The screenshot boundary is a source gap

The screenshot's selected coordinate is 45.97929,-121.14818. The Dell's complete
26-project USGS index identifies two candidates in zone 10, cell x64y510:

| USGS project | Native spacing | Native value at selected point |
| --- | --- | --- |
| WA_FEMAHQ_2018_D18 | 1 m | -999999, declared nodata |
| WA_Mount_Adams_LiDAR_2016_D16 | 1 m | -999999, declared nodata |

Read both public S3 COGs independently with GDAL through rasterio, in addition
to the application's own range reader. Both agree on CRS EPSG:26910, 1 m
transform and nodata. Each has zero valid samples in a 500 x 500 m window
around the point. The National Map product API lists the same FEMA raster.
The public S3 project listing agrees with the engine's Washington roster.

The real iOS 26 simulator reproduces the diagonal boundary and a horizontal
survey edge in this vicinity. At z16.5 the settled viewport contains 1,579,948
USGS-rank samples and 3,925,076 national-rank samples, with zero pending/failed
requests. At a closer z17.8 view within the hole, the settled display is entirely
national elevation. These are display sample counts, not native source spacing
or accuracy. A successful request or survey bounding box does not establish
valid elevation coverage.

DNR's catalogue lists Gorge East Wali 2022 and other candidate surveys nearby.
Their footprints alone do not establish valid pixels. Neither of the Dell's
two cached DNR rasters covers this location. No DNR acquisition was initiated
to diagnose it; browsing remains cache-only. A user-selected DNR download is
needed before this app can use additional DNR rasters here. A retry fix alone
does not remove genuine holes from the federal source.

Raw evidence under `/tmp/csp-dnr-finish/`: `stuck-baseline.json`,
`stuck-wide.json`, `stuck-native-sources.json`, `stuck-rasterio.json`,
`stuck-dnr-coverage.json`, `tnm-point.json`, `all-projects.xml` and
`stuck-survey-boundary.png`. Diagnostic COG reads used a separate local cache,
not changes to the live Dell cache.

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
