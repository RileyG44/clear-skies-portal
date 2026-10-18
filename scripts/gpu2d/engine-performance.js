#!/usr/bin/env node
'use strict';
/**
 * Isolated real-GPU engine performance; one changed view per animation frame.
 * node scripts/gpu2d/engine-performance.js [--browser=chrome|webkit|both]
 *   [--frames=300] [--comparison=1] [--output=/tmp/gpu2d-engine-performance.json]
 * Measures the engine using a deliberately minimal VERSION:'test' shade double,
 * not the production terrain style. No readPixels/finish occurs in timed paths.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const launchers = {
  chrome: () => require('/Users/riley/.npm/_npx/31e32ef8478fbf80/node_modules/playwright').chromium.launch({
    channel: 'chrome', headless: true,
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
  }),
  webkit: () => require('/Users/riley/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core').webkit.launch()
};
const argument = name => {
  const item = process.argv.slice(2).find(value => value.startsWith(`--${name}=`));
  return item ? item.slice(name.length + 3) : undefined;
};

async function browserBenchmark({ frames, cssSize, dpr }) {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const summarize = values => {
    if (!values.length) return null;
    const sorted = values.slice().sort((a, b) => a - b);
    return { samples: values.length, meanMs: +(values.reduce((a, b) => a + b, 0) / values.length).toFixed(4),
      p95Ms: +sorted[Math.ceil(sorted.length * 0.95) - 1].toFixed(4), maxMs: +sorted[sorted.length - 1].toFixed(4) };
  };
  const heap = () => performance.memory ? {
    usedJSHeapSize: performance.memory.usedJSHeapSize,
    totalJSHeapSize: performance.memory.totalJSHeapSize,
    jsHeapSizeLimit: performance.memory.jsHeapSizeLimit
  } : null;
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
      let best;
      for (const item of this.records.values()) if (item.sourceId === id && item.z <= tile.z &&
        Math.floor(tile.x / 2 ** (tile.z - item.z)) === item.x && Math.floor(tile.y / 2 ** (tile.z - item.z)) === item.y &&
        (!best || item.z > best.z)) best = item;
      return best;
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
  const tiles = [];
  for (let y = 46; y < 51; y++) for (let x = 60; x < 68; x++) {
    const width = 256, height = 256, grid = new Float32Array(width * height);
    for (let j = 0; j < height; j++) for (let i = 0; i < width; i++)
      grid[j * width + i] = 500 + i * 2.7 + j * 1.35 + 24 * Math.sin(i * 0.31) * Math.cos(j * 0.27);
    tiles.push({ key: `base/7/${x}/${y}`, sourceId: 'base', rank: 1, label: 'base', z: 7, x, y,
      width, height, grid, sampleMeters: 2, surveys: [], revision: 1 });
  }
  const sources = [{ id: 'base', rank: 1, label: 'base', nativeZoom: () => 7, allowed: () => true }];
  const canvas = document.createElement('canvas');
  canvas.style.width = `${cssSize[0]}px`; canvas.style.height = `${cssSize[1]}px`;
  document.body.append(canvas);
  const store = new FakeStore(sources, tiles), errors = [];
  const engine = CSPGpuTerrainEngine.create({ canvas, store, shaders, sources: () => sources,
    maxTextureBytes: 64 * 1024 * 1024, onNeedsFrame: () => {}, onError: error => errors.push(error.message || String(error)) });
  assert(engine, `engine.create returned null: ${errors.join('; ')}`);
  const gl = canvas.getContext('webgl2'); assert(gl, 'WebGL2 context unavailable');
  function rendererInfo() {
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const metadata = {
      renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      version: gl.getParameter(gl.VERSION), floatTargets: Boolean(gl.getExtension('EXT_color_buffer_float')),
      contextLost: gl.isContextLost()
    };
    assert(!metadata.contextLost, 'GPU context lost');
    assert(!/swiftshader|llvmpipe|software rasterizer|softpipe/i.test(metadata.renderer), `Software renderer rejected: ${metadata.renderer}`);
    return metadata;
  }
  const rendererBefore = rendererInfo();
  assert(devicePixelRatio === dpr, `Browser devicePixelRatio ${devicePixelRatio} differs from requested ${dpr}`);
  const extension = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const frameView = { centerMerc: [64 / 128, 48.5 / 128], zoom: 7, bearing: 0, cssSize, dpr, dz: dpr >= 1.5 ? 1 : 0 };
  const moving = i => ({ ...frameView,
    centerMerc: [(64 + 0.38 * Math.sin(i * 0.041)) / 128, (48.5 + 0.22 * Math.cos(i * 0.037)) / 128] });
  let observer;
  const longTasks = [];
  const longTaskSupported = typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('longtask');
  if (longTaskSupported) {
    observer = new PerformanceObserver(list => { for (const entry of list.getEntries()) longTasks.push({ startTime: entry.startTime, duration: entry.duration }); });
    observer.observe({ type: 'longtask', buffered: false });
  }
  const pending = [], gpu = [], cpu = [], intervals = [], coverages = [];
  let disjoint = false;
  function pollQueries() {
    if (!extension) return;
    disjoint ||= Boolean(gl.getParameter(extension.GPU_DISJOINT_EXT));
    while (pending.length && gl.getQueryParameter(pending[0].query, gl.QUERY_RESULT_AVAILABLE)) {
      const { query, frame } = pending.shift();
      if (!disjoint) gpu.push({ frame, milliseconds: gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6 });
      gl.deleteQuery(query);
    }
  }
  try {
    for (const tile of tiles) store.emit(tile);
    // Warm uploads, pipeline compilation, and compositor scheduling, paced by rAF.
    for (let i = 0; i < 60; i++) { await nextFrame(); engine.render(moving(i)); }
    const initialStats = engine.stats();
    assert(initialStats.textures === 40, `expected 40 native resident tiles, got ${initialStats.textures}`);
    assert(canvas.width === Math.round(cssSize[0] * dpr) && canvas.height === Math.round(cssSize[1] * dpr), 'physical render dimensions differ from requested view');
    const stressBefore = { stats: engine.stats(), heap: heap() };
    let stressMinCoverage = 1;
    for (let i = 0; i < 100; i++) { await nextFrame(); stressMinCoverage = Math.min(stressMinCoverage, engine.render(moving(i + 60)).coverage); }
    const stressAfter = { stats: engine.stats(), heap: heap() };
    // Every timed render is submitted in a different animation frame. Queries
    // are polled before the CPU timer and never block on unavailable results.
    let previousTimestamp = await nextFrame();
    const timedStart = performance.now();
    for (let i = 0; i < frames; i++) {
      const timestamp = await nextFrame(); intervals.push(timestamp - previousTimestamp); previousTimestamp = timestamp;
      pollQueries();
      const query = extension ? gl.createQuery() : null;
      if (query) gl.beginQuery(extension.TIME_ELAPSED_EXT, query);
      const start = performance.now(), rendered = engine.render(moving(i + 160));
      cpu.push(performance.now() - start);
      if (query) { gl.endQuery(extension.TIME_ELAPSED_EXT); pending.push({ query, frame: i }); }
      coverages.push(rendered.coverage);
    }
    const timedEnd = performance.now();
    const finalStats = engine.stats();
    const deadline = performance.now() + 5000;
    while (pending.length && performance.now() < deadline) { await nextFrame(); pollQueries(); }
    await pause(25); // Deliver deferred PerformanceObserver records after timing.
    if (observer) for (const entry of observer.takeRecords()) longTasks.push({ startTime: entry.startTime, duration: entry.duration });
    const measuredLongTasks = longTasks.filter(entry => entry.startTime < timedEnd && entry.startTime + entry.duration > timedStart);
    const rendererAfter = rendererInfo();
    assert(!errors.length, `engine errors: ${errors.join('; ')}`);
    assert(gl.getError() === gl.NO_ERROR, 'WebGL error after benchmark');
    assert(finalStats.textures === 40, `residency changed from 40 to ${finalStats.textures}`);
    assert(finalStats.textureBytes <= 64 * 1024 * 1024, 'native texture budget exceeded');
    assert(Math.min(...coverages) >= 0.98, `coverage below 98%: ${Math.min(...coverages)}`);
    const gpuValues = disjoint ? [] : gpu.map(sample => sample.milliseconds);
    return { status: 'pass', userAgent: navigator.userAgent, actualDevicePixelRatio: devicePixelRatio,
      rendererBefore, rendererAfter, cssSize, physicalSize: [canvas.width, canvas.height], dpr, displayZoom: 7,
      requestedTileZoom: dpr >= 1.5 ? 8 : 7, nativeZoom: 7, nativeSize: [256, 256], nativeGrid: [8, 5],
      suppliedResidentTiles: tiles.length, shadeModule: "VERSION:'test' minimal height/rank shade double",
      frames, warmupFrames: 60, pacedBy: 'requestAnimationFrame', elapsedMs: +(timedEnd - timedStart).toFixed(2),
      cpuSubmission: summarize(cpu), gpuExecution: summarize(gpuValues), rafInterval: summarize(intervals),
      gpuTimerAvailable: Boolean(extension), gpuTimerDisjoint: extension ? disjoint : null,
      gpuQueriesPending: pending.length, gpuQueriesCompleted: gpu.length,
      longTasks: { supported: Boolean(longTaskSupported), count: longTaskSupported ? measuredLongTasks.length : null,
        maxMs: !longTaskSupported ? null : measuredLongTasks.length ? Math.max(...measuredLongTasks.map(entry => entry.duration)) : 0, entries: measuredLongTasks },
      minCoverage: Math.min(...coverages), initialStats, finalStats,
      panStress100Moves: { before: stressBefore, after: stressAfter, minCoverage: stressMinCoverage,
        nativeTextureBytesDelta: stressAfter.stats.textureBytes - stressBefore.stats.textureBytes,
        usedJSHeapBytesDelta: stressBefore.heap && stressAfter.heap ? stressAfter.heap.usedJSHeapSize - stressBefore.heap.usedJSHeapSize : null,
        heapCaveat: 'performance.memory is browser-specific and may be coarse; no forced GC or claim of leak absence' },
      cpuTimingScope: 'synchronous engine.render() submission only; GPU/query polling and compositor work excluded', pageErrors: [], errors };
  } finally {
    observer?.disconnect();
    for (const { query } of pending) gl.deleteQuery(query);
    engine.destroy(); canvas.remove();
  }
}

(async () => {
  const browserOption = argument('browser') || 'both';
  const names = browserOption === 'both' ? ['chrome', 'webkit'] : [browserOption];
  const frames = Number(argument('frames') || 300);
  const outputPath = argument('output') || '/tmp/gpu2d-engine-performance.json';
  if (names.some(name => !launchers[name])) throw new Error('Use --browser=chrome|webkit|both');
  if (!Number.isInteger(frames) || frames < 1) throw new Error('--frames must be a positive integer');
  const configs = [{ key: '1440x900@2', cssSize: [1440, 900], dpr: 2 }];
  if (argument('comparison') === '1') configs.push({ key: '1024x720@1', cssSize: [1024, 720], dpr: 1 });
  const engineSource = fs.readFileSync(path.join(root, 'gpu-terrain-engine.js'), 'utf8');
  const output = { harness: 'gpu2d-engine-performance', timestamp: new Date().toISOString(),
    engineSha256: crypto.createHash('sha256').update(engineSource).digest('hex'),
    scope: 'isolated engine; deterministic in-memory native tiles and minimal shade double; not full-app style or network performance',
    statusMeaning: 'pass means valid measurement, expected real GPU/residency/coverage, and no engine errors; speed targets are not asserted', browsers: {} };
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n');
  for (const name of names) {
    let browser;
    output.browsers[name] = {};
    try {
      browser = await launchers[name]();
      for (const config of configs) {
        const context = await browser.newContext({ viewport: { width: config.cssSize[0], height: config.cssSize[1] }, deviceScaleFactor: config.dpr });
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        try {
          await page.setContent('<!doctype html><meta charset="utf-8"><title>GPU2D paced performance</title><body style="margin:0;overflow:hidden"></body>');
          for (const module of ['elevation-tile-core.js', 'tile-pipeline.js']) await page.addScriptTag({ path: path.join(root, module) });
          // Freeze one engine revision for every browser/config in this run.
          await page.addScriptTag({ content: engineSource });
          let timeout;
          const limitMs = Math.max(30000, (frames + 160) * 100);
          let result;
          try {
            result = await Promise.race([page.evaluate(browserBenchmark, { frames, ...config }),
              new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(`Benchmark exceeded ${limitMs} ms`)), limitMs); })]);
          } finally { clearTimeout(timeout); }
          result.pageErrors = errors;
          if (errors.length) result.status = 'fail';
          output.browsers[name][config.key] = result;
        } catch (error) { output.browsers[name][config.key] = { status: 'fail', error: error.stack || String(error), pageErrors: errors }; }
        finally { await context.close(); }
        fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n');
      }
    } catch (error) { output.browsers[name].launchError = { status: 'fail', error: error.stack || String(error) }; }
    finally { if (browser) await browser.close(); }
  }
  output.completedAt = new Date().toISOString();
  output.status = Object.values(output.browsers).every(results => Object.values(results).every(result => result.status === 'pass')) ? 'pass' : 'fail';
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify(output, null, 2));
  if (output.status !== 'pass') process.exitCode = 1;
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
