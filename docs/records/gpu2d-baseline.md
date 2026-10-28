# GPU terrain integration validation

Measured 2026-10-17 on Apple M2, real Chrome/Metal and Playwright WebKit.
Raw measurements: [gpu2d-validation.json](https://github.com/RileyG44/clear-skies-portal/blob/73d117a/docs/gpu2d-validation.json) (repository history).

## Result

The resident GPU renderer integrates all ten terrain styles and elevation
spectrum/bands in one canvas. Source decoding stays on the CPU; resampling,
shading and compositing stay on the GPU. Cursor and research queries use the
shared native store. `?gpu2d=0` retains the legacy renderer, and unsupported
WebGL2/float targets fall back automatically.

| Measurement | Legacy | GPU |
|---|---:|---:|
| Fixed 16-move route: main-thread busy | 15,731 ms | 968 ms |
| Long tasks on that route | 20 | 0 |
| Largest long task | 1,214 ms | none |
| Chrome gesture p95 | not measured | 16.8 ms |
| WebKit gesture p95 | not measured | 37 ms |
| Minimum sampled gesture coverage, Chrome / WebKit | not measured | 99.33% / 98.77% |

The pan route uses the same cached source and fixed moves, with each route
warmed before timing. Legacy work overruns its timer delays (25.5 s wall time
versus 13.1 s GPU), so these are total main-thread milliseconds for the same
actions, not equal-duration utilization percentages. The GPU result is 93.8%
less main-thread work. These headline route numbers are single runs, not a
three-run median.

## Correctness and feature coverage

- Engine review: 29 checks pass in each browser, including rank precedence,
  no-data fallback, bicubic resampling, rotation, wrapping, exports, and
  context restoration. Completely valid higher-priority tiles now omit hidden
  lower-priority draws; partial native tiles retain their fallbacks.
- Production modules in the complete app: one terrain canvas; cursor/research
  queries and provenance; all styles; 12 rotated exports at 1x/2x/4x; streamed
  PNG and ordinary PNG match exactly; 53 quarter-step zooms from 15 through 28;
  GPU context loss/restoration all pass in Chrome and WebKit.
- WebKit settings: all 21 control cases paint within one frame and make zero
  network requests. A real extra-frame delay in lighting/elevation slider
  handlers was fixed by updating GPU state before their existing UI callback.
- The engine exposes a monotonically increasing `stats().frames` for completed
  interactive shade draws. Timing tests use this counter; elapsed render time
  and source-generation numbers are not reliable paint counters.
- Chrome 100-pan memory stress passes: two canvases before/after (one terrain
  canvas plus the app's other canvas), 106,954,752 texture bytes, JS heap
  6,288,276 to 9,628,216 bytes. Texture budget is 192 MiB.
- Leaflet layer checks cover pane gestures and legacy fallback. The isolated
  native CSS zoom geometry check holds compositor time during each paired
  measurement, since WebKit advances computed transforms between reads.
  This is a geometry check, not a native CSS transition frame-rate claim.

## Image differences and remaining limits

The real-terrain comparison covers both browsers, all ten styles, and zooms
15/17 at the Columbia Plateau view. Raw pixel parity ranges down to 98.43%
within 3/255 for WebKit aspect at z17. Differences form two-pixel lines at the
legacy renderer's 256-physical-pixel tile boundaries: legacy shading clamps
each tile's Sobel neighborhood, while GPU shading crosses tile boundaries.
Excluding a documented two-pixel radius around those boundaries and the
viewport edge, every case is at least 99.993% within 3/255. This diagnostic
exclusion does not replace the raw comparison. Contour tolerant IoU is at
least 99.5% in the sampled views. Removing seams is intentional.

The complete six-view, six-zoom, spectrum/band real-terrain image matrix and
three-repeat baseline have not been run. Shader reference comparisons cover
spectrum/bands separately, but do not substitute for that complete matrix.
At non-cardinal bearings, sampling a screen-space Sobel grid differs from
rotating an already-shaded north-up image; this remains a documented rendering
difference rather than a claim of exact rotated legacy parity.

A subsequent WebKit wheel-only diagnostic found repeated pane-layout reads.
Caching static pane geometry reduced view calculation p95 from 6 ms to 1 ms
and wheel-only rAF p95 from 35 ms to 31 ms. The cache is invalidated on resize,
re-addition, or pane class/position changes; current transforms remain live.
This is a separate diagnostic, not a replacement for the full gesture result.

The spec's gesture thresholds are not fully met: Chrome missed 16.7 ms by
0.1 ms in the sampled run, and WebKit missed its 20 ms target materially.
Screenshot coverage uses a conservative RGB distance threshold of 18 from
the map background, not exact height-field coverage. Coverage passes, and the
main-thread reduction is measured, but this build
must not be described as having passed every performance acceptance gate.

## Reproduction

Use a separate dev server with `HOST=127.0.0.1 PORT=8816` and a temporary
`CSP_CACHE_DIR`. The scripts refuse the live service on port 8765.

```sh
npm run verify
node scripts/gpu2d/harness-lib.js --self-test
node scripts/gpu2d/engine-review-checks.js --browser=both --frames=60
CSP_GPU2D_URL=http://127.0.0.1:8816 node scripts/gpu2d/layer-browser.js
B=webkit CSP_GPU2D_URL=http://127.0.0.1:8816 node scripts/gpu2d/app-smoke.js
GPU2D_ALLOW_8816=1 GPU2D_REUSE_SERVER=1 node scripts/gpu2d/bench-settings.js --browser webkit --gpu2d 1 --repeats 1 --port 8816 --cache /tmp/csp-integration-cache --no-warm
```

The same harness supports `bench-pan`, `bench-gesture`, `memory`, `rotation`,
`sweep-deepzoom`, `robustness`, `feature-parity`, and `parity-visual`.
`run-all.js` runs the broader matrix on its own port. Warm-up fails early after
three unsettled views; a failed benchmark gate returns a nonzero exit status.
