# Native shell implementation and verification

Date: 2026-10-23
Branch: `ios/native-shell`
Task: resume the interrupted Stage 2 UI work, verify the expanded glass sheet,
repair discovered bridge omissions, and prepare the authorized internal build.

## Authority and scope

`SPEC.md` remains `0.1.0-draft`, unapproved. This work uses accepted **CR-001 r1**
as its implementation authority, with binding SHA-256
`35ffe7088f8f71a654fbdcfb892d1857b21135b72f7069a5b087dbbecb7d94f9`.
It does not approve BASE-001 or resolve the remaining product decisions.

Requirement references: U-01, U-03, U-04; UX-02/03/04/06; ARCH-01/04;
CAP-01 through CAP-14 as the parity reference; CR-001 conditions 1–7 and the
scientific/loading contracts in `docs/ENGINEERING_REVIEW.md`.

Acceptance checks for this task:

- Build the SwiftUI shell with the existing bundled map/science code.
- Preserve the smaller Dynamic Type text, monochrome symbols, grouped LiDAR
  and Elevation controls, separate slider tracks and trailing switches Riley
  requested in the conversation.
- Keep the expanded sheet transparent over the map, follow system appearance,
  and apply the darker glass tint in dark appearance.
- Describe all 13 routes and retain engine/export/layers popover inputs and
  actions. Native-host changes stay opt-in.
- Pass the web static and regression checks, build/install on the paired
  iPhone, and produce a signed internal distribution archive.
- Record remaining web controls and unverified behavior explicitly.

## Recovered state and repairs

Opus left the Stage 2 implementation uncommitted: native search, navigation,
13 route renderers, map dock and popovers; the JSON adapter; minified bundling;
compact styling and the LiDAR/Elevation regrouping. Its final sheet change
was a custom expanded detent at 90% of available height, transparent list and
navigation backgrounds, and a system Liquid Glass presentation background.
Its earlier archive/export succeeded, but it had not completed an upload.

The takeover reproduced the translucent expanded sheet in the Mac's
"Designed for iPhone" app. It also found a functional omission: hiding web
popovers with `display:none` removed their layout boxes, so the native engine
panel lost its address field and Connect button. Popovers now stay laid out
off screen, like the sidebar, with their `[hidden]` state preserved. The
native adapter can distinguish conditional controls again. Off-screen copies
are marked `aria-hidden` to avoid duplicate VoiceOver controls. Popover status
text is a subtitle instead of a clipped leading toolbar item.

The unrelated server test assumed `/api/health` was smaller than the
compression threshold. Diagnostics had grown beyond it. The test now uses
the deterministic nine-byte `not found` response for the tiny-body check;
existing large-response compression and byte-for-byte decompression checks
remain. No server, terrain, source-selection or numerical code changed.

## Route checklist

"Described" below means the installed Debug app's real WKWebView and native
adapter returned nonempty controls for that route. It is not end-to-end proof
of every action, conditional state, dataset or scientific output.

| Route | Native UI in this build | Remaining web surface / verification limit |
|---|---|---|
| Layers | Layer cards, visibility, opacity, actions and ordering controls | Map rendering remains web; described on device. |
| Satellite imagery | Place/coordinate search, filters, scene groups/results and actions | Dated scene display/download not rerun in this task; described on device. |
| LiDAR | Styles, Looks, stack/editor, palettes/ramp, lighting, effects, source and download controls | Point-cloud viewer controls and on-map download selection remain web; described on device. |
| Elevation | Reference/range, palette, spectrum, thresholds/colors, band controls and Reset | Rendering remains web; threshold, color and Reset references checked on device. |
| Analyze | Native groups and parameter controls | Analysis algorithms/jobs remain shared code; described, no new analyses run. |
| Export | Native route and map export popover, resolution, map-info switch and capture/select actions | Area-selection handles/bar remain web; controls checked, no new export performed. |
| Conditions | Native groups, switches, source text and opacity | Live provider responses/freshness not revalidated; described on device. |
| Geology & hazards | Native overlay and research controls | Map identification content remains web; described on device. |
| Past landscapes | Native overlay controls and context | Dataset interpretation unchanged; described on device. |
| Labels & reference | Native reference-layer switches and opacity | Map labels remain web; described on device. |
| Markup | Native layer cards, switches and available actions | Drawing/editing toolbar and on-map editor remain web; described on device. |
| Appearance | Native choices, switches, colors and accessibility preferences | Map theme remains independent of native system appearance; described on device. |
| Settings | Native engine/export/preferences controls and credits | Engine address remains entered/stored on the device; described on device. |

