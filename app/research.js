/* ------------------------------- viewport-scale geomorphology research */
let researchWorker=null,researchServerController=null,researchToken=0;
/* Analysis layers, bottom first. Each keeps its last result so colors,
   relief shading and blend change instantly without recomputing, and the
   cursor readout can sample it. Styles are remembered per analysis. */
let researchStack=[],researchSeq=0,researchLiveTimer=0,researchFocus=null,researchStyles={};
let researchParamDefaults={scale:"balanced",sunDate:"355",wind:"225"};
const RESEARCH_PREF_KEY="clearskies.research.v1";
try{
  const p=JSON.parse(localStorage.getItem(RESEARCH_PREF_KEY)||"null");
  if(p){ if(typeof p.live==="boolean") $("#researchLive").checked=p.live;
         if(p.styles&&typeof p.styles==="object") researchStyles={...p.styles};
         else if(p.palettes&&typeof p.palettes==="object") for(const [product,palette] of Object.entries(p.palettes)) researchStyles[product]={palette};
         for(const key of ["scale","sunDate","wind"]) if(typeof p[key]==="string") researchParamDefaults[key]=p[key] }
}catch(e){}
function saveResearchPrefs(){
  try{ localStorage.setItem(RESEARCH_PREF_KEY,JSON.stringify({live:$("#researchLive").checked,styles:researchStyles,...researchParamDefaults})) }catch(e){}
}
function waitForElevationLayer(layer,timeout=15000){
  return new Promise(resolve=>{
    const started=performance.now();
    const poll=()=>{
      if(layer===gpuTerrainLayer){
        const status=layer.settled();
        if(status.complete&&(!status.refining&&status.ratio>=.9||performance.now()-started>timeout))return resolve(true);
        if(performance.now()-started>timeout)return resolve(status.complete>0);
        setTimeout(poll,120);return;
      }
      if(layer._store.size&&(!layer._pending.size||performance.now()-started>timeout)) return resolve(layer._store.size>0);
      if(performance.now()-started>timeout) return resolve(layer._store.size>0);
      setTimeout(poll,120);
    };poll();
  });
}
async function researchElevationSource(timeout=15000){
  if(gpuTerrainEnabled){
    const temporary=!map.hasLayer(gpuTerrainLayer);
    if(temporary)gpuTerrainLayer.addTo(map);
    await waitForElevationLayer(gpuTerrainLayer,timeout);return {layer:gpuTerrainLayer,temporary};
  }
  if(elevLayer&&elevLayer._store.size){ await waitForElevationLayer(elevLayer,Math.min(4500,timeout));return {layer:elevLayer,temporary:false} }
  const layer=new ElevLayer({...elevationSourceOptions(),fallbackNativeZoom:15,nationalNativeZoom:17,
    render:elevationRenderSettings(),maxZoom:VIEW_MAX,maxNativeZoom:17,zIndex:1,opacity:0,keepBuffer:0,
    updateWhenIdle:true,updateWhenZooming:false,maxRetries:0});
  layer.addTo(map);await waitForElevationLayer(layer);return {layer,temporary:true};
}
function researchElevationGrid(layer){
  if(layer===gpuTerrainLayer)return layer.gridForView();
  const rows=[];
  for(const [key,tile] of layer._store){
    const [z,x,y]=key.split("/").map(Number);if(tile.elev&&tile.elev.length===65536) rows.push({z,x,y,elev:tile.elev});
  }
  if(!rows.length) throw new Error("No elevation pixels are ready for this view.");
  const z=Math.max(...rows.map(t=>t.z)),tiles=rows.filter(t=>t.z===z);
  const minX=Math.min(...tiles.map(t=>t.x)),maxX=Math.max(...tiles.map(t=>t.x));
  const minY=Math.min(...tiles.map(t=>t.y)),maxY=Math.max(...tiles.map(t=>t.y));
  const sourceWidth=(maxX-minX+1)*256,sourceHeight=(maxY-minY+1)*256,source=new Float32Array(sourceWidth*sourceHeight);source.fill(NaN);
  for(const tile of tiles){
    const ox=(tile.x-minX)*256,oy=(tile.y-minY)*256;
    for(let y=0;y<256;y++) source.set(tile.elev.subarray(y*256,(y+1)*256),(oy+y)*sourceWidth+ox);
  }
  const factor=Math.max(1,Math.ceil(Math.max(sourceWidth,sourceHeight)/640));
  const width=Math.ceil(sourceWidth/factor),height=Math.ceil(sourceHeight/factor),grid=new Float32Array(width*height);grid.fill(NaN);
  if(factor===1) grid.set(source);
  else for(let y=0;y<height;y++) for(let x=0;x<width;x++){
    let sum=0,count=0;
    for(let yy=y*factor;yy<Math.min(sourceHeight,(y+1)*factor);yy++) for(let xx=x*factor;xx<Math.min(sourceWidth,(x+1)*factor);xx++){
      const value=source[yy*sourceWidth+xx];if(value===value){sum+=value;count++}
    }
    if(count) grid[y*width+x]=sum/count;
  }
  const n=Math.pow(2,z),lon=x=>x/n*360-180,lat=y=>Math.atan(Math.sinh(Math.PI*(1-2*y/n)))*180/Math.PI;
  const bounds=L.latLngBounds([lat(maxY+1),lon(minX)],[lat(minY),lon(maxX+1)]);
  const resolution=156543.03392*Math.cos(map.getCenter().lat*Math.PI/180)/Math.pow(2,z)*factor;
  const provenance=[...new Set(tiles.map(tile=>layer._store.get(`${tile.z}/${tile.x}/${tile.y}`)?.cv.dataset.cspElevationSource||"Unknown source"))];
  const provisional=tiles.some(tile=>layer._store.get(`${tile.z}/${tile.x}/${tile.y}`)?.cv._cspRefining);
  return {grid,width,height,resolution,bounds,z,factor,provenance,provisional};
}
function researchQuantile(data,q){
  const values=[],step=Math.max(1,Math.floor(data.length/60000));
  for(let i=0;i<data.length;i+=step) if(Number.isFinite(data[i])) values.push(data[i]);
  if(!values.length) return NaN;values.sort((a,b)=>a-b);return values[Math.max(0,Math.min(values.length-1,Math.round((values.length-1)*q)))];
}
/* Color looks for the lidar analysis products. Stops are [0..1, "#hex"],
   the shape terrain-core's normalizeColorRamp takes, so a shared palette
   editor can drive them later. Fixed-value classes (avalanche) use
   [degrees, "#hex"] and paint each band flat. */
