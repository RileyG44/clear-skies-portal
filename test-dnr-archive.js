"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {DnrStore}=require("./wadnr");
const {DnrArchive,defaultArchiveRoot}=require("./dnr-archive");
const root=fs.mkdtempSync(path.join(os.tmpdir(),"csp-dnr-archive-"));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const projects=[{name:"Archive Survey 2024",datasets:[
  {ID:10,name:"DTM",XMin:-121,YMin:47,XMax:-120,YMax:48},
  {ID:11,name:"DTM Hillshade",layers:"11h",XMin:-121,YMin:47,XMax:-120,YMax:48}]}];
const layers={layers:[{id:77,name:"11h",type:"Raster Layer"}]};
// A prepared raster on disk: native TIFF plus one overview level.
function raster(dir,key,bounds,size){
  fs.writeFileSync(path.join(dir,key+".tif"),Buffer.alloc(size,1));
  fs.mkdirSync(path.join(dir,key));fs.writeFileSync(path.join(dir,key,"2.f32"),Buffer.alloc(size/2,2));
  return {key,project:"Archive Survey 2024",datasetId:10,year:2024,bounds,file:key+".tif",overviewDir:key,
    levels:[{factor:2,path:"2.f32"}],bytes:size+size/2};
}
function setup(name,{archive=true}={}){
  const cache=path.join(root,name),dir=path.join(cache,"wadnr"),archiveRoot=path.join(root,name+"-icloud");
  fs.mkdirSync(dir,{recursive:true});
  const west=raster(dir,"west",[-121,47,-120.6,47.4],4000),east=raster(dir,"east",[-120.4,47.6,-120,48],4000);
  fs.writeFileSync(path.join(dir,"index.json"),JSON.stringify({version:1,revision:3,files:[west,east],
    regions:[{datasetId:10,bbox:[-120.9,47.1,-120.8,47.2]},{datasetId:10,bbox:[-120.2,47.7,-120.1,47.8]}]}));
  // West was used long ago, east recently.
  fs.writeFileSync(path.join(dir,"usage.json"),JSON.stringify({west:1000,east:Date.now()}));
  const downloads=[];
  const store=new DnrStore(cache,{archive:archive?new DnrArchive(archiveRoot):null,
    request:async p=>{if(p==="/project")return projects;if(p.includes("/layers?"))return layers;downloads.push(p);
      return [{dataset_id:10,dataset_name:"DTM",files:1,bytes:100}];},
    workerFactory:()=>{throw new Error("archived data must not be downloaded from DNR again");}});
  store.minFreeBytes=0;
  return {store,dir,archiveRoot,downloads,west,east};
}
async function settle(store){for(let i=0;i<200&&(store.active||store.queue.size);i++)await new Promise(r=>setTimeout(r,10));}
function tileInside(bounds){
  const z=16,n=2**z,lon=(bounds[0]+bounds[2])/2,lat=(bounds[1]+bounds[3])/2;
  return [z,Math.floor((lon+180)/360*n),Math.floor((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*n)];
}

async function evictionChecks(){
  const {store,dir,archiveRoot,west}=setup("evict");
  store.maxBytes=7000;  // two 6000-byte rasters exceed it; one fits
  const before=store.index.revision;
  await store.makeRoom(1000,[-100,40,-99,41]);
  assert.deepEqual(store.index.files.map(f=>f.key),["east"],"the least recently used raster leaves the local store");
  assert(store.index.revision>before,"tiles re-render once a raster is unlisted");
  assert(!fs.existsSync(path.join(dir,"west.tif"))&&!fs.existsSync(path.join(dir,"west")),"local copy is removed");
  assert.equal(store.index.regions.length,1,"coverage claims for archived data are dropped so the area can be loaded again");
  const folder=path.join(archiveRoot,"files","west");
  assert.equal(fs.statSync(path.join(folder,"west.tif")).size,4000);
  assert.equal(fs.statSync(path.join(folder,"west","2.f32")).size,2000);
  const record=JSON.parse(fs.readFileSync(path.join(folder,"record.json"),"utf8"));
  assert.equal(record.lastUsed,1000);assert(record.archivedAt>0);assert.deepEqual(record.bounds,west.bounds);
  const index=JSON.parse(fs.readFileSync(path.join(archiveRoot,"index.json"),"utf8"));
  assert.equal(index.files.length,1);assert.equal(index.files[0].key,"west");
  assert.equal(store.status().archive.files,1);assert.equal(store.status().archive.bytes,6000);

  // A raster covering the area being prepared is never archived for it.
  await store.makeRoom(7000,[-120.3,47.7,-120.1,47.9]);
  assert.deepEqual(store.index.files.map(f=>f.key),["east"]);
  await store.close();
}

async function restoreChecks(){
  const {store,dir,archiveRoot,downloads,west}=setup("restore");
  store.maxBytes=7000;
  await store.makeRoom(1000,[-100,40,-99,41]);
  const [z,x,y]=tileInside(west.bounds);
  assert.equal((await store.ensureTile(z,x,y)).state,"pending","an archived area queues a restore");
  await settle(store);
  assert.deepEqual(downloads,[],"restoring from iCloud makes no DNR download query");
  const keys=store.index.files.map(f=>f.key).sort();
  assert.deepEqual(keys,["west"],"room is made by archiving the other raster, and west comes back");
  assert.equal(fs.readFileSync(path.join(dir,"west.tif")).length,4000);
  assert.equal(fs.readFileSync(path.join(dir,"west","2.f32"))[0],2);
  assert.equal(store.index.files[0].archivedAt,undefined,"archive bookkeeping does not leak into the local index");
  assert(fs.existsSync(path.join(archiveRoot,"files","west","west.tif")),"the iCloud copy is kept after restoring");
  assert.equal((await store.ensureTile(z,x,y)).state,"ready","restored area is served locally");
  assert(!fs.readdirSync(dir).some(n=>n.startsWith("restore-")),"restore staging is cleaned up");

  // Evicting a raster that is already in iCloud is just a local delete.
  const archivedAt=JSON.parse(fs.readFileSync(path.join(archiveRoot,"files","west","record.json"),"utf8")).archivedAt;
  store.maxBytes=1000;
  await store.makeRoom(1,[-100,40,-99,41]);
  assert.equal(store.index.files.length,0);assert(!fs.existsSync(path.join(dir,"west.tif")));
  assert.equal(JSON.parse(fs.readFileSync(path.join(archiveRoot,"files","west","record.json"),"utf8")).archivedAt,archivedAt);
  await store.close();

  // record.json folders rebuild a missing or conflicted index.
  fs.unlinkSync(path.join(archiveRoot,"index.json"));
  const rebuilt=new DnrArchive(archiveRoot);
  assert.deepEqual(rebuilt.list().map(e=>e.key).sort(),["east","west"]);
  assert(fs.existsSync(path.join(archiveRoot,"index.json")));
  fs.rmSync(path.join(archiveRoot,"files","east"),{recursive:true});
  assert.deepEqual(new DnrArchive(archiveRoot).list().map(e=>e.key),["west"],"entries whose folder is gone are dropped");
  assert.equal(rebuilt.find(10,[-100,40,-99,41]).length,0);
  assert.equal(rebuilt.find(10,[-120.9,47.1,-120.8,47.2]).length,1,"spatial lookup finds archived rasters by area");
  assert.equal(rebuilt.find(99,[-120.9,47.1,-120.8,47.2]).length,0,"and by dataset");
}

async function incompleteRestoreChecks(){
  const {store,dir,archiveRoot,west}=setup("incomplete");
  store.maxBytes=7000;
  await store.makeRoom(1000,[-100,40,-99,41]);
  fs.truncateSync(path.join(archiveRoot,"files","west","west.tif"),10);
  const [z,x,y]=tileInside(west.bounds);
  await store.ensureTile(z,x,y);await settle(store);
  assert.equal(store.index.files.some(f=>f.key==="west"),false,"a short iCloud copy never becomes rendered coverage");
  assert.match((await store.ensureTile(z,x,y)).error||"",/incomplete/);
  assert(!fs.readdirSync(dir).some(n=>n.startsWith("restore-")));
  await store.close();
}

async function noArchiveChecks(){
  const {store,east}=setup("no-icloud",{archive:false});
  store.maxBytes=12000;  // full: 12000 bytes used
  const [z,x,y]=tileInside([-118,46,-117.9,46.1]);
  projects[0].datasets[0].XMax=-117;projects[0].datasets[0].YMin=46;
  await store.ensureTile(z,x,y);await tick();
  assert.match((await store.ensureTile(z,x,y)).error||"",/iCloud Drive is not available/,"without iCloud the budget pause says why");
  assert.deepEqual(store.index.files.map(f=>f.key).sort(),["east","west"],"nothing is deleted without an archive");
  assert.equal(store.status().archive.available,false);
  void east;await store.close();
  projects[0].datasets[0].XMax=-120;projects[0].datasets[0].YMin=47;
}

function rootChecks(){
  assert.equal(defaultArchiveRoot({CSP_DNR_ARCHIVE_DIR:"off"}),null);
  const custom=path.join(root,"custom-icloud");
  assert.equal(defaultArchiveRoot({CSP_DNR_ARCHIVE_DIR:custom}),path.resolve(custom));
  if(process.platform!=="darwin")assert.equal(defaultArchiveRoot({}),null,"no iCloud Drive outside macOS");
  const store=new DnrStore(path.join(root,"budget"),{archive:null});
  assert.equal(store.maxBytes,32*1073741824,"default DNR budget is 32 GiB");
  store.close();
}

async function main(){
  rootChecks();
  await evictionChecks();
  await restoreChecks();
  await incompleteRestoreChecks();
  await noArchiveChecks();
  console.log("dnr archive: all checks passed");
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>fs.rmSync(root,{recursive:true,force:true}));
