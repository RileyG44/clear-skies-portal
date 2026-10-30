# Washington detail coverage and automatic gap downloads

Task: Riley's missed-USGS-data and automatic-DNR instruction, actual message
1923 in the continuing iPhone detail repair. Governing supplements: accepted
CR-013 r1 and CR-014 r1; SPEC.md 0.1.0-draft remains unapproved. Affected IDs:
U-03, CAP-04, DATA-01/03/04/05/06, RENDER-01/03, UX-02/03 and bounded D-06.
Shipping relies on Riley's actual message 229: “Push all of the fixes, update
the Dell, push the TestFlight update, and merge the fix into main on GitHub.”

## What the audit establishes

The previous 32,138 km² absence claim was too strong and used an overview scan
that undercounted valid pixels. The corrected 100 m EPSG:5070 grid estimates:

- Washington cartographic land mask: 175,332.16 km².
- Valid standard 1 m pixels in the prior app's WA projects: 143,788.62 km².
- Additional valid standard 1 m pixels under OR_, ID_ and Elwha_ names:
  382.94 km² in Washington. The wider discovery also adds Oregon/Idaho detail.
- Remaining **standard-product** gap: approximately 31,160.60 km² (17.8%).

This is an approximate overview-derived estimate, not proof that fine federal
data is absent at every point. All 3,132 standard TIFFs intersecting WA land
were scanned at overview resolution. Older one_meter files need their 1/16
overview; a blank 1/32 overview had incorrectly counted useful land as absent.
Census 2023 500k cartographic land boundaries define the denominator. A
USGS generalized footprint failed known covered controls (including Island
County), so catalog footprints were not accepted as pixel proof.

The alternate-link investigation included S3 project prefixes outside WA_, TNM
OPR/topobathy queries, WESM work units, legacy 1 m ImageServer samples and
coarser products. A ten-point OPR recheck found nine points already covered by
the corrected standard scan. Elwha remained a real numeric gap; this update
adds its verified 392-file OPR survey. A second Elwha point was independently
confirmed. This does not constitute a complete statewide OPR pixel audit.
Legacy Mount Adams ImageServer data also answered valid 1 m despite staged S3
links returning 404; this change adds no new legacy ImageServer adapter.

Of 300 random points, 289 remained gaps after correcting the standard scan.
DNR returned DTM candidates at 217 of those (75%). The other 72 sampled points
were on Colville or Yakama Nation land. Candidate availability does not prove
complete numeric DNR coverage or permission to infer it across a reservation.
No claim that all remaining gaps can be filled is supported.

## Where the standard-product gaps are

Values below use the corrected raster grid, clipped to county land masks.
They include places where OPR, a legacy endpoint, DNR or coarser federal ground
may exist. Full county results are in [counties.json](wa-coverage-2026-10-29/counties.json).

| County | Approximate standard gap, km² | Share of county land |
|---|---:|---:|
| Yakima County | 5,095 | 45.6% |
| Ferry County | 2,718 | 46.5% |
| Okanogan County | 2,598 | 18.9% |
| Whatcom County | 2,594 | 46.2% |
| Pierce County | 2,333 | 53.1% |
| Jefferson County | 2,112 | 44.7% |
| Lewis County | 2,079 | 33.0% |
| Klickitat County | 1,767 | 35.8% |
| Snohomish County | 1,674 | 30.6% |
| Clallam County | 1,622 | 35.4% |
| Skagit County | 1,452 | 31.9% |
| Asotin County | 1,306 | 78.8% |

Named areas investigated include Mount Rainier (Paradise/Longmire/Sunrise),
Olympic high country and coast, Mount Adams/Trout Lake, and the Columbia Gorge
patch at 45.97929,-121.14818. DNR catalog candidates exist at these locations;
actual downloads and numeric pixels, rather than their bounding boxes, decide
what renders. The reported Gorge patch's current standard files have nodata;
DNR's published hillshade contains detail. Earlier PR #47 restored that
published hillshade. This change adds automatic acquisition of numeric DNR
so adjustable lighting and analytical styles can use its elevations too.

## Implemented behavior

Default federal discovery is WA_,OR_,ID_,Elwha_ (explicit CSP_USGS_STATES wins).
A narrow cached index keeps serving while bounded background listings add
projects. Failed listings remain provisional. Both old negatives and old
positive bodies are refreshed under a coverage version; useful saved numeric
bytes can be returned as uncached provisional fallback if the refresh fails.
This avoids keeping old partial tiles indefinitely and preserves retryability.

