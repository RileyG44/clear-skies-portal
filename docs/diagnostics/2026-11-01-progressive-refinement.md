# Terrain source queue audit — cycle 4, 2026-11-01

Baseline: `d24815f` (merged PR #62), build `2026-11-01f`.

## Ranked fixes

| Rank | Fix | Value |
| --- | --- | --- |
| 1 | Start CPU HiDPI refinement when useful base data arrives. | The all-source completion barrier let a slow overview or national request postpone an already available sharper LiDAR tile. The best available contributing source now starts sharpening independently; a later better source can also refine. |
| 2 | Retire redundant GPU source demand per display tile. | Full preferred numeric coverage previously kept waiting for slower, lower-ranked LiDAR and held queue capacity. Each display chain now releases its lower-ranked targets; a shared native parent stays until every child releases it. |
| 3 | Retire redundant CPU source consumers. | Full numeric coverage now cancels lower tiers that cannot contribute pixels, including superseded sharpening. This releases this tile's wait and queue slots without cancelling another layer's shared request. |

Concurrency limits and server source selection are unchanged. Quality ranks,
per-pixel gaps, explicit source preferences and provenance retain their existing
meaning. Published hillshade remains a picture, separate from numeric heights.

## Reproduction and measurements

```sh
node scripts/performance/progressive-refinement.js --baseline=d24815f \
  --output=docs/diagnostics/assets/2026-11-01-progressive-refinement.json
```

The harness executes the production CPU layer, GPU native store and shared
request pool with a virtual clock. Preferred base data costs 100 ms, HiDPI
refinement 80 ms, national data 2 s and other fallback data 5 s. The partial CPU
fixture retains holes after real nodata-aware resampling, so national data is
still necessary. The viewport fixture has 36 visible tiles and six constrained
source slots. This tests backlog behavior, rather than changing production
limits to obtain a result.

| Measurement | Before, ms | After, ms |
| --- | ---: | ---: |
| CPU finest detail, with partial base and slow fallback | 5,080 | 180 |
| CPU completion with full detail and redundant fallback | 5,000 | 100 |
| GPU completion with full preferred detail | 5,000 | 100 |
| GPU completion when partial preferred detail needs raw fallback | 5,000 | 5,000 |
| All preferred detail across the constrained 36-tile view | 25,900 | 1,200 |

In the viewport fixture, completed source operations fall from 72 to 36; the
36 redundant operations cancel when their higher-quality replacement arrives.
Total occupied source-operation time falls from 183,600 to 7,200 ms, summed
across concurrent requests. This is not elapsed time, a network byte count, or
a claim that already-started real COG downloads stop. The engine intentionally
finishes on-wire shared ranges into cache. Raw results, control outcomes and
operation counts are in [the recorded JSON](assets/2026-11-01-progressive-refinement.json).

These fixed-cost measurements establish scheduler improvements. They do not
predict cold provider latency, browser frame rate, or phone speed.

## Correctness and lifecycle

- CPU refinement starts only for contributing numeric data. Fine nodata retains
  useful base pixels. A later higher rank can supersede and cancel lower-rank
  refinement, while a pending higher-quality provider remains eligible.
- CPU lower tiers retire only when every output pixel already has a higher
  numeric rank. Mixed partial sources can jointly establish that coverage.
- GPU retirement requires a full, masked, exact requested target record. A
  cached ancestor cannot suppress detail at a settled intermediate zoom.
  Partial target records conservatively keep lower sources.
- GPU ownership covers all display children of a shared native tile, including
  the current view after demand changes. Another layer retains its independent
  request-pool consumer. Transitional cover and backdrop work keep their
  separate purpose.
- Retired failures and cancellations do not report failed refinement or retry
  useless fallbacks. Genuine missing better sources still fail and remain
  eligible for recovery. Published numeric recovery keeps its existing result
  contract.
- Unloading during early refinement cancels consumers and releases canvases.
  Stale view callbacks cannot retire requests belonging to a newer view.

Verification: 20 relevant test files passed, including 16 new CPU/GPU ownership
and refinement regressions, actual intermediate-zoom settlement, stationary
recovery, published composites, source preferences, Oregon units/provenance,
3D/export sampling, shared request lifecycle and packaging. `npm run check`
and the baseline comparison above cover syntax/assets/build stamps and the
fixed-cost performance claims respectively.

## Live input from PR #62 and next review

Before this cycle, installed assets matched merged main. A live cold USGS tile
at 47.4551, -121.6917 returned full numeric coverage in 2,418 ms. Its three
source reads averaged 2 ms in the source queue and about 984 ms from read start
to response. This sample points to provider/read cost rather than a source
backlog for that particular cold tile.

After a rapid view change, four new z18 tiles returned full coverage in 37–57
ms using warmed source data; their revisits were cache hits at about 2 ms.
Abandoned render/source work drained, with no worker failures or restarts.
The Oregon DOGAMI tile at the reported 44.333599, -121.926842 site still returned
full coverage. These were single live verification runs, not a controlled
before/after comparison for this cycle's frontend changes.

The output review leaves these next candidates:

1. Measure low-priority CPU sharpening under a large settled viewport: starting
   earlier removes the dependency barrier, but it still competes within the
   existing request budget.
2. Evaluate delayed lower-LiDAR hedging and retiring obsolete raw stand-ins.
   Sources still start together for resilience to failed/empty preferred data;
   cover/backdrop remain protected to avoid blanking fast pans.
3. Measure private cross-worker decode costs and cold catalogue discovery
   separately from provider read time. Shared ranges remove duplicate transfer,
   but each rendering worker still owns its decoded grids.

Complementary partial GPU sources are not treated as proof of full coverage
for cancellation. Recognizing their union requires native-crop validity work;
the conservative behavior preserves gap filling at the cost of some extra
fallback demand.