const RESEARCH_PALETTES={
  grey:{name:"Greyscale",stops:[[0,"#0b0b0d"],[1,"#ffffff"]]},
  paper:{name:"Ink on paper",stops:[[0,"#1b1f2a"],[.55,"#8a8f99"],[1,"#f6f1e7"]]},
  glacier:{name:"Glacier ice",stops:[[0,"#0d1b2a"],[.45,"#2e6f8e"],[.75,"#8fd3e0"],[1,"#f4fbff"]]},
  ember:{name:"Ember",stops:[[0,"#140a07"],[.4,"#7a2414"],[.7,"#e0782f"],[1,"#fff2c8"]]},
  lava:{name:"Lava river",stops:[[0,"#0b1f4b"],[.3,"#4b2a8a"],[.55,"#c04a7a"],[.75,"#f08a3c"],[.9,"#f9d057"],[1,"#fffbe8"]]},
  viridis:{name:"Viridis",stops:[[0,"#440154"],[.25,"#3b528b"],[.5,"#21918c"],[.75,"#5ec962"],[1,"#fde725"]]},
  inferno:{name:"Inferno",stops:[[0,"#000004"],[.25,"#57106e"],[.5,"#bc3754"],[.75,"#f98e09"],[1,"#fcffa4"]]},
  daylight:{name:"Daylight",stops:[[0,"#1d2b53"],[.35,"#5b4a8b"],[.6,"#e07a5f"],[.85,"#f2cc8f"],[1,"#fff8e1"]]},
  snowpack:{name:"Snowpack",stops:[[0,"#f4fbff"],[.4,"#a9d6f0"],[.75,"#5a8fc2"],[1,"#24345e"]]},
  wet:{name:"Dry to wet",stops:[[0,"#e9dcc0"],[.35,"#b9cf8f"],[.6,"#5fae8c"],[.8,"#2f7fb5"],[1,"#163d7a"]]},
  water:{name:"River blue",stops:[[0,"#9ed4ff"],[.5,"#2f8fe0"],[1,"#0b3c91"]]},
  glow:{name:"Glowing streams",stops:[[0,"#3b3f9a"],[.5,"#36b6ff"],[1,"#e8fbff"]]},
  depth:{name:"Pool depth",stops:[[0,"#cfeeff"],[.5,"#4a9ee0"],[1,"#0d2f75"]]},
  wind:{name:"Scour to drift",stops:[[0,"#d9622b"],[.35,"#f3c48a"],[.5,"#f7f5ef"],[.65,"#9cc3e6"],[1,"#3b4cc0"]]},
  windPurple:{name:"Orange to purple",stops:[[0,"#b35806"],[.5,"#f7f7f7"],[1,"#542788"]]},
  caltopo:{name:"Slope classes",classes:[[27,"#f7e95b"],[30,"#f9b233"],[32,"#f07a22"],[35,"#e0262b"],[46,"#a31f83"],[51,"#3a3fbf"],[60,"#1a1a1a"]]},
  fatmap:{name:"Simple 30/35/40/45",classes:[[30,"#ffd24d"],[35,"#ff8a2a"],[40,"#e8303a"],[45,"#8a2be2"],[50,"#222222"]]},
  red:{name:"Red relief",tint:"#d7301f"},
  ochre:{name:"Ochre relief",tint:"#c77c12"},
  blue:{name:"Blue relief",tint:"#2166ac"},
  geoClassic:{name:"Classic landforms",categories:["#dcdcdc","#380000","#c80000","#ff5014","#fad23c","#ffff3c","#b4e614","#3cfa96","#0000ff","#000038"]},
  geoEarth:{name:"Earth tones",categories:["#ece6d6","#5b2c0f","#9c4a1a","#cf8a4a","#e8c27a","#f1e3b0","#a9c47f","#6aa88a","#2f6f9a","#1b2f55"]},
  standard:{name:"Standard"}
};
const RESEARCH_LOOKS={
  svf:{palettes:["grey","paper","glacier","ember","lava"],range:"quantile",blend:"multiply",
    labels:["Enclosed","","Open sky"],read:v=>`Sky view ${Math.round(v*100)}%`},
  openpos:{palettes:["grey","paper","glacier","ember","lava"],range:"quantile",blend:"multiply",
    labels:["Hollow","","Crest"],read:v=>`Positive openness ${v.toFixed(1)}°`},
  openneg:{palettes:["grey","paper","glacier","ember","lava"],range:"quantile",blend:"multiply",
    labels:["Crest","","Hollow"],read:v=>`Negative openness ${v.toFixed(1)}°`},
  rrim:{palettes:["red","ochre","blue"],range:"rrim",blend:"normal",
    labels:["Hollow","Steep","Ridge"],read:(v,s)=>`Slope ${Math.round(s)}° · ${v>=0?"convex":"concave"} ${Math.abs(v).toFixed(1)}°`},
  geomorphons:{palettes:["geoEarth","geoClassic"],range:"categories",blend:"normal",alpha:.86,
    read:v=>CSPTerrainAnalysis.GEOMORPHON_CLASSES[v]||""},
  drainage:{palettes:["water","glow","lava"],range:"log",blend:"normal",
    labels:["Rill","","Main stem"],read:v=>`Drains ${researchArea(v)}`},
  wetness:{palettes:["wet","viridis","glacier"],range:"quantile",blend:"normal",alpha:.86,
    labels:["Dry","","Wet"],read:v=>`Wetness index ${v.toFixed(1)}`},
  depressions:{palettes:["depth","glacier","lava"],range:"positive",blend:"normal",
    read:v=>v>0?`Sink depth ${researchFeet(v)}`:"No closed depression"},
  avalanche:{palettes:["caltopo","fatmap"],range:"classes",blend:"normal",alpha:.78,
    read:v=>`Slope ${v.toFixed(0)}°${v>=30&&v<=45?" · prime avalanche start zone":""}`},
  solar:{palettes:["daylight","inferno","snowpack","grey"],range:"quantile",blend:"normal",alpha:.86,
    labels:null,read:(v,s)=>`${v.toFixed(1)} kWh/m² · ${s.toFixed(1)} h direct sun`},
  wind:{palettes:["wind","windPurple"],range:"symmetric",blend:"normal",alpha:.8,
    labels:["Scoured","Neutral","Loaded"],read:v=>Math.abs(v)<.5?"Neutral to the wind":v>0?`Sheltered ${v.toFixed(1)}° · snow loading`:`Exposed ${(-v).toFixed(1)}° · wind scour`}
};
function researchFeet(metres){ const feet=metres/.3048;return `${feet<10?feet.toFixed(1):Math.round(feet).toLocaleString()} ft` }
function researchArea(m2){
  const acres=m2/4046.856;
  return acres>=640?`${(acres/640).toFixed(acres>=6400?0:1)} sq mi`:acres>=1?`${acres<10?acres.toFixed(1):Math.round(acres).toLocaleString()} acres`:`${Math.round(m2/.0929).toLocaleString()} sq ft`;
}
/* The analyses on offer, in menu order, with what each one shows. */
const RESEARCH_CATALOG=[
  {group:"LiDAR visualization",items:[["svf","Sky-view factor"],["openpos","Positive openness"],["openneg","Negative openness"],["rrim","Red relief image map"]]},
  {group:"Landforms",items:[["geomorphons","Landforms (geomorphons)"],["lrm","Local relief model"],["tpi","Terrain position index"],["tri","Terrain ruggedness"],
    ["residual","Multi-scale residual anomalies"],["northness","Aspect northness / eastness"],["curvature","Surface curvature (Laplacian)"]]},
  {group:"Water",items:[["drainage","Drainage network"],["wetness","Topographic wetness index"],["depressions","Depressions and sinks"]]},
  {group:"Snow and sun",items:[["avalanche","Avalanche slope angle"],["solar","Sun exposure"],["wind","Wind exposure and snow loading"]]},
  {group:"Geomorphology screens",items:[["glacial","Glacial-margin candidate screen"],["moraine","Glacial moraine leads (Beta)"],["flood","Flood-channel candidate screen"]]}
];
const RESEARCH_LABELS=Object.fromEntries(RESEARCH_CATALOG.flatMap(group=>group.items));
const RESEARCH_HINTS={lrm:"Remove broad hills so smaller landforms stand out.",tpi:"Show ridges and hollows relative to surrounding ground.",tri:"Show how rough or broken the surface is.",
  residual:"Find bumps and dips that differ from the broader surface.",northness:"Show which way slopes face, along north–south and east–west axes.",
  curvature:"Show local surface bending as the elevation Laplacian. Profile and plan curvature are not displayed.",glacial:"Flag possible ice-margin landforms. Check candidates against geology and field evidence.",
  moraine:"Beta: find leads on moraine-like ridges and hummocky belts. Compare with Glacial margin; landslides and other terrain can look similar.",
  flood:"Flag possible flood channels. Check candidates against geology and field evidence.",
  svf:"How much open sky each spot can see. Subtle banks, pits and trails stand out with no sun angle to tune.",
  openpos:"Bright where ground stands proud: ridges, berms and crests read crisply.",
  openneg:"Bright where ground sinks in: channels, ditches and hollows read crisply.",
  rrim:"Red for steep ground, light for ridges, dark for hollows. A classic Japanese LiDAR map style.",
  geomorphons:"Name every spot as a peak, ridge, shoulder, spur, slope, hollow, footslope, valley, pit or flat.",
  drainage:"Trace where water would run, from rills to the main stream.",
  wetness:"Show where water tends to collect: flat ground that drains a large area.",
  depressions:"Find closed hollows such as kettles, sinkholes and ponds, shaded by depth.",
  avalanche:"Highlight slopes from 27° up, where avalanches start most often. One input to avalanche terrain, not a forecast.",
  solar:"Daily sunshine with terrain shadows. Dark ground keeps its snow longest.",
  wind:"Blue slopes are sheltered and collect drifting snow; orange slopes are scoured by the wind."};
