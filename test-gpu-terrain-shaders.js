"use strict";

const assert = require("assert/strict");
const shaders = require("./gpu-terrain-shaders.js");

const PRELUDE = [
  "uniform sampler2D u_heightTex;",
  "float csp_height(ivec2 p){ return texelFetch(u_heightTex, p, 0).r; }",
  "int csp_rank(ivec2 p){ return int(texelFetch(u_heightTex, p, 0).g + 0.5); }",
  "bool csp_valid(ivec2 p){ return texelFetch(u_heightTex, p, 0).g > 0.5; }",
  "ivec2 csp_size(){ return textureSize(u_heightTex, 0); }"
].join("\n");
const SRC = shaders.shadeFragmentSource(PRELUDE);

function close(actual, expected, epsilon, message) {
  assert.ok(Math.abs(actual - expected) <= epsilon,
    `${message}: expected ${expected}, got ${actual}`);
}

/* Contract surface. */
assert.equal(shaders.VERSION, "1");
assert.deepEqual({ ...shaders.STYLE_IDS },
  { hs: 0, hsmulti: 1, slope: 2, aspect: 3, northness: 4, tint: 5, c2: 6, c5: 7, c10: 8, c25: 9, rem: 10, contour: 11 });
assert.match(shaders.fullscreenVertexSource, /#version 300 es/);
assert.match(shaders.fullscreenVertexSource, /out vec2 v_screenUv/);
assert.match(shaders.fullscreenVertexSource, /gl_VertexID/);

/* Fragment source: prelude inserted verbatim, prelude functions used and
 * never redefined, version line first. */
assert.ok(SRC.startsWith("#version 300 es\n"), "fragment shader must start with the version line");
assert.ok(SRC.includes(PRELUDE), "engine prelude must be inserted verbatim");
for (const fn of ["csp_height", "csp_rank", "csp_valid", "csp_size"]) {
  assert.ok(SRC.includes(fn + "("), `${fn} must be called`);
  assert.ok(!new RegExp(`(float|int|bool|ivec2)\\s+${fn}\\s*\\(`).test(SRC.replace(PRELUDE, "")),
    `${fn} must not be redefined outside the prelude`);
}
assert.match(SRC, /in vec2 v_screenUv;/);
assert.match(SRC, /out vec4 fragColor;/);

/* Every declared uniform is listed in SHADE_UNIFORMS and vice versa. */
{
  const declared = [...SRC.matchAll(/uniform\s+(?:int|float|vec2|vec3|vec4)\s+(u_\w+)\s*(?:\[\d+\])?\s*;/g)].map((m) => m[1]);
  assert.deepEqual([...declared].sort(), [...shaders.SHADE_UNIFORMS].sort(),
    "SHADE_UNIFORMS must list every uniform the shader declares");
  assert.equal(new Set(shaders.SHADE_UNIFORMS).size, shaders.SHADE_UNIFORMS.length,
    "SHADE_UNIFORMS must not contain duplicates");
}

/* The Apple-GPU NaN trap: no power call may take a possibly-negative base.
 * The only power call allowed is the relief factor, whose base is clamped
 * with max(..., 0.0). The hsmulti weight must stay s * s. */
{
  const powerCalls = [...SRC.matchAll(/pow\s*\(([^)]*)\)/g)].map((m) => m[1]);
  assert.ok(powerCalls.length >= 1, "relief factor power call expected");
  for (const args of powerCalls)
    assert.ok(args.includes("max("), `power call base must be clamped non-negative: pow(${args})`);
  assert.ok(SRC.includes("s * s"), "hsmulti weight must be s * s");
  assert.ok(!/pow\s*\(\s*s\b/.test(SRC), "hsmulti must not raise s to a power");
}

/* uniformValues: representative full state maps field-by-field. */
{
  const values = shaders.uniformValues({
    terrain: {
      style: "tint", opacity: 0.75,
      look: { contrast: 130, saturation: 60, brightness: 90 },
      lighting: { azimuth: 200, altitude: 30, ambient: 0.3 }
    },
    spectrum: {
      spectrumOn: true, level: 812, span: 1200, spectrumAlpha: 0.65,
      below: { enabled: true, level: 400, color: [0.21, 0.49, 0.84] },
      above: { enabled: false, level: 2400, color: [0.93, 0.41, 0.31] },
      bandAlpha: 0.52, bandFeather: 45.7, outline: true, outlineWidth: 2.4384,
      bandCompiled: { rgba() { return [0, 0, 0, 0]; } }
    },
    spectrumOpacity: 0.9,
    groundResOverride: 3.25
  }, { centerMerc: [0.31, 0.62], zoom: 15.5, bearing: 37, cssSize: [1024, 768], dpr: 2, dz: 1 });

  assert.deepEqual(Object.keys(values).sort(), [...shaders.SHADE_UNIFORMS].sort(),
    "uniformValues must return exactly the SHADE_UNIFORMS names");
  assert.equal(values.u_style, shaders.STYLE_IDS.tint);
  assert.equal(values.u_terrainOpacity, 0.75);
  assert.equal(values.u_sunAzimuth, 200);
  assert.equal(values.u_sunAltitude, 30);
  assert.equal(values.u_ambient, 0.3);
  close(values.u_lookContrast, 1.3, 1e-12, "contrast percent becomes a factor");
  close(values.u_lookSaturation, 0.6, 1e-12, "saturation percent becomes a factor");
  close(values.u_lookBrightness, 0.9, 1e-12, "brightness percent becomes a factor");
  assert.equal(values.u_spectrumOn, 1);
  assert.equal(values.u_spectrumLevel, 812);
  assert.equal(values.u_spectrumSpan, 1200);
  assert.equal(values.u_spectrumAlpha, 0.65);
  assert.equal(values.u_belowOn, 1);
  assert.equal(values.u_belowLevel, 400);
  assert.deepEqual(values.u_belowColor, [0.21, 0.49, 0.84]);
  assert.equal(values.u_aboveOn, 0);
  assert.equal(values.u_aboveLevel, 2400);
  assert.equal(values.u_bandAlpha, 0.52);
  assert.equal(values.u_bandFeather, 45.7);
  assert.equal(values.u_outlineOn, 1);
  assert.equal(values.u_outlineWidth, 2.4384);
  assert.equal(values.u_spectrumOpacity, 0.9);
  assert.deepEqual(values.u_centerMerc, [0.31, 0.62]);
  assert.equal(values.u_zoom, 15.5);
  close(values.u_bearingRad, 37 * Math.PI / 180, 1e-12, "bearing degrees become radians");
  assert.deepEqual(values.u_cssSize, [1024, 768]);
  assert.equal(values.u_dpr, 2);
  assert.equal(values.u_groundResOverride, 3.25);
}

/* A height-only ramp must not request unused derivatives. Lighting and
 * analytical styles still require the original gradient path. */
for (const style of ['rem','tint']) {
  const ramp = param => shaders.uniformValues({terrain:{stack:{layers:[{style,param}]}}},{});
  assert.equal(ramp(0).u_stackGradient,0);
  assert.equal(ramp(.5).u_stackGradient,1);
}
for (const style of ['hs','hsmulti','slope','aspect','northness','c5','contour'])
  assert.equal(shaders.uniformValues({terrain:{stack:{layers:[{style}]}}},{}).u_stackGradient,1);

/* uniformValues: every style id, off, clamps and defaults. */
{
  for (const [style, id] of Object.entries(shaders.STYLE_IDS))
    assert.equal(shaders.uniformValues({ terrain: { style } }, {}).u_style, id, `style ${style}`);
  assert.equal(shaders.uniformValues({ terrain: { style: "off" } }, {}).u_style, -1);
  const defaults = shaders.uniformValues({}, {});
  assert.equal(defaults.u_style, shaders.STYLE_IDS.hs);
  assert.equal(defaults.u_terrainOpacity, 1);
  assert.equal(defaults.u_sunAzimuth, 315);
  assert.equal(defaults.u_sunAltitude, 45);
  assert.equal(defaults.u_ambient, 0.12);
  assert.equal(defaults.u_lookSaturation, 1);
  assert.equal(defaults.u_lookContrast, 1);
  assert.equal(defaults.u_lookBrightness, 1);
  assert.equal(defaults.u_spectrumOn, 0);
  assert.equal(defaults.u_spectrumOpacity, 1);
  assert.equal(defaults.u_groundResOverride, 0);
  assert.deepEqual(defaults.u_centerMerc, [0.5, 0.5]);
  const clamped = shaders.uniformValues({
    terrain: { opacity: 4, lighting: { azimuth: 720, altitude: 200, ambient: 9 } },
    spectrum: { spectrumAlpha: -2, bandAlpha: 7 }
  }, { dpr: 0 });
  assert.equal(clamped.u_terrainOpacity, 1);
  assert.equal(clamped.u_sunAzimuth, 359);
  assert.equal(clamped.u_sunAltitude, 90);
  assert.equal(clamped.u_ambient, 0.6);
  assert.equal(clamped.u_spectrumAlpha, 0);
  assert.equal(clamped.u_bandAlpha, 1);
  assert.ok(clamped.u_dpr > 0, "dpr must never reach the shader as zero");
  assert.deepEqual(shaders.uniformValues({ spectrum: {} }, {}).u_belowColor, [1, 0, 0],
    "missing below colour falls back to the elevationRenderSettings default");
  assert.deepEqual(shaders.uniformValues({ spectrum: {} }, {}).u_aboveColor, [0, 0, 1],
    "missing above colour falls back to the elevationRenderSettings default");
}

/* Mercator / metres-per-pixel math against independent references. */
{
  close(shaders.latitudeFromMercatorY(0.5), 0, 1e-15, "Mercator y 0.5 is the equator");
  close(shaders.latitudeFromMercatorY(0), Math.atan(Math.sinh(Math.PI)), 1e-15, "Mercator top edge");
  const lat45 = 45 * Math.PI / 180;
  const mercY45 = (1 - Math.log(Math.tan(lat45) + 1 / Math.cos(lat45)) / Math.PI) / 2;
  close(shaders.latitudeFromMercatorY(mercY45), lat45, 1e-12, "Mercator round trip at 45 degrees");

  const equatorView = { centerMerc: [0.5, 0.5], zoom: 0, bearing: 0, cssSize: [256, 256], dpr: 1 };
  close(shaders.metersPerPixel(equatorView), 40075016.68557849 / 256, 1e-6,
    "one world pixel at zoom 0 on the equator");
  close(shaders.metersPerPixel({ ...equatorView, zoom: 10, dpr: 2 }),
    40075016.68557849 / (256 * 1024 * 2), 1e-9, "zoom and dpr both shrink ground pixels");
  close(shaders.metersPerPixel({ centerMerc: [0.5, mercY45], zoom: 8, dpr: 1 }),
    40075016.68557849 * Math.cos(lat45) / (256 * 256), 1e-9, "latitude cosine shrinks ground pixels");
  close(shaders.reliefZFactor(0), 1, 1e-12, "relief factor at zero resolution");
  close(shaders.reliefZFactor(100), 1 + 0.024 * Math.pow(100, 0.664), 1e-12, "relief factor formula");
}

/* Screen-to-Mercator: centre is exact at any bearing; offsets rotate. */
{
  const view = { centerMerc: [0.31, 0.62], zoom: 12, bearing: 0, cssSize: [800, 600], dpr: 2 };
  assert.deepEqual(shaders.screenToMercator(view, [0.5, 0.5]), [0.31, 0.62]);
  assert.deepEqual(shaders.screenToMercator({ ...view, bearing: 137 }, [0.5, 0.5]), [0.31, 0.62]);
  const world = 256 * Math.pow(2, 12);
  const east = shaders.screenToMercator(view, [1, 0.5]);
  close(east[0], 0.31 + 400 / world, 1e-15, "screen right is Mercator east at bearing 0");
  close(east[1], 0.62, 1e-15, "screen right keeps Mercator y at bearing 0");
  const south = shaders.screenToMercator(view, [0.5, 1]);
  close(south[1], 0.62 + 300 / world, 1e-15, "screen down is Mercator south at bearing 0");
  const rotated = shaders.screenToMercator({ ...view, bearing: 90 }, [1, 0.5]);
  close(rotated[0], 0.31, 1e-12, "bearing 90: screen right is no longer east");
  close(rotated[1], 0.62 - 400 / world, 1e-12, "bearing 90: screen right is Mercator north");
  const diagonal = shaders.screenToMercator({ ...view, bearing: 37 }, [1, 1]);
  const b = 37 * Math.PI / 180;
  close(diagonal[0], 0.31 + (400 * Math.cos(b) + 300 * Math.sin(b)) / world, 1e-12, "bearing 37 x");
  close(diagonal[1], 0.62 + (-400 * Math.sin(b) + 300 * Math.cos(b)) / world, 1e-12, "bearing 37 y");
}

/* Gradient rotation: cardinal bearings and length preservation. */
{
  assert.deepEqual(shaders.rotateGradient(0.3, -0.7, 0), [0.3, -0.7]);
  let [e, s] = shaders.rotateGradient(1, 0, 90);
  close(e, 0, 1e-15, "bearing 90: screen-right rise has no east component");
  close(s, -1, 1e-15, "bearing 90: screen-right rise faces south negatively (rises north)");
  [e, s] = shaders.rotateGradient(0, 1, 90);
  close(e, 1, 1e-15, "bearing 90: screen-down rise is an eastward rise");
  close(s, 0, 1e-15, "bearing 90: screen-down rise has no south component");
  [e, s] = shaders.rotateGradient(1, 0, 180);
  close(e, -1, 1e-15, "bearing 180: screen-right rise is a westward rise");
  close(s, 0, 1e-15, "bearing 180: screen-right rise has no south component");
  [e, s] = shaders.rotateGradient(0.6, 0.8, 37);
  close(Math.hypot(e, s), 1, 1e-15, "rotation preserves gradient length");
  const rb = 37 * Math.PI / 180;
  close(e, 0.6 * Math.cos(rb) + 0.8 * Math.sin(rb), 1e-15, "bearing 37 east component");
  close(s, -(0.6 * Math.sin(rb) - 0.8 * Math.cos(rb)), 1e-15, "bearing 37 south component");
}

/* CSS filter reference: Filter Effects formulas, order and clamping. */
{
  const identity = shaders.cssFilterReference([0.2, 0.5, 0.9], { saturation: 1, contrast: 1, brightness: 1 });
  assert.deepEqual(identity, [0.2, 0.5, 0.9]);
  const grey = shaders.cssFilterReference([1, 0, 0], { saturation: 0, contrast: 1, brightness: 1 });
  for (const channel of grey) close(channel, 0.213, 1e-12, "saturate(0) gives the luminance row");
  const contrasted = shaders.cssFilterReference([200 / 255, 100 / 255, 50 / 255],
    { saturation: 1, contrast: 1.8, brightness: 1 });
  close(contrasted[0], 1, 1e-12, "contrast clamps above 1 (browser-observed behaviour)");
  close(contrasted[1], (100 / 255) * 1.8 + (1 - 1.8) * 0.5, 1e-12, "contrast intercept formula");
  const dark = shaders.cssFilterReference([0.4, 0.4, 0.4], { saturation: 1, contrast: 1, brightness: 0.5 });
  assert.deepEqual(dark, [0.2, 0.2, 0.2]);
  const ordered = shaders.cssFilterReference([0.9, 0.1, 0.1], { saturation: 0, contrast: 2, brightness: 1 });
  close(ordered[0], Math.min(1, Math.max(0, (0.213 * 0.9 + 0.715 * 0.1 + 0.072 * 0.1) * 2 - 0.5)), 1e-12,
    "saturate runs before contrast (swapped order would differ)");
}

console.log("gpu terrain shader checks passed");
