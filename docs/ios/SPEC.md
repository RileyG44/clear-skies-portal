# Clear Skies Native iOS — product and engineering specification

Revision: 0.1.0-draft
Date: 2026-09-06
Status: INITIAL PROPOSAL — awaiting Riley's baseline approval
Product authority: Riley Grant
Custodian: dedicated Spec Owner (see SPEC_OWNER.md)
Existing app baseline: main at 4c78a7197eacec9688326bf5dc75823b5e29ab23

## 1. Authority and interpretation

Riley has authorized establishing this specification and its owner. Requirements
marked U below capture his explicit direction and are already authoritative.
Requirements marked P are proposed implementation/product requirements; inclusion
in this draft is not approval. Approval of this baseline adopts its P requirements
except the explicitly unresolved decisions in section 10. Approval does not spend
money, enroll accounts, publish an app, or authorize all future implementation.
Governance is effective now under Riley's explicit instruction, independently of
baseline approval. Changes follow GOVERNANCE.md; use stable requirement IDs.

## 2. Product purpose and audience

- U-01: Deliver a native iOS version of Clear Skies with the current app's intended
  capabilities: satellite imagery, high-quality LiDAR-derived terrain, LiDAR
  tooling, geological and landscape overlays, mosaics, and exploration.
- U-02: Serve broad landscape exploration and research, including geology,
  archaeology, hiking, and curious map users. Do not narrow the product to metal
  detecting or assume a single hobby defines its market.
- U-03: Core experience: open map, select a layer, move/zoom to a place, and receive
  the best appropriate available data without repeated zooming to settle tiles.
- U-04: Prioritize current native iOS design conventions, efficiency and visual
  polish. Specific frameworks have not yet been approved by Riley.
- U-05: Explore a subscription business around USD 7.99/month and 400–500 active
  paying subscribers. Riley proposed USD 0.99 for seven days then monthly renewal;
  that exact offer is unresolved, not silently replaced by a free trial.
- U-06: Spec Owner permission plus Riley's approval is required for every deviation.

The target is capability parity, not replication of desktop panel geometry or
known defects. A phased build is proposed; no phase may silently redefine the
finished product or omit capabilities from a paid release.

## 3. Native user experience (proposed)

- UX-01 (P): Open to an interactive map. Returning users restore viewpoint, layer
  stack, and preferences; first-use guidance is brief and dismissible. Allow users
  to understand available coverage and value before committing to payment.
- UX-02 (P): Use native search, location permission flow, bottom sheets, controls,
  share sheets, accessible typography, light/dark appearances, and safe-area
  handling. Use system glass materials for navigation without compromising legends.
- UX-03 (P): Primary actions have at least 44×44-point hit areas. Search suggestions
  never cover Search/Locate actions. Support larger text, VoiceOver, reduced motion
  and transparency, landscape, keyboard appearance, and short available heights.
- UX-04 (P): Map gestures and tools must not conflict. Visible loading is separated
  into overview available, refining detail, ready, no coverage, offline, and error.
  Never require a user to jiggle the viewpoint to retry stalled rendering.
- UX-05 (P): Treat field use as a first-class workflow: saved places, notes and
  coordinates, explicit offline areas, download size/progress, pause/resume/delete,
  recovery after interruption, and a map that still works without GPS permission.
- UX-06 (P): Preserve meaningful camera/layer state across 2D/3D transitions. Release
  inactive renderer resources. Show feature limitations before starting an action.

## 4. Capability parity inventory (proposed acceptance scope)

Each row must gain implementation and verification evidence before it is called
complete. Current source code and docs establish intent, not verified iOS behavior.
The discovery catalog contains 46 entries, not 46 verified integrations. Where
legacy prose conflicts with code/tests, investigate rather than copying its claims.

