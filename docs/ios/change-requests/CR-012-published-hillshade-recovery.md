# CR-012 — restore available published DNR hillshade

Status: ACCEPTED
Request content revision: r1; binding SHA-256 recorded below the proposal.
Author / task: coordinating Codex; finish Riley's persistent blurry-patch repair.
Current approved spec revision: SPEC.md 0.1.0-draft remains unapproved;
accepted CR-001–011 supplements apply. This is a bounded supplement.
Affected requirement IDs: U-03, CAP-04/05/06, DATA-03/05/06,
RENDER-01/02/03/04, UX-04, D-06 (this source preference only), CR-001/011.
Type: permanent bounded restoration of an existing published source.

## Existing requirement and conflict

U-03 requires the best appropriate available data without repeated zooming.
CR-011 prefers valid engine-cached DNR elevation and prohibits implicit archive
acquisition. It does not restore the older published DNR hillshade route.
At Riley's marker 45.97929,-121.14818 the indexed federal 1 m files contain
nodata, but DNR MapServer layer 944 (Gorge East Wali 2022) returns detailed
hillshade and identify value 221. Current Auto never selects the retained
published-image renderer. Riley confirms this exact ground was sharp in Clear
Skies before. The earlier global "no high-resolution data" diagnosis was false.

## Exact requested change

1. For Auto, at existing close-view scales and only ordinary unmodified 2D
   hillshade (hs, no analytical Studio stack), restore published WA DNR DTM
   hillshade using the existing catalog, image proxy and bounded tile renderer.
   Per rendered pixel prefer valid cached numeric DNR, then valid published DNR
   hillshade, then existing USGS/national/overview numeric fallbacks. Transparent
   published pixels preserve useful fallback. Explicit National/USGS choices
   continue to exclude DNR. Discovery bounds remain request hints, never proof
   of rendered coverage. Catalog changes must refine stationary resident tiles.
2. Keep image presentation separate from numeric elevation. Published pixels
   never enter height grids, measurements, spectrum, derived/colored/modified
   Studio styles, 3D or analysis. Those retain their current numeric sources and
   explicit-download workflow. Cached numeric DNR retains CR-011 priority in
   all existing paths. No source archive acquisition or restore during browsing;
   every implicit numeric DNR request remains acquire=0.
3. Reuse the existing numeric tile pipeline in a single composite image tile,
   apply opacity once and keep real per-pixel source contributions. Label the
   published contribution as published hillshade with fixed provider lighting
   and unknown project-native spacing unless verified. Numeric pixels may be
   relit; published pixels do not change with sun controls. Explain this in
   shared/native source information and lighting notes without a blocking flow.
4. Preserve useful pixels during delayed, failed, cancelled and reversed results.
   Bound image requests/memory and retry transient failures with backoff while
   stationary; distinguish a transparent valid image from provider failure.
   Reuse cached numeric elevation for lighting/appearance changes. Cancel only
   the departing consumer, release tile resources and reject obsolete results.
5. Correct the investigation's overbroad coverage conclusion and PR evidence;
   preserve the independently verified federal nodata findings. Include matching
   web/iOS assets and existing startup, preferences, progress and shipping rules.

## Alternatives and impact

Leaving Auto unchanged contradicts the available-image evidence and Riley's
restoration task. Downloading numeric archives implicitly conflicts with CR-011.
Treating gray hillshade as elevation would fabricate measurements. Applying an
image to analytical or modified styles would misrepresent those computations.
A bounded composite on the existing non-analytic image path restores only the
appropriate product. It may use the existing CPU/per-tile shader path for this
ordinary hillshade; other GPU styles keep their current renderer. DNR image
availability remains a provider dependency; this is not an offline-phone or
physical-device performance claim. No account, purchase or privacy change.
Rollback: revert this bounded client change; cached elevation and downloads stay
valid. Permanent restoration, superseded only by another accepted change.

## Verification plan

- Same screenshot region before/after, actual simulator and real DNR image;
  inspect valid rendered pixels/provenance after settling without another pan.
- Numeric DNR over published; published over coarse fallback; transparent detail,
  mixed coverage, reversed responses, same-source refinement and opacity.
- Stationary failure/recovery, changed catalog/source intent, cancellation,
  revisit and bounded cleanup; preserve useful pixels throughout recovery.
- National/USGS selections and every analytical/modified style remain numeric;
  images never enter measurement grids. Lighting changes reuse numeric data and
  preserve fixed image pixels. No acquire/restore or DNR index mutation.
- Existing Node/static/iOS Python checks and matching simulator/Release builds;
  report physical-phone, provider-availability and analytical-coverage limits.

## Riley approval

