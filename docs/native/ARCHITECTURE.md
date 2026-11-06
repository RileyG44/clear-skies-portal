# ClearSkies on iPhone — architecture and implementation plan

Status: adopted 2026-11-05. Progress is tracked in [PROGRESS.md](PROGRESS.md).

This plan was consolidated from a four-model architecture review (four
independent plans, two review laps, author responses). The review files
themselves are not in the repository; references below such as
`grok/04-grok-response.md` or `deepseek/08` name those working papers.
Code claims marked **[V]** were checked against the repository when the
plan was written.

---

## 1. The answer in one paragraph

ClearSkies becomes one native iPhone app with no server, desktop, Tailscale or account requirement.

- **Engine.** A Rust engine (`csk-core`) runs inside the app process. It owns codecs, geodesy, source selection, sampling, provenance, storage policy, resumable jobs, the scientific kernels and sync semantics.
- **Platform layer.** Swift owns the platform: URLSession transport (foreground and background), BackgroundTasks, sandbox storage, memory-pressure signals, CloudKit and the Liquid Glass chrome.
- **Renderer.** The map is drawn by a Rust renderer (`csk-gpu`) on wgpu's Metal backend, into a native `CAMetalLayer`, with native gestures. Its shaders are generated from the existing GLSL, so the web client and the phone run the same terrain math from one source.
- **Transition.** The current WKWebView map stays as the canvas until each native mode passes its parity and performance gates. During that period it is fed by the in-app engine instead of the Dell.
- **Sync.** User state syncs through the user's own iCloud (CloudKit private database). There's no ClearSkies account, and a user-chosen folder serves non-Apple devices.
- **WA DNR mirror.** An optional mirror operated by ClearSkies may accelerate WA DNR if the licence allows. The phone never depends on it.
- **Reuse elsewhere.**
  - Electron moves onto the same core through napi-rs.
  - The web client keeps its WebGL renderers and gains the core as WASM.
  - A future Android app reuses the core and the wgpu renderer.

---

## 2. Your six questions, answered

**Q1 — What's the best option technically, ignoring effort?**
Native code in the app process, without exception.

- **Rejected: embedded Node and JavaScriptCore.** Neither gets a JIT on iOS (believed, high).
- **Rejected: WKWebView workers and WASM as the engine.** They're tied to WebKit's separate process: its memory limit, its suspension, and a copy across process boundaries for every tile.
- **Language: Rust for the engine.** It's memory-safe at the untrusted-file boundary, and it's portable to desktop, web (WASM) and Android.
- **GPU: Metal through wgpu.** wgpu is the default because it gives one renderer for iOS and Android.
  - A raw-Metal backend built from the same shader IR is funded as a comparison from phase 0.
  - On the flagship phone, a reproducible frame-time regression above 10% makes Metal the iOS backend. Whichever is faster ships.
- **The map leaves the web view in the end.** The reasons are measurable:
  - The web view adds an inter-process hop and a copy for every tile.
  - It runs under a separate memory limit; iOS kills the WebKit process independently.
  - It can't run durable background work.
  - Its input and frame pacing aren't the app's to control.

  The old "WebKit is capped at 60 fps" argument is downgraded to *believed, medium*. The decision doesn't rest on it.

**Q2 — A single mobile download with everything?**
Yes. Every capability the Dell provides today has an on-device design, including WA DNR, raw 1 m USGS, offline areas, analysis, shared markup and export. What can't be promised on iOS:
- exact background start times;
- uninterrupted multi-hour background CPU;
- completion after the user force-quits;
- acting as an always-on server for other devices.

The design works within those limits:
- **Durable downloads:** background URLSession.
- **User-started processing:** iOS 26's `BGContinuedProcessingTask`, with real progress.
- **Maintenance:** opportunistic `BGProcessingTask` runs.
- **Resumable work:** a job journal that breaks everything into byte-bounded, resumable units.
- **Honest UI:** the app always says which state a job is in: downloaded, processed, committed offline, or paused.

**Q3 — Does chunked/streaming processing hurt performance?**
No. Within a fixed memory budget it's how this work runs fastest:
- **Cache locality:** small tiles stay in fast memory, whole rasters don't.
- **Parallelism:** independent blocks decode on several cores at once.
- **First pixels sooner:** useful output appears before the whole file is read.

