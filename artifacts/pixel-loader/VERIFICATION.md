# Pixel satellite startup loader — verification

Branch: `feat/pixel-loader`, isolated worktree under `~/.t3/worktrees/csp-main/feat-pixel-loader`.
Base: origin/main `2c79ddc` (includes PR #38 first-load selection fix).
Authority: Riley's direct build request and updated reference instruction; accepted CR-008 r1. SPEC.md 0.1.0-draft remains pending; accepted CR supplements remain unchanged outside this bounded appearance change.

## Surfaces found and changed

- Browser startup/recovery panel: inline canvas replaces title/loading text/reload during normal startup. Accessible loading status remains; timeout/script errors reveal the existing message and reload recovery. No-JavaScript reload fallback remains available.
- Electron/Mac: uses that same web startup panel. Initial BrowserWindow background is black. The window is still created after the engine health check; no separate engine-start splash exists.
- iOS: static UILaunchScreen now uses a dedicated pure-black LaunchBackground color. Native LaunchCover replaces the mountain pulse/glass card while the existing web ready signal is pending (also used for process restoration). WKWebView's backing background is black. Its bundled page uses the same web loader underneath the native cover.
- Installed PWA: manifest system splash background is black; OS-provided app-icon presentation remains system-controlled.

The updated generator is the source of truth: SHA-256 `103ad40e02648228158a04efdefcc643198658a1d725fd6dc1fcd10114fc4a4c`. Horizontally centered satellite, gentle vertical hover, three sweeping dashed beams, no HUD/signal bars, no border. Exact seeded stars, terrain, props and grayscale values. 192 frames at 24 fps, eight-second loop. Web canvas and native logical-resolution raster drawing use nearest-neighbor scaling at integer physical-pixel multiples, bounded by safe areas. Reduced motion draws frame zero. No media assets or new dependency. Inline web drawing code is 4,660 source bytes / 2,329 gzip bytes.

No minimum display time was present or added. Existing readiness events, native handoff/fade, timeout, cache recovery, app/map initialization, source selection and scientific code remain unchanged. Service-worker/build tokens advance together; site.json assembly automatically includes the inline loader for static hosting, Electron and iOS.

## Checks

- `npm run check`: passed, build 2026-10-28b.
- `npm test`: final full run passed 63/63 files. An initial run had a local markup-server startup ECONNREFUSED under concurrent first-time build load; isolated retry and subsequent full runs passed without changing that test or server.
- `python3 -m unittest discover -s ios/scripts -p 'test_*.py'`: 13 passed.
- Calibration discovery was attempted; `scripts/glacial-calibration/test_esri_tiling.py` cannot import its missing generated `output/glacial-calibration/curator-cache/scripts/evalsite.py`. This check is not claimed passed; no generated replacement or scientific change was made.
- iOS Debug simulator build: passed with Xcode SDK iphonesimulator27.1 targeting the iOS 26.0 simulator; final bundled site rebuilt after all page/manifest edits.
- `git diff --check`: passed.
- Independent Python-rendered RGB hashes at frames 0/24/48/96/191 match the canvas output exactly; regression also checks frame 192 loops to zero, reduced-motion still and ready cleanup.
- Chrome visual checks at 390×844, 1440×900, and 844×390 (DPR 2). Stylesheets and first application script deliberately held while screenshots were captured: loader starts, animates, and remains crisp without those resources. On release, the real app becomes ready and startup panel hides. Landscape reduced-motion image remains byte-identical over time.
- iOS simulator: Clear Skies First Load QA, iOS 26.0. Observed plain-black system launch, captured native animation, then confirmed ready native controls/map via screenshot and accessibility tree. No debug delay or altered readiness was introduced.

## Screenshots

- `web-phone.png`: phone startup, 390×844.
- `web-desktop.png`: desktop startup, 1440×900.
- `web-landscape.png`: landscape reduced-motion still, 844×390.
- `ios-loading.png`: actual native loading cover.
- `ios-ready.png`: subsequent native map/controls after handoff.

Limits: simulator rather than physical iPhone/TestFlight; native reduced-motion behavior is implemented using accessibilityReduceMotion but was not separately toggled in the simulator. Electron shares the visually checked web loader; the packaged Mac binary was not built/run. No universal startup-duration/performance benchmark is claimed. No push, PR, deployment or TestFlight upload.
