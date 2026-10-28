/* Full display-state share links, CR-003 r1: the codec that packs a display
   state into a URL fragment and back, and the schema a state must pass before
   anything on the map changes. Only data crosses this boundary; typed raster
   buffers retain their original bits, including nodata NaNs.

   What counts as valid depends on the page - its controls, overlays and
   analysis settings - so validate() takes those as an environment:
     {controls, viewMax, overlays, pointCloudClasses, lidarRender,
      analysisLayers, researchLabels, researchParams, researchStyleDefaults,
      researchPaletteChoices} */
(function(root,factory){
  const api=factory();
  if(typeof module==="object" && module.exports) module.exports=api;
  root.CSPShareState=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";

  /* ---------------------------------------------------------------- codec */
  const arrays = {Float32Array,Float64Array,Int8Array,Uint8Array,Uint8ClampedArray,Int16Array,Uint16Array,Int32Array,Uint32Array};
  const base64 = bytes => {
    let value="";
    for(let i=0;i<bytes.length;i+=16384)value+=String.fromCharCode(...bytes.subarray(i,i+16384));
    return btoa(value).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
  };
  const bytes = value => {
    if(typeof value!=="string"||!/^[A-Za-z0-9_-]*$/.test(value)||value.length%4===1)throw Error("Malformed share-link data.");
    const text=atob(value.replace(/-/g,"+").replace(/_/g,"/"));
    return Uint8Array.from(text,c=>c.charCodeAt(0));
  };
  function pack(value){
    if(ArrayBuffer.isView(value)){
      if(!arrays[value.constructor.name])throw Error("Unsupported shared raster type.");
      return {$binary:value.constructor.name,data:base64(new Uint8Array(value.buffer,value.byteOffset,value.byteLength)),length:value.length};
    }
    if(typeof value==="number"&&!Number.isFinite(value))return {$number:String(value)};
    if(value===null||["string","boolean","number"].includes(typeof value))return value;
    if(Array.isArray(value))return value.map(pack);
    if(!value||typeof value!=="object"||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error("Unsupported share-link value.");
    const result=Object.create(null);
    for(const [key,item] of Object.entries(value)){
      if(["__proto__","constructor","prototype"].includes(key))throw Error("Invalid share-link field.");
      if(item!==undefined)result[key]=pack(item);
    }
    return result;
  }
  function unpack(value){
    if(!value||typeof value!=="object")return value;
    if(Array.isArray(value))return value.map(unpack);
    if(Object.keys(value).some(key=>["__proto__","constructor","prototype"].includes(key)))throw Error("Invalid share-link field.");
    if(Object.hasOwn(value,"$binary")){
      const Type=arrays[value.$binary],data=bytes(value.data);
      if(!Type||!Number.isSafeInteger(value.length)||value.length<0||data.byteLength!==value.length*Type.BYTES_PER_ELEMENT||Object.keys(value).length!==3)throw Error("Invalid shared raster buffer.");
      return new Type(data.buffer);
    }
    if(Object.hasOwn(value,"$number")){
      if(Object.keys(value).length!==1||!["NaN","Infinity","-Infinity"].includes(value.$number))throw Error("Invalid shared number.");
      return Number(value.$number);
    }
    return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,unpack(item)]));
  }
  async function encode(state){
    if(typeof CompressionStream!=="function")throw Error("This browser cannot create full-state links.");
    const data=new TextEncoder().encode(JSON.stringify(pack(state)));
    const compressed=await new Response(new Blob([data]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
    return "1."+base64(new Uint8Array(compressed));
  }
  async function decode(value){
    if(typeof value!=="string"||!value.startsWith("1."))throw Error("This share-link version is not supported.");
    if(typeof DecompressionStream!=="function")throw Error("This browser cannot open full-state links.");
    try{
      const data=await new Response(new Blob([bytes(value.slice(2))]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
      return unpack(JSON.parse(data));
    }catch(error){throw Error("The share link is damaged or contains invalid data.");}
  }

  /* --------------------------------------------------------------- schema */
  function check(condition,message){if(!condition)throw Error("Invalid share link: "+message);}
  function same(a,b){
    if(a===b)return true;
    if(!a||!b||typeof a!=="object"||typeof b!=="object"||Array.isArray(a)!==Array.isArray(b))return false;
    const keys=Object.keys(a);
    return keys.length===Object.keys(b).length&&keys.every(key=>Object.hasOwn(b,key)&&same(a[key],b[key]));
  }
  function geometry(value){
    const point=p=>Array.isArray(p)&&p.length>=2&&p.every(Number.isFinite);
    const line=p=>Array.isArray(p)&&p.length>=2&&p.every(point);
    const polygon=p=>Array.isArray(p)&&p.length>0&&p.every(ring=>line(ring)&&ring.length>=4);
    return !!value&&({Point:point,LineString:line,Polygon:polygon,MultiPolygon:p=>Array.isArray(p)&&p.length>0&&p.every(polygon)})[value.type]?.(value.coordinates)===true;
  }
  const IMAGERY_HOSTS=["planetarycomputer.microsoft.com","earth-search.aws.element84.com","earth-search.aws.element84.com.s3.amazonaws.com","titiler.xyz","gibs.earthdata.nasa.gov","worldview.earthdata.nasa.gov","browser.dataspace.copernicus.eu","search.asf.alaska.edu","cmr.earthdata.nasa.gov","landsatlook.usgs.gov","sentinel-cogs.s3.us-west-2.amazonaws.com","naipeuwest.blob.core.windows.net","naipblobs.blob.core.windows.net"];
  function safeURL(value){
    if(value==null||value==="")return;
    const url=new URL(value);
    check(url.protocol==="https:"&&!url.username&&!url.password,"unsafe imagery address");
    check(IMAGERY_HOSTS.includes(url.hostname)||/\.(?:amazonaws\.com|blob\.core\.windows\.net)$/.test(url.hostname),"imagery address is not a supported public provider");
    for(const [key,v] of url.searchParams){
      check(!/^(?:engine|server|apiBase|sig|signature|token|access_token|api.?key|key|credential|authorization|x-amz-.+)$/i.test(key),"credentials cannot be shared");
      if(/^https?:\/\//i.test(v))safeURL(v);
    }
  }
  function validateScene(scene){
    check(scene&&typeof scene.id==="string"&&typeof scene.srcKey==="string"&&typeof scene.label==="string"&&Number.isFinite(Date.parse(scene.date)),"imagery identity");
    if(scene.tiles){check(["xyz","tilejson"].includes(scene.tiles.type)&&typeof scene.tiles.url==="string"&&scene.tiles.url.length>0,"imagery tile format");safeURL(scene.tiles.url)}
    if(scene.link)safeURL(scene.link);
    if(scene.bbox)check(scene.bbox.length===4&&scene.bbox.every(Number.isFinite),"imagery footprint");
    if(scene.geom)check(geometry(scene.geom),"imagery geometry");
    for(const key of ["cloud","gsd","nativeMax"])if(scene[key]!=null)check(Number.isFinite(scene[key]),"imagery "+key);
  }

  const KEYS=["version","view","theme","controls","studio","terrainLook","overlays","alerts","imagery","research","markup","pointCloud","order"];
  function validateView(state,env){
    const v=state.view,p=v?.location;
    check(v&&Array.isArray(v.center)&&v.center.length===2&&v.center.every(Number.isFinite)&&Math.abs(v.center[0])<=90&&Math.abs(v.center[1])<=180&&Number.isFinite(v.zoom)&&v.zoom>=0&&v.zoom<=env.viewMax&&["2d","3d"].includes(v.mode)&&Number.isFinite(v.bearing)&&Number.isFinite(v.pitch),"map view");
    check(p&&Number.isFinite(p.lat)&&Math.abs(p.lat)<=90&&Number.isFinite(p.lng)&&Math.abs(p.lng)<=180&&typeof p.label==="string"&&v.center[0]===p.lat&&v.center[1]===p.lng,"selected location");
    check(["light","dark"].includes(state.theme),"map theme");
  }
  function validateControls(state,env){
    const controls=new Map(env.controls.map(el=>[el.id,el]));
    check(state.controls&&typeof state.controls==="object"&&!Array.isArray(state.controls),"display controls");
    check(Object.keys(state.controls).length===controls.size,"incomplete or unsupported display controls");
    for(const [id,value] of Object.entries(state.controls)){
      const el=controls.get(id);check(el,"unsupported control "+id);
      if(el.type==="checkbox"){check(typeof value==="boolean","checkbox "+id);continue}
      check(typeof value==="string","value "+id);
      if(el.tagName==="SELECT")check([...el.options].some(o=>o.value===value),"unsupported option for "+id);
      if(el.type==="color")check(/^#[0-9a-f]{6}$/i.test(value),"color "+id);
      if(["range","number"].includes(el.type))check(value!==""&&Number.isFinite(+value)&&(!el.min||+value>=+el.min)&&(!el.max||+value<=+el.max),"range "+id);
      if(el.type==="date")check(value===""||/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value)),"date "+id);
    }
  }
  function validateOverlays(state,env){
    check(Array.isArray(state.overlays)&&state.overlays.every(item=>env.overlays.some(o=>o.id===item.id)&&Number.isFinite(item.opacity)&&item.opacity>=0&&item.opacity<=100),"overlay settings");
    for(const item of state.overlays){
      const o=env.overlays.find(o=>o.id===item.id);
      if(item.timeSlice!=null)check(o.timeSlice?.values.includes(item.timeSlice),"overlay time slice");
      if(item.lineWidth!=null)check(o.lineWidth&&Number.isFinite(item.lineWidth)&&item.lineWidth>0,"overlay line width");
    }
  }
  function validateTerrain(state,env){
    check(state.terrainLook&&["contrast","saturation","brightness"].every(key=>Number.isFinite(state.terrainLook[key])),"terrain appearance");
    if(!state.studio)return;
    check(state.studio.state&&same(state.studio.state,env.lidarRender.normalizeState(state.studio.state)),"unsupported terrain mix settings");
    for(const fit of [state.studio.fitted,state.studio.flatFitted])check(fit&&typeof fit==="object"&&Object.values(fit).every(range=>Array.isArray(range)&&range.length===2&&range.every(Number.isFinite)&&range[1]>range[0]),"terrain display range");
    check(state.studio.remFloor===null||Number.isFinite(state.studio.remFloor),"relative elevation floor");
  }
  function validateConditionsAndImagery(state){
    check(state.alerts&&typeof state.alerts.types==="object"&&["nws","quakes","volcanoes","fires","viewport"].every(key=>typeof state.alerts[key]==="boolean"),"condition filters");
    if(!state.imagery)return;
    validateScene(state.imagery.primary);
    check(Array.isArray(state.imagery.neighbours),"imagery neighbours");
    state.imagery.neighbours.forEach(validateScene);
    if(state.imagery.backdrop)validateScene(state.imagery.backdrop);
  }
  function validateResearch(state,env){
    check(state.research&&typeof state.research.live==="boolean"&&Array.isArray(state.research.layers)&&state.research.layers.length<=env.analysisLayers.MAX_LAYERS,"analysis layers");
    for(const entry of state.research.layers){
      check(/^a\d+$/.test(entry.id)&&env.researchLabels[entry.product]&&entry.style&&entry.params,"analysis identity");
      check(same(entry.style,env.analysisLayers.normalizeStyle(entry.style,env.researchStyleDefaults(entry.product))),"unsupported analysis style");
      const palettes=env.researchPaletteChoices(entry.product);
      check(palettes.length?palettes.some(p=>p.id===entry.style.palette):entry.style.palette==="standard","unsupported analysis palette");
      for(const [key,value] of Object.entries(entry.params))check(env.researchParams[key]?.options.some(o=>o[0]===value),"analysis parameter");
      if(!entry.last)continue;
      const c=entry.last.capture,r=entry.last.result;
      check(c&&Number.isSafeInteger(c.width)&&c.width>0&&Number.isSafeInteger(c.height)&&c.height>0&&Number.isFinite(c.resolution)&&c.resolution>0,"analysis dimensions");
      const raster=data=>ArrayBuffer.isView(data)&&data.length===c.width*c.height;
      check(raster(c.elevation)&&r&&raster(r.data)&&r.width===c.width&&r.height===c.height&&typeof r.label==="string"&&(!r.secondary||raster(r.secondary))&&(!c.hillshade||raster(c.hillshade)),"analysis raster");
      const bounds=b=>Array.isArray(b)&&b.length===4&&b.every(Number.isFinite)&&b[1]>=-90&&b[3]<=90&&b[1]<b[3]&&b[0]<b[2];
      check(bounds(entry.last.bounds)&&c.raster&&bounds(c.raster.bounds)&&c.raster.width===c.width&&c.raster.height===c.height,"analysis bounds");
    }
  }
  const ANNOTATION_KINDS=["pen","highlight","line","arrow","arrow2","area","rect","shape","circle","text","pin"];
  function validateMarkup(state){
    check(Array.isArray(state.markup),"annotations");
    for(const entry of state.markup){
      const doc=entry.doc;
      check(doc?.type==="FeatureCollection"&&typeof doc.markup?.id==="string"&&/^[a-z0-9_-]+$/i.test(doc.markup.id)&&typeof doc.markup.name==="string"&&/^#[0-9a-f]{6}$/i.test(doc.markup.color)&&Array.isArray(doc.features)&&Number.isFinite(entry.opacity)&&entry.opacity>=0&&entry.opacity<=100&&Number.isFinite(entry.rank),"annotation layer");
      for(const f of doc.features){
        check(f?.type==="Feature"&&["Point","LineString","Polygon"].includes(f.geometry?.type)&&geometry(f.geometry)&&f.properties&&ANNOTATION_KINDS.includes(f.properties.kind),"annotation feature");
        const p=f.properties;
        for(const key of ["color","fillColor"])if(p[key]!=null)check(/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(p[key]),"annotation color");
        for(const key of ["width","radius","size","rot","opacity","fill"])if(p[key]!=null)check(typeof p[key]==="number"&&Number.isFinite(p[key]),"annotation numeric style");
        if(p.text!=null)check(typeof p.text==="string","annotation text");
        if(p.space3d)check(Array.isArray(p.space3d.anchor)&&p.space3d.anchor.length>=2&&p.space3d.anchor.every(Number.isFinite),"3D annotation anchor");
      }
    }
  }
  function validatePointCloud(state,env){
    const pc=state.pointCloud;
    if(!pc)return;
    check(pc.classes&&env.pointCloudClasses.every(name=>typeof pc.classes[name]==="boolean"),"point-cloud classes");
    check(pc.project==null||typeof pc.project==="string","point-cloud project");
    const c=pc.camera;
    if(c)check(Array.isArray(c.position)&&c.position.length===3&&c.position.every(Number.isFinite)&&[c.yaw,c.pitch,c.radius].every(Number.isFinite)&&c.radius>0,"point-cloud camera");
  }
  function validateOrder(state){
    const layerIds=new Set(["basemap","scene","terrain","elevation-spectrum","elevation-bands","active-fires",
      ...state.overlays.map(o=>"overlay:"+o.id),...state.research.layers.map(e=>"analysis:"+e.id),...state.markup.map(e=>"markup:"+e.doc.markup.id)]);
    check(Array.isArray(state.order)&&new Set(state.order).size===state.order.length&&state.order.every(id=>layerIds.has(id)),"layer order");
  }
  /* Sections are checked in this order; each relies on the ones before it. */
  function validate(state,env){
    check(state&&state.version===1&&Object.keys(state).length===KEYS.length&&KEYS.every(key=>Object.hasOwn(state,key)),"unsupported state format");
    validateView(state,env);
    validateControls(state,env);
    validateOverlays(state,env);
    validateTerrain(state,env);
    validateConditionsAndImagery(state);
    validateResearch(state,env);
    validateMarkup(state);
    validatePointCloud(state,env);
    validateOrder(state);
    return state;
  }

  return Object.freeze({encode,decode,pack,unpack,validate,validateScene});
});
