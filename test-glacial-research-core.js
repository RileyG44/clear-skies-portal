"use strict";

const assert = require("assert/strict");
const fs = require("fs");
const vm = require("vm");
const G = require("./glacial-research-core.js");

const close = (actual, expected, tolerance = 1e-6, message = "") =>
  assert(Math.abs(actual - expected) <= tolerance,
    `${message} expected ${expected}, received ${actual}`);

function raster(width, height, fn) {
  return Float64Array.from({ length: width * height }, (_, index) => {
    const y = Math.floor(index / width), x = index % width;
    return fn(x, y);
  });
}

function maxFinite(data, filter = () => true) {
  let maximum = -Infinity;
  for (let i = 0; i < data.length; i++) if (Number.isFinite(data[i]) && filter(i)) maximum = Math.max(maximum, data[i]);
  return maximum;
}

// CommonJS and ordinary browser script loading expose the same pure API.
assert.equal(G.VERSION, 1);
const browser = { globalThis: {} };
vm.runInNewContext(fs.readFileSync(require.resolve("./glacial-research-core.js"), "utf8"), browser);
assert.equal(typeof browser.globalThis.CSPGlacialResearch.localReliefModel, "function");
assert.equal(typeof browser.globalThis.CSPGlacialResearch.scoreFloodChannelCandidates, "function");

// Spatial metadata records units and automatically converts known mixed units.
let spatial = G.normalizeSpatialMetadata({ cellSizeX: 3, cellSizeY: 5, horizontalUnit: "ft", verticalUnit: "m" });
assert.deepEqual(spatial.resolution, { x: 3, y: 5, unit: "ft" });
close(spatial.zFactor, 1 / 0.3048, 1e-12, "metres to feet z factor");
assert.equal(spatial.zFactorSource, "unit-conversion");
assert.throws(() => G.normalizeSpatialMetadata({ horizontalUnit: "map-unit", verticalUnit: "survey-unit" }), /zFactor/);

const width = 15, height = 13, centerX = 7, centerY = 6;
const plane = raster(width, height, (x, y) => 100 + 2 * x - 3 * y);
const center = centerY * width + centerX;

// A plane has zero local residual, TPI, and curvature away from raster edges.
let result = G.localReliefModel(plane, width, height, { radiusCells: 3, cellSize: 2, horizontalUnit: "m", verticalUnit: "m" });
close(result.data[center], 0, 1e-6, "plane local relief");
close(result.baseline[center], plane[center], 1e-6, "plane local mean");
assert.equal(result.metadata.radius.cells.x, 3);
assert.equal(result.metadata.outputUnit, "m");

result = G.terrainPositionIndex(plane, width, height, { radiusCells: 3, innerRadiusCells: 1 });
close(result.data[center], 0, 1e-6, "plane annular TPI");
assert.equal(result.metadata.algorithm.includes("box annulus"), true);

// Physical radii are resolved independently on non-square cells.
result = G.localReliefModel(plane, width, height, {
  radius: 10, cellSizeX: 2, cellSizeY: 5, horizontalUnit: "m"
});
assert.deepEqual(result.metadata.radius.cells, { x: 5, y: 2 });

let curvature = G.finiteDifferenceCurvature(plane, width, height);
close(curvature.laplacian[center], 0, 1e-12, "plane Laplacian");
close(curvature.profileSecondDerivative[center], 0, 1e-12, "plane profile second derivative");
close(curvature.planSecondDerivative[center], 0, 1e-12, "plane plan second derivative");

// Riley TRI is sqrt(sum of eight squared centre-neighbour differences).
const eastPlane = raster(5, 5, x => x);
result = G.terrainRuggednessIndex(eastPlane, 5, 5);
close(result.data[12], Math.sqrt(6), 1e-6, "Riley TRI on east-rising plane");
result = G.terrainRuggednessIndex(eastPlane, 5, 5, { method: "mean-absolute" });
close(result.data[12], 6 / 8, 1e-6, "mean absolute neighbourhood difference");
assert(Number.isNaN(result.data[0]), "strict default neighbour count keeps incomplete edges as no-data");

// Downslope aspect uses compass bearings and exposes directional components.
let components = G.slopeAspectComponents(eastPlane, 5, 5, { cellSize: 1 });
close(components.slopeDegrees[12], 45, 1e-6, "45-degree slope");
close(components.aspectDegrees[12], 270, 1e-6, "east-rising plane descends west");
close(components.northness[12], 0, 1e-6);
close(components.eastness[12], -1, 1e-6);
close(components.slopeWeightedEastness[12], -Math.SQRT1_2, 1e-6);

