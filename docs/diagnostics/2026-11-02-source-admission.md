# Terrain source queue audit — cycle 7, 2026-11-02

Baseline: `ff6c74edc2dd6eb26879fe0be82ba611d284f3be` (#65, build
`2026-11-01h`). This is the final audit cycle requested before updating the Mac,
Dell terrain engine and internal TestFlight build.

## Findings ranked by value

| Rank | Fix | Evidence and value |
| --- | --- | --- |
| 1 | Balance source admission between reader workers. | A broad 192-block window occupied the global queue ahead of a different reader's two blocks. Scheduling by active consumer reads, with rotating ties and FIFO within each reader, admits small useful work as slots open. Worker borrowing and existing global/local limits still apply. |
| 2 | Preserve an immediate replacement in shared upstream admission. | An aborted request's finalizer unconditionally removed its key, erasing a newly queued replacement. A third viewer then created a duplicate transport. Finalizers now remove only their own entry. |
| 3 | Categorize bounded source-failure diagnostics. | Installed Mac traffic recorded 24 source failures and a maximum queue wait of 20,428 ms, but aggregate counters could not distinguish provider failures from timeouts. Health now includes error buckets and one bounded recent failure, and S3 HTTP/timeout/body-size errors carry stable codes. This enables diagnosis; it does not directly reduce latency or establish the historical failures' cause. |
| 4 | Measure fairness between jobs sharing one reader worker. | Admission currently identifies consumer workers, not individual render jobs. Independent jobs within one worker still share that reader's allowance. Task identities would require changes through the worker/source boundary; no measured benefit yet justifies that scope. |
| 5 | Measure live source failure and cold-view completion before changing budgets or hedging. | The installed snapshot establishes queue pressure, not whether provider capacity, broad windows or failing reads dominate. Preserve working fallback and collect categorized failures before tuning. |

The first three are implemented. Concurrency limits, scientific source labels,
per-pixel quality precedence and independent cancellation remain unchanged.

## Controlled comparison

```sh
node scripts/performance/source-admission.js --baseline=ff6c74e \
  --output=docs/diagnostics/assets/2026-11-01-source-admission.json
```

The workload executes the actual broker and upstream code with a virtual clock,
100 ms range costs, 24 global slots and six borrower workers. The second reader
arrives one millisecond after the broad window. All requested work remains useful.
HTTPS sharing uses controlled transport. These are scheduling measurements, not
live-provider or device timings. Full results are in [the recorded
JSON](assets/2026-11-01-source-admission.json).

| Measurement | Before | After |
| --- | ---: | ---: |
| Small reader's first range starts | 799 ms | 99 ms |
| Small reader's two ranges complete | 899 ms | 199 ms |
| Broad reader completes | 800 ms | 900 ms |
| All work completes | 900 ms | 900 ms |
| Physical range reads | 194 | 194 |
| Single-reader control completion | 800 ms | 800 ms |
| Single-reader control reads | 192 | 192 |
| Rapid-revisit target transports | 2 | 1 |

Fairness advances the small reader by 700 ms and delays the broad reader by
100 ms, without changing overall completion or read count. Both versions use all
six borrowers. The single-reader control is exactly unchanged. The revisit case
avoids a duplicate transport; the fairness case makes no byte-reduction claim.

Selection examines each reader's first eligible pending range instead of scoring
every queued block for each free slot. A busy CPU worker may still read its own
data; only available workers may borrow another reader's work. Shared active
reads count toward every current reader, and departing consumers stop counting.

## Verification and diagnostic bounds

- Fifteen new regressions cover reader fairness, rotation, shared-owner departure,
  replacement identity during queued/on-wire revisits, independent cancellation,
  retry, HTTP errors, timeouts, oversized bodies and the actual broker protocol.
- Existing real six-worker tests preserve numeric 123.5 m output, compressed
  sharing, worker-loss recovery, borrowing, bounded queues and warm revisits.
- Pool, task-cancellation, warming, server, USGS render/index/OPR/coverage-cache,
  Oregon, elevation loading/refinement/recovery and source-release/stand-in
  regressions pass. Static checks and assembled/minified site checks also pass.
- The real-worker control benchmark runs three trials each: shared reads use
  two physical requests, independent/single-reader reads use twelve, all revisits
  use zero network requests, and every case preserves numeric values with no
  final queued/active ranges or source failures. Local timings vary by execution;
  they are regression controls, not a before/after speed claim.
- Health retains at most sixteen error buckets including `OTHER`, plus one recent
  failure with a 64-character code, 160-character message, read phase and queue/read
  durations. A shared failure counts once per read; cancellation is not a failure.
- Build `2026-11-02a` is stamped in `version.js`, `sw.js` and all HTML build URLs.

Before this cycle, #65 was installed on the Mac with all 103 non-vendor asset
hashes matching main. Warm USGS revisits and the reported Oregon tile
`18/42287/94982` returned full coverage. Active user traffic had drained by the
later snapshot, but earlier traffic showed 24 source reads on wire and 80 queued
behind two renders. Historical failures cannot be explained retrospectively.

Deployment preflight found the Dell service still on `75bdfa4`, with three
workers on four cores. Updating that service is required to deliver the earlier
tile fixes to the engine used by the phone. Keep its downloaded DNR files, cache,
service settings and worker count intact. TestFlight bundles the same assembled,
minified web assets as Pages; the terrain broker runs on the engines.

## Output review

The measured small-reader delay and duplicate revisit transports are addressed.
The next useful evidence is live cold-view completion and categorized failures
across broad mixed-survey views. Per-job fairness, fallback hedging and TIFF cache
budget changes remain measurement candidates. No further audit iteration starts
after this commit, as requested; deployment and verification finish the work.
