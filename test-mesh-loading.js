'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=require("./test-fixtures/page-source.js");
const code=html.slice(html.indexOf('function terrainDemTiles('),html.indexOf('function terrainTheme('));
const flush=async()=>{for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));};
function fixture(){
  const pending=[],ctx={AbortController,DOMException,CSPTilePipeline:require('./tile-pipeline'),console,
    setTimeout,clearTimeout,performance,$:()=>({value:'auto'}),PROXY:true,API:'test',api:x=>x,serverHealth:null,
    dnrStatus:{revision:0},dnrElevationAvailable:()=>false,waitElevationRetry:async()=>{},
    public3dSources:new Map(),public3dDrapeSources:new Map(),scheduleTerrainStatus(){},elevCacheClear(){},
    map3dBuiltKey:'',elevSpectrumRevision:0,map3d:null,
    fetch:(url,{signal})=>new Promise((resolve,reject)=>{
      const entry={url,signal,resolve:(value)=>resolve({ok:true,headers:{get:()=>null},arrayBuffer:async()=>Uint8Array.of(value).buffer}),
        fail:()=>resolve({ok:false,status:503})};
      pending.push(entry);
      signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});
    })};
  vm.runInNewContext(code,ctx);
  return {ctx,pending,request:(x,signal,source='dem')=>ctx.meshTile(10,x,300,signal,source),
    national:x=>pending.find(p=>p.url===`/api/elev/national/10/${x}/300.png`),
    overview:x=>pending.find(p=>p.url.endsWith(`/10/${x}/300.png`)&&p.url.startsWith('https:'))};
}
async function main(){
  let f=fixture(),controller=new AbortController();
  let tile=f.request(500,controller.signal);await flush();
  assert(f.overview(500),'overview starts immediately alongside fine work');
  f.national(500).resolve(2);assert.equal(new Uint8Array(await tile)[0],2);
  assert(f.overview(500).signal.aborted,'fine arrival cancels its slow overview');

  f=fixture();controller=new AbortController();tile=f.request(500,controller.signal);await flush();
  f.overview(500).resolve(1);assert.equal(new Uint8Array(await tile)[0],1);
  assert(!f.national(500).signal.aborted,'visible fine work survives the first overview');
  controller.abort();await flush();assert(f.national(500).signal.aborted,'aborted holder releases background work');

  f=fixture();f.ctx.serverHealth={features:['overview-elevation']};controller=new AbortController();
  tile=f.request(500,controller.signal);await flush();
  const cached=f.pending.find(p=>p.url==='/api/elev/overview/10/500/300.png');
  assert(cached,'an upgraded engine supplies the shared overview cache');
  assert(!f.overview(500),'a cache request must not also download from AWS');
  cached.fail();await flush();
  assert(f.overview(500),'a failed cache route must retain direct-source fallback');
  f.overview(500).resolve(1);assert.equal(new Uint8Array(await tile)[0],1);
  controller.abort();await flush();

  f=fixture();f.ctx.serverHealth={features:['overview-elevation']};controller=new AbortController();
  tile=f.request(500,controller.signal);await flush();
  f.pending.find(p=>p.url==='/api/elev/overview/10/500/300.png').resolve(1);
  assert.equal(new Uint8Array(await tile)[0],1);assert(!f.overview(500),'a successful cache hit needs no AWS request');
  controller.abort();await flush();

  f=fixture();const a=new AbortController(),b=new AbortController();
  const first=assert.rejects(f.request(500,a.signal),{name:'AbortError'}),second=f.request(500,b.signal,'demShade');
  await flush();a.abort();await flush();assert(!f.national(500).signal.aborted,'shade holder retains shared fine work');
  f.national(500).resolve(2);await first;assert.equal(new Uint8Array(await second)[0],2);

  f=fixture();const holders=Array.from({length:8},()=>new AbortController());
  const results=holders.map((holder,i)=>f.request(500+i,holder.signal).catch(error=>error));
  await flush();assert.equal(f.pending.filter(p=>p.url.startsWith('/api/')).length,6,'fine work is bounded');
  assert.equal(f.pending.filter(p=>p.url.startsWith('https:')).length,8,'overview is not blocked by fine slots');
  holders[0].abort();await flush();assert(f.national(506),'cancelling obsolete work starts the next fine tile');
  holders.forEach(h=>h.abort());await Promise.all(results);await flush();
  console.log('mesh loading checks passed (immediate race, refinement lifetime, shared cancellation, bounded work)');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
