"use strict";
/* Evaluate one parameter set against cached views (preregistration 2026-10-13).
   Primary metric: region-macro average precision on positive views; confuser
   false-alarm rate (FAR) on confuser/control views at the threshold.
   Usage: node scripts/glacial-calibration/evaluate.js --split train
     [--weights 0.30,0.25,0.25,0.20] [--trough 0.35] [--radius-m 60]
     [--mode A|B|C] [--sat relief,tpi,slopeDeg,curv] [--threshold 0.58]
     [--out file.json]
   Modes: A per-view p90 (current app), B fixed physical saturation,
   C per-pixel max of A and B normalizations. */
const fs = require("fs"), path = require("path"), zlib = require("zlib");
const core = require(path.join(__dirname, "..", "..", "glacial-research-core.js"));
const OUT = path.join(__dirname, "..", "..", "output", "glacial-calibration");

/* ---------------- views ---------------- */
function loadViews(split) {
  const dir = path.join(OUT, "views");
  const views = [];
  if (!fs.existsSync(dir)) return views;
  for (const f of fs.readdirSync(dir).sort()) {
    if (!f.endsWith(".json.gz")) continue;
    const v = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, f))).toString());
    if (split && v.split !== split) continue;
    if (v.nodataFraction > 0.01) continue; // preregistration drop rule, decided before scoring
    v.grid = new Float32Array(Buffer.from(v.gridB64, "base64").buffer);
    v.pos = Buffer.from(v.posB64, "base64");
    v.ign = Buffer.from(v.ignB64, "base64");
    delete v.gridB64; delete v.posB64; delete v.ignB64;
    views.push(v);
  }
  return views;
}

/* ---------------- features ---------------- */
// Raw transformed features, mirroring scoreGlacialLobeMarginCandidates but with
// tunable trough factor and radius in metres (converted per view).
function rawFeatures(view, radiusM, trough) {
  const { grid, w, h, cellMetres } = view;
  const radiusCells = Math.max(1, Math.round(radiusM / cellMetres));
  const opts = { cellSize: cellMetres, radiusCells };
  const relief = core.localReliefModel(grid, w, h, opts).data;
  const tpi = core.terrainPositionIndex(grid, w, h, opts).data;
  const slope = core.slopeAspectComponents(grid, w, h, opts).slopeRadians;
  const curv = core.finiteDifferenceCurvature(grid, w, h, opts).laplacian;
  const n = w * h;
  const f = {
    topographicBreak: new Float32Array(n), ridgeOrTroughPosition: new Float32Array(n),
    localRelief: new Float32Array(n), slope: new Float32Array(n),
  };
  for (let i = 0; i < n; i++) {
    f.localRelief[i] = Math.abs(relief[i]);
    f.ridgeOrTroughPosition[i] = Number.isFinite(tpi[i]) ? Math.max(tpi[i], 0) + trough * Math.max(-tpi[i], 0) : NaN;
    f.slope[i] = Number.isFinite(slope[i]) ? slope[i] * 180 / Math.PI : NaN; // degrees, per plan saturation units
    f.topographicBreak[i] = Math.abs(curv[i]);
  }
  return f;
}

function p90Normalize(data) {
  const finite = [];
  for (let i = 0; i < data.length; i++) if (Number.isFinite(data[i])) finite.push(Math.max(0, data[i]));
  finite.sort((a, b) => a - b);
  let scale = finite.length ? finite[Math.min(finite.length - 1, Math.floor(0.9 * finite.length))] : NaN;
  if (!(scale > Number.EPSILON) && finite.length) scale = finite[finite.length - 1];
  const out = new Float32Array(data.length).fill(NaN);
  for (let i = 0; i < data.length; i++) if (Number.isFinite(data[i]))
    out[i] = scale > Number.EPSILON ? Math.min(1, Math.max(0, data[i]) / scale) : 0;
  return out;
}

const SAT_KEYS = ["localRelief", "ridgeOrTroughPosition", "slope", "topographicBreak"];
function normalize(f, mode, sat) {
  const out = {};
  for (const k of Object.keys(f)) {
    const a = p90Normalize(f[k]);
    if (mode === "A") { out[k] = a; continue; }
    const b = new Float32Array(f[k].length).fill(NaN);
    const s = sat[k];
    for (let i = 0; i < f[k].length; i++) if (Number.isFinite(f[k][i])) b[i] = Math.min(1, Math.max(0, f[k][i]) / s);
    if (mode === "B") { out[k] = b; continue; }
    const c = new Float32Array(f[k].length).fill(NaN);
    for (let i = 0; i < f[k].length; i++) if (Number.isFinite(a[i]) && Number.isFinite(b[i])) c[i] = Math.max(a[i], b[i]);
    out[k] = c;
  }
  return out;
}

