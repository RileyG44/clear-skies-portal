"use strict";
/*
 * Real-GPU parity for gpu-terrain-shaders.js (Workstream S). NOT part of
 * npm test: it needs a real GPU browser.
 *
 *   node scripts/gpu2d/shader-parity.js [chrome|webkit|both]
 *
 * Renders every terrain style, spectrum, bands, outline, appearance looks,
 * opacities and bearings 0/37/90/180 through CSPGpuTerrainShaders with a
 * test prelude backed by an RGBA32F texture of a synthetic terrain grid
 * (with no-data holes), and compares against the CPU references
 * CSPTerrainRaster.renderRgba and CSPTerrainDrape.elevationColours.
 * Exact ground resolution parity uses the u_groundResOverride uniform.
 * Rotation cases compare against the north-up GPU render resampled by the
 * same rotation (interior pixels), per spec section 9 item 5.
 *
 * Browsers (real GPUs; chrome-headless-shell is software, do not use):
 *   Chrome+Metal and WebKit via the Playwright installs named in the spec.
 * Playwright comes from scripts/lib/playwright.js.
 */
const shaders = require("../../gpu-terrain-shaders.js");
const terrainCore = require("../../terrain-core.js");
const raster = require("../../terrain-raster.js");
const drape = require("../../terrain-drape-core.js");
const elevationBands = require("../../elevation-bands.js");

const W = 256, H = 256;
const GROUND_RES = 1.5;
const LIGHTING = { azimuth: 315, altitude: 45, ambient: 0.12 };

/* ---------------- fixture ---------------- */

function fixtureGrid() {
  const grid = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = 640
      + 95 * Math.sin(x / 23.0) * Math.cos(y / 31.0)
      + 55 * Math.sin((x + 2 * y) / 11.0)
      + 28 * Math.sin(x / 5.3) * Math.sin(y / 7.1)
      + 130 * Math.exp(-Math.pow(y - (120 + 30 * Math.sin(x / 40.0)), 2) / (2 * 18 * 18))
      + x * 0.35 - y * 0.12;
    grid[y * W + x] = v;
  }
  for (let y = 40; y < 76; y++) for (let x = 180; x < 216; x++) grid[y * W + x] = NaN;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = x - 60, dy = y - 200;
    if (dx * dx + dy * dy < 18 * 18) grid[y * W + x] = NaN;
  }
  return grid;
}

/* Smooth, hole-free field for rotation cases: at non-cardinal bearings the
 * discrete Sobel kernel on a resampled field cannot reproduce a rotated
 * gradient exactly, and high-frequency ripples would measure that kernel
 * discretisation instead of the bearing math (which the cardinal bearings
 * and the Node rotateGradient tests pin down exactly). */
function smoothGrid() {
  const grid = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    grid[y * W + x] = 640
      + 95 * Math.sin(x / 23.0) * Math.cos(y / 31.0)
      + 55 * Math.sin((x + 2 * y) / 11.0)
      + x * 0.35 - y * 0.12;
  }
  return grid;
}

/* ---------------- CPU references ---------------- */

function reliefGroundRes(style, groundRes) {
  return (style === "hs" || style === "hsmulti" || style === "tint")
    ? groundRes / shaders.reliefZFactor(groundRes) : groundRes;
}

