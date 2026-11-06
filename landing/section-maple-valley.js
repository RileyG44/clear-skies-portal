/* The ground under the vine maple: a soil and rock section as you would find it on the
   glacial upland around Maple Valley, Washington, in the Cedar River country.

     A  forest duff over Alderwood gravelly sandy loam, the brown, stony soil that
        formed on the till since the ice left, about 15,000 years ago
     B  Vashon lodgement till: grey, unsorted, packed hard under the ice sheet, the
        "hardpan" that perches the winter rain and keeps these woods wet
     C  Vashon advance outwash: sand and gravel the meltwater streams laid down ahead of
        the advancing ice, cross-bedded, with pebble lenses
     D  far below (the zig-zag marks the depth left out), the sandstone, shale and coal
        seams of the Puget Group, the beds the Black Diamond and Ravensdale mines worked

   The frame, ground line and return values match drawSection in sketch.js, so the rest
   of the drawing does not need to know which section it stands on. */

import { lerp, DEG } from "./sketch-kit.js";

export function drawSectionMV(K, ink) {
  const { rnd, R, line, poly, ROOT, label } = K;

  /* ---------- ground line (as sketch.js draws it) ---------- */
  const g0 = 0.0035 * Math.sin(1.1) + 0.0025 * Math.sin(0.3);
  const groundY = x => 0.0035 * Math.sin(x * 8.3 + 1.1) + 0.0025 * Math.sin(x * 19.7 + 0.3) - 0.012 * x - g0;
  for (const dir of [-1, 1]) {
    const pts = [];
    for (let x = 0; Math.abs(x) <= 0.5; x += dir * 0.004) pts.push([x, groundY(x) + R(-0.0004, 0.0004), ROOT]);
    poly(pts, f => lerp(1.5, 0.9, f), f => 0.85 - 0.35 * f * f, 0.0, 0.07, ink);
  }
  for (let i = 0; i < 70; i++) {
    const x = R(-0.47, 0.47), y = groundY(x) + R(0.0005, 0.003), a = R(-0.4, 0.4), l = R(0.003, 0.008);
    line(x, y, ROOT, x + Math.cos(a) * l, y + Math.sin(a) * l, ROOT, 0.8, R(0.35, 0.6), 0.04 + 0.05 * Math.abs(x), 0.01, ink);
  }

  /* ---------- the section ---------- */
  const xL = -0.42, xR = 0.34, yBot = -0.205;
  const yA = x => groundY(x) - 0.032 + 0.003 * Math.sin(x * 13 + 2);            // soil / till
  const yB = x => -0.09 + 0.007 * Math.sin(x * 4.1 + 0.7) + 0.003 * Math.sin(x * 15 + 1);   // till / outwash
  const yC = -0.146, yD = -0.156;                                                // the depth break
  const tSec = x => 0.08 + 0.14 * (x - xL) / (xR - xL);
  const dot = (x, y, w, a, t) => line(x, y, ROOT, x + 0.0004, y + 0.0002, ROOT, w, a, t, 0.01, ink);
  const blob = (x, y, r, asp, rot, w, a, t) => {
    const n = 8, pts = [], jit = [];
    for (let i = 0; i < n; i++) jit.push(R(0.82, 1.12));
    for (let i = 0; i <= n; i++) {
      const q = i / n * Math.PI * 2, rr = r * jit[i % n], px = Math.cos(q) * rr, py = Math.sin(q) * rr * asp;
      pts.push([x + px * Math.cos(rot) - py * Math.sin(rot), y + px * Math.sin(rot) + py * Math.cos(rot), ROOT]);
    }
    poly(pts, w, a, t, t + 0.02, ink);
  };
  // the box
  const edge = (x, ytop, y0, y1) => {
    const pts = [];
    for (let y = ytop; y >= y1 - 1e-6; y -= 0.006) if (y <= y0) pts.push([x + R(-0.0005, 0.0005), y, ROOT]);
    pts.push([x, y1, ROOT]);
    poly(pts, 1.1, 0.75, 0.05, 0.1, ink);
  };
  for (const x of [xL, xR]) { edge(x, groundY(x), groundY(x), yC); edge(x, yD, yD, yBot); }
  {
    const bot = [];
    for (let x = xL; x <= xR + 1e-6; x += 0.006) bot.push([x, yBot + R(-0.0004, 0.0004), ROOT]);
    poly(bot, 1.1, 0.75, 0.08, 0.14, ink);
  }

  // A: soil. Duff stippled densest at the top, the gravelly loam below with small stones;
  // the soil grades into the till, so its foot is dashed
  for (let x = xL; x < xR - 0.004; x += 0.011) {
    const x1 = Math.min(xR, x + 0.0065);
    line(x, yA(x), ROOT, x1, yA(x1), ROOT, 0.9, 0.55, tSec(x), 0.01, ink);
  }
  for (let i = 0; i < 700; i++) {
    const x = R(xL + 0.003, xR - 0.003), top = groundY(x) - 0.0025, bt = yA(x) + 0.001;
    const y = top - (top - bt) * Math.pow(rnd(), 1.4);
    dot(x, y, R(1.0, 1.6), R(0.32, 0.6), tSec(x) + 0.02);
  }
  for (let i = 0; i < 70; i++) {          // duff: needles and leaf bits lying flat
    const x = R(xL + 0.006, xR - 0.012), y = groundY(x) - R(0.0015, 0.007), l = R(0.003, 0.007);
    line(x, y, ROOT, x + l, y + R(-0.001, 0.001), ROOT, 0.8, 0.45, tSec(x) + 0.02, 0.01, ink);
  }
  for (let i = 0; i < 55; i++) {          // the "gravelly" of gravelly loam
    const x = R(xL + 0.006, xR - 0.006), y = R(yA(x) + 0.004, groundY(x) - 0.01), r = R(0.0011, 0.0026);
    blob(x, y, r, R(0.6, 1), R(0, 3), 0.8, R(0.45, 0.65), tSec(x) + 0.03);
  }

  // B: the till. Stones of every size, unsorted and unrounded, packed in a fine grey
  // matrix, with the flat, platy partings of the hardpan
  {
    const bc = [];
    for (let x = xL; x <= xR + 1e-6; x += 0.005) bc.push([x, yB(x), ROOT]);
    poly(bc, 1.15, 0.72, 0.1, 0.18, ink);
    const peb = [];
    for (let tries = 0; tries < 1600 && peb.length < 120; tries++) {
      const r = 0.0015 + 0.0062 * Math.pow(rnd(), 2.6);
      const x = R(xL + r + 0.002, xR - r - 0.002), top = yA(x) - r - 0.002, bt = yB(x) + r + 0.002;
      if (top <= bt) continue;
      const y = R(bt, top);
      if (peb.some(p => Math.hypot(p[0] - x, p[1] - y) < p[2] + r + 0.0012)) continue;
      peb.push([x, y, r]);
      blob(x, y, r, R(0.55, 0.95), R(0, 3), r > 0.004 ? 1.0 : 0.85, R(0.5, 0.72), tSec(x) + 0.04);
      if (r > 0.0045) for (let k = 0; k < 3; k++) {
        const a = R(-1.2, -0.2), px = x + Math.cos(a) * r * 0.55, py = y + Math.sin(a) * r * 0.5;
        line(px - 0.0012, py - 0.0016, ROOT, px + 0.0012, py + 0.0016, ROOT, 0.7, 0.35, tSec(x) + 0.07, 0.01, ink);
      }
    }
    const clear = (x, y, m) => !peb.some(p => Math.hypot(p[0] - x, p[1] - y) < p[2] + m);
    for (let i = 0; i < 520; i++) {
      const x = R(xL + 0.003, xR - 0.003), y = R(yB(x) + 0.002, yA(x) - 0.002);
      if (clear(x, y, 0.001)) dot(x, y, R(0.9, 1.3), R(0.3, 0.5), tSec(x) + 0.05);
    }
    for (let i = 0; i < 26; i++) {        // hardpan partings
      const x = R(xL + 0.01, xR - 0.05), y = R(yB(x) + 0.006, yA(x) - 0.008), l = R(0.012, 0.03);
      const pts = [];
      for (let s = 0; s <= l; s += 0.003) if (clear(x + s, y, 0.0015)) pts.push([x + s, y + R(-0.0005, 0.0005), ROOT]); else if (pts.length) break;
      if (pts.length > 2) poly(pts, 0.7, 0.4, tSec(x) + 0.06, tSec(x) + 0.08, ink);
    }
  }

  // C: advance outwash. Sets of cross-beds, the sloping foresets cut off flat by the set
  // above, and lenses of rounded pebbles lying along the bedding
  {
    const sets = [];
    for (let y = yC + 0.004; y < 0; ) { const h = R(0.011, 0.018); sets.push([y, y + h]); y += h; }
    for (const [y0, y1] of sets) {
      const top = x => Math.min(y1, yB(x) - 0.002), dir = rnd() < 0.7 ? 1 : -1, sl = R(16, 26) * DEG;
      // the set's base, a near-flat scour
      const base = [];
      for (let x = xL + 0.002; x <= xR - 0.002; x += 0.006) if (y0 < yB(x) - 0.003) base.push([x, y0 + 0.0008 * Math.sin(x * 40), ROOT]); else if (base.length) break;
      if (base.length > 3) poly(base, 0.8, 0.5, tSec(base[0][0]) + 0.1, tSec(base[0][0]) + 0.13, ink);
      for (let x = xL + R(0, 0.01); x < xR; x += R(0.007, 0.011)) {
        const h = top(x + 0.01) - y0; if (h < 0.004) continue;
        const dx = h / Math.tan(sl) * dir, x0 = x, x1 = x + dx;
        if (x1 < xL + 0.003 || x1 > xR - 0.003) continue;
        line(x0, top(x0) - 0.0005, ROOT, x1, y0 + 0.0008, ROOT, 0.65, R(0.3, 0.45), tSec(x0) + 0.11, 0.015, ink);
      }
    }
    for (let i = 0; i < 4; i++) {        // pebble lenses
      const cx = R(xL + 0.06, xR - 0.06), [y0, y1] = sets[Math.floor(rnd() * sets.length)], w = R(0.04, 0.09);
      for (let j = 0; j < 22; j++) {
        const x = cx + R(-w, w) * 0.5, y = lerp(y0, y1, R(0.15, 0.55));
        if (y > yB(x) - 0.004) continue;
        blob(x, y, R(0.0012, 0.0024), R(0.55, 0.75), R(-0.2, 0.2), 0.75, R(0.45, 0.62), tSec(x) + 0.12);
      }
    }
    for (let i = 0; i < 380; i++) {      // sand grains
      const x = R(xL + 0.003, xR - 0.003), y = R(yC + 0.002, yB(x) - 0.002);
      dot(x, y, R(0.7, 1.0), R(0.22, 0.38), tSec(x) + 0.12);
    }
  }

  // the depth break: tens of metres of outwash and older drift are left out here
  for (const yb of [yC, yD]) {
    const pts = [];
    for (let x = xL, i = 0; x <= xR + 1e-6; x += 0.009, i++) pts.push([x, yb + (i % 2 ? 0.0028 : -0.0028), ROOT]);
    poly(pts, 0.9, 0.62, 0.2, 0.24, ink);
  }

  // D: Puget Group bedrock. Sandstone in beds that dip gently, shale partings, and a coal
  // seam drawn solid
  {
    const dip = -3.5 * DEG, bed = (x, y0) => y0 + Math.tan(dip) * (x - xL);
    const inD = (x, y) => x > xL + 0.002 && x < xR - 0.002 && y < yD - 0.004 && y > yBot + 0.002;
    const coal0 = -0.178, coal1 = -0.1865;
    for (let y0 = yD + 0.01; y0 > yBot - 0.04; y0 -= R(0.006, 0.01)) {
      if (y0 < coal0 + 0.006 && y0 > coal1 - 0.004) continue;
      const shale = rnd() < 0.3, pts = [];
      for (let x = xL + 0.002; x <= xR - 0.002; x += 0.006) {
        const y = bed(x, y0);
        if (!inD(x, y)) { if (pts.length > 2) poly(pts.splice(0), 0.7, 0.42, tSec(pts[0] ? pts[0][0] : x) + 0.16, tSec(x) + 0.2, ink); pts.length = 0; continue; }
        if (shale && Math.floor(x * 160) % 2) { if (pts.length > 1) poly(pts.splice(0), 0.7, 0.45, tSec(x) + 0.16, tSec(x) + 0.18, ink); continue; }
        pts.push([x, y, ROOT]);
      }
      if (pts.length > 2) poly(pts, 0.7, 0.42, tSec(pts[0][0]) + 0.16, tSec(pts[0][0]) + 0.2, ink);
    }
    for (let x = xL + 0.003; x < xR - 0.003; x += 0.0024) {    // the coal: close hatching
      const a = bed(x, coal0), b = bed(x, coal1);
      line(x, a, ROOT, x - 0.0014, b, ROOT, 0.95, 0.72, tSec(x) + 0.18, 0.01, ink);
    }
    for (let i = 0; i < 260; i++) {                            // sand grains in the sandstone
      const x = R(xL + 0.003, xR - 0.003), y = R(yBot + 0.002, yD - 0.004);
      const a = bed(x, coal0), b = bed(x, coal1);
      if (y < a + 0.002 && y > b - 0.002) continue;
      dot(x, y, R(0.7, 1.0), R(0.25, 0.4), tSec(x) + 0.17);
    }
  }

  label(xR + 0.016, (groundY(xR) + yA(xR)) / 2, "<b>A</b> duff &amp; gravelly loam", { t: 0.2, cls: "sec" });
  label(xR + 0.016, (yA(xR) + yB(xR)) / 2, "<b>B</b> Vashon till, hardpan", { t: 0.24, cls: "sec" });
  label(xR + 0.016, (yB(xR) + yC) / 2, "<b>C</b> outwash sand &amp; gravel", { t: 0.28, cls: "sec" });
  label(xR + 0.016, (yD + yBot) / 2, "<b>D</b> sandstone &amp; coal", { t: 0.32, cls: "sec" });
  return { groundY, yA, yB, xL, xR, yBot, tSec };
}