Authority: Riley's direct build/continuation instructions under GOV-002:
"Hi, Opus was fixing a bug where I wasn’t seeing high res tiles load or at least
not load properly. Can you please pick up where it left off and finish this."
His source instruction: "the app should always default to WA DNR data *when*
its already available or when it has been downloaded by the user."
Latest clarification: "It was sharp in Clear Skies before" (the exact patch).
These messages are present in the current inherited user context. Source thread:
<t3-thread://v2/25ec7f29-6fda-4160-a0ec-8450030a6239/thread:project:95d7b465-9ac4-4d9b-ad2b-94155aa5a211:23c965b7-44ea-424d-bfea-4b195e8b5ef6>.
Scope: necessary bounded repair and dedicated owner review, not unrelated work.
No claim Riley saw this digest. Release authority remains separately recorded.

Binding: independently reproduced 5,198 UTF-8/LF proposal bytes before this
heading, normalizing only workflow Status to DRAFT, SHA-256
`2c6e910d82ca77507a95c4610c7cb829b098f13e9cb4ef699f94e8a6368c7172`.
This is a later traceability binding, not a digest represented as presented
to Riley.

## Spec Owner disposition

Owner: dedicated Spec Owner `/root/spec_owner` (Codex), fresh CR-012-r1-only
session after the CR-011 handoff; reviewed 2026-10-29 (America/Los_Angeles).
Decision: ACCEPTED for exact digest-bound r1, with no substantive proposal edit.

Authority independently checked through t3_thread_read in the source thread
above. Actual completed/untruncated user_messages 720 and 749 contain the DNR
default and finish-the-repair instructions. Their message IDs and timestamps
match the independently verified CR-011 authority record. Actual user_message
1228 is completed/untruncated, creationSource server, updatedAt
2026-10-29T21:15:20.129Z; it contains the question about this exact patch and
Riley's answer, "It was sharp in Clear Skies before". Actual user_messages
999/1005 report a persistent blurry portion while surrounding terrain sharpens;
1222 challenges the no-data conclusion. These are continuing build instructions
under GOV-002, authorizing this necessary bounded repair and dedicated review
without a repeated approval question. This acceptance does not independently
authorize or verify shipping.

Consistency evidence: read governing docs, accepted requests/owner continuity,
CR-011 and affected source. Inspected waTileUrl/waSharpPx, WADNR_OK,
CompositeTerrainLayer, chooseTerrain/applyTerrain, GPU state selection,
sunEffect, source information and coverage refresh. The existing JavaScript
map already retains a separate published DNR image compositor and a numeric
GPU/CPU path. Routing ordinary hs through a bounded composite of those existing
products stays within CR-001's shared map architecture; no scientific logic moves
to native chrome and no renderer library replacement is accepted.

Viewed the supplied dnr-sharp-512.png as an image: fine terrain texture and sharp
edges are present. Read its request JSON (existing DNR MapServer export,
512 pixels, dpi 192, layer 944) and layer metadata. Read
dnr-point-identify3.json: layer 944 returns Stretch.Pixel Value 221, while
layers 553/234/764 return NoData. This demonstrates an available published
image candidate, not numeric elevation or verified project-native spacing.
No independent network/device/runtime/scientific test was performed by this
owner. Federal file-read/NoData/404 findings remain the implementer's evidence;
distinguish actual missing samples from an unavailable legacy file.

Conditions preserving/interpreting r1:
1. Eligibility is exactly Auto plus close-view ordinary unmodified 2D hs.
   Analytical, colored or modified Studio stacks and explicit source choices
   must remain excluded. Cache-derived numeric DNR keeps CR-011 precedence.
   Preserve independent numeric spectrum, measurements, analyses and 3D,
   including concurrent display; published gray values never become heights.
2. Composite actual valid pixels once, in r1's priority order. Transparent
   published pixels expose existing useful fallbacks. A successful HTTP/PNG or
   catalog footprint alone is not rendered coverage. Failed/error products and
   missing pixels must not be counted as valid published detail. Source counts
   and labels describe actual contributions and distinguish image provenance
   from numeric sampling; unknown native spacing stays unknown.
3. Explain fixed provider lighting for published pixels in shared/native source
   and sun information. Numeric contributions may relight from cached grids;
   changing the sun must neither fabricate relit image detail nor re-fetch
   elevation. Preserve single opacity application, active-layer ordering,
   restoration/preferences and exports' honest source limitations.
4. Keep useful pixels across asynchronous refinements, catalog discovery,
   transient errors, intent changes and reversed responses. Stationary tiles
   must retry/recover with bounded backoff and resources. Reuse requests and
   numeric grids; unload/cancel only departing consumers and reject obsolete
   results. Do not solve discovery changes by repeatedly blanking whole layers.
5. Published image requests may use the existing image proxy. They do not
   authorize numeric archive acquisition, archive restore, DNR index mutation
   or wider implicit downloads. Existing cache-only numeric requests remain
   acquire=0. This source is a provider dependency, not phone-offline storage.
