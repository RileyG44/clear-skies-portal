"use strict";
/* Saved areas on the engine: checking a downloaded area against the WA DNR
   catalogue rewrites its manifest on disk, flagging changed datasets. Runs a
   real server on a free port against a throwaway cache holding the catalogue
   response, so no remote provider is involved. */
const assert=require("assert/strict");
const fs=require("fs"),os=require("os"),path=require("path"),net=require("net"),crypto=require("crypto");
const {spawn}=require("child_process");

const cache=fs.mkdtempSync(path.join(os.tmpdir(),"clear-skies-areas-"));
const areas=path.join(cache,"areas");fs.mkdirSync(areas);
const freePort=()=>new Promise(resolve=>{ const s=net.createServer();s.listen(0,"127.0.0.1",()=>{ const {port}=s.address();s.close(()=>resolve(port)) }) });
/* The engine caches the catalogue query for a bbox under this key. */
const catalogue=([w,s,e,n],rows)=>{
  const query="wadnr:query:"+JSON.stringify({type:"Polygon",coordinates:[[[w,s],[e,s],[e,n],[w,n],[w,s]]]});
  const file=path.join(cache,crypto.createHash("sha1").update(query).digest("hex"));
  fs.writeFileSync(file,JSON.stringify(rows));
  fs.writeFileSync(file+".meta",JSON.stringify({status:200,type:"application/json"}));
};
const save=(id,bbox)=>fs.writeFileSync(path.join(areas,id+".json"),JSON.stringify({id,bbox,datasets:[{dataset_id:1,bytes:100,files:1}],created:1,checked:1}));
const manifest=id=>JSON.parse(fs.readFileSync(path.join(areas,id+".json"),"utf8"));

(async()=>{
  const port=await freePort();
  const child=spawn(process.execPath,[path.join(__dirname,"server.js")],{env:{...process.env,PORT:String(port),CSP_CACHE_DIR:cache,CSP_TERRAIN_WORKERS:"1"},stdio:"ignore"});
  const base=`http://127.0.0.1:${port}`;
  try{
    for(let i=0;i<50;i++){ try{ await fetch(base+"/api/health");break }catch(e){ await new Promise(r=>setTimeout(r,100)) } }
    save("fixture",[-123,47,-122,48]);
    catalogue([-123,47,-122,48],[{dataset_id:1,project_name:"P",dataset_name:"D",bytes:100,files:1}]);

    const [same]=await (await fetch(base+"/api/warm/check?id=fixture")).json();
    assert.equal(same.checkFailed,undefined,"an unchanged area checks cleanly");
    assert.equal(same.stale,false);
    assert(manifest("fixture").checked>1,"and the check time is saved to its manifest");
    assert.equal(manifest("fixture").stale,false);
    assert.deepEqual(fs.readdirSync(areas),["fixture.json"],"no temporary files are left behind");

    save("other",[-121,46,-120,47]);
    catalogue([-121,46,-120,47],[{dataset_id:1,project_name:"P",dataset_name:"D",bytes:150,files:2},{dataset_id:2,project_name:"P",dataset_name:"New",bytes:5,files:1}]);
    const [changed]=await (await fetch(base+"/api/warm/check?id=other")).json();
    assert.equal(changed.stale,true,"a changed catalogue marks the area stale");
    assert.deepEqual(changed.changed,[{project_name:"P",dataset_name:"D",was:100,now:150}]);
    assert.deepEqual(changed.added,[{project_name:"P",dataset_name:"New",bytes:5}]);
    assert.deepEqual(manifest("other"),changed,"and the manifest on disk says so");
    console.log("saved area checks passed (unchanged, changed and added datasets, manifests persisted)");
  }finally{ child.kill() }
})().catch(error=>{ console.error(error);process.exit(1) });
