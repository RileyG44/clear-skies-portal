"use strict";

const assert = require("assert/strict");
const fs = require("fs");
const vm = require("vm");
const Engine = require("./gpu-terrain-engine.js");

// These regressions use no browser, DOM, real clock, or GPU. The startup
// fallback must also work when importing the ordinary browser UMD script.
assert.equal(typeof Engine.create, "function");
assert.equal(Engine.create({ canvas: { getContext: () => null } }), null,
  "a browser without WebGL2 must keep the existing renderer available");
const browser = { globalThis: {} };
vm.runInNewContext(fs.readFileSync(require.resolve("./gpu-terrain-engine.js"), "utf8"), browser);
assert.equal(typeof browser.globalThis.CSPGpuTerrainEngine.create, "function");
assert.equal(browser.globalThis.CSPGpuTerrainEngine.create({ canvas: { getContext: () => null } }), null);

// Supply complete collaborators so these calls reach the actual context and
// extension failure paths rather than the missing-options guard.
{
  const store = { on() {}, off() {} }, shaders = {};
  let calls = 0;
  const canvas = { getContext(kind, attributes) {
    calls++;
    assert.equal(kind, "webgl2");
    assert.deepEqual(attributes, { alpha: true, premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: false });
    return null;
  } };
  assert.equal(Engine.create({ canvas, store, shaders }), null);
  assert.equal(calls, 1);
  let diagnostic;
  assert.equal(Engine.create({ canvas: { getContext() { return { getExtension() { return null; } }; } }, store, shaders,
    onError(error) { diagnostic = error.message; } }), null);
  assert.match(diagnostic, /EXT_color_buffer_float/);
  assert.equal(Engine.create({ canvas: { getContext() { throw new Error("GPU disabled"); } }, store, shaders }), null);
}

assert.ok(Engine._test, "engine must expose its pure test helpers");
const { tileLevel, coverageTiles, cropFor, TextureLRU, drainUploads } = Engine._test;
for (const [name, helper] of Object.entries({ tileLevel, coverageTiles, cropFor, TextureLRU, drainUploads })) {
  assert.equal(typeof helper, "function", `${name} must be callable`);
}

function view(overrides = {}) {
  return { centerMerc: [0.51, 0.49], zoom: 4, bearing: 0, cssSize: [310, 170], dpr: 1, ...overrides };
}
function tileKey(tile) { return `${tile.z}/${tile.x}/${tile.y}`; }
function mod(value, span) { return ((value % span) + span) % span; }
function keys(tiles) { return tiles.map(tileKey).sort(); }
function assertTiles(actual, expected, message) {
  assert.deepEqual(keys(actual), keys(expected), message);
  assert.equal(new Set(keys(actual)).size, actual.length, `${message}: no duplicate world copies`);
}
function cartesianTiles(z, xs, ys) {
  return ys.flatMap(y => xs.map(x => ({ z, x, y })));
}

// ElevLayer rounds CSS zoom before adding the HiDPI data level. In particular,
// 1.5 is the existing HIDPI threshold; explicit dz=0 must override that default.
for (const [zoom, dpr, dz, expected] of [
  [4, 1, undefined, 4], [4.49, 1, undefined, 4], [4.5, 1, undefined, 5],
  [4.49, 2, undefined, 5], [4.5, 2, undefined, 6],
  [4, 1.499999, undefined, 4], [4, 1.5, undefined, 5],
  [4, 3, 0, 4], [4, 1, 1, 5], [4.5, 2, 0, 5],
  [-4, 1, undefined, 0], [-0.6, 2, undefined, 0],
  [21.6, 2, undefined, 22], [32, 1, undefined, 22], [30.5, 2, 0, 22]
]) {
  const candidate = view({ zoom, dpr });
  if (dz !== undefined) candidate.dz = dz;
  assert.equal(tileLevel(candidate), expected, `tileLevel(${JSON.stringify(candidate)})`);
}

// Non-boundary fixtures make the exact covered tile rectangle unambiguous.
// At z=2 this viewport is 1.5 tiles wide and .5 tiles high, centred in tile 1.
const rectangular = view({ centerMerc: [0.375, 0.375], zoom: 2, cssSize: [384, 128] });
assertTiles(coverageTiles(rectangular, 0), cartesianTiles(2, [0, 1, 2], [1]), "unrotated rectangle");
assertTiles(coverageTiles({ ...rectangular, bearing: 90 }, 0), cartesianTiles(2, [1], [0, 1, 2]),
  "rotation exchanges viewport width and height");
