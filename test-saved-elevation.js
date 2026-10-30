"use strict";
/* Preloaded in the HTTP child, this forbids both upstream requests and raw
   worker tasks. A saved tile must be served with the COG ranges absent. */
const assert=require("assert/strict"),fs=require("fs"),os=require("os"),path=require("path");
const http=require("http"),net=require("net"),zlib=require("zlib"),{spawn}=require("child_process");
const budget=require("./cache-budget.js"),usgs=require("./usgs.js");
if(process.env.CSP_TEST_SAVED_ELEVATION_FIXTURE==="1"){
  const blocked=kind=>{
    fs.appendFileSync(process.env.CSP_TEST_SAVED_ELEVATION_LOG,kind+"\n");
    return Error("Offline fixture forbids "+kind);
  };
  require("https").request=()=>{throw blocked("upstream")};
  require("./terrain-pool.js").TerrainPool.prototype.run=async action=>{throw blocked(action)};
}else if(require.main===module){
  main().catch(error=>{console.error(error);process.exitCode=1});
}
function request(port,url){
  return new Promise((resolve,reject)=>{
    const req=http.get({host:"127.0.0.1",port,path:url},res=>{
      const chunks=[];res.on("data",chunk=>chunks.push(chunk));
      res.on("end",()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));
    });
    req.on("error",reject);req.setTimeout(5000,()=>req.destroy(Error("request timed out")));
  });
}
function pixels(png){
  const parts=[];let width,height;
  for(let offset=8;offset<png.length;){
    const size=png.readUInt32BE(offset),type=png.toString("ascii",offset+4,offset+8);
    const data=png.subarray(offset+8,offset+8+size);
    if(type==="IHDR"){width=data.readUInt32BE(0);height=data.readUInt32BE(4)}
    if(type==="IDAT")parts.push(data);
    offset+=size+12;
  }
  const raw=zlib.inflateSync(Buffer.concat(parts)),rgba=Buffer.alloc(width*height*4);
  for(let y=0;y<height;y++){
    assert.equal(raw[y*(width*4+1)],0,"fixture PNG uses unfiltered rows");
    raw.copy(rgba,y*width*4,y*(width*4+1)+1,(y+1)*(width*4+1));
  }
  return {rgba,width,height};
}
function dem(height){
  const packed=height+32768,whole=Math.floor(packed),rgba=Buffer.alloc(256*256*4);
  for(let i=0;i<rgba.length;i+=4){rgba[i]=whole>>8;rgba[i+1]=whole&255;rgba[i+2]=Math.floor((packed-whole)*256);rgba[i+3]=255}
  return usgs.encodePNG(rgba,256,256);
}
async function main(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"csp-saved-elevation-")),old=(Date.now()-86400000)/1000;
  let child;
  try{
    fs.mkdirSync(path.join(dir,"usgs/areas"),{recursive:true});
    const log=path.join(dir,"blocked.log"),raw=dem(456.75),national=dem(123.5);
    const cases=[
      {raw:200,national:200,source:"usgs-1m",coverage:"0.75"},
      {raw:204,national:200,source:"3dep",coverage:"1"},
      /* No saved raw tile: a cached national DEM is not what this route would
         compute (1 m comes first), so it is only an uncached offline fallback. */
      {national:200,source:"3dep",coverage:"1",fallback:true},
      {raw:200,national:204,source:"usgs-1m",coverage:"0.75"},
      {raw:204,national:204,source:"none",coverage:"none"},
      {national:204,source:"none",coverage:"none",fallback:true},
      {z:12,raw:200,national:200,source:"3dep",coverage:"1"},
      {raw:200,national:200,source:"usgs-1m",legacy:true,fallback:true},
      /* A raw gap saved without the final mark may come from an incomplete
         1 m index, so it is not this route's exact answer: 1 m is tried first. */
      {raw:204,national:200,source:"3dep",coverage:"1",fallback:true,unmarked:true}
    ];
    const put=(key,status,body,coverage,final)=>{
      const target=path.join(dir,key);
      fs.writeFileSync(target,status===204?Buffer.alloc(0):body);
      fs.writeFileSync(target+".meta",JSON.stringify({status,type:"image/png",...(coverage==null?{}:{sourceMeta:{scope:usgs.coverageScope(),coverage,...(final?{final:true,scope:usgs.coverageScope()}:{})}})}));
      fs.utimesSync(target,old,old);fs.utimesSync(target+".meta",old,old);
    };
    for(let i=0;i<cases.length;i++){
      const c=cases[i];Object.assign(c,{z:c.z||13,x:1380+i,y:1440});
      const N=2**c.z,lon=(c.x+.4)/N*360-180,lat=Math.atan(Math.sinh(Math.PI*(1-2*(c.y+.4)/N)))*180/Math.PI;
      fs.writeFileSync(path.join(dir,"usgs/areas",i+".json"),JSON.stringify({bbox:[lon,lat-.00001,lon+.00001,lat],z0:c.z,z1:c.z,raw:true,style:"slope"}));
      const keys=budget.elevationWarmKeys(c);
      if(c.raw)put(keys.raw,c.raw,raw,c.legacy?undefined:.75,c.raw===204&&!c.unmarked);
      put(keys.national,c.national,national,c.legacy?undefined:1);
    }
    const range=path.join(dir,"usgs",budget.sha1("discarded-cog-range"));
    fs.writeFileSync(range,Buffer.alloc(4096));fs.utimesSync(range,old,old);
    const swept=await budget.sweep(dir,{capBytes:1});
    assert.equal(swept.errors.length,0);assert.equal(swept.manifests,cases.length);
    assert(!fs.existsSync(range),"actual range eviction precedes offline requests");
    assert(fs.readdirSync(path.join(dir,"usgs")).every(name=>!/^[a-f0-9]{40}$/.test(name)),"no COG chunks remain");
    // Reintroduce a low-zoom raw body to prove it cannot override the national tile.
    put(budget.elevationWarmKeys(cases[6]).raw,200,raw,.75);
    const port=await new Promise(resolve=>{const socket=net.createServer();socket.listen(0,"127.0.0.1",()=>{const port=socket.address().port;socket.close(()=>resolve(port))})});
    child=spawn(process.execPath,["--require",__filename,"server.js"],{
      cwd:__dirname,env:{...process.env,PORT:String(port),HOST:"127.0.0.1",CSP_CACHE_DIR:dir,CSP_MARKUP_DIR:path.join(dir,"markup"),
        CSP_TERRAIN_WORKERS:"1",CSP_CACHE_MIN_FREE_GB:process.env.CSP_CACHE_MIN_FREE_GB||"1",
        CSP_TEST_SAVED_ELEVATION_FIXTURE:"1",CSP_TEST_SAVED_ELEVATION_LOG:log},stdio:["ignore","pipe","pipe"]
    });
    let logs="";child.stdout.on("data",chunk=>logs+=chunk);child.stderr.on("data",chunk=>logs+=chunk);
    let ready=false;
    for(let i=0;i<150;i++){
      try{if((await request(port,"/api/health")).status===200){ready=true;break}}catch{}
      if(child.exitCode!=null)break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert(ready,"offline server must start\n"+logs);
    for(const c of cases.filter(c=>!c.fallback)){
      const tile=`${c.z}/${c.x}/${c.y}`,key=budget.sha1("elevation-v5:"+tile);
      assert(!fs.existsSync(path.join(dir,key)),"generic elevation starts uncached");
      const first=await request(port,"/api/elev/"+tile+".png");
      assert.equal(first.status,200);assert.equal(first.headers["x-cache"],"hit");
      assert.equal(first.headers["x-elevation-source"],c.source);
      assert.equal(first.headers["x-coverage"],c.coverage);
      assert.equal(first.headers["cache-control"],"public, max-age=604800, immutable");
      if(c.source==="none"){
        const {rgba,width,height}=pixels(first.body);assert.equal(width,256);assert.equal(height,256);
        for(let i=0;i<rgba.length;i+=4)assert.deepEqual([...rgba.subarray(i,i+4)],[128,0,0,255],"no coverage is opaque sea-level geometry");
      }else assert.deepEqual(first.body,c.source==="usgs-1m"?raw:national,"saved Terrarium bytes are reused unchanged");
      const meta=JSON.parse(fs.readFileSync(path.join(dir,key+".meta"),"utf8"));
      assert.equal(meta.status,c.source==="none"?204:200,"reuse also persists elevation-v5");
      const second=await request(port,"/api/elev/"+tile+".png");
      assert.deepEqual(second.body,first.body);assert.equal(second.headers["x-cache"],"hit");
      assert.equal(second.headers["x-elevation-source"],c.source==="none"?"none":"cached");
    }
    assert(!fs.existsSync(log),"saved tiles must not attempt raw rendering or upstream requests");
    const cold=await request(port,"/api/elev/13/1500/1440.png");
    assert.equal(cold.status,503,"an unsaved tile retains its offline failure behavior");
    assert.match(fs.readFileSync(log,"utf8"),/raw-elevation\nupstream\n/,"the fixture catches both forbidden paths");
    /* After the cold check: these trip the national circuit breaker. */
    for(const c of cases.filter(c=>c.fallback)){
      const tile=`${c.z}/${c.x}/${c.y}`,key=budget.sha1("elevation-v5:"+tile);
      for(let attempt=0;attempt<2;attempt++){
        const res=await request(port,"/api/elev/"+tile+".png");
        assert.equal(res.status,200);assert.equal(res.headers["x-cache"],"saved-fallback");
        assert.equal(res.headers["x-elevation-source"],c.source);assert.equal(res.headers["x-coverage"],c.coverage);
        assert.equal(res.headers["cache-control"],"no-store","a fallback must not be cached by the browser");
        if(c.source==="none"){const {rgba}=pixels(res.body);assert.deepEqual([...rgba.subarray(0,4)],[128,0,0,255])}
        else assert.deepEqual(res.body,c.source==="usgs-1m"?raw:national);
      }
      assert(!fs.existsSync(path.join(dir,key)),"a fallback never persists under elevation-v5, so 1 m is fetched again online");
    }
    const attempts=fs.readFileSync(log,"utf8").split("\n").filter(line=>line==="raw-elevation").length;
    assert(attempts>=1+cases.filter(c=>c.fallback).length*2,"1 m lidar is attempted before every national fallback");
    console.log(`saved elevation: ${cases.filter(c=>!c.fallback).length} exact offline cases + ${cases.filter(c=>c.fallback).length} uncached fallbacks passed (ranges evicted, 1 m tried first)`);
  }finally{
    if(child&&child.exitCode==null){const exited=new Promise(resolve=>child.once("exit",resolve));child.kill();await exited}
    fs.rmSync(dir,{recursive:true,force:true});
  }
}
