# Glacial-margin screen calibration

A test, run by four subagents, that applies the Glacial-margin candidate screen
(`scoreGlacialLobeMarginCandidates` in `glacial-research-core.js`) to mapped
moraines and look-alike landforms, tunes its parameters, and reports how well it
separates them on ground it has never seen.

The goal is a screen whose high scores mean "this looks like a mapped moraine
at this scale", backed by a measured hit rate. It will still not prove
glaciation; the screening notice stays.

## 1. What is being calibrated

The current score is a weighted mean of four features, each scaled to the
view's own 90th percentile and capped at 1:

| Feature | Current weight | Source |
|---|---|---|
| Slope break, \|Laplacian curvature\| | 0.30 | `finiteDifferenceCurvature` |
| Raised position, TPI (lows count at 0.35) | 0.25 | `terrainPositionIndex` |
| Local relief, \|LRM\| | 0.25 | `localReliefModel` |
| Steepness, sin(slope) | 0.20 | `slopeAspectComponents` |

The calibration varies:

| Parameter | Search space |
|---|---|
| Four weights | Simplex, step 0.05 (1,771 combinations) |
| Trough factor (currently 0.35) | 0, 0.2, 0.35, 0.5, 1 |
| Neighbourhood radius **in metres** | 15, 30, 60, 120, 240 m |
| Normalization mode | A: per-view 90th percentile (current) · B: fixed physical saturation · C: max of A and B |
| Saturation constants (mode B/C only) | relief and TPI in m, slope in degrees, curvature in 1/m, each from a 5-value ladder |
| Candidate threshold (currently 0.58) | Chosen after the weights, to a precision target |

**Normalization has to be in the search.** In mode A the top 10% of every view
scores high, so no choice of weights can stop a moraine-free view from lighting
up. Weights can only change *which* pixels in a view rank highest. Mode B and C
are the only way the screen can say "nothing here".

The radius moves from pixels to metres because the app's pixel size changes
with zoom. A fixed physical radius makes results comparable across views.

## 2. Dataset

### Positive sites: mapped moraines

At least 20 sites from at least 6 independent regions. Each site needs:
- moraine geometry from an authoritative map: state geologic map polygons
  with a moraine unit, or a published moraine crest or footprint map;
- the map's scale, so its positional uncertainty is known;
- full USGS 3DEP 1 m lidar coverage (record the project and year);
- a citation;
- a type tag: terminal, recessional, or lateral. Terminal is the target class.
  Laterals and recessionals are scored but reported separately.

Starting candidates for the curator to verify (drop any without suitable
mapping or lidar):
- **Washington:** Withrow Moraine (Okanogan lobe, Waterville Plateau);
  Leavenworth / Icicle Creek; Lake Wenatchee; Cle Elum / Kittitas drifts;
  the Puget lobe Vashon terminal zone.
- **Elsewhere:** Wallowa Lake (OR); Fremont Lake / Pinedale (WY); Convict
  Lake and Bloody Canyon (CA); Bemis Moraine (Des Moines lobe, IA/MN);
  Valparaiso Moraine (IN/IL); Johnstown Moraine (WI); Ronkonkoma and Harbor
  Hill moraines (Long Island, NY).

### Confuser sites: same shape, different origin

As many confuser sites as positive sites, chosen because they fool shape-only
screens:
- river terrace risers (e.g. Columbia River terraces);
- landslide scarps and hummocky landslide deposits;
- fault scarps;
- scabland coulee rims and basalt rimrock (flood-cut, not glacial);
- Palouse loess hills;
- sand dunes (e.g. Moses Lake, Juniper Dunes);
- Mima mounds;
- road and rail embankments, levees, quarries and mine spoil;
- alluvial fan margins.

Add a few **unglaciated controls**: ordinary hill country well outside any
mapped ice limit.

### Labels

Rasterize each map onto every view at the view's pixel size:
- **positive:** inside a mapped moraine polygon;
- **ignore:** within the map's positional uncertainty of a moraine boundary
  (about 12 m at 1:24,000 and 50 m at 1:100,000);
- **negative:** everything else, including other glacial ground such as
  outwash and till plain. The screen is for margins, not "anywhere glaciated".

Confuser and control views are all negative.

### Views that match the app

Each site is sampled as views of the kind the app analyses: a mosaic of 3DEP
elevation box-averaged to at most 640 px on the long side. Use three pixel
sizes per site, about 2, 5 and 12 m, matching common zooms. For each pixel
size, also take two extra views offset by a third of the width, to measure
stability under panning. Elevation comes from the 3DEP ImageServer
`exportImage` Float32 path already used in `server.js`
(`nationalElevationTiff`), at the exact bbox and pixel size.

