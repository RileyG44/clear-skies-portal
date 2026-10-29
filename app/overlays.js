/* ================================================= labels & reference overlays
   Drawn on top of the imagery, each independently toggleable. Everything here
   is keyless and sends CORS, so these go direct rather than through the proxy —
   the exception is anything that does not, which is routed and noted below.

   Deliberately NOT OpenStreetMap's own tiles: their tile-usage policy forbids
   it and the server answers 418. Esri's free reference layers are the
   keyless substitute.                                                        */
/* Overlay groups, in menu order, each with the sidebar route that shows it. */
const OVERLAY_GROUP_ROUTES={"Imagery":"satellite","Labels & reference":"labels","Conditions":"conditions","Geology & hazards":"geology","Past landscapes":"past"};
const OVERLAYS = [
  /* Drawn low so the analytical terrain shaders still composite above imagery,
     which is the ordering check-static already pins. */
  { id:"imagery", group:"Imagery", name:"Satellite imagery", via:"Esri", sw:"#7d8f6a", z:20,
    url:ESRI_IMAGERY, attr:ESRI_IMAGERY_ATTR, maxZoom:19, sharp:true,
    note:"Best-available global mosaic, sub-metre over most populated land. Display only under Esri's terms: not cached or re-served." },

  { id:"s2cloudless", group:"Imagery", name:"Sentinel-2 cloudless", via:"EOX", sw:"#6a86a8", z:10,
    url:EOX_S2_CLOUDLESS, attr:EOX_ATTR, maxZoom:16, sharp:true,
    note:`Cloud-free 33 ft composite for ${EOX_S2_YEAR}, complete over all land. Coarser than the Esri mosaic but never cloudy and never missing.` },

  /* Sparse, not global: the Open Data Program publishes on disaster
     activations only, so this indexes where sub-metre imagery exists at all
     rather than pretending to be a layer. Footprints, dates and a link to the
     COGs - the pixels are JPEG-compressed GeoTIFFs in per-scene UTM zones,
     which needs a warp the portal does not have yet. */
  { id:"maxarvhr", group:"Imagery", name:"Maxar VHR coverage", via:"Maxar Open Data", sw:"#c88fb0", z:560,
    geoLoader:()=>loadMaxarFootprints(), popupKind:"maxar", nonCommercial:true,
    attr:"Maxar Open Data Program (CC-BY-NC-4.0)",
    note:"Where 12–20 inch disaster imagery exists, with dates. Licensed CC-BY-NC-4.0 \u2014 non-commercial use only." },

  { id:"roads", group:"Labels & reference", name:"Roads & streets", via:"Esri", sw:"#e0a060", z:520,
    url:"https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}",
    attr:"Esri, HERE, Garmin", maxZoom:19 },

  /* USGS National Map trails. Layer 37 is Trails, 24 is Trail labels, and the
     service is the same host already used for the GNIS peaks and named places,
     so it is already in the snapshot allowlist. Covers national park and
     national forest alike - USFS's own trails service was tested and is far
     sparser, and empty over Rainier because that is a Park, not a Forest.
     Drawn above roads: on a hike the trail is the thing you are following. */
  { id:"trails", group:"Labels & reference", name:"Trails & paths", via:"USGS", sw:"#d2691e", z:525,
    dynamic:"https://carto.nationalmap.gov/arcgis/rest/services/transportation/MapServer/export",
    layers:"37,24", attr:"USGS The National Map", minZoom:10, maxZoom:19 },

  { id:"places", group:"Labels & reference", name:"Cities & boundaries", via:"Esri", sw:"#9fb4d0", z:530,
    url:"https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
    attr:"Esri", maxZoom:19 },

  /* Esri splits its Canvas basemap into a label-free Base and a separate
     Reference layer, so the labels overlay is that Reference - and it has to
     follow the map theme, or dark ink lands on a dark basemap. */
  { id:"labels", group:"Labels & reference", name:"Place labels", via:"Esri", sw:"#d8dee8", z:540, themed:true,
    urlFor:theme=>ESRI_CANVAS+"/World_"+(theme==="dark"?"Dark":"Light")+"_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
    attr:ESRI_ATTR, maxZoom:16 },

  { id:"water", group:"Labels & reference", name:"Rivers & lakes", via:"USGS NHD", sw:"#5aa9e6", z:510,
    url:"https://basemap.nationalmap.gov/arcgis/rest/services/USGSHydroCached/MapServer/tile/{z}/{y}/{x}",
    referenceExport:"https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/export",
    layers:"2,4,5,6,7,8,9,10,11,12", minDetailScale:577790.554289,
    note:"USGS NHD feature labels render at display density where available. Cached USGS hydrography remains visible while detail loads or is unavailable.",
    attr:"USGS The National Map — NHD", maxZoom:19 },

  /* GNIS is a dynamic MapServer rather than cached tiles, so each tile is an
     export request for its own bbox. Layer 5 is Landforms, which is where
     summits, ridges, gaps and glaciers live; layer 3 is Populated Places. */
  { id:"peaks", group:"Labels & reference", name:"Peaks & landforms", via:"USGS GNIS", sw:"#c9a227", z:550,
    dynamic:"https://carto.nationalmap.gov/arcgis/rest/services/geonames/MapServer/export",
    layers:"5", attr:"USGS GNIS", minZoom:10, maxZoom:19 },

  { id:"gnames", group:"Labels & reference", name:"Named places", via:"USGS GNIS", sw:"#b0894f", z:545,
    dynamic:"https://carto.nationalmap.gov/arcgis/rest/services/geonames/MapServer/export",
    layers:"3", attr:"USGS GNIS", minZoom:9, maxZoom:19 },

  /* Primary-source Quaternary reference layers. The hosted polygons are
     simplified by the service at query time so toggling them stays well under
     1 MB rather than transferring multi-megabyte source geometry. They are
     deliberately labelled as references/reconstructions: neither polygon is
     a flood-depth, event-timing, or modern-water observation. */
  { id:"waice", group:"Past landscapes", name:"Continental ice limits", via:"WGS · 1:250k", sw:"#7ed9ee", z:493,
    geojson:"https://gis.dnr.wa.gov/site1/rest/services/Public_Geology/250k_Surface_Geology/MapServer/0/query?where=1%3D1&outFields=OBJECTID&returnGeometry=true&outSR=4326&maxAllowableOffset=0.001&geometryPrecision=5&f=geojson",
    geoStyle:{color:"#7ed9ee",weight:2.25,opacity:.95,lineCap:"round",lineJoin:"round"},
    lineWidth:{label:"Glacier / ice-limit border",min:.5,max:6,step:.25,default:2.25},
    attr:"Washington Geological Survey — Continental Ice Limits", minZoom:6, maxZoom:16,
    defaultOpacity:80,
    note:"Mapped late-Wisconsinan and older continental ice limits at 1:250,000; reference linework, not present-day ice." },

  { id:"waflood", group:"Past landscapes", name:"Ice Age flood extent", via:"WGS", sw:"#35bdd5", z:491,
    geojson:"https://services.arcgis.com/4x406oNViizbGo13/arcgis/rest/services/Ice_Age_Floods_National_Geologic_Trail_and_Sites/FeatureServer/2/query?where=1%3D1&outFields=ID&returnGeometry=true&outSR=4326&maxAllowableOffset=0.001&geometryPrecision=5&f=geojson",
    geoStyle:{color:"#25a9c4",weight:1.4,opacity:.95,fillColor:"#36c4de",fillOpacity:.44},
    attr:"Washington Geological Survey — Ice Age Floods Affected Area", defaultOpacity:42,
    note:"Regional affected-area reference only—not flood depth, timing, frequency, or a parcel-scale boundary." },

  { id:"paleolakes", group:"Past landscapes", name:"Pleistocene lakes", via:"EWU · IAFI", sw:"#6aaeff", z:492,
    geojson:"https://services1.arcgis.com/igNkUJZ7SGoMjDNi/arcgis/rest/services/GlacialH2O_V1/FeatureServer/0/query?where=POLY_TYPE%3D%27Lake%27&outFields=POLY_TYPE&returnGeometry=true&outSR=4326&maxAllowableOffset=0.001&geometryPrecision=5&f=geojson",
    geoStyle:{color:"#5c9df2",weight:1.2,opacity:.95,fillColor:"#69b7ff",fillOpacity:.42},
    lineWidth:{label:"Lake border",min:.5,max:6,step:.25,default:1.2},
    attr:"Eastern Washington University / Ice Age Floods Institute", defaultOpacity:48,
    note:"Interpretive EWU/IAFI reconstruction using circa-2010 lake boundaries; not an observed water-depth or age surface." },

  /* NADI-1 (Dalton et al. 2023) reconstructs the whole North American ice
     complex every 500 years in calendar ka. The bundled file is clipped to the
     Pacific Northwest and simplified to ~100 m, so it ships with the app rather
     than pulling 55 MB of continental shapefiles. One slice draws at a time: the
     best-estimate ice fill, its margin, and the MIN/MAX uncertainty envelopes.
     Regenerate with scripts/build-nadi1-cordilleran.py. */
  { id:"nadi1ice", group:"Past landscapes", name:"Cordilleran ice by age", via:"NADI-1 · 25–10.5 ka", sw:"#cfeefa", z:494,
    geojson:"./nadi1-cordilleran.json", styleKind:"nadi1",
    timeSlice:{label:"Ice margin at",unit:"ka",default:17.5,
      values:Array.from({length:30},(_,i)=>25-i*.5)},
    attr:"Dalton et al. 2023, NADI-1 — Quaternary Science Reviews 321 (CC BY 4.0)", defaultOpacity:85,
    note:"NADI-1 reconstruction in thousands of calendar years before present. Fill and white line are the best-estimate margin; red dashes the maximum and yellow dots the minimum plausible extent. A continental-scale synthesis — use the WGS ice limits for mapped local detail." },

  /* Macrostrat's cartographic tiles now send browser-safe CORS, so the global
     surface compilation works with or without the M2. Its blended map scales
     make it a regional context layer, not a measuring surface. */
  { id:"geology", group:"Geology & hazards", name:"Surface geology", via:"Macrostrat", sw:"#c98f6a", z:470, url:"https://tiles.macrostrat.org/carto/{z}/{x}/{y}.png",
    attr:"Macrostrat — CC BY 4.0", maxZoom:16, defaultOpacity:55,
    note:"Blends source maps at several scales for visual context; identify a point to see every contributing compilation and cite its original source." },

  { id:"sgmc", group:"Geology & hazards", name:"State geologic map", via:"USGS", sw:"#b06a5a", z:465, url:"https://mrdata.usgs.gov/mapcache/wmts/1.0.0/sgmc/default/GoogleMapsCompatible/{z}/{y}/{x}.png",
    attr:"USGS Mineral Resources — State Geologic Map Compilation", maxZoom:14, defaultOpacity:55 },

  { id:"wageology", group:"Geology & hazards", name:"WA surface geology", via:"WGS · DS-18", sw:"#c69b67", z:469,
    dynamic:"https://gis.dnr.wa.gov/site1/rest/services/Public_Geology/100K_Surface_Geology_WA_GeMS/MapServer/export",
    layers:"11", attr:"Washington Geological Survey — 100K Surface Geology WA GeMS", minZoom:6, maxZoom:17,
    defaultOpacity:52,
    note:"Gapless statewide WGS compilation intended for about 1:100,000 display and regional interpretation." },

  { id:"wafaults", group:"Geology & hazards", name:"WA active faults", via:"WGS · DDS-1", sw:"#f05a54", z:496,
    dynamic:"https://gis.dnr.wa.gov/site1/rest/services/Public_Geology/Earthquakes_and_Faults/MapServer/export",
    layers:"12", attr:"Washington Geological Survey — Quaternary Active Faults", minZoom:6, maxZoom:18,
    defaultOpacity:86,
    note:"Reconnaissance/regional fault compilation; do not measure a site-specific setback distance from this linework." },

  { id:"wavents", group:"Geology & hazards", name:"WA volcanic vents", via:"WGS", sw:"#f28c45", z:497,
    dynamic:"https://gis.dnr.wa.gov/site1/rest/services/Public_Geology/Volcanic_Vents/MapServer/export",
    layers:"0", attr:"Washington Geological Survey — Volcanic Vent Locations", minZoom:7, maxZoom:18,
    defaultOpacity:90,
    note:"Mapped eruptive centers classified by age; reference locations, not volcanic hazard zones." },

  { id:"usfaults", group:"Geology & hazards", name:"US faults & folds", via:"USGS", sw:"#ff5b57", z:499,
    dynamic:"https://earthquake.usgs.gov/arcgis/rest/services/haz/Qfaults/MapServer/export",
    layers:"21,22", attr:"USGS Quaternary Fault and Fold Database", minZoom:4, maxZoom:18,
    defaultOpacity:90,
    note:"National reconnaissance reference, including mapped fault areas; not a site-specific setback, recurrence, or rupture-hazard determination." },

  { id:"weatheralerts", group:"Conditions", name:"Active weather hazards", via:"NOAA/NWS · 5 min", sw:"#ff5b68", z:505,
    geoLoader:loadNwsWeatherAlerts, popupKind:"weather", geoTtl:5*60*1000,
    attr:"NOAA National Weather Service", defaultOpacity:90,
    note:"Official NWS watches, warnings, advisories, and public-safety statements. Boundaries and text can be revised as an event develops." },

  { id:"earthquakes", group:"Conditions", name:"Earthquakes", via:"USGS · 5 min", sw:"#ff8d5b", z:504,
    geoLoader:loadEarthquakeAlerts,
    pointKind:"quake", geoTtl:5*60*1000, attr:"USGS Earthquake Hazards Program", defaultOpacity:94,
    note:"Preliminary real-time locations; marker size follows magnitude and color follows reported depth. Event values can be revised." },

  { id:"volcanostatus", group:"Conditions", name:"Volcano status", via:"USGS VSC · 15 min", sw:"#f26b54", z:503,
    geoLoader:loadVolcanoAlerts,
    pointKind:"volcano", geoTtl:15*60*1000, attr:"USGS Volcano Science Center", defaultOpacity:94,
    note:"Current observatory status markers, not hazard-zone boundaries. Open a marker for its alert and notice synopsis." },

  { id:"landslide", group:"Geology & hazards", name:"Landslide susceptibility", via:"USGS", sw:"#b78a55", z:477,
    url:"https://tiles.arcgis.com/tiles/v01gqwM5QqNysAAi/arcgis/rest/services/US_Landslide_Susceptibility/MapServer/tile/{z}/{y}/{x}",
    attr:"USGS National Landslide Hazards", maxZoom:22, defaultOpacity:62,
    note:"Broad susceptibility screening, not a forecast or parcel-scale slope-stability assessment." },

  { id:"plateboundaries", group:"Geology & hazards", name:"Plate boundaries", via:"USGS", sw:"#bb7cff", z:489,
    dynamic:"https://earthquake.usgs.gov/arcgis/rest/services/eq/map_plateboundaries/MapServer/export",
    layers:"0,1", attr:"USGS Earthquake Hazards Program", minZoom:1, maxZoom:12,
    defaultOpacity:84,
    note:"Generalized plate and microplate boundaries for regional tectonic context; line placement is not a survey boundary." },

  { id:"vs30", group:"Geology & hazards", name:"Vs30 site conditions", via:"USGS", sw:"#65a8dd", z:476,
    dynamic:"https://earthquake.usgs.gov/arcgis/rest/services/eq/vs30_mosaic/MapServer/export",
    layers:"0", attr:"USGS Vs30 Mosaic", minZoom:3, maxZoom:18, defaultOpacity:58,
    note:"Near-surface shear-wave velocity proxy for seismic site conditions. It is not lithology, bedrock depth, or a substitute for field measurements." },

  { id:"waarchaeology", group:"Past landscapes", name:"WA archaeology index", via:"agency + academic", sw:"#d6a6ff", z:506,
    geoData:()=>globalThis.CSPWaArchaeology?.featureCollection(),
    pointKind:"archaeology", attr:"DAHP, NPS, Washington State Parks, WSU, UW Press and cited research", defaultOpacity:96,
    note:"A public-safe research index, not Washington's protected inventory. Green markers are public visitor locations; violet markers are intentionally generalized; amber markers are estimated research waypoints. Every marker states its precision, uncertainty, access limits, and source." },

  /* Snow. NOHRSC runs the SNODAS assimilation daily for the whole of CONUS, so
     this is current conditions rather than a satellite pass — it has no cloud
     problem and no revisit gap. MODIS NDSI is the satellite view alongside it,
     which does have both but sees the whole world. */
  { id:"snowdepth", group:"Conditions", name:"Snow depth", via:"NOHRSC · M2 cache", sw:"#7fc4ff", z:480, snow:"3", attr:"NOAA NOHRSC National Snow Analysis", maxZoom:14, defaultOpacity:70,
    note:"Modeled snow depth in inches at about 0.6 mile resolution across CONUS; NOAA refreshes the analysis four times daily." },

  { id:"swe", group:"Conditions", name:"Snow water equivalent", via:"NOHRSC · M2 cache", sw:"#4f8fd0", z:479, snow:"7", attr:"NOAA NOHRSC National Snow Analysis", maxZoom:14, defaultOpacity:70,
    note:"Modeled liquid-water content of the snowpack in inches at about 0.6 mile resolution; not a point measurement." },

  { id:"snowcover", group:"Conditions", name:"Snow cover", via:"NASA GIBS", sw:"#cfe9ff", z:478, gibs:"MODIS_Terra_NDSI_Snow_Cover", attr:"NASA GIBS — MODIS Terra NDSI",
    maxZoom:8, defaultOpacity:65 },
];

