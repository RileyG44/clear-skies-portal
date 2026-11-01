# Terrain source queue audit — cycle 2, 2026-11-01

Baseline: `ab4f769` (the merged settled-viewport repair in PR #59).
Build: `2026-11-01c`.

This cycle repeats the audit below the browser/render queue. The first repair
stops obsolete sampling jobs, but a worker still had its own uncancellable S3
queue. Concurrent renders also shared byte transfers without sharing the
subsequent header parsing or block decoding.

## Ranked fixes

| Rank | Improvement | Outcome |
| --- | --- | --- |
| 1 | Remove unowned queued S3 ranges. Abandoned reads otherwise stay ahead of the new viewport after its obsolete render has already stopped. | Implemented, including shared ownership through header, block and UTM-zone discovery. Reads already on the wire remain available to revisiting/shared consumers and populate the cache. |
| 2 | Share pending TIFF header parsing and decoded blocks per worker. The default two overlapping raw renders can repeat the same CPU and allocation work after their shared HTTP response. | Implemented. Each live header/block has one pending operation; failures and cancelled replacements remain retryable. |
| 3 | Make styled-terrain neighbour warming yield to real demand. A single idle check previously admitted twelve jobs, leaving running speculation ahead of a subsequent viewport. | Implemented. One speculative render after 160 ms of idle time, with a bounded candidate list; new terrain demand clears the list and cancels the warm viewer. A visible viewer joining that render retains ownership. |

The third change affects the styled raw-terrain route, including the CPU
fallback. The default numeric GPU path does not invoke this warmer.

## Review loop

The first benchmark/test review identified two additional gaps in these paths:

- S3 slot handoff incremented the next request's active count in a microtask.
  A newcomer could take the apparently free slot before that increment and
  exceed the configured limit. Slot handoff now reserves capacity synchronously.
- Zoneless source discovery opened a TIFF header without the render's signal.
  This quietly retained ownership after sampling stopped. The signal now passes
  through candidate/zone discovery and the coverage endpoint, and cancellation
  does not cache an unknown zone.

Both have focused regression coverage. Cancellation fans out through one
listener per render signal, including windows touching many blocks. Finishing,
failure and abort release listeners; old completion callbacks cannot erase a
replacement operation with the same key. The final review retained native
source ranking, nodata/provisional recovery and the existing bounded caches.

## Repeatable measurements

Run:

```sh
node scripts/performance/terrain-source-queue.js --baseline=ab4f769
```

This runs the production modules from either revision with actual TIFF parsing,
deflate decoding and temporary disk caches. HTTPS is controlled at 20 ms/read
with one S3 slot. The warming scenario uses one simulated worker with a 400 ms
warm render, 10 ms visible render and demand arriving 160 ms after a cache hit.

| Measurement | Before | After |
| --- | ---: | ---: |
| Header parses for two overlapping renders | 2 | 1 |
| Block decodes for two overlapping renders | 2 | 1 |
| Source requests for those shared reads | 2 | 2 |
| Queued ranges after 24 header consumers depart | 24 | 0 |
| Obsolete source requests reaching HTTPS | 24 | 0 |
| Current view ready in that queue workload, virtual ms | 520 | 40 |
| Speculative jobs admitted by the warmer | 12 | 1 |
| Speculative jobs queued when new demand arrives | 11 | 0 |
| Current view ready behind warming, virtual ms | 250 | 10 |

These are controlled workload comparisons, not phone or live-provider latency
claims. The default two raw jobs per worker are used for the CPU-work comparison;
an eight-consumer regression also checks fan-in. The earlier browser scheduling
benchmark still produces its repaired 480 ms visible-detail completion and zero
offscreen raw starts before visible completion.

[Machine-readable results](assets/2026-11-01-source-queue.json).

## Verification

- `npm run check`.
- 18 relevant Node test files: source queues, warming, TIFF/PNG numerics, USGS
  index/OPR/render/coverage recovery, cache budgets, terrain workers, shared task
  cancellation, CPU/GPU elevation loading, settled-viewport scheduling and server
  integration. Both new regression files fail against `ab4f769` and pass here.
- Cancellation tests cover queued headers and blocks, multiple owners, a read
  already in flight, an immediate revisit, zone-discovery cancellation, failed
  header/block retries, concurrency handoff and abort-listener cleanup.
- Warming tests cover idle admission, serial capacity, bounded work, demand
  during the pause, active cancellation and a visible consumer retaining a warm
  render after another request arrives.

## Next audit priorities

1. Measure live per-worker source queue age, range latency and view completion
   before tuning concurrency or the treatment of orphaned reads already on the
   wire. Those reads currently finish into the reusable cache; this cycle bounds
   them to the existing S3 concurrency rather than interrupting useful transfers.
2. Evaluate duplicate cold ranges across workers. Sharing added here is per
   worker; workers still share completed disk ranges rather than in-flight
   reads. A broker/affinity change needs a cross-worker workload and measurements
   to justify its coordination and memory costs.
3. Exercise gestures on physical phones and cold/slow live providers. Fixed
   concurrency remains unchanged until those measurements support a better value.

These are the next review inputs, not claims of additional implemented fixes.
