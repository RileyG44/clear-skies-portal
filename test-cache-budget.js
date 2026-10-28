"use strict";
/* Exercise actual files and the download routes with stub upstreams. These
   tests must never use the installed service/cache or make network requests. */
const assert=require("assert/strict"),fs=require("fs"),fsp=fs.promises,os=require("os"),path=require("path"),http=require("http");
const {execFileSync}=require("child_process");
const budget=require("./cache-budget.js"),{sha1}=budget;
const dirs=[];let checks=0;
const temp=()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),"csp-budget-"));dirs.push(dir);return dir};
const now=Date.now(),old=now-24*3600000;
async function file(dir,name,size,atime=old,mtime=old){
  const f=path.join(dir,name);await fsp.mkdir(path.dirname(f),{recursive:true});await fsp.writeFile(f,Buffer.alloc(size));await fsp.utimes(f,atime/1000,mtime/1000);return f;
}
async function pair(dir,key,size,atime=old,mtime=old){await file(dir,key,size,atime,mtime);await file(dir,key+".meta",10,atime,mtime)}
async function exists(f){try{await fsp.access(f);return true}catch{return false}}
/* 0o500 blocks new files on Unix. On Windows chmod only sets the read-only
   attribute, and a directory ignores that, so deny adding a file instead.
   Everyone is *S-1-1-0 so the command does not depend on a localised name. */
const sealManifestDir=dir=>{
  if(process.platform==="win32") execFileSync("icacls",[dir,"/deny","*S-1-1-0:(WD,AD)"],{stdio:"ignore",windowsHide:true});
  else fs.chmodSync(dir,0o500);
};
const unsealManifestDir=dir=>{
  if(process.platform==="win32") execFileSync("icacls",[dir,"/remove:d","*S-1-1-0"],{stdio:"ignore",windowsHide:true});
  else fs.chmodSync(dir,0o700);
};
/* Drive the real download routes, with only the network and terrain workers
   stubbed: the tiles each download caches must be exactly the keys its
   manifest pins, and a manifest that cannot be written must say so. */
