/* ---------------------------------------------------------------- state */
let LOC=null, ITEMS=[], SEL=null, searchToken=0, searchAbort=null;
let committedLocation=null, locationVersion=0, resultEntryTimer=0;
const $=s=>document.querySelector(s);
const statusEl=$("#status"), resEl=$("#results");

/* The dot's color is an appearance setting (Settings > Appearance); it is
   set as an SVG attribute, not just CSS, so map snapshots keep it too. */
const locationDotColor=()=>getComputedStyle(document.documentElement).getPropertyValue("--csp-location-dot").trim()||"#ffffff";
document.addEventListener("csp:appearance",event=>{
  const color=event.detail?.locationDot||locationDotColor();
  if(marker) marker.setStyle({color,fillColor:color});
});
function setLoc(lat,lng,keepLabel,label){
  LOC={lat,lng};
  if(marker) map.removeLayer(marker);
  const dot=locationDotColor();
  marker=L.circleMarker([lat,lng],{radius:7,color:dot,weight:2,fillColor:dot,fillOpacity:.55,className:"csp-location-dot"})
          .addTo(map).bindTooltip(lat.toFixed(5)+", "+lng.toFixed(5),{direction:"top",offset:[0,-8]});
  if(!keepLabel) $("#q").value = lat.toFixed(5)+", "+lng.toFixed(5);
  updateCoordinateActions();
  committedLocation={version:++locationVersion,coordinates:{lat,lng},label:label||lat.toFixed(5)+", "+lng.toFixed(5)};
  document.dispatchEvent(new CustomEvent("csp:location",{detail:committedLocation}));
  syncLocationPin();
}
/* Clearing forgets the selected place: the dot, the search text and any
   search still in flight. Imagery already on the map stays; it is a layer
   with its own controls. */
function clearLoc(){
  const had=!!(LOC||$("#q").value);
  searchToken++;if(searchAbort){searchAbort.abort();searchAbort=null}
  acCancel();acHide();
  LOC=null;if(marker){map.removeLayer(marker);marker=null}
  $("#q").value="";updateCoordinateActions();
  if(statusEl.textContent.startsWith("Location selected")) statusEl.textContent="";
  committedLocation={version:++locationVersion,coordinates:null,label:""};
  document.dispatchEvent(new CustomEvent("csp:location",{detail:committedLocation}));
  syncLocationPin();
  return had;
}
function syncLocationPin(){
  if(!locationPin) return;
  const on=!!(document.body.classList.contains("terrain-3d")&&map3d&&LOC);
  locationPin.hidden=!on;
  if(!on) return;
  const p=map3d.project([LOC.lng,LOC.lat]);
  if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)){locationPin.hidden=true;return}
  locationPin.style.transform=`translate3d(${p.x}px,${p.y}px,0)`;
}

function ago(iso){
  const h=(Date.now()-new Date(iso))/36e5;
  // Daily composites often use a nominal noon timestamp before noon locally;
  // describing that as a negative number of minutes old is misleading.
  if(h<0)  return "today";
  if(h<1)  return Math.round(h*60)+" min ago";
  if(h<48) return Math.round(h)+" h ago";
  const d=h/24;
  if(d<60) return Math.round(d)+" days ago";
  if(d<730)return Math.round(d/30.4)+" months ago";
  return (d/365.25).toFixed(1)+" years ago";
}
function freshClass(iso){
  const d=(Date.now()-new Date(iso))/864e5;
  return d<=3?"fresh":"";
}
function res(g){
  const ft=Number(g)*3.28084;
  if(ft<1) return (ft*12).toFixed(1)+" in";
  return (ft<100?ft.toFixed(1):Math.round(ft).toLocaleString())+" ft";
}

/* ---------------------------------------------------------------- search */
/* Photon (photon.komoot.io) is an OSM geocoder purpose-built for type-ahead and
   permits autocomplete traffic; Nominatim's usage policy does not. No key needed. */
const PHOTON="https://photon.komoot.io";
/* One parser for search, autocomplete and coordinate actions. Google Earth
   copies DMS with hemisphere letters; keyboards may use straight or typographic
   degree/prime marks. Return null for place names, but never geocode an invalid
   coordinate as though it were a place. Decimal output stays latitude first. */
function parseCoordinates(value){ return CSPCoordinates.parse(value) }