assertTiles(coverageTiles({ ...rectangular, bearing: -90 }, 0), cartesianTiles(2, [1], [0, 1, 2]),
  "negative bearing covers the same centred rectangle");
assertTiles(coverageTiles({ ...rectangular, bearing: 450 }, 0), coverageTiles({ ...rectangular, bearing: 90 }, 0),
  "full turns do not change coverage");
assertTiles(coverageTiles(rectangular), cartesianTiles(2, [3, 0, 1, 2], [0, 1, 2]),
  "the default margin is one display tile, wrapping west");
assertTiles(coverageTiles(rectangular, 2), cartesianTiles(2, [0, 1, 2, 3], [0, 1, 2, 3]),
  "a larger margin is clamped at the poles and deduplicated across world copies");

// Independently project screen corners into Mercator coordinates. Compare the
// entire bounding rectangle. Fractional CSS scale must not be rounded to
// data zoom.
function expectedCoverage(candidate, margin) {
  const z = tileLevel(candidate), n = 2 ** z, worldPixels = 256 * 2 ** candidate.zoom;
  const angle = candidate.bearing * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  const corners = [];
  for (const px of [-candidate.cssSize[0] / 2, candidate.cssSize[0] / 2]) {
    for (const py of [-candidate.cssSize[1] / 2, candidate.cssSize[1] / 2]) {
      corners.push([(candidate.centerMerc[0] + (c * px + s * py) / worldPixels) * n,
        (candidate.centerMerc[1] + (-s * px + c * py) / worldPixels) * n]);
    }
  }
  const west = Math.floor(Math.min(...corners.map(p => p[0]))) - margin;
  const east = Math.floor(Math.max(...corners.map(p => p[0]))) + margin;
  const north = Math.max(0, Math.floor(Math.min(...corners.map(p => p[1]))) - margin);
  const south = Math.min(n - 1, Math.floor(Math.max(...corners.map(p => p[1]))) + margin);
  const xs = [...new Set(Array.from({ length: east - west + 1 }, (_, i) => mod(west + i, n)))];
  return cartesianTiles(z, xs, Array.from({ length: Math.max(0, south - north + 1) }, (_, i) => north + i));
}
for (const candidate of [
  view({ zoom: 4.37, bearing: 37, dpr: 2 }),
  view({ zoom: 5.72, bearing: -61, cssSize: [613, 217], dpr: 2, dz: 0 }),
  view({ centerMerc: [0.9993, 0.42], zoom: 4.23, bearing: 28 }),
  view({ centerMerc: [-0.0007, 0.42], zoom: 4.23, bearing: 28 }),
  view({ centerMerc: [1.9993, 0.42], zoom: 4.23, bearing: 28 }),
  view({ centerMerc: [0.51, 0], zoom: 3.13, bearing: 32 }),
  view({ centerMerc: [0.51, 1], zoom: 3.13, bearing: 32 }),
  view({ zoom: 28.25, bearing: 17, dpr: 3 }),
  view({ zoom: 0, cssSize: [2300, 1300], bearing: 37 })
]) {
  const before = JSON.stringify(candidate);
  const tiles = coverageTiles(candidate);
  assertTiles(tiles, expectedCoverage(candidate, 1), `coverage at ${JSON.stringify(candidate)}`);
  assert.equal(JSON.stringify(candidate), before, "coverage must not mutate its input view");
  const n = 2 ** tileLevel(candidate);
  for (const tile of tiles) {
    assert.ok(Number.isInteger(tile.x) && tile.x >= 0 && tile.x < n, "normalized integer x");
    assert.ok(Number.isInteger(tile.y) && tile.y >= 0 && tile.y < n, "clamped integer y");
  }
}
assertTiles(coverageTiles(view({ zoom: 0, cssSize: [5000, 5000] })), [{ z: 0, x: 0, y: 0 }],
  "world-level coverage has only one tile even for a very wide viewport");
assertTiles(coverageTiles(view({ centerMerc: [0.9993, 0.42], zoom: 4.23, bearing: 28 })),
  coverageTiles(view({ centerMerc: [-0.0007, 0.42], zoom: 4.23, bearing: 28 })),
  "the antimeridian uses the same source keys from either world copy");

