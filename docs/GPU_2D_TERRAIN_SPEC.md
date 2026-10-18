# GPU 2D terrain stack — specification

Status: approved for build · Base branch: `gpu2d/base` · Owner/integrator: Claude (parent thread)

## 1. Why

Measured on an Apple M2 (real Metal GPU, Chrome 154, hillshade + elevation
spectrum on, 16 pan/zoom moves over 22 s — `scripts/gpu2d/probes/prof.js`):

| Interaction | Main-thread busy | Long tasks |
|---|---|---|
| Pan/zoom | **13.2 s of 22 s** | **27 tasks, 8.8 s frozen** |
| Drag sun azimuth | 0.56 s | 0 |
| Drag spectrum reference | 0.39 s | 0 |

8.0 s of the 13.2 s is `ElevationTileCore.resampleElevation` (bicubic
Catmull-Rom in JS), 1.3 s `resampleBilinear`, 0.7 s `ProgressiveGrid.accept`.
Shading itself is ~0.5–0.9 ms/tile on the GPU since the `pow()` fix.

Today every tile, for **each of two layers** (`AnalyticTerrainLayer` for the
LiDAR style and `ElevLayer` for the spectrum/bands), does:
fetch → decode (CPU) → resample to tile size (CPU, bicubic) → merge ranks
(CPU) → upload to a shared WebGL2 context → shade → copy into its own 2D
canvas → the browser composites hundreds of canvases.

## 2. Goal

Draw the entire 2D elevation stack (LiDAR terrain style **and** elevation
spectrum/highlights) into **one WebGL2 canvas** from elevation textures that
stay resident on the GPU. Panning, zooming, rotating, and every style,
lighting, appearance, spectrum and band change become redraws from resident
textures. No per-tile canvases, no CPU resampling, no GPU→CPU copies on the
draw path. Accuracy must match the current renderer (see §9).

### Non-goals
- 3D (MapLibre) rendering is unchanged.
- `CompositeTerrainLayer` (WA DNR *published hillshade images* when
  `chooseTerrain(style).src==="wadnr"`) is unchanged.
- Research analysis algorithms are unchanged; only their input grid source changes.
- Server/engine (`server.js`) is unchanged.

## 3. Architecture

```
 index.html (app)                          new modules (UMD, browser global + Node require)
 ─────────────────                         ─────────────────────────────────────────────
 applyTerrain()/applyElev() ──► L.CSPGpuTerrainLayer  (gpu-terrain-layer.js)   [Workstream L]
                                   │  owns <canvas>, Leaflet/rotate/HiDPI/pane-paint view math
                                   ▼
                              CSPGpuTerrainEngine     (gpu-terrain-engine.js)   [Workstream E]
                                   │  WebGL2, texture LRU, tile coverage, ancestor fallback,
                                   │  pass 1 height field, pass 2 shade+composite, export, provenance
                     ┌─────────────┴──────────────┐
                     ▼                            ▼
          CSPGpuTerrainStore              CSPGpuTerrainShaders
          (gpu-terrain-store.js)  [D]     (gpu-terrain-shaders.js)  [S]
          fetch/decode/mask/rank,         GLSL: all 10 styles, spectrum, bands,
          CPU grids, LRU, CPU queries     outline, CSS-filter appearance, compositing
```

Per frame (pan/zoom/rotate/setting change):

1. **Coverage.** Engine computes the display tiles covering the rotated
   viewport (plus one-tile margin) at tile level `round(zoom)+dz`
   (`dz=1` on HiDPI exactly as `ElevLayer` does today), and asks the store to
   `want()` them. Missing data never blocks a frame.
2. **Pass 1 – height field.** Into an offscreen float framebuffer at physical
   pixel resolution (`cssSize*dpr`), draw one quad per display tile per
   available source, ranks ascending. Each draw samples the **finest resident
   native texture for that source at or above the tile** (exact or ancestor
   with UV crop — this replaces CPU `resampleElevation`) using Catmull-Rom
   bicubic, with the no-data rules of `resampleElevation` (bicubic where all 16
   taps are valid, else no-data-aware bilinear, else no write). Output:
   `R = height metres`, `G = rank (1..5)`, `G = 0` means no data. Higher rank
   overwrites lower; within a rank, the finer level wins. This is exactly
   `ProgressiveGrid` semantics.
