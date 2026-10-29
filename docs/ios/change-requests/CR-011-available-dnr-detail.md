# CR-011 — prefer available WA DNR detail and expose download progress

Status: ACCEPTED
Request content revision: r1; binding SHA-256 recorded below after proposal text.
Author / task: coordinating Codex; finish Riley's missing-detail repair.
Current approved spec revision: SPEC.md 0.1.0-draft remains unapproved;
accepted CR-001–010 supplements apply. This request is a bounded supplement.
Affected requirement IDs: U-03/04, CAP-04/05/07/08/11/14, DATA-03/05/06,
RENDER-01/02/03/04, UX-02/03/04/05, D-06 (this preference only), CR-001 parity.
Type: permanent bounded source-selection and progress-placement change.

## Existing requirement and conflict

U-03: "Core experience: open map, select a layer, move/zoom to a place, and receive
the best appropriate available data without repeated zooming to settle tiles."
DATA-05 proposes deterministic best-available selection; D-06's broader policy
remains unresolved. CR-001 preserves existing source selection except accepted
supplements. Currently dnrTileAllowed and maskDnrGrid restrict DNR to device-local
download boxes. The Dell already holds finer Moses Lake DNR elevation, but a
phone without its own box rejects it. The background progress panel anchors to
the web toolbar hidden by native-host mode and overlaps the native info control.

## Exact requested change

1. In the existing Best available elevation path, prefer valid cached WA DNR
   elevation over USGS wherever the connected engine already has it, including
   user-downloaded data. Use existing ranks, samplers and renderer. Remove the
   device-local box restriction on valid returned DNR pixels across GPU/CPU 2D,
   elevation, shared 3D and fabric analysis. Preserve explicit source choices.
2. Expose cached raster footprint hints in the existing DNR status response so
   clients can avoid irrelevant tile requests. Hints are not valid-pixel coverage.
   Older engines without hints retain cache-only probing when files are present.
   Source revision/policy changes invalidate DNR results; retain other good data.
3. Browsing, panning, zooming and source selection keep acquire=0. They must never
   download or restore a DNR archive. Explicit download actions remain required
   for missing data; USGS and overview fill nodata/errors without stale downgrade.
   Download-area records continue to describe explicit downloads and outlines.
4. Place collapsed and expanded native background download progress below the
   top safe area/info control, outside the top fade and right toolbar, with
   usable details/cancel controls and scrolling at short heights. Preserve
   selection geometry, web/Electron toolbar anchoring and download lifecycle.
5. Update misleading source/help text and synchronize build/static/iOS assets.

## Alternatives and impact

Keeping per-phone gating requires duplicate download actions and fails Riley's
explicit source preference. Unconditional acquisition risks large unrequested
downloads and is excluded. Cached DNR can change the displayed terrain/analysis
where it is finer; existing units, validity, source provenance and scientific
math remain unchanged. No new provider, subscription, numerical device budget or
broader datum/source policy is adopted. Status carries only raster bounds, no
user identity or device download history. Roll back the bounded source/UI change
without deleting cached data. Existing distribution/release gates remain.

## Verification plan

- Exercise real source gates with no device downloads, cached footprint hits and
  misses, older engines, missing/invalid pixels, explicit choices and revision
  changes. Verify cache-only requests and lower-quality fallback.
- Check actual server status hints from a local fixture, cached DNR tiles and
  no-data responses without an acquisition job. Preserve existing DNR unit,
  provenance, acquisition and offline tests.
- Build iOS and reproduce Moses Lake close zoom with no saved download box;
  capture real loaded DNR provenance and compare the prior build. Check another
  cached region and uncached ground. Record timings as observations, not PERF
  gate acceptance; disclose physical-phone/one-minute-delay uncertainty.
- Verify native collapsed/expanded download progress, details/cancel hit areas,
  portrait/landscape and selection placement. Check ordinary web anchoring.
- Run static checks, all Node tests and required iOS Python checks; include
  matching site assets in the internal TestFlight build.

## Riley approval — direct build authorization under GOV-002

Exact instruction, actual user_message position 720 (2026-10-29):
> yeah, the app should always default to WA DNR data *when* its already available or when it has been downloaded by the user. Also, You need to move the download progress tile for offline lidar. Its currently way up in the top left behind the info button and covered by the fade at the very top

Continuation at position 749:
> Hi, Opus was fixing a bug where I wasn’t seeing high res tiles load or at least not load properly. Can you please pick up where it left off and finish this.

Source: <t3-thread://v2/25ec7f29-6fda-4160-a0ec-8450030a6239/thread:project:95d7b465-9ac4-4d9b-ad2b-94155aa5a211:23c965b7-44ea-424d-bfea-4b195e8b5ef6>
Message 720 ID: 0bfd1019-0ada-443d-9c1c-d8161966b126.
Binding: independently reproduced 4,460 UTF-8/LF proposal bytes before this
approval heading, normalizing only workflow Status to DRAFT, SHA-256
`2a8f1069619e0478960e732d6460fdc6c5e64c3a7d2ff1e42a7ecee7f9abc723`.
The coordinator read actual user messages through t3_thread_read. This direct
build instruction authorizes necessary CR submission and dedicated owner review
under GOV-002; no repeated confirmation is required. The digest is later
traceability, not represented as presented to Riley. Shipping authority is
separate: actual user_message position 229 authorizes push, merge, Dell update
and internal TestFlight for this continuing repair task; owner acceptance itself
does not authorize deployment.

