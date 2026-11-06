/* Maple leaves for the maple page, drawn once into a small texture atlas that the leaf
   layer in sketch.js stamps across the canopy. The page draws vine maple leaves
   (vineOutline); the bigleaf blade it began with is kept (leafOutline).

   A vine maple (Acer circinatum) blade is nearly round, a hand's breadth or less across:
   seven to nine short, pointed lobes fan right round from the stalk, cut perhaps a third
   of the way in, the margin doubly toothed, the base a shallow heart. A primary vein runs
   from the stalk to each lobe tip.

   A bigleaf blade is palmate: five broad lobes (now and then a hint of a sixth or
   seventh at the base) spread from the top of the petiole, cut by deep rounded
   sinuses, with a few big blunt teeth along each lobe and finer irregular serration
   between. The three upper lobes are the big ones; the two basal lobes are short and
   swing down and out, either side of the notch where the stalk joins. Five primary
   veins run from that point to the lobe tips, each throwing a few side veins.

   Each of the 16 cells holds one variant, with its own lobe angles, lengths, widths,
   teeth and a little asymmetry; per-leaf scale, rotation, mirroring, tilt and curl
   are added when the leaves are laid. Channels:
     R  the silhouette (antialiased fill)
     G  the outline, a fine pen line just inside the margin
     B  the veins
     A  the silhouette eroded from the edge, so R - A is a rim where the wash pools
   The petiole junction sits at (0.5, LEAF_JY) of every cell, the main lobe points to
   row 0 (towards v = 0), and a lobe of length 1 is LEAF_R0 of a cell. */

export const LEAF_GRID = 4, LEAF_CELL = 128, LEAF_JY = 0.6, LEAF_R0 = 0.55;

function rng(a) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

/* the outline of one variant: points [x, y] in leaf units, y towards the main lobe */
export function leafOutline(seed) {
  const rnd = rng(seed), R = (a, b) => a + (b - a) * rnd(), D = Math.PI / 180;
  const sk = R(-0.06, 0.06);                       // the whole blade leans a little to one side
  // [angle from the main axis, length, half-width]; the pairs are not quite mirror images
  // [angle from the main axis, length, half-width]; the pairs are not quite mirror images
  const lobes = [
    [sk, 1, R(0.26, 0.31)],
    [R(54, 62) * D + sk, R(0.86, 0.95), R(0.24, 0.29)], [-R(54, 62) * D + sk, R(0.86, 0.95), R(0.24, 0.29)],
    [R(110, 122) * D + sk, R(0.5, 0.62), R(0.2, 0.25)], [-R(110, 122) * D + sk, R(0.5, 0.62), R(0.2, 0.25)]
  ];
  if (rnd() < 0.3) { const s = rnd() < 0.5 ? 1 : -1; lobes.push([s * R(148, 158) * D, R(0.24, 0.3), 0.12]); }   // a small extra basal lobe
  const palm = R(0.28, 0.33);
  // each lobe is broad, with nearly parallel sides that round in to a blunt point
  const inside = (x, y) => {
    if (x * x + y * y < palm * palm) return -1;
    for (let j = 0; j < lobes.length; j++) {
      const [a, L, W] = lobes[j], ca = Math.cos(a), sa = Math.sin(a);
      const t = x * sa + y * ca, n = x * ca - y * sa;     // along and across the lobe
      if (t <= 0 || t >= L) continue;
      const s = t / L, hw = W * Math.pow(1 - Math.pow(s, 3), 0.6) * (0.82 + 0.3 * s * (1 - s));
      if (Math.abs(n) < hw) return j;
    }
    return -2;
  };
  const teeth = lobes.map(() => ({ n: Math.round(R(3, 5)), ph: R(0, 1), amp: R(0.04, 0.07) }));
  const fine = R(0, 6.3), N = 420, pts = [];
  for (let i = 0; i < N; i++) {
    const th = i / N * 2 * Math.PI - Math.PI, sx = Math.sin(th), cy = Math.cos(th);
    // march in from outside to the first point inside the blade
    let r = 1.15, own = -1;
    for (; r > 0.05; r -= 0.004) { const j = inside(r * sx, r * cy); if (j !== -2) { own = j; break; } }
    // the notch where the stalk joins
    if (Math.abs(th) > Math.PI - 0.5) r = Math.min(r, lerp(0.12, r, smoothstep(0.08, 0.5, Math.PI - Math.abs(th))));
    // big blunt teeth along each lobe's outer half, finer uneven serration between them
    if (own >= 0) {
      const [a, L] = lobes[own], tt = teeth[own];
      const along = (r * sx * Math.sin(a) + r * cy * Math.cos(a)) / L;
      const outer = smoothstep(0.5, 0.8, along);
      const u = along * tt.n + tt.ph + (Math.atan2(Math.sin(th - a), Math.cos(th - a)) > 0 ? 0.5 : 0);
      const big = Math.pow(Math.abs(Math.sin(Math.PI * u)), 0.7) - 0.5;
      const saw = ((u * 3.1 + fine) % 1) - 0.5;
      r *= 1 + outer * (tt.amp * big + 0.022 * saw);
    }
    pts.push([r * Math.sin(th), r * Math.cos(th)]);
  }
  return { pts, lobes };
}

