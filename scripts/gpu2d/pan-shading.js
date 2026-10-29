#!/usr/bin/env node
'use strict';
/**
 * "Smoother panning" (CR-008) on the real GPU with the production shaders.
 * node scripts/gpu2d/pan-shading.js [--browser=chrome|webkit|both] [--base=main]
 *
 * The unmodified engine from --base (git) and this checkout's engine run one
 * drag-and-settle sequence over a synthetic relative-elevation valley, with a
 * finer tile arriving mid-drag:
 * - Off: every WebGL call (names, arguments, object identities) and every
 *   frame's pixels equal the base engine's. No extra target is allocated.
 * - On: drag frames use the CSS grid; the wanted tiles, store requests and
 *   coverage equal Off's, and the first settled frame's pixels, height field
 *   and analysis samples equal Off's exactly. Its targets are freed there.
 * Also reports drag-frame GPU time, the iPhone-size target bytes and which
 * derived fields fall under one CSS pixel. No server, data or app state.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
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

async function suite() {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const lat = 61.2, Z = 14, n = 2 ** Z;
  const cy = 0.5 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / (2 * Math.PI);
  const center = [0.1 + 0.37 / n, cy], mPerMerc = 40075016 * Math.cos(lat * Math.PI / 180);
  const height = (mx, my) => {
    const u = (mx - center[0]) * mPerMerc, v = (my - center[1]) * mPerMerc, d = u - 160 * Math.sin(v / 310) - 40 * Math.sin(v / 77);
    return 300 - 0.03 * v + 0.01 * u + 45 * (1 - Math.exp(-d * d / (2 * 260 * 260))) - 2.5 * Math.exp(-d * d / (2 * 14 * 14)) +
      1.2 * Math.sin(u / 23) * Math.cos(v / 31) + 4 * Math.sin(u / 9) * Math.cos(v / 13) + 1.5 * Math.sin((u + 2 * v) / 5) + 0.02 * u;
  };
  const tile = (id, rank, z, x, y) => {
    const m = 2 ** z, grid = new Float32Array(256 * 256);
    for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) grid[j * 256 + i] = height((x + (i + .5) / 256) / m, (y + (j + .5) / 256) / m) + (rank - 1) * 0.25;
    return { key: `${id}/${z}/${x}/${y}`, sourceId: id, rank, label: id, z, x, y, width: 256, height: 256, grid, sampleMeters: 1, surveys: [], revision: 1 };
  };
  const specs = [{ id: 'base', rank: 1, label: 'base', nativeZoom: () => Z, allowed: () => true },
    { id: 'fine', rank: 2, label: 'fine', nativeZoom: () => Z + 1, allowed: () => true }];
  const tx = Math.floor(center[0] * n), ty = Math.floor(center[1] * n), records = [];
  for (let y = ty - 3; y <= ty + 3; y++) for (let x = tx - 3; x <= tx + 3; x++) records.push(tile('base', 1, Z, x, y));
  const late = tile('fine', 2, Z + 1, Math.floor(center[0] * n * 2), Math.floor(center[1] * n * 2));
  class FakeStore {
    constructor() { this.options = { sources: () => specs }; this.records = new Map(); this.listeners = new Set(); this.wants = []; }
    sources() { return specs; } get(k) { return this.records.get(k); }
    on(_, fn) { this.listeners.add(fn); return this; } off(_, fn) { this.listeners.delete(fn); return this; }
    emit(r) { this.records.set(r.key, r); this.listeners.forEach(fn => fn(r)); }
    want(tiles, options) { this.wants.push(JSON.stringify([tiles.map(t => `${t.z}/${t.x}/${t.y}`), options && options.generation, options && options.bounds])); }
    settled(t) { return { complete: true, total: t.length, ratio: 1 }; } provenance() { return {}; }
    finestFor(id, t) { return [...this.records.values()].filter(r => r.sourceId === id && r.z <= t.z && Math.floor(t.x / 2 ** (t.z - r.z)) === r.x && Math.floor(t.y / 2 ** (t.z - r.z)) === r.y).sort((a, b) => b.z - a.z)[0]; }
  }
  const state = detailRadius => ({
    terrain: { style: 'hs', opacity: 1, look: { contrast: 100, saturation: 100, brightness: 100 }, lighting: { azimuth: 315, altitude: 45, ambient: .12 },
      stack: { layers: [{ style: 'rem', opacity: 1, blend: 'normal', stops: [[0, .14, .12, .78, 1], [.35, .55, .15, .85, 1], [.7, 1, .45, .12, 1], [1, 1, .95, .7, 1]], min: 0, max: 40, gamma: 1 }],
        detail: .3, detailRadius, reliefExag: 1.6, remRadius: 200 } },
    spectrum: { spectrumOn: false }, spectrumOpacity: 1 });
  // A WebGL2 context whose every call is recorded. Objects are named by first
  // appearance; large arrays by length and a sparse checksum.
  function traced(canvas) {
    const log = [], ids = new WeakMap(); let next = 0, on = true;
    const name = value => {
      if (value === null || value === undefined || typeof value !== 'object') return value;
      if (ArrayBuffer.isView(value)) {
        if (value.length <= 64) return Array.from(value).join(',');
        let sum = 0; for (let i = 0; i < value.length; i += 97) sum += Number(value[i]) || 0;
        return `${value.constructor.name}:${value.length}:${sum}`;
      }
      if (Array.isArray(value)) return value.map(name).join(',');
      if (!ids.has(value)) ids.set(value, `#${next++}`); return ids.get(value);
    };
    const real = HTMLCanvasElement.prototype.getContext;
    canvas.getContext = function (kind, attributes) {
      const gl = real.call(this, kind, attributes); if (!gl) return gl;
      return new Proxy(gl, { get(target, key) {
        const value = target[key];
        if (typeof value !== 'function') return value;
        return function (...args) { const out = value.apply(target, args); if (on) log.push(`${String(key)}(${args.map(name).join(';')})=${name(out)}`); return out; };
      } });
    };
    return { log, pause: () => { on = false; }, resume: () => { on = true; } };
  }
  function make(Engine, css, detailRadius) {
    const canvas = document.createElement('canvas'); document.body.append(canvas);
    const trace = traced(canvas), store = new FakeStore(), errors = [];
    const engine = Engine.create({ canvas, store, shaders: CSPGpuTerrainShaders, onNeedsFrame: () => {}, onError: e => errors.push(String(e)) });
    assert(engine, 'engine unavailable: ' + errors.join('; '));
    engine.setState(state(detailRadius));
    for (const r of records) store.emit(r);
    trace.pause(); const gl = canvas.getContext('webgl2'); trace.resume();
    return { engine, canvas, store, trace, gl: HTMLCanvasElement.prototype.getContext.call(canvas, 'webgl2') || gl };
  }
  function pixels(item) {
    item.trace.pause();
    const gl = item.gl, out = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, out);
    item.trace.resume(); return out;
  }
  const differing = (a, b) => { let k = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) k++; return k; };
  const live = { centerMerc: center, zoom: 14.3, bearing: 12, cssSize: [201, 437], dpr: 3, dz: 1 };
  const at = i => ({ ...live, centerMerc: [center[0] + i * 3 / (256 * 2 ** live.zoom), center[1] - i * 1.5 / (256 * 2 ** live.zoom)] });
  // settle, 24 drag frames (a finer tile arrives at frame 10), settle.
  const sequence = [];
  for (let i = 0; i < 6; i++) sequence.push({ view: at(0), drag: false });
  for (let i = 1; i <= 24; i++) sequence.push({ view: at(i), drag: true, arrive: i === 10 });
  for (let i = 0; i < 6; i++) sequence.push({ view: at(24), drag: false });
  // Upload batching follows a time budget. A clock that advances a fixed
  // step per reading makes each run's batching, and so its trace, repeatable.
  const realNow = performance.now.bind(performance);
  function run(Engine, coarseDrag, detailRadius = 6) {
    let clock = 0; performance.now = () => (clock += 0.05);
    try { return runOnce(Engine, coarseDrag, detailRadius); } finally { performance.now = realNow; }
  }
  function runOnce(Engine, coarseDrag, detailRadius) {
    const item = make(Engine, live.cssSize, detailRadius), frames = [], coverage = [];
    for (const step of sequence) {
      if (step.arrive) item.store.emit(late);
      const result = item.engine.render(step.view, coarseDrag && step.drag ? { coarse: true } : undefined);
      coverage.push(JSON.stringify(result)); frames.push(pixels(item));
    }
    item.trace.pause();
    const out = { frames, coverage, wants: item.store.wants, log: item.trace.log, stats: item.engine.stats(),
      field: item.engine.debugReadHeight(), samples: item.engine.sampleValues() };
    item.engine.destroy(); item.canvas.remove(); return out;
  }
  const results = {};
  // Off is the unmodified engine, call for call and pixel for pixel.
  // The page's first engine can differ by one level in a few bytes (shader
  // warm-up in the browser's GPU backend); discard it. A second base run is
  // the control: base against base must be exact for Off's equality to count.
  run(window.CSPBaseEngine, false);
  const base = run(window.CSPBaseEngine, false), off = run(CSPGpuTerrainEngine, false), control = run(window.CSPBaseEngine, false);
  assert(base.log.length > 1000, `trace too short: ${base.log.length}`);
  base.frames.forEach((frame, i) => assert(!differing(frame, control.frames[i]), `control: base frame ${i} not repeatable`));
  assert(base.log.join('\n') === control.log.join('\n'), 'control: base trace not repeatable');
  const firstCall = base.log.findIndex((call, i) => call !== off.log[i]);
  assert(base.log.length === off.log.length && firstCall === -1,
    `Off WebGL trace differs at call ${firstCall}: base ${base.log[firstCall]} / off ${off.log[firstCall]}`);
  base.frames.forEach((frame, i) => assert(!differing(frame, off.frames[i]), `Off frame ${i} differs from the base engine`));
  assert(off.stats.gestureBytes === 0 && off.stats.gesturePeakBytes === 0, 'Off allocated drag targets');
  results.off = { webglCalls: off.log.length, frames: off.frames.length, identicalToBase: true };
  // On: drag frames differ, everything else is Off's.
  const on = run(CSPGpuTerrainEngine, true);
  assert(JSON.stringify(on.wants) === JSON.stringify(off.wants), 'On changed the wanted tiles or store requests');
  assert(JSON.stringify(on.coverage) === JSON.stringify(off.coverage), 'On changed the coverage results');
  const settled = sequence.length - 6, dragDiffs = [];
  for (let i = 0; i < sequence.length; i++) {
    const k = differing(on.frames[i], off.frames[i]);
    if (sequence[i].drag) dragDiffs.push(k / on.frames[i].length);
    else assert(!k, `On frame ${i} (${i < 6 ? 'before' : 'after'} the drag) differs from Off in ${k} bytes`);
  }
  assert(dragDiffs.every(d => d > 0), 'a drag frame was not on the CSS grid');
  assert(on.field.data.every((v, i) => Object.is(v, off.field.data[i])), 'settled height field differs from Off');
  assert(JSON.stringify(on.samples) === JSON.stringify(off.samples), 'settled analysis samples differ from Off');
  assert(on.stats.gestureBytes === 0 && on.stats.gesturePeakBytes > 0, 'drag targets not freed at the settled frame');
  const alpha = frame => { let k = 0; for (let i = 3; i < frame.length; i += 4) if (frame[i]) k++; return k; };
  const coverageRatio = sequence.map((s, i) => s.drag ? alpha(on.frames[i]) / Math.max(1, alpha(off.frames[i])) : 1);
  assert(Math.min(...coverageRatio) > 0.99, `drag-frame valid pixels fell to ${Math.min(...coverageRatio)}`);
  results.on = { firstSettledFrame: settled, settledIdenticalToOff: true, dragFrameBytesDiffering: { min: Math.min(...dragDiffs), max: Math.max(...dragDiffs) },
    dragFrameValidPixelRatioMin: Math.min(...coverageRatio), peakDragTargetBytes: on.stats.gesturePeakBytes };
  // iPhone 17 Pro portrait at DPR 3: the drag targets this allocates.
  {
    const item = make(CSPGpuTerrainEngine, [402, 874], 6), phone = { ...live, cssSize: [402, 874] };
    item.engine.render(phone); item.engine.render(at(1) && { ...phone, centerMerc: at(1).centerMerc }, { coarse: true });
    const s = item.engine.stats(); item.engine.render({ ...phone, centerMerc: at(2).centerMerc });
    results.iphoneDragTargetBytes = s.gestureBytes; results.iphoneFieldBytes = s.heightFieldBytes;
    assert(item.engine.stats().gestureBytes === 0, 'iPhone drag targets not freed');
    item.engine.destroy(); item.canvas.remove();
  }
  // GPU time per drag frame, full resolution against the CSS grid: blocks of
  // 40 frames, each waited for by a one-pixel readback of the canvas.
  {
    const item = make(CSPGpuTerrainEngine, live.cssSize, 6), times = { full: [], css: [] }, px = new Uint8Array(4);
    const sync = () => { item.gl.bindFramebuffer(item.gl.FRAMEBUFFER, null); item.gl.readPixels(0, 0, 1, 1, item.gl.RGBA, item.gl.UNSIGNED_BYTE, px); };
    item.engine.render(at(0)); sync();
    for (const mode of ['full', 'css', 'full', 'css']) for (let i = 1; i <= 40; i++) {
      const t = performance.now(); item.engine.render(at(i * (mode === 'css' ? 1.01 : 1)), mode === 'css' ? { coarse: true } : undefined); sync();
      times[mode].push(performance.now() - t);
    }
    const median = v => v.slice().sort((a, b) => a - b)[v.length >> 1];
    results.dragFrameMs = { full: +median(times.full).toFixed(2), css: +median(times.css).toFixed(2), viewport: live.cssSize, dpr: live.dpr };
    item.engine.destroy(); item.canvas.remove();
  }
  // Which derived fields drop out on the CSS grid (a radius under one pixel).
  {
    const t = CSPGpuTerrainEngine._test, report = [];
    for (const detailRadius of [6, 3, 1.5]) {
      const s = state(detailRadius), full = t.auxRadii(s, live, CSPGpuTerrainShaders), css = t.auxRadii(s, t.gestureView(live), CSPGpuTerrainShaders);
      report.push({ detailRadiusMetres: detailRadius, remRadiusMetres: 200,
        fullPx: { blur: +full.blur.toFixed(2), base: +full.base.toFixed(1) }, cssPx: { blur: +css.blur.toFixed(2), base: +css.base.toFixed(1) },
        dragBlur: t.auxPlan(css.blur, 1, 1) ? 'softened' : 'absent while dragging', settledBlur: t.auxPlan(full.blur, 1, 1) ? 'present' : 'absent' });
    }
    results.subPixelRadii = report;
  }
  return results;
}

(async () => {
  const names = (argument('browser') || 'both') === 'both' ? ['chrome', 'webkit'] : [argument('browser')];
  if (names.some(name => !launchers[name])) throw new Error('Use --browser=chrome|webkit|both');
  const baseRev = argument('base') || 'main';
  const baseSource = execFileSync('git', ['show', `${baseRev}:gpu-terrain-engine.js`], { cwd: root, encoding: 'utf8' });
  const output = { harness: 'gpu2d-pan-shading', base: execFileSync('git', ['rev-parse', baseRev], { cwd: root, encoding: 'utf8' }).trim(), browsers: {} };
  for (const name of names) {
    let browser;
    try {
      browser = await launchers[name]();
      const page = await browser.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.setContent('<!doctype html><meta charset="utf-8"><body style="margin:0"></body>');
      for (const file of ['elevation-tile-core.js', 'terrain-core.js', 'terrain-raster.js', 'elevation-bands.js', 'terrain-drape-core.js', 'gpu-terrain-shaders.js'])
        await page.addScriptTag({ content: fs.readFileSync(path.join(root, file), 'utf8') });
      await page.addScriptTag({ content: baseSource });
      await page.evaluate(() => { window.CSPBaseEngine = window.CSPGpuTerrainEngine; delete window.CSPGpuTerrainEngine; });
      await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'gpu-terrain-engine.js'), 'utf8') });
      output.browsers[name] = { status: 'pass', ...(await page.evaluate(suite)) };
      if (errors.length) output.browsers[name] = { ...output.browsers[name], status: 'fail', pageErrors: errors };
    } catch (error) { output.browsers[name] = { status: 'fail', error: error.message }; }
    finally { if (browser) await browser.close(); }
  }
  output.status = Object.values(output.browsers).every(result => result.status === 'pass') ? 'pass' : 'fail';
  console.log(JSON.stringify(output, null, 2));
  if (output.status !== 'pass') process.exitCode = 1;
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