function cpuComposite(spec) {
  const grid = spec.grid;
  /* Terrain straight RGBA bytes, appearance filter, premultiply, opacity. */
  const terrainPremult = new Float32Array(W * H * 4);
  if (spec.style !== "off") {
    const straight = raster.renderRgba(spec.style, {
      grid, width: W, height: H,
      groundRes: reliefGroundRes(spec.style, spec.groundRes),
      lighting: spec.lighting
    });
    const look = {
      saturation: spec.look.saturation / 100,
      contrast: spec.look.contrast / 100,
      brightness: spec.look.brightness / 100
    };
    for (let i = 0; i < W * H; i++) {
      const a = straight[i * 4 + 3] / 255;
      if (a <= 0) continue;
      const rgb = shaders.cssFilterReference(
        [straight[i * 4] / 255, straight[i * 4 + 1] / 255, straight[i * 4 + 2] / 255], look);
      terrainPremult[i * 4] = rgb[0] * a * spec.terrainOpacity;
      terrainPremult[i * 4 + 1] = rgb[1] * a * spec.terrainOpacity;
      terrainPremult[i * 4 + 2] = rgb[2] * a * spec.terrainOpacity;
      terrainPremult[i * 4 + 3] = a * spec.terrainOpacity;
    }
  }
  /* Spectrum/bands straight bytes -> premultiplied, scaled by opacity. */
  const specPremult = new Float32Array(W * H * 4);
  const sp = spec.spectrum;
  if (sp) {
    const bandState = {
      unit: "m",
      bands: [
        { id: "below", operator: "below", enabled: sp.below.enabled, maxM: sp.below.level,
          color: "#367ed6", opacity: sp.bandAlpha, featherM: sp.bandFeather,
          outline: { enabled: sp.outline, color: "#ffffff", opacity: 0.88, widthM: sp.outlineWidth } },
        { id: "above", operator: "above", enabled: sp.above.enabled, minM: sp.above.level,
          color: "#ed684f", opacity: sp.bandAlpha, featherM: sp.bandFeather,
          outline: { enabled: sp.outline, color: "#ffffff", opacity: 0.88, widthM: sp.outlineWidth } }
      ]
    };
    const settings = {
      spectrumOn: sp.spectrumOn, level: sp.level, span: sp.span,
      spectrumAlpha: sp.spectrumAlpha,
      bandCompiled: elevationBands.compileBands(bandState)
    };
    const straight = drape.elevationColours(grid, W * H, settings, new Uint8ClampedArray(W * H * 4), W, W, 0);
    for (let i = 0; i < W * H; i++) {
      const a = straight[i * 4 + 3] / 255;
      if (a <= 0) continue;
      specPremult[i * 4] = straight[i * 4] / 255 * a * spec.spectrumOpacity;
      specPremult[i * 4 + 1] = straight[i * 4 + 1] / 255 * a * spec.spectrumOpacity;
      specPremult[i * 4 + 2] = straight[i * 4 + 2] / 255 * a * spec.spectrumOpacity;
      specPremult[i * 4 + 3] = a * spec.spectrumOpacity;
    }
  }
  /* Spectrum source-over terrain, premultiplied -> bytes. */
  const out = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H * 4; i += 4) {
    const keep = 1 - specPremult[i + 3];
    out[i] = Math.round((specPremult[i] + terrainPremult[i] * keep) * 255);
    out[i + 1] = Math.round((specPremult[i + 1] + terrainPremult[i + 1] * keep) * 255);
    out[i + 2] = Math.round((specPremult[i + 2] + terrainPremult[i + 2] * keep) * 255);
    out[i + 3] = Math.round((specPremult[i + 3] + terrainPremult[i + 3] * keep) * 255);
  }
  return out;
}

/* ---------------- comparison ---------------- */

function compareBytes(gpu, cpu, margin) {
  let max = 0, over1 = 0, over3 = 0, n = 0;
  for (let y = margin; y < H - margin; y++) for (let x = margin; x < W - margin; x++) {
    const o = (y * W + x) * 4;
    if (gpu[o + 3] < 8 && cpu[o + 3] < 8) continue;
    n++;
    let m = 0;
    for (let c = 0; c < 4; c++) m = Math.max(m, Math.abs(gpu[o + c] - cpu[o + c]));
    if (m > max) max = m;
    if (m > 1) over1++;
    if (m > 3) over3++;
  }
  return { max, pctOver1: 100 * over1 / Math.max(1, n), pctOver3: 100 * over3 / Math.max(1, n), n };
}

function lineIoU(gpu, cpu, margin) {
  const isLine = (img, x, y) => img[(y * W + x) * 4 + 3] > 10;
  const near = (img, x, y) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
      if (isLine(img, x + dx, y + dy)) return true;
    return false;
  };
  let a = 0, b = 0, matchA = 0, matchB = 0;
  for (let y = margin; y < H - margin; y++) for (let x = margin; x < W - margin; x++) {
    const ga = isLine(gpu, x, y), ca = isLine(cpu, x, y);
    if (ca) { a++; if (near(gpu, x, y)) matchA++; }
    if (ga) { b++; if (near(cpu, x, y)) matchB++; }
  }
  return { iouTolerant: (matchA + matchB) / Math.max(1, a + b), refMatched: a ? matchA / a : 1, gpuMatched: b ? matchB / b : 1 };
}