The real costs are small and planned for:
- bookkeeping;
- a one-pixel halo around tiles for slope and hillshade;
- re-reading compressed bytes in old strip-layout TIFFs.

WA DNR data is converted once, at import, into a tiled layout, so later panning never pays the strip cost again.

**Q4 — What's the best-performing storage and data design?**
- **Six storage tiers:**
  - GPU and RAM, under one memory governor;
  - a disposable cache in `Library/Caches`, which iOS may clear;
  - prepared DNR data in Application Support, excluded from backup;
  - pinned offline areas;
  - user work, kept separate;
  - per-job staging space.
- **Formats:**
  - elevation stays lossless float32 metres;
  - derived tiles are stored zstd-compressed;
  - raw upstream bytes are kept unchanged.
- **One storage governor** admits work only if this fits: reserve + every active job's peak + pinned data + the cache floor.
- **Cellular:** bulk downloads wait for Wi-Fi unless the user opts in for that job. Raw 1 m detail on cellular is a setting. Automatic WA DNR acquisition needs an estimate and consent, or an unmetered network.
- **Cloud tier:** a ClearSkies-operated DNR mirror would beat pure on-device performance for sparse viewing of ZIP-packaged sources. It stays optional and licence-gated, and full on-device acquisition remains a release requirement.

**Q5 — How do apps save user state without an account?**
They ride on the platform account the user already has.

- **On Apple devices:** CloudKit's private database is tied to the user's Apple ID. The app needs no login, and the storage counts against the user's iCloud, not ours.
  - `CKSyncEngine` is Apple's modern sync driver for it.
  - Small preferences go in `NSUbiquitousKeyValueStore` (about 1 MB total).
- **Off Apple:** sync through a folder the user picks (iCloud Drive, Dropbox, WebDAV) or file export.
- **Local first:** everything works fully offline and signed-out.
- **Optional:** Sign in with Apple isn't needed for any of this.

**Q6 — Is anything genuinely infeasible on an iPhone?**
No current scientific feature. What can't be copied literally is the desktop's operating model:
- a Node worker pool with desktop heap limits;
- unattended multi-hour background jobs;
- a 15–20 GB cache plus a 32 GB DNR store by default;
- a phone serving other devices.

Each has a replacement: a bounded native executor, resumable jobs, adjustable allocations, and per-device engines that share only user state.

---

## 3. Rulings on what the seats still disputed

