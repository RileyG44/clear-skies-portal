# Header text colors and spacing — 2026-10-25

Task: Riley's IMG_2872 report asks for the search caret and top-left ready
checkmark to match the menu's font color, about half the wordmark-to-search
gap, and a frost fade slightly lower, centered above the first section label.

Authority: accepted CR-001 r1, SHA-256
35ffe7088f8f71a654fbdcfb892d1857b21135b72f7069a5b087dbbecb7d94f9,
supplementing SPEC.md 0.1.0-draft (baseline unapproved). Native UI scope under
U-04 and CAP-01; UX-02/UX-03 are draft cross-references. No normative spec,
source-selection, rendering, science, pricing or release-gate changes.

## Changes and acceptance

- SearchBar's TextField tint resolves the same font-color setting and dynamic
  primary color as PortalPrimary. Its caret follows menu text, independently
  of the button accent, including an explicitly chosen font color.
- The terrain-ready checkmark uses PortalPrimary rather than the accent tint.
  Its ready/loading/partial/error state logic is preserved.
- The wordmark's minimum row height changes from 56 to 48 points and the
  search block's 12-point top padding is removed. At default type size this
  reduces the ink-to-control gap by about 16 points, roughly half its prior
  size. Search and other control hit areas remain 44 points.
- The one continuous material background extends 8 points below the header's
  layout bounds. Its final 12-point fade therefore sits lower in the existing
  gap before the section label, without increasing that gap or pushing the
  list down. The extension does not intercept touches.
- The contextual Locate/Go and menu/keyboard-dismiss actions are preserved.

Only native Swift files `ToolsSheet.swift` and `MapChrome.swift` change for
this task. Shared web files and the existing `2026-10-25c` bundle are unchanged.

## Verification

- Debug iPhone 17 Pro simulator / iOS 26.0: reproduced the old pink caret and
  pink ready checkmark with button accent `#ff2d55` and automatic font color.
  Before screenshot: `/tmp/clearskies-header-polish-before.png`.
- Installed the corrected Debug build and checked the same view with the same
  accent. Dark mode shows a white caret and white checkmark. Light mode shows
  a dark caret/checkmark. With custom font color `#d6a35c`, the wordmark, menu
  text, caret and ready checkmark all follow that gold color while the button
  accent remains pink. Screenshots:
  `/tmp/clearskies-header-polish-dark-caret.png`,
  `/tmp/clearskies-header-polish-light.png`,
  `/tmp/clearskies-header-polish-custom-font.png`.
- The ready state was real: the app's existing controls selected Hillshade at
  47.66, -117.4, zoom 12. Each check waited for the existing status to report
  `Terrain ready · 100% of loaded tile positions · USGS 3DEP elevation`.
  No fabricated status or mock data was used. JSON state readbacks use unique
  run IDs and sit beside the screenshots as `*-state.json`.
- Before/after 402×874 screenshots at 1× measured about 30 points between the
  bottom of the wordmark's white ink and the search control, then 14 points
  afterward. The search control moves up 20 points, the wordmark ink moves up
  4 points, and the search-to-section-label gap stays the same. The fade is
  visibly lower within that gap, without adding another material pane.
- Focused empty search still presents disabled Go + Dismiss keyboard in the
  same two circles; control hit areas and the prior contextual button logic
  remain unchanged.
- Debug simulator build and signed Release archive passed. `git diff --check`
  passed for the two Swift files. No new tests were added for this visual
  adjustment. Shared files are unchanged from the preceding task's passing
  55-test fixture run; that suite was not repeated for this native-only change.

Physical-device appearance, VoiceOver, and the full device matrix remain
unverified. This internal build is not G3 or public-release acceptance.

The simulator's original appearance settings, terrain style and viewpoint
were restored after the visual checks. Readback confirmed automatic font
color, no custom button accent, and the original Off terrain style.

Internal TestFlight **1.0 (29883061)** uploaded successfully on 2026-10-25 at
20:09 PDT. Xcode reported `Upload succeeded` / `EXPORT SUCCEEDED` and Apple
reported that the package was processing. It supersedes 29882966. Export
retains `testFlightInternalTestingOnly: true`. Archive:
`/tmp/clearskies-header-polish.xcarchive`; upload log:
`/tmp/clearskies-header-polish-upload.log`.
