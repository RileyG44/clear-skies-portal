# Capture repair — implementation and verification

Task scope: Riley's 2026-10-24 report of jumping selection handles and rectangular
bands in exported terrain images. Riley identified the affected combination as
**Aurora, 32×**.

Authority: accepted CR-001 r1, SHA-256
`35ffe7088f8f71a654fbdcfb892d1857b21135b72f7069a5b087dbbecb7d94f9`,
supplementing SPEC.md `0.1.0-draft` (baseline remains unapproved). Requirement
cross-references: U-04, UX-03, UX-04, CAP-06, CAP-13, RENDER-04, DATA-06;
ENGINEERING_REVIEW.md contracts 1–2, 6–9. This is a repair within the internal
native-shell exception, not a normative change or a parity/release-gate claim.

Acceptance checks:

- Corners and whole edges resize without relocating the opposite corner;
  touching the interior moves the rectangle. Near-handle touches retain the
  initial grab offset. Secondary pointers cannot replace an active drag.
- Cancellation restores the rectangle; selection gestures leave the map camera
  unchanged. Handle targets are at least 44 CSS pixels across.
- Aurora at 32× remains geographically aligned and visually continuous across
  streamed PNG bands, columns and internal GPU targets, including rotated views.
- One capture uses consistent terrain effects, settings and resident sources;
  resources are released on completion or failure and queued refinement resumes.
- Existing source ranking, float elevation data, attribution/readout, scale
  choices, streaming limits and other map layers retain their existing behavior.
- Static/regression checks, a signed iPhone build, device checks and an internal
  TestFlight archive/upload pass.

## Investigation and repair

The old corner targets were 30 pixels wide. A pointer landing 18 pixels outside
the southeast corner missed the handle and began drawing a new rectangle.
The browser reproduction changed a 264 × 543 rectangle at (61, 160) into a
30 × 40 rectangle at (343, 721). The repaired handler instead preserves (61,
160) and resizes to 294 × 583 for the same drag. Targets are now 44 pixels wide;
geometry also recognizes entire edges and nearby finger touches. The active
pointer owns the drag, cancelled gestures restore their starting rectangle, and
selection events stop before reaching the underlying map.

Aurora combines relative elevation with a soft-light hillshade overlay, an
8-metre detail radius and a 3-kilometre valley-floor radius. Large captures were
rendered in bands and columns; each block independently recomputed its terrain
effect fields inside that small rectangle. The clipped neighborhoods changed
the palette and shading at block boundaries. The reported image's regular
two-column band pattern matches that export layout.

The GPU layer now creates one releasable capture session. It copies the map's
derived float effect fields and freezes the settings, camera and resident draw
plan for all export blocks. A geographic transform registers each crop with the
same effect fields. Native elevation and shading are still rendered at the
requested output density; the export is not an enlarged screen image. One-pixel
halos preserve derivative samples at block edges. Native uploads queue during
the capture and resume when its session is released, preventing source revisions
from changing halfway through the PNG. The existing resident texture budget and
source-priority rules are unchanged.

An interruption check also found that releasing a capture after GPU context
restoration attempted to delete texture/framebuffer handles from the lost
context. Release now drops those already-invalid objects without issuing GL
deletions against the restored context.

## Verification

- `npm run check`: passed, including inline syntax, asset inventory and cache
  consistency for web bundle **2026-10-24c**.
- `npm test`: all **55 scripts passed** with Node 24.19.0 in a clean source
  snapshot of HEAD overlaid with these exact edits and additions. As in the
  preceding satellite repair, the snapshot excludes the unrelated untracked
  local calibration corpus that can stall its optional data-file checks. No
  tests were skipped or weakened. The new `test-capture.js` exercises the actual
  gesture/compositor functions, geographic effect-field registration, success
  cleanup and failed second-block cleanup.
- Real GPU engine regression: **29 checks passed in Chrome and 29 in WebKit**
  using `scripts/gpu2d/engine-review-checks.js --browser=both --frames=30`.
  These include native-height parity, source priority/nodata, rotated and tiled
  export, frozen settings, context restoration and interleaved readback.
- Real production Aurora stack and PNG compositor:
  `scripts/gpu2d/capture.js --browser=both` passed on Apple M2 Metal in Chrome
  and Apple GPU in WebKit. At 32×, full versus streamed 1,408 × 2,112 PNGs
  agreed within **one channel value out of 255** at bearings 0° and 37°, with
  internal GPU targets forced down to 512 pixels. The large **7,240 × 7,860**
  PNG used **30 blocks**, two columns and 552-row bands. Independent crops
  checked **1,989,120 seam pixels** across every band/column boundary, again
  within one channel value. The PNGs were saved and visually inspected.
  The interrupted-capture check rejects export while the GPU context is lost,
  then releases the frozen capture and resumes rendering after restoration
  without a WebGL error.
