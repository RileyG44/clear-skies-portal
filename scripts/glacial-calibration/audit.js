"use strict";
/* Auditor (plan agent 4): independent held-out test, run ONCE with theta and
   threshold frozen from train/validation. Checks leakage, reruns baselines on
   test, computes pass criteria with region bootstrap, per-confuser FAR,
   stability, and writes output/glacial-calibration/REPORT.md.
   Run: node scripts/glacial-calibration/audit.js   (test views loaded only here) */
const fs = require("fs"), path = require("path");
const ev = require("./evaluate.js");
const OUT = path.join(__dirname, "..", "..", "output", "glacial-calibration");
const SEED = 20261013;
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

function scoreSet(views, paramsFor) {
  // returns per-view {view, score, ap, regionAPs...}
  const regionAP = new Map(), rows = [];
  let farSum = 0, farN = 0; const farByType = new Map();
  let objTP = 0, objTotal = 0, skelHit = 0, skelTotal = 0;
  for (const view of views) {
    const { params, threshold } = paramsFor(view);
    const score = ev.scoreView(view, params);
    const row = { site: view.site, region: view.region, class: view.class, type: view.type, viewKm: view.viewKm, offset: view.offset };
    if (view.class === "positive") {
      row.ap = ev.viewAP(score, view);
      if (row.ap !== null) {
        if (!regionAP.has(view.region)) regionAP.set(view.region, []);
        regionAP.get(view.region).push(row.ap);
      }
      const skel = ev.skeletonize(view.pos, view.w, view.h);
      const tol = Math.max(1, Math.round((view.uncertaintyM || 12) / view.cellMetres));
      const hit = new Uint8Array(score.length);
      for (let i = 0; i < score.length; i++) hit[i] = Number.isFinite(score[i]) && score[i] >= threshold ? 1 : 0;
      for (let y = 0; y < view.h; y++) for (let x = 0; x < view.w; x++) {
        if (!skel[y * view.w + x]) continue;
        skelTotal++;
        let ok = false;
        outer: for (let dy = -tol; dy <= tol && !ok; dy++) for (let dx = -tol; dx <= tol; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < view.w && ny < view.h && hit[ny * view.w + nx]) { ok = true; break outer; }
        }
        if (ok) skelHit++;
      }
    } else {
      row.far = ev.viewFAR(score, view, threshold);
      farSum += row.far; farN++;
      if (!farByType.has(view.type)) farByType.set(view.type, []);
      farByType.get(view.type).push(row.far);
    }
    const hit = new Uint8Array(score.length);
    for (let i = 0; i < score.length; i++) hit[i] = Number.isFinite(score[i]) && score[i] >= threshold ? 1 : 0;
    for (const px of ev.components(hit, view.w, view.h)) {
      if (px.length * view.cellMetres * view.cellMetres < 5000) continue;
      objTotal++;
      if (px.some(i => view.pos[i] || view.ign[i])) objTP++;
    }
    rows.push(row);
  }
  const regionMeans = Object.fromEntries([...regionAP].map(([r, a]) => [r, a.reduce((x, y) => x + y, 0) / a.length]));
  return { regionMeans,
    macroAP: Object.values(regionMeans).reduce((a, b) => a + b, 0) / Math.max(1, Object.keys(regionMeans).length),
    far: farN ? farSum / farN : null,
    farByType: Object.fromEntries([...farByType].map(([k, v]) => [k, +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(4)])),
    objectPrecision: objTotal ? objTP / objTotal : null,
    objectRecall: skelTotal ? skelHit / skelTotal : null, rows };
}

