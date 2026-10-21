# CR-001 — Native iOS shell around the existing Clear Skies map engine

Status: ACCEPTED
Request content revision and immutable commit/content digest: r1; SHA-256 of
every line above the "Riley approval" heading, quoted to Riley when presented
Author / task: coordinating agent (Claude), 2026-10-21. Riley asked to replace
the Grok-built native client with a faithful port distributed via TestFlight.
Current approved spec revision: none (SPEC.md 0.1.0-draft; BASE-001 pending)
Affected requirement IDs: U-04, UX-02, ARCH-01, ARCH-02, ARCH-03, ARCH-04,
ARCH-07, D-02, G1, G3; CAP-01 to CAP-14 as the parity reference
Type: specification change (resolves D-02 for the native client) and
time-limited exception (implementation and internal TestFlight before BASE-001)

## Existing requirement and conflict

> ARCH-02 (P): Evaluate MapLibre Native as the primary map renderer in a bounded
> prototype. [...] Record measured fit before selection.

> ARCH-03 (P): [...] React Native, Three.js and a web-view wrapper are
> alternatives, not approved defaults.

> D-02: Final renderer and feasible native terrain/point-cloud implementation.

BASE-001 is pending, so no native implementation is authorized.

Riley's direction on 2026-10-21: "I love the way the app works now and the way
it is laid out, but I think the UI would be smoother if the whole app was iOS
native." His earlier request asked for "real liquid glass, real iOS native
code, and is smooth and fast like an iphone app".

Evidence from source inspection on 2026-10-21:

- The web client is about 30,500 lines: a 9,825-line inline application, the
  WebGL2 GPU terrain engine and shaders, LiDAR studio, markup, MapLibre GL JS
  3D, Potree point clouds and research modules. The Node engine adds about
  4,600 lines. Electron already hosts this client unchanged.
- The uncommitted `ios/` client (about 3,700 lines of Swift on MapLibre Native)
  re-implements a subset. Terrain styles are recomputed on the CPU in Swift
  (`TerrainRaster.swift`) and served through a loopback tile server; 3D uses
  SceneKit. By its own handoff, it does not draw point clouds or dated
  satellite scenes, cannot draw markup shapes, has one LiDAR layer instead of
  the stack, and lacks area selection. Without the Mac engine it falls back to
  AWS Terrarium overview tiles, which the web client labels about 98 ft
  spacing. In the same situation the web client requests public USGS 3DEP
  directly, at 3.3 ft where available. No CR or decision record authorizes
  that architecture.

## Exact requested change

1. Architecture for the native client (resolves D-02 until an approved CR
   supersedes it):
   - A SwiftUI application built with the iOS 26 SDK. All user-facing chrome
     is native and uses system Liquid Glass: map dock, search with suggestions
     and coordinate actions, the bottom sheet and tool list, every tool page
     (Layers, Satellite imagery, LiDAR, Elevation, Analyze, Export, Conditions,
     Geology & hazards, Past landscapes, Labels & reference, Markup,
     Appearance, Settings), popovers, alerts, share/export and location. The
     native layout mirrors the current app's.
   - The map canvas is the existing web map engine: Leaflet 2D with the GPU
     terrain layer, MapLibre GL JS 3D, Potree point clouds and the existing JS
     modules. It is bundled inside the app and runs in a full-screen WKWebView.
     Scientific, source-selection, loading and rendering code is reused, not
     re-implemented in Swift.
   - Native controls drive the engine through a message bridge. The web client
     gains an opt-in native-host mode that hides its HTML chrome and reports
     control state. With the mode off, web and Electron behavior is unchanged.
   - The Node terrain engine stays optional. The app reaches it at the
     user-configured address (Tailscale), as the hosted web client does today.
     Without the engine, the app uses the web client's existing public sources.
   - Replacing the web map canvas with a native renderer requires a separate
     approved CR backed by on-device measurements.
2. For this client, this replaces ARCH-02's MapLibre Native evaluation and
   ARCH-03's web-view restriction. The web view is approved for the map canvas
   only, not as a whole-app wrapper in the finished product.
