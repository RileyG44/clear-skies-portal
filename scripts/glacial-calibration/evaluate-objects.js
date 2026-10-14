"use strict";
/* Object-level evaluation of glacial-moraine-analysis v2 (design:
   docs/GLACIAL_MORAINE_V2_DESIGN.md, "Offline validation"), extended
   for v3 belt/zone objects (docs/GLACIAL_BELT_V3_DESIGN.md,
   "Evaluation"): segments carry objectType "belt" for zones and
   "ridge" for ridge segments (absent objectType counts as ridge).
   Precision, skeleton recall, and confuser flagged area are reported
   per object type (ridge, belt, combined) through the same
   exact-membership machinery; the official success bar stays on the
   combined output. If a segmentRaster value (other than the 0
   background) matches no segment id, that view's type split is
   counted unevaluated and the row says so, while its combined
   metrics are computed exactly as before.

   For --split train|validation ONLY. The calibration test regions are
   spent: --split test (and any other split) is refused before any view
   or the analysis module is loaded, so this harness can never score it.
   evaluateView (the exported path) asserts the same before running
   analysis.

   Exact-touch rule (review fix): segment membership comes ONLY from
   per-segment pixel lists or the analysis result's segmentRaster
   (Int32Array of segment ids). Bounding-box overlap is never used for
   touch, area, or detection masks. A view whose result offers neither
   is counted unevaluated (no official metrics for it).

   Membership preference (v3 contract): a segment that carries its own
   `pixels` list uses exactly that list as its membership for touch,
   flagged area, and eligibility, in preference to segmentRaster
   matches. Belt zones publish `pixels` = the ORIGINAL candidate-mask
   cells inside the zone and `zonePixels` = the closed footprint; only
   `pixels` is membership (zonePixels is never read), so a belt whose
   closed footprint covers a positive pixel its candidate cells do not
   reach does not touch. Segments without `pixels` keep the raster rule
   (raster pixels whose value matches the segment). The raster carries
   only the per-pixel winner, so it is never the sole membership for a
   segment that publishes pixels. Each row records how many segments
   used each source (membershipSource) and the rule (membershipRule).

   Eligible segment area comes from exact membership counts only
   (membership pixel count, or an explicit pixelCount when a segment has
   no membership); bbox-derived and areaM2-only areas cannot prove
   eligibility. Belt eligibility therefore uses the candidate-cell
   membership count, not the zone's areaM2 (which the analysis computes
   from zonePixels). The combined detection mask (flagged area, recall)
   is the union of eligible segments' membership pixels, per-segment
   pixels where published, raster matches otherwise.

   Touch target: positive pixels OR their label-uncertainty band, where
   the band is computed here from view.pos and view.uncertaintyM
   (uncertaintyM ?? 12; an explicit 0 stays 0) via an exact Euclidean
   distance transform: a pixel is in the band when its Euclidean
   distance to the nearest positive pixel is <= uncertaintyM. The
   generic view.ign mask (no-data / unmapped / ambiguous) never counts
   as a touch on its own.

   Baseline: the actual current screen, required directly from
   glacial-research-core.js: scoreGlacialLobeMarginCandidates with its
   default radius (5 cells, no radius option passed) and threshold 0.58.
   Baseline FAR and flagged-area fraction share one valid-ground
   population: pixels whose grid value is finite. Both counts recorded.

   Object recall: a positive-mask skeleton pixel hits when its Euclidean
   distance to the flagged (eligible likely+possible) detection mask,
   ((dx^2+dy^2) * cellMetres^2 <= uncertaintyM^2), holds. An empty
   eligible list yields an empty detection mask (no recall credit).
   Recall is reported region-macro (skeleton counts pooled within a
   region, then regions averaged); the pooled figure is kept separately
   as objectRecallPooled.

   Experiment integrity: every run records a fingerprint (effective
   config, candidateThreshold, analysis-module file hash, view
   count/limit, baseline on/off). Merging splits with different
   fingerprint identities is refused. Partial (--limit) or
   baseline-less (--skip-baseline) runs are marked incomplete and their
   success bar reports "unevaluated". The official success bar is
   computed only from complete train+validation rows under one
   fingerprint.

   Usage:
     node scripts/glacial-calibration/evaluate-objects.js --split train
       [--config '{"candidateThreshold":0.45}' | --config config.json]
       [--out output/glacial-calibration/results-objects.json]
       [--analysis ../../glacial-moraine-analysis.js] [--limit N]
       [--candidate-threshold 0.45] [--skip-baseline] [--belt-off]

   --belt-off forwards belt:false to the analysis call (v3 A/B: ridge
   path only) and is part of the run fingerprint, so belt-on and
   belt-off splits never merge. A belt segment returned while belt is
   off is counted per row (beltSegmentsWhileBeltOff) and warned about.

   Pinned analysis API (glacial-moraine-analysis.js):
     analyzeMoraineCandidates(grid, w, h, opts)
       opts: {cellSize, cellMetres, candidateThreshold, config, belt?}
       -> {score, mask, segmentRaster?, segments: [{id, verdict, score,
           bbox, centroid, lengthM, evidence, pixelCount?, areaM2?,
           pixels?, zonePixels? (ignored), objectType? ("belt" for
           zones, "ridge" or absent for ridge segments)}], metadata}
   CommonJS direct export, a {analyzeMoraineCandidates} object, a UMD
   global-style export, and a factory(G, ...siblings) returning such an
   object are all accepted (see resolveAnalyze). */
const fs = require("fs"), path = require("path"), crypto = require("crypto");

const REPO_ROOT = path.join(__dirname, "..", "..");
const OUT_DIR = path.join(REPO_ROOT, "output", "glacial-calibration");
const DEFAULT_OUT = path.join(OUT_DIR, "results-objects.json");
const DEFAULT_ANALYSIS = path.join(REPO_ROOT, "glacial-moraine-analysis.js");
const MIN_SEGMENT_AREA_M2 = 5000; // design: min candidate area
const BASELINE_THRESHOLD = 0.58; // current screen threshold in the design doc
const BASELINE_RADIUS_CELLS = 5; // core default radius; recorded, not passed
const SUCCESS_BAR = { likelyPrecisionMin: 0.5, objectRecallMin: 0.4 };
const VALID_SPLITS = new Set(["train", "validation"]);
// Recorded in rows, summaries, and the fingerprint identity so results
// scored under the older raster-first rule never merge with these.
const MEMBERSHIP_RULE = "segment-pixels-preferred";
const MEMBERSHIP_NOTE = "membership: a segment's own `pixels` list when published (belt zones: original " +
  "candidate-mask cells, not the closed zonePixels footprint), else its segmentRaster matches; " +
  "touch, flagged area, recall mask, and eligibility area (membership pixel count) all use it";

const { loadViews, skeletonize } = require(path.join(__dirname, "evaluate.js"));
const glacialCore = require(path.join(REPO_ROOT, "glacial-research-core.js"));

/* ---------------- analysis module resolution ---------------- */
function tryRequire(p) { try { return require(p); } catch { return null; } }