/* The beta and the hydrology and snow tools pick their own scales. */
const RESEARCH_FIXED_SCALE=["moraine","drainage","wetness","depressions","avalanche","solar"];
const RESEARCH_PARAMS={
  scale:{label:"Scale",hint:"Fine reveals smaller features; broad compares a wider area around each point.",
    options:[["fine","Fine"],["balanced","Balanced"],["broad","Broad"]]},
  sunDate:{label:"Date",hint:"Clear-sky sunshine for one day, with shadows cast by the surrounding terrain.",
    options:[["355","Midwinter (Dec 21)"],["46","Late winter (Feb 15)"],["79","Spring equinox (Mar 20)"],["121","Late spring (May 1)"],
      ["172","Midsummer (Jun 21)"],["265","Autumn equinox (Sep 22)"],["today","Today"]]},
  wind:{label:"Wind from",hint:"Snow drifts onto slopes sheltered from this wind and is stripped from exposed ones.",
    options:[["0","North"],["45","Northeast"],["90","East"],["135","Southeast"],["180","South"],["225","Southwest"],["270","West"],["315","Northwest"]]}
};
function researchParamKeys(product){
  return [...(RESEARCH_FIXED_SCALE.includes(product)?[]:["scale"]),...(product==="solar"?["sunDate"]:[]),...(product==="wind"?["wind"]:[])];
}
/* Ramp looks can also wear the LiDAR Studio's palettes; class and category
   looks keep their own, since their colours carry meaning. */