6. Complete r1's real-image/simulator comparison and all named regression/build
   checks. Test same-source refinement, nodata, opacity, reversed/cancelled
   results, stationary failures/recovery, explicit selections and modified-style
   exclusions. Disclose remaining numeric/analytical coverage and physical-phone
   performance uncertainty. Correct the earlier global no-data conclusion and
   retain precise federal nodata evidence; do not describe all styles as repaired
   merely because published ordinary hs is sharp.

Spec treatment: permanent bounded supplement to SPEC.md 0.1.0-draft, CR-001's
unchanged-web/source-selection constraint and CR-011 for the published ordinary
hillshade route only. SPEC.md and BASE-001 remain unchanged/unapproved. Broader
D-06 datum, numerical tolerances and source policies remain open. Other CRs,
ENGINEERING_REVIEW contracts, internal distribution/expiry, proposed PERF and
release gates remain unchanged. Acceptance is permission to implement, not
implementation, scientific validation, provider SLA or release acceptance.
Next action: parent may implement and verify exact r1. No further Riley
confirmation is needed within this task; material revisions need a traceable
owner record under GOV-002. This owner session ends at handoff; no approval
custody transfers to the implementer.

## Implementation and verification

Implemented on isolated `fix/published-dnr-hillshade-recovery`, based on main
`cd56331cc30dfc957dc11731180b9ec3f92d2962`. Shared build `2026-10-29e`.
This evidence does not amend the accepted proposal or owner disposition.

- Actual same-camera iPhone 17 Pro / iOS 26 simulator and live Dell/DNR:
  center 45.9796901,-121.1442121, z15.5, Classic/Auto/hs/100%. At 25 seconds
  stationary, prior d uses 51% USGS and 49% national; candidate e uses 100%
  published DNR across 50 resident tiles, none pending/failed, and the formerly
  soft patch visibly contains fine terrain. Before/after PNGs are committed
  under docs/diagnostics/assets; detailed diagnosis corrects the earlier global
  no-detail conclusion while retaining the verified federal nodata evidence.
- Real source checks: cached Moses Lake view retains 100% numeric DNR rather
  than the image, including actual DTM 1759 survey provenance. Explicit
  National/USGS and slope/topographic Studio styles stay on numeric GPU data;
  returning to Auto ordinary hs restores the image. Sun changes add zero
  requests and leave published image pixels unchanged. Local download areas
  remain empty; captured requests contain no archive acquire/restore action.
- Rapid pans and a 31-degree rotated z16.5 revisit continue refining without
  a camera nudge. The subsequent stationary view reaches all 168 resident
  tiles at published rank 4, none pending/failed, at the 55-second observation.
  This real provider example is not a physical-phone or PERF timing pass.
- Actual 3D transition uses numeric cspmesh DEM/shading and cspgpu3d analysis
  sources, with a live-lighting note. Returning to 2D restores the fixed-image
  lighting explanation. Published pictures never become 3D heights.
- The actual composite regression exercises reversed ordering, published above
  coarse/numeric DNR above image, transparent and fractional alpha, retained
  opacity, numeric-only measurement grids, fixed light/no fetch, stationary
  204/error recovery, overlapping image/numeric retries, shared-consumer
  cancellation and cleanup. Transition tests preserve staged GPU coverage past
  a retry deadline and ensure the CPU fallback replaces the image subclass
  when switching to explicit/analytical numeric intent. Readout tests label
  numeric pixel provenance and preserve numeric nodata beneath imagery.
- All 69 Node test files, static checks, vendor sync and dependency audit pass
  (zero vulnerabilities). All 13 iOS Python checks pass. Debug simulator and
  Release archive/export builds use the same assembled/minified site assets;
  final archive/package verification and delivery are recorded with the PR.
- Live Dell before publication: numeric DNR revision 2, two files,
  1,362,607,888 bytes, no acquisition job. Index SHA-256 remains
  1c13c08b5026654002e3ec2f160cdc311c76ba07d889b31a91e0c5539013478e.

Scratch evidence: /tmp/csp-detail-recheck/patch-before.json, patch-after.json,
scenarios-final.json, modes-final.json, verify-final.log, python-final.log and
matching screenshots/build logs. Published provider layer 944 identifies value
221 at the marker; direct National ImageServer identify returns NoData for all
three cataloged 1 m items. The unavailable third legacy file URL returns 404.

Limits: sharp published ordinary hillshade does not supply missing numeric
analytical elevation or establish project-native spacing, vertical accuracy,
provider uptime, phone-offline storage or physical-iPhone performance. No paid
release or App Store acceptance claim. SPEC.md/BASE-001, other CRs, scientific
validation, proposed PERF/release gates and CR-001 expiry remain unchanged.