Map dock and map-mode selection are native. Engine, layers and export
popovers were checked against their actual visible web inputs, including
the formerly missing controls. The displayed-scene popover has a native
renderer but was not exercised with a selected scene in this task.
The remaining web surfaces are implementation work still to complete under
Stage 2, not approved release deferrals.

## Verification evidence

- `npm run check`: passed (static assets and inline scripts).
- `npm test`: all **53 test scripts passed**, including server integration and the GPU terrain,
  loading, cache, 3D, point-cloud, export and numerical regression scripts.
- Native adapter/host syntax checks and `git diff --check`: passed.
- Xcode 27.1 / iOS 27.1 SDK: Debug builds for iPhone and "Designed for iPhone"
  succeeded. The paired iPhone 15 Pro Max runs iOS 27.2 (24B115); the current
  Debug build installed and launched successfully.
- Real-device bridge probe: **13 routes and 3 popovers passed, no failures**.
  It runs the actual bundled page without mocked providers, screen capture,
  analyses or export. The reproducible runner is
  `ios/scripts/verify_shell_on_device.py`; results include a unique run ID.
- The rebuilt Mac compatibility app also showed the restored engine address
  field, Connect button and status subtitle. Its expanded engine and LiDAR
  sheets retained glass; scrolling LiDAR showed separate slider labels/tracks.
  The off-screen web sidebar no longer appeared in its accessibility tree.
- Actual iPhone captures showed the expanded LiDAR page in light appearance
  and the dark glass dock/search over live rendered terrain. Expanded dark
  sheet appearance was observed on the Mac build; a final on-phone visual
  pass for both appearances is still required. Screenshots alone do not
  establish scientific accuracy or performance.
- Release archive and local internal IPA export succeeded, build **29880283**.
  Distribution remains internal-only via `testFlightInternalTestingOnly`.

The device-panel feature is disabled and there is no installed Simulator
runtime. Verification used Xcode's direct paired-device tools and the Mac
compatibility build. The on-device probe runs without activating the app,
so it does not need to take over the phone's screen.

## Remaining work and release limits

**Internal TestFlight upload succeeded at 21:53 PDT on 2026-10-23.**
Xcode reported `Upload succeeded`, `Uploaded package is processing`, and
`EXPORT SUCCEEDED` for version 1.0, build 29880283.

Follow-up on 2026-10-23 after Riley signed in to the shared browser:
App Store Connect confirmed **Ready to Test** for this build. The internal
group **Riley** was created with automatic distribution enabled, and its
Builds tab shows 1.0 (29880283), Internal, Ready to Test. Riley's existing
Account Holder account is the group's only tester; its invitation status is
**Invited** (10:17 PM PDT). No additional testers were added. Accepting the
invitation and installing through the TestFlight app remain Riley's next
steps; TestFlight installation has not been observed.

The missing app record was created through Xcode's existing signed-in account,
using the project's full name **Clear Skies Portal** because both "Clear Skies"
and "ClearSkies" were already in use. Bundle ID: `dev.riley.ClearSkies`.
App Store Connect app ID: `6826495925`. Browser sign-in was not needed for
record creation or upload. No App Store submission or external testing was
performed.

The signed archive, exported IPA and per-run bridge result are retained on
this Mac under `~/Library/Developer/ClearSkiesVerification/`, outside iCloud
Documents and the repository. The build folder is `build-29880283`.

Full Safari/app viewpoint parity, every conditional native action,
point-cloud stress/lifecycle checks, markup drawing, selected-scene display,
export/sharing, offline interruption/recovery, VoiceOver/Dynamic Type and
landscape/keyboard testing remain unverified in this task. Physical-device
frame timings, thermal/memory measurements and independent scientific
reference validation were not performed. No PERF gate or G3/G4 acceptance
is claimed, and no public deployment, pricing or feature omission is approved.