/* GIBS publishes on a lag, so an overlay asking for "today" can be empty for
   hours. Step back a day, which is reliably there. */
function gibsDay(back){
  return new Date(Date.now()-(back==null?1:back)*864e5).toISOString().slice(0,10);
}

/* NOHRSC now returns clean CORS. Prefer the warm M2 cache when connected and
   fall straight back to the authoritative browser-direct export if it is not;
   snow conditions therefore keep working when the private server is offline. */
const SnowLayer = ResilientTileLayer.extend({
  snowUrl(c,direct){
    const b=tileMerc(c).join(",");
    if(!direct&&PROXY) return api(`/api/snow?bbox=${b}&layer=${this.options.snow}&size=${EXPORT_PX}`);
    return "https://mapservices.weather.noaa.gov/raster/rest/services/snow/"
         + "NOHRSC_Snow_Analysis/MapServer/export"
         + `?bbox=${b}&bboxSR=3857&imageSR=3857&size=${EXPORT_PX},${EXPORT_PX}&format=png32`
         + `&transparent=true&f=image&layers=show:${this.options.snow}`;
  },
  getTileUrl(c){ return this.snowUrl(c,false) },
  getFallbackTileUrl(c){ return PROXY ? this.snowUrl(c,true) : null }
});

/* A finished GIBS day is already global. Keep this small subclass so search
   scenes and the snow-cover reference obey the same completed-day rule. */