/* the outline of one vine maple variant, in the same units and form as leafOutline */
export function vineOutline(seed) {
  const rnd = rng(seed), R = (a, b) => a + (b - a) * rnd(), D = Math.PI / 180;
  const sk = R(-0.05, 0.05), N = rnd() < 0.55 ? 9 : 7, spread = R(140, 150) * D;
  const lobes = [];
  for (let j = 0; j < N; j++) {
    const t = j / (N - 1) * 2 - 1, a = sk + t * spread * R(0.97, 1.03);
    lobes.push([a, (1 - 0.22 * Math.pow(Math.abs(t), 1.5)) * R(0.95, 1.04), R(0.4, 0.46) * (N === 7 ? 1.15 : 1) * (1 - 0.2 * Math.abs(t))]);
  }
  const palm = R(0.58, 0.64);
  // a lobe: broad where it leaves the palm, tapering straight in to a sharp tip
  const inside = (x, y) => {
    if (x * x + y * y < palm * palm) return -1;
    let best = -2, bm = 0;
    for (let j = 0; j < lobes.length; j++) {
      const [a, L, W] = lobes[j], ca = Math.cos(a), sa = Math.sin(a);
      const t = x * sa + y * ca, n = x * ca - y * sa;
      if (t <= 0 || t >= L) continue;
      const s = t / L, hw = W * Math.pow(1 - s, 0.95);
      const m = hw - Math.abs(n);
      if (m > bm) { bm = m; best = j; }
    }
    return best;
  };
  const teeth = lobes.map(() => ({ n: Math.round(R(4, 6)), ph: R(0, 1), amp: R(0.03, 0.045) }));
  const fine = R(0, 6.3), Np = 480, pts = [];
  for (let i = 0; i < Np; i++) {
    const th = i / Np * 2 * Math.PI - Math.PI, sx = Math.sin(th), cy = Math.cos(th);
    let r = 1.15, own = -1;
    for (; r > 0.05; r -= 0.004) { const j = inside(r * sx, r * cy); if (j !== -2) { own = j; break; } }
    // a shallow heart where the stalk joins
    if (Math.abs(th) > Math.PI - 0.35) r = Math.min(r, lerp(0.38, r, smoothstep(0.04, 0.35, Math.PI - Math.abs(th))));
    // doubly toothed: teeth along the lobe's outer part, each with a smaller one between
    if (own >= 0) {
      const [a, L] = lobes[own], tt = teeth[own];
      const along = (r * sx * Math.sin(a) + r * cy * Math.cos(a)) / L;
      const outer = smoothstep(0.55, 0.75, along);
      const u = along * tt.n + tt.ph + (Math.atan2(Math.sin(th - a), Math.cos(th - a)) > 0 ? 0.5 : 0);
      const big = ((u % 1) + 1) % 1 - 0.5, small = (((u * 2 + fine) % 1) + 1) % 1 - 0.5;
      r *= 1 + outer * (tt.amp * big + 0.018 * small);
    }
    pts.push([r * Math.sin(th), r * Math.cos(th)]);
  }
  return { pts, lobes };
}

