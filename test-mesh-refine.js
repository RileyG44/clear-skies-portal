'use strict';
/* Progressive 3D mesh refinement: a tile served the CDN overview is reloaded on
   its own once its 3DEP lands, on the source that holds it, and never by
   changing the whole source's tile URL (which made MapLibre reload every DEM
   tile in view about once a second). */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require.resolve('./index.html'),'utf8');
const between=(start,end)=>{const i=html.indexOf(start);assert(i>=0,start);const j=html.indexOf(end,i);assert(j>i,end);return html.slice(i,j);};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const flush=async()=>{for(let i=0;i<8;i++) await tick();};

async function main(){
  let now=0;const timers=[];let timerId=0;
  const clock={
    setTimeout:(fn,ms=0)=>{const id=++timerId;timers.push({id,at:now+ms,fn});return id;},
    clearTimeout:id=>{const i=timers.findIndex(t=>t.id===id);if(i>=0) timers.splice(i,1);},
    async advance(ms){
      const end=now+ms;
      for(;;){
        await flush();timers.sort((a,b)=>a.at-b.at);
        if(!timers.length||timers[0].at>end) break;
        const t=timers.shift();now=t.at;t.fn();
      }
      now=end;await flush();
    }
  };
  const fine=new Map();   // national URL -> resolve(body|null)
  const fetches=[];
  const fetchStub=(url)=>{
    fetches.push(url);
    if(url.startsWith('https://s3.amazonaws.com/')) return Promise.resolve({ok:true,status:200,arrayBuffer:async()=>new Uint8Array([1]).buffer});
    return new Promise(resolve=>fine.set(url,body=>resolve(body===null
      ?{ok:true,status:200,headers:{get:name=>name==='X-Coverage'?'none':null},arrayBuffer:async()=>new ArrayBuffer(0)}
      :{ok:true,status:200,headers:{get:()=>null},arrayBuffer:async()=>new Uint8Array([2]).buffer})));
  };
  const refreshes=[],setTiles=[];
  const map3d={
    sources:new Set(['dem','demShade']),
    getSource(id){return this.sources.has(id)?{setTiles:tiles=>setTiles.push([id,tiles])}:undefined;},
    refreshTiles(id,tiles){refreshes.push([id,Array.from(tiles,t=>`${t.z}/${t.x}/${t.y}`).sort()]);}
  };
  const context={
    ...clock,performance:{now:()=>now},console,
    $:()=>({value:'auto'}),PROXY:true,API:'engine',api:path=>'engine'+path,dnrStatus:{revision:1},dnrElevationAvailable:()=>false,
    fetch:fetchStub,public3dSources:new Map(),public3dDrapeSources:new Map(),scheduleTerrainStatus:()=>{},elevCacheClear:()=>{},
    map3dBuiltKey:'x',elevSpectrumRevision:0,map3d,maplibreProtocolReady:false
  };
  vm.runInNewContext(between('function terrainDemTiles(','function terrainTheme(')+'\n'+
    between('async function installMaplibreProtocols(','\nfunction setTerrainModeUi('),context);
  const handlers={};
  await context.installMaplibreProtocols({addProtocol:(name,fn)=>{handlers[name]=fn;}});
  const request=(url)=>handlers.cspmesh({url},new AbortController()).then(result=>result.data);
  const national=(z,x,y)=>`engine/api/elev/national/${z}/${x}/${y}.png`;

  /* Both sources ask under their own host; the URL revision is fixed. */
  const demUrl=context.terrainDemTiles('dem')[0],shadeUrl=context.terrainDemTiles('shade')[0];
  assert.match(demUrl,/^cspmesh:\/\/dem\/\{z\}\/\{x\}\/\{y\}\.png\?r=\d+$/);
  assert.match(shadeUrl,/^cspmesh:\/\/shade\/\{z\}\/\{x\}\/\{y\}\.png\?r=\d+$/);
  const tileUrl=(template,z,x,y)=>template.replace('{z}',z).replace('{x}',x).replace('{y}',y);

  /* Slow 3DEP: the overview answers, then a burst of arrivals is one refresh of
     exactly those tiles on the source that holds them. */
  const a=request(tileUrl(demUrl,14,10,20)),b=request(tileUrl(demUrl,14,11,20)),c=request(tileUrl(shadeUrl,14,10,20));
  await clock.advance(300);
  assert.deepEqual(new Uint8Array(await a),new Uint8Array([1]),'overview answers after MESH_FAST_WAIT');
  await b;await c;
  assert.equal(refreshes.length,0,'nothing to refresh before 3DEP lands');
  fine.get(national(14,10,20))(new Uint8Array([2]));fine.get(national(14,11,20))(new Uint8Array([2]));
  await clock.advance(100);
  assert.equal(refreshes.length,0,'refresh is batched, not per arrival');
  await clock.advance(1200);
  assert.deepEqual(refreshes,[['dem',['14/10/20','14/11/20']],['demShade',['14/10/20']]],'only the refined tiles are refreshed, per source');
  assert.equal(setTiles.length,0,'refinement never rewrites the source URL');
  assert.equal(context.terrainDemTiles('dem')[0],demUrl,'refinement does not bump the URL revision');

  /* A tile out of view is not reloaded by refreshTiles; it stays pending and is
     refreshed again when the view moves, until its source asks for it again. */
  refreshes.length=0;
  context.meshRefineAgain();await clock.advance(1300);
  assert.deepEqual(refreshes,[['dem',['14/10/20','14/11/20']],['demShade',['14/10/20']]],'unserved tiles stay pending');
  refreshes.length=0;
  const fetchCount=fetches.length;
  assert.deepEqual(new Uint8Array(await request(tileUrl(demUrl,14,10,20))),new Uint8Array([2]),'reload answers 3DEP from memory');
  assert.equal(fetches.length,fetchCount,'refined tile reloads without a network request');
  context.meshRefineAgain();await clock.advance(1300);
  assert.deepEqual(refreshes,[['dem',['14/11/20']],['demShade',['14/10/20']]],'dem being served does not clear demShade’s copy');
  refreshes.length=0;
  await request(tileUrl(demUrl,14,11,20));await request(tileUrl(shadeUrl,14,10,20));
  context.meshRefineAgain();await clock.advance(1300);
  assert.equal(refreshes.length,0,'nothing left to refresh once every holder was served 3DEP');

  /* Where 3DEP has nothing the overview is final: no refresh. Wrapped x is
     normalised to the canonical tile MapLibre refreshes. */
  const none=request(tileUrl(demUrl,14,12,20));await clock.advance(300);await none;
  fine.get(national(14,12,20))(null);await clock.advance(1300);
  assert.equal(refreshes.length,0,'no 3DEP coverage means no refresh');
  const wrapped=request(tileUrl(demUrl,3,9,2));await clock.advance(300);await wrapped;
  fine.get(national(3,1,2))(new Uint8Array([2]));await clock.advance(1300);
  assert.deepEqual(refreshes,[['dem',['3/1/2']]],'x wraps to the canonical tile');
  refreshes.length=0;

  /* A genuine reset still changes the URL and forgets pending refreshes. */
  const pending=request(tileUrl(demUrl,14,13,20));await clock.advance(300);await pending;
  context.resetMeshSources();
  assert.notEqual(context.terrainDemTiles('dem')[0],demUrl,'reset bumps the revision');
  fine.get(national(14,13,20))(new Uint8Array([2]));context.meshRefineAgain();await clock.advance(1300);
  assert.equal(refreshes.length,0,'a reset drops refreshes for the old sources');

  /* A source that is not in the style is skipped rather than throwing. */
  map3d.sources.delete('demShade');
  const shadeOnly=request(tileUrl(context.terrainDemTiles('shade')[0],14,14,20));await clock.advance(300);await shadeOnly;
  fine.get(national(14,14,20))(new Uint8Array([2]));await clock.advance(1300);
  assert.equal(refreshes.length,0,'missing source is not refreshed');

  await assert.rejects(request('cspmesh://other/1/2/3.png'),/invalid mesh tile/);
  console.log('mesh refine tests passed');
}
main().catch(error=>{console.error(error);process.exit(1);});