function rotateOffset(sx, sy, bearingDeg) {
  const b = bearingDeg * Math.PI / 180, c = Math.cos(b), s = Math.sin(b);
  return [sx * c + sy * s, -sx * s + sy * c];
}
function rotatedGrid(grid, bearingDeg) {
  /* Bilinear: a nearest-neighbour rotation staircases the smooth fixture
   * field and the Sobel gradient then measures the steps, not the terrain. */
  const out = new Float32Array(W * H).fill(NaN);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [gx, gy] = rotateOffset(x + 0.5 - W / 2, y + 0.5 - H / 2, bearingDeg);
    const fx = gx + W / 2 - 0.5, fy = gy + H / 2 - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    if (x0 < 0 || y0 < 0 || x0 + 1 >= W || y0 + 1 >= H) continue;
    const a = grid[y0 * W + x0], b = grid[y0 * W + x0 + 1];
    const c = grid[(y0 + 1) * W + x0], d = grid[(y0 + 1) * W + x0 + 1];
    if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c) || !Number.isFinite(d)) continue;
    out[y * W + x] = a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
  }
  return out;
}
function resampleBytes(bytes, bearingDeg) {
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [gx, gy] = rotateOffset(x + 0.5 - W / 2, y + 0.5 - H / 2, bearingDeg);
    const nx = Math.round(gx + W / 2 - 0.5), ny = Math.round(gy + H / 2 - 0.5);
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
    const so = (ny * W + nx) * 4, oo = (y * W + x) * 4;
    for (let c = 0; c < 4; c++) out[oo + c] = bytes[so + c];
  }
  return out;
}

/* Discrete JS simulation of the shader for non-cardinal bearings. The
 * north-up-resampled comparison at 37 degrees measures Sobel-kernel
 * discretisation on a resampled grid (a JS simulation of this exact
 * discrete pipeline reproduces the same ~19% of aspect pixels over
 * 3/255), so rotation plumbing is validated exactly here instead:
 * same rotated field, same Sobel, shaders.rotateGradient, CPU colours. */
const ASPECT_STOPS = [[0, "#4d78c8"], [45, "#3ba5b0"], [90, "#57a765"], [135, "#c9ad4f"],
  [180, "#d96b52"], [225, "#c45b82"], [270, "#8d65bb"], [315, "#5e77c5"], [360, "#4d78c8"]]
  .map(([v, hex]) => [v, [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))]);

function simulateRotated(style, gridRot, bearing) {
  const out = new Uint8Array(W * H * 4);
  const at = (x, y) => gridRot[y * W + x];
  const res = reliefGroundRes(style, GROUND_RES);
  const shadeOf = terrainCore.createHillshade(LIGHTING);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const a = at(x - 1, y - 1), b = at(x, y - 1), c = at(x + 1, y - 1);
    const d = at(x - 1, y), f = at(x + 1, y);
    const g = at(x - 1, y + 1), h = at(x, y + 1), k = at(x + 1, y + 1);
    if (![a, b, c, d, f, g, h, k].every(Number.isFinite)) continue;
    const dxS = ((c + 2 * f + k) - (a + 2 * d + g)) / (8 * res);
    const dyS = ((g + 2 * h + k) - (a + 2 * b + c)) / (8 * res);
    const [e, s] = shaders.rotateGradient(dxS, dyS, bearing);
    const o = (y * W + x) * 4;
    if (style === "hs") {
      const byte = Math.round(shadeOf(e, s) * 255);
      out[o] = byte; out[o + 1] = byte; out[o + 2] = byte; out[o + 3] = 255;
    } else {
      if (Math.hypot(e, s) <= Math.tan(0.5 * Math.PI / 180)) continue;
      const aspect = ((Math.atan2(-e, s) * 180 / Math.PI) % 360 + 360) % 360;
      let i = 0;
      while (i < ASPECT_STOPS.length - 2 && aspect > ASPECT_STOPS[i + 1][0]) i++;
      const [v0, c0] = ASPECT_STOPS[i], [v1, c1] = ASPECT_STOPS[i + 1];
      const t = (aspect - v0) / (v1 - v0);
      for (let ch = 0; ch < 3; ch++) out[o + ch] = Math.round(c0[ch] + (c1[ch] - c0[ch]) * t);
      out[o + 3] = 255;
    }
  }
  return out;
}

