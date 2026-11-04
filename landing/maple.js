/* ClearSkies sketchbook hero, seasonal variant.
   An open-grown bigleaf maple (Acer macrophyllum) in pen, ink and watercolour over the
   same soil section as the Douglas-fir page. Its limbs are grown by space colonisation
   inside a broad dome crown, thickened with the pipe model, and carry moss and licorice
   fern the way west-slope maples do. The leaves, flowers, seed keys, epiphytes, grass
   and litter are drawn for one day of the year (see phenology.js), so the page shows
   the tree as it stands in its native range on the day it is opened.

   It shares the stroke renderer and bone physics in sketch.js: every mark is pinned to
   a bone, branches are damped springs, and the cursor brushes the twigs it touches. */
import { KIND, DEG, lerp, clamp, smooth, mulberry32, canvasAPI, drawSection, pack } from "./sketch.js";
import { season as seasonOf } from "./phenology.js";

export const VIEW = { cx: 0.0, cy: 0.425, w: 1.32, h: 1.46 };

const PEN = [0.25, 0.18, 0.12];          // iron-gall ink, a brown-black
const SEPIA = [0.47, 0.37, 0.27];
const GRAPHITE = [0.33, 0.32, 0.30];
const SHADE = [0.47, 0.47, 0.57, 0.55];  // cool shadow wash (round dabs)
const SHADE_FLAT = [0.5, 0.5, 0.58];     // the same, laid along a limb
const FERN = [0.22, 0.42, 0.21];         // sword fern, evergreen
const WHITE = [1, 1, 1];
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const mul = (a, k) => [a[0] * k[0], a[1] * k[1], a[2] * k[2]];
const LIGHT = (() => { const x = -0.55, y = 0.83, l = Math.hypot(x, y); return [x / l, y / l]; })();

