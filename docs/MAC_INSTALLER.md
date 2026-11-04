# Mac installer

On macOS with Node.js 22.12 or newer:

```sh
npm ci
npm run check
node --test test-desktop.js test-electron-startup.js test-setup-config.js
node scripts/verify-desktop-setup.js
CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:mac
node scripts/verify-mac-package.js
```

This builds Apple Silicon (`arm64`) and Intel (`x64`) DMGs and ZIPs in `dist/`.
`npm run dist` is an alias. The DMG opens with ClearSkies and an Applications
shortcut: drag the app across, then launch it from Applications. First launch
shows the shared Windows/Mac welcome; completion is remembered in the existing
user-data directory. `--setup` reopens the welcome; the Mac Help menu also
opens the welcome and terrain engine/Tailscale guide.

The package verifier checks both app bundles, architecture metadata, bundled
engine/client/setup assets, and ad-hoc signatures, then starts each packaged
engine supported by the host (Intel requires Rosetta on Apple Silicon). It
requires the host architecture to pass, and reports any other architecture
it cannot run. It writes `dist/SHA256SUMS-Mac.txt` for all four downloads.

`.github/workflows/mac-release.yml` builds and verifies on pull requests or
manual dispatch. Push a `mac-v<package version>` tag on the merged commit to
publish a Mac release with `docs/MAC_RELEASE.md` as its release notes. Windows
keeps its existing `desktop-v*` release path.

The current release uses ad-hoc signing without Apple notarization; no Apple
distribution credentials are configured by this workflow. Gatekeeper may
require Open Anyway as described in the release notes. A future notarized
release needs a Developer ID Application certificate and Apple notarization
credentials. App identifiers and user-data paths are unchanged.

Advanced configuration is shared with Windows and is collapsed by default.
Settings are validated and saved in `desktop-config.json` in the existing
Electron user-data directory. They configure the bundled engine through its
existing environment variables before startup. Custom engine resource settings
select the bundled engine; they never rewrite another terrain service.
Smoother panning defaults to Auto, uses the existing map preference, and is
saved outside the changing loopback origin so in-app changes survive restarts.
The version 3 welcome is shown once to existing desktop users on upgrade too.
