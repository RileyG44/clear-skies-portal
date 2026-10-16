'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('markup.js','utf8');
const code=(name,next)=>source.slice(source.indexOf(`function ${name}(`),source.indexOf(`function ${next}(`,source.indexOf(`function ${name}(`)));
const range={};vm.runInNewContext(code('widthRangePosition','syncWidthRange'),range);
for(const min of [0,.1])for(const max of [10000,50000.125]){
  assert.equal(range.widthRangePosition(min,min,max),0);
  assert.equal(range.widthRangePosition(max,min,max),1000);
  let previous=-1;
  for(let p=0;p<=1000;p++){
    const value=range.widthRangeFeet(p,min,max);assert(value>=previous);previous=value;
    assert(Math.abs(range.widthRangePosition(value,min,max)-p)<=1,'log slider round-trip');
  }
  assert.equal(range.widthRangeFeet(1000,min,max),+max.toFixed(4));
}
const one={doc:{markup:{id:'one',name:'One',description:'Old'}}},two={doc:{markup:{id:'two',name:'Two'}}};
const changes=[];
const meta={layerDetailsDraft:{layer:one,name:'  North rim <A>  ',description:'  First line\nSecond line  '},touch:layer=>changes.push(layer),paintLayerContext(){},editing:two};
vm.runInNewContext(code('finishLayerDetails','widthRangePosition'),meta);
meta.finishLayerDetails(true,false);
assert.equal(one.doc.markup.name,'North rim <A>');assert.equal(one.doc.markup.description,'First line\nSecond line');
assert.equal(two.doc.markup.name,'Two','a draft cannot rename the next active layer');
assert.equal(changes.length,1);
meta.layerDetailsDraft={layer:one,name:'Discard',description:'Discard'};meta.finishLayerDetails(false,false);
assert.equal(one.doc.markup.name,'North rim <A>');assert.equal(changes.length,1,'cancel does not save');
meta.layerDetailsDraft={layer:one,name:' ',description:'x'.repeat(1500)};meta.finishLayerDetails(true,false);
assert.equal(one.doc.markup.name,'North rim <A>','an empty name preserves the current name');assert.equal(one.doc.markup.description.length,1000);

let selected={properties:{width:3}},undos=0,saves=0,rendered=0;
const env={editing:one,groundEdit:null,selectedFeature:()=>selected,pushUndo(){undos++},touch(){saves++},drawFrame(){},
  renderFeature(){rendered++},styles:{ink:{},highlight:{},text:{}},currentStyle:()=>({family:'line'}),here:()=>2,saveStyles(){},tool:'pen'};
vm.runInNewContext(code('finishGroundEdit','selectedFeature'),env);
// The slice also contains style helpers; their initialisation is intentionally
// uneventful. Only the ground-size functions are exercised here.
for(const value of [1.25,8,20])env.applyGroundValue('width',value,false);
assert.equal(undos,1,'a complete width drag makes one undo step');assert.equal(saves,0,'persist when the drag ends');
env.applyGroundValue('width',20,true);assert.equal(saves,1);assert.equal(selected.properties.width,20*.3048);assert(rendered>=3);
selected=null;env.applyGroundValue('width',1.25,true);
assert.equal(env.styles.ink.groundWidth,1.25*.3048,'new marks retain exact feet as metres');
assert.equal(env.styles.ink.width,1.25*.3048/2);
console.log('markup controls passed (metadata drafts, layer isolation, logarithmic feet slider, exact units and one-step undo)');
