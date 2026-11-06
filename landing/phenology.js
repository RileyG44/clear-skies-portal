/* The seasonal calendar of the maple page's trees, a bigleaf maple (Acer macrophyllum)
   and a vine maple (Acer circinatum), in their home range: the low and middle west
   slope of the Cascades and the Puget lowland. They keep the same calendar; they
   differ in their flowers, their keys and the colours they turn.

   Everything is worked out from the visitor's own date, so nothing is fetched. The
   page passes `?date=YYYY-MM-DD` to preview another day.

   The calendar is a single "phase" number that runs through the year:
     < 0     dormant: bare limbs, moss and licorice fern green in the winter rain
     0..0.45 bud break: bigleaf hangs yellow-green flower tassels before its leaves
             open; vine maple opens little red-and-white flowers with its first leaves
     0.45..1 leaf-out: new leaves expand, bright yellow-green
     1..1.75 summer: full canopy, deep green, seed keys filling
     1.75..2.2 late summer: the green dulls, keys ripen to tan
     2.2..2.75 turning: bigleaf yellow, then gold; vine maple orange, and scarlet where
             the sun reaches
     2.75..3.3 leaf fall: bigleaf gold, ochre and tan; vine maple scarlet, crimson and
             orange; the ground covered in leaves
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

/* A vine maple's leaf at leaf phase A, and how much sun it gets (0 deep in the crown's
   shade, 1 on its sunny face). In shade it turns butter yellow and orange; in the sun it
   goes orange, then scarlet and crimson. The same leaves are a little bronzed when they
   open in the sun. */
const VINE_SHADE = [
  [0.10, [0.70, 0.66, 0.30]],   // just out of the bud, yellow-green
  [0.45, [0.62, 0.74, 0.27]],   // new leaf, lime
  [0.95, [0.42, 0.62, 0.22]],   // spring green
  [1.35, [0.28, 0.49, 0.18]],   // summer green
  [1.85, [0.33, 0.47, 0.19]],   // late-summer olive
  [2.2, [0.55, 0.58, 0.21]],    // first yellowing
  [2.5, [0.86, 0.75, 0.25]],    // butter yellow
  [2.8, [0.9, 0.6, 0.2]],       // orange-gold
  [3.05, [0.84, 0.46, 0.2]],    // orange
  [3.3, [0.66, 0.42, 0.25]],    // tan
  [3.7, [0.5, 0.35, 0.21]]      // brown
];
const VINE_SUN = [
  [0.10, [0.72, 0.52, 0.3]],    // opening bronzed
  [0.45, [0.64, 0.68, 0.28]],
  [0.95, [0.44, 0.6, 0.22]],
  [1.35, [0.3, 0.48, 0.18]],
  [1.85, [0.4, 0.45, 0.19]],    // a red blush on the edges by late summer
  [2.2, [0.68, 0.45, 0.18]],    // bronzing
  [2.5, [0.9, 0.44, 0.15]],     // orange
  [2.8, [0.84, 0.22, 0.12]],    // scarlet
  [3.05, [0.68, 0.15, 0.13]],   // crimson
  [3.3, [0.56, 0.24, 0.18]],    // dull red-brown
  [3.7, [0.48, 0.3, 0.2]]       // brown
];
const track = (T, A) => {
  if (A <= T[0][0]) return T[0][1].slice();
  for (let i = 1; i < T.length; i++) if (A <= T[i][0]) return mix(T[i - 1][1], T[i][1], (A - T[i - 1][0]) / (T[i][0] - T[i - 1][0]));
  return T[T.length - 1][1].slice();
};
export function vineLeafColor(A, sun = 0.5) {
  return mix(track(VINE_SHADE, A), track(VINE_SUN, A), smooth(0.2, 0.85, sun));
}

/* Samaras ("seed keys"): green in early summer (a vine maple's are rosy red), tan by
   autumn, grey-brown through the winter until the last ones blow off in spring. */
