# Relative elevation, camera limits, native controls, and overview prewarming

Task scope: finish the pan/zoom performance repairs begun on
`fix/ios-relative-elevation-performance`, and implement Riley's fresh-session
North America startup, filled-map camera limits, and native/web control parity requests. Scientific source choice, elevation units, nodata rules,
rendering resolution, palettes and user controls retain their existing meanings.

## Authority and requirements

The native baseline remains `SPEC.md` 0.1.0-draft, **unapproved**, supplemented
by accepted CR-001 r1 (digest
`35ffe7088f8f71a654fbdcfb892d1857b21135b72f7069a5b087dbbecb7d94f9`).
This is maintenance of the existing shared web map engine inside that shell.
Requirement cross-references: U-03/U-04, CAP-01/CAP-03–CAP-06/CAP-11,
RENDER-01–RENDER-04 and DATA-03/DATA-06; proposed IDs are cross-references,
not a claim that the draft or proposed numerical performance gates are approved.
Engineering review contracts 1–4 and 7–10 apply.

Riley initially requested world startup and early global zoom prewarming, then
replaced the startup request with North America and a maximum zoom-out that
keeps every edge filled. On a portrait screen the widest view crops the world
horizontally rather than showing empty polar bands. Longitude wraps normally.
Recovery of an existing session still restores its camera within those limits.
Custom startup settings are future work explicitly outside this task.

Riley also requested web-equivalent native toolbar reordering and selected-place
controls, removal of the selected-place card, improved menu closing/spacing,
and publication to main, internal TestFlight, desktop and simulator apps. These
are shared-shell parity repairs within CR-001, not approval of the draft spec.

No new provider, renderer, lower-resolution gesture mode, device memory cap,
pricing, privacy behavior or release-gate exception is introduced. CR-001's
limitations remain in force; these checks do not establish G3 acceptance.

## Changes

- Decode the 2D elevation PNGs with the existing drape workers, retaining the
  native tile size and main-thread fallback. Fuse repeated validity scans.
- Keep coarse overview backdrops and useful in-flight ancestors across camera
  changes. Favor drawn/wanted GPU textures when evicting, within the existing
  byte cap. Finer descendants stop drawing after their source's proper tile
  level is available, avoiding history-dependent aliasing and extra draws.
- Preserve Leaflet's useful old tile levels during passing zoom commits and
  failed/slow replacement. Retained raster holds remain geographically aligned.
- Compute large relative-elevation block minima with separate row/column
  passes. The minimum and nodata rules are unchanged.
- Batch the pane preview, coordinate rebase and camera commit into one terrain
  draw. Instrumentation found **three** full terrain shades at passing pinch
  boundaries; the revised path shades the final camera **once** in the same
  painted frame. It does not defer terrain until another animation frame.
- Start fresh sessions at North America (`[45, -100]`, zoom 3). Compute the
  minimum zoom from the rotated viewport and constrain latitude in world pixels
  during drags, inertia, pinch previews, commits, programmatic moves and resize.
  This preserves antimeridian wrapping and prevents empty polar edges.
- Make native map tools draggable with live reordering, VoiceOver move actions,
  and the shared web dock's saved order. The native adapter delegates persistence
  to the web control rather than introducing a second preference. The map-mode
  choices use a button-backed native popover: the previous Menu intercepted long
  presses to select a mode, preventing that button from being dragged.
- Show the committed location as muted text in both native search capsules, with
  a clear-selection x. Place Copy / Google Maps / Google Earth directly below the
  field, using the web's coordinates and URLs; remove the separate location card.
- Add a visible close-to-map control at every menu depth, hide the crowded drag
  pill, and place the search field below a properly spaced navigation header.
  Swipe dismissal remains available. The collapsed search opens search directly.
