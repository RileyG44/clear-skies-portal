"use strict";

// Object-level moraine screen (v2) on synthetic DEMs built from elevation
// functions. Module-level cases compose segment core + features + classifier
// by hand; analysis-level cases run glacial-moraine-analysis.js end to end and
// are reported as pending if that module is not present yet.

const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const G = require("./glacial-research-core.js");
const S = require("./glacial-segment-core.js");
const F = require("./glacial-segment-features.js");
const C = require("./glacial-moraine-classifier.js");

const W = 200, H = 200, CELL = 5;
const failures = [], pending = [];
let passed = 0;

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`FAIL - ${name}\n  ${String(error && error.message || error).split("\n").join("\n  ")}`);
  }
}

function raster(fn) {
  const grid = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) grid[y * W + x] = fn(x, y);
  return grid;
}

const gauss = (d, sigma) => Math.exp(-0.5 * (d / sigma) * (d / sigma));

// 1. Arcuate end-moraine-like ridge across a shallow valley. The valley drains
// east (+x, 0.5% grade) with a gently concave cross-profile rising 10 m to the
// view edges. The ridge is an arc of radius 150 cells (750 m) centred west of
// the view, so it crosses the valley axis convex down-valley, spans ~52-60
// degrees of bend, and fades out before the view edges. Crest 8 m, steeper
// ice-proximal flank (sigma 15 m) than distal flank (sigma 25 m). Four small
// closed depressions (2 m deep, ~12 m sigma) sit 70 m proximal of the crest.
const ARC = { cx: -40, cy: 100, radius: 150, height: 8, proximalSigma: 3, distalSigma: 5, halfAngle: 0.45 };
const KETTLE_ANGLES = [-0.3, -0.1, 0.1, 0.3];
const arcuateRidge = raster((x, y) => {
  const valley = 100 + 10 * Math.pow((y - 100) / 100, 2) + 0.01 * x;
  const d = Math.hypot(x - ARC.cx, y - ARC.cy) - ARC.radius;
  const angle = Math.atan2(y - ARC.cy, x - ARC.cx);
  const taper = gauss(Math.max(0, Math.abs(angle) - ARC.halfAngle), 0.08);
  const ridge = ARC.height * taper * gauss(d, d < 0 ? ARC.proximalSigma : ARC.distalSigma);
  let kettles = 0;
  for (const t of KETTLE_ANGLES) {
    const kx = ARC.cx + (ARC.radius - 14) * Math.cos(t), ky = ARC.cy + (ARC.radius - 14) * Math.sin(t);
    kettles += 2 * gauss(Math.hypot(x - kx, y - ky), 2.5);
  }
  return valley + ridge - kettles;
});

// 2. Straight one-sided fault step: a regional plane uplifted 8 m across a
// straight diagonal fault trace (logistic scarp ~15 m wide). No arc, no pits.
const faultStep = raster((x, y) => 100 + 0.01 * x + 8 / (1 + Math.exp(-(x - 0.5 * y - 50) / 3)));

// 3. Smooth rolling hills: broad sine hills, 15 m amplitude, 350 x 425 m period.
const rollingHills = raster((x, y) =>
  100 + 15 * Math.sin(2 * Math.PI * x / 70) * Math.sin(2 * Math.PI * y / 85));

// 4. Transverse dune field: periodic parallel ridges 110 m apart, 5 m high,
// long gentle stoss and short steep lee face, crestlines gently sinuous, on a
// slight regional slope.
const duneField = raster((x, y) => {
  const phase = (((x + 6 * Math.sin(y / 25)) % 22) + 22) % 22;
  return 100 + 0.005 * y + (phase < 16 ? 5 * phase / 16 : 5 * (22 - phase) / 6);
});

// Manual composition mirroring the design pipeline: stage 1 is the current
// glacial-margin screen (mode A, default weights/radius) at >= 0.45.
function composedPipeline(grid) {
  const stage1 = G.scoreGlacialLobeMarginCandidates(grid, W, H, {
    cellSize: CELL, horizontalUnit: "m", verticalUnit: "m", rowAxis: "south", edgePolicy: "shrink"
  });
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < mask.length; i++) mask[i] = Number.isFinite(stage1.score[i]) && stage1.score[i] >= 0.45 ? 1 : 0;
  const segments = S.extractSegments(mask, W, H, { cellMetres: CELL });
  const entries = segments.map(segment => ({ segment, features: F.segmentFeatures(grid, W, H, segment, { cellMetres: CELL }) }));
  const verdicts = C.classifySegments(entries);
  return entries.map((entry, i) => Object.assign({}, entry, { result: verdicts[i] }));
}

