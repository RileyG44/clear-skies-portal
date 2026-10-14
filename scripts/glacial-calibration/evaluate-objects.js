"use strict";
/* Object-level evaluation of glacial-moraine-analysis v2 (design:
   docs/GLACIAL_MORAINE_V2_DESIGN.md, "Offline validation").

   For --split train|validation ONLY. The calibration test regions are
   spent: --split test (and any other split) is refused before any view
   or the analysis module is loaded, so this harness can never score it.

   Per cached view (reuse of evaluate.js loadViews / view format:
   gridB64/posB64/ignB64 -> grid/pos/ign, plus split, class, type,
   cellMetres, uncertaintyM) the object pipeline is run once and:

   - object precision: share of eligible segments (verdict likely or
     possible, area >= 5,000 m2) touching a positive (pos) or
     uncertainty-ignore (ign) pixel. Reported pooled for likely+possible
     together and for likely alone (the pre-registered success bar uses
     likely). Segment area prefers segment.areaM2, then
     segment.pixelCount * cell area, then an explicit pixel list, then a
     bbox approximation ((x1-x0+1)*(y1-y0+1) cells, inclusive bbox).
   - object recall: fraction of the positive-mask skeleton (Zhang-Suen,
     reused from evaluate.js) lying within view.uncertaintyM of a
     likely+possible segment pixel. The segment-pixel raster is built
     from per-segment pixels when present, else from the returned
     result.mask restricted to eligible segments' bboxes, else from
     filled eligible bboxes (documented approximation: bbox touch tests
     and bbox-filled rasters can only inflate touch/recall, so a shortfall
     under that approximation is conservative evidence of failure, while
     a pass should be re-checked once segments carry real pixel lists).
   - per-confuser-type false alarms (non-positive views, grouped by
     view.type): eligible flagged segments per view and flagged area
     fraction (flagged pixels / view pixels), each compared with the
     current pixel screen's per-type FAR at threshold 0.58, computed with
     evaluate.js scoreView under its default (current-screen) parameters
     unless --skip-baseline is given.

   Usage:
     node scripts/glacial-calibration/evaluate-objects.js --split train
       [--config '{"candidateThreshold":0.45}' | --config config.json]
       [--out output/glacial-calibration/results-objects.json]
       [--analysis ../../glacial-moraine-analysis.js] [--limit N]
       [--candidate-threshold 0.45] [--skip-baseline]

   --config accepts an inline JSON object or a path to a JSON file; the
   parsed object is passed through to the analysis as opts.config (and
   config.candidateThreshold, if present, also as opts.candidateThreshold).
   --analysis overrides the analysis module path (used to smoke-test this
   harness against a stub before glacial-moraine-analysis.js lands).

   Pinned analysis API (glacial-moraine-analysis.js):
     analyzeMoraineCandidates(grid, w, h, opts)
       opts: {cellSize, cellMetres, candidateThreshold, config}
       -> {score, mask, segments: [{id, verdict, score, bbox, centroid,
           lengthM, evidence, pixelCount?, areaM2?, pixels?}], metadata}
   CommonJS direct export, a {analyzeMoraineCandidates} object, a UMD
   global-style export, and a factory(G, ...siblings) returning such an
   object are all accepted (see resolveAnalyze). */
const fs = require("fs"), path = require("path");

const REPO_ROOT = path.join(__dirname, "..", "..");
const OUT_DIR = path.join(REPO_ROOT, "output", "glacial-calibration");
const DEFAULT_OUT = path.join(OUT_DIR, "results-objects.json");
const DEFAULT_ANALYSIS = path.join(REPO_ROOT, "glacial-moraine-analysis.js");
const MIN_SEGMENT_AREA_M2 = 5000; // design: min candidate area
const BASELINE_THRESHOLD = 0.58; // current screen threshold in the design doc
const SUCCESS_BAR = { likelyPrecisionMin: 0.5, objectRecallMin: 0.4 };

