# Terrain source queue audit — cycle 5, 2026-11-01

Baseline: `7cfbad5` (merged PR #63). Build: `2026-11-01g`.

## Ranked fixes

| Rank | Fix | Value |
| --- | --- | --- |
| 1 | Track request priority, source group and foreground intent per consumer. | A background view could globally demote a shared request still needed by a visible layer. Departed owners also left stale priorities and foreground accounting. The pool now derives effective demand from its remaining owners, with visible demand first. GPU reprioritization identifies its own consumer by signal. |
| 2 | Retire obsolete raw stand-ins per display child. | A coarse raw render remained protected even after full requested detail covered every child. It could keep a slot, refinement status and stationary retries busy. Stand-ins now release after their final child has complete requested data of equal or better rank and sufficient resolution. |
| 3 | Admit CPU sharpening before queue refill, ahead of overview work. | Starting sharpening in the base promise's finalizer could miss the newly freed slot. Priority zero also put available numeric detail behind all overview requests. Refinement now enters at acceptance, behind numeric first-pass cover and ahead of overview. |

Production capacities remain 20 total source slots, the existing provider/group
limits, and at most six concurrent sharpening requests. No higher concurrency
is used to obtain the measurements.

## Measurements

```sh
node scripts/performance/terrain-demand.js --baseline=7cfbad5 \
  --output=docs/diagnostics/assets/2026-11-01-terrain-demand.json
```

The production pool, GPU store and CPU layer run with a virtual clock and fixed
source costs. These are scheduler measurements, not live-provider, network-byte
or device performance claims.

| Measurement | Before | After |
| --- | ---: | ---: |
| Shared visible request after another owner demotes its own background demand, ms | 5,100 | 100 |
| Sixteen fine tiles complete, ms | 200 | 200 |
| Refinement finishes after those fine tiles replace a slow stand-in, ms | 5,000 | 200 |
| Total source-operation time for stand-in case, summed ms | 6,600 | 1,800 |
| Constrained CPU view: first sharper tile, ms | 2,200 | 200 |
| Constrained CPU view: all 36 sharper tiles, ms | 3,900 | 2,000 |
| Constrained CPU view: first paint, ms | 100 | 100 |
| Constrained CPU view: completion including needed gap filling, ms | 4,100 | 4,100 |

The ownership case uses one slot and a 100 ms shared tile competing with 5 s
foreground work. The stand-in case has sixteen visible tiles, ten raw slots,
100 ms detail and a 5 s coarse render. Its redundant operation cancels at 200
ms; fine requests are unchanged. This does not imply aborting a shared range
already on the wire: the engine retains its existing cache-completion policy.

The CPU stress case limits the harness to eight total slots while retaining
production group limits. Preferred base and sharp requests cost 100 ms,
national 2 s, overview 5 s. Every display tile retains a genuine gap after
nodata-aware base resampling, so lower numeric data remains necessary. The
production-capacity, 20-slot partial and full controls have exactly unchanged
timings, request counts and source-operation times. The priority improvement
therefore applies to queue contention, rather than speeding up an unconstrained
provider. Production capacity is not changed to eight.

Raw results and all controls are in [the recorded JSON](assets/2026-11-01-terrain-demand.json).
The comparison asserts faster shared visible work, lower obsolete work, earlier
constrained refinement, unchanged first paint, no delay to needed gap filling,
and unchanged production-capacity controls. The previous progressive-refinement
and viewport/cancellation comparison workloads retain their improvements.

## Correctness and ownership

- Foreground intent wins independently of registration order. Background
  priorities cannot inflate visible priority. Releasing an owner recalculates
  both queued priority and active group/foreground counters.
- Scoped reprioritization changes only waiters with the same signal. A caller
  without a matching consumer cannot alter another owner's request. Existing
  unscoped API calls retain their behavior for their callers.
- Shared reads continue while any consumer remains. Effective group changes
  retain source limits for queued work and correct accounting for running work.
- A stand-in retires only on full, masked, exact requested target coverage.
  Missing or partial targets retain coarse cover. A cached ancestor never proves
  fine detail complete. Multiple children and native tiles serving both cover
  and an exact target retain independent ownership.
- Full resident preferred data suppresses new redundant raw stand-ins on
  revisits. Redundant failures and retry intent retire together. Stale callbacks
  cannot cancel a new view's cover, and another layer retains its own consumer.
- Numeric first-pass cover stays ahead of sharpening. Quality ranks, nodata,
  provenance, source-native limits and published-image separation are unchanged.

Verification: 24 relevant test files passed, including 15 new ownership,
stand-in and constrained-refinement regressions. Coverage includes stationary
recovery, intermediate viewport settlement, shared cancellation, quality
ordering, Oregon provenance, 3D/mesh scheduling, readout, exports and packaging.
`npm run check` passed for build g. The fixed-cost comparisons above also assert
that every CPU output retains the expected numeric pixels and final status.

## Deployment verification and next review

Before this cycle, PR #63 merged as `7cfbad5`, passed its main deployment run,
and reached public Pages as build f. All 103 non-vendor installed asset hashes
matched merged main, the installed source-release paths passed CPU/GPU checks,
and service settings (including port 8770) were preserved. Live USGS/Oregon
coverage and cached revisits passed with empty final source/render queues and
no new failures or worker restarts. Those warm-cache checks establish deployment
and correctness, not a cold-provider comparison for this frontend cycle.

The output review leaves these next candidates:

1. CPU mixed-source HiDPI tiles sharpen their best source; lower-rank pixels
   filling survey gaps can remain at base resolution. Measure selective
   refinement of contributing sources without growing speculative demand.
2. Measure delayed lower-LiDAR hedging against cold and failed preferred sources.
   Immediate parallel starts still spend some source work before cancellation
   but protect blank/failed coverage; provider measurements should guide delay.
3. Measure the engine's private decoded-grid/header memory and duplicate decode
   work, separately from its now-shared compressed ranges and catalogue reads.

Complementary partial GPU grids remain a conservative case: their union is not
used as proof to cancel additional sources. Overview/backdrop work keeps its
existing pan/zoom purpose after raw stand-ins retire.
