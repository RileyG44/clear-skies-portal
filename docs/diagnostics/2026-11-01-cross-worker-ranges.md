# Terrain source queue audit — cycle 3, 2026-11-01

Baseline: `752077d` (merged Oregon coverage fix, PR #61). Build:
`2026-11-01e`. PR #61 is deployed as build d; the installed Mac engine's assets
matched merged main and all 11 checked Oregon tiles returned full numeric
coverage without worker failures or restarts before this cycle began.

## Ranked fixes

| Rank | Improvement | Value and implementation |
| --- | --- | --- |
| 1 | Share cold COG ranges across workers. | Six workers previously downloaded the same header and compressed block six times each. One borrowed worker now downloads and atomically caches each pending range. Consumers receive a shared immutable buffer; HTTP, disk I/O, parsing and decoding remain off the server thread. |
| 2 | Bound and cancel the shared source queue. | A process-wide range budget and 1,024-entry queue prevent an unbounded backlog. The default preserves existing capacity (workers × the existing per-worker S3 limit). Last-owner cancellation removes queued work, and on-wire work remains reusable. Borrowed downloads balance across available workers within their local limits. CPU-busy workers only read for their own consumers. Worker loss reassigns surviving consumers. |
| 3 | Expose source pressure and reuse in health data. | `terrain.sourceRanges` now reports queued and on-wire reads, oldest queue age, queue and read durations, bytes, sharing, failures, capacity rejections and per-worker consumers/completed downloads. Render queue length alone could not identify the source bottleneck. |

No network concurrency increase is used to obtain the shared-read improvement.
The process-wide limit covers worker COG ranges, not standalone catalogue,
coverage or other providers' requests.

## Repeatable measurements

```sh
node scripts/performance/cross-worker-ranges.js --baseline=752077d \
  --output=docs/diagnostics/assets/2026-11-01-cross-worker-ranges.json
```

The workload uses six real worker threads, actual TIFF parsing/deflate decoding
and temporary disk caches. Every decoded pixel must equal the fixture's known
123.5 m value. A controlled local provider imposes 50 ms per read. Shared and
independent six-reader cases have two provider slots; the single-reader case
opens six files with eight provider slots. The baseline loads the historical
pool without broker support; both sides use the same reader and numeric fixture.

Three runs per case, median completion:

| Measurement | Before | After |
| --- | ---: | ---: |
| Shared cold downloads | 12 | 2 |
| Shared downloaded bytes | 399,480 | 66,580 |
| Shared cold completion, ms | 332 | 121 |
| Independent files completion, ms | 329 | 329 |
| Single reader, six files completion, ms | 179 | 135 |
| Single reader, peak provider concurrency | 4 | 6 |
| Network requests on every revisit | 0 | 0 |

Shared downloads and bytes fall by 83.3%. The independent-file control retains
its request count and measured median. The single-reader case uses otherwise
available worker network slots while retaining one rendering/decoding reader.
These are controlled source-workload results, not phone or live-provider timing
claims. All trial data and telemetry are in the
[recorded results](assets/2026-11-01-cross-worker-ranges.json).

## Correctness and lifecycle

A tile's local shared header/block operation owns one remote subscription.
Removing one tile or one worker's subscription cannot cancel another consumer.
When the last viewer leaves, queued broker and local S3 reads cancel; already
started downloads finish into the reusable cache. An immediate revisit shares
an on-wire result or retries after a queued cancellation is acknowledged.
An old completion cannot erase its replacement. Network failures do not become
cached absence. Both byte windows and source keys participate in sharing.

An owner is borrowed for I/O independently of its own tile job. If its worker
exits, surviving consumers move to another worker. The interrupted owner's job
retains the pool's existing failure behavior; healthy neighbours succeed. Pool
close clears coordination and terminates the workers. Buffers are retained only
while the read is pending; completed memory caches and decoder state keep their
existing budgets. Scientific source selection, units, nodata and quality ranks
are unchanged.

Health durations include IPC and cache work. `active` counts assigned loads;
`onWire` counts started network reads; `queued` includes loads waiting at a local
S3 gate as well as the global queue. `avgReadMs` is the successful started-read
to-response cost. Disk hits that bypass the broker and decoded-grid hits are not
included in its counters. The per-worker completed-read counters reset with a
replacement worker; global totals persist for the pool lifetime.

## Verification and next review inputs

- `npm run check` and 18 relevant Node test files covering pool/worker lifecycle,
  shared queues, TIFF/PNG numerics, source discovery, nodata/OPR/provisional
  recovery, cache budgets, source cancellation, CPU elevation, Oregon numeric
  conversion, server health, warming and packaging.
- Real six-worker sharing and owner termination; all surviving readers and a
  subsequent revisit retain the expected numeric grids.
- Queue saturation/retry, 24 abandoned ranges, one remaining owner, immediate
  revisits, on-wire reuse, byte-window isolation, borrowed-worker balancing,
  CPU availability, local capacity, failed reads and stale owner messages.

The output review caught a possible queue imbalance: assigning every download
to the first consumer could fill its local gate while other workers were free.
The final scheduler borrows available workers within their local limits and
can advance a serviceable read past a locally blocked queue head.

Next inputs for the requested loop are live queue/read telemetry under gestures
and CPU analysis, cross-worker duplicate decoding after the shared transfer, and
cold catalogue discovery. Do not raise concurrency based only on the controlled
latency fixture. Decoded blocks remain private to each worker; catalogue reads
and responses that finish after every viewer leaves remain separate follow-up
measurements.