// Exact and ancestor UV crops contain only the display tile's part of the
// native texture. Descendants and siblings must never be mistaken for fallback.
assert.deepEqual(cropFor({ z: 4, x: 7, y: 6 }, { z: 4, x: 7, y: 6 }),
  { x: 0, y: 0, width: 1, height: 1 });
assert.deepEqual(cropFor({ z: 2, x: 1, y: 1 }, { z: 4, x: 7, y: 6 }),
  { x: 0.75, y: 0.5, width: 0.25, height: 0.25 });
assert.deepEqual(cropFor({ z: 2, x: 1, y: 1 }, { z: 4, x: 23, y: 6 }),
  { x: 0.75, y: 0.5, width: 0.25, height: 0.25 }, "display x wraps before cropping");
assert.deepEqual(cropFor({ z: 2, x: -3, y: 1 }, { z: 4, x: -9, y: 6 }),
  { x: 0.75, y: 0.5, width: 0.25, height: 0.25 }, "native and display x both wrap");
assert.deepEqual(cropFor({ z: 2, x: -1, y: 2 }, { z: 2, x: 3, y: 2 }),
  { x: 0, y: 0, width: 1, height: 1 }, "same native tile across the antimeridian");
for (const [record, display] of [
  [{ z: 5, x: 14, y: 12 }, { z: 4, x: 7, y: 6 }],
  [{ z: 2, x: 2, y: 1 }, { z: 4, x: 7, y: 6 }],
  [{ z: 2, x: 1, y: 0 }, { z: 4, x: 7, y: 6 }],
  [{ z: 4, x: 6, y: 6 }, { z: 4, x: 7, y: 6 }],
  [{ z: 4, x: 7, y: 5 }, { z: 4, x: 7, y: 6 }]
]) assert.equal(cropFor(record, display), null, "unrelated native tile cannot cover display");
for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
  assert.deepEqual(cropFor({ z: 2, x: 1, y: 1 }, { z: 4, x: 4 + x, y: 4 + y }),
    { x: x / 4, y: y / 4, width: 0.25, height: 0.25 }, "all quadrants retain correct UV offsets");
}
const tiny = 2 ** -22;
assert.deepEqual(cropFor({ z: 0, x: 0, y: 0 }, { z: 22, x: 2 ** 22 - 1, y: 2 ** 22 - 1 }),
  { x: 1 - tiny, y: 1 - tiny, width: tiny, height: tiny }, "deep crops avoid 32-bit coordinate overflow");

// Texture eviction releases native resources and accounts bytes, rather than
// limiting only the number of records. get touches; peek must remain read-only.
{
  const evictions = [], cache = new TextureLRU(10, (...args) => evictions.push(args));
  const a = { bytes: 4, id: "a" }, b = { bytes: 3, id: "b" }, c = { bytes: 5, id: "c" };
  assert.equal(cache.bytes, 0); assert.equal(cache.size, 0);
  assert.equal(cache.set("a", a), true); assert.equal(cache.set("b", b), true);
  assert.equal(cache.get("a"), a);
  assert.equal(cache.peek("b"), b);
  assert.equal(cache.set("c", c), true);
  assert.equal(cache.peek("b"), undefined, "peek must not rescue the least recently used texture");
  assert.equal(cache.peek("a"), a); assert.equal(cache.peek("c"), c);
  assert.equal(cache.bytes, 9); assert.equal(cache.size, 2);
  assert.equal(evictions.length, 1); assert.ok(evictions[0].includes(b), "eviction provides the released entry");
  const replacement = { bytes: 2, id: "replacement" };
  assert.equal(cache.set("a", replacement), true);
  assert.equal(cache.bytes, 7, "replacement subtracts old allocation before adding new");
  assert.equal(cache.size, 2); assert.equal(cache.get("a"), replacement);
  assert.ok(evictions.some(args => args.includes(a)), "replacing a texture releases the old allocation");
  const oversized = { bytes: 11, id: "oversized" };
  assert.equal(cache.set("oversized", oversized), false, "oversized allocations must be rejected");
  assert.equal(cache.peek("oversized"), undefined);
  assert.equal(cache.bytes, 7); assert.equal(cache.size, 2);
  assert.equal(cache.get("missing"), undefined); assert.equal(cache.peek("missing"), undefined);
  cache.delete("a");
  assert.equal(cache.bytes, 5); assert.equal(cache.size, 1); assert.equal(cache.peek("a"), undefined);
  assert.ok(evictions.some(args => args.includes(replacement)), "delete releases the texture");
  cache.delete("missing"); assert.equal(cache.bytes, 5);
  cache.clear();
  assert.equal(cache.bytes, 0); assert.equal(cache.size, 0);
  assert.ok(evictions.some(args => args.includes(c)), "clear releases all remaining textures");
  const count = evictions.length; cache.clear(); assert.equal(evictions.length, count, "clear is idempotent");
}
{
  const cache = new TextureLRU(10, () => {});
  assert.equal(cache.set("exact", { bytes: 10 }), true, "the budget permits an exact fit");
  assert.equal(cache.bytes, 10);
  cache.set("new", { bytes: 1 });
  assert.equal(cache.peek("exact"), undefined); assert.equal(cache.bytes, 1);
  cache.set("second", { bytes: 3 }); cache.set("third", { bytes: 3 });
  cache.set("large", { bytes: 8 });
  assert.equal(cache.size, 1, "eviction continues until the byte budget is met");
  assert.equal(cache.bytes, 8); assert.ok(cache.peek("large"));
  const disabled = new TextureLRU(0, () => {});
  assert.equal(disabled.set("a", { bytes: 1 }), false, "zero budget cannot retain a texture");
  assert.equal(disabled.bytes, 0); assert.equal(disabled.size, 0);
}

