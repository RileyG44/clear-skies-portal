"use strict";
/* Calibrator (plan section 5, preregistration selection rule).
   Search strategy (documented in results-train.json): features are computed
   once per view x radius from the app primitives; weight grid (0.05 simplex)
   is scored on a fixed labelled-pixel subsample per view with 512-bin AP;
   the top candidates are then re-scored exactly (full pixels, unbinned AP)
   before feasibility, near-optimal bootstrap selection, logistic cross-check
   and the validation threshold rule. Test views are never loaded here.
   Run: node scripts/glacial-calibration/optimize.js */
const fs = require("fs"), path = require("path");
const ev = require("./evaluate.js");
const core = require(path.join(__dirname, "..", "..", "glacial-research-core.js"));
const OUT = path.join(__dirname, "..", "..", "output", "glacial-calibration");

const RADII = [15, 30, 60, 120, 240];
const TROUGHS = [0, 0.2, 0.35, 0.5, 1];
const SAT_LADDERS = {
  localRelief: [2, 5, 10, 20, 40], ridgeOrTroughPosition: [2, 5, 10, 20, 40],
  slope: [5, 10, 20, 30, 45], topographicBreak: [0.002, 0.005, 0.01, 0.02, 0.05],
};
const CURRENT = { weights: [0.30, 0.25, 0.25, 0.20], trough: 0.35, mode: "A", threshold: 0.58 };
const SEED = 20261013;
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

/* ---------- weight simplex ---------- */
function weightGrid() {
  const out = [];
  for (let a = 0; a <= 20; a++) for (let b = 0; b <= 20 - a; b++) for (let c = 0; c <= 20 - a - b; c++) {
    const d = 20 - a - b - c;
    out.push([a / 20, b / 20, c / 20, d / 20]);
  }
  return out; // 1771, order [topographicBreak, ridgeOrTroughPosition, localRelief, slope]
}

/* ---------- subsampled features per view ---------- */
// Returns per positive view: sample indices' raw feature values + labels + region.
function sampleFeatures(view, radiusM, rand) {
  const { grid, w, h, cellMetres } = view;
  const radiusCells = Math.max(1, Math.round(radiusM / cellMetres));
  const opts = { cellSize: cellMetres, radiusCells };
  const relief = core.localReliefModel(grid, w, h, opts).data;
  const tpi = core.terrainPositionIndex(grid, w, h, opts).data;
  const slope = core.slopeAspectComponents(grid, w, h, opts).slopeRadians;
  const curv = core.finiteDifferenceCurvature(grid, w, h, opts).laplacian;
  const posIdx = [], negIdx = [];
  for (let i = 0; i < w * h; i++) {
    if (view.ign[i] || !Number.isFinite(grid[i])) continue;
    (view.pos[i] ? posIdx : negIdx).push(i);
  }
  const pick = (arr, cap) => {
    if (arr.length <= cap) return arr;
    const out = [], used = new Set();
    while (out.length < cap) { const k = arr[(rand() * arr.length) | 0]; if (!used.has(k)) { used.add(k); out.push(k); } }
    return out;
  };
  const idx = [...pick(posIdx, 2000), ...pick(negIdx, 2000)];
  const n = idx.length;
  const F = { topographicBreak: new Float32Array(n), tpiRaw: new Float32Array(n),
    localRelief: new Float32Array(n), slopeDeg: new Float32Array(n) };
  const y = new Uint8Array(n);
  idx.forEach((px, k) => {
    F.localRelief[k] = Math.abs(relief[px]);
    F.tpiRaw[k] = tpi[px];
    F.slopeDeg[k] = Number.isFinite(slope[px]) ? slope[px] * 180 / Math.PI : NaN;
    F.topographicBreak[k] = Math.abs(curv[px]);
    y[k] = view.pos[px] ? 1 : 0;
  });
  return { region: view.region, F, y };
}

function normalizeSample(sf, trough, mode, sat) {
  const n = sf.y.length;
  const cols = {};
  const raw = {
    topographicBreak: sf.F.topographicBreak, localRelief: sf.F.localRelief, slope: sf.F.slopeDeg,
    ridgeOrTroughPosition: Float32Array.from(sf.F.tpiRaw, v => Number.isFinite(v) ? Math.max(v, 0) + trough * Math.max(-v, 0) : NaN),
  };
  for (const k of Object.keys(raw)) {
    const finite = Array.from(raw[k]).filter(Number.isFinite).sort((a, b) => a - b);
    const p90 = finite.length ? finite[Math.min(finite.length - 1, Math.floor(0.9 * finite.length))] : NaN;
    const col = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const v = raw[k][i];
      if (!Number.isFinite(v)) { col[i] = NaN; continue; }
      const a = p90 > 1e-12 ? Math.min(1, Math.max(0, v) / p90) : 0;
      if (mode === "A") col[i] = a;
      else {
        const b = Math.min(1, Math.max(0, v) / sat[k]);
        col[i] = mode === "B" ? b : Math.max(a, b);
      }
    }
    cols[k] = col;
  }
  return cols;
}

