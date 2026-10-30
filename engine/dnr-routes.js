/* WA DNR lidar: the coverage catalogue, raster acquisition and its warm
   jobs (all in DnrStore), the file query and the hillshade export proxy. */
"use strict";
const {HttpError,readBody,readJson,send,jsonBody} = require("./http.js");
const {isPng} = require("./images.js");
const {WADNR_HOST,WADNR_MAP,TILE_MS,limitedUpstream,terrainAborted} = require("./upstream.js");
const {TTL_TILE,TTL_META,key,cacheGet,cachePut} = require("./tile-cache.js");
const {validBbox,csvNumbers,validMercBbox} = require("./params.js");

let dnr = null;
function init(dnrStore){ dnr=dnrStore }

const routes={
  /* Catalogue discovery is independent of the expensive file-intersection
     query. Bounds identify candidates; only raster pixels prove coverage. */
  "/api/wadnr/coverage":async(req,res,{u,p,signal})=>{
    const bbox=validBbox((u.searchParams.get("bbox")||"").split(","));
    if(!bbox)throw new HttpError(400,"bbox=w,s,e,n required");
    try{
      const value=await dnr.coverage(bbox);
      return send(res,200,"application/json",Buffer.from(JSON.stringify(value)),{"Cache-Control":"no-store"});
    }catch(error){
      return send(res,503,"application/json",Buffer.from(JSON.stringify({state:"error",error:String(error.message||error)})),{"Cache-Control":"no-store","Retry-After":"30"});
    }
  },
  "/api/wadnr/status":async(req,res,{u,p,signal})=>{
    return send(res,200,"application/json",Buffer.from(JSON.stringify(dnr.status())),{"Cache-Control":"no-store"});
  },
  /* What has moved to iCloud Drive. Selecting DNR over one of these areas, or
     fetching it, copies it back instead of downloading it again. */
  "/api/wadnr/archive":async(req,res,{u,p,signal})=>{
    return send(res,200,"application/json",jsonBody({...dnr.archive.status(),files:dnr.archive.list()}),{"Cache-Control":"no-store"});
  },
  "/api/wadnr/warm":async(req,res,{u,p,signal})=>{
    const job=await readJson(req,{});
    if(!validBbox(job.bbox)||job.bbox[1]<-85||job.bbox[3]>85)throw new HttpError(400,"bbox=w,s,e,n required");
    if(dnr.warm.running)return send(res,409,"application/json",jsonBody({busy:true,error:"Another WA DNR download is running"}),{"Cache-Control":"no-store"});
    try{return send(res,200,"application/json",jsonBody(dnr.startWarm(job.bbox)),{"Cache-Control":"no-store"});}
    catch(error){throw new HttpError(400,String(error.message||error));}
  },
  "/api/wadnr/warm/status":async(req,res,{u,p,signal})=>{
    return send(res,200,"application/json",jsonBody({...dnr.warm,acquisition:dnr.status()}),{"Cache-Control":"no-store"});
  },
  "/api/wadnr/warm/stop":async(req,res,{u,p,signal})=>{
    const job=await readJson(req,{});
    return send(res,200,"application/json",jsonBody(dnr.stopWarm(job.id)),{"Cache-Control":"no-store"});
  },
  /* ---- WA DNR: which lidar files cover this polygon? ---- */
  "/api/wadnr/query":async(req,res,{u,p,signal})=>{
    const geojson = (await readBody(req)).toString();
    let geometry;
    try{ geometry=JSON.parse(geojson) }catch(e){ throw new HttpError(400,"valid GeoJSON required") }
    if(!geometry||geometry.type!=="Polygon"||!Array.isArray(geometry.coordinates)||!geometry.coordinates.length)
      throw new HttpError(400,"GeoJSON Polygon required");
    const form = "geojson=" + encodeURIComponent(geojson);
    const k = key("wadnr:query:"+geojson);
    const hit=cacheGet(k,TTL_META);
    if(hit) return send(res,200,hit.type,hit.body,{"X-Cache":"HIT"});
    let r=null;
    try{
      r=await limitedUpstream(k,{host:WADNR_HOST,path:"/query",method:"POST",__timeout:30000,
        headers:{"Content-Type":"application/x-www-form-urlencoded",
                 "Content-Length":Buffer.byteLength(form),
                 "User-Agent":"clear-skies-portal"}},form,signal);
    }catch(error){ if(terrainAborted(error)) return }
    let valid=false;
    try{valid=r?.status===200&&Array.isArray(JSON.parse(r.body));}catch{}
    if(valid){
      cachePut(k,200,r.type,r.body);
      return send(res,200,r.type,r.body,{"X-Cache":"MISS"});
    }
    return send(res,503,"application/json",Buffer.from('{"state":"error","error":"DNR coverage lookup failed; coverage is unknown"}'),
                {"X-Cache":"ERROR","Cache-Control":"no-store","Retry-After":"30"});
  },
  /* ---- WA DNR: hillshade image for a bbox, restricted to given layers ---- */
  "/api/wadnr/export":async(req,res,{u,p,signal})=>{
    const bbox   = u.searchParams.get("bbox")   || "";
    const size   = u.searchParams.get("size")   || "256,256";
    const layers = u.searchParams.get("layers") || "";
    const dims=csvNumbers(size,2);
    /* The dpi sets the map scale ArcGIS draws at. WA DNR's hillshade comes
       from a tile cache: a 512 px export at 96 dpi asks for one level finer
       than the cache holds, and every such tile came back as Esri's "Map
       data not yet available" stamp. So a larger export keeps the scale of
       a 256 px one (192 dpi at 512 px) unless the page asks otherwise. */
    const dpi=u.searchParams.has("dpi")?Number(u.searchParams.get("dpi")):dims?Math.round(96*dims[0]/256):96;
    if(!validMercBbox(bbox)||!dims||dims.some(v=>!Number.isInteger(v)||v<1||v>1024)||
       !Number.isInteger(dpi)||dpi<24||dpi>384||
       (layers&&(!/^\d+(,\d+)*$/.test(layers)||layers.split(",").length>14)))
      return send(res,400,"application/json",Buffer.from('{"error":"bad params"}'));
    let qp = `?bbox=${bbox}&bboxSR=3857&imageSR=3857&size=${size}`
           + `&format=png32&transparent=true&dpi=${dpi}&f=image`;
    if(layers) qp += `&layers=show:${layers}`;
    const k = key("wadnr:export:"+qp);
    const good = cacheGet(k, TTL_TILE);
    if(good) return send(res,200,good.type,good.body,
                         {"X-Cache":"HIT","Cache-Control":"public, max-age=604800"});
    let r=null;
    try{
      r = await limitedUpstream(k,{host:WADNR_HOST, path:WADNR_MAP+"/export"+qp, method:"GET",
                                  headers:{"User-Agent":"clear-skies-portal"}, __timeout:TILE_MS},null,signal);
    }catch(e){ if(terrainAborted(e)) return; r=null }
    if(r && r.status===200 && isPng(r.body)){
      cachePut(k, 200, "image/png", r.body);
      return send(res,200,"image/png",r.body,{"X-Cache":"MISS","Cache-Control":"public, max-age=604800"});
    }
    /* Offline, or upstream down: a high-density request can still be drawn
       from the 256 px copy an area download cached. */
    const lowRes=size!=="256,256"&&cacheGet(key("wadnr:export:"+qp.replace(`size=${size}`,"size=256,256").replace(`dpi=${dpi}`,"dpi=96")),TTL_TILE);
    if(lowRes) return send(res,200,lowRes.type,lowRes.body,{"X-Cache":"HIT-256","Cache-Control":"no-store"});
    /* A transport or upstream failure is not an empty lidar tile. Returning
       a successful transparent image made the browser stop retrying and the
       map appeared to give up. Preserve the error so the resilient tile
       client can back off and retry it. */
    return send(res,204,"image/png",Buffer.alloc(0),
                {"X-Cache":"ERROR","X-CSP-Error":"upstream","Cache-Control":"no-store","Retry-After":"2"});
  },
};

module.exports={init,routes};
