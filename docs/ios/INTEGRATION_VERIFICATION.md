# Native repair integration — 2026-10-24

Authorization: Riley requested merging the completed fixes into main in the
current T3 conversation. Scope: integrate the native shell and the satellite,
Capture and selected-theme fixes with main at `7b1b3ad` (including the finer
LiDAR export work from PR 30).

Approved supplement: CR-001 r1, SHA-256
`35ffe7088f8f71a654fbdcfb892d1857b21135b72f7069a5b087dbbecb7d94f9`.
SPEC.md remains 0.1.0-draft, unapproved. Cross-references: U-01/U-03/U-04,
CAP-01/CAP-02/CAP-05/CAP-06/CAP-07/CAP-11/CAP-12/CAP-13,
RENDER-01 through RENDER-04; CR-001 conditions 1–7. No normative changes or
new exceptions. Internal builds for Riley only; no public iOS release.

## Conflict resolution

- One frozen map field, settings and resident source plan serve all Capture
  blocks. Geographic registration preserves Aurora effects across PNG bands
  and columns, including rotated crops. Context loss invalidates old handles.
- Main's finer native elevation loader, provider levels, progress counts,
  separate texture budget and bounded chunks remain enabled. Each capture owns
  its detail textures; they cannot evict the interactive view's textures.
- The compositor uses the full-image region API while keeping one frozen
  capture alive until success/failure cleanup. Handle and gesture repairs,
  satellite scene/zoom behavior and native selected-theme wiring are retained.
- Shared build stamp: `2026-10-24d`, with matching static/service worker/iOS assets.

## Acceptance evidence

Evidence: `~/Library/Developer/ClearSkiesVerification/evidence/merge-2026-10-24/`.

- `npm run check` and all 55 `npm test` scripts passed on a clean tracked-source
  snapshot outside iCloud. Full `npm run verify` passed after a dependency refresh (zero vulnerabilities).
- Real Chrome/Metal and WebKit engine review: 29/29 checks each, no page errors.
- Aurora 32×: full versus streamed parity at bearings 0°/37°; a 7240×7860 PNG
  in 30 blocks/two columns, 1,989,120 seam pixels compared, max channel delta 1
  in both real-GPU browsers. Refinement freezes/releases and context recovery pass.
- Main's six finer-elevation export scenarios pass in Chrome and WebKit: z14
  views fetch z17 relief, region/whole/tight-budget output matches within 1
  channel, live store/textures stay unchanged, no export texture leaks.
- Main's five export seam scenarios pass on Chrome/Metal, max channel delta 1.
- Signed Debug iPhone build passed. Installed build `2026-10-24d` passes
  selected-theme synchronization on the paired iPhone (root, native LiDAR sheet,
  native Capture popover; actual UIKit root/web/presenter traits in both modes).
- The paired iPhone passes the final real-GPU Aurora 32× capture, source freeze
  and context-loss/recovery fixture, plus installed WKWebView handle/edge/pointer
  checks. Handle events are synthetic, not a claim of a physical-finger test.
- Refreshed compatible locked dependencies after the current npm advisory feed
  blocked verify: Electron 43.8.3, fast-uri 3.1.9, undici 6.29.1/7.30.1.
  Package.json ranges are unchanged; npm audit reports zero vulnerabilities.

## Limitations

The separate 12-finding Opus audit is a repair backlog, not a completed fix set.
See the original report in the evidence folder and the per-repair verification
records. No scientific accuracy, performance, parity or release gate is claimed
by these deterministic and device smoke checks. TestFlight 29880844 predates
this integration; a later matching app build is required for this merged code.