const RESEARCH_RAMP_RANGES=["quantile","log","positive","symmetric"];
function researchPaletteChoices(product){
  const look=RESEARCH_LOOKS[product];if(!look) return [];
  const own=look.palettes.map(id=>({id,name:RESEARCH_PALETTES[id].name,stops:RESEARCH_PALETTES[id].stops}));
  const studio=typeof CSPLidarRender!=="undefined"?CSPLidarRender.PALETTES:null;
  return typeof CSPAnalysisLayers!=="undefined"?CSPAnalysisLayers.paletteChoices(own,studio,RESEARCH_RAMP_RANGES.includes(look.range)):own;
}
function researchStudioStops(id){
  if(typeof id!=="string"||!id.startsWith("studio:")||typeof CSPLidarRender==="undefined") return null;
  const palette=CSPLidarRender.PALETTES[id.slice(7)];return palette&&palette.stops||null;
}
function researchPaletteId(product,chosen){
  const look=RESEARCH_LOOKS[product];if(!look) return "standard";
  return researchPaletteChoices(product).some(p=>p.id===chosen)?chosen:look.palettes[0];
}
/* A CSS gradient for a palette chip or layer swatch. */
function researchPaletteCss(id,reverse){
  const palette=RESEARCH_PALETTES[id],stops=palette?.stops||researchStudioStops(id);
  const flip=t=>reverse?100-t:t;
  const list=stops?stops.map(([t,c])=>[flip(t*100),String(c).slice(0,7)]).sort((a,b)=>a[0]-b[0]).map(([t,c])=>`${c} ${+t.toFixed(2)}%`):
    palette?.classes?palette.classes.map(([,c],i,all)=>`${c} ${i/all.length*100}% ${(i+1)/all.length*100}%`):
    palette?.categories?palette.categories.map((c,i,all)=>`${c} ${i/all.length*100}% ${(i+1)/all.length*100}%`):
    palette?.tint?[`#ffffff 0%`,`${palette.tint} 60%`,`#1a0d0a 100%`]:null;
  return list?`linear-gradient(90deg,${list.join(",")})`:"";
}
/* Legacy products have one fixed colour scheme; this stands in for it in menus. */
function researchProductSwatch(product){
  if(RESEARCH_LOOKS[product]) return researchPaletteCss(RESEARCH_LOOKS[product].palettes[0]);
  if(["lrm","tpi","residual","curvature"].includes(product)) return "linear-gradient(90deg,#4191f5,#f5f8fa,#f25b4c)";
  if(product==="northness") return "linear-gradient(90deg,#f5463d,#d6f53d,#3df5a0,#3d8cf5,#c63df5,#f5463d)";
  if(product==="flood") return "linear-gradient(90deg,#cb3df0,#f0b43d)";
  return "linear-gradient(90deg,#3d8cf5,#45f0a4,#f0c43d)";
}
function researchHex(hex){ const n=parseInt(hex.slice(1),16);return [(n>>16)&255,(n>>8)&255,n&255] }
function researchRamp(stops){
  const parsed=stops.map(([t,hex])=>[t,researchHex(hex)]);
  return t=>{
    if(!(t>parsed[0][0])) return parsed[0][1];
    for(let i=1;i<parsed.length;i++) if(t<=parsed[i][0]){
      const [t0,a]=parsed[i-1],[t1,b]=parsed[i],f=(t-t0)/(t1-t0||1);
      return [a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f,a[2]+(b[2]-a[2])*f];
    }
    return parsed[parsed.length-1][1];
  };
}
function researchCss(rgb){ return `rgb(${rgb.map(Math.round).join(",")})` }
/* Hillshade of the analysed DEM, 0..1, for mixing into the colors. */
function researchHillshade(elevation,width,height,resolution){
  const out=new Float32Array(width*height),res=resolution/reliefZFactor(resolution);
  const az=315*Math.PI/180,alt=45*Math.PI/180,sa=Math.sin(alt),ca=Math.cos(alt),sz=Math.sin(az),cz=Math.cos(az);
  const at=(x,y,z)=>{const v=elevation[Math.max(0,Math.min(height-1,y))*width+Math.max(0,Math.min(width-1,x))];return v===v?v:z};
  for(let y=0;y<height;y++) for(let x=0;x<width;x++){
    const i=y*width+x,z=elevation[i];if(z!==z){out[i]=1;continue}
    const a=at(x-1,y-1,z),b=at(x,y-1,z),c=at(x+1,y-1,z),d=at(x-1,y,z),f=at(x+1,y,z),g=at(x-1,y+1,z),h=at(x,y+1,z),k=at(x+1,y+1,z);
    const east=((c+2*f+k)-(a+2*d+g))/(8*res),north=-((g+2*h+k)-(a+2*b+c))/(8*res);
    out[i]=Math.max(0,Math.min(1,(sa-east*ca*sz-north*ca*cz)/Math.sqrt(1+east*east+north*north)));
  }
  return out;
}
/* Legacy research products keep their original colors and keys. */
function researchLegacyColours(result,product){
  const data=result.data,secondary=result.secondary;
  const signed=["lrm","tpi","residual","curvature"].includes(product);
  const lo=researchQuantile(data,.03),hi=researchQuantile(data,.97),span=signed?Math.max(Math.abs(lo||0),Math.abs(hi||0),1e-9):Math.max(hi||0,1e-9);
  const hsv=(h,s,v)=>{ h=((h%360)+360)%360;const c=v*s,x=c*(1-Math.abs((h/60)%2-1)),m=v-c;let r=0,g=0,b=0;
    if(h<60){r=c;g=x}else if(h<120){r=x;g=c}else if(h<180){g=c;b=x}else if(h<240){g=x;b=c}else if(h<300){r=x;b=c}else{r=c;b=x}
    return [(r+m)*255,(g+m)*255,(b+m)*255] };
  const colourAt=(value,eastness)=>{
    let rgb,alpha=.72;
    if(product==="northness"&&Number.isFinite(eastness)){
      const aspect=(Math.atan2(eastness,value)*180/Math.PI+360)%360;rgb=hsv(aspect,0.72,0.96);alpha=.66;
    }else if(product==="glacial"||product==="moraine"||product==="flood"){
      const t=Math.max(0,Math.min(1,value));rgb=product!=="flood"?hsv(205-165*t,.72,.92):hsv(292-112*t,.76,.94);alpha=t<.25?0:.18+.66*t;
    }else if(signed){
      const t=Math.max(-1,Math.min(1,value/span)),a=Math.abs(t);rgb=t<0?[65+(245-65)*(1-a),145+(248-145)*(1-a),245+(250-245)*(1-a)]:[245+(242-245)*a,248+(91-248)*a,250+(76-250)*a];alpha=.18+.62*a;
    }else{
      const t=Math.max(0,Math.min(1,(value-Math.min(0,lo||0))/span));rgb=hsv(215-165*t,.68,.94);alpha=.16+.66*t;
    }
    return {rgb,alpha};
  };
  const directional=product==="northness",screen=product==="glacial"||product==="moraine"||product==="flood";
  const start=directional?0:signed?-span:screen?0:Math.min(0,lo||0),end=directional?360:screen?1:signed?span:start+span;
  const stops=Array.from({length:17},(_,i)=>{
    const value=start+(end-start)*i/16,a=value*Math.PI/180;
    const {rgb}=colourAt(directional?Math.cos(a):value,directional?Math.sin(a):undefined);
    return `${researchCss(rgb)} ${i/16*100}%`;
  });
  const tick=v=>["lrm","tpi","tri"].includes(product)?`${+(v/.3048).toFixed(1)} ft`:
    product==="residual"?`${+v.toPrecision(3)} σ`:product==="curvature"?`${+(v*.3048).toPrecision(3)} /ft`:+v.toPrecision(3);
  const legend={name:result.label,bar:`linear-gradient(90deg,${stops.join(",")})`,
    labels:directional?["N","E","S","W","N"]:product==="moraine"?["Low support","Possible lead","Strong lead"]:screen?["0","Candidate score","1"]:[tick(start),signed?"0":"",tick(end)]};
  return {colourAt:(value,i)=>colourAt(value,secondary?.[i]),legend};
}
/* One color function per look: (value, index) -> {rgb, alpha}. */
function researchLookColours(result,product,paletteId,reverse){
  const look=RESEARCH_LOOKS[product],data=result.data,secondary=result.secondary;
  const palette=RESEARCH_PALETTES[paletteId]||{stops:researchStudioStops(paletteId)||RESEARCH_PALETTES[look.palettes[0]].stops};
  const alpha=look.alpha??1,name=result.label;
  if(look.range==="categories"){
    const colors=palette.categories.map(researchHex),classes=CSPTerrainAnalysis.GEOMORPHON_CLASSES;
    const order=[2,3,4,5,6,7,8,9,10,1],width=100/order.length;
    return {colourAt:value=>value>=1&&value<=10?{rgb:colors[value-1],alpha}:null,
      legend:{name,bar:`linear-gradient(90deg,${order.map((c,i)=>`${palette.categories[c-1]} ${i*width}% ${(i+1)*width}%`).join(",")})`,labels:[classes[2],classes[6],classes[10]+" · flat"]}};
  }
  if(look.range==="classes"){
    const bands=palette.classes.map(([value,hex])=>[value,researchHex(hex)]),top=bands[bands.length-1][0]+10,from=bands[0][0];
    const pos=v=>(v-from)/(top-from)*100;
    return {colourAt:value=>{
        if(!(value>=from)) return null;
        let rgb=bands[0][1];for(const [edge,c] of bands) if(value>=edge) rgb=c;
        return {rgb,alpha};
      },
      legend:{name,bar:`linear-gradient(90deg,${bands.map(([v,c],i)=>`${researchCss(c)} ${pos(v)}% ${pos(i+1<bands.length?bands[i+1][0]:top)}%`).join(",")})`,
        labels:[`${from}°`,"35–45°",`${bands[bands.length-1][0]}°+`]}};
  }
  if(look.range==="rrim"){
    const tint=researchHex(palette.tint),lo=researchQuantile(data,.02),hi=researchQuantile(data,.98),span=Math.max(1e-6,hi-lo);
    const color=(t,s)=>{const shade=.12+.88*t;return [0,1,2].map(c=>(255+(tint[c]-255)*s)*shade)};
    return {colourAt:(value,i)=>{
        const t=Math.max(0,Math.min(1,(value-lo)/span)),s=Math.max(0,Math.min(1,(secondary?.[i]||0)/45));
        return {rgb:color(t,s),alpha};
      },
      legend:{name,bar:`linear-gradient(90deg,${researchCss(color(0,.2))},${researchCss(color(.55,1))},${researchCss(color(1,.15))})`,labels:look.labels}};
  }
  const forward=researchRamp(palette.stops||RESEARCH_PALETTES[look.palettes[0]].stops),ramp=reverse?t=>forward(1-t):forward;
  let lo,hi;
  if(look.range==="log"){
    const cellArea=result.metadata?.cellArea||1,peak=result.metadata?.maxArea||cellArea*100;
    lo=Math.log(Math.max(cellArea*250,peak*6e-4));hi=Math.max(lo+1,Math.log(peak));
    const start=Math.exp(lo);
    return {colourAt:value=>{
        if(!(value>=start)) return null;
        const t=Math.max(0,Math.min(1,(Math.log(value)-lo)/(hi-lo)));return {rgb:ramp(t),alpha:.45+.55*t};
      },
      legend:{name,bar:`linear-gradient(90deg,${[0,.25,.5,.75,1].map(t=>`${researchCss(ramp(t))} ${t*100}%`).join(",")})`,
        labels:[researchArea(start),"",researchArea(Math.exp(hi))]}};
  }
  if(look.range==="positive"){
    const positive=data.filter(v=>v>0),deep=Math.max(.05,researchQuantile(positive.length?positive:[1],.98));
    return {colourAt:value=>{
        if(!(value>0)) return null;
        const t=Math.max(0,Math.min(1,value/deep));return {rgb:ramp(t),alpha:.35+.6*t};
      },
      legend:{name,bar:`linear-gradient(90deg,${[0,.5,1].map(t=>`${researchCss(ramp(t))} ${t*100}%`).join(",")})`,labels:["Shallow","",`${researchFeet(deep)}+`]}};
  }
  if(look.range==="symmetric"){
    const span=Math.max(1,Math.abs(researchQuantile(data,.02)),Math.abs(researchQuantile(data,.98)));lo=-span;hi=span;
  }else{lo=researchQuantile(data,.02);hi=researchQuantile(data,.98);if(!(hi>lo)) hi=lo+1e-6}
  const labels=look.labels||(product==="solar"?[`${lo.toFixed(1)} kWh/m²`,"",`${hi.toFixed(1)} kWh/m²`]:["","",""]);
  return {colourAt:value=>({rgb:ramp(Math.max(0,Math.min(1,(value-lo)/(hi-lo)))),alpha}),
    legend:{name,bar:`linear-gradient(90deg,${[0,.25,.5,.75,1].map(t=>`${researchCss(ramp(t))} ${t*100}%`).join(",")})`,labels}};
}
function researchColourRaster(result,product,options={}){
  const canvas=document.createElement("canvas");canvas.width=result.width;canvas.height=result.height;
  const image=canvas.getContext("2d").createImageData(result.width,result.height),data=result.data;
  const look=RESEARCH_LOOKS[product]?researchLookColours(result,product,researchPaletteId(product,options.palette),!!options.reverse):researchLegacyColours(result,product);
  const relief=Math.max(0,Math.min(1,(options.relief||0)/100)),shade=relief>0&&options.hillshade;
  for(let i=0;i<data.length;i++){
    const value=data[i],o=i*4;if(!Number.isFinite(value)) continue;
    const color=look.colourAt(value,i);if(!color||!(color.alpha>0)) continue;
    /* Multiply-style relief: full shadow keeps a quarter of the color. */
    const k=shade?1-relief+relief*(.25+.95*shade[i]):1;
    image.data[o]=Math.min(255,Math.round(color.rgb[0]*k));image.data[o+1]=Math.min(255,Math.round(color.rgb[1]*k));
    image.data[o+2]=Math.min(255,Math.round(color.rgb[2]*k));image.data[o+3]=Math.round(255*color.alpha);
  }
  canvas.getContext("2d").putImageData(image,0,0);return {url:canvas.toDataURL("image/png"),legend:look.legend};
}
function runResearchWorker(payload){
  if(researchWorker) researchWorker.terminate();
  researchWorker=new Worker("research-worker.js");
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{researchWorker?.terminate();researchWorker=null;reject(new Error("Analysis timed out."))},30000);
    researchWorker.onmessage=e=>{ if(e.data.id!==payload.id) return;clearTimeout(timer);researchWorker.terminate();researchWorker=null;e.data.ok?resolve(e.data):reject(new Error(e.data.error)) };
    researchWorker.onerror=e=>{clearTimeout(timer);researchWorker.terminate();researchWorker=null;reject(new Error(e.message||"Analysis worker failed."))};
    researchWorker.postMessage(payload,[payload.grid.buffer]);
  });
}
function shouldOffloadResearch(raster){
  const mobile=matchMedia("(pointer: coarse)").matches||(navigator.maxTouchPoints>1&&innerWidth<900);
  return CSPResearchAnalysis.shouldOffload({connected:PROXY,mobile,cells:raster.grid.length,
    hardwareConcurrency:navigator.hardwareConcurrency||0});
}
async function runResearchServer(payload){
  if(researchServerController) researchServerController.abort();
  const controller=new AbortController();researchServerController=controller;
  let timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;controller.abort()},45000);
  const query=new URLSearchParams({product:payload.product,scale:payload.scale,width:String(payload.width),
    height:String(payload.height),resolution:String(payload.resolution)});
  const extra=payload.options||{};
  if(Number.isFinite(extra.dayOfYear)) query.set("day",String(extra.dayOfYear));
  if(Number.isFinite(extra.latitude)) query.set("lat",extra.latitude.toFixed(3));
  if(Number.isFinite(extra.windAzimuth)) query.set("wind",String(extra.windAzimuth));
  try{
    const response=await fetch(api("/api/terrain/analyze?"+query),{method:"POST",body:payload.grid,
      headers:{"Content-Type":"application/octet-stream"},cache:"no-store",signal:controller.signal});
    if(!response.ok) throw new Error(`M2 analysis HTTP ${response.status}`);
    return {id:payload.id,ok:true,...CSPResearchAnalysis.decodeResult(await response.arrayBuffer())};
  }catch(error){
    if(timedOut) throw new Error("M2 analysis timed out");
    throw error;
  }finally{
    clearTimeout(timer);if(researchServerController===controller) researchServerController=null;
  }
}
async function runAdaptiveResearch(payload,preferServer){
  if(preferServer){
    try{ return {...await runResearchServer(payload),engine:"M2 terrain engine"} }
    catch(error){
      if(error&&error.name==="AbortError") throw error;
      return {...await runResearchWorker(payload),engine:"browser worker fallback"};
    }
  }
  return {...await runResearchWorker(payload),engine:"browser worker"};
}
function researchDayOfYear(value){
  if(value!=="today") return +value;
  const now=new Date();return Math.round((Date.UTC(now.getFullYear(),now.getMonth(),now.getDate())-Date.UTC(now.getFullYear(),0,0))/864e5);
}
function researchRequestOptions(entry){
  if(entry.product==="solar") return {dayOfYear:researchDayOfYear(entry.params.sunDate),latitude:map.getCenter().lat};
  if(entry.product==="wind") return {windAzimuth:+entry.params.wind};
  return {};
}

