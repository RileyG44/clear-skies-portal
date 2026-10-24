/* Real shader + real PNG capture fixture, shared by desktop WebKit and the
 * installed Debug WKWebView probe. Only elevation delivery is synthetic. */
async function captureFixture({ composeSource, streamSource, large = true, saveArtifact = false }) {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const checks = [], failures = [];
  const canvas = document.createElement('canvas');
  const mapEl = document.createElement('div');
  mapEl.style.backgroundColor = '#111416'; mapEl.appendChild(canvas);
  const z = 15, n = 2 ** z, sources = [{ id: 'capture-fixture', rank: 1, nativeZoom: () => z, allowed: () => true }];
  const records = new Map(), listeners = new Set();
  for (let y = 11416; y <= 11423; y++) for (let x = 5277; x <= 5282; x++) {
    const width = 256, grid = new Float32Array(width * width);
    for (let j = 0; j < width; j++) for (let i = 0; i < width; i++) {
      const u = (x - 5279) * width + i, v = (y - 11419) * width + j;
      grid[j * width + i] = 220 + 70 * Math.sin(u / 115) + 55 * Math.cos(v / 143) +
        18 * Math.sin((u + v) / 25) + 6 * Math.sin(u / 7) * Math.cos(v / 9);
    }
    const key = `capture-fixture/${z}/${x}/${y}`;
    records.set(key, { key, sourceId: 'capture-fixture', rank: 1, z, x, y, width, height: width, grid, revision: 1 });
  }
  const store = {
    options: { sources: () => sources }, sources: () => sources, get: key => records.get(key),
    on: (name, fn) => listeners.add(fn), off: (name, fn) => listeners.delete(fn), want() {},
    finestFor(id, tile) {
      return [...records.values()].find(r => r.sourceId === id && r.z <= tile.z &&
        Math.floor(tile.x / 2 ** (tile.z - r.z)) === r.x && Math.floor(tile.y / 2 ** (tile.z - r.z)) === r.y);
    }
  };
  const errors = [];
  const engine = CSPGpuTerrainEngine.create({ canvas, store, shaders: CSPGpuTerrainShaders,
    sources: () => sources, onNeedsFrame() {}, onError: error => errors.push(String(error)) });
  assert(engine, `Real GPU unavailable: ${errors.join('; ')}`);
  const gl = canvas.getContext('webgl2'), debug = gl.getExtension('WEBGL_debug_renderer_info');
  const metadata = { userAgent: navigator.userAgent, renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
  assert(!/swiftshader|llvmpipe|software rasterizer/i.test(metadata.renderer), 'Software GPU is not accepted');
  const L = { Layer: { extend: definition => { function Layer() {} Layer.prototype = definition; return Layer; } } };
  CSPGpuTerrainLayer.install(L);
  const layer = Object.create(L.CSPGpuTerrainLayer.prototype);
  Object.assign(layer, { _engine: engine, _container: mapEl });
  const scene = CSPLidarRender.LOOKS.find(look => look.id === 'aurora').scene;
  const studio = CSPLidarRender.normalizeState({ base: { rem: scene.base }, overlays: scene.overlays, effects: scene.effects, look: 'aurora' });
  const state = { terrain: { style: 'rem', opacity: 1, stack: CSPLidarRender.buildStack(studio, 'rem', {}),
    lighting: { azimuth: 315, altitude: 45, ambient: 0.12 }, look: { contrast: 100, brightness: 100, saturation: 100 } }, spectrum: {} };
  engine.setState(state);
  for (const record of records.values()) for (const fn of listeners) fn(record);
  const frame = { centerMerc: [5279.5 / n, 11419.5 / n], zoom: 15.25, bearing: 0, cssSize: [430, 932], dpr: 3, dz: 1 };
  function settle(view) {
    for (let i = 0; i < 40; i++) engine.render(view);
    const fit = CSPLidarRender.fitRange(engine.sampleValues().relative, 'rem');
    state.terrain.stack = CSPLidarRender.buildStack(studio, 'rem', { base: fit });
    engine.setState(state); engine.render(view); gl.finish(); layer._view = view;
  }
  // Compile the unmodified application compositor functions. Other map layers
  // are absent; terrain, canvas readback and PNG encoding are production code.
  const env = { $: () => mapEl, window: {}, map3d: null, gpuTerrainEnabled: true, gpuTerrainLayer: layer,
    snapshotPaintOrder: items => items, snapshotDomItems: () => [], snapshotReport() {}, drawSnapshotReadout() {},
    SNAPSHOT_BAND_PIXELS: 4_000_000, SNAPSHOT_BLOCK_EDGE: 4096 };
  const compile = (name, source, png) => new Function('env', 'CSPPngStream',
    `const {${Object.keys(env).join(',')}}=env;let snapshotProgressAt=0;${source};return ${name};`)(env, png);
  const compose = compile('composeSnapshot', composeSource, CSPPngStream);
  const originalSnapshot = engine.createSnapshot.bind(engine), originalRender = engine.renderToCanvas.bind(engine);
  let created = 0, released = 0, blocks = 0;
  engine.createSnapshot = view => {
    const snapshot = originalSnapshot(view), release = snapshot.release; created++;
    snapshot.release = () => { if (!snapshot.released) released++; release(); };
    return snapshot;
  };
  engine.renderToCanvas = (...args) => { blocks++; return originalRender(...args); };
  async function pixels(blob) {
    const url = URL.createObjectURL(blob), image = new Image();
    try {
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; });
      const output = document.createElement('canvas'); output.width = image.width; output.height = image.height;
      const ctx = output.getContext('2d'); ctx.drawImage(image, 0, 0);
      const data = ctx.getImageData(0, 0, output.width, output.height).data; output.width = output.height = 0; return data;
    } finally { URL.revokeObjectURL(url); }
  }
  function compare(actual, expected, name) {
    assert(actual.length === expected.length, `${name}: different byte counts`);
    let max = 0, different = 0;
    for (let i = 0; i < actual.length; i++) { const delta = Math.abs(actual[i] - expected[i]); max = Math.max(max, delta); if (delta > 3) different++; }
    assert(!different, `${name}: ${different} channels differ by >3; maximum ${max}`);
    return max;
  }
  try {
    for (const bearing of [0, 37]) {
      const view = { ...frame, bearing }; settle(view);
      const spec = { width: 1408, height: 2112, scale: 32, sel: { x: 132, y: 264, w: 44, h: 66 }, plans: [], tiles: 0 };
      engine.debugLimits({ maxTargetSize: 512 });
      const full = await compose(spec), parts = [];
      await compile('composeSnapshotStream', streamSource, CSPPngStream)(spec, bytes => parts.push(bytes.slice()));
      const maximumChannelDifference = compare(await pixels(full.blob), await pixels(new Blob(parts, { type: 'image/png' })), `Aurora 32x bearing ${bearing}`);
      assert(created === released, 'Compositor leaked a frozen capture');
      checks.push({ name: `Aurora 32x full/stream parity, bearing ${bearing}`, width: spec.width, height: spec.height, maximumChannelDifference, forcedGpuTargetEdge: 512 });
    }
    engine.debugLimits({});
    if (large) {
      settle(frame);
      const spec = { width: 7240, height: 7860, scale: 32, sel: { x: 60, y: 120, w: 226.25, h: 245.625 }, plans: [], tiles: 0 };
      const reference = originalSnapshot(frame), parts = [], bandHeight = Math.floor(4_000_000 / spec.width), colWidth = Math.ceil(spec.width / 2);
      let row = 0, sampled = 0, maximumChannelDifference = 0;
      const wrappedPng = { create(options) {
        const png = CSPPngStream.create(options);
        return { ...png, async writeRows(data, h) {
          // Independent crops straddle every column and band boundary. They
          // share the map's geographic effect fields, not a block's edges.
          const patches = [
            { x: 0, y: row, w: spec.width, h: Math.min(8, h) },
            { x: 0, y: row + Math.max(0, h - 8), w: spec.width, h: Math.min(8, h) },
            { x: colWidth - 16, y: row, w: 32, h }
          ];
          for (const p of patches) {
            const patch = { ...spec, width: p.w, height: p.h, sel: { ...spec.sel, x: spec.sel.x + p.x / 32, y: spec.sel.y + p.y / 32 } };
            const expected = await originalRender(CSPGpuTerrainLayer.exportView(frame, patch), p.w, p.h, reference);
            const a = new Uint8ClampedArray(p.w * p.h * 4);
            for (let j = 0; j < p.h; j++) a.set(data.subarray(((p.y - row + j) * spec.width + p.x) * 4, ((p.y - row + j) * spec.width + p.x + p.w) * 4), j * p.w * 4);
            maximumChannelDifference = Math.max(maximumChannelDifference, compare(a, expected.getContext('2d').getImageData(0, 0, p.w, p.h).data, 'Large capture seam'));
            sampled += p.w * p.h; expected.width = expected.height = 0;
          }
          row += h; await png.writeRows(data, h);
        } };
      } };
      const previousBlocks = blocks, previousCreated = created, previousReleased = released, started = performance.now();
      let result;
      try { result = await compile('composeSnapshotStream', streamSource, wrappedPng)(spec, bytes => parts.push(bytes.slice())); }
      finally { reference.release(); }
      const blob = new Blob(parts, { type: 'image/png' });
      assert(row === spec.height && result.failed === 0, 'Incomplete 32x PNG');
      assert(created - previousCreated === 1 && released - previousReleased === 1, 'Large capture must use and release exactly one session');
      if (saveArtifact) window.__captureArtifact = blob;
      checks.push({ name: 'Aurora 32x large streamed PNG', width: spec.width, height: spec.height, bytes: blob.size,
        blocks: blocks - previousBlocks, bandHeight, columns: 2, sampledSeamPixels: sampled, maximumChannelDifference,
        milliseconds: Math.round(performance.now() - started) });
    }
    settle(frame);
    const snapshot = engine.createSnapshot(frame), previous = engine.stats().uploads;
    const revised = { ...records.values().next().value, revision: 2 };
    records.set(revised.key, revised); for (const fn of listeners) fn(revised);
    engine.render(frame);
    assert(engine.stats().uploads === previous, 'Source revision changed during capture');
    assert(engine.stats().queuedUploads > 0, 'Refinement was discarded during capture');
    snapshot.release(); engine.render(frame);
    assert(engine.stats().uploads > previous, 'Queued refinement did not resume');
    checks.push({ name: 'Native source revision is frozen during capture; refinement resumes after release' });
    assert(gl.getError() === gl.NO_ERROR, 'WebGL error before context-loss test');
    const interrupted = engine.createSnapshot(frame), loss = gl.getExtension('WEBGL_lose_context');
    assert(loss, 'Context-loss verification unavailable');
    const event = name => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error(`${name} timed out`)), 5000);
      canvas.addEventListener(name, () => { clearTimeout(timer); resolve(); }, { once: true });
    });
    const lost = event('webglcontextlost'); loss.loseContext(); await lost; gl.getError();
    // Restoration is allowed after the browser finishes loss-event dispatch.
    await new Promise(resolve => setTimeout(resolve, 40));
    let rejected = false;
    try { await originalRender(CSPGpuTerrainLayer.exportView(frame, { scale: 32, width: 64, height: 64, sel: { x: 80, y: 160 } }), 64, 64, interrupted); }
    catch (_) { rejected = true; }
    assert(rejected, 'A lost context must reject capture instead of emitting empty pixels');
    const restored = event('webglcontextrestored'); loss.restoreContext(); await restored;
    interrupted.release(); settle(frame);
    assert(engine.ready && engine.stats().queuedUploads === 0, 'Capture interruption prevented restored refinement');
    checks.push({ name: 'Interrupted capture rejects; frozen resources release and rendering recovers after context restoration' });
    const glError = gl.getError(); assert(glError === gl.NO_ERROR, `WebGL error after capture: ${glError}`);
    assert(created === released, 'Capture lifecycle is unbalanced');
  } catch (error) { failures.push(`${error.message || error}\n${error.stack || ''}`); }
  finally { engine.destroy(); canvas.remove(); }
  return { passed: failures.length === 0, build: globalThis.CSP_BUILD || null, metadata, look: 'aurora', scale: 32, checks, failures };
}
if (typeof module === 'object') module.exports = captureFixture;
