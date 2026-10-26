# iOS search Go and sheet glass correction — 2026-10-25

Implementation task: Riley's five screenshot reports on the TestFlight menu
sheet in the current T3 conversation (annotated IMG_2853, with IMG_2856 as the
clear-over-the-map reference):

1. A little black patch at the very top of the menu pane, above the
   ClearSkies wordmark, where the frost behind the title did not reach.
   The frost behind the title otherwise stays exactly as it was; Riley
   clarified this on 2026-10-25 (it is not a request to remove that frost
   or to make the area clear).
2. Same patch, stated as the frost not reaching the top of the pane.
3. The bottom of that frosted header cuts off abruptly; blur that hard
   edge/transition a little instead of a sharp line.
4. The search bar should shrink slightly for a search/enter/go button that
   can be selected when an address is in the bar, or a place is selected on
   the map but not double-tapped, to manually trigger the satellite imagery
   search for that location.
5. The menu does not reach the bottom of the menu pane.

Authority: SPEC.md 0.1.0-draft remains unapproved. This task uses accepted
CR-001 r1 (SHA-256
35ffe7088f8f71a654fbdcfb892d1857b21135b72f7069a5b087dbbecb7d94f9),
Stage 2 and its internal-build exception, with CR-002's existing wording
preserved. Relevant IDs: U-04, CAP-01 and CAP-02; UX-02/UX-03 are draft
cross-references. These are UI defect corrections within the accepted native
chrome scope, not changes to architecture, parity, science or release gates.
No normative specification edits are part of this task.

## Changes

- The floating sheet no longer reserves a 16-point top inset inside its
  frame. Its navigation stack now starts at the pane's top edge, so the
  fixed header's existing native frost — which already ignored the
  container's top safe area — finally reaches the top of the pane,
  covering the black patch above the wordmark (1, 2). The frost behind
  the ClearSkies title is otherwise unchanged: same
  `.ultraThinMaterial`, same header, and `SheetGlass` is untouched.
- The fixed header frost is masked by a top-to-bottom gradient that
  blurs it out over only its last 12 percent, so the bottom transition
  is a little softer instead of a hard line (3). Scrolled rows still
  cannot show through Search, per the menu-glass correction.
- The sheet also no longer reserves the home indicator inset inside its
  frame, so its list viewport reaches the pane's bottom edge (5). The
  home list also uses an 8-point bottom scroll-content margin, so the
  last group sits at the pane's bottom instead of above a dead glass
  strip.
- A circular Go button (`arrow.right`, "Search for satellite imagery")
  sits between the search field and Locate/keyboard-dismiss, so the field
  shrinks slightly whenever the sheet is open (4). It is enabled when the
  field has text or a place is selected on the map
  (`ShellModel.canLoadImagery`), and dimmed/disabled otherwise.
  `ShellModel.loadImagery()` looks typed text up through the existing
  `CSPNativeShell.searchText` (web geocoding, then its scene search), or,
  for an already selected place, calls the new
  `CSPNativeShell.searchSelected()`. That adapter calls the new
  `ClearSkiesPortalBridge.searchSelected` export in `index.html`, whose
  `cspSearchSelected()` runs the web's existing scene search (`run()`) at
  the selected location — exactly what a map double-tap does, without
  moving the selection or auto-applying a scene. Either way the Satellite
  imagery route then opens so scenes can be picked. No source selection,
  scientific math, loading or rendering logic is re-implemented in Swift;
  with native-host mode off, web behaviour is unchanged (the new bridge
  export is inert there). Shared build stamp bumped to `2026-10-25b`.

## Acceptance checks

1. The wordmark's frost runs from the pane's top edge: no black patch
   above ClearSkies, and the frost behind the title is otherwise the
   same as before.
2. The header frost's bottom edge is blurred a little into the sheet
   below Search/coordinates instead of a straight cut.
3. With no text and no selected place, Go is dimmed and disabled; with a
   selected place shown in the field (coordinates), Go is fully opaque.
4. `searchSelected` at a selected place returns true and runs the existing
   scene search exactly once; with no place it returns false and does not
   run it (new focused cases in `test-satellite.js`, observed failing
   before the bridge existed).
5. The home list's rows reach the pane's bottom edge in medium and
   expanded sheets; toolbar panel sheets (Terrain engine) still frame
   their title at the top and footer action at the bottom.

