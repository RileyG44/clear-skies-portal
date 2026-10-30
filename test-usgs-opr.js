'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const usgs=require('./usgs.js'),manifest=require('./usgs-elwha-opr.json'),cog=require('./cog.js');
assert.equal(manifest.files.length,392);assert.equal(new Set(manifest.files.map(f=>f.key)).size,392);
assert.equal(manifest.files.reduce((n,f)=>n+f.size,0),487350073);
function header(f){return {geo:{epsg:26910,scale:[1,1,0],tie:[0,0,0,f.bounds[0],f.bounds[3],0],nodata:-999999},levels:[{w:f.width,h:f.height,tw:256,th:256,sf:3,bps:32,spp:1}]}}
for(const f of manifest.files){
  assert(f.key.startsWith('StagedProducts/Elevation/OPR/Projects/Elwha_River_WA_LiDAR/WA_ElwhaRiver_2014/TIFF/'));
  usgs.validateElwhaHeader(f,header(f));
}
const file=manifest.files.find(f=>f.key.endsWith('10UDU537182.tif'));
assert.equal(file.bounds[0],453895,'use actual clipped header bounds, not the filename');
assert(usgs.elwhaCandidates(10,file.bounds).includes(file));assert.equal(usgs.elwhaCandidates(11,file.bounds).length,0);
assert.equal(usgs.elwhaCandidates(10,[0,0,1,1]).length,0);
for(const mutate of [t=>t.geo.epsg=null,t=>t.geo.scale[0]=2,t=>t.levels[0].spp=3,t=>t.levels[0].sf=1,t=>t.geo.tie[3]++]){
  const h=header(file);mutate(h);assert.throws(()=>usgs.validateElwhaHeader(file,h),/Incompatible/);
}
async function sampling(){
  let standardValue=222,oprValue=111,failStandard=false,failOPR=false;
  const standard={file:'fixture',project:'Standard',cell:'fixture',year:2024,size:1};
  const ll={lon:-123.58437,lat:47.99898},u=cog.lonLatToUTM(ll.lon,ll.lat,10);
  const standardFile={width:4000,height:4000,bounds:[u.e-2000,u.n-2000,u.e+2000,u.n+2000]};
  const context={require,module:{exports:{}},exports:{},__dirname,Buffer,process,console,setTimeout,clearTimeout,
    fixtureIndex:async()=>({projects:{}}),fixtureCandidates:async()=>[standard],
    fixtureOpen:async(key)=>{
      if(key.endsWith('/fixture')){if(failStandard)throw Error('standard offline');return header(standardFile)}
      if(failOPR)throw Error('OPR offline');return header(manifest.files.find(f=>f.key===key));
    },fixtureTile:async(key)=>new Float32Array(256*256).fill(key.endsWith('/fixture')?standardValue:oprValue)};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'usgs.js'),'utf8')+'\ngetIndex=fixtureIndex;cellCandidates=fixtureCandidates;openCog=fixtureOpen;cogTile=fixtureTile;',context);
  const test=context.module.exports,n=2**20,x=Math.floor((ll.lon+180)/360*n),y=Math.floor((1-Math.asinh(Math.tan(ll.lat*Math.PI/180))/Math.PI)/2*n);
  let result=await test.sampleBest(20,x,y,16);assert.equal(result.coverage,1);assert(result.sources.every(s=>s.project==='Standard'));
  standardValue=-999999;result=await test.sampleBest(20,x,y,16);
  assert.equal(result.coverage,1);assert(result.sources.every(s=>s.product==='Original Product Resolution DEM'));
  assert(result.grid.every(v=>v===111));assert.equal(result.sources[0].verticalUnits,'meters');assert.equal(result.sources[0].nativeMeters,1);
  oprValue=-999999;assert.equal(await test.sampleBest(20,x,y,16),null);
  oprValue=Infinity;assert.equal(await test.sampleBest(20,x,y,16),null,"non-finite samples are not numeric coverage");
  oprValue=111;failStandard=true;await assert.rejects(test.sampleBest(20,x,y,16),/read failed/,'OPR cannot permanently mask a standard read failure');
  failStandard=false;failOPR=true;await assert.rejects(test.sampleBest(20,x,y,16),/read failed/);
  failOPR=false;result=await test.sampleBest(20,x,y,16);assert.equal(result.coverage,1,'stationary retry recovers');
  standardValue=222;const direct=await test.sampleGrid(20,x,y,16);assert(direct.sources.every(s=>s.project==='Standard'),'opened noncontributing OPR must not be reported');
}
sampling().then(()=>console.log('Elwha OPR bounds, numeric validation, standard priority, nodata, transient failure, recovery and contributing-only provenance passed')).catch(error=>{console.error(error);process.exitCode=1});
