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
assert(index.includes('if(raw[i]===raw[i]) merged[i]=raw[i]'),
       "raw lidar must refine valid pixels without erasing the national baseline");
assert(index.includes('fallbackNativeZoom:15'),"browser elevation fallback must stretch its last native tile");
assert(index.includes('const VIEW_MAX=28'),"the map must support deep visual overzoom");
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
       index.includes('if(coords.z<13&&baseline&&!self.options.refineOverview)'),
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
assert(index.indexOf('basemaps.cartocdn.com/light_all')<index.indexOf('basemaps.cartocdn.com/dark_all'),
       "the readable light basemap must precede the dark fallback");
assert(index.includes('background:#dbe6eb'),"out-of-world space must not flash black at global zooms");
assert(index.includes('id="mapTheme"'),"map-only light and dark basemap control must be present");
assert(index.includes('clearskies.mapTheme.v1'),"map theme choice must persist between sessions");
assert(index.includes('<option value="ft" selected>feet</option>'),"elevation must default to feet");
assert(index.includes('id="elevAlpha"'),"elevation spectrum needs a user-controlled shader strength");
assert(index.includes('class="elev-spectrum-scale"')&&
       index.indexOf('class="elevKey"')<index.indexOf('id="elevAlpha"')&&
       index.includes('for="elevAlpha">Spectrum opacity'),
       "the elevation legend must sit below its ramp and remain separate from spectrum opacity");
assert(index.includes('height:var(--app-height);background:var(--page)')&&!index.includes('syncVisualViewport'),
       "the application shell must use CSS dynamic viewport sizing without a shortened visual-viewport offset");
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
                    "glacial-research-core.js","research-analysis.js","research-worker.js"])
  assert(read(".github/workflows/ci.yml").includes(asset),`Pages artifact must include ${asset}`);
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
assert(!pkg.dependencies||Object.keys(pkg.dependencies).length===0,"runtime dependencies are intentionally forbidden");
for(const icon of manifest.icons||[])
  assert(fs.existsSync(path.join(root,icon.src)),`missing manifest icon: ${icon.src}`);

console.log(`static checks passed (${inline.length} inline scripts, ${sources.sources.length} sources, build ${versionSandbox.CSP_BUILD})`);
