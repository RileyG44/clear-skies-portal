/* GPU analytical textures in MapLibre's own context. The raster layers still
   own terrain draping, mip filtering, occlusion and export. See the guarded
   MapLibre 6.6 adapter contract in docs/GPU_3D_TERRAIN_SPEC.md. */
(function(root,factory){
  "use strict";
  const api=factory(root);
  if(typeof module==="object"&&module.exports)module.exports=api;
  else root.CSPGpuTerrain3DLayer=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(root){
  "use strict";
  const ID="csp-gpu3d-shade";
  function resolveFlag(search,storage){
    const value=new URLSearchParams(search||"").get("gpu3d");
    if(value==="0"||value==="1")return value==="1";
    try{const saved=storage?.getItem("clearskies.gpu3d");if(saved==="0"||saved==="1")return saved==="1";}catch(_){}
    return true;
  }
  function create(options){
    const map=options.map,Renderer=options.renderer||root.CSPGpuTerrain3DRenderer;
    const Cache=options.cacheModule||root.CSPGpuTerrain3DCache;
    const gl=map?.painter?.context?.gl;
    let enabled=false,error=null,destroyed=false,lost=false,renderer=null;
    let stamps=new WeakMap(),pending=new Map(),epoch=0,frameCount=0,invalidations=0;
    let stateKeys={},stateRevisions={analysis:0,elevspec:0},stateValues=null,stateDirty=true,installed=false,installing=false;
    const budget=options.maxBytes||192*1024*1024;
    const cache=Cache?.create({loadGrid:options.loadGrid,maxBytes:budget});
    function fail(reason){
      if(!enabled&&error)return;
      enabled=false;error=String(reason?.message||reason||"3D GPU unavailable");
      try{renderer?.destroy()}catch(_){}renderer=null;
      try{cache?.clear()}catch(_){}
      pending.clear();stamps=new WeakMap();epoch++;
      options.onStatus?.(false,error);
      if(!destroyed)options.onFallback?.(error);
    }
    function supported(){
      return /^6\.6\./.test(options.version||"")&&gl&&typeof gl.texStorage2D==="function"&&
        typeof map.on==="function"&&typeof map.addLayer==="function"&&
        !!map.painter.context.setDirty&&!!Renderer&&!!cache;
    }
    function states(){
      if(!stateDirty&&stateValues)return stateValues;
      const values=options.getStates();
      for(const id of ["analysis","elevspec"]){
        const key=JSON.stringify(values[id]);
        if(stateKeys[id]!==key){stateKeys[id]=key;stateRevisions[id]++;}
      }
      stateValues=values;stateDirty=false;return values;
    }
    function startPrepare(z,x,y){
      const key=`${z}/${x}/${y}`;
      if(pending.has(key))return;
      const generation=epoch;
      const job=cache.prepare(z,x,y).then(()=>{
        if(!destroyed&&enabled&&generation===epoch)map.triggerRepaint();
      },reason=>{
        if(reason?.name!=="AbortError"&&!destroyed&&generation===epoch)fail(reason);
      }).finally(()=>{if(pending.get(key)===job)pending.delete(key);});
      pending.set(key,job);
    }
    function prerender(){
      if(!enabled||destroyed||lost||gl.isContextLost())return;
      try{
        const tm=map.style?.tileManagers,terrain=map.terrain?.tileManager;
        if(!tm)return;
        if(map.getTerrain?.()&&typeof terrain?.releaseRTT!=="function")throw new Error("MapLibre terrain texture adapter unavailable");
        const values=states(),jobs=[],updated=[];
        for(const id of ["analysis","elevspec"]){
          const layerId=id==="analysis"?"terrain-analysis":"elev-spectrum";
          if(!map.getLayer(layerId)||map.getLayoutProperty(layerId,"visibility")==="none"||map.getPaintProperty?.(layerId,"raster-opacity")===0)continue;
          const manager=tm[id];if(!manager)continue;
          if(typeof manager.getIds!=="function"||typeof manager.getTileByID!=="function")throw new Error("MapLibre raster tile adapter unavailable");
          // MapLibre's visible coordinates include the ancestor/fallback tiles
          // its raster pass actually draws. Keep offscreen cache entries cold.
          const visible=typeof manager.getVisibleCoordinates==="function"&&typeof manager.getTile==="function"
            ?manager.getVisibleCoordinates(false).map(coord=>manager.getTile(coord))
            :manager.getIds().map(key=>manager.getTileByID(key));
          for(const tile of visible){
            const coord=tile?.tileID?.canonical,texture=tile?.texture;
            if(tile?.state!=="loaded"||!coord||!texture)continue;
            if(!texture.texture||texture.size?.[0]!==256||texture.size?.[1]!==256||!texture.useMipmap)throw new Error("MapLibre raster texture contract changed");
            const record=cache.peek(coord.z,coord.x,coord.y);
            if(!record){startPrepare(coord.z,coord.x,coord.y);continue;}
            const stamp=stamps.get(tile);
            if(stamp?.handle===texture.texture&&stamp.record===record.revision&&stamp.state===stateRevisions[id])continue;
            jobs.push({key:record.key,revision:record.revision,grid:record.grid,size:256,
              targetTexture:texture.texture,state:values[id],groundRes:options.groundResolution(coord)});
            updated.push({tile,handle:texture.texture,record:record.revision,state:stateRevisions[id]});
          }
        }
        if(!jobs.length)return;
        const result=renderer.renderBatch(jobs);
        if(result.drawn!==jobs.length){if(gl.isContextLost())return;throw new Error("3D GPU shade batch did not finish");}
        const changed=new Map();let uniformChange=false;
        for(const item of updated){
          const previous=stamps.get(item.tile);
          uniformChange=uniformChange||!!previous&&previous.state!==item.state;
          stamps.set(item.tile,item);
          changed.set(item.tile.tileID.key||`${item.tile.tileID.canonical.z}/${item.tile.tileID.canonical.x}/${item.tile.tileID.canonical.y}`,item.tile.tileID);
        }
        if(uniformChange&&typeof terrain?.releaseAllRTT==="function"){terrain.releaseAllRTT();invalidations++;}
        else for(const coord of changed.values()){terrain?.releaseRTT(coord);invalidations++;}
        frameCount++;
      }catch(reason){fail(reason);}
    }
    function install(){
      if(!enabled||destroyed||installing||!map.style)return;
      if(map.getLayer(ID)){installed=true;return;}
      installing=true;
      try{map.addLayer({id:ID,type:"custom",renderingMode:"2d",prerender,render:function(){}});installed=true;}
      catch(reason){if(map.isStyleLoaded?.())fail(reason);}
      finally{installing=false;}
    }
    function contextLost(){lost=true;renderer=null;stamps=new WeakMap();}
    function sourceData(event){
      // A source reload can overwrite an existing native handle with the
      // placeholder. Handle identity alone cannot detect that upload.
      if(event.tile&&(event.sourceId==="analysis"||event.sourceId==="elevspec"))stamps.delete(event.tile);
    }
    function contextRestored(){
      if(destroyed||!enabled)return;
      try{renderer=Renderer.create({gl:map.painter.context.gl,maxBytes:budget});if(!renderer)throw new Error("3D GPU context restoration failed");
        lost=false;stamps=new WeakMap();map.triggerRepaint();}
      catch(reason){fail(reason);}
    }
    function destroy(){
      if(destroyed)return;destroyed=true;enabled=false;epoch++;
      map.off("style.load",install);map.off("styledata",install);map.off("remove",destroy);
      map.off("webglcontextlost",contextLost);map.off("webglcontextrestored",contextRestored);
      map.off("sourcedata",sourceData);
      try{renderer?.destroy()}catch(_){}renderer=null;cache?.destroy();pending.clear();
      options.onStatus?.(false,error);
    }
    const controller={
      get enabled(){return enabled&&!destroyed;},
      prepare:function(z,x,y,signal){return cache.prepare(z,x,y,{signal});},
      update:function(){if(enabled&&!destroyed){stateDirty=true;map.triggerRepaint();}},
      clear:function(){cache?.clear();renderer?.clear();pending.clear();stamps=new WeakMap();stateKeys={};epoch++;
        stateDirty=true;stateValues=null;
        if(enabled&&!destroyed)map.triggerRepaint();},
      destroy,
      stats:function(){return {enabled:enabled&&!destroyed,error,lost,installed,frames:frameCount,invalidations,
        pending:pending.size,renderer:renderer?.stats()||null,cache:cache?.stats()||null};}
    };
    try{
      if(!supported())throw new Error("MapLibre 6.6 GPU texture adapter unavailable");
      renderer=Renderer.create({gl,maxBytes:budget});if(!renderer)throw new Error("3D GPU renderer self-test unavailable");
      enabled=true;
      map.on("style.load",install);map.on("styledata",install);map.on("remove",destroy);
      map.on("webglcontextlost",contextLost);map.on("webglcontextrestored",contextRestored);
      map.on("sourcedata",sourceData);
      options.onStatus?.(true,null);install();
    }catch(reason){fail(reason);}
    return controller;
  }
  return {VERSION:"1",resolveFlag,create};
});