3. Commit the existing `ios/` work, unchanged, to the branch
   `archive/grok-native-rewrite`. It is not the base for new work.
4. Time-limited exception before BASE-001 approval. It authorizes:
   - Stage 1: Xcode project, bundled web client, WKWebView host, local asset
     loading, engine connectivity, native location and share integration. The
     current web UI remains visible inside the app.
   - Stage 2: replace the in-app HTML chrome with native chrome, one route at a
     time, keeping every control. A web control stays until its native
     equivalent exists. No route or capability is removed.
   - Internal TestFlight builds for Riley's own devices.
   Expiry: when BASE-001 is approved or rejected, or 2027-01-31, whichever
   comes first.
   Not covered: external TestFlight, App Store submission, StoreKit, pricing,
   paid features, a hosted public engine, new data sources, removing or
   deferring any capability, and the proposed PERF numerical gates.

## Alternatives and impact

- Continue or repair the full native rewrite (MapLibre Native plus Swift and
  Metal). This has the highest ceiling for gesture smoothness. It means
  re-implementing the whole client, including GLSL to Metal, LiDAR studio,
  markup and Potree. Parity and scientific-divergence risk are high, and it is
  far longer.
- Plain web wrapper (Stage 1 only). Fastest, but no native UI, so it does not
  meet Riley's goal.
- This proposal gives parity by construction and native chrome. Map gestures
  and WebGL performance remain WebKit's. WebKit may limit animation to 60
  frames per second on 120 Hz screens; this must be measured on the device.
- Every web UI change then needs a matching native update. Engineering contract
  9 (keep hosting, Electron and service-worker assets in sync) gains the iOS
  bundle.
- Scientific consequences: none. The same code computes and renders.
- Privacy: location is used only on request. The engine address is stored on
  the device.
- Cost: no new spending. The Apple Developer Program membership is already held.
- A later public release still needs its own approval. App Review guideline 4.2
  risk is reduced by the native UI.
- Rollback: remove the new `ios/` project or restore the archive branch. The
  native-host mode is opt-in and removable.

## Verification plan

- `npm run check` and `npm test` pass after the native-host changes. Existing
  web UI regression scripts are unchanged.
- On Riley's iPhone 15 Pro Max (iOS version and build recorded), compare one
  viewpoint and layer stack in Safari and in the app: hillshade, multi-direction
  hillshade, tint, slope, aspect, contours, elevation spectrum, 3D, point
  cloud, markup drawing, satellite scene search and display, and export.
- Verify with the engine reachable over Tailscale and with it unreachable
  (public fallback).
- Each build carries a route-by-route checklist: every web control has a native
  equivalent or is listed as still web.
- Record Instruments frame timing for sheet drag and map pan as information,
  not as approved gates.

## Riley approval — required before routing to Spec Owner

Exact approval text: Riley answered the structured question "How do you want
the native app built?" by selecting "Approve CR-001 (Recommended)". The option
text shown to him read: "Native Liquid Glass screens around your existing map
engine. Approves CR-001 r1 exactly as written (SHA-256
35ffe7088f8f71a654fbdcfb892d1857b21135b72f7069a5b087dbbecb7d94f9) and lets me
start a Spec Owner session to record it. Then I put Grok's code on a separate
branch and start step 1."
Available message/issue/PR reference: T3 Code thread
56d5529a-7bb5-43e5-ac76-eebcb30229ca, question answered 2026-10-21. No durable
URL exists.
Approved request content revision and immutable commit/content digest: r1,
SHA-256 35ffe7088f8f71a654fbdcfb892d1857b21135b72f7069a5b087dbbecb7d94f9 over
every line above this heading, with the status line as presented
("Status: DRAFT"). Later status-line changes are workflow state, not request
content. Reproduce with:
`awk '/^## Riley approval/{exit} {print}' CR-001-native-shell-with-web-engine.md | sed '1,/^Status:/s/^Status:.*/Status: DRAFT/' | shasum -a 256`
Scope: approval of exact proposed change, plus authorization to re-establish a
Spec Owner session to record it