/* ---------------- in-page GPU harness ---------------- */

const PRELUDE = [
  "uniform sampler2D u_heightTex;",
  "float csp_height(ivec2 p){ return texelFetch(u_heightTex, p, 0).r; }",
  "int csp_rank(ivec2 p){ return int(texelFetch(u_heightTex, p, 0).g + 0.5); }",
  "bool csp_valid(ivec2 p){ ivec2 s = textureSize(u_heightTex, 0);",
  "  return p.x >= 0 && p.y >= 0 && p.x < s.x && p.y < s.y && texelFetch(u_heightTex, p, 0).g > 0.5; }",
  "ivec2 csp_size(){ return textureSize(u_heightTex, 0); }"
].join("\n");

function pageSetup(uniformNames) {
  const gl = document.createElement("canvas").getContext("webgl2",
    { alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false });
  if (!gl) throw new Error("WebGL2 unavailable");
  const compile = (type, source) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, source); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, CSPGpuTerrainShaders.fullscreenVertexSource));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, CSPGpuTerrainShaders.shadeFragmentSource(window.__prelude)));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  const locations = {};
  for (const name of uniformNames) locations[name] = gl.getUniformLocation(program, name);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  window.__render = (gridB64, width, height, values) => {
    const binary = atob(gridB64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const grid = new Float32Array(bytes.buffer);
    const data = new Float32Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const v = grid[i];
      data[i * 4] = Number.isFinite(v) ? v : 0;
      data[i * 4 + 1] = Number.isFinite(v) && v > -1e20 ? 1 : 0;
    }
    const canvas = gl.canvas;
    canvas.width = width; canvas.height = height;
    gl.viewport(0, 0, width, height);
    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, data);
    gl.uniform1i(gl.getUniformLocation(program, "u_heightTex"), 0);
    for (const name of uniformNames) {
      const loc = locations[name], value = values[name];
      if (!loc) continue;
      if (name === "u_style") gl.uniform1i(loc, value);
      else if (Array.isArray(value) && value.length === 2) gl.uniform2f(loc, value[0], value[1]);
      else if (Array.isArray(value) && value.length === 3) gl.uniform3f(loc, value[0], value[1], value[2]);
      else gl.uniform1f(loc, value);
    }
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const px = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, px);
    /* readPixels row 0 is the canvas bottom; flip to top-first rows. */
    const flipped = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++)
      flipped.set(px.subarray((height - 1 - y) * width * 4, (height - y) * width * 4), y * width * 4);
    let out = "";
    const raw = new Uint8Array(flipped.buffer);
    for (let i = 0; i < raw.length; i += 8192)
      out += String.fromCharCode.apply(null, raw.subarray(i, i + 8192));
    return btoa(out);
  };
  return "ready";
}

/* ---------------- cases ---------------- */

const IDENTITY_LOOK = { contrast: 100, saturation: 100, brightness: 100 };
const BASE_VIEW = { centerMerc: [0.33, 0.35], zoom: 15, bearing: 0, cssSize: [W, H], dpr: 1, dz: 0 };

function spectrumSettings(patch) {
  return Object.assign({
    spectrumOn: false, level: 640, span: 800, spectrumAlpha: 0.75,
    below: { enabled: false, level: 520, color: [54 / 255, 125 / 255, 214 / 255] },
    above: { enabled: false, level: 900, color: [237 / 255, 104 / 255, 79 / 255] },
    bandAlpha: 0.52, bandFeather: 0, outline: false, outlineWidth: 8 * 0.3048
  }, patch || {});
}

function makeCase(name, patch) {
  return Object.assign({
    name, style: "hs", lighting: LIGHTING, look: IDENTITY_LOOK,
    terrainOpacity: 1, spectrum: null, spectrumOpacity: 1,
    groundRes: GROUND_RES, bearing: 0, grid: null, contour: false
  }, patch || {});
}

