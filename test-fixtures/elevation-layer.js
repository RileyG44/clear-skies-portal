'use strict';
const fs=require('node:fs'),vm=require('node:vm');
const pipeline=require('../tile-pipeline');
class Grid{
  constructor(options){this.events={};this.initialize(options);}
  on(names,fn){for(const name of names.split(' '))(this.events[name]||=[]).push(fn);return this;}
  fire(name,value){for(const fn of this.events[name]||[])fn.call(this,value);}
  getTileSize(){return {x:this.options.tileSize||2,y:this.options.tileSize||2};}
  static extend(methods){class Layer extends this{}Object.assign(Layer.prototype,methods);return Layer;}
}
function elevationLayer({source=fs.readFileSync(require.resolve('../app/elevation.js'),'utf8'),pool=new pipeline.RequestPool(),fetchElevation,hidpi=false}={}){
  const context={L:{GridLayer:Grid,setOptions:(self,o)=>self.options={...o},point:(x,y)=>({x,y})},HIDPI:hidpi,
    releaseCanvas:cv=>{cv.width=cv.height=0;},document:{createElement:()=>({dataset:{},getContext:()=>({clearRect(){}})})},
    AbortController,DOMException,Float32Array,Promise,CSPTilePipeline:pipeline,ElevationTileCore:require('../elevation-tile-core'),
    CSPPublicTerrain:require('../public-terrain'),PROXY:true,RAW_COVERAGE_QUERY:'ix=3',dnrStatus:{revision:1},dnrTileAllowed:()=>true,
    api:p=>p,elevationRequests:pool,fetchElevation,fetchPublicElevation:fetchElevation};
  vm.runInNewContext(source.slice(source.indexOf('const ElevLayer ='),source.indexOf('function tileGroundResolution('))+';this.Layer=ElevLayer;',context);
  context.Layer.prototype._paint=()=>{};
  return context;
}
module.exports={elevationLayer};