| ID | Required capability | Existing reference | Native status |
|---|---|---|---|
| CAP-01 | Place/coordinate search, locate, copy/open coordinates, bearings and view restoration | index.html; ui-system.js | Not implemented |
| CAP-02 | Dated satellite scene search, filters, source/date selection, acquisition context, scene footprints and imagery mosaics | index.html; mosaic-core.js; sources.json | Not implemented |
| CAP-03 | Layer enable/order/opacity and reference basemaps | ui-system.js; index.html | Not implemented |
| CAP-04 | Best-available terrain, USGS 3DEP/raw DEM and WA DNR coverage adapters | usgs.js; cog.js; index.html | Not implemented |
| CAP-05 | Hillshade/multidirectional, elevation tint, slope, aspect, exposure and contour styles | terrain-raster.js; terrain-core.js | Not implemented |
| CAP-06 | Lighting, exaggeration, palette/style parameters and cached-data interaction | terrain-raster.js; THREE_D_TERRAIN.md | Not implemented |
| CAP-07 | Elevation spectrum, thresholds/bands, units and independent opacity | elevation-bands.js; elevation-tile-core.js | Not implemented |
| CAP-08 | Landform fabric and research raster products, parameterized scale and provenance | research-analysis.js; glacial-research-core.js; research-worker.js | Not implemented |
| CAP-09 | Geology/hazards, identification, past landscapes, archaeology context and reference overlays | wa-archaeology.js; sources.json; index.html | Not implemented |
| CAP-10 | Weather/conditions, seismic/volcano/fire/snow overlays and freshness indicators | sources.json; index.html | Not implemented |
| CAP-11 | Linked 3D terrain with supported terrain styles and honest limitations | THREE_D_TERRAIN.md | Not implemented |
| CAP-12 | Point clouds: project selection, linked/unlinked camera, classes, bare earth, color modes, point budget and lighting | POINT_CLOUD_3D.md; point-cloud-core.js; point-cloud-viewer.js | Not implemented |
| CAP-13 | Geographic-extent-preserving PNG export, resolution choices, attribution and actual quality limits | index.html exporter; README.md | Not implemented |
| CAP-14 | Offline terrain download/resume and cache management; current engine-disk caching must become explicit on-device downloads for field use | server.js; usgs.js | Native storage is new work |
| CAP-15 | Public subscription entitlement, restore/manage purchases and offline access policy | New commercial service | Not implemented |

Native point budgets are measured device budgets; the web's 1–10 million setting
is not automatically a safe iPhone default. Choosing a lower approved device limit
must preserve honesty about loaded versus available detail. Exact source roster,
spatial coverage, supported parameters, and release parity are resolved in the
approved milestone inventory, not inferred from a checkbox here.

## 5. Scientific data and rendering contracts (proposed)

- DATA-01 (P): Catalog every source with stable identity/version, provider, survey,
  acquisition interval, availability/update time, bounds, validity mask, CRS,
  horizontal/vertical reference, units, native spacing, documented accuracy,
  attribution, commercial/redistribution/offline permissions and retrieval metadata.
  Missing facts are explicit unknowns. Never infer a license from public access.
- DATA-02 (P): Keep imagery capture time distinct from catalog update time. Do not
  advertise universal real-time high-resolution imagery. Coverage, clouds, revisit
  interval and processing delay must be visible when relevant.
- DATA-03 (P): Distinguish native spacing, display sampling, interpolation and
  measurement accuracy. Never call an overview LiDAR without provenance or treat
  upsampling as added information. Exaggeration changes display, not measurements.
- DATA-04 (P): Resolve vertical references/units before quantitative mixing. Where
  compatibility is unknown, block affected cross-source numerical analysis or
  label an explicitly approved approximate mode. Do not silently blend elevations.
- DATA-05 (P): Best-available source selection is deterministic per footprint and
  intended use; account for valid data, compatible reference, native resolution,
  acquisition and license constraints. Exact ranking is a required design decision.
- RENDER-01 (P): Shared source requests, bounded concurrency/cache/memory, viewpoint
  cancellation and reference-counted consumers; one cancelled consumer cannot break
  another. Cache keys include source version, projection and relevant processing.
- RENDER-02 (P): Within one viewport/source intent, late lower-quality data must
  never replace valid higher-quality data. Intentional date/source changes are new
  requests; reject stale results from previous requests.