## Spec Owner disposition — only after Riley authorization

Owner identity and review date: Spec Owner session re-established 2026-10-21
under Riley's authorization (Claude subagent); reviewed 2026-10-21. The
coordinating agent launched this session. The checks below were made against
source and the T3 thread record, not taken from that agent's account.
Decision / rationale: ACCEPTED.
- Approval binds to this content. The digest reproduces with the command above.
  The thread record (items 743–744, recorded 2026-10-21T18:08:29Z) shows the
  quoted option text and Riley's answer "Approve CR-001 (Recommended)". The
  creation of this file (item 738) precedes the question in the same thread.
- Scope is bounded: two stages, internal TestFlight for Riley's own devices,
  an expiry and an explicit not-covered list.
- Parity is kept. Item 1's 13 tool pages match the 13 routes in ui-system.js,
  and Stage 2 keeps every control. This matches Riley's same-day direction for
  "same ui, same features, same functionality" (thread item 314).
- Scientific and loading contracts carry over because the same web code
  computes and renders. ENGINEERING_REVIEW.md contracts 1–8 are unchanged;
  contract 9 gains the iOS bundle, as the request says.
- Only D-02 is resolved, for the native client. D-01 and D-03 to D-08 stay
  open, BASE-001 stays pending and the PERF gates stay proposed.
Evidence check (2026-10-21):
- Confirmed: Terrarium fallback in TerrainEngine.swift elevation(); CPU styling
  in TerrainRaster.swift served from a 127.0.0.1 tile listener (TileProxy.swift,
  PortalMapView.swift); SceneKit 3D (TerrainMeshView.swift); public USGS 3DEP
  with no engine (public-terrain.js; gpu-terrain-store.js buildSources, called
  from gpuElevationSources; GPU 2D is on by default); the "~98 ft" and "3.3 ft
  where available" labels; Electron loading the unchanged client
  (electron/main.js; its preload only adds a macOS drag strip).
- Line counts: 3,694 Swift lines in 13 files; 30,516 web-client lines
  (index.html, 37 first-party scripts, 2 CSS files, service worker and workers);
  a 9,824-line inline script; 4,334–4,652 engine lines depending on what is
  counted.
- "By its own handoff" is Grok's thread message (item 648), not a repository
  file. Each gap it lists was also confirmed in the Swift source. Both Riley
  quotes were found in the thread (items 0 and 672).
- Not verified: Apple Developer Program membership (no account access) and the
  WebKit 60 fps limit (to be measured, as the request says).
Accepted spec revision or exception scope and expiry: Supplement to SPEC.md
0.1.0-draft; spec text unchanged (rationale in DECISIONS.md). For the native
client, item 1 replaces ARCH-02's MapLibre Native evaluation and ARCH-03's
web-view restriction, and resolves D-02 until an approved CR supersedes it.
Exception: items 3 and 4 only. Expires when BASE-001 is approved or rejected,
or 2027-01-31, whichever comes first. The D-02 resolution does not expire with
the exception. Not covered: the list in item 4.
Conditions (same text in DECISIONS.md):
1. Parity: measured against the current web client bundled in each build, every
   route (13 today, as listed in item 1) and every control. CAP-01 to CAP-14 are
   cross-references, not a ceiling.
2. Reuse: native controls call the web client's existing functions through the
   bridge. No source selection, scientific math, loading or rendering logic is
   re-implemented in Swift.
3. No silent loss: if a capability fails inside WKWebView (for example download,
   export, location, storage or a WebGL2 limit), stop that route's work and
   raise a request. No stub, mock or quiet removal. A rendering difference
   between Safari and the app for the same viewpoint and layer stack is a
   defect, not an accepted divergence.
4. Shared code: with native-host mode off, web and Electron behavior is
   unchanged and `npm run check` and `npm test` pass. Each web change ships with
   the matching iOS bundle (engineering contract 9).
