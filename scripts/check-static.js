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
new vm.Script(read("elevation-bands.js"),{filename:"elevation-bands.js"});
new vm.Script(read("elevation-tile-core.js"),{filename:"elevation-tile-core.js"});
new vm.Script(read("glacial-research-core.js"),{filename:"glacial-research-core.js"});
new vm.Script(read("research-analysis.js"),{filename:"research-analysis.js"});
const versionSandbox={};
vm.runInNewContext(read("version.js"),versionSandbox,{filename:"version.js"});
assert.match(versionSandbox.CSP_BUILD,/^\d{4}-\d{2}-\d{2}[a-z]$/,"build version must be date plus revision letter");
assert(index.includes(`<script src="version.js?build=${versionSandbox.CSP_BUILD}"></script>`),
       "page must cache-bust and load the shared build version");
assert(index.includes('<script src="mosaic-core.js"></script>'),"index must load the tested mosaic core");
assert(index.includes('<script src="elevation-bands.js"></script>'),"index must load the tested elevation-band core");
assert(index.includes('<script src="elevation-tile-core.js"></script>'),"index must decode packed elevation before resampling");
assert(index.includes('<script src="glacial-research-core.js"></script>'),"index must load geomorphology primitives");
assert(index.includes('<script src="research-analysis.js"></script>'),"index must load the shared analysis dispatcher");
assert(read("sw.js").includes(`const CSP_BUILD = "${versionSandbox.CSP_BUILD}";`),
       "service worker cache namespace must use the page build version");
assert(index.includes('register("sw.js",{updateViaCache:"none"})'),
       "service-worker imports must bypass stale HTTP cache during update checks");
assert(index.includes('id="snapshot"'),"map snapshot control must be present");
assert(index.includes('getDisplayMedia'),"map snapshot control must use browser surface capture");
assert(index.includes('body.print-map'),"map snapshot control must have a print fallback");
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
assert(index.includes('const CompositeTerrainLayer = L.GridLayer.extend'),
       "terrain refinement must composite into one tile instead of stacking darkening layers");
assert(index.includes('const softError=response.headers.get("X-CSP-Error")'),
       "soft upstream tile failures must retry without painting a permanent empty tile");
assert(index.includes('zIndex:440')&&index.includes('zIndex:450'),
       "analytical terrain and elevation shaders must render above primary imagery");
assert(index.includes('ElevationTileCore.decodeTerrarium')&&index.includes('ElevationTileCore.resampleElevation'),
       "packed Terrarium bytes must be decoded before floating-point resampling");
assert(index.includes('const nationalPromise=coords.z>=13')&&index.includes('if(coords.z<13&&baseline)'),
       "overview elevation must paint browser-direct data without duplicate server decoding");
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
assert(index.includes('(0.15+0.85*t)'),"neutral elevation shading must not darken the whole basemap");
assert(index.includes('class ElevationGpuRenderer'),"elevation recolouring must use the shared WebGL2 renderer");
assert(index.includes('elevation-tiles-prod/terrarium'),"elevation must have a browser-direct national fallback");
assert(index.includes('CSPResearchAnalysis.shouldOffload({connected:PROXY'),
       "large and mobile research rasters must prefer the connected M2 engine");
assert(index.includes('return {...await runResearchWorker(payload),engine:"browser worker fallback"}'),
       "M2 analysis failure must retain an automatic browser-worker fallback");
assert.match(index,/id:"waice"[\s\S]{0,500}250k_Surface_Geology\/MapServer\/export[\s\S]{0,160}layers:"0"/,
       "continental-ice reference must use WGS 250k layer 0");
assert.match(index,/id:"waflood"[\s\S]{0,500}Ice_Age_Floods_National_Geologic_Trail_and_Sites\/FeatureServer\/2\/query/,
       "Ice Age floods reference must use the WGS hosted affected-area layer 2");
assert.match(index,/id:"paleolakes"[\s\S]{0,500}GlacialH2O_V1\/FeatureServer\/0\/query\?where=POLY_TYPE%3D%27Lake%27/,
       "Pleistocene lakes must use only the EWU/IAFI Lake reconstruction class");
assert(index.match(/maxAllowableOffset=0\.001/g).length>=2,
       "hosted Ice Age polygons must request simplified geometry instead of multi-megabyte source vertices");
assert.match(index,/id:"wageology"[\s\S]{0,500}100K_Surface_Geology_WA_GeMS\/MapServer\/export[\s\S]{0,160}layers:"11"/,
       "WA surface geology must use official WGS DS-18 map-unit layer 11");
assert.match(index,/id:"wafaults"[\s\S]{0,500}Earthquakes_and_Faults\/MapServer\/export[\s\S]{0,160}layers:"12"/,
       "WA active faults must use official WGS Quaternary layer 12");
assert.match(index,/id:"wavents"[\s\S]{0,500}Volcanic_Vents\/MapServer\/export[\s\S]{0,160}layers:"0"/,
       "WA volcanic vents must use official WGS layer 0");
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
assert(server.includes("const TTL_SNOW   = 2*3600*1000"),
       "the M2 snow cache must not hide most of NOAA's four daily updates");
for(const asset of ["mosaic-core.js","terrain-core.js","elevation-bands.js","elevation-tile-core.js",
                    "glacial-research-core.js","research-analysis.js","research-worker.js"])
  assert(read(".github/workflows/ci.yml").includes(asset),`Pages artifact must include ${asset}`);
const installer=read("scripts/install-mac-service.sh");
for(const asset of ["terrain-core.js","elevation-bands.js","elevation-tile-core.js",
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
