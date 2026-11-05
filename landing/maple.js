/* ClearSkies sketchbook hero, seasonal variant.
   An open-grown bigleaf maple (Acer macrophyllum) in pen, ink and watercolour over the
   same soil section as the Douglas-fir page. The tree is grown in three dimensions by
   maple-growth.js (buds competing for light, apical control, flowering forks, self-
   pruning, sag under load) and drawn here as seen from the front. The leaves, flowers,
   seed keys, grass and litter are drawn for one day of the year (see phenology.js), so the page shows
   the tree as it stands in its native range on the day it is opened.

   It shares the stroke renderer and bone physics in sketch.js: every mark is pinned to
   a bone, branches are damped springs, and the cursor brushes the twigs it touches. */
import { KIND, DEG, lerp, clamp, smooth, mulberry32, canvasAPI, drawSection, pack } from "./sketch.js";
import { season as seasonOf } from "./phenology.js";
import { growMaple, unpackMaple } from "./maple-growth.js";
import { BAKED } from "./maple-tree.js";
import { leafAtlas } from "./maple-leaves.js";

export const VIEW = { cx: 0.0, cy: 0.425, w: 1.32, h: 1.46 };

const PEN = [0.15, 0.155, 0.165];        // a cool near-black, like the e-ink text
const TWIG_INK = [0.3, 0.29, 0.28];      // fine wood: pen thinned with the bark colour
const SEPIA = [0.36, 0.37, 0.38];        // the soil section, in grey
const GRAPHITE = [0.3, 0.31, 0.32];
const SHADE = [0.47, 0.47, 0.57, 0.55];  // cool shadow wash (round dabs)
const SHADE_FLAT = [0.5, 0.5, 0.58, 0.45]; // the same, laid along a limb (soft, round-ended)
const FERN = [0.22, 0.42, 0.21];         // sword fern, evergreen
const WHITE = [1, 1, 1];
const LIDAR_X = -0.37;                   // where the lidar pulse in the margin note comes down
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const mul = (a, k) => [a[0] * k[0], a[1] * k[1], a[2] * k[2]];
const LIGHT = (() => { const x = -0.55, y = 0.83, l = Math.hypot(x, y); return [x / l, y / l]; })();

