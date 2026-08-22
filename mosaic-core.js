/* Clear Skies Portal — dependency-free mosaic planning helpers.
   Kept separate from the UI so geometry, identity, and level-of-detail rules
   can be tested without a browser or Leaflet. */
(function(root,factory){
  const api=factory();
  if(typeof module==="object" && module.exports) module.exports=api;
  root.CSPMosaic=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";

  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const roundTo=(v,step)=>Math.round(Number(v)/step)*step;

  function metersPerPixel(lat,zoom){
    return 156543.03392804097*Math.cos(clamp(Number(lat)||0,-85,85)*Math.PI/180)/Math.pow(2,Number(zoom)||0);
  }

  function nativeZoomForGsd(gsd,lat){
    const m=Number(gsd);
    if(!(m>0)) return null;
    return clamp(Math.ceil(Math.log2(156543.03392804097*Math.cos(clamp(Number(lat)||0,-85,85)*Math.PI/180)/m)),0,24);
  }

  function nearLongitude(lng,anchor){
    let x=Number(lng), a=Number(anchor)||0;
    while(x-a>180) x-=360;
    while(x-a<-180) x+=360;
    return x;
  }

  function ringContains(ring,lng,lat){
    if(!Array.isArray(ring)||ring.length<3) return false;
    const y=Number(lat), points=[];
    let previous=null;
    /* Unwrap the ring continuously instead of moving every vertex around the
       query independently. For a 179 -> -179 edge, the latter turns the small
       dateline polygon into a 358-degree polygon whenever the query is near
       Greenwich. Continuous unwrapping keeps that edge at 179 -> 181. */
    for(const raw of ring){
      const p=raw||[];
      let x=Number(p[0]); const py=Number(p[1]);
      if(!Number.isFinite(x)||!Number.isFinite(py)) continue;
      if(previous!=null) x=nearLongitude(x,previous);
      points.push([x,py]); previous=x;
    }
    if(points.length<3||!Number.isFinite(y)) return false;
    const x=nearLongitude(lng,points[0][0]);
    let inside=false;
    for(let i=0,j=points.length-1;i<points.length;j=i++){
      const [xi,yi]=points[i], [xj,yj]=points[j];
      const crosses=((yi>y)!==(yj>y)) && x < (xj-xi)*(y-yi)/(yj-yi)+xi;
      if(crosses) inside=!inside;
    }
    return inside;
  }

  function polygonContains(poly,lng,lat){
    if(!Array.isArray(poly)||!ringContains(poly[0],lng,lat)) return false;
    for(let i=1;i<poly.length;i++) if(ringContains(poly[i],lng,lat)) return false;
    return true;
  }

  function geometryContains(geom,lng,lat){
    if(!geom||!Array.isArray(geom.coordinates)) return false;
    if(geom.type==="Polygon") return polygonContains(geom.coordinates,lng,lat);
    if(geom.type==="MultiPolygon") return geom.coordinates.some(p=>polygonContains(p,lng,lat));
    return false;
  }

  function bboxContainsPoint(bbox,lng,lat){
    if(!Array.isArray(bbox)||bbox.length!==4) return false;
    const [w,s,e,n]=bbox.map(Number), y=Number(lat), x=Number(lng);
    if(![w,s,e,n,x,y].every(Number.isFinite)||y<s||y>n) return false;
    return w<=e ? x>=w&&x<=e : x>=w||x<=e;
  }

  function itemContains(item,lng,lat){
    return item&&item.geom ? geometryContains(item.geom,lng,lat)
                           : bboxContainsPoint(item&&item.bbox,lng,lat);
  }

  function makeCoverageGrid(view,size){
    const G=Math.max(4,Math.min(96,Number(size)||32));
    return {w:Number(view.w),s:Number(view.s),e:Number(view.e),n:Number(view.n),G,
            cells:new Uint8Array(G*G)};
  }

  function cellsGained(cov,item,mark){
    if(!cov||!item) return 0;
    let east=cov.e;
    if(east<cov.w) east+=360;
    const dx=(east-cov.w)/cov.G, dy=(cov.n-cov.s)/cov.G;
    let gain=0;
    for(let j=0;j<cov.G;j++) for(let i=0;i<cov.G;i++){
      const k=j*cov.G+i;
      if(cov.cells[k]) continue;
      let lng=cov.w+(i+0.5)*dx;
      if(lng>180) lng-=360;
      const lat=cov.s+(j+0.5)*dy;
      if(itemContains(item,lng,lat)){ gain++; if(mark) cov.cells[k]=1; }
    }
    return gain;
  }

  function coveredFraction(cov){
    if(!cov||!cov.cells||!cov.cells.length) return 0;
    let n=0; for(const v of cov.cells) n+=v?1:0;
    return n/cov.cells.length;
  }

  function footprintBase(item){
    const p=item&&item.props||{};
    if(p["grid:code"]) return String(p["grid:code"]).replace(/^MGRS-/,"MGRS-");
    if(p["s2:mgrs_tile"]) return "MGRS-"+p["s2:mgrs_tile"];
    if(p["landsat:wrs_path"]!=null) return "WRS-"+p["landsat:wrs_path"]+"-"+p["landsat:wrs_row"];
    return String(item&&item.id||"scene");
  }

  /* MGRS alone is not a footprint: edge-of-swath acquisitions in one grid cell
     can be disjoint. A coarse geometry signature groups near-identical dates and
     provider variants while allowing complementary acquisitions to coexist. */
  function patchKey(item){
    const b=item&&item.bbox;
    if(Array.isArray(b)&&b.length===4)
      return footprintBase(item)+"|"+b.map(v=>roundTo(v,0.05).toFixed(2)).join(",");
    return footprintBase(item)+"|"+String(item&&item.id||"");
  }

  function productKey(item){
    const p=item&&item.props||{};
    const exact=p["s2:product_uri"]||p["landsat:product_id"]||p["landsat:scene_id"];
    if(exact) return String(exact).toUpperCase();
    const platform=String(p.platform||p.constellation||"").toLowerCase();
    const orbit=p["sat:relative_orbit"]==null?"":String(p["sat:relative_orbit"]);
    const day=String(item&&item.date||"").slice(0,10);
    return [item&&item.coll||"",patchKey(item),platform,day,orbit].join("|");
  }

  function bboxContains(outer,inner){
    return Array.isArray(outer)&&Array.isArray(inner)&&outer.length===4&&inner.length===4&&
      outer[0]<=inner[0]&&outer[1]<=inner[1]&&outer[2]>=inner[2]&&outer[3]>=inner[3];
  }

  function splitBbox(bbox){
    if(!Array.isArray(bbox)||bbox.length!==4) return [];
    let [w,s,e,n]=bbox.map(Number);
    if(![w,s,e,n].every(Number.isFinite)||n<s) return [];
    let width=e-w;
    while(width<0) width+=360;
    if(width>=360) return [[-180,s,180,n]];
    w=((w+180)%360+360)%360-180;
    e=w+width;
    return e<=180 ? [[w,s,e,n]] : [[w,s,180,n],[-180,s,e-360,n]];
  }

  return {metersPerPixel,nativeZoomForGsd,geometryContains,bboxContainsPoint,itemContains,
          makeCoverageGrid,cellsGained,coveredFraction,footprintBase,patchKey,productKey,bboxContains,splitBbox};
});
