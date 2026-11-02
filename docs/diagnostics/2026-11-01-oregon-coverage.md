# Oregon resolution gap at 44.333599, -121.926842

Investigated on 2026-11-01, following the tile queue audit. Fix build:
`2026-11-01d`. Cycle 2 (PR #60) was merged and deployed as `2026-11-01c` before
this investigation; the installed Mac engine matched that merged source.

## Cause

The USGS index returns the 2021 McKenzie River 10 km cell at this coordinate.
That establishes a candidate file, not valid elevation at every pixel within
its bounding box. The file's 1 m block containing this point has 262,144 nodata
samples (`-999999`). An independent `geotiff` read of a 6×6 window around the
point also returned only nodata. Its coarse overview has the same hole. The
engine's raw elevation requests at z14, z16 and z18 correctly returned no cover;
the browser therefore used coarser national/overview terrain.

The USGS [product query](https://tnmaccess.nationalmap.gov/api/v1/products?datasets=Digital%20Elevation%20Model%20%28DEM%29%201%20meter&bbox=-121.926942,44.333499,-121.926742,44.333699&max=100)
returned that single DEM, with no LPC or OPR product at the point. This is a
source availability gap in the connected providers, separate from the settled
zoom and request backlog bugs fixed earlier.

Oregon DOGAMI has valid bare-earth elevation here. A primary-raster identify
locked to raster 96 returned 3977.22 feet (approximately 1212.26 metres).
The completed OLC project metadata identifies **Lane County 2014**, collected
September 7, 2013 through June 8, 2015, with **3-foot (0.9144 m) grid spacing**,
elevations in feet, NAD83(2011) horizontal reference and NAVD88/GEOID12A vertical
reference. Spacing is not an accuracy claim. The app had no numeric Oregon
provider connected.

Provider references:

- [Primary bare-earth mosaic](https://gis.dogami.oregon.gov/arcgis/rest/services/lidar/DIGITAL_TERRAIN_MODEL_MOSAIC/ImageServer)
- [Completed OLC project metadata](https://gis.dogami.oregon.gov/arcgis/rest/services/lidar/DOGAMI_Lidar_Project_Status/MapServer/1)

## Fix and loading behavior

Automatic terrain source selection now includes verified Oregon OLC numeric
rasters through a new engine endpoint. It is enabled only when the connected
engine advertises support, only in the Oregon region and only at detail zooms.
Explicit USGS/national selections retain their provider intent.

- Catalog queries exclude overview images. A survey must match a primary
  raster's name/year and provide confirmed 3-foot spacing and feet units.
  Raster ids and metadata ids are unrelated; coincident ids are not a match.
- The export locks the selected primary rasters and requests an unstyled F32
  elevation TIFF. The worker converts feet to metres before checking elevation
  limits and encoding Terrarium, preserving nodata transparency and high peaks.
- The source has separate labels, survey metadata and a quality rank in the
  GPU store, CPU fallback and 3D mesh. Late national/overview data fills holes
  without overwriting detail. Oregon numeric coverage suppresses published
  hillshade gap pictures. Where cached WA DNR is available at the boundary,
  its existing source priority is retained rather than replaced by Oregon.
- Browser and provider requests are bounded to two concurrent Oregon requests.
  Detail tiles share catalog discovery over z12 cells; rendered responses use
  the existing bounded RAM/disk caches. Existing shared-request cancellation
  applies to upstream queries, exports and worker conversion. Failures return
  retryable, uncached responses.

## Verification

- Live source checks: full numeric coverage at z14 and z18 plus a 3×3 grid
  around the point at z16. This covers the site and roughly a 1.3 km-wide
  neighbourhood, rather than assuming the whole project's bounding box is valid.
- Independent source checks: USGS nodata confirmed with `geotiff`; DOGAMI
  identify and a locked F32 TIFF export agree on available terrain.
- Offline regression: primary/overview separation, name matching, unknown unit
  rejection, exact feet conversion, valid 12,000-foot peaks, transparent nodata,
  retry/revisit behavior, catalog sharing, regional/zoom gating, CORS metadata,
  browser provenance, GPU detail gaps, CPU reversed responses and 3D selection.
- 21 relevant Node test files and `npm run check`.

[Recorded live evidence](assets/2026-11-01-oregon-coverage.json).
The recorded elapsed times are single live requests, not a speed benchmark.

## Limits and next audit inputs

Only OLC rasters whose metadata establishes the supported units, spacing and
survey identity are admitted. Other DOGAMI collections need their own metadata
validation. This does not establish complete Oregon coverage or add resolution
beyond the source grid. DOGAMI reprojects to Web Mercator; this adapter does not
perform an independent inter-survey datum transformation.

The mosaic exposes the selected candidate rasters, not each pixel's actual
contributor or capture date. Metadata explicitly records that limitation. A
z12 discovery cell may select candidates that contribute no pixels to a smaller
tile; coverage is always measured from the returned numeric pixels.

The next performance experiment, saved separately while this reported site was
prioritized, measured duplicate downloads across six cold worker threads.
Coordination and per-worker queue/latency telemetry remain follow-up work in the
requested audit loop; no cross-worker broker is included in this coverage fix.
