/* The architecture of an open-grown maple, grown in three dimensions and then flattened
   onto the page by maple.js. The page draws a vine maple (Acer circinatum, VINE below);
   the bigleaf maple it began with (Acer macrophyllum, MAPLE) is kept as a second form.

   It is a self-organising tree model in the manner of Palubicki et al. (2009), "Self-
   organizing tree models for image synthesis", reduced to what a drawing needs:

   - Every shoot is a chain of metamers (internode + node). Each node carries an opposite
     pair of lateral buds, and each pair is turned a quarter turn from the last
     (decussate), as on a maple twig.
   - Buds compete for space and light. The crown is an irregular volume filled with
     markers; each marker counts for the nearest bud whose cone of perception holds it.
     A bud's share of markers is its light, and their direction is where it is free to grow.
   - Light is gathered down the tree, then the tree's vigour is handed back up it,
     split at every node between the leader and its laterals (Borchert and Honda's model
     of apical control). Well-lit buds grow long shoots; shaded ones stay dormant and die.
   - A shoot bends as it grows towards its free space, the light above and outward, and
     its own previous heading, so limbs curve because of where they grew, not because of
     noise.
   - Maples carry flowers on terminal buds; a shoot that flowers stops, and the opposite
     pair below it takes over, which is how maples fork.
   - Branches that stop paying their way in light are shed, leaving a knot.
   - Last, limbs sag under their own weight in proportion to the load they carry and how
     slender they are (stiffness goes with r^4), so big limbs arch out and the tips, which
     grew towards the light, turn up again.

   Units match the page: the ground is y = 0, the tree is about 1 tall, z points at the
   viewer. Everything is seeded, so the tree is the same on every visit and on every date. */

function mulberry32(a) {
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const DEG = Math.PI / 180;
const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// quaternions [w, x, y, z]
const qAxis = (ax, a) => { const s = Math.sin(a / 2); return [Math.cos(a / 2), ax[0] * s, ax[1] * s, ax[2] * s]; };
const qMul = (p, q) => [
  p[0] * q[0] - p[1] * q[1] - p[2] * q[2] - p[3] * q[3],
  p[0] * q[1] + p[1] * q[0] + p[2] * q[3] - p[3] * q[2],
  p[0] * q[2] - p[1] * q[3] + p[2] * q[0] + p[3] * q[1],
  p[0] * q[3] + p[1] * q[2] - p[2] * q[1] + p[3] * q[0]];
const qRot = (q, v) => {
  const [w, x, y, z] = q, tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
};

/* a sparse grid of points for neighbour queries */
function grid(cs) {
  const m = new Map(), key = (i, j, k) => (i * 73856093) ^ (j * 19349663) ^ (k * 83492791);
  return {
    add(id, x, y, z) { const g = key(Math.floor(x / cs), Math.floor(y / cs), Math.floor(z / cs)); let c = m.get(g); if (!c) m.set(g, c = []); c.push(id); },
    near(x, y, z, f) {
      const i0 = Math.floor(x / cs), j0 = Math.floor(y / cs), k0 = Math.floor(z / cs);
      for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) for (let k = k0 - 1; k <= k0 + 1; k++) {
        const c = m.get(key(i, j, k)); if (c) for (const id of c) f(id);
      }
    }
  };
}

export const MAPLE = {
  L: 0.0095,            // metamer length
  years: 24,
  markers: 15000,
  crown: { x: 0.025, y: 0.6, z: 0, rx: 0.49, ry: 0.37, rz: 0.4, yMin: 0.2, under: 1.22 },
  boleTop: 0.18,
  cone: 50 * DEG,       // half-angle of a bud's perception
  occupy: 2.1,          // markers within this many metamers of wood are taken
  maxShoot: 7,          // metamers a bud can grow in one season
  free: 0.1,            // how strongly a shoot turns towards its free space, against its heading
  vigour: 0.45,         // metamers per unit of resource
  apical: 0.55,         // Borchert-Honda lambda on leaders; laterals use a little less
  flower: 0.05,         // chance a mature terminal bud flowers in a season (and the shoot forks)
  shed: 0.11,           // a branch is shed when its light per node falls below this
  sag: 0.9e-5           // how much a limb bends per unit of load moment over r^4
};

