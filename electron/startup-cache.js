"use strict";
const fs=require("fs"),path=require("path"),zlib=require("zlib"),crypto=require("crypto"),{promisify}=require("util");
const gunzip=promisify(zlib.gunzip),GIB=1073741824,TTL=90*24*3600*1000;
const digest=(algorithm,body)=>crypto.createHash(algorithm).update(body).digest("hex");
async function installStartupCache(file,cache,config){
  const manifest=JSON.parse(await fs.promises.readFile(file.replace(".json.gz",".manifest.json"),"utf8"));
  if(manifest.version!==1||!Array.isArray(manifest.keys)||manifest.keys.length>1000||manifest.keys.some(key=>!/^[a-f0-9]{40}$/.test(key)))
    throw Error("Invalid startup terrain manifest");
  const present=await Promise.all(manifest.keys.map(async key=>fs.existsSync(path.join(cache,key))&&fs.existsSync(path.join(cache,key+".meta"))));
  if(present.every(Boolean))return {installed:0,reason:"already-cached"};
  const packed=await fs.promises.readFile(file);
  if(digest("sha256",packed)!==manifest.archiveSha256)throw Error("Startup terrain archive checksum mismatch");
  const archive=JSON.parse((await gunzip(packed,{maxOutputLength:96*1024*1024})).toString());
  const captured=Date.parse(archive.capturedAt);
  if(archive.version!==1 || archive.capturedAt!==manifest.capturedAt || !Number.isFinite(captured) || captured>Date.now()+60000 || !Array.isArray(archive.entries) || archive.entries.length!==manifest.keys.length)
    throw Error("Invalid startup terrain package");
  // Preserve the acquisition age rather than refreshing stale seed data on install.
  if(Date.now()-captured>=TTL)return {installed:0,reason:"expired"};
  await fs.promises.mkdir(cache,{recursive:true});
  const stat=await fs.promises.statfs(cache),available=Number(stat.bavail)*Number(stat.bsize)-config.minFreeGiB*GIB;
  let installed=0,used=0;
  for(const entry of archive.entries){
    const {kind,z,x,y,key,meta}=entry;
    if(!manifest.keys.includes(key)||!["overview","national"].includes(kind)||!Number.isInteger(z)||z<0||z>11||!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x>=2**z||y>=2**z||
      key!==digest("sha1",`elevation-${kind}-v1:${z}/${x}/${y}`)||meta?.status!==200||meta.type!=="image/png")throw Error("Invalid startup terrain entry");
    const body=Buffer.from(entry.body,"base64");
    if(body.length>1024*1024||digest("sha256",body)!==entry.sha256||body.toString("hex",0,8)!=="89504e470d0a1a0a")throw Error("Startup terrain checksum mismatch");
    const target=path.join(cache,key),metadata=target+".meta";
    // A live cache entry (including a negative coverage result) always wins.
    if(fs.existsSync(target)||fs.existsSync(metadata))continue;
    used+=body.length+4096;if(used>available)break;
    let bodyCreated=false;
    try{
      await fs.promises.writeFile(target,body,{flag:"wx"});bodyCreated=true;
      await fs.promises.writeFile(metadata,JSON.stringify({...meta,seedCapturedAt:archive.capturedAt}),{flag:"wx"});
      const at=new Date(captured);await fs.promises.utimes(target,at,at);await fs.promises.utimes(metadata,at,at);
      installed++;
    }catch(error){
      if(bodyCreated)await fs.promises.unlink(target).catch(()=>{});
      if(error.code!=="EEXIST")throw error;
    }
  }
  return {installed,reason:used>available?"disk-reserve":"ready"};
}
module.exports={installStartupCache};
