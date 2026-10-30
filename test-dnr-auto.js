'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {ElevationTileStore}=require('./gpu-terrain-store');
const tick=()=>new Promise(r=>setImmediate(r));
const c={z:16,x:10700,y:23000},view=[-121.22,45.97,-121.20,45.99];
function fixture(){
  const calls=[],events={},classes=new Set();class ElevLayer{}
  const layer=new ElevLayer(),canvas={width:2,height:2,_cspCoords:c,_cspNumericCounts:{2:4},_cspRefining:false,_cspSourceCounts:{4:4}};
  layer._tiles={one:{el:canvas}};
  const nodes={'#terSrc':{value:'auto'},'#terStyle':{value:'hs'}};
  const ctx={console,Map,ElevLayer,PROXY:true,serverHealth:{features:['wadnr-auto']},API:'engine',
    dnrElevationAvailable:()=>true,dnrBusy:false,dnrSelBbox:null,terrainSwap:null,snapshotExporting:false,snapshotPanel:{hidden:true},researchStack:[],
    gpuTerrainLayer:null,terLayer:layer,elevLayer:null,elevationActive:()=>false,
    waCoverageState:'ready',waCover:[{dtmDataset:1,bounds:view}],dnrStatus:{cachedBounds:[]},
    map:{hasLayer:l=>l===layer,getZoom:()=>16,on:(name,fn)=>{events[name]=fn}},document:{body:{classList:{contains:c=>classes.has(c)}}},
    $:id=>nodes[id],dnrViewportBbox:()=>view,tileBbox:()=>view,
    bboxIntersects:(a,b)=>a[0]<b[2]&&a[2]>b[0]&&a[1]<b[3]&&a[3]>b[1],
    bboxContains:(a,b)=>a[0]<=b[0]&&a[1]<=b[1]&&a[2]>=b[2]&&a[3]>=b[3],
    startDnrDownload:(bbox,opts)=>calls.push({bbox,opts}),setTimeout:()=>1,clearTimeout:()=>{}};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync('app/dnr-auto.js','utf8'),ctx);
  return {ctx,layer,canvas,nodes,calls,events,classes};
}
function gating(){
  const cases=[f=>f.ctx.PROXY=false,f=>f.ctx.serverHealth.features=[],f=>f.ctx.dnrBusy=true,
    f=>f.ctx.map.getZoom=()=>14.9,f=>f.nodes['#terSrc'].value='3dep',f=>f.nodes['#terSrc'].value='usgs1m',
    f=>f.classes.add('terrain-3d'),f=>f.ctx.snapshotExporting=true,f=>f.ctx.snapshotPanel.hidden=false,
    f=>f.ctx.researchStack=[{status:'busy'}],f=>f.ctx.terrainSwap={},f=>f.ctx.dnrSelBbox=view,
    f=>f.canvas._cspRefining=true,f=>f.canvas._cspRefineFailed=true,f=>f.canvas._cspNumericCounts={3:4},
    f=>f.canvas._cspNumericCounts={5:4},f=>f.canvas._cspNumericCounts={3:2,5:2},f=>f.ctx.waCover=[],
    f=>f.ctx.waCoverageState='error',f=>f.ctx.dnrStatus.cachedBounds=[view],f=>f.nodes['#terStyle'].value='off',
    f=>f.events['movestart zoomstart rotatestart']()];
  for(const change of cases){const f=fixture();change(f);f.ctx.checkAutomaticDnr();assert.equal(f.calls.length,0,change.toString());}
  const f=fixture();f.ctx.checkAutomaticDnr();assert.equal(f.calls.length,1,'published image alone neither proves numeric coverage nor blocks a gap');
  assert.equal(f.calls[0].opts.automatic,true);assert.deepEqual(Array.from(f.calls[0].bbox),view);
  f.ctx.checkAutomaticDnr();assert.equal(f.calls.length,1,'a cancelled, failed or completed attempt never restarts in the same session');
  f.ctx.API='other-engine';f.ctx.checkAutomaticDnr();assert.equal(f.calls.length,2,'attempts belong to the connected engine');
  const spectrum=fixture();spectrum.nodes['#terStyle'].value='off';spectrum.ctx.elevationActive=()=>true;
  spectrum.ctx.checkAutomaticDnr();assert.equal(spectrum.calls.length,1,'elevation-only Best available also acquires');
}
async function pixelSummary(){
  let resolveRaw,fail=false;
  const raw={id:'raw',rank:3,label:'raw',url:'raw'},base={id:'base',rank:2,label:'base',url:'base'};
  const store=new ElevationTileStore({sources:[raw,base],retryDelayMs:100000,request:async url=>{
    if(url==='raw'){if(fail)throw Error('unknown');return new Promise(r=>resolveRaw=r)}
    return {grid:new Float32Array([1,1,1,1]),width:2,height:2};}});
  const want=store.want([c]);await tick();assert.equal(store.detailGaps(),null,'unknown requests cannot trigger acquisition');
  resolveRaw({grid:new Float32Array([NaN,NaN,NaN,NaN]),width:2,height:2});await want;await tick();
  assert.deepEqual(store.detailGaps(),[c],'real nodata with national fallback is a detail gap');
  store.clear();fail=true;await store.want([c]);await tick();assert.equal(store.detailGaps(),null,'a retryable USGS failure is not a gap');store.destroy();
}
(async()=>{gating();await pixelSummary();console.log('Automatic DNR gates and real numeric gap checks passed');})().catch(e=>{console.error(e);process.exitCode=1});

async function busyRouteCheck(){
  const {Readable}=require('node:stream'),routes=require('./engine/dnr-routes.js');
  routes.init({warm:{running:true},startWarm(){throw Error('must not replace active work')}});
  const req=Readable.from([Buffer.from(JSON.stringify({bbox:[-121,45,-120.999,45.001]}))]);req.headers={};req.method='POST';
  const res={req,writeHead(status,headers){this.status=status;this.headers=headers;return this},end(body){this.body=body}};
  await routes.routes['/api/wadnr/warm'](req,res,{});
  assert.equal(res.status,409);assert.equal(JSON.parse(res.body).busy,true);
}
busyRouteCheck().catch(error=>{console.error(error);process.exitCode=1});

async function budgetChecks(){
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{DnrStore}=require('./wadnr.js');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'csp-auto-budget-'));
  try{for(const reserve of [false,true]){
    let downloads=0;
    const store=new DnrStore(path.join(root,String(reserve)),{archive:null,request:async p=>{
      if(p==='/project')return [{name:'Survey 2025',datasets:[{ID:10,name:'DTM',XMin:-122,YMin:44,XMax:-120,YMax:46}]}];
      if(p.includes('/layers?'))return {layers:[]};downloads++;throw Error('budget must prevent acquisition');
    }});
    if(reserve)store.minFreeBytes=Number.MAX_SAFE_INTEGER;else store.maxBytes=1;
    const job=store.startWarm([-121,45,-120.999,45.001]);
    for(let i=0;i<30&&store.warm.running;i++)await new Promise(r=>setTimeout(r,100));
    assert.equal(store.warm.running,false);assert.match(store.warm.error,reserve?/free-space reserve/:/storage budget/);
    assert.equal(downloads,0);assert.equal(store.index.files.length,0);assert(job.id);await store.close();
  }}finally{fs.rmSync(root,{recursive:true,force:true})}
}
budgetChecks().catch(error=>{console.error(error);process.exitCode=1});