const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/* the atlas, as RGBA bytes (rows from the top), LEAF_GRID x LEAF_GRID cells */
export function leafAtlas(seed = 20261105) {
  const S = LEAF_CELL, W = S * LEAF_GRID;
  const mk = () => { const c = typeof document === "undefined" ? new OffscreenCanvas(W, W) : document.createElement("canvas"); c.width = c.height = W; const g = c.getContext("2d"); g.fillStyle = "#000"; g.fillRect(0, 0, W, W); return [c, g]; };
  const [cR, gR] = mk(), [cG, gG] = mk(), [cB, gB] = mk(), [cA, gA] = mk();
  for (let v = 0; v < LEAF_GRID * LEAF_GRID; v++) {
    const ox = (v % LEAF_GRID) * S, oy = Math.floor(v / LEAF_GRID) * S;
    const { pts, lobes } = vineOutline(seed + v * 977);
    const P = ([x, y]) => [ox + S * (0.5 + x * LEAF_R0), oy + S * (LEAF_JY - y * LEAF_R0)];
    const path = g => { g.beginPath(); pts.forEach((p, i) => { const [x, y] = P(p); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); };
    const jx = ox + S * 0.5, jy = oy + S * LEAF_JY;
    gR.fillStyle = "#fff"; path(gR); gR.fill();
    // the outline: a fine, slightly uneven pen line kept inside the margin
    gG.save(); path(gG); gG.clip(); gG.strokeStyle = "#fff"; gG.lineJoin = "round"; gG.lineWidth = 4.2; path(gG); gG.stroke(); gG.restore();
    // eroded silhouette: the fill with the edge band knocked back
    gA.save(); path(gA); gA.clip(); gA.fillStyle = "#fff"; path(gA); gA.fill();
    gA.strokeStyle = "rgba(0,0,0,0.45)"; gA.lineJoin = "round"; for (const w of [22, 14, 8]) { gA.lineWidth = w; path(gA); gA.stroke(); }
    gA.restore();
    // veins: five primaries from the junction, curving slightly, each with a few side veins
    gB.save(); path(gB); gB.clip(); gB.strokeStyle = "#fff"; gB.lineCap = "round";
    const r2 = rng(seed + v * 31 + 7);
    for (const [a, L] of lobes) {
      const tip = [Math.sin(a) * L * 0.9, Math.cos(a) * L * 0.9], bend = (r2() - 0.5) * 0.12;
      const c = [Math.sin(a + bend) * L * 0.45, Math.cos(a + bend) * L * 0.45];
      const [x0, y0] = P([0, 0]), [x1, y1] = P(c), [x2, y2] = P(tip);
      gB.lineWidth = L > 0.6 ? 3 : 2.2; gB.beginPath(); gB.moveTo(x0, y0); gB.quadraticCurveTo(x1, y1, x2, y2); gB.stroke();
      if (L < 0.4) continue;
      gB.lineWidth = 1.4;
      for (const f of [0.38, 0.6, 0.8]) for (const sd of [-1, 1]) {
        if (r2() < 0.25) continue;
        const q = (1 - f) * (1 - f), m = 2 * f * (1 - f), e = f * f;
        const bx = q * 0 + m * c[0] + e * tip[0], by = q * 0 + m * c[1] + e * tip[1];
        const sa = a + sd * (0.75 + 0.2 * r2()), sl = L * (0.22 - 0.1 * f);
        const [u0, v0] = P([bx, by]), [u1, v1] = P([bx + Math.sin(sa) * sl, by + Math.cos(sa) * sl]);
        gB.beginPath(); gB.moveTo(u0, v0); gB.lineTo(u1, v1); gB.stroke();
      }
    }
    gB.restore();
    void jx; void jy;
  }
  const out = new Uint8Array(W * W * 4);
  const dR = gR.getImageData(0, 0, W, W).data, dG = gG.getImageData(0, 0, W, W).data, dB = gB.getImageData(0, 0, W, W).data, dA = gA.getImageData(0, 0, W, W).data;
  for (let i = 0; i < W * W; i++) { out[i * 4] = dR[i * 4]; out[i * 4 + 1] = dG[i * 4]; out[i * 4 + 2] = dB[i * 4]; out[i * 4 + 3] = dA[i * 4]; }
  return { data: out, size: W, grid: LEAF_GRID, jy: LEAF_JY, r0: LEAF_R0 };
}
