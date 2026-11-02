# Terrain source queue audit — cycle 6, 2026-11-01

Baseline: `92abdb502334f5ffcba8f98d5f7c013203b58b97` (#64, build g).
This cycle changes CPU elevation scheduling and the shared browser request pool.

## Findings ranked by value

| Rank | Fix | Evidence and value |
| --- | --- | --- |
| 1 | Refine every source that still contributes pixels. | The installed CPU layer finished a mixed HiDPI tile as `[60,20,60,20]`, requesting fine raw data but no fine national data. Half its pixels stayed at the parent resolution indefinitely. Lower contributors now sharpen as soon as their useful base data arrives. |
| 2 | Apply provider limits to initial and sharp requests together. | Sharpening used `group: sharp`, bypassing the provider group. A 36-tile DNR workload admitted eight requests despite `dnr: 2`, leaving six queued inside a simulated two-slot service. Combined limits remove that internal queue and let queued first-pass cover retain its priority. |
| 3 | Recover ordinary CPU layers after short fetch retries are exhausted. | GPU stores and published composites already retried stationary failures. Ordinary `ElevLayer`/analytical layers stopped after the fetch helper's three attempts. They now retry only failed operations with bounded exponential backoff while keeping useful pixels. |
| 4 | Evaluate delayed fallback hedging against cold preferred sources. | Immediate parallel starts can spend work before cancellation, but preserve coverage during preferred-source failures. Provider and device measurements are still needed before changing this balance. |
| 5 | Measure private TIFF cache retention across long sessions. | A read-only disk-cache sample found twelve distinct readable header layouts, predominantly 512×512 blocks plus smaller overviews. It did not establish excessive resident memory. Parsed headers remain unbounded and decoded blocks remain count-bounded; changing those budgets is deferred pending memory evidence. |

The first three are implemented. Native zoom ceilings, per-pixel rank precedence,
fine-nodata fallback, and actual survey provenance remain the loading contracts.

## Controlled comparison

```sh
node scripts/performance/mixed-source-refinement.js --baseline=92abdb5 \
  --output=docs/diagnostics/assets/2026-11-01-mixed-source-refinement.json
```

The workload executes the real layer and each revision's actual request pool,
with production client capacities, a virtual clock and fixed costs. Raw base
and fine requests cost 100 ms, national base requests 2 s, and overview 5 s.
National refinement has both 100 ms and 2 s controls. DNR uses a FIFO service
with two simulated slots: base costs 100 ms and fine costs 1 s. Recovery fails
one complete raw operation, then succeeds after 100 ms; it does not bypass the
production fetch helper's short retries in the app.

These are scheduling and coverage measurements, not live-provider, device or
network-byte speed claims. Full results and request counts are in
[the recorded JSON](assets/2026-11-01-mixed-source-refinement.json).

| Measurement | Before | After |
| --- | ---: | ---: |
| Mixed 36-tile view: requested-level pixels when finished | 50% | 100% |
| Mixed view: first paint | 100 ms | 100 ms |
| Mixed view: all first-pass coverage | 4,000 ms | 4,000 ms |
| Mixed view: first / all raw sharp tiles | 200 / 700 ms | 200 / 700 ms |
| Mixed view: all pixels at requested detail, 100 ms national refinement | never | 4,200 ms |
| DNR: maximum admitted requests | 8 | 2 |
| DNR: maximum service queue | 6 | 0 |
| DNR: all 36 initial tiles visible | 9,500 ms | 500 ms |
| DNR: first sharp tile | 1,100 ms | 1,400 ms |
| DNR: all 36 sharp tiles | 18,500 ms | 18,500 ms |
| Stationary CPU recovery after one failed operation | never | 1,200 ms |

The DNR policy favors complete initial coverage: its first sharp tile is 300 ms
later in this workload. Final completion and the 45 required requests are
unchanged. Summed admitted-request lifetime falls from 122,000 to 36,900 ms;
that includes waiting in the simulated service, not CPU work eliminated.

Completing mixed-source detail requires 36 additional national requests here,
one for every tile whose gaps still use national pixels. They replace detail
that was never requested before. With 2 s national refinement, completion takes
16 s; first-pass coverage and raw sharpening are unchanged. Full raw coverage
starts zero national sharpening requests, and its complete metrics and request
counts are exactly unchanged. The engine worker count and source/client limits
have not been increased.

The earlier `terrain-demand` benchmark now records first complete cover separately
from final refinement. Its old completion assertion assumed only raw sharpened;
that is no longer an equal-work comparison. The replacement still asserts no
delay to first-pass cover, preserves the raw sharpening/first-paint checks, and
checks that only the 36 contributing national refinements are additional. The
full-detail control is still compared exactly.

## Verification and preserved contracts

- Thirteen new regression cases cover all contributing tiers, late sources,
  dynamic completion, native ceilings, simultaneous provider/refinement limits,
  shared-owner reclassification, stationary base/fine recovery, backoff, final
  nodata, unload/removal, source replacement and an initially unavailable tile.
- Existing published numeric/image recovery still owns its one retry path;
  the CPU layer does not add a second loop to it.
- When every initial source fails, Leaflet completion stays pending until
  recovery supplies useful pixels. An early error completion would leave the
  recovered canvas without Leaflet's visible loaded state.
- A successful absent source does not retry. Obsolete source errors do not
  trigger recovery. Per-tile retry delays are 1, 2, 4, 8, 16, then 30 seconds.
  Backoff holds no request-pool slot. Departure cancels only this tile's wait.
- Twenty-five relevant test files passed, plus `npm run check`, static-site
  assembly/minification, and the current/prior scheduling benchmarks.
- Build h is stamped in `version.js`, `sw.js` and every HTML build URL.

Before this cycle, #64 was squash merged as `92abdb5` and installed. All 103
non-vendor installed asset hashes matched main, service settings including port
8770 survived, public Pages served build g, and main workflow `41371213613`
passed. Live warm-cache USGS tiles/revisits and the Oregon tile at the reported
44.333599, -121.926842 location returned coverage with empty final queues and no
new worker failures/restarts. Those checks verify the previous deployment;
they are not live before/after evidence for this cycle's client changes.

## Output review and next measurements

1. Gap refinement adds necessary work when the secondary provider is slow. Measure
   visible-area completion on representative phones and broad mixed-survey views
   before changing concurrency or using a contributor-size threshold.
2. Compare cold preferred-source success/failure before introducing hedge delays.
   The new combined limits make that comparison possible without bypassing the
   configured provider budget.
3. Measure retained TIFF bytes, header counts and duplicate worker decode time
   across a long pan/revisit session. The cached-header sample alone cannot
   justify byte budgets or a shared decoded cache.

Successful fine survey nodata still retains useful coarse same-source values
in CPU grids. The GPU's authoritative DNR coverage rule is different; changing
that behavior requires preserving lower-source fallback and scientific coverage
evidence. That scientific behavior is left for a separate measured change.