async function geocode(t){
  const r=await fetch(PHOTON+"/api/?limit=1&q="+encodeURIComponent(t));
  const j=await r.json();
  const f=(j.features||[])[0];
  if(!f) throw new Error("Location not found");
  return {lat:f.geometry.coordinates[1], lng:f.geometry.coordinates[0],
          name:placeLabel(f.properties), extent:f.properties.extent};
}

/* Photon feature -> display strings */
function placeLabel(p){
  return p.name || [p.housenumber,p.street].filter(Boolean).join(" ") || p.city || p.county || "Unnamed place";
}
function placeContext(p){
  return [p.city && p.city!==p.name ? p.city : null, p.county, p.state, p.country]
         .filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).join(", ");
}
function placeKind(p){
  return String(p.osm_value || p.osm_key || p.type || "place").replace(/_/g," ");
}

/* ------------------------------------------------- autocomplete */
let acAbort=null, acTimer=null, acList=[], acIdx=-1, acGeneration=0;
const acEl=(()=>{ const d=document.createElement("div"); d.id="ac"; d.style.display="none";
                  document.getElementById("iw").appendChild(d); return d })();

function splitName(f){
  const p=f.properties||{};
  return { primary: placeLabel(p), secondary: placeContext(p) };
}
function kindOf(f){ return placeKind(f.properties||{}) }

function acHide(){ acEl.style.display="none"; acIdx=-1 }
/* A search that has already run must not be followed by the suggestion list
   it overtook: the debounce timer or an in-flight lookup would otherwise land
   after Enter and reopen the dropdown over the panel. */
function acCancel(){ clearTimeout(acTimer); if(acAbort) acAbort.abort(); acGeneration++; acList=[] }
function acShow(html){ acEl.innerHTML=html; acEl.style.display="block" }

function acRender(){
  if(!acList.length){ acHide(); return }
  acShow(acList.map((i,n)=>{
    return `<div class="r ${n===acIdx?"k":""}" data-n="${n}">
      <div class="p">${esc(i.primary)}</div>
      <div class="s">${esc(i.secondary)}</div>
      <div class="t">${esc(i.kind)}</div></div>`;
  }).join(""));
  acEl.querySelectorAll(".r").forEach(el=>{
    el.onmousedown=e=>e.preventDefault();
    el.onclick=()=>acPick(+el.dataset.n);
  });
}
function esc(s){ return String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])) }
/* Phones are tapped, not clicked: the hints that name the gesture say so. */
const MAP_TAP=matchMedia("(pointer:coarse)").matches?"tap":"click";
if(MAP_TAP==="tap"){
  const idle=document.getElementById("status");if(idle?.dataset.kind==="idle") idle.textContent="Enter a location, or tap anywhere on the map.";
  const empty=document.querySelector("#results .empty");if(empty) empty.innerHTML="No search yet.<br>Try <b>Moses Lake</b>, <b>Zermatt</b>, or double-tap the map.";
}
function safeHttpUrl(value){
  try{ const u=new URL(String(value||"")); return /^https?:$/.test(u.protocol)?u.href:"" }
  catch(e){ return "" }
}

function acPick(n){
  const place=acList[n];if(place) cspSearchPlace(place);
}

async function acQuery(t){
  if(acAbort) acAbort.abort();
  acAbort=new AbortController();
  const generation=++acGeneration;
  try{
    const found=await cspPlaceSuggestions(t,acAbort.signal);
    if(generation!==acGeneration||document.activeElement!==$("#q")||$("#q").value.trim()!==t) return;
    acList=found;acIdx=-1;
    if(!acList.length) acShow('<div class="note">No matches</div>');
    else acRender();
  }catch(e){
    if(e?.name==="AbortError"||generation!==acGeneration||document.activeElement!==$("#q")||$("#q").value.trim()!==t) return;
    acList=[]; acShow(`<div class="note">Place search unavailable \u2014 you can still paste coordinates or double-${MAP_TAP} the map</div>`);
  }
}

function acInput(){
  const t=$("#q").value.trim();
  clearTimeout(acTimer);
  if(acAbort) acAbort.abort();
  acList=[];acIdx=-1;
  try{ if(t.length<3 || parseCoordinates(t)){ acHide(); return } }
  catch(error){ acHide(); return }
  acShow('<div class="note">Searching\u2026</div>');
  acTimer=setTimeout(()=>acQuery(t), 280);   // debounce, respects Nominatim rate limits
}