/* ------------------------------------------------------- analysis layers */
function researchStyleDefaults(product){
  const look=RESEARCH_LOOKS[product];
  return {palette:look?look.palettes[0]:"standard",blend:look?.blend||"normal",opacity:.82,relief:0,reverse:false,visible:true};
}
function researchEntry(id){ return researchStack.find(entry=>entry.id===id)||null }
function researchLabel(entry){
  const name=RESEARCH_LABELS[entry.product]||"Surface analysis";
  if(entry.product==="solar") return `${name} · ${(RESEARCH_PARAMS.sunDate.options.find(o=>o[0]===entry.params.sunDate)||[,""])[1].replace(/ \(.*\)/,"")}`;
  if(entry.product==="wind") return `${name} · ${(RESEARCH_PARAMS.wind.options.find(o=>o[0]===entry.params.wind)||[,""])[1]}`;
  return name;
}
/* What the layer views draw for one entry. */
function researchDescribe(entry){
  const look=RESEARCH_LOOKS[entry.product],style=entry.style,palettes=researchPaletteChoices(entry.product);
  const ramp=look&&RESEARCH_RAMP_RANGES.includes(look.range);
  return {id:entry.id,product:entry.product,label:researchLabel(entry),hint:RESEARCH_HINTS[entry.product]||"",
    visible:style.visible,opacity:style.opacity,blend:style.blend,relief:style.relief,reverse:ramp?style.reverse:null,
    palette:style.palette,palettes:palettes.map(p=>({id:p.id,name:p.name,css:researchPaletteCss(p.id)})),
    swatch:look?researchPaletteCss(style.palette,ramp&&style.reverse):entry.legend?.bar||researchProductSwatch(entry.product),
    params:researchParamKeys(entry.product).map(key=>({key,label:RESEARCH_PARAMS[key].label,hint:RESEARCH_PARAMS[key].hint,
      options:RESEARCH_PARAMS[key].options,value:entry.params[key]})),
    status:entry.status,message:entry.message};
}
const researchViews=[];
function researchHost(extra){
  return {...extra,
    layers:()=>researchStack.slice().reverse().map(researchDescribe),
    catalog:()=>RESEARCH_CATALOG.map(group=>({group:group.group,items:group.items.map(([id,label])=>({id,label,hint:RESEARCH_HINTS[id],swatch:researchProductSwatch(id)}))})),
    add:product=>addResearchLayer(product),
    update:(id,patch)=>updateResearchLayer(id,patch),
    remove:id=>removeResearchLayer(id),
    move:(id,direction)=>moveResearchLayer(id,direction)};
}
function researchChanged({layers=true}={}){
  for(const view of researchViews) view.refresh();
  paintResearchInfo();
  const ready=researchStack.filter(entry=>entry.overlay);
  setCount("research",ready.length?ready.length===1?researchLabel(ready[0]):`${ready.length} layers`:"");
  if(layers){paintMapReadoutKeys();paintCursorAnalysis();announceLayers()}
}
function addResearchLayer(product){
  if(!RESEARCH_LABELS[product]||researchStack.length>=CSPAnalysisLayers.MAX_LAYERS) return null;
  const style=CSPAnalysisLayers.normalizeStyle(researchStyles[product],researchStyleDefaults(product));
  style.palette=researchPaletteId(product,style.palette);style.visible=true;
  const params={};for(const key of researchParamKeys(product)) params[key]=researchParamDefaults[key];
  const entry={id:"a"+(++researchSeq),product,params,style,overlay:null,last:null,legend:null,url:"",status:"busy",message:"Reading elevation…"};
  researchStack.push(entry);researchFocus=entry.id;
  runResearchLayers([entry.id]);researchChanged({layers:false});
  return entry.id;
}
function updateResearchLayer(id,patch){
  const entry=researchEntry(id);if(!entry) return;
  if(patch.params){
    Object.assign(entry.params,patch.params);Object.assign(researchParamDefaults,patch.params);saveResearchPrefs();
    researchFocus=id;runResearchLayers([id],{quiet:true});researchChanged({layers:false});return;
  }
  const before=entry.style;
  entry.style=CSPAnalysisLayers.normalizeStyle(Object.assign({},before,patch),researchStyleDefaults(entry.product));
  if(patch.palette!==undefined) entry.style.palette=researchPaletteId(entry.product,entry.style.palette);
  const {visible,...kept}=entry.style;researchStyles[entry.product]=kept;saveResearchPrefs();
  /* Colours need a fresh image; blend, opacity and visibility do not. */
  if(entry.style.palette!==before.palette||entry.style.reverse!==before.reverse||entry.style.relief!==before.relief) scheduleResearchRepaint(entry);
  else placeResearchOverlay(entry);
  researchChanged();
}
function removeResearchLayer(id){
  const entry=researchEntry(id);if(!entry) return;
  if(entry.overlay) map.removeLayer(entry.overlay);
  researchStack=researchStack.filter(e=>e!==entry);researchPending.delete(id);
  if(researchFocus===id) researchFocus=researchStack.at(-1)?.id||null;
  if(!researchStack.length){++researchToken;clearTimeout(researchLiveTimer)}
  restackResearch();researchChanged();
}
function moveResearchLayer(id,direction){
  const index=researchStack.findIndex(entry=>entry.id===id),target=index+direction;
  if(index<0||target<0||target>=researchStack.length) return;
  [researchStack[index],researchStack[target]]=[researchStack[target],researchStack[index]];
  restackResearch();researchChanged();
}
/* Analysis layers sit above the terrain, in stack order. */
function researchZ(index){ return Math.max(455,(gpuTerrainOrderZ??0)+2)+index*2 }
function restackResearch(){ researchStack.forEach((entry,index)=>entry.overlay?.setZIndex(researchZ(index))) }