/* ---------- the skeleton: trunk, scaffold limbs, then space colonisation ---------- */
function growSkeleton(seed) {
  const rnd = mulberry32(seed), R = (a, b) => a + (b - a) * rnd();
  const X = [], Y = [], Par = [], Sc = [];
  const add = (x, y, p, sc) => { X.push(x); Y.push(y); Par.push(p); Sc.push(sc); return X.length - 1; };
  const D = 0.0095;

  // a short, slightly leaning bole that forks low into four scaffold limbs
  let p = add(0, 0, -1, 1);
  const forkY = 0.19;
  for (let y = D; y <= forkY + 1e-6; y += D) p = add(0.006 * Math.sin(y * 9 + 0.5) - 0.006 * Math.sin(0.5), y, p, 1);
  const fork = p;
  const limbs = [[122, 142, 0.24], [101, 112, 0.27], [82, 74, 0.29], [58, 40, 0.25]];
  for (const [a0, a1, L] of limbs) {
    let x = X[fork], y = Y[fork], q = fork;
    const n = Math.round(L / D), b0 = (a0 + R(-5, 5)) * DEG, b1 = (a1 + R(-6, 6)) * DEG, wph = R(0, 6.3);
    for (let i = 1; i <= n; i++) {
      // limbs wander a little as they rise, the way a maple's scaffold does
      const th = lerp(b0, b1, smooth(0, 1, i / n)) + 0.09 * Math.sin(i * 0.42 + wph) + R(-0.04, 0.04);
      x += Math.cos(th) * D; y += Math.sin(th) * D; q = add(x, y, q, 1);
    }
  }

  // crown: a broad dome with a lobed, billowing edge
  const C = { x: 0, y: 0.625, rx: 0.47, ry: 0.335 };
  const ph = [R(0, 6.3), R(0, 6.3), R(0, 6.3)];
  const env = (x, y) => {
    const u = (x - C.x) / C.rx, v = (y - C.y) / C.ry, th = Math.atan2(v, u);
    const rr = 1 + 0.06 * Math.sin(5 * th + ph[0]) + 0.045 * Math.sin(8 * th + ph[1]) + 0.03 * Math.sin(13 * th + ph[2]);
    return Math.hypot(u, v) / rr;
  };
  // foliage grows in billows: clumps of attraction points near the shell, plus a thin scatter
  const AX = [], AY = [];
  const inside = (x, y) => env(x, y) <= 1 && y >= 0.3;
  for (let tries = 0, clumps = 0; clumps < 95 && tries < 20000; tries++) {
    const x = R(-C.rx * 1.1, C.rx * 1.1), y = R(0.3, C.y + C.ry * 1.1), e = env(x, y);
    if (!inside(x, y) || e < 0.55 || rnd() > e * e) continue;
    clumps++;
    const cr = R(0.035, 0.075), m = Math.round(R(35, 70));
    for (let j = 0; j < m; j++) {
      const a = R(0, 6.283), d = cr * Math.sqrt(rnd()), px = x + Math.cos(a) * d, py = y + Math.sin(a) * d * 0.8;
      if (inside(px, py)) { AX.push(px); AY.push(py); }
    }
  }
  for (let tries = 0, k = 0; k < 900 && tries < 20000; tries++) {
    const x = R(-C.rx * 1.1, C.rx * 1.1), y = R(0.3, C.y + C.ry * 1.1);
    if (!inside(x, y) || rnd() > 0.3 + 0.7 * env(x, y)) continue;
    AX.push(x); AY.push(y); k++;
  }
  const alive = new Uint8Array(AX.length).fill(1);

  const di = 0.075, dk = 0.017, cs = di;
  const grid = new Map(), key = (i, j) => i * 100003 + j;
  const ins = k => { const g = key(Math.floor(X[k] / cs), Math.floor(Y[k] / cs)); (grid.get(g) || grid.set(g, []).get(g)).push(k); };
  for (let k = 0; k < X.length; k++) ins(k);
  const kids = new Int32Array(60000);

  for (let it = 0; it < 220; it++) {
    const sx = new Map();
    for (let a = 0; a < AX.length; a++) {
      if (!alive[a]) continue;
      const ci = Math.floor(AX[a] / cs), cj = Math.floor(AY[a] / cs);
      let best = -1, bd = di * di;
      for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) {
        const cell = grid.get(key(i, j));
        if (!cell) continue;
        for (const k of cell) {
          const dx = AX[a] - X[k], dy = AY[a] - Y[k], d2 = dx * dx + dy * dy;
          if (d2 < bd) { bd = d2; best = k; }
        }
      }
      if (best < 0) continue;
      const d = Math.sqrt(bd) || 1, v = sx.get(best) || [0, 0, 0];
      v[0] += (AX[a] - X[best]) / d; v[1] += (AY[a] - Y[best]) / d; v[2]++; sx.set(best, v);
    }
    const fresh = [];
    for (const [k, v] of sx) {
      if (kids[k] >= 3) continue;
      // a little phototropism, and limbs that lean out from the centre of the crown
      let dx = v[0] / v[2] + 0.06 * Math.sign(X[k] - C.x), dy = v[1] / v[2] + 0.03;
      const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      const nx = X[k] + dx * D, ny = Y[k] + dy * D;
      // don't stack a second shoot right on top of an existing one
      let dup = false;
      for (const f of fresh) if (Math.abs(X[f] - nx) < D * 0.4 && Math.abs(Y[f] - ny) < D * 0.4) { dup = true; break; }
      if (dup) continue;
      const q = add(nx, ny, k, 0); kids[k]++; fresh.push(q); ins(q);
    }
    if (!fresh.length) break;
    for (const q of fresh) {
      for (let a = 0; a < AX.length; a++) {
        if (!alive[a]) continue;
        const dx = AX[a] - X[q], dy = AY[a] - Y[q];
        if (dx * dx + dy * dy < dk * dk) alive[a] = 0;
      }
    }
  }

  // short lateral shoots all along the outer limbs, so the shell is a mesh of fine twigs
  {
    const n0 = X.length, kid0 = Array.from({ length: n0 }, () => 0);
    for (let k = 1; k < n0; k++) kid0[Par[k]]++;
    for (let k = 1; k < n0; k++) {
      if (Sc[k] || env(X[k], Y[k]) < 0.5 || rnd() > 0.42) continue;
      const a = Par[k], tx = X[k] - X[a], ty = Y[k] - Y[a], tl = Math.hypot(tx, ty) || 1;
      const side = rnd() < 0.5 ? -1 : 1, rot = side * R(38, 68) * DEG;
      let th = Math.atan2(ty, tx) + rot, x = X[k], y = Y[k], q = k;
      const steps = 1 + Math.floor(R(1, 4));
      for (let i = 0; i < steps; i++) {
        th += (-Math.PI / 2 - th) * 0.06 + R(-0.15, 0.15);   // side shoots droop a little
        x += Math.cos(th) * D * 0.85; y += Math.sin(th) * D * 0.85; q = add(x, y, q, 0);
      }
    }
  }
  const n = X.length, Kids = Array.from({ length: n }, () => []);
  for (let k = 1; k < n; k++) Kids[Par[k]].push(k);
  // relax the zig-zag of the colonisation steps
  for (let pass = 0; pass < 3; pass++) for (let k = 1; k < n; k++) {
    if (Sc[k] || Kids[k].length !== 1) continue;
    const a = Par[k], b = Kids[k][0];
    X[k] = 0.5 * X[k] + 0.25 * (X[a] + X[b]); Y[k] = 0.5 * Y[k] + 0.25 * (Y[a] + Y[b]);
  }
  // pipe model: a limb's cross-section carries all the shoots beyond it
  const r = new Float32Array(n), acc = new Float32Array(n), E = 2.45, r0 = 0.00105;
  for (let k = n - 1; k >= 0; k--) {
    r[k] = acc[k] > 0 ? Math.pow(acc[k], 1 / E) : r0;
    if (Par[k] >= 0) acc[Par[k]] += Math.pow(r[k], E);
  }
  // map the pipe-model radii so the bole is 0.026 thick just under the fork and the
  // shoot tips are hairlines
  const gam = Math.log(0.026 / 0.0006) / Math.log(r[fork] / r0);
  for (let k = 0; k < n; k++) {
    r[k] = 0.0006 * Math.pow(r[k] / r0, gam);
    if (Y[k] < 0.06 && Sc[k]) r[k] *= 1 + 0.55 * Math.exp(-Y[k] / 0.018);   // root flare
  }
  // distance along the wood from the ground, for the order the pen draws in
  const dist = new Float32Array(n);
  for (let k = 1; k < n; k++) dist[k] = dist[Par[k]] + Math.hypot(X[k] - X[Par[k]], Y[k] - Y[Par[k]]);
  let dmax = 0; for (let k = 0; k < n; k++) dmax = Math.max(dmax, dist[k]);
  // how many steps each node is from the nearest shoot tip; leaves grow on the last few
  const hTip = new Int32Array(n).fill(1e6);
  for (let k = n - 1; k >= 0; k--) {
    if (!Kids[k].length) hTip[k] = 0;
    if (Par[k] >= 0) hTip[Par[k]] = Math.min(hTip[Par[k]], hTip[k] + 1);
  }
  return { n, X, Y, Par, Kids, r, Sc, dist, dmax, env, C, forkY, fork, hTip };
}

