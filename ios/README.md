# Clear Skies for iPhone

The native iOS app, built under [CR-001](../docs/ios/change-requests/CR-001-native-shell-with-web-engine.md).
Read that request, its conditions and [AGENTS.md](../AGENTS.md) before changing
anything here.

## How it works

The map engine is the web client itself: the same `index.html`, Leaflet, GPU
terrain shaders, MapLibre 3D, Potree point clouds and research modules that
GitHub Pages and the Mac app serve. Nothing scientific is re-implemented in
Swift. The app adds the iOS layer around it:

- `SiteSchemeHandler` serves the bundled client at `clearskies://app/`.
  WebKit treats that scheme as a secure context, so modules, workers,
  WebAssembly, the clipboard and geolocation work as they do on https.
- `EngineProxy` forwards the page's relative `/api/...` requests to the terrain
  engine at the address entered in the app's engine box. The page never makes a
  cross-origin request, so `server.js` needs no change. Without an engine the
  client uses its public sources, exactly as the hosted web client does.
- `native-host.js` runs before the page and defines `window.CSPNativeHost`. Web
  code checks for it (`NATIVE_HOST` in `index.html`); without it, the web
  client behaves exactly as before. Geolocation goes through Core Location.
- `WebHost` handles links out of the app, dialogs, exports (downloads become a
  share sheet) and recovery if iOS ends the page's process.

The current Stage 2 build draws search, the map dock, the tool sheet, all 13
tool routes and the engine/layers/export/scene popovers in SwiftUI. The web
controls stay laid out off screen as the bridge's source of truth. Map
selections, the markup drawing toolbar and point-cloud viewer controls remain
web controls at this stage. See [the implementation checklist](../docs/ios/STAGE2_VERIFICATION.md)
for verification and remaining work; this is an internal build, not a parity
or release-gate acceptance claim.

The bundled site is the GitHub Pages artifact. `scripts/assemble_site.py` reads
the file list from the "Assemble the static site" step in
`.github/workflows/ci.yml` at build time, so the app ships whatever Pages ships.

## Build and run

Requirements: Xcode 27 or later, [XcodeGen](https://github.com/yonaskolb/XcodeGen),
and `Config/Local.xcconfig` containing your team ID (copy
`Config/Local.example.xcconfig`).

```
cd ios
xcodegen generate                 # after changing project.yml
scripts/run-on-iphone.sh          # build, install and open on the paired iPhone
scripts/run-on-iphone.sh --no-activate # install without taking over the screen
scripts/testflight.sh             # archive and upload for internal TestFlight
scripts/testflight.sh --export    # archive and export the .ipa without uploading
```

The iPhone runner excludes simulators and iPads, requires a paired physical
iPhone, and confirms live contact before building. If no phone is reachable it
exits without building or installing. `--no-activate` also applies to launch.
Run its device-selection regressions with
`python3 -m unittest discover -s ios/scripts -p 'test_*.py' -v`.

Uploads are internal-only (`testFlightInternalTestingOnly`): App Store Connect
will not send them to external testers or App Review. Each upload numbers its
build from the clock, so build numbers always increase.

Keep build output out of `~/Documents` when it syncs with iCloud Drive: the
file provider tags files there and `codesign` rejects the app. The scripts
build in `~/Library/Developer/Xcode/DerivedData`.

Change web files in the repository root, never in the app bundle. Any web
change ships with the next app build (engineering contract 9).

## Verify the native bridge

After installing the current Debug build, run from the repository root:

```
xcrun devicectl list devices
python3 ios/scripts/verify_shell_on_device.py <device-id> --output /tmp/clear-skies-shell-check.json
```

The probe launches only Clear Skies, without activating it or capturing the
screen. It describes all 13 live tool routes and opens/closes the engine,
export and layers popovers, checking their native controls against the actual
visible web inputs. It also checks elevation thresholds, color wells and
Reset. Results carry a per-run ID so a stale result cannot count as a pass.
The probe does not run analyses, export an image or change engine settings.
Background execution can be suspended by iOS; if no result arrives, unlock
the phone and open the Debug app before retrying.

For frame measurements, pass `--activate` to bring Clear Skies to the foreground:

```
python3 ios/scripts/verify_shell_on_device.py <device-id> --activate --probe scripts/performance/device-pan.js --output /tmp/clear-skies-pan.json
```

The Debug probe temporarily disables auto-lock while its script runs and restores
the previous setting afterward. Release builds do not include this hook.

For a live satellite scene search, application, disclosure/panel reopening and
zoom-refinement check, use the satellite probe:

```
python3 ios/scripts/verify_shell_on_device.py <device-id> --probe ios/scripts/verify_satellite.js --output /tmp/clear-skies-satellite-check.json
```

It uses live catalogs and scene tiles, verifies decoded tile sizes and finer
zoom requests with Auto Fill disabled, then clears its test scene and restores
the previous viewpoint and filter controls. See
[satellite repair evidence](../docs/ios/SATELLITE_FIX_VERIFICATION.md).

For Capture handle and Aurora 32× export verification, see the reproducible
[Capture repair checks](../docs/ios/CAPTURE_FIX_VERIFICATION.md). They exercise
the installed selection handlers and the actual GPU/streamed PNG pipeline
without activating the app or capturing the phone screen.

For selected-theme synchronization across the map, native controls and sheets,
see the [appearance repair checks](../docs/ios/APPEARANCE_FIX_VERIFICATION.md).
The device runner accepts `--page terrain` or `--panel snapshotPanel` to verify
the same transition while an actual native sheet is presented.

Debug-only launch arguments also allow app-scoped visual verification:
`-cspDebugPage terrain -cspDebugDetent large`, `-cspDebugSection Lighting`,
`-cspDebugPanel serverPanel`, and `-cspDebugAppearance light` or `dark`.
Appearance overrides affect that app launch and do not change system settings.
These hooks and their cached JSON output are excluded from Release builds.
