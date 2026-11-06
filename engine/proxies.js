/* Cached proxies for upstreams the browser cannot use directly (no CORS) or
   that installed and offline clients read from the engine's cache. */
"use strict";
const {send} = require("./http.js");
const {isPng,TRANSPARENT} = require("./images.js");
const {TILE_MS,cached,upstream,limitedUpstream,terrainAborted} = require("./upstream.js");
const {TTL_TILE,key,cacheGet,cachePut} = require("./tile-cache.js");
const {validMercBbox,DEP_RULES,exportPixels} = require("./params.js");

const TTL_FIRMS  = 20*60*1000;
const TTL_SNOW   = 2*3600*1000;       // NOHRSC publishes four analyses per day
/* Cold NHD renders often finish just under 10 s. CloudFront's gateway page
   follows at about 10.2 s and carries no Access-Control-Allow-Origin. Stay
   under that, and answer the browser with a 1 px PNG instead of the page. */
const HYDRO_EXPORT_MS=9800;
const HYDRO_EXPORT_KEYS=["bbox","bboxSR","imageSR","size","format","transparent","dpi","f","layers"];

function hydroExportPath(value){
  let target;
  try{ target=new URL(value) }
  catch(e){ return null }
  if(target.protocol!=="https:"||target.username||target.password||target.port&&target.port!=="443") return null;
  if(target.hostname!=="hydro.nationalmap.gov") return null;
  if(target.pathname!=="/arcgis/rest/services/nhd/MapServer/export") return null;
  const next=new URL("https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/export");
  for(const key of HYDRO_EXPORT_KEYS){
    const item=target.searchParams.get(key);
    if(!item||item.length>200) return null;
    next.searchParams.set(key,item);
  }
  if(next.searchParams.get("bboxSR")!=="3857"||next.searchParams.get("imageSR")!=="3857") return null;
  if(next.searchParams.get("format")!=="png32"||next.searchParams.get("f")!=="image") return null;
  if(next.searchParams.get("transparent")!=="true") return null;
  if(!/^\d{2,3}$/.test(next.searchParams.get("dpi"))) return null;
  if(!/^\d{2,4},\d{2,4}$/.test(next.searchParams.get("size"))) return null;
  if(!/^show:\d+(?:,\d+)*$/.test(next.searchParams.get("layers"))) return null;
  if(!/^-?\d+(\.\d+)?(?:,-?\d+(\.\d+)?){3}$/.test(next.searchParams.get("bbox"))) return null;
  return next.pathname+next.search;
}

