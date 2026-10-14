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

// ---------------------------------------------------------------------------
// Belt/zone objects (v3): zone core + zone features + belt classifier composed
// manually, zone-core units on hand-built masks, then end-to-end through the
// analysis once it publishes belt objects.
// ---------------------------------------------------------------------------

const Z = require("./glacial-zone-core.js");
const ZF = require("./glacial-zone-features.js");
const B = require("./glacial-belt-classifier.js");

// Deterministic LCG so the synthetic hummock fields are reproducible.
function lcg(seed) {
  let state = seed >>> 0;
  return () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296;
}

// 5. Hummocky belt: 70 bumps (2-5 m high, sigma 7.5-15 m, so roughly 15-45 m
// across) scattered at >= 35 m spacing through a broad arc band (the arcuate
// ridge's arc, +-110 m wide, +-0.5 rad) on a 1% plane, with no continuous
// crest. Eight closed pits (3 m deep, sigma 10 m) alternate 45 m either side
// of the band centreline, each ringed by a 2 m rim 25 m out, as in rim-ridge
// hummocks; bumps keep 50 m clear of them. The rims matter: a pit sitting in
// the inter-hummock lowland has its negative-TPI blob grow into the connected
// lows, so the kettle detector's spill-rim proxy (correctly) does not close it.
const BELT = { cx: -40, cy: 100, radius: 150, halfWidth: 22, halfAngle: 0.5, pits: 8, bumps: 70 };
const beltPits = Array.from({ length: BELT.pits }, (_, k) => {
  const a = ((k + 0.5) / BELT.pits * 2 - 1) * BELT.halfAngle * 0.9, d = (k % 2 ? 1 : -1) * 9;
  return { x: BELT.cx + (BELT.radius + d) * Math.cos(a), y: BELT.cy + (BELT.radius + d) * Math.sin(a) };
});
const beltBumps = [];
for (let n = 0, next = lcg(12345); beltBumps.length < BELT.bumps && n < 5000; n++) {
  const a = (next() * 2 - 1) * BELT.halfAngle, d = (next() * 2 - 1) * BELT.halfWidth;
  const x = BELT.cx + (BELT.radius + d) * Math.cos(a), y = BELT.cy + (BELT.radius + d) * Math.sin(a);
  if (beltBumps.some(b => Math.hypot(b.x - x, b.y - y) < 7) || beltPits.some(p => Math.hypot(p.x - x, p.y - y) < 10)) continue;
  beltBumps.push({ x, y, height: 2 + 3 * next(), sigma: 1.5 + 1.5 * next() });
}
const hummockyBelt = raster((x, y) => {
  let z = 100 + 0.01 * x;
  for (const b of beltBumps) z += b.height * gauss(Math.hypot(x - b.x, y - b.y), b.sigma);
  for (const p of beltPits) {
    const d = Math.hypot(x - p.x, y - p.y);
    z += 2 * gauss(d - 5, 1.8) - 3 * gauss(d, 2);
  }
  return z;
});

// 6. Smooth broad hill: one Gaussian dome, 30 m high, sigma 175 m, on a 1% plane.
const smoothHill = raster((x, y) => 100 + 0.01 * x + 30 * gauss(Math.hypot(x - 100, y - 100), 35));

// 7. Chaotic coarse landslide-like deposit: 40 flat-topped, randomly rotated
// square blocks (40-90 m across, 6-18 m tall, logistic edges ~3.5 m) packed
// without overlap inside a 4 m lobe on a 3% slope. Blocks combine by max, so
// the deposit has no closed pits of its own.
const slideBlocks = [];
for (let n = 0, next = lcg(7); slideBlocks.length < 40 && n < 5000; n++) {
  const x = 40 + 120 * next(), y = 40 + 120 * next();
  if (Math.hypot((x - 100) / 60, (y - 100) / 55) > 1) continue;
  const half = 4 + 5 * next();
  if (slideBlocks.some(b => Math.hypot(b.x - x, b.y - y) < 0.9 * (b.half + half))) continue;
  slideBlocks.push({ x, y, half, height: 6 + 12 * next(), turn: next() * Math.PI / 2 });
}
const landslide = raster((x, y) => {
  let top = 0;
  for (const b of slideBlocks) {
    const c = Math.cos(b.turn), s = Math.sin(b.turn);
    const u = Math.abs((x - b.x) * c + (y - b.y) * s), v = Math.abs(-(x - b.x) * s + (y - b.y) * c);
    top = Math.max(top, b.height / (1 + Math.exp((Math.max(u, v) - b.half) / 0.7)));
  }
  const lobe = 1 / (1 + Math.exp((Math.hypot((x - 100) / 65, (y - 100) / 60) - 1) / 0.05));
  return 100 - 0.03 * x + 4 * lobe + top;
});