function stability(views, paramsFor) {
  // (a) pan-offset: same site+size, o0 vs o1/o2 overlap; (b) scale: o0 views block-averaged
  const scored = new Map();
  const getScore = view => {
    if (!scored.has(view)) scored.set(view, ev.scoreView(view, paramsFor(view).params));
    return scored.get(view);
  };
  const diffs = [];
  const byKey = new Map();
  for (const v of views) byKey.set(`${v.site}|${v.viewKm}|${v.offset}`, v);
  for (const v of views) {
    if (v.offset !== 0) continue;
    const s0 = getScore(v);
    for (const o of [1, 2]) {
      const u = byKey.get(`${v.site}|${v.viewKm}|${o}`);
      if (!u) continue;
      const s1 = getScore(u);
      const dxPx = Math.round((u.bbox[0] - v.bbox[0]) / ((v.bbox[2] - v.bbox[0]) / v.w));
      const dyPx = Math.round((v.bbox[3] - u.bbox[3]) / ((v.bbox[3] - v.bbox[1]) / v.h)); // rows from north
      for (let y = 0; y < v.h; y++) for (let x = 0; x < v.w; x++) {
        const ax = x, ay = y, bx = x - dxPx, by = y - dyPx;
        if (bx < 0 || by < 0 || bx >= v.w || by >= v.h) continue;
        const a = s0[ay * v.w + ax], b = s1[by * v.w + bx];
        if (Number.isFinite(a) && Number.isFinite(b)) diffs.push(Math.abs(a - b));
      }
    }
  }
  const pan = diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : null;
  // scale: finer o0 block-averaged onto coarser o0 grid (same centre)
  const scaleDiffs = [];
  const sizes = [1.3, 3.2, 7.7];
  const sites = [...new Set(views.map(v => v.site))];
  for (const site of sites) for (let si = 0; si + 1 < sizes.length; si++) {
    const fine = byKey.get(`${site}|${sizes[si]}|0`), coarse = byKey.get(`${site}|${sizes[si + 1]}|0`);
    if (!fine || !coarse) continue;
    const sf = getScore(fine), sc = getScore(coarse);
    const acc = new Map();
    for (let y = 0; y < fine.h; y++) for (let x = 0; x < fine.w; x++) {
      const lon = fine.bbox[0] + (x + 0.5) * (fine.bbox[2] - fine.bbox[0]) / fine.w;
      const lat = fine.bbox[3] - (y + 0.5) * (fine.bbox[3] - fine.bbox[1]) / fine.h;
      const cx = Math.floor((lon - coarse.bbox[0]) / (coarse.bbox[2] - coarse.bbox[0]) * coarse.w);
      const cy = Math.floor((coarse.bbox[3] - lat) / (coarse.bbox[3] - coarse.bbox[1]) * coarse.h);
      if (cx < 0 || cy < 0 || cx >= coarse.w || cy >= coarse.h) continue;
      const fv = sf[y * fine.w + x], cv = sc[cy * coarse.w + cx];
      if (!Number.isFinite(fv) || !Number.isFinite(cv)) continue;
      const k = cy * coarse.w + cx;
      if (!acc.has(k)) acc.set(k, { f: 0, n: 0, c: cv });
      const a = acc.get(k); a.f += fv; a.n++;
    }
    for (const a of acc.values()) scaleDiffs.push(Math.abs(a.f / a.n - a.c));
  }
  const scale = scaleDiffs.length ? scaleDiffs.reduce((a, b) => a + b, 0) / scaleDiffs.length : null;
  return { pan, scale, overall: pan !== null && scale !== null ? (pan + scale) / 2 : (pan ?? scale) };
}

