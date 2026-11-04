/* The seasonal calendar of a bigleaf maple (Acer macrophyllum) in its home range,
   the low and middle west slope of the Cascades and the Puget lowland.

   Everything is worked out from the visitor's own date, so nothing is fetched. The
   page passes `?date=YYYY-MM-DD` to preview another day.

   The calendar is a single "phase" number that runs through the year:
     < 0     dormant: bare limbs, moss and licorice fern green in the winter rain
     0..0.45 bud break: yellow-green flower tassels hang before the leaves open
     0.45..1 leaf-out: new leaves expand, bright yellow-green
     1..1.75 summer: full canopy, deep green, seed keys filling
     1.75..2.2 late summer: the green dulls, keys ripen to tan
     2.2..2.75 turning: yellow, then gold
     2.75..3.3 leaf fall: gold, ochre and tan, the ground covered in leaves
     3.3..3.9 the last leaves
     > 3.9  bare again
   Each leaf adds its own offset to the phase, so trees turn and drop unevenly. */

// [day of year, phase], interpolated smoothly between keys
const KEYS = [
  [0, -0.95], [45, -0.6], [72, -0.15], [84, 0.05], [100, 0.32], [114, 0.55], [128, 0.8], [146, 1.05],
  [190, 1.4], [232, 1.75], [258, 2.05], [276, 2.35], [290, 2.62], [300, 2.85], [310, 3.08], [322, 3.35],
  [336, 3.7], [350, 4.0], [366, 4.05]
];

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const bump = (x, a, b, c, d) => smooth(a, b, x) * (1 - smooth(c, d, x));
const mix = (c0, c1, t) => [lerp(c0[0], c1[0], t), lerp(c0[1], c1[1], t), lerp(c0[2], c1[2], t)];

export function dayOfYear(d) {
  const start = new Date(d.getFullYear(), 0, 1);
  return (d - start) / 864e5;          // fractional, from 0
}

export function phaseOf(doy) {
  for (let i = 1; i < KEYS.length; i++) {
    const [d1, p1] = KEYS[i], [d0, p0] = KEYS[i - 1];
    if (doy <= d1) { const t = (doy - d0) / (d1 - d0); return lerp(p0, p1, t * t * (3 - 2 * t)); }
  }
  return KEYS[KEYS.length - 1][1];
}

/* A leaf's colour at leaf phase A (the season's phase plus the leaf's own offset).
   Bigleaf maple turns yellow to gold, then ochre and tan; it rarely reddens. */
const LEAF = [
  [0.10, [0.70, 0.66, 0.30]],   // just out of the bud, bronzed yellow-green
  [0.45, [0.62, 0.74, 0.27]],   // new leaf, lime
  [0.95, [0.42, 0.62, 0.22]],   // spring green
  [1.35, [0.28, 0.49, 0.18]],   // summer green
  [1.85, [0.33, 0.47, 0.19]],   // late-summer olive
  [2.2, [0.52, 0.57, 0.21]],    // first yellowing
  [2.5, [0.84, 0.76, 0.24]],    // yellow
  [2.8, [0.89, 0.64, 0.19]],    // gold
  [3.05, [0.78, 0.55, 0.24]],   // ochre
  [3.3, [0.66, 0.47, 0.26]],    // tan
  [3.7, [0.5, 0.35, 0.21]]      // brown
];
export function leafColor(A) {
  if (A <= LEAF[0][0]) return LEAF[0][1].slice();
  for (let i = 1; i < LEAF.length; i++) if (A <= LEAF[i][0]) {
    const t = (A - LEAF[i - 1][0]) / (LEAF[i][0] - LEAF[i - 1][0]);
    return mix(LEAF[i - 1][1], LEAF[i][1], t);
  }
  return LEAF[LEAF.length - 1][1].slice();
}

/* Samaras ("seed keys"): green in early summer, tan by autumn, grey-brown through
   the winter until the last ones blow off in spring. */
function keyColor(P) {
  if (P < 0) return mix([0.56, 0.47, 0.36], [0.5, 0.44, 0.37], smooth(-0.95, -0.1, P));
  if (P < 1.4) return mix([0.66, 0.7, 0.32], [0.5, 0.62, 0.27], smooth(0.5, 1.4, P));
  if (P < 2.6) return mix([0.5, 0.62, 0.27], [0.72, 0.6, 0.38], smooth(1.6, 2.6, P));
  return mix([0.72, 0.6, 0.38], [0.58, 0.48, 0.36], smooth(2.6, 4, P));
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function season(date = new Date()) {
  const doy = dayOfYear(date), P = phaseOf(doy);
  // the wet season: October rains through May; moss and licorice fern answer to it
  const wet = doy < 150 ? 1 - smooth(130, 190, doy) : smooth(265, 300, doy);
  const note =
    P < -0.2 ? "bare limbs, moss and seed keys" :
    P < 0.05 ? "buds swelling" :
    P < 0.45 ? "flower tassels out, first leaves" :
    P < 1.0 ? "new leaves, bright yellow-green" :
    P < 1.75 ? "full canopy, deep green" :
    P < 2.2 ? "late-summer green, keys ripening" :
    P < 2.75 ? "leaves turning yellow and gold" :
    P < 3.3 ? "gold and tan, leaves falling" :
    P < 3.9 ? "the last leaves coming down" : "bare limbs, moss and seed keys";
  return {
    date, doy, P,
    label: `${date.getDate()} ${MONTHS[date.getMonth()]}`,
    note,
    leaf: leafColor,
    // how many flower tassels hang (0..1)
    flowers: bump(P, -0.05, 0.12, 0.38, 0.62),
    // seed keys on the tree (0..1) and their colour
    keys: P > 0.45 ? smooth(0.45, 0.9, P) : P < 0.1 ? 0.75 * (1 - smooth(-0.6, 0.05, P)) + 0.05 : 0,
    keyColor: keyColor(P),
    // licorice fern fronds on the mossy limbs: up with the autumn rain, withered by July
    fern: doy < 200 ? 1 - smooth(150, 185, doy) : smooth(282, 312, doy),
    // moss: vivid in the wet season, dull and gold-green in the August drought
    moss: mix([0.55, 0.53, 0.27], [0.36, 0.55, 0.17], wet),
    // grass at the foot of the tree browns off in the dry summer
    grass: mix([0.62, 0.55, 0.32], [0.3, 0.5, 0.2], doy < 200 ? 1 - smooth(165, 205, doy) : smooth(255, 290, doy)),
    // fallen leaves on the ground, and how fresh they are (1 = just fallen, 0 = rotted)
    litter: doy >= 270 ? smooth(278, 330, doy) : 1 - smooth(15, 135, doy),
    litterFresh: doy >= 270 ? 1 - 0.6 * smooth(300, 366, doy) : 0.4 * (1 - smooth(0, 90, doy)),
    // leaves in the air at any moment
    falling: Math.round(9 * bump(P, 2.45, 2.8, 3.4, 3.85))
  };
}

/* ?date=2026-04-20 previews another day; anything else uses the visitor's clock. */
export function pageDate(search = location.search) {
  const m = /[?&]date=(\d{4})-(\d{1,2})-(\d{1,2})/.exec(search);
  if (m) { const d = new Date(+m[1], +m[2] - 1, +m[3], 12); if (!isNaN(d)) return d; }
  return new Date();
}
