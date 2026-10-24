/* Page side of export-detail.js. A synthetic survey whose fine relief (a
   ~10 m ripple) exists only in its z17 tiles, as LiDAR detail exists only in
   the finest native level. The live view at z14 never sees it; an 8x export
   must fetch z17 and show it, without touching the live view's tiles. */
window.runDetailProbe = async function (opts) {
  const lat = 47.3, Z = 17, live = {zoom: 14.3, dpr: 1, dz: 0, cssSize: [300, 200]};
  const cy = 0.5 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / (2 * Math.PI);
  const center = [0.3141 + 0.37 / 2 ** 14, cy];
  const mPerMerc = 40075016 * Math.cos(lat * Math.PI / 180);
  const height = (mx, my, z) => {
    const u = (mx - center[0]) * mPerMerc, v = (my - center[1]) * mPerMerc;
    return 420 + 0.02 * u - 0.04 * v + 30 * Math.sin(u / 400) * Math.cos(v / 650) + (z >= Z ? 0.9 * Math.sin(u / 1.7) * Math.cos(v / 2.3) : 0);
  };
  const requests = [];
  const request = async url => {
    const [, z, x, y] = url.split('/').map(Number); requests.push(z);
    await new Promise(r => setTimeout(r, 1));
    const n = 2 ** z, grid = new Float32Array(256 * 256);
    for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) grid[j * 256 + i] = height((x + (i + .5) / 256) / n, (y + (j + .5) / 256) / n, z);
    return {width: 256, height: 256, grid};
  };
  const sources = [{id: 'syn', rank: 3, label: 'syn', nativeZoom: z => Math.min(z, Z), url: (z, x, y) => `syn/${z}/${x}/${y}`, allowed: () => true, group: 'detail'}];
  const store = new CSPGpuTerrainStore.ElevationTileStore({sources: () => sources, request});
  const canvas = document.createElement('canvas'); document.body.append(canvas);
  const errs = [];
  const engine = CSPGpuTerrainEngine.create({canvas, store, shaders: CSPGpuTerrainShaders, onNeedsFrame: () => {}, onError: e => errs.push(String(e)),
    exportChunk: opts.chunk, exportTextureBytes: opts.textureBytes});
  if (!engine) throw new Error('engine null ' + errs);
  engine.setState({terrain: {style: 'hs', opacity: 1, look: {contrast: 100, saturation: 100, brightness: 100},
    lighting: {azimuth: 315, altitude: 45, ambient: .12}}, spectrum: {spectrumOn: false}, spectrumOpacity: 1});
  const view = {centerMerc: center, zoom: live.zoom, bearing: opts.bearing || 0, cssSize: live.cssSize, dpr: live.dpr, dz: live.dz};
  for (let i = 0; i < 400; i++) {
    engine.render(view); await new Promise(r => setTimeout(r, 4));
    const s = store.settled(engine.neededTiles(view));
    if (s.ratio === 1 && !s.refining && !engine.stats().queuedUploads) break;
  }
  engine.render(view);
  const liveRequests = requests.length, liveStore = store.stats().tiles, liveTextures = engine.stats().textures;
  const scale = opts.scale, W = Math.round(live.cssSize[0] * scale), H = Math.round(live.cssSize[1] * scale);
  const spec = {sel: {x: 0, y: 0, w: live.cssSize[0], h: live.cssSize[1]}, scale, width: W, height: H};
  const ev = CSPGpuTerrainLayer.exportView(view, spec);
  const detailInfo = engine.exportDetail(ev, W);
  const out = document.createElement('canvas'); out.width = W; out.height = H; const ctx = out.getContext('2d');
  let tilesSeen = 0;
  const options = {detail: opts.detail, onTile: () => tilesSeen++};
  if (opts.mode === 'whole') ctx.drawImage(await engine.renderToCanvas(ev, W, H, undefined, options), 0, 0);
  else {
    // index.html's streamed path: full-width bands cut into <=4096 px columns.
    const bandH = Math.max(8, Math.min(1024, Math.floor(4e6 / W))), cols = Math.ceil(W / 4096), colW = Math.ceil(W / cols);
    try {
      for (let y0 = 0; y0 < H; y0 += bandH) for (let c = 0; c < cols; c++) {
        const x0 = c * colW, w = Math.min(colW, W - x0), h = Math.min(bandH, H - y0);
        ctx.drawImage(await engine.renderToCanvas(ev, W, H, {x: x0, y: y0, width: w, height: h}, options), x0, y0);
      }
    } finally { engine.releaseExport(); }
  }
  const data = ctx.getImageData(0, 0, W, H).data;
  // Pixel-scale relief: mean |luma(x) - luma(x+1)|, the ripple's signature.
  let fine = 0, count = 0, opaque = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x + 1 < W; x++) {
    const i = (y * W + x) * 4, l = .299 * data[i] + .587 * data[i + 1] + .114 * data[i + 2], r = .299 * data[i + 4] + .587 * data[i + 5] + .114 * data[i + 6];
    fine += Math.abs(l - r); count++;
  }
  for (let i = 3; i < data.length; i += 4) if (data[i]) opaque++;
  let diff = null;
  if (opts.compare && window.__prev && window.__prev.length === data.length) {
    let max = 0, over2 = 0; for (let i = 0; i < data.length; i++) { const d = Math.abs(data[i] - window.__prev[i]); if (d > max) max = d; if (d > 2) over2++; }
    diff = {max, over2};
  }
  if (opts.keep) window.__prev = data;
  const byZ = {}; for (const z of requests.slice(liveRequests)) byZ[z] = (byZ[z] || 0) + 1;
  const result = {W, H, detailInfo, exportRequests: byZ, tilesSeen, fine: +(fine / count).toFixed(3), coverage: +(opaque / (W * H)).toFixed(4), diff,
    liveStoreUnchanged: store.stats().tiles === liveStore, liveTexturesUnchanged: engine.stats().textures === liveTextures,
    exportTexturesAfter: engine.stats().exportTextures, errors: errs};
  engine.destroy(); store.destroy();
  return result;
};
