"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { spawnSync } = require("node:child_process");
const E = require("./scripts/glacial-calibration/evaluate-objects.js");

let checks = 0;
function check(name, run) { run(); checks++; console.log("PASS " + name); }
function view() {
  const v = { w: 4, h: 4, cellMetres: 100, split: "train", class: "positive",
    site: "synthetic", region: "synthetic", grid: new Float64Array(16),
    pos: new Uint8Array(16), uncertaintyM: 0 };
  v.pos[5] = 1; return v;
}
function row(v, segments, raster) {
  return E.evaluateView(v, () => ({ segments, segmentRaster: raster }), {}, { skipBaseline: true }).row;
}

check("explicit empty belt membership stays empty despite a painted raster", () => {
  const v = view(), raster = new Int32Array(16); raster[5] = 100001;
  const r = row(v, [{ id: 100001, objectType: "belt", verdict: "likely",
    pixels: new Uint32Array(0), pixelCount: 0, zonePixels: Uint32Array.of(5), areaM2: 10000 }], raster);
  assert.equal(r.membershipSource.segmentPixels, 1);
  assert.equal(r.membershipSource.segmentRaster, 0);
  assert.equal(r.eligibleSegments, 0);
  assert.equal(r.flaggedPixels, 0);
  assert.equal(r.skeletonHits, 0);
  const exact = E.exactSegmentPixels({}, [{ pixels: [] }], v);
  assert.equal(exact.bySegment.values().next().value.length, 0);
});

check("belt candidate membership overrides closed footprint and raster winner", () => {
  const v = view(), raster = new Int32Array(16); raster[5] = 100001;
  const r = row(v, [{ id: 100001, objectType: "belt", verdict: "likely",
    pixels: Uint32Array.of(6), zonePixels: Uint32Array.of(5, 6), areaM2: 20000 }], raster);
  assert.equal(r.eligibleSegments, 1);
  assert.equal(r.eligibleTouching, 0);
  assert.equal(r.skeletonHits, 0);
  assert.equal(r.flaggedPixels, 1);
});

check("overlapping ridge and belt lists retain both objects and union membership", () => {
  const v = view(), raster = new Int32Array(16); raster[5] = raster[6] = raster[7] = 100001;
  const r = row(v, [
    { id: 1, objectType: "ridge", verdict: "possible", pixels: Uint32Array.of(5, 6) },
    { id: 100001, objectType: "belt", verdict: "likely", pixels: Uint32Array.of(6, 7) }
  ], raster);
  assert.equal(r.eligibleSegments, 2);
  assert.equal(r.eligibleTouching, 1);
  assert.equal(r.byObjectType.ridge.flaggedPixels, 2);
  assert.equal(r.byObjectType.belt.flaggedPixels, 2);
  assert.equal(r.flaggedPixels, 3);
  assert.equal(r.skeletonHits, 1);
});

check("segments without a pixel list retain exact raster membership", () => {
  const v = view(), raster = new Int32Array(16); raster[5] = 1;
  const r = row(v, [{ id: 1, verdict: "likely", pixelCount: 1 }], raster);
  assert.equal(r.membershipSource.segmentRaster, 1);
  assert.equal(r.flaggedPixels, 1);
  assert.equal(r.eligibleTouching, 1);
});

check("missing raster ids never claim background or array-position membership", () => {
  const v = view(), raster = new Int32Array(16); raster[5] = 1;
  const s = { id: 123, verdict: "likely", pixelCount: 1 };
  const exact = E.exactSegmentPixels({ segmentRaster: raster }, [s], v);
  assert.equal(exact.bySegment.has(s), false);
  assert.equal(exact.membershipSource.none, 1);
  const r = row(v, [s], raster);
  assert.equal(r.flaggedPixels, 0);
  assert.equal(r.eligibleTouching, 0);
  assert.equal(r.skeletonHits, 0);
});

const fpOpts = { config: {}, candidateThreshold: 0.45,
  analysisPath: path.join(__dirname, "glacial-moraine-analysis.js"),
  viewCount: 1, split: "train", skipBaseline: false, beltOff: false };
const original = E.computeFingerprint(fpOpts);
function fingerprintWithChangedBytes(filename) {
  const read = fs.readFileSync;
  fs.readFileSync = function (file, ...args) {
    const result = read.call(this, file, ...args);
    return path.resolve(String(file)) === filename
      ? Buffer.concat([Buffer.from(result), Buffer.from("test byte change")]) : result;
  };
  try { return E.computeFingerprint(fpOpts); }
  finally { fs.readFileSync = read; }
}
check("changed pipeline dependency bytes invalidate experiment identity", () => {
  const filename = path.join(__dirname, "glacial-belt-classifier.js");
  const changed = fingerprintWithChangedBytes(filename);
  assert.equal(original.analysisModuleHash, changed.analysisModuleHash);
  assert.notEqual(original.dependencyHashes["glacial-belt-classifier.js"], changed.dependencyHashes["glacial-belt-classifier.js"]);
  assert.notEqual(original.hash, changed.hash);
});

check("view corpus identity includes compressed bytes and is shared across splits", () => {
  const validation = E.computeFingerprint({ ...fpOpts, split: "validation", viewCount: 3 });
  assert.equal(original.hash, validation.hash);
  const names = Object.keys(original.viewCorpus.files);
  assert.deepEqual(names, [...names].sort());
  if (names.length) {
    const changed = fingerprintWithChangedBytes(path.join(__dirname, "output/glacial-calibration/views", names[0]));
    assert.notEqual(original.hash, changed.hash);
  }
  assert.notEqual(original.hash, E.computeFingerprint({ ...fpOpts, beltOff: true }).hash);
});

check("held-out split is rejected before analysis through API and CLI", () => {
  let ran = false;
  assert.throws(() => E.evaluateView({ ...view(), split: "test" }, () => { ran = true; }), /must be train or validation/);
  assert.equal(ran, false);
  const cli = spawnSync(process.execPath, [path.join(__dirname, "scripts/glacial-calibration/evaluate-objects.js"),
    "--split", "test", "--analysis", "/nonexistent/analysis.js"], { encoding: "utf8" });
  assert.equal(cli.status, 2);
  assert.match(cli.stderr, /--split test refused/);
  assert.doesNotMatch(cli.stderr, /cannot load analysis/);
});
console.log(`Glacial object evaluation: ${checks} checks passed.`);