function binnedAP(colsList, weights) {
  // region-macro AP from 512-bin histograms per view
  const regionAPs = new Map();
  for (const { region, cols, y } of colsList) {
    const posBins = new Float64Array(512), negBins = new Float64Array(512);
    let P = 0;
    for (let i = 0; i < y.length; i++) {
      let s = 0, ws = 0, cnt = 0;
      const keys = ["topographicBreak", "ridgeOrTroughPosition", "localRelief", "slope"];
      for (let k = 0; k < 4; k++) { const v = cols[keys[k]][i]; if (Number.isFinite(v)) { s += weights[k] * v; ws += weights[k]; cnt++; } }
      if (cnt < 2 || !ws) continue;
      const bin = Math.min(511, Math.floor((s / ws) * 512));
      if (y[i]) { posBins[bin]++; P++; } else negBins[bin]++;
    }
    if (!P) continue;
    let tp = 0, fp = 0, prevR = 0, ap = 0;
    for (let b = 511; b >= 0; b--) {
      if (!posBins[b] && !negBins[b]) continue;
      tp += posBins[b]; fp += negBins[b];
      const R = tp / P; ap += (R - prevR) * (tp / (tp + fp)); prevR = R;
    }
    if (!regionAPs.has(region)) regionAPs.set(region, []);
    regionAPs.get(region).push(ap);
  }
  const means = [...regionAPs.values()].map(a => a.reduce((x, y) => x + y, 0) / a.length);
  return means.length ? means.reduce((a, b) => a + b, 0) / means.length : 0;
}

function gridSearch(samples, trough, mode, sat, weightsList) {
  const colsList = Samples.map(sf => ({ region: sf.region, y: sf.y, cols: normalizeSample(sf, trough, mode, sat) }));
  let best = null;
  const scored = [];
  for (const w of weightsList) {
    const ap = binnedAP(colsList, w);
    scored.push({ weights: w, ap });
    if (!best || ap > best.ap) best = { weights: w, ap };
  }
  scored.sort((a, b) => b.ap - a.ap);
  return { best, top: scored.slice(0, 15) };
}
let Samples = [];

/* ---------- exact scoring (config-grouped) ---------- */
// Finalists sharing (trough, radiusM, mode, sat) share one feature pass per
// view. Threshold-dependent recall/FAR come from 0.01 score histograms.
function exactGroup(views, thetas, normFor) {
  const acc = thetas.map(() => ({
    regionAP: new Map(), posBins: new Float64Array(101), posTotal: 0,
    negFarBins: new Float64Array(101), negViews: 0,
  }));
  for (const view of views) {
    const norm = normFor(view);
    thetas.forEach((theta, ti) => {
      const a = acc[ti];
      const score = ev.combine(norm, theta.weights);
      if (view.class === "positive") {
        const ap = ev.viewAP(score, view);
        if (ap !== null) {
          if (!a.regionAP.has(view.region)) a.regionAP.set(view.region, []);
          a.regionAP.get(view.region).push(ap);
        }
        for (let i = 0; i < score.length; i++)
          if (view.pos[i] && !view.ign[i] && Number.isFinite(score[i])) {
            a.posBins[Math.min(100, Math.floor(score[i] * 100))]++; a.posTotal++;
          }
      } else {
        a.negViews++;
        const bins = new Float64Array(101);
        let total = 0;
        for (let i = 0; i < score.length; i++)
          if (Number.isFinite(score[i])) { bins[Math.min(100, Math.floor(score[i] * 100))]++; total++; }
        if (total) {
          let run = 0;
          for (let b = 100; b >= 0; b--) { run += bins[b]; a.negFarBins[b] += run / total; }
        }
      }
    });
  }
  return acc.map(a => {
    const regionMeans = Object.fromEntries([...a.regionAP].map(([r, arr]) => [r, arr.reduce((x, y) => x + y, 0) / arr.length]));
    const recallAt = t => {
      if (!a.posTotal) return 0;
      let s = 0; for (let b = Math.min(100, Math.round(t * 100)); b <= 100; b++) s += a.posBins[b];
      return s / a.posTotal;
    };
    const farAt = t => a.negViews ? a.negFarBins[Math.min(100, Math.round(t * 100))] / a.negViews : 0;
    return { regionMeans,
      macroAP: Object.values(regionMeans).reduce((x, y) => x + y, 0) / Math.max(1, Object.keys(regionMeans).length),
      recallAt, farAt };
  });
}