| # | Question | Positions | Ruling | Why |
|---|---|---|---|---|
| R1 | Native renderer stack | Muse/DeepSeek originally MapLibre Native + Metal; Grok/Opus wgpu. Lap 2: all four accept wgpu by default. | **wgpu (Metal backend) by default.** A same-IR raw-Metal comparator is funded in phase 0. MapLibre Native is a host comparator only. | The app's basemap and labels are raster images (`app/map.js:BASEMAPS`), so MapLibre's vector strengths are unused. wgpu also gives Android its renderer. |
| R2 | wgpu vs raw Metal threshold | Muse and DeepSeek: a 10% regression is unacceptable. Opus: a bounded swap. | **Winner ships.** A reproducible >10% sustained frame-time regression on the 15 Pro Max, or a capability that wgpu can't reach maintainably, makes Metal the iOS backend. Judged on p95/p99 frame time, touch-to-photon latency and energy. | You asked for best-in-class on the flagship. Sharing code with Android doesn't justify a measured iPhone regression. |
| R3 | Overturn criterion for the native map | Opus/Muse: global. DeepSeek: 2D only. | **2D only.** If the WebKit canvas with elev32 tiles meets p95 ≤ 8.33 ms in cached pan, input latency within the agreed margin of native, and has no terrain-caused WebContent kills, native 2D becomes optional. Native 3D, points and studio still proceed. | It's honest about the biggest cost, without letting a 2D result cancel 3D work the product needs. |
| R4 | Markup sync unit | Grok-seat: per-feature Automerge docs. DeepSeek final: per-feature CloudKit records with three-way merge. Opus/Muse/DeepSeek lap 2: one doc per layer. | **One Automerge document per layer**, features keyed by `fid`. CloudKit and the folder transport both carry immutable change chunks plus periodic snapshots. The layer catalogue and each saved area are separate documents. | Splitting a line is one user action that deletes one feature and creates several (`markup.js:1375` **[V]**). Per-feature records would let another device see half of it. |
| R5 | Sync fallback | — | If Automerge misses its budget at 20,000 features (load, merge, history, binary size, licence), fall back to DeepSeek's per-feature record protocol (`deepseek/08` §2.4.4). Its multi-feature edits are then grouped by a batch ID, and partial batches are hidden. | It keeps a designed fallback that never silently loses edits. |
| R6 | DNR ingest strategy | Single streaming pass vs. staging to disk. | **zran seek index** over deflated ZIP members, built in one pass. A temp-file staging path is the first implementation and the fallback. | It handles TIFFs whose metadata sits after the pixels and blocks stored out of order, under strict memory limits. |
| R7 | Local DNR storage format | Strict COG + libtiff writer vs. local tiled TIFF + Rust writer. | **A local tiled, multi-level TIFF.** Header space is reserved up front and tiles are appended in production order. It uses Deflate with the floating-point predictor, so `cog.js` can still read it. A narrow Rust writer produces it, and GDAL validates it in CI. Strict COG is only for the server-side mirror. | Peak disk drops to ZIP + output + index + scratch, below today's ZIP + TIFF + overviews (`wadnr.js:259`). It also avoids an FFI to libtiff. |
| R8 | Wire format during transition | Content negotiation vs. a distinct path. | **A distinct `/api/elev32/{z}/{x}/{y}` route.** It returns a 16-byte aligned header plus float32 body. Existing `.png` routes stay unchanged. | The `<img>` tags and 3D `createImageBitmap` consumers can't negotiate, and the S3 fallback regex is anchored at `.png$` (`app/elevation.js:525`). |
| R9 | Science port timing | Originally after the native map. | **In parallel with phases 3–6.** Each mode is drawn by exactly one renderer and switched whole, never composited. A *visible* web research mode is fine during transition; a hidden WebView kept alive for compute is not. | Science depends on the core and `research-contract.js`, not on the renderer. |
| R10 | Projections | PROJ vs. proj4rs. | **Bake-off in phase 1; PROJ is the predicted winner.** It shares the app's SQLite, ships a trimmed `proj.db` with no grids, fails closed, and is pinned to reproduce proj4js results. | Coverage of every branch in `dnr-raster-source.mjs:projection` decides it. |
| R11 | Shader toolchain | naga's GLSL front end vs. glslang. | **glslang → SPIR-V → naga (WGSL for wgpu) and naga/spirv-cross (MSL for the comparator).** Sources are extracted from the authoritative JS shader factories, and generated output is checked in. One core program is hand-ported as a reference. | It proves floored `mod`, NaN behaviour and uniform layout on all styles. |
| R12 | Tile-delivery latency target | 20 ms vs. 8.3 ms p95. | **p95 ≤ 8.3 ms, p99 ≤ 16.7 ms** for in-app tile delivery during a fling. | At 120 Hz, 20 ms drops two frames. If the target is missed, diagnose delivery vs. decode; don't relax it. |
| R13 | Calendar estimates | DeepSeek: "week 24 / month 12–13". | **Dropped.** Phases have exit gates, not dates. | Those figures assumed two human engineers working full time. That doesn't match how this project is built. |

---

## 4. Architecture

### 4.1 Components