- RENDER-03 (P): Keep useful coverage while a replacement stages. Commit based on
  valid rendered coverage, not HTTP success or bounding polygons. Failed candidates
  retain the prior useful map and surface an actionable status.
- RENDER-04 (P): Separate elevation retrieval from styling. Cached compatible data
  supports lighting/palette/threshold changes without redownloading elevation.
  New analysis neighborhoods may request genuinely missing data with clear status.
- RENDER-05 (P): Mosaic plans are stable across adjacent tiles, respect validity and
  selected date/quality policy, and avoid avoidable seams. Define newest, clearest,
  and finest-resolution policies explicitly; never silently swap their meanings.
- DATA-06 (P): Analyses/exports include source provenance, units/reference, processing
  parameters/version, nodata handling, resolution and provisional/completeness state.
  Numerical products require known-quantity and independent GIS reference checks.
  Existing curvature UI claims profile/plan while code returns surface Laplacian;
  resolve the intended outputs in D-06. Never copy the misleading label as parity.

- DATA-07 (P): Glacial/flood or other geological screening describes observed
  morphology and model assumptions. It must not be presented as calibrated
  probability, a demonstrated geological cause, or proof of ice/flood presence.
  Labels, legends and exports preserve uncertainty and method limitations.

## 6. Architecture proposal — not a settled technology decision

- ARCH-01 (P): Swift/SwiftUI native shell with explicit feature modules, typed state
  and concurrency ownership. UI must not own provider discovery or scientific math.
- ARCH-02 (P): Evaluate MapLibre Native as the primary map renderer in a bounded
  prototype. Its raster/vector/Metal capabilities do not imply parity with MapLibre
  GL JS, custom terrain shaders, or Potree. Record measured fit before selection.
- ARCH-03 (P): Use Metal/custom native rendering only where the approved prototype
  proves it necessary. Point clouds require their own feasibility and memory gate.
  React Native, Three.js and a web-view wrapper are alternatives, not approved defaults.
- ARCH-04 (P): Reuse tested Node terrain processing and provider integrations behind
  versioned APIs where suitable. Share data contracts and numerical fixtures across
  web/native; port browser-dependent code deliberately rather than duplicating bugs.
- ARCH-05 (P): Public service uses authenticated access, server-verified entitlement,
  object storage, shared caches and bounded processing jobs. Choose hosted providers
  only after workload/cost evidence and Riley's approval of purchases.
- ARCH-06 (P): Ordinary map interaction uses locally rendered/cached tiles, not a
  new remote compute job for every gesture. Expensive analyses run as cancellable
  jobs with status and resource limits. Existing web/private-engine use remains viable.
- ARCH-07 (P): Paying customers must not depend on Riley's home computer or a shared
  personal Tailscale credential. Keep deployment, credentials and customer data
  separated from the private development engine.

## 7. Commercial operation (proposed)

- BIZ-01 (P): Use StoreKit subscription purchase/restore/manage flows and verified
  server entitlement, with renewal, refund, expiry, billing retry and grace handling.
  Display localized price and eligibility; never hard-code a USD offer globally.
- BIZ-02 (P): Trial duration/price, renewal price, free tier, offline entitlement
  grace, feature packaging and expensive-job quotas require explicit decisions.
  The USD 0.99/week idea is an unresolved platform constraint; do not substitute.
- BIZ-03 (P): Measure compute, storage, network egress, cache hit ratio and support
  cost per active subscriber before claiming profitable operation at USD 7.99.
  Subscribers are not equivalent to simultaneous active render jobs.
- OPS-01 (P): Minimize location retention and analytics. No background location by
  default. Document access, deletion, privacy disclosures and incident recovery.
- OPS-02 (P): Provider permission/attribution, commercial serving and offline caching
  must be verified per enabled source before paid distribution. Unsupported sources
  need a disclosed replacement/defer request; no quiet removal or assumed permission.

## 8. Verification and performance gates (proposed)

Correctness and performance results must be separate. Passing tests on synthetic
rasters is not proof of full-resolution live data, field reliability or accuracy.