/* A vine maple (Acer circinatum) grown in the open: a clump of slender stems from one
   base, leaning out and arching as they go, under a broad, low, layered crown. Its
   leaders give way to their laterals sooner than a bigleaf's (lower apical control),
   it forks more often, and its thin wood bends further under its load */
export const VINE = {
  L: 0.0085,
  years: 24,
  markers: 15000,
  crown: { x: 0.0, y: 0.57, z: 0, rx: 0.36, ry: 0.43, rz: 0.3, yMin: 0.13, under: 1.12 },
  stems: 6,             // stems from the clump
  stemLean: [8, 32],    // degrees from upright at the base
  stemLen: [0.06, 0.14],// before each stem starts to branch freely
  baseR: 0.022,         // the clump's radius at the ground
  boleTop: 0.18,
  cone: 50 * DEG,
  occupy: 2.1,
  maxShoot: 6,
  free: 0.12,
  vigour: 0.45,
  apical: 0.57,
  flower: 0.08,
  flowerY: 0.18,
  up: [0.075, 0.05],    // the pull upwards on leaders and on side shoots
  out: 0.03,            // and outwards from the crown's centre
  shed: 0.1,
  sag: 2e-5
};
// the tree this page draws, and the seed it is grown from (picked from a run of seeds
// for a full, even crown with no lone limb standing off its side)
export const TREE = VINE;
export const TREE_SEED = 20451160;

/* the crown volume: a broad, irregular dome, a little heavier on one side. It draws the
   seed's first six numbers, so a baked tree can rebuild it without growing again */
function crownOf(seed, P) {
  const rnd = mulberry32(seed), R = (a, b) => a + (b - a) * rnd();
  const C = P.crown;
  const ph = Array.from({ length: 6 }, () => R(0, 6.3));
  const env3 = (x, y, z) => {
    // (the underside is shallower than the top, so it curves up towards the edges)
    const u = (x - C.x) / C.rx, v = (y - C.y) / C.ry * (y > C.y ? 1.06 : C.under), w = (z - C.z) / C.rz;
    const th = Math.atan2(v, Math.hypot(u, w)), az = Math.atan2(w, u), ct = Math.cos(th);
    const lobe = 1 + 0.08 * Math.sin(3 * az + ph[0]) * ct + 0.06 * Math.sin(2 * az + 2 * th + ph[1])
      + 0.05 * Math.sin(5 * az + ph[2]) * ct * ct + 0.04 * Math.sin(3 * th + ph[3]);
    return Math.hypot(u, v, w) / lobe;
  };
  // its outline as seen from the front, for lighting the leaves and for the drawing's layout
  const env = (x, y) => {
    const u = (x - C.x) / C.rx, v = (y - C.y) / C.ry * (y > C.y ? 1.06 : C.under), th = Math.atan2(v, Math.abs(u)), az = u < 0 ? Math.PI : 0;
    const ct = Math.cos(th), lobe = 1 + 0.08 * Math.sin(3 * az + ph[0]) * ct + 0.06 * Math.sin(2 * az + 2 * th + ph[1])
      + 0.05 * Math.sin(5 * az + ph[2]) * ct * ct + 0.04 * Math.sin(3 * th + ph[3]);
    return Math.hypot(u, v) / lobe;
  };
  return { rnd, R, C, env3, env };
}

