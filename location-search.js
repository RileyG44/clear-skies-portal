/* Coordinate search and autocomplete. This controller owns pending suggestions,
 * debounce/cancellation and coordinate-vs-place policy; the app supplies map
 * selection and scene-search actions. It is shared by the web and native bridge. */
(function(root,factory){
  if(typeof module==='object'&&module.exports) module.exports=factory(require('./coordinates.js'));
  else root.CSPLocationSearch=factory(root.CSPCoordinates);
})(typeof globalThis!=='undefined'?globalThis:this,function(coordinates){
'use strict';
const parseCoordinates=coordinates.parse;
/* Photon permits type-ahead traffic; Nominatim's policy does not. */
const PHOTON='https://photon.komoot.io';


async function geocode(t){
  const r=await fetch(PHOTON+"/api/?limit=1&q="+encodeURIComponent(t));
  const j=await r.json();
  const f=(j.features||[])[0];
  if(!f) throw new Error("Location not found");
  return {lat:f.geometry.coordinates[1], lng:f.geometry.coordinates[0],
          name:placeLabel(f.properties), extent:f.properties.extent};
}

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

function splitName(f){
  const p=f.properties||{};
  return { primary: placeLabel(p), secondary: placeContext(p) };
}

function kindOf(f){ return placeKind(f.properties||{}) }

function coordinateLinks(ll){
  const compact=`${ll.lat.toFixed(6)},${ll.lng.toFixed(6)}`;
  return {
    maps:`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(compact)}`,
    earth:`https://earth.google.com/web/search/${compact}/`
  };
}

function esc(s){ return String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])) }

function coordinateForActions(text,selected){
  let typed;
  try{ typed=parseCoordinates(text) }catch(error){ return null }
  const ll=typed||selected;
  return ll&&Number.isFinite(ll.lat)&&Number.isFinite(ll.lng)&&Math.abs(ll.lat)<=90&&Math.abs(ll.lng)<=180 ? ll : null;
}

async function suggestions(text,signal){
  const t=String(text||"").trim();
  try{ if(t.length<3||parseCoordinates(t)) return [] }catch(error){ return [] }
  const r=await fetch(PHOTON+"/api/?limit=6&q="+encodeURIComponent(t),{signal});
  if(!r.ok) throw new Error("geocoder "+r.status);
  const seen=new Set();
  return ((await r.json()).features||[]).filter(f=>f.geometry&&f.geometry.coordinates).map(f=>{
    const s=splitName(f);
    return {primary:s.primary,secondary:s.secondary,kind:kindOf(f),lat:f.geometry.coordinates[1],lng:f.geometry.coordinates[0],extent:f.properties.extent||null};
  }).filter(place=>{
    const key=[place.primary,place.secondary,place.kind].join("|").toLowerCase();
    if(seen.has(key)) return false;
    seen.add(key);return true;
  });
}

function createController(options){
  const {input,results:acEl,status:statusEl,map,selected,select:setLoc,search:run,
    pick:cspSearchPlace,isFocused,tap:MAP_TAP,clearLocation,nativeHost}=options;
  const lookup=options.lookup||geocode, suggest=options.suggest||suggestions;
  const clock=options.clock||globalThis;
  let acAbort=null, acTimer=null, acList=[], acIdx=-1, acGeneration=0;

  function acHide(){ acEl.style.display="none"; acIdx=-1 }

  // Invalidate pending responses when a committed search overtakes suggestions.
  function acCancel(){ clock.clearTimeout(acTimer); if(acAbort) acAbort.abort(); acGeneration++; acList=[] }

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

  function acPick(n){
    const place=acList[n];if(place) cspSearchPlace(place);
  }

  async function acQuery(t){
    if(acAbort) acAbort.abort();
    acAbort=new AbortController();
    const generation=++acGeneration;
    try{
      const found=await suggest(t,acAbort.signal);
      if(generation!==acGeneration||!isFocused()||input.value.trim()!==t) return;
      acList=found;acIdx=-1;
      if(!acList.length) acShow('<div class="note">No matches</div>');
      else acRender();
    }catch(e){
      if(e?.name==="AbortError"||generation!==acGeneration||!isFocused()||input.value.trim()!==t) return;
      acList=[]; acShow(`<div class="note">Place search unavailable \u2014 you can still paste coordinates or double-${MAP_TAP} the map</div>`);
    }
  }

  function acInput(){
    const t=input.value.trim();
    clock.clearTimeout(acTimer);
    if(acAbort) acAbort.abort();
    acList=[];acIdx=-1;
    try{ if(t.length<3 || parseCoordinates(t)){ acHide(); return } }
    catch(error){ acHide(); return }
    acShow('<div class="note">Searching\u2026</div>');
    acTimer=clock.setTimeout(()=>acQuery(t), 280);   // debounce autocomplete traffic
  }

  function acKey(e){
    const open=acEl.style.display!=="none" && acList.length;
    if(e.key==="ArrowDown"&&open){ e.preventDefault(); acIdx=(acIdx+1)%acList.length; acRender() }
    else if(e.key==="ArrowUp"&&open){ e.preventDefault(); acIdx=acIdx<0?acList.length-1:(acIdx-1+acList.length)%acList.length; acRender() }
    else if(e.key==="Enter"){ if(open&&acIdx>=0){ e.preventDefault(); acPick(acIdx) } else { acCancel(); acHide(); doSearch() } }
    else if(e.key==="Escape"){ if(open) e.preventDefault(); acCancel(); acHide() }
  }

  async function doSearch(){
    const t=input.value.trim(); if(!t) return;
    acCancel(); acHide();
    try{
      const ll=parseCoordinates(t);
      if(ll){ setLoc(ll.lat,ll.lng,/*keepLabel*/true,t); map.setView([ll.lat,ll.lng], Math.max(map.getZoom(),10)); }
      else{
        statusEl.dataset.kind="general",statusEl.innerHTML='<span class="spin"></span> Geocoding…';
        const g=await lookup(t);
        setLoc(g.lat,g.lng,/*keepLabel*/true,t); map.setView([g.lat,g.lng],11);
      }
      run();
    }catch(e){ statusEl.dataset.kind="general",statusEl.innerHTML=`<span class="chip err">${e.message}</span>` }
  }

  function clear(){
    clearLocation();
    if(!nativeHost()) input.focus({preventScroll:true});
  }
  function focus(){ if(acList.length&&input.value.trim().length>=3) acRender(); }
  return {hide:acHide,cancel:acCancel,input:acInput,key:acKey,search:doSearch,clear,focus,
    coordinates:()=>coordinateForActions(input.value,selected())};
}

return {parseCoordinates,coordinateLinks,coordinateForActions,suggestions,geocode,
  createController,escape:esc,endpoint:PHOTON};
});