| Component | Language | Owns | Ported from |
|---|---|---|---|
| `csk-core::geo` | Rust (+ PROJ via FFI) | CRS, GeoKeys, WKT, pixel-centre conventions, UTM lattice, vertical units | `dnr-raster-source.mjs:projection/verticalMeters`, `usgs.js:utmGrid` |
| `csk-core::codec` | Rust (+ Esri LERC C++ and laz-perf via bounded FFI) | TIFF/BigTIFF, LZW/Deflate/predictors, LERC, LAZ, ZIP64/CRC, zran, row-streaming strip decoder, local tiled-TIFF writer | `cog.js`, `usgs.js:readCogHeader/cogTile`, DNR runtime |
| `csk-core::sources` | Rust | USGS index and coverage, WA DNR catalogue and portal session, Oregon, national/overview, small proxies (FIRMS, SNODAS, geology), best-source ranking and provenance | `usgs.js`, `wadnr.js`, `engine/terrain.js`, `engine/oregon.js`, `engine/proxies.js` |
| `csk-core::store` | Rust (rusqlite) | SQLite/WAL index, inline blobs plus segment files, pins, budgets, storage governor | `cache-budget.js`, `engine/tile-cache.js` (policies, not the filesystem scanning) |
| `csk-core::jobs` | Rust | Platform-neutral journal and job graph, checkpoints, atomic publish | `engine/downloads.js`, `wadnr.js` warm jobs |
| `csk-core::science` | Rust | Fabric, research, terrain analysis, glacial products, research contract | `research-analysis.js`, `terrain-analysis-core.js`, `glacial-*.js`, `research-contract.js` |
| `csk-core::raster` | Rust | CPU reference rendering, Terrarium/style PNG for image-only consumers, snapshot validation | `terrain-core.js`, `terrain-raster.js`, `engine/snapshot.js` |
| `csk-sync` | Rust (Automerge) | Layer documents, `fid` migration, change chunks and snapshots, transport protocol, GeoJSON as an interchange view | `markup.js`, `engine/markup-store.js` |
| `csk-gpu` | Rust (wgpu) | Map scene, raster pyramid, height/rank field and analytic shading, 3D mesh and drape, EPT points with EDL, offscreen export, texture residency | `gpu-terrain-*.js`, `app/terrain-3d.js`, `point-cloud-*.js` |
| `LocalEngine` | Swift + Rust | Transition router: every `server.js` route, method, status, header and health field, with per-route ownership | `server.js`, `engine/*.js` |
| Platform layer | Swift | URLSession (foreground and background), BackgroundTasks, storage locations, memory/thermal signals, CloudKit (`CKSyncEngine`), key-value store, `CAMetalLayer` and display link, gestures | `ios/Sources/*` |

**Hot tile buffers** cross the Rust/Swift boundary through a C ABI. The handle is opaque, reference-counted, read-only and aligned, with retain/release, and Rust owns the bytes. **Control messages** use UniFFI. Tile data never becomes JSON or auto-marshalled arrays.

### 4.2 Data path

- **End state:** URLSession bytes or cached bytes → Rust validates and decodes the block → budgeted float32 grid plus validity, rank and provenance → render queue → wgpu texture upload → resident `R32Float` height plus rank/validity → height-field pass → shading pass.
  - There's no PNG and no inter-process hop. Upload staging copies still exist and are counted; nobody claims "zero copy" without measuring it.
- **Transition:** the same engine, then `SiteSchemeHandler` serves `/api/elev32/...` to the WebView. Its client decodes in `terrain-drape-worker.js` and transfers ArrayBuffers instead of cloning them.

### 4.3 The transition elevation format (`application/vnd.clearskies.elev32`)

| Offset | Field |
|---|---|
| 0–3 | ASCII `CSE2` |
| 4 | u8 version = 1 |
| 5 | u8 flags (bit 0 = zstd payload; disk only, never on the wire) |
| 6–7 | u16 LE header bytes = 16 |
| 8–9 | u16 LE width |
| 10–11 | u16 LE height |
| 12–15 | u32 LE reserved = 0 |
| 16… | f32 LE row-major metres, top-left first; NaN = invalid |

- **Validation:** the engine that produces a tile validates every value. The page checks only the header and the length.
- **Headers:** responses keep all existing headers:
  - `X-Coverage`, together with `Cache-Control: no-store` as the provisional-absence signal (`app/elevation.js:512–515`);
  - `X-Elevation-Source`, from which 3D derives its rank (`app/terrain-3d.js:625`);
  - `X-Ground-Res`, `X-USGS-Sources`, `X-DNR-Sources`, `X-Oregon-Sources`;
  - the DNR revision and status headers.
- **Disk:** the same container, with the zstd flag set.

### 4.4 Ingest access plan (WA DNR)

Adopted from `deepseek/08` §2.4.3 with the R6/R7 rulings.

**Observed 2026-11-06:** the direct DNR portal streams a generated ZIP and ignores
byte ranges. The initial direct path therefore downloads to a bounded staging file
before reading its central directory. King County East 2021 already contains tiled,
multi-level BigTIFFs: read those in place, preserving their original samples, rather
than transcoding them. Range-based access below applies only to an upstream that
actually supports it. Unsupported projection/units and oversized strip blocks fail
closed until their codec path is implemented.

