/* An American crow that visits the maple page. After 30 to 60 seconds with nobody touching
   the page it flies in from an edge, lands on a letter of the ClearSkies wordmark and sits
   there fidgeting: quick head turns and tilts, blinks of the pale third eyelid, bowing
   tail flicks, a ruffle and shake, shuffles along the letter and the odd hop
   round to face the other way. The moment the visitor moves the pointer, touches, scrolls
   or types, it crouches, pushes off and flies away from them.

   The bird is drawn each frame with canvas paths into a small canvas that follows it, in
   the page's ink and with the page's roughening filter. It is a little rig in crow units
   (beak tip to tail tip is about 1): a body, a neck and head with a two-part beak, a tail
   that fans, two legs, and two wings that are real 3D surfaces, flapping about the body's
   axis and projected with a slight view from above, so the far wing rises behind the back
   and the near wing sweeps down past the belly. The hand folds on the upstroke and the
   whole wing folds back along the body when the bird sits. Each pose parameter is a damped
   spring towards a target, which gives the bird's movements their quick start and soft stop.

   ?crow=now brings the crow in after a couple of seconds, for previews. */

const INK = "#1d1e20", FAR = "#34363a", EYE = "rgba(196,198,192,1)";
const HI = a => `rgba(214,216,210,${a})`;
const KX = 0.24, KY = -0.36;                  // how a point's depth (towards the viewer) shows on screen
const SPAN = 0.95, CHORD = 0.5;              // one wing, beak-to-tail lengths
// one wing's outline in (along the span, back along the chord), leading edge first, five fingers at the tip
const WING = [[0, 0], [0.22, 0.012], [0.44, 0.0], [0.58, 0.03], [0.74, 0.06],
  [0.97, 0.1], [0.84, 0.15], [1, 0.19], [0.85, 0.22], [0.98, 0.28], [0.83, 0.295], [0.93, 0.35], [0.79, 0.355], [0.86, 0.405],
  [0.7, 0.43], [0.6, 0.415], [0.5, 0.44], [0.4, 0.425], [0.3, 0.44], [0.18, 0.42], [0.06, 0.4], [0, 0.36]];
const NOTCH = [6, 8, 10, 12];                // the gaps between the fingers, for the feather lines
const SH = [0.07, 0.085];                    // the shoulder, in body coordinates

const rot = ([x, y], a) => { const c = Math.cos(a), s = Math.sin(a); return [x * c - y * s, x * s + y * c]; };
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/* one wing's outline points on screen (frame units), side +1 near, -1 far. Open, the wing
   is two pieces hinged at the wrist: the arm, and the hand with the five fingers, which
   lags the arm through the beat and on the upstroke swings back, shortens and turns its
   feathers edge-on, so the wing comes up half folded and goes down full */
function wingPts(P, side) {
  const { pitch, open, phiA, phiH, fold, sweep, droop, tilt = 0 } = P;
  const unit = v => { const n = Math.hypot(...v); return [v[0] / n, v[1] / n, v[2] / n]; };
  const dA = unit([sweep + tilt, Math.sin(phiA), side * Math.cos(phiA)]);
  const dH = unit([(sweep + tilt) * 1.3 - fold * 1.2 - 0.12, Math.sin(phiH), side * Math.cos(phiH)]);
  const arm = 0.45 * SPAN * (1 - 0.18 * fold), W = [SH[0] + dA[0] * arm, SH[1] + dA[1] * arm, dA[2] * arm];
  return WING.map(([u, v]) => {
    const hand = smooth(0.38, 0.7, u);
    const vv = v * CHORD * (1 - 0.5 * fold * hand);
    const o = u <= 0.45 ? [SH[0] + dA[0] * u / 0.45 * arm - vv, SH[1] + dA[1] * u / 0.45 * arm, dA[2] * u / 0.45 * arm]
      : (() => { const h = (u - 0.45) * SPAN * (1 - 0.4 * fold); return [W[0] + dH[0] * h - vv, W[1] + dH[1] * h, W[2] + dH[2] * h]; })();
    // folded: laid back along the body, the primaries stacked over the tail
    const f = [SH[0] + 0.02 - u * 0.5 - v * 0.06, SH[1] + 0.012 - v * 0.36 * (1 - 0.62 * u) - u * 0.1 - droop * 0.05 * u, side * (0.07 + droop * 0.04)];
    const x = lerp(f[0], o[0], open), y = lerp(f[1], o[1], open), z = lerp(f[2], o[2], open);
    const [rx, ry] = rot([x, y], pitch);
    return [rx + z * KX, ry + z * KY];
  });
}

/* the wingbeat: c runs 0..1 through one beat; a long downstroke, then a quicker upstroke.
   Returns -1 at the bottom of the stroke and 1 at the top */
const DOWN = 0.57;
export function beat(c) {
  c -= Math.floor(c);
  return c < DOWN ? Math.cos(Math.PI * c / DOWN) : -Math.cos(Math.PI * (c - DOWN) / (1 - DOWN));
}
export function wingPose(c, mid, amp) {
  c -= Math.floor(c);
  const up = c >= DOWN ? Math.sin(Math.PI * (c - DOWN) / (1 - DOWN)) : 0;
  // the stroke plane leans: the wings beat down and forward, then come up and back
  return { phiA: mid + amp * beat(c), phiH: mid + 0.04 + amp * 1.22 * beat(c - 0.07), fold: Math.min(1, amp / 0.75) * Math.pow(up, 0.8), tilt: -0.5 * amp * beat(c - 0.04) };
}

function fillPath(g, pts) { g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.fill(); }