function acKey(e){
  const open=acEl.style.display!=="none" && acList.length;
  if(e.key==="ArrowDown"&&open){ e.preventDefault(); acIdx=(acIdx+1)%acList.length; acRender() }
  else if(e.key==="ArrowUp"&&open){ e.preventDefault(); acIdx=acIdx<0?acList.length-1:(acIdx-1+acList.length)%acList.length; acRender() }
  else if(e.key==="Enter"){ if(open&&acIdx>=0){ e.preventDefault(); acPick(acIdx) } else { acCancel(); acHide(); doSearch() } }
  else if(e.key==="Escape"){ if(open) e.preventDefault(); acCancel(); acHide() }
}

/* ------------------------------------------------- current location */
function geolocate(){
  const btn=$("#loc");
  if(!navigator.geolocation){
    statusEl.dataset.kind="general",statusEl.innerHTML='<span class="chip err">This browser has no geolocation support</span>'; return;
  }
  if(!window.isSecureContext){
    statusEl.dataset.kind="general",statusEl.innerHTML='<span class="chip err">Location needs a secure context</span>'+
      ' <span style="color:var(--dim)">open this page over https:// or from localhost, not file://</span>';
    return;
  }
  btn.classList.add("busy"); btn.disabled=true;
  statusEl.dataset.kind="general",statusEl.innerHTML='<span class="spin"></span> Getting your location\u2026';
  navigator.geolocation.getCurrentPosition(
    async pos=>{
      btn.classList.remove("busy"); btn.disabled=false;
      const {latitude:lat, longitude:lng, accuracy}=pos.coords;
      acHide(); setLoc(lat,lng); map.setView([lat,lng],12);
      $("#q").value=lat.toFixed(5)+", "+lng.toFixed(5);
      try{   // best-effort friendly name
        const r=await fetch(PHOTON+`/reverse?lat=${lat}&lon=${lng}`);
        const p=(((await r.json()).features||[])[0]||{}).properties;
        if(p){
          const area=[p.city||p.locality||p.district||p.county, p.state||p.country]
                     .filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).join(", ");
          if(area) $("#q").value=area;
        }
      }catch(e){}
      if(accuracy>5000) statusEl.dataset.kind="general",statusEl.innerHTML=`<span class="chip">accurate to ~${(accuracy/1609.344).toFixed(1)} mi</span>`;
      run();
    },
    err=>{
      btn.classList.remove("busy"); btn.disabled=false;
      const msg={1:NATIVE_HOST?"Location is off for Clear Skies \u2014 allow it in the Settings app"
                 :"Location permission denied \u2014 allow it in your browser\u2019s site settings",
                 2:"Location unavailable right now",
                 3:"Location request timed out"}[err.code] || "Could not get your location";
      statusEl.dataset.kind="general",statusEl.innerHTML=`<span class="chip err">${esc(msg)}</span>`;
    },
    {enableHighAccuracy:true, timeout:12000, maximumAge:120000}
  );
}

/* ------------------------------------------------------------- date window
   One source of truth for "which dates are we asking for". Presets and an
   explicit range produce the same shape, so every query goes down one path.
   `stac` is an RFC 3339 interval for the STAC `datetime` parameter; null means
   don't constrain. `mode` is "rel" (last N days), "abs" (named range) or "all". */
const isoZ = d => d.toISOString().slice(0,19)+"Z";
const ymd  = d => d.toISOString().slice(0,10);

function relWindow(days){
  if(!(days>0)) return {mode:"all", days:0, from:null, to:null, stac:null, label:"All time"};
  const from=new Date(Date.now()-days*864e5);
  return {mode:"rel", days, from, to:null, stac:isoZ(from)+"/..",
          label: days===365?"Last year" : days===1825?"Last 5 years" : "Last "+days+" days"};
}

function dateWindow(){
  if($("#days").value!=="custom") return relWindow(+$("#days").value);
  const f=$("#dFrom").value, t=$("#dTo").value;
  if(!f && !t) return relWindow(0);                      // empty range == all time
  const from = f ? new Date(f+"T00:00:00Z") : null;
  const to   = t ? new Date(t+"T23:59:59Z") : null;
  return {mode:"abs", days:0, from, to,
          stac:(from?isoZ(from):"..")+"/"+(to?isoZ(to):".."),
          label:(f||"any")+" → "+(t||"any")};
}