/* ---------- the drawing for one date ---------- */
export function buildMaple(date = new Date(), seed = 20261104) {
  const S = seasonOf(date);
  const K = canvasAPI(seed + 7);
  const { R, line, poly, dashed, circle, bone, ROOT, label, seg, tag } = K;
  const { groundY, yBot, xR } = drawSection(K, SEPIA);
  const G = growSkeleton(seed);
  const { n, X, Y, Par, Kids, r, env, C } = G;
  const tNode = k => 0.13 + 0.5 * G.dist[k] / G.dmax;

  /* chains: follow the thickest child; every other child starts a new chain */
  const chains = [];
  {
    const stack = [[0]];
    while (stack.length) {
      const ch = stack.pop();
      let k = ch[ch.length - 1];
      for (;;) {
        const ks = Kids[k].slice().sort((a, b) => r[b] - r[a]);
        if (!ks.length) break;
        for (let i = 1; i < ks.length; i++) stack.push([k, ks[i]]);
        ch.push(ks[0]); k = ks[0];
      }
      chains.push(ch);
    }
  }

  /* bones: each chain is cut into pieces of a few nodes */
  const boneOf = new Int32Array(n).fill(ROOT);
  for (const ch of chains) {
    let par = boneOf[ch[0]];
    const per = r[ch[1] ?? ch[0]] > 0.006 ? 6 : 4;
    let total = 0;
    for (let i = 1; i < ch.length; i++) total += Math.hypot(X[ch[i]] - X[ch[i - 1]], Y[ch[i]] - Y[ch[i - 1]]);
    let done = 0;
    for (let i = 0; i < ch.length - 1; i += per) {
      const j = Math.min(ch.length - 1, i + per), a = ch[i], b = ch[j];
      let L = 0; for (let q = i + 1; q <= j; q++) L += Math.hypot(X[ch[q]] - X[ch[q - 1]], Y[ch[q]] - Y[ch[q - 1]]);
      const rr = r[ch[Math.min(i + 1, j)]], trunk = G.Sc[b] && Y[b] <= G.forkY + 1e-6 && Math.abs(X[b]) < 0.02;
      const kind = trunk ? KIND.TRUNK : rr > 0.0035 ? KIND.BRANCH : KIND.TWIG;
      const w0 = kind === KIND.TRUNK ? 1.5 : kind === KIND.BRANCH ? 4.4 / Math.sqrt(Math.max(0.04, total)) : 2.6 / Math.sqrt(Math.max(0.012, L));
      const m = kind === KIND.TWIG ? L * 1.6 : L * (0.8 + rr / 0.003);
      par = bone(par, X[a], Y[a], X[b], Y[b], kind, w0, kind === KIND.TRUNK ? 0.4 : kind === KIND.BRANCH ? 0.14 : 0.15, m,
        kind === KIND.TRUNK ? 1 - Y[a] : Math.max(L, total - done) + 0.01);
      for (let q = i + 1; q <= j; q++) boneOf[ch[q]] = par;
      done += L;
    }
  }

  /* leaves: positions and personalities are fixed for the tree; the date decides
     which are out, how big they are and what colour */
  const lr = mulberry32(seed + 3), LR = (a, b) => a + (b - a) * lr();
  const dr = mulberry32(seed + 11 + Math.floor(S.doy)), DR = (a, b) => a + (b - a) * dr();
  const leaves = [];
  for (let k = 1; k < n; k++) {
    if (G.Sc[k] || G.hTip[k] > 4) continue;
    const tip = Kids[k].length === 0, cnt = tip ? 3 : 2;
    for (let j = 0; j < cnt; j++) {
      const a = LR(0, 6.283), d = 0.011 * Math.sqrt(lr());
      const x = X[k] + Math.cos(a) * d, y = Y[k] + Math.sin(a) * d - 0.002;
      const e = clamp(env(x, y), 0, 1.15);
      const ux = x - C.x, uy = y - C.y, ul = Math.hypot(ux, uy) || 1;
      const lit = clamp(0.5 + 0.5 * ((ux * LIGHT[0] + uy * LIGHT[1]) / ul) * (0.4 + 0.6 * e), 0, 1) * (0.45 + 0.55 * e);
      const off = LR(-0.17, 0.17) + 0.12 * (e - 0.7);
      const drop = 3.0 + LR(0, 0.75) - 0.1 * (e - 0.7);
      leaves.push({ k, x, y, e, lit, off, drop, sz: LR(0.0058, 0.0095), th: LR(0, 6.283), jit: LR(-0.04, 0.04),
        v: [LR(0.92, 1.06), LR(0.93, 1.05), LR(0.9, 1.06)], keep: lr(), wash: lr(), shade: lr() });
    }
  }
  const P = S.P, out = [];
  for (const L of leaves) {
    const A = P + L.off;
    if (A <= 0.1 || A >= L.drop) continue;
    L.A = A; out.push(L);
  }

  /* how much foliage covers each spot, so wood behind a full canopy is only glimpsed */
  const CS = 0.014, cov = new Map(), ck = (x, y) => Math.floor(x / CS) * 100003 + Math.floor(y / CS);
  for (const L of out) { const g = L.A < 0.95 ? 0.3 + 0.7 * smooth(0.1, 0.95, L.A) : 1; cov.set(ck(L.x, L.y), (cov.get(ck(L.x, L.y)) || 0) + g); }
  const covAt = (x, y) => clamp((cov.get(ck(x, y)) || 0) / 5, 0, 1);

  /* ---------- wood ---------- */
  let tipY = 0;
  const leafy = out.length / Math.max(1, leaves.length);   // 0 bare .. 1 full canopy
  // limbs seen inside a leafy crown are in its shade: a deeper, warmer wash
  const barkWash = mix([0.56, 0.51, 0.44], [0.42, 0.36, 0.29], leafy);
  const wood = (k, f) => 1 - covAt(X[k], Y[k]) * (r[k] > 0.009 ? 0.45 : r[k] > 0.004 ? 0.7 : 0.88) * f;
  for (const ch of chains) {
    if (ch.length < 2) continue;
    const m = ch.length, rr = r[ch[1]];
    const pts = ch.map(k => [X[k], Y[k], boneOf[k]]);
    pts[0][2] = boneOf[ch[0]];
    // a side limb starts at its parent's surface, not its centre line, so the two
    // don't double up where they join
    if (ch[0] !== 0) {
      const a = ch[0], b = ch[1], d = Math.hypot(X[b] - X[a], Y[b] - Y[a]) || 1, f = Math.min(0.95, 0.85 * r[a] / d);
      pts[0] = [lerp(X[a], X[b], f), lerp(Y[a], Y[b], f), boneOf[a]];
    }
    const t0 = tNode(ch[0]), t1 = tNode(ch[m - 1]) + 0.02;
    // the node a stroke's width and ink come from (never the parent's, at the joint)
    const at = f => ch[Math.max(1, Math.min(m - 1, Math.round(f * (m - 1))))];
    // the tree's height is the wood's, so it reads the same in every season
    for (const k of ch) tipY = Math.max(tipY, Y[k] + r[k] + 0.006);
    if (rr > 0.0042) {
      // normals along the chain
      const N0 = ch.map((k, i) => {
        const a = ch[Math.max(0, i - 1)], b = ch[Math.min(m - 1, i + 1)];
        const dx = X[b] - X[a], dy = Y[b] - Y[a], l = Math.hypot(dx, dy) || 1;
        return [-dy / l, dx / l];
      });
      const N = N0;
      for (const s of [-1, 1]) {
        const side = ch.map((k, i) => [(i ? X[k] : pts[0][0]) + N[i][0] * r[k] * s, (i ? Y[k] : pts[0][1]) + N[i][1] * r[k] * s, boneOf[k]]);
        side[0][2] = boneOf[ch[0]];
        const litSide = (N[Math.floor(m / 2)][0] * s * LIGHT[0] + N[Math.floor(m / 2)][1] * s * LIGHT[1]) > 0;
        poly(side, f => lerp(1.25, 0.85, f), f => (litSide ? 0.55 : 0.82) * wood(at(f), 1), t0, t1, PEN);
      }
      poly(pts, f => -2 * r[at(f)] * 0.96, f => (0.3 + 0.28 * leafy * (env(X[at(f)], Y[at(f)]) < 1 ? 1 : 0)) * wood(at(f), 0.6), t0 + 0.03, t1 + 0.04, barkWash);
      // the shaded flank: a cool wash and cross-hatching
      const shadeSide = ch.map((k, i) => {
        const s = (N[i][0] * LIGHT[0] + N[i][1] * LIGHT[1]) > 0 ? -1 : 1;
        return [(i ? X[k] : pts[0][0]) + N[i][0] * r[k] * 0.48 * s, (i ? Y[k] : pts[0][1]) + N[i][1] * r[k] * 0.48 * s, boneOf[k], s];
      });
      poly(shadeSide.map(p => p.slice(0, 3)), f => -r[at(f)] * 0.95, f => 0.24 * wood(at(f), 1), t0 + 0.05, t1 + 0.05, SHADE_FLAT);
      if (rr > 0.0065) for (let i = 0; i < m - 1; i++) {
        const k = ch[i], q = ch[i + 1], L = Math.hypot(X[q] - X[k], Y[q] - Y[k]);
        for (let a = 0; a < L; a += R(0.0032, 0.005)) {
          const f = a / L, x = lerp(X[k], X[q], f), y = lerp(Y[k], Y[q], f), s = shadeSide[i][3], rk = lerp(r[k], r[q], f);
          const nx = N[i][0] * s, ny = N[i][1] * s;
          line(x + nx * rk * R(0.05, 0.3), y + ny * rk * R(0.05, 0.3), boneOf[q], x + nx * rk * 0.95 - ny * 0.0015, y + ny * rk * 0.95 + nx * 0.0015, boneOf[q],
            0.7, R(0.16, 0.28) * wood(k, 1), lerp(t0, t1, i / m) + 0.04, 0.01, PEN);
        }
      }
      // ridged bark on the bole and the big limbs: broken lines that follow the grain
      if (rr > 0.009) {
        const nl = Math.round(rr / 0.004);
        for (let j = 0; j < nl; j++) {
          let s = R(-0.8, 0.8), i = 0;
          while (i < m - 1) {
            const len = Math.floor(R(2, 6)), stop = Math.min(m - 1, i + len);
            const run = [];
            for (let q = i; q <= stop; q++) { s = clamp(s + R(-0.06, 0.06), -0.88, 0.88); run.push([X[ch[q]] + N[q][0] * r[ch[q]] * s, Y[ch[q]] + N[q][1] * r[ch[q]] * s, boneOf[ch[q]]]); }
            poly(run, 0.75, (0.22 + 0.2 * (s + 1) / 2) * wood(ch[i], 1), lerp(t0, t1, i / m) + 0.02, lerp(t0, t1, stop / m) + 0.03, PEN);
            i = stop + Math.floor(R(1, 3));
          }
        }
      }
    } else {
      poly(pts, f => -1.9 * r[at(f)], f => (r[at(f)] > 0.0015 ? 0.74 : 0.5) * wood(at(f), 1), t0, t1, PEN);
    }
  }
  // roots spreading into the duff, and the root flare
  for (const s of [-1, 1]) for (let k = 0; k < 3; k++) {
    const x0 = s * R(0.014, 0.026), y0 = R(0.012, 0.03), x1 = s * R(0.045, 0.08), pts = [];
    for (let i = 0; i <= 8; i++) { const f = i / 8; pts.push([lerp(x0, x1, f), lerp(y0, groundY(x1), Math.pow(f, 0.55)) + 0.0005, ROOT]); }
    poly(pts, f => lerp(1.4, 0.8, f), 0.8, 0.12, 0.16, PEN);
  }

  /* ---------- moss, licorice fern ---------- */
  for (const ch of chains) {
    if (r[ch[1] ?? ch[0]] < 0.0055) continue;
    for (let i = 0; i < ch.length - 1; i++) {
      const k = ch[i], q = ch[i + 1], dx = X[q] - X[k], dy = Y[q] - Y[k], L = Math.hypot(dx, dy) || 1;
      let nx = -dy / L, ny = dx / L; if (ny < 0) { nx = -nx; ny = -ny; }
      const rk = r[q], damp = 1.3 - Y[q], cnt = Math.round(L / 0.0011 * Math.min(1.4, Math.sqrt(rk / 0.01)) * damp);
      const tm = tNode(q) + 0.05;
      for (let j = 0; j < cnt; j++) {
        const f = R(0, 1), up = R(0, 1) < 0.78 ? 1 : -1, o = rk * R(0.45, 1.18);
        const x = X[k] + dx * f + nx * o * up, y = Y[k] + dy * f + ny * o * up, a = R(0, 6.28), l = R(0.0012, 0.0032);
        const c = mul(R(0, 1) < 0.12 ? mix(S.moss, [0.72, 0.74, 0.32], 0.5) : S.moss, [R(0.85, 1.1), R(0.9, 1.08), R(0.85, 1.1)]);
        line(x, y, boneOf[q], x + Math.cos(a) * l, y + Math.sin(a) * l, boneOf[q], R(1.2, 2.1), R(0.5, 0.8) * wood(q, 0.5), tm, 0.01, c);
      }
      if (rk > 0.0055 && R(0, 1) < 0.7) {
        const x = X[k] + dx * 0.5 + nx * rk * 0.7, y = Y[k] + dy * 0.5 + ny * rk * 0.7;
        line(x - dx * 0.5, y - dy * 0.5, boneOf[q], x + dx * 0.5, y + dy * 0.5, boneOf[q], -rk * 1.1, 0.3 * wood(q, 0.5), tm + 0.02, 0.01, [...S.moss, 0.5]);
      }
      // licorice fern fronds stand up out of the moss in the wet season
      if (rk > 0.0075 && Math.abs(dy / L) < 0.75 && R(0, 1) < 0.11 * S.fern) {
        const bx = X[k] + dx * 0.5 + nx * rk * 0.9, by = Y[k] + dy * 0.5 + ny * rk * 0.9;
        const len = R(0.016, 0.03), th0 = Math.atan2(ny, nx) + R(-0.5, 0.5), pts = [];
        let x = bx, y = by, th = th0;
        for (let s = 0; s <= 8; s++) { pts.push([x, y]); th += R(-0.05, 0.12) * Math.sign(nx || 1); x += Math.cos(th) * len / 8; y += Math.sin(th) * len / 8; }
        const end = pts[8], fb = bone(boneOf[q], bx, by, end[0], end[1], KIND.FERN, 5, 0.18, len * 1.5, len);
        const fc = mix([0.55, 0.52, 0.27], [0.27, 0.5, 0.2], clamp(S.fern * 1.4 - 0.2, 0, 1));
        poly(pts.map(p => [p[0], p[1], fb]), 0.8, 0.7, tm + 0.04, tm + 0.07, fc);
        for (let s = 1; s < 8; s++) {
          const p = pts[s], u = pts[s + 1], ux = u[0] - p[0], uy = u[1] - p[1], ul = Math.hypot(ux, uy) || 1;
          const pl = 0.0055 * Math.sin(Math.PI * s / 9) * (len / 0.024) + 0.001;
          for (const sd of [-1, 1]) {
            const c = Math.cos(sd * 70 * DEG), sn = Math.sin(sd * 70 * DEG), vx = (ux * c - uy * sn) / ul, vy = (ux * sn + uy * c) / ul;
            line(p[0], p[1], fb, p[0] + vx * pl, p[1] + vy * pl, fb, 1.1, 0.68, tm + 0.05 + 0.02 * s / 8, 0.01, fc);
          }
        }
      }
    }
  }

  /* ---------- foliage ---------- */
  let accent = [0, 0, 0], aw = 0;
  for (const L of out) {
    const A = L.A, g = A < 0.95 ? 0.3 + 0.7 * smooth(0.1, 0.95, A) : A > 3.1 ? 0.85 : 1;
    let c = mul(S.leaf(A + L.jit), L.v);
    c = L.lit > 0.5 ? mix(c, WHITE, (L.lit - 0.5) * 0.32) : mix(mul(c, [0.74, 0.76, 0.84]), c, L.lit * 2);
    c = c.map(v => clamp(v, 0, 1));
    accent = accent.map((v, i) => v + c[i]); aw++;
    const b = boneOf[L.k], s = L.sz * g, t = Math.min(0.93, tNode(L.k) + 0.07 + DR(0, 0.08));
    const ink = lerp(0.8, 0.5, L.lit);
    const lobes = DR(0, 1) < 0.55 ? [-1.75, -0.85, 0, 0.85, 1.75] : [-0.85, 0, 0.85];
    // a leaf held at a slant is foreshortened along one axis
    const tilt = DR(0, 1) < 0.4 ? DR(0.35, 0.7) : 1, ua = DR(0, 3.14), ux = Math.cos(ua), uy = Math.sin(ua);
    for (const o of lobes) {
      const a = L.th + o, l = s * (o === 0 ? 1 : Math.abs(o) > 1 ? 0.6 : 0.85);
      let vx = Math.cos(a) * l, vy = Math.sin(a) * l;
      const pr = (vx * ux + vy * uy) * (1 - tilt); vx -= pr * ux; vy -= pr * uy;
      line(L.x, L.y, b, L.x + vx, L.y + vy, b, DR(2.1, 2.9) * (0.7 + 0.3 * g), ink * DR(0.88, 1.04), t, 0.012, c);
    }
    if (L.shade < 0.3 && L.lit < 0.55) { // a few pen touches in the shadowed leaves
      const a = L.th + DR(-1, 1);
      line(L.x, L.y, b, L.x + Math.cos(a) * s * 0.9, L.y + Math.sin(a) * s * 0.9, b, 0.8, 0.4, t + 0.01, 0.01, PEN);
    }
    if (L.wash < 0.17 && L.e < 0.86) {         // no wash past the crown's edge
      const rr = DR(0.01, 0.017) * (0.45 + 0.55 * g), a = DR(0, 3.14), l = DR(0.002, 0.006);
      line(L.x - Math.cos(a) * l, L.y - Math.sin(a) * l, b, L.x + Math.cos(a) * l, L.y + Math.sin(a) * l, b, -2 * rr, DR(0.16, 0.26) * (0.6 + 0.4 * g),
        Math.min(1.1, t + 0.1), 0.05, [...mix(c, WHITE, 0.22), 0.38]);
    }
    if (L.lit < 0.42 && L.wash > 0.86) {
      const rr = DR(0.013, 0.024);
      line(L.x - 0.003, L.y, b, L.x + 0.003, L.y - 0.002, b, -2 * rr, DR(0.07, 0.12), Math.min(1.1, t + 0.12), 0.05, SHADE);
    }
  }
  accent = aw ? accent.map(v => v / aw) : S.moss.slice();

  /* flower tassels (spring) and seed keys (summer into winter) at the shoot tips */
  const tips = [];
  for (let k = 1; k < n; k++) if (!Kids[k].length && !G.Sc[k]) tips.push(k);
  const fr = mulberry32(seed + 5);
  for (const k of tips) {
    const pf = fr(), pk = fr(), nkeys = 2 + Math.floor(fr() * 3), sway = fr() * 2 - 1;
    const b = boneOf[k], t = Math.min(0.95, tNode(k) + 0.1);
    if (pf < 0.55 * S.flowers) {
      const len = 0.012 + 0.009 * fr(), pts = [];
      let x = X[k], y = Y[k], th = -Math.PI / 2 + 0.5 * sway;
      for (let i = 0; i <= 6; i++) { pts.push([x, y]); th += (-Math.PI / 2 - th) * 0.25; x += Math.cos(th) * len / 6; y += Math.sin(th) * len / 6; }
      const fb = bone(b, X[k], Y[k], pts[6][0], pts[6][1], KIND.TWIG, 4.5, 0.15, len * 2, len);
      poly(pts.map(p => [p[0], p[1], fb]), 0.8, 0.6, t, t + 0.02, [0.55, 0.6, 0.27]);
      for (let i = 1; i <= 6; i++) {
        const p = pts[i], a = R(0, 6.28);
        line(p[0], p[1], fb, p[0] + Math.cos(a) * 0.0014, p[1] + Math.sin(a) * 0.0014, fb, R(1.8, 2.6), 0.8, t + 0.01, 0.01, [0.8, 0.79, 0.3]);
      }
      line(pts[1][0], pts[1][1], fb, pts[5][0], pts[5][1], fb, -0.009, 0.12, t + 0.03, 0.03, [0.88, 0.87, 0.5, 0.5]);
    }
    if (pk < 0.24 * S.keys) {
      const hidden = P > 0.5 && P < 2.9 ? 0.55 : 1;   // among summer leaves they are hard to see
      for (let j = 0; j < nkeys; j++) {
        const sl = 0.004 + 0.003 * fr(), sa = -Math.PI / 2 + (fr() - 0.5) * 1.2;
        const sx = X[k] + Math.cos(sa) * sl, sy = Y[k] + Math.sin(sa) * sl;
        line(X[k], Y[k], b, sx, sy, b, 0.7, 0.55 * hidden, t, 0.01, S.keyColor);
        for (const w of [-1, 1]) {
          const wa = sa + w * (0.55 + 0.2 * fr()), wl = 0.0045 + 0.0015 * fr();
          line(sx, sy, b, sx + Math.cos(wa) * wl, sy + Math.sin(wa) * wl, b, 1.7, 0.75 * hidden, t + 0.01, 0.01, S.keyColor);
          if (j === 0) line(sx, sy, b, sx + Math.cos(wa) * wl, sy + Math.sin(wa) * wl, b, 0.6, 0.22 * hidden, t + 0.02, 0.01, PEN);
        }
      }
    }
  }

  /* leaves in the air: a few come down while the tree is dropping them */
  {
    const pool = out.filter(L => L.e > 0.75 && L.y < 0.62 && L.A > 2.5);
    for (let i = 0; i < S.falling && pool.length; i++) {
      const L = pool[Math.floor(DR(0, pool.length))];
      const x = L.x + DR(-0.03, 0.03), y = L.y - DR(0.01, 0.04);
      const fb = bone(ROOT, x, y, x, y + 0.01, KIND.FALL, 1, 0, 0.01, 0.01);
      const c = S.leaf(L.A + DR(0, 0.25));
      for (const o of [-0.85, 0, 0.85]) line(x, y, fb, x + Math.cos(L.th + o) * 0.006, y + Math.sin(L.th + o) * 0.006, fb, 2, 0.85, 0.95, 0.02, c);
    }
  }

  /* ---------- the ground: grass, sword fern and the year's fallen leaves ---------- */
  for (const [fx, nf, sc] of [[-0.11, 8, 1], [0.13, 6, 0.8], [-0.25, 4, 0.55], [0.42, 4, 0.5]]) {
    const base = groundY(fx);
    for (let k = 0; k < nf; k++) {
      const f = nf === 1 ? 0 : k / (nf - 1), a = (lerp(-72, 72, f) + R(-8, 8)) * DEG, L = R(0.05, 0.085) * sc * (1 - 0.35 * Math.abs(f - 0.5));
      const pts = [];
      let x = fx + R(-0.004, 0.004), y = base, th = Math.PI / 2 - a;
      for (let i = 0; i <= 12; i++) { pts.push([x, y]); th += (Math.sign(a) || 1) * -0.035 * (1 + Math.abs(a)); x += Math.cos(th) * L / 12; y += Math.sin(th) * L / 12; }
      const end = pts[12], b = bone(ROOT, pts[0][0], pts[0][1], end[0], end[1], KIND.FERN, 5.5, 0.16, L * 1.5, L);
      const t0 = 0.22 + 0.05 * f;
      poly(pts.map(p => [p[0], p[1], b]), 0.85, 0.7, t0, t0 + 0.03, mul(FERN, [0.8, 0.85, 0.8]));
      for (let i = 2; i < 12; i++) {
        const p = pts[i], q = pts[i + 1], dx = q[0] - p[0], dy = q[1] - p[1], dl = Math.hypot(dx, dy);
        const ux = dx / dl, uy = dy / dl, pl = 0.0065 * sc * Math.sin(Math.PI * (i - 1) / 12) + 0.0015;
        for (const sd of [-1, 1]) {
          const c = Math.cos(sd * 62 * DEG), sn = Math.sin(sd * 62 * DEG), vx = ux * c - uy * sn, vy = ux * sn + uy * c;
          line(p[0], p[1], b, p[0] + vx * pl, p[1] + vy * pl, b, 1.15, 0.62, t0 + 0.03 * i / 12, 0.01, FERN);
        }
      }
    }
  }
  for (let i = 0; i < 70; i++) {
    const x = R(-0.5, 0.5);
    if (Math.abs(x) < 0.04) continue;
    const y = groundY(x), nb = Math.floor(R(3, 7));
    for (let k = 0; k < nb; k++) {
      const a = (90 + R(-30, 30)) * DEG, l = R(0.004, 0.013);
      line(x + R(-0.002, 0.002), y, ROOT, x + Math.cos(a) * l, y + Math.sin(a) * l, ROOT, 0.85, R(0.45, 0.7), 0.2 + 0.08 * Math.abs(x), 0.01, mul(S.grass, [R(0.85, 1.1), R(0.9, 1.08), R(0.85, 1.1)]));
    }
  }
  {
    const nl = Math.round(560 * S.litter);
    for (let i = 0; i < nl; i++) {
      let x = R(-0.52, 0.52);
      if (Math.abs(x) > 0.38 && R(0, 1) < 0.6) x *= 0.6;          // most fall under the crown
      const y = groundY(x) + R(0.0004, 0.0045) + (Math.abs(x) < 0.05 ? 0.002 : 0);
      const c = mul(mix([0.44, 0.34, 0.24], S.leaf(R(2.7, 3.6)), S.litterFresh), [R(0.9, 1.08), R(0.9, 1.06), R(0.9, 1.06)]);
      const a = R(-0.35, 0.35), l = R(0.0045, 0.008);
      for (const o of [-0.5, 0, 0.5]) line(x, y, ROOT, x + Math.cos(a + o) * l, y + Math.sin(a + o) * l * 0.45, ROOT, 1.9, R(0.55, 0.8), 0.24 + 0.06 * Math.abs(x), 0.01, c);
    }
  }

  /* ---------- annotations, in graphite ---------- */
  const treeEnd = tag.length;
  {
    const xd = 0.6, ta = 0.82, top = tipY;
    poly([[xd, groundY(xd), ROOT], [xd, top, ROOT]], 0.8, 0.55, ta, ta + 0.04, GRAPHITE);
    for (const y of [groundY(xd), top]) line(xd - 0.012, y, ROOT, xd + 0.012, y, ROOT, 0.8, 0.6, ta, 0.01, GRAPHITE);
    for (const [y, s] of [[groundY(xd), 1], [top, -1]]) {
      line(xd, y, ROOT, xd - 0.0045, y + s * 0.012, ROOT, 0.8, 0.6, ta + 0.04, 0.01, GRAPHITE);
      line(xd, y, ROOT, xd + 0.0045, y + s * 0.012, ROOT, 0.8, 0.6, ta + 0.04, 0.01, GRAPHITE);
    }
    dashed(0.03, top, xd - 0.016, top, 0.006, 0.006, 0.7, 0.45, ta, ta + 0.03, GRAPHITE);
    label(xd + 0.014, (groundY(xd) + top) / 2, `${(top * 25).toFixed(1)} m &middot; canopy height`, { anchor: "c", rot: -90, t: 0.88, cls: "dim" });

    // one lidar pulse: first return off the canopy (or, in winter, a limb), last return on bare earth
    const xr = -0.37;
    let hit = 0;
    for (let i = 0; i < treeEnd; i++) {
      for (const kk of [0, 2]) { const x = seg[i * 4 + kk], y = seg[i * 4 + kk + 1]; if (Math.abs(x - xr) < 0.003 && y > hit && y < 1.05) hit = y; }
    }
    const tl = 0.86, gy = groundY(xr);
    dashed(xr, 1.08, xr, hit + 0.006, 0.01, 0.007, 0.8, 0.6, tl, tl + 0.03, GRAPHITE);
    circle(xr, hit, 0.0045, 0.8, 0.7, tl + 0.03, GRAPHITE);
    dashed(xr, hit - 0.006, xr, gy + 0.004, 0.003, 0.008, 0.7, 0.4, tl + 0.03, tl + 0.07, GRAPHITE);
    line(xr - 0.004, gy - 0.002, ROOT, xr + 0.004, gy + 0.006, ROOT, 0.9, 0.75, tl + 0.07, 0.01, GRAPHITE);
    line(xr - 0.004, gy + 0.006, ROOT, xr + 0.004, gy - 0.002, ROOT, 0.9, 0.75, tl + 0.075, 0.01, GRAPHITE);
    label(xr - 0.014, hit + 0.02, "first return", { anchor: "r", t: 0.9 });
    label(xr - 0.014, gy + 0.045, "last return<br>bare earth", { anchor: "r", t: 0.93, cls: "lr" });

    // species note with a leader to the crown
    const lp = [[0.105, 1.062, ROOT], [0.075, 1.052, ROOT], [0.05, 1.034, ROOT], [0.036, top + 0.012, ROOT]];
    poly(lp, 0.75, 0.55, 0.84, 0.87, GRAPHITE);
    label(0.112, 1.068, "<i>Acer macrophyllum</i><br>Bigleaf maple, west slope", { anchor: "l", t: 0.86, cls: "sp sp-l" });
    label(-0.02, yBot - 0.03, "Fig. 1 &nbsp;Bigleaf maple on glacial till over andesite, Puget lowland", { anchor: "c", t: 0.97, cls: "cap" });
    label(-0.02, yBot - 0.062, `as it stands on ${S.label} &middot; ${S.note}`, { anchor: "c", t: 0.99, cls: "cap season" });
  }

  const T = pack(K, { tip: tipY, rock: yBot });
  T.season = S;
  T.accent = accent;
  T.leaves = out.length;
  return T;
}