function resolveAnalyze(analysisPath) {
  let mod;
  try { mod = require(analysisPath); }
  catch (e) {
    throw new Error(`cannot load analysis module at ${analysisPath}: ${e.message} ` +
      `(final integration awaits the real glacial-moraine-analysis.js; ` +
      `point --analysis at a stub implementing analyzeMoraineCandidates to smoke-test)`);
  }
  const fromObject = (o) => (o && typeof o.analyzeMoraineCandidates === "function")
    ? o.analyzeMoraineCandidates.bind(o) : null;
  let fn = fromObject(mod) || fromObject(mod && mod.CSPGlacialMoraineAnalysis) ||
    fromObject(mod && mod.default);
  if (fn) return fn;
  if (typeof mod === "function") {
    try {
      const core = tryRequire(path.join(REPO_ROOT, "glacial-research-core.js"));
      const sib = (n) => tryRequire(path.join(REPO_ROOT, n));
      const made = mod(core, sib("glacial-segment-core.js"),
        sib("glacial-segment-features.js"), sib("glacial-moraine-classifier.js"));
      fn = fromObject(made);
      if (fn) return fn;
    } catch { /* not a factory; fall through and treat mod itself as the fn */ }
    return mod;
  }
  throw new Error(`analysis module at ${analysisPath} exposes no analyzeMoraineCandidates ` +
    `(expected {analyzeMoraineCandidates}, a UMD equivalent, or a factory returning one)`);
}

