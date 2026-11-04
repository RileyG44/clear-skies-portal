/* ClearSkies sketchbook hero.
   A pen-and-ink Douglas-fir over a geologist's soil section, drawn with three.js.
   Every mark is a short ink stroke (an instanced quad) pinned to a bone. Bones form
   a hierarchy (trunk, branch, twig, fern frond) and each one is a damped angular
   spring, so a cursor brushing through the crown pushes the twigs it touches and,
   more weakly, the branches that carry them. The ground and the section never move.
   Strokes are drawn with multiply blending on white and the canvas is multiplied
   onto the paper, so overlapping lines darken the way real ink does. */
import * as THREE from "three";

const KIND = { STATIC: 0, TRUNK: 1, BRANCH: 2, TWIG: 3, FERN: 4 };
const INK = { GREEN: 0, SEPIA: 1, GRAPHITE: 2, BARK: 3 };
const DEG = Math.PI / 180;

// The drawing lives in "tree units": the trunk stands at x = 0 and is 1 tall.
export const VIEW = { cx: -0.01, cy: 0.405, w: 1.12, h: 1.42 };
const DRAW_SECONDS = 6.2;

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

export function buildTree(seed = 20261104) {
  const rnd = mulberry32(seed);
  const R = (a, b) => a + (b - a) * rnd();

  const seg = [], bon = [], sty = [], col = [];
  const line = (x0, y0, b0, x1, y1, b1, w, ink, t, dur, c) => {
    seg.push(x0, y0, x1, y1); bon.push(b0, b1); sty.push(w, clamp(ink, 0, 1), t, dur); col.push(c);
  };
  // pts = [[x, y, bone], ...]; the pen travels along it from t0 to t1
  const poly = (pts, w, ink, t0, t1, c) => {
    const n = pts.length - 1;
    for (let i = 0; i < n; i++) {
      const f = i / n, a = pts[i], b = pts[i + 1];
      line(a[0], a[1], a[2], b[0], b[1], b[2], typeof w === "function" ? w(f) : w,
        typeof ink === "function" ? ink(f) : ink, t0 + (t1 - t0) * f, (t1 - t0) / n * 1.2, c);
    }
  };
  const dashed = (x0, y0, x1, y1, dash, gap, w, ink, t0, t1, c) => {
    const L = Math.hypot(x1 - x0, y1 - y0), ux = (x1 - x0) / L, uy = (y1 - y0) / L;
    for (let a = 0; a < L; a += dash + gap) {
      const b = Math.min(L, a + dash);
      line(x0 + ux * a, y0 + uy * a, ROOT, x0 + ux * b, y0 + uy * b, ROOT, w, ink, lerp(t0, t1, a / L), (t1 - t0) * dash / L * 1.3, c);
    }
  };
  const circle = (cx, cy, r, w, ink, t, c, b = ROOT, n = 14, ry = r, rot = 0) => {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const a = i / n * Math.PI * 2, x = Math.cos(a) * r, y = Math.sin(a) * ry;
      pts.push([cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot), b]);
    }
    poly(pts, w, ink, t, t + 0.02, c);
  };

  const B = { ox: [], oy: [], ex: [], ey: [], par: [], kind: [], w0: [], zeta: [], m: [], ext: [] };
  const bone = (par, ox, oy, ex, ey, kind, w0, zeta, m, ext) => {
    const i = B.ox.length;
    B.ox.push(ox); B.oy.push(oy); B.ex.push(ex); B.ey.push(ey); B.par.push(par); B.kind.push(kind);
    B.w0.push(w0); B.zeta.push(zeta); B.m.push(m); B.ext.push(ext);
    return i;
  };
  const ROOT = bone(-1, 0, 0, 0, 0, KIND.STATIC, 0, 0, 0, 1);
  const labels = [];
  const label = (x, y, html, o = {}) => labels.push({ x, y, html, anchor: o.anchor || "l", rot: o.rot || 0, t: o.t ?? 0.9, cls: o.cls || "" });

  /* ---------- ground line ---------- */
  const g0 = 0.0035 * Math.sin(1.1) + 0.0025 * Math.sin(0.3);
  const groundY = x => 0.0035 * Math.sin(x * 8.3 + 1.1) + 0.0025 * Math.sin(x * 19.7 + 0.3) - 0.012 * x - g0;
  {
    for (const dir of [-1, 1]) {
      const pts = [];
      for (let x = 0; Math.abs(x) <= 0.5; x += dir * 0.004) pts.push([x, groundY(x) + R(-0.0004, 0.0004), ROOT]);
      poly(pts, f => lerp(1.5, 0.9, f), f => 0.85 - 0.35 * f * f, 0.0, 0.07, INK.SEPIA);
    }
    // a little duff and litter on the surface
    for (let i = 0; i < 70; i++) {
      const x = R(-0.47, 0.47), y = groundY(x) + R(0.0005, 0.003), a = R(-0.4, 0.4), l = R(0.003, 0.008);
      line(x, y, ROOT, x + Math.cos(a) * l, y + Math.sin(a) * l, ROOT, 0.8, R(0.35, 0.6), 0.04 + 0.05 * Math.abs(x), 0.01, INK.SEPIA);
    }
  }

  /* ---------- soil section (the geology) ---------- */
  const xL = -0.42, xR = 0.34, yBot = -0.205;
  const yA = x => groundY(x) - 0.03 + 0.003 * Math.sin(x * 13 + 2);
  const yB = x => -0.108 + 0.010 * Math.sin(x * 4.1 + 0.7) + 0.004 * Math.sin(x * 15 + 1);
  const tSec = x => 0.08 + 0.14 * (x - xL) / (xR - xL);
  {
    const edge = (x, ytop) => {
      const pts = [];
      for (let y = ytop; y >= yBot - 1e-6; y -= 0.006) pts.push([x + R(-0.0005, 0.0005), y, ROOT]);
      pts.push([x, yBot, ROOT]);
      poly(pts, 1.1, 0.75, 0.05, 0.1, INK.SEPIA);
    };
    edge(xL, groundY(xL)); edge(xR, groundY(xR));
    const bot = [];
    for (let x = xL; x <= xR + 1e-6; x += 0.006) bot.push([x, yBot + R(-0.0004, 0.0004), ROOT]);
    poly(bot, 1.1, 0.75, 0.08, 0.14, INK.SEPIA);
    // A/B contact is gradational: draw it dashed. B/C is a sharp contact on rock.
    for (let x = xL; x < xR - 0.004; x += 0.011) {
      const x1 = Math.min(xR, x + 0.0065);
      line(x, yA(x), ROOT, x1, yA(x1), ROOT, 0.9, 0.55, tSec(x), 0.01, INK.SEPIA);
    }
    const bc = [];
    for (let x = xL; x <= xR + 1e-6; x += 0.005) bc.push([x, yB(x), ROOT]);
    poly(bc, 1.15, 0.72, 0.1, 0.18, INK.SEPIA);

    // A horizon: duff and loam, stippled densest at the top
    for (let i = 0; i < 900; i++) {
      const x = R(xL + 0.003, xR - 0.003), top = groundY(x) - 0.0025, bt = yA(x) + 0.001;
      const y = top - (top - bt) * Math.pow(rnd(), 0.75);
      line(x, y, ROOT, x + 0.0004, y + 0.0002, ROOT, R(1.1, 1.7), R(0.35, 0.65), tSec(x) + 0.02, 0.01, INK.SEPIA);
    }
    for (let i = 0; i < 60; i++) { // short horizontal duff flecks
      const x = R(xL + 0.006, xR - 0.012), y = groundY(x) - R(0.002, 0.008), l = R(0.003, 0.007);
      line(x, y, ROOT, x + l, y + R(-0.001, 0.001), ROOT, 0.8, 0.45, tSec(x) + 0.02, 0.01, INK.SEPIA);
    }

    // B horizon: glacial till, unsorted pebbles and cobbles in a fine matrix
    const peb = [];
    for (let tries = 0; tries < 1400 && peb.length < 150; tries++) {
      const r = 0.0016 + 0.0065 * Math.pow(rnd(), 2.4);
      const x = R(xL + r + 0.002, xR - r - 0.002);
      const top = yA(x) - r - 0.002, bt = yB(x) + r + 0.002;
      if (top <= bt) continue;
      const y = R(bt, top);
      if (peb.some(p => Math.hypot(p[0] - x, p[1] - y) < p[2] + r + 0.0012)) continue;
      peb.push([x, y, r]);
      const n = 8, rot = R(0, 3), asp = R(0.6, 1), pts = [], jit = [];
      for (let i = 0; i < n; i++) jit.push(R(0.8, 1.12));
      for (let i = 0; i <= n; i++) {
        const a = i / n * Math.PI * 2, rr = r * jit[i % n], px = Math.cos(a) * rr, py = Math.sin(a) * rr * asp;
        pts.push([x + px * Math.cos(rot) - py * Math.sin(rot), y + px * Math.sin(rot) + py * Math.cos(rot), ROOT]);
      }
      poly(pts, r > 0.004 ? 1.0 : 0.85, R(0.5, 0.72), tSec(x) + 0.04, tSec(x) + 0.06, INK.SEPIA);
      if (r > 0.0045) { // shade the lower right of bigger clasts
        for (let k = 0; k < 3; k++) {
          const a = R(-1.2, -0.2), px = x + Math.cos(a) * r * 0.55, py = y + Math.sin(a) * r * 0.55 * asp;
          line(px - 0.0012, py - 0.0016, ROOT, px + 0.0012, py + 0.0016, ROOT, 0.7, 0.35, tSec(x) + 0.07, 0.01, INK.SEPIA);
        }
      }
    }
    for (let i = 0; i < 380; i++) {
      const x = R(xL + 0.003, xR - 0.003), y = R(yB(x) + 0.002, yA(x) - 0.002);
      if (peb.some(p => Math.hypot(p[0] - x, p[1] - y) < p[2] + 0.001)) continue;
      line(x, y, ROOT, x + 0.0003, y, ROOT, R(0.9, 1.3), R(0.3, 0.5), tSec(x) + 0.05, 0.01, INK.SEPIA);
    }

    // C: andesite bedrock. Diagonal hatch, steep joints, a scatter of phenocrysts.
    const inC = (x, y) => x > xL + 0.002 && x < xR - 0.002 && y < yB(x) - 0.003 && y > yBot + 0.002;
    const ha = 50 * DEG, hx = Math.cos(ha), hy = Math.sin(ha), nx = -hy, ny = hx;
    for (let k = -0.6; k < 0.6; k += 0.0058) {
      const ox = 0 + nx * k, oy = -0.16 + ny * k;
      let on = null;
      for (let s = -0.5; s <= 0.5; s += 0.002) {
        const x = ox + hx * s, y = oy + hy * s, inside = inC(x, y) && rnd() > 0.015;
        if (inside && !on) on = [x, y];
        if ((!inside || s + 0.002 > 0.5) && on) {
          if (Math.hypot(x - on[0], y - on[1]) > 0.003) line(on[0], on[1], ROOT, x, y, ROOT, 0.75, R(0.26, 0.38), tSec(on[0]) + 0.06, 0.02, INK.SEPIA);
          on = null;
        }
      }
    }
    for (let j = 0; j < 7; j++) {
      let x = R(xL + 0.03, xR - 0.03), y = yB(x) - 0.002; const pts = [[x, y, ROOT]];
      const a = R(-74, -62) * DEG;
      while (y > yBot + 0.004 && x > xL + 0.003 && x < xR - 0.003) {
        x += Math.cos(a + R(-0.25, 0.25)) * 0.009; y += Math.sin(a) * 0.009; pts.push([x, Math.max(y, yBot), ROOT]);
      }
      poly(pts, 1.05, 0.62, tSec(x) + 0.07, tSec(x) + 0.1, INK.SEPIA);
    }
    for (let i = 0; i < 110; i++) {
      const x = R(xL, xR), y = R(yBot, -0.11), a = R(0, Math.PI), l = R(0.0015, 0.003);
      if (!inC(x, y)) continue;
      line(x, y, ROOT, x + Math.cos(a) * l, y + Math.sin(a) * l, ROOT, 1.1, 0.5, tSec(x) + 0.08, 0.01, INK.SEPIA);
    }
    label(xR + 0.016, (groundY(xR) + yA(xR)) / 2, "<b>A</b> duff &amp; loam", { t: 0.2, cls: "sec" });
    label(xR + 0.016, (yA(xR) + yB(xR)) / 2, "<b>B</b> glacial till", { t: 0.24, cls: "sec" });
    label(xR + 0.016, (yB(xR) + yBot) / 2, "<b>C</b> andesite", { t: 0.28, cls: "sec" });
  }

  /* ---------- trunk ---------- */
  const tX = y => 0.0035 * Math.sin(y * 4.3 + 0.4) + 0.0022 * Math.sin(y * 11.7 + 1.3) - 0.0035 * Math.sin(0.4) - 0.0022 * Math.sin(1.3);
  const tR = y => 0.0205 * Math.pow(Math.max(0, 1 - y), 1.05) + 0.016 * Math.exp(-Math.max(y, 0) / 0.011) + 0.0009;
  const TN = 22, trunk = [];
  for (let i = 0; i < TN; i++) {
    const y0 = i / TN, y1 = (i + 1) / TN;
    trunk.push(bone(i ? trunk[i - 1] : ROOT, tX(y0), y0, tX(y1), y1, KIND.TRUNK, 1.4, 0.35, 0.8 / TN, 1 - y0));
  }
  const tb = y => trunk[clamp(Math.floor(y * TN), 0, TN - 1)];
  const shadeAt = x => 0.84 + 0.32 * clamp(x / 0.26 * 0.5 + 0.5, 0, 1); // lit from the upper left

  {
    for (const s of [-1, 1]) {
      const pts = [], ph = R(0, 9);
      for (let y = 0; y <= 1.0001; y += 0.0035) pts.push([tX(y) + s * tR(y) + 0.00035 * Math.sin(y * 90 + ph), y, tb(y)]);
      poly(pts, f => lerp(1.8, 0.7, f), f => f < 0.27 ? 0.95 : f < 0.34 ? lerp(0.95, 0.26, (f - 0.27) / 0.07) : 0.26, 0.12, 0.34, INK.GREEN);
      for (let i = 0; i < pts.length - 1; i++) {
        const y = pts[i][1];
        if (Math.sin(y * 41 + ph) > 0.3 && y < 0.3) {
          const off = -s * 0.0014;
          line(pts[i][0] + off, y, pts[i][2], pts[i + 1][0] + off, pts[i + 1][1], pts[i + 1][2], 0.8, 0.38, 0.12 + 0.22 * y, 0.01, INK.GREEN);
        }
      }
    }
    // a light wash of bark brown on the bole, a little heavier on the shaded right
    for (let y = 0; y < 0.8; y += 0.004) {
      const y1 = y + 0.0042, fade = y < 0.27 ? 1 : Math.max(0, 0.55 * (1 - (y - 0.27) / 0.5));
      if (fade <= 0) break;
      for (let s = -0.7; s <= 0.95; s += 0.22) {
        const sj = clamp(s + R(-0.05, 0.05), -0.95, 0.97), k = (sj + 1) / 2;
        line(tX(y) + sj * tR(y), y, tb(y), tX(y1) + sj * tR(y1), y1, tb(y1), R(1.6, 2.4), (y < 0.27 ? 0.16 + 0.34 * k * k : 0.1 + 0.28 * k * k) * fade, 0.18 + 0.2 * y, 0.008, INK.BARK);
      }
    }
    // deep, braided Douglas-fir bark furrows
    for (let k = 0; k < 30; k++) {
      let s = R(-0.94, 0.94), y = R(0.003, 0.05);
      const yEnd = rnd() < 0.7 ? R(0.24, 0.34) : R(0.34, 0.6);
      while (y < yEnd) {
        const n = Math.floor(R(5, 22)), w = R(0.75, 1.55);
        for (let j = 0; j < n && y < yEnd; j++) {
          const y1 = y + 0.004, s1 = clamp(s + R(-0.04, 0.04), -0.97, 0.97), fade = y < 0.27 ? 1 : 0.42;
          line(tX(y) + s * tR(y), y, tb(y), tX(y1) + s1 * tR(y1), y1, tb(y1), w, (0.3 + 0.42 * (s + 1) / 2) * fade, 0.2 + 0.17 * y, 0.006, INK.GREEN);
          y = y1; s = s1;
        }
        y += 0.004 * Math.floor(R(1, 4));
      }
    }
    // cross-contour shading on the shaded side
    for (let y = 0.006; y < 0.6; y += R(0.0032, 0.0052)) {
      const s0 = R(0.18, 0.5), s1 = R(0.9, 0.98), fade = y < 0.27 ? 1 : 0.4, pts = [];
      for (let i = 0; i <= 3; i++) {
        const s = lerp(s0, s1, i / 3);
        pts.push([tX(y) + s * tR(y), y - 0.0028 * Math.sqrt(1 - s * s), tb(y)]);
      }
      poly(pts, 0.75, R(0.18, 0.3) * fade, 0.24 + 0.15 * y, 0.26 + 0.15 * y, INK.GREEN);
    }
    // root flare and roots running down into the soil
    for (const s of [-1, 1]) for (let k = 0; k < 3; k++) {
      const pts = [];
      const x0 = s * R(0.016, 0.03), y0 = R(0.01, 0.03), x1 = s * R(0.045, 0.075);
      for (let i = 0; i <= 8; i++) { const f = i / 8; pts.push([lerp(x0, x1, f), lerp(y0, groundY(x1), Math.pow(f, 0.55)) + 0.0005, ROOT]); }
      poly(pts, f => lerp(1.4, 0.8, f), 0.8, 0.12, 0.16, INK.GREEN);
    }
    const root = (x, y, th, len, w, depth, t) => {
      const pts = [[x, y, ROOT]];
      for (let d = 0; d < len; d += 0.006) {
        th += R(-0.28, 0.28) + 0.06 * (-Math.PI / 2 - th);
        x += Math.cos(th) * 0.006; y += Math.sin(th) * 0.006;
        if (x < xL + 0.004 || x > xR - 0.004 || y < yB(x) - 0.01) break;
        pts.push([x, y, ROOT]);
        if (depth < 3 && rnd() < 0.09) root(x, y, th + R(-0.9, 0.9), len * R(0.3, 0.55), w * 0.65, depth + 1, t + 0.02);
      }
      poly(pts, f => Math.max(0.6, w * (1 - 0.6 * f)), 0.42, t, t + 0.05, INK.GREEN);
    };
    for (let k = 0; k < 8; k++) {
      const s = k % 2 ? 1 : -1;
      root(s * R(0.004, 0.03), groundY(0) - 0.003, -Math.PI / 2 + s * R(0.25, 1.2), R(0.05, 0.13), R(1.2, 1.8), 0, 0.15);
    }
  }

  /* ---------- needles: the pen's main work ---------- */
  // P = [[x, y, bone], ...] along a twig; needles go out on both sides, angled forward
  // and pulled a little downward, shorter towards the tip.
  const spray = (P, t0, dt, inkK, u, density = 1) => {
    const cum = [0];
    for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    const total = cum[cum.length - 1];
    if (total <= 0) return;
    let i = 0;
    for (let a = R(0, 0.002); a < total; a += R(0.0022, 0.0032) / density) {
      while (i < P.length - 2 && cum[i + 1] < a) i++;
      const f = (a - cum[i]) / Math.max(1e-6, cum[i + 1] - cum[i]);
      const x = lerp(P[i][0], P[i + 1][0], f), y = lerp(P[i][1], P[i + 1][1], f);
      let dx = P[i + 1][0] - P[i][0], dy = P[i + 1][1] - P[i][1]; const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
      const b = f < 0.5 ? P[i][2] : P[i + 1][2];
      const tipF = Math.min(1, (total - a) / 0.012);
      for (const sd of [-1, 1]) {
        if (rnd() < 0.2) continue;
        const ang = sd * R(22, 88) * DEG, c = Math.cos(ang), sn = Math.sin(ang);
        let nx = dx * c - dy * sn, ny = dx * sn + dy * c - R(0.1, 0.5);
        const nl0 = Math.hypot(nx, ny); nx /= nl0; ny /= nl0;
        const nl = R(0.0045, 0.0115) * (0.5 + 0.5 * tipF) * (0.82 + 0.18 * (1 - u));
        const ink = R(0.46, 0.8) * inkK * shadeAt(x) * (ny < -0.4 ? 1.1 : 0.93);
        line(x + nx * 0.0006, y + ny * 0.0006, b, x + nx * nl, y + ny * nl, b, R(0.7, 1.05), ink, t0 + dt * a / total, 0.012, INK.GREEN);
      }
    }
  };

  const bendPath = (x, y, th, len, n, droop, wob) => {
    const pts = [[x, y]];
    for (let i = 0; i < n; i++) {
      let diff = -Math.PI / 2 - th;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      th += diff * droop / n * 1.4 + R(-wob, wob);
      x += Math.cos(th) * len / n; y += Math.sin(th) * len / n; pts.push([x, y]);
    }
    return pts;
  };

  const twig = (x, y, dx, dy, Lb, droop, parB, t0, inkK, u) => {
    const pts = bendPath(x, y, Math.atan2(dy, dx), Lb, 6, droop, 0.08);
    const end = pts[pts.length - 1];
    const b = bone(parB, x, y, end[0], end[1], KIND.TWIG, 3.0 / Math.sqrt(Lb), 0.15, Lb * 2, Lb);
    const P = pts.map(p => [p[0], p[1], b]);
    poly(P, 0.8, 0.55 * inkK, t0, t0 + 0.02, INK.GREEN);
    spray(P, t0 + 0.012, 0.03, inkK, u);
    if (Lb > 0.03) {
      const k = Lb > 0.055 ? 3 : 2;
      for (let j = 0; j < k; j++) {
        const f = R(0.2, 0.75), i = Math.min(5, Math.floor(f * 6)), p = pts[i], q = pts[i + 1];
        const th = Math.atan2(q[1] - p[1], q[0] - p[0]) + (j % 2 ? 1 : -1) * R(35, 58) * DEG;
        const sub = bendPath(p[0], p[1], th, Lb * R(0.3, 0.46), 4, droop * 0.8, 0.1).map(s => [s[0], s[1], b]);
        poly(sub, 0.7, 0.55 * inkK, t0 + 0.015, t0 + 0.03, INK.GREEN);
        spray(sub, t0 + 0.02, 0.025, inkK, u);
      }
    }
    return b;
  };

  /* ---------- crown ---------- */
  const crownR = h => {
    const u = (h - 0.27) / 0.73;
    return (0.30 * Math.pow(Math.max(0, 1 - u), 0.82) + 0.012) * (1 - 0.26 * smooth(0.14, 0, u));
  };
  const branches = [];
  const makeBranch = (h, s, fore) => {
    const u = clamp((h - 0.27) / 0.73, 0, 1);
    const clump = 0.78 + 0.22 * Math.sin(h * 31 + 1.7) * Math.sin(h * 9.3 + s * 2.1);
    let L = crownR(h) * R(0.62, 1.12) * clump, back = false;
    if (fore) { L *= R(0.22, 0.42); back = rnd() < 0.35; }
    let th0 = (lerp(-22, 38, Math.pow(u, 0.8)) + R(-9, 9)) * DEG;
    if (fore) th0 = -R(38, 72) * DEG + u * 30 * DEG;
    const g = lerp(56, 16, u) * DEG * R(0.8, 1.2), tip = lerp(78, 18, u) * DEG * R(0.8, 1.2);
    const M = 20, P = [], nz = R(0, 6.3);
    let x = tX(h) + s * tR(h) * 0.4, y = h;
    for (let i = 0; i <= M; i++) {
      const v = i / M, th = th0 - g * v + tip * v * v * v + 0.07 * Math.sin(v * 8 + nz);
      P.push({ x, y, v, dx: s * Math.cos(th), dy: Math.sin(th) });
      x += s * Math.cos(th) * L / M; y += Math.sin(th) * L / M;
    }
    const NB = L > 0.12 ? 5 : L > 0.05 ? 3 : 2, bones = [];
    let par = tb(h);
    for (let j = 0; j < NB; j++) {
      const i0 = Math.round(j * M / NB), i1 = Math.round((j + 1) * M / NB);
      par = bone(par, P[i0].x, P[i0].y, P[i1].x, P[i1].y, KIND.BRANCH, 2.6 / Math.sqrt(L) * (1.35 - 0.1 * j), 0.13, L / NB, L * (1 - j / NB) + 0.03);
      bones.push(par);
    }
    const boneAt = v => bones[Math.min(NB - 1, Math.floor(v * NB + 1e-6))];
    const at = v => {
      const f = v * M, i = Math.min(M - 1, Math.floor(f)), r = f - i, a = P[i], b = P[i + 1];
      return { x: lerp(a.x, b.x, r), y: lerp(a.y, b.y, r), dx: a.dx, dy: a.dy };
    };
    const t0 = 0.3 + 0.36 * u + R(0, 0.015), inkK = back ? 0.5 : 1;
    // light brown shading along the underside of each limb
    poly(P.map(p => [p.x, p.y - 0.001, boneAt(p.v)]), f => lerp(2.2, 0.9, u) * (1 - 0.6 * f) + 0.5, f => lerp(0.45, 0.14, f) * inkK, t0 + 0.01, t0 + 0.06, INK.BARK);
    poly(P.map(p => [p.x, p.y, boneAt(p.v)]), f => (lerp(1.9, 0.8, u) * (1 - 0.6 * f) + 0.3) * (fore ? 0.8 : 1), f => lerp(0.42, 0.28, f) * inkK, t0, t0 + 0.05, INK.GREEN);

    let d = R(0.004, 0.012), side = rnd() < 0.5 ? 1 : -1;
    while (d < L * 0.97) {
      const v = d / L;
      if (v > (fore ? 0.02 : 0.05)) {
        const p = at(v); side = -side;
        const up = side > 0, rot = (up ? s : -s) * R(28, 62) * DEG, c = Math.cos(rot), sn = Math.sin(rot);
        const Lb = Math.min(0.08, 0.24 * (L - d) + 0.016) * R(0.65, 1.2) * (up ? 0.6 : 1.08) * (fore ? 0.7 : 1);
        if (!up || rnd() < 0.75) twig(p.x, p.y, p.dx * c - p.dy * sn, p.dx * sn + p.dy * c, Lb, up ? R(0.05, 0.2) : R(0.3, 0.75) * (1 - 0.5 * u), boneAt(v), t0 + 0.035 + 0.05 * v, inkK, u);
      }
      d += R(0.009, 0.017);
    }
    spray(P.filter(p => p.v > 0.42).map(p => [p.x, p.y, boneAt(p.v)]), t0 + 0.05, 0.03, inkK, u);

    if (!fore) { // tone under each tier: short, near-vertical hatching
      const n = Math.floor(L / 0.0042);
      for (let k = 0; k < n; k++) {
        const v = R(0.12, 0.96), p = at(v), off = R(0.004, 0.02) * (1 - 0.35 * v) * (1 - 0.5 * u);
        const cx = p.x + R(-0.005, 0.005), cy = p.y - off, a = (72 + R(-6, 6)) * DEG, hl = R(0.006, 0.013);
        line(cx - Math.cos(a) * hl / 2, cy - Math.sin(a) * hl / 2, boneAt(v), cx + Math.cos(a) * hl / 2, cy + Math.sin(a) * hl / 2, boneAt(v),
          0.8, R(0.18, 0.32) * shadeAt(cx) * 1.1, t0 + 0.12 + R(0, 0.05), 0.012, INK.GREEN);
      }
    }
    branches.push({ u, L, at, boneAt, t0, fore });
  };

  let h = 0.272;
  while (h < 0.972) {
    const u = (h - 0.27) / 0.73;
    for (const s of rnd() < 0.5 ? [-1, 1] : [1, -1]) if (rnd() < 0.93) makeBranch(h + R(-0.004, 0.004), s, false);
    if (rnd() < 0.62) makeBranch(h + R(-0.004, 0.004), rnd() < 0.5 ? -1 : 1, true);
    h += (0.0075 + 0.013 * (1 - u)) * R(0.75, 1.3) + (rnd() < 0.08 ? 0.02 * (1 - u) : 0);
  }
  // deep shade inside the crown, close to the trunk, so the bole reads as hidden
  for (let y = 0.3; y < 0.93; y += 0.0026) {
    const w = crownR(y) * 0.32, x = tX(y) + R(-w, w), a = (72 + R(-8, 8)) * DEG, hl = R(0.006, 0.014);
    line(x - Math.cos(a) * hl / 2, y - Math.sin(a) * hl / 2, tb(y), x + Math.cos(a) * hl / 2, y + Math.sin(a) * hl / 2, tb(y),
      0.8, R(0.22, 0.4) * shadeAt(x), 0.4 + 0.36 * (y - 0.27) / 0.73, 0.012, INK.GREEN);
  }
  // the leader: a slim spire of needles on the last of the trunk
  {
    const P = [];
    for (let y = 0.95; y <= 1.0001; y += 0.005) P.push([tX(y), y, tb(Math.min(y, 0.999))]);
    spray(P, 0.66, 0.03, 1, 1, 1.3);
  }
  // dead lower limbs, typical of a forest-grown Douglas-fir
  for (let k = 0; k < 11; k++) {
    const hh = R(0.09, 0.265), s = rnd() < 0.5 ? -1 : 1, L = R(0.008, 0.04) * (hh / 0.27 + 0.3);
    const a = R(-48, -10) * DEG, b = tb(hh), x0 = tX(hh) + s * tR(hh) * 0.9;
    const x1 = x0 + s * Math.cos(a) * L, y1 = hh + Math.sin(a) * L;
    poly([[x0, hh, b], [lerp(x0, x1, 0.55), lerp(hh, y1, 0.55) + 0.0015, b], [x1, y1, b]], f => lerp(1.5, 0.7, f), 0.75, 0.24 + hh * 0.2, 0.27 + hh * 0.2, INK.GREEN);
    poly([[x0, hh - 0.001, b], [x1, y1 - 0.001, b]], f => lerp(2, 0.8, f), 0.25, 0.25 + hh * 0.2, 0.28 + hh * 0.2, INK.BARK);
    if (L > 0.02) {
      const xm = lerp(x0, x1, 0.6), ym = lerp(hh, y1, 0.6), a2 = a + s * 0.7, l2 = L * 0.4;
      line(xm, ym, b, xm + s * Math.cos(a2) * l2, ym + Math.sin(a2) * l2, b, 0.7, 0.6, 0.27 + hh * 0.2, 0.01, INK.GREEN);
    }
  }
  // Douglas-fir cones hang below the branches, with three-pointed bracts
  {
    const upper = branches.filter(b => b.u > 0.42 && b.L > 0.05 && !b.fore);
    for (let k = 0; k < 16 && upper.length; k++) {
      const br = upper[Math.floor(rnd() * upper.length)], v = R(0.45, 0.85), p = br.at(v), b = br.boneAt(v);
      const cx = p.x, cy = p.y - 0.011, rot = R(-0.2, 0.2) + Math.PI / 2;
      circle(cx, cy, 0.0085, 0.85, 0.75, br.t0 + 0.2, INK.GREEN, b, 12, 0.0042, rot);
      for (let j = -1; j <= 1; j++) {
        const yy = cy + j * 0.004;
        line(cx - 0.003, yy + 0.001, b, cx + 0.003, yy - 0.001, b, 0.7, 0.5, br.t0 + 0.21, 0.01, INK.GREEN);
      }
      for (let j = -1; j <= 1; j++) line(cx + j * 0.0015, cy - 0.006, b, cx + j * 0.0025, cy - 0.0095, b, 0.7, 0.6, br.t0 + 0.22, 0.01, INK.GREEN);
    }
  }

  /* ---------- understory: sword ferns and grass at the foot of the tree ---------- */
  for (const [fx, n, sc] of [[-0.085, 8, 1], [0.095, 7, 0.85], [-0.15, 4, 0.5], [0.26, 5, 0.55]]) {
    const base = groundY(fx);
    for (let k = 0; k < n; k++) {
      const f = n === 1 ? 0 : k / (n - 1), a = (lerp(-72, 72, f) + R(-8, 8)) * DEG, L = R(0.05, 0.085) * sc * (1 - 0.35 * Math.abs(f - 0.5));
      const pts = [];
      let x = fx + R(-0.004, 0.004), y = base, th = Math.PI / 2 - a;
      for (let i = 0; i <= 12; i++) {
        pts.push([x, y]);
        th += (Math.sign(a) || 1) * -0.035 * (1 + Math.abs(a));
        x += Math.cos(th) * L / 12; y += Math.sin(th) * L / 12;
      }
      const end = pts[12];
      const b = bone(ROOT, pts[0][0], pts[0][1], end[0], end[1], KIND.FERN, 5.5, 0.16, L * 1.5, L);
      const t0 = 0.22 + 0.05 * f;
      poly(pts.map(p => [p[0], p[1], b]), 0.85, 0.7, t0, t0 + 0.03, INK.GREEN);
      for (let i = 2; i < 12; i++) {
        const p = pts[i], q = pts[i + 1], dx = q[0] - p[0], dy = q[1] - p[1], dl = Math.hypot(dx, dy);
        const ux = dx / dl, uy = dy / dl, pl = 0.0065 * sc * Math.sin(Math.PI * (i - 1) / 12) + 0.0015;
        for (const sd of [-1, 1]) {
          const c = Math.cos(sd * 62 * DEG), sn = Math.sin(sd * 62 * DEG);
          const vx = ux * c - uy * sn, vy = ux * sn + uy * c;
          line(p[0], p[1], b, p[0] + vx * pl, p[1] + vy * pl, b, 0.85, 0.58, t0 + 0.03 * i / 12, 0.01, INK.GREEN);
        }
      }
    }
  }
  for (let i = 0; i < 46; i++) {
    const x = R(-0.47, 0.47);
    if (Math.abs(x) < 0.035) continue;
    const y = groundY(x), n = Math.floor(R(3, 6));
    for (let k = 0; k < n; k++) {
      const a = (90 + R(-28, 28)) * DEG, l = R(0.004, 0.012);
      line(x + R(-0.002, 0.002), y, ROOT, x + Math.cos(a) * l, y + Math.sin(a) * l, ROOT, 0.75, R(0.35, 0.6), 0.2 + 0.08 * Math.abs(x), 0.01, INK.GREEN);
    }
  }
  /* ---------- annotations, in graphite ---------- */
  {
    const xd = 0.385, ta = 0.82;
    poly([[xd, groundY(xd), ROOT], [xd, 1.0, ROOT]], 0.8, 0.55, ta, ta + 0.04, INK.GRAPHITE);
    for (const y of [groundY(xd), 1.0]) line(xd - 0.012, y, ROOT, xd + 0.012, y, ROOT, 0.8, 0.6, ta, 0.01, INK.GRAPHITE);
    for (const [y, s] of [[groundY(xd), 1], [1.0, -1]]) {
      line(xd, y, ROOT, xd - 0.0045, y + s * 0.012, ROOT, 0.8, 0.6, ta + 0.04, 0.01, INK.GRAPHITE);
      line(xd, y, ROOT, xd + 0.0045, y + s * 0.012, ROOT, 0.8, 0.6, ta + 0.04, 0.01, INK.GRAPHITE);
    }
    dashed(0.012, 1.0, xd - 0.016, 1.0, 0.006, 0.006, 0.7, 0.45, ta, ta + 0.03, INK.GRAPHITE);
    label(xd + 0.014, 0.5, "38.4 m &middot; canopy height", { anchor: "c", rot: -90, t: 0.88, cls: "dim" });

    // one lidar pulse: first return on the crown, last return on bare earth
    const xr = -0.2;
    let hit = 0;
    for (let i = 0; i < col.length; i++) {
      if (col[i] !== INK.GREEN) continue;
      for (const k of [0, 2]) {
        const x = seg[i * 4 + k], y = seg[i * 4 + k + 1];
        if (Math.abs(x - xr) < 0.0028 && y > hit) hit = y;
      }
    }
    const tl = 0.86, gy = groundY(xr);
    dashed(xr, 1.06, xr, hit + 0.006, 0.01, 0.007, 0.8, 0.6, tl, tl + 0.03, INK.GRAPHITE);
    circle(xr, hit, 0.0045, 0.8, 0.7, tl + 0.03, INK.GRAPHITE);
    dashed(xr, hit - 0.006, xr, gy + 0.004, 0.003, 0.008, 0.7, 0.4, tl + 0.03, tl + 0.07, INK.GRAPHITE);
    line(xr - 0.004, gy - 0.004 + 0.002, ROOT, xr + 0.004, gy + 0.004 + 0.002, ROOT, 0.9, 0.75, tl + 0.07, 0.01, INK.GRAPHITE);
    line(xr - 0.004, gy + 0.004 + 0.002, ROOT, xr + 0.004, gy - 0.004 + 0.002, ROOT, 0.9, 0.75, tl + 0.075, 0.01, INK.GRAPHITE);
    label(xr - 0.014, hit + 0.004, "first return", { anchor: "r", t: 0.9 });
    label(xr - 0.014, gy + 0.016, "last return &middot; bare earth", { anchor: "r", t: 0.93 });

    // species note with a leader to the upper crown
    const lp = [[-0.17, 0.905, ROOT], [-0.12, 0.902, ROOT], [-0.075, 0.893, ROOT], [-0.035, 0.879, ROOT]];
    poly(lp, 0.75, 0.55, 0.84, 0.87, INK.GRAPHITE);
    label(-0.176, 0.905, "<i>Pseudotsuga menziesii</i><br>Douglas-fir, west slope", { anchor: "r", t: 0.86, cls: "sp" });
    label(-0.04, yBot - 0.03, "Fig. 1 &nbsp;Old Douglas-fir on glacial till over andesite, North Cascades", { anchor: "c", t: 0.97, cls: "cap" });
  }

  let tipY = 0;
  for (let i = 0; i < col.length; i++) if (col[i] === INK.GREEN && Math.abs(seg[i * 4]) < 0.03) tipY = Math.max(tipY, seg[i * 4 + 1], seg[i * 4 + 3]);

  /* ---------- bone physics constants ---------- */
  const n = B.ox.length, mSub = Float32Array.from(B.m);
  for (let b = n - 1; b > 0; b--) if (B.par[b] >= 0) mSub[B.par[b]] += mSub[b];
  const invI = new Float32Array(n);
  for (let b = 0; b < n; b++) {
    const I = Math.max(1e-6, mSub[b] * B.ext[b] * B.ext[b] / 3);
    // branches get a little more give than a rigid rod would, so a sweep visibly lifts the bough
    invI[b] = B.kind[b] === KIND.STATIC ? 0 : B.kind[b] === KIND.TRUNK ? 0.15 / I : B.kind[b] === KIND.BRANCH ? 3 / I : 1 / I;
  }
  return {
    count: col.length, nb: n, labels, anchors: { tip: tipY, rock: yBot },
    seg: new Float32Array(seg), bon: new Float32Array(bon), sty: new Float32Array(sty), col: new Float32Array(col),
    bones: {
      ox: Float32Array.from(B.ox), oy: Float32Array.from(B.oy), ex: Float32Array.from(B.ex), ey: Float32Array.from(B.ey),
      par: Int32Array.from(B.par), kind: Uint8Array.from(B.kind), w0: Float32Array.from(B.w0), zeta: Float32Array.from(B.zeta),
      m: Float32Array.from(B.m), invI
    }
  };
}