const fixed = (value, digits = 2) => Number.isFinite(value) ? value.toFixed(digits) : String(value);
function describe({ segment: s, features: f, result: r }) {
  return `#${s.id} ${r.verdict} score=${fixed(r.score)} L=${fixed(s.lengthM, 0)}m width=${fixed(s.meanWidthM, 0)}m ` +
    `elong=${fixed(s.elongation, 1)} arc=${fixed(s.arcScore)} bend=${fixed(s.netBendRad * 180 / Math.PI, 0)}deg ` +
    `prom=${fixed(f.prominenceM)}m asym=${fixed(f.profileAsymmetry)} kettles=${f.kettleCount} ` +
    `apron=${fixed(f.apronFlatFraction)} valley=${fixed(f.valleyCrossingScore)}` +
    (r.hardRejects.length ? ` rejects=${r.hardRejects.join(",")}` : "");
}
const longest = rows => rows.reduce((a, b) => (b.segment.lengthM > a.segment.lengthM ? b : a), rows[0]);
const summary = rows => rows.length ? rows.slice().sort((a, b) => b.result.score - a.result.score || b.segment.lengthM - a.segment.lengthM)
  .slice(0, 4).map(describe).join("\n") : "(no segments)";

// ---------------------------------------------------------------------------
// Module-level cases: segment core + features + classifier composed manually.
// ---------------------------------------------------------------------------

const composed = {};
check("composed: arcuate ridge across a shallow valley yields a likely segment", () => {
  const rows = composed.arc = composedPipeline(arcuateRidge);
  const likely = rows.filter(row => row.result.verdict === "likely");
  assert(likely.length >= 1, `expected >= 1 likely segment, got none:\n${summary(rows)}`);
  // The likely object is the ridge itself: long, arcuate, prominent, and it
  // crosses the valley axis (y = 100) rather than following it.
  const ridge = likely[0];
  assert(ridge.segment.lengthM > 600, describe(ridge));
  assert(ridge.segment.bbox[1] < 100 && ridge.segment.bbox[3] > 100, `likely segment should span the valley axis: ${describe(ridge)}`);
  assert(ridge.features.prominenceM >= C.DEFAULT_CONFIG.strongProminenceM, describe(ridge));
  assert(ridge.segment.arcScore >= C.DEFAULT_CONFIG.highArcScore, describe(ridge));
  console.log(`  measured: ${describe(ridge)}`);
});

check("composed: straight one-sided fault step reaches no likely segment", () => {
  const rows = composed.step = composedPipeline(faultStep);
  assert(rows.length >= 1, "stage 1 should still propose the scarp as a candidate");
  assert.equal(rows.filter(row => row.result.verdict === "likely").length, 0, summary(rows));
  console.log(`  measured: ${describe(longest(rows))}`);
});

check("composed: smooth rolling hills yield no likely segment", () => {
  const rows = composed.hills = composedPipeline(rollingHills);
  assert.equal(rows.filter(row => row.result.verdict === "likely").length, 0, summary(rows));
  console.log(`  measured: ${rows.length} segments; top ${rows.length ? describe(longest(rows)) : "-"}`);
});

check("composed: periodic parallel dune ridges yield no likely segment", () => {
  const rows = composed.dunes = composedPipeline(duneField);
  assert(rows.length >= 2, "stage 1 should propose several dune crests");
  assert.equal(rows.filter(row => row.result.verdict === "likely").length, 0, summary(rows));
  console.log(`  measured: ${rows.length} segments; top ${describe(longest(rows))}`);
});

// ---------------------------------------------------------------------------
// Segment-core units on hand-built masks.
// ---------------------------------------------------------------------------