/* what the drawing reads off a finished skeleton */
function finish(x, y, z, par, r, Sc, knots, crown) {
  const n = x.length, Kids = Array.from({ length: n }, () => []);
  for (let k = 1; k < n; k++) Kids[par[k]].push(k);
  const dist = new Float32Array(n);
  for (let k = 1; k < n; k++) dist[k] = dist[par[k]] + Math.hypot(x[k] - x[par[k]], y[k] - y[par[k]]);
  let dmax = 0; for (let k = 0; k < n; k++) dmax = Math.max(dmax, dist[k]);
  const hTip = new Int32Array(n).fill(1e6);
  for (let k = n - 1; k >= 0; k--) {
    if (!Kids[k].length) hTip[k] = 0;
    if (par[k] >= 0) hTip[par[k]] = Math.min(hTip[par[k]], hTip[k] + 1);
  }
  let fork = 0; for (let k = 0; k < n; k++) if (Sc[k] === 2) fork = k;
  return { n, X: x, Y: y, Z: z, Par: par, Kids, r, Sc, dist, dmax, env: crown.env, C: crown.C, forkY: y[fork], fork, hTip, knots };
}

export function growMaple(seed = TREE_SEED, P = TREE) {
  const crown = crownOf(seed, P), { rnd, R, C, env3 } = crown;
  const L = P.L;

  /* ---- markers ---- */
  const MX = [], MY = [], MZ = [];
  for (let tries = 0; MX.length < P.markers && tries < P.markers * 20; tries++) {
    const x = C.x + R(-1.2, 1.2) * C.rx, y = R(C.yMin, C.y + C.ry * 1.15), z = C.z + R(-1.2, 1.2) * C.rz;
    if (env3(x, y, z) <= 1) { MX.push(x); MY.push(y); MZ.push(z); }
  }
  const NM = MX.length, mAlive = new Uint8Array(NM).fill(1), mGrid = grid(0.05);
  for (let m = 0; m < NM; m++) mGrid.add(m, MX[m], MY[m], MZ[m]);
  const rOcc = P.occupy * L;
  const occupy = (x, y, z) => mGrid.near(x, y, z, m => {
    if (!mAlive[m]) return;
    const dx = MX[m] - x, dy = MY[m] - y, dz = MZ[m] - z;
    if (dx * dx + dy * dy + dz * dz < rOcc * rOcc) mAlive[m] = 0;
  });

  /* ---- wood and buds ---- */
  const X = [], Y = [], Z = [], Par = [], Dir = [], Pair = [], Ord = [], IsMain = [], kids = [], budsAt = [];
  const dead = [];
  const node = (x, y, z, p, d, pair, ord, main) => {
    const k = X.length;
    X.push(x); Y.push(y); Z.push(z); Par.push(p); Dir.push(d); Pair.push(pair); Ord.push(ord); IsMain.push(main);
    kids.push([]); budsAt.push([]); dead.push(0);
    if (p >= 0) kids[p].push(k);
    return k;
  };
  const bN = [], bD = [], bT = [], bA = [], bO = [], bIdle = [];
  const bud = (k, d, term, ord) => { const b = bN.length; bN.push(k); bD.push(d); bT.push(term); bA.push(1); bO.push(ord); bIdle.push(0); budsAt[k].push(b); return b; };
  // an opposite pair of lateral buds at node k, splayed beta from the shoot
  const pairAt = (k, beta) => {
    const d = Dir[k], a = Pair[k], cb = Math.cos(beta), sb = Math.sin(beta);
    for (const s of [-1, 1]) bud(k, norm([d[0] * cb + a[0] * s * sb, d[1] * cb + a[1] * s * sb, d[2] * cb + a[2] * s * sb]), 0, Ord[k] + 1);
  };
  const decussate = (d, a) => norm(cross(d, a));

  /* a clump of stems from one base, each its own leader, leaning out and arching a
     little further as it rises */
  if (P.stems) {
    const root = node(0, 0, 0, -1, [0, 1, 0], [1, 0, 0], 0, 1), n = P.stems, az0 = R(0, 6.3);
    for (let s = 0; s < n; s++) {
      // (spread round the clump, a little more across the page than into it, so the arching shows)
      let az = az0 + (s + R(-0.3, 0.3)) / n * 2 * Math.PI; az = Math.atan2(Math.sin(az) * 0.7, Math.cos(az));
      const lean0 = R(P.stemLean[0], P.stemLean[1]) * DEG, m = Math.round(R(P.stemLen[0], P.stemLen[1]) / L);
      let p = root, x = 0.004 * Math.cos(az), y = 0, z = 0.004 * Math.sin(az), a = norm([-Math.sin(az), 0, Math.cos(az)]);
      for (let i = 1; i <= m; i++) {
        const lean = lean0 + 12 * DEG * i / m;
        const d = norm([Math.sin(lean) * Math.cos(az), Math.cos(lean), Math.sin(lean) * Math.sin(az)]);
        x += d[0] * L; y += d[1] * L; z += d[2] * L;
        a = decussate(d, a);
        p = node(x, y, z, p, d, a, 0, 1);
        if (i > 3) pairAt(p, R(45, 60) * DEG);
      }
      bud(p, Dir[p], 1, 0);
    }
  } else
  /* the bole: grown in its first years as a single leader. It starts with a slight lean
     and rights itself towards the light, the way a tree recovers from a lean */
  {
    const az = R(150, 200) * DEG, n = Math.round(P.boleTop / L);
    let p = -1, x = 0, y = 0, z = 0, a = norm([Math.sin(R(-0.4, 0.4)), 0, Math.cos(0.3)]);
    for (let i = 0; i <= n; i++) {
      const lean = lerp(7, -2.5, smooth(0, 1, i / n)) * DEG;
      const d = norm([Math.sin(lean) * Math.cos(az), Math.cos(lean), Math.sin(lean) * Math.sin(az)]);
      if (i) { x += d[0] * L; y += d[1] * L; z += d[2] * L; }
      a = i ? decussate(d, a) : norm(cross(d, [0, 0, 1]));
      p = node(x, y, z, p, d, a, 0, 1);
      if (i > 2) pairAt(p, R(48, 60) * DEG);
    }
    // the bole's terminal bud flowered and the top pair became the two leaders of an
    // open-grown maple's low fork. Turn that pair so the fork opens mostly across the
    // page, with some depth, and splay it less than an ordinary pair
    const top = p, d = Dir[top];
    Pair[top] = norm([Math.cos(R(14, 26) * DEG), 0, Math.sin(R(14, 26) * DEG) * (rnd() < 0.5 ? -1 : 1)]);
    for (const b of budsAt[top]) bA[b] = 0;
    budsAt[top] = [];
    pairAt(top, R(28, 36) * DEG);
  }
  const fork = X.length - 1;

  /* ---- the seasons of growth ---- */
  const knots = [];
  for (let year = 0; year < P.years; year++) {
    const n = X.length, nb = bN.length;
    const rho = lerp(0.17, 0.058, smooth(0, 7, year)), cosCone = Math.cos(P.cone);

    // terminal buds of mature shoots flower now and then; the shoot stops and forks
    if (year >= 3) for (let b = 0; b < nb; b++) {
      if (!bA[b] || !bT[b] || bO[b] < 1 || Y[bN[b]] < (P.flowerY ?? 0.32)) continue;
      if (rnd() < P.flower) bA[b] = 0;
    }

    // light: each free marker counts for the nearest bud that can see it
    const bQ = new Float64Array(nb), bV = new Float64Array(nb * 3), bGrid = grid(rho);
    for (let b = 0; b < nb; b++) if (bA[b]) { const k = bN[b]; bGrid.add(b, X[k], Y[k], Z[k]); }
    for (let m = 0; m < NM; m++) {
      if (!mAlive[m]) continue;
      let best = -1, bd = rho * rho, bx = 0, by = 0, bz = 0;
      bGrid.near(MX[m], MY[m], MZ[m], b => {
        const k = bN[b], dx = MX[m] - X[k], dy = MY[m] - Y[k], dz = MZ[m] - Z[k], d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= bd || d2 < 1e-12) return;
        const d = Math.sqrt(d2), D = bD[b];
        if ((dx * D[0] + dy * D[1] + dz * D[2]) / d < cosCone) return;
        best = b; bd = d2; bx = dx / d; by = dy / d; bz = dz / d;
      });
      if (best < 0) continue;
      bQ[best] += 1; bV[best * 3] += bx; bV[best * 3 + 1] += by; bV[best * 3 + 2] += bz;
    }

    // gather it down the tree ...
    const Qn = new Float64Array(n);
    for (let b = 0; b < nb; b++) if (bA[b]) Qn[bN[b]] += bQ[b];
    for (let k = n - 1; k > 0; k--) if (!dead[k]) Qn[Par[k]] += Qn[k];
    // ... and hand the vigour back up, split at each node between leader and laterals
    const vIn = new Float64Array(n), bRes = new Float64Array(nb);
    vIn[0] = Qn[0];
    for (let k = 0; k < n; k++) {
      if (dead[k] || vIn[k] <= 0) continue;
      let mainBud = -1, Qm = 0, Ql = 0;
      const mains = [];                          // (a clump's base has several leaders)
      for (const c of kids[k]) if (!dead[c]) { if (IsMain[c]) { mains.push(c); Qm += Qn[c]; } else Ql += Qn[c]; }
      for (const b of budsAt[k]) if (bA[b]) { if (bT[b]) { mainBud = b; Qm += bQ[b]; } else Ql += bQ[b]; }
      if (Qm + Ql <= 0) continue;
      const lam = Ord[k] <= 1 ? P.apical : P.apical - 0.03, den = lam * Qm + (1 - lam) * Ql;
      const vm = vIn[k] * lam * Qm / den, vl = vIn[k] - vm;
      for (const c of mains) vIn[c] += Qm > 0 ? vm * Qn[c] / Qm : 0;
      if (mainBud >= 0) bRes[mainBud] += Qm > 0 ? vm * bQ[mainBud] / Qm : 0;
      if (Ql > 0) {
        for (const c of kids[k]) if (!dead[c] && !IsMain[c]) vIn[c] += vl * Qn[c] / Ql;
        for (const b of budsAt[k]) if (bA[b] && !bT[b]) bRes[b] += vl * bQ[b] / Ql;
      }
    }

    // buds with enough vigour grow this season's shoot
    for (let b = 0; b < nb; b++) {
      if (!bA[b]) continue;
      const nm = Math.min(P.maxShoot, Math.floor(bRes[b] * P.vigour));
      if (nm < 1) { if (bQ[b] === 0 && ++bIdle[b] > 2) bA[b] = 0; continue; }
      bA[b] = 0;
      const free = bQ[b] > 0 ? norm([bV[b * 3], bV[b * 3 + 1], bV[b * 3 + 2]]) : [0, 0, 0];
      let p = bN[b], d = bD[b], a = bT[b] ? Pair[p] : norm(cross(d, Dir[p]));
      const ord = bO[b];
      for (let i = 0; i < nm; i++) {
        // where it is free to grow, the light (up, and outward from the crown), and the
        // heading it already has: the three together bend the shoot as it lengthens
        const hx = X[p] - C.x, hz = Z[p] - C.z, hl = Math.hypot(hx, hz) || 1;
        // (each pull is small per metamer, so a shoot turns in a curve along its length
        // rather than with an elbow at the start of each season's growth)
        const up = ord <= 1 ? (P.up ? P.up[0] : 0.085) : (P.up ? P.up[1] : 0.05), out = P.out ?? 0.025;
        d = norm([d[0] + P.free * free[0] + out * hx / hl, d[1] + P.free * free[1] + up, d[2] + P.free * free[2] + out * hz / hl]);
        a = decussate(d, a);
        const q = node(X[p] + d[0] * L, Y[p] + d[1] * L, Z[p] + d[2] * L, p, d, a, ord, bT[b] || i > 0 ? 1 : 0);
        occupy(X[q], Y[q], Z[q]);
        pairAt(q, R(42, 58) * DEG);
        p = q;
      }
      bud(p, d, 1, ord);
    }

    // self-pruning: a branch that no longer earns its keep in light is shed, and the
    // wood closes over the stub as a knot
    if (year >= 6) {
      const n2 = X.length, size = new Float64Array(n2), tips = new Float64Array(n2), Q2 = new Float64Array(n2);
      for (let k = 0; k < Math.min(n, n2); k++) Q2[k] = Qn[k];
      for (let k = n2 - 1; k >= 0; k--) {
        if (dead[k]) continue;
        size[k] += 1; if (!kids[k].some(c => !dead[c])) tips[k] = 1;
        if (Par[k] >= 0) { size[Par[k]] += size[k]; tips[Par[k]] += tips[k]; }
      }
      for (let k = 1; k < n; k++) {
        if (dead[k] || IsMain[k] || size[k] < 6 || dead[Par[k]]) continue;
        if (Q2[k] / size[k] >= P.shed) continue;
        knots.push({ k: Par[k], tips: tips[k], d: Dir[k] });
        const stack = [k];
        while (stack.length) { const j = stack.pop(); dead[j] = 1; for (const b of budsAt[j]) bA[b] = 0; for (const c of kids[j]) stack.push(c); }
      }
    }
  }

  // the last season: lit dormant buds put out short spur shoots, the fine twigging of a crown
  {
    const nb = bN.length;
    for (let b = 0; b < nb; b++) {
      if (!bA[b] || bT[b] || dead[bN[b]] || Y[bN[b]] < C.yMin || rnd() > 0.35) continue;
      let p = bN[b], d = bD[b], a = norm(cross(d, Dir[p]));
      const nm = 1 + (rnd() < 0.4 ? 1 : 0);
      for (let i = 0; i < nm; i++) {
        d = norm([d[0], d[1] + 0.05, d[2]]); a = decussate(d, a);
        p = node(X[p] + d[0] * L * 0.8, Y[p] + d[1] * L * 0.8, Z[p] + d[2] * L * 0.8, p, d, a, bO[b], i > 0 ? 1 : 0);
      }
    }
  }

  /* ---- keep the living wood, renumbered (parents still come before children) ---- */
  const N0 = X.length, id = new Int32Array(N0).fill(-1);
  let n = 0;
  for (let k = 0; k < N0; k++) if (!dead[k] && (k === 0 || id[Par[k]] >= 0)) id[k] = n++;
  const x = new Float32Array(n), y = new Float32Array(n), z = new Float32Array(n), par = new Int32Array(n), main = new Uint8Array(n), ord = new Uint8Array(n);
  for (let k = 0; k < N0; k++) if (id[k] >= 0) {
    const i = id[k]; x[i] = X[k]; y[i] = Y[k]; z[i] = Z[k]; par[i] = k ? id[Par[k]] : -1; main[i] = IsMain[k]; ord[i] = Ord[k];
  }
  const bole = new Uint8Array(n);
  for (let k = 0; k <= fork; k++) if (id[k] >= 0) bole[id[k]] = 1;
  const Kids = Array.from({ length: n }, () => []);
  for (let k = 1; k < n; k++) Kids[par[k]].push(k);

  /* ---- pipe model: a limb's cross-section carries all the shoots beyond it ---- */
  const r = new Float32Array(n), acc = new Float32Array(n), E = 2.45, r0 = 0.00105;
  for (let k = n - 1; k >= 0; k--) {
    r[k] = acc[k] > 0 ? Math.pow(acc[k], 1 / E) : r0;
    if (par[k] >= 0) acc[par[k]] += Math.pow(r[k], E);
  }
  // (scaled so the bigleaf's fork, or the vine maple's clump at the ground, has its girth)
  const fk = P.stems ? 0 : id[fork], gam = Math.log((P.stems ? P.baseR : 0.035) / 0.0006) / Math.log(r[fk] / r0);
  for (let k = 0; k < n; k++) r[k] = 0.0006 * Math.pow(r[k] / r0, gam);

  /* ---- sag: each node bends the wood beyond it down by its load moment over r^4 ---- */
  {
    const m = new Float64Array(n), mx = new Float64Array(n), mz = new Float64Array(n);
    for (let k = n - 1; k > 0; k--) {
      const w = r[k] * r[k] * L;
      m[k] += w; mx[k] += w * x[k]; mz[k] += w * z[k];
      const p = par[k]; m[p] += m[k]; mx[p] += mx[k]; mz[p] += mz[k];
    }
    const Q = Array.from({ length: n }, () => [1, 0, 0, 0]);
    const nx = Float32Array.from(x), ny = Float32Array.from(y), nz = Float32Array.from(z);
    for (let k = 1; k < n; k++) {
      const p = par[k], o = qRot(Q[p], [x[k] - x[p], y[k] - y[p], z[k] - z[p]]);
      nx[k] = nx[p] + o[0]; ny[k] = ny[p] + o[1]; nz[k] = nz[p] + o[2];
      // the load beyond k, and how far out it hangs
      const hx = mx[k] / m[k] - x[k], hz = mz[k] / m[k] - z[k], h = Math.hypot(hx, hz);
      // (young wood has not had the years to settle, so twigs barely sag)
      const a = bole[k] || h < 1e-5 ? 0 : clamp(P.sag * m[k] * h / Math.pow(r[k], 4), 0, 0.025) * smooth(0.0015, 0.006, r[k]);
      Q[k] = a > 0 ? qMul(Q[p], qAxis(norm(cross([0, 1, 0], [hx / h, 0, hz / h])), a)) : Q[p];
    }
    x.set(nx); y.set(ny); z.set(nz);
  }

  // relax the step-to-step facets of the growth along each axis (the axis follows the
  // thicker child, as the eye does). Each axis is eased between its fixed ends in its
  // own frame; a side shoot then rides along with the point it grows from, so the
  // branch angles at the joints are kept
  {
    const cont = new Int32Array(n).fill(-1);
    for (let k = 1; k < n; k++) { const p = par[k]; if (cont[p] < 0 || r[k] > r[cont[p]]) cont[p] = k; }
    const sx = Float32Array.from(x), sy = Float32Array.from(y), sz = Float32Array.from(z);
    const tx = new Float32Array(n), ty = new Float32Array(n), tz = new Float32Array(n);
    // interior axis nodes: those with a next node on the same axis
    const inner = [];
    for (let k = 1; k < n; k++) if (!bole[k] && cont[k] >= 0) inner.push(k);
    for (let pass = 0; pass < 10; pass++) {
      for (const k of inner) {
        const a = par[k], b = cont[k];
        tx[k] = 0.5 * sx[k] + 0.25 * (sx[a] + sx[b]); ty[k] = 0.5 * sy[k] + 0.25 * (sy[a] + sy[b]); tz[k] = 0.5 * sz[k] + 0.25 * (sz[a] + sz[b]);
      }
      for (const k of inner) { sx[k] = tx[k]; sy[k] = ty[k]; sz[k] = tz[k]; }
    }
    // (the node a side shoot starts from is that shoot's fixed end, so its own easing
    // above used the parent's unsmoothed point; carry the parent's offset down)
    const ox = new Float32Array(n), oy = new Float32Array(n), oz = new Float32Array(n);
    for (let k = 1; k < n; k++) {
      const p = par[k], side = cont[p] !== k || bole[p];
      // the offset the axis carries from where it started, plus this node's own easing
      let bx = 0, by = 0, bz = 0;
      if (side) { bx = ox[p]; by = oy[p]; bz = oz[p]; }
      else { bx = ox[p] - (sx[p] - x[p]); by = oy[p] - (sy[p] - y[p]); bz = oz[p] - (sz[p] - z[p]); }
      ox[k] = bx + sx[k] - x[k]; oy[k] = by + sy[k] - y[k]; oz[k] = bz + sz[k] - z[k];
    }
    for (let k = 1; k < n; k++) { x[k] += ox[k]; y[k] += oy[k]; z[k] += oz[k]; }
  }

  // the root flare
  for (let k = 0; k < n; k++) if (bole[k]) r[k] *= 1 + 0.5 * Math.exp(-y[k] / 0.028);

  /* ---- what the drawing needs ---- */
  const Sc = new Uint8Array(n);
  for (let k = 0; k < n; k++) Sc[k] = bole[k] ? 2 : r[k] > 0.0045 ? 1 : 0;
  const kn = knots.filter(o => id[o.k] >= 0).map(o => ({ k: id[o.k], r: 0.0006 * Math.pow(r0 * Math.pow(o.tips, 1 / E) / r0, gam) * 0.8, d: o.d }));
  return finish(x, y, z, par, r, Sc, kn, crown);
}

