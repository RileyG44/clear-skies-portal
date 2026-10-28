/* The snapshot image proxy: lets an exported map include raster tiles from
   providers that refuse CORS, and nothing else - exact hosts, HTTPS only, a
   bounded body that must really be an image, and re-checked redirects. */
"use strict";
const net = require("net");
const {HttpError,send,jsonBody} = require("./http.js");
const {isPng,isJpeg,isWebp} = require("./images.js");
const {TILE_MS,WADNR_HOST,upstream,cached} = require("./upstream.js");
const {key} = require("./tile-cache.js");

const TTL_SNAPSHOT = 24*3600*1000;
const MAX_SNAPSHOT_URL = 8192;
const MAX_SNAPSHOT_IMAGE = 16*1024*1024;
const MAX_SNAPSHOT_REDIRECTS = 3;
/* These are the raster providers rendered by the portal today. Keep this list
   exact: the screenshot helper must never become a general-purpose proxy.
   Every entry is matched exactly - there is no suffix wildcard. CARTO used to
   need one because Leaflet substituted {s} with a/b/c/d shards; the basemap
   moved to Esri, which serves from a single host, so that exception is gone. */
const SNAPSHOT_IMAGE_HOSTS = new Set([
  "planetarycomputer.microsoft.com",
  "titiler.xyz",
  "gibs.earthdata.nasa.gov",
  "elevation.nationalmap.gov",
  "s3.amazonaws.com",
  "prd-tnm.s3.amazonaws.com",
  "services.arcgisonline.com",
  "tiles.maps.eox.at",
  "basemap.nationalmap.gov",
  "hydro.nationalmap.gov",
  "carto.nationalmap.gov",
  "mrdata.usgs.gov",
  "gis.dnr.wa.gov",
  WADNR_HOST,
  "tiles.macrostrat.org",
  "mapservices.weather.noaa.gov",
  "earthquake.usgs.gov",
  "tiles.arcgis.com"
]);

function validateSnapshotImageUrl(value){
  if(typeof value!=="string"||!value.trim())
    throw new HttpError(400,"snapshot image URL is required");
  if(Buffer.byteLength(value,"utf8")>MAX_SNAPSHOT_URL)
    throw new HttpError(400,`snapshot image URL exceeds ${MAX_SNAPSHOT_URL} bytes`);
  let target;
  try{ target=new URL(value) }
  catch(e){ throw new HttpError(400,"snapshot image URL is invalid") }
  if(target.protocol!=="https:")
    throw new HttpError(400,"snapshot image URL must use HTTPS");
  if(target.username||target.password)
    throw new HttpError(400,"snapshot image URL must not contain credentials");
  if(target.port&&target.port!=="443")
    throw new HttpError(400,"snapshot image URL must use port 443");

  const rawHost=target.hostname.toLowerCase();
  const ipHost=rawHost.startsWith("[")&&rawHost.endsWith("]") ? rawHost.slice(1,-1) : rawHost;
  const hostname=ipHost.replace(/\.$/,"");
  if(net.isIP(hostname)||hostname==="localhost"||hostname.endsWith(".localhost")||
     hostname.endsWith(".local")||hostname.endsWith(".internal")||hostname.endsWith(".home.arpa"))
    throw new HttpError(403,"snapshot image URL must not use a literal or private host");
  if(!SNAPSHOT_IMAGE_HOSTS.has(hostname))
    throw new HttpError(403,"snapshot image host is not allowed");

  target.hostname=hostname;
  target.hash="";
  return target;
}

function resolveSnapshotImageRedirect(current,location){
  if(typeof location!=="string"||!location.trim())
    throw new HttpError(502,"snapshot image upstream sent a redirect without a location");
  let next;
  try{ next=new URL(location,current) }
  catch(e){ throw new HttpError(502,"snapshot image upstream sent an invalid redirect") }
  return validateSnapshotImageUrl(next.href);
}

const SNAPSHOT_IMAGE_TYPES = new Map([
  ["image/png",isPng],
  ["image/jpeg",isJpeg],
  ["image/webp",isWebp]
]);
const SNAPSHOT_REDIRECT_STATUSES = new Set([301,302,303,307,308]);

async function fetchSnapshotImage(initial, signal){
  let target=validateSnapshotImageUrl(initial instanceof URL ? initial.href : initial);
  const visited=new Set();
  for(let redirects=0;;redirects++){
    if(visited.has(target.href))
      throw new HttpError(502,"snapshot image upstream redirect loop");
    visited.add(target.href);
    let result;
    try{
      result=await upstream({
        hostname:target.hostname,
        port:443,
        path:target.pathname+target.search,
        method:"GET",
        __timeout:TILE_MS,
        __maxBody:MAX_SNAPSHOT_IMAGE,
        headers:{
          "User-Agent":"clear-skies-portal",
          "Accept":"image/png,image/jpeg,image/webp",
          "Accept-Encoding":"gzip, deflate, br"
        }
      }, null, signal);
    }catch(error){
      if(error&&error.code==="UPSTREAM_TOO_LARGE")
        throw new HttpError(502,`snapshot image exceeds ${MAX_SNAPSHOT_IMAGE} bytes`);
      throw new HttpError(502,`snapshot image upstream request failed: ${String(error&&error.message||error)}`);
    }
    if(SNAPSHOT_REDIRECT_STATUSES.has(result.status)){
      if(redirects>=MAX_SNAPSHOT_REDIRECTS)
        throw new HttpError(502,"snapshot image upstream sent too many redirects");
      target=resolveSnapshotImageRedirect(target,result.headers&&result.headers.location);
      continue;
    }
    if(result.status!==200)
      throw new HttpError(502,`snapshot image upstream returned HTTP ${result.status}`);
    const type=String(result.type||"").split(";",1)[0].trim().toLowerCase();
    const matches=SNAPSHOT_IMAGE_TYPES.get(type);
    if(!matches)
      throw new HttpError(415,"snapshot image upstream did not return PNG, JPEG, or WebP");
    if(!matches(result.body))
      throw new HttpError(502,`snapshot image upstream returned invalid ${type} data`);
    return {status:200,type,body:result.body};
  }
}

const routes={
  "/api/snapshot/image":async(req,res,{u,signal})=>{
    if(req.method!=="GET")
      return send(res,405,"application/json",jsonBody({error:"method not allowed"}),{"Allow":"GET"});
    const target=validateSnapshotImageUrl(u.searchParams.get("url"));
    const result=await cached(key("snapshot:image:v1:"+target.href),TTL_SNAPSHOT,
      /* Pass the client's signal so an abandoned snapshot fetch dies with the
         page instead of holding one of the four global upstream slots. */
      ()=>fetchSnapshotImage(target, signal));
    return send(res,200,result.type,result.body,{
      "X-Cache":result.hit?"HIT":"MISS",
      "Cache-Control":"public, max-age=86400"
    });
  }
};

module.exports={validateSnapshotImageUrl,resolveSnapshotImageRedirect,routes};
