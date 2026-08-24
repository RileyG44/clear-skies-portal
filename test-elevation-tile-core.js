"use strict";

const assert = require("assert/strict");
const fs = require("fs");
const vm = require("vm");
const T = require("./elevation-tile-core.js");

function rgbaPixel(red, green, blue, alpha = 255) {
  return [red, green, blue, alpha];
}

function terrariumInteger(elevation, alpha = 255) {
  const packed = elevation + 32768;
  return rgbaPixel(Math.floor(packed / 256), Math.floor(packed) & 255, 0, alpha);
}

// CommonJS and ordinary browser script loading expose the same API.
assert.equal(T.VERSION, 1);
const browser = { globalThis: {} };
vm.runInNewContext(fs.readFileSync(require.resolve("./elevation-tile-core.js"), "utf8"), browser);
assert.equal(typeof browser.globalThis.ElevationTileCore.decodeTerrariumCrop, "function");

// Exact Terrarium decoding, including its 1/256-metre blue byte.
let decoded = T.decodeTerrarium(new Uint8ClampedArray([
  ...rgbaPixel(0, 0, 0),             // -32768 m
  ...rgbaPixel(128, 0, 0),           // 0 m
  ...rgbaPixel(128, 1, 128),         // 1.5 m
  ...rgbaPixel(255, 255, 255)        // 32767 + 255/256 m
]), 4, 1);
assert(decoded instanceof Float32Array);
assert.deepEqual(Array.from(decoded), [-32768, 0, 1.5, 32767.99609375]);

// Transparent source pixels are scientific no-data, not the -32768 m datum.
decoded = T.decodeTerrarium(new Uint8Array([
  ...rgbaPixel(128, 0, 0, 0),
  ...rgbaPixel(128, 100, 0, 1)
]), 2, 1);
assert(Number.isNaN(decoded[0]));
assert.equal(decoded[1], 100);

// Byte carry is the critical regression: -1 m is [127,255,0] and 0 m is
// [128,0,0]. Their true midpoint is -0.5 m. Interpolating packed RGB first
// would decode the rounded byte midpoint near +128 m instead.
let result = T.decodeTerrariumCrop(new Uint8Array([
  ...rgbaPixel(127, 255, 0),
  ...rgbaPixel(128, 0, 0)
]), 2, 1, null, 1, 1);
assert.equal(result[0], -0.5);
const corruptPackedMidpoint = T.decodeTerrariumValue(128, 128, 0);
assert(Math.abs(corruptPackedMidpoint - result[0]) > 100);

// Integer crop coordinates select exact pixel centres when source and output
// crop dimensions match.
const gridRgba = new Uint8Array(4 * 3 * 4);
for (let i = 0; i < 12; i++) gridRgba.set(terrariumInteger(i), i * 4);
result = T.decodeTerrariumCrop(gridRgba, 4, 3, { x: 1, y: 1, width: 2, height: 2 }, 2, 2);
assert.deepEqual(Array.from(result), [5, 6, 9, 10]);
assert.deepEqual(T.normalizeCrop({ left: 1, top: 2, right: 4, bottom: 6 }, 10, 10),
  { x: 1, y: 2, width: 3, height: 4 });

// Fractional crops are bilinear in decoded elevation space.
result = T.resampleElevation(new Float32Array([0, 10]), 2, 1,
  { x: 0.5, y: 0, width: 1, height: 1 }, 1, 1);
assert.equal(result[0], 5);

// A no-data neighbour contributes neither its value nor its weight. A valid
// zero must remain distinguishable from no-data.
result = T.resampleElevation(new Float32Array([0, NaN]), 2, 1, null, 1, 1);
assert.equal(result[0], 0);
result = T.decodeTerrariumCrop(new Uint8Array([
  ...terrariumInteger(0, 0),
  ...terrariumInteger(100, 255)
]), 2, 1, null, 1, 1);
assert.equal(result[0], 100);

// Renormalization fills samples that retain any finite support, but exact
// no-data edges stay NaN when every non-zero-weight neighbour is invalid.
result = T.resampleElevation(new Float32Array([
  10, NaN,
  NaN, NaN
]), 2, 2, null, 3, 3);
assert.equal(result[0], 10);
assert.equal(result[4], 10);
assert(Number.isNaN(result[2]));
assert(Number.isNaN(result[6]));
assert(Number.isNaN(result[8]));

// Clamped raster edges stretch the highest available source detail instead of
// producing black/no-data borders during overzoom.
result = T.resampleElevation(new Float32Array([42]), 1, 1,
  { x: -2, y: -2, width: 5, height: 5 }, 4, 4);
assert(Array.from(result).every(value => value === 42));

assert.throws(() => T.decodeTerrarium(new Uint8Array(3), 1, 1), /width \* height \* 4/);
assert.throws(() => T.resampleElevation(new Float32Array(1), 1, 1,
  { x: 0, y: 0, width: 0, height: 1 }, 1, 1), /greater than zero/);

console.log("elevation tile core checks passed");
