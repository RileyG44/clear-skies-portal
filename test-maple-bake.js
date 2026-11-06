// The landing page's maples are grown ahead of time (scripts/bake-maple.mjs). If
// landing/maple-growth.js changes without a fresh bake, the page silently falls back to
// growing the tree in the browser, which is slow on phones; this catches that.
const test = require("node:test");
const assert = require("node:assert");

test("each baked maple matches its growth parameters", async () => {
  const { unpackMaple } = await import("./landing/maple-growth.js");
  const { SPECIES, pickSpecies } = await import("./landing/maple-species.js");
  for (const sp of Object.values(SPECIES)) {
    const { BAKED } = await import("./landing/" + sp.bakeFile);
    const G = unpackMaple(BAKED, sp.seed, sp.growth);
    assert.ok(G, `landing/${sp.bakeFile} is stale: run node scripts/bake-maple.mjs`);
    assert.ok(G.n > 1000 && G.Sc[0] === 2 && G.Par[0] === -1);
  }
  // ?tree= names a tree; otherwise it is a coin toss
  assert.equal(pickSpecies("?tree=vine").id, "vine");
  assert.equal(pickSpecies("?tree=bigleaf").id, "bigleaf");
  assert.equal(pickSpecies("", () => 0.2).id, "bigleaf");
  assert.equal(pickSpecies("?tree=oak", () => 0.7).id, "vine");
});
