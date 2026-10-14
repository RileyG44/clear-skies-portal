"use strict";
/* Validation threshold rule (preregistration): after theta is frozen from
   train, choose on validation views the lowest threshold (0.01 grid) whose
   pooled object precision >= 0.50 (components >= 5,000 m2 touching a positive
   or uncertainty-ignore pixel). Reports object recall and FAR there.
   Scores and skeletons are computed once per view; only the component pass
   repeats per threshold. Run: node scripts/glacial-calibration/threshold.js */
const fs = require("fs"), path = require("path");
const ev = require("./evaluate.js");
const OUT = path.join(__dirname, "..", "..", "output", "glacial-calibration");

function main() {
  const results = JSON.parse(fs.readFileSync(path.join(OUT, "results-train.json"), "utf8"));
  const ch = results.chosen;
  const params = { weights: ch.weights, trough: ch.trough, radiusM: ch.radiusM, mode: ch.mode, sat: ch.sat || {} };
  const views = ev.loadViews("validation");
  console.log(`validation views=${views.length}`);
  const prepared = views.map(view => {
    const score = ev.scoreView(view, params);
    const skel = view.class === "positive" ? ev.skeletonize(view.pos, view.w, view.h) : null;
    return { view, score, skel };
  });
  const rows = [];
  let chosenT = null;
  for (let ti = 5; ti <= 95; ti++) {
    const t = ti / 100;
    let objTP = 0, objTotal = 0, skelHit = 0, skelTotal = 0, farSum = 0, farN = 0;
    for (const { view, score, skel } of prepared) {
      const hit = new Uint8Array(score.length);
      for (let i = 0; i < score.length; i++) hit[i] = Number.isFinite(score[i]) && score[i] >= t ? 1 : 0;
      for (const px of ev.components(hit, view.w, view.h)) {
        if (px.length * view.cellMetres * view.cellMetres < 5000) continue;
        objTotal++;
        if (px.some(i => view.pos[i] || view.ign[i])) objTP++;
      }
      if (view.class === "positive") {
        const tol = Math.max(1, Math.round((view.uncertaintyM || 12) / view.cellMetres));
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
      } else farSum += ev.viewFAR(score, view, t), farN++;
    }
    const row = { threshold: t, objectPrecision: objTotal ? objTP / objTotal : null,
      objectRecall: skelTotal ? skelHit / skelTotal : null, far: farN ? farSum / farN : null, components: objTotal };
    rows.push(row);
    if (chosenT === null && row.objectPrecision !== null && row.objectPrecision >= 0.5) chosenT = t;
    console.log(`t=${t.toFixed(2)} objPrec=${row.objectPrecision?.toFixed(3)} objRec=${row.objectRecall?.toFixed(3)} FAR=${row.far?.toFixed(4)}`);
  }
  let fallback = null;
  if (chosenT === null) {
    const best = rows.reduce((a, b) => ((b.objectPrecision ?? -1) > (a.objectPrecision ?? -1) ? b : a));
    fallback = { threshold: best.threshold, objectPrecision: best.objectPrecision, shortfall: true };
    chosenT = best.threshold;
  }
  const out = { params, chosenThreshold: chosenT, fallback, rows };
  fs.writeFileSync(path.join(OUT, "results-validation.json"), JSON.stringify(out, null, 1));
  console.log("CHOSEN THRESHOLD", chosenT, fallback ? "(fallback: max precision, shortfall recorded)" : "");
}
if (require.main === module) main();