// Manual composition mirroring the v3 analysis: the analysis's candidate mask
// (stage-1 score >= 0.45 AND TPI > 0), the ridge path on it with a shared view
// context, then zones from the same mask. ridgeSupport counts likely/possible
// ridge segments whose centroid falls in the closed zone, as the analysis does.
function composedBelt(grid) {
  const stage1 = G.scoreGlacialLobeMarginCandidates(grid, W, H, {
    cellSize: CELL, horizontalUnit: "m", verticalUnit: "m", rowAxis: "south", edgePolicy: "shrink"
  });
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < mask.length; i++) {
    mask[i] = Number.isFinite(stage1.score[i]) && stage1.score[i] >= 0.45 && stage1.evidence.terrainPosition[i] > 0 ? 1 : 0;
  }
  const context = F.createViewContext(grid, W, H, { cellMetres: CELL });
  const ridgeEntries = S.extractSegments(mask, W, H, { cellMetres: CELL })
    .map(segment => ({ segment, features: F.segmentFeatures(grid, W, H, segment, { cellMetres: CELL, context }) }));
  const ridgeVerdicts = C.classifySegments(ridgeEntries);
  const ridges = ridgeEntries.map((entry, i) => Object.assign({}, entry, { result: ridgeVerdicts[i] }));
  const zones = Z.extractZones(mask, W, H, { cellMetres: CELL }).map(zone => {
    const members = new Set(zone.zonePixels);
    const ridgeSupport = ridges.filter(({ segment: s, result: r }) =>
      (r.verdict === "likely" || r.verdict === "possible") &&
      members.has(Math.round(s.centroid[1]) * W + Math.round(s.centroid[0]))).length;
    const features = Object.assign(ZF.zoneFeatures(grid, W, H, zone, { cellMetres: CELL, context, stageScore: stage1.score }), { ridgeSupport });
    return { zone, features };
  });
  const beltVerdicts = B.classifyZones(zones);
  return { ridges, zones: zones.map((entry, i) => Object.assign({}, entry, { result: beltVerdicts[i] })) };
}

function describeZone({ zone: z, features: f, result: r }) {
  return `zone#${z.id} ${r.verdict} score=${fixed(r.score)} area=${fixed(z.areaM2, 0)}m2 elong=${fixed(z.elongation)} ` +
    `solidity=${fixed(z.solidity)} hummocks=${fixed(f.hummockDensityPerKm2, 1)}/km2 kettles=${fixed(f.kettleDensityPerKm2, 1)}/km2 ` +
    `texture=${fixed(f.textureScore)} raised=${fixed(f.raisedFraction)} stage=${fixed(f.meanStageScore)} ` +
    `rough=${fixed(f.roughness)}m relief=${fixed(f.reliefM)}m ridgeSupport=${f.ridgeSupport}` +
    (r.hardRejects.length ? ` rejects=${r.hardRejects.join(",")}` : "");
}
const zoneSummary = zones => zones.length ? zones.map(describeZone).join("\n") : "(no zones)";
const ridgeVerdictList = ridges => ridges.map(row => row.result.verdict).join(",") || "none";

const belts = {};
check("belt composed: hummocky arc band yields a likely belt zone; the ridge path alone does not", () => {
  const { ridges, zones } = belts.hummocky = composedBelt(hummockyBelt);
  const likely = zones.filter(row => row.result.verdict === "likely");
  assert(likely.length >= 1, `expected >= 1 likely belt zone:\n${zoneSummary(zones)}`);
  const belt = likely[0];
  assert.equal(belt.zone.objectType, "belt");
  // The likely zone is the band itself: it spans the band's y extent and owes
  // its verdict to texture (hummocks and closed pits), not to a crest.
  assert(belt.zone.bbox[1] < 60 && belt.zone.bbox[3] > 140, `zone should span the arc band: ${describeZone(belt)}`);
  assert(belt.features.hummockDensityPerKm2 >= B.DEFAULT_CONFIG.minHummockDensityPerKm2, describeZone(belt));
  assert(belt.features.kettleDensityPerKm2 >= B.DEFAULT_CONFIG.minKettleDensityPerKm2, describeZone(belt));
  assert(belt.features.textureScore >= B.DEFAULT_CONFIG.minTextureScore, describeZone(belt));
  assert.equal(ridges.filter(row => row.result.verdict === "likely").length, 0,
    `ridge path should find no likely segment: ${summary(ridges)}`);
  console.log(`  measured: ${describeZone(belt)}; ridge verdicts ${ridgeVerdictList(ridges)}`);
});

