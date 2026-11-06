/* The two trees the maple page can draw. Each visit draws one, picked at random (or
   named with ?tree=bigleaf or ?tree=vine), and only that tree's baked skeleton is
   downloaded: each bake is its own module, imported when it is needed.

   A tree here is its growth parameters and seed (maple-growth.js), its baked skeleton
   (scripts/bake-maple.mjs), its leaf blade (maple-leaves.js), its colour calendar
   (phenology.js, by id) and the few things the drawing does differently for it. */
import { MAPLE, VINE } from "./maple-growth.js";
import { leafOutline, vineOutline } from "./maple-leaves.js";

export const SPECIES = {
  /* An open-grown bigleaf maple (Acer macrophyllum): a single broad bole, a big domed
     crown, blades up to a foot across, gold and tan in the fall. */
  bigleaf: {
    id: "bigleaf", growth: MAPLE, seed: 20261104,
    bakeFile: "maple-tree.js", bake: () => import("./maple-tree.js"),
    outline: leafOutline,
    leafSize: [0.0072, 0.0115],                              // a blade up to a foot across
    bark: [[0.55, 0.53, 0.5], [0.42, 0.39, 0.35]],           // grey-brown, deeper in the shade of the crown
    flowers: "tassel",                                       // long yellow-green hanging tassels
    keyWing: [0.55, 0.2, 0.0045, 0.0015],                    // wings in a V: spread, its jitter, length, its jitter
    metres: 25,                                              // metres in one drawing unit, for the height note
    name: "<i>Acer macrophyllum</i><br>Bigleaf maple, west slope",
    caption: "Bigleaf maple on Alderwood soil over Vashon till, Maple Valley, Washington",
    alt: "bigleaf maple"
  },
  /* A vine maple (Acer circinatum): a clump of slender leaning stems, round 7-9 lobed
     blades, red-and-white flowers, orange and scarlet in the fall. Maple Valley,
     Washington was first called Vine Maple Valley. */
  vine: {
    id: "vine", growth: VINE, seed: 20451160,
    bakeFile: "maple-tree-vine.js", bake: () => import("./maple-tree-vine.js"),
    outline: vineOutline,
    leafSize: [0.0068, 0.0105],                              // a hand's breadth across, on a small tree
    bark: [[0.52, 0.53, 0.46], [0.4, 0.41, 0.34]],           // smooth, grey-green
    flowers: "cluster",                                      // little drooping clusters, red sepals round a white centre
    keyWing: [1.4, 0.15, 0.0042, 0.0014],                    // wings spread nearly flat
    metres: 8,
    name: "<i>Acer circinatum</i><br>Vine maple, Maple Valley",
    caption: "Vine maple on Alderwood soil over Vashon till, Maple Valley, Washington",
    alt: "vine maple"
  }
};

/* ?tree=bigleaf or ?tree=vine picks one; otherwise each load is a coin toss */
export function pickSpecies(search = location.search, rnd = Math.random) {
  const asked = new URLSearchParams(search).get("tree");
  if (asked && SPECIES[asked]) return SPECIES[asked];
  return rnd() < 0.5 ? SPECIES.bigleaf : SPECIES.vine;
}