3. **Pass 2 – shade + composite.** One full-screen draw reads the height field
   with a 3×3 neighbourhood (seamless across tiles), computes the gradient in
   screen space, rotates it into east/north by the map bearing, and computes
   ground distance per pixel from the fragment's Web-Mercator latitude. It
   shades the terrain style (with the CSS-filter appearance and terrain
   opacity), shades spectrum + bands, and composites spectrum **over**
   terrain, premultiplied, into the canvas.
4. Setting changes are uniform updates only: no network, no CPU pixel work.

## 4. Module contracts

All four modules use the same UMD wrapper as `elevation-tile-core.js`
(`root.X = factory()` in the browser, `module.exports` in Node) and must load
with no side effects. Skeletons with these exact signatures are committed on
`gpu2d/base`; **do not change a signature without telling the integrator in
your final report** (additions are fine).

### 4.1 `CSPGpuTerrainShaders` — `gpu-terrain-shaders.js` (Workstream S)

```js
CSPGpuTerrainShaders = {
  VERSION: "1",
  STYLE_IDS: {hs:0,hsmulti:1,slope:2,aspect:3,northness:4,tint:5,c2:6,c5:7,c10:8,c25:9}, // off = -1
  fullscreenVertexSource,        // GLSL 300 es; gl_VertexID triangle; out vec2 v_screenUv (0,0)=top-left
  shadeFragmentSource(prelude),  // GLSL 300 es string. `prelude` (from the engine) defines:
                                 //   float csp_height(ivec2 p); int csp_rank(ivec2 p); bool csp_valid(ivec2 p);
                                 //   ivec2 csp_size();   // height-field size in physical px
  SHADE_UNIFORMS,                // array of every uniform name used by shadeFragmentSource
  uniformValues(state, view),    // -> {name: number|number[]} for every SHADE_UNIFORMS entry
}
```

`state` (built by the layer from existing app helpers, identical shapes):

```js
{
  terrain: { style: "hs"|...|"off", opacity: 0..1,
             look: {contrast, saturation, brightness},      // percents, terrainLook(style)
             lighting: {azimuth, altitude, ambient} },       // terrainLighting()
  spectrum: elevationRenderSettings(),                       // exactly that object
  spectrumOpacity: 0..1                                       // elevLayer opacity today (1 unless changed)
}
```

`view` (shared by every module):

```js
{ centerMerc: [x,y],   // Web-Mercator 0..1 (x east, y south), Float64
  zoom,                // fractional CSS zoom, Leaflet semantics (256 px tiles)
  bearing,             // degrees clockwise, leaflet-rotate map.getBearing()
  cssSize: [w,h], dpr, // canvas CSS size and devicePixelRatio
  dz }                 // 1 on HiDPI (devicePixelRatio>=1.5) else 0
```

