"use strict";
const {test}=require("node:test"),assert=require("assert/strict"),fs=require("fs"),path=require("path"),os=require("os"),zlib=require("zlib"),crypto=require("crypto");
const {installStartupCache}=require("./electron/startup-cache"),{DEFAULTS}=require("./electron/setup-config"),{tiles,view}=require("./scripts/build-startup-cache");
const digest=body=>crypto.createHash("sha256").update(body).digest("hex");
const packed=fs.readFileSync("build/startup-terrain.json.gz"),archive=JSON.parse(zlib.gunzipSync(packed));
function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"csp-seed-test-")),file=path.join(root,"startup-terrain.json.gz"),cache=path.join(root,"cache");
  function write(value){
    const body=zlib.gzipSync(JSON.stringify(value));fs.writeFileSync(file,body);
    fs.writeFileSync(file.replace(".json.gz",".manifest.json"),JSON.stringify({version:1,capturedAt:value.capturedAt,archiveSha256:digest(body),keys:value.entries.map(e=>e.key)}));
  }
  const value={...archive,capturedAt:new Date(Date.now()-1000).toISOString(),entries:[archive.entries[0]]};write(value);
  return {root,file,cache,value,write,close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test("Bundled starter terrain covers the launch camera and nearby tiles without relabeling overview",()=>{
  const manifest=JSON.parse(fs.readFileSync("build/startup-terrain.manifest.json","utf8"));
  assert.equal(digest(packed),manifest.archiveSha256);assert.equal(archive.entries.length,235);
  assert.deepEqual(new Set(archive.entries.map(e=>`${e.kind}/${e.z}/${e.x}/${e.y}`)),new Set(tiles().map(e=>`${e.kind}/${e.z}/${e.x}/${e.y}`)));
  const startup=fs.readFileSync("app/map.js","utf8").match(/const CSP_STARTUP_VIEW = Object.freeze\((\{[^;]+\})\);/)[1];
  const camera=require("vm").runInNewContext(`(${startup})`);
  assert.deepEqual(Array.from(camera.center),view.center);assert.equal(camera.zoom,view.referenceZoom);
  assert.equal(camera.width,view.referenceWidth);assert.equal(camera.height,view.referenceHeight);
  for(const entry of archive.entries){
    assert.equal(entry.kind,"overview");assert.equal(entry.meta.status,200);
    assert.equal(digest(Buffer.from(entry.body,"base64")),entry.sha256);
  }
});
test("Startup terrain seeds missing cache entries once, preserves newer saves and original age",async()=>{
  const f=fixture();
  try{
    const result=await installStartupCache(f.file,f.cache,{...DEFAULTS,minFreeGiB:0});assert.equal(result.installed,1);
    const entry=f.value.entries[0],target=path.join(f.cache,entry.key);
    assert.equal(digest(fs.readFileSync(target)),entry.sha256);
    assert(Math.abs(fs.statSync(target).mtimeMs-Date.parse(f.value.capturedAt))<2);
    fs.writeFileSync(target,"newer live result");
    const again=await installStartupCache(f.file,f.cache,DEFAULTS);assert.equal(again.reason,"already-cached");
    assert.equal(fs.readFileSync(target,"utf8"),"newer live result");
    fs.unlinkSync(target);await installStartupCache(f.file,f.cache,DEFAULTS);
    assert(!fs.existsSync(target),"an existing metadata/negative-coverage entry is never replaced");
  }finally{f.close();}
});
test("Startup terrain respects disk reserve, rejects corruption and ignores expired seed data",async()=>{
  const f=fixture();
  try{
    assert.equal((await installStartupCache(f.file,f.cache,{...DEFAULTS,minFreeGiB:1e9})).installed,0);
    f.write({...f.value,capturedAt:new Date(Date.now()-91*86400000).toISOString()});
    assert.equal((await installStartupCache(f.file,f.cache,DEFAULTS)).reason,"expired");
    f.write({...f.value,entries:[{...f.value.entries[0],sha256:"bad"}]});
    await assert.rejects(installStartupCache(f.file,f.cache,DEFAULTS),/checksum/);
    assert(!fs.existsSync(path.join(f.cache,f.value.entries[0].key)));
  }finally{f.close();}
});
test("The engine reads packaged starter tiles without disk writes and prefers its live cache",async()=>{
  const f=fixture();
  try{
    await installStartupCache(f.file,f.cache,{minFreeGiB:0});
    const live=path.join(f.root,"live");fs.mkdirSync(live);
    const entry=f.value.entries[0],{execFileSync}=require("child_process");
    const code=`const c=require('./engine/tile-cache');c.init(${JSON.stringify(live)},{canEvict:()=>false});const hit=c.cacheGet(${JSON.stringify(entry.key)},c.TTL_TILE);console.log(hit?hit.body.toString('base64'):'missing');`;
    const read=()=>execFileSync(process.execPath,["-e",code],{env:{...process.env,CSP_STARTUP_CACHE_DIR:f.cache},encoding:"utf8"}).trim();
    assert.equal(read(),entry.body);assert.deepEqual(fs.readdirSync(live),[],"seed reads never write into the user's cache or app bundle");
    fs.writeFileSync(path.join(live,entry.key),"live terrain");fs.writeFileSync(path.join(live,entry.key+".meta"),JSON.stringify({status:200,type:"image/png"}));
    assert.equal(Buffer.from(read(),"base64").toString(),"live terrain");
  }finally{f.close();}
});
