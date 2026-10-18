# GPU 3D validation harness

Deterministic browser harness for moving 3D analytical drapes from CPU workers
(`renderDrapeTile` → `terrain-drape-worker.js`) to resident GPU shading.
It measures whichever path the build actually runs and never claims a GPU
result when no GPU controller exists.

```bash
# CPU baseline (isolated port, temp cache; never 8765):
node scripts/gpu3d/bench3d.js --spawn-port 8823 --browser chrome --gpu3d 0 \
  --out /tmp/csp-gpu3d-upgrade/cpu-baseline-chrome.json

# Later GPU path, same camera/styles/controls:
node scripts/gpu3d/bench3d.js --spawn-port 8823 --browser chrome --gpu3d 1 --require-gpu \
  --out /tmp/csp-gpu3d-upgrade/gpu-chrome.json
node scripts/gpu3d/bench3d.js --spawn-port 8823 --browser webkit --gpu3d 0
node scripts/gpu3d/diff3d.js <old.png> <new.png>   # measured diff; thresholds are reviewer's
```

Options: `--url http://127.0.0.1:PORT/` (attach to your own isolated server
instead of `--spawn-port`), `--shots DIR`, `--repeats N`, `--no-phone`,
`--context-loss` (opt-in, destructive-ish, runs last), `--require-gpu`
(exit 3 when `?gpu3d=1` has no controller).

Design, mirroring `scripts/gpu2d/harness-lib.js` and `scripts/ui-terrain-drape.js`:

- Real GPU only: Chrome launched with `--use-angle=metal`; WebKit via
  Playwright. The unmasked WebGL renderer/vendor is recorded; SwiftShader or
  any software renderer sets `performanceValid:false`.
- Synthetic Terrarium fixture for every elevation/basemap request, so network
  and provider variation cannot move request counts. Elevation, basemap, and
  total requests are counted; in-page counters record `renderDrapeTile`
  calls by style, worker constructions, and worker `postMessage` jobs.
- Visible-terrain readiness: MapLibre style loaded plus the visible layers'
  source tiles `loaded`, completed CPU shade jobs and GPU inputs ready (exposed as `window.__map3d` by the same
  `CSPMarkup?.attach3d` injection the drape regression uses); timeouts report
  the real tile states instead of passing.
- Fixed camera at pitch 58 / bearing 37 ( zoom 14), styles
  slope/aspect/tint/contours-10ft, spectrum + below/above bands, then
  post-warm-up light and spectrum control responses (wall/paint p50/p95,
  drape-render, worker-post, and elevation-request deltas), a four-leg
  camera route with RAF frame p50/p95, and a desktop DPR2 pass plus a
  390x844 DPR3 phone-emulation pass (emulation, not a physical iPhone).
- Framebuffer screenshots captured in MapLibre's render event exclude HTML controls
  and use the actual drawing-buffer dimensions (the existing phone policy caps rendering at 2x).
  Images are written per style with visible-raster coverage
  against the MapLibre background. Old/new parity is same-camera screenshots
  compared with `diff3d.js`; no pass threshold is invented here.
- GPU detection: `window.ClearSkiesPortalBridge.gpu3d()` returns a
  controller with `stats() -> {enabled,error,renderer:{inputTextures,
  inputBytes,uploads,draws,...},cache:{...}}`, and
  `document.documentElement.dataset.gpu3d` is `'on'|'off'`. `?gpu3d=0` forces
  the old path, `1` enables the new one. Stats are recorded verbatim at start
  and end of each profile. If no enabled controller exists, the JSON verdict
  says `UNAVAILABLE` plainly and `--require-gpu` exits 3. On the GPU path the
  expected signal (reported, not gated here) is zero added CPU drape-worker
  jobs for analytic + spectrum changes, with renderer uploads/draws as the
  GPU-side evidence.

Control timing waits for actual shade submissions or CPU jobs to begin, then
visible source readiness and a presented frame. It includes legacy debounce
and avoids measuring the preceding loaded image. Source coordinates and focal
camera elevation stay fixed for parity. Run benchmark processes sequentially
without other GPU workloads; these are application response measurements, not
GPU completion timestamps or a universal frame-rate claim.

`lifecycle3d.js` checks clean frames, relighting without uploads, native texture
reloads, structural style changes, elevation visibility, exit/re-entry, context
loss/recovery and a forced automatic CPU fallback. Run it with the same
`--url`, `--browser` and `--out` options. No benchmark uses the live port 8765.
