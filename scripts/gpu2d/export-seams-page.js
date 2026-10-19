/* Page side of export-seams.js. A synthetic braided-river valley under a
   relative-elevation + detail layer stack, exported the way index.html's
   streamed path exports it. */
window.runProbe = async function (opts) {
  const lat = 61.2, Z = 14, n = 2 ** Z;
  const cy = (0.5 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / (2 * Math.PI));
  const center = [0.1 + 0.37 / n, cy];
  const mPerMerc = 40075016 * Math.cos(lat * Math.PI / 180);
  const height = (mx, my) => {
    const u = (mx - center[0]) * mPerMerc, v = (my - center[1]) * mPerMerc;
    const xc = 160 * Math.sin(v / 310) + 40 * Math.sin(v / 77);
    const d = u - xc;
    return 300 - 0.03 * v + 0.01 * u + 45 * (1 - Math.exp(-d * d / (2 * 260 * 260)))
      - 2.5 * Math.exp(-d * d / (2 * 14 * 14)) + 1.2 * Math.sin(u / 23) * Math.cos(v / 31) + 0.0006 * u * u / 10;
  };
  const tx0 = Math.floor(center[0] * n), ty0 = Math.floor(center[1] * n);
  const specs = [{id: 'syn', rank: 1, label: 'syn', nativeZoom: () => Z, allowed: () => true}];
  const records = [];
  for (let y = ty0 - 3; y <= ty0 + 3; y++) for (let x = tx0 - 2; x <= tx0 + 2; x++) {
    const grid = new Float32Array(256 * 256);
    for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) grid[j * 256 + i] = height((x + (i + .5) / 256) / n, (y + (j + .5) / 256) / n);
    records.push({key: `syn/${Z}/${x}/${y}`, sourceId: 'syn', rank: 1, label: 'syn', z: Z, x, y, width: 256, height: 256, grid, sampleMeters: 1, surveys: [], revision: 1});
  }
  class FakeStore {
    constructor() { this.options = {sources: () => specs}; this.records = new Map(); this.listeners = new Set(); }
    sources() { return specs; } get(k) { return this.records.get(k); }
    on(_, fn) { this.listeners.add(fn); return this; } off(_, fn) { this.listeners.delete(fn); return this; }
    emit(r) { this.records.set(r.key, r); this.listeners.forEach(fn => fn(r)); }
    want() {} settled(t) { return {complete: true, total: t.length, ratio: 1}; } provenance() { return {}; }
    finestFor(id, t) { return [...this.records.values()].filter(r => r.z <= t.z && Math.floor(t.x / 2 ** (t.z - r.z)) === r.x && Math.floor(t.y / 2 ** (t.z - r.z)) === r.y).sort((a, b) => b.z - a.z)[0]; }
  }
  const store = new FakeStore(), canvas = document.createElement('canvas'); document.body.append(canvas);
  const errs = [];
  const engine = CSPGpuTerrainEngine.create({canvas, store, shaders: CSPGpuTerrainShaders, onNeedsFrame: () => {}, onError: e => errs.push(String(e))});
  if (!engine) throw new Error('engine null ' + errs);
  engine.setState({
    terrain: {style: 'hs', opacity: 1, look: {contrast: 100, saturation: 100, brightness: 100}, lighting: {azimuth: 315, altitude: 45, ambient: .12},
      stack: {layers: [{style: 'rem', opacity: 1, blend: 'normal', stops: [[0, .14, .12, .78, 1], [.35, .55, .15, .85, 1], [.7, 1, .45, .12, 1], [1, 1, .95, .7, 1]], min: 0, max: opts.remMax || 12, gamma: 1}],
        detail: .3, detailRadius: 6, reliefExag: 1.6, remRadius: 1500}},
    spectrum: {spectrumOn: false}, spectrumOpacity: 1});
  const css = opts.css || [215, 466];
  const live = {centerMerc: center, zoom: opts.zoom || 14.3, bearing: opts.bearing || 0, cssSize: css, dpr: opts.liveDpr || 1, dz: 0};
  for (const r of records) store.emit(r);
  for (let i = 0; i < 60; i++) { engine.render(live); }
  if (opts.limit) engine.debugLimits({maxTargetSize: opts.limit});
  const scale = opts.scale, W = Math.round(css[0] * scale), H = Math.round(css[1] * scale);
  const out = document.createElement('canvas'); out.width = W; out.height = H; const ctx = out.getContext('2d');
  const exportView = CSPGpuTerrainLayer.exportView;
  const spec = {sel: {x: 0, y: 0, w: css[0], h: css[1]}, scale, width: W, height: H};
  const t0 = performance.now();
  if (opts.mode === 'live') {
    engine.render({...live}); ctx.drawImage(canvas, 0, 0);
  } else if (opts.mode === 'whole') {
    ctx.drawImage(await engine.renderToCanvas(exportView(live, spec), W, H), 0, 0);
  } else if (opts.mode === 'blocks-old') {
    // index.html before the fix: every block is its own export.
    const bandH = Math.max(8, Math.min(1024, Math.floor(4e6 / W))), cols = Math.ceil(W / 4096), colW = Math.ceil(W / cols);
    for (let y0 = 0; y0 < H; y0 += bandH) for (let c = 0; c < cols; c++) {
      const x0 = c * colW, w = Math.min(colW, W - x0), h = Math.min(bandH, H - y0);
      const bs = {...spec, sel: {...spec.sel, x: x0 / scale, y: y0 / scale}, width: w, height: h};
      ctx.drawImage(await engine.renderToCanvas(exportView(live, bs), w, h), x0, y0);
    }
  } else if (opts.mode === 'blocks-new') {
    const bandH = Math.max(8, Math.min(1024, Math.floor(4e6 / W))), cols = Math.ceil(W / 4096), colW = Math.ceil(W / cols);
    const view = exportView(live, spec);
    try {
      for (let y0 = 0; y0 < H; y0 += bandH) for (let c = 0; c < cols; c++) {
        const x0 = c * colW, w = Math.min(colW, W - x0), h = Math.min(bandH, H - y0);
        ctx.drawImage(await engine.renderToCanvas(view, W, H, {x: x0, y: y0, width: w, height: h}), x0, y0);
      }
    } finally { engine.releaseExport(); }
  }
  const ms = performance.now() - t0;
  // Seam metric: mean |row r - row r-1| at every band boundary vs elsewhere.
  const data = ctx.getImageData(0, 0, W, H).data;
  const rowDiff = r => { let s = 0; for (let x = 0; x < W; x++) for (let k = 0; k < 3; k++) s += Math.abs(data[(r * W + x) * 4 + k] - data[((r - 1) * W + x) * 4 + k]); return s / W / 3; };
  const bandH = Math.max(8, Math.min(1024, Math.floor(4e6 / W)));
  const seams = [], others = [];
  for (let r = 1; r < H; r++) (r % bandH === 0 ? seams : (r % 97 === 0 ? others : null))?.push(rowDiff(r));
  const avg = a => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  let diff = null;
  if (window.__prev && window.__prev.length === data.length) { let mx = 0, cnt = 0; for (let i = 0; i < data.length; i++) { const d = Math.abs(data[i] - window.__prev[i]); if (d > mx) mx = d; if (d > 2) cnt++; } diff = {max: mx, over2: cnt}; }
  window.__prev = data;
  engine.destroy();
  return {W, H, bandH, ms: Math.round(ms), seamDiff: +avg(seams).toFixed(2), rowDiff: +avg(others).toFixed(2), maxSeam: +Math.max(0, ...seams).toFixed(2), diff};
};
