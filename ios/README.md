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

Stage 1 shows the web client's own controls. Stage 2 replaces them, route by
route, with native SwiftUI screens that call the same web functions.

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
scripts/testflight.sh             # archive and upload for internal TestFlight
scripts/testflight.sh --export    # archive and export the .ipa without uploading
```

Uploads are internal-only (`testFlightInternalTestingOnly`): App Store Connect
will not send them to external testers or App Review. Each upload numbers its
build from the clock, so build numbers always increase.

Keep build output out of `~/Documents` when it syncs with iCloud Drive: the
file provider tags files there and `codesign` rejects the app. The scripts
build in `~/Library/Developer/Xcode/DerivedData`.

Change web files in the repository root, never in the app bundle. Any web
change ships with the next app build (engineering contract 9).