const { loadViews, skeletonize, scoreView, viewFAR, parseParams: parsePixelParams } =
  require(path.join(__dirname, "evaluate.js"));

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
    // Factory shape: (G, segments?, features?, classifier?) -> {analyze...}.
    try {
      const core = tryRequire(path.join(REPO_ROOT, "glacial-research-core.js"));
      const sib = (n) => tryRequire(path.join(REPO_ROOT, n));
      const made = mod(core, sib("glacial-segment-core.js"),
        sib("glacial-segment-features.js"), sib("glacial-moraine-classifier.js"));
      fn = fromObject(made);
      if (fn) return fn;
    } catch { /* not a factory; fall through and treat mod itself as the fn */ }
    return mod; // direct analyzeMoraineCandidates(grid, w, h, opts) export
  }
  throw new Error(`analysis module at ${analysisPath} exposes no analyzeMoraineCandidates ` +
    `(expected {analyzeMoraineCandidates}, a UMD equivalent, or a factory returning one)`);
}

/* ---------------- segment helpers ---------------- */
function segmentPixelIndices(seg) {
  for (const key of ["pixels", "pixelIndices", "indices", "pixelIndexes"]) {
    const v = seg && seg[key];
    if (v && typeof v.length === "number" && v.length) return v;
  }
  return null;
}

function segmentAreaM2(seg, cellMetres) {
  const cellArea = cellMetres * cellMetres;
  if (seg && Number.isFinite(seg.areaM2) && seg.areaM2 > 0) return seg.areaM2;
  if (seg && Number.isFinite(seg.area) && seg.area > 0) return seg.area; // tolerated alias
  if (seg && Number.isFinite(seg.pixelCount) && seg.pixelCount > 0) return seg.pixelCount * cellArea;
  const px = segmentPixelIndices(seg);
  if (px) return px.length * cellArea;
  if (seg && Array.isArray(seg.bbox) && seg.bbox.length >= 4) {
    const bw = Math.max(0, seg.bbox[2] - seg.bbox[0] + 1); // inclusive bbox
    const bh = Math.max(0, seg.bbox[3] - seg.bbox[1] + 1);
    return bw * bh * cellArea;
  }
  return 0; // unknown area: not eligible (cannot prove >= minimum)
}

function bboxContains(seg, x, y) {
  if (!seg || !Array.isArray(seg.bbox) || seg.bbox.length < 4) return false;
  return x >= seg.bbox[0] && x <= seg.bbox[2] && y >= seg.bbox[1] && y <= seg.bbox[3];
}

// Does a segment touch any pos/ign pixel? Exact via its pixel list when
// present; otherwise any pos/ign pixel inside its bbox (approximation).
function segmentTouches(seg, view) {
  const { pos, ign, w } = view;
  const px = segmentPixelIndices(seg);
  if (px) { for (let k = 0; k < px.length; k++) if (pos[px[k]] || ign[px[k]]) return true; return false; }
  if (seg && Array.isArray(seg.bbox) && seg.bbox.length >= 4) {
    const [x0, y0, x1, y1] = seg.bbox;
    for (let y = Math.max(0, y0); y <= Math.min(view.h - 1, y1); y++)
      for (let x = Math.max(0, x0); x <= Math.min(w - 1, x1); x++)
        if (pos[y * w + x] || ign[y * w + x]) return true;
  }
  return false;
}

