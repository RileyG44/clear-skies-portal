#!/usr/bin/env node
'use strict';
/**
 * Isolated real-GPU engine checks. No server, app state, or downloaded data.
 * Usage: node scripts/gpu2d/engine-parity.js [--browser=chrome|webkit|both] [--frames=300]
 * The injected shade module intentionally exposes height/rank directly; production
 * style parity belongs to shader-parity.js. Tests here exercise the real engine.
 */
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const launchers = {
  chrome: () => require('../lib/playwright.js').chromium.launch({
    channel: 'chrome', headless: true,
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
  }),
  webkit: () => require('../lib/playwright.js').webkit.launch()
};
const argument = name => {
  const item = process.argv.slice(2).find(value => value.startsWith(`--${name}=`));
  return item ? item.slice(name.length + 3) : undefined;
};

async function browserSuite({ frames }) {
  const checks = [];
  const failures = [];
  const engines = [];
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function check(name, fn) {
    const started = performance.now();
    try { checks.push({ name, status: 'pass', ...(await fn()), milliseconds: +(performance.now() - started).toFixed(2) }); }
    catch (error) { failures.push({ name, message: error.message, stack: error.stack }); checks.push({ name, status: 'fail', message: error.message }); }
    finally { for (const item of engines.splice(0)) { item.engine.destroy(); item.canvas.remove(); } }
  }
  function source(id, rank, z) { return { id, rank, label: id, nativeZoom: () => z, allowed: () => true }; }
  function record(id, rank, z, x, y, width, height, formula) {
    const grid = new Float32Array(width * height);
    for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) grid[j * width + i] = formula(i, j);
    return { key: `${id}/${z}/${x}/${y}`, sourceId: id, rank, label: id, z, x, y, width, height, grid,
      sampleMeters: 2, surveys: [], revision: 1 };
  }
  class FakeStore {
    constructor(sources, records) {
      this._sources = sources; this.options = { sources: () => this._sources };
      this.records = new Map(records.map(item => [item.key, item])); this._tiles = this.records;
      this.listeners = new Map(); this.wanted = []; this.wantCalls = 0;
    }
    sources() { return this._sources; }
    get(key) { return this.records.get(key); }
    on(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(fn); return this; }
    off(name, fn) { this.listeners.get(name)?.delete(fn); return this; }
    emit(item) { this.records.set(item.key, item); for (const fn of this.listeners.get('tile') || []) fn(item); }
    want(tiles) { this.wanted = tiles; this.wantCalls++; }
    finestFor(id, tile) {
      return [...this.records.values()].filter(item => item.sourceId === id && item.z <= tile.z &&
        Math.floor(tile.x / 2 ** (tile.z - item.z)) === item.x && Math.floor(tile.y / 2 ** (tile.z - item.z)) === item.y)
        .sort((a, b) => b.z - a.z)[0];
    }
    settled(tiles) { return { complete: true, total: tiles.length, ratio: 1, refining: false }; }
    provenance() { return { ranks: {}, labels: [], surveys: [], sampleMeters: {} }; }
  }
  const shaders = {
    VERSION: 'test', SHADE_UNIFORMS: [],
    fullscreenVertexSource: '#version 300 es\nout vec2 v_screenUv;void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));v_screenUv=vec2(p.x,1.0-p.y);gl_Position=vec4(p*2.0-1.0,0.0,1.0);}',
    shadeFragmentSource: prelude => `#version 300 es
precision highp float;precision highp int;
in vec2 v_screenUv;out vec4 outColor;
${prelude}
void main(){ivec2 p=min(ivec2(v_screenUv*vec2(csp_size())),csp_size()-1);if(!csp_valid(p)){outColor=vec4(0.0);return;}outColor=vec4(clamp(csp_height(p)/2048.0,0.0,1.0),float(csp_rank(p))/5.0,0.2,1.0);}`,
    uniformValues: () => ({})
  };
  const baseView = { centerMerc: [7.5 / 16, 5.5 / 16], zoom: 4, bearing: 0, cssSize: [192, 144], dpr: 1, dz: 0 };
  const view = changes => ({ ...baseView, ...changes });
  const smooth = (x, y) => 500 + x * 2.7 + y * 1.35 + 24 * Math.sin(x * 0.31) * Math.cos(y * 0.27);
  function makeEngine(sources, records, maxTextureBytes = 64 * 1024 * 1024) {
    const canvas = document.createElement('canvas'); document.body.append(canvas);
    const store = new FakeStore(sources, records);
    const creationErrors = [];
    const engine = CSPGpuTerrainEngine.create({ canvas, store, shaders, sources: () => sources, maxTextureBytes, onNeedsFrame: () => {}, onError: error => creationErrors.push(error.message || String(error)) });
    assert(engine, `engine.create returned null on this GPU: ${creationErrors.join('; ')}`);
    const gl = canvas.getContext('webgl2'); assert(gl, 'engine canvas has no WebGL2 context');
    const item = { engine, canvas, store, gl }; engines.push(item);
    for (const tile of records) store.emit(tile);
    return item;
  }
  function settle(item, frameView, count = 16) {
    let result;
    for (let i = 0; i < count; i++) result = item.engine.render(frameView);
    item.gl.finish(); return result;
  }
  // Sample through the public CPU reference. A one-pixel crop is centered at the
  // projected GPU sample and has the actual native-pixel footprint, preserving
  // the reference's bilinear-versus-Catmull-Rom magnification decision.
  function expected(records, frameView, width, height) {
    const merged = new CSPTilePipeline.ProgressiveGrid(width * height);
    const worldSize = 256 * 2 ** frameView.zoom * frameView.dpr;
    const radians = frameView.bearing * Math.PI / 180, c = Math.cos(radians), s = Math.sin(radians);
    const ordered = records.slice().sort((a, b) => a.rank - b.rank || a.z - b.z || a.key.localeCompare(b.key));
    for (const tile of ordered) {
      const grid = new Float32Array(width * height); grid.fill(NaN);
      const levelSize = 2 ** tile.z, footprintX = tile.width * levelSize / worldSize, footprintY = tile.height * levelSize / worldSize;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const sx = x + 0.5 - width / 2, sy = y + 0.5 - height / 2;
        // Leaflet rotates the map clockwise: inverse-screen rotation recovers
        // east/south world coordinates before looking up the native pixel.
        const wx = frameView.centerMerc[0] + (c * sx + s * sy) / worldSize;
        const wy = frameView.centerMerc[1] + (-s * sx + c * sy) / worldSize;
        const u = wx * levelSize - tile.x, v = wy * levelSize - tile.y;
        if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
        grid[y * width + x] = ElevationTileCore.resampleElevation(tile.grid, tile.width, tile.height,
          { x: u * tile.width - footprintX / 2, y: v * tile.height - footprintY / 2, width: footprintX, height: footprintY }, 1, 1, { smooth: true })[0];
      }
      merged.accept(grid, tile.rank, true);
    }
    return merged;
  }
  function compareHeight(item, records, frameView, { tolerance = 1 / 256, ignoreBorder = 0 } = {}) {
    settle(item, frameView);
    assert(typeof item.engine.debugReadHeight === 'function', 'engine.debugReadHeight diagnostic is missing');
    const actual = item.engine.debugReadHeight();
    const width = Math.round(frameView.cssSize[0] * frameView.dpr), height = Math.round(frameView.cssSize[1] * frameView.dpr);
    assert(actual.width === width && actual.height === height, `height field ${actual.width}x${actual.height}; expected ${width}x${height}`);
    assert(actual.data.length === width * height * 2, 'debugReadHeight must return tightly packed RG floats');
    const cpu = expected(records, frameView, width, height);
    let maxError = 0, totalError = 0, valid = 0, mismatchedRank = 0, mismatchedHeight = 0, first;
    for (let y = ignoreBorder; y < height - ignoreBorder; y++) for (let x = ignoreBorder; x < width - ignoreBorder; x++) {
      const i = y * width + x, rank = Math.round(actual.data[i * 2 + 1]);
      if (rank !== cpu.ranks[i]) { mismatchedRank++; first ||= { x, y, gotRank: rank, wantRank: cpu.ranks[i], got: actual.data[i * 2], want: cpu.grid[i] }; continue; }
      if (!rank) continue;
      const error = Math.abs(actual.data[i * 2] - cpu.grid[i]);
      maxError = Math.max(maxError, error); totalError += error; valid++;
      if (!Number.isFinite(error) || error > tolerance) { mismatchedHeight++; first ||= { x, y, got: actual.data[i * 2], want: cpu.grid[i], error }; }
    }
    assert(!mismatchedRank && !mismatchedHeight, `CPU parity failed: ${mismatchedRank} rank and ${mismatchedHeight} height mismatches; max=${maxError}; first=${JSON.stringify(first)}`);
    return { topLeft: {actual: actual.data[0], expected: cpu.grid[0]}, pixels: width * height, valid, maxHeightErrorMetres: +maxError.toFixed(7), meanHeightErrorMetres: valid ? +(totalError / valid).toFixed(7) : 0, stats: item.engine.stats() };
  }
  const metaCanvas = document.createElement('canvas'), metaGl = metaCanvas.getContext('webgl2');
  assert(metaGl, 'WebGL2 unavailable');
  const debug = metaGl.getExtension('WEBGL_debug_renderer_info');
  const metadata = {
    userAgent: navigator.userAgent,
    renderer: debug ? metaGl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : metaGl.getParameter(metaGl.RENDERER),
    vendor: debug ? metaGl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : metaGl.getParameter(metaGl.VENDOR),
    version: metaGl.getParameter(metaGl.VERSION),
    floatTargets: Boolean(metaGl.getExtension('EXT_color_buffer_float')),
    gpuTimer: Boolean(metaGl.getExtension('EXT_disjoint_timer_query_webgl2'))
  };
  assert(!/swiftshader|llvmpipe|software rasterizer/i.test(metadata.renderer), `Software renderer rejected: ${metadata.renderer}`);
  metaGl.getExtension('WEBGL_lose_context')?.loseContext();

  for (const [name, frameView, nativeSize] of [
    ['integer-zoom-bicubic', view({ cssSize: [256, 256] }), 32],
    ['fractional-zoom-and-center', view({ zoom: 4.375, centerMerc: [7.63 / 16, 5.42 / 16] }), 32],
    ['deep-ancestor-zoom-offset', view({ zoom: 10.25, centerMerc: [7.481 / 16, 5.529 / 16] }), 32],
    ['hidpi-dz', view({ zoom: 4.25, cssSize: [120, 96], dpr: 2, dz: 1 }), 32],
    ['downsample-bilinear', view({ cssSize: [128, 128], zoom: 3.5 }), 512]
  ]) await check(name, () => {
    const tile = record('base', 1, 4, 7, 5, nativeSize, nativeSize, smooth);
    return compareHeight(makeEngine([source('base', 1, 4)], [tile]), [tile], frameView);
  });

  for (const [axis, formula] of [['x', (x, y) => 500 + x], ['y', (x, y) => 500 + y]]) await check(`downsample-coordinate-${axis}`, () => {
    const tile = record('base', 1, 4, 7, 5, 512, 512, formula);
    return compareHeight(makeEngine([source('base', 1, 4)], [tile]), [tile], view({ cssSize: [128, 128], zoom: 3.5 }), { tolerance: 1 / 256 });
  });

  await check('nonfinite-and-finite-sentinel-nodata', () => {
    const tile = record('base', 1, 4, 7, 5, 32, 32, (x, y) =>
      x < 8 ? NaN : x < 16 ? -1e30 : x < 24 ? Infinity : smooth(x, y));
    // The specification excludes finite sentinels in bilinear too; the legacy
    // bilinear helper accepts finite values, so sanitize its input explicitly.
    const reference = { ...tile, grid: tile.grid.map(value => Number.isFinite(value) && value > -1e20 ? value : NaN) };
    return compareHeight(makeEngine([source('base', 1, 4)], [tile]), [reference], view({ cssSize: [256, 256] }));
  });
  await check('zoom-28-native-level-22-cap', () => {
    const x = 1900000, y = 1600000, n = 2 ** 22;
    const tile = record('base', 1, 22, x, y, 32, 32, smooth);
    const frame = view({ zoom: 28.25, centerMerc: [(x + 0.5) / n, (y + 0.5) / n], dpr: 2, dz: 1, cssSize: [128, 96] });
    const item = makeEngine([source('base', 1, 22)], [tile]);
    const parity = compareHeight(item, [tile], frame);
    assert(item.store.wanted.every(tile => tile.z === 22), 'display level exceeded22');
    return parity;
  });
  await check('idle-and-uniform-only-draws', () => {
    const tile = record('base', 1, 4, 7, 5, 32, 32, smooth), item = makeEngine([source('base', 1, 4)], [tile]), frame = view();
    settle(item, frame);
    assert(item.engine.stats().drawCalls === 0, 'idle frame must not draw');
    const wanted = item.store.wantCalls, uploaded = item.engine.stats().uploads;
    item.engine.setState({ anySetting: 1 }); item.engine.render(frame);
    assert(item.engine.stats().drawCalls === 1, 'settings must redraw only shade pass');
    assert(item.store.wantCalls === wanted && item.engine.stats().uploads === uploaded, 'settings changed data demand or uploads');
    return { idleDrawCalls: 0, settingDrawCalls: item.engine.stats().drawCalls, extraWantCalls: item.store.wantCalls - wanted };
  });

  await check('partial-nodata-preserves-lower-rank', () => {
    const tiles = [record('base', 1, 3, 3, 2, 32, 32, smooth),
      record('raw', 3, 4, 7, 5, 32, 32, (x, y) => x < 15 || y > 24 ? NaN : smooth(x, y) + 160),
      record('dnr', 5, 5, 15, 11, 32, 32, (x, y) => x > 10 && x < 23 && y > 8 && y < 22 ? NaN : smooth(x, y) + 300)];
    return compareHeight(makeEngine([source('base', 1, 3), source('raw', 3, 4), source('dnr', 5, 5)], tiles), tiles, view({ cssSize: [256, 256] }));
  });
  await check('same-rank-finer-tile-holes-retain-ancestor', () => {
    const tiles = [record('raw', 3, 3, 3, 2, 32, 32, smooth),
      record('raw', 3, 4, 7, 5, 32, 32, (x, y) => x > 10 && x < 21 && y > 10 && y < 21 ? NaN : smooth(x, y) + 200)];
    return compareHeight(makeEngine([source('raw', 3, 4)], tiles), tiles, view({ cssSize: [256, 256] }));
  });
  await check('no-data-is-transparent-rank-zero', () => {
    const tiles = [record('base', 1, 4, 7, 5, 32, 32, (x, y) => x < 17 ? NaN : smooth(x, y))];
    const item = makeEngine([source('base', 1, 4)], tiles);
    const result = compareHeight(item, tiles, view({ cssSize: [256, 256] }));
    const rgba = new Uint8Array(item.canvas.width * item.canvas.height * 4);
    item.gl.bindFramebuffer(item.gl.FRAMEBUFFER, null);
    item.gl.readPixels(0, 0, item.canvas.width, item.canvas.height, item.gl.RGBA, item.gl.UNSIGNED_BYTE, rgba);
    const transparent = rgba.filter((_, i) => i % 4 === 3 && rgba[i] === 0).length;
    assert(transparent > 20000 && transparent < 45000, `unexpected transparent pixels: ${transparent}`);
    return { ...result, transparent };
  });
  for (const bearing of [0, 37, 90, 180]) await check(`rotation-${bearing}`, () => {
    const tiles = [record('base', 1, 3, 3, 2, 64, 64, smooth)];
    return compareHeight(makeEngine([source('base', 1, 3)], tiles), tiles, view({ bearing }));
  });
  await check('async-provenance-counts-rendered-ranks', async () => {
    const tiles = [record('base', 1, 4, 7, 5, 32, 32, smooth), record('dnr', 5, 5, 15, 11, 32, 32, smooth)];
    const frameView = view({ cssSize: [256, 256] }), item = makeEngine([source('base', 1, 4), source('dnr', 5, 5)], tiles);
    settle(item, frameView);
    const cpu = expected(tiles, frameView, 256, 256), counts = {};
    for (const rank of cpu.ranks) if (rank) counts[rank] = (counts[rank] || 0) + 1;
    const started = performance.now(), pending = item.engine.readProvenance(frameView), syncMs = performance.now() - started;
    assert(pending && typeof pending.then === 'function', 'readProvenance must return a promise');
    const actual = await Promise.race([pending, sleep(5000).then(() => { throw new Error('provenance read timed out'); })]);
    for (const [rank, count] of Object.entries(counts)) assert(actual.ranks[rank] === count, `provenance rank ${rank}: ${actual.ranks[rank]} instead of ${count}`);
    assert(!actual.ranks[2] && !actual.ranks[3], 'provenance contains absent ranks');
    return { counts, syncSubmissionMs: +syncMs.toFixed(4), actual };
  });
  await check('forced-tiled-export-seams', async () => {
    const tiles = [record('base', 1, 3, 3, 2, 64, 64, smooth)];
    const item = makeEngine([source('base', 1, 3)], tiles), frameView = view({ cssSize: [185, 131], bearing: 37 });
    settle(item, frameView);
    assert(typeof item.engine.debugLimits === 'function', 'engine.debugLimits diagnostic is missing');
    const results = [];
    for (const scale of [1, 2, 4]) {
      const width = 185 * scale, height = 131 * scale;
      item.engine.debugLimits({ maxTargetSize: 8192 });
      const reference = await item.engine.renderToCanvas(frameView, width, height);
      const referencePixels = reference.getContext('2d').getImageData(0, 0, width, height).data;
      item.engine.debugLimits({ maxTargetSize: 64 });
      const tiled = await item.engine.renderToCanvas(frameView, width, height);
      const tiledPixels = tiled.getContext('2d').getImageData(0, 0, width, height).data;
      let maxError = 0, mismatch = 0, seamMismatch = 0;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let channel = 0; channel < 4; channel++) {
        const i = (y * width + x) * 4 + channel, difference = Math.abs(referencePixels[i] - tiledPixels[i]);
        maxError = Math.max(maxError, difference);
        if (difference > 1) { mismatch++; if (x % 64 < 2 || y % 64 < 2) seamMismatch++; }
      }
      assert(!mismatch, `export ${scale}x differs: ${mismatch} channels (${seamMismatch} at seams), max=${maxError}`);
      results.push({ scale, width, height, maxByteError: maxError, mismatchedChannels: mismatch, seamMismatchedChannels: seamMismatch });
    }
    item.engine.debugLimits({ maxTargetSize: 8192 });
    return { exports: results };
  });
  await check('context-loss-and-restore', async () => {
    const tiles = [record('base', 1, 4, 7, 5, 32, 32, smooth)];
    const item = makeEngine([source('base', 1, 4)], tiles), frameView = view();
    compareHeight(item, tiles, frameView);
    const extension = item.gl.getExtension('WEBGL_lose_context'); assert(extension, 'WEBGL_lose_context unavailable');
    extension.loseContext();
    for (let i = 0; i < 20 && !item.gl.isContextLost(); i++) await sleep(5);
    assert(item.gl.isContextLost(), 'context did not enter lost state');
    await sleep(40);
    assert(item.engine.ready === false || item.engine.stats().ready === false, 'engine must expose ready=false while context is lost');
    const started = performance.now(); extension.restoreContext();
    let restored = false;
    while (performance.now() - started < 1000) {
      await sleep(10);
      if (!item.gl.isContextLost() && (item.engine.ready || item.engine.stats().ready)) { restored = true; break; }
    }
    const restoreMs = performance.now() - started;
    assert(restored, `context failed to restore within 1 second (${restoreMs}ms)`);
    return { ...compareHeight(item, tiles, frameView), restoreMs: +restoreMs.toFixed(2) };
  });
  await check('resident-texture-budget-and-eviction', () => {
    const tiles = [];
    for (let y = 4; y < 8; y++) for (let x = 6; x < 10; x++) tiles.push(record('base', 1, 4, x, y, 128, 128, smooth));
    const budget = 5 * 128 * 128 * 4, item = makeEngine([source('base', 1, 4)], tiles, budget);
    settle(item, view({ cssSize: [320, 240] }), 48);
    const stats = item.engine.stats();
    assert(stats.textureBytes <= budget, `texture budget exceeded: ${stats.textureBytes} > ${budget}`);
    assert(stats.textures > 0, 'no resident textures after uploads');
    return { budgetBytes: budget, stats };
  });
  await check('benchmark-300-changing-pan-frames', async () => {
    const tiles = [];
    for (let y = 46; y < 51; y++) for (let x = 60; x < 68; x++) tiles.push(record('base', 1, 7, x, y, 256, 256, smooth));
    const item = makeEngine([source('base', 1, 7)], tiles), frameView = view({ zoom: 7, centerMerc: [64 / 128, 48.5 / 128], cssSize: [1024, 720] });
    settle(item, frameView, 32);
    const initial = item.engine.stats(), extension = item.gl.getExtension('EXT_disjoint_timer_query_webgl2'), queries = [], cpu = [], coverages = [];
    for (let i = 0; i < frames; i++) {
      const moving = { ...frameView, centerMerc: [(64 + 0.38 * Math.sin(i * 0.041)) / 128, (48.5 + 0.22 * Math.cos(i * 0.037)) / 128] };
      const query = extension ? item.gl.createQuery() : null;
      if (query) item.gl.beginQuery(extension.TIME_ELAPSED_EXT, query);
      const start = performance.now(), rendered = item.engine.render(moving); cpu.push(performance.now() - start);
      if (query) { item.gl.endQuery(extension.TIME_ELAPSED_EXT); queries.push(query); }
      coverages.push(rendered.coverage);
      // Yield only between batches. CPU timing excludes this, upload warmup,
      // readback, getError/finish, and query-result polling.
      if (i % 30 === 29) await sleep(0);
    }
    item.gl.finish();
    const gpu = [], timerDisjoint = extension ? Boolean(item.gl.getParameter(extension.GPU_DISJOINT_EXT)) : null;
    if (extension && !timerDisjoint) {
      const deadline = performance.now() + 5000;
      while (queries.some(query => !item.gl.getQueryParameter(query, item.gl.QUERY_RESULT_AVAILABLE)) && performance.now() < deadline) await sleep(10);
      for (const query of queries) {
        if (item.gl.getQueryParameter(query, item.gl.QUERY_RESULT_AVAILABLE)) gpu.push(item.gl.getQueryParameter(query, item.gl.QUERY_RESULT) / 1e6);
        item.gl.deleteQuery(query);
      }
    } else for (const query of queries) item.gl.deleteQuery(query);
    const summarize = values => {
      if (!values.length) return null;
      const sorted = values.slice().sort((a, b) => a - b);
      return { samples: values.length, meanMs: +(values.reduce((a, b) => a + b, 0) / values.length).toFixed(4), p95Ms: +sorted[Math.ceil(sorted.length * 0.95) - 1].toFixed(4), maxMs: +sorted[sorted.length - 1].toFixed(4) };
    };
    const stats = item.engine.stats();
    assert(stats.textureBytes <= 64 * 1024 * 1024, 'benchmark exceeded texture budget');
    assert(stats.textures >= 20 && stats.textures <= 40, `benchmark residency ${stats.textures} is outside expected 20–40 native tiles`);
    assert(coverages.every(value => value >= 0.98), `benchmark coverage fell below 98%: ${Math.min(...coverages)}`);
    assert(item.gl.getError() === item.gl.NO_ERROR, 'WebGL error after benchmark');
    return { frames, suppliedResidentTiles: tiles.length, initialStats: initial, finalStats: stats, cpuSubmission: summarize(cpu), gpuExecution: summarize(gpu), gpuTimerAvailable: Boolean(extension), gpuTimerDisjoint: timerDisjoint, minCoverage: Math.min(...coverages) };
  });
  return { status: failures.length ? 'fail' : 'pass', metadata, checks, failures };
}