const SnowCoverLayer = ResilientTileLayer.extend({
  getTileUrl(c){
    return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${this.options.gibs}`
         + `/default/${gibsDay()}/GoogleMapsCompatible_Level8/${c.z}/${c.y}/${c.x}.png`;
  }
});

/* An ArcGIS dynamic MapServer drawn as slippy tiles: one export per tile, in
   the tile's own mercator bbox. */
const ExportLayer = ResilientTileLayer.extend({
  getTileUrl(c){
    const b=tileMerc(c).join(",");
    const density=Math.max(2,Math.min(3,Math.ceil(Number(window.devicePixelRatio)||1)));
    return `${this.options.endpoint}?bbox=${b}&bboxSR=3857&imageSR=3857`
         + `&size=${256*density},${256*density}&format=png32&transparent=true&dpi=${96*density}&f=image`
         + `&layers=show:${this.options.layers}`;
  }
});

/* Keep the cached map useful while a genuine high-density NHD feature render
   stages. Each tile upgrades independently; late cached pixels cannot undo it.
   Child image requests use the existing retry/cancellation implementation. */
const ReferenceLabelLayer=ExportLayer.extend({
  initialize(url,options){
    ResilientTileLayer.prototype.initialize.call(this,url,options);
    this.on("tileunload",event=>{
      for(const request of event.tile?._cspReferenceRequests||[]){
        request._cspCancelled=true;clearTimeout(request._cspRetry);
        request.onload=null;request.onerror=null;request.src=EMPTY_TILE;
      }
      clearTimeout(event.tile?._cspReferenceTimer);
    });
  },
  wantsDetail(c){return 591657527.591555/2**c.z<=this.options.minDetailScale},
  getFallbackTileUrl(c){return L.Util.template(this.options.cachedUrl,c)},
  getTileUrl(c){return this.wantsDetail(c)?ExportLayer.prototype.getTileUrl.call(this,c):this.getFallbackTileUrl(c)},
  getSnapshotTileUrl(c){return this._cspReferenceDetailAvailable?this.getTileUrl(c):this.getFallbackTileUrl(c)},
  createTile(c,done){
    if(!this.wantsDetail(c))return ResilientTileLayer.prototype.createTile.call(this,c,done);
    const canvas=document.createElement("canvas"),context=canvas.getContext("2d");
    const density=Math.max(2,Math.min(3,Math.ceil(Number(window.devicePixelRatio)||1)));
    canvas.width=canvas.height=256*density;canvas._cspReferenceRequests=[];
    canvas._cspReferenceQuality="loading";
    let remaining=2,reported=false,detailReady=false;
    const publish=(error,image,detail)=>{
      if(canvas._cspCancelled||this._cspRemoved||!this._map)return;
      if(detail)clearTimeout(canvas._cspReferenceTimer);
      remaining--;
      if(!error&&(!detailReady||detail)){
        context.clearRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
        detailReady=detail;canvas._cspReferenceQuality=detail?"detail":"cached";canvas._cspHasContent=true;
        if(detail){this._cspReferenceDetailAvailable=true;clearTimeout(canvas._cspReferenceTimer)}
        if(!reported){reported=true;done(null,canvas)}
        this.fire("tilerefine",{tile:canvas,coords:c});
      }
      if(!remaining&&!reported){reported=true;done(error||new Error("Reference labels unavailable"),canvas)}
      if(!remaining)this.fire("tilerefine",{tile:canvas,coords:c});
    };
    for(const detail of [false,true]){
      const consumer=Object.create(this);
      consumer.options={...this.options,tileRetries:detail?0:1};
      consumer.getTileUrl=()=>detail?ExportLayer.prototype.getTileUrl.call(this,c):this.getFallbackTileUrl(c);
      consumer.getFallbackTileUrl=()=>null;
      const image=ResilientTileLayer.prototype.createTile.call(consumer,c,(error,tile)=>publish(error,tile,detail));
      canvas._cspReferenceRequests.push(image);
      if(detail){
        // The cached tile remains useful if the dynamic provider stalls.
        canvas._cspReferenceTimer=setTimeout(()=>{
          if(detailReady||canvas._cspCancelled)return;
          image._cspCancelled=true;image.onload=null;image.onerror=null;image.src=EMPTY_TILE;
          publish(new Error("High-density reference render timed out"),image,true);
        },15000);
      }
    }
    return canvas;
  }
});

const OV_KEY="clearskies.overlays.v1";
let ovOn={}, ovLayers={}, ovLineWidths={}, ovOpacities={}, ovOrder=[], ovTimeSlices={};
const ovGeoCache=new Map();
const ovPointCanvas=L.canvas({padding:.5});

const ALERT_PREF_KEY="clearskies.alerts.v1";
const ALERT_TYPE_DEFAULTS={storm:true,winter:true,fire:true,coast:true,temperature:true,other:true};
let alertPrefs={nws:!cspFreshView,quakes:!cspFreshView,volcanoes:!cspFreshView,fires:false,viewport:true,
  nwsSeverity:"all",quakeAge:"week",quakeMag:-1,types:{...ALERT_TYPE_DEFAULTS}};
const alertRawCache=new Map();
let alertMoveTimer=null,alertsReady=false,nwsCoverage=null,nwsFetchedAt=0;

function alertBounds(){
  // Fetch beyond the screen so ordinary pans stay inside a warm geometry
  // envelope instead of asking NOAA for nearly identical polygons each time.
  const b=map.getBounds().pad(.35);
  return {west:Math.max(-180,b.getWest()),south:Math.max(-85,b.getSouth()),
          east:Math.min(180,b.getEast()),north:Math.min(85,b.getNorth())};
}
function alertPointInView(feature){
  if(!alertPrefs.viewport) return true;
  const c=feature?.geometry?.coordinates;
  return Array.isArray(c)&&Number.isFinite(+c[0])&&Number.isFinite(+c[1])&&map.getBounds().pad(.15).contains([+c[1],+c[0]]);
}
async function alertRawFeed(url,ttl){
  const now=Date.now(),old=alertRawCache.get(url);
  if(old){alertRawCache.delete(url);alertRawCache.set(url,old)}
  if(old?.data&&now-old.at<ttl) return old.data;
  if(old?.promise) return old.promise;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  const next={data:old?.data||null,at:old?.at||0,promise:null};
  next.promise=fetch(url,{mode:"cors",credentials:"omit",cache:"no-cache",signal:controller.signal})
    .then(async response=>{
      if(!response.ok) throw new Error(`alert source returned HTTP ${response.status}`);
      const data=await response.json();
      if(!data||data.type!=="FeatureCollection"||!Array.isArray(data.features)) throw new Error("alert source returned invalid GeoJSON");
      next.data=data;next.at=Date.now();return data;
    }).finally(()=>{clearTimeout(timer);next.promise=null});
  alertRawCache.set(url,next);
  while(alertRawCache.size>24) alertRawCache.delete(alertRawCache.keys().next().value);
  return next.promise;
}
function nwsAlertCategory(feature){
  const name=String(feature?.properties?.prod_type||feature?.properties?.event||"");
  if(/Tsunami|Marine|Coastal|Surf|Rip Current|Beach|Hurricane|Tropical|Typhoon|Storm Surge|Small Craft/i.test(name)) return "coast";
  if(/Fire|Red Flag|Smoke|Ashfall/i.test(name)) return "fire";
  if(/Winter|Snow|Blizzard|Ice|Avalanche|Sleet/i.test(name)) return "winter";
  if(/Heat|Cold|Freeze|Frost|Air Quality|Stagnation|Fog/i.test(name)) return "temperature";
  if(/Tornado|Thunderstorm|Flood|Wind|Hail|Dust|Rain|Lightning|Squall/i.test(name)) return "storm";
  return "other";
}
function nwsAlertRank(feature){
  const p=feature?.properties||{},sig=String(p.sig||"").toUpperCase(),name=String(p.prod_type||"");
  if(sig==="W"||/Warning|Emergency|Evacuation/i.test(name)) return 2;
  if(sig==="A"||/Watch/i.test(name)) return 1;
  return 0;
}
async function loadNwsWeatherAlerts(){
  const b=alertPrefs.viewport?alertBounds():null;
  const params=new URLSearchParams({where:"1=1",outSR:"4326",geometryPrecision:"5",
    maxAllowableOffset:alertPrefs.viewport?"0.001":"0.02",
    outFields:"objectid,prod_type,msg_type,sig,url,expiration,onset,issuance,event,wfo",returnGeometry:"true",f:"geojson"});
  if(b){
    params.set("geometry",`${b.west},${b.south},${b.east},${b.north}`);
    params.set("geometryType","esriGeometryEnvelope");params.set("inSR","4326");
  }
  const url="https://mapservices.weather.noaa.gov/eventdriven/rest/services/WWA/watch_warn_adv/MapServer/1/query?"+params;
  const data=await alertRawFeed(url,5*60*1000),threshold={all:0,watch:1,warning:2}[alertPrefs.nwsSeverity]||0;
  if(b){
    nwsCoverage=L.latLngBounds([b.south,b.west],[b.north,b.east]);nwsFetchedAt=Date.now();
  }else{nwsCoverage=null;nwsFetchedAt=Date.now()}
  return {...data,features:data.features.filter(feature=>nwsAlertRank(feature)>=threshold&&alertPrefs.types[nwsAlertCategory(feature)]!==false)};
}
async function loadEarthquakeAlerts(){
  const age=["hour","day","week","month"].includes(alertPrefs.quakeAge)?alertPrefs.quakeAge:"week";
  const data=await alertRawFeed(`https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_${age}.geojson`,5*60*1000);
  const minimum=Number.isFinite(+alertPrefs.quakeMag)?+alertPrefs.quakeMag:-1;
  return {...data,features:data.features.filter(feature=>{
    const mag=Number(feature?.properties?.mag);
    return alertPointInView(feature)&&(!Number.isFinite(mag)||mag>=minimum);
  })};
}
/* The Maxar coverage index ships with the app rather than being crawled at
   runtime: it is 55 collection.json reads against S3, which is a build-time job,
   not something to make every visitor pay for. scripts/sync-maxar-catalog.js
   regenerates it. Cached in memory for the session - the file is static. */
let maxarCatalogPromise=null;
async function loadMaxarFootprints(){
  if(!maxarCatalogPromise){
    maxarCatalogPromise=(async()=>{
      const response=await fetch("./maxar-catalog.json",{cache:"no-cache"});
      if(!response.ok) throw new Error(`coverage index HTTP ${response.status}`);
      return response.json();
    })().catch(error=>{ maxarCatalogPromise=null; throw error });
  }
  const catalog=await maxarCatalogPromise;
  const features=[];
  for(const event of catalog.events||[]){
    for(const box of event.footprints||[]){
      const [west,south,east,north]=box;
      if(![west,south,east,north].every(Number.isFinite)) continue;
      features.push({type:"Feature",
        properties:{title:event.title||event.id,start:event.start,end:event.end,
                    license:event.license||catalog.license,url:event.url},
        geometry:{type:"Polygon",coordinates:[[[west,south],[east,south],[east,north],[west,north],[west,south]]]}});
    }
  }
  return {type:"FeatureCollection",features};
}
async function loadVolcanoAlerts(){
  const url="https://volcanoes.usgs.gov/vsc/api/volcanoApi/geojson";
  const data=await alertRawFeed(url,15*60*1000);
  return {...data,features:data.features.filter(alertPointInView)};
}

function ovLoad(){
  try{
    const s=JSON.parse(localStorage.getItem(OV_KEY)); if(s&&s.on) ovOn=s.on;
    if(s&&s.op!=null) $("#ovOp").value=s.op;
    if(s&&s.opacities&&typeof s.opacities==="object") ovOpacities={...s.opacities};
    if(s&&Array.isArray(s.order)) ovOrder=s.order.filter(id=>OVERLAYS.some(o=>o.id===id));
    if(s&&s.lineWidths&&typeof s.lineWidths==="object"){
      for(const o of OVERLAYS) if(o.lineWidth&&Number.isFinite(+s.lineWidths[o.id]))
        ovLineWidths[o.id]=Math.max(o.lineWidth.min,Math.min(o.lineWidth.max,+s.lineWidths[o.id]));
    }
    if(s&&s.slices&&typeof s.slices==="object"){
      for(const o of OVERLAYS) if(o.timeSlice&&o.timeSlice.values.includes(+s.slices[o.id]))
        ovTimeSlices[o.id]=+s.slices[o.id];
    }
  }catch(e){}
  $("#ovOpOut").textContent=$("#ovOp").value+"%";
}
function ovSave(){
  try{ localStorage.setItem(OV_KEY, JSON.stringify({on:ovOn, op:+$("#ovOp").value,lineWidths:ovLineWidths,opacities:ovOpacities,order:ovOrder,slices:ovTimeSlices})) }catch(e){}
}

/* Time-sliced overlays keep every slice in one cached file and redraw only the
   selected one, so scrubbing the slider never refetches. */
function overlayTimeSlice(o){
  const spec=o.timeSlice;if(!spec) return null;
  const value=+ovTimeSlices[o.id];
  return spec.values.includes(value)?value:spec.default;
}
function overlayTimeSliceText(o){
  const value=overlayTimeSlice(o);
  return `${Number(value.toFixed(1))} ${o.timeSlice.unit}`;
}
function ovSliceData(o,data){
  if(!o.timeSlice||!data) return data;
  const value=overlayTimeSlice(o);
  return {...data,features:data.features.filter(f=>Number(f?.properties?.ka)===value)};
}
function setOverlayTimeSlice(o,value){
  const spec=o.timeSlice;if(!spec||!spec.values.includes(+value)) return;
  ovTimeSlices[o.id]=+value;
  const output=$("#ovTimeOut_"+o.id);if(output) output.textContent=overlayTimeSliceText(o);
  const layer=ovLayers[o.id],data=ovGeoCache.get(o.id)?.data;
  if(layer&&data&&!layer._cspLoading){
    layer.clearLayers();layer.addData(ovSliceData(o,data));
    layer.setStyle(feature=>ovFeatureStyle(o,feature,layer._cspOpacity));
  }
}

function overlayLineWidth(o){
  const spec=o.lineWidth;if(!spec) return null;
  const value=+ovLineWidths[o.id];
  return Math.max(spec.min,Math.min(spec.max,Number.isFinite(value)?value:spec.default));
}
function setOverlayLineWidth(o,value){
  const spec=o.lineWidth;if(!spec) return null;
  const numeric=+value;
  return ovLineWidths[o.id]=Math.max(spec.min,Math.min(spec.max,Number.isFinite(numeric)?numeric:spec.default));
}
function overlayLineWidthText(o){
  const value=overlayLineWidth(o);
  return `${Number(value.toFixed(2))} px`;
}

const overlayOpacityPercent=o=>{
  const own=+ovOpacities[o.id];
  return Math.max(0,Math.min(100,Number.isFinite(own)?own:+$("#ovOp").value));
};
const ovOpacity = o => {
  const requested=overlayOpacityPercent(o)/100;
  return Math.min(1,o.defaultOpacity!=null ? requested*(o.defaultOpacity/100)/.9 : requested);
};
const overlayZ=o=>{
  const index=ovOrder.indexOf(o.id);
  return index<0?o.z:580-index*3;
};
function setOverlayOpacity(id,value){
  const o=OVERLAYS.find(item=>item.id===id);if(!o) return;
  ovOpacities[id]=Math.max(0,Math.min(100,+value||0));
  const layer=ovLayers[id];if(layer?.setOpacity) layer.setOpacity(ovOpacity(o));
  const input=$("#ovOpacity_"+id),output=$("#ovOpacityOut_"+id);
  if(input) input.value=ovOpacities[id];if(output) output.textContent=Math.round(ovOpacities[id])+"%";
  ovSave();paintOverlayNote();
}
function setOverlayOrder(order){
  ovOrder=[...new Set((order||[]).filter(id=>OVERLAYS.some(o=>o.id===id)))];
  ovOrder.forEach((id,index)=>{
    const layer=ovLayers[id];if(!layer) return;
    if(layer.setZIndex) layer.setZIndex(580-index*3);
  });
  [...ovOrder].reverse().forEach(id=>ovLayers[id]?.bringToFront?.());
  ovSave();
}

function ovGeoStyle(o,feature,opacity){
  if(o.popupKind==="weather"){
    const rank=nwsAlertRank(feature),color=rank>=2?"#ff4f5e":rank===1?"#f5a33b":"#54a7e8";
    return {color:color,weight:rank>=2?2.4:1.8,opacity:.96*opacity,
      fillColor:color,fillOpacity:(rank>=2?.18:rank===1?.13:.09)*opacity,
      dashArray:rank===0?"5 4":null};
  }
  if(o.styleKind==="nadi1"){
    const kind=feature?.properties?.kind;
    if(kind==="ice") return {stroke:false,fillColor:"#e4f6ff",fillOpacity:.46*opacity};
    if(kind==="max") return {color:"#ff6b6b",weight:1.6,opacity:.92*opacity,dashArray:"7 5",fill:false};
    if(kind==="min") return {color:"#f2c744",weight:1.6,opacity:.92*opacity,dashArray:"2 5",lineCap:"round",fill:false};
    return {color:"#ffffff",weight:2.2,opacity:.96*opacity,lineJoin:"round",fill:false};
  }
  const style={...(o.geoStyle||{})};
  if(o.lineWidth) style.weight=overlayLineWidth(o);
  style.opacity=(style.opacity==null?1:style.opacity)*opacity;
  style.fillOpacity=(style.fillOpacity==null?0:style.fillOpacity)*opacity;
  return style;
}

function ovPointStyle(o,feature,opacity){
  const p=feature?.properties||{};
  if(o.pointKind==="quake"){
    const mag=Number(p.mag),depth=Number(feature?.geometry?.coordinates?.[2]);
    const fill=!Number.isFinite(depth)?"#aeb7c2":depth<35?"#ff6a5b":depth<70?"#f1aa43":depth<300?"#4fa9e8":"#8c73d6";
    return {radius:Math.max(3,Math.min(13,3+(Number.isFinite(mag)?Math.max(0,mag)*1.35:0))),
      color:"#ffffff",weight:1,opacity:.82*opacity,fillColor:fill,fillOpacity:.82*opacity};
  }
  if(o.pointKind==="archaeology"){
    const estimated=p.precision==="estimated",generalized=p.precision==="generalized";
    const fill=estimated?"#f0b35a":generalized?"#b28ada":"#56c9a7";
    return {radius:p.researchLead?7:6,color:"#ffffff",weight:p.researchLead?1.5:1.1,
      opacity:.9*opacity,fillColor:fill,fillOpacity:(p.researchLead ? .28 : .78)*opacity,
      dashArray:estimated?"3 2":null};
  }
  const code=String(p.colorCode||"").toUpperCase();
  const fill=code==="RED"?"#f04444":code==="ORANGE"?"#f08a3c":code==="YELLOW"?"#e9bd39":code==="GREEN"?"#4caf78":"#8c96a4";
  return {radius:6,color:"#ffffff",weight:1.25,opacity:.9*opacity,fillColor:fill,fillOpacity:.88*opacity};
}

function ovFeatureStyle(o,feature,opacity){
  return o.pointKind?ovPointStyle(o,feature,opacity):ovGeoStyle(o,feature,opacity);
}

function ovPointPopup(o,feature){
  const p=feature?.properties||{};
  if(o.pointKind==="quake"){
    const mag=Number(p.mag),depthKm=Number(feature?.geometry?.coordinates?.[2]),when=Number(p.time);
    const url=safeHttpUrl(p.url),link=url?`<br><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open USGS event →</a>`:"";
    return `<b>${esc(p.place||"Earthquake")}</b><br>Magnitude ${Number.isFinite(mag)?mag.toFixed(1):"not reported"}`+
      `<br>Depth ${Number.isFinite(depthKm)?(depthKm*.621371).toFixed(1)+" mi":"not reported"}`+
      `${Number.isFinite(when)?"<br>"+esc(new Date(when).toLocaleString()):""}${link}`;
  }
  if(o.pointKind==="archaeology"){
    const uncertainty=Number(p.uncertaintyMi);
    const sourceLinks=(Array.isArray(p.sources)?p.sources:[]).map(s=>{
      const url=safeHttpUrl(s?.url);return url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(s.title||"Source")}</a>`:"";
    }).filter(Boolean).join("<br>");
    return `<b>${esc(p.name||"Washington archaeology")}</b>`+
      `<br>${esc(p.siteType||"Archaeological landscape")} · ${esc(p.period||"date not stated")}`+
      `<br><b>${esc(p.precisionLabel||p.precision||"Location note")}</b>`+
      `${Number.isFinite(uncertainty)?` · ±${uncertainty<1?uncertainty.toFixed(1):uncertainty.toFixed(0)} mi`:""}`+
      `<br>${esc(p.access||"Check land ownership and access before visiting.")}`+
      `<br><br>${esc(p.summary||"")}`+
      `${p.tribalContext?`<br><br>Context: ${esc(p.tribalContext)}`:""}`+
      `${sourceLinks?`<br><br>${sourceLinks}`:""}`;
  }
  const url=safeHttpUrl(p.volcanoUrl),link=url?`<br><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open observatory page →</a>`:"";
  const synopsis=p.noticeSynopsis?`<br>${esc(p.noticeSynopsis)}`:"";
  return `<b>${esc(p.volcanoName||"US volcano")}</b>${p.region?"<br>"+esc(p.region):""}`+
    `<br>Alert: ${esc(p.alertLevel||"unassigned")} · aviation: ${esc(p.colorCode||"unassigned")}`+
    `${p.nvewsThreat?"<br>Threat: "+esc(p.nvewsThreat):""}${synopsis}${link}`;
}

