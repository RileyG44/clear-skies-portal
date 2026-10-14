# Moraine belt v3 results

Completed 2026-10-13 on `glacial-calibration`. **FAIL: keep experimental; do not merge or deploy.**

All 351 eligible train/validation views were evaluated under frozen source,
parameters and dataset fingerprints: 297 training views and 54 validation
views. The combined screen passes the recall and baseline-confuser-area
gates but fails the required likely precision of 0.5. Previously spent
test regions were not scored. No parameters were tuned after these results.

| Split | Ridge-only likely precision | Ridge + belt likely precision | Ridge-only recall | Ridge + belt recall |
| --- | ---: | ---: | ---: | ---: |
| train | 0.3016 | 0.4856 | 0.1660 | 0.6578 |
| validation | 0.0556 | 0.1579 | 0.0791 | 0.7701 |
| Combined official | 0.2469 | 0.4350 | 0.1551 | 0.6718 |

Recall measures mapped positive skeleton within its uncertainty band using
eligible **likely and possible** objects. Likely precision measures the
fraction of eligible likely objects touching mapped positives or that band.
These are morphology-screen metrics, not probabilities of glacial origin.
The ridge-only comparison uses the same revised feature extraction and
membership rules, so it differs from the original v2 evaluation.

The belt path greatly improves coverage, but its likely precision drops from
48.56% on training to 15.79% on validation. It cannot support a reliable
low-false-positive detector or any near-100% accuracy claim.

## Confuser ground flagged (likely + possible)

Fractions below are mean valid-ground area fractions per confuser type,
across train and validation. This is an area metric, not object precision.

| Confuser | Ridge-only | Ridge + belt | Original pixel screen | Combined below baseline |
| --- | ---: | ---: | ---: | --- |
| coulee-rim | 0.0357 | 0.1321 | 0.1928 | yes |
| dune | 0.0308 | 0.1022 | 0.1372 | yes |
| fan-margin | 0.0304 | 0.1127 | 0.1593 | yes |
| fault-scarp | 0.0210 | 0.0884 | 0.2121 | yes |
| landslide | 0.0434 | 0.1663 | 0.2187 | yes |
| mima-mounds | 0.0357 | 0.1541 | 0.1838 | yes |
| quarry | 0.0399 | 0.1706 | 0.1931 | yes |
| terrace-riser | 0.0406 | 0.1168 | 0.1890 | yes |
| unglaciated | 0.0373 | 0.1673 | 0.2435 | yes |

Passing the original pixel-screen baseline does not mean near-zero false
positives: belts give up much of ridge-only's low flagged confuser area.

## Fixes and verification

- Priority-flood drainage replaces TPI-sign blobs for kettles; peak suppression
  replaces merged positive blobs for hummocks. Texture uses a geometric mean.
- Likely requires both texture sides or strong joint texture. Free stage-score
  evidence was removed; context contributions are capped.
- All objects publish original pixel membership; display closing is excluded
  from evaluation membership. Empty lists stay empty and missing raster ids
  cannot acquire background pixels. No-data display cells remain background.
- Experiment identity hashes all pipeline dependencies, metric implementation,
  manifest and compressed view corpus. Belt-on/off experiments cannot merge.
- 24 synthetic moraine checks and eight evaluator regressions pass. Independent
  review matched flooding against minimax relaxation on 120 random small grids.
- `npm run verify` passes on Node 24.19.0; audit reports zero vulnerabilities.
  Local HTTP smoke returned 200 for five revised modules; server was stopped.

The original block landslide fixture was incorrectly described as pit-free:
it contains 36 real closed depressions and still produces one likely belt.
It remains a known morphological false-positive diagnostic. Its filled,
draining counterpart remains possible, not likely. The fixture correction
does not solve separation of hummocky landslides from glacial terrain; the
original no-likely landslide acceptance goal remains unmet for pitted slides.

Peak counts, connected drainage depressions, DEM resolution/fill quality,
and original map-label uncertainty limit interpretation. Fresh held-out
regions and independent geological corroboration are still required before
a default-on release. Validation has now informed design discussions and
must not be treated as fresh held-out proof in a future iteration.

## Execution and artifacts

Muse Wonder stopped on a subscription quota error. Existing implementation
and review artifacts were recovered and preserved; the remaining work was
completed with root integration and a GPT-6.1 Sol high-reasoning review.
See `docs/GLACIAL_BELT_V3_REVIEW.md` for the final review.

The first 138 belt-on and 144 belt-off training rows were preserved from the
sequential evaluator. Remaining rows ran through the exact exported
`evaluateView` function using three local worker threads per mode, with the
same Node 20.19.0 runtime. Preserved row ordering, complete counts, unique
row identities, and before/after pipeline/corpus fingerprints were checked.
Validation used the normal CLI. Final split merging checked matching
fingerprints and used the evaluator's exported `officialSuccessBar`.

Results and reproducibility helpers:

- `output/glacial-calibration/results-objects-belt-v3.json`
- `output/glacial-calibration/results-objects-ridge-v3.json`
- `output/glacial-calibration/resume-object-evaluation-runner.js`
- `output/glacial-calibration/merge-object-evaluation-splits.js`

Both merged files contain 351 rows, split fingerprints, per-object-type
metrics, per-confuser metrics and the failed official success bar. Earlier
calibration result files were preserved. Nothing was merged to main or
deployed during this continuation.
