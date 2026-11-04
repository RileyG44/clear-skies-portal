# Windows distribution

`npm ci`, then `npm run dist:win` builds a self-contained x64 one-click EXE, an optional guided EXE, and a portable ZIP under `dist/`. Run `node scripts/verify-windows-package.js` to check the complete bundled client/engine and generate SHA-256 checksums. No installed Node runtime is needed by end users: Electron runs the bundled engine.

One-click installation is per-user, needs no administrator access, creates Desktop/Start shortcuts and registers Windows uninstall support. The guided installer additionally offers location and user/all-users selection. Both use the same application identity and upgrade path. User data is preserved on upgrade and uninstall. Windows controls taskbar pinning; users can pin the correctly branded Start shortcut.

The engine starts automatically with the app, binds only to loopback, and stops when the app quits. This release does not install an unattended Windows service or configure Tailscale Serve. Users should keep the app and computer running for remote engine access. The setup guide accurately marks automatic Tailscale server/link setup as future work. Tailscale installation is always the user's separate choice.

After installation, the first Windows launch opens a LiDAR welcome page with the native mobile Pacifico ClearSkies wordmark. Open ClearSkies immediately, or choose Learn about Tailscale to open the guide as page two. F1 opens the guide directly. Reopen it with F1 or the Start shortcut **ClearSkies Setup and Tailscale**. Completion is stored in the existing app user-data directory. The guide offers https://tailscale.com/ and https://pkgs.tailscale.com/stable/tailscale-setup-latest.exe (the upstream latest-stable alias, not a pinned version).

`Windows installers` runs for packaging PRs and manual workflow dispatches, retaining downloadable build artifacts. To publish a Windows release after merging, push a `desktop-v<package.json version>` tag; the workflow builds on Windows, verifies the payload and publishes all three downloads and checksums. Update the release-note filenames in `docs/WINDOWS_RELEASE.md` when the package version changes. Signing is not configured yet; do not disable executable resource editing, which supplies the application icon and product name.

Manual acceptance: run the guided wizard and inspect install, progress and finish pages; inspect the post-install welcome and second-page Tailscale links; run the one-click installer; verify Settings uninstall registration, shortcut targets/icons, first-run guide, second-launch map, F1, engine `/api/health`, native close/minimize/maximize and window drag/resize. Test an upgrade without deleting the app's saved data.

Caches and new markup live under the app's persistent user-data directory. Before replacing legacy app files, the installer closes the old app and preserves in-bundle markup (including deletion tombstones) in a retained legacy-markup backup. First launch imports that backup only when no newer markup store exists.

The public name is ClearSkies (one word). Pacifico Regular is bundled locally with its license and matches the native mobile menu wordmark. The welcome image is an optimized copy of Riley's supplied LiDAR capture, not a generated illustration. Keep the legacy executable filename, application ID, package name and data paths stable for existing installations.

## Advanced configuration (1.0.4)

The welcome screen includes the same optional advanced setup as Mac. Open
**Advanced configuration** to choose tile/DNR/memory cache sizes, free disk
space reserve, automatic or fixed terrain workers, and Off/Auto/On smoother
panning. Skip it to use the defaults documented in `MAC_RELEASE.md`. Settings
are validated and stored outside the installation in `desktop-config.json`.
Reopen the welcome using the Start setup shortcut to change them later.
No separate Node.js, runtime or terminal setup is needed.