{
  const cache = new TextureLRU(10, () => {});
  cache.set("a", { bytes: 3 }); cache.set("b", { bytes: 3 }); cache.set("c", { bytes: 3 });
  const larger = { bytes: 7 };
  assert.equal(cache.set("a", larger), true);
  assert.equal(cache.peek("a"), larger);
  assert.equal(cache.peek("b"), undefined, "growing an existing record evicts oldest remaining entries");
  assert.equal(cache.peek("c").bytes, 3);
  assert.equal(cache.bytes, 10); assert.equal(cache.size, 2);
  cache.set("d", { bytes: 1 });
  assert.equal(cache.peek("c"), undefined, "updating a record makes it most recently used");
  assert.equal(cache.peek("a"), larger); assert.equal(cache.bytes, 8);
}

// Measure upload work with a deterministic clock. Delete before invoking the
// callback so that a new revision of the same tile survives for the next frame.
{
  let clock = 0;
  const queue = new Map([['a', { key: 'a' }], ['b', { key: 'b' }], ['c', { key: 'c' }], ['d', { key: 'd' }]]);
  const seen = [];
  const count = drainUploads(queue, record => {
    assert.equal(queue.has(record.key), false, "upload removes its own queued revision before callbacks");
    seen.push(record.key); clock += 2;
  }, () => clock);
  assert.equal(count, 2, "the default 4ms budget stops exactly at its limit");
  assert.deepEqual(seen, ['a', 'b']); assert.deepEqual([...queue.keys()], ['c', 'd']);
  assert.equal(drainUploads(queue, () => { clock += 20; }, () => clock, 1), 1,
    "one expensive upload is allowed, then further work is deferred");
  assert.deepEqual([...queue.keys()], ['d']);
  assert.equal(drainUploads(queue, () => { clock += 1; }, () => clock, 10), 1);
  assert.equal(queue.size, 0);
  assert.equal(drainUploads(queue, () => { throw new Error("empty queue invoked upload"); }, () => clock), 0);
}
{
  let clock = 100;
  const revision1 = { key: "tile", revision: 1 }, revision2 = { key: "tile", revision: 2 };
  const queue = new Map([["tile", revision1]]), seen = [];
  assert.equal(drainUploads(queue, record => {
    seen.push(record.revision); queue.set("tile", revision2); clock += 4;
  }, () => clock, 4), 1);
  assert.equal(queue.get("tile"), revision2, "new tile events during upload retain their latest revision");
  assert.equal(drainUploads(queue, record => { seen.push(record.revision); clock += 4; }, () => clock, 4), 1);
  assert.deepEqual(seen, [1, 2]); assert.equal(queue.size, 0);
}
{
  let clock = 0;
  const queue = new Map([["a", { key: "a", revision: 1 }], ["b", { key: "b", revision: 1 }]]);
  queue.set("a", { key: "a", revision: 2 });
  const seen = [];
  assert.equal(drainUploads(queue, record => { seen.push(record.revision); clock += 0.75; }, () => clock, 1), 2);
  assert.deepEqual(seen, [2, 1], "pending revisions are coalesced before uploading");
}

console.log("GPU terrain engine checks passed (pure helpers and unavailable-GPU fallback)");
