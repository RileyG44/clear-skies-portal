/* No DOM, renderer, or map state: return the same seasonal drawing and atlas
   as the landing page, transferring the buffers instead of copying them. */
import { buildMaple } from "./maple.js";
import { SPECIES } from "./maple-species.js";
import { BAKED } from "./maple-tree-vine.js";

self.onmessage = event => {
  try {
    const T = buildMaple(new Date(event.data), SPECIES.vine, BAKED, { treeOnly: true });
    const tree = {};
    for (const key of ["count", "nb", "labels", "anchors", "seg", "bon", "sty", "col", "leafCount", "leafData", "bones", "view", "leafPen", "loadFlex"]) tree[key] = T[key];
    const atlas = T.leafCount ? T.leafAtlas() : null;
    const buffers = new Set();
    const collect = object => {
      if (ArrayBuffer.isView(object)) buffers.add(object.buffer);
      else if (object && typeof object === "object") for (const value of Object.values(object)) collect(value);
    };
    collect(tree); collect(atlas);
    self.postMessage({ tree, atlas }, [...buffers]);
  } catch (error) { self.postMessage({ error: String(error.message || error) }); }
};