Required fragment behaviour (port, don't reinvent — references in §8):
- Gradient: Sobel 3×3 on the height field exactly as the current
  `TerrainGpuRenderer` shader, divided by the ground distance of one physical
  pixel at the fragment's latitude: `mpp = 2πR·cos(lat) / (256·2^zoom·dpr)`,
  `R=6378137`. Then rotate (dx,dy) from screen axes to east/north by `bearing`.
- Shaded styles (hs, hsmulti, tint) divide by `reliefZFactor(mpp)`
  (`1+0.024·mpp^0.664`) like `reliefResolution()`; slope/aspect/contours use
  true `mpp`.
- **All 10 styles**: port the `TerrainGpuRenderer` fragment shader (including
  the `s*s` hsmulti fix, contour index lines and adaptive spacing).
- Spectrum, below/above bands, feather, outline: port `ElevationGpuRenderer`
  (index.html ~line 9040–9150) and match `CSPTerrainDrape.elevationColours`.
- Appearance: apply CSS `saturate()` then `contrast()` then `brightness()` to
  the **terrain** colour using the Filter Effects Level 1 formulas (that is
  what `applyTerrainAppearanceTo` does to the layer today), then terrain
  opacity. The spectrum has no filter.
- Composite: `out = spectrum ⊕ (terrain)` source-over, premultiplied alpha.
- No data (`!csp_valid`) → fully transparent for both.
- Tests may need a fixed ground resolution: a `u_groundResOverride` uniform
  (≤ 0 = compute from the view) is allowed and must default to 0.

### 4.2 `CSPGpuTerrainStore` — `gpu-terrain-store.js` (Workstream D)

One shared store of decoded **native** source tiles for both the terrain
style and the spectrum (today each layer fetches and resamples separately).

```js
const store = new CSPGpuTerrainStore.ElevationTileStore({
  sources: () => SourceSpec[],        // rebuilt by the app when elevationSourceOptions() changes
  request: (url, {signal, priority, group, kind}) => Promise<{grid:Float32Array,width,height,surveys?}>,
                                      // app wraps elevationRequests + fetchElevation/fetchPublicElevation
  mask: (grid, width, height, nativeCoords, source) => Float32Array,  // app supplies maskDnrGrid for DNR
  maxBytes                            // CPU budget; LRU evicts tiles not wanted in the last N frames
});
SourceSpec = { id, rank /*5 dnr,3 raw,2 national,1 overview*/, label,
               nativeZoom(displayZ) /* port of ElevLayer._loadTile */, url(z,x,y),
               allowed(displayCoords) /* e.g. dnrTileAllowed, shown>=13 */, group, sharper? }
store.want(displayTiles /*[{z,x,y}] at tile level incl. dz*/, {generation}) // dedupe, prioritise, abort unwanted
store.get(key)            // key = `${sourceId}/${z}/${x}/${y}` (native) -> TileRecord | undefined
store.finestFor(sourceId, displayCoords) -> TileRecord|undefined  // exact native tile or nearest resident ancestor
store.on("tile", fn(record)) / store.off(...)                     // fired after decode+mask
store.sampleAt(lng, lat) -> {value, rank, label, z} | null        // replaces readout loop (index.html ~10486)
store.gridForView({bounds, zoom, maxSide:640}) -> same shape as researchElevationGrid() today
store.settled(displayTiles) -> {complete, total, ratio, refining} // replaces waitForElevationLayer/readiness
store.provenance(displayTiles) -> {ranks:{1:n,2:n,3:n,5:n}, labels:[...], surveys:[...], sampleMeters:{rank:m}}
store.clear(); store.destroy();
TileRecord = {key, sourceId, rank, label, z, x, y, width, height, grid /*Float32 NaN=no data*/,
              sampleMeters, surveys, revision}
```

Port exactly from `ElevLayer._loadTile` (index.html ~9610–9700): source list,
native zoom rules, `shown>=13` raw/national gating, `refineOverview`, DNR
`acquire=0&revision=`, priorities/groups, the "first pass at on-screen zoom,
sharper next-zoom data at low priority" behaviour, and DNR masking in **native**
coordinates.

### 4.3 `CSPGpuTerrainEngine` — `gpu-terrain-engine.js` (Workstream E)

```js
const engine = CSPGpuTerrainEngine.create({canvas, store, shaders, maxTextureBytes, onNeedsFrame});
   // returns null when WebGL2/EXT_color_buffer_float/self-test is unavailable -> app falls back
engine.setState(state)              // §4.1 state; marks dirty
engine.render(view)                 // synchronous draw of one frame; returns {coverage:0..1, missing:n}
engine.neededTiles(view) -> [{z,x,y}]   // display tiles incl. rotation margin (also calls store.want)
engine.renderToCanvas(view, width, height) -> Promise<HTMLCanvasElement>  // export; tiles the render
                                    // when width/height exceed MAX_RENDERBUFFER_SIZE
engine.readProvenance(view) -> Promise<{ranks:{...}}>  // async (fenceSync + getBufferSubData), never stalls
engine.stats() -> {textures, textureBytes, drawCalls, lastFrameMs}
engine.destroy()
```

Responsibilities: texture LRU (R32F 256×256 per native tile, budget default
192 MB fine-pointer / 64 MB coarse-pointer), uploads on `store` "tile" events
(spread over frames, ≤ 4 ms of uploads per frame), ancestor UV-crop fallback,
pass 1 + pass 2, `EXT_color_buffer_float` RG32F height field (fallback: RGBA8
packed height, ≤ 1/256 m error, documented), context-loss handling (re-upload
from the CPU store on restore), a start-up self-test that compares a fixture
against `CSPTerrainRaster.renderRgba` / `CSPTerrainDrape.elevationColours`
and returns `null` on mismatch.

### 4.4 `L.CSPGpuTerrainLayer` — `gpu-terrain-layer.js` (Workstream L)

A Leaflet `L.Layer` (not a GridLayer) that owns the engine's canvas and is
the only thing `index.html` talks to:

```js
const layer = L.cspGpuTerrainLayer({store, state, zIndex:440}); layer.addTo(map);
layer.setState(state); layer.getEngine(); layer.getStore();
layer.sampleAt(latlng); layer.gridForView(); layer.settled(); layer.provenance();
layer.snapshotEntry(spec)   // used by composeSnapshot (export)
```

- Canvas placement: must stay correctly placed under **leaflet-rotate**
  (bearing), HiDPI, Leaflet zoom animation, and the app's **pane painting**
  (`paintPanes` scales `tilePane`/`overlayPane` during wheel/pinch; it fires
  `zoomanim` with `{center, zoom, noUpdate:true}` per painted frame). The layer
  redraws at the *painted* view each animation frame instead of being CSS-scaled.
- Z-order: terrain at 440 and spectrum at 450 today; verify nothing else draws
  in the tile pane between 440 and 450, then draw both in one canvas at 440.
- Redraw scheduling: one `requestAnimationFrame` per dirty state; idle when
  nothing changed.

## 5. App integration (Workstream L)

- Feature flag `gpu2d`: URL `?gpu2d=0|1`, then `localStorage["clearskies.gpu2d"]`,
  default **on** when `CSPGpuTerrainEngine.create` succeeds. Off → today's code
  path exactly (keep `AnalyticTerrainLayer`, `ElevLayer`, `terrainGpu`, `elevGpu`).
- Test hooks: set `document.documentElement.dataset.gpu2d = "on" | "off"` once
  the path is decided, and add `gpuTerrain: () => layer || null` to
  `window.ClearSkiesPortalBridge`. The V harness relies on both.
- `applyTerrain()` / `applyElev()` / `installTerrain()` / `clearTerrain()` use
  one shared `L.CSPGpuTerrainLayer` when on (style switch = `setState`, no swap).
- Replace every `_store` / per-tile-canvas consumer when on:
  readout (~10486), `researchElevationSource`/`researchElevationGrid`/
  `waitForElevationLayer` (~9780–9826), terrain status readiness (~7076),
  terrain source panel summary (~6940), `paintElevOut`, the
  `terLayer._store.forEach(... _paint ...)` repaint sites (~7124, ~9717, ~10219),
  and anything else found by `grep -n "_store\|_cspSourceCounts\|_cspHasContent\|cspElevationSource" index.html ui-system.js`.
- Export (`composeSnapshot`, ~4060): add a `{kind:"gpu-terrain"}` paint item
  ordered by the layer's z-index that draws `engine.renderToCanvas` at the
  export resolution and transform (north-up and rotated).
- Register new files everywhere a front-end script is registered (done on
  base by the wiring task; keep it consistent if you add files).

## 6. Workstreams and ownership

Every workstream runs in its own git worktree off `gpu2d/base`, commits to its
own branch, **does not push, merge, deploy, or touch the live service on
:8765**, and only edits the files it owns (other files: read-only; if a
change elsewhere is unavoidable, make it minimal and list it in the report).

| WS | Branch | Owns | Agent |
|---|---|---|---|
| S | `gpu2d/shaders` | `gpu-terrain-shaders.js`, `test-gpu-terrain-shaders.js`, `scripts/gpu2d/shader-parity.js` | Muse Wonder |
| D | `gpu2d/store` | `gpu-terrain-store.js`, `test-gpu-terrain-store.js` | Claude Opus 5.5 |
| E | `gpu2d/engine` | `gpu-terrain-engine.js`, `test-gpu-terrain-engine.js`, `scripts/gpu2d/engine-*.js` | GPT-6.1 Sol Ultra (Codex) |
| L | `gpu2d/layer` | `gpu-terrain-layer.js`, `index.html` integration, `ui-system.js` if needed | GPT-6.1 Sol Ultra (ChatGPT Work) |
| V | `gpu2d/verify` | `scripts/gpu2d/*.js` harness (not probes), `docs/gpu2d-baseline.md` | Grok 4.7 |
| M | (assigned by integrator) | exactly-specified mechanical edits | DeepSeek V4.1 Flash |

Parallel work against contracts: S, D, E, L, V start together. E and L code
against the §4 contracts and may use small local stubs for modules they do not
own; the integrator merges S → D → E → L → V and resolves seams.

## 7. Environment (this Mac)

- Node 20/24; repo uses no bundler for these modules (plain `<script>`).
- Dev server for your workstream (never port 8765):
  `HOST=127.0.0.1 PORT=<port> CSP_CACHE_DIR=/tmp/csp-<ws>-cache node server.js`
  Ports: S 8814, D 8813, E 8811, L 8812, V 8815. Stop it when done.
- Real-GPU browsers via Playwright (no install needed):
  - Chrome + Metal: `require("/Users/riley/.npm/_npx/31e32ef8478fbf80/node_modules/playwright").chromium.launch({channel:"chrome",headless:true,args:["--use-angle=metal","--enable-gpu","--ignore-gpu-blocklist"]})`
  - WebKit (Safari engine): `require("/Users/riley/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core").webkit.launch()`
  - Headless `chrome-headless-shell` uses SwiftShader (software) — do not use it for GPU parity or perf.
- Page hooks: `window.ClearSkiesPortalBridge.map` (Leaflet), `.map3d()`;
  `terrainGpu`, `elevGpu`, `terrainLighting` are script-scoped (not on
  `window`). The probes in `scripts/gpu2d/probes/` show how to expose them in a
  test by rewriting the served HTML with `page.route`.
- Test location: Columbia Plateau, WA — `[47.858,-118.33]` (hills + DNR coverage).
- Git in this repo can be slow; use `timeout` on git commands. If `git commit`
  hangs, retry once with `timeout 60`.
- `npm run verify` is what CI runs; keep it green on your branch.

## 8. Accuracy references

- Terrain styles: `CSPTerrainRaster.renderRgba(style,{grid,width,height,groundRes,lighting})` (terrain-raster.js)
- Spectrum/bands: `CSPTerrainDrape.elevationColours(elev,count,settings,out,...)` (terrain-drape-core.js)
- Resampling: `ElevationTileCore.resampleElevation(...,{smooth:true})` (elevation-tile-core.js)
- Rank merge: `CSPTilePipeline.ProgressiveGrid` (tile-pipeline.js)
- Current GPU shaders: `TerrainGpuRenderer`, `ElevationGpuRenderer` (index.html ~9035–9330)

## 9. Acceptance criteria

Measured by the V harness with Chrome+Metal and WebKit on this M2, flag on vs
flag off, same server cache state:

1. **Pan/zoom profile** (`prof.js` script): main-thread busy ≤ 20 % of
   baseline; ≤ 2 long tasks; none > 100 ms.
2. **Gesture smoothness**: during wheel zoom and drag pan, p95 rAF interval
   ≤ 16.7 ms (Chrome), ≤ 20 ms (WebKit); no frame below 98 % elevation
   coverage once any ancestor is resident.
3. **Settings**: lighting, appearance, opacity, style, spectrum and band
   changes paint within one frame with zero network requests.
4. **Visual parity** north-up at integer zooms 12/14/16/17/19/22 for all 10
   styles, spectrum and bands at 6 fixed views: ≥ 99 % of pixels within 3/255
   per channel vs flag-off once settled (contours: ≥ 97 % line IoU with 1 px
   tolerance). Document intentional differences (tile seams removed).
5. **Rotation**: bearings 0/37/90/180 — aspect colours and hillshade lighting
   stay geographically correct (compare against a north-up render rotated).
6. **Deep / fractional zoom**: sweep 12→28 in 0.25 steps; no blank frame.
7. **Memory**: GPU texture bytes stay under budget; JS heap stable over a
   100-move pan stress; canvas count no longer scales with tiles.
8. **Robustness**: `WEBGL_lose_context` lose → restore recovers in < 1 s;
   engine creation failure or `?gpu2d=0` → old path, identical behaviour.
9. **Feature parity**: cursor readout, research tools, terrain status panel,
   provenance labels, export (1×/2×/4×, rotated and north-up) all work.
10. `npm run verify` passes; new unit tests are part of `npm test`.

## 10. Report format (every workstream)

Final message must include: branch name and commit SHAs; files changed; any
contract change or addition; tests run with exact results; measured numbers
where relevant; known gaps; anything you edited outside your ownership.
