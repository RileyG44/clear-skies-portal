"use strict";
// Refresh only public-domain USGS elevation and the existing attributed Mapzen
// overview. Display-only basemaps/imagery are never included in this package.
const fs=require("fs"),path=require("path"),os=require("os"),net=require("net"),zlib=require("zlib"),crypto=require("crypto");
const {spawn}=require("child_process"),{once}=require("events");
const view={center:[47.559373,-117.699455],referenceZoom:10.04,referenceWidth:430,referenceHeight:932,width:1920,height:1080};
function tiles(includeNational=false){
  const zoom=view.referenceZoom+Math.log2(Math.min(view.width/view.referenceWidth,view.height/view.referenceHeight));
  const [lat,lng]=view.center,cy=(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2,cx=(lng+180)/360;
  const out=[];
  for(let z=6;z<=11;z++){
    const n=2**z,scale=2**(z-zoom),dx=view.width/512*scale,dy=view.height/512*scale;
    const ring=z>=9?1:0;
    for(let x=Math.floor(cx*n-dx)-ring;x<=Math.floor(cx*n+dx)+ring;x++)
      for(let y=Math.floor(cy*n-dy)-ring;y<=Math.floor(cy*n+dy)+ring;y++)
        for(const kind of includeNational&&z>=9?["overview","national"]:["overview"])
          out.push({kind,z,x,y});
  }
  return out;
}
async function build(){
  const plan=tiles(process.argv.includes("--national"));console.log(`Preparing ${plan.length} startup elevation tiles (default view and one-tile border).`);
  if(process.argv.includes("--dry-run")){console.log(JSON.stringify({view,levels:plan.reduce((o,t)=>(o[t.z]=(o[t.z]||0)+1,o),{})}));return;}
  const scratch=fs.mkdtempSync(path.join(os.tmpdir(),"csp-startup-seed-"));
  const listener=net.createServer();listener.listen(0,"127.0.0.1");await once(listener,"listening");
  const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
  const child=spawn(process.execPath,[path.resolve("server.js")],{env:{...process.env,HOST:"127.0.0.1",PORT:String(port),
    CSP_CACHE_DIR:path.join(scratch,"cache"),CSP_MARKUP_DIR:path.join(scratch,"markup"),CSP_TERRAIN_WORKERS:"2",CSP_DNR_ARCHIVE_DIR:"off",CSP_CACHE_MIN_FREE_GB:"1"},stdio:["ignore","pipe","pipe"]});
  let log="";child.stdout.on("data",data=>{log+=data;});child.stderr.on("data",data=>{log+=data;});
  try{
    let healthy=false;
    for(let i=0;i<100;i++){
      if(child.exitCode!==null)throw Error(log);
      try{healthy=(await (await fetch(`http://127.0.0.1:${port}/api/health`)).json()).ok;}catch{}
      if(healthy)break;await new Promise(resolve=>setTimeout(resolve,100));
    }
    if(!healthy)throw Error(`Seed engine failed to start: ${log}`);
    let next=0,done=0;const entries=[];
    await Promise.all(Array.from({length:3},async()=>{
      while(next<plan.length){
        const tile=plan[next++],{kind,z,x,y}=tile;
        const url=`http://127.0.0.1:${port}/api/elev/${kind}/${z}/${x}/${y}.png`;
        let error;
        for(let attempt=0;attempt<3;attempt++){
          try{
            const response=await fetch(url,{signal:AbortSignal.timeout(45000)});
            if(!response.ok || response.headers.get("X-Coverage")==="none")throw Error(`${url}: HTTP ${response.status} / ${response.headers.get("X-Coverage")}`);
            const body=Buffer.from(await response.arrayBuffer());
            if(body.toString("hex",0,8)!=="89504e470d0a1a0a" || body.readUInt32BE(16)!==256 || body.readUInt32BE(20)!==256)throw Error(`Invalid terrain PNG: ${url}`);
            const key=crypto.createHash("sha1").update(`elevation-${kind}-v1:${z}/${x}/${y}`).digest("hex");
            const meta=JSON.parse(fs.readFileSync(path.join(scratch,"cache",key+".meta"),"utf8"));
            entries.push({...tile,key,meta,sha256:crypto.createHash("sha256").update(body).digest("hex"),body:body.toString("base64")});
            error=null;break;
          }catch(e){error=e;}
        }
        if(error)throw error;
        done++;if(done%25===0||done===plan.length)console.log(`${done}/${plan.length} startup tiles prepared`);
      }
    }));
    entries.sort((a,b)=>a.key.localeCompare(b.key));
    const archive={version:1,capturedAt:new Date().toISOString(),view,entries};
    const file=path.resolve("build/startup-terrain.json.gz");
    const packed=zlib.gzipSync(JSON.stringify(archive),{level:9});
    fs.writeFileSync(file,packed);
    fs.writeFileSync(file.replace(".json.gz",".manifest.json"),JSON.stringify({version:1,capturedAt:archive.capturedAt,view,
      archiveSha256:crypto.createHash("sha256").update(packed).digest("hex"),keys:entries.map(entry=>entry.key)},null,2)+"\n");
    console.log(`Wrote ${file}: ${(fs.statSync(file).size/1048576).toFixed(1)} MiB`);
  }finally{
    if(child.exitCode===null){const exited=once(child,"exit");child.kill();await exited;}
    fs.rmSync(scratch,{recursive:true,force:true});
  }
}
if(require.main===module)build().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={tiles,view};
