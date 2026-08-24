"use strict";

const assert = require("assert/strict");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const {spawn} = require("child_process");

const root=__dirname;
const cache=fs.mkdtempSync(path.join(os.tmpdir(),"clear-skies-test-"));

const freePort=()=>new Promise((resolve,reject)=>{
  const server=net.createServer();
  server.once("error",reject);
  server.listen(0,"127.0.0.1",()=>{
    const port=server.address().port;
    server.close(()=>resolve(port));
  });
});

function request(port,pathname,{method="GET",headers={},body=null}={}){
  return new Promise((resolve,reject)=>{
    const req=http.request({host:"127.0.0.1",port,path:pathname,method,headers},res=>{
      const chunks=[];
      res.on("data",chunk=>chunks.push(chunk));
      res.on("end",()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));
    });
    req.on("error",reject);
    if(body) req.write(body);
    req.end();
  });
}

async function main(){
  const port=await freePort();
  const child=spawn(process.execPath,["server.js"],{
    cwd:root,
    env:{...process.env,PORT:String(port),HOST:"127.0.0.1",CSP_CACHE_DIR:cache,CSP_TERRAIN_WORKERS:"1"},
    stdio:["ignore","pipe","pipe"]
  });
  let logs="";
  child.stdout.on("data",chunk=>{ logs+=chunk });
  child.stderr.on("data",chunk=>{ logs+=chunk });

  try{
    let health=null;
    for(let i=0;i<50;i++){
      try{ health=await request(port,"/api/health"); if(health.status===200) break }catch(e){}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.equal(health&&health.status,200,`server failed to start\n${logs}`);
    const healthBody=JSON.parse(health.body);
    assert.equal(healthBody.ok,true);
    assert(Number.isInteger(healthBody.cached)&&healthBody.cached>=0,"health must report the cached tile count");
    assert(Number.isFinite(healthBody.uptimeSec)&&healthBody.uptimeSec>=0,"health must report process uptime");
    assert(Number.isInteger(healthBody.rendering)&&healthBody.rendering>=0,"health must report active terrain renders");
    assert(Number.isInteger(healthBody.renderQueued)&&healthBody.renderQueued>=0,"health must report queued terrain renders");
    assert.equal(healthBody.terrain.workers,1,"health must report the configured terrain worker pool");
    assert.equal(healthBody.terrain.active,0,"fresh terrain workers must be idle");
    assert.equal(healthBody.nationalCircuit.coolingDown,false,"fresh fallback circuit must be closed");
    assert.equal(health.headers["cache-control"],"no-store","health must never be served stale");

    const page=await request(port,"/");
    assert.equal(page.status,200);
    assert.match(page.headers["content-type"],/^text\/html/);
    assert.equal(page.headers["x-content-type-options"],"nosniff");

    const preflight=await request(port,"/api/health",{
      method:"OPTIONS",headers:{Origin:"https://rileyg44.github.io","Access-Control-Request-Method":"GET"}
    });
    assert.equal(preflight.status,204);
    assert.equal(preflight.headers["access-control-allow-origin"],"https://rileyg44.github.io");

    const blocked=await request(port,"/api/warm",{
      method:"POST",headers:{Origin:"https://evil.example"},body:"{}"
    });
    assert.equal(blocked.status,403);
    assert.equal(blocked.headers["access-control-allow-origin"],undefined);

    const invalidJson=await request(port,"/api/warm",{method:"POST",body:"{"});
    assert.equal(invalidJson.status,400);
    const hugePlan=await request(port,"/api/warm",{
      method:"POST",body:JSON.stringify({bbox:[-180,-80,180,80],z0:19,z1:19,rule:"Hillshade Gray"})
    });
    assert.equal(hugePlan.status,413);
    const hugeBody=await request(port,"/api/warm",{method:"POST",body:"x".repeat(300000)});
    assert.equal(hugeBody.status,413);

    assert.equal((await request(port,"/api/warm/stop")).status,405);
    assert.equal((await request(port,"/api/elev/not-a-tile")).status,400);
    assert.equal((await request(port,"/api/usgs/tile/notastyle/1/0/0.png")).status,400);
    assert.equal((await request(port,"/.git/config")).status,404);
    assert.equal((await request(port,"/package.json")).status,404);
    assert.equal((await request(port,"/%2e%2e%2fpackage.json")).status,403);
    assert.equal((await request(port,"/%E0%A4%A")).status,400);

    console.log("server integration checks passed");
  } finally {
    if(child.exitCode===null && child.signalCode===null){
      child.kill("SIGTERM");
      await new Promise(resolve=>child.once("exit",resolve));
    }
    fs.rmSync(cache,{recursive:true,force:true});
  }
}

main().catch(err=>{ console.error(err); process.exitCode=1 });