check("belt composed: smooth broad hill yields no likely belt zone", () => {
  const { ridges, zones } = belts.hill = composedBelt(smoothHill);
  assert.equal(zones.filter(row => row.result.verdict === "likely").length, 0, zoneSummary(zones));
  console.log(`  measured: ${zones.length} zone(s): ${zoneSummary(zones)}; ridge verdicts ${ridgeVerdictList(ridges)}`);
});

check("belt composed: chaotic pit-free landslide blocks yield no likely belt zone", () => {
  const { ridges, zones } = belts.landslide = composedBelt(landslide);
  assert(zones.length >= 1, "the block field should still form a candidate zone");
  for (const row of zones) assert.equal(row.features.kettleDensityPerKm2, 0, `terrain premise: no pits; ${describeZone(row)}`);
  assert.equal(zones.filter(row => row.result.verdict === "likely").length, 0, zoneSummary(zones));
  console.log(`  measured: ${zones.length} zone(s): ${zoneSummary(zones)}; ridge verdicts ${ridgeVerdictList(ridges)}`);
});

// Zone-core units. Clusters are 4 x 4 grids of radius-3-cell disks at 9-cell
// pitch (15 m gaps inside a cluster), each cluster's closed area above the
// 20,000 m2 default on its own. The lone cluster is three radius-2 disks.
const disksMask = centres => maskOf((x, y) => centres.some(([cx, cy, r]) => Math.hypot(x - cx, y - cy) <= r));
const cluster = (x0, y0, n = 4, pitch = 9, r = 3) =>
  Array.from({ length: n * n }, (_, k) => [x0 + (k % n) * pitch, y0 + Math.floor(k / n) * pitch, r]);
const loneCluster = [[100, 100, 2], [106, 100, 2], [103, 105, 2]];
const nearPair = disksMask([...cluster(10, 20), ...cluster(10 + 27 + 6 + 10, 20)]); // 10-cell (50 m) edge gap
const farPair = disksMask([...cluster(10, 20), ...cluster(10 + 27 + 6 + 40, 20)]);  // 40-cell (200 m) edge gap
const withLone = disksMask([...cluster(10, 20), ...cluster(10 + 27 + 6 + 10, 20), ...loneCluster]);

check("zone core: two nearby hummock clusters merge into one zone at default closing", () => {
  const zones = Z.extractZones(nearPair, MW, MH, { cellMetres: CELL });
  assert.equal(zones.length, 1, `got ${zones.length} zones`);
  const [zone] = zones;
  const originalCount = nearPair.reduce((sum, v) => sum + v, 0);
  assert.equal(zone.objectType, "belt");
  assert.equal(zone.id, 1);
  assert.equal(zone.pixelCount, originalCount, "pixels are the original candidate cells inside the zone");
  assert(zone.pixels.every(p => nearPair[p] === 1), "zone.pixels must be original mask cells");
  assert(zone.zonePixelCount > 2 * originalCount, `closing should fill the gaps: ${zone.zonePixelCount} vs ${originalCount}`);
  assert.equal(zone.areaM2, zone.zonePixelCount * CELL * CELL, "area comes from the closed footprint");
  assert(zone.bbox[0] <= 7 && zone.bbox[2] >= 53 + 27 + 3, `zone should span both clusters: bbox ${zone.bbox}`);
  assert(zone.elongation > 1.5, `two side-by-side clusters read as elongated: ${zone.elongation}`);
  // Without closing the same mask is 32 separate disks, so the merge is the closing's doing.
  assert.equal(Z.extractZones(nearPair, MW, MH, { cellMetres: CELL, closeRadiusM: 0, minAreaM2: 0 }).length, 32);
  // 200 m apart is beyond what a 60 m closing can bridge: two zones.
  const far = Z.extractZones(farPair, MW, MH, { cellMetres: CELL });
  assert.equal(far.length, 2, `far clusters should stay separate, got ${far.length}`);
  console.log(`  measured: merged zone ${fixed(zone.areaM2, 0)} m2 from ${originalCount} candidate cells, ` +
    `elong=${fixed(zone.elongation)} solidity=${fixed(zone.solidity)}; far pair areas ${far.map(z => z.areaM2).join(", ")} m2`);
});