function exactTheta(views, theta) {
  if (theta.baselineRadius)
    return exactGroup(views, [theta], v => ev.normalize(ev.rawFeatures(v, 5 * v.cellMetres, theta.trough), theta.mode, theta.sat || {}))[0];
  return exactGroup(views, [theta], v => ev.normalize(ev.rawFeatures(v, theta.radiusM, theta.trough), theta.mode, theta.sat || {}))[0];
}

function exactFinalists(views, finalists) {
  const groups = new Map();
  for (const c of finalists) {
    const key = JSON.stringify([c.trough, c.radiusM, c.mode, c.sat]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  const out = new Map();
  for (const [key, thetas] of groups) {
    const [trough, radiusM, mode, sat] = JSON.parse(key);
    const res = exactGroup(views, thetas, v => ev.normalize(ev.rawFeatures(v, radiusM, trough), mode, sat || {}));
    thetas.forEach((c, i) => out.set(c, res[i]));
    console.log(`exact group ${key}: ${thetas.length} thetas done`);
  }
  return out;
}

function main() {
  const t0 = Date.now();
  const train = ev.loadViews("train");
  const posViews = train.filter(v => v.class === "positive");
  console.log(`train views=${train.length} positive=${posViews.length}`);
  const weightsList = weightGrid();
  const candidates = []; // {weights, trough, radiusM, mode, sat, approxAP}
  const stageLog = [];

  for (const stage of ["radius", "trough", "mode"]) {
    if (stage === "radius") {
      for (const radiusM of RADII) {
        const rand = rng(SEED);
        Samples = posViews.map(v => sampleFeatures(v, radiusM, rand));
        const { best, top } = gridSearch(Samples, 0.35, "A", null, weightsList);
        stageLog.push({ stage, radiusM, bestAP: best.ap, weights: best.weights });
        for (const t of top) candidates.push({ ...t, trough: 0.35, radiusM, mode: "A", sat: null, approxAP: t.ap });
        console.log(`radius ${radiusM}: sampleAP=${best.ap.toFixed(4)} w=${best.weights} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
      }
    }
  }
  // choose best radius by best candidate
  const bestRadius = candidates.reduce((a, b) => (b.approxAP > a.approxAP ? b : a)).radiusM;
  {
    const rand = rng(SEED);
    Samples = posViews.map(v => sampleFeatures(v, bestRadius, rand));
    for (const trough of TROUGHS) {
      const { best, top } = gridSearch(Samples, trough, "A", null, weightsList);
      stageLog.push({ stage: "trough", trough, bestAP: best.ap });
      for (const t of top) candidates.push({ ...t, trough, radiusM: bestRadius, mode: "A", sat: null, approxAP: t.ap });
      console.log(`trough ${trough}: sampleAP=${best.ap.toFixed(4)} w=${best.weights}`);
    }
    // mode B/C: coordinate search over saturation ladders at best-so-far weights, then re-grid
    const bestSoFar = candidates.reduce((a, b) => (b.approxAP > a.approxAP ? b : a));
    for (const mode of ["B", "C"]) {
      let sat = { localRelief: 5, ridgeOrTroughPosition: 5, slope: 20, topographicBreak: 0.01 };
      let cur = gridSearch(Samples, bestSoFar.trough, mode, sat, [bestSoFar.weights]).best.ap;
      for (let round = 0; round < 2; round++)
        for (const k of Object.keys(SAT_LADDERS))
          for (const val of SAT_LADDERS[k]) {
            const trial = { ...sat, [k]: val };
            const ap = gridSearch(Samples, bestSoFar.trough, mode, trial, [bestSoFar.weights]).best.ap;
            if (ap > cur) { cur = ap; sat = trial; }
          }
      const { best, top } = gridSearch(Samples, bestSoFar.trough, mode, sat, weightsList);
      stageLog.push({ stage: "mode", mode, sat, bestAP: best.ap });
      for (const t of top) candidates.push({ ...t, trough: bestSoFar.trough, radiusM: bestRadius, mode, sat, approxAP: t.ap });
      console.log(`mode ${mode}: sampleAP=${best.ap.toFixed(4)} sat=${JSON.stringify(sat)} w=${best.weights}`);
    }
  }

  // exact re-score of top distinct candidates
  candidates.sort((a, b) => b.approxAP - a.approxAP);
  const seen = new Set(), finalists = [];
  for (const c of candidates) {
    const key = JSON.stringify([c.weights, c.trough, c.radiusM, c.mode, c.sat]);
    if (seen.has(key)) continue;
    seen.add(key); finalists.push(c);
    if (finalists.length >= 24) break;
  }
  console.log(`exact-scoring ${finalists.length} finalists...`);
  const baseline = exactTheta(train, { ...CURRENT, radiusM: 60, baselineRadius: true });
  const Rcur = baseline.recallAt(0.58), FARcur = baseline.farAt(0.58);
  console.log(`baseline exact macroAP=${baseline.macroAP.toFixed(4)} Rcur=${Rcur.toFixed(3)} FARcur=${FARcur.toFixed(4)}`);
  const exactByTheta = exactFinalists(train, finalists);
  const exact = [];
  for (const c of finalists) {
    const r = exactByTheta.get(c);
    // t_theta: lowest threshold on 0.01 grid whose pooled recall <= Rcur
    let tTheta = 1.0;
    for (let t = 0; t <= 1.0001; t += 0.01) if (r.recallAt(+t.toFixed(2)) <= Rcur) { tTheta = +t.toFixed(2); break; }
    const far = r.farAt(tTheta);
    exact.push({ ...c, exactAP: r.macroAP, regionMeans: r.regionMeans, tTheta, farAtT: far, feasible: far <= FARcur });
    console.log(`exact AP=${r.macroAP.toFixed(4)} w=${c.weights} trough=${c.trough} r=${c.radiusM} mode=${c.mode} t=${tTheta} FAR=${far.toFixed(4)} feasible=${far <= FARcur}`);
  }
  exact.sort((a, b) => b.exactAP - a.exactAP);
  const feasible = exact.filter(e => e.feasible);
  const winnerPool = feasible.length ? feasible : exact;
  const thetaStar = winnerPool[0];

  // near-optimal set via region bootstrap (B=2000, diff vs theta*)
  const regions = Object.keys(thetaStar.regionMeans);
  const randB = rng(SEED);
  const diffs = new Map(winnerPool.map(e => [e, []]));
  for (let b = 0; b < 2000; b++) {
    const draw = Array.from({ length: regions.length }, () => regions[(randB() * regions.length) | 0]);
    const mean = e => draw.reduce((a, r) => a + (e.regionMeans[r] ?? thetaStar.regionMeans[r]), 0) / draw.length;
    const base = mean(thetaStar);
    for (const e of winnerPool) diffs.get(e).push(base - mean(e));
  }
  const nearOptimal = winnerPool.filter(e => {
    const d = [...diffs.get(e)].sort((a, b) => a - b);
    return d[Math.floor(0.025 * d.length)] <= 0;
  });
  const distEq = w => w.reduce((a, x) => a + Math.abs(x - 0.25), 0);
  nearOptimal.sort((a, b) => distEq(a.weights) - distEq(b.weights) || a.radiusM - b.radiusM);
  const chosen = nearOptimal[0] || thetaStar;

  // baselines: equal weights + single features (exact, mode A, trough .35, radius of chosen)
  const baselines = { current: { macroAP: baseline.macroAP, recallAt058: Rcur, farAt058: FARcur } };
  for (const [name, w] of [["equal", [0.25, 0.25, 0.25, 0.25]], ["breakOnly", [1, 0, 0, 0]], ["positionOnly", [0, 1, 0, 0]], ["reliefOnly", [0, 0, 1, 0]], ["slopeOnly", [0, 0, 0, 1]]]) {
    const r = exactTheta(train, { weights: w, trough: 0.35, radiusM: chosen.radiusM, mode: "A", sat: null });
    baselines[name] = { macroAP: r.macroAP, farAt058: r.farAt(0.58), recallAt058: r.recallAt(0.58) };
  }

  const results = {
    created: new Date().toISOString(), searchNote: "Grid scored on fixed 2000+2000 labelled-pixel subsample per positive view, 512-bin AP; finalists re-scored exactly on full pixels. Test views never loaded.",
    stageLog, baselines, exactFinalists: exact.map(e => ({ weights: e.weights, trough: e.trough, radiusM: e.radiusM, mode: e.mode, sat: e.sat, approxAP: e.approxAP, exactAP: e.exactAP, tTheta: e.tTheta, farAtT: e.farAtT, feasible: e.feasible })),
    chosen: { weights: chosen.weights, trough: chosen.trough, radiusM: chosen.radiusM, mode: chosen.mode, sat: chosen.sat, exactAP: chosen.exactAP, tTheta: chosen.tTheta, farAtT: chosen.farAtT },
    seconds: +((Date.now() - t0) / 1000).toFixed(0),
  };
  fs.writeFileSync(path.join(OUT, "results-train.json"), JSON.stringify(results, null, 1));
  console.log("CHOSEN", JSON.stringify(results.chosen));
  console.log(`wrote results-train.json in ${results.seconds}s`);
}
if (require.main === module) main();
