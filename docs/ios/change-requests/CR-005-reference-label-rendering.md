# CR-005 — Dark-mode water styling and sharper reference labels

Status: ACCEPTED
Request content revision and immutable commit/content digest: r1; SHA-256 of bytes before the Riley approval heading
Author / task: coordinating agent, Riley's direct river/lake appearance and label-resolution requests in the current conversation
Current approved spec revision: SPEC.md 0.1.0-draft remains unapproved; CR-001 through CR-004 supplements apply
Affected requirement IDs: U-01, U-04, UX-02, CAP-09, CAP-10, DATA-03, CR-001 shared-client parity
Type: bounded reference-overlay presentation change

## Existing requirement and conflict

CR-001 says "With the mode off, web and Electron behavior is unchanged."
Riley now directly requests light-grey rivers/lakes in dark mode and sharper
labels on that overlay and similar reference overlays. The cached water tiles
are 256-pixel USGS NHD rasters; merely enlarging them adds no information.
Existing dynamic GNIS/trail exports render at one or two pixels per CSS pixel.

## Exact requested change

Render Rivers & lakes in light grey in dark mode, retaining blue presentation
in light mode. Apply the same styling to map captures and the layer swatch.
For sharper water labels, use USGS's existing public NHD dynamic MapServer at
https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/export at local
scales it supports, with its scale-dependent line, flowline, area and waterbody
feature layers and labels. Preserve USGS/NHD attribution and identify the
dynamic rendering in the layer description. Keep the existing cached USGS
hydro tiles at overview scales and as a bounded per-tile failure fallback.
Report fallback/failure honestly using the existing overlay health/status UI.

Request genuine high-density dynamic reference renders, at least 512 pixels per
256 CSS-pixel footprint and up to the display's 3x density, with proportional
DPI so label size in screen space remains stable. Apply this to water, trails,
peaks/landforms and named places. Preserve map footprints, opacity, order,
provider scale rules, native/shared-engine parity and existing retries and
cancellation. Cached Esri reference tiles remain at their provider's available
resolution; disclose this limit rather than shrink their labels by requesting
the next zoom level or claim upsampling adds detail. No capability is removed.

Keep exported reference imagery consistent with the displayed grey styling and
source fallback. Extend the existing exact-host export allowlist only with
hydro.nationalmap.gov. No new account, paid provider, numerical terrain/analysis
change, background location, public deployment or distribution is authorized.
This supplements CR-001's unchanged-web condition only for these requested
reference-overlay changes. Its remaining conditions and expiry are unchanged.

## Alternatives and impact

Retaining cached tiles limits text sharpness. Moving cached labels one zoom
level finer would shrink them instead of preserving their screen size. A new
vector-map renderer/provider is unnecessary for this bounded improvement.
Dynamic NHD cartography can differ from the cached NHD compilation and entails
more provider rendering and image bytes; preserve cached overview/failure
coverage and measure live responses. Neither label pixel density nor grey
styling changes measurement accuracy. Rollback restores cached water and the
previous dynamic label density. This is permanent presentation behavior.

## Verification plan

Check real USGS NHD metadata, labels and successful 512/768-pixel exports;
compare footprints, label size and detail at representative WA water locations.
Verify light-blue/dark-grey appearance and theme switching without re-fetching
terrain, opacity/order, cached overview, failed dynamic responses and fallback,
map captures and bounded cancellation/retries. Check desktop and native iOS,
shared syntax/tests, exact export-host checks and matching bundled assets.
Record cached-Esri and physical-device limitations separately.

## Riley approval — direct task authority under GOV-002

Original r1 proposal binding: SHA-256
`2cdd6e56268c4df81036ad57cc02d95bc0da5f327685289cf032963b2a0e6fa8`
over exactly 4,010 UTF-8/LF bytes before this heading, including Status: DRAFT.
The dedicated owner independently computed this before edits. Only workflow
status changes above the heading; normalize Status: ACCEPTED to Status: DRAFT
to reproduce. This digest is recorded for traceability after Riley's instructions;
it is not represented as a digest presented to or explicitly approved by Riley.
The proposal text otherwise remains byte-identical.

