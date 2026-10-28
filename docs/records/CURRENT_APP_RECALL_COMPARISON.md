# Current app recall and additional moraine leads

Measured the published app (2026-10-13g) and the frozen experimental detector on the same 351 train/validation views. **Using both detects 79.7% of mapped traces, versus 73.8% for the current app alone at its standard 0.58 analytical cutoff.** The new detector alone detects 67.2%.

The user accepts false positives in exchange for additional leads. The new detector is therefore assessed as a supplementary screening layer, rather than requiring it to meet the original high-precision replacement gate. No app code or deployed parameters changed.

## Shared recall and complementarity

| Population | Current app, Balanced ≥0.58 | New likely + possible | Either method | Additional trace from new | Fraction of current misses recovered |
| --- | ---: | ---: | ---: | ---: | ---: |
| train | 74.3% | 65.8% | 79.3% | 5.1 pp | 19.2% |
| validation | 70.3% | 77.0% | 81.9% | 11.6 pp | 39.1% |
| combined | 73.8% | 67.2% | 79.7% | 5.9 pp | 21.7% |

Recall counts mapped positive skeleton pixels within the map’s positional uncertainty. Counts are pooled within each positive region, then regions receive equal weight. Additional coverage counts new detections below the current app’s ≥0.58 score cutoff, not terrain invisible at every heatmap colour. It is coverage of mapped traces, not a percentage of entire moraine objects confirmed geologically.

Validation has only 2 positive sites (boulder-lake, scab-creek) in 1 positive region (wy-wind-river), plus 36 confuser views. Combined positive evidence spans 8 regions. Multiple pans and scales are correlated views, not independent geological discoveries. Previously spent test regions were not scored. These are descriptive train/validation findings, not fresh held-out proof.

## Current app’s scale settings at cutoff 0.58

| Scale | Train recall | Validation recall | Combined recall |
| --- | ---: | ---: | ---: |
| fine | 78.9% | 80.1% | 79.0% |
| balanced | 74.3% | 70.3% | 73.8% |
| broad | 70.1% | 60.9% | 68.9% |

Balanced uses a 10-cell radius; Fine 4; Broad 24. The earlier object experiment’s “current screen” baseline used the core’s 5-cell radius. Its area comparison was against that reference, not the published app’s default Balanced setting. Radius 5 was measured again here solely to reproduce that prior baseline exactly.

## Reviewing look-alike ground

Mean fraction of finite DEM ground flagged on known confuser views:

| Confuser | Current Balanced ≥0.58 | Current Balanced ≥0.45 | New detector |
| --- | ---: | ---: | ---: |
| unglaciated | 24.1% | 40.6% | 16.7% |
| coulee-rim | 19.3% | 30.4% | 13.2% |
| dune | 13.5% | 20.6% | 10.2% |
| fan-margin | 15.7% | 22.6% | 11.3% |
| terrace-riser | 18.5% | 28.6% | 11.7% |
| mima-mounds | 18.0% | 28.4% | 15.4% |
| quarry | 18.8% | 30.4% | 17.1% |
| fault-scarp | 21.3% | 33.7% | 8.8% |
| landslide | 21.4% | 34.9% | 16.6% |

This is area requiring inspection, not candidate-level precision. The app’s continuous heatmap does not currently expose a binary cutoff control. Alternate cutoffs describe the recall/inspection-burden tradeoff; none was tuned or deployed.

## Lowering the current app’s analytical cutoff

| Balanced cutoff | Combined mapped-trace recall | Validation mapped-trace recall |
| --- | ---: | ---: |
| 0.35 | 87.4% | 90.4% |
| 0.45 | 81.8% | 82.6% |
| 0.58 | 73.8% | 70.3% |
| 0.7 | 66.0% | 58.7% |

## Uncertainty

The descriptive paired-region bootstrap gives a 95% interval of 3.1 pp to 8.7 pp for additional coverage from the new detector at Balanced ≥0.58. It resamples the positive regions (10,000 fixed-seed replicates), not individual pixels or repeated views. It cannot correct the small, geographically selected sample or development on training data. No region-bootstrap validation interval is reported because validation has only one positive region.

## Integrity and reproduction

Published source bytes are frozen in `output/glacial-calibration/current-app-snapshot`. The result JSON records their SHA256 hashes, the complete pipeline/corpus fingerprint, Node runtime, all per-view counts, scale/cutoff summaries and detection overlap. Every positive view exactly reproduces prior new-detector skeleton hits, denominator and flagged pixels; every confuser view exactly reproduces the prior radius-5 baseline flagged pixels. Both fingerprint sets are rechecked after computation.

The current pixel screen has no connected-object minimum-area filter. The new mask retains the previous ≥5000 m² membership eligibility and original candidate pixels, excluding display closing, to reproduce the established new-detector results exactly. Both use the same DEMs, labels, uncertainty bands and finite-ground denominators.

Focused tests independently enumerate physical distances on a small grid, check score-cutoff equality/NaN handling, empty detections, overlapping coverage identities, regional versus pooled weighting, confuser area weighting, and API/CLI refusal of the spent test split.

Reproduce with `node scripts/glacial-calibration/compare-current-app.js --jobs 6` and `node test-current-app-recall.js`. Raw data: `output/glacial-calibration/results-current-app-recall.json`.


## Lead-generation interpretation and verification

Under the user's recall-first preference, the new screen is useful as a
complementary lead layer: its added detections include mapped terrain below
the current app's standard score cutoff. It should retain screening language
and show evidence, rather than treat its "likely" label as geological proof.
Considering lower-score colours in the current heatmap also yields more
coverage, with a larger confuser-area burden. A future sensitivity control
could make that tradeoff explicit; no such UI change was made in this task.

All 351 rows completed with zero reproduction mismatches. Current-app scale
and cutoff results, prior core-default baseline counts, source bytes and
experiment fingerprints reconciled. `npm run check` and the focused comparison
tests pass on Node 24.19.0. The inline comparison was visually checked at
728px/light and 360px/dark, with no console messages. The shared chart bundle
exceeded T3's 512 KB HTML limit, so delivery uses a native compact table and
source receipt. Main and deployment remain unchanged.