const WKEYS = ["topographicBreak", "ridgeOrTroughPosition", "localRelief", "slope"];
function combine(norm, weights) {
  const n = norm.slope.length, score = new Float32Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    let sum = 0, wsum = 0, count = 0;
    for (let k = 0; k < 4; k++) {
      const v = norm[WKEYS[k]][i];
      if (Number.isFinite(v)) { sum += weights[k] * v; wsum += weights[k]; count++; }
    }
    if (count >= 2 && wsum > 0) score[i] = sum / wsum;
  }
  return score;
}

function scoreView(view, params) {
  const f = rawFeatures(view, params.radiusM, params.trough);
  return combine(normalize(f, params.mode, params.sat || {}), params.weights);
}

/* ---------------- metrics ---------------- */
// Step-wise AP with ties as single thresholds (preregistration definition).
function viewAP(score, view) {
  const pairs = [];
  let P = 0;
  for (let i = 0; i < score.length; i++) {
    if (view.ign[i] || !Number.isFinite(score[i])) continue;
    if (view.pos[i]) { pairs.push([score[i], 1]); P++; } else pairs.push([score[i], 0]);
  }
  if (!P) return null;
  pairs.sort((a, b) => b[0] - a[0]);
  let tp = 0, fp = 0, prevR = 0, ap = 0, i = 0;
  while (i < pairs.length) {
    let j = i;
    while (j < pairs.length && pairs[j][0] === pairs[i][0]) { if (pairs[j][1]) tp++; else fp++; j++; }
    const R = tp / P, Pr = tp / (tp + fp);
    ap += (R - prevR) * Pr; prevR = R; i = j;
  }
  return ap;
}

function viewFAR(score, view, threshold) {
  let hits = 0, total = 0;
  for (let i = 0; i < score.length; i++) {
    if (!Number.isFinite(score[i])) continue;
    total++; if (score[i] >= threshold) hits++;
  }
  return total ? hits / total : 0;
}

function components(mask, w, h) {
  const seen = new Uint8Array(w * h), out = [], stack = [];
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || seen[s]) continue;
    const px = []; stack.push(s); seen[s] = 1;
    while (stack.length) {
      const c = stack.pop(); px.push(c);
      const x = c % w, y = (c / w) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const nn = ny * w + nx;
        if (mask[nn] && !seen[nn]) { seen[nn] = 1; stack.push(nn); }
      }
    }
    out.push(px);
  }
  return out;
}

// Zhang-Suen thinning for the positive-mask skeleton (object recall).
function skeletonize(mask, w, h) {
  const img = Uint8Array.from(mask);
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : img[y * w + x];
  let changed = true;
  while (changed) {
    changed = false;
    for (const step of [0, 1]) {
      const del = [];
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        if (!at(x, y)) continue;
        const p = [at(x, y - 1), at(x + 1, y - 1), at(x + 1, y), at(x + 1, y + 1), at(x, y + 1), at(x - 1, y + 1), at(x - 1, y), at(x - 1, y - 1)];
        const B = p.reduce((a, b) => a + b, 0);
        if (B < 2 || B > 6) continue;
        let A = 0; for (let k = 0; k < 8; k++) if (!p[k] && p[(k + 1) % 8]) A++;
        if (A !== 1) continue;
        const m1 = step ? p[2] * p[4] * p[6] : p[0] * p[2] * p[4];
        const m2 = step ? p[0] * p[4] * p[6] : p[0] * p[2] * p[6];
        if (!m1 && !m2) del.push(y * w + x);
      }
      if (del.length) { changed = true; for (const i of del) img[i] = 0; }
    }
  }
  return img;
}

