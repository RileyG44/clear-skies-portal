/* Pure drawing buffers shared by the page renderer and startup worker.
   Keep this module free of DOM and WebGL work. */
export const KIND = { STATIC: 0, TRUNK: 1, BRANCH: 2, TWIG: 3, FERN: 4, FALL: 5 };
export const DEG = Math.PI / 180;
const FIR_INKS = [[0.16, 0.53, 0.37], [0.47, 0.37, 0.27], [0.33, 0.32, 0.30], [0.62, 0.42, 0.25]];

export function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

/* The drawing kit shared by every sketch: a seeded random source, the stroke and bone
   buffers, and the pen primitives. A colour is an ink index into `palette` or an
   [r, g, b, soft] array; soft > 0 draws a round-ended watercolour wash instead of a
   pen line. */
export function canvasAPI(seed, palette = FIR_INKS) {
  const rnd = mulberry32(seed);
  const R = (a, b) => a + (b - a) * rnd();
  const seg = [], bon = [], sty = [], col = [], tag = [];
  const line = (x0, y0, b0, x1, y1, b1, w, ink, t, dur, c) => {
    seg.push(x0, y0, x1, y1); bon.push(b0, b1); sty.push(w, clamp(ink, 0, 1), t, dur);
    const k = typeof c === "number" ? palette[c] : c;
    col.push(k[0], k[1], k[2], k[3] || 0); tag.push(typeof c === "number" ? c : -1);
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
  /* leaf sprites, for drawings that bring a leaf atlas (see createSketch): a whole leaf
     stamped from the atlas cell `v`, its stalk end at (x, y) on bone b. rot turns the
     leaf's main axis from straight up; sq < 0 mirrors it, and |sq| < 1 foreshortens it
     across, as a leaf held at a slant; curl bends it. col = [r, g, b] and detail 0..1
     (how much outline and vein it carries); it unfolds from t over dur. alpha 2 + a
     marks a falling leaf (opacity a), which tumbles as its bone turns. Sprites are laid
     in the order they are given, later ones over earlier ones */
  const lf = [];
  const leaf = (x, y, b, rot, size, sq, v, curl, c, detail, t, dur, alpha = 1) => {
    lf.push(x, y, b, rot, size, sq, v, curl, c[0], c[1], c[2], detail, t, dur, rnd() * 6.283, alpha);
  };
  return { rnd, R, seg, bon, sty, col, tag, line, poly, dashed, circle, B, bone, ROOT, labels, label, lf, leaf };
}

/* Physics constants and typed buffers for the renderer. */
export function pack(K, anchors) {
  const { seg, bon, sty, col, B, labels, lf } = K;
  const n = B.ox.length, mSub = Float32Array.from(B.m);
  for (let b = n - 1; b > 0; b--) if (B.par[b] >= 0) mSub[B.par[b]] += mSub[b];
  const invI = new Float32Array(n);
  for (let b = 0; b < n; b++) {
    const I = Math.max(1e-6, mSub[b] * B.ext[b] * B.ext[b] / 3);
    // branches get a little more give than a rigid rod would, so a sweep visibly lifts the bough
    invI[b] = B.kind[b] === KIND.STATIC ? 0 : B.kind[b] === KIND.TRUNK ? 0.15 / I : B.kind[b] === KIND.BRANCH ? 3 / I : 1 / I;
  }
  return {
    count: sty.length / 4, nb: n, labels, anchors,
    seg: new Float32Array(seg), bon: new Float32Array(bon), sty: new Float32Array(sty), col: new Float32Array(col),
    leafCount: lf ? lf.length / 16 : 0, leafData: lf && lf.length ? new Float32Array(lf) : null,
    bones: {
      ox: Float32Array.from(B.ox), oy: Float32Array.from(B.oy), ex: Float32Array.from(B.ex), ey: Float32Array.from(B.ey),
      par: Int32Array.from(B.par), kind: Uint8Array.from(B.kind), w0: Float32Array.from(B.w0), zeta: Float32Array.from(B.zeta),
      m: Float32Array.from(B.m), ext: Float32Array.from(B.ext), invI
    }
  };
}