function ovPointTooltip(o,feature){
  const p=feature?.properties||{};
  if(o.pointKind==="quake"){
    const mag=Number(p.mag);
    return `<b>${Number.isFinite(mag)?"M"+mag.toFixed(1):"Earthquake"}</b> · ${esc(p.place||"location pending")}`;
  }
  if(o.pointKind==="archaeology")
    return `<b>${esc(p.name||"Washington archaeology")}</b><br>${esc(p.precisionLabel||p.siteType||"Research location")}`;
  return `<b>${esc(p.volcanoName||"US volcano")}</b><br>${esc(p.alertLevel||"alert unassigned")} · ${esc(p.colorCode||"aviation unassigned")}`;
}

/* Both ends of a Maxar event's temporal extent matter: these collections carry
   pre-event archive alongside the post-event collect, so a single date would
   misrepresent what you can actually see. */
function maxarWhen(p){
  const day=value=>{ const date=new Date(String(value||"").replace(" ","T"));
    return Number.isFinite(date.getTime())?date.toISOString().slice(0,10):"" };
  const start=day(p.start),end=day(p.end);
  if(start&&end&&start!==end) return `Imagery ${start} to ${end}`;
  return start||end ? `Imagery ${start||end}` : "Date not published";
}
function ovFeaturePopup(o,feature){
  if(o.popupKind==="maxar"){
    const p=feature?.properties||{},url=safeHttpUrl(p.url);
    return `<b>${esc(p.title||"Maxar Open Data")}</b>`+
      `<br>${esc(maxarWhen(p))}`+
      `<br>12\u201320 inch optical, Cloud-Optimised GeoTIFF`+
      `<br><b>CC-BY-NC-4.0 \u2014 non-commercial use only</b>`+
      `${url?`<br><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open the STAC collection \u2192</a>`:""}`;
  }
  if(o.popupKind!=="weather") return "";
  const p=feature?.properties||{},url=safeHttpUrl(p.url);
  const when=value=>{ const date=new Date(value);return Number.isFinite(date.getTime())?date.toLocaleString():"" };
  const onset=when(p.onset||p.issuance),expires=when(p.expiration);
  return `<b>${esc(p.prod_type||p.event||"NWS alert")}</b>`+
    `${p.wfo?`<br>Issued by ${esc(p.wfo)}`:""}`+
    `${onset?`<br>Starts ${esc(onset)}`:""}${expires?`<br>Expires ${esc(expires)}`:""}`+
    `${url?`<br><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open official NWS alert →</a>`:""}`;
}
function ovFeatureTooltip(o,feature){
  if(o.popupKind==="maxar"){
    const p=feature?.properties||{};
    return `<b>${esc(p.title||"Maxar Open Data")}</b><br>${esc(maxarWhen(p))}`;
  }
  if(o.popupKind!=="weather") return "";
  const p=feature?.properties||{},rank=nwsAlertRank(feature);
  return `<b>${esc(p.prod_type||p.event||"NWS alert")}</b><br>${rank>=2?"Warning":rank===1?"Watch":"Advisory / statement"}`;
}