Only the verified Elwha OPR prefix is added, after all standard candidates.
Cached valid DNR stays preferred in Best available. Explicit National excludes
OPR and DNR. Original keys, actual contributing sources, native 1 m spacing,
separate display sampling, meter units, reference and processing limitations
are retained. Opened files with no contributing pixels are omitted.

Elwha metadata specifies NAD83(2011), NAVD88/GEOID12A and meters. TIFFs label
EPSG:26910, while WESM identifies horizontal EPSG:6339. The existing UTM
approximation is retained; no realization-aware transformation or accuracy
guarantee is claimed. Collection/modification spans 2014–2015 with differing
metadata dates. Missing delivered breaklines prevent standard certification.

The manifest is reproducible with scripts/verify-elwha-opr.py (rasterio
required). All 392 independently read headers match its actual bounds, sizes,
Float32 single-band 1 m grids and CRS. Source TIFFs total 487,350,073 bytes;
only headers and needed pixel ranges are fetched, not a full survey archive.
[Independent engine/reference samples](wa-coverage-2026-10-29/elwha-reference.json)
match bilinear rasterio within 0.3 mm at the two verified points. The nearest
source pixels differ because the engine uses bilinear interpolation at its
Mercator pixel centers; that difference is separate from survey accuracy and
Terrarium quantization (1/256 m). Failed standard reads remain retryable even
when OPR could fill the output completely.

Automatic DNR is off unless an engine advertises wadnr-auto with
CSP_DNR_AUTO=1. It waits for a settled Best available 2D terrain/elevation view
at zoom 15+, with no own pending/retrying tiles. Actual numeric rank 3/5
pixels establish gaps; published hillshade is not numeric coverage. A single
existing warm job acquires the clipped gap extent. Explicit USGS/National,
3D, captures and exports cannot trigger it. Automatic progress has Cancel;
explicit actions expose that Cancel instead of failing at “already running.”
Attempted boxes are not restarted in that session after cancel, failure or a
budget refusal. No offline-area records/outlines are created. Completion
refines the stationary view through the existing terrain replacement path.

DNR files may cost roughly 0.6–3 GB per new area even for a small viewport.
The existing 4,096-cell, 32-file, archive, time and disk-reserve bounds apply.
The Dell's intended cap is 300 GiB with an 8 GiB free-disk reserve. This is an
engine cache, not on-phone offline storage. At the initial read-only check the
Dell had about 414 GiB free, no archive and no active acquisition. Without an
archive it pauses at the cap rather than deleting data. The Mac remains off
by default. Roll back automatic acquisition by unsetting CSP_DNR_AUTO.

## Verification

- Node suite: 72 test files passing, including automatic gates, unknown versus
  confirmed nodata, canceled/failed attempt suppression, source choices,
  explicit actions during an automatic job, numeric versus image coverage,
  scope expansion/repair, partial-body refresh, failure recovery, standard
  priority, contributing-only OPR provenance and saved offline fallbacks.
- Static checks and all 13 iOS Python checks passed.
- Live all-header validation: 392 files, 487,350,073 source bytes.
- Independent rasterio/engine samples: both Elwha gaps plus outside control.
- Actual iPhone 17 Pro simulator: settled Gorge gap started one automatic job;
  progress sat at CSS y=126 with Cancel accessible. It fetched/ingested one
  817,366,653-byte raster. A later provider metadata request timed out; the
  error stayed visible and the attempt did not restart. A stationary cached
  view then used 100% numeric DNR from Gorge East Wali 2022 (DTM 1699), with
  zero new POSTs. No explicit offline-area record was created.
- npm run verify passed all checks and found zero vulnerabilities. The HTTP
  warm-job fixture was corrected to avoid accidental live metadata requests.
- Release archive build 29888771: all 145 site files match the separately
  assembled/minified artifact, visible build 2026-10-29f.
- Final bundled simulator: the Elwha view reached 100% federal numeric
  detail, reported the OPR survey and reference limitations, and issued zero
  download POSTs. The reservation control issued zero POSTs and retained
  national/overview ground, but lower-source retries were still active, so
  this does not independently establish the no-survey trigger behavior. The
  deterministic no-survey/cap/reserve controls pass. Physical provider errors
  and the partial live warm-job failure above remain disclosed limitations.
- Internal-only TestFlight upload of 29888771 succeeded; Apple reported the
  package processing. Dell deployment and Pages results are in PR #48.

Physical iPhone timing, statewide source completeness and provider throughput
are not established by unit or simulator checks. Existing baseline/performance,
scientific and paid-release gates remain unchanged.
