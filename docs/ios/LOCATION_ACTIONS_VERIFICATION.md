# Collapsed location actions and loading color — 2026-10-25

Task: Riley's IMG_2877 request. Empty collapsed search shows Locate only;
selected location shows an up/down toggle and an ordered location-action stack.
The terrain loading spinner follows menu font color instead of button accent.

Authority: CR-001 r1, accepted supplement to SPEC.md 0.1.0-draft (baseline
unapproved), SHA-256
35ffe7088f8f71a654fbdcfb892d1857b21135b72f7069a5b087dbbecb7d94f9.
Native chrome under U-04/CAP-01/CAP-02. UX-02/UX-03/UX-04 are draft references.
No normative or scientific changes. Full location/layer-state web sharing is a
new opt-in web capability, held for exact CR-003 r1 approval and owner acceptance.

## Implementation

- TerrainStatusCapsule resolves ProgressView tint from portalAppearance.fontColor
  with the same dynamic primary fallback as menu text. Existing status logic stays.
- SearchCapsule shows Locate alone without a selected location. A selection shows
  Show location actions; expanded it becomes Hide location actions. Clearing the
  selection and opening the full menu reset the expanded state.
- Above the toggle, bottom to top: Go, best satellite image, Copy coordinates,
  Google Earth, Google Maps. Share is held for CR-003, not represented by a
  nonfunctional button. Existing menu shortcuts and search-row behavior remain.
- Go calls the native adapter's centerSelected command, moving the current 2D or
  3D map to the committed selection at the current zoom without a scene search.
- Best imagery first centers, then calls the existing searchBestImagery function.
  Scientific ranking, scene application and Auto-fill behavior remain in the
  existing engine. Auto-fill is already checked by default; prefs version 2
  preserves an explicit saved opt-out, while old implicit-off prefs migrate on.
- Controls have 44-point or larger targets, accessible names, reduced-motion
  transitions, and vertical overflow scrolling for short available heights.

## Verification

- Current Debug simulator build compiles and installs successfully.
- npm run check and all 55 shared test files passed in a byte-verified local
  copy. CSP_CACHE_MIN_FREE_GB=1 was supplied only to test fixture processes
  because the host has less than the production default 8 GiB free. Production
  reserve, assertions and tolerances are unchanged (same environment issue
  reproduced on baseline in the previous button-state task).
- test-satellite.js executes the actual native adapter command in 2D and 3D:
  Go centers exactly, preserves zoom/camera parameters, and makes zero scene
  searches; best imagery centers then invokes the engine once. Missing selection
  does nothing. Additional checks execute real loadSearchPrefs for default/on/off
  and legacy cases. All pass.
- Live iPhone 17 Pro / iOS 26.0 UI checks pass: selected collapsed state initially
  exposes only the toggle; tapping opens the five authorized existing actions in
  exact order; Go places the selection at pixel offset 0 from map center at the
  existing zoom with zero STAC/catalog requests. Down-toggle hides the stack and
  clearing the location leaves Locate alone. Evidence: `/tmp/clearskies-location-actions/stack-result.json`,
  `selected-collapsed.png`, `selected-expanded.png`, `empty-locate-only.png`.
- Real USGS terrain loading, without response/status mocks, was recorded with
  red accent #ff2d55: spinner is white in dark mode, dark gray in light mode, and
  gold with custom font #d6a35c. The ready seal has the same font color. Loading
  state is confirmed in each Debug result and the videos include actual loading
  frames. Evidence: `spinner-dark.png`, `spinner-light-loading.png`,
  `spinner-dark-custom-loading.png` and corresponding videos/JSON in the same
  temporary directory. The first light PNG captured the ready seal after a fast
  cached load; its video is the spinner evidence.
- Copy is verified against the simulator pasteboard: two downward swipes starting
  on Copy preserve a sentinel; an ordinary tap on the collapsed stack copies
  exactly `60.000000, -100.000000`. The original pasteboard is restored. Evidence:
  `copy-result.json` in that directory.
- Release archive 1.0 (29883178) succeeds. Current Swift sources are verified
  against the build mirror; archived native-shell.js is byte-identical to the
  working source. Internal TestFlight upload succeeded at 2026-10-25 22:07 PDT;
  Apple reports package processing. Log: `/tmp/clearskies-location-actions-upload.log`.
  Share-link roundtrip remains held for CR-003 acceptance.
- The actual native imagery button was exercised with real providers and a
  historical date range, with Auto-fill explicitly off. Its engine call sees
  the selection at pixel offset 0 from map center; existing searchBestImagery
  returns applied=true and installs its selected MODIS Terra true-color scene
  dated 2025-08-31 (reported 820 ft), while Auto-fill remains false before/after.
  This verifies native command ordering and preference retention, not a new
  scientific ranking or a high-resolution guarantee. Evidence: `imagery-result.json`
  and `imagery-result.png` in the temporary verification directory.

## Handoff and remaining scope

Internal build 1.0 (29883178) contains the spinner, five existing location actions,
and full-header swipes. The only requested feature held is full-state Share;
CR-003 r1 is drafted and Riley's approval question remains pending. No Spec Owner
has been restored or claimed to have reviewed it. No web share payload, reader,
nonfunctional Share button or public deployment has been implemented.

The simulator's original meadow appearance and saved search preferences,
including Auto-fill on, were restored after testing. The native location stack
is left open over real USGS terrain for review; `final-location-actions.png` and
`restored-prefs.json` record that state. The physical phone was not changed by
simulator testing. Internal TestFlight availability follows Apple processing;
these checks do not establish a paid-release or performance gate.