async function ovFetchGeoData(o){
  if(o.geoLoader){
    const data=await o.geoLoader();
    if(!data||data.type!=="FeatureCollection"||!Array.isArray(data.features))
      throw new Error("live alert loader returned invalid GeoJSON");
    return data;
  }
  if(o.geoData){
    const data=typeof o.geoData==="function"?o.geoData():o.geoData;
    if(!data||data.type!=="FeatureCollection"||!Array.isArray(data.features))
      throw new Error("bundled source returned invalid GeoJSON");
    return data;
  }
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),15000);
  try{
    const response=await fetch(o.geojson,{mode:"cors",credentials:"omit",cache:o.geoTtl?"no-cache":"force-cache",signal:controller.signal});
    if(!response.ok) throw new Error(`source returned HTTP ${response.status}`);
    const data=await response.json();
    if(!data||data.type!=="FeatureCollection"||!Array.isArray(data.features))
      throw new Error("source returned invalid GeoJSON");
    return data;
  }finally{ clearTimeout(timer) }
}

function ovGeoData(o){
  const now=Date.now(),ttl=Number(o.geoTtl)||0;
  let entry=ovGeoCache.get(o.id);
  if(entry?.promise) return entry.promise;
  if(entry?.data&&(!ttl||now-entry.at<ttl))
    return Promise.resolve({data:entry.data,at:entry.at,stale:false});
  const next={data:entry?.data||null,at:entry?.at||0,promise:null};
  next.promise=ovFetchGeoData(o).then(data=>{
    next.data=data;next.at=Date.now();next.promise=null;
    return {data,at:next.at,stale:false};
  }).catch(error=>{
    next.promise=null;
    if(next.data) return {data:next.data,at:next.at,stale:true,error};
    if(ovGeoCache.get(o.id)===next) ovGeoCache.delete(o.id);
    throw error;
  });
  ovGeoCache.set(o.id,next);return next.promise;
}

