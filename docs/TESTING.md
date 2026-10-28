# Tests and verification tools

## Every change

```
npm run check   # scripts/check-static.js: syntax of every shipped file, site.json, page/engine contracts
npm test        # every test-*.js in the root, one at a time, offline
python3 -m unittest discover -s ios/scripts -p 'test_*.py'   # iPhone install tooling (CI runs this too)
```

Each `test-*.js` stands alone (`node test-server.js` runs one). They never use
the network, the live service on port 8765 or its cache: server tests start
`server.js` on a free port against temporary folders. Shared fixtures live in
`test-fixtures/`.

## Optional browser suites

These need a real browser and are run by hand when their area changes. They
load Playwright through `scripts/lib/playwright.js` (the `playwright-core`
dev dependency, or the module named by `PLAYWRIGHT_MODULE`) and drive
installed Google Chrome by default for interface suites, or WebKit. Set
`CSP_UI_BROWSER=chromium` to use a downloaded Playwright Chromium, or
`CSP_UI_BROWSER=webkit` for interface workloads supported by WebKit. GPU
suites choose their browser explicitly and keep their real-GPU requirements. The GPU and performance suites start their own
server on an isolated port and never use the service on 8765.

### Interface (`scripts/ui-*.js`)

Run named workloads with an isolated server and temporary cache/markup storage:

```
node scripts/run-ui.js map-popovers review-regressions sheet-chrome satellite-search sheet
```

The runner refuses occupied ports, runs workloads sequentially and cleans up
its server/storage on success or failure. `CSP_UI_OUTPUT=/absolute/path` puts
popover/review/satellite screenshots outside the default `.codex-audits`.
Individual scripts still accept an explicit server URL; their default 8765
attaches to a running service, so use the runner for isolated verification.
The shared server and browser lifecycle lives in `scripts/lib/` and is also
used by the GPU harnesses. This does not merge their GPU/device assertions.

These suites verify the supported shell, including old `?ui=classic` URLs.
The collapsed portrait sheet is a 52px search capsule; its grabber appears
only when expanded. Build/reset utilities are in Settings. The markup
fixture persists saves across reload, matching engine ownership. Browser
fixtures do not establish live-provider, physical-device, UIKit, or offline
upgrade acceptance. Run the native/device gates separately.

| Script | Checks |
|---|---|
| `ui-map-popovers.js` | Dock popovers in light and dark on desktop, phones and landscape: editing, layer switching, drawing, keyboard focus, panel transitions, Reduced Motion, the camera's two actions, Appearance colours and presets after a reload, the typed width field and the selected mark's Delete/Undo bar |
| `ui-snapshot.js` | Capture: whole view, area selection, handles, exported pixels |
| `ui-satellite-search.js` | Scene filters, custom dates, search keys, dismissed lookups, mobile focus, source credits, header alignment, pinned navigation and both dropdown styles, plus legacy query URLs on the supported shell |
| `ui-sheet.js`, `ui-sheet-chrome.js` | Phone bottom sheet detents and grabber keys; compact footer, toolbar fade/slide, direct swipe tracking, Reduced Motion and Settings utilities |
| `ui-stress.js` | Search row and coordinate shortcuts across phone to desktop sizes |
| `ui-review-regressions.js` | Touch scrolling and completed taps, committed locations and retained drafts, result-selection animations, scaled-pointer geometry, short screens, date shortcuts and phone picker targets |
| `ui-pinch.js` | Phone pinch and twist: labels stay on the map, layers and canvases are reused |
| `ui-terrain-drape.js` | Request counts for the default 1280×800 slope view |

### GPU 2D terrain (`scripts/gpu2d/`)

Real GPU only (Chrome on Metal, WebKit). `harness-lib.js` serves the app on an
isolated port and injects `page-hook.js`; `run-all.js` runs the benchmark set
below for both browsers with the GPU path off and on.

| Script | Checks |
|---|---|
| `bench-pan.js`, `bench-gesture.js`, `bench-settings.js`, `memory.js` | Pan, gesture and settings frame time; memory over 100 pans |
| `parity-visual.js`, `rotation.js`, `sweep-deepzoom.js`, `robustness.js`, `feature-parity.js` | CPU/GPU pixel parity, rotation colours, deep-zoom blanks, context loss, exports |
| `engine-parity.js`, `engine-review-checks.js`, `engine-performance.js` | The engine on its own: lifecycle, wrapping, exports, frame time |
| `shader-parity.js` | `gpu-terrain-shaders.js` against the CPU styles |
| `layer-browser.js`, `app-smoke.js` | The Leaflet layer and the whole app on deterministic fixtures |
| `capture.js` | Real shader and PNG capture (fixture shared with the iPhone probe) |
| `export-detail.js`, `export-seams.js` | Exports fetch finer elevation and tile without seams |
| `refinement.js` | Slow overview and failed fine tiles recover |
| `native-audit.js` | The iPhone adapter (`ios/Resources/native-shell.js`) on an assembled site with a mocked native transport |

### GPU 3D terrain (`scripts/gpu3d/`)

`bench3d.js`, `diff3d.js` and `lifecycle3d.js`; see [scripts/gpu3d/README.md](../scripts/gpu3d/README.md).

### Performance (`scripts/performance/`)

| Script | Checks |
|---|---|
| `world-startup.js` | Full app start on deterministic tiles, older-engine compatibility, session restore |
| `map-audit.js` | Phone map: terrain kept through source refreshes, one shade per gesture input |
| `relative-elevation-regression.js` | The WebGL relative-elevation filter against a CPU reference |
| `device-pan.js`, `device-fast-gestures.js` | Frame timing on a phone; run as iPhone probes (below) |

## iPhone

Probes run inside the installed Debug app:
`python3 ios/scripts/verify_shell_on_device.py <device-id> --probe <file>` (see
[ios/README.md](../ios/README.md)).

| Probe | Checks |
|---|---|
| `ios/scripts/verify_shell.js` (default) | Every native route and popover against the live web controls |
| `ios/scripts/verify_audit.js` | Native sliders, 44-point targets and other audit repairs |
| `ios/scripts/verify_layer_navigation.js` | Popover-to-editor navigation and contextual menus |
| `ios/scripts/verify_recovery.js` | The app's WebContent recovery restores 3D and the selected place |
| `ios/scripts/verify_appearance.js`, `verify_capture.js`, `verify_satellite.js`, `verify_share.js` | Appearance traits, Capture gestures, live scene search, share links |

`ios/scripts/test_select_iphone.py` and `test_run_on_iphone.py` test the
install tooling with mocked Xcode tools.

## Glacial calibration (`scripts/glacial-calibration/`)

The offline evaluation behind the experimental moraine screen, described in
[GLACIAL_CALIBRATION.md](GLACIAL_CALIBRATION.md). In order: `fetch.js` (and
`extract_file_labels.py` for geodatabase labels; `test_esri_tiling.py` tests
its tiling fallback), `overlays.js`, `optimize.js`, `logistic.js`,
`threshold.js`, `evaluate.js`, `evaluate-objects.js`, `audit.js` (held-out
test, run once) and `compare-current-app.js`.