Independent evidence: owner directly read the actual messages in the
[parent T3 Code thread](t3-thread://v1/0e7c30e1-9c85-4b32-9b08-86e8efa70a9a),
messages view, limit 100, then afterPosition 87, limit 15. The following records
are completed, untruncated user_message items, createdBy: user,
creationSource: web; authority does not rely on assistant summaries.

Position 88, messageId d321dedb-00f5-46e8-99fb-e431619da8ac,
updatedAt 2026-10-26T17:06:14.075Z:

> also, when in dark mode, is it possible to make the rivers and lakes overlay be a light grey instead of blue?

Position 102, messageId 460cd1c9-cb9d-4346-91b5-53fac51676c4,
updatedAt 2026-10-26T17:07:27.908Z:

> Also, is it possible to make the labels/text on the rivers/lakes overlay and any that apply labels like it a little more high resolution? The way they are now, they look kind of sloppy.

The same owner independently verified GOV-002 at actual user_message position
27, messageId cb0288b1-a6d6-452c-a479-740d29f70376,
updatedAt 2026-10-26T16:57:39.610Z:

> Stop asking me for approval, you have approval to make any and all changes you need once I've instructed you to build something. Yes you are approved to do this though.

These direct appearance/label requests extend the active build task. The bounded
r1 implementation and this dedicated owner review are necessary within that task
and authorized under GOV-002; no repeated Riley approval/restoration question is
needed. This is direct task authority, not a claim Riley approved an unseen digest
or that provider metadata/test success supplies product authority.

## Spec Owner disposition — accepted

Owner: dedicated Spec Owner review sub-agent (Codex), CR-005 r1 only;
reviewed 2026-10-26 (America/Los_Angeles). This session ends at handoff.
Decision: ACCEPTED for the original digest-bound r1 without substantive changes.
Read the proposal above as the operative scope. In particular, the requested
water is LIGHT grey IN dark mode; a dark-grey water color is not this request.

Independent consistency evidence:
- Read AGENTS.md, GOVERNANCE.md, SPEC.md, DECISIONS.md, SPEC_OWNER.md,
  OWNER_REVIEW.md, ENGINEERING_REVIEW.md and accepted CR-001 through CR-004,
  including placement addendum r1-a1. SPEC.md 0.1.0-draft at pending baseline
  commit 142fdf4748baddf6cb03d6cdde1c9f67fe012d50 remains unapproved.
- index.html OVERLAYS currently uses cached USGSHydroCached for water and
  dynamic carto.nationalmap.gov exports for trails (37,24), peaks/landforms (5)
  and named places (3). ExportLayer already renders tileMerc footprints using
  EXPORT_PX/EXPORT_DPI, currently 256/96 or 512/192; increasing reference density
  in that shared boundary avoids a new renderer or duplicated Swift rendering.
- ResilientTileLayer.createTile already obtains getFallbackTileUrl, bounds
  retries, switches once to fallback and cancels unloaded/removed tile work.
  Existing trackLayerHealth counts loads/errors but does not distinguish a
  successfully loaded fallback. r1's honest fallback status therefore needs
  implementation; a loaded cached tile cannot silently claim dynamic detail.
- The snapshot path has its own snapshotLayerTileUrl and drawSnapshotRasterPlan;
  it fetches source tiles and paints them separately from DOM style filters.
  The implementation must carry the approved style and bounded source fallback
  through this path as well as the interactive map. Merely changing map CSS is
  insufficient evidence of capture parity. Preserve existing output extent.
- Independently fetched live JSON metadata: USGSHydroCached/MapServer/0 is a
  Raster Layer (hasLabels false); its baked pixels cannot become sharper labels
  through enlargement. hydro.nationalmap.gov/.../nhd/MapServer reports
  supportsDynamicLayers true, minScale 577790.554289, maxScale 0 and a
  4096-by-4096 export limit. Feature layers 4/6 (small/large-scale flowlines)
  and 10/12 (small/large-scale waterbodies) report hasLabels true. Small-scale
  layers report minScale 577790.554289/maxScale 73221; large-scale layers
  report minScale 73220/maxScale 0. These are provider scale denominators,
  not universal fixed zoom thresholds. Preserve their scale rules, including
  with proportional DPI; metadata is not proof of a successful labeled export.
- server.js uses an explicit snapshot-image host allowlist already containing
  basemap.nationalmap.gov and carto.nationalmap.gov. r1 permits adding only the
  exact hydro.nationalmap.gov host. Preserve all other export URL checks.

Acceptance conditions (apply the proposal's existing requirements):
1. Render actual 512–768-pixel dynamic reference images for the same 256-CSS-pixel
   footprint, with proportional DPI and stable screen-space label size. Cover
   water at provider-supported scales and the existing dynamic trail/GNIS layers.
   Verify successful, nonempty labeled responses and representative WA examples;
   extra response dimensions alone do not prove sharper usable labels.
2. Preserve cached USGS water at overview scales and as bounded per-tile failure
   fallback, with honest health/status. Preserve coverage, cancellation/retries,
   opacity/order, attribution and source description. No next-level shrinking of
   cached text or upsampling claim; disclose cached Esri resolution limits.
3. Light-mode blue and dark-mode light grey must match across dynamic/cached
   water, swatches and map captures. Theme changes must not refetch terrain.
   Preserve geographic footprints and measurement/scientific semantics.
4. Implement through the existing shared engine, with native/shared parity,
   matching iOS assets and appropriate shared checks/tests/build evidence.
   Record real response cost/latency and failures; metadata or a simulator build
   does not establish live rendering, physical-device performance or acceptance.

Affected IDs: U-01, U-04, UX-02, CAP-09, CAP-10, DATA-03 and CR-001 parity,
with CAP-03/CAP-13 and shared rendering/loading contracts as dependent checks
for opacity/order and captures. This adds no unrelated capability or release gate.
Spec treatment: permanent bounded presentation supplement to SPEC.md 0.1.0-draft,
which remains unchanged and unapproved with BASE-001 pending. CR-001's web/Electron
condition is supplemented only for these reference-overlay changes, including
this exact public USGS NHD dynamic endpoint and export host. All other conditions,
internal-distribution limits and exception expiry remain: BASE-001 approval or
rejection, or 2027-01-31, whichever first. CR-002/003 and CR-004 r1+r1-a1 remain
unchanged. No new renderer, account, paid provider, numerical terrain change,
public deployment or distribution is authorized. No open decision is resolved.

## Implementation and verification

Owner acceptance authorizes the parent to implement original r1 and execute its
verification plan. Live 512/768-pixel density samples are being obtained by the
parent; their success, visual quality and runtime/fallback/capture behavior were
not verified by this owner. Metadata checks above are live provider discovery,
not runtime acceptance. Do not mark r1 IMPLEMENTED or VERIFIED from this record.

Outstanding: real labeled density/footprint/text-size comparisons, supported-scale
boundaries, light/dark switching, overview and forced fallback/status, failed or
cancelled requests, capture source/style parity, latency/bytes, desktop/native
comparison, shared checks/tests, iOS build and matching bundled assets. Disclose
physical-device and cached-Esri limitations. Preserve scientific/loading invariants.
If the dynamic service cannot satisfy r1, stop only that affected work and obtain
a revised owner record under GOV-002; do not silently substitute upsampling or
remove the requested improvement. No repeated Riley approval within task scope.

Handoff: this owner changed only CR-005, DECISIONS.md and SPEC_OWNER.md, left
uncommitted for the parent. No app code, runtime/device/scientific tests, commits,
deployment or delegation. Preserve unrelated dirty work. This CR-005-r1-only
session ends here; the parent does not inherit owner custody.
