"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),vm=require("node:vm");
const {EventEmitter}=require("node:events");
const {spawn}=require("node:child_process");
const net=require("node:net");
const {DnrStore,tileBounds,uncovered}=require("./wadnr");
const runtime=require("./vendor/dnr-runtime.cjs");
const publicTerrain=require("./public-terrain");
const terrainRaster=require("./terrain-raster");
const root=fs.mkdtempSync(path.join(os.tmpdir(),"csp-dnr-test-"));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
const name="Official DNR Survey 2025";
const projects=[{name,datasets:[
  {ID:10,name:"DTM",XMin:-119,YMin:47,XMax:-118,YMax:48},
  {ID:11,name:"DTM Hillshade",layers:"11h",XMin:-119,YMin:47,XMax:-118,YMax:48}
]}];
const layers={layers:[{id:77,name:"11h",type:"Raster Layer"}]};
async function catalogueChecks(){
  const gate=deferred(),calls=[];
  const store=new DnrStore(path.join(root,"catalog"),{request:async p=>{
    calls.push(p);if(p==="/project")return gate.promise;if(p.includes("/layers?"))return layers;
    throw new Error("unexpected expensive intersection lookup");
  }});
  const a=store.coverage([-119.6,46,-116.95,47.9]),b=store.coverage([-118.6,47.7,-118.4,47.8]);
  gate.resolve(projects);
  assert.equal((await a).projects.length,1);assert.equal((await b).projects.length,1);
  assert.equal(calls.length,2,"simultaneous views share one catalogue request and do not call the slow file query");
  assert.equal((await store.coverage([-130,40,-129,41])).projects.length,0);
  const disk=new DnrStore(path.join(root,"catalog"),{request:()=>{throw new Error("network must not be used for a fresh catalogue");}});
  assert.equal((await disk.coverage([-119,47,-118,48])).projects[0].dtm,77);
  const unavailable=new DnrStore(path.join(root,"failure"),{request:async()=>{throw new Error("upstream timed out");}});
  await assert.rejects(unavailable.coverage([-119,47,-118,48]),/timed out/);
  assert.equal(unavailable.catalogue,null,"failed discovery must not become an empty successful catalogue");
  await assert.rejects(unavailable.coverage([-119,47,-118,48]),/unavailable/);
  const f=path.join(root,"catalog","wadnr","catalog.json");
  const old=JSON.parse(fs.readFileSync(f));old.at=Date.now()-8*86400000;fs.writeFileSync(f,JSON.stringify(old));
  const stale=new DnrStore(path.join(root,"catalog"),{request:async()=>{throw new Error("upstream unavailable");}});
  const result=await stale.coverage([-119,47,-118,48]);
  assert.equal(result.state,"stale");assert.equal(result.projects.length,1,"last valid coverage survives a provider failure");
}
async function acquisitionChecks(){
  const workers=[];
  const store=new DnrStore(path.join(root,"queue"),{request:async p=>{
    if(p==="/project")return projects;
    if(p.includes("/layers?"))return layers;
    return [{dataset_id:10,dataset_name:"DTM",files:1,bytes:100}];
  },workerFactory:()=>{const w=new EventEmitter();w.postMessage=a=>{w.args=a;};w.terminate=()=>{queueMicrotask(()=>w.emit("exit",0));};workers.push(w);return w;}});
  const n=2**17,x=Math.floor(((-118.5+180)/360*n)/2)*2,y=Math.floor((1-Math.asinh(Math.tan(47.75*Math.PI/180))/Math.PI)/2*n);
  const a=await store.ensureTile(17,x,y),b=await store.ensureTile(17,x+1,y);
  await tick();
  assert.equal(a.state,"pending");assert.equal(b.state,"pending");assert.equal(workers.length,1,"neighbor and retina tiles share a bounded acquisition");
  assert.equal(store.status().queued,0);
  workers[0].emit("message",{error:"download interrupted"});await tick();
  assert.equal(store.index.files.length,0,"an incomplete archive must not become rendered DNR coverage");
  assert.equal((await store.ensureTile(17,x,y)).state,"error","failed downloads back off rather than storming the upstream");
  store.close();
}
async function warmAreaChecks(){
  const store=new DnrStore(path.join(root,"warm-area"),{request:async p=>{
    if(p==="/project")return projects;
    if(p.includes("/layers?"))return layers;
    throw new Error("no DNR files outside catalogue coverage");
  }});
  // 0.2 x 0.2 degrees is ~1,700 z16 cells: far beyond the old 32-cell
  // viewport cap, and an explicit fetch must be allowed to cover it.
  const warm=store.startWarm([-130,40,-129.8,40.2]);
  assert(warm.id,"every warm job carries an id so clients can tell jobs apart");
  assert(warm.total>32&&warm.total<=4096,`explicit area fetch spans ${warm.total} cells`);
  for(let i=0;i<100&&store.warm.running;i++)await new Promise(r=>setTimeout(r,10));
  assert.equal(store.warm.error,null);assert.equal(store.warm.done,warm.total,"empty cells finish without downloads");
  assert.throws(()=>store.startWarm([-130,30,-120,45]),/4096/, "state-sized fetches stay bounded");
  store.ensureTile=async()=>({state:"pending"});
  const pending=store.startWarm([-130,40,-129.8,40.2]);
  assert.equal(store.stopWarm(warm.id).cancelled,false,"an old client cannot cancel a newer download");
  assert.equal(store.warm.stop,false,"a mismatched job id leaves the running job intact");
  assert.equal(store.stopWarm(pending.id).cancelled,true,"the owner can cancel a running job");
  for(let i=0;i<120&&store.warm.running;i++)await new Promise(r=>setTimeout(r,10));
  assert.equal(store.warm.running,false,"a pending acquisition settles after cancellation");
  assert(store.warm.done<store.warm.total,"cancellation stops scheduling the rest of the selected area");
  store.close();
}
async function rasterChecks(){
  const {writeArrayBuffer}=await import("geotiff");
  const z=15,n=2**z,x=Math.floor((-118.53+180)/360*n),y=Math.floor((1-Math.asinh(Math.tan(47.742*Math.PI/180))/Math.PI)/2*n);
  const r=20037508.342789244,span=2*r/n,left=-r+x*span,top=r-y*span,w=512,h=512;
  const values=new Float32Array(w*h);
  for(let j=0;j<h;j++)for(let i=0;i<w;i++)values[j*w+i]=i>=256&&j>=256?-9999:100+i*.3+j*.5;
  const buffer=writeArrayBuffer(values,{width:w,height:h,BitsPerSample:[32],SampleFormat:[3],
    ModelPixelScale:[span/w,span/h,0],ModelTiepoint:[0,0,0,left,top,0],
    GTModelTypeGeoKey:1,GTRasterTypeGeoKey:1,ProjectedCSTypeGeoKey:3857,ProjLinearUnitsGeoKey:9001,VerticalUnitsGeoKey:9003,GDAL_NODATA:"-9999"});
  const dir=path.join(root,"raster","wadnr");fs.mkdirSync(dir,{recursive:true});
  const file=path.join(dir,"fixture.tif");fs.writeFileSync(file,Buffer.from(buffer));
  const info=await runtime.inspect(file);
  assert.equal(info.verticalMeters,1200/3937,"horizontal metre coordinates must not override vertical feet");
  const levelDir=path.join(dir,"fixture");
  const levels=await runtime.buildOverviews(file,info,levelDir);
  assert.equal(levels.length,4);
  const record={...info,key:"fixture",project:name,datasetId:10,year:2025,file:"fixture.tif",overviewDir:"fixture",levels};
  const out=await runtime.sample({cacheDir:path.join(root,"raster"),files:[record],z,x,y,size:256});
  assert(out&&out.coverage>.74&&out.coverage<.76);
  assert.equal(out.sources[0].project,name);assert.equal(out.sources[0].datasetId,10);
  assert(Math.abs(out.grid[0]-100.4*(1200/3937))<.001,"DNR numeric values are independently converted to metres and sampled at pixel centres");
  assert(Number.isNaN(out.grid[200*256+200]),"true no-data remains a gap");
  for(const style of ["hs","hsmulti","tint","slope","aspect","northness","c2","c5","c10","c25"]){
    const rgba=terrainRaster.renderRgba(style,{grid:out.grid,width:256,height:256,groundRes:out.groundRes});
    assert.equal(rgba.length,256*256*4);
    assert.equal(rgba[(200*256+200)*4+3],0,`${style} must preserve DNR gaps`);
  }
  const coarse=await runtime.sample({cacheDir:path.join(root,"raster"),files:[record],z:13,x:Math.floor(x/4),y:Math.floor(y/4),size:256});
  assert(coarse?.sources[0].sampleMeters>coarse.sources[0].nativeMeters,"broad views use numeric overviews");
  const summary=publicTerrain.summarize([{el:{_cspHasContent:true,_cspSourceCounts:{5:100},
    _cspSurveySources:{5:out.sources},_cspSourceResolution:{5:out.groundRes}}}]);
  assert.equal(summary.sources[0].label,"WA DNR bare-earth elevation");
  assert.match(summary.sources[0].nativeLabel,/5\.27 ft/,"survey spacing is displayed in feet");
  assert.equal(summary.sources[0].surveys[0].datasetId,10);
  assert.throws(()=>runtime.verticalMeters({ProjLinearUnitsGeoKey:9003}),/does not declare vertical/,"undeclared vertical units cannot be guessed from horizontal units");
  assert.throws(()=>runtime.verticalMeters({GTCitationGeoKey:"Unit Name = Foot_US"}),/does not declare vertical/);
  const corrected=runtime.surveyInfo({verticalMeters:1},1543);
  assert.equal(corrected.verticalMeters,1200/3937);
  assert.equal(corrected.declaredVerticalMeters,1);assert.equal(corrected.metadataDatasetId,1547);
  assert.equal(runtime.surveyInfo({verticalMeters:1},999).verticalMeters,1,"survey overrides apply only to the documented dataset");
  return {record,z,x,y,cacheDir:path.join(root,"raster")};
}
function sourceChoiceChecks(){
  const html=fs.readFileSync(path.join(__dirname,"index.html"),"utf8");
  assert(!/<option value="wadnr/.test(html),"WA DNR is an explicit area fetch, never a source dropdown default");
  assert(html.includes('id="dnrSelect"')&&html.includes('id="dnrFetch"'),"terrain panel offers select-and-fetch for WA DNR areas");
  const fn=html.slice(html.indexOf("function chooseTerrain(style){"),html.indexOf("/* Presentation is independent",html.indexOf("function chooseTerrain(style){")));
  const context={$:()=>({value:"auto"}),map:{getZoom:()=>15},PROXY:true,waIds:()=>[77],waProjects:()=>[],
    WADNR_OK:new Set(["hs"]),usgsCover:null,waCoverageState:"ready",dnrElevationAvailable:()=>true};
  vm.createContext(context);vm.runInContext(fn,context);
  for(const style of ["hs","hsmulti","slope","aspect","northness","tint","c2"])
    assert.equal(context.chooseTerrain(style).src,"wadnr-elevation",`${style} can derive from fetched DNR elevation`);
  assert.equal(context.chooseTerrain("hs").cachedOnly,true,"browsing alone never fetches DNR");
  const options=html.slice(html.indexOf("function elevationSourceOptions(){"),html.indexOf("function dnrAcquisitionText(){"));
  context.API="";context.dnrStatus={revision:2};context.dnrAreasKey=()=>"";
  vm.runInContext(options,context);
  const auto=context.elevationSourceOptions();
  assert.equal(auto.dnrAcquire,false,"automatic browsing must not trigger large DNR archives");
  assert(auto.rawEndpoint&&auto.nationalEndpoint,"USGS remains the active default outside fetched areas");
  context.$=()=>({value:"3dep"});assert.equal(context.elevationSourceOptions().rawEndpoint,null);
  assert.equal(context.elevationSourceOptions().dnrAcquire,false);
  // Exercise the real gating/masking helpers, not stubs: a fetched box that
  // covers the west half of a z14 tile must mask the east half to NaN.
  const helpers=html.slice(html.indexOf('const DNR_AREA_KEY='),html.indexOf("function elevationSourceOptions(){"));
  const hctx={localStorage:{getItem:()=>JSON.stringify([{bbox:[-120.2,47.4,-120.15,47.5]}])},dnrElevationAvailable:()=>true};
  vm.createContext(hctx);vm.runInContext(helpers+';this.__h={dnrAreas,tileBbox,bboxIntersects,bboxContains,maskDnrGrid,dnrTileAllowed}',hctx);Object.assign(hctx,hctx.__h);
  assert.equal(hctx.dnrAreas.length,1);
  assert.equal(hctx.bboxContains(hctx.dnrAreas[0].bbox,[-120.19,47.41,-120.16,47.49]),true);
  const grid=new Float32Array(256*256).fill(100);
  assert(hctx.bboxIntersects(hctx.tileBbox(14,2723,5731),hctx.dnrAreas[0].bbox),"fixture tile overlaps the fetched box");
  const masked=hctx.maskDnrGrid(grid,256,256,{z:14,x:2723,y:5731});
  assert(masked.some(v=>v===100)&&masked.some(v=>Number.isNaN(v)),"boundary tile is masked per-pixel, not dropped whole");
  const empty=hctx.maskDnrGrid(new Float32Array(4).fill(7),2,2,{z:14,x:2800,y:5800});
  assert(empty.every(v=>Number.isNaN(v)),"a tile outside every fetched area contributes no DNR pixels");
  assert.equal(hctx.dnrTileAllowed({z:14,x:2800,y:5800}),false,"outside tiles never request DNR");
}
async function httpChecks(fixture){
  const dir=path.join(fixture.cacheDir,"wadnr");
  fs.writeFileSync(path.join(dir,"index.json"),JSON.stringify({version:1,revision:1,files:[fixture.record],regions:[]}));
  fs.writeFileSync(path.join(dir,"catalog.json"),JSON.stringify({at:Date.now(),projects:[{
    name,year:2025,dtmDataset:10,bounds:fixture.record.bounds}]}));
  const listener=net.createServer();await new Promise(r=>listener.listen(0,"127.0.0.1",r));
  const port=listener.address().port;await new Promise(r=>listener.close(r));
  const child=spawn(process.execPath,[path.join(__dirname,"server.js")],{env:{...process.env,
    HOST:"127.0.0.1",PORT:String(port),CSP_CACHE_DIR:fixture.cacheDir,CSP_TERRAIN_WORKERS:"1"},stdio:["ignore","pipe","pipe"]});
  let logs="";child.stdout.on("data",b=>{logs+=b;});child.stderr.on("data",b=>{logs+=b;});
  const base=`http://127.0.0.1:${port}`;
  try{
    for(let attempt=0;attempt<100;attempt++){
      try{const response=await fetch(base+"/api/health");if(response.ok)break;}catch{}
      if(attempt===99)throw new Error("DNR HTTP fixture did not start: "+logs);
      await new Promise(r=>setTimeout(r,50));
    }
    const url=base+`/api/wadnr/elev/${fixture.z}/${fixture.x}/${fixture.y}.png?acquire=0`;
    const first=await fetch(url);assert.equal(first.status,200);assert.equal(first.headers.get("x-elevation-source"),"wadnr-dtm");
    assert.equal(first.headers.get("x-cache"),"miss");
    const sources=JSON.parse(decodeURIComponent(first.headers.get("x-dnr-sources")));
    assert.equal(sources[0].datasetId,10);assert.equal(sources[0].project,name);
    assert.equal(Buffer.from(await first.arrayBuffer()).toString("hex",0,8),"89504e470d0a1a0a");
    const hit=await fetch(url);assert.equal(hit.headers.get("x-cache"),"hit");
    assert.equal(hit.headers.get("x-dnr-sources"),first.headers.get("x-dnr-sources"),"warm-cache pixels keep actual DNR provenance");
    const empty=await fetch(base+"/api/wadnr/elev/17/1/1.png?acquire=0");
    assert.equal(empty.headers.get("x-elevation-source"),"none");
    assert.equal(empty.headers.get("x-coverage"),"none","no-data must never be labeled DNR coverage");
    const [w,s,e,n]=fixture.record.bounds,bbox=[w+(e-w)*.1,s+(n-s)*.6,w+(e-w)*.4,s+(n-s)*.9];
    const fabric=await fetch(base+"/api/wadnr/fabric?"+new URLSearchParams({bbox:bbox.join(","),strict:"1",n:"64",lo:"20",hi:"80"}));
    const measured=await fabric.json();assert.equal(measured.ok,true,JSON.stringify(measured));
    assert(measured.sources.every(s=>s.startsWith("WA DNR:")),"strict fabric measures actual DNR elevations");
    const rejected=await fetch(base+"/api/wadnr/warm",{method:"POST",body:JSON.stringify({bbox:[-119,47,-118,48]})});
    assert.equal(rejected.status,400,"unbounded DNR view downloads are rejected");
    const warm=await fetch(base+"/api/wadnr/warm",{method:"POST",body:JSON.stringify({bbox})});
    assert.equal(warm.status,200);
    let status;
    for(let i=0;i<30;i++){status=await (await fetch(base+"/api/wadnr/warm/status")).json();if(!status.running)break;await new Promise(r=>setTimeout(r,100));}
    assert.equal(status.error,null);assert.equal(status.done,status.total);
  }finally{
    child.kill("SIGTERM");await new Promise(r=>child.once("exit",r));
  }
}
function uncoveredChecks(){
  const area=(parts)=>parts.reduce((sum,[w,s,e,n])=>sum+(e-w)*(n-s),0);
  assert.deepEqual(uncovered([0,0,4,4],[]),[[0,0,4,4]]);
  assert.deepEqual(uncovered([0,0,4,4],[[-1,-1,5,5]]),[],"a cached file covering the cell needs no download");
  assert.deepEqual(uncovered([0,0,4,4],[[-1,2,5,5]]),[[0,0,4,2]],"a seam cell only requests the uncached strip");
  const parts=uncovered([0,0,4,4],[[1,1,2,2],[3,-1,5,5]]);
  assert.equal(area(parts),16-1-4);
  for(const p of parts)assert.ok(!(p[0]<2&&p[2]>1&&p[1]<2&&p[3]>1)&&p[2]<=3,"no requested part overlaps a cached extent");
}
async function seamDownloadChecks(){
  const dir=fs.mkdtempSync(path.join(root,"seam-")),bodies=[],acquired=[];
  const store=new DnrStore(dir,{request:async(p,body)=>{if(body)bodies.push(JSON.parse(decodeURIComponent(body.slice(8))));
    return body?[{dataset_id:10,dataset_name:"DTM",bytes:1024,files:1}]:p==="/project"?projects:layers;}});
  store.minFreeBytes=0;
  store.index.files=[{key:"k",datasetId:10,bounds:[-119,47.5,-117,48],file:"k.tif",levels:[]}];
  store.acquire=async args=>{acquired.push(args.geometry);return {files:[]};};
  store.queue.set("j",{id:"j",bbox:[-118.5,47.4,-118.4,47.6],datasetId:10,project:name,touched:Date.now(),state:"queued"});
  store.drain();for(let i=0;i<20&&store.active;i++)await tick();
  assert.deepEqual(bodies[0],{type:"Polygon",coordinates:[[[-118.5,47.4],[-118.4,47.4],[-118.4,47.5],[-118.5,47.5],[-118.5,47.4]]]},
    "coverage query excludes the cached file so DNR does not re-zip it");
  assert.deepEqual(acquired[0],bodies[0],"the ZIP download uses the same clipped geometry");
}
async function main(){
  try{uncoveredChecks();await seamDownloadChecks();await catalogueChecks();await acquisitionChecks();await warmAreaChecks();const fixture=await rasterChecks();sourceChoiceChecks();await httpChecks(fixture);
    console.log("DNR checks passed (catalogue, bounded acquisition, GeoTIFF, units, no-data, overviews, styles, HTTP provenance, strict fabric and DNR view downloads)");
  }finally{await runtime.close();fs.rmSync(root,{recursive:true,force:true});}
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={rasterChecks};
