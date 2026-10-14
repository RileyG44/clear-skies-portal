'use strict';
// Published pixel heatmap versus experimental object masks on the SAME
// train/validation views, mapped skeletons, uncertainty bands and valid ground.
// No parameter fitting; threshold sensitivity is descriptive only.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');
const E=require('./evaluate-objects.js');
const {loadViews,skeletonize}=require('./evaluate.js');
const ROOT=path.resolve(__dirname,'../..');
const THRESHOLDS=Object.freeze([0.35,0.45,0.58,0.70]);
const SCALES=Object.freeze(['fine','balanced','broad']);
function scoreMask(score,threshold){return Uint8Array.from(score,z=>Number.isFinite(z)&&z>=threshold?1:0);}
function coveredSkeleton(mask,skel,w,h,cellMetres,uncertaintyM){
 const d2=E.squaredDistanceTo(mask,w,h),covered=new Uint8Array(mask.length);
 const limit=uncertaintyM*uncertaintyM,cell2=cellMetres*cellMetres;
 for(let i=0;i<mask.length;i++)if(skel[i]&&d2[i]*cell2<=limit+1e-9)covered[i]=1;
 return covered;
}
function overlapCounts(skel,current,newer){
 let total=0,currentHits=0,newHits=0,both=0,newOnly=0,currentOnly=0;
 for(let i=0;i<skel.length;i++)if(skel[i]){total++;if(current[i])currentHits++;if(newer[i])newHits++;
 if(current[i]&&newer[i])both++;else if(newer[i])newOnly++;else if(current[i])currentOnly++;}
 return {total,currentHits,newHits,both,newOnly,currentOnly,union:currentHits+newOnly};
}
function summarize(rows,key){
 const positive=rows.filter(r=>r.class==='positive'),regions=new Map(),confusers={};
 for(const r of positive){const m=r.methods[key];if(!regions.has(r.region))regions.set(r.region,{total:0,hits:0});const g=regions.get(r.region);g.total+=r.skeletonPixels;g.hits+=m.skeletonHits;}
 const eligible=[...regions.values()].filter(g=>g.total>0),sum=(list,k)=>list.reduce((a,v)=>a+(v[k]||0),0);
 for(const r of rows.filter(r=>r.class!=='positive')){const g=confusers[r.type]||(confusers[r.type]={views:0,meanFlaggedArea:0,flaggedPixels:0,validPixels:0});g.views++;g.meanFlaggedArea+=r.methods[key].flaggedPixels/r.validPixels;g.flaggedPixels+=r.methods[key].flaggedPixels;g.validPixels+=r.validPixels;}
 for(const g of Object.values(confusers)){g.meanFlaggedArea/=g.views;g.pooledFlaggedArea=g.flaggedPixels/g.validPixels;}
 return {views:rows.length,positiveViews:positive.length,confuserViews:rows.length-positive.length,
 regionMacroRecall:eligible.length?eligible.reduce((a,g)=>a+g.hits/g.total,0)/eligible.length:null,
 pooledRecall:sum(eligible,'total')?sum(eligible,'hits')/sum(eligible,'total'):null,
 regions:Object.fromEntries(regions),confusers};
}
function summarizeOverlap(rows,scale){
 const regions=new Map();for(const r of rows.filter(r=>r.class==='positive')){
 const o=r.overlap[scale];if(!regions.has(r.region))regions.set(r.region,Object.fromEntries(Object.keys(o).map(k=>[k,0])));
 const g=regions.get(r.region);for(const k of Object.keys(o))g[k]+=o[k];}
 const eligible=[...regions.values()].filter(g=>g.total>0);
 const macro=k=>eligible.reduce((a,g)=>a+g[k]/g.total,0)/eligible.length;
 const missed=eligible.filter(g=>g.total>g.currentHits);
 return {currentRecall:macro('currentHits'),newRecall:macro('newHits'),bothRecall:macro('both'),
 additionalNewRecall:macro('newOnly'),currentOnlyRecall:macro('currentOnly'),unionRecall:macro('union'),
 fractionOfCurrentMissesRecovered:missed.reduce((a,g)=>a+g.newOnly/(g.total-g.currentHits),0)/missed.length,
 regions:Object.fromEntries(regions)};
}
function identity(r){return JSON.stringify([r.split,r.site,r.viewKm,r.offset]);}
function validPixels(grid){let n=0;for(const z of grid)if(Number.isFinite(z))n++;return n;}
function evaluate(view,prior,app,core,newAnalyze){
 if(!['train','validation'].includes(view.split))throw Error('Only train/validation permitted; test refused');
 const {w,h,cellMetres}=view,n=w*h,isPositive=view.class==='positive';
 const skel=isPositive?skeletonize(view.pos,w,h):null;
 const row={site:view.site,region:view.region,split:view.split,class:view.class,type:view.type,
 viewKm:view.viewKm,offset:view.offset,cellMetres,uncertaintyM:view.uncertaintyM??12,
 validPixels:validPixels(view.grid),skeletonPixels:isPositive?skel.reduce((a,z)=>a+(z?1:0),0):null,methods:{},overlap:{}};
 let newCovered;
 if(isPositive){
  const result=newAnalyze(view.grid,w,h,{cellSize:cellMetres});
  const exact=E.exactSegmentPixels(result,result.segments,view);
  const eligible=result.segments.filter(s=>['likely','possible'].includes(s.verdict)&&E.segmentAreaM2(s,cellMetres,exact.bySegment.get(s)?.length)>=E.MIN_SEGMENT_AREA_M2);
  const mask=E.buildFlaggedMask(result,eligible,view,exact);
  newCovered=coveredSkeleton(mask,skel,w,h,cellMetres,row.uncertaintyM);
  const flaggedPixels=mask.reduce((a,z)=>a+z,0),hits=newCovered.reduce((a,z)=>a+z,0);
  if(hits!==prior.skeletonHits||row.skeletonPixels!==prior.skeletonPixels||flaggedPixels!==prior.flaggedPixels)throw Error(`New-detector reproduction mismatch: ${identity(view)}`);
  row.methods.new={flaggedPixels,skeletonHits:hits};
 }else row.methods.new={flaggedPixels:prior.flaggedPixels,skeletonHits:null};
 function record(key,score,threshold){const mask=scoreMask(score,threshold);const covered=isPositive?coveredSkeleton(mask,skel,w,h,cellMetres,row.uncertaintyM):null;
 row.methods[key]={flaggedPixels:mask.reduce((a,z)=>a+z,0),skeletonHits:covered?covered.reduce((a,z)=>a+z,0):null};return covered;}
 for(const scale of SCALES){const result=app.run({product:'glacial',scale,width:w,height:h,resolution:cellMetres,grid:view.grid});
  for(const threshold of THRESHOLDS){const covered=record(`${scale}@${threshold}`,result.data,threshold);if(isPositive&&threshold===0.58)row.overlap[scale]=overlapCounts(skel,covered,newCovered);}}
 const reference=core.scoreGlacialLobeMarginCandidates(view.grid,w,h,{cellSize:cellMetres,horizontalUnit:'m',verticalUnit:'m',rowAxis:'south',edgePolicy:'shrink'});
 record('core5@0.58',reference.score,0.58);
 if(!isPositive&&row.methods['core5@0.58'].flaggedPixels!==prior.baselineFlaggedPixels)throw Error(`Prior baseline reproduction mismatch: ${identity(view)}`);
 return row;
}
function hashFile(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
async function main(){
 const args=process.argv.slice(2),opt=(k,d)=>args.includes(k)?args[args.indexOf(k)+1]:d;
 const split=opt('--split','both');if(!['both','train','validation'].includes(split))throw Error('Only train/validation permitted; test refused');
 const appDir=path.resolve(opt('--app-dir',path.join(ROOT,'output/glacial-calibration/current-app-snapshot')));
 const out=path.resolve(opt('--out',path.join(ROOT,'output/glacial-calibration/results-current-app-recall.json')));
 const limit=args.includes('--limit')?Number(opt('--limit',0)):null,jobs=Math.max(1,Math.min(6,Number(opt('--jobs',6))));
 const previous=JSON.parse(fs.readFileSync(path.join(ROOT,'output/glacial-calibration/results-objects-belt-v3.json')));
 const appFiles=['version.js','research-analysis.js','glacial-research-core.js','index.html'];
 const fingerprint=()=>({currentApp:Object.fromEntries(appFiles.map(f=>[f,hashFile(path.join(appDir,f))])),
 evaluator:hashFile(__filename),newDetector:E.computeFingerprint({config:{},candidateThreshold:0.45,
 analysisPath:path.join(ROOT,'glacial-moraine-analysis.js'),viewCount:297,limit:null,skipBaseline:false,split:'train',beltOff:false}).hash});
 const frozen=fingerprint();if(frozen.newDetector!==previous.fingerprints.train.hash)throw Error('Previous new-detector experiment no longer matches source/corpus');
 const selected=split==='both'?['train','validation']:[split];let views=selected.flatMap(s=>loadViews(s));
 if(limit!==null)views=views.slice(0,limit);if(!views.length)throw Error('No eligible views');
 const prior=new Map(previous.rows.map(r=>[identity(r),r]));for(const v of views)if(!prior.has(identity(v)))throw Error('Missing matching prior row');
 const rows=new Array(views.length),workers=[];let next=0,done=0;const started=Date.now();
 console.log(`Evaluating ${views.length} views with ${jobs} workers; published scales ${SCALES}; thresholds ${THRESHOLDS}`);
 try{await Promise.all(Array.from({length:jobs},()=>new Promise((resolve,reject)=>{
 const worker=new Worker(__filename,{workerData:{appDir}});workers.push(worker);
 const dispatch=()=>{if(next>=views.length){resolve();return;}const index=next++;worker.postMessage({index,view:views[index],prior:prior.get(identity(views[index]))});};
 worker.on('message',m=>{if(m.error){reject(Error(m.error));return;}rows[m.index]=m.row;done++;if(done%10===0||done===views.length)console.log(`${done}/${views.length}`);dispatch();});worker.on('error',reject);dispatch();
 })));}finally{await Promise.all(workers.map(w=>w.terminate()));}
 if(done!==views.length||rows.filter(Boolean).length!==views.length)throw Error('Incomplete row collection');
 if(JSON.stringify(fingerprint())!==JSON.stringify(frozen))throw Error('Source/corpus changed during evaluation');
 const keys=Object.keys(rows[0].methods),summaries={};
 for(const group of ['train','validation','combined']){const selectedRows=group==='combined'?rows:rows.filter(r=>r.split===group);if(!selectedRows.length)continue;
 summaries[group]={methods:Object.fromEntries(keys.map(k=>[k,summarize(selectedRows,k)])),overlap:Object.fromEntries(SCALES.map(scale=>[scale,summarizeOverlap(selectedRows,scale)]))};}
 const payload={created:new Date().toISOString(),publishedUrl:'https://rileyg44.github.io/clear-skies-portal/',
 publishedBuild:fs.readFileSync(path.join(appDir,'version.js'),'utf8'),fingerprint:frozen,thresholds:THRESHOLDS,scales:SCALES,
 complete:limit===null&&split==='both',seconds:(Date.now()-started)/1000,node:process.version,
 metric:'Region-macro mapped-positive-skeleton recall within per-view uncertainty. New mask: exact original membership, eligible likely+possible, >=5000 m2. Current mask: unfiltered score >= threshold.',
 testScored:false,summaries,rows};fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(payload,null,1));
 console.log(JSON.stringify({out,views:rows.length,balancedRecall:summaries.combined?.methods['balanced@0.58'].regionMacroRecall,newRecall:summaries.combined?.methods.new.regionMacroRecall}));
}
if(!isMainThread){const app=require(path.join(workerData.appDir,'research-analysis.js')),core=require(path.join(workerData.appDir,'glacial-research-core.js')),
 newAnalyze=require(path.join(ROOT,'glacial-moraine-analysis.js')).analyzeMoraineCandidates;
 parentPort.on('message',m=>{try{parentPort.postMessage({index:m.index,row:evaluate(m.view,m.prior,app,core,newAnalyze)});}catch(e){parentPort.postMessage({index:m.index,error:e.stack});}});
}else if(require.main===module){main().catch(e=>{console.error(e);process.exitCode=1;});}
module.exports={scoreMask,coveredSkeleton,overlapCounts,summarize,summarizeOverlap,evaluate,identity};