async function warmKeyChecks(){
  const tile={z:13,x:1380,y:2880},N=2**tile.z;
  const bboxOf=x=>{const lon=(x+.4)/N*360-180,lat=Math.atan(Math.sinh(Math.PI*(1-2*(tile.y+.4)/N)))*180/Math.PI;return [lon,lat-.00001,lon+.00001,lat]};
  const bbox=bboxOf(tile.x),base={bbox,z0:13,z1:13,label:"test"};
  assert.deepEqual(budget.tileRange(bbox,13),{x0:tile.x,x1:tile.x,y0:tile.y,y1:tile.y});
  const cache=temp(),areas=path.join(cache,"areas"),usgsAreas=path.join(cache,"usgs","areas");
  const usgs=require("./usgs.js"),png=usgs.encodePNG(Buffer.alloc(4,255),1,1);
  /* An empty 1 m index (INDEX_VERSION 2, as check-static requires) keeps the
     real finalizer off the network: it records no source COGs. */
  usgs.init(cache);fs.mkdirSync(areas);fs.writeFileSync(path.join(cache,"usgs","index.json"),JSON.stringify({v:2,projects:{}}));
  Object.assign(require("./engine/upstream.js"),{upstream:async({path})=>({status:200,type:"image/png",body:path==="/query"?Buffer.from("[]"):png})});
  Object.assign(require("./engine/terrain.js"),{nationalElevationTiff:async()=>Buffer.alloc(1)});
  const cacheBudget=require("./engine/tile-cache.js").init(cache,{canEvict:()=>false});
  const downloads=require("./engine/downloads.js");
  downloads.init({areasDir:areas,pool:{size:3,run:async()=>({png:Buffer.from("png")})},budget:cacheBudget});
  const server=http.createServer((req,res)=>{const u=new URL(req.url,"http://x");downloads.routes[u.pathname](req,res,{u,p:u.pathname})});
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const at=route=>`http://127.0.0.1:${server.address().port}${route}`;
  const cached=()=>new Set(fs.readdirSync(cache).filter(f=>/^[0-9a-f]{40}$/.test(f)));
  async function download(start,job){
    const before=cached();let status;
    assert.equal((await fetch(at(start),{method:"POST",body:JSON.stringify(job)})).status,200);
    while((status=await (await fetch(at(start+"/status"))).json()).running) await new Promise(r=>setTimeout(r,10));
    return {status,written:new Set([...cached()].filter(k=>!before.has(k)))};
  }
  const manifests=dir=>fs.readdirSync(dir).map(f=>JSON.parse(fs.readFileSync(path.join(dir,f),"utf8")));
  try{
    const job={...base,layers:"0,7",rule:"Slope Map"},{status,written}=await download("/api/warm",job);
    assert.equal(status.unrecorded,"");
    const [manifest]=manifests(areas);
    const bb=budget.mercBbox(tile.z,tile.x,tile.y),rr=encodeURIComponent(JSON.stringify({rasterFunction:job.rule}));
    const expected=[sha1(`wadnr:export:?bbox=${bb}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&dpi=96&f=image&layers=show:0,7`),
      sha1(`3dep:/arcgis/rest/services/3DEPElevation/ImageServer/exportImage?bbox=${bb}&bboxSR=3857&imageSR=3857&size=256,256&format=png&transparent=true&f=image&renderingRule=${rr}`)];
    const [w,s,e,n]=bbox,query=sha1("wadnr:query:"+JSON.stringify({type:"Polygon",coordinates:[[[w,s],[e,s],[e,n],[w,n],[w,s]]]}));
    assert.deepEqual(written,new Set([...expected,query]),"the tiles plus the catalogue answer");
    assert.deepEqual(new Set(budget.manifestKeys(manifest,"areas")),new Set(expected));
    const usgsJob={...base,style:"slope",raw:true},usgsRun=await download("/api/usgs/warm",usgsJob);
    const national=sha1(`elevation-national-v1:13/${tile.x}/${tile.y}`),elev=sha1(`usgselev:13/${tile.x}/${tile.y}`);
    assert.deepEqual(usgsRun.written,new Set([national,elev]));assert.equal(usgsRun.status.unrecorded,"");
    const [usgsManifest]=manifests(usgsAreas);
    assert.deepEqual([usgsManifest.source,usgsManifest.style,usgsManifest.raw,usgsManifest.bbox],["usgs1m","slope",true,bbox],"the real finalizer records the area");
    const style=sha1(`terrain-v3:slope:13/${tile.x}/${tile.y}`);
    assert.deepEqual(new Set(budget.manifestKeys(usgsManifest,"usgs/areas")),new Set([style,national,elev]));
    assert.deepEqual(new Set(budget.manifestKeys({...usgsManifest,raw:false},"usgs/areas")),new Set([style,national]));
    assert.deepEqual((await budget.readPins(cache)).pins,new Set([...expected,style,national,elev]),"the cache pins what both manifests list");
    /* A manifest that cannot be written leaves the tiles but reports the area unrecorded. */
    sealManifestDir(areas);sealManifestDir(usgsAreas);
    try{
      const failed=await download("/api/warm",{...job,bbox:bboxOf(tile.x+2)}),failedUsgs=await download("/api/usgs/warm",usgsJob);
      assert(failed.written.size>0&&failed.status.unrecorded,"WA DNR tiles arrive but the area is reported unrecorded");
      assert(failedUsgs.status.skipped===1&&failedUsgs.status.unrecorded,"so is a 1 m area");
      assert.equal(manifests(areas).length+manifests(usgsAreas).length,2,"and no partial manifest is left behind");
      assert.deepEqual(fs.readdirSync(areas).concat(fs.readdirSync(usgsAreas)).filter(f=>!f.endsWith(".json")),[]);
    }finally{ unsealManifestDir(areas);unsealManifestDir(usgsAreas) }
    checks+=11;return {job,usgsJob:usgsManifest,national,style};
  }finally{ server.close();await cacheBudget.close() }
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