## Results

- iPhone simulator (Clear Skies iPhone, iOS 26.0), Debug build installed:
  dark expanded, light medium, Terrain engine panel and Satellite imagery
  route screenshots inspected; the map above the pane is crisp, the
  wordmark frost reaches the pane top and fades below Search, and home
  rows (Appearance, Layer groups label) are cut by the pane's own bottom
  edge rather than floating above a dead strip.
- Live simulator probe with a restored Spokane location
  (47.81088, -117.37989): `CSPNativeShell.searchSelected()` returned true,
  the web status reported `250 results`, 60 result rows rendered, the
  native Satellite imagery count showed 250, and Go was enabled beside the
  coordinates in the field.
- Real-input tap flow on the Release simulator build (iPhone 17 Pro,
  agent-device 0.21.31, `DEVELOPER_DIR` set to Xcode), recorded to
  `/tmp/clearskies-go-flow2.mp4` with a 23-cell contact sheet over 401 s
  (`/tmp/flow2-contact-sheet.png`; the clip includes the driver's slow
  snapshot waits, and its touch-overlay export timed out, so the raw
  video was kept). Typed case: tapped Search, filled "Spokane" (Go went
  from disabled to enabled), tapped Go, and Satellite imagery opened;
  scrolling showed "Best available, 250 scenes" and a populated scene
  list (VIIRS, HLS S30, Sentinel-2 L2A). Map-selected case: cleared the
  selection, single-tapped the map once (white selection ring at the tap,
  capsule "Search, 47.72039, -117.45827" — no double-tap), opened the
  menu to the exact reported state ("Location selected. Double-click or
  double-tap the map to load imagery", Go enabled beside the
  coordinates), tapped Go, and Satellite imagery opened with a populated
  Sentinel/HLS scene list at the new place. Repeated 600-point sheet
  scrolls in both cases settled in about 1.7–3.8 s each including the
  driver's snapshot diff; `perf frames` reports frame health as
  unavailable on iOS simulators, so no FPS figure is claimed.
- `verify_shell.js` bridge check on the same simulator build: all 13
  routes and 3 native tool panels passed with no failures.