const southRising = raster(5, 5, (_x, y) => y);
components = G.slopeAspectComponents(southRising, 5, 5);
close(components.aspectDegrees[12], 0, 1e-6, "south-rising plane descends north");
components = G.slopeAspectComponents(southRising, 5, 5, { rowAxis: "north" });
close(components.aspectDegrees[12], 180, 1e-6, "row-axis convention is explicit");

const flat = new Float32Array(25).fill(10);
components = G.slopeAspectComponents(flat, 5, 5);
assert(Number.isNaN(components.aspectDegrees[12]));
assert(Number.isNaN(components.northness[12]));
assert.equal(components.slopeWeightedNorthness[12], 0);

// Clearly named finite-difference directional curvature behaves analytically.
const bowl = raster(width, height, (x, y) => Math.pow(x - centerX, 2) + 2 * Math.pow(y - centerY, 2));
curvature = G.finiteDifferenceCurvature(bowl, width, height);
close(curvature.laplacian[center], 6, 1e-6, "bowl centre Laplacian");
assert(Number.isNaN(curvature.profileSecondDerivative[center]), "profile direction is undefined at a stationary point");
const oneEast = centerY * width + centerX + 1;
close(curvature.profileSecondDerivative[oneEast], 2, 1e-6, "bowl profile along x gradient");
close(curvature.planSecondDerivative[oneEast], 4, 1e-6, "bowl plan direction along y");
assert.equal(curvature.metadata.signConvention.includes("concave-up"), true);

const ridge = raster(width, height, x => -Math.pow(x - centerX, 2));
curvature = G.finiteDifferenceCurvature(ridge, width, height);
close(curvature.profileSecondDerivative[oneEast], -2, 1e-6, "convex ridge profile");
close(curvature.planSecondDerivative[oneEast], 0, 1e-6, "straight ridge plan direction");

// Multiscale residuals are zero on a plane and highlight a ridge at one or more scales.
result = G.multiScaleResidualAnalysis(plane, width, height, { scales: [2, 4], edgePolicy: "nodata" });
close(result.anomaly[center], 0, 1e-6, "plane multiscale anomaly");
assert.equal(result.dominantScaleIndex[center], 0);
assert.equal(result.residuals.length, 2);
const localizedRidge = raster(width, height, x => 25 * Math.exp(-Math.pow(x - centerX, 2) / 4));
result = G.multiScaleResidualAnalysis(localizedRidge, width, height, { scales: [2, 4], edgePolicy: "nodata" });
assert(result.anomaly[center] > 0, "ridge crest has a positive residual anomaly");
assert(result.dominantScaleIndex[center] >= 0);
assert.equal(result.metadata.caution.includes("not probabilities"), true);

// Hypsometry ignores no-data and returns a conventional equal-cell-area curve.
let stats = G.hypsometricStatistics(new Float64Array([0, 1, 2, 3, NaN, -9999]), { noData: -9999, curvePoints: 5, verticalUnit: "ft" });
assert.equal(stats.count, 4);
assert.equal(stats.noDataCount, 2);
assert.equal(stats.min, 0);
assert.equal(stats.max, 3);
close(stats.mean, 1.5);
close(stats.median, 1.5);
close(stats.hypsometricIntegral, 0.5);
assert.deepEqual(stats.quantiles, { p05: 0.15000000000000002, p25: 0.75, p50: 1.5, p75: 2.25, p95: 2.8499999999999996 });
assert.equal(stats.curve[0].relativeElevation, 1);
assert.equal(stats.curve.at(-1).relativeElevation, 0);
assert.equal(stats.metadata.areaAssumption.includes("equal area"), true);

stats = G.hypsometricStatistics(new Float32Array([NaN, -9999]), { noData: -9999 });
assert.equal(stats.count, 0);
assert.equal(stats.hypsometricIntegral, null);

// No-data is propagated at the target while valid neighbours can support a window.
const withVoid = Float64Array.from(plane);
withVoid[center] = -9999;
result = G.localReliefModel(withVoid, width, height, { radiusCells: 2, noData: -9999 });
assert(Number.isNaN(result.data[center]));
const neighbour = center + 1;
assert(Number.isFinite(result.data[neighbour]), "a partial valid neighbourhood remains usable");
result = G.terrainPositionIndex(withVoid, width, height, { radiusCells: 2, noData: -9999, minValidFraction: 1 });
assert(Number.isNaN(result.data[neighbour]), "strict validity can reject windows containing voids");

