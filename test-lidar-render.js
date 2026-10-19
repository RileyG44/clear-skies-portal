"use strict";
/* LiDAR colour model: node test-lidar-render.js
 * Layers, palettes, looks and blend maths shared by the studio panel, the GPU
 * shade pass and the CPU look previews. */
const assert = require("node:assert/strict");
const render = require("./lidar-render.js");
const shaders = require("./gpu-terrain-shaders.js");

const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: expected ${b}, got ${a}`);

/* Colours: 6- and 8-digit hex, stops spaced evenly or placed explicitly. */
assert.deepEqual(render.parseHex("#ff0000"), [1, 0, 0, 1]);
assert.deepEqual(render.parseHex("00ff0080").map(v => +v.toFixed(3)), [0, 1, 0, 0.502]);
assert.equal(render.parseHex("red"), null);
assert.equal(render.toHex([1, 0.5, 0, 1]), "#ff8000");
assert.equal(render.toHex([0, 0, 0, 0.5]), "#00000080");
assert.deepEqual(render.normalizeStops(["#000000", "#808080", "#ffffff"]),
  [[0, "#000000"], [0.5, "#808080"], [1, "#ffffff"]]);
assert.deepEqual(render.normalizeStops([[1, "#FFFFFF"], [0, "#000000"], [0.5, "nope"]]),
  [[0, "#000000"], [1, "#ffffff"]], "stops sort, lower-case and drop invalid colours");
assert.equal(render.normalizeStops(["#000000"]), null, "a ramp needs two stops");
assert.equal(render.normalizeStops(Array.from({ length: 20 }, () => "#123456")).length, render.MAX_STOPS);

/* Every palette parses, every style's default palette exists, every look
 * normalises to itself (so the gallery can recognise the active look). */
for (const [id, palette] of Object.entries(render.PALETTES))
  assert.ok(render.normalizeStops(palette.stops), `palette ${id} must have valid stops`);
for (const [id, style] of Object.entries(render.STYLES))
  assert.ok(render.PALETTES[style.palette], `style ${id} default palette must exist`);
assert.ok(render.LOOKS.length >= 8, "a gallery of looks ships");
for (const look of render.LOOKS) {
  const { state, style } = render.applyScene(render.emptyState(), look.scene, look.id);
  assert.equal(render.matchLook(state, style), look.id, `look ${look.id} must be recognised after applying it`);
}

/* The shader and the model agree on blend modes and style ids. */
assert.deepEqual(render.BLENDS.map(b => b.id), Object.keys(shaders.BLEND_IDS));
for (const id of ["hs", "hsmulti", "slope", "aspect", "northness", "tint", "rem", "c2", "c5", "c10", "c25", "contour"])
  assert.ok(render.STYLES[id] && shaders.styleId(id) !== null, `${id} must exist on both sides`);
assert.equal(render.MAX_LAYERS, shaders.MAX_LAYERS);
assert.equal(render.MAX_STOPS, shaders.MAX_STOPS);

/* Untouched styling stays on the legacy renderer: no stack. */
{
  const state = render.emptyState();
  for (const style of ["hs", "hsmulti", "slope", "aspect", "northness", "tint", "c10"]) {
    assert.ok(render.isLegacy(state, style), `${style} default is legacy`);
    assert.equal(render.buildStack(state, style), null);
  }
  assert.equal(render.buildStack(state, "off"), null);
  assert.ok(!render.isLegacy(state, "rem"), "relative elevation only exists on the stack");
  const rem = render.buildStack(state, "rem", { base: [0, 12] }, { remFlatBase: 410 });
  assert.equal(rem.layers.length, 1);
  assert.deepEqual([rem.layers[0].min, rem.layers[0].max], [0, 12], "auto layers take the fitted range");
  assert.equal(rem.remFlatBase, 410);
}

/* A coloured base plus overlays builds a stack the shader can pack. */
{
  const state = render.emptyState();
  state.base.hs = Object.assign(render.defaultLayer("hs"), { palette: "glacier-shade", gamma: 1.4 });
  state.overlays = [
    Object.assign(render.defaultLayer("slope"), { blend: "multiply", opacity: 0.5 }),
    Object.assign(render.defaultLayer("aspect"), { visible: false })
  ];
  state.effects.detail = 0.5;
  assert.ok(!render.isLegacy(state, "hs"));
  const stack = render.buildStack(state, "hs", {});
  assert.deepEqual(stack.layers.map(l => l.style), ["hs", "slope"], "hidden layers are skipped");
  assert.equal(stack.layers[1].blend, "multiply");
  assert.equal(stack.detail, 0.5);
  const packed = shaders.stackUniforms(stack);
  assert.equal(packed.on, 1);
  assert.equal(packed.count, 2);
  assert.deepEqual(packed.a.slice(4, 8), [shaders.STYLE_IDS.slope, 0.5, shaders.BLEND_IDS.multiply, stack.layers[1].stops.length]);
  close(packed.b[2], 1.4, 1e-9, "gamma packs into the second vector");
}

/* Saved state survives junk: unknown styles and bad numbers are dropped or
 * clamped, never thrown. */
{
  const state = render.normalizeState({
    base: { hs: { palette: "lava", gamma: 99, opacity: -3 }, bogus: {} },
    overlays: [{ style: "slope" }, { style: "nope" }, { style: "aspect" }, { style: "tint" }, { style: "hs" }],
    effects: { detail: 40, remRadius: "x" },
    userLooks: [{ id: "u1", name: "Mine", scene: { style: "rem" } }, { id: 3 }]
  });
  assert.deepEqual(Object.keys(state.base), ["hs"]);
  assert.equal(state.base.hs.palette, "lava");
  assert.ok(state.base.hs.gamma <= 10 && state.base.hs.opacity >= 0);
  assert.equal(state.overlays.length, render.MAX_LAYERS - 1, "overlays cap leaves room for the base");
  assert.equal(state.effects.detail, 3);
  assert.equal(state.effects.remRadius, render.EFFECT_DEFAULTS.remRadius);
  assert.equal(state.userLooks.length, 1);
  assert.equal(render.normalizeState(null).look, "classic");
}

/* Fit to view: percentiles ignore outliers; relative elevation starts at 0. */
{
  const values = Array.from({ length: 1001 }, (_, i) => 1000 + i);
  values.push(9000, -500);
  const [low, high] = render.fitRange(values, "tint");
  assert.ok(low >= 1000 && low <= 1030 && high >= 1970 && high <= 2010, `robust range ${low}..${high}`);
  assert.equal(render.fitRange(values, "rem")[0], 0);
  assert.equal(render.fitRange([], "tint"), null);
  const flat = render.fitRange([5, 5, 5], "tint");
  assert.ok(flat[1] > flat[0], "a flat view still gets a usable range");
}

/* Blend maths follow the W3C formulas the shader uses. */
{
  const b = [0.2, 0.5, 0.8], s = [0.6, 0.4, 0.1];
  assert.deepEqual(render.blendColour("normal", b, s), s);
  render.blendColour("multiply", b, s).forEach((v, i) => close(v, b[i] * s[i], 1e-12, "multiply"));
  render.blendColour("screen", b, s).forEach((v, i) => close(v, b[i] + s[i] - b[i] * s[i], 1e-12, "screen"));
  render.blendColour("darken", b, s).forEach((v, i) => close(v, Math.min(b[i], s[i]), 1e-12, "darken"));
  close(render.blendColour("overlay", [0.25], [0.5])[0], 0.25, 1e-12, "overlay with mid-grey source keeps the backdrop");
  const lum = c => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
  close(lum(render.blendColour("color", b, s)), lum(b), 1e-9, "colour keeps backdrop luminance");
  close(lum(render.blendColour("luminosity", b, s)), lum(s), 1e-9, "luminosity takes source luminance");
  const over = render.composite([0, 0, 0, 0], [1, 0, 0], 0.5, "multiply");
  close(over[0], 0.5, 1e-12, "over an empty backdrop a layer draws as normal");
  close(over[3], 0.5, 1e-12, "alpha accumulates source-over");
}

/* Palette lookup: gamma bends the ramp, steps quantise it. */
{
  const stops = [[0, 0, 0, 0, 1], [1, 1, 1, 1, 1]];
  const at = (patch, value) => render._test.paletteColour(Object.assign({ stops, min: 0, max: 10, gamma: 1, steps: 0 }, patch), value)[0];
  close(at({}, 5), 0.5, 1e-12, "linear midpoint");
  close(at({ gamma: 2 }, 5), 0.25, 1e-12, "gamma 2 darkens the middle");
  close(at({ steps: 2 }, 4), 0, 1e-12, "two bands: lower half");
  close(at({ steps: 2 }, 6), 1, 1e-12, "two bands: upper half");
  close(at({}, -50), 0, 1e-12, "below range clamps");
}

/* Separable filters: blur preserves a flat field, min erodes a spike. */
{
  const w = 9, h = 9, flat = new Float32Array(w * h).fill(3);
  assert.ok(render._test.filterGrid(flat, w, h, 2, "blur").every(v => Math.abs(v - 3) < 1e-5));
  const spike = flat.slice(); spike[40] = 100;
  assert.equal(render._test.filterGrid(spike, w, h, 1, "min")[40], 3);
}

/* New analysis layers can register a style with its own palette. */
{
  const style = render.registerStyle({ id: "test-snow", label: "Snow", family: "sequential", domain: [0, 1],
    palette: { name: "Snow", stops: ["#000000", "#ffffff"] }, unit: "value", auto: false });
  assert.equal(style.label, "Snow");
  assert.ok(render.OVERLAY_STYLES.includes("test-snow"));
  assert.ok(render.PALETTES["style-test-snow"]);
  assert.equal(render.defaultLayer("test-snow").palette, "style-test-snow");
  assert.throws(() => render.registerStyle({ id: "bad id" }), TypeError);
}

/* The CPU preview draws something for every look. */
{
  const dem = render.previewTerrain(48, 32);
  for (const look of render.LOOKS) {
    const rgba = render.renderScenePreview(look.scene, dem, { azimuth: 315, altitude: 45 });
    assert.equal(rgba.length, 48 * 32 * 4);
    let opaque = 0, sum = 0;
    for (let i = 0; i < rgba.length; i += 4) { opaque += rgba[i + 3] > 0; sum += rgba[i] + rgba[i + 1] + rgba[i + 2]; }
    assert.ok(opaque > 48 * 32 * 0.9 && sum > 0, `look ${look.id} preview must draw`);
  }
}

console.log("lidar render model checks passed");