check("zone core: a lone small hummock cluster is dropped by min area", () => {
  const zones = Z.extractZones(withLone, MW, MH, { cellMetres: CELL });
  assert.equal(zones.length, 1, `lone cluster should be dropped, got ${zones.length} zones`);
  assert(zones[0].bbox[2] < 95, "the surviving zone is the merged pair, not the lone cluster");
  const kept = Z.extractZones(withLone, MW, MH, { cellMetres: CELL, minAreaM2: 0 });
  assert.equal(kept.length, 2);
  const lone = kept[1];
  assert(lone.bbox[0] >= 95 && lone.areaM2 < Z.DEFAULT_OPTIONS.minAreaM2, `lone cluster ${lone.areaM2} m2 at ${lone.bbox}`);
  assert.equal(lone.pixelCount, disksMask(loneCluster).reduce((sum, v) => sum + v, 0));
  // Raising the floor just above the lone zone's area keeps exactly the pair.
  assert.equal(Z.extractZones(withLone, MW, MH, { cellMetres: CELL, minAreaM2: lone.areaM2 + 1 }).length, 1);
  assert.equal(Z.extractZones(withLone, MW, MH, { cellMetres: CELL, minAreaM2: lone.areaM2 }).length, 2);
  assert.deepEqual(Z.extractZones(new Uint8Array(MW * MH), MW, MH, { cellMetres: CELL }), []);
  assert.throws(() => Z.extractZones(withLone, MW, MH, {}), /cellMetres/);
  console.log(`  measured: lone cluster closes to ${lone.areaM2} m2 (${lone.pixelCount} candidate cells) < ${Z.DEFAULT_OPTIONS.minAreaM2} m2`);
});

// End to end: belt objects through analyzeMoraineCandidates. Pending until
// the analysis publishes them (metadata.belt or objectType on segments).
const BELT_ID_OFFSET = 100000;
const BELT_ANALYSIS_CASES = [
  ["belt analysis: hummocky belt yields a likely belt object; belt:false removes it", hummockyBelt, true],
  ["belt analysis: smooth broad hill yields no likely belt object", smoothHill, false],
  ["belt analysis: landslide blocks yield no likely belt object", landslide, false]
];
let beltIntegrated = false, beltProbe = null;
if (analyze) {
  try {
    beltProbe = analyze(hummockyBelt, W, H, { cellSize: CELL });
    beltIntegrated = beltProbe.metadata.belt !== undefined || beltProbe.segments.some(s => "objectType" in s);
  } catch (error) {
    check("belt analysis: hummocky belt runs end to end", () => { throw error; });
  }
}
if (!beltIntegrated) {
  const reason = analyze ? "belt objects not yet integrated in glacial-moraine-analysis.js" : "glacial-moraine-analysis.js not present";
  for (const [name] of BELT_ANALYSIS_CASES) {
    pending.push(name);
    console.log(`PENDING - ${name} (${reason})`);
  }
} else {
  const beltSegments = result => result.segments.filter(s => s.objectType === "belt");
  const brief = result => result.segments.map(s => `${s.objectType}#${s.id} ${s.verdict} ${fixed(s.score)}`).join("; ") || "no segments";
  for (const [name, grid, expectLikely] of BELT_ANALYSIS_CASES) {
    check(name, () => {
      const result = grid === hummockyBelt ? beltProbe : analyze(grid, W, H, { cellSize: CELL });
      for (const s of result.segments) {
        assert(s.objectType === "ridge" || s.objectType === "belt", `objectType ${s.objectType} on #${s.id}`);
        assert(s.objectType === "belt" ? s.id > BELT_ID_OFFSET : s.id < BELT_ID_OFFSET, `id scheme: ${s.objectType}#${s.id}`);
        assert(Array.isArray(s.evidence) && s.evidence.length > 0, "verdicts must carry evidence");
      }
      const likelyBelts = beltSegments(result).filter(s => s.verdict === "likely");
      if (!expectLikely) {
        assert.equal(likelyBelts.length, 0, brief(result));
        console.log(`  measured: ${brief(result)}`);
        return;
      }
      assert(likelyBelts.length >= 1, `expected a likely belt object: ${brief(result)}`);
      assert(result.metadata.belt && result.metadata.belt.likely >= 1, `metadata.belt ${JSON.stringify(result.metadata.belt)}`);
      const beltIds = new Set(likelyBelts.map(s => s.id));
      let painted = 0;
      for (let i = 0; i < W * H; i++) {
        if (!beltIds.has(result.segmentRaster[i])) continue;
        painted++;
        assert.equal(result.score[i], 1, "likely belt pixels carry the likely raster value");
        assert.equal(result.mask[i], 1, "likely belt pixels are in the mask");
      }
      assert(painted > 0, "segmentRaster should carry the likely belt id");
      // The ridge path on this terrain finds no likely object, so disabling
      // the belt path removes every belt object and every likely verdict.
      const ridgeOnly = analyze(grid, W, H, { cellSize: CELL, belt: false });
      assert.equal(beltSegments(ridgeOnly).length, 0, `belt:false still has belts: ${brief(ridgeOnly)}`);
      assert(!Array.from(ridgeOnly.segmentRaster).some(id => id > BELT_ID_OFFSET), "belt:false raster carries belt ids");
      assert.equal(ridgeOnly.segments.filter(s => s.verdict === "likely").length, 0, brief(ridgeOnly));
      console.log(`  measured: ${brief(result)}; belt:false -> ${brief(ridgeOnly)}`);
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