function featherLines(g, pts, a, lw) {
  g.strokeStyle = HI(a); g.lineWidth = lw; g.lineCap = "round";
  g.beginPath();
  for (const k of NOTCH) {                  // between the fingers, in towards the hand
    const [x, y] = pts[k], [x2, y2] = pts[k + 8 > pts.length - 1 ? pts.length - 1 : k + 8];
    g.moveTo(x, y); g.lineTo(lerp(x, x2, 0.33), lerp(y, y2, 0.33));
  }
  // the edge of the coverts, a curve across the inner wing
  const c = [1, 2, 3].map(i => { const [x, y] = pts[i], [x2, y2] = pts[pts.length - i - 1]; return [lerp(x, x2, 0.42), lerp(y, y2, 0.42)]; });
  g.moveTo(...c[0]); g.quadraticCurveTo(...c[1], ...c[2]);
  g.stroke();
}

/* the bird, in a context already set to frame units (origin at the body's centre, y up,
   x towards the beak) */
export function drawCrow(g, P) {
  const { pitch, crouch, neck, hp, yaw, gape, tail, fan, puff, blink, feet, grip } = P;
  const B = p => rot(p, pitch);
  const sc = 1 + 0.07 * puff;
  g.fillStyle = INK; g.strokeStyle = INK; g.lineJoin = "round"; g.lineCap = "round";

  // the far wing, behind everything
  g.fillStyle = FAR; fillPath(g, wingPts(P, -1));
  g.fillStyle = INK;

  // legs: a feathered thigh, the bare tarsus, toes round the perch
  const hip = B([-0.015, -0.075]);
  for (let i = 0; i < 2; i++) {
    const F = feet[i];
    const mx = (hip[0] + F[0]) / 2, my = (hip[1] + F[1]) / 2, dx = F[0] - hip[0], dy = F[1] - hip[1], d = Math.hypot(dx, dy) || 1;
    const bend = 0.025 + crouch * 0.05;           // the heel kinks back
    const ax = mx + (dy / d) * bend * (dx > 0 ? -1 : 1) - 0.01, ay = my - (dx / d) * bend * 0.3;
    g.lineWidth = i ? 0.017 : 0.02; g.strokeStyle = i ? FAR : INK;
    g.beginPath(); g.moveTo(hip[0], hip[1]); g.lineTo(ax, ay); g.lineTo(F[0], F[1]);
    const t = 0.02 + 0.05 * grip;
    g.moveTo(F[0], F[1]); g.lineTo(F[0] + t, F[1] - 0.004 * grip);
    g.moveTo(F[0], F[1]); g.lineTo(F[0] + t * 0.85, F[1] + 0.006);
    g.moveTo(F[0], F[1]); g.lineTo(F[0] - t * 0.7, F[1] - 0.002);
    g.stroke();
  }
  g.strokeStyle = INK;
  g.beginPath(); const th = B([-0.03, -0.07]); g.ellipse(th[0], th[1], 0.07, 0.055, pitch, 0, 7); g.fill();

  // tail: a long, slightly rounded fan from the rump
  const tb = B([-0.17, -0.045]), ta = Math.PI + 0.17 + 0.22 * (1 - P.open) + pitch + tail;
  const L = 0.3 - 0.04 * P.open, w0 = 0.042 - 0.008 * P.open, w1 = 0.052 * (1 + fan * 1.3) * (1 + 0.15 * P.open), cx = Math.cos(ta), cy = Math.sin(ta), px = -cy, py = cx;
  g.beginPath();
  g.moveTo(tb[0] + px * w0, tb[1] + py * w0);
  g.lineTo(tb[0] + cx * L + px * w1, tb[1] + cy * L + py * w1);
  g.quadraticCurveTo(tb[0] + cx * (L + 0.035) , tb[1] + cy * (L + 0.035), tb[0] + cx * L - px * w1, tb[1] + cy * L - py * w1);
  g.lineTo(tb[0] - px * w0, tb[1] - py * w0); g.closePath(); g.fill();

  // body
  const sl = P.open;                       // in the air the body draws out long and slim
  g.beginPath(); g.ellipse(0, 0, 0.215 * sc * (1 + 0.07 * sl), 0.13 * sc * (1 - 0.14 * sl), pitch, 0, 7); g.fill();
  const ch = B([0.1, 0.0]); g.beginPath(); g.ellipse(ch[0], ch[1], 0.13 * sc, 0.115 * sc * (1 - 0.12 * sl), pitch, 0, 7); g.fill();

  // neck and head
  const hc = B([0.235 + 0.075 * neck, 0.072 + 0.02 * neck - 0.035 * crouch]);
  const nb = B([0.11, 0.035]);
  g.lineWidth = 0.17 * (1 + 0.1 * puff); g.beginPath(); g.moveTo(nb[0], nb[1]); g.lineTo(hc[0], hc[1]); g.stroke();
  g.save(); g.translate(hc[0], hc[1]); g.rotate(pitch * 0.35 + hp);
  const cyw = Math.cos(yaw), H = ([x, y]) => [x * cyw, y];
  g.beginPath(); g.arc(0, 0, 0.083, 0, 7); g.fill();
  // throat hackles, shaggy under the chin
  g.beginPath(); g.moveTo(...H([0.04, -0.05]));
  for (let i = 0; i < 4; i++) { g.lineTo(...H([0.02 - i * 0.04, -0.085 - 0.012 * puff - (i % 2) * 0.014])); g.lineTo(...H([-0.0 - i * 0.04, -0.07])); }
  g.lineTo(...H([-0.1, -0.02])); g.closePath(); g.fill();
  // the heavy bill: the forehead runs straight into a down-curved culmen
  const gp = [0.05, -0.012];
  g.save(); g.translate(gp[0] * cyw, gp[1]); g.rotate(gape * 0.25 * Math.sign(cyw || 1));
  g.beginPath(); g.moveTo(...H([-0.02, 0.072])); g.quadraticCurveTo(...H([0.11, 0.06]), ...H([0.155, -0.004]));
  g.quadraticCurveTo(...H([0.09, 0.0]), ...H([0.0, -0.002])); g.lineTo(...H([-0.05, 0])); g.closePath(); g.fill();
  g.restore();
  g.save(); g.translate(gp[0] * cyw, gp[1]); g.rotate(-gape * Math.sign(cyw || 1));
  g.beginPath(); g.moveTo(...H([0, 0])); g.lineTo(...H([0.14, -0.003])); g.quadraticCurveTo(...H([0.07, -0.028]), ...H([-0.01, -0.036])); g.closePath(); g.fill();
  g.restore();
  // the eye: black on black, so only its glint shows, or the pale third eyelid as it blinks
  const ex = 0.026 * cyw, ey = 0.024;
  if (blink) { g.fillStyle = EYE; g.beginPath(); g.arc(ex, ey, 0.015, 0, 7); g.fill(); }
  else { g.fillStyle = HI(0.95); g.beginPath(); g.arc(ex + 0.006 * cyw, ey + 0.006, 0.0062, 0, 7); g.fill(); }
  // nasal bristles lying along the base of the bill
  g.strokeStyle = HI(0.22); g.lineWidth = 0.005; g.beginPath(); g.moveTo(...H([0.05, 0.045])); g.lineTo(...H([0.1, 0.035])); g.stroke();
  g.restore();
  g.fillStyle = INK;

  // the near wing, folded over the side or open in flight
  const wp = wingPts(P, 1);
  fillPath(g, wp);
  featherLines(g, wp, 0.3, 0.0075);
  if (P.open > 0.3) {                      // a pale edge along the spread wing, so it reads against the body
    g.strokeStyle = HI(0.3 * P.open); g.lineWidth = 0.008; g.beginPath(); g.moveTo(...wp[0]); for (let i = 1; i <= 4; i++) g.lineTo(...wp[i]); g.stroke();
  }
  // a little sheen along the back and tail
  g.strokeStyle = HI(0.16); g.lineWidth = 0.008;
  g.beginPath(); const b0 = B([0.12, 0.1]), b1 = B([-0.05, 0.11]); g.moveTo(...b0); g.quadraticCurveTo(...B([0.03, 0.125]), ...b1); g.stroke();
  g.beginPath(); g.moveTo(tb[0] + cx * 0.05, tb[1] + cy * 0.05); g.lineTo(tb[0] + cx * (L - 0.02), tb[1] + cy * (L - 0.02)); g.stroke();
}