Large cached data goes in `output/glacial-calibration/`, which is gitignored.
Each file's SHA-256 is recorded in the manifest so runs are reproducible.

## 3. Split and pre-registration

Before any tuning, the curator writes `manifest.json` containing:
- every site, its label source and the view list;
- a **region-level split**: about 60% train, 15% validation, 25% held-out
  test. Every view of a site, and every site in a region, stays on one side.
  Neighbouring pixels are near-duplicates, so a pixel-level split would
  overstate accuracy.
- the primary metric and the selection rule below, fixed in advance.

The calibrator only ever receives train and validation views. Only the
auditor runs the held-out set, and runs it once.

## 4. Metrics

**Primary: per-view average precision (PR-AUC)**, macro-averaged over positive
views, together with the **confuser false-alarm rate**: the fraction of
confuser and control pixels at or above threshold. Scoring only positive views
would reward a screen that lights up everything.

Secondary metrics:
- **Object recall:** the share of mapped moraine length covered by an
  above-threshold band, within the label uncertainty.
- **Object precision:** the share of above-threshold connected blobs (at least
  a minimum area) that touch a mapped moraine.
- **View-level AUC** (modes B and C only): does total above-threshold area
  separate positive views from confuser views?
- **Stability:** the mean absolute score difference for the same ground across
  pan-offset views and across the three pixel sizes.
- **Per-confuser breakdown:** the false-alarm rate for each confuser type, so
  the report shows what still fools the screen.

**Baselines** to beat: the current parameters; each feature alone; equal
weights. Uncertainty comes from bootstrapping over regions, not pixels.

## 5. Optimization

1. **Cache features once.** The scoring function already returns
   `evidence.normalized` and the raw features. For each view × radius ×
   normalization mode, compute the four raw features once, then recombine
   weights in memory. A full grid search is then cheap.
2. **Grid search** the full space on train views. Rank by mean
   leave-one-region-out PR-AUC, subject to the confuser false-alarm rate
   staying at or below the current parameters' rate.
3. **Cross-check with logistic regression.** Fit an L2-regularized logistic
   regression on the four normalized features (non-negative coefficients,
   rescaled to sum to 1). If it lands far from the grid optimum, report both.
4. **Prefer simple, flat optima.** If several settings score within the
   bootstrap interval of the best, pick the one closest to equal weights with
   the best stability. Report how sharply the score falls off around the
   optimum.
5. **Choose the threshold** on validation views: the lowest threshold that
   reaches 50% object precision. Report the recall it gives.

## 6. Agents

The work fits four agents; each hands a file to the next.

| # | Agent | Does | Produces |
|---|---|---|---|
| 1 | **Curator** (web research) | Finds and verifies sites, label sources, citations and lidar coverage; writes the split and pre-registered rules | `output/glacial-calibration/manifest.json` and `SOURCES.md` |
| 2 | **Data engineer** | Fetches DEM views and label geometry; rasterizes labels; checks for no-data holes and DEM seams; saves hillshade + label overlay PNGs for spot checks | Cached views, label rasters, checksums, overlay gallery |
| 3 | **Calibrator** | Builds the harness under `scripts/glacial-calibration/` (`fetch.js`, `evaluate.js`, `optimize.js`); runs the search on train and validation only | `results-train.json` and a ranked parameter table |
| 4 | **Auditor** (independent) | Checks for leakage and label errors; reruns the baselines; runs the held-out test once; writes the verdict | `REPORT.md` with held-out metrics, confidence intervals, a failure gallery and a go / no-go recommendation |

The main thread then:
- applies the chosen parameters to `glacial-research-core.js`;
- bumps the screening notice id to `glacial-lobe-margin-observational-screen-v2`
  and records the calibration in the result metadata;
- adds a small committed regression fixture (a few downsampled views) to
  `test-glacial-research-core.js`, asserting the calibrated screen beats the
  old weights on it;
- updates the in-app legend wording if normalization changed.

## 7. Pass criteria

Ship the new parameters only if, on the **held-out** regions:
- PR-AUC beats the current parameters, with a region-bootstrap 95% interval
  that excludes zero improvement;
- the confuser false-alarm rate is no worse;
- stability is no worse.

If none of the settings pass, ship nothing. The auditor still reports which
confusers defeat the four features, as evidence for new features.

## 8. Expected limits

Four local shape measurements can't tell a moraine from a hummocky landslide
or a dune ridge of the same size. The auditor should say plainly if the ceiling
is the features, not the weights. Likely next features:
- ridge elongation and arcuate (lobe-shaped) continuity;
- hummocky texture and kettle-depression density;
- position upslope of an outwash fan or plain;
- agreement with mapped till and outwash units (Macrostrat).

Those are out of scope for this test.