async function ovPopulateGeoLayer(o,layer){
  const initial=layer.getLayers().length===0;
  if(initial) layer._cspLoading=true; else layer._cspRefreshing=true;
  try{
    const result=await ovGeoData(o);
    if(!result.stale){
      layer.clearLayers();layer.addData(ovSliceData(o,result.data));
      layer.setStyle(feature=>ovFeatureStyle(o,feature,layer._cspOpacity));
      layer._cspCount=result.data.features.length;
      layer._cspError=null;
    }else{
      if(initial){layer.addData(ovSliceData(o,result.data));layer.setStyle(feature=>ovFeatureStyle(o,feature,layer._cspOpacity));layer._cspCount=result.data.features.length}
      layer._cspError="live refresh failed; retaining the last successful data";
    }
    layer._cspLoadedAt=result.at;
  }catch(error){
    layer._cspError=error&&error.name==="AbortError" ? "source timed out" : (error.message||"source unavailable");
  }finally{
    layer._cspLoading=false;layer._cspRefreshing=false;paintOverlayNote();paintAlertStatus();
    if(layer._cspRefreshRequested&&ovLayers[o.id]===layer){
      layer._cspRefreshRequested=false;ovGeoCache.delete(o.id);queueMicrotask(()=>ovPopulateGeoLayer(o,layer));
    }
  }
}

const mapTheme=()=>document.getElementById("map").dataset.basemapTheme==="dark"?"dark":"light";
const ovUrl=o=>o.urlFor?o.urlFor(mapTheme()):o.url;

/* Rebuild any overlay whose tiles depend on the map theme. setMapTheme runs
   once before OVERLAYS exists, so the call site there is guarded. */
function ovRefreshThemed(){
  if(!ovThemedReady) return;
  for(const o of OVERLAYS){
    if(o.id==="water"){
      const container=ovLayers[o.id]?.getContainer?.();
      if(container)container.style.filter=mapTheme()==="dark"?"grayscale(1) brightness(1.35)":"none";
    }
    if(!o.themed || !ovLayers[o.id]) continue;
    map.removeLayer(ovLayers[o.id]);
    ovLayers[o.id]=ovBuild(o).addTo(map);
  }
}

function ovBuild(o){
  const common={opacity:ovOpacity(o), zIndex:overlayZ(o), attribution:o.attr, pane:"overlayPane",
                maxZoom:VIEW_MAX,maxNativeZoom:o.maxZoom||19,minZoom:o.minZoom||0,crossOrigin:true,
                updateWhenZooming:false, keepBuffer:2};
  if(o.referenceExport){
    const layer=new ReferenceLabelLayer("",{...common,className:"csp-water-overlay",endpoint:o.referenceExport,
      cachedUrl:o.url,layers:o.layers,minDetailScale:o.minDetailScale});
    layer.on("add",()=>{layer.getContainer().style.filter=mapTheme()==="dark"?"grayscale(1) brightness(1.35)":"none"});
    layer.on("load tileload tileerror tilerefine",()=>paintOverlayNote());
    return layer;
  }
  if(o.geojson||o.geoData||o.geoLoader){
    const interactive=!!(o.pointKind||o.popupKind);
    const layer=L.geoJSON(null,{attribution:o.attr,pane:"overlayPane",interactive,
      bubblingMouseEvents:false,renderer:o.pointKind?ovPointCanvas:undefined,
      style:feature=>ovFeatureStyle(o,feature,ovOpacity(o)),
      pointToLayer:o.pointKind?((feature,ll)=>L.circleMarker(ll,{renderer:ovPointCanvas,...ovPointStyle(o,feature,ovOpacity(o))})):undefined,
      onEachFeature:interactive?((feature,child)=>{
        const tooltip=o.pointKind?ovPointTooltip(o,feature):ovFeatureTooltip(o,feature);
        const popup=o.pointKind?ovPointPopup(o,feature):ovFeaturePopup(o,feature);
        if(tooltip) child.bindTooltip(tooltip,{direction:"top",offset:[0,-6],opacity:.98,className:"csp-point-tip"});
        if(popup) child.bindPopup(popup,{maxWidth:340});
      }):undefined});
    layer._cspOpacity=ovOpacity(o);
    layer.setOpacity=opacity=>{
      layer._cspOpacity=opacity;
      layer.setStyle(feature=>ovFeatureStyle(o,feature,opacity));
      return layer;
    };
    ovPopulateGeoLayer(o,layer);
    return layer;
  }
  if(o.dynamic) return new ExportLayer("",{...common, endpoint:o.dynamic, layers:o.layers});
  if(o.snow)    return new SnowLayer("",{...common, snow:o.snow,tileRetries:1});
  if(o.gibs)    return new SnowCoverLayer("",{...common,gibs:o.gibs,tileRetries:1});
  const options={...common, subdomains:o.sub||"abc"};
  return resilientLayer(ovUrl(o), o.sharp?sharpTiles(options):options);
}

function visibleOverlayGroup(){
  return Object.keys(OVERLAY_GROUP_ROUTES).find(group=>OVERLAY_GROUP_ROUTES[group]===document.body.dataset.cspRoute)||null;
}

