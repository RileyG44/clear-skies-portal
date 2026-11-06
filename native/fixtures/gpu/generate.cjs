"use strict";
// Frozen L1 CPU references. Regenerate deliberately, never during a test.
const fs = require("node:fs");
const path = require("node:path");
const raster = require("../../../terrain-raster.js");
const shaders = require("../../../gpu-terrain-shaders.js");
const width = 65, height = 49, groundRes = 1.5;
const grid = new Float32Array(width * height);
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  grid[y * width + x] = -45 + x * 0.35 - y * 0.12 + 1.2 * Math.sin(x / 7) * Math.cos(y / 11);
}
for (let y = 15; y < 21; y++) for (let x = 24; x < 33; x++) grid[y * width + x] = NaN;
fs.writeFileSync(path.join(__dirname, "heights.f32"), Buffer.from(grid.buffer));
const cases = [];
for (const [style, id] of Object.entries(shaders.STYLE_IDS).filter(([, id]) => id < 10)) {
  const result = raster.renderRgba(style, {grid, width, height,
    groundRes: ["hs", "hsmulti", "tint"].includes(style) ? groundRes / shaders.reliefZFactor(groundRes) : groundRes,
    lighting: {azimuth: 315, altitude: 45, ambient: 0.12}});
  // The GPU output contract is premultiplied RGBA.
  for (let i = 0; i < result.length; i += 4) for (let c = 0; c < 3; c++)
    result[i + c] = Math.round(result[i + c] * result[i + 3] / 255);
  fs.writeFileSync(path.join(__dirname, `${style}.rgba`), result);
  cases.push({style, id});
}
fs.writeFileSync(path.join(__dirname, "cases.json"), JSON.stringify({width, height, groundRes, cases}, null, 2) + "\n");
