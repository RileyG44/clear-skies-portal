'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const path=require('node:path'),root=__dirname;
const html=require("./test-fixtures/page-source.js");
const C=require('./share-state.js');
const fixture=JSON.parse(fs.readFileSync(path.join(root,'test-fixtures/share-state-v1.json'),'utf8'));
const controls=Object.entries(fixture.controls).map(([id,value])=>({id,type:typeof value==='boolean'?'checkbox':/^#[a-f0-9]{6}$/i.test(value)?'color':value!==''&&Number.isFinite(+value)?'number':'text',tagName:'INPUT',min:'',max:''}));
const ctx={CSPShareState:C,document:{querySelectorAll:selector=>selector==='input[id],select[id]'?controls:[]},URL,
 CSPLidarRender:require(path.join(root,'lidar-render.js')),CSPAnalysisLayers:require(path.join(root,'analysis-layers.js')),
 researchStyleDefaults:()=>({palette:'standard',blend:'normal',opacity:.82,relief:0,reverse:false,visible:true}),researchPaletteChoices:()=>[],
 VIEW_MAX:28,OVERLAYS:fixture.overlays.map(o=>({id:o.id})),RESEARCH_LABELS:{curvature:'Surface curvature (Laplacian)'},RESEARCH_PARAMS:{scale:{options:[['balanced','Balanced']]}},};
vm.createContext(ctx);
vm.runInContext(html.slice(html.indexOf('const CSP_SHARE_WEB_URL='),html.indexOf('Object.assign(window.ClearSkiesPortalBridge,{shareURL:')),ctx);
(async()=>{
 const data={label:'47.66, -117.4 · κ ⛰️',raster:new Float32Array([1,NaN,Infinity,-Infinity,-0,1/3]),classes:new Uint8Array([2,3,9]),none:null};
 const decoded=await C.decode(await C.encode(data));assert.equal(decoded.label,data.label);
 assert.deepEqual(Buffer.from(decoded.raster.buffer),Buffer.from(data.raster.buffer));assert.deepEqual(decoded.classes,data.classes);
 for(const bad of ['','2.abcd','1.','1.!','1.abc'])await assert.rejects(()=>C.decode(bad));
 assert.throws(()=>C.unpack(JSON.parse('{"__proto__":{"polluted":true}}')));
 assert.throws(()=>C.unpack({$binary:'Float32Array',data:'AA',length:10}));assert.equal({}.polluted,undefined);
 ctx.cspValidateShareState(fixture);
 const mixed=structuredClone(fixture);
 mixed.studio.state=ctx.CSPLidarRender.normalizeState({base:{tint:{auto:true,rangeMode:'separate'}}});
 mixed.studio.remLandFloor=-86;
 mixed.studio.fitted={base:{land:[-90,150],water:[-4500,0]}};
 ctx.cspValidateShareState(mixed);
 for(const fit of [{land:null,water:null},{land:[5,2],water:[-500,0]},{land:[0,50],water:[-500,0],extra:true}]){
  const bad=structuredClone(mixed);bad.studio.fitted.base=fit;assert.throws(()=>ctx.cspValidateShareState(bad),/Invalid share link/);
 }
 for(const fit of [{land:[-90,150],water:[-4500,0],inland:[-1600,1200]},{land:null,water:null,inland:[-1600,1200]},{land:[-90,150],water:null,inland:null}]){
  const lake=structuredClone(mixed);lake.studio.fitted.base=fit;ctx.cspValidateShareState(lake);
  const roundtrip=await C.decode(await C.encode(lake));ctx.cspValidateShareState(roundtrip);assert.deepEqual(roundtrip.studio.fitted,lake.studio.fitted);
 }
 for(const fit of [{land:null,water:null,inland:null},{land:[0,10],water:null,inland:[20,-20]},{land:[0,10],water:null,inland:[0,Infinity]},{land:[0,10],water:null,inland:"lake"},{inland:[-1600,0]}]){
  const bad=structuredClone(mixed);bad.studio.fitted.base=fit;assert.throws(()=>ctx.cspValidateShareState(bad),/Invalid share link/);
 }
 const restored=await C.decode(await C.encode(mixed));ctx.cspValidateShareState(restored);
 assert.deepEqual(restored.studio.fitted,mixed.studio.fitted);
 assert.equal(restored.studio.remLandFloor,-86);
 for(const floor of [null,undefined,0,1234]){const value=structuredClone(mixed);value.studio.remLandFloor=floor;ctx.cspValidateShareState(value)}
 for(const floor of [NaN,Infinity,"12"]){const bad=structuredClone(mixed);bad.studio.remLandFloor=floor;assert.throws(()=>ctx.cspValidateShareState(bad),/Invalid share link/)}

 const invalid=[s=>s.version=9,s=>s.engineBase='https://private.example',s=>s.view.location.lat=91,s=>delete s.controls.terStyle,s=>s.controls.engineBase='private',s=>s.controls.mosaic='true',s=>s.overlays.push({id:'not-a-source',opacity:80}),s=>s.order.push({id:'bad'}),s=>s.order.push('overlay:not-a-source'),s=>s.order.push(s.order[0]),s=>s.studio.state.effects.detail=999,s=>s.studio.state.base.unknown={style:'unknown'},s=>s.studio.fitted={base:[5,2]}];
 for(const change of invalid){const value=structuredClone(fixture);change(value);assert.throws(()=>ctx.cspValidateShareState(value),/Invalid share link/);await assert.rejects(()=>ctx.cspRestoreShareState(value),/Invalid share link/)}
 const scene={id:'test',srcKey:'pc',label:'test',date:'2025-08-31',tiles:{type:'tilejson',url:'https://planetarycomputer.microsoft.com/api/data/v1/item/tilejson.json?collection=naip&item=test'}};
 ctx.cspValidateShareScene(scene);
 for(const change of [s=>delete s.tiles.url,s=>s.cloud='cloudy',s=>s.geom={type:'Polygon',coordinates:[[1,2]]}]){const invalid=structuredClone(scene);change(invalid);assert.throws(()=>ctx.cspValidateShareScene(invalid),/Invalid share link/)}
 for(const url of ['http://127.0.0.1/api/secret','https://private.example/data','https://planetarycomputer.microsoft.com/item?sig=private','https://user:secret@planetarycomputer.microsoft.com/data'])assert.throws(()=>ctx.cspValidateShareScene({...scene,tiles:{type:'xyz',url}}));
 console.log('share links: codec bits/Unicode, malformed data/versions, schema validation before mutation, private fields/URLs and native snapshot passed');
})().catch(error=>{console.error(error);process.exitCode=1});