- Signed Debug build, installation and background launch passed on the paired
  **iPhone 15 Pro Max, iOS 27.2**, using Xcode 27.1 / iOS 27.1 SDK.
- The same production Aurora/PNG fixture passed inside the installed iPhone
  WKWebView on Apple GPU in bundle 2026-10-24b, run ID
  `1ddcec47-98a8-41a4-90eb-1f2e84206fbe`. It completed the 7,240 × 7,860,
  30-block streamed PNG, sampled all seam regions within one channel value, and
  verified that source revisions wait during capture and resume afterward.
- Actual installed selection-handler probe passed, web bundle 2026-10-24b,
  run ID `42702a9d-5188-4aae-8557-cfa7a31cde4f`: corner tolerance, preserved
  anchor/grab offset, second-pointer ownership, resizing between handles,
  interior movement, cancellation, 44-pixel targets and unchanged map camera.
  These are synthetic touch PointerEvents in WebKit, not a physical finger
  usability test. The probe temporarily replaces native pointer capture and the
  selection setup's animation frame so it can run without activating the app.
- Existing native bridge probe: **13 routes and 3 popovers passed**, run ID
  `8a636569-0c6d-4f01-be16-442765aeab64`.

The final context-restoration cleanup correction is in bundle 2026-10-24c.
Its signed Debug build and installation passed; the phone locked before the
post-install launch. A subsequent launch retry also returned iOS's `Locked`
error. The final device recovery rerun therefore requires unlocking the phone.
Desktop Chrome and WebKit passed the new interruption/recovery check after that
correction. The earlier physical-device checks establish the reported selection
and Aurora 32× fixes; they do not validate the final context-restoration cleanup
on that device.

Follow-up: Riley confirmed the phone was unlocked. The subsequent CoreDevice
launch returned error 4016 and the device list marked it **unavailable** (trusted
connectivity/services could not be asserted). The outstanding recovery rerun now
requires restoring that connection, not another unlock. Riley asked to continue
through Xcode and deferred App Store Connect sign-in until returning to the desk.

Signed Release archive/local IPA export **1.0 (29880791)** passed. The packaged
HTML, engine, layer and version stamp match reproducible minification of the
tested source, verified by SHA-256. The preceding **29880780** internal upload
was superseded to include the context-restoration cleanup correction.
Xcode confirmed **Upload succeeded** and **EXPORT SUCCEEDED** for 29880791 on
2026-10-24. Distribution remains internal-only in the existing Riley group.
The App Store Connect browser session subsequently signed out. Final
**Testing** availability for 29880791 is not yet confirmed; it requires signing
back in (or checking the TestFlight app). Archive/IPA and upload logs are retained
under `~/Library/Developer/ClearSkiesVerification/build-29880791` and `evidence/`.

Device checks did not capture the phone screen or open the share sheet. The GPU
fixture uses deterministic synthetic native elevation with the actual Aurora
model, shaders, engine, layer export method, canvas readback and PNG encoder;
it does not establish survey accuracy or maximum-device export capacity. Other
layers are absent from that fixture; the existing regression checks cover their
compositing/readout contracts. Existing native-grid or survey-boundary artifacts
are distinct from the repaired export-block discontinuities.

Evidence is retained locally under
`~/Library/Developer/ClearSkiesVerification/evidence/capture-*`.

## Reproduce

```sh
node test-capture.js
node scripts/gpu2d/capture.js --browser=both --output=/tmp/clear-skies-capture
node scripts/gpu2d/engine-review-checks.js --browser=both --frames=30
python3 ios/scripts/verify_shell_on_device.py <device-id> \
  --probe ios/scripts/verify_capture.js --output /tmp/capture-gestures.json
node scripts/gpu2d/capture.js --device-probe=/tmp/capture-gpu.js
python3 ios/scripts/verify_shell_on_device.py <device-id> \
  --probe /tmp/capture-gpu.js --output /tmp/capture-gpu.json --timeout 110
```

The browser runners use the local Playwright installations documented by the
existing GPU verification workflow. The generated device probe runs the same
fixture against the bundled production modules. These probes are Debug-only;
no test data or debug launch execution is included in Release builds.
