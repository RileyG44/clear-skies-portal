"use strict";

const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname,"..");
const read = name => fs.readFileSync(path.join(root,name),"utf8");

const index = read("index.html");
const inline = [...index.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
assert(inline.length>=2,"expected Leaflet and application inline scripts");
inline.forEach((match,i)=>new vm.Script(match[1],{filename:`index.html#inline-${i+1}`}));

// Exercise the STAC normalizer as JavaScript, not just as parsed source. This
// catches accidental cross-function locals (for example nativeMax) that only
// fail when a real catalog feature is normalized in the browser.
function namedFunction(source,name){
  const start=source.indexOf(`function ${name}(`);
  assert(start>=0,`missing function ${name}`);
  const body=source.indexOf("{",start);
  let depth=0, quote=null, escaped=false;
  for(let i=body;i<source.length;i++){
    const ch=source[i];
    if(quote){
      if(escaped) escaped=false;
      else if(ch==="\\") escaped=true;
      else if(ch===quote) quote=null;
      continue;
    }
    if(ch==='"'||ch==="'"||ch==='`'){ quote=ch; continue; }
    if(ch==="{") depth++;
    else if(ch==="}" && --depth===0) return source.slice(start,i+1);
  }
  throw new Error(`unterminated function ${name}`);
}
const normSandbox={
  COLL:{"sentinel-2-l2a":{label:"Sentinel-2",gsd:10,kind:"Optical"}},
  LOC:null, TITILER:"https://example.invalid/", NISAR_GIBS:"",
  safeHttpUrl:value=>value||null
};
vm.runInNewContext(`${namedFunction(index,"norm")}; normalized=norm({
  id:"scene-1", collection:"sentinel-2-l2a", bbox:[-122,46,-121,47],
  geometry:{type:"Polygon",coordinates:[]},
  properties:{datetime:"2026-08-22T12:00:00Z","eo:cloud_cover":4}, assets:{}
},{key:"pc",name:"Planetary Computer"});`,normSandbox,{filename:"index.html#norm-test"});
assert.equal(normSandbox.normalized.nativeMax,null,"ordinary STAC scenes default nativeMax to null");

new vm.Script(read("sw.js"),{filename:"sw.js"});
new vm.Script(read("mosaic-core.js"),{filename:"mosaic-core.js"});
new vm.Script(read("terrain-core.js"),{filename:"terrain-core.js"});
new vm.Script(read("terrain-raster.js"),{filename:"terrain-raster.js"});
new vm.Script(read("elevation-bands.js"),{filename:"elevation-bands.js"});
new vm.Script(read("elevation-tile-core.js"),{filename:"elevation-tile-core.js"});
new vm.Script(read("wa-archaeology.js"),{filename:"wa-archaeology.js"});
new vm.Script(read("glacial-research-core.js"),{filename:"glacial-research-core.js"});
new vm.Script(read("research-analysis.js"),{filename:"research-analysis.js"});
const versionSandbox={};
vm.runInNewContext(read("version.js"),versionSandbox,{filename:"version.js"});
assert.match(versionSandbox.CSP_BUILD,/^\d{4}-\d{2}-\d{2}[a-z]$/,"build version must be date plus revision letter");
assert(index.includes(`<script src="version.js?build=${versionSandbox.CSP_BUILD}"></script>`),
       "page must cache-bust and load the shared build version");
assert(index.includes('<script src="mosaic-core.js"></script>'),"index must load the tested mosaic core");
assert(index.includes('<script src="terrain-core.js"></script>')&&index.includes('<script src="terrain-raster.js"></script>'),
       "index must load tested terrain primitives and the deterministic display rasterizer");
assert(index.includes('<script src="elevation-bands.js"></script>'),"index must load the tested elevation-band core");
assert(index.includes('<script src="elevation-tile-core.js"></script>'),"index must decode packed elevation before resampling");
assert(index.includes('<script src="wa-archaeology.js"></script>'),"index must load the public-safe archaeology index");
assert(index.includes('<script src="glacial-research-core.js"></script>'),"index must load geomorphology primitives");
assert(index.includes('<script src="research-analysis.js"></script>'),"index must load the shared analysis dispatcher");
assert(read("sw.js").includes(`const CSP_BUILD = "${versionSandbox.CSP_BUILD}";`),
       "service worker cache namespace must use the page build version");
/* Shipping a fix is not the same as anyone receiving it. Same-origin assets are
   served cache-first and the worker calls skipWaiting(), so a new build takes
   the controller while the open page keeps running old HTML - and an installed
   PWA can sit backgrounded for days making no navigation at all. Without a
   prompt the only way through is knowing to force-quit the app. */
assert(/navigator\.serviceWorker\.addEventListener\("controllerchange"/.test(index),
       "a new worker taking control is the signal that the open page is stale");
assert(/if\(hadController\) offerNewBuild\(\)/.test(index),
       "the first worker ever taking control is not an update and must not interrupt");
assert(/document\.addEventListener\("visibilitychange",recheck\)/.test(index)&&
       /registration\.update\(\)/.test(index),
       "a backgrounded PWA makes no navigations, so it must re-check on the way back in");
assert(index.includes('id="newBuildReload"'),"the update prompt must offer a reload");
/* A layout failure that only appears on a real phone cannot be reasoned about
   from a desktop. Whether the page fills the window and whether the window
   fills the screen are two different failures with two different fixes, and a
   photograph cannot tell them apart - so the device reports them itself. */
assert(index.includes('page fills window')&&index.includes('window fills screen'),
       "the build stamp must separate a short page from a short web view");
assert(index.includes('id="buildDiag"'),"the geometry readout must be reachable from the build stamp");
assert(index.includes('register("sw.js",{updateViaCache:"none"})'),
       "service-worker imports must bypass stale HTTP cache during update checks");
assert(index.includes('id="snapshot"'),"map snapshot control must be present");
assert(index.includes('id="snapshotPanel"')&&index.includes('id="snapshotScale"')&&index.includes('id="snapshotSave"'),
       "map export must expose a direct PNG-resolution chooser");
assert(!index.includes('getDisplayMedia')&&index.includes('composeHighResolutionSnapshot')&&
       index.includes('snapshotEl.onclick=()=>setSnapshotPanel(snapshotPanel.hidden)'),
       "map export must render directly instead of rejecting macOS window capture");
assert(index.includes('SNAPSHOT_PRESETS')&&index.includes('sourceSteps')&&index.includes('snapshotLayerTileUrl')&&
       index.includes('SNAPSHOT_MAX_TILES=720'),
       "higher-resolution exports must request bounded source tiles for the current geographic extent");
assert(index.includes('touchShare=matchMedia("(pointer: coarse)").matches')&&
       index.includes("Downloaded ${name} to this browser's Downloads."),
       "desktop map exports must download without invoking a system share sheet");
const snapshotRangeSandbox={};
vm.runInNewContext(`${namedFunction(index,"snapshotWorldY")}; ${namedFunction(index,"snapshotTileRange")};
  regional=snapshotTileRange({getWest:()=>-120,getEast:()=>-119,getNorth:()=>48,getSouth:()=>47},10);
  dateline=snapshotTileRange({getWest:()=>179,getEast:()=>-179,getNorth:()=>1,getSouth:()=>-1},4);`,
  snapshotRangeSandbox,{filename:"index.html#snapshot-range-test"});
assert(snapshotRangeSandbox.regional.x1>=snapshotRangeSandbox.regional.x0&&snapshotRangeSandbox.regional.y1>=snapshotRangeSandbox.regional.y0,
       "high-resolution export must cover every tile in an ordinary current viewport");
assert(snapshotRangeSandbox.dateline.x1>=snapshotRangeSandbox.dateline.x0,
       "high-resolution export must preserve an extent crossing the antimeridian");
assert(index.includes('setView([47.1301,-119.2781], 9)'),"Moses Lake must remain the default terrain test view");
assert(index.includes('placeholder="Search a place, or 47.1301, -119.2781"'),"Moses Lake coordinates must be the visible search default");
assert(index.includes('id="srvConnect"'),"terrain engine needs an explicit connect control");
assert(index.includes('id="srvCopyLink"'),"terrain engine needs a private setup-link control");
assert(index.includes('takeSharedServerBase'),"private setup links must be consumed from URL fragments");
assert(index.includes('id="elevSpan"'),"elevation spectrum needs a configurable colour span");
assert(index.includes('list="elevSpanPresets"'),"elevation span must accept custom feet values with presets");
assert(index.includes('nationalEndpoint:"/api/elev/national",rawEndpoint:"/api/usgs/elev"'),
       "elevation spectrum must progressively refine one shader layer");
assert(!index.includes('elevRawLayer'),"elevation spectrum must not double-paint national and raw colour tiles");
/* Both refinement stages must go through mergeElevation. Its predecessor was an
   inline loop guarded only by the array's existence, so a no-coverage answer -
   which is a full grid of no-data, not a missing one - counted as a successful
   refinement and painted the hole over the global baseline. */
assert(/const nationalMerged=ElevationTileCore\.mergeElevation\(baseline,nationalElev\)/.test(index),
       "national elevation must merge into the baseline, never replace it unchecked");
assert(/const merged=ElevationTileCore\.mergeElevation\(baseline,raw\)/.test(index),
       "raw lidar must refine valid pixels without erasing the national baseline");
assert(!/if\(nationalElev\)\{ baseline=nationalElev/.test(index),
       "a decoded tile's existence must never stand in for it having data");
assert(index.includes('fallbackNativeZoom:15'),"browser elevation fallback must stretch its last native tile");
assert(index.includes('const VIEW_MAX=28'),"the map must support deep visual overzoom");
assert(index.includes('rotate:true,dragRotate:true,touchRotate:true')&&index.includes('id="bearingReset"'),
       "2D maps must support direct mouse/touch bearing rotation with a north reset");
assert(index.includes('id="map3d"')&&index.includes('import("./vendor/maplibre-gl.mjs")')&&
       index.includes('terrain:{source:"dem",exaggeration:light.exaggeration}'),
       "3D lidar terrain must lazy-load MapLibre and use the elevation DEM as a mesh");
assert(index.includes('id="terSunAz"')&&index.includes('id="terSunAlt"')&&index.includes('id="terAmbient"')&&
       index.includes('function repaintTerrainLighting()'),
       "terrain lighting must be adjustable and shared by 2D and 3D rendering");
assert(index.includes('maxZoom:VIEW_MAX,maxNativeZoom:17'),
       "one-metre lidar must stretch its honest native detail beyond z17 instead of oversampling or going black");
assert(index.includes('const WADNR_OK = new Set(["hs"])'),
       "WA DNR routing must not substitute plain hillshade for analytical terrain styles");
assert(index.includes('const CompositeTerrainLayer = L.GridLayer.extend')&&index.includes('const AnalyticTerrainLayer=ElevLayer.extend'),
       "terrain refinement must composite into one tile instead of stacking darkening layers");
assert(index.includes('class TerrainGpuRenderer')&&index.includes('dataset.cspRenderer="webgl2"'),
       "hillshade, slope, and aspect must use one shared WebGL2 terrain renderer when available");
assert(index.includes('rawEndpoint:null')&&index.includes('refineOverview:true'),
       "national analytical terrain must progressively refine a complete browser baseline without requesting raw lidar");
assert(index.includes('const softError=response.headers.get("X-CSP-Error")'),
       "soft upstream tile failures must retry without painting a permanent empty tile");
assert(index.includes('zIndex:440')&&index.includes('zIndex:450'),
       "analytical terrain and elevation shaders must render above primary imagery");
assert(index.includes('ElevationTileCore.decodeTerrarium')&&index.includes('ElevationTileCore.resampleElevation'),
       "packed Terrarium bytes must be decoded before floating-point resampling");
assert(index.includes('const nationalPromise=(coords.z>=13||self.options.refineOverview)')&&
       index.includes('if(coords.z<13&&ElevationTileCore.hasElevation(baseline)&&!self.options.refineOverview)'),
       "overview elevation must support either immediate browser-only paint or explicit national refinement");
assert(index.includes('panesEl.addEventListener("wheel"')&&index.includes('canScroll(body,delta)'),
       "wheel and trackpad input over an open submenu must scroll its content before chaining to the pane stack");
assert(index.includes('rawNative==null||rawNative==="" ? NaN : Number(rawNative)'),
       "missing imagery native zoom must derive from GSD instead of collapsing to z0");
const imageryZoomSandbox={};
vm.runInNewContext(`${namedFunction(index,"imageryNativeZoom")}; missing=imageryNativeZoom({nativeMax:null,gsd:30}); explicit=imageryNativeZoom({nativeMax:9,gsd:10});`,imageryZoomSandbox,{filename:"index.html#imagery-native-zoom-test"});
assert.equal(imageryZoomSandbox.missing,13,"30 m imagery without nativeMax must derive z13 from GSD");
assert.equal(imageryZoomSandbox.explicit,9,"an explicit imagery native zoom must win over GSD");
const gibsSandbox={GIBS:[{id:"daily",label:"Daily test",gsd:500,vis:"rgb"}]};
vm.runInNewContext(`${namedFunction(index,"gibsItems")};
  currentItems=gibsItems({mode:"rel",from:null,to:null});
  historicItems=gibsItems({mode:"abs",from:new Date("2025-07-01T00:00:00Z"),to:new Date("2025-07-31T23:59:59Z")});`,
  gibsSandbox,{filename:"index.html#gibs-complete-day-test"});
const yesterday=new Date(Date.now()-864e5).toISOString().slice(0,10);
assert.equal(gibsSandbox.currentItems[0].date.slice(0,10),yesterday,
       "current GIBS search must start on the last completed UTC day");
assert.equal(gibsSandbox.historicItems[0].date.slice(0,10),"2025-07-31",
       "historical GIBS search must remain anchored on the selected end date");
assert(index.indexOf('World_Light_Gray_Base')<index.indexOf('World_Dark_Gray_Base'),
       "the readable light basemap must precede the dark fallback");
/* The point-cloud panel is a full-width bottom sheet below 760px, laid out by
   CSS. An inline width overrides that, and the saved desktop width used to be
   applied unconditionally at startup -- a 560px panel on a 375px phone, hanging
   off the right edge. Every write to panel.style.width must be breakpoint
   aware, which is what applyPanelWidth() centralises. */
{
  const viewer=fs.readFileSync(path.join(root,"point-cloud-viewer.js"),"utf8");
  assert(/function setPanelWidth\(px\)/.test(viewer),
         "point-cloud panel width must go through setPanelWidth()");
  assert(/if\(narrow\(\)\) panel\.style\.removeProperty\("width"\)/.test(viewer),
         "setPanelWidth must clear the inline width on narrow viewports");
  const writes=(viewer.match(/panel\.style\.width\s*=/g)||[]).length;
  assert.equal(writes,1,`panel.style.width is written ${writes} times; it belongs only inside setPanelWidth`);
  assert(/visualViewport\?\.addEventListener\("resize"/.test(viewer),
         "iOS changes the viewport via visualViewport without a window resize; the breakpoint must be re-evaluated there");

  /* The phone layout is a detented sheet, per Apple's guidance for secondary
     content: resizable between detents, with a grabber saying so, left
     non-modal so the map behind stays live. It replaced a slab pinned at
     top:40dvh that gave the 3D view a third of the screen with no way to
     move it. */
  assert(/const DETENTS=\["peek","half","full"\]/.test(viewer),
         "the mobile sheet must offer peek, half and full detents");
  assert(/function nearestDetent\(height,velocity\)/.test(viewer)&&/velocity<-0\.5/.test(viewer),
         "a flick must move one detent rather than snapping to whichever is nearest");
  assert(/velocity>0\.5&&height<=lowest\+8/.test(viewer),
         "a firm flick down from the smallest detent must dismiss the sheet");
  assert(/lastPointerAt/.test(viewer)&&!/event\.detail===0/.test(viewer),
         "a touch tap reports click.detail 0 like a keyboard press; the sheet must not cycle twice on one tap");
  assert(index.includes('id="pcGrabber"'),"the sheet must show a grabber to advertise that it resizes");
  /* The grabber and header sit outside #pcCanvas so they survive the peek
     detent, where the canvas is collapsed to nothing. */
  assert(index.indexOf('id="pcGrabber"')<index.indexOf('id="pcCanvas"')&&
         index.indexOf('class="pc-head"')<index.indexOf('id="pcCanvas"'),
         "grabber and header must precede the canvas so peek can collapse it");
  assert(index.includes('[data-detent="peek"] #pcCanvas'),
         "the peek detent must collapse the 3D view and leave the map usable");
  /* touch-action on the panel inherits into the scrolling control list and
     stops the browser scrolling it entirely - invisible to a mouse-driven
     test, total on a phone. It belongs on the drag targets only. */
  assert(index.includes('#pcGrabber,#pointCloudPanel .pc-head{touch-action:none}')&&
         index.includes('.pc-controls{touch-action:pan-y}'),
         "touch-action must be scoped to the drag targets, never the whole sheet");
  assert(/#pcCanvas\{flex:1 1 auto;min-height:180px/.test(index),
         "the 3D view needs a floor or the controls squeeze it to a strip");

  /* The sidebar is a sheet on a phone and answers the same gestures. The axis
     is decided once from the first decisive movement, so a diagonal drag
     cannot flip between scrolling and dismissing halfway through. */
  assert(index.includes("#side{touch-action:pan-y}"),
         "the sidebar must keep vertical scrolling and claim only the horizontal axis");
  assert(/horizontal=Math\.abs\(dx\)>Math\.abs\(dy\)/.test(index),
         "the dismiss gesture must commit to one axis rather than re-deciding mid-drag");
  assert(/horizontal&&dx<-56/.test(index),"a swipe back toward the edge must dismiss the sidebar");
  assert(/getElementById\("map"\)\.addEventListener\("pointerdown"/.test(index),
         "tapping the map beside the sheet must dismiss it");
  /* 44pt is the minimum for a control you aim at, not a floor for every line of
     a dense scrolling list. Applying it wholesale inflated the panes to twice
     the visible height and left 10.5px labels stranded in oversized boxes. The
     search row - one row, aimed at deliberately - gets the full target; list
     rows keep a density you can actually read. */
  assert(/\.search-row #go,\.search-row #q[^}]*min-height:44px/.test(index),
         "the search controls are aimed at deliberately and must carry the full target");
  const rowRule=index.match(/\.check,\.ovrow\{min-height:(\d+)px\}/);
  assert(rowRule,"dense sidebar rows must set an explicit phone height");
  const rowHeight=Number(rowRule[1]);
  assert(rowHeight>=34&&rowHeight<=40,
         `dense list rows are ${rowHeight}px; below 34 is fiddly, above 40 and the panel stops showing anything`);

  /* Point cloud: the ramp follows the view, and one slider lifts the canopy. */
  assert(/function rampToView\(\)/.test(viewer)&&/elevationRangeFromNodes/.test(viewer),
         "the elevation ramp must be scaled to the loaded nodes, not the whole project");
  assert(index.includes('id="pcCanopy"')&&/function applyCanopy\(level\)/.test(viewer),
         "a single canopy slider must run from bare earth to all returns");
  assert(index.includes('<details class="pc-advanced">'),
         "the per-class checkboxes belong behind a disclosure, not in front of the slider");
}

assert(!/cartocdn/.test(index),
       "no CARTO basemap may remain: unkeyed tiles are watermarked and raster is being retired");
/* setMapTheme runs during load and asks the themed overlays to rebuild, but
   OVERLAYS is a const declared much later. Reaching it in its temporal dead
   zone throws - and because that happens at top level it aborts the rest of
   the script, so the whole page dies with one console line. The readiness flag
   is what prevents it, and it only works if it is declared before the call. */
{
  const declared=index.indexOf("let ovThemedReady=false;");
  const called=index.indexOf("ovRefreshThemed();");
  const armed=index.indexOf("ovThemedReady=true;");
  assert(declared>=0&&called>=0&&armed>=0,"themed-overlay readiness flag must exist");
  assert(declared<called,"ovThemedReady must be declared before setMapTheme calls ovRefreshThemed");
  assert(called<armed,"ovThemedReady must be armed only after OVERLAYS is initialised");
  const guard=index.slice(index.indexOf("function ovRefreshThemed()"),
                          index.indexOf("function ovRefreshThemed()")+120);
  assert(guard.includes("if(!ovThemedReady) return;"),
         "ovRefreshThemed must bail out until the overlay list exists");
}
assert(index.includes('background:#dbe6eb'),"out-of-world space must not flash black at global zooms");
assert(index.includes('id="mapTheme"'),"map-only light and dark basemap control must be present");
assert(index.includes('clearskies.mapTheme.v1'),"map theme choice must persist between sessions");
assert(index.includes('<option value="ft" selected>feet</option>'),"elevation must default to feet");
assert(index.includes('id="elevAlpha"'),"elevation spectrum needs a user-controlled shader strength");
assert(index.includes('class="elev-spectrum-scale"')&&
       index.indexOf('class="elevKey"')<index.indexOf('id="elevAlpha"')&&
       index.includes('for="elevAlpha">Spectrum opacity'),
       "the elevation legend must sit below its ramp and remain separate from spectrum opacity");
/* The shell must never be sized from a measurement that can come up short of
   the screen. That was first a JS visual-viewport offset; replacing it with
   height:100dvh moved the same failure rather than ending it, because an
   installed standalone PWA reports that unit short of the display by the bottom
   safe-area inset - the map stopped above the home indicator and the manifest
   background showed through as a black bar. #app is position:fixed, so inset:0
   resolves against the initial containing block, which under viewport-fit=cover
   is the whole screen. No measurement, nothing to come up short. */
assert(index.includes('#app{position:fixed;inset:0;width:100%;background:var(--page)}'),
       "the application shell must be sized by inset:0 against the initial containing block");
assert(!/#app\{[^}]*height:/.test(index),
       "the shell must not carry an explicit height; it over-constrains inset:0 and can fall short of the screen");
assert(!index.includes('syncVisualViewport'),
       "the shell must never be sized from a JS-measured visual viewport");
assert(index.includes('content="width=device-width,initial-scale=1,viewport-fit=cover"'),
       "viewport-fit=cover is what makes the safe-area strips part of the shell");
/* An edge-to-edge app has to say so consistently. viewport-fit=cover puts the
   safe-area strips inside the layout; "black" asks iOS to reserve the system
   bars and fill them with theme-color instead, which contradicts it. */
/* The device measured its window 59px short of the screen - the status-bar
   inset on a Dynamic Island iPhone, and the documented black-translucent
   failure where the view is sized short and the shortfall shows as a band along
   the bottom. With "black" the window is the area below the status bar and #app
   fills it exactly. */
assert(index.includes('name="apple-mobile-web-app-status-bar-style" content="black"')&&
       !index.includes('content="black-translucent"'),
       "black-translucent sized the window short of the screen on this hardware");
assert(index.includes('doubleClickZoom:false')&&index.includes('map.on("dblclick",e=>{ stageMapLocation(e); run(); });'),
       "a map point must be selected on one click and load imagery only on double click or double tap");
assert(index.includes('PANE_REORDER_HOLD_MS=260')&&index.includes('Press and hold to reorder.'),
       "sidebar reordering must require a short press-and-hold instead of an immediate drag");
assert(index.includes('id="sideToggleDock"')&&index.includes('right:calc(12px + var(--safe-right))')&&
       index.includes('function sideMaxWidth()')&&index.includes('SIDE_TOGGLE_GUTTER=68'),
       "right-side map tools and the standalone sidebar toggle must remain separated while resizing");
assert(index.includes('container-type:inline-size')&&index.includes('clamp(10.5px,3.2cqi,12.5px)')&&
       index.includes('white-space:nowrap;overflow:hidden;text-overflow:ellipsis'),
       "sidebar action labels must adapt to panel width without changing button height");
assert(index.includes('-webkit-appearance:menulist')&&index.includes('color-scheme:dark'),
       "sidebar selects must retain the platform-native menu treatment");
assert(index.includes('id="terReset"')&&index.includes('id="ctlReset"')&&
       index.includes('id="elevSpectrumReset"')&&index.includes('id="elevBandsReset"')&&
       index.includes('id="researchReset"')&&index.includes('id="ovReset"'),
       "every adjustable render panel must expose its own reset control");
assert(index.includes('function inputPercent(id,fallback)')&&
       index.includes('const opacity=inputPercent("#elevBandAlpha",52)/100')&&
       index.includes('bandAlpha:inputPercent("#elevBandAlpha",52)/100'),
       "elevation spectrum and highlight opacity must support an actual zero-opacity value");
assert(index.includes('(0.15+0.85*t)'),"neutral elevation shading must not darken the whole basemap");
assert(index.includes('class ElevationGpuRenderer'),"elevation recolouring must use the shared WebGL2 renderer");
assert(index.includes('elevation-tiles-prod/terrarium'),"elevation must have a browser-direct national fallback");
assert(index.includes('CSPResearchAnalysis.shouldOffload({connected:PROXY'),
       "large and mobile research rasters must prefer the connected M2 engine");
assert(index.includes('return {...await runResearchWorker(payload),engine:"browser worker fallback"}'),
       "M2 analysis failure must retain an automatic browser-worker fallback");
assert.match(index,/id:"waice"[\s\S]{0,650}250k_Surface_Geology\/MapServer\/0\/query[\s\S]{0,260}lineWidth:\{label:"Glacier \/ ice-limit border"/,
       "continental-ice reference must use the WGS 250k vector layer with an adjustable border");
assert.match(index,/id:"waflood"[\s\S]{0,500}Ice_Age_Floods_National_Geologic_Trail_and_Sites\/FeatureServer\/2\/query/,
       "Ice Age floods reference must use the WGS hosted affected-area layer 2");
assert.match(index,/id:"paleolakes"[\s\S]{0,500}GlacialH2O_V1\/FeatureServer\/0\/query\?where=POLY_TYPE%3D%27Lake%27/,
       "Pleistocene lakes must use only the EWU/IAFI Lake reconstruction class");
assert.match(index,/id:"paleolakes"[\s\S]{0,700}lineWidth:\{label:"Lake border"/,
       "Pleistocene-lake borders must expose their own adjustable width");
assert(index.includes('function overlayLineWidth(o)')&&index.includes('id="ovLine_${o.id}"')&&
       index.includes('lineWidths:ovLineWidths'),
       "Ice Age border-width controls must persist and repaint existing vector layers");
assert(index.match(/maxAllowableOffset=0\.001/g).length>=2,
       "hosted Ice Age polygons must request simplified geometry instead of multi-megabyte source vertices");
assert.match(index,/id:"wageology"[\s\S]{0,500}100K_Surface_Geology_WA_GeMS\/MapServer\/export[\s\S]{0,160}layers:"11"/,
       "WA surface geology must use official WGS DS-18 map-unit layer 11");
assert.match(index,/id:"wafaults"[\s\S]{0,500}Earthquakes_and_Faults\/MapServer\/export[\s\S]{0,160}layers:"12"/,
       "WA active faults must use official WGS Quaternary layer 12");
assert.match(index,/id:"wavents"[\s\S]{0,500}Volcanic_Vents\/MapServer\/export[\s\S]{0,160}layers:"0"/,
       "WA volcanic vents must use official WGS layer 0");
assert.match(index,/id:"geology"[\s\S]{0,320}https:\/\/tiles\.macrostrat\.org\/carto\/\{z\}\/\{x\}\/\{y\}\.png/,
       "Macrostrat geology must load browser-direct without depending on the M2");
const macrostratOverlay=index.match(/\{ id:"geology"[\s\S]*?\},/)[0];
assert(!macrostratOverlay.includes("needsProxy"),"Macrostrat must remain available while the private server is offline");
assert.match(index,/id:"usfaults"[\s\S]{0,500}haz\/Qfaults\/MapServer\/export[\s\S]{0,160}layers:"21,22"/,
       "national Quaternary faults must use the USGS database and fault-area layers");
assert.match(index,/id:"plateboundaries"[\s\S]{0,500}eq\/map_plateboundaries\/MapServer\/export[\s\S]{0,160}layers:"0,1"/,
       "tectonic context must include USGS plates and microplates");
assert.match(index,/id:"vs30"[\s\S]{0,500}eq\/vs30_mosaic\/MapServer\/export[\s\S]{0,320}not lithology/,
       "Vs30 must be clearly labeled as a site-condition proxy rather than geology");
assert.match(index,/id:"weatheralerts"[\s\S]{0,260}geoLoader:loadNwsWeatherAlerts[\s\S]{0,120}geoTtl:5\*60\*1000/,
       "weather hazards must use the filtered NOAA loader with a five-minute refresh cadence");
assert.match(index,/id:"earthquakes"[\s\S]{0,240}geoLoader:loadEarthquakeAlerts[\s\S]{0,120}pointKind:"quake"[\s\S]{0,100}geoTtl:5\*60\*1000/,
       "earthquakes must use the filterable USGS loader with a five-minute refresh cadence");
assert.match(index,/id:"volcanostatus"[\s\S]{0,240}geoLoader:loadVolcanoAlerts[\s\S]{0,120}pointKind:"volcano"[\s\S]{0,100}geoTtl:15\*60\*1000/,
       "volcano status must use the filterable USGS VSC loader with a bounded refresh cadence");
assert(index.includes("WWA/watch_warn_adv/MapServer/1/query")&&index.includes('maxAllowableOffset:alertPrefs.viewport?"0.001":"0.02"'),
       "NWS polygons must use NOAA's live service with view-aware geometry simplification");
assert(index.includes("while(alertRawCache.size>24)")&&index.includes("nwsCoverage?.contains(map.getBounds())"),
       "live-alert geometry must keep a bounded cache and reuse its buffered NOAA coverage while panning");
assert(index.includes("all_${age}.geojson")&&index.includes("volcanoApi/geojson"),
       "alert loaders must retain the official USGS earthquake and volcano feeds");
assert(index.includes('data-pane="alerts"')&&index.includes('id="alertNwsSeverity"')&&
       index.includes('id="alertQuakeAge"')&&index.includes('id="alertQuakeMag"')&&
       index.includes('aria-live="polite"')&&index.includes("clearskies.alerts.v1")&&index.includes("initAlerts();"),
       "the dedicated live-alert centre and its filter preferences must be present and initialized");
assert.match(index,/id:"waarchaeology"[\s\S]{0,420}CSPWaArchaeology\?\.featureCollection\(\)[\s\S]{0,160}pointKind:"archaeology"/,
       "Washington archaeology must use the validated bundled research index");
assert(index.includes('p.precision==="estimated"')&&read("wa-archaeology.js").includes('"Estimated research waypoint"'),
       "archaeology markers must visually and textually distinguish estimated locations");
assert(index.includes('id="coordCopy"')&&index.includes('id="coordOpen"')&&
       index.includes("https://www.google.com/maps/search/?api=1")&&index.includes("https://earth.google.com/web/search/"),
       "the search row must copy a selected coordinate and offer cross-platform Google Maps and Earth links");
assert(index.includes("child.bindTooltip(tooltip")&&index.includes('className:"csp-point-tip"'),
       "interactive point overlays must reveal concise labels on hover while retaining full click popups");
assert(index.includes('cache:o.geoTtl?"no-cache":"force-cache"')&&index.includes("retaining the last successful data"),
       "live GeoJSON feeds must refresh without discarding a successful canvas layer on failure");
assert(index.includes("const ovPointCanvas=L.canvas({padding:.5})"),
       "large point feeds must share Leaflet's canvas renderer instead of creating thousands of SVG nodes");
assert(index.includes("https://macrostrat.org/api/v2/geologic_units/map")&&
       index.includes("const GEOLOGY_IDENTIFY_MAX=128")&&index.includes("Surface map compilations overlap"),
       "point geology identification must be browser-direct, bounded, and retain its interpretation caveat");
for(const caveat of ["reference linework, not present-day ice","not flood depth, timing, frequency",
                     "Interpretive EWU/IAFI reconstruction","not volcanic hazard zones"])
  assert(index.includes(caveat),`research overlay must retain its interpretation caveat: ${caveat}`);
assert(index.includes("const ovGeoCache=new Map()")&&index.includes("L.geoJSON(null"),
       "lightweight hosted research polygons must be fetched once and rendered as vectors");
assert(index.includes("const FIRE_VIEW_TTL=10*60*1000")&&
       index.includes("fireCoverage?.contains(viewport)")&&index.includes("Promise.allSettled")&&
       index.includes("resultRecordCount=2000"),
       "active fires must retain a buffered vector layer instead of refetching after every move");
assert(index.includes("NOHRSC_Snow_Analysis/MapServer/export")&&
       index.includes("getFallbackTileUrl(c){ return PROXY ? this.snowUrl(c,true) : null }"),
       "snow depth and SWE must fall back from the warm M2 cache to NOAA direct CORS");
const elevSandbox={};
vm.runInNewContext(`${namedFunction(index,"elevRampRgb")}; center=elevRampRgb(500,500,300); lower=elevRampRgb(200,500,300); upper=elevRampRgb(800,500,300);`,elevSandbox,{filename:"index.html#elevation-spectrum-test"});
assert.deepEqual(Array.from(elevSandbox.center),[255,255,250],"reference elevation must be white");
assert(elevSandbox.lower[0]>elevSandbox.lower[2],"lower elevations must trend red");
assert(elevSandbox.upper[2]>elevSandbox.upper[0],"higher elevations must trend blue");
const server=read("server.js");
assert(server.includes('if(z>=13) try{ raw=await terrainTask'),"raw lidar elevation must be reserved for useful close zooms");
assert(server.includes('const TERRAIN_RENDER_VERSION = "terrain-v2"'),
       "corrected terrain renders must use a new server-cache namespace");
assert(server.includes('function slot(signal)')&&server.includes('queue.splice(index,1)'),
       "abandoned viewport requests must leave the upstream concurrency queue immediately");
assert(server.includes('"X-CSP-Error":"upstream"'),
       "transient tile failures must remain retryable without noisy broken-image responses");
assert(server.includes('p==="/api/terrain/analyze"&&req.method==="POST"')&&server.includes('transferList:[grid.buffer]'),
       "viewport DEM analysis must be validated and transferred off the Node event loop");
assert(server.includes('"gis.dnr.wa.gov"'),
       "the screenshot image proxy must allow the exact WGS raster host used by research overlays");
assert(server.includes('"earthquake.usgs.gov"')&&server.includes('"tiles.arcgis.com"'),
       "the snapshot helper must allow only the exact new USGS raster hosts");
assert(server.includes("const TTL_SNOW   = 2*3600*1000"),
       "the M2 snow cache must not hide most of NOAA's four daily updates");
for(const asset of ["mosaic-core.js","terrain-core.js","terrain-raster.js","elevation-bands.js","elevation-tile-core.js","wa-archaeology.js",
                    "glacial-research-core.js","research-analysis.js","research-worker.js","maxar-catalog.json"])
  assert(read(".github/workflows/ci.yml").includes(asset),`Pages artifact must include ${asset}`);

/* Global imagery. The portal shipped without any: cartographic basemaps plus a
   US-only high-resolution tier, so everywhere abroad fell back to grey tiles. */
assert(index.includes('id:"imagery"')&&index.includes("World_Imagery/MapServer"),
       "a global satellite mosaic must be available outside the United States");
assert(index.includes('id:"s2cloudless"')&&index.includes("s2cloudless-${EOX_S2_YEAR}_3857"),
       "a cloud-free global composite must back up the best-available mosaic");
/* Esri and EOX permit in-app display but not bulk caching or re-serving. sw.js
   returns early for cross-origin requests, so the precache cannot reach them -
   this pins that the imagery is never added to the same-origin asset list. */
for(const host of ["World_Imagery","tiles.maps.eox.at"])
  assert(!read("sw.js").includes(host),
         `display-only imagery (${host}) must never enter the service worker precache`);
assert(read("sw.js").includes("url.origin !== self.location.origin) return"),
       "the service worker must leave cross-origin imagery to the network");
/* Maxar Open Data is CC-BY-NC-4.0. The non-commercial term has to reach the
   screen, not just the source registry. */
assert(index.includes('id:"maxarvhr"')&&index.includes('popupKind:"maxar"'),
       "the sparse VHR index must be reachable as an overlay");
assert(index.includes("nonCommercial:true")&&/non-commercial/i.test(index),
       "the CC-BY-NC-4.0 term on Maxar Open Data must be stated in the UI");
assert(index.includes("o.nonCommercial?")&&index.includes('.ovrow .nc{'),
       "a non-commercial layer must carry its restriction on the row that switches it on");
assert(index.includes('fetch("./maxar-catalog.json"'),
       "the VHR coverage index must ship with the app rather than crawl S3 per visitor");
assert(read("package.json").includes("test-maxar-catalog.js"),
       "the shipped VHR coverage index must be covered by the test suite");
assert(read("package.json").includes("sync-maxar-catalog.js"),
       "the VHR coverage index must be regenerable from a documented script");
/* A shipped runtime file has to be listed in three unrelated places - the Pages
   artifact, the service worker precache, and the engine's own static allowlist.
   Missing the last one served a 404 only when the browser asked for it. */
for(const [file,label] of [["server.js","the local engine"],["sw.js","the service worker"]])
  assert(read(file).includes("maxar-catalog.json"),
         `${label} must serve the VHR coverage index`);
const installer=read("scripts/install-mac-service.sh");
for(const asset of ["terrain-core.js","terrain-raster.js","elevation-bands.js","elevation-tile-core.js","wa-archaeology.js",
                    "glacial-research-core.js","research-analysis.js","research-worker.js"])
  assert(installer.includes(asset),`installed M2 runtime must include ${asset}`);
for(const script of ["scripts/launch-terrain-engine.sh","scripts/install-mac-service.sh"]){
  const source=read(script);
  assert.match(source,/127\.0\.0\.1/,`${script} must keep the engine loopback-only`);
}
const launchAgent=read("scripts/com.rileyg44.clear-skies-portal.plist");
assert(launchAgent.includes('<key>CSP_TERRAIN_WORKERS</key>')&&launchAgent.includes('<string>6</string>'),
       "the dedicated M2 service must run six terrain workers");
assert(launchAgent.includes('<string>Interactive</string>'),"the dedicated terrain service must receive interactive scheduling");
assert(read("server.js").includes("cacheDisk:cacheDiskStats()"),"health must expose cache disk safety");
const watchdog=read("scripts/launch-terrain-engine.sh");
assert(watchdog.includes("MAX_HEALTH_MISSES"),"watchdog must restart an unresponsive HTTP coordinator");
assert(!watchdog.includes("engine_busy"),"high CPU must not conceal a dead HTTP coordinator");
for(const file of ["terrain-pool.js","terrain-worker.js"])
  assert(fs.existsSync(path.join(root,file)),`missing terrain runtime: ${file}`);

const manifest=JSON.parse(read("manifest.json"));
const sources=JSON.parse(read("sources.json"));
const pkg=JSON.parse(read("package.json"));
assert(Array.isArray(sources.sources)&&sources.sources.length>0,"sources.json needs active sources");
assert.equal(pkg.dependencies["maplibre-gl"],"^6.6.0","3D terrain must pin the reviewed MapLibre major/minor");
assert.equal(pkg.dependencies["@tomickigrzegorz/leaflet-rotate"],"^0.2.4","2D rotation must use the reviewed MIT plugin");
for(const asset of ["maplibre-gl.mjs","maplibre-gl-shared.mjs","maplibre-gl-worker.mjs","maplibre-gl.css","leaflet-rotate.umd.min.js"])
  assert(fs.existsSync(path.join(root,"vendor",asset)),`missing vendored renderer asset: ${asset}`);
/* The sun controls do nothing for derived styles, and nothing for the published
   WA DNR hillshade that "best available" silently switches to past z13 over
   Washington. Both used to fail in silence: the slider moved, the readout
   updated, the picture did not change. The note must be live state, not prose. */
assert(index.includes('id="terLightNote"'),"the terrain lighting note must be addressable to update live");
assert(/CSPTerrain\.sunAffectsTerrain\(/.test(index),
       "whether the sun does anything must come from the tested rule, not a condition retyped in the UI");
assert(/note\.dataset\.live=String\(effect\.live\)/.test(index),
       "the note must record whether the sun is live so it can be styled and asserted");
assert(/function paintTerrainInfo\(pick\)\{\s*\/\*[\s\S]{0,400}?\*\/\s*paintSunNote\(\);/.test(index),
       "the note must be re-evaluated wherever terrain state changes, not only on slider input");

assert(index.includes('id="pointCloudPanel"')&&index.includes('id="terModePoints"'),"3D point-cloud panel and entry point must exist");

/* Product spelling: LiDAR in anything a reader sees. Code identifiers, URLs,
   bucket names and comments keep their own spelling - usgs-lidar-public is a
   real host, not copy. This checks the rendered strings only. */
{
  const visible=index
    .replace(/\/\*[\s\S]*?\*\//g,"")          // block comments
    .replace(/^\s*\/\/.*$/gm,"")               // line comments
    .replace(/https?:\/\/[^\s"'`)]+/g,"")      // urls
    .replace(/usgs-lidar-public|lidarportal|lidar-research|point-cloud/g,"");
  const stragglers=[...visible.matchAll(/.{0,40}\blidar\b.{0,25}/gi)]
    .map(m=>m[0].trim())
    .filter(hit=>!/LiDAR/.test(hit));
  assert.equal(stragglers.length,0,
    `user-visible copy must spell it LiDAR: ${stragglers.slice(0,3).join(" | ")}`);
}

/* Overlay menu shape. The old grouping was the data's taxonomy, not the
   reader's: one subject split three ways, a group holding a single layer, a
   group whose name repeated a whole pane, and ten layers with no group at all
   floating above the first heading. */
{
  const registry=index.slice(index.indexOf("const OVERLAYS = ["));
  const entries=registry.slice(0,registry.indexOf("\n];")).split(/\n\s*\{\s*id:/).slice(1);
  assert(entries.length>20,"overlay registry did not parse");
  const groups=entries.map(entry=>entry.match(/group:"([^"]+)"/)?.[1]);
  assert(groups.every(Boolean),"every overlay must sit in a group; none may float above the first heading");
  const declared=index.match(/const OVERLAY_GROUPS=\[([^\]]+)\]/);
  assert(declared,"the overlay group order must be declared, not left to registry order");
  const names=[...declared[1].matchAll(/"([^"]+)"/g)].map(m=>m[1]);
  for(const group of new Set(groups))
    assert(names.includes(group),`overlay group ${group} is not in the declared order`);
  const counts={};
  for(const group of groups) counts[group]=(counts[group]||0)+1;
  for(const [group,count] of Object.entries(counts))
    assert(count>1,`${group} holds a single layer; that is a heading, not a group`);
  const paneTitles=[...index.matchAll(/class="pane-t">([^<]+)</g)].map(m=>m[1].trim());
  for(const group of names)
    assert(!paneTitles.includes(group),`overlay group "${group}" repeats a pane title`);
}
assert(index.includes('id="pcBareEarth"')&&index.includes('id="pcAllReturns"'),"point-cloud class presets must be wired");
for(const asset of ["build/potree/potree.js","build/potree/workers/EptLaszipDecoderWorker.js","build/potree/workers/laz-perf.wasm","libs/copc/index.js","SOURCE.json"])
  assert(fs.existsSync(path.join(root,"vendor","potree",asset)),`missing vendored Potree asset: ${asset}`);
const pointCatalog=JSON.parse(read("point-cloud-catalog.json"));
assert.equal(pointCatalog.projects.length,30,"Washington point-cloud catalog must contain 30 projects");
for(const icon of manifest.icons||[])
  assert(fs.existsSync(path.join(root,icon.src)),`missing manifest icon: ${icon.src}`);

console.log(`static checks passed (${inline.length} inline scripts, ${sources.sources.length} sources, build ${versionSandbox.CSP_BUILD})`);