/* Blending needs the terrain and basemap as its backdrop, and those live in
   the tile pane; the overlay pane is its own compositing group. A normal
   layer stays in the overlay pane so it keeps its place in the layer stack. */
function placeResearchOverlay(entry){
  if(!entry.last||!entry.url) return;
  const {blend,opacity,visible}=entry.style,pane=blend==="normal"?"overlayPane":"tilePane",bounds=entry.last.bounds;
  if(entry.overlay&&entry.overlay.options.pane===pane&&entry.overlay.getBounds().equals(bounds)){
    if(entry.overlay._url!==entry.url) entry.overlay.setUrl(entry.url);
  }else{
    if(entry.overlay) map.removeLayer(entry.overlay);
    entry.overlay=L.imageOverlay(entry.url,bounds,{opacity:0,zIndex:researchZ(researchStack.indexOf(entry)),interactive:false,alt:researchLabel(entry),pane,className:"csp-research-overlay"}).addTo(map);
  }
  entry.overlay.setOpacity(visible?opacity:0);
  const element=entry.overlay.getElement();if(element){element.style.mixBlendMode=blend;element.dataset.analysis=entry.product}
}
/* Recolour the cached result: palette, relief shading and reverse are
   instant and never touch the elevation or the worker. */
function repaintResearch(entry){
  const last=entry.last;if(!last) return;
  const relief=entry.style.relief,capture=last.capture;
  if(relief>0&&!capture.hillshade) capture.hillshade=researchHillshade(capture.elevation,capture.width,capture.height,capture.resolution);
  const coloured=researchColourRaster(last.result,entry.product,{palette:entry.style.palette,reverse:entry.style.reverse,relief,hillshade:capture.hillshade});
  entry.url=coloured.url;entry.legend=coloured.legend;
  placeResearchOverlay(entry);
}
const researchRepaints=new Set();let researchRepaintFrame=0;
function scheduleResearchRepaint(entry){
  researchRepaints.add(entry);
  if(!researchRepaintFrame) researchRepaintFrame=requestAnimationFrame(()=>{
    researchRepaintFrame=0;const due=[...researchRepaints];researchRepaints.clear();
    for(const e of due) if(researchStack.includes(e)) repaintResearch(e);
    researchChanged();
  });
}