- `node test-satellite.js`: passed, including the new selected-place cases.
- `npm run check`: passed, build `2026-10-25b`.
- Debug and Release simulator builds: `** BUILD SUCCEEDED **`.
- Full suite: every test in the `npm test` chain was exercised in the
  workspace or a local-disk copy. All passed except two failures that
  reproduce identically on untouched HEAD in this environment and do not
  touch any file changed here: `test-wadnr.js` (expected `pending`, got
  `error` at its acquisition check, also failing from a clean
  `git archive HEAD` copy) and `test-server.js` ("engine cache disk is at
  its existing free-space reserve"; the data volume has 3.5 GiB free).
  `test-glacial-object-evaluation.js` stalls for many minutes reading its
  iCloud-backed calibration corpus in this workspace and passes in
  seconds from the local-disk copy (8 checks).

## Limitations

This is an internal field-build change under CR-001, not G3 or a
public-release acceptance claim. Physical-device, VoiceOver, landscape
and full device-matrix testing are not claimed, and no simulator FPS
figure is claimed (frame health is unavailable on simulators).

## Title frost correction (Riley, 2026-10-25, after build 29882784)

Riley's side-by-side showed the first upload got this wrong: the grey
frost stopped below ClearSkies, leaving the title on transparent glass.
The cause was the new fade mask on the search header's frost rectangle:
the mask clips the rectangle's stretch up into the navigation bar on
current iOS. The frost is now one continuous area exactly as in the
original: the navigation bar itself carries `.ultraThinMaterial`
(`toolbarBackground(.ultraThinMaterial, for: .navigationBar)`, visible)
behind the wordmark from the pane's top edge, and the search header's
frost rectangle (with its slight bottom blur) sits directly below it
with no safe-area stretch to rely on. Verified on Debug (dark) and
Release (light, real tap opening the menu) simulator screenshots: one
grey area from the pane top through the title and Search, and the
Satellite page's bar is unchanged.

## Previous release

Internal TestFlight build **1.0 (29882809)** uploaded successfully on
2026-10-25 (`Upload succeeded` / `** EXPORT SUCCEEDED **`), from the
final source including the title frost correction above. It supersedes
29882784. Availability in TestFlight follows Apple's processing.

## Unified header correction (Riley, after build 29882809)

Riley's IMG_2860 and IMG_2861 physical-device screenshots supersede the
earlier visual acceptance above: the title and search still read as distinct
panes. His requested result is one frosted area from the pane's top through
Search and, when present, Copy/Maps/Earth, followed by a short transition to
the existing glass list below.

Authority remains CR-001 r1 and its digest above, supplementing the unapproved
SPEC.md 0.1.0-draft. Scope: a native home-header UI correction under U-04 and
CAP-01, with UX-02/UX-03 as draft cross-references. No normative requirements,
scientific behavior, shared engine code or release gates change.

Implementation in `ToolsSheet.swift`:

- The wordmark and Close button now occupy the same fixed native SwiftUI
  header as Search and the conditional coordinate actions. One
  `.ultraThinMaterial` rectangle covers that entire header, starting at the
  sheet's top. The home navigation bar is hidden, removing its separate
  material compositor; pushed routes explicitly restore their native bar.
- The material mask stays fully opaque until the final 12 points, then fades
  to clear. The transition has the same length with and without coordinate
  actions. The home list's automatic top scroll-edge effect is disabled so
  it cannot add another competing surface.
- Existing sheet Liquid Glass, search/Go/Locate behavior, coordinate actions,
  drag detents and route contents are preserved. Earlier uncommitted changes
  in RootView, ShellModel and native-shell.js are retained.

Acceptance evidence, 2026-10-25, iPhone 17 Pro simulator / iOS 26.0:

- Debug screenshots inspected in dark medium with coordinates, light expanded
  with coordinates, and light medium without a selection: the title and
  search share one continuous frost; the short fade follows the lowest
  visible control row. Screenshot files:
  `/tmp/clearskies-unified-header-dark-coordinates.png` and
  `/tmp/clearskies-unified-header-light-coordinates.png`.
- Real-input Satellite imagery push and Back returned to the unified header;
  the route retained its native title, Back and Close controls.
- Release build installed and opened through agent-device, with no Debug
  launch hooks. Search focused and opened the keyboard; Go was disabled
  without a selection; dismissing the keyboard kept the header intact.
  A real upward swipe moved the list from Map to its final Appearance/Settings
  group while the header stayed fixed and hid rows behind Search. Screenshot:
  `/tmp/clearskies-unified-header-release-scrolled.png`.
- Release dark appearance also checked through real input: switched the map
  theme, single-tapped a point (59.53432, -103.71094), opened Search, dismissed
  the keyboard and dragged the header from expanded to medium. Go was enabled
  and all three coordinate actions appeared under the same frost. The medium
  header had no title/search boundary; the fade followed the coordinate row.
  Screenshot: `/tmp/clearskies-unified-header-release-dark.png`.
- Existing `verify_shell.js` probe passed all 13 routes and three panels,
  including selected-coordinate and clear-location synchronization; no
  failures. The result's unique run ID is
  `header-529f9391-7800-4b6e-9478-5fe72118993c`, saved in
  `/tmp/clearskies-unified-header-shell-check.json`.
- Debug and Release simulator builds succeeded. `npm run check` passed;
  `git diff --check` passed for the affected files. This correction changes
  only native layout, so the full shared-engine suite was not rerun; its
  previous results and limitations above remain historical evidence.

Physical-device appearance still requires Riley's TestFlight check; simulator
images are not a claim that this has been verified on his phone. No G3 or
public-release acceptance is claimed.

Internal TestFlight build **1.0 (29882858)** archived and uploaded successfully
on 2026-10-25. Xcode reported `Upload succeeded` and `EXPORT SUCCEEDED` at
16:43 PDT; Apple then reported the uploaded package was processing. It
supersedes 29882809. The export retains `testFlightInternalTestingOnly: true`.
Build/upload log: `/tmp/clearskies-unified-header-testflight.log`.

The subsequent contextual-button request supersedes the home button arrangement
in this record while preserving the continuous frost. See
[SEARCH_BUTTON_STATES_VERIFICATION.md](SEARCH_BUTTON_STATES_VERIFICATION.md),
internal build 29882966.