// Raster of likely+possible segment pixels, restricted to eligible segs.
function buildFlaggedMask(result, eligible, view) {
  const { w, h } = view, n = w * h, out = new Uint8Array(n);
  const anyPixels = eligible.some((s) => segmentPixelIndices(s));
  if (anyPixels) {
    for (const seg of eligible) {
      const px = segmentPixelIndices(seg);
      if (px) { for (let k = 0; k < px.length; k++) if (px[k] >= 0 && px[k] < n) out[px[k]] = 1; }
      else if (Array.isArray(seg.bbox)) // mixed shapes: fall back to bbox fill
        for (let y = Math.max(0, seg.bbox[1]); y <= Math.min(h - 1, seg.bbox[3]); y++)
          for (let x = Math.max(0, seg.bbox[0]); x <= Math.min(w - 1, seg.bbox[2]); x++) out[y * w + x] = 1;
    }
    return out;
  }
  const mask = result && result.mask;
  if (mask && mask.length === n && eligible.length) {
    // True segment pixels, kept only inside an eligible segment's bbox.
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      if (eligible.some((s) => bboxContains(s, x, y))) out[y * w + x] = 1;
    }
    return out;
  }
  if (mask && mask.length === n) { for (let i = 0; i < n; i++) out[i] = mask[i] ? 1 : 0; return out; }
  for (const seg of eligible) {
    if (!Array.isArray(seg.bbox)) continue;
    for (let y = Math.max(0, seg.bbox[1]); y <= Math.min(h - 1, seg.bbox[3]); y++)
      for (let x = Math.max(0, seg.bbox[0]); x <= Math.min(w - 1, seg.bbox[2]); x++) out[y * w + x] = 1;
  }
  return out;
}

/* ---------------- per-view evaluation ---------------- */
function evaluateView(view, analyze, config, opts) {
  const { w, h } = view, n = w * h;
  const analysisOpts = { cellSize: view.cellMetres, cellMetres: view.cellMetres, config };
  if (opts.candidateThreshold != null) analysisOpts.candidateThreshold = opts.candidateThreshold;
  else if (config && config.candidateThreshold != null) analysisOpts.candidateThreshold = config.candidateThreshold;
  const t0 = Date.now();
  const result = analyze(view.grid, w, h, analysisOpts) || {};
  const seconds = +((Date.now() - t0) / 1000).toFixed(2);
  const segments = Array.isArray(result.segments) ? result.segments : [];
  const isFlagVerdict = (s) => s && (s.verdict === "likely" || s.verdict === "possible");
  const eligible = [], likelyEligible = [];
  for (const seg of segments) {
    if (!isFlagVerdict(seg)) continue;
    if (segmentAreaM2(seg, view.cellMetres) < MIN_SEGMENT_AREA_M2) continue;
    eligible.push(seg); if (seg.verdict === "likely") likelyEligible.push(seg);
  }
  const countTouch = (list) => list.reduce((a, s) => a + (segmentTouches(s, view) ? 1 : 0), 0);
  const eligibleTouching = countTouch(eligible), eligibleLikelyTouching = countTouch(likelyEligible);
  const flaggedMask = buildFlaggedMask(result, eligible, view);
  let flaggedPixels = 0; for (let i = 0; i < n; i++) if (flaggedMask[i]) flaggedPixels++;

  const row = {
    site: view.site, region: view.region, split: view.split, class: view.class, type: view.type,
    viewKm: view.viewKm, offset: view.offset, w, h, cellMetres: view.cellMetres,
    uncertaintyM: view.uncertaintyM != null ? view.uncertaintyM : 12,
    segmentsTotal: segments.length,
    segmentsLikely: segments.filter((s) => s && s.verdict === "likely").length,
    segmentsPossible: segments.filter((s) => s && s.verdict === "possible").length,
    segmentsUnsupported: segments.filter((s) => s && s.verdict === "unsupported").length,
    eligibleSegments: eligible.length, // likely+possible, >= 5,000 m2
    eligibleLikely: likelyEligible.length,
    eligibleTouching, eligibleLikelyTouching,
    objectPrecision: eligible.length ? eligibleTouching / eligible.length : null,
    likelyPrecision: likelyEligible.length ? eligibleLikelyTouching / likelyEligible.length : null,
    flaggedPixels, flaggedAreaFraction: n ? flaggedPixels / n : null,
    flaggedSegmentsPerView: eligible.length, // per-view count; averaged in summaries
    skeletonPixels: null, skeletonHits: null, objectRecall: null,
    baselinePixelFAR: null, seconds,
  };

  if (view.class === "positive") {
    const skel = skeletonize(view.pos, w, h);
    const tol = Math.max(0, Math.round(((view.uncertaintyM || 12)) / view.cellMetres));
    let total = 0, hits = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!skel[y * w + x]) continue;
      total++;
      let ok = false;
      outer: for (let dy = -tol; dy <= tol && !ok; dy++) for (let dx = -tol; dx <= tol; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && flaggedMask[ny * w + nx]) { ok = true; break outer; }
      }
      if (ok) hits++;
    }
    row.skeletonPixels = total; row.skeletonHits = hits;
    row.objectRecall = total ? hits / total : null;
  }
  if (!opts.skipBaseline && view.class !== "positive") {
    // Current screen (evaluate.js defaults = mode A weights) pixel FAR @ 0.58.
    row.baselinePixelFAR = viewFAR(scoreView(view, opts._pixelParams), view, BASELINE_THRESHOLD);
  }
  return { row, metadata: result.metadata || null };
}

