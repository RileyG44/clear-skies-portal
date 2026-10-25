'use strict';
/* Shared DEM borders after staggered 3D mesh refinement, run through the
   vendored MapLibre code itself: DEMData (Terrarium decode, edge clamp,
   backfillBorder) and tile IDs come from maplibre-gl-shared.mjs, and the
   backfill propagation (co/lo), the in-view tile store, TileManager's
   refreshTiles/_reloadTile/_loadTile/_tileLoaded, raster-dem's
   _getNeighboringTiles/getIds/getTileByID and Map#refreshTiles are sliced
   verbatim from maplibre-gl.mjs. Only the network, the PNG decode, timers
   and public source/layer glue are stubbed. Source removal and terrain RTT
   destruction also use vendored methods; RTT releases are recorded.

   MapLibre marks each neighbour border "backfilled" per tile key, so reloading
   one refined tile leaves its neighbours holding its old elevation along the
   shared edge, and adjacent tiles reloading together can leave one with its
   own clamped edge; the app must redo those borders. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const baseline=!!process.env.MESH_BORDER_BASELINE;
const html=fs.readFileSync(process.env.MESH_BORDER_BASELINE||require.resolve('./index.html'),'utf8');
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
  // A file:// URL, not a bare path: Windows rejects "C:\..." as an ESM specifier.
  const shared=await import(require('url').pathToFileURL(path.join(dir,'maplibre-gl-shared.mjs')).href);
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
      getSource(){return this._source} _setTileReloadTimer(){} _clearTileReloadTimer(){}
      ${take(main,'onRemove(e){for(let e of this._inViewTiles')}
      ${take(main,'clearTiles(){')}
      ${take(main,'_removeTile(e){')}
      ${take(main,'_unloadTile(e){')}
      ${take(main,'_abortTile(e){')}
      ${take(main,'refreshTiles(e){for(let t of this._inViewTiles')}
      ${take(main,'async _reloadTile(e,t){')}
      ${take(main,'async _loadTile(e,t,n,r){')}
      ${take(main,'_tileLoaded(e,t,n,r,i){')}
      ${take(main,'getIds(){return this._inViewTiles')}
      ${take(main,'getTileByID(e){return this._inViewTiles')}
    }
    class DemSourceBase{ ${take(main,'_getNeighboringTiles(e){')} }
    class MapLike{ constructor(){this.style={tileManagers:{}}} ${take(main,'refreshTiles(e,t){let n=this.style.tileManagers[e]')} }
    class TerrainTiles{
      ${take(main,'destruct(){this.tileManager.usedForTerrain')}
      ${take(main,'releaseAllRTT(){')}
    }
    this.TerrainTiles=TerrainTiles;this.TileManager=TileManager;this.DemSourceBase=DemSourceBase;this.MapLike=MapLike;`;
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

async function main(scenario="normal"){
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

  const warnings=[];
  // This fixture holds fine responses indefinitely and releases them in a
  // border-specific order. Admit its whole 3x3 view; test-mesh-loading.js
  // independently checks the production six-request bound and cancellation.
  const pipeline=require('./tile-pipeline');
  const borderPipeline={...pipeline,RequestPool:class extends pipeline.RequestPool{
    constructor(options){super({...options,concurrency:9});}
  }};
  const app={...clock,AbortController,DOMException,CSPTilePipeline:borderPipeline,waitElevationRetry:async()=>{},performance:{now:()=>now},console:{...console,warn:(...args)=>warnings.push(args.join(" "))},
    $:()=>({value:'auto'}),PROXY:true,API:'engine',api:p=>'engine'+p,serverHealth:null,dnrStatus:{revision:1},dnrElevationAvailable:()=>false,
    fetch:fetchStub,public3dSources:new Map(),public3dDrapeSources:new Map(),scheduleTerrainStatus:()=>{},elevCacheClear:()=>{},
    map3dBuiltKey:'',elevSpectrumRevision:0,maplibreProtocolReady:false};
  vm.runInNewContext(between('function terrainDemTiles(','function terrainTheme(')+'\n'+
    between('async function installMaplibreProtocols(','\nfunction setTerrainModeUi('),app);
  let cspmesh;await app.installMaplibreProtocols({addProtocol:(name,fn)=>{if(name==='cspmesh') cspmesh=fn;}});

  /* The DEM source: MapLibre's own neighbour table and DEMData, fed by the
     app's protocol handler like raster-dem's loadTile. */
  const map=new V.MapLike();let uid=0,wireApp=true;
  const sources={},loadCounts={dem:0,demShade:0},resets=[];let missingInternals=false;
  const layers=[{id:'background',type:'background'},{id:'relief',type:'color-relief',source:'demShade'},
    {id:'drape',type:'raster',source:'image'},{id:'hillshade',type:'hillshade',source:'demShade'}];
  const initialLayers=JSON.stringify(layers);
  const specs={dem:{type:'raster-dem',tiles:app.terrainDemTiles('dem'),encoding:'terrarium',tileSize:256,maxzoom:17},
    demShade:{type:'raster-dem',tiles:app.terrainDemTiles('shade'),encoding:'terrarium',tileSize:256,maxzoom:17}};
  const makeManager=(id,options)=>{
    class Source extends V.DemSourceBase{
      constructor(){super();this.id=id;this.type='raster-dem';this.tiles=options.tiles;this.loads=0}
      async loadTile(tile){
        this.loads++;loadCounts[id]++;
        const url=tile.tileID.canonical.url(this.tiles,1,'xyz');
        tile.neighboringTiles=this._getNeighboringTiles(tile.tileID);
        const {data}=await cspmesh({url},new AbortController());
        const padded=new Uint8Array((SIZE+2)*(SIZE+2)*4),bytes=new Uint8Array(data);
        for(let y=0;y<SIZE;y++) padded.set(bytes.subarray(y*SIZE*4,(y+1)*SIZE*4),((y+1)*(SIZE+2)+1)*4);
        tile.dem=new V.DEMData(++uid,{width:SIZE+2,height:SIZE+2,data:padded},'terrarium');
        tile.needsHillshadePrepare=tile.needsTerrainPrepare=tile.needsColorReliefPrepare=true;tile.state='loaded';
      }
      unloadTile(tile){delete tile.dem;tile.state='unloaded'}
      fire(event){ if(wireApp&&event.type==='data') app.meshSourceData({...event,sourceId:id,dataType:'source'}) }
    }
    const manager=new V.TileManager(id,new Source());
    const cache=[];manager._outOfViewCache={add:(id,t)=>cache.push(t),reset:()=>{for(const t of cache)manager._unloadTile(t);cache.length=0}};
    map.style.tileManagers[id]=manager;sources[id]=manager;manager.map={painter:{}};
    if(missingInternals&&scenario==='missing-getIds') manager.getIds=undefined;
    return manager;
  };
  for(const id of ['dem','demShade']) makeManager(id,specs[id]);
  const rttReleased=[],rttDiscarded=[];let repaints=0;
  const terrainOptions={source:'dem',exaggeration:1.7};
  const makeTerrain=()=>{
    const tm=new V.TerrainTiles();tm.tileManager=sources.dem;tm._tiles={};
    for(let y=Y0-1;y<=Y0+1;y++) for(let x=X0-1;x<=X0+1;x++)
      tm._tiles[`${x}/${y}`]={releaseRTT:()=>rttDiscarded.push(`${x}/${y}`)};
    tm.releaseRTT=id=>rttReleased.push(`${id.canonical.x}/${id.canonical.y}`);
    if(missingInternals&&scenario==='missing-releaseRTT') tm.releaseRTT=undefined;
    return {options:terrainOptions,tileManager:tm};
  };
  app.map3d={style:map.style,getSource:id=>sources[id]?sources[id]._source:undefined,refreshTiles:(id,tiles)=>map.refreshTiles(id,tiles),
    terrain:makeTerrain(),triggerRepaint:()=>repaints++,
    /* Public source/layer glue, with the real vendored onRemove -> clearTiles
       -> unloadTile path and fresh tile objects on re-add. No refresh mock. */
    getStyle:()=>({sources:specs,layers:[...layers]}),getTerrain:()=>app.map3d.terrain?.options||null,
    setTerrain:options=>{app.map3d.terrain?.tileManager.destruct();app.map3d.terrain=options?makeTerrain():null},
    removeLayer:id=>{const i=layers.findIndex(l=>l.id===id);assert(i>=0);layers.splice(i,1)},
    addLayer:(layer,before)=>{const i=before?layers.findIndex(l=>l.id===before):layers.length;assert(i>=0);layers.splice(i,0,layer)},
    removeSource:id=>{assert(!layers.some(l=>l.source===id));assert(!app.map3d.terrain);sources[id].onRemove();delete sources[id];delete map.style.tileManagers[id]},
    addSource:(id,options)=>{resets.push(id);assert.deepEqual(options,specs[id]);const manager=makeManager(id,options);loadView(manager)}
  };

  /* A 3x3 view of tiles on both sources, loaded the way _addTile loads them. */
  const tile=id=>({tileID:id,state:'loading',uses:1,hasData(){return this.state==='loaded'||this.state==='reloading'||this.state==='expired'},
    isRenderable(){return this.hasData()},unloadVectorData(){},setExpiryData(){},getExpiryTimeout(){}});
  function loadView(manager){for(let y=Y0-1;y<=Y0+1;y++) for(let x=X0-1;x<=X0+1;x++){
    const id=new V.OverscaledTileID(Z,0,Z,x,y),t=tile(id);manager._inViewTiles.setTile(id.key,t);manager._loadTile(t,id.key,t.state,false);
  }}
  for(const manager of Object.values(sources)) loadView(manager);
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

  if(scenario!=="normal"){
    missingInternals=true;
    if(scenario==='missing-getIds') for(const manager of Object.values(sources)) manager.getIds=undefined;
    else if(scenario==='missing-releaseRTT') app.map3d.terrain.tileManager.releaseRTT=undefined;
    else throw new Error(scenario);
    release(X0,Y0);await clock.advance(1300);
    const counts=[{...loadCounts}],borders=[Object.values(sources).map(m=>mismatches(m).length)];
    for(let i=0;i<3;i++){await clock.advance(5000);counts.push({...loadCounts});borders.push(Object.values(sources).map(m=>mismatches(m).length))}
    console.log(`${baseline?'before':'after'} ${scenario}: loads ${JSON.stringify(counts)}, incorrect borders ${JSON.stringify(borders)}, warnings ${warnings.length}, RTT discards ${rttDiscarded.length}`);
    if(baseline){
      if(scenario==='missing-getIds') assert(counts[3].dem>counts[2].dem&&counts[2].dem>counts[1].dem,'control reproduces the reload cascade');
      else assert.equal(rttDiscarded.length,0,'control never invalidates missing RTT internals');
      return;
    }
    assert.deepEqual(counts[1],counts[2],'fallback loads stop in the first 5 s window');
    assert.deepEqual(counts[2],counts[3],'fallback stays stopped');
    assert(counts[1].dem===19&&counts[1].demShade===19,'the single-tile upgrade plus one 9-tile source replacement per source');
    assert.deepEqual(resets.sort(),['dem','demShade'],'one source reset on each affected source');
    assert.equal(warnings.length,1,'missing internals warn once');
    assert(rttDiscarded.length>=18,'source resets discard every drape RTT via vendored terrain destruction');
    for(const manager of Object.values(sources)) assert.deepEqual(mismatches(manager),[],'fresh source tiles have consistent borders');
    assert.equal(JSON.stringify(layers),initialLayers,'source replacement preserves layer order');
    assert.deepEqual(app.map3d.getTerrain(),terrainOptions,'source replacement preserves terrain exaggeration');
    /* A later fine arrival still refines in compatibility mode, in one reset;
       its fresh loads must not perpetuate the compatibility reset either. */
    release(X0+1,Y0);await clock.advance(5000);const later={...loadCounts};
    assert.equal(centre(sources.dem,X0+1,Y0),fineHeight(X0+1,Y0));
    for(const manager of Object.values(sources)) assert.deepEqual(mismatches(manager),[],'later compatibility refinement repairs borders');
    await clock.advance(10000);assert.deepEqual(loadCounts,later,'subsequent compatibility refinement also settles');
    assert.equal(warnings.length,1,'later refinements do not repeat the compatibility warning');
    return;
  }

  /* Control: the vendored backfill alone. Refreshing only the refined tile
     gives it 3DEP, but its neighbours keep its overview along their edges. */
  rttReleased.length=0;wireApp=false;release(X0,Y0);await flush();
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
  /* Evict actual fine bytes through the bounded LRU, then hold a new national
     request while both sources replace fine DEMs with overview. This is an
     ordinary MapLibre reload, without the app's meshReloading marker. */
  const centreKey=`${Z}/${X0}/${Y0}`;released.delete(centreKey);
  vm.runInNewContext(`for(let i=0;i<MESH_FINE_MAX;i++) rememberMeshTile('eviction-'+i,new ArrayBuffer(0));
    if(meshFine.size!==MESH_FINE_MAX) throw new Error('fine cache cap changed');
    if(meshFine.has(meshKey(${Z},${X0},${Y0}))) throw new Error('centre not evicted');`,app);
  const downgradeBefore={...loadCounts};rttReleased.length=0;
  for(const id of ['dem','demShade']) map.refreshTiles(id,[{z:Z,x:X0,y:Y0}]);
  await clock.advance(400);
  const downgradeBad=Object.values(sources).map(m=>mismatches(m).length);
  console.log(`${baseline?'before':'after'} eviction -> overview: incorrect borders ${downgradeBad}, loads ${JSON.stringify(downgradeBefore)} -> ${JSON.stringify(loadCounts)}`);
  for(const manager of Object.values(sources)) assert.equal(centre(manager,X0,Y0),100,'evicted fine bytes cause an overview reload');
  if(baseline) assert.deepEqual(downgradeBad,[1028,1028],'control reproduces incorrect downgrade borders');
  else{
    assert.deepEqual(downgradeBad,[0,0],'every overview replacement repairs both sources');
    assert.equal(new Set(rttReleased).size,8,'downgrade invalidates all neighbour drapes');
  }
  const overviewLoads={...loadCounts};await clock.advance(10000);
  assert.deepEqual(loadCounts,overviewLoads,'overview waits without repeated reloads for new 3DEP');
  release(X0,Y0);await clock.advance(5000);
  for(const manager of Object.values(sources)){
    assert.equal(centre(manager,X0,Y0),fineHeight(X0,Y0),'downgraded tile re-queues and returns to 3DEP');
    assert.deepEqual(mismatches(manager),[],'borders agree again after re-refinement');
  }
  assert.deepEqual(loadCounts,{dem:overviewLoads.dem+1,demShade:overviewLoads.demShade+1},'re-refinement reloads each centre once');
  console.log(`${baseline?'before':'after'} re-refinement: incorrect borders 0,0, loads ${JSON.stringify(loadCounts)}`);
  const settled={...loadCounts};await clock.advance(10000);assert.deepEqual(loadCounts,settled,'re-refinement settles');
  /* Same-quality replacements are observed too, even without app markers. */
  for(const id of ['dem','demShade']) map.refreshTiles(id,[{z:Z,x:X0,y:Y0},{z:Z,x:X0+1,y:Y0}]);
  await clock.advance(5000);
  if(!baseline) for(const manager of Object.values(sources)) assert.deepEqual(mismatches(manager),[],'same-quality adjacent reloads repair the vendored race');
  console.log('mesh border tests passed (vendored DEM backfill, source cleanup, terrain RTT destruction, both sources)');
}
(async()=>{for(const scenario of ['normal','missing-getIds','missing-releaseRTT']) await main(scenario)})().catch(error=>{console.error(error);process.exit(1);});