Required scenarios: rapid pan/zoom and revisits; adjacent/missing surveys; stale,
reversed, failed and cancelled responses; styles while loading; antimeridian and
bounds; repeated 2D/3D/point-cloud transitions; background/foreground, low memory,
thermal pressure, denied location, interrupted downloads, offline and entitlement
changes; search suggestions, larger text, VoiceOver and landscape keyboards.

Proposed benchmark targets, subject to baseline approval and measurement protocol:

| ID | Measure | Proposed gate |
|---|---|---|
| PERF-01 | Scripted 2D gesture frames on minimum supported physical iPhone, warm local data, fixed layer stack | 95th percentile frame duration ≤20 ms; no main-thread stall >100 ms |
| PERF-02 | Warm cached style change | 95th percentile first updated frame ≤100 ms |
| PERF-03 | Fixed recorded network fixture: 20 Mbps, 80 ms RTT, specified scene/tile bytes | 95th percentile overview ≤2 s and target valid detail ≥95% within 5 s after gesture ends |
| PERF-04 | 20-minute repeated pan/style/mode lifecycle | Bounded configured caches; no retained inactive renderer or monotonically growing live allocations |
| PERF-05 | Failure fixture | Prior valid map retained; no stale downgrade, retry storm or manual zoom required |

PERF-03 excludes true nodata from the denominator and reports it separately; it
must not count an overview as target detail. These are controlled-fixture targets,
not worldwide provider SLAs. Before this gate can pass, record physical devices,
OS/build, datasets and bytes, layer stack, repetitions, warm/cold state, viewport,
measurement method and percentile calculation. Memory caps, point budgets, battery
and per-user backend ceilings remain open; implementers cannot choose them as new
requirements. Missing baseline hardware/protocol means unverified, not passed.

## 9. Delivery gates (proposed)

1. G0: Riley approves a versioned baseline; owner records exact approval evidence.
2. G1: Approve bounded prototype scope and unresolved renderer/device decisions.
   Prove search → terrain → zoom → shading on real iPhone and live WA data plus
   deterministic fixtures. Record feasibility and cost; prototype shortcuts follow
   the same change process. No implication of production readiness.
3. G2: Owner records a Riley-approved release matrix covering every CAP ID, including
   every deferral. A smaller paid release cannot be inferred from phased development.
4. G3: TestFlight field build, scientific reference validation, billing lifecycle,
   accessibility, device/network benchmarks and operational recovery.
5. G4: Riley authorizes App Store submission after acceptance evidence, source rights,
   public service readiness, chosen pricing, support/privacy pages and release review.

App Store review timing, subscriber counts, source uptime and implementation dates
are not guaranteed by this specification.

## 10. Open decisions — explicit, not delegated defaults

D-01: Minimum supported iPhone/iOS; iPad release scope and accessibility/device matrix.
D-02: Final renderer and feasible native terrain/point-cloud implementation.
D-03: Exact initial-release capability/source/geography matrix and any paid-release deferrals.
D-04: Supported introductory offer, monthly/annual prices, free access and job limits.
D-05: Offline package types, quotas, licensing, retention and subscription-expiry behavior.
D-06: Source-selection/mosaic policy, compatible datum transformations, numerical tolerances.
D-07: Hardware/memory/point/battery budgets and completed benchmark protocol.
D-08: Cloud provider, region, spending ceiling, account/identity and web subscription interoperability.

These require Riley-approved requests. Agents may document options and evidence;
they may not resolve them by silently implementing a preferred default.

## 11. References

Existing repository references above describe the current implementation and its
limitations. The following informed proposals; platform details must be rechecked
before implementation, and any incompatibility goes through change control.

- Apple design: https://developer.apple.com/design/
- Apple introductory offer duration table: https://developer.apple.com/help/app-store-connect/manage-subscriptions/set-up-introductory-offers-for-auto-renewable-subscriptions/
- Apple subscription lifecycle: https://developer.apple.com/app-store/subscriptions/
- MapLibre Native iOS: https://maplibre.org/maplibre-native/ios/latest/documentation/maplibre/