/* ---------------- split summary ---------------- */
function summarize(rows) {
  const sum = (list, k) => list.reduce((a, r) => a + (r[k] || 0), 0);
  const positives = rows.filter((r) => r.class === "positive");
  const confusers = rows.filter((r) => r.class !== "positive");
  const elig = sum(rows, "eligibleSegments"), eligTP = sum(rows, "eligibleTouching");
  const lik = sum(rows, "eligibleLikely"), likTP = sum(rows, "eligibleLikelyTouching");
  const skel = sum(positives, "skeletonPixels"), skelHit = sum(positives, "skeletonHits");
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
    confuserByType[type] = {
      views: list.length,
      flaggedSegmentsTotal: sum(list, "eligibleSegments"),
      flaggedSegmentsPerView: +(sum(list, "eligibleSegments") / list.length).toFixed(3),
      flaggedAreaFraction: +areaMean.toFixed(5),
      flaggedAreaFractionPooled: +(sum(list, "flaggedPixels") /
        Math.max(1, list.reduce((a, r) => a + r.w * r.h, 0))).toFixed(5),
      baselinePixelFAR: baseMean != null ? +baseMean.toFixed(5) : null,
      belowBaseline: baseMean != null ? areaMean < baseMean : null,
    };
  }
  const likelyPrecision = lik ? likTP / lik : null;
  const objectRecall = skel ? skelHit / skel : null;
  const confuserTypesBelowBaseline = Object.values(confuserByType)
    .every((t) => t.belowBaseline !== false); // null (no baseline) does not fail the bar
  return {
    views: rows.length, positiveViews: positives.length, confuserViews: confusers.length,
    eligibleSegments: elig, eligibleLikely: lik,
    objectPrecision: elig ? +(eligTP / elig).toFixed(4) : null, // likely+possible pooled
    likelyPrecision: likelyPrecision != null ? +likelyPrecision.toFixed(4) : null,
    objectRecall: objectRecall != null ? +objectRecall.toFixed(4) : null, // likely+possible, pooled
    skeletonPixels: skel, skeletonHits: skelHit,
    confuserByType,
    successBar: {
      bar: { likelyPrecisionMin: SUCCESS_BAR.likelyPrecisionMin, objectRecallMin: SUCCESS_BAR.objectRecallMin,
        confuserFlaggedArea: "below current screen pixel FAR at 0.58, per confuser type" },
      likelyPrecision: likelyPrecision != null ? +likelyPrecision.toFixed(4) : null,
      likelyPrecisionPass: likelyPrecision != null ? likelyPrecision >= SUCCESS_BAR.likelyPrecisionMin : null,
      objectRecall: objectRecall != null ? +objectRecall.toFixed(4) : null,
      objectRecallPass: objectRecall != null ? objectRecall >= SUCCESS_BAR.objectRecallMin : null,
      confuserFlaggedAreaPass: confuserTypesBelowBaseline,
      pass: (likelyPrecision != null && likelyPrecision >= SUCCESS_BAR.likelyPrecisionMin) &&
        (objectRecall != null && objectRecall >= SUCCESS_BAR.objectRecallMin) && confuserTypesBelowBaseline,
    },
  };
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
  const candidateThreshold = opt("--candidate-threshold", null);
  const limit = opt("--limit", null);
  const outFile = opt("--out", DEFAULT_OUT);
  const analysisPath = path.resolve(opt("--analysis", DEFAULT_ANALYSIS));

  let analyze;
  try { analyze = resolveAnalyze(analysisPath); }
  catch (e) { console.error(`error: ${e.message}`); process.exit(1); }

  let views = loadViews(split);
  if (limit != null) views = views.slice(0, Math.max(0, parseInt(limit, 10) || 0));
  const cliOpts = {
    candidateThreshold: candidateThreshold != null ? Number(candidateThreshold) : null,
    skipBaseline: has("--skip-baseline"),
    _pixelParams: parsePixelParams([]), // evaluate.js defaults: current screen
  };
  const rows = []; let metadataSample = null;
  const t0 = Date.now();
  for (const view of views) {
    const { row, metadata } = evaluateView(view, analyze, config, cliOpts);
    if (!metadataSample && metadata) metadataSample = metadata;
    rows.push(row);
  }
  const summary = summarize(rows);
  const payload = {
    tool: "evaluate-objects", created: new Date().toISOString(), split, config,
    analysisPath, minSegmentAreaM2: MIN_SEGMENT_AREA_M2, baselineThreshold: BASELINE_THRESHOLD,
    analysisMetadataSample: metadataSample,
    seconds: +((Date.now() - t0) / 1000).toFixed(1),
    summaries: { [split]: summary }, rows,
  };
  // Merge into an existing results file so train and validation accumulate.
  if (outFile === DEFAULT_OUT && fs.existsSync(outFile)) {
    try {
      const prev = JSON.parse(fs.readFileSync(outFile, "utf8"));
      if (prev && prev.summaries && Array.isArray(prev.rows)) {
        payload.summaries = { ...prev.summaries, [split]: summary };
        payload.rows = [...prev.rows.filter((r) => r.split !== split), ...rows];
      }
    } catch { /* unreadable previous results: overwrite with this split only */ }
  }
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(payload, null, 1));

  const bar = summary.successBar;
  const fmt = (v) => (v == null ? "n/a" : Number(v).toFixed(3));
  const yn = (v) => (v == null ? "n/a" : v ? "PASS" : "FAIL");
  console.log(`split=${split} views=${summary.views} (positive ${summary.positiveViews}, confuser ${summary.confuserViews})`);
  console.log(`objectPrecision(likely+possible)=${fmt(summary.objectPrecision)}  ` +
    `likelyPrecision=${fmt(summary.likelyPrecision)}  objectRecall=${fmt(summary.objectRecall)}`);
  console.log(`success bar: likelyPrecision>=${SUCCESS_BAR.likelyPrecisionMin} [${yn(bar.likelyPrecisionPass)}]  ` +
    `recall>=${SUCCESS_BAR.objectRecallMin} [${yn(bar.objectRecallPass)}]  ` +
    `confuser flagged area < pixel FAR@${BASELINE_THRESHOLD} [${yn(bar.confuserFlaggedAreaPass)}]  => ${bar.pass ? "PASS" : "FAIL"}`);
  for (const [type, t] of Object.entries(summary.confuserByType))
    console.log(`  confuser ${type}: ${t.flaggedSegmentsPerView}/view, flaggedArea=${fmt(t.flaggedAreaFraction)} vs baseline FAR=${fmt(t.baselinePixelFAR)} [${yn(t.belowBaseline)}]`);
  console.log(`wrote ${outFile}`);
}
if (require.main === module) main();
module.exports = { segmentAreaM2, segmentPixelIndices, segmentTouches, buildFlaggedMask, evaluateView, summarize, parseConfig, resolveAnalyze, SUCCESS_BAR, MIN_SEGMENT_AREA_M2 };