/* ---------------- Euclidean distance transform ---------------- */
// 1-D squared Euclidean distance transform (Felzenszwalb & Huttenlocher).
function dt1d(f, d, n, tmpV, tmpZ) {
  let k = 0;
  tmpV[0] = 0;
  tmpZ[0] = -Infinity; tmpZ[1] = Infinity;
  for (let q = 1; q < n; q++) {
    if (!Number.isFinite(f[q]) && f[q] !== Infinity) f[q] = Infinity;
    let s = ((f[q] + q * q) - (f[tmpV[k]] + tmpV[k] * tmpV[k])) / (2 * q - 2 * tmpV[k]);
    while (s <= tmpZ[k]) {
      k--;
      s = ((f[q] + q * q) - (f[tmpV[k]] + tmpV[k] * tmpV[k])) / (2 * q - 2 * tmpV[k]);
    }
    k++; tmpV[k] = q; tmpZ[k] = s; tmpZ[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (tmpZ[k + 1] < q) k++;
    const dx = q - tmpV[k];
    d[q] = dx * dx + f[tmpV[k]];
  }
}
// Squared distance (in cells^2) to the nearest set pixel of `target`.
function squaredDistanceTo(target, w, h) {
  const n = w * h, INF = 1e20;
  const d = new Float64Array(n);
  for (let i = 0; i < n; i++) d[i] = target[i] ? 0 : INF;
  const maxDim = Math.max(w, h);
  const f = new Float64Array(maxDim), o = new Float64Array(maxDim);
  const tmpV = new Int32Array(maxDim + 1), tmpZ = new Float64Array(maxDim + 2);
  for (let x = 0; x < w; x++) { // columns
    for (let y = 0; y < h; y++) f[y] = d[y * w + x];
    dt1d(f, o, h, tmpV, tmpZ);
    for (let y = 0; y < h; y++) d[y * w + x] = o[y];
  }
  for (let y = 0; y < h; y++) { // rows
    for (let x = 0; x < w; x++) f[x] = d[y * w + x];
    dt1d(f, o, w, tmpV, tmpZ);
    for (let x = 0; x < w; x++) d[y * w + x] = o[x];
  }
  return d;
}
// Mask of pixels within uncertaintyM (Euclidean) of a positive pixel.
function touchTargetMask(view) {
  const { pos, w, h } = view;
  const uncertaintyM = view.uncertaintyM ?? 12;
  const out = new Uint8Array(w * h);
  let anyPos = false;
  for (let i = 0; i < pos.length; i++) if (pos[i]) { anyPos = true; break; }
  if (!anyPos) return { mask: out, uncertaintyM, targetPixels: 0 };
  const d2 = squaredDistanceTo(pos, w, h);
  const limit = uncertaintyM * uncertaintyM;
  const cell2 = view.cellMetres * view.cellMetres;
  let count = 0;
  for (let i = 0; i < out.length; i++) if (d2[i] * cell2 <= limit + 1e-9) { out[i] = 1; count++; }
  return { mask: out, uncertaintyM, targetPixels: count };
}

/* ---------------- segment helpers ---------------- */
function segmentPixelIndices(seg) {
  for (const key of ["pixels", "pixelIndices", "indices", "pixelIndexes"]) {
    const v = seg && seg[key];
    if (v && typeof v.length === "number") return v;
  }
  return null;
}
// Distinct in-bounds pixel indices, so membership counts stay honest.
function normalizePixels(raw, view) {
  if (!raw) return null;
  const n = view.w * view.h, seen = new Set(), out = [];
  const add = (i) => { if (i >= 0 && i < n && !seen.has(i)) { seen.add(i); out.push(i); } };
  for (let k = 0; k < raw.length; k++) {
    const v = raw[k];
    if (typeof v === "number" && Number.isFinite(v)) add(v | 0);
    else if (Array.isArray(v) && v.length >= 2) add((v[1] | 0) * view.w + (v[0] | 0));
    else if (v && typeof v === "object" && Number.isFinite(v.x) && Number.isFinite(v.y))
      add((v.y | 0) * view.w + (v.x | 0));
  }
  return out;
}
// Exact per-segment pixel lists from segmentRaster. Zero is background;
// every other value must match an explicit segment id. Array-position
// guessing can turn background into an object's membership and is forbidden.
function pixelsFromRaster(raster, segments, n) {
  const byValue = new Map();
  for (let i = 0; i < n; i++) {
    const v = raster[i];
    if (v === 0) continue;
    if (!byValue.has(v)) byValue.set(v, []);
    byValue.get(v).push(i);
  }
  const map = new Map();
  segments.forEach(s => { if (s && s.id !== 0 && byValue.has(s.id)) map.set(s, byValue.get(s.id)); });
  return map;
}
// Per-segment exact membership. A segment's own pixel list wins over
// raster matches (see the membership preference rule above); segments
// without one use their segmentRaster matches. Returns {source,
// bySegment: Map<seg, number[]>, sourceBySegment, membershipSource}
// or null when the view has neither a segmentRaster nor any segment
// pixel list.
function exactSegmentPixels(result, segments, view) {
  const n = view.w * view.h;
  const raster = result && result.segmentRaster;
  const hasRaster = !!(raster && typeof raster.length === "number" && raster.length === n);
  const fromRaster = hasRaster && segments.length ? pixelsFromRaster(raster, segments, n) : new Map();
  const bySegment = new Map(), sourceBySegment = new Map();
  const membershipSource = { segmentPixels: 0, segmentRaster: 0, none: 0 };
  for (const seg of segments) {
    const own = normalizePixels(segmentPixelIndices(seg), view);
    if (own) { bySegment.set(seg, own); sourceBySegment.set(seg, "segmentPixels"); membershipSource.segmentPixels++; }
    else if (fromRaster.has(seg)) {
      bySegment.set(seg, fromRaster.get(seg)); sourceBySegment.set(seg, "segmentRaster"); membershipSource.segmentRaster++;
    } else membershipSource.none++;
  }
  if (!hasRaster && !membershipSource.segmentPixels) return null;
  const source = !hasRaster ? "segmentPixels"
    : (membershipSource.segmentPixels ? "segmentPixels+segmentRaster" : "segmentRaster");
  return { source, bySegment, sourceBySegment, membershipSource };
}
// Membership pixel count (belt: candidate cells, not zonePixels).
function exactPixelCount(seg, exact) {
  if (exact && exact.bySegment.has(seg)) return exact.bySegment.get(seg).length;
  const px = seg && segmentPixelIndices(seg);
  if (px) return px.length;
  if (seg && Number.isFinite(seg.pixelCount) && seg.pixelCount > 0) return seg.pixelCount;
  return null;
}
// Area from exact pixel counts only; unknown area => 0 (not eligible).
function segmentAreaM2(seg, cellMetres, exactCount) {
  const count = exactCount != null ? exactCount
    : (seg && segmentPixelIndices(seg) ? segmentPixelIndices(seg).length
      : (seg && Number.isFinite(seg.pixelCount) && seg.pixelCount > 0 ? seg.pixelCount : null));
  return count != null ? count * cellMetres * cellMetres : 0;
}
function segmentTouches(seg, view, touchMask, exact) {
  if (!touchMask || typeof touchMask.length !== "number") {
    touchMask = touchTargetMask(view).mask;
    const px0 = normalizePixels(segmentPixelIndices(seg), view);
    if (!px0) return false;
    for (let k = 0; k < px0.length; k++) if (touchMask[px0[k]]) return true;
    return false;
  }
  let px = exact && exact.bySegment.get(seg);
  if (!px) px = normalizePixels(segmentPixelIndices(seg), view);
  if (!px) return false;
  for (let k = 0; k < px.length; k++) if (touchMask[px[k]]) return true;
  return false;
}
// Detection mask from eligible segments' exact pixels only. An empty
// eligible list yields an empty mask (no recall credit); the result's
// own mask and bboxes are never used.
function buildFlaggedMask(result, eligible, view, exact) {
  const out = new Uint8Array(view.w * view.h);
  if (!eligible.length) return out;
  if (!exact) exact = exactSegmentPixels(result, eligible, view);
  if (!exact) return out;
  for (const seg of eligible) {
    const px = exact.bySegment.get(seg);
    if (!px) continue;
    for (let k = 0; k < px.length; k++) if (px[k] >= 0 && px[k] < out.length) out[px[k]] = 1;
  }
  return out;
}

/* ---------------- object types (v3 belt/zone split) ---------------- */
const OBJECT_TYPES = ["ridge", "belt"];
// Belt zones carry objectType "belt"; ridge segments may carry
// "ridge" or omit objectType entirely. Absent (and any non-"belt"
// value) counts as ridge, so ridge + belt always partition segments.
function segmentObjectType(seg) {
  const raw = seg && seg.objectType != null ? String(seg.objectType).trim().toLowerCase() : "";
  return raw === "belt" ? "belt" : "ridge";
}
// Type split needs raster ids to resolve to segments. Belt ids are
// offset by the analysis so they cannot collide with ridge ids, but
// the raster value still maps back to the segment whose id matches.
// A non-background raster value matching no segment id makes the
// view's type split unevaluated (combined metrics are unaffected:
// they come from the segment list through the existing machinery).
// Raster value 0 is the background sentinel (segment ids start at 1).
function rasterTypeSplitStatus(result, segments, view) {
  const raster = result && result.segmentRaster;
  const n = view.w * view.h;
  if (!raster || typeof raster.length !== "number" || raster.length !== n)
    return { evaluated: true, reason: null, unmatchedValues: [] };
  const ids = new Set();
  for (const s of segments) if (s && s.id != null) ids.add(s.id);
  const unmatched = [];
  const seen = new Set();
  for (let i = 0; i < n; i++) {
    const v = raster[i];
    if (v === 0 || ids.has(v) || seen.has(v)) continue;
    seen.add(v); unmatched.push(v);
  }
  if (!unmatched.length) return { evaluated: true, reason: null, unmatchedValues: [] };
  const shown = unmatched.slice(0, 5).join(", ") + (unmatched.length > 5 ? ", ..." : "");
  return { evaluated: false, unmatchedValues: unmatched,
    reason: `segmentRaster type split unevaluated: raster value(s) ${shown} match no segment id ` +
      `(belt ids are offset but must still map back to a segment id); per-objectType metrics for this view are unevaluated` };
}
function emptyObjectTypeEntry(objectType, evaluated, reason) {
  return { objectType, evaluated: !!evaluated, unevaluated: !evaluated,
    unevaluatedReason: evaluated ? null : (reason || null),
    segmentsTotal: null, segmentsLikely: null, segmentsPossible: null,
    eligibleSegments: null, eligibleLikely: null, eligibleTouching: null,
    eligibleLikelyTouching: null, objectPrecision: null, likelyPrecision: null,
    flaggedPixels: null, flaggedAreaFraction: null, flaggedSegmentsPerView: null,
    skeletonPixels: null, skeletonHits: null, objectRecall: null };
}

/* ---------------- baseline (actual current screen) ---------------- */
function validGroundCount(view) {
  let c = 0;
  for (let i = 0; i < view.grid.length; i++) if (Number.isFinite(view.grid[i])) c++;
  return c;
}
function baselineFAR(view, validGroundPixels) {
  const res = glacialCore.scoreGlacialLobeMarginCandidates(view.grid, view.w, view.h, {
    cellSize: view.cellMetres, horizontalUnit: "m", verticalUnit: "m",
    rowAxis: "south", edgePolicy: "shrink", threshold: BASELINE_THRESHOLD,
  }); // no radius option: core default radius (5 cells) applies
  let flagged = 0;
  for (let i = 0; i < view.grid.length; i++)
    if (Number.isFinite(view.grid[i]) && Number.isFinite(res.score[i]) && res.score[i] >= BASELINE_THRESHOLD) flagged++;
  return { baselinePixelFAR: validGroundPixels ? flagged / validGroundPixels : null, baselineFlaggedPixels: flagged };
}

/* ---------------- per-view evaluation ---------------- */
function evaluateView(view, analyze, config, opts) {
  opts = opts || {};
  if (!view || !VALID_SPLITS.has(view.split))
    throw new Error(`evaluateView: split must be train or validation (got ${JSON.stringify(view && view.split)}); ` +
      `the calibration test regions are spent and must not be scored`);
  const { w, h } = view, n = w * h;
  const uncertaintyM = view.uncertaintyM ?? 12;
  const analysisOpts = { cellSize: view.cellMetres, cellMetres: view.cellMetres, config };
  if (opts.candidateThreshold != null) analysisOpts.candidateThreshold = opts.candidateThreshold;
  else if (config && config.candidateThreshold != null) analysisOpts.candidateThreshold = config.candidateThreshold;
  const beltOff = opts.belt === false;
  if (beltOff) analysisOpts.belt = false;
  const t0 = Date.now();
  const result = analyze(view.grid, w, h, analysisOpts) || {};
  const seconds = +((Date.now() - t0) / 1000).toFixed(2);
  const segments = Array.isArray(result.segments) ? result.segments : [];
  const validGroundPixels = validGroundCount(view);

  let baseline = { baselinePixelFAR: null, baselineFlaggedPixels: null };
  if (!opts.skipBaseline && view.class !== "positive") baseline = baselineFAR(view, validGroundPixels);

  const baseRow = {
    site: view.site, region: view.region, split: view.split, class: view.class, type: view.type,
    viewKm: view.viewKm, offset: view.offset, w, h, cellMetres: view.cellMetres, uncertaintyM,
    segmentsTotal: segments.length,
    segmentsLikely: segments.filter((s) => s && s.verdict === "likely").length,
    segmentsPossible: segments.filter((s) => s && s.verdict === "possible").length,
    segmentsUnsupported: segments.filter((s) => s && s.verdict === "unsupported").length,
    validGroundPixels, baselineFlaggedPixels: baseline.baselineFlaggedPixels,
    baselinePixelFAR: baseline.baselinePixelFAR, seconds,
    belt: !beltOff,
    beltSegmentsWhileBeltOff: beltOff ? segments.filter((s) => segmentObjectType(s) === "belt").length : null,
    membershipRule: MEMBERSHIP_RULE, membershipNote: MEMBERSHIP_NOTE,
  };

  const exact = exactSegmentPixels(result, segments, view);
  if (!exact) {
    const reason = "exact segment pixels unavailable: analysis result has neither a " +
      "segmentRaster matching the view nor per-segment pixels; bbox overlap is not used";
    const segmentsByObjectType = { ridge: 0, belt: 0, combined: segments.length };
    for (const s of segments) segmentsByObjectType[segmentObjectType(s)]++;
    return { row: { ...baseRow, evaluated: false, unevaluated: true, unevaluatedReason: reason,
      exactSource: null, membershipSource: null, eligibleSegments: null, eligibleLikely: null, eligibleTouching: null,
      eligibleLikelyTouching: null, objectPrecision: null, likelyPrecision: null,
      flaggedPixels: null, flaggedAreaFraction: null, flaggedSegmentsPerView: null,
      skeletonPixels: null, skeletonHits: null, objectRecall: null,
      segmentsByObjectType, segmentsRidge: segmentsByObjectType.ridge, segmentsBelt: segmentsByObjectType.belt,
      typeSplitEvaluated: false, typeSplitUnevaluated: true, typeSplitUnevaluatedReason: reason,
      objectTypeSplitEvaluated: false, objectTypeSplitUnevaluated: true,
      typeSplitUnmatchedRasterValues: [],
      byObjectType: { ridge: emptyObjectTypeEntry("ridge", false, reason),
        belt: emptyObjectTypeEntry("belt", false, reason),
        combined: emptyObjectTypeEntry("combined", false, reason) },
      ridgeObjectPrecision: null, beltObjectPrecision: null, combinedObjectPrecision: null,
      ridgeLikelyPrecision: null, beltLikelyPrecision: null, combinedLikelyPrecision: null,
      ridgeObjectRecall: null, beltObjectRecall: null, combinedObjectRecall: null,
      ridgeFlaggedPixels: null, beltFlaggedPixels: null, ridgeFlaggedAreaFraction: null,
      beltFlaggedAreaFraction: null, ridgeEligibleSegments: null, beltEligibleSegments: null },
      metadata: result.metadata || null };
  }

  const isFlagVerdict = (s) => s && (s.verdict === "likely" || s.verdict === "possible");
  const eligible = [], likelyEligible = [];
  for (const seg of segments) {
    if (!isFlagVerdict(seg)) continue;
    if (segmentAreaM2(seg, view.cellMetres, exactPixelCount(seg, exact)) < MIN_SEGMENT_AREA_M2) continue;
    eligible.push(seg); if (seg.verdict === "likely") likelyEligible.push(seg);
  }
  const { mask: touchMask, targetPixels: touchTargetPixels } = touchTargetMask(view);
  const countTouch = (list) => list.reduce((a, s) => a + (segmentTouches(s, view, touchMask, exact) ? 1 : 0), 0);
  const eligibleTouching = countTouch(eligible), eligibleLikelyTouching = countTouch(likelyEligible);
  const flaggedMask = buildFlaggedMask(result, eligible, view, exact);
  let flaggedPixels = 0; for (let i = 0; i < n; i++) if (flaggedMask[i]) flaggedPixels++;

  // Per-objectType split through the same exact machinery. Combined
  // figures above/below are unchanged; ridge and belt partition the
  // eligible list by segmentObjectType (absent objectType = ridge).
  const typeSplit = rasterTypeSplitStatus(result, segments, view);
  const segmentsByObjectType = { ridge: 0, belt: 0, combined: segments.length };
  for (const s of segments) segmentsByObjectType[segmentObjectType(s)]++;
  const byObjectType = {};
  const flaggedMaskByType = {};
  for (const t of OBJECT_TYPES) {
    if (!typeSplit.evaluated) { byObjectType[t] = emptyObjectTypeEntry(t, false, typeSplit.reason); continue; }
    const eligT = eligible.filter((s) => segmentObjectType(s) === t);
    const likT = eligT.filter((s) => s.verdict === "likely");
    const touchT = countTouch(eligT), likTouchT = countTouch(likT);
    const maskT = buildFlaggedMask(result, eligT, view, exact);
    flaggedMaskByType[t] = maskT;
    let fpT = 0; for (let i = 0; i < n; i++) if (maskT[i]) fpT++;
    const segsT = segments.filter((s) => segmentObjectType(s) === t);
    byObjectType[t] = { objectType: t, evaluated: true, unevaluated: false, unevaluatedReason: null,
      segmentsTotal: segsT.length,
      segmentsLikely: segsT.filter((s) => s && s.verdict === "likely").length,
      segmentsPossible: segsT.filter((s) => s && s.verdict === "possible").length,
      eligibleSegments: eligT.length, eligibleLikely: likT.length,
      eligibleTouching: touchT, eligibleLikelyTouching: likTouchT,
      objectPrecision: eligT.length ? touchT / eligT.length : null,
      likelyPrecision: likT.length ? likTouchT / likT.length : null,
      flaggedPixels: fpT, flaggedAreaFraction: validGroundPixels ? fpT / validGroundPixels : null,
      flaggedSegmentsPerView: eligT.length, skeletonPixels: null, skeletonHits: null, objectRecall: null,
      eligibleBySegmentPixels: eligT.filter((s) => exact.sourceBySegment.get(s) === "segmentPixels").length,
      eligibleBySegmentRaster: eligT.filter((s) => exact.sourceBySegment.get(s) === "segmentRaster").length,
      eligibilityAreaBasis: "membership pixel count" + (t === "belt" ? " (candidate-mask cells; zone areaM2/zonePixels not used)" : "") };
  }

  const row = { ...baseRow, evaluated: true, unevaluated: false, unevaluatedReason: null,
    exactSource: exact.source, membershipSource: exact.membershipSource, touchTargetPixels,
    eligibleSegments: eligible.length, eligibleLikely: likelyEligible.length,
    eligibleTouching, eligibleLikelyTouching,
    objectPrecision: eligible.length ? eligibleTouching / eligible.length : null,
    likelyPrecision: likelyEligible.length ? eligibleLikelyTouching / likelyEligible.length : null,
    flaggedPixels, flaggedAreaFraction: validGroundPixels ? flaggedPixels / validGroundPixels : null,
    flaggedSegmentsPerView: eligible.length,
    skeletonPixels: null, skeletonHits: null, objectRecall: null,
    segmentsByObjectType, segmentsRidge: segmentsByObjectType.ridge, segmentsBelt: segmentsByObjectType.belt,
    typeSplitEvaluated: typeSplit.evaluated, typeSplitUnevaluated: !typeSplit.evaluated,
    typeSplitUnevaluatedReason: typeSplit.evaluated ? null : typeSplit.reason,
    objectTypeSplitEvaluated: typeSplit.evaluated, objectTypeSplitUnevaluated: !typeSplit.evaluated,
    typeSplitUnmatchedRasterValues: typeSplit.unmatchedValues,
    byObjectType: null,
    ridgeObjectPrecision: byObjectType.ridge.objectPrecision, beltObjectPrecision: byObjectType.belt.objectPrecision,
    combinedObjectPrecision: eligible.length ? eligibleTouching / eligible.length : null,
    ridgeLikelyPrecision: byObjectType.ridge.likelyPrecision, beltLikelyPrecision: byObjectType.belt.likelyPrecision,
    combinedLikelyPrecision: likelyEligible.length ? eligibleLikelyTouching / likelyEligible.length : null,
    ridgeObjectRecall: null, beltObjectRecall: null, combinedObjectRecall: null,
    ridgeFlaggedPixels: byObjectType.ridge.flaggedPixels, beltFlaggedPixels: byObjectType.belt.flaggedPixels,
    ridgeFlaggedAreaFraction: byObjectType.ridge.flaggedAreaFraction,
    beltFlaggedAreaFraction: byObjectType.belt.flaggedAreaFraction,
    ridgeEligibleSegments: byObjectType.ridge.eligibleSegments, beltEligibleSegments: byObjectType.belt.eligibleSegments,
    ridgeEligibleLikely: byObjectType.ridge.eligibleLikely, beltEligibleLikely: byObjectType.belt.eligibleLikely };

  if (view.class === "positive") {
    const skel = skeletonize(view.pos, w, h);
    let total = 0, hits = 0;
    if (eligible.length) {
      const d2 = squaredDistanceTo(flaggedMask, w, h);
      const limit = uncertaintyM * uncertaintyM, cell2 = view.cellMetres * view.cellMetres;
      for (let i = 0; i < n; i++) {
        if (!skel[i]) continue;
        total++;
        if (d2[i] * cell2 <= limit + 1e-9) hits++;
      }
    } else {
      for (let i = 0; i < n; i++) if (skel[i]) total++;
    }
    row.skeletonPixels = total; row.skeletonHits = hits;
    row.objectRecall = total ? hits / total : null;
    row.combinedObjectRecall = row.objectRecall;
    // Skeleton recall per type against that type's flagged mask only.
    for (const t of OBJECT_TYPES) {
      const entry = byObjectType[t];
      if (!entry.evaluated) continue;
      let hitsT = 0;
      const eligT = eligible.filter((s) => segmentObjectType(s) === t);
      if (eligT.length) {
        const d2 = squaredDistanceTo(flaggedMaskByType[t], w, h);
        const limit = uncertaintyM * uncertaintyM, cell2 = view.cellMetres * view.cellMetres;
        for (let i = 0; i < n; i++) if (skel[i] && d2[i] * cell2 <= limit + 1e-9) hitsT++;
      }
      entry.skeletonPixels = total; entry.skeletonHits = hitsT;
      entry.objectRecall = total ? hitsT / total : null;
    }
    row.ridgeObjectRecall = byObjectType.ridge.objectRecall;
    row.beltObjectRecall = byObjectType.belt.objectRecall;
  }
  byObjectType.combined = { objectType: "combined", evaluated: true, unevaluated: false, unevaluatedReason: null,
    segmentsTotal: segments.length, segmentsLikely: baseRow.segmentsLikely, segmentsPossible: baseRow.segmentsPossible,
    eligibleSegments: row.eligibleSegments, eligibleLikely: row.eligibleLikely,
    eligibleTouching: row.eligibleTouching, eligibleLikelyTouching: row.eligibleLikelyTouching,
    objectPrecision: row.objectPrecision, likelyPrecision: row.likelyPrecision,
    flaggedPixels: row.flaggedPixels, flaggedAreaFraction: row.flaggedAreaFraction,
    flaggedSegmentsPerView: row.flaggedSegmentsPerView,
    skeletonPixels: row.skeletonPixels, skeletonHits: row.skeletonHits, objectRecall: row.objectRecall };
  row.byObjectType = byObjectType;
  return { row, metadata: result.metadata || null };
}

/* ---------------- split summary ---------------- */
function summarize(rows, options) {
  options = options || {};
  const allRows = Array.isArray(rows) ? rows : [];
  const unevaluatedRows = allRows.filter((r) => r && r.evaluated === false);
  const rowsE = allRows.filter((r) => r && r.evaluated !== false);
  const sum = (list, k) => list.reduce((a, r) => a + (r[k] || 0), 0);
  const positives = rowsE.filter((r) => r.class === "positive");
  const confusers = rowsE.filter((r) => r.class !== "positive");
  const elig = sum(rowsE, "eligibleSegments"), eligTP = sum(rowsE, "eligibleTouching");
  const lik = sum(rowsE, "eligibleLikely"), likTP = sum(rowsE, "eligibleLikelyTouching");
  const skel = sum(positives, "skeletonPixels"), skelHit = sum(positives, "skeletonHits");
  // Region-macro recall: pool skeleton counts within a region, average regions.
  const byRegion = new Map();
  for (const r of positives) {
    const key = r.region || "unknown";
    if (!byRegion.has(key)) byRegion.set(key, { skeletonPixels: 0, skeletonHits: 0 });
    const g = byRegion.get(key);
    g.skeletonPixels += r.skeletonPixels || 0; g.skeletonHits += r.skeletonHits || 0;
  }
  const regionRecalls = [...byRegion.values()].filter((g) => g.skeletonPixels > 0)
    .map((g) => g.skeletonHits / g.skeletonPixels);
  const objectRecallMacro = regionRecalls.length
    ? regionRecalls.reduce((a, b) => a + b, 0) / regionRecalls.length : null;
  const objectRecallByRegion = {};
  for (const [k, g] of [...byRegion].sort())
    objectRecallByRegion[k] = { skeletonPixels: g.skeletonPixels, skeletonHits: g.skeletonHits,
      objectRecall: g.skeletonPixels ? +(g.skeletonHits / g.skeletonPixels).toFixed(4) : null };
  const byType = new Map();
  for (const r of confusers) {
    const key = r.type || r.class || "unknown";
    if (!byType.has(key)) byType.set(key, []);
    byType.get(key).push(r);
  }
  const confuserByType = {};
  for (const [type, list] of [...byType].sort()) {
    const areaMean = list.reduce((a, r) => a + (r.flaggedAreaFraction || 0), 0) / list.length;
    const base = list.filter((r) => r.baselinePixelFAR != null);
    const baseMean = base.length ? base.reduce((a, r) => a + r.baselinePixelFAR, 0) / base.length : null;
    const validGround = sum(list, "validGroundPixels");
    confuserByType[type] = {
      views: list.length,
      flaggedSegmentsTotal: sum(list, "eligibleSegments"),
      flaggedSegmentsPerView: +(sum(list, "eligibleSegments") / list.length).toFixed(3),
      flaggedAreaFraction: +areaMean.toFixed(5),
      flaggedPixels: sum(list, "flaggedPixels"), validGroundPixels: validGround,
      baselineFlaggedPixels: sum(list, "baselineFlaggedPixels"),
      flaggedAreaFractionPooled: validGround ? +(sum(list, "flaggedPixels") / validGround).toFixed(5) : null,
      baselinePixelFAR: baseMean != null ? +baseMean.toFixed(5) : null,
      belowBaseline: baseMean != null ? areaMean < baseMean : null,
    };
  }
  // Per-objectType summary (ridge / belt / combined). Combined uses
  // the existing top-level fields above; ridge and belt pool only
  // views whose type split was evaluated. Rows built before the
  // per-type fields existed have no entry and count as unevaluated
  // for the split (their combined figures are still used).
  const typeEntryOf = (r, t) => (r && r.byObjectType && r.byObjectType[t]) || null;
  const typeEvaluatedRows = (list, t) => list.filter((r) => {
    const e = typeEntryOf(r, t);
    return e && e.evaluated !== false && e.unevaluated !== true;
  });
  const sumEntry = (list, t, k) => list.reduce((a, r) => a + ((typeEntryOf(r, t) || {})[k] || 0), 0);
  const typeSplitUnevaluatedRows = allRows.filter((r) => r && (r.typeSplitUnevaluated === true ||
    (typeEntryOf(r, "ridge") && typeEntryOf(r, "ridge").unevaluated === true) || r.evaluated === false));
  function summarizeObjectType(t) {
    const rowsT = typeEvaluatedRows(rowsE, t), posT = typeEvaluatedRows(positives, t);
    const eT = sumEntry(rowsT, t, "eligibleSegments"), eTP = sumEntry(rowsT, t, "eligibleTouching");
    const lT = sumEntry(rowsT, t, "eligibleLikely"), lTP = sumEntry(rowsT, t, "eligibleLikelyTouching");
    const sT = sumEntry(posT, t, "skeletonPixels"), sHitT = sumEntry(posT, t, "skeletonHits");
    const byReg = new Map();
    for (const r of posT) {
      const key = r.region || "unknown", e = typeEntryOf(r, t);
      if (!byReg.has(key)) byReg.set(key, { skeletonPixels: 0, skeletonHits: 0 });
      const g = byReg.get(key);
      g.skeletonPixels += e.skeletonPixels || 0; g.skeletonHits += e.skeletonHits || 0;
    }
    const recalls = [...byReg.values()].filter((g) => g.skeletonPixels > 0)
      .map((g) => g.skeletonHits / g.skeletonPixels);
    const macro = recalls.length ? recalls.reduce((a, b) => a + b, 0) / recalls.length : null;
    const byRegOut = {};
    for (const [k, g] of [...byReg].sort())
      byRegOut[k] = { skeletonPixels: g.skeletonPixels, skeletonHits: g.skeletonHits,
        objectRecall: g.skeletonPixels ? +(g.skeletonHits / g.skeletonPixels).toFixed(4) : null };
    const lp = lT ? lTP / lT : null;
    return { objectType: t, views: rowsT.length, evaluatedViews: rowsT.length,
      positiveViews: posT.length, confuserViews: typeEvaluatedRows(confusers, t).length,
      eligibleSegments: eT, eligibleLikely: lT, eligibleTouching: eTP, eligibleLikelyTouching: lTP,
      objectPrecision: eT ? +(eTP / eT).toFixed(4) : null,
      likelyPrecision: lp != null ? +lp.toFixed(4) : null,
      objectRecall: macro != null ? +macro.toFixed(4) : null,
      objectRecallPooled: sT ? +(sHitT / sT).toFixed(4) : null,
      objectRecallByRegion: byRegOut, skeletonPixels: sT, skeletonHits: sHitT,
      flaggedPixels: sumEntry(rowsT, t, "flaggedPixels"),
      validGroundPixels: sum(rowsT, "validGroundPixels") };
  }
  const byObjectTypeSummary = { ridge: summarizeObjectType("ridge"), belt: summarizeObjectType("belt"),
    combined: { objectType: "combined", views: rowsE.length, evaluatedViews: rowsE.length,
      positiveViews: positives.length, confuserViews: confusers.length,
      eligibleSegments: elig, eligibleLikely: lik, eligibleTouching: eligTP, eligibleLikelyTouching: likTP,
      objectPrecision: elig ? +(eligTP / elig).toFixed(4) : null,
      likelyPrecision: lik ? +((likTP / lik)).toFixed(4) : null,
      objectRecall: objectRecallMacro != null ? +objectRecallMacro.toFixed(4) : null,
      objectRecallPooled: skel ? +(skelHit / skel).toFixed(4) : null,
      objectRecallByRegion, skeletonPixels: skel, skeletonHits: skelHit,
      flaggedPixels: sum(rowsE, "flaggedPixels"), validGroundPixels: sum(rowsE, "validGroundPixels") } };
  // Per-confuser flagged area split by object type.
  function confuserStats(list, t) {
    if (!list.length) return null;
    const get = (r, k) => (t === "combined" ? (r[k] || 0) : ((typeEntryOf(r, t) || {})[k] || 0));
    const areaKey = t === "combined" ? "flaggedAreaFraction" : "flaggedAreaFraction";
    const areaMean = list.reduce((a, r) => a + get(r, areaKey), 0) / list.length;
    const base = list.filter((r) => r.baselinePixelFAR != null);
    const baseMean = base.length ? base.reduce((a, r) => a + r.baselinePixelFAR, 0) / base.length : null;
    const validGround = sum(list, "validGroundPixels");
    const fp = list.reduce((a, r) => a + get(r, "flaggedPixels"), 0);
    const fs = list.reduce((a, r) => a + get(r, "eligibleSegments"), 0);
    return { views: list.length, flaggedSegmentsTotal: fs,
      flaggedSegmentsPerView: +(fs / list.length).toFixed(3),
      flaggedAreaFraction: +areaMean.toFixed(5), flaggedPixels: fp, validGroundPixels: validGround,
      baselineFlaggedPixels: sum(list, "baselineFlaggedPixels"),
      flaggedAreaFractionPooled: validGround ? +(fp / validGround).toFixed(5) : null,
      baselinePixelFAR: baseMean != null ? +baseMean.toFixed(5) : null,
      belowBaseline: baseMean != null ? areaMean < baseMean : null };
  }
  const confuserByObjectType = { ridge: {}, belt: {}, combined: {} };
  for (const [type, list] of [...byType].sort()) {
    const ridgeStats = confuserStats(typeEvaluatedRows(list, "ridge"), "ridge");
    const beltStats = confuserStats(typeEvaluatedRows(list, "belt"), "belt");
    const combinedStats = confuserStats(list, "combined");
    // confuserByType entries stay exactly as before; the split lives
    // only in the new confuserByObjectType structure.
    confuserByType[type] = { ...combinedStats };
    confuserByObjectType.ridge[type] = ridgeStats;
    confuserByObjectType.belt[type] = beltStats;
    confuserByObjectType.combined[type] = { ...combinedStats,
      byObjectType: { ridge: ridgeStats, belt: beltStats, combined: { ...combinedStats } } };
  }
  const likelyPrecision = lik ? likTP / lik : null;
  const objectRecallPooled = skel ? skelHit / skel : null;
  const incomplete = options.complete === false || unevaluatedRows.length > 0;
  const confuserTypesBelowBaseline = Object.values(confuserByType)
    .every((t) => t.belowBaseline !== false);
  const metricsPass = (likelyPrecision != null && likelyPrecision >= SUCCESS_BAR.likelyPrecisionMin) &&
    (objectRecallMacro != null && objectRecallMacro >= SUCCESS_BAR.objectRecallMin) && confuserTypesBelowBaseline;
  const status = incomplete ? "unevaluated" : "evaluated";
  const membershipSource = { segmentPixels: 0, segmentRaster: 0, none: 0 };
  for (const r of rowsE) if (r.membershipSource)
    for (const k of Object.keys(membershipSource)) membershipSource[k] += r.membershipSource[k] || 0;
  return {
    membershipRule: MEMBERSHIP_RULE, membershipNote: MEMBERSHIP_NOTE, membershipSource,
    beltEligibilityAreaBasis: "membership pixel count (belt: original candidate-mask cells inside the zone, not zonePixels/areaM2)",
    views: allRows.length, evaluatedViews: rowsE.length, unevaluatedViews: unevaluatedRows.length,
    unevaluatedReasons: [...new Set(unevaluatedRows.map((r) => r.unevaluatedReason).filter(Boolean))],
    positiveViews: positives.length, confuserViews: confusers.length,
    eligibleSegments: elig, eligibleLikely: lik,
    objectPrecision: elig ? +(eligTP / elig).toFixed(4) : null,
    likelyPrecision: likelyPrecision != null ? +likelyPrecision.toFixed(4) : null,
    objectRecall: objectRecallMacro != null ? +objectRecallMacro.toFixed(4) : null,
    objectRecallPooled: objectRecallPooled != null ? +objectRecallPooled.toFixed(4) : null,
    objectRecallByRegion, skeletonPixels: skel, skeletonHits: skelHit,
    validGroundPixels: sum(rowsE, "validGroundPixels"),
    confuserByType,
    byObjectType: byObjectTypeSummary,
    objectPrecisionByObjectType: { ridge: byObjectTypeSummary.ridge.objectPrecision,
      belt: byObjectTypeSummary.belt.objectPrecision, combined: byObjectTypeSummary.combined.objectPrecision },
    likelyPrecisionByObjectType: { ridge: byObjectTypeSummary.ridge.likelyPrecision,
      belt: byObjectTypeSummary.belt.likelyPrecision, combined: byObjectTypeSummary.combined.likelyPrecision },
    objectRecallByObjectType: { ridge: byObjectTypeSummary.ridge.objectRecall,
      belt: byObjectTypeSummary.belt.objectRecall, combined: byObjectTypeSummary.combined.objectRecall },
    confuserByObjectType, confuserByTypeAndObjectType: confuserByObjectType,
    typeSplitUnevaluatedViews: typeSplitUnevaluatedRows.length,
    typeSplitUnevaluatedReasons: [...new Set(typeSplitUnevaluatedRows
      .map((r) => r.typeSplitUnevaluatedReason || (r.byObjectType && r.byObjectType.ridge &&
        r.byObjectType.ridge.unevaluatedReason) || r.unevaluatedReason).filter(Boolean))],
    successBar: {
      bar: { likelyPrecisionMin: SUCCESS_BAR.likelyPrecisionMin, objectRecallMin: SUCCESS_BAR.objectRecallMin,
        confuserFlaggedArea: "below current screen pixel FAR at 0.58, per confuser type" },
      status, complete: !incomplete,
      likelyPrecision: likelyPrecision != null ? +likelyPrecision.toFixed(4) : null,
      likelyPrecisionPass: incomplete ? null : (likelyPrecision != null ? likelyPrecision >= SUCCESS_BAR.likelyPrecisionMin : null),
      objectRecall: objectRecallMacro != null ? +objectRecallMacro.toFixed(4) : null,
      objectRecallPooled: objectRecallPooled != null ? +objectRecallPooled.toFixed(4) : null,
      objectRecallPass: incomplete ? null : (objectRecallMacro != null ? objectRecallMacro >= SUCCESS_BAR.objectRecallMin : null),
      confuserFlaggedAreaPass: incomplete ? null : confuserTypesBelowBaseline,
      pass: incomplete ? null : metricsPass,
    },
  };
}
// Official bar: only from complete train+validation rows under one fingerprint.
function officialSuccessBar(summaries, fingerprints, rows) {
  const sTrain = summaries && summaries.train, sVal = summaries && summaries.validation;
  const fTrain = fingerprints && fingerprints.train, fVal = fingerprints && fingerprints.validation;
  if (!sTrain || !sVal)
    return { status: "unevaluated", pass: null, reason: "requires complete train and validation runs under one fingerprint" };
  if (!fTrain || !fVal || fTrain.hash !== fVal.hash)
    return { status: "unevaluated", pass: null, reason: "train and validation fingerprints differ or are missing" };
  if (fTrain.complete === false || fVal.complete === false)
    return { status: "unevaluated", pass: null, reason: "train or validation run is incomplete (partial --limit or baseline-less)" };
  const combined = summarize(Array.isArray(rows) ? rows : [], { complete: true });
  if (combined.unevaluatedViews > 0)
    return { status: "unevaluated", pass: null, reason: `${combined.unevaluatedViews} view(s) unevaluated (no exact segment pixels)`, summary: combined };
  return { ...combined.successBar, summary: combined };
}

/* ---------------- fingerprint ---------------- */
function canonicalJson(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(",")}}`;
}
function sha256Hex(text) { return crypto.createHash("sha256").update(text).digest("hex"); }
function fileHash(p) { try { return sha256Hex(fs.readFileSync(p)); } catch { return null; } }
function viewCorpusHashes() {
  const directory = path.join(OUT_DIR, "views");
  // Identity covers every cached view's compressed bytes in stable filename
  // order. Hashing does not decode labels/DEM or score held-out test views.
  if (!fs.existsSync(directory)) return { available: false, files: {} };
  const files = Object.fromEntries(fs.readdirSync(directory).sort()
    .filter(name => name.endsWith(".json.gz"))
    .map(name => [name, sha256Hex(fs.readFileSync(path.join(directory, name)))]));
  return { available: true, files };
}
function computeFingerprint({ config, candidateThreshold, analysisPath, viewCount, limit, skipBaseline, split, beltOff }) {
  const effectiveConfig = config || {};
  const analysisHash = fileHash(analysisPath);
  // Hash the whole analysis pipeline and metric implementation: the wrapper
  // alone is unchanged when feature extraction or classifier rules change.
  const dependencyHashes = Object.fromEntries([
    "glacial-research-core.js", "glacial-segment-core.js", "glacial-segment-features.js",
    "glacial-moraine-classifier.js", "glacial-zone-core.js", "glacial-zone-features.js",
    "glacial-belt-classifier.js", "scripts/glacial-calibration/evaluate.js",
    "scripts/glacial-calibration/evaluate-objects.js", "output/glacial-calibration/manifest.json"
  ].map(name => [name, fileHash(path.join(REPO_ROOT, name))]));
  const identity = { config: effectiveConfig, candidateThreshold, analysisModuleHash: analysisHash,
    dependencyHashes, viewCorpus: viewCorpusHashes(),
    limit: limit != null ? limit : null, baseline: !skipBaseline, belt: !beltOff,
    membershipRule: MEMBERSHIP_RULE };
  const hash = sha256Hex(canonicalJson(identity));
  const complete = limit == null && !skipBaseline;
  return { hash, fingerprint: hash, ...identity, analysisHash, analysisPath,
    viewCount, baselineOn: !skipBaseline, split, complete, incomplete: !complete };
}

/* ---------------- CLI ---------------- */
function parseConfig(raw) {
  if (raw == null || raw === "") return {};
  const text = fs.existsSync(raw) ? fs.readFileSync(raw, "utf8") : raw;
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("--config must be a JSON object (inline JSON or path to a JSON file)");
  return parsed;
}

function main() {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const has = (k) => args.includes(k);
  const split = opt("--split", "train");
  if (split === "test") {
    console.error("error: --split test refused: the calibration test regions are spent " +
      "and must not be scored by this build (docs/GLACIAL_MORAINE_V2_DESIGN.md). Use train or validation.");
    process.exit(2);
  }
  if (split !== "train" && split !== "validation") {
    console.error(`error: --split must be train or validation (got ${JSON.stringify(split)}); test is refused.`);
    process.exit(2);
  }
  let config;
  try { config = parseConfig(opt("--config", null)); }
  catch (e) { console.error(`error: ${e.message}`); process.exit(2); }
  const candidateRaw = opt("--candidate-threshold", null);
  const limitRaw = opt("--limit", null);
  const limit = limitRaw != null ? Math.max(0, parseInt(limitRaw, 10) || 0) : null;
  const outFile = opt("--out", DEFAULT_OUT);
  const analysisPath = path.resolve(opt("--analysis", DEFAULT_ANALYSIS));
  const skipBaseline = has("--skip-baseline");
  const beltOff = has("--belt-off");
  const candidateThreshold = candidateRaw != null ? Number(candidateRaw)
    : (config && config.candidateThreshold != null ? Number(config.candidateThreshold) : 0.45);

  let analyze;
  try { analyze = resolveAnalyze(analysisPath); }
  catch (e) { console.error(`error: ${e.message}`); process.exit(1); }

  let views = loadViews(split);
  const totalViews = views.length;
  if (limit != null) views = views.slice(0, limit);
  const fingerprint = computeFingerprint({ config, candidateThreshold, analysisPath,
    viewCount: views.length, limit, skipBaseline, split, beltOff });
  fingerprint.totalViewsAvailable = totalViews;

  const cliOpts = { candidateThreshold: candidateRaw != null ? Number(candidateRaw) : null, skipBaseline };
  if (beltOff) cliOpts.belt = false;
  const rows = []; let metadataSample = null;
  const t0 = Date.now();
  for (const view of views) {
    const { row, metadata } = evaluateView(view, analyze, config, cliOpts);
    if (!metadataSample && metadata) metadataSample = metadata;
    rows.push(row);
  }
  const summary = summarize(rows, { complete: fingerprint.complete, fingerprint: fingerprint.hash });
  const payload = {
    tool: "evaluate-objects", created: new Date().toISOString(), split, config,
    candidateThreshold, analysisPath, analysisModuleHash: fingerprint.analysisModuleHash,
    belt: !beltOff, membershipRule: MEMBERSHIP_RULE, membershipNote: MEMBERSHIP_NOTE,
    fingerprint, fingerprints: { [split]: fingerprint },
    complete: fingerprint.complete, incomplete: fingerprint.incomplete,
    minSegmentAreaM2: MIN_SEGMENT_AREA_M2, baselineThreshold: BASELINE_THRESHOLD,
    baselineRadiusCells: BASELINE_RADIUS_CELLS,
    analysisMetadataSample: metadataSample,
    seconds: +((Date.now() - t0) / 1000).toFixed(1),
    summaries: { [split]: summary }, rows,
  };
  payload.officialSuccessBar = officialSuccessBar(payload.summaries, payload.fingerprints, payload.rows);
  payload.successBar = payload.officialSuccessBar;
  // Merge into an existing results file so train and validation accumulate.
  if (fs.existsSync(outFile)) {
    try {
      const prev = JSON.parse(fs.readFileSync(outFile, "utf8"));
      if (prev && prev.summaries && Array.isArray(prev.rows)) {
        const prevFps = prev.fingerprints || (prev.fingerprint ? { [prev.split]: prev.fingerprint } : null);
        const retained = Object.keys(prev.summaries).filter((s) => s !== split);
        if (retained.length) {
          if (!prevFps) {
            console.error("error: refusing to merge splits: existing results file has no fingerprint; start from a fresh results file");
            process.exit(2);
          }
          for (const s of retained) {
            if (!prevFps[s] || prevFps[s].hash !== fingerprint.hash) {
              console.error(`error: refusing to merge splits with different fingerprints: ` +
                `${s} fingerprint ${prevFps[s] ? prevFps[s].hash : "missing"} != ${split} fingerprint ${fingerprint.hash}; ` +
                `config, candidateThreshold, analysis pipeline dependencies, metrics, manifest, limit, baseline, belt on/off, or membership rule differ. Start from a fresh results file.`);
              process.exit(2);
            }
          }
        }
        payload.summaries = { ...prev.summaries, [split]: summary };
        payload.rows = [...prev.rows.filter((r) => r.split !== split), ...rows];
        payload.fingerprints = { ...(prevFps || {}), [split]: fingerprint };
        payload.officialSuccessBar = officialSuccessBar(payload.summaries, payload.fingerprints, payload.rows);
        payload.successBar = payload.officialSuccessBar;
      }
    } catch (e) {
      if (e && e.code === "MERGE_REFUSED") throw e;
      if (process.exitCode) throw e;
      /* unreadable previous results: overwrite with this split only */
      if (e instanceof SyntaxError || (e && e.code === "ENOENT")) { /* overwrite */ } else if (e && e.message && e.message.startsWith("error:")) throw e;
    }
  }
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(payload, null, 1));

  const bar = summary.successBar;
  const fmt = (v) => (v == null ? "n/a" : Number(v).toFixed(3));
  const yn = (v) => (v == null ? "n/a" : v ? "PASS" : "FAIL");
  console.log(`split=${split} views=${summary.views} (positive ${summary.positiveViews}, confuser ${summary.confuserViews}, unevaluated ${summary.unevaluatedViews})`);
  if (summary.unevaluatedViews)
    for (const r of summary.unevaluatedReasons) console.log(`  unevaluated: ${r}`);
  console.log(`fingerprint=${fingerprint.hash} complete=${fingerprint.complete} baseline=${!skipBaseline} belt=${beltOff ? "off" : "on"} limit=${limit == null ? "none" : limit} views=${fingerprint.viewCount}`);
  const m = summary.membershipSource;
  console.log(`membership (${MEMBERSHIP_RULE}): segments by own pixels=${m.segmentPixels} by raster=${m.segmentRaster} none=${m.none}`);
  const beltWhileOff = rows.reduce((a, r) => a + (r.beltSegmentsWhileBeltOff || 0), 0);
  if (beltWhileOff)
    console.log(`  warning: --belt-off set but the analysis returned ${beltWhileOff} belt segment(s); it may not honour opts.belt === false`);
  console.log(`objectPrecision(likely+possible)=${fmt(summary.objectPrecision)}  ` +
    `likelyPrecision=${fmt(summary.likelyPrecision)}  objectRecall(region-macro)=${fmt(summary.objectRecall)}  objectRecallPooled=${fmt(summary.objectRecallPooled)}`);
  const barText = bar.status === "unevaluated" ? "unevaluated" : (bar.pass ? "PASS" : "FAIL");
  console.log(`success bar: likelyPrecision>=${SUCCESS_BAR.likelyPrecisionMin} [${yn(bar.likelyPrecisionPass)}]  ` +
    `recall>=${SUCCESS_BAR.objectRecallMin} [${yn(bar.objectRecallPass)}]  ` +
    `confuser flagged area < pixel FAR@${BASELINE_THRESHOLD} [${yn(bar.confuserFlaggedAreaPass)}]  => ${barText}`);
  const off = payload.officialSuccessBar;
  console.log(`official success bar (complete train+validation, one fingerprint): ${off.status === "unevaluated" ? "unevaluated" : (off.pass ? "PASS" : "FAIL")}` +
    (off.reason ? ` (${off.reason})` : ""));
  for (const [type, t] of Object.entries(summary.confuserByType))
    console.log(`  confuser ${type}: ${t.flaggedSegmentsPerView}/view, flaggedArea=${fmt(t.flaggedAreaFraction)} vs baseline FAR=${fmt(t.baselinePixelFAR)} [${yn(t.belowBaseline)}]`);
  if (summary.byObjectType) {
    for (const t of ["ridge", "belt", "combined"]) {
      const s = summary.byObjectType[t];
      console.log(`  objectType ${t}: objectPrecision=${fmt(s.objectPrecision)} likelyPrecision=${fmt(s.likelyPrecision)} ` +
        `objectRecall(region-macro)=${fmt(s.objectRecall)} objectRecallPooled=${fmt(s.objectRecallPooled)}`);
    }
    if (summary.typeSplitUnevaluatedViews)
      console.log(`  type split unevaluated views: ${summary.typeSplitUnevaluatedViews}`);
    for (const [type] of Object.entries(summary.confuserByType)) {
      const b = (summary.confuserByObjectType && summary.confuserByObjectType.combined[type] &&
        summary.confuserByObjectType.combined[type].byObjectType) || {};
      const part = (x) => (x ? `${fmt(x.flaggedAreaFraction)} (${x.flaggedPixels}px)` : "n/a");
      console.log(`  confuser ${type} flagged area by objectType: ridge=${part(b.ridge)} belt=${part(b.belt)} combined=${part(b.combined)}`);
    }
  }
  console.log(`wrote ${outFile}`);
}
if (require.main === module) main();
module.exports = { segmentAreaM2, segmentPixelIndices, segmentTouches, buildFlaggedMask, evaluateView,
  exactSegmentPixels, MEMBERSHIP_RULE, summarize, officialSuccessBar, computeFingerprint, parseConfig, resolveAnalyze, squaredDistanceTo, touchTargetMask, segmentObjectType, objectTypeOf: segmentObjectType, rasterTypeSplitStatus, OBJECT_TYPES, SUCCESS_BAR, MIN_SEGMENT_AREA_M2, BASELINE_THRESHOLD };