const routes={
  /* ---- 3DEP terrain tiles (cached, so warmed areas work offline) ---- */
  "/api/3dep":async(req,res,{u,p,signal})=>{
    const bbox=u.searchParams.get("bbox")||"";
    const px=exportPixels(u);
    const rule=u.searchParams.get("rule")||"Hillshade Gray";
    if(!validMercBbox(bbox)||!DEP_RULES.has(rule))
      return send(res,400,"application/json",Buffer.from('{"error":"bad bbox or rendering rule"}'));
    const rr=encodeURIComponent(JSON.stringify({rasterFunction:rule}));
    const dp=`/arcgis/rest/services/3DEPElevation/ImageServer/exportImage`
           + `?bbox=${bbox}&bboxSR=3857&imageSR=3857&size=${px},${px}&format=png&transparent=true&f=image&renderingRule=${rr}`;
    const k=key("3dep:"+dp);
    const hit=cacheGet(k,TTL_TILE);
    if(hit) return send(res,200,hit.type,hit.body,{"X-Cache":"HIT","Cache-Control":"public, max-age=604800"});
    let r=null;
    try{ r=await limitedUpstream(k,{host:"elevation.nationalmap.gov", path:dp, method:"GET",
                                   headers:{"User-Agent":"clear-skies-portal"}, __timeout:TILE_MS},null,signal) }
    catch(e){ if(terrainAborted(e)) return; r=null }
    /* ArcGIS answers 200 with a JSON error body when a request upsets it, and
       this used to cache anything over 100 bytes without looking at what it
       was. A bad answer then stuck around for TTL_TILE — 90 days — which is
       how one wrong tile becomes permanent. Check it is really a PNG. */
    if(r && r.status===200 && isPng(r.body)){
      cachePut(k,200,r.type,r.body);
      return send(res,200,r.type,r.body,{"X-Cache":"MISS","Cache-Control":"public, max-age=604800"});
    }
    const lowRes=px!==256&&cacheGet(key("3dep:"+dp.replace(`size=${px},${px}`,"size=256,256")),TTL_TILE);
    if(lowRes) return send(res,200,lowRes.type,lowRes.body,{"X-Cache":"HIT-256","Cache-Control":"no-store"});
    return send(res,204,"image/png",Buffer.alloc(0),
                {"X-Cache":"ERROR","X-CSP-Error":"upstream","Cache-Control":"no-store","Retry-After":"2"});
  },
  /* ---- NASA FIRMS: 24 h active-fire hotspots (no CORS upstream) ---- */
  "/api/firms":async(req,res,{u,p,signal})=>{
    const sat = (u.searchParams.get("sat")||"J1").toUpperCase();
    const map = {J1:"noaa-20-viirs-c2/csv/J1_VIIRS_C2_USA_contiguous_and_Hawaii_24h.csv",
                 J2:"noaa-21-viirs-c2/csv/J2_VIIRS_C2_USA_contiguous_and_Hawaii_24h.csv",
                 SV:"suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_USA_contiguous_and_Hawaii_24h.csv"};
    const rel = map[sat] || map.J1;
    const r = await cached(key("firms:"+rel), TTL_FIRMS, ()=>upstream({
      host:"firms.modaps.eosdis.nasa.gov", path:"/data/active_fire/"+rel, method:"GET",
      headers:{"User-Agent":"clear-skies-portal","Accept-Encoding":"gzip"}}, null, signal));
    /* This used to send no Cache-Control at all, so every page load re-fetched a
       national-extent CSV. The server already holds it for TTL_FIRMS (20 min);
       let the browser keep it for half that, and only when it really loaded -
       an upstream error must not be pinned in the browser for ten minutes. */
    return send(res, r.status, "text/csv; charset=utf-8", r.body,
                {"X-Cache": r.hit?"HIT":"MISS",
                 "Cache-Control": r.status===200 ? "public, max-age=600" : "no-store"});
  },
  /* ---- optional warm-cache path for Macrostrat geology tiles ------------
     Current browsers can load these directly with CORS. Retain the exact,
     bounded route for installed/offline clients and older saved builds. */
  "/api/geo/":async(req,res,{u,p,signal})=>{
    const m=p.match(/^\/api\/geo\/(macrostrat)\/(\d+)\/(\d+)\/(\d+)\.png$/);
    if(!m) return send(res,400,"text/plain",Buffer.from("bad geo tile path"));
    const [,which,z,x,y]=m;
    const host="tiles.macrostrat.org", pth=`/carto/${z}/${x}/${y}.png`;
    const k=key("geo:"+which+":"+pth);
    const hit=cacheGet(k, TTL_TILE);          // bedrock geology is not news
    if(hit) return send(res,200,hit.type,hit.body,
                        {"X-Cache":"HIT","Cache-Control":"public, max-age=2592000"});
    let r=null;
    try{ r=await limitedUpstream(k,{host, path:pth, method:"GET",
                                   headers:{"User-Agent":"clear-skies-portal"}, __timeout:TILE_MS},null,signal) }
    catch(e){ if(terrainAborted(e)) return; r=null }
    if(r && r.status===200 && isPng(r.body)){
      cachePut(k,200,"image/png",r.body);
      return send(res,200,"image/png",r.body,
                  {"X-Cache":"MISS","Cache-Control":"public, max-age=2592000"});
    }
    return send(res,204,"image/png",Buffer.alloc(0),
                {"X-Cache":"ERROR","X-CSP-Error":"upstream","Cache-Control":"no-store","Retry-After":"2"});
  },
  /* ---- current snow analysis --------------------------------------------
     The browser can now use NOHRSC directly, but this route remains the
     preferred warm M2 cache and a resilient fallback. NOHRSC refreshes four
     times per day, so two hours keeps the cache useful without hiding a new
     analysis for most of an update cycle. */
  "/api/snow":async(req,res,{u,p,signal})=>{
    const bbox=u.searchParams.get("bbox")||"";
    const layer=u.searchParams.get("layer")||"3",px=exportPixels(u);
    if(!validMercBbox(bbox)) return send(res,400,"application/json",Buffer.from('{"error":"bad bbox"}'));
    if(!["3","7"].includes(layer))                 // 3 = snow depth, 7 = SWE
      return send(res,400,"application/json",Buffer.from('{"error":"bad layer"}'));
    const pth="/raster/rest/services/snow/NOHRSC_Snow_Analysis/MapServer/export"
            + `?bbox=${bbox}&bboxSR=3857&imageSR=3857&size=${px},${px}`
            + `&format=png32&transparent=true&f=image&layers=show:${layer}`;
    const k=key("snow:"+pth);
    const hit=cacheGet(k, TTL_SNOW);
    if(hit) return send(res,200,hit.type,hit.body,{"X-Cache":"HIT","Cache-Control":"public, max-age=3600"});
    let r=null;
    try{ r=await limitedUpstream(k,{host:"mapservices.weather.noaa.gov", path:pth, method:"GET",
                                   headers:{"User-Agent":"clear-skies-portal"}, __timeout:TILE_MS},null,signal) }
    catch(e){ if(terrainAborted(e)) return; r=null }
    if(r && r.status===200 && isPng(r.body)){
      cachePut(k,200,"image/png",r.body);
      return send(res,200,"image/png",r.body,{"X-Cache":"MISS","Cache-Control":"public, max-age=3600"});
    }
    return send(res,204,"image/png",Buffer.alloc(0),
                {"X-Cache":"ERROR","X-CSP-Error":"upstream","Cache-Control":"no-store","Retry-After":"2"});
  },
  /* NHD feature exports. The public host renders on demand and, under load,
     CloudFront answers with an HTML gateway page that has no CORS header.
     A browser image request then logs a CORS error. This route is same-origin
     for the local engine: a real PNG on success, and the 1 px sentinel (which
     the map treats as "no detail") when the render does not come back in time.
     The query is rebuilt from an allowlist so this cannot proxy anything else. */
  "/api/reference/nhd":async(req,res,{u,signal})=>{
    if(req.method!=="GET")
      return send(res,405,"application/json",Buffer.from('{"error":"method not allowed"}'),{"Allow":"GET"});
    const path=hydroExportPath(u.searchParams.get("url"));
    if(!path) return send(res,400,"application/json",Buffer.from('{"error":"bad reference export"}'));
    const quiet=()=>send(res,200,"image/png",TRANSPARENT,{"Cache-Control":"no-store","X-CSP-Error":"upstream"});
    let upstreamResult=null;
    try{
      upstreamResult=await limitedUpstream("hydro:"+path,{
        host:"hydro.nationalmap.gov", hostname:"hydro.nationalmap.gov", path, method:"GET",
        headers:{"User-Agent":"clear-skies-portal","Accept":"image/png"},
        __timeout:HYDRO_EXPORT_MS
      },null,signal);
    }catch(error){ if(terrainAborted(error)) return; upstreamResult=null }
    if(upstreamResult&&upstreamResult.status===200&&isPng(upstreamResult.body)&&upstreamResult.body.length>TRANSPARENT.length)
      return send(res,200,"image/png",upstreamResult.body,{"Cache-Control":"public, max-age=86400"});
    return quiet();
  },
};

module.exports={routes};
