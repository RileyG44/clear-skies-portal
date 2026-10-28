"use strict";
/* Exercise actual files and the warm functions with stub upstreams. These
   tests must never use the installed service/cache or make network requests. */
const assert=require("assert/strict"),fs=require("fs"),fsp=fs.promises,os=require("os"),path=require("path"),vm=require("vm");
const budget=require("./cache-budget.js"),{sha1}=budget;
const dirs=[];let checks=0;
const temp=()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),"csp-budget-"));dirs.push(dir);return dir};
const now=Date.now(),old=now-24*3600000;
async function file(dir,name,size,atime=old,mtime=old){
  const f=path.join(dir,name);await fsp.mkdir(path.dirname(f),{recursive:true});await fsp.writeFile(f,Buffer.alloc(size));await fsp.utimes(f,atime/1000,mtime/1000);return f;
}
async function pair(dir,key,size,atime=old,mtime=old){await file(dir,key,size,atime,mtime);await file(dir,key+".meta",10,atime,mtime)}
async function exists(f){try{await fsp.access(f);return true}catch{return false}}
function extract(source,name){
  const start=source.indexOf(`async function ${name}(`),end=source.indexOf(`\n}\n`,start)+2;
  assert(start>=0&&end>start);return source.slice(start,end);
}
async function warmKeyChecks(){
  const source=fs.readFileSync(path.join(__dirname,"engine","downloads.js"),"utf8"),raw=fs.readFileSync(path.join(__dirname,"usgs.js"),"utf8");
  const tile={z:13,x:1380,y:2880},N=2**tile.z;
  const lon=(tile.x+.4)/N*360-180,lat=Math.atan(Math.sinh(Math.PI*(1-2*(tile.y+.4)/N)))*180/Math.PI;
  const bbox=[lon,lat-.00001,lon+.00001,lat],base={bbox,z0:13,z1:13,label:"test"};
  assert.deepEqual(budget.tileRange(bbox,13),{x0:tile.x,x1:tile.x,y0:tile.y,y1:tile.y});
  const writes=[],manifests=[],ctx={cacheBudgetCore:budget,key:sha1,tileRange:budget.tileRange,mercBbox:budget.mercBbox,
    warm:{},usgsWarm:{controllers:new Set()},terrainPool:{size:3,run:async()=>({png:Buffer.from("png")})},
    cacheGet:()=>null,cachePut:(k)=>writes.push(k),upstream:async()=>({status:200,body:Buffer.from("png")}),
    isPng:()=>true,waQuery:async()=>[],areaSave:a=>manifests.push(a),dsFingerprint:()=>[],
    WADNR_HOST:"example",WADNR_MAP:"/test",TTL_TILE:1,TILE_MS:1,nationalElevationTiff:async()=>Buffer.alloc(1),
    AbortController,Buffer,usgs:{finalizeWarm:async job=>manifests.push(job)}};
  vm.createContext(ctx);vm.runInContext(extract(source,"startWarm")+"\n"+extract(source,"startUsgsWarm"),ctx);
  const job={...base,layers:"0,7",rule:"Slope Map"};await ctx.startWarm(job);
  const bb=budget.mercBbox(tile.z,tile.x,tile.y),rr=encodeURIComponent(JSON.stringify({rasterFunction:job.rule}));
  const expected=[sha1(`wadnr:export:?bbox=${bb}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&dpi=96&f=image&layers=show:0,7`),
    sha1(`3dep:/arcgis/rest/services/3DEPElevation/ImageServer/exportImage?bbox=${bb}&bboxSR=3857&imageSR=3857&size=256,256&format=png&transparent=true&f=image&renderingRule=${rr}`)];
  assert.deepEqual(writes,expected);assert.deepEqual(new Set(budget.manifestKeys(manifests[0],"areas")),new Set(expected));
  writes.length=0;const usgsJob={...base,style:"slope",raw:true};await ctx.startUsgsWarm(usgsJob);
  const national=sha1(`elevation-national-v1:13/${tile.x}/${tile.y}`),elev=sha1(`usgselev:13/${tile.x}/${tile.y}`);
  assert.deepEqual(new Set(writes),new Set([national,elev]));
  const style=sha1(`terrain-v3:slope:13/${tile.x}/${tile.y}`);
  assert.deepEqual(new Set(budget.manifestKeys(usgsJob,"usgs/areas")),new Set([style,national,elev]));
  assert.deepEqual(new Set(budget.manifestKeys({...usgsJob,raw:false},"usgs/areas")),new Set([style,national]));
  const legacyWrites=[],legacy={cacheBudget:budget,planTiles:()=>[tile],warm:{},renderTile:async()=>({png:Buffer.from("png"),meta:{sources:[]}}),finalizeWarm:async()=>{}};
  vm.createContext(legacy);vm.runInContext(extract(raw,"startWarm"),legacy);
  await legacy.startWarm(usgsJob,{get:()=>null,put:(s,z,x,y,png,k)=>legacyWrites.push(k)});
  assert.deepEqual(legacyWrites,[style]);
  const dir=temp();await file(dir,"areas/sample.json",0);await fsp.writeFile(path.join(dir,"areas/sample.json"),JSON.stringify(job));
  await file(dir,"usgs/areas/sample.json",0);await fsp.writeFile(path.join(dir,"usgs/areas/sample.json"),JSON.stringify(usgsJob));
  assert.deepEqual((await budget.readPins(dir)).pins,new Set([...expected,style,national,elev]));
  checks+=7;return {job,usgsJob,national,style};
}
(async()=>{
  try{
    const samples=await warmKeyChecks();
    /* LRU differs from mtime; the newest-written body is the oldest-used one.
       130 bytes exceeds 120, so stop at <=108, after exactly one 40-byte pair. */
    const dir=temp(),a=sha1("a"),b=sha1("b"),c=sha1("c");
    await pair(dir,a,30,old,old+10000);await pair(dir,b,30,old+2000,old);await file(dir,"usgs/"+c,50,old+4000);
    const dry=await budget.sweep(dir,{capBytes:120,dryRun:true});assert.equal(dry.evictedBytes,40);assert.equal(dry.bytes,90);assert(await exists(path.join(dir,a)));
    const deleted=[];const result=await budget.sweep(dir,{capBytes:120,onEvict:k=>deleted.push(k)});
    assert.deepEqual(deleted,[a]);assert.equal(result.rootBodiesEvicted,1);assert.equal(result.evictedCount,1);assert.equal(result.bytes,90);
    assert(!await exists(path.join(dir,a)));assert(!await exists(path.join(dir,a+".meta")));assert(await exists(path.join(dir,b)));assert(await exists(path.join(dir,"usgs/"+c)));checks+=4;
    /* tmp, JSON, subdirectories and young metadata protect an entire pair. */
    const excluded=temp(),young=sha1("young"),youngMeta=sha1("young-meta"),orphan=sha1("orphan");
    await pair(excluded,young,50,old,now);await pair(excluded,youngMeta,50);
    await fsp.utimes(path.join(excluded,youngMeta+".meta"),old/1000,now/1000);
    for(const name of [sha1("tmp")+".tmp-123",sha1("tmp-meta")+".meta.tmp", "usgs/"+sha1("tmp2")+".123.tmp", "index.json","usgs/index.json","usgs/zones.json","wadnr/"+sha1("dnr"),"areas/note.txt","other/"+sha1("other")])await file(excluded,name,1000);
    await file(excluded,orphan+".meta",10);
    const outside=temp();await file(outside,"keep",500);await fsp.symlink(path.join(outside,"keep"),path.join(excluded,sha1("symlink")));
    const ex=await budget.sweep(excluded,{capBytes:1});assert.equal(ex.evictedBytes,10);assert.equal(ex.bytes,120);assert.equal(ex.protectedBytes,120);
    assert(await exists(path.join(outside,"keep")));assert(await exists(path.join(excluded,youngMeta+".meta")));
    assert(await exists(path.join(excluded,"wadnr/"+sha1("dnr"))));checks+=3;
    const pinned=temp();await file(pinned,"usgs/areas/saved.json",0);await fsp.writeFile(path.join(pinned,"usgs/areas/saved.json"),JSON.stringify(samples.usgsJob));
    await pair(pinned,samples.national,90);await pair(pinned,samples.style,90);await pair(pinned,sha1("loose"),20);await file(pinned,"usgs/"+sha1("range"),30);
    const p=await budget.sweep(pinned,{capBytes:150});assert.equal(p.pinnedBytes,200);assert.equal(p.pinnedOverCap,true);assert.equal(p.bytes,200);assert.equal(p.evictedBytes,60);assert.equal(p.overCap,true);
    assert(await exists(path.join(pinned,samples.national)));assert(await exists(path.join(pinned,samples.national+".meta")));checks+=2;
    const touch=temp(),f=await file(touch,sha1("touch"),10,old,old+1234.567);
    const before=await fsp.stat(f);assert.equal(await budget.touchAccess(f,before),true);
    const after=await fsp.stat(f);assert(Math.abs(after.mtimeMs-before.mtimeMs)<.002,"access must preserve sub-ms TTL mtime");assert(after.atimeMs>=now-100);
    assert.equal(await budget.touchAccess(f,after),false);checks+=2;
    const invalid=temp();await pair(invalid,sha1("keep"),50);await file(invalid,"areas/broken.json",0);await fsp.writeFile(path.join(invalid,"areas/broken.json"),"{broken");
    const failClosed=await budget.sweep(invalid,{capBytes:1});assert.equal(failClosed.evictedCount,0);assert.equal(failClosed.errors.length,1);checks++;
    /* A warm job beginning mid-scan invalidates the pins and stops deletion. */
    const paused=temp();await pair(paused,sha1("paused"),50);
    const stop=await budget.sweep(paused,{capBytes:1,canEvict:()=>false});assert.equal(stop.evictedCount,0);assert.equal(stop.interrupted,true);checks++;
    /* Cache writers never wait, and a held write gate prevents eviction.
       Exceptions release it, including a failed atomic cache write. */
    const gate=new SharedArrayBuffer(4),locked=temp(),lockedKey=sha1("locked");await pair(locked,lockedKey,50);
    Atomics.store(new Int32Array(gate),0,-1);
    assert.equal(budget.guardedWrite(gate,()=>assert.fail("must not run")),false);
    assert.equal((await budget.sweep(locked,{capBytes:1,gate})).evictedCount,0);
    Atomics.store(new Int32Array(gate),0,0);
    assert.throws(()=>budget.guardedWrite(gate,()=>{throw Error("failed write")}),/failed write/);
    assert.equal(budget.guardedWrite(gate,()=>{}),true);
    assert.equal((await budget.sweep(locked,{capBytes:1,gate})).evictedCount,1);
    assert.equal(budget.guardedWrite(gate,()=>budget.guardedWrite(gate,()=>{})),true,"independent writes may overlap");checks++;
    /* Every asynchronous filesystem boundary must leave the gate available.
       Schedule a real cache write at each deletion: the per-entry yield must
       persist it before the next deletion, not once the sweep has finished. */
    const gaps=temp(),gapGate=new SharedArrayBuffer(4),state=new Int32Array(gapGate);
    for(let i=0;i<40;i++)await pair(gaps,sha1("gap-"+i),10);
    const asyncStat=fsp.lstat,asyncUnlink=fsp.unlink,syncUnlink=fs.unlinkSync;
    let persisted=0,removed=0;
    fsp.lstat=async(...args)=>{assert.equal(Atomics.load(state,0),0,"async lstat must not hold gate");return asyncStat.apply(fsp,args)};
    fsp.unlink=async(...args)=>{assert.equal(Atomics.load(state,0),0,"async unlink must not hold gate");return asyncUnlink.apply(fsp,args)};
    fs.unlinkSync=(target,...args)=>{
      assert.equal(Atomics.load(state,0),-1,"final unlink must exclude replacements");
      const result=syncUnlink.call(fs,target,...args);
      if(!target.endsWith(".meta")){
        assert.equal(persisted,removed,"writers must persist between entries");removed++;
        setImmediate(()=>{
          assert(budget.guardedWrite(gapGate,()=>fs.writeFileSync(path.join(gaps,"writer.txt"),String(++persisted))));
        });
      }
      return result;
    };
    try{
      const gapsResult=await budget.sweep(gaps,{capBytes:1,gate:gapGate,onEvict:()=>assert.equal(Atomics.load(state,0),0)});
      assert.equal(gapsResult.evictedCount,40);assert.equal(persisted,40);assert.equal(Atomics.load(state,0),0);
    }finally{fsp.lstat=asyncStat;fsp.unlink=asyncUnlink;fs.unlinkSync=syncUnlink}
    checks++;
    const replaced=temp(),replacement=await file(replaced,sha1("replacement"),50);let firstCheck=true;
    const race=await budget.sweep(replaced,{capBytes:1,canEvict:()=>{
      if(firstCheck){firstCheck=false;fs.writeFileSync(replacement,Buffer.alloc(51))}return true;
    }});
    assert.equal(race.evictedCount,0,"final re-check must preserve a newly written body");
    assert.equal(fs.statSync(replacement).size,51);checks++;
    /* Exercise fetchRange's real cache-hit path; an exact-length fixture
       avoids S3 and must update only its access time. */
    const rangeDir=temp(),usgs=require("./usgs.js"),rangeKey="fixture.tif",a0=0,b0=9;
    usgs.init(rangeDir);const rangeFile=await file(rangeDir,"usgs/"+sha1(rangeKey+":"+a0+"-"+b0),10);
    const rangeBefore=await fsp.stat(rangeFile),hit=await usgs.fetchRange(rangeKey,a0,b0);
    assert.equal(hit.cached,true);assert.equal(hit.buf.length,10);
    await budget.touchAccess(rangeFile);const rangeAfter=await fsp.stat(rangeFile);
    assert(Math.abs(rangeAfter.mtimeMs-rangeBefore.mtimeMs)<.002);assert(rangeAfter.atimeMs>old);checks++;
    const controller=new budget.CacheBudget(temp(),{startupMs:60000,intervalMs:60000,writeThreshold:1});
    controller.noteWrite(1);assert(controller.scheduled);const first=controller.run();assert.equal(controller.run(),first);await first;assert.equal(controller.stats().capGiB,15);await controller.close();checks++;
    const abortDir=temp();await pair(abortDir,sha1("abort"),50);
    const abort=new budget.CacheBudget(abortDir,{startupMs:60000,intervalMs:60000});abort.capBytes=1;
    const pending=abort.run();abort.invalidatePins();const aborted=await pending;
    assert.equal(aborted.evictedCount,0);assert.equal(aborted.interrupted,true);await abort.close();checks++;
    const workerDir=temp();await pair(workerDir,sha1("worker"),50);let workerEvicted=0;
    const workerBudget=new budget.CacheBudget(workerDir,{onEvict:()=>workerEvicted++,startupMs:60000,intervalMs:60000});workerBudget.capBytes=1;
    const workerResult=await workerBudget.run();assert.equal(workerEvicted,1);assert.equal(workerResult.evictedBytes,60);await workerBudget.close();checks++;
    assert.equal(budget.maxGiB("0"),15);assert.equal(budget.maxGiB("bad"),15);assert.equal(budget.maxGiB("2.5"),2.5);checks++;
    console.log(`cache budget: ${checks} checks passed`);
  }finally{for(const dir of dirs)await fsp.rm(dir,{recursive:true,force:true})}
})().catch(error=>{console.error(error);process.exitCode=1});