/* ---------- the drawing for one date ---------- */
export function buildMaple(date = new Date(), seed = 20261104) {
  const S = seasonOf(date);
  const K = canvasAPI(seed + 7);
  const { R, line, poly, dashed, circle, bone, ROOT, label, seg, tag } = K;
  const { groundY, yBot, xR } = drawSection(K, SEPIA);
  // the tree is baked ahead of time (scripts/bake-maple.mjs); it is grown here only if
  // the bake is stale or another seed is asked for
  const G = unpackMaple(BAKED, seed) || growMaple(seed);
  const { n, X, Y, Z, Par, Kids, r, env, C } = G;
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
    const per = r[ch[1] ?? ch[0]] > 0.006 ? 6 : r[ch[1] ?? ch[0]] > 0.002 ? 5 : 7;
    let total = 0;
    for (let i = 1; i < ch.length; i++) total += Math.hypot(X[ch[i]] - X[ch[i - 1]], Y[ch[i]] - Y[ch[i - 1]]);
    let done = 0;
    for (let i = 0; i < ch.length - 1; i += per) {
      const j = Math.min(ch.length - 1, i + per), a = ch[i], b = ch[j];
      let L = 0; for (let q = i + 1; q <= j; q++) L += Math.hypot(X[ch[q]] - X[ch[q - 1]], Y[ch[q]] - Y[ch[q - 1]]);
      const rr = r[ch[Math.min(i + 1, j)]], trunk = G.Sc[b] === 2;
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
  /* each leaf grows from a node on its own stalk. A maple's leaves are opposite, a pair
     at each node, and each pair is turned a quarter turn from the one before (decussate).
     They crowd this year's and last year's wood near the tips; older wood inside the
     crown carries the odd pair, so the centre is not hollow */
  const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm3 = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  for (let k = 1; k < n; k++) {
    if (G.Sc[k]) continue;
    const h = G.hTip[k];
    if (h > 3 && r[k] > 0.0045) continue;
    const pairs = h === 0 ? 1 : h === 1 ? 0.55 : h <= 3 ? 0.18 : 0.07;
    if (lr() >= pairs) continue;
    const p = Par[k], d = norm3([X[k] - X[p], Y[k] - Y[p], Z[k] - Z[p]]);
    const ref = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const q0 = norm3(cross3(d, ref)), q1 = cross3(d, q0);
    const tw = LR(-0.35, 0.35), q = h % 2 ? q0 : q1, o = h % 2 ? q1 : q0;
    const ax = norm3([q[0] * Math.cos(tw) + o[0] * Math.sin(tw), q[1] * Math.cos(tw) + o[1] * Math.sin(tw), q[2] * Math.cos(tw) + o[2] * Math.sin(tw)]);
    const sz = LR(0.0072, 0.0115);   // bigleaf: a blade up to a foot across
    for (const side of [1, -1]) {
      // the stalk leaves the twig at about 50 degrees, leaning forward, and the leaf's
      // weight bends it down a little
      const st = norm3([side * ax[0] * 0.65 + d[0] * 0.55, side * ax[1] * 0.65 + d[1] * 0.55 - 0.35, side * ax[2] * 0.65 + d[2] * 0.55]);
      const pl = sz * LR(0.7, 1.0);
      const jx = X[k] + st[0] * pl, jy = Y[k] + st[1] * pl;
      // the blade carries on from its stalk, hanging a little more
      let bx = st[0], by = st[1] - 0.25;
      if (Math.hypot(bx, by) < 0.25) { bx = side * 0.5; by = -0.4; }   // a stalk aimed at the viewer: the blade faces us
      const th = Math.atan2(by, bx) + LR(-0.2, 0.2);
      const x = jx + Math.cos(th) * sz * 0.5, y = jy + Math.sin(th) * sz * 0.5;   // the blade's middle
      const e = clamp(env(x, y), 0, 1.15);
      const ux = x - C.x, uy = y - C.y, ul = Math.hypot(ux, uy) || 1;
      const lit = clamp(0.5 + 0.5 * ((ux * LIGHT[0] + uy * LIGHT[1]) / ul) * (0.4 + 0.6 * e), 0, 1) * (0.45 + 0.55 * e);
      const off = LR(-0.17, 0.17) + 0.12 * (e - 0.7);
      const drop = 3.0 + LR(0, 0.75) - 0.1 * (e - 0.7);
      leaves.push({ k, x, y, jx, jy, jz: Z[k] + st[2] * pl, e, lit, off, drop, sz: sz * LR(0.9, 1.1), th, jit: LR(-0.04, 0.04),
        v: [LR(0.92, 1.06), LR(0.93, 1.05), LR(0.9, 1.06)], keep: lr(), wash: lr(), shade: lr(),
        // which of the atlas's leaves; how far it is twisted on its stalk (cos of the twist:
        // below 0 we see its underside); how curled
        cell: Math.floor(lr() * 16), sq: (lr() < 0.28 ? -1 : 1) * (lr() < 0.35 ? LR(0.4, 0.75) : LR(0.8, 1)), curl: LR(-1, 1) });
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
  const barkWash = mix([0.55, 0.53, 0.5], [0.42, 0.39, 0.35], leafy);   // bigleaf maple bark: grey-brown
  const wood = (k, f) => 1 - covAt(X[k], Y[k]) * (r[k] > 0.009 ? 0.45 : r[k] > 0.004 ? 0.7 : 0.88) * f;
  // a pen run whose width and ink are read from the node each point carries ([x, y, bone, node])
  const strand = (pts, w, ink, t0, t1, c) => {
    const nn = pts.length - 1;
    for (let i = 0; i < nn; i++) {
      const p = pts[i], q = pts[i + 1];
      line(p[0], p[1], p[2], q[0], q[1], q[2], typeof w === "function" ? w(p[3]) : w,
        typeof ink === "function" ? ink(p[3]) : ink, t0 + (t1 - t0) * i / nn, (t1 - t0) / nn * 1.2, c);
    }
  };
  // a branch collar: each side limb swells a little where it leaves its parent
  for (const ch of chains) if (ch[0] !== 0 && ch.length > 2 && r[ch[1]] > 0.003) r[ch[1]] = Math.min(r[ch[0]] * 0.95, r[ch[1]] * 1.16);
  // a long limb thins out to a twig; from there on it is drawn as a twig, not in outline
  const tails = new Set(), dch = [];
  for (const ch of chains) {
    let cut = ch.length;
    if (ch.length > 2 && r[ch[1]] > 0.0042) for (let i = 2; i < ch.length; i++) if (r[ch[i]] < 0.0034) { cut = i; break; }
    if (cut < ch.length - 1) { const t = ch.slice(cut); dch.push(ch.slice(0, cut + 1), t); tails.add(t); } else dch.push(ch);
  }

  /* where limbs meet, each one's outline stops at the other's surface, so a fork reads
     as one piece of wood instead of two tubes laid over each other */
  const chainAt = new Int32Array(n).fill(-1), posIn = new Int32Array(n);
  dch.forEach((ch, c) => ch.forEach((k, i) => { if (i || c === 0) { chainAt[k] = c; posIn[k] = i; } }));
  const thick = ch => ch.length > 1 && r[ch[1]] > 0.0042;
  const capsules = dch.map(() => []), rootCaps = [];
  const capsule = (list, ax, ay, ra, bx, by, rb) => list.push([ax, ay, bx, by, ra * 0.94, rb * 0.94]);
  dch.forEach((ch, c) => {
    if (c === 0 || !thick(ch)) return;
    const pc = chainAt[ch[0]], pch = dch[pc], ip = posIn[ch[0]];
    // the parent's wood around the joint blocks the limb's outline ...
    for (let i = Math.max(0, ip - 3); i < Math.min(pch.length - 1, ip + 3); i++)
      capsule(capsules[c], X[pch[i]], Y[pch[i]], r[pch[i]], X[pch[i + 1]], Y[pch[i + 1]], r[pch[i + 1]]);
    // ... and the limb's first stretch blocks the parent's
    for (let i = 0; i < Math.min(ch.length - 1, 6); i++)
      capsule(capsules[pc], X[ch[i]], Y[ch[i]], r[ch[Math.max(1, i)]], X[ch[i + 1]], Y[ch[i + 1]], r[ch[i + 1]]);
  });
  /* depth: the tree is three-dimensional, so a limb nearer the viewer hides the lines of
     a limb behind it. Thick limbs are filed by cell with their depth */
  const DG = 0.03, dgrid = new Map(), dkey = (i, j) => i * 7919 + j;
  const related = dch.map((ch, c) => new Set([c]));
  dch.forEach((ch, c) => { if (c && chainAt[ch[0]] >= 0) { related[c].add(chainAt[ch[0]]); related[chainAt[ch[0]]].add(c); } });
  dch.forEach((ch, c) => {
    if (!thick(ch)) return;
    for (let i = 0; i < ch.length - 1; i++) {
      const a = ch[i], b = ch[i + 1], ra = r[ch[Math.max(1, i)]] * 0.96, rb = r[b] * 0.96;
      if (rb < 0.003) break;
      const cap = [X[a], Y[a], X[b], Y[b], ra, rb, (Z[a] + Z[b]) / 2, c], m = Math.max(ra, rb);
      for (let gi = Math.floor((Math.min(X[a], X[b]) - m) / DG); gi <= Math.floor((Math.max(X[a], X[b]) + m) / DG); gi++)
        for (let gj = Math.floor((Math.min(Y[a], Y[b]) - m) / DG); gj <= Math.floor((Math.max(Y[a], Y[b]) + m) / DG); gj++) {
          const g = dkey(gi, gj); (dgrid.get(g) || dgrid.set(g, []).get(g)).push(cap);
        }
    }
  });
  const inCap = (x, y, ax, ay, bx, by, ra, rb) => {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1, t = clamp(((x - ax) * dx + (y - ay) * dy) / l2, 0, 1);
    const rr = lerp(ra, rb, t), ex = x - ax - dx * t, ey = y - ay - dy * t;
    return ex * ex + ey * ey < rr * rr;
  };
  const hidden = (c, x, y, z) => {
    const cell = dgrid.get(dkey(Math.floor(x / DG), Math.floor(y / DG)));
    if (cell) for (const [ax, ay, bx, by, ra, rb, zc, cc] of cell)
      if (zc > z + 0.012 && !related[c].has(cc) && inCap(x, y, ax, ay, bx, by, ra, rb)) return true;
    return false;
  };
  // (the roots block only the bole's outline, not the bark drawn on its face)
  const blocked = (c, x, y, outline = false, z) => {
    if (z !== undefined && hidden(c, x, y, z)) return true;
    for (const [ax, ay, bx, by, ra, rb] of outline && c === 0 ? capsules[0].concat(rootCaps) : capsules[c]) {
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1, t = clamp(((x - ax) * dx + (y - ay) * dy) / l2, 0, 1);
      const rr = lerp(ra, rb, t), ex = x - ax - dx * t, ey = y - ay - dy * t;
      if (ex * ex + ey * ey < rr * rr) return true;
    }
    return false;
  };
  // draw a line along pts, lifting the pen wherever it runs inside a limb it meets
  const clipped = (c, pts, w, ink, t0, t1, col) => {
    let run = [], i0 = 0;
    const nn = pts.length - 1, flush = i => { if (run.length > 1) strand(run, w, ink, lerp(t0, t1, i0 / nn), lerp(t0, t1, i / nn), col); run = []; };
    for (let i = 0; i <= nn; i++) {
      const p = pts[i], z = p[3] !== undefined ? Z[p[3]] : undefined, inside = blocked(c, p[0], p[1], true, z);
      if (i && inside !== blocked(c, pts[i - 1][0], pts[i - 1][1], true, z)) {
        // find the surface between the two points so the line ends exactly on it
        let lo = 0, hi = 1, q = pts[i - 1];
        for (let it = 0; it < 6; it++) { const m = (lo + hi) / 2; (blocked(c, lerp(q[0], p[0], m), lerp(q[1], p[1], m), true, z) === inside ? hi = m : lo = m); }
        const e = [lerp(q[0], p[0], lo), lerp(q[1], p[1], lo), p[2], p[3]];
        if (inside) { run.push(e); flush(i); } else { i0 = i; run.push(e); }
      }
      if (!inside) { if (!run.length) i0 = i; run.push(p); }
    }
    flush(nn);
  };

  /* buttress roots: the bole's flare runs out into roots that hump through the duff */
  const roots = [];
  {
    const bole = dch[0].filter(k => G.Sc[k] === 2);
    const boleAt = y => bole.reduce((b, k) => Math.abs(Y[k] - y) < Math.abs(Y[b] - y) ? k : b, bole[0]);
    for (const s of [-1, 1]) for (let j = 0; j < 3; j++) {
      const y0 = R(0.03, 0.075) * (j === 2 ? 0.6 : 1), kb = boleAt(y0), x0 = X[kb] + s * r[kb] * R(0.35, 0.7);
      const x1 = X[0] + s * R(0.075, 0.13) * (j === 2 ? 0.55 : j ? 0.8 : 1), y1 = groundY(x1) + 0.0015;
      const rw0 = r[kb] * R(0.32, 0.45) * (j === 2 ? 0.7 : 1), pts = [];
      for (let i = 0; i <= 12; i++) {
        const f = i / 12;
        pts.push([lerp(x0, x1, f), y1 + (y0 - y1) * Math.pow(1 - f, 2.4), lerp(rw0, 0.0014, Math.pow(f, 0.75))]);
      }
      roots.push({ s, pts });
      for (let i = 0; i < 12; i++) capsule(rootCaps, pts[i][0], pts[i][1], pts[i][2], pts[i + 1][0], pts[i + 1][1], pts[i + 1][2]);
    }
  }

  for (let c = 0; c < dch.length; c++) {
    const ch = dch[c];
    if (ch.length < 2) continue;
    const m = ch.length, rr = r[ch[1]];
    const pts = ch.map(k => [X[k], Y[k], boneOf[k], k]);
    // a side limb starts at its parent's surface, not its centre line, so the two
    // don't double up where they join
    if (ch[0] !== 0 && !tails.has(ch)) {
      const a = ch[0], b = ch[1], d = Math.hypot(X[b] - X[a], Y[b] - Y[a]) || 1, f = Math.min(0.95, 0.85 * r[a] / d);
      pts[0] = [lerp(X[a], X[b], f), lerp(Y[a], Y[b], f), boneOf[a], b];
    } else pts[0][3] = ch[1];
    const t0 = tNode(ch[0]), t1 = tNode(ch[m - 1]) + 0.02, tAt = i => lerp(t0, t1, i / (m - 1));
    // the node a stroke's width and ink come from (never the parent's, at the joint)
    const at = f => ch[Math.max(1, Math.min(m - 1, Math.round(f * (m - 1))))];
    // the tree's height is the wood's, so it reads the same in every season
    for (const k of ch) tipY = Math.max(tipY, Y[k] + r[k] + 0.006);
    if (thick(ch)) {
      const big = rr > 0.0075;
      // old wood is lumpy: the outline swells and pinches a little along its length
      const lp = [R(0, 6.3), R(0, 6.3)];
      const rD = k => r[k] * (big ? 1 + 0.045 * Math.sin(G.dist[k] * 75 + lp[0]) + 0.03 * Math.sin(G.dist[k] * 190 + lp[1]) : 1);
      const N = ch.map((k, i) => {
        const a = ch[Math.max(0, i - 1)], b = ch[Math.min(m - 1, i + 1)];
        const dx = X[b] - X[a], dy = Y[b] - Y[a], l = Math.hypot(dx, dy) || 1;
        return [-dy / l, dx / l];
      });
      const T = N.map(([nx, ny]) => [ny, -nx]);
      const base = i => (i ? [X[ch[i]], Y[ch[i]]] : [pts[0][0], pts[0][1]]);
      const off = (i, s) => { const k = ch[i], [x, y] = base(i), rk = rD(k); return [x + N[i][0] * rk * s, y + N[i][1] * rk * s, boneOf[k], ch[Math.max(1, i)]]; };
      // which side faces away from the light, node by node
      const dark = N.map(([nx, ny]) => (nx * LIGHT[0] + ny * LIGHT[1]) > 0 ? -1 : 1);
      const node = i => ch[Math.max(1, i)];
      for (const s of [-1, 1]) {
        const side = ch.map((k, i) => off(i, s));
        side[0][2] = boneOf[ch[0]];
        const litSide = dark[Math.floor(m / 2)] !== s;
        clipped(c, side, k => clamp(0.85 + r[k] * 26, 0.9, 1.75), k => (litSide ? 0.55 : 0.85) * clamp(r[k] / 0.009, 0.5, 1) * wood(k, 1), t0, t1, PEN);
      }
      // where a side limb's wash lies over its parent's it is laid thinner, so the joint doesn't darken
      const lap = k => c ? clamp(posIn[k] / 3, 0.4, 1) : 1;
      // (the bole is laid square-ended, so its fill stops at the ground line)
      const bodyInk = k => (0.3 + 0.28 * leafy * (env(X[k], Y[k]) < 1 ? 1 : 0)) * wood(k, 0.6);
      if (c === 0) {
        const nb = pts.findIndex((p, i) => i && G.Sc[ch[i]] !== 2);
        strand(pts.slice(0, nb + 1), k => -2 * rD(k) * 0.96, bodyInk, t0 + 0.03, tAt(nb) + 0.04, [...barkWash, -0.5]);
        strand(pts.slice(nb - 1), k => -2 * rD(k) * 0.96, bodyInk, tAt(nb - 1) + 0.03, t1 + 0.04, [...barkWash, -1]);
      } else strand(pts, k => -2 * rD(k) * 0.96, bodyInk, t0 + 0.03, t1 + 0.04, [...barkWash, -1]);
      // the shaded flank: a cool wash, and on the bole and big limbs a deeper core shadow
      // (it slides smoothly round the limb as the limb turns against the light)
      const darkC = N.map(([nx, ny]) => clamp(-(nx * LIGHT[0] + ny * LIGHT[1]) * 1.8, -1, 1));
      const flank = (u, i) => { const k = ch[i], [x, y] = base(i), rk = r[k] * u * darkC[i]; return [x + N[i][0] * rk, y + N[i][1] * rk, boneOf[k], node(i)]; };
      clipped(c, ch.map((k, i) => flank(0.48, i)), k => -r[k] * 0.95, k => 0.2 * wood(k, 1) * lap(k), t0 + 0.05, t1 + 0.05, SHADE_FLAT);
      if (big) clipped(c, ch.map((k, i) => flank(0.6, i)), k => -r[k] * 0.5, k => 0.2 * wood(k, 1) * lap(k), t0 + 0.06, t1 + 0.06, SHADE_FLAT);
      // cross-contours: hatching that curves round the limb on its shaded half, the way
      // a pen describes a cylinder seen from below
      if (rr > 0.008) for (let i = ch[0] === 0 ? 0 : 1; i < m - 1; i++) {
        const k = ch[i], q = ch[i + 1], [bx, by] = base(i), L = Math.hypot(X[q] - bx, Y[q] - by);
        for (let a = 0; a < L; a += r[k] > 0.016 ? R(0.0022, 0.0034) : R(0.003, 0.0048)) {
          const f = a / L, cx = lerp(bx, X[q], f), cy = lerp(by, Y[q], f), rk = lerp(rD(k), rD(q), f);
          const nx = N[i][0] * dark[i], ny = N[i][1] * dark[i], tx = T[i][0], ty = T[i][1];
          const u0 = R(0, 1) < 0.4 ? R(0.55, 0.75) : R(0.15, 0.5), bow = rk * R(0.3, 0.42), arc = [];
          for (let z = 0; z <= 4; z++) {
            const u = lerp(u0, 0.97, z / 4), o = bow * Math.sqrt(1 - u * u);
            arc.push([cx + nx * rk * u + tx * o, cy + ny * rk * u + ty * o, boneOf[q], q]);
          }
          if (blocked(c, arc[0][0], arc[0][1], false, Z[q]) || blocked(c, arc[4][0], arc[4][1], false, Z[q])) continue;
          strand(arc, 0.8, R(0.26, 0.42) * wood(k, 1), tAt(i) + 0.04, tAt(i) + 0.05, PEN);
        }
      }
      // fluted bark on the bole and the big limbs: ridges that twist and braid along
      // the grain, with dark furrows between them on the shaded side
      if (big) {
        const nl = Math.round(rr / 0.0022);
        for (let j = 0; j < nl; j++) {
          const s0 = R(-0.85, 0.85), ph = R(0, 6.3), fq = R(22, 50), amp = R(0.08, 0.22);
          let drift = 0, i = ch[0] === 0 ? 0 : 1;
          while (i < m - 1) {
            const stop = Math.min(m - 1, i + Math.floor(R(6, 16))), run = [];
            let l = 0;
            for (let q = i; q <= stop; q++) {
              drift = clamp(drift + R(-0.035, 0.035), -0.3, 0.3);
              const sv = clamp(s0 + drift + amp * Math.sin(G.dist[ch[q]] * fq + ph), -0.93, 0.93), p = off(q, sv);
              if (blocked(c, p[0], p[1], false, Z[p[3]])) break;
              run.push(p); l += -dark[q] * Math.sign(sv) * Math.abs(sv);
            }
            if (run.length > 1) {
              l /= run.length;   // -1 deep in shadow .. 1 in the light
              strand(run, 0.95, (0.26 + 0.42 * clamp(0.45 - 0.75 * l, 0, 1)) * wood(ch[i], 1), tAt(i) + 0.02, tAt(stop) + 0.03, PEN);
              if (l < -0.2 && R(0, 1) < 0.65) strand(run, k => -r[k] * 0.12, 0.2 * wood(ch[i], 1), tAt(i) + 0.05, tAt(stop) + 0.05, PEN);
            }
            i = stop + (R(0, 1) < 0.5 ? 0 : 1);
          }
        }
      }
      // the crotch of a fork holds a little dark
      if (c && rr > 0.006) {
        const pc = chainAt[ch[0]], i = 2 < m ? 2 : m - 1, k = ch[i];
        for (let z = 0; z < 5; z++) {
          const s = z % 2 ? 1 : -1, x = X[k] + N[i][0] * r[k] * s * R(0.7, 1), y = Y[k] + N[i][1] * r[k] * s * R(0.7, 1);
          const dx = X[ch[0]] - X[k], dy = Y[ch[0]] - Y[k], dl = Math.hypot(dx, dy) || 1;
          if (!blocked(c, x, y) && blocked(pc, x, y) === false) line(x, y, boneOf[k], x + dx / dl * 0.004, y + dy / dl * 0.004, boneOf[ch[0]], 0.9, 0.35 * wood(k, 1), t0 + 0.04, 0.01, PEN);
        }
      }
    } else {
      // (laid lighter as it thickens, so it doesn't read darker than the limbs drawn in outline)
      // (lifted where it passes behind a nearer limb)
      const tw = pts.map((p, i) => [p[0], p[1], p[2], ch[Math.max(1, i)]]);
      clipped(c, tw, k => -1.9 * r[k], k => (r[k] > 0.0015 ? lerp(0.7, 0.4, smooth(0.0022, 0.0042, r[k])) : 0.5) * wood(k, 1), t0, t1, TWIG_INK);
    }
  }
  // the roots themselves: a wash, a lit upper edge, a lower edge sinking into the soil,
  // and a little hatching underneath
  for (const { s, pts } of roots) {
    const m = pts.length - 1, P3 = pts.map(([x, y]) => [x, y, ROOT]);
    const nrm = pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(m, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
      let nx = -dy / l, ny = dx / l; if (ny < 0) { nx = -nx; ny = -ny; } return [nx, ny];
    });
    poly(P3, f => -2 * pts[Math.round(f * m)][2], 0.32, 0.12, 0.16, [...barkWash, -1]);
    const up = pts.map((p, i) => [p[0] + nrm[i][0] * p[2], p[1] + nrm[i][1] * p[2], ROOT, 0]);
    clipped(0, up, 1.2, s < 0 ? 0.6 : 0.8, 0.12, 0.17, PEN);
    const lo = pts.map((p, i) => [p[0] - nrm[i][0] * p[2] * 0.8, p[1] - nrm[i][1] * p[2] * 0.8, ROOT, 0]).filter(p => p[1] > groundY(p[0]) + 0.0008);
    if (lo.length > 1) clipped(0, lo, 0.9, 0.45, 0.13, 0.17, PEN);
    for (let i = 1; i < m - 2; i++) {
      const p = pts[i], [nx, ny] = nrm[i];
      line(p[0] - nx * p[2] * 0.05, p[1] - ny * p[2] * 0.05, ROOT, p[0] - nx * p[2] * 0.75 + s * 0.001, p[1] - ny * p[2] * 0.75, ROOT, 0.7, 0.24, 0.16, 0.01, PEN);
    }
  }

  /* knots: where the tree shed a branch, the bark has closed over the stub in a ring */
  for (const kn of G.knots) {
    const k = kn.k, p = Par[k];
    if (p < 0 || r[k] < 0.0055 || !Kids[k].length) continue;
    const q = Kids[k][0], dx = X[q] - X[p], dy = Y[q] - Y[p], dl = Math.hypot(dx, dy) || 1, nx = -dy / dl, ny = dx / dl;
    // where on the limb it sits: a stub that pointed sideways shows near the edge, one
    // that pointed at or away from us shows on the face
    const s = clamp(kn.d[0] * nx + kn.d[1] * ny, -0.75, 0.75);
    const x = X[k] + nx * r[k] * s, y = Y[k] + ny * r[k] * s, z = Z[k] + r[k];
    if (hidden(chainAt[k] >= 0 ? chainAt[k] : 0, x, y, z)) continue;
    const kr = clamp(kn.r, 0.0018, r[k] * 0.5), rot = Math.atan2(dy, dx), b = boneOf[k], t = tNode(k) + 0.06;
    circle(x, y, kr, 0.85, 0.6 * wood(k, 1), t, PEN, b, 12, kr * 0.62 * (1 - 0.5 * Math.abs(s)), rot);
    circle(x, y, kr * 0.45, 0.7, 0.45 * wood(k, 1), t + 0.01, PEN, b, 8, kr * 0.3, rot);
    line(x - Math.cos(rot) * kr * 0.2, y - Math.sin(rot) * kr * 0.2, b, x + Math.cos(rot) * kr * 0.2, y + Math.sin(rot) * kr * 0.2, b, -kr * 0.5, 0.35 * wood(k, 1), t + 0.01, 0.01, PEN);
    // the bark puckers round it: a couple of curved lines above and below
    for (const side of [-1, 1]) {
      const arc = [];
      for (let i = 0; i <= 5; i++) {
        const u = (i / 5 - 0.5) * 2.2, ex = Math.cos(rot) * kr * u * 1.6, ey = Math.sin(rot) * kr * u * 1.6;
        const off = side * kr * (0.95 + 0.5 * (1 - u * u / 1.21));
        arc.push([x + ex - Math.sin(rot) * off, y + ey + Math.cos(rot) * off, b]);
      }
      poly(arc, 0.7, 0.4 * wood(k, 1), t + 0.02, t + 0.03, PEN);
    }
  }

  /* ---------- foliage ----------
     Every leaf is a whole bigleaf blade from the leaf atlas (maple-leaves.js), stamped on
     the end of its stalk and laid back to front, so the near leaves overlap the far ones
     the way they do on the tree. The far side of the crown is drawn softer and paler with
     only a faint outline; the near side and the crown's edge get a firm outline and, where
     they are big enough, their veins. The change is gradual with depth. */
  let accent = [0, 0, 0], aw = 0;
  // the few leaves that will come down today hang from bones of their own (see below)
  const fallers = new Set();
  {
    const pool = out.filter(L => L.e > 0.75 && L.y < 0.62 && L.A > 2.5);
    for (let i = 0; i < S.falling && pool.length; i++) fallers.add(pool[Math.floor(DR(0, pool.length))]);
  }
  let zlo = Infinity, zhi = -Infinity;
  for (const L of out) { zlo = Math.min(zlo, L.jz); zhi = Math.max(zhi, L.jz); }
  const order = out.slice().sort((a, b) => a.jz - b.jz);
  const LEAF_SIZE = 1.3;   // the atlas's lobe-length unit against the leaf's size in the tree
  for (const L of order) {
    const A = L.A, g = A < 0.95 ? 0.3 + 0.7 * smooth(0.1, 0.95, A) : A > 3.1 ? 0.85 : 1;
    // (in autumn each leaf turns on its own time, so the crown is gold, ochre and brown at once)
    let c = mul(S.leaf(A + L.jit * (A > 2.2 ? 4 : 1)), L.v);
    // lit from the upper left: the sunny side of the crown paler, its shaded side and the
    // leaves deep inside it darker and cooler
    c = L.lit > 0.5 ? mix(c, WHITE, (L.lit - 0.5) * 0.36) : mix(mul(c, [0.74, 0.76, 0.84]), c, L.lit * 2);
    // depth: 0 on the far side of the crown, 1 on the near side
    const dz = clamp((L.jz - zlo) / Math.max(1e-6, zhi - zlo), 0, 1);
    const near = Math.max(smooth(0.35, 0.85, dz), smooth(0.86, 1.0, L.e) * 0.85);
    // the far leaves sit back: paler and a little cooler, less contrast
    c = mix(c, [0.8, 0.82, 0.8], 0.28 * (1 - near));
    c = c.map(v => clamp(v, 0, 1));
    accent = accent.map((v, i) => v + c[i]); aw++;
    const b = boneOf[L.k], t0 = Math.min(0.91, tNode(L.k) + 0.05 + DR(0, 0.05));
    // the stalk first, from the twig, then the blade unfolds from its end
    const nx = X[L.k], ny = Y[L.k], jx = lerp(nx, L.jx, 0.55 + 0.45 * g), jy = lerp(ny, L.jy, 0.55 + 0.45 * g);
    line(nx, ny, b, jx, jy, b, 0.7, lerp(0.3, 0.55, near), t0, 0.012, mix(c, PEN, 0.4));
    if (fallers.has(L)) continue;
    K.leaf(jx, jy, b, L.th - Math.PI / 2, L.sz * g * LEAF_SIZE, L.sq, L.cell, L.curl, c, near, t0 + 0.012, 0.05, lerp(0.9, 1, near));
  }
  accent = aw ? accent.map(v => v / aw) : S.moss.slice();

  /* flower tassels (spring) and seed keys (summer into winter) at the shoot tips, laid
     over the leaves (pass 3) since they hang out past them */
  const tips = [];
  for (let k = 1; k < n; k++) if (!Kids[k].length && !G.Sc[k]) tips.push(k);
  const fr = mulberry32(seed + 5);
  for (const k of tips) {
    const pf = fr(), pk = fr(), nkeys = 2 + Math.floor(fr() * 3), sway = fr() * 2 - 1;
    const b = boneOf[k], t = Math.min(0.95, tNode(k) + 0.1);
    if (pf < 0.3 * S.flowers) {
      const len = 0.012 + 0.009 * fr(), pts = [];
      let x = X[k], y = Y[k], th = -Math.PI / 2 + 0.5 * sway;
      for (let i = 0; i <= 6; i++) { pts.push([x, y]); th += (-Math.PI / 2 - th) * 0.25; x += Math.cos(th) * len / 6; y += Math.sin(th) * len / 6; }
      const fb = bone(b, X[k], Y[k], pts[6][0], pts[6][1], KIND.TWIG, 4.5, 0.15, len * 2, len);
      poly(pts.map(p => [p[0], p[1], fb]), 0.8, 0.6, t, t + 0.02, [0.55, 0.6, 0.27, 2]);
      for (let i = 1; i <= 6; i++) {
        const p = pts[i], a = R(0, 6.28);
        line(p[0], p[1], fb, p[0] + Math.cos(a) * 0.0014, p[1] + Math.sin(a) * 0.0014, fb, R(1.8, 2.6), 0.8, t + 0.01, 0.01, [0.8, 0.79, 0.3, 2]);
      }
      line(pts[1][0], pts[1][1], fb, pts[5][0], pts[5][1], fb, -0.009, 0.12, t + 0.03, 0.03, [0.88, 0.87, 0.5, 2.5]);
    }
    if (pk < 0.12 * S.keys) {
      const hidden = P > 0.5 && P < 2.9 ? 0.55 : 1;   // among summer leaves they are hard to see
      for (let j = 0; j < nkeys; j++) {
        const sl = 0.004 + 0.003 * fr(), sa = -Math.PI / 2 + (fr() - 0.5) * 1.2;
        const sx = X[k] + Math.cos(sa) * sl, sy = Y[k] + Math.sin(sa) * sl;
        line(X[k], Y[k], b, sx, sy, b, 0.7, 0.55 * hidden, t, 0.01, [...S.keyColor, 2]);
        for (const w of [-1, 1]) {
          const wa = sa + w * (0.55 + 0.2 * fr()), wl = 0.0045 + 0.0015 * fr();
          line(sx, sy, b, sx + Math.cos(wa) * wl, sy + Math.sin(wa) * wl, b, 1.7, 0.75 * hidden, t + 0.01, 0.01, [...S.keyColor, 2]);
          if (j === 0) line(sx, sy, b, sx + Math.cos(wa) * wl, sy + Math.sin(wa) * wl, b, 0.6, 0.22 * hidden, t + 0.02, 0.01, [...PEN, 2]);
        }
      }
    }
  }

  /* leaves in the air: a few come down while the tree is dropping them. Each starts on
     the tree, as one of its leaves, on a bone of its own that lets go after a while */
  for (const L of fallers) {
    const x = L.jx, y = L.jy;
    const fb = bone(ROOT, x, y, x, y + 0.01, KIND.FALL, 1, 0, 0.01, 2 + groundY(x) + 0.006);
    const c = S.leaf(L.A + DR(0, 0.25));
    // (alpha 2 + 1 marks it as a falling leaf, which tumbles with its bone)
    K.leaf(x, y, fb, L.th - Math.PI / 2, L.sz * LEAF_SIZE, L.sq, L.cell, L.curl, c, 1, Math.min(0.95, tNode(L.k) + 0.07), 0.05, 3);
  }

  /* ---------- the ground: grass, sword fern and the year's fallen leaves ---------- */
  /* sword fern: evergreen, but it changes. New fronds unroll from fiddleheads in spring,
     bright against last year's; old outer fronds brown off from autumn; winter weather
     presses the clump flat */
  const fr2 = mulberry32(seed + 17);
  for (const [fx, nf, sc] of [[-0.25, 4, 0.55], [0.42, 4, 0.5]]) {
    const base = groundY(fx), flat = S.fernFlat;
    for (let k = 0; k < nf; k++) {
      const f = nf === 1 ? 0 : k / (nf - 1), outer = Math.abs(f - 0.5) > 0.3, pick = fr2(), len = fr2();
      const a = (lerp(-72, 72, f) * (1 + 0.22 * flat) + R(-8, 8)) * DEG;
      const L = lerp(0.05, 0.085, len) * sc * (1 - 0.35 * Math.abs(f - 0.5)) * (1 - 0.22 * flat);
      // this frond's colour today: browning if it is an old outer one, bright if it is new
      const old = outer && pick < 0.75 * S.fernOld, fresh = !outer && pick < 0.8 * Math.max(S.fernNew, S.fiddle);
      const fc = old ? mix(FERN, [0.56, 0.46, 0.28], 0.45 + 0.35 * S.fernOld) : fresh ? mix(FERN, [0.5, 0.66, 0.28], 0.65) : FERN;
      if (!outer && pick < 0.8 * S.fiddle && S.fernNew < 0.3) continue;    // still coiled: drawn as a fiddlehead below
      const pts = [];
      let x = fx + R(-0.004, 0.004), y = base, th = Math.PI / 2 - a;
      for (let i = 0; i <= 12; i++) { pts.push([x, y]); th += (Math.sign(a) || 1) * -0.035 * (1 + Math.abs(a)) * (1 + 0.6 * flat + (old ? 0.4 : 0)); x += Math.cos(th) * L / 12; y = Math.max(groundY(x) + 0.0006, y + Math.sin(th) * L / 12); }   // a frond that bends to the ground lies along it
      const end = pts[12], b = bone(ROOT, pts[0][0], pts[0][1], end[0], end[1], KIND.FERN, 5.5, 0.16, L * 1.5, L);
      const t0 = 0.22 + 0.05 * f;
      poly(pts.map(p => [p[0], p[1], b]), 0.85, 0.7, t0, t0 + 0.03, mul(fc, [0.8, 0.85, 0.8]));
      for (let i = 2; i < 12; i++) {
        const p = pts[i], q = pts[i + 1], dx = q[0] - p[0], dy = q[1] - p[1], dl = Math.hypot(dx, dy);
        const ux = dx / dl, uy = dy / dl, pl = (0.0065 * sc * Math.sin(Math.PI * (i - 1) / 12) + 0.0015) * (old ? 0.85 : 1);
        for (const sd of [-1, 1]) {
          // a browning frond loses some pinnae
          if (old && R(0, 1) < 0.25) continue;
          const c = Math.cos(sd * 62 * DEG), sn = Math.sin(sd * 62 * DEG), vx = ux * c - uy * sn, vy = ux * sn + uy * c;
          line(p[0], p[1], b, p[0] + vx * pl, p[1] + vy * pl, b, 1.15, 0.62, t0 + 0.03 * i / 12, 0.01, fc);
        }
      }
    }
    // fiddleheads: tight coils on short stalks, unrolling as spring goes on
    if (S.fiddle > 0.05) for (let k = 0; k < Math.round(2 + 2 * sc); k++) {
      const x0 = fx + R(-0.006, 0.006), h = (0.008 + 0.012 * S.fiddle) * sc * R(0.8, 1.2), lean = R(-0.35, 0.35);
      const b = bone(ROOT, x0, base, x0 + Math.sin(lean) * h, base + h, KIND.FERN, 6, 0.16, h * 1.5, h);
      const tx = x0 + Math.sin(lean) * h, ty = base + Math.cos(lean) * h, coil = [];
      line(x0, base, b, tx, ty, b, 0.9, 0.7, 0.24, 0.01, [0.42, 0.56, 0.26]);
      const turns = 1.6 - 0.6 * S.fernNew, rc = 0.0034 * sc + 0.001;
      for (let i = 0; i <= 10; i++) {
        const u = i / 10, ang = Math.PI / 2 - lean - u * turns * 6.283 * Math.sign(lean || 1), rr = rc * (1 - 0.75 * u);
        coil.push([tx + Math.sign(lean || 1) * rc + Math.cos(ang + Math.PI) * rr * Math.sign(lean || 1), ty + Math.sin(ang) * rr, b]);
      }
      poly(coil, 1.2, 0.72, 0.245, 0.26, [0.48, 0.62, 0.27]);
    }
  }
  /* grass and wildflowers. Plants stand in the same places every year (their own random
     stream); the date decides which are up, in leaf or in flower */
  // the spot the lidar note calls bare earth is kept bare
  const bare = x => x > LIDAR_X - 0.13 && x < LIDAR_X + 0.05;   // (the note itself sits to its left)
  const gr = mulberry32(seed + 13), GR = (a, b) => a + (b - a) * gr();
  /* the snow's surface: a lying depth that undulates, a drift the west wind piles against
     the trunk's windward side (left), the hollow it scoops in the lee, and little tails of
     drift behind the fern clumps */
  const xl = X[0] - r[0] * 0.95, xr = X[0] + r[0] * 0.95;
  const driftAt = x =>
    x < xl ? 0.052 * Math.exp((x - xl) / 0.085) :
    x < xr ? lerp(0.052, 0.012, smooth(xl, xr, x)) :
    0.012 * (1 - smooth(xr, xr + 0.03, x)) - 0.006 * Math.exp(-(((x - xr - 0.04) / 0.03) ** 2)) + 0.01 * Math.exp(-(((x - xr - 0.14) / 0.08) ** 2));
  const fernDrift = x => [-0.25, 0.42].reduce((a, fx) => a + 0.01 * Math.exp(-(((x - fx - 0.03) / 0.028) ** 2)) - 0.004 * Math.exp(-(((x - fx + 0.025) / 0.015) ** 2)), 0);
  const snowY = x => groundY(x) + S.snow * Math.max(0.004, 0.017 + 0.004 * Math.sin(x * 31 + 1) + 0.0025 * Math.sin(x * 83 + 2) + driftAt(x) + fernDrift(x));
  const sway = (x, y, h) => bone(ROOT, x, y, x, y + h, KIND.FERN, 6, 0.16, h * 1.5, h);
  const late = c => [c[0], c[1], c[2], 2 + (c[3] || 0)];       // ink laid over the snow
  // wildflowers are drawn a little larger than life, as a field sketch would, about their base
  const GS = 1.9;
  let ox = 0, oy = 0;
  const at0 = (x, y) => { ox = x; oy = y; };
  const pl = (x0, y0, b0, x1, y1, b1, w, ink, t, dur, c) =>
    line(ox + (x0 - ox) * GS, oy + (y0 - oy) * GS, b0, ox + (x1 - ox) * GS, oy + (y1 - oy) * GS, b1, w > 0 ? w * 1.35 : w * GS, ink, t, dur, c);
  const ppoly = (pts, w, ink, t0, t1, c) => poly(pts.map(p => [ox + (p[0] - ox) * GS, oy + (p[1] - oy) * GS, p[2]]), w, ink, t0, t1, c);
  for (let i = 0; i < 90; i++) {
    const x = GR(-0.5, 0.5), nb = Math.floor(GR(3, 8)), lk = GR(0.85, 1.15), seedy = gr();
    if (Math.abs(x) < 0.04 || bare(x)) continue;
    const y = groundY(x), b = sway(x, y, 0.012), over = S.snow > 0.2;
    for (let k = 0; k < nb; k++) {
      const a = (90 + GR(-30, 30) * (S.grassLen < 0.8 ? 1.3 : 1)) * DEG, l = GR(0.004, 0.013) * S.grassLen * lk;
      // under snow only the tips show above it
      if (over && y + Math.sin(a) * l < snowY(x) + 0.001) continue;
      const c = mul(S.grass, [R(0.85, 1.1), R(0.9, 1.08), R(0.85, 1.1)]);
      line(x + GR(-0.002, 0.002), y, b, x + Math.cos(a) * l, y + Math.sin(a) * l, b, 0.85, R(0.45, 0.7), 0.2 + 0.08 * Math.abs(x), 0.01, over ? late(c) : c);
      // summer grass goes to seed: a few taller stems with golden heads
      if (k === 0 && seedy < 0.55 * S.seedHeads) {
        const h = GR(0.016, 0.026), lean = GR(-0.25, 0.25), tx = x + Math.sin(lean) * h, ty = y + Math.cos(lean) * h;
        line(x, y, b, tx, ty, b, 0.7, 0.55, 0.22, 0.01, mix(S.grass, [0.62, 0.55, 0.32], 0.5));
        for (let j = 0; j < 5; j++) {
          const f = 0.72 + j * 0.06, px = lerp(x, tx, f), py = lerp(y, ty, f), sd = j % 2 ? 1 : -1;
          line(px, py, b, px + sd * 0.0018 + Math.sin(lean) * 0.002, py + 0.0016, b, 1.5, 0.6, 0.23, 0.01, [0.74, 0.64, 0.38]);
        }
      }
    }
    // western buttercups shine in the spring grass
    if (gr() < 0.5 * S.buttercup && Math.abs(x) > 0.12) {
      at0(x, y);
      const h = GR(0.008, 0.014), tx = x + GR(-0.003, 0.003);
      pl(x, y, b, tx, y + h, b, 0.6, 0.5, 0.22, 0.01, [0.36, 0.5, 0.22]);
      pl(tx - 0.0012, y + h, b, tx + 0.0012, y + h, b, 2.6, 0.85, 0.23, 0.01, [0.96, 0.82, 0.18]);
    }
  }
  // plants that come up in the same spot each year
  const plant = (n, x0, x1) => Array.from({ length: n }, () => { const x = GR(x0, x1); return { x, y: groundY(x), r: [gr(), gr(), gr(), gr()] }; }).filter(p => !bare(p.x));
  const fores = plant(5, -0.34, 0.34).filter(p => Math.abs(p.x) > 0.07);   // the shade under the crown
  const opens = plant(7, -0.5, 0.5).filter(p => Math.abs(p.x) > 0.22);    // the open grass beyond it
  // Oregon grape: a low evergreen shrub of spiny leaflets, yellow in spring, blue berries late summer
  for (const p of [fores[0], opens[1]].filter(Boolean)) {
    at0(p.x, p.y);
    for (let st = 0; st < 4; st++) {
      const h = GR(0.014, 0.024), lean = GR(-0.5, 0.5), tx = p.x + Math.sin(lean) * h, ty = p.y + Math.cos(lean) * h, b = sway(p.x, p.y, h);
      pl(p.x, p.y, b, tx, ty, b, 0.8, 0.6, 0.22, 0.01, [0.3, 0.27, 0.2]);
      for (let j = 1; j <= 4; j++) for (const sd of [-1, 1]) {
        const f = j / 4.4, px = lerp(p.x, tx, f), py = lerp(p.y, ty, f), a = lean * -1 + Math.PI / 2 + sd * 1.05;
        const ex = px + Math.cos(a) * 0.0045, ey = py + Math.sin(a) * 0.0045;
        pl(px, py, b, ex, ey, b, 1.7, 0.72, 0.23, 0.01, [0.2, 0.34, 0.2]);
        pl(px, py, b, ex, ey, b, 0.6, 0.45, 0.235, 0.01, PEN);
      }
      if (S.grape > 0.05) for (let j = 0; j < 6; j++) pl(tx, ty, b, tx + GR(-0.003, 0.003), ty + GR(0, 0.004), b, 2.2, 0.85 * S.grape, 0.24, 0.01, [0.95, 0.8, 0.2]);
      if (S.grapeBerry > 0.05) for (let j = 0; j < 5; j++) { const bx = tx + GR(-0.0025, 0.0025), by = ty - GR(0, 0.004); pl(bx, by, b, bx + 0.0004, by, b, 2.6, 0.8 * S.grapeBerry, 0.24, 0.01, [0.33, 0.38, 0.58]); }
    }
  }
  // western trillium: three broad leaves in a whorl and one three-petalled flower, white, ageing pink
  if (S.trilliumLeaf > 0.05) for (const p of fores.slice(1)) {
    at0(p.x, p.y);
    const h = 0.012 + 0.006 * p.r[0], tx = p.x + (p.r[1] - 0.5) * 0.003, ty = p.y + h * S.trilliumLeaf, b = sway(p.x, p.y, h);
    pl(p.x, p.y, b, tx, ty, b, 0.7, 0.6, 0.22, 0.01, [0.3, 0.42, 0.22]);
    for (let j = 0; j < 3; j++) {
      const a = p.r[2] * 2 + j * 2.09, ex = tx + Math.cos(a) * 0.0075, ey = ty + Math.sin(a) * 0.0028;
      pl(tx, ty, b, ex, ey, b, 3.4 * S.trilliumLeaf, 0.75, 0.23, 0.01, [0.27, 0.45, 0.2]);
    }
    if (S.trillium > 0.05) {
      const fc = mix([0.97, 0.97, 0.94], [0.8, 0.55, 0.7], S.trilliumAge), fy = ty + 0.004;
      pl(tx, ty, b, tx, fy, b, 0.6, 0.5, 0.24, 0.01, [0.3, 0.42, 0.22]);
      for (let j = 0; j < 3; j++) {
        const a = Math.PI / 2 + (j - 1) * 1.15, ex = tx + Math.cos(a) * 0.0055, ey = fy + Math.sin(a) * 0.004 - 0.001;
        pl(tx, fy, b, ex, ey, b, 3.2 * S.trillium, 0.9, 0.25, 0.01, fc);
        pl(tx, fy, b, ex, ey, b, 0.55, 0.4 * S.trillium, 0.255, 0.01, GRAPHITE);
      }
      pl(tx, fy, b, tx + 0.0005, fy + 0.0005, b, 1.6, 0.9 * S.trillium, 0.26, 0.01, [0.9, 0.78, 0.25]);
    }
  }
  // Pacific bleeding heart: ferny blue-green leaves and arching sprays of pink lockets
  if (S.bleedingLeaf > 0.05) for (const p of fores.slice(0, 3)) {
    const x = p.x + 0.02 * (p.r[3] - 0.5);
    at0(x, p.y);
    for (let j = 0; j < 6; j++) {
      const a = (90 + (j - 2.5) * 22) * DEG, l = (0.008 + 0.004 * gr()) * S.bleedingLeaf, ex = x + Math.cos(a) * l, ey = p.y + Math.sin(a) * l;
      pl(x, p.y, ROOT, ex, ey, ROOT, 0.6, 0.5, 0.22, 0.01, [0.38, 0.5, 0.42]);
      for (let q = 1; q <= 3; q++) { const f = q / 3.3; pl(lerp(x, ex, f), lerp(p.y, ey, f), ROOT, lerp(x, ex, f) + 0.0022 * Math.cos(a + 1.2), lerp(p.y, ey, f) + 0.0022 * Math.sin(a + 1.2), ROOT, 1.8, 0.6, 0.225, 0.01, [0.45, 0.6, 0.5]); }
    }
    if (S.bleeding > 0.05) {
      const h = 0.016, b = sway(x, p.y, h), pts = [];
      for (let q = 0; q <= 6; q++) { const f = q / 6; pts.push([x + f * 0.011, p.y + h * Math.sin(f * 2.4) * 0.9, b]); }
      ppoly(pts, 0.6, 0.6, 0.24, 0.25, [0.42, 0.35, 0.32]);
      for (let q = 2; q <= 6; q++) {
        const [fx, fy] = pts[q];
        pl(fx, fy, b, fx, fy - 0.0028, b, 0.5, 0.5, 0.25, 0.01, [0.42, 0.35, 0.32]);
        pl(fx - 0.0008, fy - 0.0034, b, fx + 0.0008, fy - 0.0034, b, 2.8, 0.85 * S.bleeding, 0.255, 0.01, [0.88, 0.45, 0.62]);
      }
    }
  }
  // common camas: a spike of blue-violet stars standing out of the open grass
  if (S.camas > 0.05) for (const p of opens) {
    at0(p.x, p.y);
    const h = 0.022 + 0.008 * p.r[0], b = sway(p.x, p.y, h);
    for (const sd of [-1, 1]) pl(p.x, p.y, b, p.x + sd * 0.004, p.y + 0.011, b, 0.8, 0.55, 0.22, 0.01, [0.36, 0.5, 0.24]);
    pl(p.x, p.y, b, p.x, p.y + h, b, 0.6, 0.55, 0.22, 0.01, [0.36, 0.5, 0.24]);
    for (let j = 0; j < 7; j++) {
      const f = 0.55 + j * 0.065, y = p.y + h * f, s = 0.0024 * (1 - j / 9);
      if (j / 7 > S.camas * 1.3) break;   // the spike opens from the bottom up
      for (let q = 0; q < 3; q++) { const a = q * 1.05 + j; pl(p.x - Math.cos(a) * s, y - Math.sin(a) * s * 0.6, b, p.x + Math.cos(a) * s, y + Math.sin(a) * s * 0.6, b, 1.3, 0.8, 0.23, 0.01, [0.46, 0.45, 0.82]); }
    }
  }
  // yarrow: feathery leaves and a flat white head through the summer
  if (S.yarrow > 0.05) for (const p of opens.concat(fores.slice(2)).slice(0, 6)) {
    const x = p.x + 0.012, y = groundY(x);
    at0(x, y);
    const h = (0.016 + 0.008 * p.r[1]) * (0.5 + 0.5 * S.yarrow), b = sway(x, y, h);
    pl(x, y, b, x, y + h, b, 0.65, 0.6, 0.22, 0.01, [0.4, 0.5, 0.3]);
    for (let j = 1; j < 4; j++) { const yy = y + h * j / 5; pl(x, yy, b, x + (j % 2 ? 1 : -1) * 0.004, yy + 0.002, b, 1.4, 0.45, 0.225, 0.01, [0.42, 0.52, 0.34]); }
    for (let j = 0; j < 7; j++) { const fx = x + (j - 3) * 0.0011, fy = y + h + 0.0005 * Math.cos((j - 3) * 0.5); pl(fx, fy, b, fx + 0.0003, fy, b, 1.9, 0.9 * S.yarrow, 0.23, 0.01, [0.95, 0.94, 0.88]); pl(fx, fy, b, fx + 0.0003, fy, b, 0.55, 0.35 * S.yarrow, 0.235, 0.01, GRAPHITE); }
  }
  {
    const nl = Math.round(560 * S.litter * (1 - S.snow));   // fresh snow buries the litter
    for (let i = 0; i < nl; i++) {
      let x = R(-0.52, 0.52);
      if (Math.abs(x) > 0.38 && R(0, 1) < 0.6) x *= 0.6;          // most fall under the crown
      const y = groundY(x) + R(0.0004, 0.0045) + (Math.abs(x) < 0.05 ? 0.002 : 0);
      const c = mul(mix([0.44, 0.34, 0.24], S.leaf(R(2.7, 3.6)), S.litterFresh), [R(0.9, 1.08), R(0.9, 1.06), R(0.9, 1.06)]);
      const a = R(-0.35, 0.35), l = R(0.0045, 0.008);
      for (const o of [-0.5, 0, 0.5]) pl(x, y, ROOT, x + Math.cos(a + o) * l, y + Math.sin(a + o) * l * 0.45, ROOT, 1.9, R(0.55, 0.8), 0.24 + 0.06 * Math.abs(x), 0.01, c);
    }
  }

  // autumn mushrooms come up through the litter near the roots
  if (S.mushrooms > 0.05) for (const p of plant(8, -0.3, 0.3)) {
    // (clear of the trunk and of the sword ferns, which would hide them)
    if (Math.abs(p.x) < 0.05 || Math.abs(p.x + 0.25) < 0.035 || p.r[0] > 0.8) continue;
    at0(p.x, p.y);
    const h = (0.004 + 0.004 * p.r[1]) * (0.6 + 0.4 * S.mushrooms), cw = 0.003 + 0.0025 * p.r[2], top = p.y + h;
    pl(p.x, p.y, ROOT, p.x, top, ROOT, 1.6, 0.6, 0.26, 0.01, [0.86, 0.8, 0.68]);
    pl(p.x, p.y, ROOT, p.x, top, ROOT, 0.5, 0.5, 0.265, 0.01, PEN);
    const cap = [];
    for (let q = 0; q <= 6; q++) { const a = Math.PI * q / 6; cap.push([p.x - Math.cos(a) * cw, top + Math.sin(a) * cw * 0.55, ROOT]); }
    pl(p.x - cw * 0.6, top + cw * 0.18, ROOT, p.x + cw * 0.6, top + cw * 0.18, ROOT, -cw * 0.75, 0.75 * S.mushrooms, 0.27, 0.01, [0.66, 0.46, 0.26]);
    ppoly(cap, 0.7, 0.7, 0.27, 0.28, PEN);
    pl(cap[0][0], cap[0][1], ROOT, cap[6][0], cap[6][1], ROOT, 0.6, 0.55, 0.28, 0.01, PEN);
  }

  /* winter snow: bare paper laid over the ground layer, a soft cool shadow in its hollows
     and one quick line along its surface; a dusting lies along the tops of the big limbs */
  if (S.snow > 0.05) {
    const st = 0.006, snowLine = [];
    for (let x = -0.53; x <= 0.53 + 1e-6; x += st) {
      const g0 = groundY(x) + 0.0007, g1 = groundY(x + st) + 0.0007, s0 = snowY(x), s1 = snowY(x + st);
      if (s0 - g0 > 0.0008) line(x - st * 0.2, (g0 + s0) / 2, ROOT, x + st * 1.2, (g1 + s1) / 2, ROOT, -(Math.max(s0 - g0, s1 - g1) + 0.0004), 1, 0.3, 0.01, [1, 1, 1, -2.5]);
      snowLine.push([x, s0, ROOT]);
      if (R(0, 1) < 0.5) line(x, (g0 + s0) / 2 - 0.0008, ROOT, x + st * R(0.6, 1.4), (g1 + s1) / 2 - 0.0012, ROOT, -(s0 - g0) * 0.7, R(0.06, 0.12) * S.snow, 0.31, 0.02, late([0.62, 0.68, 0.82, 0.6]));
    }
    // the surface line breaks here and there, as a quick pen line does
    for (let i = 0; i < snowLine.length - 1;) {
      const j = Math.min(snowLine.length - 1, i + Math.floor(R(4, 14)));
      poly(snowLine.slice(i, j + 1), 1, 0.62 * S.snow, 0.31, 0.33, late(GRAPHITE));
      i = j + (R(0, 1) < 0.6 ? 1 : 2);
    }
    // the drift's wind-carved face: a few broken lines following its surface, and a cool
    // shadow in the scoop on the lee side of the trunk
    for (let j = 0; j < 4; j++) {
      const u = 0.25 + 0.17 * j, x0 = xl - R(0.04, 0.2), x1 = xl - R(0, 0.02), pts = [];
      for (let x = x0; x <= x1; x += 0.004) pts.push([x, lerp(groundY(x), snowY(x), 1 - u * R(0.9, 1.1)), ROOT]);
      for (let i = 0; i < pts.length - 1;) {
        const k = Math.min(pts.length - 1, i + Math.floor(R(3, 8)));
        poly(pts.slice(i, k + 1), 0.7, 0.3 * S.snow, 0.33, 0.35, late(GRAPHITE));
        i = k + Math.floor(R(1, 4));
      }
    }
    for (let x = xr; x < xr + 0.09; x += 0.006) line(x, snowY(x) - 0.003, ROOT, x + 0.008, snowY(x + 0.008) - 0.003, ROOT, -0.007, 0.12 * S.snow, 0.33, 0.02, late([0.62, 0.68, 0.82, 0.6]));
    for (let x = xl - 0.1; x < xl; x += 0.008) line(x, snowY(x) - 0.006, ROOT, x + 0.01, snowY(x + 0.01) - 0.006, ROOT, -0.009, 0.06 * S.snow, 0.33, 0.02, late([0.62, 0.68, 0.82, 0.6]));
    if (S.snow > 0.4) for (const ch of chains) {
      if (ch.length < 3 || r[ch[1]] < 0.008) continue;
      for (let i = 1; i < ch.length - 1; i++) {
        const k = ch[i], q = ch[i + 1], dx = X[q] - X[k], dy = Y[q] - Y[k], L = Math.hypot(dx, dy) || 1;
        if (Math.abs(dy / L) > 0.72 || Y[k] < 0.1) continue;
        let nx = -dy / L, ny = dx / L; if (ny < 0) { nx = -nx; ny = -ny; }
        const c = Math.min(0.004, r[k] * 0.35) * (1 - Math.abs(dy / L) / 0.72) * S.snow, b = boneOf[q];
        const o0 = r[k] * 0.55, o1 = r[k] + c, mid = (o0 + o1) / 2;
        line(X[k] + nx * mid, Y[k] + ny * mid, b, X[q] + nx * mid, Y[q] + ny * mid, b, -(o1 - o0), 1, tNode(q) + 0.12, 0.01, [1, 1, 1, -2]);
        line(X[k] + nx * o1, Y[k] + ny * o1, b, X[q] + nx * o1, Y[q] + ny * o1, b, 0.8, 0.55, tNode(q) + 0.13, 0.01, late(GRAPHITE));
        line(X[k] + nx * r[k] * 0.6, Y[k] + ny * r[k] * 0.6, b, X[q] + nx * r[k] * 0.6, Y[q] + ny * r[k] * 0.6, b, -r[k] * 0.12, 0.1, tNode(q) + 0.13, 0.01, late([0.62, 0.68, 0.82, 0.6]));
      }
    }
  }

  /* snow still coming down: a slow fall of flakes, each a speck of bare paper with a
     graphite tick, so they show white against the bark and grey against the page */
  if (S.snow > 0.55) for (let i = 0; i < 48; i++) {
    const x = DR(-0.6, 0.64), y = DR(0.08, 1.14);
    const fb = bone(ROOT, x, y, x, y + 0.01, KIND.FALL, 1, 0, 0.01, 1 + groundY(x) + 0.02 * S.snow);
    line(x, y, fb, x + 0.0002, y, fb, -0.0032, 1, 0.95, 0.01, [1, 1, 1, -2]);
    for (let q = 0; q < 3; q++) { const a = q * 1.05 + DR(0, 1); line(x - Math.cos(a) * 0.0013, y - Math.sin(a) * 0.0013, fb, x + Math.cos(a) * 0.0013, y + Math.sin(a) * 0.0013, fb, 0.6, 0.42, 0.95, 0.01, late(GRAPHITE)); }
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
    const xr = LIDAR_X;
    let hit = 0;
    for (let i = 0; i < treeEnd; i++) {
      for (const kk of [0, 2]) { const x = seg[i * 4 + kk], y = seg[i * 4 + kk + 1]; if (Math.abs(x - xr) < 0.003 && y > hit && y < 1.05) hit = y; }
    }
    // (a leaf's blade reaches about its size out from its stalk)
    for (let i = 0; i < K.lf.length; i += 16) {
      const x = K.lf[i], y = K.lf[i + 1], sz = K.lf[i + 4];
      if (Math.abs(x - xr) < sz * 0.6 && y + sz * 0.7 > hit && y < 1.05) hit = y + sz * 0.7;
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
  T.leafAtlas = () => leafAtlas(seed + 1);
  T.leafPen = PEN;
  {
    // where a crow can come down to forage: bare ground under the spread of the crown, clear of the trunk
    const xs = leaves.map(l => l.jx).sort((a, b) => a - b), q = f => xs.length ? xs[Math.floor(f * (xs.length - 1))] : 0;
    const x0 = X[0], lo = Math.min(x0 - 0.12, x0 + (q(0.1) - x0) * 0.85), hi = Math.max(x0 + 0.12, x0 + (q(0.9) - x0) * 0.85);
    T.ground = { y: groundY, spans: [[lo, x0 - 0.09], [x0 + 0.09, hi]] };
  }
  T.loadFlex = { trunk: 0.005, branch: 0.0035 };   // the trunk and limbs bend under the load of the crown (see sketch.js)
  return T;
}