function paintOverlayNote(){
  const group=visibleOverlayGroup();
  const catalog=group?OVERLAYS.filter(o=>o.group===group):OVERLAYS;
  const n=catalog.filter(o=>ovLayers[o.id]).length;
  setCount("overlays", n ? n+" on" : "");
  document.querySelectorAll("#ovList .ovrow").forEach(r=>
    r.classList.toggle("on", !!ovOn[r.dataset.id]));
  document.querySelectorAll("#ovList .ov-line-control").forEach(control=>{
    control.hidden=!ovOn[control.dataset.id];
  });
  document.querySelectorAll("#ovList .ov-opacity-control").forEach(control=>{
    control.hidden=!ovOn[control.dataset.id];
  });
  const zoom=map.getZoom();
  const stretched=catalog.filter(o=>ovOn[o.id]&&o.maxZoom&&zoom>o.maxZoom);
  const loading=catalog.filter(o=>ovOn[o.id]&&ovLayers[o.id]&&ovLayers[o.id]._cspLoading);
  const failed=catalog.filter(o=>ovOn[o.id]&&ovLayers[o.id]&&ovLayers[o.id]._cspError);
  const notices=catalog.filter(o=>ovOn[o.id]&&o.note);
  const inCatalog=id=>catalog.some(o=>o.id===id);
  const lines=[];
  if(inCatalog("water")&&ovOn.water&&ovLayers.water){
    const layer=ovLayers.water,tiles=Object.values(layer._tiles||{}).filter(tile=>tile.current!==false);
    const detail=tiles.filter(tile=>tile.el?._cspReferenceQuality==="detail").length;
    const cached=tiles.filter(tile=>tile.loaded&&tile.el?._cspReferenceQuality!=="detail").length;
    lines.push(`Rivers &amp; lakes: ${detail} high-density tile${detail===1?"":"s"}${cached?` · ${cached} cached tile${cached===1?"":"s"} (overview or detail unavailable/pending)`:""}.`);
  }
  if(stretched.length) lines.push(`${stretched.map(o=>esc(o.name)).join(", ")} ${stretched.length>1?"are":"is"} displaying the last available native level, enlarged at z${zoom}.`);
  if(loading.length) lines.push(`Loading ${loading.map(o=>esc(o.name)).join(", ")}…`);
  if(failed.length) lines.push(failed.map(o=>`${esc(o.name)}: ${esc(ovLayers[o.id]._cspError)}. Toggle it to retry.`).join("<br>"));
  if((inCatalog("snowdepth")&&ovOn.snowdepth&&ovLayers.snowdepth)||(inCatalog("swe")&&ovOn.swe&&ovLayers.swe))
    lines.push("NOHRSC depth and SWE are current modeled conditions in <b>inches</b>. The connected M2 serves its warm cache first; the browser falls back directly to NOAA without blanking the layer.");
  if(inCatalog("snowcover")&&ovOn.snowcover&&ovLayers.snowcover) lines.push(`Snow cover is the completed MODIS pass for <b>${gibsDay()}</b>; it stretches its last 1,640 ft native level instead of disappearing when you zoom farther in.`);
  if(notices.length) lines.push(notices.map(o=>`<b>${esc(o.name)}:</b> ${esc(o.note)}`).join("<br>"));
  if(!lines.length) lines.push(n
    ? "Drawn over the imagery. Drag the opacity slider if labels compete with the scene."
    : "Nothing on. These draw over whatever imagery is selected.");
  $("#ovNote").innerHTML=lines.join("<br>");
}

function ovApply(){
  for(const o of OVERLAYS){
    // A proxied layer cannot work from file:// — the upstream sends no CORS.
    const want=!!ovOn[o.id] && !(o.needsProxy && !PROXY);
    if(want && !ovLayers[o.id]) ovLayers[o.id]=ovBuild(o).addTo(map);
    else if(!want && ovLayers[o.id]){ map.removeLayer(ovLayers[o.id]); delete ovLayers[o.id] }
  }
  paintOverlayNote();
}

const ALERT_OVERLAY_PREF={weatheralerts:"nws",earthquakes:"quakes",volcanostatus:"volcanoes"};
function saveAlertPrefs(){
  try{ localStorage.setItem(ALERT_PREF_KEY,JSON.stringify(alertPrefs)) }catch(e){}
}
function syncAlertUI(){
  if(!$("#alertNws")) return;
  $("#alertNws").checked=!!alertPrefs.nws;$("#alertQuakes").checked=!!alertPrefs.quakes;
  $("#alertVolcanoes").checked=!!alertPrefs.volcanoes;$("#alertFires").checked=!!alertPrefs.fires;
  $("#alertViewport").checked=!!alertPrefs.viewport;
  $("#alertNwsSeverity").value=alertPrefs.nwsSeverity;$("#alertQuakeAge").value=alertPrefs.quakeAge;
  $("#alertQuakeMag").value=String(alertPrefs.quakeMag);
  document.querySelectorAll("[data-alert-type]").forEach(input=>input.checked=alertPrefs.types[input.dataset.alertType]!==false);
  $("#alertTypes").setAttribute("aria-disabled",String(!alertPrefs.nws));
  for(const label of document.querySelectorAll('.pane[data-pane="alerts"] .check')){
    const input=label.querySelector('input[type="checkbox"]');label.classList.toggle("on",!!input?.checked);
  }
  const on=[alertPrefs.nws,alertPrefs.quakes,alertPrefs.volcanoes,alertPrefs.fires].filter(Boolean).length;
  setCount("alerts",on?`${on} on`:"");
}
function paintAlertStatus(){
  if(!alertsReady||!$("#alertStatus")) return;
  const parts=[];
  for(const [id,label] of [["weatheralerts","weather"],["earthquakes","quakes"],["volcanostatus","volcanoes"]]){
    if(!ovOn[id]) continue;
    const layer=ovLayers[id];
    if(layer?._cspError) parts.push(`<span class="warn">${label} unavailable</span>`);
    else if(layer?._cspLoading) parts.push(`${label} loading`);
    else parts.push(`${label} ${(layer?._cspCount||0).toLocaleString()}`);
  }
  if(alertPrefs.fires) parts.push("fires on");
  const scope=alertPrefs.viewport?"current view":"all available";
  $("#alertStatus").innerHTML=(parts.length?parts.join(" · "):"No live alert sources selected")+
    `<br><span class="ok">Automatic refresh</span> · ${scope} · NWS/USGS official feeds`;
}
function refreshAlertLayers(ids){
  for(const id of ids){
    ovGeoCache.delete(id);
    const layer=ovLayers[id],o=OVERLAYS.find(item=>item.id===id);
    if(!layer||!o) continue;
    if(layer._cspLoading||layer._cspRefreshing) layer._cspRefreshRequested=true;
    else ovPopulateGeoLayer(o,layer);
  }
  paintAlertStatus();
}
function applyAlertSources(){
  ovOn.weatheralerts=!!alertPrefs.nws;ovOn.earthquakes=!!alertPrefs.quakes;ovOn.volcanostatus=!!alertPrefs.volcanoes;
  for(const id of Object.keys(ALERT_OVERLAY_PREF)){ const input=$("#ov_"+id);if(input) input.checked=!!ovOn[id] }
  ovSave();ovApply();
  const fireChanged=$("#fire").checked!==!!alertPrefs.fires;
  $("#fire").checked=!!alertPrefs.fires;syncChecks();
  if(fireChanged){ if(alertPrefs.fires) loadFires(true);else clearFires() }
  saveSearchPrefs();saveAlertPrefs();syncAlertUI();paintAlertStatus();
}
function syncAlertFromOverlay(id,on){
  if(!alertsReady||!ALERT_OVERLAY_PREF[id]) return;
  alertPrefs[ALERT_OVERLAY_PREF[id]]=!!on;saveAlertPrefs();syncAlertUI();paintAlertStatus();
}
function initAlerts(){
  let stored=null;
  try{ stored=JSON.parse(localStorage.getItem(ALERT_PREF_KEY)||"null") }catch(e){}
  if(stored&&typeof stored==="object") alertPrefs={...alertPrefs,...stored,types:{...ALERT_TYPE_DEFAULTS,...(stored.types||{})}};
  else{
    for(const [id,key] of Object.entries(ALERT_OVERLAY_PREF))
      if(Object.prototype.hasOwnProperty.call(ovOn,id)) alertPrefs[key]=!!ovOn[id];
    alertPrefs.fires=$("#fire").checked;
  }
  if(!["all","watch","warning"].includes(alertPrefs.nwsSeverity)) alertPrefs.nwsSeverity="all";
  if(!["hour","day","week","month"].includes(alertPrefs.quakeAge)) alertPrefs.quakeAge="week";
  if(![-1,1,2.5,4,5.5].includes(+alertPrefs.quakeMag)) alertPrefs.quakeMag=-1;
  alertsReady=true;syncAlertUI();applyAlertSources();
  for(const [id,key] of [["alertNws","nws"],["alertQuakes","quakes"],["alertVolcanoes","volcanoes"],["alertFires","fires"]])
    $("#"+id).addEventListener("change",event=>{alertPrefs[key]=event.target.checked;applyAlertSources()});
  $("#alertViewport").addEventListener("change",event=>{
    alertPrefs.viewport=event.target.checked;saveAlertPrefs();syncAlertUI();
    refreshAlertLayers(["weatheralerts","earthquakes","volcanostatus"]);
    if(alertPrefs.fires) loadFires(true);
  });
  $("#alertNwsSeverity").addEventListener("change",event=>{
    alertPrefs.nwsSeverity=event.target.value;saveAlertPrefs();refreshAlertLayers(["weatheralerts"]);
  });
  $("#alertQuakeAge").addEventListener("change",event=>{
    alertPrefs.quakeAge=event.target.value;saveAlertPrefs();refreshAlertLayers(["earthquakes"]);
  });
  $("#alertQuakeMag").addEventListener("change",event=>{
    alertPrefs.quakeMag=+event.target.value;saveAlertPrefs();refreshAlertLayers(["earthquakes"]);
  });
  document.querySelectorAll("[data-alert-type]").forEach(input=>input.addEventListener("change",event=>{
    alertPrefs.types[event.target.dataset.alertType]=event.target.checked;saveAlertPrefs();syncAlertUI();refreshAlertLayers(["weatheralerts"]);
  }));
  $("#fire").addEventListener("change",()=>{
    if(!alertsReady) return;alertPrefs.fires=$("#fire").checked;saveAlertPrefs();syncAlertUI();paintAlertStatus();
  });
  map.on("moveend",()=>{
    if(!alertsReady||!alertPrefs.viewport) return;
    clearTimeout(alertMoveTimer);alertMoveTimer=setTimeout(()=>{
      const ids=["earthquakes","volcanostatus"];
      if(!nwsCoverage?.contains(map.getBounds())||Date.now()-nwsFetchedAt>=5*60*1000) ids.unshift("weatheralerts");
      refreshAlertLayers(ids);
    },650);
  });
}