- Add `/api/elev/overview/{z}/{x}/{y}.png`, advertised by the
  `overview-elevation` health feature. The route serves the existing AWS
  Terrarium PNGs verbatim, using existing RAM/disk budgets and shared upstream
  cancellation. Older engines and failed cache routes retain direct AWS access.
- Add a bounded, resumable-by-cache-hit prewarm CLI. It changes no cache cap
  and creates no recurring background task.

## Storage evidence and implications

The source is [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/).
Its [format documentation](https://github.com/tilezen/joerd/blob/master/docs/formats.md)
describes raw Terrarium elevations rather than pre-colored hillshade. This lets
all terrain styles share one cache. These are global overview data, not a new
worldwide high-resolution LiDAR survey.

The S3 ListObjectsV2 inventory counted every PNG through source zoom 7,
excluding XML sidecars. Cumulative source sizes:

- Zooms 0–4: 341 tiles, 25,410,724 bytes (25.4 MB).
- Zooms 0–5: 1,365 tiles, 89,978,855 bytes (90.0 MB).
- Zooms 0–6: 5,461 tiles, 302,950,227 bytes (303.0 MB / 288.9 MiB).
- Zooms 0–7: 21,845 tiles, 999,279,969 bytes (999.3 MB).

The completed zoom 0–6 preload used 180,213 bytes of cache metadata and
336,359,424 allocated bytes on APFS (336 MB / 320.8 MiB), including block
allocation. The private engine verified all 5,461 tiles as hits with zero
upstream misses after installation. Its existing 20 GiB disposable-cache cap
and 8 GiB free-space reserve are unchanged. The actual cache volume reported
about 14.7 GiB free after this work, rather than hundreds of GiB.

Each deeper global level has four times as many tiles. Prewarming these coarse
levels improves startup, early zooms and coarse fallback availability. It does
not remove the phone's GPU cost at close zoom. Caching all decoded zoom 0–6
Float32 grids would need about 1.33 GiB; these are deliberately stored compressed
on the server, with only demanded tiles decoded/uploaded on the phone. This
preload does not include provider imagery, labels, point clouds or raw surveys.

## Verification and reproducibility

- `npm run check` and `npm test`: pass, including HTTP cache byte identity,
  shared requests, failures that must not poison the cache, source capability
  changes, old-engine compatibility and direct-source fallback.
- `scripts/performance/relative-elevation-regression.js` in WebKit and
  Chrome/Metal: 26 reference fixtures each; maximum absolute difference from
  the independent CPU reference approximately 0.00043 m. This is numerical
  implementation evidence, not a surveyed-accuracy claim or an approved new
  tolerance. The abandoned A/B comparison accidentally substituted mean for
  minimum filtering; the corrected block-minimum comparisons preserve output.
- `scripts/performance/world-startup.js`: phone, small-phone and desktop
  sizes in both browsers; North America startup, existing-session restore,
  fresh-session reset, 11 terrain styles with full viewport coverage, no elevation
  refetch on style changes, and raw world-pixel corner checks during extreme
  north/south pan, pinch, rotation and resizing.
- `scripts/performance/map-audit.js`: passing pinch boundaries shade once;
  delayed/failed raster replacements preserve and align useful coverage;
  source refresh and in-progress capture remain consistent.
- Production app smoke: all terrain styles, 12 rotated/scaled exports,
  identical regular/streamed exports, 53 zoom steps through z28 and context
  loss/recovery.
- Final iPhone native probe: all 13 tool routes and three popovers pass, including
  saved dock ordering, selected-place text and coordinate URLs, and clearing the
  selected point. The updated Debug app is installed on the physical iPhone.
- Simulator interaction: submit coordinates, inspect the muted search placeholder
  and three coordinate buttons, close the menu, drag the map-mode tool from first
  to third, and tap it to inspect all three mode choices. The drag changed the
  actual native order without switching modes. Screenshots verify the separate
  menu header and absence of the old selected-place card.
- Packaged desktop: local ad-hoc signature verifies with `codesign --verify
  --deep --strict`; its own Electron runtime starts the bundled server, passes
  health checks and serves final source-identical terrain assets. The package is
  installed in Applications. The running private engine serves the final web
  assets while retaining its existing warm cache and service configuration.
- Native CSS geometry checks exercise five known positions within the real
  transition and still check natural completion/idle. The independent DOM
  oracle compares frozen compositor positions; it is not an FPS benchmark.
  Gesture alignment is sampled at the same task's microtask checkpoint, so
  moving terrain rendering to a later animation frame still fails the test.
- Terrain-only fast pan and z16-to-z11 pinch in desktop WebKit: zero detected
  terrain holes and zero strobing cells in the sampled screenshots. Timing
  and screenshot passes are separate; screenshots stall browser rendering.

Physical verification uses the installed Debug app on iPhone 15 Pro Max,
430x932 CSS pixels at DPR 3, live private-engine data, and the user's existing
REM/hillshade stack. `device-fast-gestures.js` records rAF intervals without
screenshots, GPU synchronization or pixel readback during timing, and restores
the prior style/preferences/session. Those intervals are not Instruments or
compositor FPS. No claim of universal flicker elimination or release-gate
acceptance is made.

Detailed artifacts are in `output/performance-audit/`: prewarm inventory,
actual disk allocation, private-engine cache-hit verification, browser JSON
and screenshots, exact source hashes, physical-device runs and build logs.
The first physical run (`2026-10-24g`, before camera batching) measured REM
pinch-out p95 70 ms and hillshade pinch-out p95 58 ms. Two subsequent runs
(`2026-10-24h`) measured:

- REM pinch-out p95 37 ms and 34 ms; maximum interval 54 ms and 60 ms.
- Hillshade pinch-out p95 29 ms in both runs.
- REM swipe p95 35 ms and 38 ms; hillshade swipe p95 35 ms and 34 ms.
- At most one terrain shade per explicit gesture input, including passing
  commits and lift-off, in both runs. No recorded interval exceeded 100 ms.
- Resident geometric coverage stayed 1.0; this is distinct from pixel coverage
  and the screenshot-based hole checks above. Native texture bytes stayed
  within the existing 64 MiB touch-device cap.
- Those historical performance runs used the preceding world startup; the
  final UI/camera build uses North America startup and viewport-filling limits.

These are short before/after Debug runs on one iPhone with live cached data,
not a controlled minimum-device or thermal benchmark. Cache warmth and network
conditions can affect comparisons. The one-versus-three draw regression is
independently measured, and the final repeat supports the observed improvement.
Detailed REM plus hillshade still costs roughly a 30 fps cadence during fast
swipes at DPR 3; this iteration does not establish sustained 60 fps.

## Re-run

```
node scripts/prewarm-overview.js --url http://127.0.0.1:8765 --max-zoom 6 --dry-run
node scripts/prewarm-overview.js --url http://127.0.0.1:8765 --max-zoom 6 --output /tmp/world-prewarm.json
python3 ios/scripts/verify_shell_on_device.py <device-id> --activate --timeout 180 --probe scripts/performance/device-fast-gestures.js --output /tmp/fast-gestures.json
```

The existing engine code/assets and desktop app were backed up before their
updates. Final web build `2026-10-24i` is installed in the private engine and
desktop package; matching Debug apps are installed on the iPhone and simulator.
Internal-only TestFlight build **29881573** uploaded successfully. Xcode reported
"Uploaded package is processing" and "Upload succeeded"; availability to testers
after Apple's processing has not been independently verified. The release archive
is retained under `~/Library/Developer/Xcode/Archives/2026-10-24/`.

The committed `2026-10-24-final-verification.json` records the final source hashes,
native probe, browser summaries, desktop package checks and bundle identity.
Builds and publication use the recovery checkout outside iCloud Documents because
the original workspace still contains dataless files with stalled reads.