// Fast summed-area neighbourhoods match a direct implementation around
// clipped edges and voids, including the centre-excluding TPI annulus.
const smallWidth = 6, smallHeight = 5, smallVoidIndex = 2 * smallWidth + 3;
const small = raster(smallWidth, smallHeight, (x, y) => 3 * x + 7 * y + ((x * y) % 3));
small[smallVoidIndex] = NaN;
const fastRelief = G.localReliefModel(small, smallWidth, smallHeight, {
  radiusCells: 1, minValidFraction: 0
}).data;
const fastTpi = G.terrainPositionIndex(small, smallWidth, smallHeight, {
  radiusCells: 2, minValidFraction: 0
}).data;
for (let y = 0; y < smallHeight; y++) for (let x = 0; x < smallWidth; x++) {
  const index = y * smallWidth + x;
  if (!Number.isFinite(small[index])) {
    assert(Number.isNaN(fastRelief[index]));
    assert(Number.isNaN(fastTpi[index]));
    continue;
  }
  const local = [];
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
    const sx = x + ox, sy = y + oy;
    if (sx >= 0 && sy >= 0 && sx < smallWidth && sy < smallHeight && Number.isFinite(small[sy * smallWidth + sx])) {
      local.push(small[sy * smallWidth + sx]);
    }
  }
  close(fastRelief[index], small[index] - local.reduce((sum, value) => sum + value, 0) / local.length, 1e-5);
  const annulus = [];
  for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) {
    const sx = x + ox, sy = y + oy;
    if ((ox || oy) && sx >= 0 && sy >= 0 && sx < smallWidth && sy < smallHeight && Number.isFinite(small[sy * smallWidth + sx])) {
      annulus.push(small[sy * smallWidth + sx]);
    }
  }
  close(fastTpi[index], small[index] - annulus.reduce((sum, value) => sum + value, 0) / annulus.length, 1e-5);
}

// A synthetic topographic step is screened near its break, not on distant flats.
const stepWidth = 41, stepHeight = 31, breakX = 20;
const step = raster(stepWidth, stepHeight, x => x < breakX ? 0 : 30);
let candidates = G.scoreGlacialLobeMarginCandidates(step, stepWidth, stepHeight, { radiusCells: 5, threshold: 0.5 });
const nearBreak = maxFinite(candidates.score, index => Math.abs(index % stepWidth - breakX) <= 2);
const farFromBreak = maxFinite(candidates.score, index => Math.abs(index % stepWidth - breakX) >= 10);
assert(nearBreak > 0.7, `step break should screen strongly, received ${nearBreak}`);
assert(farFromBreak < 0.05, `distant flats should remain quiet, received ${farFromBreak}`);
assert.equal(candidates.metadata.screeningNotice.observationalOnly, true);
assert.equal(candidates.metadata.screeningNotice.diagnostic, false);
assert.equal(candidates.metadata.screeningNotice.scoreIsProbability, false);
assert(candidates.metadata.screeningNotice.commonConfounders.includes("fault scarps"));

// A trough with a gentle longitudinal grade screens along its centreline.
const channelWidth = 41, channelHeight = 31, channelX = 20;
const channel = raster(channelWidth, channelHeight, (x, y) =>
  Math.min(30, 0.6 * Math.pow(x - channelX, 2)) + 0.08 * y);
candidates = G.scoreFloodChannelCandidates(channel, channelWidth, channelHeight, { radiusCells: 6, threshold: 0.5 });
const centrelineScore = maxFinite(candidates.score, index => Math.abs(index % channelWidth - channelX) <= 1);
const uplandScore = maxFinite(candidates.score, index => Math.abs(index % channelWidth - channelX) >= 12);
assert(centrelineScore > 0.7, `channel centreline should screen strongly, received ${centrelineScore}`);
assert(uplandScore < centrelineScore, "distant convex slopes should score below the trough");
assert.equal(candidates.metadata.screeningNotice.observationalOnly, true);
assert.equal(candidates.metadata.screeningNotice.diagnostic, false);
assert(candidates.metadata.screeningNotice.warning.includes("does not establish a flood"));

// Invalid API inputs fail loudly instead of emitting plausible-looking science.
assert.throws(() => G.localReliefModel(new Float32Array(3), 2, 2), /width times height/);
assert.throws(() => G.localReliefModel(flat, 5, 5, { radiusCells: 0 }), /greater than or equal to 1/);
assert.throws(() => G.terrainPositionIndex(flat, 5, 5, { radiusCells: 2, innerRadiusCells: 2 }), /non-empty/);
assert.throws(() => G.terrainPositionIndex(flat, 5, 5, { radiusCells: [2, 3], innerRadiusCells: [3, 1] }), /non-empty/);
assert.throws(() => G.terrainRuggednessIndex(flat, 5, 5, { method: "mystery" }), /method/);
assert.throws(() => G.scoreFloodChannelCandidates(flat, 5, 5, { threshold: 2 }), /threshold/);

console.log("glacial research core checks passed");
