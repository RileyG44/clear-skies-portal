# Glacial moraine belt/zone objects — v3 design

Follow-up to `docs/GLACIAL_MORAINE_V2_DESIGN.md`. The v2 object screen is
ridge-only; its evaluation (train/validation, exact membership) passed false
alarms by a wide margin (0.5–1.8% flagged vs 14–26% baseline) but failed
recall (0.058/0.026 vs bar 0.4) and likely precision (0.25/0.00 vs bar 0.5),
because mapped moraines are mostly **hummocky belts**, not single ridges.
This design adds a second object type, the belt/zone, scored on texture
density rather than crest shape. The ridge path is unchanged.

## Principles (carried from v2)

Objects not pixels; recall stage then precision stage; three verdicts with
evidence; no saturating normalization; abstention allowed; screening notice
stays. All verdicts from both object types merge into one segment list and
one verdict raster.

## Zone generation — `glacial-zone-core.js` (`CSPGlacialZones`)

Input: the stage-1 candidate mask the analysis already builds (score >=
candidateThreshold AND TPI > 0), plus grid dimensions.

1. Close the mask: dilate then erode with radius `closeRadiusM`
   (default 60 m, converted to cells) so neighbouring hummocks merge into
   belts; fill interior holes.
2. Connected components (8-connectivity) of the closed mask; drop zones
   smaller than `minAreaM2` (default 20,000 m² — belts are zones, not
   hummocks).
3. Each zone: `{id, pixels (of the ORIGINAL candidate mask inside the zone,
   so area/touch stay honest), zonePixels (closed-mask pixels), pixelCount,
   areaM2 (from zonePixels), bbox, centroid, elongation (PCA axes),
   orientationRad, solidity (zonePixels / convex-hull-area approximation
   via bbox-corrected PCA rectangle — document the approximation),
   perimeterM (boundary cell edges of zonePixels)}`.
   `objectType: "belt"` on every zone.

Morphology must be implemented with distance-transform or separable
dilation — no naive per-pixel radius loops over the full grid per zone.

## Zone features — `glacial-zone-features.js` (`CSPGlacialZoneFeatures`)

Factory pattern like the segment features; must reuse the per-view context
from `glacial-segment-features.js` (`createViewContext`) when provided via
opts, computing shared layers once.

`zoneFeatures(grid, w, h, zone, opts)` returns:

- `hummockDensityPerKm2` — distinct raised blobs (TPI above +0.5 m,
  8-connected, area 100–20,000 m²) whose centroid lies in the zone,
  per km² of zone area. Blob membership seeded/grown like the fixed kettle
  detector (seed below/above threshold, grow to zero crossing) to avoid
  float-noise merging.
- `kettleDensityPerKm2` — closed-depression blobs from the view context
  (same detector family as segment kettles) per km².
- `raisedFraction` — fraction of zone pixels with TPI > 0.
- `meanStageScore` — mean stage-1 pixel score inside the zone (pass the
  stage-1 score raster in opts).
- `roughness` — mean |LRM| inside the zone (from context).
- `reliefM` — p95−p05 elevation inside the zone.
- `ridgeSupport` — number of ridge segments (from the v2 ridge path) whose
  centroid lies in the zone and whose verdict is likely/possible; computed
  by the analysis, not this module (documented input via opts).
- `textureScore` 0..1 — documented combination: hummock and kettle density
  each mapped through a saturating ramp with physical knees
  (e.g. density d -> d/(d+knee)), averaged. No per-view percentile.

## Belt classifier — `glacial-belt-classifier.js` (`CSPGlacialBeltClassifier`)

- `DEFAULT_CONFIG` with named thresholds.
- `classifyZone(zone, features, config?)` ->
  `{verdict, score, evidence[], hardRejects[]}` in the v2 classifier's
  format. Hard rejects: area below minimum; raisedFraction < 0.3 (zone is
  mostly trough); reliefM < 1 m. Evidence rewards: hummock density, kettle
  density, textureScore, ridgeSupport > 0, elongation in a belt-plausible
  band (zones may be compact — do NOT require elongation), meanStageScore.
  Penalties: very high solidity + low texture (smooth blob — till plain or
  smooth hill), extreme roughness without depressions (chaotic landslide
  texture is a penalty only when kettle density is ~0; document this is
  the weakest rule and why).
- `classifyZones(list, config?)` for `{zone, features}` pairs.

## Analysis integration (`glacial-moraine-analysis.js`)

After the ridge path: build zones from the same candidate mask, compute
zone features with the shared view context, classify, then merge:

- Returned `segments` includes ridge segments (`objectType: "ridge"`,
  defaulted when absent) and zones (`objectType: "belt"`).
- Verdict raster: per pixel take the max of ridge and belt contributions;
  `segmentRaster` carries the winning segment/zone id per pixel (belt ids
  offset so they cannot collide with ridge ids — document the scheme).
- `mask` = likely|possible across both types.
- Metadata gains `belt: {zones, likely, possible}` counts.
- Belt path must be disableable (`opts.belt: false`) for A/B evaluation.

## Evaluation

`evaluate-objects.js` gains per-objectType reporting: precision and recall
split ridge vs belt vs combined, using the existing exact-membership
machinery (zones arrive through `segmentRaster`, so no metric changes
beyond the split). The success bar from v2 applies to the **combined**
output: likely precision >= 0.5, region-macro recall >= 0.4 on
train+validation, confuser flagged area below the current screen's pixel
FAR per type. Test split remains refused.

## Synthetic tests (extend `test-glacial-moraine.js` style, new file section)

1. Hummocky belt (field of 10–40 m bumps + several closed pits across a
   broad arc band, no single crest): at least one belt zone `likely`,
   and the ridge path alone finds no `likely`.
2. Smooth broad hill: no belt `likely`.
3. Chaotic coarse landslide-like zone (large blocks, no pits): no belt
   `likely`.
4. Zone core units: two nearby hummock clusters merge into one zone after
   closing; a lone small cluster is dropped by min area.

## Out of scope

Mapped-geology evidence; learned classifiers; new held-out regions (still
required before any default-on ship decision); changing ridge thresholds.