/* ---- baking ----
   Growing the tree takes most of a second on a laptop and several on a phone, and the
   tree is the same on every visit, so it is grown once ahead of time (scripts/bake-maple.js)
   and shipped packed: 12 bytes a node. bakedMaple() checks the bake was made with these
   parameters and this seed, and otherwise the tree is grown live. */
const QXYZ = 20000, QR = 500000;
const paramsKey = (seed, P) => seed + ":" + JSON.stringify(P);

export function packMaple(G, seed = TREE_SEED, P = TREE) {
  const n = G.n, buf = new ArrayBuffer(n * 12), dv = new DataView(buf);
  for (let k = 0; k < n; k++) {
    const o = k * 12;
    dv.setInt16(o, Math.round(G.X[k] * QXYZ), true); dv.setInt16(o + 2, Math.round(G.Y[k] * QXYZ), true); dv.setInt16(o + 4, Math.round(G.Z[k] * QXYZ), true);
    dv.setUint16(o + 6, k ? k - G.Par[k] : 0, true);
    dv.setUint16(o + 8, Math.min(65535, Math.round(G.r[k] * QR)), true);
    dv.setUint8(o + 10, G.Sc[k]);
  }
  const knots = G.knots.map(o => [o.k, +o.r.toFixed(5), +o.d[0].toFixed(3), +o.d[1].toFixed(3), +o.d[2].toFixed(3)]);
  return { key: paramsKey(seed, P), n, knots, data: Buffer.from(buf).toString("base64") };
}

export function unpackMaple(B, seed = TREE_SEED, P = TREE) {
  if (!B || B.key !== paramsKey(seed, P)) return null;
  const bin = atob(B.data), n = B.n, u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const dv = new DataView(u8.buffer);
  const x = new Float32Array(n), y = new Float32Array(n), z = new Float32Array(n), par = new Int32Array(n), r = new Float32Array(n), Sc = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    const o = k * 12;
    x[k] = dv.getInt16(o, true) / QXYZ; y[k] = dv.getInt16(o + 2, true) / QXYZ; z[k] = dv.getInt16(o + 4, true) / QXYZ;
    par[k] = k ? k - dv.getUint16(o + 6, true) : -1;
    r[k] = dv.getUint16(o + 8, true) / QR; Sc[k] = dv.getUint8(o + 10);
  }
  const knots = B.knots.map(([k, kr, a, b, c]) => ({ k, r: kr, d: [a, b, c] }));
  return finish(x, y, z, par, r, Sc, knots, crownOf(seed, P));
}