/* One elevation capture feeds every layer waiting on it. A newer request
   supersedes an older one but inherits its unfinished layers. */
const researchPending=new Set();
/* The last finished elevation capture, reused while the view is unchanged so
   a second layer or a new setting appears without re-reading the terrain. */
let researchCapture=null;
const researchViewKey=()=>`${map.getBounds().toBBoxString()}|${map.getZoom()}|${gpuTerrainEnabled}|${map.getSize().x}x${map.getSize().y}`;
async function runResearchLayers(ids,{quiet=false}={}){
  ids.forEach(id=>researchPending.add(id));
  const token=++researchToken,waiting=()=>researchStack.filter(entry=>researchPending.has(entry.id));
  for(const entry of waiting()){entry.status="busy";entry.message=entry.last?"Updating for this view…":"Reading elevation…"}
  researchChanged({layers:false});
  let source;
  try{
    /* Following the map should feel immediate: analyse what has loaded after
       a short wait rather than holding for the last refinement. */
    let capture=researchCapture&&researchCapture.key===researchViewKey()?researchCapture:null;
    if(!capture){
      source=await researchElevationSource(quiet?4000:15000);if(token!==researchToken) return;
      const raster=researchElevationGrid(source.layer);
      capture={key:researchViewKey(),elevation:raster.grid.slice(),width:raster.width,height:raster.height,resolution:raster.resolution,hillshade:null,raster:{...raster,grid:null}};
      researchCapture=capture;
    }
    const raster=capture.raster,preferServer=shouldOffloadResearch({grid:capture.elevation});
    for(const entry of waiting()){
      if(!entry.last) entry.message="Analyzing this view…";researchChanged({layers:false});
      try{
        const result=await runAdaptiveResearch({id:token,product:entry.product,scale:entry.params.scale||"balanced",grid:capture.elevation.slice(),
          width:raster.width,height:raster.height,resolution:raster.resolution,options:researchRequestOptions(entry)},preferServer);
        if(token!==researchToken) return;
        researchPending.delete(entry.id);if(!researchStack.includes(entry)) continue;
        entry.last={result,capture,bounds:raster.bounds,engine:result.engine};entry.status="ready";entry.message="";
        repaintResearch(entry);
      }catch(error){
        if(token!==researchToken) return;
        researchPending.delete(entry.id);entry.status="error";entry.message=error.message||"Analysis failed.";
      }
      researchChanged();
    }
  }catch(error){
    if(token!==researchToken) return;
    for(const entry of waiting()){researchPending.delete(entry.id);entry.status=entry.last?"ready":"error";entry.message=entry.last?"":error.message||"No elevation for this view."}
    if(quiet&&researchStack.some(entry=>entry.last)) researchNotice=error.message||"Could not update this view.";
    researchChanged();
  }
  finally{ if(source?.temporary) map.removeLayer(source.layer) }
}
let researchNotice="";
/* Details for the layer most recently added or changed. */
function paintResearchInfo(){
  const out=$("#researchOut");if(!out) return;
  const entry=researchEntry(researchFocus)||researchStack.at(-1);
  if(!entry){out.textContent=researchNotice||"Choose an analysis to reveal it in this view.";return}
  if(!entry.last){
    out.innerHTML=entry.status==="error"?`<span class="warn">${esc(entry.message)}</span>`:`<span class="spin"></span> ${esc(entry.message||"Analyzing this view…")}`;return;
  }
  const {result,capture}=entry.last,raster=capture.raster,meta=result.metadata||{},product=entry.product;
  const caution=result.notice?.warning||meta.caution||"Morphology is observational and must be checked against mapped geology and field evidence.";
  const extra=product==="solar"?`<div class="fr"><span class="fk">Day</span><span class="fv">${meta.daylightHours} h daylight · noon sun ${meta.noonSunAltitude}°</span></div>`:
    product==="wind"?`<div class="fr"><span class="fk">Wind from</span><span class="fv">${esc((RESEARCH_PARAMS.wind.options.find(o=>o[0]===entry.params.wind)||[,""])[1])} · ${researchFeet(meta.searchMetres)} upwind</span></div>`:
    product==="avalanche"?`<div class="fr"><span class="fk">30–45° ground</span><span class="fv">${Math.round(meta.startZoneShare*100)}% of this view</span></div>`:
    meta.radiusMetres?`<div class="fr"><span class="fk">Search radius</span><span class="fv">${researchFeet(meta.radiusMetres)}</span></div>`:"";
  const busy=researchStack.some(e=>e.status==="busy");
  const live=busy?'<span class="spin"></span>Updating for this view…':researchNotice?esc(researchNotice):$("#researchLive").checked?"Follows the map: pan or zoom and it re-analyzes.":"";
  out.innerHTML=`<div class="fr"><span class="fk">Layer</span><span class="fv">${esc(result.label)}</span></div>`+
    `<div class="fr"><span class="fk">Sampling</span><span class="fv">${(raster.resolution*3.28084).toFixed(1)} ft/pixel · z${raster.z}</span></div>`+extra+
    `<div class="fr"><span class="fk">Elevation used</span><span class="fv">${esc(raster.provenance.join(" + "))}${raster.provisional?" (still refining at capture)":""}</span></div>`+
    `<div class="note">Sample spacing is not survey accuracy. Mixed sources and survey edges can affect terrain derivatives.</div>`+
    `<div class="fr"><span class="fk">Scale</span><span class="fv">${esc(entry.params.scale||"Automatic")}</span></div>`+
    `<div class="note">${esc(caution)}</div><div class="research-live" aria-live="polite">${live}</div>`;
}
/* Live mode: once a layer is showing, panning or zooming re-runs the stack
   for the new view after the map settles. */