1. **Central directory.** Read the ZIP end-of-central-directory record and Zip64 locator with two range reads.
   - Reject encrypted members, unknown compression methods, and paths that escape the staging folder ("zip-slip").
   - Enforce limits on compressed size, uncompressed size and member count.
2. **Per member:**
   - **Small (≤ 8 MiB):** read or inflate into memory and verify the CRC.
   - **Large, stored:** range-read directly.
   - **Large, deflated:** build a zran checkpoint table once: the last 32 KiB of output every 16 MiB, about 4 MB per 2 GB member, saved per member hash. Reads seek once, then scan forward, with requests processed in ascending offset order.
3. **Row-streaming strip decoder:** compressed strip ≤ 4 MiB, plus a 16-row ring buffer, plus the destination tile. Predictor state is kept across rows. Tiled TIFFs decode tile by tile.
4. **Validate before publishing:** CRS, orientation, band count, units, nodata, and the dataset-1543 vertical correction applied exactly once.
   - Decode is bit-exact to the JS pipeline: f64 vertical-scale multiply, then f32 store (`dnr-raster-source.mjs:151`).
   - Overviews (4/16/64/256) follow `buildOverviews`' valid-sample arithmetic.
5. **Very wide sources:** level-1 overviews are built in 4,096-column strips, with byte-bounded accumulators. This closes DeepSeek's open item §5.4.
6. **Work units:** discretionary background work is split into byte-bounded row bands *before* scheduling. A unit that can't fit a background grant runs only under `BGContinuedProcessingTask` or in the foreground.
7. **Crash-safe publish:**
   - stage the output and fsync it;
   - validate every tile through the production decoder;
   - one SQLite transaction is the commit point;
   - sweep orphaned staging folders at launch.
8. **Portal session:** the DNR portal needs a cookie. The background download carries the cookie from the session-seeding GET explicitly, since the bundled runtime GETs `/` before downloading.
9. **Disk bound:** ZIP + output + zran index + scratch, plus temp-file staging only on the fallback path. Phase 4 measures the real peak.

### 4.5 Background jobs

The journal stages are: planned → transfer → verify → prepare-source → transcode → validate → commit. There are also paused, cancelled and error states, with byte counts throughout.

| Work | Mechanism |
|---|---|
| Current-view tiles | Foreground URLSession lanes per host and source; superseded requests are cancelled, while shared requests stay alive for other consumers |
| ZIPs and large offline batches | Background URLSession, recreated by identifier; finished files move into job storage at once |
| User-started ingest and offline builds | `BGContinuedProcessingTask` submitted from the tap, with real progress |
| Deferred chunks, cleanup, index repair | `BGProcessingTask` |
| Offline COG reads | Batched by file, revision and nearby byte ranges, with a limited number of tasks in flight |

"Ready to ingest" is the normal state after a long download finishes. The plan doesn't assume a continued task is still alive by then.

### 4.6 Memory

- **One governor** admits scratch, decoded output, queued uploads, analysis scratch, ingest buffers and GPU textures together.
- **Starting limits (to be calibrated):**
  - ingest-owned memory ≤ 256 MiB;
  - a materialised decode unit ≤ 32 MiB;
  - textures about 96 MiB in 2D, 64 MiB in 3D, while WebKit is still in the process.
- **Checks:** `os_proc_available_memory()` is read before growing. Under pressure the app drops off-screen textures, stops prefetch, reduces point detail and pauses ingest.
- **Files** are read through memory maps or bounded reads; a whole raster is never loaded into memory at once.
- **Fix to carry over:** today the 128 MiB coarse-pointer budgets are set at `app/terrain-sources.js:initGpuTerrain`, so that's where they change.

### 4.7 Storage

These are the defaults; all are user-adjustable.

| Tier | Location | Default |
|---|---|---|
| Disposable source/derived cache | `Library/Caches` | 4 GiB |
| Prepared DNR (unpinned) | Application Support, excluded from backup | 6 GiB, LRU |
| Pinned offline areas | Application Support | user-chosen, with estimates |
| User work | Application Support (user state) | separate from caches |
| Job staging | Application Support (jobs) | reserved per job |

