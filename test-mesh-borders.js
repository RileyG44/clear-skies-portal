'use strict';
/* Shared DEM borders after staggered 3D mesh refinement, run through the
   vendored MapLibre code itself: DEMData (Terrarium decode, edge clamp,
   backfillBorder) and tile IDs come from maplibre-gl-shared.mjs, and the
   backfill propagation (co/lo), the in-view tile store, TileManager's
   refreshTiles/_reloadTile/_loadTile/_tileLoaded, raster-dem's
   _getNeighboringTiles/getIds/getTileByID and Map#refreshTiles are sliced
   verbatim from maplibre-gl.mjs. Only the network, the PNG decode, timers
   and the terrain RTT cache (recorded) are stubbed.

   MapLibre marks each neighbour border "backfilled" per tile key, so reloading
   one refined tile leaves its neighbours holding its old elevation along the
   shared edge, and adjacent tiles reloading together can leave one with its
   own clamped edge; the app must redo those borders. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(require.resolve('./index.html'),'utf8');
const between=(start,end)=>{const i=html.indexOf(start);assert(i>=0,start);const j=html.indexOf(end,i);assert(j>i,end);return html.slice(i,j);};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const flush=async()=>{for(let i=0;i<12;i++) await tick();};

/* A method or function body from minified source: from `start` to its
   matching brace, skipping strings and template literals. */
function take(src,start){
  const i=src.indexOf(start);assert(i>=0,`vendored MapLibre no longer contains ${start}`);
  assert.equal(src.indexOf(start,i+1),-1,`${start} is not unique in vendored MapLibre`);
  let depth=0,j=src.indexOf('{',i);const templates=[];
  for(;j<src.length;j++){
    const ch=src[j];
    if(ch==='"'||ch==="'"){for(j++;src[j]!==ch;j++) if(src[j]==='\\') j++;continue;}
    if(ch==='`'){templates.push(depth);for(j++;src[j]!=='`';j++){if(src[j]==='\\'){j++;continue;}if(src[j]==='$'&&src[j+1]==='{'){j++;depth++;break;}}if(src[j]==='`')templates.pop();continue;}
    if(ch==='{') depth++;
    else if(ch==='}'){depth--;
      if(templates.length&&depth===templates[templates.length-1]){templates.pop();for(j++;src[j]!=='`';j++){if(src[j]==='\\'){j++;continue;}if(src[j]==='$'&&src[j+1]==='{'){j++;depth++;templates.push(depth-1);break;}}continue;}
      if(depth===0) return src.slice(i,j+1);}
  }
  throw new Error(`unbalanced ${start}`);
}

async function vendored(){
  const dir=path.join(__dirname,'vendor');
  const shared=await import(path.join(dir,'maplibre-gl-shared.mjs'));
  const main=fs.readFileSync(path.join(dir,'maplibre-gl.mjs'),'utf8');
  const imported=main.match(/^import\{([^}]*)\}from"\.\/maplibre-gl-shared\.mjs"/m);assert(imported,'shared import statement');
  const context={console};
  for(const pair of imported[1].split(',')){const [name,local]=pair.split(' as ');context[local]=shared[name];}
  const coStart=main.indexOf('function co(e,t){'),uoStart=main.indexOf('var uo=class{'),uoEnd=main.indexOf(',fo=class',uoStart);
  assert(coStart>0&&uoStart>coStart&&uoEnd>uoStart,'vendored backfill and tile store');
  const code=`
    var U=()=>Date.now(),Nt=error=>error,h=class{constructor(error,data){this.type="error";this.error=error;Object.assign(this,data)}};
    var K=class{constructor(type,data){this.type=type;Object.assign(this,data)}};
    ${main.slice(coStart,uoStart)}${main.slice(uoStart,uoEnd)};
    class TileManager{
      constructor(id,source){this.id=id;this._source=source;this._inViewTiles=new uo;this._state={initializeTileState(){}};this.map=null}
      getSource(){return this._source} _setTileReloadTimer(){}
      ${take(main,'refreshTiles(e){for(let t of this._inViewTiles')}
      ${take(main,'async _reloadTile(e,t){')}
      ${take(main,'async _loadTile(e,t,n,r){')}
      ${take(main,'_tileLoaded(e,t,n,r,i){')}
      ${take(main,'getIds(){return this._inViewTiles')}
      ${take(main,'getTileByID(e){return this._inViewTiles')}
    }
    class DemSourceBase{ ${take(main,'_getNeighboringTiles(e){')} }
    class MapLike{ constructor(){this.style={tileManagers:{}}} ${take(main,'refreshTiles(e,t){let n=this.style.tileManagers[e]')} }
    this.TileManager=TileManager;this.DemSourceBase=DemSourceBase;this.MapLike=MapLike;`;
  if(process.env.DUMP) fs.writeFileSync("/tmp/mesh-borders-code.js",code);
  vm.runInNewContext(code,context);
  /* DEMData is the shared export with backfillBorder. */
  const DEMData=Object.values(shared).find(value=>typeof value==='function'&&value.prototype?.backfillBorder&&value.prototype?.getUnpackVector);
  assert(DEMData,'vendored DEMData');
  const tileId=context.en;assert.equal(typeof tileId,'function','vendored OverscaledTileID');
  return {...context,DEMData,OverscaledTileID:tileId};
}