function scheduleResearchLive(delay=650){
  clearTimeout(researchLiveTimer);
  if(!researchStack.length||!$("#researchLive").checked||map3d) return;
  researchLiveTimer=setTimeout(()=>{
    if(!researchStack.length||map3d) return;
    researchNotice="";runResearchLayers(researchStack.map(entry=>entry.id),{quiet:true});
  },delay);
}
map.on("moveend",()=>scheduleResearchLive());
$("#researchLive").onchange=()=>{saveResearchPrefs();paintResearchInfo()};
function clearResearchLayers(message){
  ++researchToken;clearTimeout(researchLiveTimer);researchPending.clear();
  for(const entry of researchStack) if(entry.overlay) map.removeLayer(entry.overlay);
  researchStack=[];researchFocus=null;researchNotice=message||"";
  researchChanged();
}
$("#researchReset").onclick=()=>{
  researchServerController?.abort();researchServerController=null;
  $("#researchLive").checked=true;researchStyles={};researchParamDefaults={scale:"balanced",sunDate:"355",wind:"225"};
  clearResearchLayers("Analysis reset. Choose an analysis to reveal it in this view.");saveResearchPrefs();
};
if(window.CSPAnalysisLayers){
  const view=CSPAnalysisLayers.mount($("#researchLayers"),researchHost({empty:"Nothing analyzed yet. Each analysis reads the elevation in view and draws above the terrain."}));
  if(view) researchViews.push(view);
}
/* Cursor readout: the analysed value under the pointer, from the cached
   raster. Rows are linear in Web-Mercator y, like the grid itself. */
function researchValueAt(entry,ll){
  const last=entry.last;if(!last||!ll) return null;
  const b=last.bounds,width=last.capture.width,height=last.capture.height;
  const mx=lng=>(lng+180)/360,my=lat=>{const s=Math.sin(lat*Math.PI/180);return .5-Math.log((1+s)/(1-s))/(4*Math.PI)};
  const x=Math.floor((mx(ll.lng)-mx(b.getWest()))/(mx(b.getEast())-mx(b.getWest()))*width);
  const y=Math.floor((my(ll.lat)-my(b.getNorth()))/(my(b.getSouth())-my(b.getNorth()))*height);
  if(x<0||y<0||x>=width||y>=height) return null;
  const i=y*width+x,value=last.result.data[i];
  return Number.isFinite(value)?{value,secondary:last.result.secondary?.[i]}:null;
}
function paintCursorAnalysis(){
  const element=$("#cursorAnalysis");if(!element) return;
  const parts=[];
  if(cursorLocation) for(const entry of researchStack.slice().reverse()){
    const look=RESEARCH_LOOKS[entry.product];if(!look||!entry.style.visible||!(entry.style.opacity>0)) continue;
    const sample=researchValueAt(entry,cursorLocation);if(sample) parts.push(look.read(sample.value,sample.secondary));
  }
  const text=parts.filter(Boolean).join(" · ");
  element.hidden=!text;if(element.textContent!==text) element.textContent=text;
}

