"use strict";
/* Markup layers on the engine: saved as files in a folder of their own, the
   newer copy wins, deletes go to a trash folder and leave a tombstone so an
   older offline copy cannot bring a layer back, and ids cannot escape the
   folder. Runs a real server on a free port against a throwaway folder. */
const assert=require("assert/strict");
const fs=require("fs"),os=require("os"),path=require("path"),net=require("net");
const {spawn}=require("child_process");

const dir=fs.mkdtempSync(path.join(os.tmpdir(),"clear-skies-markup-"));
const cache=fs.mkdtempSync(path.join(os.tmpdir(),"clear-skies-markup-cache-"));
const freePort=()=>new Promise(resolve=>{ const s=net.createServer();s.listen(0,"127.0.0.1",()=>{ const {port}=s.address();s.close(()=>resolve(port)) }) });
const layer=(id,updated,features=1)=>({type:"FeatureCollection",markup:{id,name:"Test "+id,color:"#ff9500",updated},
  features:Array.from({length:features},(_,i)=>({type:"Feature",geometry:{type:"Point",coordinates:[-119.28,47.13+i/1000]},properties:{fid:"f"+i,kind:"pin",size:20}}))});

(async()=>{
  const port=await freePort();
  const child=spawn(process.execPath,[path.join(__dirname,"server.js")],{env:{...process.env,PORT:String(port),CSP_MARKUP_DIR:dir,CSP_CACHE_DIR:cache,CSP_TERRAIN_WORKERS:"1"},stdio:"ignore"});
  const base=`http://127.0.0.1:${port}`;
  try{
    for(let i=0;i<50;i++){ try{ await fetch(base+"/api/health");break }catch(e){ await new Promise(r=>setTimeout(r,100)) } }
    const post=(p,body)=>fetch(base+p,{method:"POST",headers:{"Content-Type":"application/json"},body:typeof body==="string"?body:JSON.stringify(body)});

    assert.deepEqual(await (await fetch(base+"/api/markup")).json(),{layers:[],deleted:{}},"empty to start");
    assert.equal((await post("/api/markup/camp-a1",layer("camp-a1",1000,3))).status,200,"save");
    assert(fs.existsSync(path.join(dir,"camp-a1.geojson")),"one GeoJSON file per layer");
    const list=await (await fetch(base+"/api/markup")).json();
    assert.deepEqual(list.layers,[{id:"camp-a1",name:"Test camp-a1",color:"#ff9500",updated:1000,count:3}]);
    const got=await (await fetch(base+"/api/markup/camp-a1")).json();
    assert.equal(got.features.length,3);assert.equal(got.markup.updated,1000);

    const stale=await post("/api/markup/camp-a1",layer("camp-a1",900,1));
    assert.equal(stale.status,409,"an older copy does not overwrite a newer one");
    assert.equal((await stale.json()).markup.updated,1000,"and gets the newer copy back");
    assert.equal((await post("/api/markup/camp-a1",layer("camp-a1",1100,2))).status,200,"a newer copy replaces it");

    assert.equal((await post("/api/markup/camp-a1",layer("other",1200))).status,400,"id must match the address");
    assert.equal((await post("/api/markup/Bad_ID",layer("Bad_ID",1200))).status,400,"ids are lowercase slugs");
    assert.equal((await post("/api/markup/x1",{...layer("x1",1),markup:{id:"x1",name:"x",color:"red",updated:1}})).status,400,"colour is #rrggbb");
    assert.equal((await post("/api/markup/x1","{not json")).status,400,"bad JSON");
    assert.notEqual((await fetch(base+"/api/markup/..%2F..%2Fserver.js")).status,200,"no path escape");

    const del=await post("/api/markup/camp-a1/delete",{at:2000});
    assert.equal(del.status,200);
    assert.equal(fs.existsSync(path.join(dir,"camp-a1.geojson")),false,"deleted layer leaves the folder");
    assert.equal(fs.readdirSync(path.join(dir,".trash")).length,1,"into the trash, not destroyed");
    assert.equal((await fetch(base+"/api/markup/camp-a1")).status,404);
    assert.equal((await post("/api/markup/camp-a1",layer("camp-a1",1500))).status,410,"an older offline copy cannot resurrect it");
    assert.equal((await post("/api/markup/camp-a1",layer("camp-a1",2500))).status,200,"a copy edited after the delete can");
    assert.deepEqual((await (await fetch(base+"/api/markup")).json()).deleted,{"camp-a1":2000});
    console.log("markup server checks passed (files, newer-wins, validation, no path escape, trash, tombstones)");
  }finally{ child.kill() }
})().catch(error=>{ console.error(error);process.exit(1) });
