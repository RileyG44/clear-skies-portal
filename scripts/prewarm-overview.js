#!/usr/bin/env node
'use strict';
/* Fill the engine's ordinary cache with the existing global Terrarium tiles.
 * No derived styles, new source, cache-cap changes or recurring job is added.
 * node scripts/prewarm-overview.js --url http://127.0.0.1:8765 --max-zoom 6
 * Add --dry-run to inspect the count and disk headroom without fetching tiles. */
const fs=require('node:fs'),path=require('node:path');
function options(args){
  const out={maxZoom:6,concurrency:2,dryRun:false};
  for(let i=0;i<args.length;i++){
    const name=args[i];
    if(name==='--dry-run'){out.dryRun=true;continue;}
    if(!['--url','--max-zoom','--concurrency','--output'].includes(name)||!args[i+1])throw Error('Use --url <engine> [--max-zoom 0..7] [--concurrency 1..4] [--dry-run] [--output <json>]');
    const value=args[++i];
    if(name==='--url')out.url=new URL(value);
    else if(name==='--output')out.output=value;
    else out[name==='--max-zoom'?'maxZoom':'concurrency']=Number(value);
  }
  if(!out.url||!['http:','https:'].includes(out.url.protocol)||out.url.username||out.url.password)throw Error('An HTTP(S) engine --url without credentials is required');
  if(!Number.isInteger(out.maxZoom)||out.maxZoom<0||out.maxZoom>7)throw Error('--max-zoom must be 0..7');
  if(!Number.isInteger(out.concurrency)||out.concurrency<1||out.concurrency>4)throw Error('--concurrency must be 1..4');
  return out;
}
async function warm(o){
  const response=await fetch(new URL('/api/health',o.url),{signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error(`Engine health HTTP ${response.status}`);
  const health=await response.json();
  if(!health.ok||!health.features?.includes('overview-elevation'))throw Error('This engine does not advertise overview-elevation; install the matching server build first');
  const levels=Array.from({length:o.maxZoom+1},(_,z)=>({z,tiles:4**z,bytes:0,hits:0,misses:0}));
  const total=levels.reduce((n,l)=>n+l.tiles,0),upperBytes=total*(256*256*4+4096);
  const report={engine:o.url.origin,maxZoom:o.maxZoom,concurrency:o.concurrency,total,done:0,bytes:0,levels,dryRun:o.dryRun,
    cacheDisk:health.cacheDisk,cacheCapGiB:health.cacheBudget?.capGiB,startedAt:new Date().toISOString()};
  if(health.cacheDisk?.writable===false)throw Error('The engine cache disk is at its existing free-space reserve');
  if(Number.isFinite(health.cacheDisk?.freeGiB)&&
      (health.cacheDisk.freeGiB-health.cacheDisk.minFreeGiB)*2**30<upperBytes)
    throw Error('The conservative uncompressed tile allowance would cross the engine free-space reserve; use fewer levels');
  if(o.dryRun)return report;
  const controller=new AbortController(),stop=()=>controller.abort();
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  let next=0;
  const tileAt=index=>{
    for(let z=0;z<=o.maxZoom;z++){const size=4**z;if(index<size)return {z,x:index%(2**z),y:Math.floor(index/(2**z))};index-=size;}
  };
  try{
    await Promise.all(Array.from({length:o.concurrency},async()=>{
      while(next<total&&!controller.signal.aborted){
        const tile=tileAt(next++),url=new URL(`/api/elev/overview/${tile.z}/${tile.x}/${tile.y}.png`,o.url);
        let last;
        for(let attempt=0;attempt<3;attempt++){
          try{
            const r=await fetch(url,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});
            if(!r.ok)throw Error(`Overview ${tile.z}/${tile.x}/${tile.y}: HTTP ${r.status}`);
            const body=Buffer.from(await r.arrayBuffer());
            if(body.length<24||body.toString('hex',0,8)!=='89504e470d0a1a0a'||body.readUInt32BE(16)!==256||body.readUInt32BE(20)!==256)
              throw Error('Engine returned an invalid overview tile');
            const level=levels[tile.z];level.bytes+=body.length;
            if(r.headers.get('X-Cache')?.toLowerCase()==='hit')level.hits++;else level.misses++;
            report.bytes+=body.length;report.done++;
            if(report.done%256===0||report.done===total)console.log(`${report.done}/${total} tiles, ${(report.bytes/2**20).toFixed(1)} MiB`);
            last=null;break;
          }catch(error){last=error;if(controller.signal.aborted)throw error;}
        }
        if(last)throw last;
      }
    })).catch(error=>{controller.abort();throw error;});
    if(controller.signal.aborted)throw Error('Prewarming cancelled');
    report.finishedAt=new Date().toISOString();return report;
  }finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}
}
if(require.main===module)(async()=>{
  const o=options(process.argv.slice(2)),report=await warm(o);
  if(o.output){fs.mkdirSync(path.dirname(path.resolve(o.output)),{recursive:true});fs.writeFileSync(o.output,JSON.stringify(report,null,2)+'\n');}
  console.log(JSON.stringify(report,null,2));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={options,warm};
