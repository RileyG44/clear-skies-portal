"use strict";
/* Logistic-regression cross-check (preregistration selection rule step 5):
   L2 (C=1.0), non-negative coefficients rescaled to sum 1, fit on train pixels
   subsampled balanced (seed 20261013), using the chosen theta's radius /
   trough / normalisation so only the weights differ. Cross-check only.
   Run: node scripts/glacial-calibration/logistic.js */
const fs = require("fs"), path = require("path");
const ev = require("./evaluate.js");
const OUT = path.join(__dirname, "..", "..", "output", "glacial-calibration");
const KEYS = ["topographicBreak", "ridgeOrTroughPosition", "localRelief", "slope"];
const SEED = 20261013;
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

function normalizeView(view, ch) {
  const f = ev.rawFeatures(view, ch.radiusM, ch.trough);
  return ev.normalize(f, ch.mode, ch.sat || {});
}

function main() {
  const results = JSON.parse(fs.readFileSync(path.join(OUT, "results-train.json"), "utf8"));
  const ch = results.chosen;
  const train = ev.loadViews("train");
  const rand = rng(SEED);
  // Build balanced subsample: up to 2000 pos + 2000 neg per view (<=20k/view cap is looser).
  const X = [], Y = [];
  const normCache = new Map();
  for (const view of train) {
    const norm = normalizeView(view, ch);
    normCache.set(view, norm);
    const pos = [], neg = [];
    for (let i = 0; i < view.w * view.h; i++) {
      if (view.ign[i]) continue;
      const vals = KEYS.map(k => norm[k][i]);
      if (!vals.every(Number.isFinite)) continue;
      (view.pos[i] ? pos : neg).push(vals);
    }
    const pick = (arr, cap) => arr.length <= cap ? arr : arr.filter(() => rand() < cap / arr.length).slice(0, cap);
    for (const v of pick(pos, 2000)) { X.push(v); Y.push(1); }
    for (const v of pick(neg, 2000)) { X.push(v); Y.push(0); }
  }
  console.log(`samples=${X.length} pos=${Y.reduce((a, b) => a + b, 0)}`);
  // Gradient descent on average log-loss + (lambda/2)||w||^2, lambda from C=1 sklearn-style approx.
  let w = [0.25, 0.25, 0.25, 0.25], b = 0;
  const lambda = 1 / X.length, lr = 0.5, iters = 300;
  for (let it = 0; it < iters; it++) {
    const g = [0, 0, 0, 0]; let gb = 0;
    for (let n = 0; n < X.length; n++) {
      let z = b; for (let k = 0; k < 4; k++) z += w[k] * X[n][k];
      const p = 1 / (1 + Math.exp(-z)), d = p - Y[n];
      for (let k = 0; k < 4; k++) g[k] += d * X[n][k] / X.length;
      gb += d / X.length;
    }
    for (let k = 0; k < 4; k++) w[k] = Math.max(0, w[k] - lr * (g[k] + lambda * w[k]));
    b -= lr * gb;
  }
  const sum = w.reduce((a, x) => a + x, 0) || 1;
  const weights = w.map(x => +(x / sum).toFixed(4));
  // Exact train AP + FAR with these weights at chosen config.
  const byRegion = new Map(); let farSum = 0, farN = 0;
  for (const view of train) {
    const score = ev.combine(normCache.get(view), weights);
    if (view.class === "positive") {
      const ap = ev.viewAP(score, view);
      if (ap !== null) { if (!byRegion.has(view.region)) byRegion.set(view.region, []); byRegion.get(view.region).push(ap); }
    } else { farSum += ev.viewFAR(score, view, ch.tTheta || 0.58); farN++; }
  }
  const regionMeans = [...byRegion.values()].map(a => a.reduce((x, y) => x + y, 0) / a.length);
  const out = { weights, bias: b, trainRegionMacroAP: regionMeans.reduce((a, x) => a + x, 0) / regionMeans.length,
    trainFARatChosenT: farN ? farSum / farN : null, config: { radiusM: ch.radiusM, trough: ch.trough, mode: ch.mode, sat: ch.sat } };
  fs.writeFileSync(path.join(OUT, "results-logistic.json"), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
}
if (require.main === module) main();