async function stacSearch(src, lat, lng, win, cloudMax, signal){
  const body={ collections:src.colls,
               intersects:{type:"Point",coordinates:[lng,lat]},
               limit:60,
               sortby:[{field:"properties.datetime",direction:"desc"}] };
  if(win.stac) body.datetime = win.stac;
  if(src.key==="nisar"){
    // CMR-STAC ignores sortby and returns oldest-first, so ask for a recent window only.
    // NISAR's public archive starts Oct 2025 (beta) / Jun 2026 (provisional).
    delete body.sortby; delete body.intersects;
    const d=0.35;
    body.bbox=[lng-d, lat-d, lng+d, lat+d];
    body.limit=40;
    // A named range is honoured as given; presets stay capped, because CMR-STAC
    // returns oldest-first and would otherwise fill up with the earliest beta data.
    body.datetime = win.mode==="abs" ? win.stac
                                     : relWindow(Math.min(win.days>0?win.days:150,150)).stac;
  }
  const post=async (bd)=>{
    const r=await fetch(src.api,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(bd),signal});
    if(!r.ok) throw new Error(src.name+" HTTP "+r.status);
    return ((await r.json()).features||[]).map(f=>norm(f,src)).filter(Boolean);
  };
  // Static products (the DEM is stamped 2021) must bypass the date window or they
  // vanish whenever the user narrows it.
  const STATIC=["cop-dem-glo-30"];
  // ...but a range the user typed means exactly that range, so in "abs" mode the
  // static products stay in the dated query and drop out if they fall outside it.
  const statics = win.mode==="abs" ? [] : src.colls.filter(c=>STATIC.includes(c));
  body.collections = win.mode==="abs" ? src.colls : src.colls.filter(c=>!STATIC.includes(c));

  const jobs=[];
  if(body.collections.length) jobs.push(post(body));
  if(statics.length && src.key!=="nisar")
    jobs.push(post({collections:statics, intersects:{type:"Point",coordinates:[lng,lat]}, limit:2}).catch(()=>[]));

  const out=(await Promise.all(jobs)).flat();
  return out.filter(x=>x.cloud==null || x.cloud<=cloudMax);
}

function norm(f,src){
  const p=f.properties||{}, a=f.assets||{};
  const cid=String(f.collection || (p["odc:product"]||""));
  const info=COLL[cid] || {label:cid,gsd:p.gsd||null,kind:""};
  let thumb=null, tiles=null, link=null, nativeMax=null;

  if(a.rendered_preview) thumb=a.rendered_preview.href;
  else if(a.thumbnail)   thumb=a.thumbnail.href;
  else if(a.preview)     thumb=a.preview.href;

  if(a.tilejson) tiles={type:"tilejson", url:a.tilejson.href};
  else if(a.visual && /\.tif{1,2}$/i.test(a.visual.href))
    tiles={type:"xyz", url:TITILER+encodeURIComponent(a.visual.href)};

  if(src.key==="nisar"){
    const d=(p.datetime||p.start_datetime||"").slice(0,10);
    if(d) tiles={type:"xyz", url:NISAR_GIBS.replace("{DATE}", d)};
    link="https://search.asf.alaska.edu/#/?dataset=NISAR";
      thumb=thumb || (a.browse && a.browse.href) || null;
      nativeMax=13;
  }

  if(src.key==="cdse"){
    link="https://browser.dataspace.copernicus.eu/?zoom=12&lat="+(LOC?LOC.lat:0)+"&lng="+(LOC?LOC.lng:0);
    if(!thumb && a.QUICKLOOK) thumb=a.QUICKLOOK.href;
  }
  const rawDate=p.datetime||p.start_datetime;
  const when=new Date(rawDate);
  if(!rawDate||!Number.isFinite(+when)) return null;
  const rawGsd=info.gsd ?? p.gsd, gsd=Number(rawGsd);
  const rawCloud=p["eo:cloud_cover"], cloud=rawCloud==null?null:Number(rawCloud);
  const bbox=Array.isArray(f.bbox)&&f.bbox.length===4&&f.bbox.every(Number.isFinite) ? f.bbox : null;
  return {
    id:String(f.id||`${src.key}:${cid}:${when.toISOString()}`), src:src.name, srcKey:src.key, coll:cid, props:p,
    label:String(info.label||cid||"Untitled scene"), kind:String(info.kind||""), vis:info.vis||"rgb",
    gsd:Number.isFinite(gsd)&&gsd>0?gsd:null, date:when.toISOString(),
    cloud:Number.isFinite(cloud)?Math.max(0,Math.min(100,cloud)):null,
    thumb:safeHttpUrl(thumb), tiles, link:safeHttpUrl(link), bbox, geom:f.geometry, nativeMax
  };
}

