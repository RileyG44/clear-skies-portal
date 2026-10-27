# CR-004 / CR-005 implementation and verification

Scope: accepted CR-004 r1 with placement addendum r1-a1, and CR-005 r1.
SPEC.md 0.1.0-draft remains unapproved; these accepted supplements authorize
this bounded change. Requirements: U-01/U-04, UX-02/03/04, CAP-01/04–11,
DATA-03 and CR-001 shared/native parity. No deployment or distribution.

Desktop retains the lower-left location readout as an initially collapsed
44-pixel info bubble. Native iOS replaces its upper-left terrain control in
place. Both expand into rounded tiles using their toolbar glass and show
coordinates, approximate elevation and provenance, applicable analysis,
active color keys, and actual terrain status including off/unavailable states.
Mobile web now also exposes the control at the upper left; native and mobile
web use a labelled selected location, otherwise map center. Shared sampling
and legends remain authoritative. Escape, accessible button names/state,
scrolling content, reduced motion and native Dynamic Type are supported.

Rivers & lakes retain blue in light mode and use a luminance/brightness filter
in dark mode. Captures preserve the filter, alpha, opacity and footprint,
including a pixel conversion for WebKit without Canvas2D filters. Dynamic
USGS NHD and existing dynamic reference exports request 512–768 pixels with
proportional DPI. NHD respects its supported detail scale and stages detail
above useful cached USGS coverage. Failed/stalled detail retains cached pixels;
unload cancels requests. Status distinguishes cached and detailed tiles.
Cached Esri roads/place labels keep their available native raster resolution;
the change cannot create source detail those services do not publish.

Verification recorded 2026-10-26:

- Focused readout tests pass: sampling/no-data/wrap, native selected/center basis,
  stale reading removal while moving, terrain status and capture semantics.
- Reference tests pass: proportional density/DPI, provider scale, immediate
  cached display, reversed arrival, timeout retention, unload cancellation,
  dynamic capture URLs and grey capture pixel/alpha/footprint fallback.
- Existing capture interaction tests pass.
- `npm run check` passes for build 2026-10-26b.
- Real desktop browser: lower-left 44-pixel bubble, expansion to 260 pixels,
  Escape collapse, matching toolbar backgrounds in light and dark, grey water.
  Live USGS NHD loaded 24 detailed tiles at 512 × 512 / 192 DPI after earlier
  service timeouts. Detail availability remains provider/network dependent.
- Desktop animation verification passes: 260 ms glass expansion/contraction,
  content fade, rapid reversal, app and OS reduced motion, and no residual
  animations after settling. CSS size transitions are disabled on this one
  element so they cannot interfere with its cancellable animation.
- Mobile web at 390 × 844: upper-left bubble expands to 260 pixels, shows map
  center/elevation/terrain, and collapses back to 44 pixels. Touch selected-location
  sampling is also covered by the readout tests.
- Electron development app launched against the preview engine: expansion to
  260 pixels and Escape collapse pass using the same shared client.
- Native iOS simulator (iPhone 17 Pro, iOS 26.0): final build succeeds. Upper-left
  anchor, expanded layout, light/dark toolbar glass, selected-location elevation,
  actual loading/refining status, and rendered elevation-spectrum key verified.
  The glass view is recreated between states to avoid system-glass layout drift;
  native expansion/collapse uses an anchored scale/fade and respects reduced motion.
- Native WebKit also confirms the enabled water overlay applies the same dark
  filter (`grayscale(1) brightness(1.35)`) across its 12 visible tiles.
- Latest iOS build assembles/minifies the shared site and contains the final info
  and motion rules, reference rendering, theme assets and build 2026-10-26b.
- Broader test coverage: 37 test programs passed before the glacial-object corpus
  fingerprint test stalled on iCloud-backed files. That read was stopped after
  several minutes without progress; the remaining 19 test programs were run
  separately and all passed. Thus 56 of 57 programs pass; a complete uninterrupted
  `npm test` is not claimed. Earlier disk-reserve failures are resolved: saved
  elevation and server integration checks now pass. No cache reserve or scientific
  test was weakened.

Physical-device accessibility/performance acceptance is not claimed by simulator
or deterministic checks. Live detailed labels remain dependent on provider/network
availability, and cached Esri labels retain their source resolution. All changes
are local and uncommitted; no deployment or distribution was performed.

Repository diff inspection is additionally limited by iCloud-offloaded Git packfiles
(`far too short to be a packfile`, `bad object HEAD`). No Git object repair, reset,
staging or commit was attempted. Runtime/source verification above is independent
of that unavailable Git history.
