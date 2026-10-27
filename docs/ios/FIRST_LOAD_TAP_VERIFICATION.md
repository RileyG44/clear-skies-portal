# First-load map selection — 2026-10-27

Scope: repair stationary first-touch place selection in the shared map; retain
finger drift tolerance, mouse clicks, double-tap imagery loading and gesture/tool
exclusions. Build `2026-10-27b`.

Authority: Riley's direct repair/shipping instruction in the current thread.
SPEC.md remains 0.1.0-draft, BASE-001 pending; accepted CR-001 r1
(SHA-256 35ffe7088f8f71a654fbdcfb892d1857b21135b72f7069a5b087dbbecb7d94f9)
authorizes the existing shared map engine and internal TestFlight. Relevant IDs:
U-01/U-03/U-04, CAP-01, UX-04, ARCH-02/03 as supplemented by CR-001, engineering
contracts 1–10. This is a defect repair within those constraints, with no spec
exception, renderer change or scientific/loading change. No routes are changed;
all 13 native tool routes retain their current controls.

## Cause and repair

The earlier investigation reproduced cold-launch failure on iOS 26, iPhone 17
Pro simulator, build 2026-10-27a. Stationary touchstart/touchend reached the map,
with no drag and no preventDefault, but WebKit omitted the compatibility click.
PR #35 only selected at touchend when a drag had prevented the click. Adding an
onclick to the hit canvas restored the click; pointer-events:none and an onclick
on the map container did not. This isolates selection's incorrect reliance on a
browser-generated click, rather than native hit testing or the search bridge.
The underlying WebKit heuristic is not claimed to be proven.

Valid single-finger taps now select directly at touchend. A short suppression
window prevents a later compatibility click/dblclick from selecting/loading twice;
real mouse pointerdown clears it immediately. Pan rejection uses peak movement,
so a drag returning to its start cannot masquerade as a tap. Pinch, cancellation,
long press, capture, point cloud and control exclusions remain.

## Regression and acceptance checks

`test-map-tap.js` executes the production event handlers. Its stationary-first-touch
assertion fails against 13e37fb's index.html (0 selections instead of 1) and passes
with the repair. It also verifies duplicate clicks, one imagery run per double tap,
subsequent mouse input, suppression expiry, drifting taps, pans/returning pans,
pinch, cancellation, long press, controls and DNR/point-cloud modes.

Acceptance: npm run check and npm test; simulator build of actual bundled/minified
site; cold launches with first stationary tap before any search/locate action,
visible dot and populated native search; then CI, merge and matching distributed
assets. Shipping results are recorded below when observed.

## Observed verification

- Node 24.19.0: full `npm run check` and `npm test` passed from
  `/Users/riley/Developer/csp-first-tap`; logs `/tmp/csp-tap-check-outside.log`
  and `/tmp/csp-tap-tests-outside.log`. The initial run inside Documents timed
  out starting a fixture server; repeating outside Documents passed unchanged.
- Xcode Debug simulator build succeeded; the app bundles the minified site.
- Installed build 2026-10-27b on iPhone 17 Pro / iOS 26.0. Repeated cold launches
  start with no dot, empty search and location version 0. The first stationary
  tap at (180,300), without locate/search interaction, produces the dot and
  `59.53432, -103.71094` in both the web field and native search; version becomes
  1. Touch traces contain touchstart/touchend and no click, directly exercising
  the reported failure path. Native accessibility confirms the populated search,
  Clear and location-actions buttons. Screenshot visually confirms dot/search.
- Raw per-run JSON, before/after native snapshots and screenshot are saved under
  `/Users/riley/Developer/ClearSkies-verification/first-load-tap-2026-10-27/`.
  Runs are named `fixed-first-tap-0`, `-1` and `-2`. The first automation attempt
  lost touchend and produced no fresh result; it was rejected, not counted.
- Physical iPhone 15 Pro Max (00008130-001658413C60001C) is reported unavailable
  by CoreDevice. No physical-device success or installed version is claimed.