## Spec Owner disposition — only after Riley authorization

Owner: dedicated Spec Owner `/root/spec_owner` (Codex), reviewed 2026-10-29
(America/Los_Angeles); exact r1 only, session ends at handoff.
Decision: ACCEPTED for the digest-bound proposal without substantive edits.

Authority independently verified through t3_thread_read, activity view, in the
source thread linked above: positions 720 and 749 are actual completed,
untruncated user_messages. Position 720 is creationSource web, updatedAt
2026-10-29T20:15:25.880Z; position 749 is creationSource mobile, messageId
5ad69fee-bba5-487c-b1f7-bc8688040faa, updatedAt 2026-10-29T20:25:42.208Z.
Together they directly authorize this bounded source preference, progress fix
and necessary owner review under GOV-002. Position 229 was also independently
read as an actual completed/untruncated mobile user_message, messageId
8e0f7630-d76c-40ac-9697-a0279025379d, updatedAt 2026-10-29T18:49:55.488Z;
its separate shipping instruction is quoted accurately above. This owner does
not itself authorize or verify deployment.

Static consistency evidence: reviewed governing documents, OWNER_REVIEW.md,
accepted CR-001–010 proposals and decision/handoff records. Inspected actual
dnrTileAllowed/maskDnrGrid/elevationSourceOptions, chooseTerrain, shared
engineElevationWithFallback, meshFineTile, fabric selection and worker sampling,
DNR status/elevation route, positionDnrSelection and native-host/MapChrome layout.
The device box is a client selection mask, not a data-availability constraint;
the existing acquire=0 server route decodes cached data without ensureTile.
Existing rank 5 and true nodata allow DNR to refine USGS without changing math.
Native-host hides mapDock, confirming its rectangle is unsuitable for progress.

Conditions interpreting and preserving r1:
1. Preference applies to Best available. Explicit National 3DEP/USGS source
   selections remain effective in GPU/CPU, elevation, 3D and analysis consumers;
   changing the default must not silently override an explicit user intent.
2. Cache footprints are request hints only. Validate hints and use actual valid
   decoded pixels, source revision, units and returned provenance. Preserve
   nodata, errors, gap filling and no late downgrade. No wider datum-transform,
   numerical-accuracy or universally-finest-source decision is adopted.
3. All implicit DNR paths remain cache-only, including fabric. No acquisition,
   archive restore or job start from map interaction. Keep bounded queues,
   cancellation and cached lower-source coverage. Distinguish existing engine
   storage from autonomous on-device offline packages; this change does not
   implement or claim those packages.
4. Positioning must keep collapsed/expanded progress and its interactive
   controls usable with safe areas, portrait/landscape and short heights;
   preserve the info tile, toolbar, selection placement and existing web anchor.
   This is a bounded repair of the existing on-map progress overlay, not
   permission to replace other native chrome with web UI.
5. Complete r1's verification plan and record failures or unavailable evidence.
   Synthetic/unit results or a successful archive do not establish real DNR
   loading, a physical-phone timing guarantee or resolution of the reported
   one-minute wait. Match shipped shared/service-worker/Electron/iOS assets.

Spec treatment: permanent bounded supplement to SPEC.md 0.1.0-draft and
CR-001's unchanged-web/source-selection constraint for r1 only. The baseline and
BASE-001 remain unchanged/unapproved. D-06 is resolved only for this cached DNR
preference; broader source/datum/tolerance decisions remain open. Other CRs,
ENGINEERING_REVIEW contracts, architecture, expiry, open decisions, PERF and
release gates remain. CR-001's internal distribution scope/expiry still applies:
BASE-001 approval/rejection or 2027-01-31, whichever first.
Further Riley confirmation: none for exact r1 and its necessary implementation
checks under the verified task instruction. Material revisions require a traceable
owner record under GOV-002; unrelated work remains outside this acceptance.
Next action: parent may implement and verify r1 now that acceptance is recorded.

## Implementation and verification

Implemented on `fix/dnr-detail-and-download-progress` from main `5bdd65f`.
Build stamp: `2026-10-29d` (initial source/progress comparison used `c`). PR/commit and shipping evidence will be recorded
with the implementation; owner acceptance above remains a distinct event.

