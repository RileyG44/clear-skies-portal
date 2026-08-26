"use strict";

const fs=require("fs");
const path=require("path");

const ROOT="https://s3-us-west-2.amazonaws.com/usgs-lidar-public/";
const out=path.resolve(__dirname,"..","point-cloud-catalog.json");

async function get(url){const response=await fetch(url);if(!response.ok)throw new Error(`${response.status} ${url}`);return response}
function year(project){const values=(project.match(/(?:19|20)\d{2}/g)||[]).map(Number),short=project.match(/(?:^|_)[A-Z](\d{2})(?:_|$)/);if(short)values.push(2000+Number(short[1]));return Math.max(0,...values)}
async function main(){
  const xml=await (await get(`${ROOT}?list-type=2&delimiter=/&prefix=WA_`)).text();
  const projects=[...xml.matchAll(/<Prefix>(WA_[^<]+\/)\s*<\/Prefix>/g)].map(match=>match[1].slice(0,-1));
  const records=[];
  let cursor=0;
  await Promise.all(Array.from({length:6},async()=>{for(;;){const i=cursor++;if(i>=projects.length)return;const project=projects[i];try{
    const metadata=await (await get(`${ROOT}${project}/ept.json`)).json();
    records.push({project,year:year(project),points:metadata.points||0,dataType:metadata.dataType,hierarchyType:metadata.hierarchyType,span:metadata.span,srs:`${metadata.srs?.authority||""}:${metadata.srs?.horizontal||""}`,bounds:metadata.bounds,boundsConforming:metadata.boundsConforming,url:`${ROOT}${project}/ept.json`});
  }catch(error){console.warn(`${project}: ${error.message}`)}}}));
  records.sort((a,b)=>a.project.localeCompare(b.project));
  const payload={schema:1,source:ROOT,generatedAt:new Date().toISOString(),projects:records};
  fs.writeFileSync(out,JSON.stringify(payload,null,2)+"\n");
  console.log(`wrote ${records.length} projects to ${path.basename(out)}`);
  if(records.length!==30)throw new Error(`expected 30 Washington EPT projects, received ${records.length}`);
}
main().catch(error=>{console.error(error);process.exitCode=1});
