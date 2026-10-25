# iOS menu and glass correction — 2026-10-25

Implementation task: correct Riley's five screenshot reports in T3 thread
1891e37e-368d-421e-b7b0-7c5121f6edc6, user message
93bb86a7-a69d-4b12-9996-d4a587f71c91 (activity 570), and the reported failed
fix in messages 2ca3d21d-2cde-4fd3-afb5-c8fb3bf95445 and
28f5f964-63b4-4d9b-9b85-cfe6bb4acab0. Existing authorization to commit,
upload internal TestFlight and update local apps: user message
d206050a-3f7f-4067-a17f-0891fc50ea2f (activity 802).

Authority: SPEC.md 0.1.0-draft remains unapproved. This task uses accepted
CR-001 r1 (SHA-256
35ffe7088f8f71a654fbdcfb892d1857b21135b72f7069a5b087dbbecb7d94f9),
Stage 2 and its internal-build exception, with CR-002's existing wording
preserved. Relevant IDs: U-04, CAP-01 and CAP-13; UX-02/UX-03 are draft
cross-references. These are UI defect corrections within the accepted native
chrome scope, not changes to architecture, parity, science or release gates.

## Prior build audit

- Commit a536cac changed six iOS files, including the native bridge. The upload
  log at /tmp/csp-testflight-a536cac.log records a Release archive from this
  checkout and successful upload of internal build 29882017.
- The earlier handoff explicitly left scroll-under-search and keyboard behavior
  untested. Successful compilation/upload did not verify those reported defects.
- Reproduced on the existing iPhone 16 Pro Max simulator, iOS 26.0: action
  capsules remain about 32 points high; the toolbar and sheet use different
  glass/tint implementations; tapping Search lifts the expanded sheet from
  y=149 to y=62. Typing works, but the keyboard-dismiss control fails to appear.
- T3 device discovery fails because the host selects CommandLineTools rather
  than Xcode. Direct agent-device 0.21.25 with DEVELOPER_DIR set to Xcode can
  operate this simulator without a Simulator.app window. XCTest snapshot
  traversal sometimes exceeds its watchdog; native snapshots and screenshots
  plus coordinate interactions provide the fallback when that occurs.

## Acceptance checks

1. LiDAR Save/Cancel/Save current and Capture/Select Area render as legible,
   appropriately sized native action controls; Map info has a separate caption.
2. Scrolling the home menu in both appearances never draws readable row text
   over Search. Search stays in its existing position within a frosted header.
3. Sheet, toolbar, Search and Locate share the same system glass treatment in
   light/dark mode; scrolling does not unexpectedly switch to a dark plate.
4. Search and route text fields retain a floating, rounded glass sheet when the
   software keyboard opens. Suggestions and form inputs remain usable; keyboard
   dismissal and sheet resizing still work.
5. Debug and Release builds succeed; native bridge control/parity checks pass.
   Any changed shared code requires npm run check and npm test, plus the matching
   iOS web bundle. Record actual results and limitations below before shipping.

## Results

The native sheet now shares the map's SwiftUI composition surface and keeps
system Liquid Glass at both heights and above the keyboard. It no longer enters
UIKit's opaque full-height modal presentation. Search, Locate and the map dock
use system Liquid Glass; controls inside the glass sheet use its clear variant
to avoid stacking a second dark scrim. No flat-fill substitute remains for those
controls. The fixed Search header has native material frost behind its whole
area. Grouped rows retain their translucent card treatment while scrolling.

Action capsules use the large native glass button size. Captions remain outside
the capsules, and pressed actions retain a visible checkmark and accessible
state. Tool-search and status rows receive the same card background as the
other menu rows. The toolbar fades and moves right while the menu rises and
returns when it lowers, with hidden controls removed from hit testing and
accessibility. Compact-height layouts use the expanded height. Sheet movement
honors Reduce Motion. List gestures expand a medium menu and collapse at the
top of its scroll content; horizontal controls keep their own gestures.

Verification evidence is in
`/Users/riley/Developer/ClearSkies-verification/menu-glass-2026-10-25/`:

- iPhone 16 Pro Max simulator, iOS 26.0: light/dark menu, expanded/scrolled
  header, Search text entry with Seattle suggestions, keyboard dismissal,
  LiDAR Save/Cancel and Capture action controls were exercised. Screenshots
  and recordings are retained. Follow-up interaction results are recorded
  below as the final build is installed.
- `verify_shell.js`: passed all 13 routes and 3 native tool panels, with
  control inventories and no failures (`bridge-final.json`).
- `verify_appearance.js`: passed light/dark web, root and sheet trait checks
  (`appearance-final.json`).
- `npm run check`: passed, including static assets and build stamp
  `2026-10-25a`. All 55 `npm test` scripts passed in the clean source snapshot
  with these shared asset changes. The only shared changes are matching build
  query strings and service-worker/version stamps; no scientific or loading
  behavior changed.
- Signed Release archive and local distribution export passed for the first
  verified candidate. The final archive incorporates the review corrections
  above; its upload result is recorded below. Production adapters match source,
  and Release contains neither `debug.appearance` nor `debug.navigation`.
- The installed Mac app was replaced with the verified packaged app and
  relaunched. Its packaged static assets and the running local engine assets
  match the source snapshot byte for byte, including build `2026-10-25a`.
  The prior app and the three replaced runtime assets are retained for rollback.

Review findings were implemented by the coordinating agent. The read-only
review agents were stopped; they are not Spec Owners and approved no exception.
This remains an internal field build under CR-001, not G3 or a public-release
acceptance claim. Physical-device, VoiceOver and full device-matrix testing are
not claimed by these simulator checks.

## Final release

Final native Debug build and signed Release archive passed. Internal TestFlight
build **1.0 (29882545)** uploaded successfully; the final nested-glass correction
is included in **1.0 (29882550)**. The final upload log is
`/tmp/csp-menu-glass-upload-final.log`; shipping archive:
`ClearSkies-nested-glass.xcarchive` in the evidence directory.

GitHub `main` implementation commit: `68b2f8152d369470f70a665af3ef6a6fc792d3ae`.
Its CI run `40219566712` passed Linux checks/tests/audit, Windows checks/tests,
and GitHub Pages deployment. The live site's uncached `version.js` reports
`2026-10-25a`. The native-only nested-glass follow-up and this final record ship
in the subsequent commit; shared shipped bytes remain identical.

The final simulator installation includes all review corrections. A list-origin
drag expanded the menu while hiding the toolbar; the fixed search frost kept
scrolled row text below the field. Search suggestions, keyboard dismissal and
both header drag directions were exercised. T3's embedded Device panel is open
on the existing simulator for Riley; no additional simulator was created.
