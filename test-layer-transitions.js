'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(require.resolve('./index.html'),'utf8');
class Canvas{}
class Layer{
  constructor(content=true){this.options={opacity:.7};this.opacity=.7;this.handlers=new Map();this._tiles={a:{loaded:1,current:true,el:Object.assign(new Canvas(),{_cspHasContent:content})}};}
  on(event,fn){this.handlers.set(event,fn);return this;}
  off(event){this.handlers.delete(event);return this;}
  emit(event){this.handlers.get(event)?.();}
  addTo(map){map.layers.add(this);this.opacityAtAdd=this.opacity;return this;}
  setOpacity(value){this.opacity=value;return this;}
}
async function main(){
  const map={layers:new Set(),hasLayer(layer){return this.layers.has(layer);},removeLayer(layer){this.layers.delete(layer);}};
  const timers=new Map();let timerId=0;
  const context={map,HTMLCanvasElement:Canvas,setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id),
    terrainSwap:null,terrainSwapMessage:'',terBase:null,terLayer:null,terSig:null,
    terrainLoadStatus:{dataset:{}},scheduleTerrainStatus:()=>{},applyTerrainAppearanceTo:()=>{},$:()=>({value:'70'}),
    mosToken:1,PENDING_NEIGH:new Set()};
  const install=html.slice(html.indexOf('function installTerrain('),html.indexOf('\nlet terSig=',html.indexOf('function installTerrain(')));
  const wait=html.slice(html.indexOf('function waitForLayerTiles('),html.indexOf('\nasync function pooled(',html.indexOf('function waitForLayerTiles(')));
  vm.runInNewContext(install+'\n'+wait,context);
  const old=new Layer(),next=new Layer(false);context.terLayer=old;map.layers.add(old);
  context.installTerrain(null,next);
  assert.equal(next.opacityAtAdd,0,'new terrain is staged invisibly');
  next.emit('load');assert.equal(map.hasLayer(old),true,'empty response cannot remove good terrain');
  next._tiles.a.el._cspHasContent=true;next.emit('load');
  assert.equal(map.hasLayer(old),false);assert.equal(next.opacity,.7);
  const failed=new Layer(false);context.installTerrain(null,failed);context.terrainSwap(false);
  assert.equal(context.terLayer,next,'failed replacement restores the working layer');
  assert.equal(map.hasLayer(failed),false);assert.equal(next.opacity,.7);
  const candidate=new Layer();const ready=context.waitForLayerTiles(candidate,1);
  assert.equal(candidate.opacityAtAdd,0,'mosaic candidate must never flash during validation');
  candidate.emit('tileload');candidate.emit('load');
  assert.equal((await ready).ready,true);assert.equal(candidate.opacity,0,'validation alone must not commit a mosaic layer');
  const partial=new Layer();partial._tiles.b={};const incomplete=context.waitForLayerTiles(partial,1);
  partial.emit('tileload');partial.emit('tileerror');partial.emit('load');assert.equal((await incomplete).ready,false);
  console.log('layer transition checks passed (staging, content readiness, rollback, incomplete mosaics)');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
