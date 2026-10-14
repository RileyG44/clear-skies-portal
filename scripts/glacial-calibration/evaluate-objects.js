"use strict";
/* Object-level evaluation of glacial-moraine-analysis v2 (design:
   docs/GLACIAL_MORAINE_V2_DESIGN.md, "Offline validation").

   For --split train|validation ONLY. The calibration test regions are
   spent: --split test (and any other split) is refused before any view
   or the analysis module is loaded, so this harness can never score it.
   evaluateView (the exported path) asserts the same before running
   analysis.

   Exact-touch rule (review fix): segment membership comes ONLY from the
   analysis result's segmentRaster (Int32Array of segment ids) or, when
   no raster is present, from per-segment `pixels`. Bounding-box overlap
   is never used for touch, area, or detection masks. A view whose result
   offers neither is counted unevaluated (no official metrics for it).
   Eligible segment area comes from exact pixel counts only (raster
   count, pixel-list length, or an explicit pixelCount); bbox-derived
   and areaM2-only areas cannot prove eligibility.

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
       [--candidate-threshold 0.45] [--skip-baseline]

   Pinned analysis API (glacial-moraine-analysis.js):
     analyzeMoraineCandidates(grid, w, h, opts)
       opts: {cellSize, cellMetres, candidateThreshold, config}
       -> {score, mask, segmentRaster?, segments: [{id, verdict, score,
           bbox, centroid, lengthM, evidence, pixelCount?, areaM2?,
           pixels?}], metadata}
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
    if (v && typeof v.length === "number" && v.length) return v;
  }
  return null;
}
function normalizePixels(raw, view) {
  if (!raw) return null;
  const out = [];
  for (let k = 0; k < raw.length; k++) {
    const v = raw[k];
    if (typeof v === "number" && Number.isFinite(v)) out.push(v | 0);
    else if (Array.isArray(v) && v.length >= 2) out.push((v[1] | 0) * view.w + (v[0] | 0));
    else if (v && typeof v === "object" && Number.isFinite(v.x) && Number.isFinite(v.y))
      out.push((v.y | 0) * view.w + (v.x | 0));
  }
  return out.length ? out : null;
}
// Exact per-segment pixel lists from segmentRaster, or null if the view
// has no exact source. Raster values are matched to segment ids; if no
// id matches, 0-based then 1-based array positions are tried.
function pixelsFromRaster(raster, segments, n) {
  const byValue = new Map();
  for (let i = 0; i < n; i++) {
    const v = raster[i];
    if (!byValue.has(v)) byValue.set(v, []);
    byValue.get(v).push(i);
  }
  const modes = {
    id: segments.map((s) => (s && byValue.has(s.id) ? byValue.get(s.id) : null)),
    index: segments.map((s, i) => (byValue.has(i) ? byValue.get(i) : null)),
    index1: segments.map((s, i) => (byValue.has(i + 1) ? byValue.get(i + 1) : null)),
  };
  const score = (lists) => lists.reduce((a, l) => a + (l ? 1 : 0), 0);
  const best = ["id", "index", "index1"].sort((a, b) => score(modes[b]) - score(modes[a]))[0];
  const map = new Map();
  segments.forEach((s, i) => { if (modes[best][i]) map.set(s, modes[best][i]); });
  return map;
}
// Returns {source, bySegment: Map<seg, number[]>} or null when neither
// segmentRaster nor any segment pixel list is available for the view.
function exactSegmentPixels(result, segments, view) {
  const n = view.w * view.h;
  const raster = result && result.segmentRaster;
  if (raster && typeof raster.length === "number" && raster.length === n && segments.length)
    return { source: "segmentRaster", bySegment: pixelsFromRaster(raster, segments, n) };
  if (raster && typeof raster.length === "number" && raster.length === n && !segments.length)
    return { source: "segmentRaster", bySegment: new Map() };
  let any = false;
  const bySegment = new Map();
  for (const seg of segments) {
    const px = normalizePixels(segmentPixelIndices(seg), view);
    if (px) { bySegment.set(seg, px); any = true; }
  }
  return any ? { source: "segmentPixels", bySegment } : null;
}
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
  };

  const exact = exactSegmentPixels(result, segments, view);
  if (!exact) {
    const reason = "exact segment pixels unavailable: analysis result has neither a " +
      "segmentRaster matching the view nor per-segment pixels; bbox overlap is not used";
    return { row: { ...baseRow, evaluated: false, unevaluated: true, unevaluatedReason: reason,
      exactSource: null, eligibleSegments: null, eligibleLikely: null, eligibleTouching: null,
      eligibleLikelyTouching: null, objectPrecision: null, likelyPrecision: null,
      flaggedPixels: null, flaggedAreaFraction: null, flaggedSegmentsPerView: null,
      skeletonPixels: null, skeletonHits: null, objectRecall: null }, metadata: result.metadata || null };
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

  const row = { ...baseRow, evaluated: true, unevaluated: false, unevaluatedReason: null,
    exactSource: exact.source, touchTargetPixels,
    eligibleSegments: eligible.length, eligibleLikely: likelyEligible.length,
    eligibleTouching, eligibleLikelyTouching,
    objectPrecision: eligible.length ? eligibleTouching / eligible.length : null,
    likelyPrecision: likelyEligible.length ? eligibleLikelyTouching / likelyEligible.length : null,
    flaggedPixels, flaggedAreaFraction: validGroundPixels ? flaggedPixels / validGroundPixels : null,
    flaggedSegmentsPerView: eligible.length,
    skeletonPixels: null, skeletonHits: null, objectRecall: null };

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
  }
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
  const likelyPrecision = lik ? likTP / lik : null;
  const objectRecallPooled = skel ? skelHit / skel : null;
  const incomplete = options.complete === false || unevaluatedRows.length > 0;
  const confuserTypesBelowBaseline = Object.values(confuserByType)
    .every((t) => t.belowBaseline !== false);
  const metricsPass = (likelyPrecision != null && likelyPrecision >= SUCCESS_BAR.likelyPrecisionMin) &&
    (objectRecallMacro != null && objectRecallMacro >= SUCCESS_BAR.objectRecallMin) && confuserTypesBelowBaseline;
  const status = incomplete ? "unevaluated" : "evaluated";
  return {
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
function computeFingerprint({ config, candidateThreshold, analysisPath, viewCount, limit, skipBaseline, split }) {
  const effectiveConfig = config || {};
  const analysisHash = fileHash(analysisPath);
  const identity = { config: effectiveConfig, candidateThreshold, analysisModuleHash: analysisHash,
    limit: limit != null ? limit : null, baseline: !skipBaseline };
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
  const candidateThreshold = candidateRaw != null ? Number(candidateRaw)
    : (config && config.candidateThreshold != null ? Number(config.candidateThreshold) : 0.45);

  let analyze;
  try { analyze = resolveAnalyze(analysisPath); }
  catch (e) { console.error(`error: ${e.message}`); process.exit(1); }

  let views = loadViews(split);
  const totalViews = views.length;
  if (limit != null) views = views.slice(0, limit);
  const fingerprint = computeFingerprint({ config, candidateThreshold, analysisPath,
    viewCount: views.length, limit, skipBaseline, split });
  fingerprint.totalViewsAvailable = totalViews;

  const cliOpts = { candidateThreshold: candidateRaw != null ? Number(candidateRaw) : null, skipBaseline };
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
                `config, candidateThreshold, analysis module, limit, or baseline settings differ. Start from a fresh results file.`);
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
  console.log(`fingerprint=${fingerprint.hash} complete=${fingerprint.complete} baseline=${!skipBaseline} limit=${limit == null ? "none" : limit} views=${fingerprint.viewCount}`);
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
  console.log(`wrote ${outFile}`);
}
if (require.main === module) main();
module.exports = { segmentAreaM2, segmentPixelIndices, segmentTouches, buildFlaggedMask, evaluateView, summarize, officialSuccessBar, computeFingerprint, parseConfig, resolveAnalyze, squaredDistanceTo, touchTargetMask, SUCCESS_BAR, MIN_SEGMENT_AREA_M2, BASELINE_THRESHOLD };
