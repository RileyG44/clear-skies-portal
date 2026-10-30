/* One screen-space canvas in the tile stack. See GPU_2D_TERRAIN_SPEC §4.4. */
(function(root,factory){
  "use strict";
  const api=factory(root);
  if(typeof module==="object"&&module.exports)module.exports=api;
  else root.CSPGpuTerrainLayer=api;
  if(root.L)api.install(root.L);
})(typeof globalThis!=="undefined"?globalThis:this,function(root){
  "use strict";
  function mercator(ll){
    const lat=Math.max(-85.0511287798,Math.min(85.0511287798,+ll.lat))*Math.PI/180;
    return [(+ll.lng+180)/360,(1-Math.asinh(Math.tan(lat))/Math.PI)/2];
  }
  function resolveFlag(search,storage){
    const value=new URLSearchParams(search||"").get("gpu2d");
    if(value==="0"||value==="1")return value==="1";
    try{const saved=storage?.getItem("clearskies.gpu2d");if(saved==="0"||saved==="1")return saved==="1";}catch(_){}
    return true;
  }
  function buildState(settings){
    return {terrain:{style:settings.style||"off",opacity:settings.opacity??1,
      look:{...settings.look},lighting:{...settings.lighting}},
      spectrum:settings.spectrum,spectrumOpacity:settings.spectrumOpacity??1};
  }
  /* Elevation level above the on-screen zoom: the one whose samples land on
     physical pixels, 0.7 to 1.4 per pixel at every zoom. A fixed +1 left a 3x
     screen with as few as 0.47, a soft picture nothing could ever refine. */
  function levelOffset(zoom,dpr){return dpr>=1.5?Math.round(zoom+Math.log2(dpr))-Math.round(zoom):0;}
  function viewFromMap(map,painted,dpr){
    const size=map.getSize(),zoom=painted?.zoom??map.getZoom();dpr=Number(dpr)||1;
    return {centerMerc:mercator(painted?.center||map.getCenter()),zoom,
      bearing:map.getBearing?.()||0,cssSize:[size.x,size.y],dpr,dz:levelOffset(zoom,dpr)};
  }
  /* Crop in screen axes, then rotate the crop's centre back into Mercator.
     Rendering this view directly also handles streamed export blocks. */
  function exportView(view,spec){
    const scale=spec.scale||1,sel=spec.sel||{x:0,y:0,w:view.cssSize[0],h:view.cssSize[1]};
    const width=spec.width??Math.round(sel.w*scale),height=spec.height??Math.round(sel.h*scale);
    const dx=sel.x+width/scale/2-view.cssSize[0]/2,dy=sel.y+height/scale/2-view.cssSize[1]/2;
    const a=view.bearing*Math.PI/180,c=Math.cos(a),s=Math.sin(a),world=256*2**view.zoom;
    return {...view,centerMerc:[view.centerMerc[0]+(c*dx+s*dy)/world,view.centerMerc[1]+(-s*dx+c*dy)/world],
      cssSize:[width/scale,height/scale],dpr:scale,liveDpr:view.dpr};
  }
  /* "Smoother panning" (CR-008): off (default), auto or on. Anything else
     stored, or no storage, is off. */
  const PAN_SHADING_KEY="clearskies.panShading.v1";
  function panShadingMode(storage){
    try{const value=storage?.getItem(PAN_SHADING_KEY);return value==="on"||value==="auto"?value:"off";}catch{return "off";}
  }
  /* One user drag, from its first dragging move through inertia to moveend,
     may shade on the CSS grid. "on" does so at once. "auto" does once 3 of
     the last 8 presented drag frames took over 24 ms, and starts the next
     drag that way while the terrain state, zoom level, viewport and DPR are
     unchanged (in memory only). A zoom, rotation or resize ends the drag
     path until moveend; every settled frame is full resolution. */
  const AUTO_SLOW_MS=24,AUTO_WINDOW=8,AUTO_SLOW_FRAMES=3;
  class PanShading{
    constructor(mode){this.mode="off";this.dragging=false;this.coarse=false;this.blocked=false;this.key="";this.remembered="";this.intervals=[];this.setMode(mode);}
    setMode(mode){
      mode=mode==="on"||mode==="auto"?mode:"off";const was=this.coarse;
      this.mode=mode;this.remembered="";this.intervals.length=0;
      this.coarse=this.dragging&&mode==="on";return was!==this.coarse;
    }
    begin(key){
      if(this.mode==="off"||this.blocked||this.dragging)return false;
      this.dragging=true;this.key=key;this.intervals.length=0;
      if(this.remembered!==key)this.remembered="";
      this.coarse=this.mode==="on"||(this.mode==="auto"&&this.remembered===key);return this.coarse;
    }
    /* Presented frame interval while dragging; true when it switches path. */
    frame(ms){
      if(!this.dragging||this.mode!=="auto"||this.coarse||!(ms>0))return false;
      this.intervals.push(ms);if(this.intervals.length>AUTO_WINDOW)this.intervals.shift();
      if(this.intervals.filter(value=>value>AUTO_SLOW_MS).length<AUTO_SLOW_FRAMES)return false;
      this.coarse=true;this.remembered=this.key;return true;
    }
    get sampling(){return this.dragging&&this.mode==="auto"&&!this.coarse;}
    /* moveend releases a block; zoom, rotate and resize set one. */
    end(block){const was=this.coarse;this.dragging=false;this.coarse=false;this.intervals.length=0;this.blocked=!!block;return was;}
  }
  function install(L){
    if(L.CSPGpuTerrainLayer)return;
    L.CSPGpuTerrainLayer=L.Layer.extend({
      options:{zIndex:440,pane:"tilePane"},
      initialize:function(options){
        L.setOptions(this,options);this._state=this.options.state;this._stateKey=JSON.stringify(this._state);this._dirty=true;
        this._canvas=root.document.createElement("canvas");this._canvas.className="csp-gpu-terrain";
        this._canvas.style.cssText="display:block;pointer-events:none;transform:none;transition:none";
        const engine=this.options.engine||root.CSPGpuTerrainEngine;
        try{this._engine=engine?.create({canvas:this._canvas,store:this.options.store,
          shaders:root.CSPGpuTerrainShaders,maxTextureBytes:this.options.maxTextureBytes,
          onNeedsFrame:()=>this.redraw()})||null;}catch(error){this._creationError=error;this._engine=null;}
        if(this._engine&&this._state)this._engine.setState(this._state);
        this._pan=new PanShading(this.options.panShading);
      },
      onAdd:function(map){
        this._map=map;this._geometryCache=new WeakMap();
        if(!this._engine)return;
        /* Keeping the container IN tilePane preserves stacking against every
           raster and overlay. Its inverse ancestor matrix makes it a genuinely
           non-rotating, unscaled screen-space container even during pane paint.
           The canvas itself has no CSS transform, transition or zoom class. */
        this._container=L.DomUtil.create("div","csp-gpu-terrain-container",map.getPane(this.options.pane));
        this._container.style.cssText="position:absolute;left:0;top:0;transform-origin:0 0;pointer-events:none;transition:none";
        this._container.style.zIndex=this.options.zIndex;this._container.appendChild(this._canvas);
        this._tile=()=>{this.redraw();this.fire("tilerefine");};this.options.store?.on("tile",this._tile);
        this._resizeObserver=new root.ResizeObserver(()=>{this._geometryCache=new WeakMap();this.redraw();});this._resizeObserver.observe(map.getContainer());
        this._hidden=root.document.body.classList.contains("terrain-3d");
        this._visibilityObserver=new root.MutationObserver(()=>{
          const hidden=root.document.body.classList.contains("terrain-3d");
          if(hidden!==this._hidden){this._hidden=hidden;this.redraw();}
        });
        this._visibilityObserver.observe(root.document.body,{attributes:true,attributeFilter:["class"]});
        this.redraw();
      },
      onRemove:function(){
        this._panStop(false);this._engine?.releaseGestureTargets?.();
        if(this._frame)root.cancelAnimationFrame(this._frame);this._frame=0;
        this._resizeObserver?.disconnect();this._visibilityObserver?.disconnect();
        if(this._tile)this.options.store?.off("tile",this._tile);
        this._container?.remove();this._container=null;this._painted=null;this._view=null;this._nativeZoom=false;
        /* remove/add retains resident engine textures; destroy() is final. */
      },
      getEvents:function(){return {move:this._moved,zoom:this._moved,moveend:this._moved,
        zoomend:this._moved,viewreset:this._moved,resize:this._moved,rotate:this._moved,zoomanim:this._zoomAnim,zoomstart:this._zoomStart};},
      _zoomStart:function(){this._panStop(true);},
      _panKey:function(){
        const map=this._map,size=map.getSize();
        return [this._stateKey,Math.round(map.getZoom()),size.x,size.y,root.devicePixelRatio].join("|");
      },
      /* The drag latch and auto's frame sampler. Off, and screens already
         near CSS resolution (the engine's DPR 1.5 rule), never begin. */
      _panTrack:function(event){
        const type=event?.type,map=this._map,pan=this._pan;
        if(type==="move"){
          if(pan.mode!=="off"&&!pan.dragging&&root.devicePixelRatio>=1.5&&map.dragging?.moving?.()&&!map._animatingZoom&&!map._cspPaneZoom)
            pan.begin(this._panKey());
          if(pan.sampling&&!this._panSampler)this._panSample();
        }else if(type==="moveend")this._panStop(false);
        else if(type==="zoom"||type==="zoomend"||type==="viewreset"||type==="resize"||type==="rotate")this._panStop(true);
      },
      _panSample:function(){
        let last=0;
        const tick=time=>{
          this._panSampler=0;if(!this._pan.sampling)return;
          if(last&&this._pan.frame(time-last)){this.redraw();return;}
          last=time;this._panSampler=root.requestAnimationFrame(tick);
        };
        this._panSampler=root.requestAnimationFrame(tick);
      },
      _panStop:function(block){
        if(this._panSampler)root.cancelAnimationFrame(this._panSampler);this._panSampler=0;
        if(this._pan.end(block))this.redraw();
      },
      setPanShading:function(mode){
        if(this._pan.setMode(mode))this.redraw();
        if(this._pan.mode==="off")this._engine?.releaseGestureTargets?.();
        return this;
      },
      panShading:function(){const p=this._pan;return {mode:p.mode,dragging:p.dragging,coarse:p.coarse};},
      _moved:function(event){
        if(event?.type==="resize")this._geometryCache=new WeakMap();
        this._panTrack(event);
        this._painted=null;this.redraw();
        // Drag/rotate handlers already run in Leaflet's painted frame. Keep
        // the screen-sized canvas fixed to the viewport before presentation.
        // A two-finger frame rotates and then paints its pinch/pan. Let that
        // paint consume the pending rotation, instead of shading it twice.
        if(event?.type==="rotate"&&!this._rotationQueued){
          this._rotationQueued=true;
          root.queueMicrotask(()=>{this._rotationQueued=false;if(!this._dirty||!this._container)return;
            if(this._frame)root.cancelAnimationFrame(this._frame);this._frame=0;this._draw();});
        }
        if(event&&(event.type==="move"||event.type==="resize")&&!this._map._animatingZoom){
          if(this._frame)root.cancelAnimationFrame(this._frame);this._frame=0;this._draw();
        }
      },
      _zoomAnim:function(event){
        this._panStop(true);
        this._painted={center:event.center,zoom:event.zoom};this._dirty=true;
        this._nativeZoom=!event.noUpdate&&!this._map._cspPaneZoom;
        if(event.noUpdate){
          /* The app fires this inside its painted animation frame. Flush here,
             before presentation; a second rAF would lag the basemap by a frame. */
          if(this._frame)root.cancelAnimationFrame(this._frame);this._frame=0;this._draw();
        }else this.redraw();
      },
      _cspTransformHold:function(center,zoom){this._painted={center,zoom};this._dirty=true;this._draw();},
      _matrix:function(el,interpolated){
        let matrix=new root.DOMMatrix();
        while(el&&el!==this._map.getContainer()){
          // Pane layout is static between resizes; reading offsets/computed
          // styles after every transform write forces WebKit to flush layout.
          // Cache only layout geometry. Current inline transforms are always
          // read, and native CSS interpolation still samples computed style.
          let geometry=this._geometryCache.get(el),cs;
          if(!geometry||geometry.left!==el.style.left||geometry.top!==el.style.top||geometry.className!==el.className){
            cs=root.getComputedStyle(el);
            geometry={left:el.style.left,top:el.style.top,className:el.className,
              x:el.offsetLeft||0,y:el.offsetTop||0,origin:cs.transformOrigin,transform:cs.transform};
            this._geometryCache.set(el,geometry);
          }
          const origin=(el.style.transformOrigin||geometry.origin).split(" ").map(parseFloat);
          let local=new root.DOMMatrix().translate(geometry.x,geometry.y);
          // Inline transforms are the pane painter's current frame. Browsers can
          // return the previous composited transform from getComputedStyle in
          // the same rAF; only native CSS tile transitions need interpolation.
          const transform=interpolated?(cs||root.getComputedStyle(el)).transform:(el.style.transform||geometry.transform);
          if(transform&&transform!=="none")local=local.translate(origin[0]||0,origin[1]||0)
            .multiply(new root.DOMMatrix(transform)).translate(-origin[0]||0,-origin[1]||0);
          matrix=local.multiply(matrix);el=el.parentElement;
        }
        return matrix;
      },
      _deriveView:function(){
        const map=this._map,view=viewFromMap(map,this._painted,root.devicePixelRatio);
        const parentMatrix=this._matrix(this._container.parentElement),inverse=parentMatrix.inverse();
        this._container.style.transform=inverse.toString();
        let point=inverse.transformPoint({x:view.cssSize[0]/2,y:view.cssSize[1]/2});
        let origin=map.getPixelOrigin(),zoom=map.getZoom();
        if((map._animatingZoom||this._nativeZoom)&&!map._cspPaneZoom){
          /* Native Leaflet zooms interpolate a tile-level CSS transition. Read
             its painted matrix, rather than jumping to zoomanim's target.
             Leaflet's zoom-end timer can precede the CSS transition's final
             frame. Keep sampling that transition until it really finishes. */
          let transitioning=false;
          map.eachLayer(layer=>{
            if(!origin||!(layer instanceof L.GridLayer))return;
            const level=layer._levels?.[layer._tileZoom];if(!level?.el)return;
            const matrix=this._matrix(level.el,true),scale=Math.hypot(matrix.a,matrix.b);
            if(!(scale>0))return;
            transitioning=transitioning||!!level.el.getAnimations?.().some(animation=>
              animation.playState==="running"&&/transform$/.test(animation.transitionProperty||""));
            point=matrix.inverse().transformPoint({x:view.cssSize[0]/2,y:view.cssSize[1]/2});
            origin=level.origin;zoom=+layer._tileZoom;view.zoom=zoom+Math.log2(scale);
          });
          this._nativeZoom=!!map._animatingZoom||transitioning;
        }
        const world=256*2**zoom;
        view.centerMerc=[(origin.x+point.x)/world,(origin.y+point.y)/world];
        view.dz=levelOffset(view.zoom,view.dpr);
        return view;
      },
      _draw:function(){
        if(!this._container||!this._engine||!this._dirty||this._map?._cspCameraFrame)return;
        this._dirty=false;
        if(root.document.body.classList.contains("terrain-3d"))return;
        const view=this._deriveView();this._view=view;
        this._canvas.style.width=view.cssSize[0]+"px";this._canvas.style.height=view.cssSize[1]+"px";
        const w=Math.max(1,Math.round(view.cssSize[0]*view.dpr)),h=Math.max(1,Math.round(view.cssSize[1]*view.dpr));
        if(this._canvas.width!==w)this._canvas.width=w;if(this._canvas.height!==h)this._canvas.height=h;
        this._coverage=this._engine.render(view,this._pan.coarse?COARSE:undefined);this.fire("render",{view,coverage:this._coverage});
        if(this._map._animatingZoom||this._nativeZoom)this.redraw();
      },
      redraw:function(){
        this._dirty=true;
        if(this._container&&!this._frame)this._frame=root.requestAnimationFrame(()=>{this._frame=0;this._draw();});
        return this;
      },
      _cspFlushViewFrame:function(){
        if(!this._dirty||!this._container)return;
        if(this._frame)root.cancelAnimationFrame(this._frame);this._frame=0;this._draw();
      },
      setState:function(state){
        const key=JSON.stringify(state);if(key===this._stateKey)return this;
        this._stateKey=key;this._state=state;this._engine?.setState(state);return this.redraw();
      },
      setZIndex:function(z){this.options.zIndex=z;if(this._container)this._container.style.zIndex=z;return this;},
      getContainer:function(){return this._container;},
      getEngine:function(){return this._engine;},getStore:function(){return this.options.store;},
      sampleAt:function(ll){return this.options.store.sampleAt(ll.lng,ll.lat);},
      gridForView:function(){
        const grid=this.options.store.gridForView({bounds:this._map.getBounds(),zoom:this._map.getZoom(),maxSide:640});
        return grid&&Array.isArray(grid.bounds)?{...grid,bounds:L.latLngBounds(grid.bounds)}:grid;
      },
      _tilesNeeded:function(){return this._map?this._engine.neededTiles(this._view||this._deriveView()):[];},
      settled:function(){return this.options.store.settled(this._tilesNeeded());},
      provenance:function(){return this.options.store.provenance(this._tilesNeeded());},
      /* canvas() renders the whole export; canvas(region) one block of it.
         Blocks of one entry share the engine's export-wide derived fields
         (relative-elevation base, detail blur), so a block export has no
         seams; release() frees them once the last block is drawn. An export
         finer than the view fetches its own elevation (options.onTile counts
         it, options.signal cancels it). */
      snapshotEntry:function(spec,options){
        if(!this._container||!this._engine)return null;
        const current=this._view||this._deriveView(),base={...current,centerMerc:[...current.centerMerc],cssSize:[...current.cssSize]};
        const view=exportView(base,spec),engine=this._engine;
        let snapshot=null;
        const dispose=()=>{snapshot?.release();snapshot=null;};
        return {kind:"gpu-terrain",el:this._container,view,
          canvas:region=>{
            if(!snapshot)snapshot=engine.createSnapshot(base);
            return engine.renderToCanvas(view,spec.width,spec.height,region,{...options,snapshot});
          },dispose,release:dispose};
      },
      /* {z, live, tiles} for an export spec: its elevation level, the view's,
         and the elevation tiles it would fetch beyond what is on screen. */
      exportDetail:function(spec){
        if(!this._container||!this._engine?.exportDetail)return null;
        return this._engine.exportDetail(exportView(this._view||this._deriveView(),spec),spec.width??Math.round(spec.sel.w*spec.scale));
      },
      destroy:function(){this.remove();this._engine?.destroy();this._engine=null;}
    });
    L.cspGpuTerrainLayer=options=>new L.CSPGpuTerrainLayer(options);
  }
  const COARSE=Object.freeze({coarse:true});
  return {VERSION:"1",mercator,resolveFlag,buildState,levelOffset,viewFromMap,exportView,install,PAN_SHADING_KEY,panShadingMode,PanShading};
});
