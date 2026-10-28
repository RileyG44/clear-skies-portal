# 2D progressive detail recovery

Release **2026-10-17j** fixes tiles remaining at coarse resolution while the
map is stationary after panning or zooming. Source resolution, numerical
precision, rendering quality and native zoom ceilings are unchanged.

## Causes and changes

1. Failed detail requests entered a cooldown, but the GPU engine only renewed
   requests when tile bounds or sources changed. Expiry did not retry them.
   Current visible demand now schedules a retry after the 10-second cooldown.
   Moving away, clearing, changing sources or destroying the store cancels
   obsolete demand; abandoned results cannot overwrite current tiles.
2. Every primary tile had to finish before any sharpening could start. The
   request pool separately required all primary work to be idle. Refinement
   now follows each completed region. Sharp requests keep their six-slot cap
   within 14 total slots, leaving eight slots for newly exposed terrain; normal
   primary priorities and other source caps are retained.
3. A small valid patch in a higher-ranked survey could suppress finer fallback
   tiles across the rest of the region. Partially covered regions now refine
   exposed lower-ranked sources too. Existing per-pixel rank precedence remains.

Explicit `X-Coverage:none` and successfully decoded empty elevation are cached
as terminal zero-valid records, with no repeating retries. Network failures
remain retryable; an exhausted pending-processing response throws a transient
error rather than being cached as missing coverage. UI status keeps scheduled
recovery marked as refining.

## Reproduction and measured verification

[Raw browser and baseline proof](https://github.com/RileyG44/clear-skies-portal/blob/73d117a/docs/gpu2d-refinement-validation.json) (repository history).
`scripts/gpu2d/refinement.js` uses the complete app, real hardware GPU and the
actual configured shared pool on an isolated server. It holds one native parent
request and fails half the fine tile URLs once. It then stops all interaction.
The fixture shortens only the retry delay to 350 ms; production remains 10 s.

| Scenario, fixed desktop viewport | Released baseline | Fixed Chrome/Metal | Fixed WebKit |
|---|---:|---:|---:|
| Native detail before unrelated held parent completes | 0 | 51 | 16 |
| Tiles reaching their requested native detail | 70 / 140 | 140 / 140 | 140 / 140 |
| Transient failed tiles retried successfully | 0 | 70 | 70 |
| Page errors | 0 | 0 | 0 |

The exact count painted before the hold is released varies with scheduling.
Both fixed browsers show actual pixel changes as detail replaces coarse data,
with unchanged camera position. The baseline deliberately reproduces the bug;
its JSON `pass:true` means the expected regression was observed, not that the
baseline completed refinement. Baseline modules are pinned to `79722f9`.

The expanded store regressions cover independent regions, partial-survey
fallbacks, stationary error/empty-result recovery, terminal provider no-coverage,
and cancellation of offscreen retries. Existing A-to-B-to-A demand, source
revision, no-data/rank, memory, GPU layer and engine checks remain in place.
An independent GPT review also saturates the real pool at 14 total / 6 sharp /
8 primary requests and verifies clearing, source changes, late results and
partial-source precedence. No DeepSeek work is used in this fix.

The full repository verification passes with zero dependency vulnerabilities.
These are controlled rendering and scheduler tests, not a guarantee that an
external provider has detail for every location or that downloads complete
within a fixed time. Physical iPhone hardware is untested.

The WebKit phone-size run also recovers all **60/60** native tiles after **30**
transient failures, with zero page errors. The final independent review passes
the full production fetcher → adapter → store chain for explicit no-coverage,
empty DEMs, rejected transport, exhausted processing polls and source revisions.

Run the regression against an isolated server with:

```sh
node scripts/gpu2d/refinement.js --url http://127.0.0.1:8826/ --browser chrome
node scripts/gpu2d/refinement.js --url http://127.0.0.1:8826/ --browser webkit --phone
```

## Deployed verification

[CI39105840030](https://github.com/RileyG44/clear-skies-portal/actions/runs/39105840030)
passes Linux verification/audit, Windows tests and Pages deployment. Build j
is installed in the backed-up Mac runtime. Page, version, service worker and
GPU store assets match the expected source locally and minified artifact on
Pages. The hosted page loads build j and the retry scheduler.

On actual local-service terrain in Chrome/Metal, a fine national tile request
was forced to fail all three transport attempts. With the camera unchanged,
it retried after **10,107 ms** and loaded all **65,536** valid native samples;
its failure flag cleared, renderer frames advanced and no page errors occurred.
The production 10-second retry interval was retained for this live check.
[Deployment evidence](https://github.com/RileyG44/clear-skies-portal/blob/73d117a/docs/gpu2d-refinement-deployment.json) (repository history).