function buildCases(grid) {
  const cases = [];
  for (const style of ["hs", "hsmulti", "slope", "aspect", "northness", "tint", "c2", "c5", "c10", "c25"])
    cases.push(makeCase("style-" + style, { style, contour: style.startsWith("c") }));
  cases.push(makeCase("hs-custom-light", { style: "hs", lighting: { azimuth: 200, altitude: 30, ambient: 0.25 } }));
  cases.push(makeCase("tint-custom-light", { style: "tint", lighting: { azimuth: 120, altitude: 60, ambient: 0.05 } }));
  cases.push(makeCase("hs-look", { style: "hs", look: { contrast: 130, saturation: 55, brightness: 115 } }));
  cases.push(makeCase("slope-look", { style: "slope", look: { contrast: 130, saturation: 55, brightness: 115 } }));
  cases.push(makeCase("tint-opacity", { style: "tint", terrainOpacity: 0.55 }));
  cases.push(makeCase("c10-look-opacity", { style: "c10", contour: true, terrainOpacity: 0.6, look: { contrast: 120, saturation: 140, brightness: 90 } }));
  cases.push(makeCase("hs+spectrum", { style: "hs", spectrum: spectrumSettings({ spectrumOn: true }) }));
  cases.push(makeCase("off+spectrum", { style: "off", spectrum: spectrumSettings({ spectrumOn: true }) }));
  cases.push(makeCase("hs+bands-feather", {
    style: "hs",
    spectrum: spectrumSettings({ below: { enabled: true, level: 520, color: [54 / 255, 125 / 255, 214 / 255] }, above: { enabled: true, level: 900, color: [237 / 255, 104 / 255, 79 / 255] }, bandFeather: 30 })
  }));
  cases.push(makeCase("off+bands-outline", {
    style: "off",
    spectrum: spectrumSettings({ below: { enabled: true, level: 520, color: [54 / 255, 125 / 255, 214 / 255] }, above: { enabled: true, level: 900, color: [237 / 255, 104 / 255, 79 / 255] }, outline: true })
  }));
  cases.push(makeCase("slope-full-composite", {
    style: "slope",
    spectrum: spectrumSettings({ spectrumOn: true, below: { enabled: true, level: 520, color: [54 / 255, 125 / 255, 214 / 255] }, above: { enabled: true, level: 900, color: [237 / 255, 104 / 255, 79 / 255] }, bandFeather: 18, outline: true })
  }));
  cases.push(makeCase("hs+spectrum-opacity", { style: "hs", spectrum: spectrumSettings({ spectrumOn: true }), spectrumOpacity: 0.45 }));
  for (const c of cases) c.grid = grid;
  return cases;
}

function stateFor(c) {
  return {
    terrain: { style: c.style, opacity: c.terrainOpacity, look: c.look, lighting: c.lighting },
    spectrum: c.spectrum || spectrumSettings(),
    spectrumOpacity: c.spectrumOpacity,
    groundResOverride: c.groundRes
  };
}
function viewFor(c) {
  return { centerMerc: BASE_VIEW.centerMerc, zoom: BASE_VIEW.zoom, bearing: c.bearing, cssSize: [W, H], dpr: 1, dz: 0 };
}

async function renderGpu(page, grid, values) {
  const b64 = Buffer.from(grid.buffer, grid.byteOffset, grid.byteLength).toString("base64");
  const out = await page.evaluate(
    ([g, w, h, v]) => window.__render(g, w, h, v), [b64, W, H, values]);
  return new Uint8Array(Buffer.from(out, "base64"));
}

