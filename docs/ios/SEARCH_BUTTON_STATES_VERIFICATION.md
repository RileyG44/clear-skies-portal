# Contextual search buttons — 2026-10-25

Task: Riley requested two contextual buttons beside the home menu's search
field, removing the separate Close button above them.

Authority: accepted CR-001 r1, SHA-256
35ffe7088f8f71a654fbdcfb892d1857b21135b72f7069a5b087dbbecb7d94f9,
supplementing SPEC.md 0.1.0-draft (BASE-001 remains unapproved). Scope: native
chrome under U-04, CAP-01 and CAP-02; UX-02/UX-03 are draft cross-references.
This is a UI arrangement within Stage 2 and its internal-build exception.
No scientific, provider, privacy, architectural or normative spec changes.

## Required behavior and acceptance checks

| Search state | Left button | Right button |
|---|---|---|
| Empty, keyboard dismissed, no selected location | Locate | Close menu |
| Keyboard open, empty, no selected location | Go, disabled | Dismiss keyboard |
| Keyboard open, typed text | Go, enabled | Dismiss keyboard |
| Typed text retained after dismissing keyboard | Go, enabled | Close menu |
| Selected place/coordinates displayed, keyboard dismissed | Go, enabled | Close menu |

- Dismissing the keyboard retains typed text without starting a search.
- Dismissing it without text or a selected location restores Locate.
- Clearing text while focused leaves Go visible until keyboard dismissal.
- There is no third Close button beside the wordmark on the home menu.
- The right chevron retains the previous Close action: return to the collapsed
  map search capsule. Pushed tool pages retain their navigation Close controls.
- Locate and Go still call the existing native-to-web actions. An empty Go is
  disabled; selected-place and typed searches retain the existing behavior.
- Icons transition in their existing 44-point circles. Reduced Motion disables
  the replacement animation. Accessibility labels and hints follow each action.
- The continuous frosted header and its 12-point fade remain intact.

## Implementation

In `ios/Sources/Shell/Sheet/ToolsSheet.swift`, the home wordmark no longer
contains a separate Close button. The search row
keeps two stable native buttons: `focused || shell.canLoadImagery` chooses
Go/Locate, while focus chooses Dismiss keyboard/Close menu. A selected location
counts as field content even though its label is displayed as the prompt and
`query` is empty. Actions reuse `locate()`, `loadImagery()` and the existing
sheet dismissal. The unified material background is preserved.

The clear-text interaction check exposed an existing focus defect: the bridge
clicked the web Clear button, which then focused its off-screen HTML field.
That could leave a web keyboard open while the native field reported no focus.
The shared `index.html` Clear handler now focuses the HTML field only with
native-host mode off. It still calls the same `clearLoc()` in either host.
`test-coordinate-search.js` exercises that real handler in both modes; the
native no-focus assertion failed before this guard and passed afterward.
Native editing focus is retained, and ordinary web/Electron Clear behavior
is preserved. No data or rendering behavior changes.

The shared build stamp and asset URLs are synchronized to `2026-10-25c` in
`index.html`, `version.js` and `sw.js`. The Release archive includes all three
matching stamps, with no `2026-10-25b` stamp remaining in those bundled files.

## Verification

The Debug app on iPhone 17 Pro / iOS 26.0 simulator passed real-input checks
for empty/keyboard-down, empty/keyboard-open (Go disabled), empty dismissal,
typed/keyboard-open, typed text retained after dismissal, clearing while
focused (Go remains visible and disabled), empty dismissal after clearing,
Close returning to the map capsule, coordinate entry and Go opening Satellite
imagery. Exactly one Close control appears on the home menu when the keyboard
is down and none while the keyboard is open; it lives beside Search. The
wordmark has no separate button. Captured AX states, screenshots and results
are in `/tmp/clearskies-context-buttons/`.

Dark medium selected-location state also passed: Go stayed enabled, Close
was beside it and Copy/Maps/Earth remained available below. Clearing that
selected location with the keyboard already down kept the keyboard down and
restored Locate + Close. Together these are the 12 passing checks recorded in
`/tmp/clearskies-context-buttons/results.json`. Final empty-state screenshot:
`/tmp/clearskies-context-buttons/empty-dark.png`.

The UI driver twice reported TEXT_ENTRY_MISMATCH with identical expected and
observed text. Fresh AX snapshots independently confirmed the exact entered
value before continuing; no application behavior was waived. XCTest also
exposed keyboard keys without a keyboard container role in one snapshot;
the check accepts either direct keyboard-container or actual key evidence.

`node test-coordinate-search.js`, `npm run check` (build `2026-10-25c`) and
`git diff --check` passed. Debug simulator build and Release device archive
succeeded. All 55 files in the shared `npm test` chain were exercised from a
local-disk copy of HEAD with the current working changes overlaid. The full
`npm test` chain passed with `CSP_CACHE_MIN_FREE_GB=1` set only in that fixture
process and its children. This uses the existing configurable cache-reserve
setting so acquisition/server fixtures can run on a disk with about 7.2 GiB
free. The production default remains 8 GiB; no shipped configuration, code
default, test assertion or scientific tolerance was changed to obtain a pass.
The passing full-suite log is
`/tmp/clearskies-context-buttons-fixture-tests.log`.

Before configuring that fixture reserve, these two failures were independently
reproduced from untouched HEAD
`6f0ed96b08d09e9861cd94e74406a19fdf83c8cf` in a separate local copy:

- `test-wadnr.js`: acquisition check expected `pending`, received `error`.
- `test-server.js`: the engine cache disk is at its existing free-space reserve.

The first workspace `npm test` attempt stopped at the offline server startup
wait in `test-saved-elevation.js`. That test passed in the local-disk copy,
which also avoided the previously documented iCloud-backed fixture stalls.
The remaining files after the initial WADNR failure were also exercised
separately before the final full-chain pass. Initial and baseline logs are in
`/tmp/clearskies-context-buttons-local-tests.log`, individual
`/tmp/clearskies-context-buttons-test-*.log` files and matching
`/tmp/clearskies-context-buttons-baseline-*.log` files.

Physical-device appearance, GPS results, VoiceOver and the full device matrix
are not verified by these simulator checks. No G3/public-release acceptance
is claimed.

## Internal build

Internal TestFlight **1.0 (29882966)** uploaded successfully on 2026-10-25 at
18:35 PDT. Xcode reported `Upload succeeded` / `EXPORT SUCCEEDED` and the
uploaded package was processing. It supersedes 29882858. The export uses the
existing `testFlightInternalTestingOnly: true` option. Archive:
`/tmp/clearskies-context-buttons.xcarchive`; upload log:
`/tmp/clearskies-context-buttons-upload.log`.

The subsequent caret/checkmark color and header spacing request preserves these
button states. See [HEADER_COLOR_SPACING_VERIFICATION.md](HEADER_COLOR_SPACING_VERIFICATION.md),
internal build 29883061.
