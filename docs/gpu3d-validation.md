# Resident GPU 3D terrain validation

Release: **2026-10-17i**. Measured October 17, 2026 Pacific on Apple M2.
Implementation: `99cb954`; latest UI changes through `12a13d3` retained.
[Recorded measurements](gpu3d-validation.json) contain the complete final runs,
renderer parity, screenshot hashes/differences and lifecycle assertions.
[Architecture and compatibility contract](GPU_3D_TERRAIN_SPEC.md).

## Measured result

The analytical terrain and elevation spectrum now shade MapLibre's native
raster textures in its own WebGL2 context. Float32 heights stay resident;
light, palette and band changes update uniforms. Native geometry, depth,
hillshade, filtering, source resolution and the mobile pixel-ratio policy remain.

Median control-to-presented-frame response, after warm-up:

| Browser and viewport | Legacy lighting | GPU lighting | Legacy spectrum | GPU spectrum |
|---|---:|---:|---:|---:|
| Chrome/Metal desktop | 598 ms | 65 ms | 385 ms | 67 ms |
| Chrome/Metal phone emulation | 419 ms | 66 ms | 298 ms | 66 ms |
| WebKit desktop | unmeasured | 67 ms | unmeasured | 68 ms |
| WebKit phone emulation | unmeasured | 66 ms | unmeasured | 65 ms |

Chrome uses five repetitions per control/profile; WebKit uses three. Processes
ran sequentially with synthetic Terrarium tiles, the same fixed camera and
actual hardware contexts. Timings include the legacy debounce, observed shade
work, visible-source readiness and a presented frame. They measure application
response, not GPU execution time. Desktop lighting improves 9.2x and spectrum
5.7x in this fixture. Every GPU control update records zero CPU drape renders,
worker posts, elevation requests and height uploads; it shades 49 desktop or
27 phone raster targets from resident inputs.

The four-leg camera route records Chrome RAF p95 16.8 ms and WebKit 41 ms
desktop / 38 ms phone, with some gaps over 50 ms in each browser. This release
does not establish a universal frame rate or faster data acquisition. Source
decoding and the terrain mesh still use their existing paths.

## Correctness and recovery

- Real Metal renderer output for all ten analytical styles and spectrum is
  within 1/255 of independently computed CPU reference pixels. Float32 input,
  no-data handling and neighbor skirts retain the shared numerical contract.
- Complete application screenshots cover slope, aspect, tint, contours and
  spectrum plus bands at desktop and phone sizes. At least **99.99926%** of
  pixels agree within 3/255 in every pair. Mean channel error is at most 1.001
  byte. Sparse raster-edge pixels differ more (desktop max 24, phone max 78);
  these are not byte-identical full-frame results. Framebuffer sizes stay
  2880x1800 desktop and 780x1688 phone under the existing 2x mobile cap.
- Eight browser lifecycle cases pass: clean frames do no shade work; relighting
  performs no uploads; source reloads repaint; structural theme changes work;
  spectrum visibility works; 3D exit/re-entry creates fresh ownership; context
  loss restores rendering; forced startup failure renders the CPU fallback.
  Chrome lifecycle and all six benchmark profiles have zero page errors.
- Native source reload testing replaced MapLibre texture handles. Unit tests
  separately cover overwrite invalidation with the same handle. Camera focal
  elevation is now preserved across asynchronous style reconstruction, and
  queued reconstructions are coalesced safely.
- Input textures and skirt caches each cap at 192 MiB desktop / 64 MiB touch.
  Final route texture residency is 37,542,096 bytes desktop and 18,637,920
  bytes phone. MapLibre's separate caches are additional allocations.

## Review and checks

GPT 6.1 implemented and independently reviewed rendering/integration; Grok 4.7
reviewed the native terrain integration design; Muse Wonder supplied the browser
harness; DeepSeek 4.1 Flash implemented the specified cache and separately
reviewed cache, renderer, measurements, lifecycle and release packaging.
No Claude model was used.

Review fixes include cancellation of abandoned neighbor requests, GL state
recovery on context loss, visible-layer-only scheduling, stable source reuse,
native lighting updates, focal-elevation preservation and readiness barriers.
A final spectrum debounce fix prevents a timer queued during style loading from
restoring CPU tile URLs after GPU activation. The targeted regression and fresh
WebKit desktop/phone run pass with zero total CPU drape renders. The original
WebKit run is retained in the JSON for comparison; the table uses the final run.
Harness corrections ensure synthetic routes apply and timing waits for the
changed image; early incomplete measurements are excluded from this record.
The legacy adapter is available with `?gpu3d=0`; incompatible MapLibre internals,
unsupported GL or startup validation failure select it automatically.

`npm run verify` passes, including the existing terrain/mesh/markup suites and
the three new cache/renderer/layer suites, with zero dependency vulnerabilities.
The assembled Pages artifact minifies successfully without renaming shared
script globals. The release checks include the merged LiDAR/menu UI changes.

Physical iPhone/Safari performance is **untested**. Phone viewport and WebKit
results here run on the Mac. The device inventory has no available simulator
devices, so no simulator result is claimed either. Deployment verification is
recorded in [gpu3d-deployment.json](gpu3d-deployment.json).

## Published verification

Release commit `f59966b` is on main. [CI and Pages run 39103465184](https://github.com/RileyG44/clear-skies-portal/actions/runs/39103465184)
passes Linux checks/audit, Windows tests and deployment. The backed-up Mac
LaunchAgent serves build `2026-10-17i`, with seven installed asset hashes
matching source. Six hosted assets, including all three GPU modules, match
the assembled minified artifact byte for byte.

Real Chrome/Metal browser checks of both the installed service and the hosted
site pass on actual terrain: GPU enabled, zero page errors, nonblank native
3D geometry plus spectrum, and zero height uploads for relighting. The hosted
check uses public elevation without an engine connection; its cold data
readiness takes about 35 seconds for the initial view and 37 seconds for the
expanded pitched view. The cached local service takes about 2 and 6 seconds.
These are source-loading observations, not control-response benchmarks.
Physical iPhone performance remains unmeasured.