5. Privacy: the engine address is entered by the user and stored on the device,
   as in the hosted web client, not compiled into the app. Item 3 is a local
   commit. The archived TerrainEngine.swift contains Riley's tailnet hostname,
   which no tracked file contains today; publishing that branch needs Riley's
   decision.
6. Open items stay open: the internal builds' deployment target and device
   family are provisional and do not resolve D-01. Existing web cache and point
   budget defaults are not D-07 budgets; new device limits need a request.
   Instruments timings are information, not PERF results. Internal TestFlight
   does not pass G3.
7. Traceability: each task and PR cites CR-001 r1 and its digest, SPEC.md
   0.1.0-draft (unapproved) with this supplement, requirement IDs, the
   route-by-route checklist, test evidence and remaining limitations.
Interpretation logged (no text change, no change in meaning): item 1's "built
with the iOS 26 SDK" names the SDK generation that introduced system Liquid
Glass. A later SDK with the same APIs satisfies it. Raised by the implementer on
2026-10-21. Verified: the only installed toolchain is Xcode 27.1 (27A9275) with
the iOS 27.1 SDK, whose SwiftUICore declares glassEffect and
GlassEffectContainer available from iOS 26.0. Riley's decision is not required.
An iOS 26.0 deployment target for internal builds follows from item 1's system
Liquid Glass; see condition 6.
Any further Riley approval required: None for items 3 and 4 within this scope
and these conditions. Required for anything not covered, any change to the text
above, publishing the archive branch, and work after expiry. If BASE-001 is
withdrawn or replaced rather than approved or rejected, the expiry question
returns to Riley; 2027-01-31 remains the outer limit.

## Implementation and verification

PR / commit: local branch `ios/native-shell`, not pushed: ceeb9f9 (these
records), d025cf8 (Map view point-cloud fix), 06a8d85 (native-host mode, web
build 2026-10-21a), 255a071 (Stage 1 app), 7a4fcd2 (TestFlight script fix).
Item 3: 6b58059 on local branch `archive/grok-native-rewrite`.
Evidence (Stage 1, 2026-10-21, coordinating agent):
- Xcode 27.1 / iOS 27.1 SDK: Debug build and Release archive succeed with no
  warnings; 8.9 MB app. Export with a cloud-managed Apple Distribution
  certificate succeeds. The TestFlight upload stopped before sending anything:
  App Store Connect has no app record for dev.riley.ClearSkies.
- macOS WebKit harness compiled from the app's own SiteSchemeHandler,
  EngineProxy and EngineSettings sources plus native-host.js, in a 430×932
  window against the engine at 127.0.0.1:8765. The page was ready in 0.8–1.9 s;
  the engine connected through the proxy; GPU 2D terrain was on and hillshade
  rendered. The elevation spectrum drew; scene search returned 250 scenes from
  AWS Earth Search; 3D terrain started; the point cloud streamed
  WA_NorthCentral_1_2021 after d025cf8; the engine markup list returned through
  the proxy. No JavaScript errors or warnings were logged.
- The same harness on the plain static site (no native host) started on build
  2026-10-21a and opened the point cloud.
- `npm run check` passes. With Node 24, 52 of 53 test files pass. The other,
  test-server.js, fails identically on main bc3cb41: /api/health now exceeds
  the 1,024-byte compression threshold the test assumes. Not introduced here.
- Route checklist, Stage 1: all 13 routes use the web client's own controls; no
  route is native yet. Nothing was removed.
Remaining limitations:
- Not yet run on an iPhone: it was not connected, and TestFlight needs the app
  record. On-device location, export share sheet, keyboard, memory and frame
  rate are unverified.
- The harness is macOS WebKit with a fine pointer. iOS-only paths (coarse
  pointer budgets, iOS export limits) are unverified.
- The Mac engine serves web build 2026-10-19o from the unmerged branch
  claude/fix-capture-custom-layers-odd4w8; the app bundles this branch and lacks
  that export fix until it merges.
- Stage 2 (native chrome) has not started.
