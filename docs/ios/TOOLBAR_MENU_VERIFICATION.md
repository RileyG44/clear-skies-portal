# iOS toolbar menu refinement — 2026-10-25

Implementation task: Riley requested removal of the redundant satellite info
button, a review and cleanup of every toolbar pop-out, and the web app's neutral
moon/sun appearance control in the current T3 conversation.

Authority: SPEC.md 0.1.0-draft is unapproved. Accepted CR-001 r1 (SHA-256
35ffe7088f8f71a654fbdcfb892d1857b21135b72f7069a5b087dbbecb7d94f9)
authorizes this Stage 2 native chrome work. Relevant IDs: U-04, CAP-02, CAP-03,
CAP-13, ARCH-01 and D-02 under CR-001; UX-02 and UX-03 are draft references.
CR-002's accepted curvature wording is preserved. The route-by-route checklist
remains STAGE2_VERIFICATION.md. No normative specification edits are part of
this task.

Scope: native toolbar, map-view chooser, Layers, image export, engine connection,
and the native adapter descriptions for these panels. Satellite information
and actions move into Layers, retaining their existing web controls. Scientific,
source-selection, loading and rendering behavior stays owned by the web engine.

Acceptance checks:

1. With satellite imagery active, no separate info button appears. Layers retains
   source/date, opacity/reset, imagery status, fill/clear actions and source links.
2. Layers has readable layer cards, bounded sliders, clear source disclosures and
   attribution. Export has legible resolution choices, map-info explanation and
   reachable Capture/Select Area actions. Engine has a clear address field,
   connection state and correctly described saved-address actions.
3. Map-view options have consistent icons, descriptions and a separate selection
   indicator. Dock reordering still works with the removed info button.
4. Appearance uses the web's current-state convention: moon in dark mode, sun in
   light mode. Its glyph stays neutral, including when dark mode is selected.
5. Verify light/dark, scrolling, keyboard entry, larger text, native bridge control
   coverage, Debug/Release compilation, and the existing required checks.

## Results

Final internal TestFlight: **1.0 (29882604)**. Its archive and final simulator
build passed, and the upload ended with `Upload succeeded` / `EXPORT SUCCEEDED`.
Availability follows Apple's processing. Candidate 29882588 uploaded earlier, then
the final light-mode review caught a popover contrast issue. The replacement
explicitly sets the popover's selected appearance and was visually verified in
both modes before uploading. The simulator has this final Debug build installed.

The panels now use native cards with consistent headings, bounded sliders,
source disclosures and clear action labels. Export and Connect occupy their own
footer space, so scrolling text cannot draw beneath the buttons. The engine
address forwards live input before Connect reads it. The map-view chooser keeps
each mode's icon and shows selection separately. Appearance uses a neutral moon
in dark mode and sun in light mode, as the web client does.

Evidence directory:
`/Users/riley/Developer/ClearSkies-verification/toolbar-2026-10-25/`.

- Debug build and signed final Release archive passed. The only Release warning
  is Xcode's skipped App Intents metadata extraction because this app has no
  AppIntents dependency. Shipping archive: `ClearSkies-toolbar-contrast.xcarchive`.
- `toolbar-bridge-1.json`: all 13 routes and 3 panels passed, including their
  native control inventories and persisted dock reordering.
- `toolbar-layer-navigation.json`: layer titles open the correct native editor;
  active-layer menus contain no duplicate Edit actions.
- `toolbar-live-focused.json`: live Sentinel-2 scene metadata/actions in Layers,
  reopening twice, controls at zero opacity, opacity reset and native slider
  bounds passed. The exact local probe is retained with the evidence.
- Screenshots and interactions cover light/dark appearance, the moon/sun switch,
  export resolution menu, layer cards, engine address keyboard and larger text.
  The engine keyboard leaves Connect reachable and the sheet floating. Test text
  was cleared and the simulator's original text-size setting restored.
- `npm run check` and all 55 `npm test` scripts passed. Shared UI/static assets,
  service-worker and build stamp `2026-10-25a` match the preceding verified local
  source copy. No web, Mac app, terrain processing or loading code changed.
- Final source hashes match the build copy (`source-digests-final.json`). Upload
  evidence is `upload.log`; the original native simulator screenshot path was
  used when T3/XCTest accessibility captures timed out. Final light/dark map-view
  screenshots are `map-mode-light-final.png` and `map-mode-dark-final.png`.

## Limitations

The broader existing satellite probe is retained as a failed result in
`toolbar-satellite.json`: it assumed an initially disabled Auto Fill preference,
and its context-layer request timed out. The focused toolbar check explicitly
sets that test preference and verifies the requested UI behavior. This does not
resolve or pass the broader satellite loading checks. No scientific or loading
behavior was changed to obtain a pass.

Physical-device, VoiceOver, landscape and full device-matrix acceptance are not
claimed. This is an internal field build under CR-001, not G3 acceptance. The
Mac and local web engine already carry the matching shared build; these changes
apply only to the iOS client.