- **Reserve:** `max(2 GiB, min(8 GiB, 5% of volume))`. The governor admits only `reserve + Σ active-job peak + pinned + cache floor`.
- **Area estimates** are source-aware since #97 (`app/areas.js:warmTileBytes`). They become format-aware again when elev32 tiles land: float32 tiles are roughly 64–128 KiB each after zstd.

### 4.8 Sync

- **Documents:** one Automerge document per markup layer, features keyed by `properties.fid`. The layer catalogue and saved-area definitions are separate documents.
- **Merge rules:**
  - properties merge per key;
  - geometry is replaced whole, and when two devices change it at once both versions are kept for an explicit choice;
  - a delete that's concurrent with an edit hides the feature but keeps the content for recovery;
  - convergence never depends on device clocks.
- **Transports:**
  - CloudKit private zone, through `CKSyncEngine`, carrying immutable change chunks plus snapshot assets;
  - a user-chosen folder or WebDAV, carrying the same chunks, written append-only;
  - `NSUbiquitousKeyValueStore` for an allowlist of small settings.

  No transport invents its own merge rule.
- **What syncs:** saved-area definitions sync; pinned terrain and job progress stay on each device.
- **Migration:** existing layers come off the engine (Dell or desktop) through a read-only import, then verification. Local authority is enabled last.

### 4.9 Clients beyond iOS

- **Electron** keeps its HTTP host and renderers, and swaps in core functions through napi-rs one at a time as each passes its parity tests. Its markup imports into the sync model.
- **Web (Pages)** keeps WebGL and its public sources, and gains WASM codecs and science. It can get WA DNR from the mirror if licensed. It can sync through CloudKit JS or WebDAV.
- **Android** reuses `csk-core`, `csk-sync` and `csk-gpu`, with a Kotlin host.

---

## 5. Build order

Each phase has exit gates, not dates.

| Phase | Deliverable | Exit gate |
|---|---|---|
| **0 — Evidence** | Device baseline (15 Pro Max plus a minimum device, proposed iPhone 13/A15); the wgpu vs raw-Metal spike; DNR licence check; background-grant and storage experiments; replay corpus; inventory of every route and client contract | The spike measures tile memory and imageblocks, display-link presentation, pipeline-compile hitches, `R32Float` sampling, readback, purgeability and raster-label compositing. Every current feature has a target component. |
| **1 — Core** | Codecs, geodesy bake-off, tile ABI, SQLite store, CPU raster/PNG reference | Bit-exact decode; tilted-plane registration < 0.01 px; the lattice test (`test-usgs-render.js`) passes |
| **2 — Local USGS behind the current map** | `LocalEngine`, `/api/elev32`, health, raw 1 m. **Engine detection:** page side done in #97; set `WebHost.builtInEngine` once `LocalEngine` answers | Raw 1 m works with no Dell; loading-order and provisional-coverage contracts pass |
| **3 — Remaining sources and exports** | National/overview, Oregon, FIRMS, SNODAS, geology, snapshots, a bundled national USGS index | Every source and export works from the phone with truthful metadata |
| **S — Science port** (parallel with 3–6) | Fabric, research, terrain analysis, glacial products | All 20 products match their goldens up to the 524,288-cell contract maximum |
| **4 — Direct WA DNR** | §4.4 in full | Stripped, tiled, late-IFD and deflated fixtures ingest within the measured peak disk; interruption keeps completed work; DNR works offline without the mirror |
| **5 — Offline jobs and policy** | §4.5–4.7, estimator, cellular rules, consent for automatic DNR | Kill at every stage, relaunch and converge; airplane mode works for saved areas |
| **6a — Local markup and full route inventory** | Local markup, `fid` migration, every route | The whole capability checklist passes with the Dell off and the mirror disabled |
| **6b — Sync** | §4.8 | Four replicas, random operations, CloudKit and folder: identical final state, no silent loss, no resurrected deletes. **M1 — single download, full capability** (still drawn by the WebView map) |
| **7 — Native 2D** | Map scene, raster pyramid, analytic shading, gestures, attribution; **rebinding the chrome off `app/bridge.js`** (883 lines, called from `ShellModel.swift` and `WebHost.swift`) | Pixel parity; p95 ≤ 8.33 ms in cached pan; the 2D overturn criterion (R3) is evaluated here |
| **8 — Native interaction** | Markup editing, measurement, search (`location-search.js`), imagery/scene search including overpass projection (`app/results.js`, `app/scenes.js`), geology identify, layers, offline UI, share links (`share-state.js` round-trip with web), published-hillshade raster class | Workflow parity against the named inventory |
| **9 — Native 3D and points** | Mesh and drape, EPT/LAZ, EDL, classification, linked cameras | 60 Hz minimum and a 120 Hz target on ProMotion; EPT/LAZ throughput and EDL parity gates |
| **10 — LiDAR studio and exports** | Studio tools and composited exports | User-flow parity |
| **11 — Retire WebKit from the map** | Remove the fallback once its dependencies are proven gone; `sw.js` is replaced by native offline, not ported | The full inventory passes with the old client unavailable. **M2 — end state** |
| **A — Optional DNR mirror** | Server-side strict COGs, immutable manifests | Licence permits; losing the mirror proves the direct path still works |
| **B — Client convergence** | Electron napi-rs, web WASM, Android host | Parity per component before each swap |