function gibsItems(win){
  const out=[];
  const push=(g,ds)=>{
    const tms=g.tms||"GoogleMapsCompatible_Level9";
    const fmt=g.vis==="night"?"png":"jpg";
    out.push({ id:g.id+"/"+ds, src:"NASA GIBS (near real-time)", srcKey:"gibs", props:{},
      coll:g.id, label:g.label, kind:g.vis==="night"?"Night":"Optical NRT", vis:g.vis||"rgb", gsd:g.gsd,
      date:ds+"T12:00:00Z", cloud:null, thumb:null,
      tiles:{type:"xyz", url:`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${g.id}/default/${ds}/${tms}/{z}/{y}/{x}.${fmt}`},
      link:`https://worldview.earthdata.nasa.gov/?v=-180,-90,180,90&t=${ds}`, bbox:null, geom:null,
      nativeMax:+((tms.match(/Level(\d+)/)||[])[1]||9) });
  };
  // GIBS near-real-time layers are one tile set per day, generated client-side
  // rather than searched, so the window has to be applied here. Anchor on the end
  // of the window (not today) so a historical range returns imagery from that range.
  const end   = Math.min(win.to ? +win.to : Date.now(), Date.now());
  const start = win.from ? +win.from : -Infinity;
  /* A UTC day is not a complete global mosaic while satellites are still
     acquiring it. Advertising the current-day tile set made the newest GIBS result
     win auto-selection, then fail its readiness gate with a screen of 404s.
     Use the last completed UTC day for a current window; historical windows
     remain anchored exactly where the user put them. */
  const todayUtc=Date.parse(new Date().toISOString().slice(0,10)+"T00:00:00Z");
  const completeEnd=end>=todayUtc ? todayUtc-1 : end;
  for(const g of GIBS){
    if(g.fixed){
      // A fixed-date product is only out of scope when the user named a range.
      if(win.mode==="abs"){
        const t=+new Date(g.fixed+"T12:00:00Z");
        if(t<start || t>end) continue;
      }
      push(g, g.fixed); continue;
    }
    for(let d=0; d<3; d++){
      const t=completeEnd-d*864e5;
      if(t<start) break;
      push(g, new Date(t).toISOString().slice(0,10));
    }
  }
  return out;
}

async function run(){
  if(!LOC) return;
  const token=++searchToken;
  if(searchAbort) searchAbort.abort();
  const controller=new AbortController(); searchAbort=controller;
  const loc={...LOC};
  const win=dateWindow(), cloudMax=+$("#cloud").value;
  clearScene(false);
  ITEMS=[]; RESULT_SHOWN={}; render();
  statusEl.dataset.kind="scenes",statusEl.innerHTML='<span class="spin"></span> Querying sources…';
  const chips={};
  SOURCES.forEach(s=>chips[s.key]=`<span class="chip" id="c_${s.key}">${s.name.split(" ")[0]} …</span>`);
  const paint=()=>{ if(token===searchToken) statusEl.dataset.kind="scenes",statusEl.innerHTML=Object.values(chips).join(" ") };

  const jobs=SOURCES.map(async s=>{
    try{
      const r=await stacSearch(s,loc.lat,loc.lng,win,cloudMax,controller.signal);
      chips[s.key]=`<span class="chip on" >${s.name.split(" ")[0]} ${r.length}</span>`; paint();
      return r;
    }catch(e){
      if(controller.signal.aborted) return [];
      chips[s.key]=`<span class="chip err">${s.name.split(" ")[0]} failed</span>`; paint();
      return [];
    }
  });
  paint();
  const got=await Promise.all(jobs);
  if(token!==searchToken) return;
  searchAbort=null;
  ITEMS=[].concat(...got, gibsItems(win));
  const n=ITEMS.length;
  statusEl.dataset.kind="scenes",statusEl.innerHTML=Object.values(chips).join(" ")+` <span class="chip">${n} results</span>`;
  render(true);
  renderPasses();
  refreshTerrainCoverage();
}

