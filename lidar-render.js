/* Clear Skies Portal — LiDAR Studio model.
 *
 * Palettes, layer styles, blend modes and whole-scene "looks" for the LiDAR
 * terrain renderer, plus the pure functions that turn a saved studio state
 * into the layer stack the GPU shader draws (gpu-terrain-shaders.js,
 * terrain.stack). No DOM, no WebGL: everything here is regression-tested in
 * test-lidar-render.js and shared by the 2D map, 3D drape and exports.
 *
 * Elevation-like values are metres. Positions inside a palette are 0..1 and
 * are mapped onto each layer's value range. A layer whose palette is the
 * style's "default" palette reproduces the legacy look exactly, and a scene
 * made only of an untouched base layer returns no stack at all, so the
 * legacy shader path (and its CPU parity) is untouched until someone styles
 * the terrain. */
(function(root,factory){
  "use strict";
  if(typeof module==="object"&&module.exports) module.exports=factory(require("./terrain-raster.js"));
  else root.CSPLidarRender=factory(root.CSPTerrainRaster);
})(typeof globalThis!=="undefined"?globalThis:this,function(raster){
  "use strict";
  if(!raster) throw new Error("terrain-raster.js must load before lidar-render.js");

  const VERSION=1,MAX_LAYERS=4,MAX_STOPS=10,FT=3.28084;
  const hasOwn=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
  const clamp=(value,low,high)=>Math.min(high,Math.max(low,value));
  const finite=(value,fallback)=>{const n=Number(value);return Number.isFinite(n)?n:fallback};

  /* ---------------------------------------------------------------- color */
  function parseHex(value){
    const match=/^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(String(value||"").trim());
    if(!match) return null;
    const n=parseInt(match[1],16);
    return [(n>>16&255)/255,(n>>8&255)/255,(n&255)/255,match[2]?parseInt(match[2],16)/255:1];
  }
  function toHex(rgba){
    const byte=v=>Math.round(clamp(v,0,1)*255).toString(16).padStart(2,"0");
    return "#"+byte(rgba[0])+byte(rgba[1])+byte(rgba[2])+(rgba[3]!==undefined&&rgba[3]<1?byte(rgba[3]):"");
  }
  const validHex=value=>!!parseHex(value);

  /* Stops are [position 0..1, "#rrggbb[aa]"]. A bare list of colors is
     spaced evenly. */
  function evenStops(colors){
    return colors.map((color,index)=>[colors.length===1?0:index/(colors.length-1),color]);
  }
  function normalizeStops(stops){
    if(!Array.isArray(stops)) return null;
    const list=stops.every(stop=>typeof stop==="string")?evenStops(stops):stops;
    const out=list.filter(stop=>Array.isArray(stop)&&stop.length>=2&&Number.isFinite(+stop[0])&&validHex(stop[1]))
      .map(stop=>[clamp(+stop[0],0,1),"#"+String(stop[1]).replace(/^#/,"").toLowerCase()])
      .sort((a,b)=>a[0]-b[0]).slice(0,MAX_STOPS);
    return out.length>=2?out:null;
  }
  // Keep the selected color's identity when it crosses another stop.
  function moveStop(stops,index,position){
    const list=stops.map(stop=>stop.slice()),moved=list[index];
    if(!moved)return {stops:list,index};
    moved[0]=clamp(position,0,1);list.sort((a,b)=>a[0]-b[0]);
    return {stops:list,index:list.indexOf(moved)};
  }

  /* --------------------------------------------------------------- palettes
     kinds: which layer families list the palette first. "shade" palettes
     map hillshade darkness to color; "cyclic" ones wrap for aspect. */
  const RELIEF_TINT=[[-500,"#162e48"],[0,"#28465f"],[300,"#466e46"],[900,"#808c5c"],[1600,"#a08c6c"],
    [2400,"#beb4aa"],[3200,"#f5f6fa"],[6000,"#ffffff"]];
  const PALETTES={
    "default-hs":{name:"Classic",kinds:["shade"],stops:[[0,"#000000"],[1,"#ffffff"]],domain:[0,1]},
    "default-slope":{name:"Classic",kinds:["sequential"],domain:[0,90],
      stops:raster.SLOPE_STOPS.map(([degrees,color])=>[degrees/90,color])},
    "default-aspect":{name:"Compass",kinds:["cyclic"],domain:[0,360],
      stops:evenStops(raster.ASPECT_STOPS.map(([,color])=>color))},
    "default-northness":{name:"Classic",kinds:["diverging"],domain:[-1,1],stops:[[0,"#d6524e"],[.5,"#f7f3e0"],[1,"#37895c"]]},
    "default-tint":{name:"Classic relief",kinds:["sequential"],domain:[-500,6000],shade:1,
      stops:RELIEF_TINT.map(([m,c])=>[(m+500)/6500,c])},
    "default-contour":{name:"Classic",kinds:["lines"],domain:[0,1],stops:[[0,"#966e50c8"],[1,"#784628"]]},

    /* Inspired by Washington Geological Survey river art: the channel glows
       white-gold and rises through orange and magenta into deep blue. */
    lava:{name:"Lava river",kinds:["sequential","art"],
      stops:[[0,"#fffbe8"],[.07,"#ffe680"],[.18,"#ffab3d"],[.32,"#f4643a"],[.48,"#d43f7e"],[.64,"#8a34c9"],[.82,"#3b33d6"],[1,"#2229b4"]]},
    ember:{name:"Ember",kinds:["sequential","art"],stops:["#2a0810","#6f1220","#b8301c","#e8641c","#ff9a4a","#ffd2a6","#fbf2ea"]},
    glacier:{name:"Glacier",kinds:["sequential","art"],stops:["#0a1519","#183238","#285c64","#3f9599","#73cfc9","#c9f7f1"]},
    aurora:{name:"Aurora",kinds:["sequential","art"],stops:["#04071a","#1b1464","#0b6e8c","#18c29c","#b6f36b","#fff9c4"]},
    neon:{name:"Neon",kinds:["sequential","art"],stops:["#0b0221","#3a0ca3","#7209b7","#f72585","#ff9e00","#ffe66d"]},
    magma:{name:"Magma",kinds:["sequential"],stops:["#000004","#1c1044","#4f127b","#812581","#b5367a","#e55064","#fb8761","#fec287","#fcfdbf"]},
    plasma:{name:"Plasma",kinds:["sequential"],stops:["#0d0887","#4c02a1","#7e03a8","#a92395","#cc4778","#e66c5c","#f89540","#fdc527","#f0f921"]},
    viridis:{name:"Viridis",kinds:["sequential"],stops:["#440154","#472d7b","#3b528b","#2c728e","#21918c","#28ae80","#5ec962","#addc30","#fde725"]},
    turbo:{name:"Turbo",kinds:["sequential"],stops:["#30123b","#4662d7","#36aaf9","#1ae4b6","#72fe5e","#c8ef34","#faba39","#f66b19","#ca2a04","#7a0403"]},
    hypsometric:{name:"Hypsometric",kinds:["sequential"],stops:["#4f7d4a","#93b46a","#dcd896","#d7b37a","#a8794e","#8a6a58","#f3f1ee"]},
    desert:{name:"Desert",kinds:["sequential"],stops:["#3b2a1e","#7d4f33","#c48650","#e9be7e","#f7e3b8","#fffaf0"]},
    forest:{name:"Forest",kinds:["sequential"],stops:["#0e2419","#24563a","#4f8a4b","#9cc27a","#e6efc0"]},
    ocean:{name:"Ocean",kinds:["sequential"],stops:["#03045e","#023e8a","#0077b6","#00b4d8","#90e0ef","#e6fbff"]},
    arctic:{name:"Arctic",kinds:["sequential","shade"],stops:["#0b1d3a","#355c8c","#8fb3d9","#e8f1fa","#ffffff"]},
    sepia:{name:"Sepia",kinds:["sequential","shade"],stops:["#22170e","#6b4c30","#b8956a","#e8d6b6","#fdf7ec"]},
    blueprint:{name:"Blueprint",kinds:["shade","sequential"],stops:["#06204a","#123d7a","#3d74c2","#a8cdfa","#f4f9ff"]},
    swiss:{name:"Swiss",kinds:["shade"],stops:["#3a3550","#7c7590","#c9c0bd","#efe7d6","#fffbf2"]},
    moonlight:{name:"Moonlight",kinds:["shade"],stops:["#04060c","#151d31","#3c4c70","#9cadd2","#e9f0ff"]},
    copper:{name:"Copper",kinds:["shade","sequential"],stops:["#1a0e08","#5a2f1a","#a8613a","#e3a571","#fff0dc"]},
    ink:{name:"Ink",kinds:["shade"],stops:[[0,"#1c1430"],[.6,"#d9d6e4"],[1,"#ffffff"]]},
    "glacier-shade":{name:"Ice shade",kinds:["shade"],stops:["#04080a","#101c20","#283f44","#5f8589","#c4e4e4"]},
    "ice-glow":{name:"Ice glow",kinds:["sequential","art"],stops:[[0,"#1e8f9400"],[.3,"#1e8f9400"],[.55,"#2fa9ab55"],[.78,"#6cd8d2a8"],[1,"#d8faf6c0"]]},
    "hue-wheel":{name:"Hue wheel",kinds:["cyclic"],stops:evenStops(["#ff4d4d","#ffb24d","#e8ff4d","#4dff88","#4dd2ff","#6b4dff","#ff4dd8","#ff4d4d"])},
    "pastel-wheel":{name:"Pastel wheel",kinds:["cyclic"],stops:evenStops(["#f8b5b5","#f8dcb0","#e9f5b3","#b8f0cc","#b3dff5","#c9b8f5","#f2b8e6","#f8b5b5"])},
    "cool-warm":{name:"Cool–warm",kinds:["diverging"],stops:["#3b4cc0","#8db0fe","#f2f2f2","#f49a7b","#b40426"]},
    "spectral":{name:"Spectral",kinds:["diverging","sequential"],stops:["#9e0142","#f46d43","#fee08b","#e6f598","#66c2a5","#5e4fa2"]},
    "ink-lines":{name:"Ink",kinds:["lines"],stops:[[0,"#1d1d1f99"],[1,"#1d1d1f"]]},
    "white-lines":{name:"White",kinds:["lines"],stops:[[0,"#ffffffa0"],[1,"#ffffff"]]},
    "gold-lines":{name:"Gold",kinds:["lines"],stops:[[0,"#ffd27a99"],[1,"#ffb627"]]}
  };
  Object.values(PALETTES).forEach(palette=>{palette.stops=normalizeStops(palette.stops)});

  /* ----------------------------------------------------------------- styles
     family drives which palettes, units and controls a layer offers.
     auto: the value range can follow the view. */
  const STYLES={
    hs:{label:"Hillshade",family:"shade",palette:"default-hs",unit:"shade",domain:[0,1]},
    hsmulti:{label:"Multi-directional hillshade",family:"shade",palette:"default-hs",unit:"shade",domain:[0,1]},
    tint:{label:"Elevation",family:"sequential",palette:"default-tint",unit:"m",domain:[-500,6000],auto:true,param:"shade"},
    rem:{label:"Relative elevation",family:"sequential",palette:"lava",unit:"m",domain:[0,60],auto:true,param:"shade",
      hint:"Height above the lowest nearby ground. Rivers and valley floors glow."},
    slope:{label:"Slope",family:"sequential",palette:"default-slope",unit:"deg",domain:[0,90]},
    aspect:{label:"Aspect",family:"cyclic",palette:"default-aspect",unit:"deg",domain:[0,360]},
    northness:{label:"North–south exposure",family:"diverging",palette:"default-northness",unit:"index",domain:[-1,1]},
    c2:{label:"Contours · 2 ft",family:"lines",palette:"default-contour",unit:"line",domain:[0,1]},
    c5:{label:"Contours · 5 ft",family:"lines",palette:"default-contour",unit:"line",domain:[0,1]},
    c10:{label:"Contours · 10 ft",family:"lines",palette:"default-contour",unit:"line",domain:[0,1]},
    c25:{label:"Contours · 25 ft",family:"lines",palette:"default-contour",unit:"line",domain:[0,1]},
    contour:{label:"Contours · custom",family:"lines",palette:"default-contour",unit:"line",domain:[0,1],param:"interval",paramDefault:20}
  };
  /* Overlay choices, in menu order. Registered analysis styles append. */
  const OVERLAY_STYLES=["hs","hsmulti","tint","rem","slope","aspect","northness","contour"];

  /* Analysis layers from elsewhere in the app join the studio here, after
     registering their GLSL with CSPGpuTerrainShaders.registerStyle. */
  function registerStyle(spec){
    const id=String(spec&&spec.id||"");
    if(!/^[a-z][a-z0-9_-]*$/i.test(id)) throw new TypeError("style id must be an identifier");
    const family=["shade","sequential","cyclic","diverging","lines"].includes(spec.family)?spec.family:"sequential";
    const domain=Array.isArray(spec.domain)&&spec.domain.length===2&&spec.domain.every(Number.isFinite)?spec.domain.slice():[0,1];
    let palette=spec.palette;
    if(palette&&typeof palette==="object"){
      const stops=normalizeStops(palette.stops||palette);
      if(!stops) throw new TypeError("palette needs at least two stops");
      PALETTES["style-"+id]={name:palette.name||"Default",kinds:[family],stops,domain};palette="style-"+id;
    }
    if(!hasOwn(PALETTES,palette)) palette=family==="cyclic"?"hue-wheel":family==="diverging"?"cool-warm":"viridis";
    STYLES[id]={label:String(spec.label||id),family,palette,unit:spec.unit||"value",domain,auto:!!spec.auto,
      hint:spec.hint?String(spec.hint):"",registered:true};
    if(!OVERLAY_STYLES.includes(id)) OVERLAY_STYLES.push(id);
    return STYLES[id];
  }

  const BLENDS=Object.freeze([
    {id:"normal",label:"Normal"},{id:"multiply",label:"Multiply"},{id:"screen",label:"Screen"},
    {id:"overlay",label:"Overlay"},{id:"soft-light",label:"Soft light"},{id:"hard-light",label:"Hard light"},
    {id:"darken",label:"Darken"},{id:"lighten",label:"Lighten"},{id:"color",label:"Color"},{id:"luminosity",label:"Luminosity"}
  ]);
  const BLEND_IDS=new Set(BLENDS.map(blend=>blend.id));

  const EFFECT_DEFAULTS=Object.freeze({detail:0,detailRadius:6,reliefExag:1,remRadius:1500});

  /* ------------------------------------------------------------------ layers */
  function defaultLayer(style){
    const spec=STYLES[style]||STYLES.hs,palette=PALETTES[spec.palette];
    const domain=palette&&palette.domain||spec.domain;
    return {style:STYLES[style]?style:"hs",palette:spec.palette,stops:null,reverse:false,opacity:1,blend:"normal",
      auto:!!spec.auto&&!(palette&&palette.domain),min:domain[0],max:domain[1],gamma:1,steps:0,
      param:spec.param==="shade"?(palette&&palette.shade?1:0):spec.param==="interval"?spec.paramDefault:0,visible:true};
  }
  function normalizeLayer(raw,fallbackStyle){
    const style=raw&&STYLES[raw.style]?raw.style:fallbackStyle;
    if(!STYLES[style]) return null;
    const base=defaultLayer(style),layer=Object.assign({},base);
    if(!raw||typeof raw!=="object") return layer;
    if(typeof raw.palette==="string"&&(hasOwn(PALETTES,raw.palette)||raw.palette==="custom")) layer.palette=raw.palette;
    layer.stops=normalizeStops(raw.stops);
    if(layer.palette==="custom"&&!layer.stops) layer.palette=base.palette;
    layer.reverse=!!raw.reverse;
    layer.opacity=clamp(finite(raw.opacity,1),0,1);
    layer.blend=BLEND_IDS.has(raw.blend)?raw.blend:"normal";
    layer.auto=STYLES[style].auto?(raw.auto===undefined?base.auto:!!raw.auto):false;
    layer.min=finite(raw.min,base.min);layer.max=finite(raw.max,base.max);
    if(layer.max<=layer.min) layer.max=layer.min+Math.max(1e-3,Math.abs(layer.min)*1e-3);
    layer.gamma=clamp(finite(raw.gamma,1),.2,5);
    layer.steps=Math.round(clamp(finite(raw.steps,0),0,32));if(layer.steps===1) layer.steps=0;
    layer.param=finite(raw.param,base.param);
    if(STYLES[style].param==="interval") layer.param=clamp(layer.param,1,5000);
    if(STYLES[style].param==="shade") layer.param=clamp(layer.param,0,1);
    layer.visible=raw.visible!==false;
    return layer;
  }
  function paletteStops(layer){
    if(layer.stops) return layer.stops;
    const palette=PALETTES[layer.palette]||PALETTES[(STYLES[layer.style]||STYLES.hs).palette];
    return palette.stops;
  }
  /* The stops a layer draws with, reversed if asked, as shader tuples. */
  function resolveStops(layer){
    const stops=paletteStops(layer).map(([position,color])=>[layer.reverse?1-position:position,...parseHex(color)]);
    return stops.sort((a,b)=>a[0]-b[0]);
  }
  function isDefaultLayer(layer,style){
    const base=defaultLayer(style);
    return layer.style===style&&layer.palette===base.palette&&!layer.stops&&!layer.reverse&&layer.opacity===1&&
      layer.blend==="normal"&&layer.auto===base.auto&&layer.min===base.min&&layer.max===base.max&&layer.gamma===1&&
      layer.steps===0&&layer.param===base.param&&layer.visible;
  }

  /* ------------------------------------------------------------------- state
     {version, base: {[style]: layer}, overlays: [layer, bottom to top],
      effects, look, userLooks: [{id, name, scene}]} */
  function emptyState(){
    return {version:VERSION,base:{},overlays:[],effects:Object.assign({},EFFECT_DEFAULTS),look:"classic",userLooks:[]};
  }
  function normalizeEffects(raw){
    const e=Object.assign({},EFFECT_DEFAULTS,raw&&typeof raw==="object"?raw:{});
    return {detail:clamp(finite(e.detail,0),-1,3),detailRadius:clamp(finite(e.detailRadius,6),1,500),
      reliefExag:clamp(finite(e.reliefExag,1),.25,8),remRadius:clamp(finite(e.remRadius,1500),50,20000)};
  }
  function normalizeState(raw){
    const state=emptyState();
    if(!raw||typeof raw!=="object") return state;
    if(raw.base&&typeof raw.base==="object")
      for(const style of Object.keys(raw.base)) if(STYLES[style]){const layer=normalizeLayer(raw.base[style],style);if(layer) state.base[style]=layer}
    if(Array.isArray(raw.overlays))
      state.overlays=raw.overlays.map(layer=>normalizeLayer(layer,null)).filter(Boolean).slice(0,MAX_LAYERS-1);
    state.effects=normalizeEffects(raw.effects);
    state.look=typeof raw.look==="string"?raw.look:null;
    if(Array.isArray(raw.userLooks))
      state.userLooks=raw.userLooks.filter(look=>look&&typeof look.id==="string"&&typeof look.name==="string"&&look.scene)
        .slice(0,24).map(look=>({id:look.id,name:look.name.slice(0,40),scene:normalizeScene(look.scene),
          ...(Number.isFinite(+look.opacity)?{opacity:clamp(+look.opacity,0,100)}:{})}));
    return state;
  }
  function baseLayer(state,style){
    return state.base[style]?state.base[style]:defaultLayer(style);
  }
  function effectsDefault(effects){
    return effects.detail===0&&effects.reliefExag===1;
  }
  /* True when the scene draws exactly like the legacy renderer. */
  function isLegacy(state,style){
    if(!style||style==="off") return true;
    if(style==="rem"||!STYLES[style]) return style!=="rem";
    return !state.overlays.some(layer=>layer.visible)&&isDefaultLayer(baseLayer(state,style),style)&&effectsDefault(state.effects);
  }

  /* fitted: {[layerKey]: [min, max]} from the current view; layer keys are
     "base" and "overlay:<index>". Returns the shader stack, or null for the
     legacy path. */
  function buildStack(state,style,fitted,options){
    if(!style||style==="off"||isLegacy(state,style)) return null;
    const opts=options||{},layers=[],list=[["base",baseLayer(state,style)]];
    state.overlays.forEach((layer,index)=>list.push(["overlay:"+index,layer]));
    for(const [key,layer] of list){
      if(!layer.visible||layers.length>=MAX_LAYERS) continue;
      let min=layer.min,max=layer.max;
      const fit=fitted&&fitted[key];
      if(layer.auto&&Array.isArray(fit)&&fit.every(Number.isFinite)&&fit[1]>fit[0]){min=fit[0];max=fit[1]}
      layers.push({style:layer.style,opacity:layer.opacity,blend:layer.blend,stops:resolveStops(layer),
        min,max,gamma:layer.gamma,steps:layer.steps,param:layer.style==="contour"||STYLES[layer.style].param?layer.param:0});
    }
    // An explicitly empty mix must stay transparent, not fall back to the
    // legacy base layer when the user hides the last visible layer.
    const effects=state.effects;
    return {layers,detail:effects.detail,detailRadius:effects.detailRadius,reliefExag:effects.reliefExag,
      remRadius:effects.remRadius,remFlatBase:finite(opts.remFlatBase,0)};
  }

  /* Robust range of view samples: percentiles keep a single tower or pit
     from flattening the whole palette. Relative elevation starts at zero. */
  function fitRange(values,style){
    if(!values||!values.length) return null;
    const sorted=Float64Array.from(values).sort();
    const pick=q=>sorted[Math.min(sorted.length-1,Math.max(0,Math.round(q*(sorted.length-1))))];
    let low=style==="rem"?0:pick(.02),high=style==="rem"?pick(.6):pick(.98);
    if(!(high>low)) high=low+1;
    const span=high-low,unit=span>200?10:span>20?1:.1;
    low=Math.floor(low/unit)*unit;high=Math.ceil(high/unit)*unit;
    return [low,high];
  }

  /* --------------------------------------------------------------- scenes
     A scene is a whole look: base style plus its layer, overlays and effects. */
  function normalizeScene(raw){
    const style=raw&&STYLES[raw.style]&&!STYLES[raw.style].registered?raw.style:"hs";
    return {style,base:normalizeLayer(raw&&raw.base,style),
      overlays:(Array.isArray(raw&&raw.overlays)?raw.overlays:[]).map(layer=>normalizeLayer(layer,null)).filter(Boolean).slice(0,MAX_LAYERS-1),
      effects:normalizeEffects(raw&&raw.effects)};
  }
  function captureScene(state,style){
    return normalizeScene({style,base:baseLayer(state,style),overlays:state.overlays,effects:state.effects});
  }
  /* Applying a scene replaces the overlays and effects and the base layer of
     its style; other styles keep their own saved colors. */
  function applyScene(state,scene,lookId){
    const next=normalizeState(state),clean=normalizeScene(scene);
    next.base[clean.style]=clean.base;next.overlays=clean.overlays;next.effects=clean.effects;next.look=lookId||null;
    return {state:next,style:clean.style};
  }

  const layer=(style,patch)=>Object.assign(defaultLayer(style),patch||{});
  const LOOKS=Object.freeze([
    {id:"classic",name:"Classic",blurb:"The standard grey hillshade.",opacity:70,
      scene:{style:"hs",base:layer("hs"),overlays:[],effects:EFFECT_DEFAULTS}},
    {id:"lava-river",name:"Lava River",blurb:"Rivers glow gold over deep-blue uplands. Best over valleys and floodplains.",
      scene:{style:"rem",base:layer("rem",{palette:"lava",gamma:.6}),
        overlays:[layer("hs",{palette:"ink",blend:"multiply",opacity:.8})],
        effects:{detail:.4,detailRadius:8,reliefExag:1.8,remRadius:3000}}},
    {id:"ember",name:"Ember",blurb:"Molten orange relief with hard sculpted light.",
      scene:{style:"tint",base:layer("tint",{palette:"ember",auto:true,param:0}),
        overlays:[layer("hs",{palette:"default-hs",blend:"soft-light",opacity:1})],
        effects:{detail:1,detailRadius:5,reliefExag:3,remRadius:1500}}},
    {id:"glacier",name:"Glacier",blurb:"Dark rock with high ground turned to glowing ice.",
      scene:{style:"hs",base:layer("hs",{palette:"glacier-shade",gamma:1.4}),
        overlays:[layer("tint",{palette:"ice-glow",auto:true,param:0,blend:"screen",opacity:1})],
        effects:{detail:.3,detailRadius:6,reliefExag:1.6,remRadius:1500}}},
    {id:"swiss",name:"Swiss Relief",blurb:"Soft hypsometric color under warm cartographic shading.",
      scene:{style:"tint",base:layer("tint",{palette:"hypsometric",auto:true,param:0}),
        overlays:[layer("hsmulti",{palette:"swiss",blend:"multiply",opacity:.85})],
        effects:{detail:.2,detailRadius:6,reliefExag:1.4,remRadius:1500}}},
    {id:"aurora",name:"Aurora",blurb:"Floodplains in luminous green and teal over midnight hills.",
      scene:{style:"rem",base:layer("rem",{palette:"aurora",reverse:true,gamma:.7}),
        overlays:[layer("hs",{palette:"moonlight",blend:"soft-light",opacity:.9})],
        effects:{detail:.3,detailRadius:8,reliefExag:2,remRadius:3000}}},
    {id:"neon-slope",name:"Neon Slope",blurb:"Steepness in electric color. Cliffs and scarps pop.",
      scene:{style:"slope",base:layer("slope",{palette:"neon",min:0,max:45,gamma:.8}),
        overlays:[layer("hs",{blend:"soft-light",opacity:.7})],
        effects:{detail:.5,detailRadius:5,reliefExag:1.5,remRadius:1500}}},
    {id:"midnight",name:"Midnight",blurb:"Moonlit multi-directional relief.",
      scene:{style:"hsmulti",base:layer("hsmulti",{palette:"moonlight",gamma:1.6}),overlays:[],
        effects:{detail:.4,detailRadius:5,reliefExag:2,remRadius:1500}}},
    {id:"blueprint",name:"Blueprint",blurb:"Drafting-table relief with white contour lines.",
      scene:{style:"hs",base:layer("hs",{palette:"blueprint"}),
        overlays:[layer("contour",{palette:"white-lines",param:20,opacity:.75})],
        effects:{detail:0,detailRadius:6,reliefExag:1.3,remRadius:1500}}},
    {id:"compass",name:"Compass Rose",blurb:"Every slope coloured by the way it faces.",
      scene:{style:"aspect",base:layer("aspect",{palette:"hue-wheel"}),
        overlays:[layer("hs",{blend:"multiply",opacity:.75})],
        effects:{detail:.3,detailRadius:5,reliefExag:1.6,remRadius:1500}}},
    {id:"topo",name:"Topographic",blurb:"Classic map colors, relief and index contours.",
      scene:{style:"tint",base:layer("tint",{palette:"hypsometric",auto:true,param:0}),
        overlays:[layer("hs",{blend:"multiply",opacity:.6}),layer("contour",{palette:"default-contour",param:40,opacity:.9})],
        effects:{detail:0,detailRadius:6,reliefExag:1.2,remRadius:1500}}}
  ].map(look=>Object.assign({opacity:100},look,{scene:normalizeScene(look.scene)})));

  /* Which looks match a state: a look is current when its scene is exactly
     what the panel would capture. */
  function matchLook(state,style,looks){
    const current=JSON.stringify(captureScene(state,style));
    const all=(looks||LOOKS).concat(state.userLooks||[]);
    const matches=look=>JSON.stringify(look.scene)===current;
    const hit=all.find(look=>look.id===state.look&&matches(look))||all.find(matches);
    return hit?hit.id:null;
  }

  /* ------------------------------------------------------------- preview
     A CPU reference of the shader's stack, used for the looks gallery and
     palette previews (and as a test oracle for the blend maths). It draws a
     small synthetic landscape: a meandering river on a floodplain between
     terraces and dissected hills, which shows off every style. */
  function previewTerrain(width,height){
    const w=width||96,h=height||64,grid=new Float32Array(w*h),res=8*96/w;
    const hash=(x,y)=>{const n=Math.sin(x*127.1+y*311.7)*43758.5453;return n-Math.floor(n)};
    const noise=(x,y)=>{
      const xi=Math.floor(x),yi=Math.floor(y),xf=x-xi,yf=y-yi,u=xf*xf*(3-2*xf),v=yf*yf*(3-2*yf);
      const a=hash(xi,yi),b=hash(xi+1,yi),c=hash(xi,yi+1),d=hash(xi+1,yi+1);
      return (a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v)*2-1;
    };
    const ridged=(x,y)=>{let sum=0,amp=.55,f=1;for(let o=0;o<5;o++){sum+=amp*(1-Math.abs(noise(x*f+o*7.3,y*f-o*3.1)));amp*=.5;f*=2.03}return sum};
    for(let y=0;y<h;y++) for(let x=0;x<w;x++){
      const u=x/w,v=y/h;
      const centre=.5+.16*Math.sin(u*Math.PI*2.2+.6)+.05*Math.sin(u*Math.PI*6.1+1.3);
      const d=Math.abs(v-centre)*h/w*1.5;
      const floodplain=Math.max(0,Math.min(1,(d-.08)/.07)),wall=floodplain*floodplain*(3-2*floodplain);
      const upland=ridged(u*3.2+.3,v*3.2*h/w+.7)*Math.min(1,d*3);
      const meander=Math.abs(v-(centre+.03*Math.sin(u*Math.PI*14)))*h/w*1.5,channel=Math.max(0,1-meander/.012);
      const bars=noise(u*16,v*16*h/w)*1.2*(1-wall);
      grid[y*w+x]=300+wall*(70+upland*110)+bars-channel*4+u*18;
    }
    return {grid,width:w,height:h,res};
  }
  function filterGrid(grid,w,h,radius,mode){
    const r=Math.max(1,Math.round(radius)),tmp=new Float32Array(w*h),out=new Float32Array(w*h),sigma=Math.max(.5,r/2);
    const pass=(src,dst,dx,dy)=>{
      for(let y=0;y<h;y++) for(let x=0;x<w;x++){
        let acc=mode==="min"?Infinity:0,weight=0;
        for(let k=-r;k<=r;k++){
          const xx=x+dx*k,yy=y+dy*k;if(xx<0||yy<0||xx>=w||yy>=h) continue;
          const v=src[yy*w+xx];
          if(mode==="min") acc=Math.min(acc,v);else{const g=Math.exp(-k*k/(2*sigma*sigma));acc+=v*g;weight+=g}
        }
        dst[y*w+x]=mode==="min"?acc:acc/weight;
      }
    };
    pass(grid,tmp,1,0);pass(tmp,out,0,1);return out;
  }
  const lum=c=>.3*c[0]+.59*c[1]+.11*c[2];
  function clipColour(c){
    const l=lum(c),n=Math.min(...c),x=Math.max(...c);
    if(n<0) c=c.map(v=>l+(v-l)*l/Math.max(l-n,1e-6));
    if(x>1) c=c.map(v=>l+(v-l)*(1-l)/Math.max(x-l,1e-6));
    return c;
  }
  const setLum=(c,l)=>{const d=l-lum(c);return clipColour(c.map(v=>v+d))};
  const hardLight=(b,s)=>s<.5?b*2*s:1-(1-b)*(1-(2*s-1));
  const softLight=(b,s)=>{const d=b<.25?((16*b-12)*b+4)*b:Math.sqrt(b);return s<.5?b-(1-2*s)*b*(1-b):b+(2*s-1)*(d-b)};
  function blendColour(mode,b,s){
    switch(mode){
      case "multiply":return b.map((v,i)=>v*s[i]);
      case "screen":return b.map((v,i)=>v+s[i]-v*s[i]);
      case "overlay":return b.map((v,i)=>hardLight(s[i],v));
      case "soft-light":return b.map((v,i)=>softLight(v,s[i]));
      case "hard-light":return b.map((v,i)=>hardLight(v,s[i]));
      case "darken":return b.map((v,i)=>Math.min(v,s[i]));
      case "lighten":return b.map((v,i)=>Math.max(v,s[i]));
      case "color":return setLum(s,lum(b));
      case "luminosity":return setLum(b,lum(s));
      default:return s.slice();
    }
  }
  /* Premultiplied source-over with a separable blend (W3C Compositing). */
  function composite(backdrop,color,alpha,mode){
    const ab=backdrop[3],b=ab>0?backdrop.slice(0,3).map(v=>v/ab):[0,0,0];
    const blended=blendColour(mode,b,color).map(v=>clamp(v,0,1));
    const mixed=color.map((v,i)=>(1-ab)*v+ab*blended[i]);
    return [0,1,2].map(i=>alpha*mixed[i]+(1-alpha)*backdrop[i]).concat(alpha+ab*(1-alpha));
  }
  function rampColour(stops,t){
    if(t<=stops[0][0]) return stops[0].slice(1);
    for(let k=1;k<stops.length;k++) if(t<=stops[k][0]){
      const a=stops[k-1],b=stops[k],f=clamp((t-a[0])/Math.max(b[0]-a[0],1e-6),0,1);
      return [1,2,3,4].map(i=>a[i]+(b[i]-a[i])*f);
    }
    return stops[stops.length-1].slice(1);
  }
  function paletteColour(layer,value){
    let t=clamp((value-layer.min)/(layer.max-layer.min),0,1);
    t=Math.pow(Math.max(t,0),layer.gamma);
    if(layer.steps>=2) t=Math.min(Math.floor(t*layer.steps),layer.steps-1)/(layer.steps-1);
    return rampColour(layer.stops,t);
  }
  function directShade(dx,dy,azimuth,altitude){
    const east=dx,north=-dy,alt=altitude*Math.PI/180,az=azimuth*Math.PI/180;
    return clamp((-east*Math.cos(alt)*Math.sin(az)-north*Math.cos(alt)*Math.cos(az)+Math.sin(alt))/Math.sqrt(east*east+north*north+1),0,1);
  }
  const aspectOf=(dx,dy)=>((Math.atan2(-dx,dy)*180/Math.PI)%360+360)%360;
  /* stack: buildStack() output. Returns straight RGBA bytes. */
  function renderStack(stack,dem,lighting){
    const {grid,width:w,height:h,res}=dem,out=new Uint8ClampedArray(w*h*4);
    if(!stack||!stack.layers.length) return out;
    const light=Object.assign({azimuth:315,altitude:45,ambient:.12},lighting||{});
    let heights=grid;
    if(stack.detail&&stack.detailRadius/res>=1){
      const blur=filterGrid(grid,w,h,Math.min(8,stack.detailRadius/res),"blur");
      heights=grid.map((v,i)=>v+stack.detail*(v-blur[i]));
    }
    let base=null;
    if(stack.layers.some(layer=>layer.style==="rem")){
      const radius=Math.min(24,Math.max(2,stack.remRadius/res/8));
      base=filterGrid(filterGrid(grid,w,h,radius,"min"),w,h,radius,"blur");
    }
    const H=(x,y)=>heights[clamp(y,0,h-1)*w+clamp(x,0,w-1)];
    const zFactor=1+.024*Math.pow(Math.max(res,0),.664),exag=stack.reliefExag||1;
    for(let y=0;y<h;y++) for(let x=0;x<w;x++){
      const a=H(x-1,y-1),b=H(x,y-1),c=H(x+1,y-1),d=H(x-1,y),f=H(x+1,y),g=H(x-1,y+1),q=H(x,y+1),k=H(x+1,y+1);
      const dx=((c+2*f+k)-(a+2*d+g))/(8*res),dy=((g+2*q+k)-(a+2*b+c))/(8*res);
      const sdx=dx*zFactor*exag,sdy=dy*zFactor*exag,height=grid[y*w+x];
      const flat=Math.hypot(dx,dy)<=Math.tan(.5*Math.PI/180),aspect=flat?-1:aspectOf(dx,dy);
      let acc=[0,0,0,0];
      for(const layer of stack.layers){
        let value,coverage=1;
        switch(layer.style){
          case "hs":value=light.ambient+(1-light.ambient)*directShade(sdx,sdy,light.azimuth,light.altitude);break;
          case "hsmulti":{
            const facing=aspectOf(dx,dy);let sum=0,total=0;
            for(let i=0;i<4;i++){
              const az=light.azimuth-90+45*i,sine=Math.sin((facing-(((az%360)+360)%360))*Math.PI/180);
              const weight=Math.hypot(dx,dy)<1e-12?1:sine*sine;
              sum+=weight*directShade(sdx,sdy,az,light.altitude);total+=weight;
            }
            value=light.ambient+(1-light.ambient)*sum/Math.max(total,1e-5);break;
          }
          case "slope":value=Math.atan(Math.hypot(dx,dy))*180/Math.PI;break;
          case "aspect":if(aspect<0) coverage=0;value=aspect;break;
          case "northness":if(aspect<0) coverage=0;value=Math.cos(aspect*Math.PI/180);break;
          case "tint":value=height;break;
          case "rem":value=Math.max(0,height-(base?base[y*w+x]:0));break;
          default:{
            const interval=layer.style==="contour"?Math.max(.5,layer.param):({c2:2,c5:5,c10:10,c25:25})[layer.style];
            if(!interval){coverage=0;break}
            const multiple=height*FT/interval,dist=Math.abs(multiple-Math.round(multiple))*interval;
            const per=Math.hypot(dx,dy)*res*FT,width=Math.max(.35,Math.min(interval*.5,per*.7));
            if(dist>=width) coverage=0;
            value=Math.abs(Math.round(multiple)%5)===0?1:0;
          }
        }
        if(!(coverage>0)) continue;
        const color=paletteColour(layer,value);
        if((layer.style==="tint"||layer.style==="rem")&&layer.param>0){
          const shade=light.ambient+(1-light.ambient)*directShade(sdx,sdy,light.azimuth,light.altitude),m=1+(.33+.82*shade-1)*clamp(layer.param,0,1);
          for(let i=0;i<3;i++) color[i]=Math.min(1,color[i]*m);
        }
        const alpha=clamp(color[3]*coverage*layer.opacity,0,1);
        if(alpha>0) acc=composite(acc,color.slice(0,3),alpha,layer.blend);
      }
      const o=(y*w+x)*4;
      if(acc[3]>0){out[o]=Math.round(acc[0]/acc[3]*255);out[o+1]=Math.round(acc[1]/acc[3]*255);out[o+2]=Math.round(acc[2]/acc[3]*255);out[o+3]=Math.round(acc[3]*255)}
    }
    return out;
  }
  /* A scene's preview with its auto ranges fitted to the preview terrain. */
  function renderScenePreview(scene,dem,lighting){
    const clean=normalizeScene(scene),state=emptyState();
    state.base[clean.style]=clean.base;state.overlays=clean.overlays;state.effects=clean.effects;
    const fitted={},layers=[["base",clean.base]].concat(clean.overlays.map((layer,i)=>["overlay:"+i,layer]));
    let base=null;
    for(const [key,layer] of layers) if(layer.auto){
      if(layer.style==="rem"){
        if(!base){const radius=Math.min(24,Math.max(2,clean.effects.remRadius/dem.res/8));base=filterGrid(filterGrid(dem.grid,dem.width,dem.height,radius,"min"),dem.width,dem.height,radius,"blur")}
        fitted[key]=fitRange(dem.grid.map((v,i)=>Math.max(0,v-base[i])),"rem");
      }else fitted[key]=fitRange(dem.grid,layer.style);
    }
    let stack=buildStack(state,clean.style,fitted);
    if(!stack) stack={layers:[{style:clean.style,opacity:1,blend:"normal",stops:resolveStops(clean.base),min:clean.base.min,max:clean.base.max,
      gamma:1,steps:0,param:clean.base.param}],detail:0,detailRadius:6,reliefExag:1,remRadius:clean.effects.remRadius};
    return renderStack(stack,dem,lighting);
  }

  /* ------------------------------------------------------------ presentation */
  function gradientCss(stops,reverse){
    const list=(stops||[]).map(([position,color])=>[reverse?1-position:position,color]).sort((a,b)=>a[0]-b[0]);
    return "linear-gradient(90deg,"+list.map(([position,color])=>{
      const c=parseHex(color);
      return `rgba(${Math.round(c[0]*255)},${Math.round(c[1]*255)},${Math.round(c[2]*255)},${+c[3].toFixed(3)}) ${+(position*100).toFixed(2)}%`;
    }).join(",")+")";
  }
  function palettesFor(style){
    const family=(STYLES[style]||STYLES.hs).family,own=(STYLES[style]||STYLES.hs).palette;
    const ids=Object.keys(PALETTES).filter(id=>!/^default-|^style-/.test(id)||id===own);
    const first=ids.filter(id=>id===own),fit=ids.filter(id=>id!==own&&PALETTES[id].kinds.includes(family));
    const rest=family==="lines"?[]:ids.filter(id=>id!==own&&!PALETTES[id].kinds.includes(family)&&!PALETTES[id].kinds.includes("lines"));
    return first.concat(fit,rest);
  }
  /* Display units: elevation in feet, angles in degrees. */
  function formatValue(style,value){
    const unit=(STYLES[style]||{}).unit;
    if(unit==="m") return Math.round(value*FT).toLocaleString()+" ft";
    if(unit==="deg") return Math.round(value)+"°";
    if(unit==="shade") return Math.round(value*100)+"%";
    return String(+value.toFixed(2));
  }
  function toDisplay(style,value){ return (STYLES[style]||{}).unit==="m"?value*FT:(STYLES[style]||{}).unit==="shade"?value*100:value }
  function fromDisplay(style,value){ return (STYLES[style]||{}).unit==="m"?value/FT:(STYLES[style]||{}).unit==="shade"?value/100:value }

  return Object.freeze({VERSION,MAX_LAYERS,MAX_STOPS,FT,PALETTES,STYLES,OVERLAY_STYLES,BLENDS,LOOKS,EFFECT_DEFAULTS,
    parseHex,toHex,normalizeStops,moveStop,registerStyle,defaultLayer,normalizeLayer,resolveStops,paletteStops,isDefaultLayer,
    emptyState,normalizeState,normalizeEffects,baseLayer,isLegacy,buildStack,fitRange,normalizeScene,captureScene,applyScene,
    matchLook,gradientCss,palettesFor,formatValue,toDisplay,fromDisplay,
    previewTerrain,renderStack,renderScenePreview,blendColour,composite,_test:Object.freeze({filterGrid,rampColour,paletteColour})});
});
