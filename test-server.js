"use strict";

const assert = require("assert/strict");
const fs = require("fs");
const http = require("http");
const zlib = require("zlib");
const net = require("net");
const os = require("os");
const path = require("path");
const {spawn} = require("child_process");
const researchAnalysis=require("./research-analysis.js");

const root=__dirname;
const cache=fs.mkdtempSync(path.join(os.tmpdir(),"clear-skies-test-"));
process.env.CSP_CACHE_DIR=cache;
process.env.CSP_TERRAIN_WORKERS="1";
const {
  validateSnapshotImageUrl,
  resolveSnapshotImageRedirect,
  closeServerResources
}=require("./server.js");

async function snapshotUrlValidationChecks(){
  try{
    const exactHosts=[
      "planetarycomputer.microsoft.com",
      "titiler.xyz",
      "gibs.earthdata.nasa.gov",
      "elevation.nationalmap.gov",
      "s3.amazonaws.com",
      "prd-tnm.s3.amazonaws.com",
      "services.arcgisonline.com",
      "basemap.nationalmap.gov",
      "carto.nationalmap.gov",
      "mrdata.usgs.gov",
      "gis.dnr.wa.gov",
      "lidarportal.dnr.wa.gov",
      "tiles.macrostrat.org",
      "mapservices.weather.noaa.gov",
      "earthquake.usgs.gov",
      "tiles.arcgis.com"
    ];
    for(const hostname of exactHosts)
      assert.equal(validateSnapshotImageUrl(`https://${hostname}/tile.png`).hostname,hostname);
    assert.throws(()=>validateSnapshotImageUrl("https://a.basemaps.cartocdn.com/tile.png"),
      /not allowed/,"the retired CARTO shard exception must not survive the Esri migration");
    assert.equal(validateSnapshotImageUrl("https://gibs.earthdata.nasa.gov:443/tile.png#ignored").href,
      "https://gibs.earthdata.nasa.gov/tile.png","default port and fragment must canonicalize");

    const denied=[
      [null,400,/required/],
      ["not a URL",400,/invalid/],
      ["http://gibs.earthdata.nasa.gov/tile.png",400,/HTTPS/],
      ["ftp://gibs.earthdata.nasa.gov/tile.png",400,/HTTPS/],
      ["https://user:secret@gibs.earthdata.nasa.gov/tile.png",400,/credentials/],
      ["https://gibs.earthdata.nasa.gov:444/tile.png",400,/port 443/],
      ["https://127.0.0.1/tile.png",403,/literal or private/],
      ["https://[::1]/tile.png",403,/literal or private/],
      ["https://localhost/tile.png",403,/literal or private/],
      ["https://server.internal/tile.png",403,/literal or private/],
      ["https://evil.example/tile.png",403,/not allowed/],
      ["https://gibs.earthdata.nasa.gov.evil.example/tile.png",403,/not allowed/],
      ["https://services.arcgisonline.com.evil.example/tile.png",403,/not allowed/],
      ["https://evilservices.arcgisonline.com/tile.png",403,/not allowed/],
      ["https://bucket.s3.amazonaws.com/tile.png",403,/not allowed/],
      ["https://gibs.earthdata.nasa.gov/"+"x".repeat(8200),400,/exceeds/]
    ];
    for(const [value,status,message] of denied){
      assert.throws(()=>validateSnapshotImageUrl(value),error=>
        error&&error.status===status&&message.test(error.message),String(value));
    }

    const current=validateSnapshotImageUrl("https://gibs.earthdata.nasa.gov/a/tile.png");
    assert.equal(resolveSnapshotImageRedirect(current,"../next.jpeg").href,
      "https://gibs.earthdata.nasa.gov/next.jpeg");
    assert.throws(()=>resolveSnapshotImageRedirect(current,"https://evil.example/tile.png"),
      error=>error&&error.status===403,"redirects must be allowlisted again");
    assert.throws(()=>resolveSnapshotImageRedirect(current,"http://gibs.earthdata.nasa.gov/tile.png"),
      error=>error&&error.status===400,"redirects must remain HTTPS");
  }finally{
    await closeServerResources();
  }
}

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
  await snapshotUrlValidationChecks();
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
    assert(Number.isFinite(healthBody.cacheDisk.freeGiB),"health must report free cache-disk capacity");
    assert.equal(typeof healthBody.cacheDisk.writable,"boolean","health must report whether persistent caching is safe");
    assert(Number.isInteger(healthBody.memoryCache.entries)&&healthBody.memoryCache.entries>=0,
      "health must report the in-memory tile cache entry count");
    assert.equal(healthBody.memoryCache.entryLimit,32768,
      "the in-memory tile cache needs a bounded default entry count");
    assert.equal(healthBody.memoryCache.limitMiB,256,
      "the in-memory tile cache needs the M2 service default capacity");
    assert.equal(healthBody.analysisCache.entries,0,"fresh analysis cache must be empty");
    assert.equal(healthBody.nationalCircuit.coolingDown,false,"fresh fallback circuit must be closed");
    assert.equal(health.headers["cache-control"],"no-store","health must never be served stale");

    const page=await request(port,"/");
    assert.equal(page.status,200);
    assert.match(page.headers["content-type"],/^text\/html/);
    assert.equal(page.headers["x-content-type-options"],"nosniff");

    const maplibreModule=await request(port,"/vendor/maplibre-gl.mjs");
    assert.equal(maplibreModule.status,200,"the vendored 3D renderer must be served locally");
    assert.match(maplibreModule.headers["content-type"],/^text\/javascript/);
    assert(maplibreModule.body.length>100000,"the MapLibre module must not be an empty placeholder");
    const rotatePlugin=await request(port,"/vendor/leaflet-rotate.umd.min.js");
    assert.equal(rotatePlugin.status,200,"the vendored 2D rotation plugin must be served locally");
    assert.match(rotatePlugin.headers["content-type"],/^text\/javascript/);

    const badSnowBbox=await request(port,"/api/snow?bbox=bad&layer=3");
    assert.equal(badSnowBbox.status,400,"snow exports must reject malformed Web Mercator bounds");
    const badSnowLayer=await request(port,
      "/api/snow?bbox=-13619243,5792092,-13462700,5948635&layer=99");
    assert.equal(badSnowLayer.status,400,"snow exports must whitelist depth and SWE only");

    const preflight=await request(port,"/api/health",{
      method:"OPTIONS",headers:{Origin:"https://rileyg44.github.io","Access-Control-Request-Method":"GET"}
    });
    assert.equal(preflight.status,204);
    assert.equal(preflight.headers["access-control-allow-origin"],"https://rileyg44.github.io");

    const analysisQuery="/api/terrain/analyze?product=residual&scale=fine&width=25&height=21&resolution=2";
    const analysisGrid=Float32Array.from({length:25*21},(_,index)=>{
      const x=index%25-12,y=Math.floor(index/25)-10;
      return 150+0.3*x*x+0.04*y;
    });
    const analysisUpload=Buffer.from(analysisGrid.buffer,analysisGrid.byteOffset,analysisGrid.byteLength);
    const analysisHeaders={"Content-Type":"application/octet-stream",Origin:"https://rileyg44.github.io"};
    const firstAnalysis=await request(port,analysisQuery,{method:"POST",headers:analysisHeaders,body:analysisUpload});
    assert.equal(firstAnalysis.status,200,firstAnalysis.body.toString());
    assert.equal(firstAnalysis.headers["content-type"],"application/vnd.clearskies.terrain-analysis");
    assert.equal(firstAnalysis.headers["x-csp-analysis-engine"],"m2-worker-thread");
    assert.equal(firstAnalysis.headers["x-cache"],"MISS");
    assert.equal(firstAnalysis.headers["access-control-allow-origin"],"https://rileyg44.github.io");
    const analysisResult=researchAnalysis.decodeResult(firstAnalysis.body);
    assert.equal(analysisResult.width,25);
    assert.equal(analysisResult.height,21);
    assert.equal(analysisResult.label,"Multi-scale residual anomaly");
    assert.equal(analysisResult.data.length,25*21);
    assert(analysisResult.data.some(Number.isFinite));

    const cachedAnalysis=await request(port,analysisQuery,{method:"POST",headers:analysisHeaders,body:analysisUpload});
    assert.equal(cachedAnalysis.status,200);
    assert.equal(cachedAnalysis.headers["x-cache"],"HIT","identical DEM analysis must reuse the bounded memory result");
    assert.deepEqual(cachedAnalysis.body,firstAnalysis.body);

    const coalescedWidth=128,coalescedHeight=128;
    const coalescedGrid=Float32Array.from({length:coalescedWidth*coalescedHeight},(_,index)=>
      300+20*Math.sin((index%coalescedWidth)/9)+10*Math.cos(Math.floor(index/coalescedWidth)/13));
    const coalescedBody=Buffer.from(coalescedGrid.buffer);
    const coalescedQuery=`/api/terrain/analyze?product=lrm&scale=broad&width=${coalescedWidth}&height=${coalescedHeight}&resolution=3`;
    const completedBefore=JSON.parse((await request(port,"/api/health")).body).terrain.completed;
    const coalescedResponses=await Promise.all([
      request(port,coalescedQuery,{method:"POST",headers:{"Content-Type":"application/octet-stream"},body:coalescedBody}),
      request(port,coalescedQuery,{method:"POST",headers:{"Content-Type":"application/octet-stream"},body:coalescedBody})
    ]);
    assert(coalescedResponses.every(response=>response.status===200));
    const completedAfter=JSON.parse((await request(port,"/api/health")).body).terrain.completed;
    assert.equal(completedAfter,completedBefore+1,"identical concurrent analysis uploads must share one worker job");

    const analysisGet=await request(port,analysisQuery);
    assert.equal(analysisGet.status,405);
    assert.equal(analysisGet.headers.allow,"POST");
    const wrongAnalysisType=await request(port,analysisQuery,{method:"POST",body:analysisUpload});
    assert.equal(wrongAnalysisType.status,415);
    const badAnalysisProduct=await request(port,
      "/api/terrain/analyze?product=made-up&scale=fine&width=25&height=21&resolution=2",
      {method:"POST",headers:{"Content-Type":"application/octet-stream"},body:analysisUpload});
    assert.equal(badAnalysisProduct.status,400);
    const badAnalysisScale=await request(port,
      "/api/terrain/analyze?product=lrm&scale=continental&width=25&height=21&resolution=2",
      {method:"POST",headers:{"Content-Type":"application/octet-stream"},body:analysisUpload});
    assert.equal(badAnalysisScale.status,400);
    const badAnalysisDimensions=await request(port,
      "/api/terrain/analyze?product=lrm&scale=fine&width=1025&height=3&resolution=2",
      {method:"POST",headers:{"Content-Type":"application/octet-stream"},body:analysisUpload});
    assert.equal(badAnalysisDimensions.status,400);
    const shortAnalysis=await request(port,
      "/api/terrain/analyze?product=lrm&scale=fine&width=3&height=3&resolution=2",
      {method:"POST",headers:{"Content-Type":"application/octet-stream"},body:Buffer.alloc(4)});
    assert.equal(shortAnalysis.status,400);
    const oversizedAnalysis=await request(port,
      "/api/terrain/analyze?product=lrm&scale=fine&width=1024&height=512&resolution=2",
      {method:"POST",headers:{"Content-Type":"application/octet-stream"},
       body:Buffer.alloc(researchAnalysis.LIMITS.maxCells*4+4)});
    assert.equal(oversizedAnalysis.status,413);
    const implausibleGrid=new Float32Array(25).fill(100);implausibleGrid[0]=200000;
    const implausibleAnalysis=await request(port,
      "/api/terrain/analyze?product=lrm&scale=fine&width=5&height=5&resolution=2",
      {method:"POST",headers:{"Content-Type":"application/octet-stream"},
       body:Buffer.from(implausibleGrid.buffer)});
    assert.equal(implausibleAnalysis.status,422);
    assert.match(JSON.parse(implausibleAnalysis.body).error,/implausible/);

    const healthAfterAnalysis=JSON.parse((await request(port,"/api/health")).body);
    assert(healthAfterAnalysis.analysisCache.entries>=1,"health must expose the bounded analysis cache");
    assert.equal(healthAfterAnalysis.analysisCache.limitMiB,64);
    assert.equal(healthAfterAnalysis.terrain.restarted,0,"ordinary analysis must keep the M2 worker warm");

    const blocked=await request(port,"/api/warm",{
      method:"POST",headers:{Origin:"https://evil.example"},body:"{}"
    });
    assert.equal(blocked.status,403);
    assert.equal(blocked.headers["access-control-allow-origin"],undefined);

    const missingSnapshot=await request(port,"/api/snapshot/image",{
      headers:{Origin:"https://rileyg44.github.io"}
    });
    assert.equal(missingSnapshot.status,400);
    assert.match(JSON.parse(missingSnapshot.body).error,/URL is required/);
    assert.equal(missingSnapshot.headers["access-control-allow-origin"],"https://rileyg44.github.io");
    const insecureSnapshot=await request(port,"/api/snapshot/image?url="+
      encodeURIComponent("http://gibs.earthdata.nasa.gov/tile.png"));
    assert.equal(insecureSnapshot.status,400);
    assert.match(JSON.parse(insecureSnapshot.body).error,/HTTPS/);
    const disallowedSnapshot=await request(port,"/api/snapshot/image?url="+
      encodeURIComponent("https://evil.example/tile.png"));
    assert.equal(disallowedSnapshot.status,403);
    assert.match(JSON.parse(disallowedSnapshot.body).error,/not allowed/);
    const postSnapshot=await request(port,"/api/snapshot/image",{method:"POST"});
    assert.equal(postSnapshot.status,405);
    assert.equal(postSnapshot.headers.allow,"GET");

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

    /* A DEM tile with no coverage must still be a real 256x256 raster encoding
       sea level. It used to be the 1x1 transparent PNG used for 2D overlays,
       whose RGB(0,0,0) decodes in Terrarium to -32768 m — a 32 km pit in the 3D
       mesh, cached `immutable` for a week. Ocean is the easy way to hit it. */
    {
      const ocean=await request(port,"/api/elev/5/3/16.png");
      assert.equal(ocean.status,200);
      assert.equal(ocean.headers["x-coverage"],"none");
      const png=ocean.body;
      assert.ok(png.length>8&&png[0]===0x89&&png.toString("ascii",1,4)==="PNG","no-coverage DEM tile must be a PNG");
      assert.equal(png.readUInt32BE(16),256,"no-coverage DEM tile must be 256 wide");
      assert.equal(png.readUInt32BE(20),256,"no-coverage DEM tile must be 256 tall");
      // decode the first pixel and confirm it means 0 m, not -32768 m
      let off=8,idat=[];
      while(off+12<=png.length){
        const len=png.readUInt32BE(off),type=png.toString("ascii",off+4,off+8);
        if(type==="IDAT") idat.push(png.subarray(off+8,off+8+len));
        if(type==="IEND") break;
        off+=12+len;
      }
      const raw=zlib.inflateSync(Buffer.concat(idat));
      const r=raw[1],g=raw[2],b=raw[3];
      assert.equal((r*256+g+b/256)-32768,0,"no-coverage DEM tile must decode to 0 m");
    }
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
