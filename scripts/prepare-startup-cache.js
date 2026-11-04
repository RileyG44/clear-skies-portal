"use strict";
const path=require("path"),fs=require("fs");
async function prepare(){
  const directory=path.resolve("build/startup-cache"),marker=path.join(directory,".snapshot");
  const manifest=JSON.parse(fs.readFileSync("build/startup-terrain.manifest.json","utf8"));
  if(!fs.existsSync(marker)||fs.readFileSync(marker,"utf8")!==manifest.archiveSha256)fs.rmSync(directory,{recursive:true,force:true});
  const result=await require("../electron/startup-cache").installStartupCache(
    path.resolve("build/startup-terrain.json.gz"),directory,{minFreeGiB:0});
  if(result.reason==="expired")throw Error("Startup terrain expired; refresh with node scripts/build-startup-cache.js");
  fs.writeFileSync(marker,manifest.archiveSha256);
  console.log(`Startup terrain resources: ${result.reason}, ${result.installed} tiles prepared.`);
}
if(require.main===module)prepare().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={prepare};