const MW = 120, MH = 120;
function maskOf(fn) {
  const mask = new Uint8Array(MW * MH);
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) mask[y * MW + x] = fn(x, y) ? 1 : 0;
  return mask;
}
const barMask = maskOf((x, y) => x >= 20 && x < 80 && y >= 10 && y < 16);          // 6 x 60 cells
const cArcMask = maskOf((x, y) => {                                              // 6-cell-wide, 120-degree arc, r ~ 200 m
  const r = Math.hypot(x - 60, y - 70), a = Math.atan2(y - 70, x - 60);
  return r >= 37 && r < 43 && a < -Math.PI / 6 && a > -5 * Math.PI / 6;
});
const ringMask = maskOf((x, y) => { const r = Math.hypot(x - 60, y - 60); return r >= 30 && r < 36; });
const smallMask = maskOf((x, y) => x >= 100 && x < 110 && y >= 100 && y < 110); // 100 cells = 2,500 m2

check("segment core: skeletonize thins a bar to a one-cell centreline inside the mask", () => {
  const skeleton = S.skeletonize(barMask, MW, MH);
  let count = 0;
  for (let i = 0; i < skeleton.length; i++) {
    if (!skeleton[i]) continue;
    count++;
    assert.equal(barMask[i], 1, "skeleton pixels must lie inside the mask");
    const y = Math.floor(i / MW);
    assert(y >= 12 && y <= 13, `bar skeleton should run along the centre rows, found row ${y}`);
  }
  assert(count >= 40 && count <= 60, `bar skeleton length ${count} cells`);
});

check("segment core: straight bar is elongated (> 3) and scores below the C-arc", () => {
  const [bar] = S.extractSegments(barMask, MW, MH, { cellMetres: CELL });
  const [arc] = S.extractSegments(cArcMask, MW, MH, { cellMetres: CELL });
  assert(bar.elongation > 3, `bar elongation ${bar.elongation}`);
  assert(Math.abs(bar.lengthM - 300) < 30, `bar length ${bar.lengthM} m should recover ~300 m`);
  assert(Math.abs(bar.meanWidthM - 30) < 5, `bar width ${bar.meanWidthM} m should recover ~30 m`);
  assert(bar.orientationRad < 0.05 || bar.orientationRad > Math.PI - 0.05, `bar runs along +x: ${bar.orientationRad}`);
  assert(arc.elongation > 3, `arc elongation ${arc.elongation}`);
  assert(bar.arcScore < arc.arcScore, `bar arcScore ${bar.arcScore} should be below C-arc ${arc.arcScore}`);
  assert(bar.arcScore <= C.DEFAULT_CONFIG.deadStraightArcScore, `bar arcScore ${bar.arcScore}`);
  assert(arc.arcScore >= C.DEFAULT_CONFIG.highArcScore, `C-arc arcScore ${arc.arcScore}`);
  assert.equal(arc.closedLoop, false);
  console.log(`  measured: bar elong=${fixed(bar.elongation)} arc=${fixed(bar.arcScore, 3)}; C-arc elong=${fixed(arc.elongation)} arc=${fixed(arc.arcScore, 3)} bend=${fixed(arc.netBendRad * 180 / Math.PI, 0)}deg`);
});

check("segment core: a closed ring is flagged and never reads as a margin arc", () => {
  const [ring] = S.extractSegments(ringMask, MW, MH, { cellMetres: CELL });
  assert.equal(ring.closedLoop, true);
  assert.equal(ring.arcScore, 0);
});

check("segment core: min-area filtering drops small blobs and ids follow area order", () => {
  const both = barMask.map((value, i) => value || smallMask[i]);
  let segments = S.extractSegments(both, MW, MH, { cellMetres: CELL });             // default 5,000 m2
  assert.deepEqual(segments.map(s => [s.id, s.pixelCount, s.areaM2]), [[1, 360, 9000]]);
  segments = S.extractSegments(both, MW, MH, { cellMetres: CELL, minAreaM2: 2000 });
  assert.deepEqual(segments.map(s => [s.id, s.pixelCount, s.areaM2]), [[1, 360, 9000], [2, 100, 2500]]);
  segments = S.extractSegments(both, MW, MH, { cellMetres: CELL, minAreaM2: 2501 });
  assert.deepEqual(segments.map(s => s.pixelCount), [360]);
  assert.deepEqual(S.extractSegments(new Uint8Array(MW * MH), MW, MH, { cellMetres: CELL }), []);
  assert.throws(() => S.extractSegments(both, MW, MH, {}), /cellMetres/);
});

