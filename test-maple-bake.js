// The landing page's maple is grown ahead of time (scripts/bake-maple.mjs). If
// landing/maple-growth.js changes without a fresh bake, the page silently falls back to
// growing the tree in the browser, which is slow on phones; this catches that.
const test = require("node:test");
const assert = require("node:assert");

test("baked maple matches the growth parameters", async () => {
  const { unpackMaple } = await import("./landing/maple-growth.js");
  const { BAKED } = await import("./landing/maple-tree.js");
  const G = unpackMaple(BAKED);
  assert.ok(G, "landing/maple-tree.js is stale: run node scripts/bake-maple.mjs");
  assert.ok(G.n > 1000 && G.Sc[0] === 2 && G.Par[0] === -1);
});
