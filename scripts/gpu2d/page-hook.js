/* Injected into app.js, immediately before
   window.ClearSkiesPortalBridge is assigned, so the closures below see
   elevLayer, terLayer, terBase, terrainSwap, terrainGpu and elevGpu.
   Loaded by harness-lib.js; not a standalone page script. */
window.__cspGpu2d = (function () {
  function bridge() { return window.ClearSkiesPortalBridge || null; }
  function gpuLayer() {
    try {
      const b = bridge();
      if (!b || typeof b.gpuTerrain !== "function") return null;
      return b.gpuTerrain() || null;
    } catch (error) {
      return null;
    }
  }
  function layerRoot(layer) {
    try { return layer && layer.getContainer ? layer.getContainer() : null; }
    catch (error) { return null; }
  }
  function elements() {
    const out = [], seen = new Set();
    const add = (el) => { if (el && !seen.has(el)) { seen.add(el); out.push(el); } };
    const from = (layer) => {
      const root = layerRoot(layer);
      if (!root) return;
      if (root.matches && root.matches("canvas,img")) add(root);
      if (root.querySelectorAll) root.querySelectorAll("canvas,img.leaflet-tile").forEach(add);
    };
    from(terBase); from(terLayer); from(elevLayer); from(gpuLayer());
    return out;
  }
  function layerInfo(layer) {
    if (!layer) return null;
    const tiles = Object.values(layer._tiles || {}).filter((tile) => tile.current !== false);
    let ready = 0, refining = 0, content = 0;
    for (const tile of tiles) {
      const el = tile.el;
      const canvas = el instanceof HTMLCanvasElement;
      if (tile.loaded && (!canvas || el._cspHasContent === true)) ready++;
      if (el && el._cspHasContent) content++;
      if (el && el._cspRefining) refining++;
    }
    return {
      pending: layer._pending ? layer._pending.size : 0,
      store: layer._store ? layer._store.size : 0,
      tiles: tiles.length,
      ready,
      content,
      refining,
      ratio: tiles.length ? ready / tiles.length : 0
    };
  }
  function interpretGpu(settled) {
    if (!settled || typeof settled !== "object") return { pending: true, ratio: null, refining: false, raw: settled || null };
    const ratio = typeof settled.ratio === "number" ? settled.ratio
      : (typeof settled.complete === "number" && settled.total) ? settled.complete / settled.total
      : settled.complete === true ? 1 : settled.complete === false ? 0 : null;
    const refining = !!settled.refining;
    return { pending: refining || ratio == null || ratio < 0.9, ratio, refining, raw: settled };
  }
  function busy(info) {
    if (!info) return false;
    /* 0.90 matches the app's own terrain-swap bar. A missing edge tile must not
       hold every later measurement at the timeout. Refining still counts as busy
       because a sharper tile changes pixels. */
    return info.tiles === 0 || info.pending > 0 || info.ratio < 0.9 || info.refining > 0;
  }
  function settlement() {
    const dataset = document.documentElement.dataset.gpu2d || "unset";
    const gpu = gpuLayer();
    if (dataset === "on" && gpu && typeof gpu.settled === "function") {
      let raw = null, error = null;
      try { raw = gpu.settled(); }
      catch (e) { error = String(e && e.message || e); }
      const parsed = interpretGpu(raw);
      return { mode: "gpu", dataset, error, swap: false, terrain: null, elevation: null, pending: parsed.pending || !!error, ratio: parsed.ratio, refining: parsed.refining };
    }
    const terrain = layerInfo(terLayer) || layerInfo(terBase);
    const elevation = layerInfo(elevLayer);
    const swap = !!terrainSwap;
    const wantTerrain = !!(terLayer || terBase);
    const wantElevation = !!elevLayer;
    const pending = swap || (wantTerrain && busy(terrain)) || (wantElevation && busy(elevation));
    return { mode: "legacy", dataset, swap, terrain, elevation, pending, ratio: terrain ? terrain.ratio : elevation ? elevation.ratio : null, refining: !!((terrain && terrain.refining) || (elevation && elevation.refining)) };
  }
  function ancestorResident() {
    const gpu = gpuLayer();
    if (document.documentElement.dataset.gpu2d === "on" && gpu && gpu.getStore) {
      try {
        const store = gpu.getStore();
        if (store && typeof store.settled === "function") {
          const s = gpu.settled();
          return !!(s && (s.total > 0 || s.complete || s.ratio > 0));
        }
      } catch (error) {}
    }
    const layers = [terLayer, terBase, elevLayer].filter(Boolean);
    return layers.some((layer) => layer._store && layer._store.size > 0);
  }
  function engineStats() {
    try {
      const gpu = gpuLayer();
      const engine = gpu && gpu.getEngine && gpu.getEngine();
      if (!engine || typeof engine.stats !== "function") return null;
      return engine.stats();
    } catch (error) {
      return { error: String(error && error.message || error) };
    }
  }
  function renderers() {
    return {
      terrain: typeof terrainGpu !== "undefined" ? terrainGpu : null,
      elevation: typeof elevGpu !== "undefined" ? elevGpu : null
    };
  }
  function path() {
    const dataset = document.documentElement.dataset.gpu2d || "unset";
    let hasGpuTerrainFn = false, gpuLayerPresent = false, error = null;
    try {
      const b = bridge();
      hasGpuTerrainFn = !!(b && typeof b.gpuTerrain === "function");
      if (hasGpuTerrainFn) gpuLayerPresent = !!b.gpuTerrain();
    } catch (e) { error = String(e && e.message || e); }
    return {
      dataset,
      hasGpuTerrainFn,
      gpuLayer: gpuLayerPresent,
      /* Unset means the integration has not chosen a path: today's renderer. */
      path: dataset === "on" ? "on" : "off",
      error
    };
  }
  /* Settings timing only. This does not read a WebGL drawing buffer.
     The live terrain canvas is created with preserveDrawingBuffer:false, so a
     later drawImage of that canvas can see a cleared buffer. Coverage, parity,
     blank frames, and rotation use a Playwright screenshot of #map instead.
     Legacy 2D tile canvases keep their pixels, so a small synchronous
     getImageData sample is a valid "did the tile change" signal. The GPU path
     reports engine.stats() frame counters, which are not pixel coverage. */
  function sample2d(el, hash) {
    if (!(el instanceof HTMLCanvasElement)) return hash;
    if (el.classList.contains("csp-gpu-terrain") || el.__cspGlHook) return hash;
    let ctx = null;
    try { ctx = el.getContext("2d"); } catch (error) { return hash; }
    if (!ctx || el.width < 2 || el.height < 2) return hash;
    try {
      const data = ctx.getImageData(0, 0, Math.min(8, el.width), Math.min(8, el.height)).data;
      for (let i = 0; i < data.length; i += 16) { hash ^= data[i]; hash = Math.imul(hash, 16777619); }
    } catch (error) {}
    return hash;
  }
  function paintSignal() {
    const dataset = document.documentElement.dataset.gpu2d || "unset";
    const appearance = [];
    for (const layer of [terLayer, terBase, elevLayer]) {
      let root = null;
      try { root = layer && layer.getContainer ? layer.getContainer() : null; } catch (error) { root = null; }
      if (!root) continue;
      const style = getComputedStyle(root);
      appearance.push((style.opacity || "") + "|" + (style.filter || ""));
    }
    if (dataset === "on") {
      const stats = engineStats();
      return {
        kind: "engine-frame-counter",
        note: "Completed interactive shade frames from engine.stats(). Not a pixel read and not coverage.",
        frames: stats && stats.frames != null ? stats.frames : null,
        generation: stats && stats.generation != null ? stats.generation : null,

        appearance: appearance.join(";")
      };
    }
    let hash = 2166136261, canvases = 0;
    for (const layer of [terLayer, terBase, elevLayer]) {
      if (!layer || !layer._tiles) continue;
      const tiles = Object.values(layer._tiles);
      const stride = Math.max(1, Math.floor(tiles.length / 6));
      for (let i = 0; i < tiles.length; i += stride) {
        const before = hash;
        hash = sample2d(tiles[i] && tiles[i].el, hash);
        if (hash !== before) canvases++;
      }
    }
    return {
      kind: "legacy-2d-sample",
      note: "Synchronous getImageData of 2D tile canvases plus layer opacity/filter. WebGL canvases are skipped.",
      hash: hash >>> 0,
      canvases,
      appearance: appearance.join(";")
    };
  }
  return { elements, settlement, ancestorResident, engineStats, path, paintSignal, layerInfo, renderers };
})();
