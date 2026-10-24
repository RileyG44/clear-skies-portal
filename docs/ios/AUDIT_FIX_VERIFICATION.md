# October 24 audit repairs

Task: recover the unfinished repairs from the **Build Fast, Precise LiDAR
Rendering** thread, merge the current work, and release matching web, internal
iOS and local Mac builds. Riley also requested removal of the native status-bar
fade so the map remains clear behind the Dynamic Island.

Authority: SPEC.md `0.1.0-draft` remains unapproved. Accepted CR-001 r1
(`35ffe7088f8f71a654fbdcfb892d1857b21135b72f7069a5b087dbbecb7d94f9`)
authorizes Stage 1/2, parity with every current web control, and internal
TestFlight for Riley. Accepted CR-002 r1
(`808d43d5bf10a8d1c7e5846f5d42b4864f6261623c121bf23cc8db2877dd919f`)
authorizes only the curvature name and description correction. The existing
Spec Owner's acceptance records are preserved, not newly approved here.
Requirement cross-references: U-04, CAP-01/02/03/06/07/08/13/14,
UX-01/02/03/04/06, RENDER-03 and DATA-06. Proposed requirements and PERF gates
are context, not an approved baseline or a claimed release acceptance.

## Scope and evidence

The source was recovered from `fix/ios-audit-findings` at `742baf0` plus its
uncommitted edits. Earlier native, satellite, Capture and theme repairs are
already in main through PR #31. No scientific kernels or source ranking are
changed by these repairs.

| Audit finding | Result |
|---|---|
| F1 Photos save permission | Added the add-only usage description to the built Info.plist. It does not request read access. The device probe verifies the shipped string; a real Save Image permission/save interaction remains unverified. |
| F2 Colors revert | Native color pickers commit the web input/change lifecycle. Spectrum and band colors persist. |
| F3 Date and empty bounds | Parsing, picker display and emission use the same UTC Gregorian calendar. Empty dates have set/clear actions and retain open-ended search semantics. |
| F4 Misleading ready state | Failed replacements stay partial; 3D status no longer borrows 2D readiness. Only explicit ready status folds to a success icon. |
| F5 Preview payloads | PNGs travel as separate, bounded image assets; routine page descriptions reference keys. Both canvas dimensions invalidate the picture cache. |
| F6 Web-process recovery | A single checkpoint in native process memory restores camera, selected place and 2D/3D mode before ready. No location checkpoint is written to disk. Full app-process termination is outside this recovery path. |
| F7 Appearance parity | Native font, text size/color, button, toggle and slider colors mirror existing web settings. Inter and its license are bundled. Layer opacity sliders use the same colors and commit accessible changes. |
| F8 Release inspection | Web Inspector is enabled only in Debug. |
| F9 Offline guidance | Connection guidance fits the client; failed empty terrain stops claiming indefinite progress. Online/offline events refresh status. |
| F10 Accessibility | Enlarged affected controls, accessible ramp adjustment and separate sun altitude/azimuth adjustments, error announcements, committed non-touch slider adjustments. Full VoiceOver, landscape and largest Dynamic Type visual review remains unverified. |
| F11 Curvature wording | Exact CR-002 name and description, including the native mirror. Calculations, units and outputs are unchanged. |
| F12 Smaller defects | Versioned suggestions reject stale picks. Native Layers groups preserve opacity and source references plus the web's layer edit buttons. Export guidance describes the system sheet; native startup caches the selected theme. |

The native `StatusBarEdge` overlay was removed at Riley's request. The map
already ignores safe-area insets and now draws directly behind the status bar.
The Electron resource list also now includes `terrain-analysis-core.js`,
`maxar-catalog.json` and `nadi1-cordilleran.json`; these were missing from the
bundled-server fallback despite being present in Pages and the installed engine.

## Acceptance checks

- `npm run verify` passed on Node **24.19.0**: static/vendor checks, all **55**
  regression scripts and **zero** dependency-audit vulnerabilities. This used
  a complete source snapshot without the ignored optional calibration corpus,
  matching CI's clean checkout. A run in the original checkout was stopped
  while hashing that unrelated local corpus; no tests were skipped or weakened.
- The actual Swift model passes date round-trip and empty/invalid-date checks
  in Pacific, Tokyo and UTC, plus appearance/image-packet decoding.
- Signed Debug compilation and installation passed on the paired **iPhone 15
  Pro Max, iOS 27.2 (24B115)**, including the clear top edge. Its current
  bundled-web version is **2026-10-24e**.
- The device route probe passes **13 routes and 3 popovers**, independently
  comparing visible panel controls against native descriptions. This caught
  two missing layer edit buttons, which were repaired before release.
- The device audit probe confirms the shipped Photos string, Inter registration,
  color persistence, image references, native slider colors and 44-point heights,
  including layer opacity sliders. The actual native recovery delegate also
  preserves the camera, mode, bearing and selected place after WebContent reload.
- The assembled, minified native-adapter harness passes in Chrome and WebKit:
  persisted colors, preview packets, stale suggestion rejection, curvature
  wording, recovery and outage state. Its final run uses deterministic network
  fixtures. The live-provider run reached a USGS CORS error and is not reported
  as a live-provider pass. Scientific or live-source accuracy is not tested by
  these adapter fixtures.
- The Electron packaging manifest includes every runtime file in the assembled
  Pages site. Final archive, upload, hosting and installed-app outcomes are
  recorded separately after those operations complete.

Per-run JSON, logs, the recovered patch and release artifacts are retained outside
iCloud Documents under
`~/Library/Developer/ClearSkiesVerification/release-2026-10-24/`.

## Remaining limits

The recovered performance measurements and scripts are included as evidence.
They report pre-existing source-replacement blanking, expiry of held image tiles
before slow replacements arrive, and duplicate render work. These findings are
not fixed by the native audit repairs. They must not be presented as passed
loading invariants or approved numerical performance gates.

Full scientific reference validation, physical-device memory/thermal/field
testing, maximum-size export and manual accessibility coverage remain outside
this verification. This is Riley's internal build, not external TestFlight,
App Store submission, BASE-001 approval or G3 acceptance. The private archived
rewrite is intentionally kept local under CR-001.