function evaluateViews(views, params) {
  const byRegion = new Map(), confuserTypes = new Map();
  let farSum = 0, farN = 0, pooledTP = 0, pooledPos = 0;
  let objTP = 0, objTotal = 0, skelHit = 0, skelTotal = 0;
  const rows = [];
  const minCompPx = Math.ceil(5000 / (params._cellAreaM2 || 25));
  for (const view of views) {
    const score = scoreView(view, params);
    const isPosSite = view.class === "positive";
    const row = { site: view.site, region: view.region, class: view.class, type: view.type, viewKm: view.viewKm, offset: view.offset };
    if (isPosSite) {
      row.ap = viewAP(score, view);
      if (row.ap !== null) {
        if (!byRegion.has(view.region)) byRegion.set(view.region, []);
        byRegion.get(view.region).push(row.ap);
      }
      for (let i = 0; i < score.length; i++) {
        if (view.ign[i] || !Number.isFinite(score[i])) continue;
        if (view.pos[i]) { pooledPos++; if (score[i] >= params.threshold) pooledTP++; }
      }
      // object recall: skeleton of positive mask within uncertainty of a hit
      const hit = new Uint8Array(score.length);
      for (let i = 0; i < score.length; i++) hit[i] = Number.isFinite(score[i]) && score[i] >= params.threshold ? 1 : 0;
      const skel = skeletonize(view.pos, view.w, view.h);
      const tolCells = Math.max(1, Math.round(((view.uncertaintyM || 12)) / view.cellMetres));
      for (let y = 0; y < view.h; y++) for (let x = 0; x < view.w; x++) {
        if (!skel[y * view.w + x]) continue;
        skelTotal++;
        let ok = false;
        outer: for (let dy = -tolCells; dy <= tolCells && !ok; dy++) for (let dx = -tolCells; dx <= tolCells; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < view.w && ny < view.h && hit[ny * view.w + nx]) { ok = true; break outer; }
        }
        if (ok) skelHit++;
      }
    } else {
      row.far = viewFAR(score, view, params.threshold);
      farSum += row.far; farN++;
      if (!confuserTypes.has(view.type)) confuserTypes.set(view.type, []);
      confuserTypes.get(view.type).push(row.far);
    }
    // object precision across all views
    const hit = new Uint8Array(score.length);
    for (let i = 0; i < score.length; i++) hit[i] = Number.isFinite(score[i]) && score[i] >= params.threshold ? 1 : 0;
    for (const px of components(hit, view.w, view.h)) {
      const areaM2 = px.length * view.cellMetres * view.cellMetres;
      if (areaM2 < 5000) continue;
      objTotal++;
      if (px.some(i => view.pos[i] || view.ign[i])) objTP++;
    }
    rows.push(row);
  }
  const regionAPs = [...byRegion.values()].map(a => a.reduce((x, y) => x + y, 0) / a.length);
  return {
    regionMacroAP: regionAPs.length ? regionAPs.reduce((a, b) => a + b, 0) / regionAPs.length : null,
    regionsWithPositives: regionAPs.length,
    far: farN ? farSum / farN : null,
    farByType: Object.fromEntries([...confuserTypes].map(([k, v]) => [k, v.reduce((a, b) => a + b, 0) / v.length])),
    pooledPositiveRecall: pooledPos ? pooledTP / pooledPos : null,
    objectPrecision: objTotal ? objTP / objTotal : null,
    objectRecall: skelTotal ? skelHit / skelTotal : null,
    rows,
  };
}

/* ---------------- CLI ---------------- */
function parseParams(args) {
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const satArr = opt("--sat", "5,5,20,0.01").split(",").map(Number);
  return {
    weights: opt("--weights", "0.30,0.25,0.25,0.20").split(",").map(Number),
    trough: Number(opt("--trough", "0.35")),
    radiusM: Number(opt("--radius-m", "60")),
    mode: opt("--mode", "A"),
    sat: { localRelief: satArr[0], ridgeOrTroughPosition: satArr[1], slope: satArr[2], topographicBreak: satArr[3] },
    threshold: Number(opt("--threshold", "0.58")),
  };
}

function main() {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const split = opt("--split", "train");
  const params = parseParams(args);
  const views = loadViews(split);
  const t0 = Date.now();
  const result = evaluateViews(views, params);
  const summary = { split, params, views: views.length,
    regionMacroAP: result.regionMacroAP, regionsWithPositives: result.regionsWithPositives,
    far: result.far, pooledPositiveRecall: result.pooledPositiveRecall,
    objectPrecision: result.objectPrecision, objectRecall: result.objectRecall,
    farByType: result.farByType, seconds: +((Date.now() - t0) / 1000).toFixed(1) };
  const outFile = opt("--out", null);
  if (outFile) fs.writeFileSync(outFile, JSON.stringify({ summary, rows: result.rows }, null, 1));
  console.log(JSON.stringify(summary, null, 1));
}
if (require.main === module) main();
module.exports = { loadViews, rawFeatures, normalize, combine, scoreView, viewAP, viewFAR, evaluateViews, skeletonize, parseParams, components, p90Normalize };