/* Groups render in this order regardless of where an overlay sits in the
   registry, so adding a layer never silently reshuffles the menu. The order is
   what you reach for first: the picture, then what orients you on it, then what
   is happening now, then the deeper reference material.

   The previous grouping was the data's taxonomy rather than the reader's:
   Geology, Geohazards and Tectonics split one subject three ways - WA active
   faults sat under Geology while US faults sat under Geohazards - Archaeology
   was a submenu holding a single layer, an overlay group repeated the name of a
   whole pane, and ten layers had no group at all and simply floated above the
   first heading. */
const OVERLAY_GROUPS=Object.keys(OVERLAY_GROUP_ROUTES);
function ovRender(){
  let last=null;
  const ordered=OVERLAY_GROUPS.flatMap(group=>OVERLAYS.filter(o=>o.group===group))
    .concat(OVERLAYS.filter(o=>!OVERLAY_GROUPS.includes(o.group)));
  $("#ovList").innerHTML = ordered.map(o=>{
    const head = o.group && o.group!==last ? `<div class="ovgrp">${esc(o.group)}</div>` : "";
    last = o.group || last;
    const dead = o.needsProxy && !PROXY;
    const lineControl=o.lineWidth ? `<div class="ov-line-control" data-id="${o.id}"${ovOn[o.id]&&!dead?"":" hidden"}>
       <div class="ov-line-label"><label for="ovLine_${o.id}">${esc(o.lineWidth.label)}</label><output id="ovLineOut_${o.id}" for="ovLine_${o.id}">${overlayLineWidthText(o)}</output></div>
       <input type="range" id="ovLine_${o.id}" min="${o.lineWidth.min}" max="${o.lineWidth.max}" step="${o.lineWidth.step}" value="${overlayLineWidth(o)}" aria-label="${esc(o.lineWidth.label)} width">
     </div>`:"";
    /* Left is oldest: the slider reads as time running forward, so dragging
       right watches the ice retreat. */
    const timeControl=o.timeSlice ? `<div class="ov-line-control ov-time-control" data-id="${o.id}"${ovOn[o.id]&&!dead?"":" hidden"}>
       <div class="ov-line-label"><label for="ovTime_${o.id}">${esc(o.timeSlice.label)}</label><output id="ovTimeOut_${o.id}" for="ovTime_${o.id}">${overlayTimeSliceText(o)}</output></div>
       <input type="range" id="ovTime_${o.id}" min="0" max="${o.timeSlice.values.length-1}" step="1" value="${o.timeSlice.values.indexOf(overlayTimeSlice(o))}" aria-label="${esc(o.name)} time slice" aria-valuetext="${overlayTimeSliceText(o)}">
     </div>`:"";
    const opacityControl=`<div class="ov-opacity-control" data-id="${o.id}"${ovOn[o.id]&&!dead?"":" hidden"}>
       <div class="ov-line-label"><label for="ovOpacity_${o.id}">Opacity</label><output id="ovOpacityOut_${o.id}" for="ovOpacity_${o.id}">${Math.round(overlayOpacityPercent(o))}%</output></div>
       <input type="range" id="ovOpacity_${o.id}" min="0" max="100" step="1" value="${overlayOpacityPercent(o)}" aria-label="${esc(o.name)} opacity">
     </div>`;
    return head + `<label class="ovrow${dead?" dead":""}" data-id="${o.id}"`
       + (dead?' title="Needs the local server (server.js)"':"") + `>
       <input type="checkbox" id="ov_${o.id}"${ovOn[o.id]&&!dead?" checked":""}${dead?" disabled":""}>
       <span class="sw" style="background:${o.sw}"></span>
       <span class="nm">${esc(o.name)}</span>
       ${o.nonCommercial?'<span class="nc" title="Licensed CC-BY-NC-4.0 \u2014 non-commercial use only">NC</span>':""}
       <span class="via">${esc(o.via)}</span>
     </label>${timeControl}${opacityControl}${lineControl}`;
  }).join("");
  OVERLAYS.forEach(o=>{
    $("#ov_"+o.id).addEventListener("change", e=>{
      ovOn[o.id]=e.target.checked; ovSave(); syncAlertFromOverlay(o.id,e.target.checked); ovApply();
    });
    const opacityInput=$("#ovOpacity_"+o.id);
    if(opacityInput){
      opacityInput.addEventListener("input",e=>setOverlayOpacity(o.id,e.target.value));
      opacityInput.addEventListener("change",ovSave);
    }
    const lineInput=$("#ovLine_"+o.id);
    if(lineInput){
      lineInput.addEventListener("input",e=>{
        const value=setOverlayLineWidth(o,e.target.value),output=$("#ovLineOut_"+o.id),layer=ovLayers[o.id];
        if(output) output.textContent=overlayLineWidthText(o);
        if(layer?.setStyle) layer.setStyle(feature=>ovFeatureStyle(o,feature,ovOpacity(o)));
        return value;
      });
      lineInput.addEventListener("change",ovSave);
    }
    const timeInput=$("#ovTime_"+o.id);
    if(timeInput){
      timeInput.addEventListener("input",e=>{
        setOverlayTimeSlice(o,o.timeSlice.values[+e.target.value]);
        e.target.setAttribute("aria-valuetext",overlayTimeSliceText(o));
      });
      timeInput.addEventListener("change",ovSave);
    }
  });
}

$("#ovOp").addEventListener("input", ()=>{
  $("#ovOpOut").textContent=$("#ovOp").value+"%";
  for(const o of OVERLAYS){
    const l=ovLayers[o.id]; if(!l) continue;
    if(ovOpacities[o.id]==null) l.setOpacity(ovOpacity(o));
  }
  paintOverlayNote();
});
$("#ovOp").addEventListener("change", ovSave);
$("#ovReset").onclick=()=>{
  ovOn={};ovOpacities={};ovOrder=[];ovTimeSlices={};$("#ovOp").value=90;$("#ovOpOut").textContent="90%";
  for(const o of OVERLAYS) if(o.lineWidth) ovLineWidths[o.id]=o.lineWidth.default;
  if(alertsReady){
    for(const key of Object.values(ALERT_OVERLAY_PREF)) alertPrefs[key]=false;
    alertPrefs.fires=false;applyAlertSources();
  }else{ ovSave();ovApply() }
  ovRender();paintOverlayNote();
};
map.on("zoomend", ()=>{ if(Object.keys(ovLayers).length) ovApply() });

/* Live feeds refresh in place on their own cadence. The old canvas remains
   visible until a complete replacement succeeds, so a transient USGS outage
   cannot flash or blank the map. */
setInterval(()=>{
  if(document.visibilityState!=="visible") return;
  const now=Date.now();
  for(const o of OVERLAYS){
    const layer=ovLayers[o.id],ttl=Number(o.geoTtl)||0;
    if(!ttl||!layer||layer._cspLoading||layer._cspRefreshing) continue;
    if(now-(layer._cspLoadedAt||0)>=ttl) ovPopulateGeoLayer(o,layer);
  }
},60000);

ovLoad();
if (cspFreshView) { ovOn = {water:true}; ovOpacities = {water:60}; }
ovRender(); ovApply();
ovThemedReady=true;      // from here a theme switch may rebuild themed overlays