// ---------------------------------------------------------------------------
// Analysis-level cases against the pinned analyzeMoraineCandidates API.
// ---------------------------------------------------------------------------

const ANALYSIS_PATH = path.join(__dirname, "glacial-moraine-analysis.js");
const ANALYSIS_CASES = [
  ["analysis: arcuate ridge yields a likely segment", arcuateRidge, true],
  ["analysis: fault step yields no likely segment", faultStep, false],
  ["analysis: rolling hills yield no likely segment", rollingHills, false],
  ["analysis: dune ridges yield no likely segment", duneField, false]
];

function loadAnalysis() {
  if (!fs.existsSync(ANALYSIS_PATH)) return null;
  const mod = require(ANALYSIS_PATH);
  if (mod && typeof mod.analyzeMoraineCandidates === "function") return mod.analyzeMoraineCandidates.bind(mod);
  if (typeof mod === "function") {
    const api = mod(G, S, F, C);
    if (api && typeof api.analyzeMoraineCandidates === "function") return api.analyzeMoraineCandidates.bind(api);
  }
  throw new Error("glacial-moraine-analysis.js exposes no analyzeMoraineCandidates");
}

let analyze = null;
try {
  analyze = loadAnalysis();
} catch (error) {
  check("analysis: module loads", () => { throw error; });
}

const SEGMENT_KEYS = ["id", "verdict", "score", "bbox", "centroid", "lengthM", "evidence"];
if (!analyze) {
  for (const [name] of ANALYSIS_CASES) pending.push(name);
  pending.forEach(name => console.log(`PENDING - ${name} (glacial-moraine-analysis.js not present)`));
} else {
  for (const [name, grid, expectLikely] of ANALYSIS_CASES) {
    check(name, () => {
      const result = analyze(grid, W, H, { cellSize: CELL });
      assert(result.score instanceof Float32Array && result.score.length === W * H, "score raster must be Float32Array(w*h)");
      assert.equal(result.mask.length, W * H);
      assert(Array.isArray(result.segments));
      assert.equal(result.metadata.screeningNotice.id, "glacial-moraine-object-screen-v2");
      assert.equal(result.metadata.screeningNotice.diagnostic, false);
      for (const segment of result.segments) {
        for (const key of SEGMENT_KEYS) assert(key in segment, `segment missing ${key}`);
        assert(["likely", "possible", "unsupported"].includes(segment.verdict), segment.verdict);
        assert(Array.isArray(segment.evidence) && segment.evidence.length > 0, "verdicts must carry evidence");
      }
      for (let i = 0; i < result.score.length; i++) {
        assert(result.score[i] >= 0 && result.score[i] <= 1, `score raster out of [0,1] at ${i}: ${result.score[i]}`);
        if (result.mask[i]) assert(result.score[i] >= 0.55, "mask pixels must carry a likely/possible raster value");
      }
      const ranked = result.segments.slice().sort((a, b) => b.score - a.score || b.lengthM - a.lengthM);
      const verdicts = ranked.slice(0, 4).map(s => `#${s.id} ${s.verdict} ${fixed(s.score)} L=${fixed(s.lengthM, 0)}m`).join("; ") +
        (ranked.length > 4 ? `; (${ranked.length - 4} more, ${result.segments.length} total)` : "");
      const likely = result.segments.filter(s => s.verdict === "likely");
      if (expectLikely) {
        assert(likely.length >= 1, `expected >= 1 likely segment; got ${verdicts || "no segments"}`);
        assert(result.score.some(value => value === 1), "likely segments should paint 1.0 into the verdict raster");
      } else {
        assert.equal(likely.length, 0, `expected no likely segment; got ${verdicts}`);
        assert(!result.score.some(value => value === 1), "no pixel should carry the likely raster value");
      }
      console.log(`  measured: ${verdicts || "no segments"}`);
    });
  }
}

const tail = pending.length ? `, ${pending.length} pending` : "";
if (failures.length) {
  console.log(`glacial moraine checks: ${passed} passed, ${failures.length} failed${tail}`);
  process.exitCode = 1;
} else {
  console.log(`glacial moraine checks passed (${passed} passed${tail})`);
}
