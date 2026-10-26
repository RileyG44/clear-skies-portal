# Full-header downward swipes — 2026-10-25

Task: Riley's IMG_2875 request makes the entire frosted home header responsive
to downward swipes, including search, the two contextual buttons and coordinate
actions. With the keyboard open, the first swipe dismisses it; a fresh swipe
collapses the menu to the map's search capsule, matching the menu chevron.

Authority: CR-001 r1, accepted supplement to SPEC.md 0.1.0-draft (baseline
unapproved), SHA-256
35ffe7088f8f71a654fbdcfb892d1857b21135b72f7069a5b087dbbecb7d94f9.
Native chrome scope under U-04 and CAP-01; UX-02/UX-03/UX-04 are draft
cross-references. No normative, scientific, shared-engine or release-gate changes.

## Implementation and acceptance

- HomeView reports its actual header height, including conditional coordinate
  actions and the fade extension. The sheet combines that size with its own
  top position in the stationary `portal-map` gesture space, avoiding coordinate
  conversion across the navigation container. Home-header recognition no longer
  uses a fixed 72-point strip.
- A vertical downward header drag while the keyboard is open ends editing in
  this app's window. That drag keeps its keyboard-only action until the finger
  lifts, even though keyboard geometry changes during the gesture. It cannot
  also dismiss the menu.
- A new qualifying downward home-header drag with the keyboard down returns
  to the collapsed map search capsule. The header works even when the list is
  scrolled. Existing upward expansion and list-origin detent/scroll behavior
  are retained; other page/panel navigation headers retain their detents.
- A native UIPanGestureRecognizer attached to this app's window accepts only
  downward pans starting inside the measured home-header region. Its normal
  touch cancellation prevents an underlying button from activating. UIKit's
  translation can reset at recognition; direction is measured from the original
  touch position in the stationary window instead. The recognizer captures
  keyboard state at touch-down and retains that decision for the entire pan.
- Existing SwiftUI drag handling retains list detents and upward expansion;
  it leaves downward home-header pans to UIKit. Ordinary taps and horizontal
  text-field gestures retain their actions. No blanket disabled state is used.
- Earlier font colors, header spacing, material/fade and contextual button
  states are preserved.

Changed files: `RootView.swift` and `ToolsSheet.swift` only. No shared web files
change for this task.

## Verification

- The final Debug build passes all 11 header start regions on iPhone 17 Pro /
  iOS 26.0: title, text field, Go, keyboard dismissal, Clear, Copy, Maps, Earth,
  side edge, inter-control gap, and empty-search header. In each case the first
  downward pan removes only the keyboard; the fresh second pan closes the menu
  to the map search capsule. The field shifts only the normal 3–4 points after
  keyboard dismissal, rather than changing detent. No shortcut action fires.
- Evidence: `/tmp/clearskies-header-swipes/verified-current-results.json` records
  the final source hash and all 11 results. Final title/Maps/Earth screen videos
  are linked there; failed experiments remain separate and are not proof of a
  passed case. The final native pan supersedes the earlier simultaneous-only
  and temporary disabled-state approaches.
- Release archive succeeds: build 1.0 (29883178),
  `/tmp/clearskies-location-actions.xcarchive`. Internal TestFlight upload succeeded.
- Additional live checks pass: horizontal field drag keeps the keyboard/menu;
  two fast 120 ms downward pans still dismiss in separate stages; a downward
  list-origin drag retains expanded-to-medium behavior; upward header drag
  expands medium again; the fixed header closes the menu after the list has
  scrolled past the Map section. Evidence: `extra-results.json` in that directory.
- Internal-only upload succeeded at 2026-10-25 22:07 PDT; xcodebuild reports
  “Uploaded package is processing” and “EXPORT SUCCEEDED”. Log:
  `/tmp/clearskies-location-actions-upload.log`. Apple processing remains.
- Full-state Share requested later in IMG_2877 is separately held for CR-003;
  this build includes the verified swipes and existing-location actions only.