const SIZE=256;
function terrarium(metres){
  const rgba=new Uint8Array(SIZE*SIZE*4),v=Math.round((metres+32768)*256);
  for(let i=0;i<SIZE*SIZE;i++){rgba[i*4]=v>>16;rgba[i*4+1]=(v>>8)&255;rgba[i*4+2]=v&255;rgba[i*4+3]=255;}
  return rgba.buffer;
}

async function main(){
  const V=await vendored();
  let now=0;const timers=[];let timerId=0;
  const clock={
    setTimeout:(fn,ms=0)=>{const id=++timerId;timers.push({id,at:now+ms,fn});return id;},
    clearTimeout:id=>{const i=timers.findIndex(t=>t.id===id);if(i>=0) timers.splice(i,1);},
    async advance(ms){const end=now+ms;for(;;){await flush();timers.sort((a,b)=>a.at-b.at);if(!timers.length||timers[0].at>end) break;const t=timers.shift();now=t.at;t.fn();}now=end;await flush();}
  };
  /* 3DEP (the national endpoint) answers only when the test releases a tile:
     overview elevation is 100 m everywhere, each tile's 3DEP is its own height. */
  const Z=10,X0=500,Y0=300,fine=new Map(),released=new Map();
  const fineHeight=(x,y)=>200+(x-X0+1)*10+(y-Y0+1);
  const fetchStub=url=>{
    if(url.startsWith('https://s3.amazonaws.com/')) return Promise.resolve({ok:true,status:200,arrayBuffer:async()=>terrarium(100)});
    const [z,x,y]=url.match(/national\/(\d+)\/(\d+)\/(\d+)\.png/).slice(1).map(Number),key=`${z}/${x}/${y}`;
    return new Promise(resolve=>{const answer=()=>resolve({ok:true,status:200,headers:{get:()=>null},arrayBuffer:async()=>terrarium(fineHeight(x,y))});
      if(released.get(key)) answer();else fine.set(key,answer);});
  };
  const release=(x,y)=>{const key=`${Z}/${x}/${y}`;released.set(key,true);fine.get(key)?.();fine.delete(key);};

  const app={...clock,performance:{now:()=>now},console,
    $:()=>({value:'auto'}),PROXY:true,API:'engine',api:p=>'engine'+p,dnrStatus:{revision:1},dnrElevationAvailable:()=>false,
    fetch:fetchStub,public3dSources:new Map(),public3dDrapeSources:new Map(),scheduleTerrainStatus:()=>{},elevCacheClear:()=>{},
    map3dBuiltKey:'',elevSpectrumRevision:0,maplibreProtocolReady:false};
  vm.runInNewContext(between('function terrainDemTiles(','function terrainTheme(')+'\n'+
    between('async function installMaplibreProtocols(','\nfunction setTerrainModeUi('),app);
  let cspmesh;await app.installMaplibreProtocols({addProtocol:(name,fn)=>{if(name==='cspmesh') cspmesh=fn;}});

  /* The DEM source: MapLibre's own neighbour table and DEMData, fed by the
     app's protocol handler like raster-dem's loadTile. */
  const map=new V.MapLike();let uid=0,wireApp=true;
  const sources={};
  for(const [id,host] of [['dem','dem'],['demShade','shade']]){
    class Source extends V.DemSourceBase{
      constructor(){super();this.id=id;this.type='raster-dem';this.tiles=app.terrainDemTiles(host);this.loads=0}
      async loadTile(tile){
        this.loads++;
        const url=tile.tileID.canonical.url(this.tiles,1,'xyz');
        tile.neighboringTiles=this._getNeighboringTiles(tile.tileID);
        const {data}=await cspmesh({url},new AbortController());
        const padded=new Uint8Array((SIZE+2)*(SIZE+2)*4),bytes=new Uint8Array(data);
        for(let y=0;y<SIZE;y++) padded.set(bytes.subarray(y*SIZE*4,(y+1)*SIZE*4),((y+1)*(SIZE+2)+1)*4);
        tile.dem=new V.DEMData(++uid,{width:SIZE+2,height:SIZE+2,data:padded},'terrarium');
        tile.needsHillshadePrepare=tile.needsTerrainPrepare=tile.needsColorReliefPrepare=true;tile.state='loaded';
      }
      fire(event){ if(wireApp&&event.type==='data') app.meshSourceData({...event,sourceId:id,dataType:'source'}) }
    }
    const manager=new V.TileManager(id,new Source());
    map.style.tileManagers[id]=manager;sources[id]=manager;
  }
  const rttReleased=[];let repaints=0;
  app.map3d={style:map.style,getSource:id=>map.style.tileManagers[id]?{}:undefined,refreshTiles:(id,tiles)=>map.refreshTiles(id,tiles),
    terrain:{tileManager:{releaseRTT:id=>rttReleased.push(`${id.canonical.x}/${id.canonical.y}`)}},triggerRepaint:()=>repaints++};

  /* A 3x3 view of tiles on both sources, loaded the way _addTile loads them. */
  const tile=id=>({tileID:id,state:'loading',uses:1,hasData(){return this.state==='loaded'||this.state==='reloading'||this.state==='expired'},
    isRenderable(){return this.hasData()},setExpiryData(){},getExpiryTimeout(){}});
  for(const manager of Object.values(sources)) for(let y=Y0-1;y<=Y0+1;y++) for(let x=X0-1;x<=X0+1;x++){
    const id=new V.OverscaledTileID(Z,0,Z,x,y),t=tile(id);manager._inViewTiles.setTile(id.key,t);manager._loadTile(t,id.key,t.state,false);
  }
  await clock.advance(400);
  const tileAt=(manager,x,y)=>manager._inViewTiles.getTileById(new V.OverscaledTileID(Z,0,Z,x,y).key);
  const centre=(manager,x,y)=>tileAt(manager,x,y).dem.get(128,128);
  for(const manager of Object.values(sources)) assert.equal(centre(manager,X0,Y0),100,'every tile starts on the overview');

  /* Every border sample a tile holds must equal the neighbour's own edge. */
  function mismatches(manager){
    const bad=[];
    for(let y=Y0-1;y<=Y0+1;y++) for(let x=X0-1;x<=X0+1;x++){
      const t=tileAt(manager,x,y);if(!t) continue;const dim=t.dem.dim;
      for(let by=-1;by<=dim;by++) for(let bx=-1;bx<=dim;bx++){
        if(bx>=0&&bx<dim&&by>=0&&by<dim) continue;
        const dx=bx<0?-1:bx>=dim?1:0,dy=by<0?-1:by>=dim?1:0,nx=x+dx,ny=y+dy;
        if(nx<X0-1||nx>X0+1||ny<Y0-1||ny>Y0+1) continue;
        const other=tileAt(manager,nx,ny);if(!other) continue;
        const want=other.dem.get(bx-dx*dim,by-dy*dim),got=t.dem.get(bx,by);
        if(got!==want) bad.push(`${manager.id} ${x}/${y} border(${bx},${by}) ${got} != ${want}`);
      }
    }
    return bad;
  }
  for(const manager of Object.values(sources)) assert.deepEqual(mismatches(manager),[],'borders agree after the first load');
  for(const manager of Object.values(sources)) assert(Object.values(tileAt(manager,X0,Y0).neighboringTiles).every(n=>n.backfilled),'the vendored backfill ran on load');

  /* Control: the vendored backfill alone. Refreshing only the refined tile
     gives it 3DEP, but its neighbours keep its overview along their edges. */
  wireApp=false;release(X0,Y0);await flush();
  map.refreshTiles('dem',[{z:Z,x:X0,y:Y0}]);await clock.advance(10);
  assert.equal(centre(sources.dem,X0,Y0),fineHeight(X0,Y0),'control: refreshed tile holds 3DEP');
  assert(mismatches(sources.dem).length>0,'control: vendored MapLibre leaves neighbour borders stale after a single-tile refresh (if this fails, MapLibre now re-backfills neighbours itself)');
  /* The app sees that load event and redoes those borders in place: no
     neighbour reloads, and the neighbours' draped textures are released. */
  wireApp=true;const refreshed=tileAt(sources.dem,X0,Y0),before=sources.dem._source.loads;
  app.meshSourceData({type:'data',sourceId:'dem',tile:refreshed,coord:refreshed.tileID});await clock.advance(3000);
  assert.deepEqual(mismatches(sources.dem),[],'the app repairs the borders a single-tile refresh left behind');
  assert.equal(sources.dem._source.loads,before,'repair needs no neighbour reloads');
  assert.deepEqual([...new Set(rttReleased)].sort(),[`${X0-1}/${Y0-1}`,`${X0-1}/${Y0}`,`${X0-1}/${Y0+1}`,`${X0}/${Y0-1}`,`${X0}/${Y0+1}`,`${X0+1}/${Y0-1}`,`${X0+1}/${Y0}`,`${X0+1}/${Y0+1}`],
    'every neighbour releases its draped render-to-texture tiles');
  assert(repaints>0,'a repaint is requested');

  /* Staggered refinement through the app on both sources: single tiles,
     adjacent tiles reloading in one batch (MapLibre's reload race), a second
     tile landing between batches, and a neighbour that is off screen (in
     MapLibre's out-of-view cache) when its neighbour refines. Each step
     settles before borders are checked. */
  const hidden=tileAt(sources.dem,X0+1,Y0-1);
  const steps=[[[X0,Y0]],[[X0+1,Y0],[X0+1,Y0+1]],['hide',[X0-1,Y0-1],'late',[X0,Y0-1],'show'],[[X0,Y0+1],[X0-1,Y0],[X0-1,Y0+1]],[[X0+1,Y0-1]]];
  for(const [index,step] of steps.entries()){
    const loads=Object.values(sources).map(manager=>manager._source.loads);
    for(const item of step){
      if(item==='late'){await clock.advance(1250);continue;}
      if(item==='hide'){sources.dem._inViewTiles.deleteTileById(hidden.tileID.key);continue;}
      if(item==='show'){await clock.advance(3000);sources.dem._inViewTiles.setTile(hidden.tileID.key,hidden);app.meshRefineAgain();continue;}
      release(...item);
    }
    await clock.advance(3000);
    for(const manager of Object.values(sources))
      assert.deepEqual(mismatches(manager),[],`${manager.id}: borders agree after refinement step ${index+1}`);
    if(index===1) assert.deepEqual(Object.values(sources).map(manager=>manager._source.loads-loads.shift()),[2,2],
      'refining two tiles reloads those two only, not their neighbours or the source');
  }
  await clock.advance(5000);
  for(const manager of Object.values(sources)){
    for(let y=Y0-1;y<=Y0+1;y++) for(let x=X0-1;x<=X0+1;x++)
      assert.equal(centre(manager,x,y),fineHeight(x,y),`${manager.id} ${x}/${y} interior refined`);
    assert.deepEqual(mismatches(manager),[],`${manager.id}: every shared border matches after staggered refinement`);
  }
  /* Neighbour reloads are not refinements: nothing keeps reloading. */
  const loads=Object.values(sources).map(manager=>manager._source.loads);
  await clock.advance(5000);
  assert.deepEqual(Object.values(sources).map(manager=>manager._source.loads),loads,'no reload cascade once borders agree');
  console.log('mesh border tests passed (vendored DEM backfill, both sources, staggered refinement)');
}
main().catch(error=>{console.error(error);process.exit(1);});