const VS = /* glsl */`
precision highp float;
precision highp sampler2D;
attribute vec4 aSeg;
attribute vec2 aBone;
attribute vec4 aStyle;
attribute float aCol;
uniform sampler2D uBones;
uniform vec2 uCenter;
uniform float uScale;
uniform vec2 uRes;
uniform float uDpr;
uniform float uDraw;
varying float vAlong;
varying float vDist;
varying float vHalf;
varying float vInk;
varying float vCol;
varying float vReveal;
varying float vWet;
vec2 xf(vec2 p, float b){
  int i = int(b + 0.5);
  vec4 t = texelFetch(uBones, ivec2(i % 64, i / 64), 0);
  return vec2(t.x * p.x - t.y * p.y, t.y * p.x + t.x * p.y) + t.zw;
}
void main(){
  vec2 a = (xf(aSeg.xy, aBone.x) - uCenter) * uScale * uDpr;
  vec2 b = (xf(aSeg.zw, aBone.y) - uCenter) * uScale * uDpr;
  vec2 d = b - a;
  float L = length(d);
  vec2 dir = L > 1e-4 ? d / L : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float w = aStyle.x * uDpr;
  float halfW = max(w, 0.9 * uDpr) * 0.5;
  float pad = halfW + 1.0;
  vec2 pos = a + d * position.x + nrm * position.y * pad;
  gl_Position = vec4(pos / (uRes * 0.5), 0.0, 1.0);
  vAlong = position.x;
  vDist = position.y * pad;
  vHalf = halfW;
  vInk = aStyle.y * min(1.0, w / (0.9 * uDpr));
  vCol = aCol;
  float since = uDraw - aStyle.z;
  vReveal = since / max(aStyle.w, 1e-4);
  vWet = clamp(1.0 - (since - aStyle.w) / 0.07, 0.0, 1.0);
}`;