function keyColor(P, vine) {
  const young = vine ? [0.74, 0.36, 0.3] : [0.5, 0.62, 0.27];
  if (P < 0) return mix([0.56, 0.47, 0.36], [0.5, 0.44, 0.37], smooth(-0.95, -0.1, P));
  if (P < 1.4) return mix(vine ? [0.7, 0.5, 0.36] : [0.66, 0.7, 0.32], young, smooth(0.5, 1.4, P));
  if (P < 2.6) return mix(young, [0.72, 0.6, 0.38], smooth(1.6, 2.6, P));
  return mix([0.72, 0.6, 0.38], [0.58, 0.48, 0.36], smooth(2.6, 4, P));
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// species: "bigleaf" or "vine"
export function season(date = new Date(), species = "bigleaf") {
  const vine = species === "vine";
  const doy = dayOfYear(date), P = phaseOf(doy);
  // the wet season: October rains through May; moss and licorice fern answer to it
  const wet = doy < 150 ? 1 - smooth(130, 190, doy) : smooth(265, 300, doy);
  const note =
    P < -0.2 ? "bare limbs and seed keys" :
    P < 0.05 ? "buds swelling" :
    P < 0.45 ? (vine ? "red-and-white flowers, first leaves" : "flower tassels out, first leaves") :
    P < 1.0 ? "new leaves, bright yellow-green" :
    P < 1.75 ? "full canopy, deep green" :
    P < 2.2 ? "late-summer green, keys ripening" :
    P < 2.75 ? (vine ? "leaves turning orange and scarlet" : "leaves turning yellow and gold") :
    P < 3.3 ? (vine ? "scarlet and orange, leaves falling" : "gold and tan, leaves falling") :
    P < 3.9 ? "the last leaves coming down" : "bare limbs and seed keys";
  return {
    date, doy, P,
    label: `${date.getDate()} ${MONTHS[date.getMonth()]}`,
    note,
    // a leaf's colour from its phase and (for a vine maple) the sun it gets
    leaf: vine ? vineLeafColor : leafColor,
    // how many flower tassels (bigleaf) or clusters (vine maple) are out (0..1)
    flowers: bump(P, -0.05, 0.12, 0.38, 0.62),
    // seed keys on the tree (0..1) and their colour
    keys: P > 0.45 ? smooth(0.45, 0.9, P) : P < 0.1 ? 0.75 * (1 - smooth(-0.6, 0.05, P)) + 0.05 : 0,
    keyColor: keyColor(P, vine),
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
    falling: Math.round(9 * bump(P, 2.45, 2.8, 3.4, 3.85)),
    /* the ground layer, by day of year */
    // a light snow lying in the depth of winter
    snow: doy < 60 ? 1 - smooth(38, 62, doy) : smooth(343, 360, doy),
    // grass: short and flattened in winter, lush in spring, tall and seeding in summer
    grassLen: 0.65 + 0.85 * bump(doy, 80, 165, 235, 300),
    seedHeads: bump(doy, 155, 178, 245, 275),
    // wildflowers of the lowland forest edge, each in its own weeks
    grape: bump(doy, 62, 78, 112, 128),        // Oregon grape, yellow sprays
    grapeBerry: bump(doy, 205, 228, 300, 330), // and its dusty blue berries
    trillium: bump(doy, 72, 86, 118, 136),     // western trillium, white, ageing pink
    trilliumAge: smooth(100, 130, doy),
    trilliumLeaf: bump(doy, 62, 75, 175, 200),
    bleeding: bump(doy, 92, 106, 150, 172),    // Pacific bleeding heart, pink
    bleedingLeaf: bump(doy, 72, 90, 205, 235),
    camas: bump(doy, 104, 116, 140, 154),      // common camas, blue-violet
    buttercup: bump(doy, 100, 116, 160, 182),  // western buttercup, yellow
    yarrow: bump(doy, 150, 170, 228, 255),     // yarrow, white
    mushrooms: bump(doy, 280, 292, 325, 342),  // autumn mushrooms in the litter
    // sword fern is evergreen but not unchanging: fiddleheads unroll in spring, the old
    // fronds brown off through autumn and winter, and winter rain and snow press them flat
    fiddle: bump(doy, 80, 90, 104, 116),
    fernNew: bump(doy, 98, 114, 150, 178),
    fernOld: doy < 140 ? 1 - smooth(95, 140, doy) : smooth(250, 300, doy),
    fernFlat: doy < 90 ? 1 - smooth(55, 90, doy) : smooth(315, 350, doy)
  };
}

/* ?date=2026-04-20 previews another day; anything else uses the visitor's clock. */
export function pageDate(search = location.search) {
  const m = /[?&]date=(\d{4})-(\d{1,2})-(\d{1,2})/.exec(search);
  if (m) { const d = new Date(+m[1], +m[2] - 1, +m[3], 12); if (!isNaN(d)) return d; }
  return new Date();
}
