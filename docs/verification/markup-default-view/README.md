# Markup pane and fresh startup verification — 2026-10-28

Branch: feat/markup-pane-default-view, based on origin/main e403983 (PR #42).
Scope: CR-009 and CR-010, accepted by dedicated Spec Owner sessions. SPEC
0.1.0-draft remains unapproved; these bounded supplements do not approve the
baseline. Affected requirements: U-03, UX-01, CAP-01/03/05/06/09 and CR-001/003.
No scientific calculations, source selection, loading policies or release gates
changed. PR #38 selection and PR #42 startup readiness paths remain in place.

## Behavior

Markup uses the existing FloatingToolsSheet, including its detents, drag,
animation, dismissal and hit geometry. Only markup is exempt from automatic
sheet closure during drawing; other tools retain their behavior. All markup
controls forward to the existing DOM/model, including auxiliary choices.
Web/Electron retain their existing map-click dismissal behavior.

Fresh startup hydrates the real Topographic preset at 100%, Rivers and lakes
at 60%, with no extra overlays, empty search and no location/marker. Eligibility
is decided before preference hydration: saved map/layer/search state, native
recovery and any csp fragment (even invalid) suppress the new defaults. Theme,
engine address and layout alone do not. Default fitting runs only at startup;
subsequent resize/user/shared cameras are not reset.

## Camera derivation and visual evidence

Reference: Riley's 1290x2796 screenshot and 430x932 export. The screenshot is
3x a 430x932-point viewport. Known marker ring centroid is approximately
(640.5,1462.5) physical pixels, or (213.5,487.5) points. The 49-degree border
independently indicates zoom about 4.51. At chosen reference zoom **4.5**, inverse
Web Mercator gives center **41.637234,-112.985268**. Actual Leaflet projection
places the known point at (214,488), within approximately one reference point.
Coordinates are screenshot-derived, not Riley-supplied survey precision.
The export cursor coordinates were not treated as the camera center.

The iPhone 16 Pro Max simulator is 440x956 points: fit zoom 4.5331668639.
Leaflet rounds camera pixels; observed center was 41.652697,-113.008632.
Coastline, Baja, Great Salt Lake and Rockies occupy the corresponding region;
this is a visual comparison, not a quantified independent multi-landmark fit.
Desktop 1440x900 reserves the open sidebar; landscape 932x430 fits the reference
extent with additional horizontal context. Screenshots: default-pro-max.png,
default-desktop.png, default-landscape.png.

Initial live terrain colors differ from the reference during existing provider
refinement; some upstream requests returned 500/503 and ocean tile boundaries
were visible. The actual existing topo preset is used; scientific rendering
was not altered to force screenshot colors.

## Simulator interactions

Separate QA bundle identifiers and an isolated local engine/markup directory
were used; existing user app/layers were not modified. Through device_list,
device_open and the returned exact agent-device launcher:

- Half pane: actual map tap created a pin, text entry saved it.
- Half pane: actual swipe drew a pen stroke and saved its LineString.
- Half pane: Select selected the stroke; actual drag changed its coordinates.
- Half pane: dragging empty map in Select mode panned the map.
- Pane expanded through its existing drag affordance and closed with its close
  button; selection persisted sensibly after dismissal.
- Evidence: markup-selected-half.png, markup-expanded.png, markup-closed.png,
  placed-markup.json (real isolated engine response after editing).

These interaction screenshots precede the final SF Symbol mapping correction;
that correction compiled successfully. Repeated simulator shutdowns interrupted
final reinstallation checks. Explicit two-finger pinch and a fresh manual pass
of camera/layers/engine panes remain unverified on simulator; their shared sheet
and map gesture implementations were not changed. Physical-device/TestFlight
verification was not performed. No release acceptance is claimed.

## Checks

- npm run check: passed, build 2026-10-28c.
- npm test: 65 passed, 0 failed (supported Homebrew Node 23.11).
- python3 -m unittest discover -s ios/scripts -p 'test_*.py' -v: 13 passed.
- Debug iOS simulator xcodebuild: BUILD SUCCEEDED, final symbols included.
- git diff --check: passed.

Tests use CSP_CACHE_MIN_FREE_GB=1 only to accommodate this Mac's free space;
production cache reserve was not changed. New tests cover fresh eligibility,
share/recovery precedence, aspect fitting, real topo hydration, native/browser
map dismissal and markup control groups. Existing scientific/loading suites pass.
No push, main modification, deployment or TestFlight upload.