const FS = /* glsl */`
precision highp float;
uniform vec3 uInk0;
uniform vec3 uInk1;
uniform vec3 uInk2;
uniform vec3 uInk3;
varying float vAlong;
varying float vDist;
varying float vHalf;
varying float vInk;
varying float vCol;
varying float vReveal;
varying float vWet;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main(){
  if (vReveal < vAlong) discard;
  float cov = clamp(vHalf + 0.5 - abs(vDist), 0.0, 1.0);
  float grain = hash(floor(gl_FragCoord.xy));
  float a = vInk * cov * (0.86 + 0.14 * grain);
  vec3 ink = vCol < 0.5 ? uInk0 : vCol < 1.5 ? uInk1 : vCol < 2.5 ? uInk2 : uInk3;
  ink *= 1.0 - 0.3 * vWet;           // fresh ink is darker, then dries
  a = min(1.0, a * (1.0 + 0.4 * vWet));
  gl_FragColor = vec4(mix(vec3(1.0), ink, a), 1.0);
}`;

export function createSketch(canvas, layer, opts = {}) {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "high-performance" }); }
  catch (e) { opts.onNoWebGL && opts.onNoWebGL(); return null; }
  renderer.setClearColor(0xffffff, 1);

  const T = buildTree(opts.seed);
  const n = T.nb, BW = 64, BH = Math.ceil(n / BW), Bn = T.bones;
  const data = new Float32Array(BW * BH * 4);
  const tex = new THREE.DataTexture(data, BW, BH, THREE.RGBAFormat, THREE.FloatType);
  tex.magFilter = tex.minFilter = THREE.NearestFilter;

  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 0, 1, 0, 1, 1, 0], 3));
  geo.setIndex([0, 1, 2, 2, 1, 3]);
  geo.setAttribute("aSeg", new THREE.InstancedBufferAttribute(T.seg, 4));
  geo.setAttribute("aBone", new THREE.InstancedBufferAttribute(T.bon, 2));
  geo.setAttribute("aStyle", new THREE.InstancedBufferAttribute(T.sty, 4));
  geo.setAttribute("aCol", new THREE.InstancedBufferAttribute(T.col, 1));
  geo.instanceCount = T.count;

  const U = {
    uBones: { value: tex }, uCenter: { value: new THREE.Vector2(VIEW.cx, VIEW.cy) }, uScale: { value: 600 },
    uRes: { value: new THREE.Vector2(1, 1) }, uDpr: { value: 1 }, uDraw: { value: reduce ? 1.2 : 0 },
    uInk0: { value: new THREE.Color(0.16, 0.53, 0.37) },   // emerald
    uInk1: { value: new THREE.Color(0.47, 0.37, 0.27) },   // iron-oxide sepia
    uInk2: { value: new THREE.Color(0.33, 0.32, 0.30) },   // graphite
    uInk3: { value: new THREE.Color(0.62, 0.42, 0.25) }      // light bark brown
  };
  const mat = new THREE.ShaderMaterial({
    vertexShader: VS, fragmentShader: FS, uniforms: U, transparent: true, depthTest: false, depthWrite: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.DstColorFactor, blendDst: THREE.ZeroFactor
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene(); scene.add(mesh);
  const cam = new THREE.OrthographicCamera();

  /* labels */
  const els = T.labels.map(l => {
    const el = document.createElement("div");
    el.className = "lbl " + l.cls; el.innerHTML = l.html; layer.appendChild(el);
    return el;
  });

  /* physics state */
  const ang = new Float32Array(n), vel = new Float32Array(n), tau = new Float32Array(n);
  const A = new Float32Array(n), C = new Float32Array(n), S = new Float32Array(n), TX = new Float32Array(n), TY = new Float32Array(n);
  const k = new Float32Array(n), c = new Float32Array(n), lim = new Float32Array(n), ph = new Float32Array(n), fq = new Float32Array(n);
  for (let b = 0; b < n; b++) {
    const w = Bn.w0[b]; k[b] = w * w; c[b] = 2 * Bn.zeta[b] * w;
    lim[b] = Bn.kind[b] === KIND.TWIG ? 0.55 : Bn.kind[b] === KIND.BRANCH ? 0.22 : Bn.kind[b] === KIND.FERN ? 0.4 : 0.02;
    ph[b] = Math.random() * 6.28; fq[b] = 2.5 + Math.random() * 4;
  }
  const P = { gain: opts.gain ?? 2.4, breeze: opts.breeze ?? 0.16, decay: 0.72 };

  function pose() {
    for (let b = 0; b < n; b++) {
      const p = Bn.par[b], d = ang[b], ox = Bn.ox[b], oy = Bn.oy[b];
      const cd = Math.cos(d), sd = Math.sin(d), qx = ox - (cd * ox - sd * oy), qy = oy - (sd * ox + cd * oy);
      if (p < 0) { A[b] = d; C[b] = cd; S[b] = sd; TX[b] = qx; TY[b] = qy; }
      else {
        const a = A[p] + d, cp = C[p], sp = S[p];
        A[b] = a; C[b] = Math.cos(a); S[b] = Math.sin(a);
        TX[b] = cp * qx - sp * qy + TX[p]; TY[b] = sp * qx + cp * qy + TY[p];
      }
      const o = b * 4; data[o] = C[b]; data[o + 1] = S[b]; data[o + 2] = TX[b]; data[o + 3] = TY[b];
    }
    tex.needsUpdate = true;
  }
  // a force F at point (px, py) turns the bone it touches and, more weakly, its ancestors
  function push(b, px, py, fx, fy) {
    let f = 1;
    while (b > 0 && f > 0.03) {
      const ox = C[b] * Bn.ox[b] - S[b] * Bn.oy[b] + TX[b], oy = S[b] * Bn.ox[b] + C[b] * Bn.oy[b] + TY[b];
      tau[b] += f * ((px - ox) * fy - (py - oy) * fx);
      if (Bn.kind[b] === KIND.TRUNK) break;
      f *= P.decay; b = Bn.par[b];
    }
  }

  const ptr = { x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, in: false, fresh: false };
  let time = 0;
  function physics(dt) {
    tau.fill(0);
    if (P.breeze > 0) {
      for (let b = 1; b < n; b++) {
        const kd = Bn.kind[b];
        if (kd < KIND.TWIG) continue;
        const mx = (Bn.ox[b] + Bn.ex[b]) / 2, my = (Bn.oy[b] + Bn.ey[b]) / 2;
        const g = 0.25 + 0.75 * Math.pow(0.5 + 0.5 * Math.sin(2.1 * mx - 0.85 * time + 0.7 * Math.sin(0.29 * time + 2.3 * my)), 3);
        const fl = Math.sin(time * fq[b] + ph[b]), W = P.breeze * Bn.m[b] * (kd === KIND.FERN ? 0.5 : 1);
        const cx = C[b] * mx - S[b] * my + TX[b], cy = S[b] * mx + C[b] * my + TY[b];
        push(b, cx, cy, W * (g + 0.2 * fl), W * 0.45 * fl * g);
      }
    }
    if (ptr.in && (ptr.vx || ptr.vy)) {
      const sp = Math.hypot(ptr.vx, ptr.vy), sc = sp > 2.5 ? 2.5 / sp : 1, vx = ptr.vx * sc, vy = ptr.vy * sc;
      for (let b = 1; b < n; b++) {
        const kd = Bn.kind[b];
        if (kd < KIND.BRANCH) continue;
        const ox = C[b] * Bn.ox[b] - S[b] * Bn.oy[b] + TX[b], oy = S[b] * Bn.ox[b] + C[b] * Bn.oy[b] + TY[b];
        const ex = C[b] * Bn.ex[b] - S[b] * Bn.ey[b] + TX[b], ey = S[b] * Bn.ex[b] + C[b] * Bn.ey[b] + TY[b];
        const dx = ex - ox, dy = ey - oy, L2 = dx * dx + dy * dy || 1e-9;
        const t = clamp(((ptr.x - ox) * dx + (ptr.y - oy) * dy) / L2, 0, 1), qx = ox + dx * t, qy = oy + dy * t;
        const d = Math.hypot(ptr.x - qx, ptr.y - qy), r = kd === KIND.BRANCH ? 0.03 : 0.024, ra = 0.075;
        if (d > ra) continue;
        const f = (d < r ? (1 - d / r) ** 2 : 0) + 0.22 * (1 - d / ra) ** 2;
        const F = P.gain * f * Bn.m[b];
        push(b, qx, qy, vx * F, vy * F);
      }
    }
    const steps = 3, h = dt / steps;
    for (let s = 0; s < steps; s++) {
      for (let b = 1; b < n; b++) {
        if (Bn.kind[b] === KIND.STATIC) continue;
        vel[b] += (-k[b] * ang[b] - c[b] * vel[b] + tau[b] * Bn.invI[b]) * h;
        const a = ang[b] + vel[b] * h;
        if (a > lim[b] || a < -lim[b]) { ang[b] = Math.sign(a) * lim[b]; vel[b] *= -0.3; } else ang[b] = a;
      }
    }
  }

  let view = { w: 1, h: 1, scale: 1, dpr: 1, left: 0, top: 0 };
  function layout() {
    const r = canvas.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    const scale = Math.min(h / VIEW.h, w / VIEW.w);
    view = { w, h, scale, dpr, left: r.left, top: r.top };
    renderer.setPixelRatio(dpr); renderer.setSize(w, h, false);
    U.uRes.value.set(w * dpr, h * dpr); U.uDpr.value = dpr; U.uScale.value = scale;
    layer.style.setProperty("--u", scale + "px");
    T.labels.forEach((l, i) => {
      const x = w / 2 + (l.x - VIEW.cx) * scale, y = h / 2 - (l.y - VIEW.cy) * scale;
      const tx = l.anchor === "r" ? "-100%" : l.anchor === "c" ? "-50%" : "0";
      els[i].style.left = x + "px"; els[i].style.top = y + "px";
      els[i].style.transform = `translate(${tx},-50%)` + (l.rot ? ` rotate(${l.rot}deg)` : "");
      if (l.rot) els[i].style.transformOrigin = "50% 50%", els[i].style.transform = `translate(-50%,-50%) rotate(${l.rot}deg)`;
    });
    if (opts.onLayout) opts.onLayout(pageY, T.anchors);
    render();
  }
  // page Y (document coordinates) of a height in the drawing
  const pageY = y => view.top + scrollY + view.h / 2 - (y - VIEW.cy) * view.scale;
  const anchors = T.anchors;
  const toTree = (cx, cy) => {
    const r = canvas.getBoundingClientRect();
    return [VIEW.cx + (cx - r.left - r.width / 2) / view.scale, VIEW.cy - (cy - r.top - r.height / 2) / view.scale];
  };
  addEventListener("pointermove", e => {
    const [x, y] = toTree(e.clientX, e.clientY);
    ptr.x = x; ptr.y = y; ptr.in = Math.abs(x - VIEW.cx) < VIEW.w / 2 + 0.1 && y > -0.05 && y < 1.1; ptr.fresh = true;
  }, { passive: true });
  addEventListener("pointerdown", e => { const [x, y] = toTree(e.clientX, e.clientY); ptr.x = ptr.px = x; ptr.y = ptr.py = y; }, { passive: true });

  function render() { renderer.render(scene, cam); }
  function updateLabels(draw) { T.labels.forEach((l, i) => els[i].classList.toggle("on", draw >= l.t)); }

  pose();
  let raf = 0, last = 0, start = 0, visible = true, draw = reduce ? 1.2 : 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!start) { start = now; last = now; ptr.px = ptr.x; ptr.py = ptr.y; }
    const dt = Math.min(1 / 30, Math.max(1e-3, (now - last) / 1000)); last = now; time += dt;
    // cursor velocity from this frame's movement, eased so a jerky mouse still reads as one sweep
    const ivx = (ptr.x - ptr.px) / dt, ivy = (ptr.y - ptr.py) / dt;
    ptr.vx = lerp(ptr.vx, ivx, 0.6); ptr.vy = lerp(ptr.vy, ivy, 0.6); ptr.px = ptr.x; ptr.py = ptr.y;
    if (Math.abs(ptr.vx) + Math.abs(ptr.vy) < 1e-3) ptr.vx = ptr.vy = 0;
    draw = Math.min(1.2, (now - start) / 1000 / DRAW_SECONDS);
    U.uDraw.value = draw;
    physics(dt); pose(); updateLabels(draw); render();
  }
  function play() { if (!raf && visible && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(frame); } }
  function pause() { cancelAnimationFrame(raf); raf = 0; }
  addEventListener("resize", layout);
  new ResizeObserver(layout).observe(canvas);
  layout();
  if (reduce) { updateLabels(1.2); render(); }
  else {
    new IntersectionObserver(es => { visible = es[0].isIntersecting; visible ? play() : pause(); }).observe(canvas);
    document.addEventListener("visibilitychange", () => document.hidden ? pause() : play());
    play();
  }
  return {
    params: P, strokes: T.count, bones: n, anchors, pageY, relayout: () => layout(),
    state: () => ({ maxTwig: Math.max(...[...ang].filter((_, b) => Bn.kind[b] === KIND.TWIG).map(Math.abs)), maxBranch: Math.max(...[...ang].filter((_, b) => Bn.kind[b] === KIND.BRANCH).map(Math.abs)) }),
    finish() { start = performance.now() - DRAW_SECONDS * 1200; },
    setDraw(v) { U.uDraw.value = v; updateLabels(v); render(); },
    // test hook: sweep a pointer along a path in tree units, stepping the physics at 60 Hz
    sweep(path, settle = 0) {
      const dt = 1 / 60;
      for (let i = 0; i < path.length + settle; i++) {
        const q = path[Math.min(i, path.length - 1)];
        ptr.vx = i < path.length && i ? (q[0] - path[i - 1][0]) / dt : 0; ptr.vy = i < path.length && i ? (q[1] - path[i - 1][1]) / dt : 0;
        ptr.x = q[0]; ptr.y = q[1]; ptr.in = true; time += dt; physics(dt); pose();
      }
      ptr.px = ptr.x; ptr.py = ptr.y; render();
    },
    toTree
  };
}