(async () => {
  const browserOption = argument('browser') || 'both';
  const names = browserOption === 'both' ? ['chrome', 'webkit'] : [browserOption];
  const frames = Number(argument('frames') || 300);
  if (names.some(name => !launchers[name])) throw new Error('Use --browser=chrome|webkit|both');
  if (!Number.isInteger(frames) || frames < 1) throw new Error('--frames must be a positive integer');
  const output = { harness: 'gpu2d-engine-parity', timestamp: new Date().toISOString(), browsers: {} };
  for (const name of names) {
    let browser;
    try {
      browser = await launchers[name]();
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.setContent('<!doctype html><meta charset="utf-8"><title>GPU engine isolated verification</title><body style="margin:0"></body>');
      for (const module of ['elevation-tile-core.js', 'tile-pipeline.js', 'gpu-terrain-engine.js']) await page.addScriptTag({ path: path.join(root, module) });
      output.browsers[name] = await page.evaluate(browserSuite, { frames });
      output.browsers[name].pageErrors = errors;
      if (errors.length) output.browsers[name].status = 'fail';
    } catch (error) { output.browsers[name] = { status: 'fail', error: error.stack || String(error) }; }
    finally { if (browser) await browser.close(); }
  }
  output.status = Object.values(output.browsers).every(result => result.status === 'pass') ? 'pass' : 'fail';
  console.log(JSON.stringify(output, null, 2));
  if (output.status !== 'pass') process.exitCode = 1;
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
