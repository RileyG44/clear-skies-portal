# Satellite imagery repair — implementation and verification

Task scope: Riley's 2026-10-24 request to repair map text selection, scene
disclosures, scene application without Auto Fill, and zoom refinement in the
internal iPhone app.

Authority: accepted CR-001 r1, SHA-256
`35ffe7088f8f71a654fbdcfb892d1857b21135b72f7069a5b087dbbecb7d94f9`,
supplementing SPEC.md `0.1.0-draft` (baseline remains unapproved). Requirement
cross-references: U-01, U-03, U-04, CAP-02, UX-04, RENDER-02, RENDER-03;
ENGINEERING_REVIEW.md contracts 2, 4, 6–9. This is implementation evidence,
not a normative specification change.

Acceptance checks:

- Map double tap and long press do not select the web document; editable fields
  retain text editing and copying.
- Satellite scene sections and the displayed-scene panel close and reopen,
  including consecutive disclosure actions.
- Selecting a live dated scene loads its imagery with Auto Fill disabled.
- Zooming requests and decodes finer scene tiles up to the source's native
  detail. Coarse context remains identifiable as context.
- Failed, cancelled and superseded selections preserve useful previous imagery
  and do not install stale layers.
- Shared web regression/static checks and a signed iOS build pass. The native
  route bridge still exposes every existing route and control.

## Investigation

- AWS scene imagery used `titiler.xyz/.../{y}@2x.png`. A live Sentinel-2 tile
  returned HTTP 422 (`int_parsing` on `1442@2x`); the same tile without the
  suffix returned HTTP 200. Adding `tilesize=512` returned a decoded 512 × 512
  PNG. TiTiler's current
  [migration documentation](https://developmentseed.org/titiler/migrations/v2_migration/)
  confirms removal of the suffix. Planetary Computer remains on its own
  advertised TileJSON URL syntax.
- Auto Fill could display MODIS context after the primary scene failed. That
  context is not additional Sentinel-2 detail.
- Hidden web panes still animated while SwiftUI animated their disclosure.
  A consecutive close/open reproduced a lost open action. Native-host pane
  changes now use the existing immediate-state path.
- The native displayed-scene panel's close action pointed to the open button.
  It now invokes the existing collapse button.
- The native web host had no document-selection suppression. Map/chrome text
  now excludes WebKit selection/callouts, with editable-field exceptions.

## Verification

- `npm run check`: passed in the working repository (inline syntax, static
  asset inventory and version/cache consistency).
- `npm test`: all **54 scripts passed** in a clean source checkout of HEAD
  overlaid with these exact edits, using Node 24.19.0. The initial run in the
  working directory stalled reading the unrelated, untracked local glacial
  calibration corpus; it was stopped. The clean checkout matches the CI file
  set and has no optional local corpus. No tests were edited or skipped to
  bypass the stall.
- `test-satellite.js` exercises the actual functions for TiTiler/Planetary
  Computer URL handling, immediate native pane changes, scene-panel closing,
  scene application without Auto Fill, native zoom ceilings, failed replacement
  retention and reversed metadata responses. Existing cancellation and layer
  transition checks also passed.
- Native host/adapter syntax, Python runner syntax and `git diff --check`:
  passed.
- Signed Debug iPhone build, installation and launch: passed with Xcode 27.1
  and the iOS 27.1 SDK. Tests used the paired iPhone 15 Pro Max on iOS 27.2.
  Verification did not activate the app or capture the phone screen.
- Real WKWebView satellite probe: **passed with no failures**, run ID
  `5db61317-57a8-4b22-b5ba-95d421cbab3d`, web bundle `2026-10-24a`.
  It checks computed map selection/callout suppression and the editable-field
  exception, runs four consecutive native disclosure actions, invokes the map's
  double-tap search handler against live catalogs, applies a live AWS Sentinel-2
  acquisition from **2026-10-21 19:21Z** with Auto Fill off, and closes/reopens
  the displayed-scene panel twice. At z12 it decoded **12/12 tiles**, then at
  z14 **15/15 tiles**, all **512 × 512**, with zero tile errors and loading
  settled. The same selected scene remained on the map.
- Existing physical-device native bridge probe: **13 routes and 3 popovers
  passed**, no failures, run ID `df35f474-d579-461e-834b-388967b3730c`.
- The web client independently loaded 20 scene tiles at z12 and 30 at z14,
  all 512px, with zero tile errors and Auto Fill off. A subsequent Planetary
  Computer Sentinel-2 selection loaded 30/30 512px tiles at z14, confirming
  that its existing advertised retina syntax still works.
- Extended physical-device Auto Fill probe: passed, run ID
  `3231c13b-81da-45f4-afd7-4b332e12598f`. At z8 Auto Fill loaded 15 MODIS
  context tiles (256px, native ceiling z9); returning to z14 loaded 15
  selected-scene tiles (512px) above the context, with zero tile errors.
- Signed Release archive and local IPA export: passed, **1.0 (29880722)**.
  Xcode confirmed **Upload succeeded** and **EXPORT SUCCEEDED** on 2026-10-24.
  App Store Connect subsequently listed the build as **Internal — Testing**
  in the existing **Riley** group, whose only tester is Riley. No external
  testing or App Store submission occurred.

Reproduce the live physical-device check after installing a current Debug build:

```sh
python3 ios/scripts/verify_shell_on_device.py <device-id> \
  --probe ios/scripts/verify_satellite.js --output /tmp/satellite-device.json
```

The probe restores the map viewpoint, search filter controls and saved search
preferences, clears its test scene, and returns to the original route.
Provider evidence is a live integration
check for this acquisition and device, not a worldwide availability or performance
claim. Physical long-press/double-tap UI gestures, VoiceOver and other source
collections still need a field pass; the probe verifies WebKit's actual computed
selection policy and invokes the real map search handler programmatically.

Archives, IPA files and detailed logs/results are retained outside iCloud
Documents under `~/Library/Developer/ClearSkiesVerification/`, in
`build-29880722/` and `evidence/satellite-*`.

No source ranking, dates, scientific calculations, provider roster, native
architecture, production release scope or proposed performance gates changed.
