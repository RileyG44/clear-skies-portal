# Glacial moraine analysis v2 — object-level design

Designs the successor to the pixel screen (`scoreGlacialLobeMarginCandidates`),
based on the calibration in `output/glacial-calibration/REPORT.md`: tuned pixel
weights did not beat the current screen on held-out regions (AP 0.226 vs 0.230)
and flooded confusers (FAR 0.64 vs 0.21), because four local shape features
saturate on any steep ground and pixels are the wrong unit of decision.

## Principles

1. **Objects, not pixels.** A moraine is an elongated, often arcuate ridge or
   hummocky belt segment. Generate candidate segments, score segments.
2. **Recall first, precision second.** Stage 1 proposes candidates generously
   (the current screen's object recall was 0.75–0.91). Stage 2 rejects
   look-alikes with object features the pixel screen lacks.
3. **Three verdicts, with evidence.** `likely` / `possible` / `unsupported`,
   each with the deciding evidence listed. The tool may abstain; that is how
   false positives stay low.
4. **No saturating normalization.** Physical gates (minimum length, relief,
   prominence) plus relative ranking; never "slope > 5° counts fully".
5. **Data-quality gating.** Verdicts carry the view's 1 m lidar footprint
   quality where known; coarse-filled DEM must not support `likely`.
6. **Screening notice stays.** This ranks morphology; it does not prove
   glaciation.

## Pipeline

```
DEM grid
  -> stage 1: current screen score (mode A) >= candidateThreshold (default 0.45)
  -> segments: 8-connected components, min area 5,000 m2, skeletonized
  -> per-segment features (shape, profile, texture, position)
  -> rule-cascade classifier -> verdict + evidence per segment
  -> outputs: verdict raster (likely 1.0 / possible 0.55 / else score*0.3),
     segment list with geometry + evidence, metadata
```

## Modules (new files, UMD like glacial-research-core.js)

### `glacial-segment-core.js` — `CSPGlacialSegments`

- `skeletonize(mask, w, h)` — Zhang–Suen thinning, returns Uint8Array.
- `extractSegments(mask, w, h, opts)` — opts `{cellMetres, minAreaM2=5000}`.
  Returns segments sorted by area desc:
  `{id, pixels:Uint32Array, pixelCount, areaM2, bbox:[x0,y0,x1,y1],
    centroid:[x,y], skeleton:[[x,y],...] (ordered longest path),
    lengthM, meanWidthM (area/length), elongation (length/meanWidth),
    orientationRad, arcScore (0..1: consistency of skeleton turning direction
    and magnitude in a moraine-plausible radius band), meanBendRad}`.
  Pure geometry; no elevation input.

### `glacial-segment-features.js` — `CSPGlacialSegmentFeatures`

Factory takes the glacial core `G` (same pattern as research-analysis.js).

- `segmentFeatures(grid, w, h, segment, opts)` — opts `{cellMetres}`.
  Returns:
  - `prominenceM` — median along-skeleton (crest elevation minus mean of two
    shoulder samples at ±width along the local skeleton normal).
  - `profileAsymmetry` — |uphill shoulder slope − downhill shoulder slope|
    normalized, 0..1, plus `steepSide` (+-1 relative to skeleton direction).
  - `widthAtHalfM` — median profile width at half prominence.
  - `kettleCount`, `kettleDensityPerKm` — distinct closed-depression blobs
    (negative TPI components, depth > 0.5 m, area < 5,000 m²) whose centroid
    falls inside the segment polygon dilated by one mean width, per km of
    skeleton length.
  - `apronFlatFraction`, `apronSide` — on each side of the segment, the
    fraction of pixels within one segment length downslope-side apron with
    slope < 3°; apronSide = flatter side.
  - `valleyCrossingScore` 0..1 — skeleton crosses the local drainage/low axis:
    compare segment centroid elevation and orientation against the low-relief
    corridor (lowest-quartile elevation band in the view); documented
    approximation.
  - `meanSlopeDeg`, `reliefM` (p95−p05 elevation within segment),
    `roughness` (mean |LRM| within segment).
  Every approximation must be stated in code comments and metadata.

### `glacial-moraine-classifier.js` — `CSPGlacialMoraineClassifier`

- `DEFAULT_CONFIG` — all thresholds/weights, named and documented.
- `classifySegment(segment, features, config?)` returns
  `{verdict: "likely"|"possible"|"unsupported", score: 0..1,
    evidence: [{key, detail, supports: +1|-1|0}], hardRejects: [string]}`.
  Hard rejects (examples): length < 150 m; prominence < 1 m;
  elongation < 2. Evidence (examples): arcScore high; kettles present;
  apron flat on one side; valley crossing; strong prominence; penalties:
  dead-straight (fault-like), contour-parallel long straight (terrace-like),
  regular periodic spacing is handled at set level later — v1 note as TODO.
- `classifySegments(segmentsWithFeatures, config?)` — maps the above.

Rules must be interpretable: a reader must be able to see why each verdict
fired from `evidence` alone.

### `glacial-moraine-analysis.js` — `CSPGlacialMoraineAnalysis` (integration)

Factory takes `G` and the three modules above (Node: require; browser: root
globals, loaded by script tags before it).

- `analyzeMoraineCandidates(grid, w, h, opts)` — opts `{cellSize,
  candidateThreshold=0.45, config}`. Runs stage 1 with the current screen
  (mode A, current weights), extracts segments, features, verdicts.
  Returns `{score (verdict raster Float32Array), mask (likely|possible),
  segments: [{id, verdict, score, bbox, centroid, lengthM, evidence}],
  metadata}` with a new screening notice id
  `glacial-moraine-object-screen-v2` and text stating morphology-only.

## App wiring

- `research-worker.js`: importScripts the four new files before
  `research-analysis.js` (order: core, segments, features, classifier,
  analysis, dispatcher).
- `research-analysis.js`: factory receives the analysis module as a second
  dependency; new product `"moraine"` returns the verdict raster, label
  "Glacial moraine candidates (object screen)", notice from metadata.
  Existing products unchanged.
- `index.html`: script tags in the same order; a select option for the new
  product next to the existing glacial screen; build stamp bumped per repo
  convention.
- `test-glacial-moraine.js`: synthetic DEMs — arcuate ridge across a valley
  (expect a `likely` segment), straight one-sided step (expect not `likely`),
  smooth hills (expect no `likely`), dune-like periodic ridges (expect not
  `likely`); segment-core unit checks (elongation, arcScore ordering).
  Wire into the repo test command if it enumerates test files.

## Offline validation (this build's evidence, train/validation only)

The calibration test regions are spent — do not score this build on them.

- `scripts/glacial-calibration/evaluate-objects.js`: for `--split
  train|validation`, load cached views
  (`output/glacial-calibration/views/`), run the pipeline, and compute
  object precision (share of likely+possible segments ≥5,000 m² touching a
  positive or uncertainty-ignore pixel), object recall (skeleton of the
  positive mask within uncertainty of a likely+possible segment), and
  per-confuser-type segment false-alarm rates (segments per view and area
  fraction flagged). Write `output/glacial-calibration/results-objects.json`.
- Success bar for this build (pre-registered here): on train+validation,
  `likely` segments reach object precision ≥ 0.5 with object recall ≥ 0.4,
  and every confuser type's flagged area fraction below the current screen's
  pixel FAR at 0.58. Falling short is reported, not tuned around silently:
  thresholds in DEFAULT_CONFIG may be adjusted on train only, with validation
  as the check, and every change logged in the results file.

## Out of scope for this build

- Mapped-geology evidence layer (Macrostrat/DNR overlap) — designed above as
  future evidence; needs its own data pipeline.
- Learned (ML) segment classifier — rule cascade first; revisit with more
  labelled segments.
- New held-out regions for a ship decision — required before any future
  default-on change; this build ships as an additional, clearly-labelled
  analysis product, not a replacement of the current screen.
