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
  function viewFromMap(map,painted,dpr){
    const size=map.getSize();dpr=Number(dpr)||1;
    return {centerMerc:mercator(painted?.center||map.getCenter()),zoom:painted?.zoom??map.getZoom(),
      bearing:map.getBearing?.()||0,cssSize:[size.x,size.y],dpr,dz:dpr>=1.5?1:0};
  }
  /* Crop in screen axes, then rotate the crop's centre back into Mercator.
     Rendering this view directly also handles streamed export blocks. */
  function exportView(view,spec){
    const scale=spec.scale||1,sel=spec.sel||{x:0,y:0,w:view.cssSize[0],h:view.cssSize[1]};
    const width=spec.width??Math.round(sel.w*scale),height=spec.height??Math.round(sel.h*scale);
    const dx=sel.x+width/scale/2-view.cssSize[0]/2,dy=sel.y+height/scale/2-view.cssSize[1]/2;
    const a=view.bearing*Math.PI/180,c=Math.cos(a),s=Math.sin(a),world=256*2**view.zoom;
    return {...view,centerMerc:[view.centerMerc[0]+(c*dx+s*dy)/world,view.centerMerc[1]+(-s*dx+c*dy)/world],
      cssSize:[width/scale,height/scale],dpr:scale};
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
        if(this._frame)root.cancelAnimationFrame(this._frame);this._frame=0;
        this._resizeObserver?.disconnect();this._visibilityObserver?.disconnect();
        if(this._tile)this.options.store?.off("tile",this._tile);
        this._container?.remove();this._container=null;this._painted=null;this._view=null;this._nativeZoom=false;
        /* remove/add retains resident engine textures; destroy() is final. */
      },
      getEvents:function(){return {move:this._moved,zoom:this._moved,moveend:this._moved,
        zoomend:this._moved,viewreset:this._moved,resize:this._moved,rotate:this._moved,zoomanim:this._zoomAnim};},
      _moved:function(event){
        if(event?.type==="resize")this._geometryCache=new WeakMap();
        this._painted=null;this.redraw();
        // Drag/rotate handlers already run in Leaflet's painted frame. Keep
        // the screen-sized canvas fixed to the viewport before presentation.
        if(event&&(event.type==="move"||event.type==="rotate"||event.type==="resize")&&!this._map._animatingZoom){
          if(this._frame)root.cancelAnimationFrame(this._frame);this._frame=0;this._draw();
        }
      },
      _zoomAnim:function(event){
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
        return view;
      },
      _draw:function(){
        if(!this._container||!this._engine||!this._dirty)return;
        this._dirty=false;
        if(root.document.body.classList.contains("terrain-3d"))return;
        const view=this._deriveView();this._view=view;
        this._canvas.style.width=view.cssSize[0]+"px";this._canvas.style.height=view.cssSize[1]+"px";
        const w=Math.max(1,Math.round(view.cssSize[0]*view.dpr)),h=Math.max(1,Math.round(view.cssSize[1]*view.dpr));
        if(this._canvas.width!==w)this._canvas.width=w;if(this._canvas.height!==h)this._canvas.height=h;
        this._coverage=this._engine.render(view);this.fire("render",{view,coverage:this._coverage});
        if(this._map._animatingZoom||this._nativeZoom)this.redraw();
      },
      redraw:function(){
        this._dirty=true;
        if(this._container&&!this._frame)this._frame=root.requestAnimationFrame(()=>{this._frame=0;this._draw();});
        return this;
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
      snapshotEntry:function(spec){
        if(!this._container||!this._engine)return null;
        const view=exportView(this._view||this._deriveView(),spec);
        return {kind:"gpu-terrain",el:this._container,view,
          canvas:()=>this._engine.renderToCanvas(view,spec.width,spec.height)};
      },
      destroy:function(){this.remove();this._engine?.destroy();this._engine=null;}
    });
    L.cspGpuTerrainLayer=options=>new L.CSPGpuTerrainLayer(options);
  }
  return {VERSION:"1",mercator,resolveFlag,buildState,viewFromMap,exportView,install};
});
