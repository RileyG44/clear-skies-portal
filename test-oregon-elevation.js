'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),os=require('node:os');
const {createRequire}=require('node:module'),zlib=require('node:zlib');
const {TerrainPool}=require('./terrain-pool.js'),terrain=require('./engine/terrain.js');
const publicTerrain=require('./public-terrain.js'),{buildSources,ElevationTileStore}=require('./gpu-terrain-store.js');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const root=__dirname,localRequire=createRequire(path.join(root,'engine/oregon.js'));
function tiff(values){
  const tags=[[256,4,4],[257,4,4],[258,3,32],[259,3,1],[273,4,134],[277,3,1],[278,4,4],[279,4,64],[339,3,3],[262,3,1]];
  const b=Buffer.alloc(198);b.write('II');b.writeUInt16LE(42,2);b.writeUInt32LE(8,4);b.writeUInt16LE(tags.length,8);
  tags.forEach(([tag,type,value],i)=>{const p=10+i*12;b.writeUInt16LE(tag,p);b.writeUInt16LE(type,p+2);b.writeUInt32LE(1,p+4);
    if(type===3)b.writeUInt16LE(value,p+8);else b.writeUInt32LE(value,p+8);});
  values.forEach((v,i)=>b.writeFloatLE(v,134+i*4));return b;
}
function rgba(png){
  png=Buffer.from(png);
  let off=8,width,height,type;const data=[];
  while(off<png.length){const length=png.readUInt32BE(off),name=png.toString('ascii',off+4,off+8),part=png.subarray(off+8,off+8+length);
    if(name==='IHDR'){width=part.readUInt32BE(0);height=part.readUInt32BE(4);type=part[9];}if(name==='IDAT')data.push(part);off+=length+12;}
  const bpp={0:1,2:3,4:2,6:4}[type],stride=width*bpp,bytes=zlib.inflateSync(Buffer.concat(data)),px=Buffer.alloc(height*stride);
  for(let y=0;y<height;y++)for(let x=0;x<stride;x++){
    const f=bytes[y*(stride+1)],a=x>=bpp?px[y*stride+x-bpp]:0,b=y?px[(y-1)*stride+x]:0,c=y&&x>=bpp?px[(y-1)*stride+x-bpp]:0;
    const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);
    px[y*stride+x]=(bytes[y*(stride+1)+1+x]+[0,a,b,(a+b)>>1,pa<=pb&&pa<=pc?a:pb<=pc?b:c][f])&255;
  }
  return Array.from({length:width*height},(_,i)=>type===6?Array.from(px.subarray(i*4,i*4+4)):
    type===2?[...px.subarray(i*3,i*3+3),255]:type===4?[px[i*2],px[i*2],px[i*2],px[i*2+1]]:[px[i],px[i],px[i],255]);
}
const primary={OBJECTID:96,Name:'OLC_LANE_COUNTY_2014_BARE_EARTH_OGIC_2011',Category:1,LowPS:3,ZOrder:2014};
const project={OBJECTID:600,Project:'Lane County 2014',CELL_SIZE:'3 FOOT',Vert_Units:'Feet',Vert_Datum:'NAVD88',ACQ_DATES:'2013-2015'};
function fixture(){
  const memory=new Map(),calls=[];let fail=false,overviewOnly=false,values=Array(16).fill(3977.22);values[0]=-999999;values[1]=12000;
  const context={module:{exports:{}},process,Buffer,console,URLSearchParams,require:name=>name==='./tile-cache.js'?{
    TTL_TILE:Infinity,key:x=>x,cacheGet:k=>memory.get(k),cachePut:(k,status,type,body,sourceMeta)=>memory.set(k,{status,type,body,sourceMeta})
  }:name==='./upstream.js'?{limitedUpstream:async(id,options,body,signal)=>{
    signal?.throwIfAborted();calls.push(options);if(fail)throw Error('offline');
    const u=new URL('https://fixture'+options.path);
    if(u.pathname.endsWith('/query')){
      const geometry=JSON.parse(u.searchParams.get('geometry'));assert(Object.values(geometry).every(v=>typeof v==='object'||Number.isFinite(v)));
      const items=u.pathname.includes('DOGAMI_Lidar_Project_Status')?[project]:[{...primary,Category:overviewOnly?2:1}];
      return {status:200,body:Buffer.from(JSON.stringify({features:items.map(attributes=>({attributes}))}))};
    }
    assert.equal(u.searchParams.get('format'),'tiff');assert.deepEqual(JSON.parse(u.searchParams.get('renderingRule')),{rasterFunction:'None'});
    assert.deepEqual(JSON.parse(u.searchParams.get('mosaicRule')).lockRasterIds,[96]);
    return {status:200,body:tiff(values)};
  }}:localRequire(name)};
  vm.runInNewContext(fs.readFileSync(path.join(root,'engine/oregon.js'),'utf8'),context,{filename:'engine/oregon.js'});
  const module=context.module.exports;
  async function request(z=18,x=42287,y=94982,signal=new AbortController().signal){
    const res={req:{headers:{origin:'https://rileyg44.github.io',method:'GET'}},writeHead(s,h){this.status=s;this.headers=h;return this;},end(b){this.body=b;}};
    await module.routes['/api/oregon/elev/']({},res,{p:`/api/oregon/elev/${z}/${x}/${y}.png`,signal});return res;
  }
  return {module,request,calls,memory,setFail:v=>{fail=v;},setOverviewOnly:v=>{overviewOnly=v;}};
}
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'csp-oregon-test-')),pool=new TerrainPool({cacheDir:dir,size:1});terrain.init(pool,null);
 try{
  const f=fixture(),selected=f.module.selectSources([primary,{...primary,OBJECTID:25,Name:'SWEET_HOME_2016',Category:2}],[project]);
  assert.equal(selected.length,1);assert.equal(selected[0].metadataDatasetId,600,'metadata ids need not equal raster ids');
  assert.equal(f.module.selectSources([primary],[{...project,Project:'Keno 2012',OBJECTID:96}]).length,0,'a coincident id cannot establish the survey');
  assert.equal(f.module.selectSources([primary],[{...project,Project:'Lane County 2015'}]).length,0,'matching place names cannot substitute for the survey year');
  for(const p of [{...project,Vert_Units:'Unknown'},{...project,CELL_SIZE:'30 FOOT'}])assert.equal(f.module.selectSources([primary],[p]).length,0);
  assert.equal(f.module.selectSources([{...primary,Category:2}],[project]).length,0,'overviews are never numeric lidar');
  const first=await f.request();assert.equal(first.status,200);assert.equal(+first.headers['X-Coverage'],.938);
  const px=rgba(first.body),height=p=>p[0]*256+p[1]+p[2]/256-32768;
  assert.equal(px[0][3],0,'nodata stays transparent');
  assert(Math.abs(height(px[1])-3657.6)<.004,'a 12000-foot summit converts before the elevation validity range check');
  assert(Math.abs(height(px[2])-3977.22*.3048)<.004,'feet convert to meters exactly once');
  const sources=JSON.parse(decodeURIComponent(first.headers['X-Oregon-Sources']));
  assert.equal(sources[0].provider,'Oregon DOGAMI');assert.equal(sources[0].verticalUnits,'meters');assert.equal(sources[0].sourceVerticalUnits,'Feet');
  assert.match(first.headers['Access-Control-Expose-Headers'],/X-Oregon-Sources/);
  const page=require('./test-fixtures/page-source.js'),fetchCode=page.slice(page.indexOf('async function fetchElevation('),page.indexOf('\nfunction waitElevationRetry('));
  const reader={AbortController,DOMException,setTimeout,clearTimeout,ElevationTileCore:require('./elevation-tile-core.js'),
    fetchOverviewResponse:async()=>({ok:true,headers:new Headers(first.headers),blob:async()=>new Blob([first.body])}),
    drapeWorkers:{run:async()=>({grid:new Float32Array([1212]),width:1,height:1})}};
  vm.runInNewContext(fetchCode,reader);
  const decoded=await reader.fetchElevation('/api/oregon/elev/18/42287/94982.png',new AbortController().signal);
  assert.equal(decoded.surveys[0].project,'Lane County 2014','the browser retains Oregon provenance from the dedicated response header');
  assert.equal((await f.request()).headers['X-Cache'],'hit');assert.equal(f.calls.length,3,'resident revisit skips catalog, download and decode');
  await f.request(18,42288,94982);assert.equal(f.calls.length,4,'nearby tiles share both catalog lookups');
  const outside=await f.request(18,50000,50000);assert.equal(outside.headers['X-Coverage'],'none');assert.equal(f.calls.length,4);
  assert.equal((await f.request(19)).status,400);
  const failed=fixture();failed.setFail(true);assert.equal((await failed.request()).status,503);assert.equal(failed.memory.size,0,'failed catalogs cannot cache absence');
  failed.setFail(false);assert.equal((await failed.request()).status,200,'stationary retries recover');
  const overview=fixture();overview.setOverviewOnly(true);assert.equal((await overview.request()).headers['X-Coverage'],'none');assert.equal(overview.calls.length,2,'an overview match never triggers a numeric export');
  const cancelled=fixture(),controller=new AbortController();controller.abort();await cancelled.request(18,42287,94982,controller.signal);
  assert.equal(cancelled.calls.length,0,'cancelled demand never reaches the provider');

  const sourcesSpec=buildSources({oregonEndpoint:'/api/oregon/elev'},{proxy:true,api:x=>x,oregonTileAllowed:publicTerrain.oregonTileAllowed});
  assert.equal(sourcesSpec[0].rank,6);assert.equal(sourcesSpec[0].group,'oregon');
  assert(sourcesSpec[0].allowed({z:18,x:42287,y:94982}));assert(!sourcesSpec[0].allowed({z:18,x:50000,y:50000}));
  const overlapping=buildSources({oregonEndpoint:'/api/oregon/elev',dnrEndpoint:'/api/wadnr/elev'},
    {proxy:true,api:x=>x,oregonTileAllowed:publicTerrain.oregonTileAllowed,dnrTileAllowed:c=>c.x===42287});
  assert(!overlapping[0].allowed({z:18,x:42287,y:94982}),'available DNR retains priority where the provider regions overlap');
  assert(overlapping[0].allowed({z:18,x:42288,y:94982}),'Oregon remains enabled outside available DNR coverage');
  const store=new ElevationTileStore({sources:sourcesSpec,request:async()=>({grid:new Float32Array([1212]),width:1,height:1,surveys:sources})});
  try{store.want([{z:18,x:42287,y:94982}]);await tick();assert.equal(store.provenance().ranks[6],65536);assert.equal(store.detailGaps().length,0,'numeric Oregon coverage suppresses published gap pictures');}
  finally{store.destroy();}
  console.log('Oregon elevation: primary-source matching, units, nodata, coverage, provenance, bounds, retries, shared catalogs and GPU detail passed');
 }finally{await pool.close();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