function main() {
  const train = JSON.parse(fs.readFileSync(path.join(OUT, "results-train.json"), "utf8"));
  const val = JSON.parse(fs.readFileSync(path.join(OUT, "results-validation.json"), "utf8"));
  const ch = train.chosen, threshold = val.chosenThreshold;
  const manifest = JSON.parse(fs.readFileSync(path.join(OUT, "manifest.json"), "utf8"));

  // leakage checks (metadata only, before scoring test)
  const splitOfRegion = Object.fromEntries(manifest.regions.map(r => [r.id, r.split]));
  const leaks = manifest.sites.filter(s => splitOfRegion[s.region] !== s.split).map(s => s.id);
  const testRegions = manifest.regions.filter(r => r.split === "test").map(r => r.id);

  const views = ev.loadViews("test");
  console.log(`test views=${views.length} regions=${testRegions.join(",")}`);
  const newParams = v => ({ params: { weights: ch.weights, trough: ch.trough, radiusM: ch.radiusM, mode: ch.mode, sat: ch.sat || {} }, threshold });
  const curParams = v => ({ params: { weights: [0.30, 0.25, 0.25, 0.20], trough: 0.35, radiusM: 5 * v.cellMetres, mode: "A", sat: {} }, threshold: 0.58 });

  const t0 = Date.now();
  const resNew = scoreSet(views, newParams);
  const resCur = scoreSet(views, curParams);
  const stabNew = stability(views, newParams);
  const stabCur = stability(views, curParams);

  // region bootstrap of AP delta (B=10000, seed 20261013), test regions with positives
  const regions = Object.keys(resNew.regionMeans).filter(r => resCur.regionMeans[r] !== undefined);
  const rand = rng(SEED);
  const deltas = [];
  for (let b = 0; b < 10000; b++) {
    const draw = Array.from({ length: regions.length }, () => regions[(rand() * regions.length) | 0]);
    const mean = m => draw.reduce((a, r) => a + m[r], 0) / draw.length;
    deltas.push(mean(resNew.regionMeans) - mean(resCur.regionMeans));
  }
  deltas.sort((a, b) => a - b);
  const ci = [deltas[Math.floor(0.025 * deltas.length)], deltas[Math.floor(0.975 * deltas.length)]];
  const delta = resNew.macroAP - resCur.macroAP;
  const passAP = ci[0] > 0;
  const passFAR = resNew.far <= resCur.far;
  const passStab = stabNew.overall <= stabCur.overall;
  const ship = passAP && passFAR && passStab;

  const worst = [...resNew.rows].filter(r => r.class === "positive" && r.ap !== undefined).sort((a, b) => a.ap - b.ap).slice(0, 8);
  const farWorst = [...resNew.rows].filter(r => r.far !== undefined).sort((a, b) => b.far - a.far).slice(0, 8);
  const out = { chosen: ch, threshold, testRegions, leaks,
    new: { macroAP: resNew.macroAP, regionMeans: resNew.regionMeans, far: resNew.far, farByType: resNew.farByType, objectPrecision: resNew.objectPrecision, objectRecall: resNew.objectRecall, stability: stabNew },
    current: { macroAP: resCur.macroAP, regionMeans: resCur.regionMeans, far: resCur.far, farByType: resCur.farByType, objectPrecision: resCur.objectPrecision, objectRecall: resCur.objectRecall, stability: stabCur },
    deltaAP: delta, deltaCI95: ci, pass: { ap: passAP, far: passFAR, stability: passStab }, ship,
    worstPositiveViews: worst, worstFarViews: farWorst, seconds: +((Date.now() - t0) / 1000).toFixed(0) };
  fs.writeFileSync(path.join(OUT, "results-test.json"), JSON.stringify(out, null, 1));

  const L = [];
  L.push("# Glacial-margin screen calibration — auditor report");
  L.push("");
  L.push(`Held-out test run once on ${new Date().toISOString().slice(0, 10)} with parameters frozen from train/validation. Test regions: ${testRegions.join(", ")}.`);
  L.push("");
  L.push("## Verdict");
  L.push("");
  L.push(ship ? "**SHIP** the calibrated parameters." : "**DO NOT SHIP** the calibrated parameters.");
  L.push("");
  L.push("| Criterion | New | Current | Pass |");
  L.push("|---|---|---|---|");
  L.push(`| Test region-macro AP | ${resNew.macroAP.toFixed(4)} | ${resCur.macroAP.toFixed(4)} | ${passAP ? "yes" : "no"} (delta ${delta.toFixed(4)}, 95% CI [${ci[0].toFixed(4)}, ${ci[1].toFixed(4)}]) |`);
  L.push(`| Confuser FAR | ${resNew.far.toFixed(4)} @ ${threshold} | ${resCur.far.toFixed(4)} @ 0.58 | ${passFAR ? "yes" : "no"} |`);
  L.push(`| Stability (mean abs score diff) | ${stabNew.overall.toFixed(4)} | ${stabCur.overall.toFixed(4)} | ${passStab ? "yes" : "no"} |`);
  L.push("");
  L.push("## Frozen parameters");
  L.push("");
  L.push(`Weights (break/position/relief/slope): ${ch.weights.join(" / ")}; trough ${ch.trough}; radius ${ch.radiusM} m; mode ${ch.mode}${ch.sat ? `; saturations ${JSON.stringify(ch.sat)}` : ""}; threshold ${threshold}.`);
  L.push("");
  L.push("## Secondary metrics (test)");
  L.push("");
  L.push(`Object precision: new ${resNew.objectPrecision?.toFixed(3)} vs current ${resCur.objectPrecision?.toFixed(3)}. Object recall: new ${resNew.objectRecall?.toFixed(3)} vs current ${resCur.objectRecall?.toFixed(3)}.`);
  L.push("");
  L.push("Per-confuser-type FAR (new): " + Object.entries(resNew.farByType).map(([k, v]) => `${k} ${v}`).join(", ") + ".");
  L.push("");
  L.push("## Leakage and label checks");
  L.push("");
  L.push(leaks.length ? `Split leaks found: ${leaks.join(", ")}` : "No region appears in more than one split; every site carries its region's split.");
  L.push("Label spot checks: `overlays/` hillshade + label PNGs per site (data-engineer stage). Confuser views verified all-negative after the fetch repair recorded in the calibration log.");
  L.push("");
  L.push("## Worst test views (new parameters)");
  L.push("");
  for (const r of worst) L.push(`- ${r.site} ${r.viewKm} km o${r.offset}: AP ${r.ap?.toFixed(3)}`);
  for (const r of farWorst) L.push(`- ${r.site} (${r.type}) ${r.viewKm} km o${r.offset}: FAR ${r.far?.toFixed(3)}`);
  L.push("");
  L.push("## Limits");
  L.push("");
  L.push("Four local shape features cannot separate moraines from every look-alike; see per-confuser FAR above. DEM views outside 1 m lidar footprints come from coarser 3DEP source data (the same service the app uses); manifest records per-site footprint coverage, with attribute-tile fallback sites flagged as bounded overestimates.");
  fs.writeFileSync(path.join(OUT, "REPORT.md"), L.join("\n") + "\n");
  console.log(JSON.stringify({ ship, deltaAP: delta, ci, newAP: resNew.macroAP, curAP: resCur.macroAP, newFAR: resNew.far, curFAR: resCur.far, stabNew: stabNew.overall, stabCur: stabCur.overall, seconds: out.seconds }, null, 1));
}
if (require.main === module) main();