Verification on 2026-10-29:
- Actual iPhone 17 Pro / iOS 26.0 simulator, one device, connected to the Dell.
  No local DNR download areas. Moses Lake at 47.210434,-119.43567, z18.6:
  installed prior build `2026-10-29a` used 100% USGS rank 3. New build used 100%
  DNR rank 5 across 5,505,024 displayed samples, with actual survey provenance
  Grant Douglas Okanogan Ytc 2022, dataset 1759, native 0.4572009144 metres.
  Matching screenshots and raw debug results: `/tmp/csp-dnr-finish/before.png`,
  `after.png`, `before.json`, `after.json`. Full DNR coverage was already ready
  at the first post-view 1.04 s observation on warm data; this is not a general
  latency or physical-phone guarantee.
- A second cached region at 47.344,-119.47 reached 100% DNR in 14.6 s on its
  first uncached rendered view. Mount Si (47.488,-121.723) used USGS rank 3.
  At Moses Lake explicit National used rank 2, explicit USGS used rank 3, and
  returning to Best available restored rank 5. All five views settled with
  full coverage and no failure; no device download boxes were created.
  Raw observations: `/tmp/csp-dnr-finish/scenarios.json`.
- Real DNR HTTP fixture verifies cached footprint hints, actual DNR provenance,
  empty-tile nodata and zero acquisition jobs after cache-only reads. Real
  candidate helpers cover older engines, no local areas, invalid/missing hints,
  disconnected engines, downloaded areas and explicit source intent. Existing
  GPU/CPU mixed-source tests preserve DNR nodata fallback and request ordering;
  shared mesh tests include explicit raw-USGS geometry and national-only choice.
- Actual native progress details and Cancel were tapped in portrait. Collapsed
  progress measured x=12,y=126 and a 44-point toggle below the native info
  control. Landscape measured x=74,y=64; expanded Map info moves progress below
  its measured height. The outer panel scrolls on short available heights.
  Progress responses were fixtures routed through real download handlers; no
  test acquisition was sent to the Dell. Web/Electron positionDnrSelection and
  selected-area geometry are unchanged; native CSS applies only to background
  progress. Screenshots: `/tmp/csp-dnr-finish/progress-expanded.png` and
  `progress-landscape-info-expanded.png`.
- Node 24.19.0: all 67 test files pass, targeted source/mesh regressions pass,
  static checks pass, vendor synchronization passes, audit reports zero known
  vulnerabilities, and all 13 iOS Python checks pass. Current native simulator
  Xcode build succeeds with the matching minified site and native assets.

Follow-up on Riley's IMG_2959 persistent blurry-patch report:
- Reproduced its diagonal survey boundary near 45.97929,-121.14818. Both
  indexed native USGS rasters contain nodata at that point; independent
  GDAL/rasterio reads also found zero valid samples in the surrounding
  500 x 500 m window. The settled app uses national elevation in those holes,
  with no pending or failed requests. No renderer retry can create those
  missing source samples. The DNR catalogue lists nearby survey candidates,
  but those rasters are not in the Dell's two-file cache; no new acquisition
  was started. See `docs/diagnostics/2026-10-29-zoom-detail.md`.
- Repaired a separate loading defect: provisional USGS index gaps formerly
  returned HTTP 200 / X-Coverage:none and became resident empty tiles forever.
  The engine now returns retryable 503 / unknown; the shared client also
  rejects the older engine's none/no-store combination. Confirmed USGS nodata
  and cache-only DNR misses keep their existing final behavior.
- Actual simulator failure/recovery fixture, identical stationary Moses Lake
  view: installed `c` stayed 100% national after 20 s, with zero retries after
  upstream recovery. Installed `d` reached 100% USGS at 12 s without a map
  event, and was fully settled without failure at 20 s. Only provisional
  responses were simulated; successful elevation was read from the live
  engine. Evidence: `/tmp/csp-dnr-finish/provisional-before.json`,
  `provisional-after.json` and matching PNGs. This fixture demonstrates the
  retry defect; it does not by itself diagnose IMG_2959. The federal nodata
  finding remains valid, but the earlier global no-detail conclusion was wrong:
  available published DNR hillshade was omitted. CR-012 restores that product
  for ordinary unmodified 2D hillshade; numeric analysis remains separate.
- Final `d`: all 68 Node test files, static checks, audit (zero vulnerabilities),
  13 iOS Python checks, Debug simulator build and Release archive/export pass.
  The new regression fails against the previous fetch helper and passes after
  the fix, preserving fallback pixels and retrying without another want().
- Final real-engine rapid-pan/zoom/revisit checks, including 31-degree bearing
  and z19.1: all three final views reached 100% DNR with no pending or failed
  requests and still zero local download areas. Settling observations were
  2.62 s, 1.30 s and 1.30 s on warm engine data; these are simulator examples,
  not a physical-phone performance gate. `/tmp/csp-dnr-finish/pan-final.json`.

Limitations: no physical iPhone measurement or reproduction of the reported
one-minute delay in this continuation. Engine-cached DNR still requires an
engine connection and is not autonomous on-phone offline storage. Raster bounds
remain request hints rather than evidence of valid-pixel coverage. Broader
source/datum validation and proposed PERF/release gates remain unverified.