async function runBrowser(kind, launch) {
  const browser = await launch();
  const page = await browser.newPage();
  await page.setContent("<!doctype html><html><body></body></html>");
  const shaderPath = require("path").join(__dirname, "..", "..", "gpu-terrain-shaders.js");
  await page.addScriptTag({ path: shaderPath });
  await page.evaluate((prelude) => { window.__prelude = prelude; }, PRELUDE);
  const ready = await page.evaluate(pageSetup, [...shaders.SHADE_UNIFORMS]);
  if (ready !== "ready") throw new Error("page setup failed");

  const grid = fixtureGrid();
  const results = [];
  for (const c of buildCases(grid)) {
    const gpu = await renderGpu(page, c.grid, shaders.uniformValues(stateFor(c), viewFor(c)));
    const cpu = cpuComposite({
      style: c.style, lighting: c.lighting, look: c.look,
      terrainOpacity: c.terrainOpacity, spectrum: c.spectrum,
      spectrumOpacity: c.spectrumOpacity, grid: c.grid,
      groundRes: c.groundRes
    });
    const stats = compareBytes(gpu, cpu, 2);
    const row = { browser: kind, case: c.name, ...stats };
    if (c.contour) row.iou = lineIoU(gpu, cpu, 2);
    results.push(row);
  }

  /* No-override view case: ground resolution from view latitude/zoom. */
  {
    const lat = 47.858 * Math.PI / 180;
    const centerMerc = [(-118.33 + 180) / 360,
      (1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2];
    const view = { centerMerc, zoom: 16, bearing: 0, cssSize: [W, H], dpr: 1, dz: 0 };
    const state = stateFor(makeCase("view-mpp", {}));
    state.groundResOverride = 0;
    const gpu = await renderGpu(page, grid, shaders.uniformValues(state, view));
    const cpu = cpuComposite({
      style: "hs", lighting: LIGHTING, look: IDENTITY_LOOK, terrainOpacity: 1,
      spectrum: null, spectrumOpacity: 1, grid,
      groundRes: shaders.metersPerPixel(view)
    });
    results.push({ browser: kind, case: "hs-view-mpp-no-override", ...compareBytes(gpu, cpu, 2) });
  }

  /* Rotation: rotated field + bearing vs north-up render resampled alike. */
  const rotationGrid = smoothGrid();
  for (const style of ["aspect", "hs"]) {
    const northState = stateFor(makeCase(style, { style }));
    const north = await renderGpu(page, rotationGrid, shaders.uniformValues(northState, viewFor({ bearing: 0 })));
    for (const bearing of [37, 90, 180]) {
      const c = makeCase(style, { style, bearing });
      const gpu = await renderGpu(page, rotatedGrid(rotationGrid, bearing), shaders.uniformValues(stateFor(c), viewFor(c)));
      const expected = resampleBytes(north, bearing);
      results.push({ browser: kind, case: `${style}-bearing-${bearing}`, ...compareBytes(gpu, expected, 12) });
    }
    /* Exact rotation-plumbing check at 37 degrees against the discrete
     * JS simulation on the identical rotated field. */
    const c37 = makeCase(style, { style, bearing: 37 });
    const gpu37 = await renderGpu(page, rotatedGrid(rotationGrid, 37), shaders.uniformValues(stateFor(c37), viewFor(c37)));
    results.push({ browser: kind, case: `${style}-bearing-37-simulated`, ...compareBytes(gpu37, simulateRotated(style, rotatedGrid(rotationGrid, 37), 37), 12) });
  }

  await browser.close();
  return results;
}

(async () => {
  const which = process.argv[2] || "both";
  const all = [];
  if (which === "chrome" || which === "both") {
    const pw = require('../lib/playwright.js');
    all.push(...await runBrowser("chrome-metal", () =>
      pw.chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] })));
  }
  if (which === "webkit" || which === "both") {
    const pw = require('../lib/playwright.js');
    all.push(...await runBrowser("webkit", () => pw.webkit.launch()));
  }
  let failures = 0;
  for (const r of all) {
    const iouText = r.iou ? ` iouTol=${r.iou.iouTolerant.toFixed(4)} refMatched=${(100 * r.iou.refMatched).toFixed(2)}% gpuMatched=${(100 * r.iou.gpuMatched).toFixed(2)}%` : "";
    console.log(`${r.browser.padEnd(12)} ${r.case.padEnd(26)} max=${String(r.max).padStart(3)} >1/255=${r.pctOver1.toFixed(2).padStart(6)}% >3/255=${r.pctOver3.toFixed(3).padStart(6)}%${iouText}`);
    const isContour = r.case.includes("c1") || r.case.startsWith("style-c");
    if (r.case.includes("simulated")) { if (r.pctOver3 > 0.1) failures++; }
    else if (!isContour && r.case.indexOf("bearing") < 0 && r.pctOver3 > 0.1) failures++;
    if (isContour && r.iou && r.iou.iouTolerant < 0.97) failures++;
  }
  console.log(failures ? `PARITY: ${failures} case(s) outside target` : "PARITY: all cases within target");
  process.exit(failures ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(2); });
