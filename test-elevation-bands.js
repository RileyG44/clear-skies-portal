"use strict";

const assert = require("assert/strict");
const fs = require("fs");
const vm = require("vm");
const E = require("./elevation-bands.js");

function band(overrides) {
  return Object.assign({
    id: "test", enabled: true, operator: "below", maxM: 100,
    inclusive: true, color: "#ff0000", opacity: 1, featherM: 0,
    outline: false, order: 0
  }, overrides || {});
}

// CommonJS and a script-tag/browser global are both first-class entry points.
assert.equal(E.VERSION, 1);
const browser = { globalThis: {} };
vm.runInNewContext(fs.readFileSync(require.resolve("./elevation-bands.js"), "utf8"), browser);
assert.equal(typeof browser.globalThis.ElevationBands.compileBands, "function");

// Exact boundary rules: each edge can independently be open or closed.
let compiled = E.compileBands([band()]);
assert.deepEqual(compiled.rgba(100), [255, 0, 0, 255]);
assert.deepEqual(compiled.rgba(100.0001), [0, 0, 0, 0]);
compiled = E.compileBands([band({ inclusive: false })]);
assert.deepEqual(compiled.rgba(100), [0, 0, 0, 0]);

compiled = E.compileBands([band({ operator: "above", minM: -20, maxM: undefined, inclusive: true })]);
assert.deepEqual(compiled.rgba(-20), [255, 0, 0, 255]);
assert.deepEqual(compiled.rgba(-20.001), [0, 0, 0, 0]);

compiled = E.compileBands([band({
  operator: "between", minM: 10, maxM: 20,
  inclusive: { min: false, max: true }
})]);
assert.deepEqual(compiled.rgba(10), [0, 0, 0, 0]);
assert.deepEqual(compiled.rgba(10.001), [255, 0, 0, 255]);
assert.deepEqual(compiled.rgba(20), [255, 0, 0, 255]);
assert.deepEqual(compiled.rgba(20.001), [0, 0, 0, 0]);

// Values are persisted canonically in metres; display-unit round trips do not
// alter negative elevations or valid values far above 4,500 m.
assert.equal(E.toMeters(1, "ft"), 0.3048);
assert.equal(E.toMeters(1, "yd"), 0.9144);
assert(Math.abs(E.convert(5280, "ft", "m") - 1609.344) < 1e-10);
assert(Math.abs(E.fromMeters(E.toMeters(-430, "ft"), "ft") + 430) < 1e-10);
let state = E.sanitizeState({ unit: "ft", bands: [
  band({ id: "deep", operator: "below", max: -100, maxM: undefined, unit: "ft" }),
  band({ id: "summit", operator: "above", min: 20000, minM: undefined, unit: "ft" })
] });
assert(Math.abs(state.bands[0].maxM + 30.48) < 1e-10);
assert(Math.abs(state.bands[1].minM - 6096) < 1e-10);

// Colour parsing covers colour-input hex, alpha hex, CSS rgb/hsl, arrays,
// objects, and invalid input without requiring a browser canvas.
assert.deepEqual(E.parseColor("#3af"), [51, 170, 255, 255]);
assert.deepEqual(E.parseColor("#33669980"), [51, 102, 153, 128]);
assert.deepEqual(E.parseColor("rgb(100% 0% 50% / 25%)"), [255, 0, 128, 64]);
assert.deepEqual(E.parseColor("hsl(120 100% 50%)"), [0, 255, 0, 255]);
assert.deepEqual(E.parseColor({ r: 1, g: 2, b: 3, a: 0.5 }), [1, 2, 3, 128]);
assert.equal(E.parseColor("definitely-not-a-colour"), null);

// Ordered source-over blending: the array/order is bottom-to-top.  Both the
// straight and canvas/WebGL premultiplied byte representations are returned.
const red = band({ id: "red", color: "#ff0000", opacity: 0.5, order: 0 });
const blue = band({ id: "blue", color: "#0000ff", opacity: 0.5, order: 1 });
compiled = E.compileBands([blue, red]); // sanitizer honours explicit order
let sample = compiled.sample(50);
assert.deepEqual(sample.straight, [85, 0, 170, 191]);
assert.deepEqual(sample.premultiplied, [64, 0, 128, 191]);
assert.deepEqual(compiled.rgba(50, "premultiplied"), sample.premultiplied);
compiled = E.compileBands([Object.assign({}, red, { order: 1 }), Object.assign({}, blue, { order: 0 })]);
assert.deepEqual(compiled.rgba(50), [170, 0, 85, 191]);

// Feathering is symmetric around the scientific threshold and uses smoothstep
// rather than a visibly banded linear ramp.
const feathered = E.sanitizeBand(band({ featherM: 20 }), 0, "m");
assert.equal(E.coverageForBand(89.9, feathered), 1);
assert.equal(E.coverageForBand(100, feathered), 0.5);
assert.equal(E.coverageForBand(110.1, feathered), 0);
assert(E.coverageForBand(95, feathered) > 0.5 && E.coverageForBand(95, feathered) < 1);

// An outline is independently coloured and spans an elevation-width centred
// on every active threshold.
compiled = E.compileBands([band({
  opacity: 0, outline: { enabled: true, color: "white", opacity: 1, widthM: 10 }
})]);
assert.deepEqual(compiled.rgba(100), [255, 255, 255, 255]);
assert.equal(compiled.rgba(104)[3] > 0, true);
assert.deepEqual(compiled.rgba(106), [0, 0, 0, 0]);

// Reconciliation retains custom bands and ordering while adding schema bands
// introduced by newer releases.
const defaults = { unit: "m", bands: [
  band({ id: "below", label: "Default below", order: 0 }),
  band({ id: "above", operator: "above", minM: 500, order: 1 })
] };
state = E.reconcile({ unit: "yd", bands: [
  band({ id: "custom", color: "#00ff00", order: 0 }),
  band({ id: "below", color: "#010203", order: 1 })
] }, defaults);
assert.deepEqual(state.order, ["custom", "below", "above"]);
assert.equal(state.unit, "yd");
assert.equal(state.bands[1].color, "#010203");

// Malformed persisted state never throws, never propagates NaN, and gets a
// deterministic, serializable representation.
state = E.sanitizeState({ unit: "furlongs", order: ["same"], bands: [
  { id: "same", enabled: "false", operator: "nonsense", thresholdM: "NaN",
    color: "garbage", opacity: 400, featherM: -5, order: "bad" },
  { id: "same", operator: "between", minM: 30, maxM: 10,
    inclusive: { min: true, max: false }, color: "rgba(1,2,3,.5)" },
  null,
  "bad"
] });
assert.equal(state.unit, "ft");
assert.deepEqual(state.order, ["same", "same-2"]);
assert.equal(state.bands[0].enabled, false);
assert.equal(state.bands[0].operator, "below");
assert.equal(state.bands[0].opacity, 1);
assert.equal(state.bands[0].featherM, 0);
assert.equal(state.bands[1].minM, 10);
assert.equal(state.bands[1].maxM, 30);
assert.deepEqual(state.bands[1].inclusive, { min: false, max: true });
assert.doesNotThrow(() => JSON.stringify(state));
assert.deepEqual(E.rgbaForElevation(NaN, state), [0, 0, 0, 0]);

console.log("elevation band checks passed");