---

## 6. Accuracy and test gates

- **Decode:** bit-exact, including the vertical-unit scale. 1e-3 m applies only where the order of operations legitimately differs.
- **Sampled grids:** max |Δ| ≤ 1e-3 m and mean ≤ 1e-5 m against the JS reference.
- **Registration:** a synthetic tilted plane must recover an offset under 0.01 px, plus the existing lattice gate.
- **Projections:** within 1 mm horizontal against EPSG/NGS points, and matching proj4js on every DNR CRS branch.
- **GPU:**
  - ≤ 1/255 per channel on identical-grid fixtures;
  - scenes at SSIM ≥ 0.995, with ≤ 3/255 difference on 99.9% of pixels;
  - 3D summit heights within 1 m.
- **Test layers** (from `deepseek/08` §2.4.5):
  - **L0:** unit and property tests;
  - **L1:** frozen goldens generated once from the current Node engine;
  - **L2:** nightly differential tests against the Node server;
  - **L3:** on-device tests: fling, offline build, background + force-quit + resume, a 30-minute soak.
- **Contracts as release gates:** scientific loading contracts (`docs/ENGINEERING_REVIEW.md`, `test-elevation-loading.js`): no lower-ranked late data overwrites detail, and an overview is never labelled LiDAR.
- **Faults:** malformed TIFF/ZIP/LERC/LAZ, disk full, expiry at every job stage, GPU device loss, memory pressure.

---

## 7. Done first, in today's app

Shipped in #97 ahead of phase 0:

1. **Markup conflicts keep both versions.** A 409, or edits on two devices since the last save, now keeps this device's work as "<name> (conflict copy)" instead of discarding it or overwriting the other device (`markup.js`). Phase 6b replaces this with merged sync.
2. **Offline-area estimates are source-aware** (`app/areas.js`): measured ~80 KB per elevation tile, a second tile from z13 for raw 1 m, two rendered images for WA DNR.
3. **The app can report a built-in engine.** The page probes `/api` when `CSPNativeHost.builtInEngine` is true (`app/terrain-sources.js:engineExpected`); `WebHost.builtInEngine` flips when `LocalEngine` answers in phase 2.

---

## 8. Risks and the measurements that settle them

| Risk | Settled by |
|---|---|
| wgpu overhead on the height→shade two-pass design | Phase-0 spike: same scene in wgpu and raw Metal; split CPU submit, GPU time, compile hitches and energy |
| iOS refuses or shortens background time for ingest | Phase-0/5 grant measurements; the design degrades to foreground plus `BGProcessingTask` |
| DNR licence forbids a mirror | Phase-0 terms check; the direct path is a release requirement either way |
| zran dependency (`inflatePrime`) or checkpoint correctness | Phase 4; temp-file staging is the first implementation |
| PROJ size or coverage | Phase-1 bake-off on the projection corpus |
| Automerge cost at 20,000 features | Phase-6b benchmark; R5 fallback |
| Shader translation drift (floored `mod`, NaN) | Phase-0/1 toolchain proof on all styles plus a custom style |
| Unscheduled UI surface (analysis, studio, chrome) | The phase-0 inventory, and the phase 7/8 rebind of `bridge.js` |