/* a damped spring towards a target */
function spring(x, k = 220, z = 0.85) { return { x, v: 0, t: x, k, z }; }
function step(s, dt) { const a = s.k * (s.t - s.x) - 2 * s.z * Math.sqrt(s.k) * s.v; s.v += a * dt; s.x += s.v * dt; }

const REST = { pitch: 0.52, crouch: 0, neck: 0, hp: 0, yaw: 0, gape: 0, tail: 0, fan: 0, puff: 0, droop: 0, shift: 0, hop: 0, open: 0, sweep: 0, phiMid: 0.2, amp: 0, f0: 0, f1: 0, l0: 0, l1: 0 };
const STIFF = { hp: 230, yaw: 150, gape: 700, tail: 600, hop: 500, open: 160, pitch: 140, neck: 150, crouch: 260, shift: 120, puff: 60, droop: 300, fan: 200, f0: 400, f1: 400, l0: 500, l1: 500, amp: 30, phiMid: 40, sweep: 60 };

export function startCrow(title, opts = {}) {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || !title || !title.firstChild) return null;
  const now = new URLSearchParams(location.search).get("crow") === "now";
  const idle = () => (now ? 2 + Math.random() : 30 + Math.random() * 30) * 1000;
  const R = (a, b) => a + (b - a) * Math.random();

  const cv = document.createElement("canvas"); cv.className = "crow inked"; cv.setAttribute("aria-hidden", "true");
  document.body.appendChild(cv);
  const g = cv.getContext("2d");
  const meter = document.createElement("canvas").getContext("2d");
  const S = {}; for (const k in REST) S[k] = spring(REST[k], STIFF[k] || 220);
  const T = (o) => { for (const k in o) S[k].t = o[k]; };

  let state = "away", timer = 0, raf = 0, last = 0, clock = 0;
  let face = spring(1, 260, 0.9), flap = 0, Bw = [0, 0], fly = null, perch = null, todo = [], blinkUntil = 0, nextBlink = 0, nextIdle = 0, nextLook = 0;
  let pointer = null, hop = null, nextHop = 0, nextGround = 0, groundEnd = 0;
  const hopGap = () => now ? R(5, 9) : R(15, 30), groundGap = () => now ? R(8, 12) : R(90, 150);
  const sk = opts.sketch && opts.sketch.toPage ? opts.sketch : null, GR = sk && opts.ground;
  /* the tree hides the crow: its leaves and wood, as discs in drawing units, bucketed */
  const OC = sk && opts.occluders, CELL = 0.04, ocGrid = new Map();
  if (OC) for (let i = 0; i < OC.length; i += 3) {
    const r = OC[i + 2], i0 = Math.floor((OC[i] - r) / CELL), i1 = Math.floor((OC[i] + r) / CELL), j0 = Math.floor((OC[i + 1] - r) / CELL), j1 = Math.floor((OC[i + 1] + r) / CELL);
    for (let a = i0; a <= i1; a++) for (let b = j0; b <= j1; b++) { const k = a * 4096 + b; let c = ocGrid.get(k); if (!c) ocGrid.set(k, c = []); c.push(i); }
  }
  // the occluders over a box in page px, as [x, y, r] in page px
  function occludersIn(x0, y0, x1, y1) {
    if (!OC) return [];
    const o = sk.toPage(0, 0), u = sk.unit(), out = [], seen = new Set();
    const a0 = Math.floor((x0 - o[0]) / u / CELL), a1 = Math.floor((x1 - o[0]) / u / CELL), b0 = Math.floor((o[1] - y1) / u / CELL), b1 = Math.floor((o[1] - y0) / u / CELL);
    if ((a1 - a0) * (b1 - b0) > 400) return out;
    for (let a = a0; a <= a1; a++) for (let b = b0; b <= b1; b++) {
      const c = ocGrid.get(a * 4096 + b); if (!c) continue;
      for (const i of c) { if (seen.has(i)) continue; seen.add(i); out.push([o[0] + OC[i] * u, o[1] - OC[i + 1] * u, OC[i + 2] * u]); }
    }
    return out;
  }
  const restPitch = () => perch && perch.ground ? 0.24 : REST.pitch;   // on the ground a crow stands more level

  /* where the crow stands: the top of one letter of the wordmark. It flies in to a tall
     letter (l, k, S or C); hopping about, it will stand on any of them but the i */
  function letter(i) {
    const tn = title.firstChild, text = tn.textContent, cs = getComputedStyle(title), fs = parseFloat(cs.fontSize);
    if (i < 0 || i >= text.length) return null;
    meter.font = `${cs.fontWeight} ${fs}px ${cs.fontFamily}`;
    const r = document.createRange(); r.setStart(tn, i); r.setEnd(tn, i + 1);
    const m = meter.measureText(text[i]);
    return { i, r, fs, dx: (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2, top: m.actualBoundingBoxAscent, desc: m.fontBoundingBoxDescent };
  }
  function choosePerch() {
    const text = title.firstChild.textContent, pick = Math.random(), ch = pick < 0.38 ? "l" : pick < 0.7 ? "k" : pick < 0.88 ? "S" : "C";
    return letter(text.indexOf(ch));
  }
  const spot = o => {
    if (o.ground) { const p = sk.toPage(o.tx, GR.y(o.tx)); return [p[0], p[1] + 0.5]; }
    const b = o.r.getBoundingClientRect(); return [b.left + o.dx, b.bottom - o.desc - o.top + 1.5];
  };
  /* a place on the ground under the branches, if it's on screen */
  function groundSpot() {
    let best = null, bc = Infinity;
    for (let i = 0; i < 10; i++) {
      const sp = GR.spans[Math.floor(Math.random() * GR.spans.length)], o = { ground: true, tx: R(sp[0], sp[1]), fs: perch.fs };
      const p = spot(o), L = sizeOf(o);
      if (!(p[0] > 20 && p[0] < innerWidth - 20 && p[1] > 60 && p[1] < innerHeight - 8)) continue;
      // (where it would be least hidden by low leaves)
      const c = occludersIn(p[0] - L * 0.4, p[1] - L * 0.5, p[0] + L * 0.4, p[1]).reduce((a, [, , r]) => a + r * r, 0);
      if (c < bc) { bc = c; best = o; }
    }
    return best;
  }
  // the point the feet stand on; during a hop, a point travelling in an arc between letters
  function perchAt() {
    if (state !== "hop" || hop.t <= 0) return spot(perch);
    const a = spot(perch), b = spot(hop.to), t = Math.min(1, hop.t), s = t * t * (3 - 2 * t) * 0.6 + t * 0.4;
    return [lerp(a[0], b[0], s), lerp(a[1], b[1], s) - hop.h * 4 * t * (1 - t)];
  }
  // the crow's length in px: the wordmark's size on a letter; on the ground, a size that sits
  // with the drawing, and in between it changes along the flight
  const sizeOf = o => o.ground ? Math.max(22, Math.min(o.fs * 0.6, sk.unit() * 0.06)) : o.fs;
  function size() {
    if (fly && state === "arrive" && fly.L0) return lerp(fly.L0, sizeOf(perch), smooth(0, 1, fly.t));
    if (fly && state === "leave" && fly.L0) return fly.L0;
    return sizeOf(perch);
  }

  // the body's centre when standing on the perch, from the pose
  function seat(L, P) {
    const fx = face.x;
    return [P[0] + fx * L * (-0.02 + S.shift.x), P[1] - L * (0.215 - 0.075 * S.crouch.x + S.hop.x)];
  }

  function schedule() { clearTimeout(timer); timer = setTimeout(arrive, idle()); }

  function bezier(p0, c1, c2, p3, s) {
    const u = 1 - s;
    return [0, 1].map(k => u * u * u * p0[k] + 3 * u * u * s * c1[k] + 3 * u * s * s * c2[k] + s * s * s * p3[k]);
  }

  function arrive() {
    if (state === "stopped") return;
    if (document.hidden) return schedule();
    perch = choosePerch(); if (!perch) return;
    const P = perchAt(), vw = innerWidth, vh = innerHeight, L = size();
    if (P[1] < L * 0.6 || P[1] > vh - 10 || P[0] < 0 || P[0] > vw) { timer = setTimeout(arrive, 10000); return; }
    const e = Math.random();
    let p0 = e < 0.45 ? [vw + 2 * L, R(0.08, 0.42) * vh] : e < 0.8 ? [R(0.5, 0.95) * vw, -2 * L] : [-2 * L, R(0.04, 0.3) * vh];
    if (Math.abs(p0[0] - P[0]) < 4 * L) p0[0] = P[0] + 4 * L;
    const dir = Math.sign(P[0] - p0[0]) || -1;
    const dist = Math.hypot(P[0] - p0[0], P[1] - p0[1]);
    fly = { kind: "in", p0, dir, t: 0, dur: Math.max(1.8, Math.min(4.2, dist / (7.5 * L))), glide: Math.random() < 0.6 ? R(0.25, 0.45) : -1 };
    for (const k in REST) { S[k].x = S[k].t = REST[k]; S[k].v = 0; }
    T({ open: 1, amp: 0.8, phiMid: 0.2, pitch: 0.05, neck: 0.35 }); S.open.x = 1; S.amp.x = 0.8; S.pitch.x = 0.05; S.neck.x = 0.35;
    face.x = face.t = dir; flap = Math.random();
    state = "arrive"; cv.style.display = "block"; Bw = p0.slice();
    last = performance.now(); raf = requestAnimationFrame(frame);
  }

  function leave() {
    if (state === "stopped") return;
    if (state === "leave" || state === "away") return;
    if (state === "arrive" && fly.t < 0) { perch = fly.from; state = "perch"; }   // still crouched to fly
    const vw = innerWidth, vh = innerHeight, L = size();
    const dir = pointer ? (pointer[0] < Bw[0] ? 1 : -1) : (Math.random() < 0.5 ? 1 : -1);
    const E = Math.random() < 0.55 ? [Math.max(-2 * L, Math.min(vw + 2 * L, Bw[0] + dir * R(0.3, 0.7) * vw)), -2.2 * L] : [dir > 0 ? vw + 2.2 * L : -2.2 * L, R(0.02, 0.3) * vh];
    const fromPerch = state === "perch", hopping = state === "hop" && hop.t > 0;
    const v = hopping ? hop.vel : fly && fly.vel ? fly.vel : [0, 0];
    fly = { kind: "out", p0: Bw.slice(), E, dir, t: fromPerch || (state === "hop" && !hopping) ? -R(0.22, 0.42) : 0, dur: Math.max(1.5, Math.min(3.2, Math.hypot(E[0] - Bw[0], E[1] - Bw[1]) / (7 * L))), c1: [Bw[0] + v[0] * 0.3 + dir * 0.4 * L, Bw[1] + v[1] * 0.3 - 1.7 * L], fromPerch: fromPerch || (state === "hop" && !hopping), feet0: fromPerch || state === "hop" ? feetWorld(L) : null, L0: L };
    todo = [];
    if (fromPerch) T({ crouch: 0, gape: 0, yaw: 0, hp: 0.1, neck: 0, puff: 0 });
    state = "leave";
  }

  function feetWorld(L, P = perchAt()) {
    const fx = face.x;
    return [[P[0] + fx * L * (0.012 + S.f0.x), P[1] - L * S.l0.x], [P[0] + fx * L * (-0.03 + S.f1.x), P[1] - L * S.l1.x]];
  }

  // the quick moves (a peck, the shake) borrow a stiffer neck for their few steps
  const brisk = on => { S.hp.k = on ? 800 : STIFF.hp; S.neck.k = on ? 500 : STIFF.neck; };
  /* fidgets on the perch, as timed steps */
  function seq(steps) { let t = clock; for (const [dt, fn] of steps) { t += dt; todo.push([t, fn]); } }
  function fidget() {
    const p = Math.random();
    if (p < 0.16) {                                // ruffle and shake
      const st = [[0, () => { brisk(1); T({ puff: 1, droop: 0.3 }); }]];
      for (let i = 0; i < 6; i++) st.push([i ? 0.05 : 0.45, () => { T({ hp: i % 2 ? 0.12 : -0.12, tail: i % 2 ? 0.12 : -0.12 }); }]);
      st.push([0.06, () => T({ hp: 0, tail: 0 })], [0.25, () => { brisk(0); T({ puff: 0, droop: 0 }); }]);
      seq(st);
    } else if (p < 0.4) {                          // a flick of tail and wings
      seq([[0, () => T({ tail: -0.32, droop: 0.6, fan: 0.4 })], [0.09, () => T({ tail: 0.06, droop: 0, fan: 0 })], [0.12, () => T({ tail: 0 })]]);
    } else if (p < 0.6) {                          // a shuffle along the letter, one foot then the other
      const d = R(0.025, 0.05) * (Math.random() < 0.5 ? -1 : 1), s = S.shift.t + d > 0.06 || S.shift.t + d < -0.06 ? -d : d;
      seq([[0, () => T({ l0: 0.03, crouch: 0.15 })], [0.1, () => T({ f0: S.f0.t + s, shift: S.shift.t + s / 2 })], [0.1, () => T({ l0: 0 })],
        [0.14, () => T({ l1: 0.03 })], [0.1, () => T({ f1: S.f1.t + s, shift: S.shift.t + s / 2 })], [0.1, () => T({ l1: 0, crouch: 0 })]]);
    } else if (p < 0.76) {                         // hop round to face the other way
      seq([[0, () => T({ crouch: 0.5 })], [0.14, () => { T({ crouch: 0, hop: 0.07 }); face.t = -face.t; }], [0.12, () => T({ hop: 0, crouch: 0.35 })], [0.14, () => T({ crouch: 0 })]]);
    } else if (p < 0.9) {                          // look back over the shoulder
      seq([[0, () => T({ yaw: Math.PI * 0.94, hp: 0.1 })], [R(0.8, 1.6), () => T({ yaw: 0, hp: 0 })]]);
    } else {                                       // a long look up at the sky
      seq([[0, () => T({ hp: 0.55, neck: 0.2 })], [R(1, 1.8), () => T({ hp: 0, neck: 0 })]]);
    }
  }

  /* a flight from where it stands to somewhere else: down to the ground, or back up to a letter */
  function flyTo(to) {
    const L = size(), from = perch, a = spot(from), b = spot(to), L1 = sizeOf(to);
    const dir = Math.sign(b[0] - a[0]) || Math.sign(face.t);
    fly = { kind: "in", p0: Bw.slice(), dir, t: -1, prep: R(0.25, 0.4), dur: Math.max(1.4, Math.min(3.6, Math.hypot(b[0] - a[0], b[1] - a[1]) / (3.2 * (L + L1)))),
      glide: Math.random() < 0.5 ? R(0.3, 0.45) : -1, from, feet0: null, L0: L, takeoff: true };
    perch = to; todo = []; state = "arrive";
  }

  /* on the ground: it walks about, head bobbing, and stops to peck */
  function groundFidget(L) {
    const p = Math.random();
    if (p < 0.45) {
      const n = 1 + Math.floor(Math.random() * 4), st = [[0, () => T({ pitch: -0.32, neck: 0.55, hp: -1.05, crouch: 0.35, tail: -0.05, yaw: 0 })], [0.35, () => brisk(1)]];
      for (let i = 0; i < n; i++) st.push([i ? 0.17 : 0.3, () => T({ hp: -1.4, neck: 0.75 })], [0.09, () => T({ hp: -1.0, neck: 0.5 })]);
      st.push([R(0.2, 0.7), () => { brisk(0); T({ pitch: restPitch(), neck: 0.05, hp: 0, crouch: 0 }); }]);
      seq(st);
    } else if (p < 0.82) {
      const span = GR.spans.find(s => perch.tx >= s[0] - 1e-6 && perch.tx <= s[1] + 1e-6) || GR.spans[0];
      const steps = 2 + Math.floor(Math.random() * 4), stride = R(0.07, 0.1), d = steps * stride * L / sk.unit(), dir = Math.sign(face.t);
      if (perch.tx + dir * d > span[1] || perch.tx + dir * d < span[0]) {     // the end of the open ground: turn round
        seq([[0, () => T({ crouch: 0.45 })], [0.13, () => { T({ crouch: 0, hop: 0.06 }); face.t = -face.t; }], [0.12, () => T({ hop: 0, crouch: 0.3 })], [0.14, () => T({ crouch: 0 })]]);
        return;
      }
      const st = [];
      for (let k = 0; k < steps; k++) {
        const f = k % 2 ? "f1" : "f0", l = k % 2 ? "l1" : "l0";
        st.push([k ? 0.12 : 0, () => T({ [l]: 0.035, neck: 0.28 })],
          [0.13, () => T({ [f]: S[f].t + stride, shift: S.shift.t + stride / 2, [l]: 0, neck: -0.04 })]);
      }
      st.push([0.2, () => {                      // move the spot it stands on up to where it walked to
        const a = S.shift.t; perch.tx += Math.sign(face.x) * a * L / sk.unit();
        for (const k of ["shift", "f0", "f1"]) { S[k].x -= a; S[k].t -= a; }
        T({ neck: 0 });
      }]);
      seq(st);
    } else if (p < 0.9) {
      seq([[0, () => T({ tail: -0.32, droop: 0.6, fan: 0.4 })], [0.09, () => T({ tail: 0.06, droop: 0, fan: 0 })], [0.12, () => T({ tail: 0 })]]);
    } else {
      seq([[0, () => T({ hp: 0.3, neck: 0.3, yaw: R(0.5, 1) })], [R(0.6, 1.4), () => T({ hp: 0, neck: 0, yaw: 0 })]]);
    }
  }

  function frame(ms) {
    const dt = Math.max(0, Math.min(1 / 30, (ms - last) / 1000)); last = ms; clock += dt;   // (a frame stamp can be a little before the call that started it)
    const L = size();
    for (let i = 0; i < 2; i++) { for (const k in S) step(S[k], dt / 2); step(face, dt / 2); }
    let feet, grip = 1, tuck = 0;
    const B = (p) => rot(p, S.pitch.x);

    if (state === "arrive" || state === "leave") {
      const f = fly; f.t += dt / (f.t < 0 ? f.prep || 0.3 : f.dur);
      let s, pos;
      if (f.kind === "in" && f.t < 0) {           // crouching to spring off where it stands
        const a = spot(f.from);
        pos = seat(L, a);
        if (f.t > -0.6) { T({ crouch: 0.9, pitch: 0.3, neck: -0.2, hp: 0, yaw: 0 }); face.t = f.dir; }
        feet = feetWorld(L, a);
      } else if (f.kind === "in") {
        if (f.takeoff && !f.launched) {
          f.launched = true; f.p0 = Bw.slice(); f.feet0 = feetWorld(L, spot(f.from));
          T({ crouch: 0, shift: 0, f0: 0, f1: 0, l0: 0, l1: 0, open: 1, amp: 1, phiMid: 0.32, sweep: 0.3, pitch: 0.25, neck: 0.2, fan: 0.5 }); S.open.k = 600; flap = 0;
        }
        const t = Math.min(1, f.t); s = t + 0.85 * t * (1 - t);
        const P3 = seat(L, perchAt()), c2 = [P3[0] - f.dir * 2.2 * L, P3[1] - 1.0 * L], c1 = [f.p0[0] + f.dir * 0.35 * Math.abs(P3[0] - f.p0[0]), f.takeoff ? f.p0[1] - 1.6 * f.L0 : lerp(f.p0[1], c2[1], 0.3)];
        pos = bezier(f.p0, c1, c2, P3, s);
        const gl = f.glide > 0 && t > f.glide && t < f.glide + 0.12;
        if (f.takeoff && t > 0.2) S.open.k = STIFF.open;
        // rowing beats, now and then a short glide; a long glide in, then a braking flare
        if (f.takeoff && t < 0.2) { /* the first deep beats of the take-off */ }
        else if (t < 0.72) T({ amp: gl ? 0.03 : 0.8, phiMid: gl ? 0.16 : 0.2, sweep: 0, fan: 0, tail: 0, neck: 0.35 });
        else if (t < 0.85) T({ amp: 0.04, phiMid: 0.2, sweep: 0.08, fan: 0.35, tail: 0.1, neck: 0.25 });
        else T({ amp: 0.75, phiMid: 0.42, sweep: 0.5, fan: 1, tail: 0.35, pitch: 0.95, neck: 0.1 });
        tuck = 1 - smooth(0.74, 0.9, t);
        if (f.t >= 1) {                          // touchdown
          state = "perch"; fly = null; T({ open: 0, amp: 0, sweep: 0, fan: 0, tail: 0, pitch: restPitch(), neck: 0 });
          if (perch.ground) groundEnd = clock + (now ? R(8, 12) : R(12, 25));
          else if (nextGround < clock) nextGround = clock + groundGap();
          S.crouch.v = 2.6; nextHop = clock + hopGap(); nextIdle = clock + R(1.2, 3); nextLook = clock + 0.4; nextBlink = clock + R(0.8, 3);
        }
      } else {
        if (f.t < 0) {                           // the moment before take-off: a startle and a crouch
          pos = seat(L, perchAt());
          if (f.t > -0.16) { T({ crouch: 1, pitch: 0.3, neck: -0.3 }); face.t = f.dir; }
          feet = feetWorld(L);
        } else {
          if (f.feet0 && !f.launched) { f.launched = true; T({ crouch: 0, open: 1, amp: 1, phiMid: 0.32, sweep: 0.3, pitch: 0.25, neck: 0.2, fan: 0.5 }); S.open.k = 600; flap = 0; }
          if (!f.fromPerch && !f.launched) { f.launched = true; face.t = f.dir; T({ amp: 0.9, open: 1, phiMid: 0.22, pitch: 0.1, sweep: 0, fan: 0, tail: 0, neck: 0.35 }); }
          const t = Math.min(1, f.t); s = 0.45 * t + 0.55 * t * t;
          const c2 = [lerp(f.p0[0], f.E[0], 0.62), lerp(f.p0[1], f.E[1], 0.62) + 0.4 * L];
          pos = bezier(f.p0, f.c1, c2, f.E, s);
          if (t > 0.25) { T({ sweep: 0, fan: 0, amp: 0.85, phiMid: 0.2, neck: 0.35 }); S.open.k = STIFF.open; }
          tuck = f.feet0 ? smooth(0.0, 0.22, t) : 1;
          if (f.t >= 1) { state = "away"; cv.style.display = "none"; cancelAnimationFrame(raf); S.open.k = STIFF.open; schedule(); return; }
        }
      }
      const vel = [(pos[0] - Bw[0]) / Math.max(dt, 1e-3), (pos[1] - Bw[1]) / Math.max(dt, 1e-3)];
      f.vel = vel; Bw = pos;
      if (state !== "perch" && f.t >= 0) {
        if (!(f.kind === "in" && f.t > 0.85)) T({ pitch: Math.max(-0.4, Math.min(0.5, 0.08 + 0.5 * Math.atan2(-vel[1], Math.abs(vel[0]) + 1))) });
        if (Math.abs(vel[0]) > 40) face.t = Math.sign(vel[0]);
        S.hp.t = -0.35 * S.pitch.x;              // the head stays level while the body pitches
        const hz = f.kind === "out" && f.t < 0.3 ? 4.4 : f.kind === "in" && f.t > 0.85 ? 4 : 2.9;
        flap += hz * dt;
        // each downstroke lifts the body a little; it sinks as the wings come up
        Bw = [Bw[0], Bw[1] + L * 0.024 * S.amp.x * beat(flap - 0.12)];
      }
    }

    /* a crow's hop: both feet together, a quick crouch and a short, low bound with the body
       held level; across a longer gap the wings open for a beat or two to carry it */
    if (state === "hop") {
      const h = hop; h.t += dt / (h.t < 0 ? 0.13 : h.dur);
      if (h.t < 0) { T({ crouch: 0.6, pitch: restPitch() - 0.12, neck: -0.05, hp: 0, yaw: 0 }); face.t = h.dir; }
      else {
        if (!h.up) {
          h.up = true; flap = 0;
          T({ crouch: 0.3, shift: 0, f0: 0, f1: 0, pitch: restPitch() - 0.05, neck: 0.1, tail: -0.1 });
          S.crouch.v = -3;                        // the legs kick out, then draw up a little
          if (h.far) T({ open: 1, amp: 0.6, phiMid: 0.3, fan: 0.4 }); else T({ droop: 0.35 });
        }
        flap += 4 * dt;
        if (h.t > (h.far ? 0.62 : 0.4)) T({ amp: 0, open: 0, phiMid: REST.phiMid, droop: 0, fan: 0, tail: 0.08, crouch: 0.1 });
        if (h.t >= 1) {                          // and down on the new letter, the knees taking it
          perch = h.to; state = "perch"; hop = null;
          T({ open: 0, amp: 0, pitch: restPitch(), fan: 0, tail: 0, neck: 0, crouch: 0 });
          S.crouch.v = 2.2; nextHop = clock + hopGap(); nextIdle = clock + R(2, 4); nextLook = clock + R(0.8, 1.6);
        }
      }
      const p = seat(L, perchAt());
      if (hop) hop.vel = [(p[0] - Bw[0]) / Math.max(dt, 1e-3), (p[1] - Bw[1]) / Math.max(dt, 1e-3)];
      Bw = p;
    }

    if (state === "perch" && !todo.length && GR && !perch.ground && nextGround && clock > nextGround) {
      const o = groundSpot(); if (o) flyTo(o); else nextGround = clock + 20;
    }
    if (state === "perch" && !todo.length && perch.ground && clock > groundEnd) flyTo(choosePerch());
    if (state === "perch" && !todo.length && !perch.ground && clock > nextHop) {
      const text = title.firstChild.textContent, opts = [];
      for (let i = 0; i < text.length; i++) if (i !== perch.i && text[i] !== "i" && text[i] !== " ") opts.push(i);
      const to = letter(opts[Math.floor(Math.random() * opts.length)]);
      if (to) {
        const a = spot(perch), b = spot(to), d = Math.abs(b[0] - a[0]), far = d > 1.3 * L;
        hop = { to, t: -1, dir: Math.sign(b[0] - a[0]) || face.t, far, dur: far ? 0.36 + d / (10 * L) : 0.24 + 0.06 * d / L, h: L * (far ? 0.22 : 0.1) + Math.max(0, a[1] - b[1]) };
        state = "hop";
      }
    }

    if (state === "perch") {
      Bw = seat(L, perchAt());
      while (todo.length && todo[0][0] <= clock) todo.shift()[1]();
      if (!todo.length && clock > nextIdle) { if (perch.ground) { groundFidget(L); nextIdle = clock + R(1.2, 3.5); } else { fidget(); nextIdle = clock + R(6, 14); } }
      if (!todo.length && clock > nextLook) {
        const r = Math.random();
        // an unhurried look about, then a good long while holding still
        T({ hp: R(-0.2, 0.24), yaw: r < 0.12 ? R(0.5, 1) : 0, neck: R(-0.05, 0.18) });
        nextLook = clock + R(1.8, 5);
      }
      if (clock > nextBlink) { blinkUntil = clock + 0.11; nextBlink = clock + R(1.5, 6); }
    }

    // feet: tucked under the tail in flight, reaching forward to land, gripping the letter when down
    const fx = Math.sign(face.x) * Math.max(Math.abs(face.x), 0.03);
    const toFrame = w => [(w[0] - Bw[0]) / (L * fx), -(w[1] - Bw[1]) / L];
    const tucked = [B([-0.09, -0.075]), B([-0.11, -0.07])];   // drawn up into the belly feathers
    if (state === "perch" || state === "hop") { feet = feetWorld(L).map(toFrame); }
    else if (feet) feet = feet.map(toFrame);
    else {
      let down = null;
      if (fly.kind === "in") { const t = fly.t, reach = [[0.11, -0.25], [0.08, -0.25]]; down = tucked.map((p, i) => [lerp(reach[i][0], p[0], tuck), lerp(reach[i][1], p[1], tuck)]); if (t > 0.93) { const w = smooth(0.93, 1, t), pw = feetWorld(L).map(toFrame); down = down.map((p, i) => [lerp(p[0], pw[i][0], w), lerp(p[1], pw[i][1], w)]); }
        if (fly.feet0 && t < 0.25) { const w = smooth(0, 0.22, t), pw = fly.feet0.map(toFrame); down = down.map((p, i) => [lerp(pw[i][0], p[0], w), lerp(pw[i][1], p[1], w)]); } }
      else { const pw = fly.feet0 ? fly.feet0.map(toFrame) : tucked; down = tucked.map((p, i) => [lerp(pw[i][0], p[0], tuck), lerp(pw[i][1], p[1], tuck)]); }
      feet = down; grip = 1 - tuck * 0.8;
    }

    const amp = Math.max(0, S.amp.x), wing = wingPose(flap, S.phiMid.x, amp);
    const P = {
      pitch: S.pitch.x, crouch: S.crouch.x, neck: S.neck.x, hp: S.hp.x, yaw: S.yaw.x, gape: Math.max(0, S.gape.x), tail: S.tail.x - (perch && perch.ground && state === "perch" ? 0.22 : 0),   // on the ground the tail is held clear of it
     
      fan: Math.max(0, S.fan.x), puff: S.puff.x + (state === "perch" || state === "hop" ? 0.06 * Math.sin(clock * 3.6) : 0), droop: S.droop.x,
      open: Math.max(0, Math.min(1, S.open.x)), ...wing, sweep: S.sweep.x,
      blink: clock < blinkUntil, feet, grip
    };
    draw(L, P);
    raf = requestAnimationFrame(frame);
  }

  function draw(L, P) {
    const dpr = Math.min(2, devicePixelRatio || 1), W = Math.ceil(L * 3.2);
    if (cv.width !== Math.round(W * dpr)) { cv.width = cv.height = Math.round(W * dpr); cv.style.width = cv.style.height = W + "px"; }
    cv.style.transform = `translate(${(Bw[0] - W / 2).toFixed(1)}px,${(Bw[1] - W / 2).toFixed(1)}px)`;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height);
    g.setTransform(dpr * L * face.x, 0, 0, -dpr * L, cv.width / 2, cv.height / 2);
    drawCrow(g, P);
    // wherever the tree stands in front, knock the crow out, so it passes behind the leaves and wood
    const ox = Bw[0] - W / 2, oy = Bw[1] - W / 2, oc = occludersIn(ox, oy, ox + W, oy + W);
    if (oc.length) {
      g.setTransform(dpr, 0, 0, dpr, -ox * dpr, -oy * dpr); g.globalCompositeOperation = "destination-out"; g.fillStyle = "#000";
      g.beginPath(); for (const [x, y, r] of oc) { g.moveTo(x + r, y); g.arc(x, y, r, 0, 6.2832); } g.fill();
      g.globalCompositeOperation = "source-over";
    }
  }

  // anything the visitor does sends the crow off and restarts the wait
  function wake(e) {
    if (e && e.type === "pointermove") {
      const p = [e.clientX, e.clientY], moved = !pointer || Math.hypot(p[0] - pointer[0], p[1] - pointer[1]) > 3;
      pointer = p; if (!moved) return;
    } else if (e && e.clientX !== undefined) pointer = [e.clientX, e.clientY];
    if (state === "away") schedule(); else leave();
  }
  // (every listener goes with the crow when it is stopped)
  const ac = new AbortController(), on = { passive: true, signal: ac.signal };
  for (const ev of ["pointermove", "pointerdown", "wheel", "keydown", "touchstart", "scroll"]) addEventListener(ev, wake, on);
  document.addEventListener("visibilitychange", () => { if (document.hidden) { if (state === "away") clearTimeout(timer); } else if (state === "away") schedule(); }, on);
  schedule();
  // when the page is done with the crow: no more timers, frames or listeners, and its canvas gone
  function stop() {
    if (state === "stopped") return;
    state = "stopped"; ac.abort(); clearTimeout(timer); cancelAnimationFrame(raf); raf = 0;
    cv.width = cv.height = 0; cv.remove();
  }
  return { get state() { return state; }, get perch() { return perch; }, arrive: () => { clearTimeout(timer); if (state === "away") arrive(); }, leave, stop };
}
