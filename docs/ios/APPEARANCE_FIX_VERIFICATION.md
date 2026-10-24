# Native appearance repair — implementation and verification

Task: Riley's 2026-10-24 report that light/dark mode is broken. After the repair,
Riley requested a full audit of the current app by Opus 5.5 with high effort.

Authority: accepted CR-001 r1, SHA-256
`35ffe7088f8f71a654fbdcfb892d1857b21135b72f7069a5b087dbbecb7d94f9`,
supplementing SPEC.md `0.1.0-draft` (baseline unapproved). Cross-references:
U-04, UX-01, UX-02, CAP-03 and CR-001's current-web-control parity requirement.
This is implementation evidence, not a normative specification change.

## Diagnosis and repair

The existing web theme button calls `setMapTheme`, which updates the basemap,
the document's `data-ui-theme`, themed overlays and the saved choice. The native
adapter already publishes that theme in `map.theme`, and `ShellModel` decodes it.
`RootView` did not consume it: Release followed the device appearance, while only
a Debug launch argument could override native appearance. Tapping the native
theme button therefore changed the map and web controls but left native sheets,
text, glass and system controls in the old appearance.

`RootView` now derives its preferred color scheme from the reported theme and
applies it to both the root presentation and native sheets. Before the page
reports a valid theme, the system is the fallback. Existing launch-only Debug
appearance overrides remain available. The web control remains the single owner
of selection and persistence; no second preference or new theme policy was added.
The shared web/Electron theme behavior and scientific rendering are unchanged.

Acceptance checks:

- Toggling the existing theme control updates the native root, web view and
  currently presented sheet together, in both directions.
- Newly opened tool sheets and popovers use the selected appearance.
- Saved choices restore through the existing web preference. System appearance
  remains the startup fallback when no page choice has arrived.
- Existing Debug appearance overrides remain launch-only; production contains
  no diagnostic bridge endpoint.
- Signed Debug/Release builds and shared static/regression checks pass.

## Verification

Source inspection confirms that the existing control publishes the correct
selected theme, and identifies the missing native consumer. A new Debug-only
readback reports the actual UIKit traits of the root, WKWebView and presented
controller. `verify_appearance.js` drives the real theme control in both
directions, checks native traits, basemap/web state, accessible button state and
persistence, then restores the original choice. The runner's `--page` and
`--panel` options use the existing Debug presentation hooks so the same check
can cover real native sheets. It asserts that a requested sheet actually appears.

The first signed Debug build passed. Installation/runtime verification was
unavailable: CoreDevice lists the paired iPhone as **unavailable**, and launch
returned error 4016 (trusted connectivity/services could not be asserted).
Riley has unlocked the phone; another unlock request would not solve this
connection failure. The final Capture recovery rerun is pending the same
connection. No new physical-device appearance pass is claimed.

Final signed Debug compilation passed, including the Debug trait-readback hook.
`npm run check` passed. All **55** `npm test` scripts passed with Node 24.19.0
in a clean source snapshot of HEAD overlaid with these exact edits, excluding
the unrelated optional local calibration corpus. No tests were skipped or
weakened. The Python runner and async JavaScript probe passed syntax checks;
`git diff --check` passed. No new shared map behavior or assets changed.

Signed Release archive and local IPA export passed: **1.0 (29880844)**, shared
web bundle **2026-10-24c**. Packaged web assets match the prior verified Capture
build, native adapter resources match this source, and the Release executable
contains no `debug.appearance` endpoint. Xcode is uploading this internal build;
App Store Connect browser verification remains deferred at Riley's request.

Evidence is retained in
`~/Library/Developer/ClearSkiesVerification/evidence/appearance-*`.

## Reproduce on the connected iPhone

```sh
python3 ios/scripts/verify_shell_on_device.py <device-id> \
  --probe ios/scripts/verify_appearance.js --output /tmp/appearance-root.json
python3 ios/scripts/verify_shell_on_device.py <device-id> \
  --probe ios/scripts/verify_appearance.js --page terrain --output /tmp/appearance-sheet.json
python3 ios/scripts/verify_shell_on_device.py <device-id> \
  --probe ios/scripts/verify_appearance.js --panel snapshotPanel --output /tmp/appearance-panel.json
```

The probe does not capture the phone screen, activate the app or change system
settings. Run without `-cspDebugAppearance`, which intentionally forces one
native appearance for visual verification.
