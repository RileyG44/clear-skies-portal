# Settled viewport and tile queue audit — 2026-11-01

Baseline: `ed16560`. Shipped web build: `2026-11-01b`.

Riley reported terrain staying blurry at intermediate zooms until another zoom
to a close view. The audit followed Leaflet camera commits, GPU demand, the
shared source pool, native elevation storage, HTTP cancellation, terrain worker
scheduling, USGS sampling, published hillshade and 3D mesh scheduling.

## Ranked fixes

| Rank | Fix and value | Status |
| --- | --- | --- |
| 1 | Give every settled viewport an explicit demand refresh, and stop expensive GPU requests at passing zooms. This addresses the refresh trigger and prevents intermediate levels from building a backlog. | Implemented |
| 2 | Batch queue admission, prioritize visible tiles before the prefetch ring, and run background work only after foreground work. This spends engine capacity on pixels the user can see. | Implemented |
| 3 | Cancel abandoned raw renders cooperatively. Free the worker promptly while retaining reusable shared COG reads and decoded caches. | Implemented |
| 4 | Make server-side styled-tile neighbour warming yield to new demand. The existing idle check happens before a batch of up to 12 speculative jobs starts; subsequently arriving demand cannot reclaim already running warm jobs. Lower value for the default numeric GPU path, which does not invoke this warmer. | Implemented in [cycle 2](2026-11-01-source-queue.md) |
| 5 | Add live queue-age, per-source latency and visible-detail completion telemetry, then tune concurrency to the engine and connection. Current fixed browser limits can overfeed a small engine or underfeed a large one; measurements should drive the limit. | Follow-up |
| 6 | Coalesce pending COG header parsing and decoded block work, beyond the existing shared range reads, and retire unused queued ranges when their final render leaves. This can save cold-start work, but needs source-read ownership to avoid cancelling another viewer. | Implemented in [cycle 2](2026-11-01-source-queue.md) |

## Findings and implementation

**Settled demand.** The GPU engine updated demand only when its rounded,
buffered tile rectangle changed. A stationary refresh with the same rectangle
was skipped, and status/readiness queries could themselves issue requests.
Unlike CPU terrain, GPU terrain did not honor expensive preview deferral: every
painted zoom level could initiate raw elevation renders. The CPU fallback also
kept `_cspDeferred` set during an ordinary reset, and depended on a particular
touch-animation callback to release it.

The GPU layer now coalesces camera events and refreshes source demand 160 ms
after the camera rests, including fractional zooms and unchanged tile bounds.
During zoom previews it shades resident pixels without starting source demand.
Ordinary panning retains incremental loading. Readiness queries are read-only
and count visible tiles; palette and lighting redraws do not refresh demand.
Normal resets and `moveend` release CPU gesture deferral. Removing the GPU
layer cancels its demand while retaining resident data for a later revisit.

**Queue admission and priority.** `RequestPool.request()` previously drained
immediately. Lower-priority cover/background requests submitted first occupied
slots before the rest of the viewport could be sorted. A one-tile prefetch ring
received the same treatment as visible detail; on wide viewports, offscreen
tiles near the centre could beat visible corners. Wrapped tile coordinates
were also ranked against an unwrapped centre without correcting the distance.

Admission and slot refills now coalesce in a microtask, allowing the batch to
be sorted before work starts. Native source requests shared by visible and
prefetch tiles take foreground priority. A pan promotes/demotes queued work,
including its source group, while retaining the provider concurrency limits.
Offscreen prefetch and far backdrops run only when no foreground work is queued
or active, with at most two background requests active. Stand-ins are limited
to visible ground. A formerly visible render that moves into the margin yields
its active slot and requeues as background work. Background failures do not hold visible readiness
or create
stationary retry traffic. Antimeridian priorities use the nearest world copy.

**Engine cancellation.** HTTP disconnects already reached `terrainTask()`, but
raw routes selected `finishOnAbort`: an abandoned render occupied a worker
until it completed or hit its 30-second timeout. Browser cancellation therefore
freed a browser slot without freeing the engine slot. Rapid gestures could
continually feed new work behind old work.

Raw elevation and styled raw terrain now cancel when their final viewer leaves.
The pool sends a cancellation message to that render's worker; USGS sampling
stops waiting at its current asynchronous stage instead of opening more surveys,
sampling fallback passes or encoding an unwanted PNG. Already shared headers
and block reads may complete into their caches. Other renders on the same
worker continue. The existing two-second grace/worker-recovery path remains
available for a worker that does not acknowledge cancellation. An immediate
revisit creates fresh demand, and an old completion cannot remove its replacement
from the shared-job map. Explicit background downloads retain their existing
ownership and cancellation behavior.

Published hillshade remains an image rather than numeric elevation. Its
separate four-slot pool and retry path, the shared elevation caches, quality
ranking, confirmed nodata handling, source-native zoom limits and 3D mesh
refinement contracts remain covered by regression tests. Source spacing and
available native detail still limit attainable resolution; this repair does
not create detail beyond the data.

## Measured outcome

Run `node scripts/performance/tile-scheduling.js --baseline=ed16560`.
The same modules from the baseline and working tree run without changing a
checkout or contacting a provider. The scheduling fixture uses 36 visible tiles
plus a margin, the application's 20-slot pool and provider limits, fixed source
costs, and a virtual clock. Cancellation uses a real worker after warming it,
with one abandoned 400 ms render followed by a 10 ms current render.

| Measurement | Baseline | Repair |
| --- | ---: | ---: |
| First visible detail, virtual ms | 280 | 100 |
| All 36 visible detail tiles, virtual ms | 780 | 480 |
| Requests started before visible detail completes | 177 | 51 |
| Offscreen raw requests started before visible detail completes | 29 | 0 |
| Total source requests after background completion | 208 | 201 |
| New view ready after abandoning old render, real fixture ms | 412.7 | 11.6 |
| Worker restarts in cancellation fixture | 0 | 0 |

Visible detail completes 38% sooner in this workload, with 71% fewer requests
started before it finishes. These are controlled scheduling results, not live
provider latency, physical iPhone performance or a universal speedup claim.
Prefetch still eventually runs to support later pans; the main improvement is
which work completes first.

## Verification

- `npm run check` and focused Node tests covering the pool, GPU store/engine/
  layer, settled camera, worker cancellation, USGS sampling, provisional recovery,
  CPU elevation loading, drape, published hillshade, 3D mesh scheduling and server.
- Three regression files run against baseline production modules fail on eager
  admission, missing preview deferral and raw `finishOnAbort`; they pass with
  the repair.
- Real-GPU engine parity: 23 checks each on Chrome/Metal and WebKit/Apple GPU,
  including seven settled zooms from 13.25 through 22,
  repeated same-bounds settlements, zero preview demand, read-only readiness,
  stationary settings, source ranking, nodata, fallback and context recovery.
- Cancellation tests exercise multiple viewers, cancellation during an actual
  sampler's shared header wait, immediate revisits, a healthy neighbouring job
  and no worker restart/requeue after cooperative cancellation.

Real-device gestures, slow remote connections and cold live provider responses
remain field checks. The installed engine must be updated as well as the web
build to receive cooperative backend cancellation.

[Machine-readable benchmark and GPU evidence](assets/2026-11-01-tile-scheduling.json).
