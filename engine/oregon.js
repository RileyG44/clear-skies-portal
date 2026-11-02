/* Numeric Oregon lidar from DOGAMI's primary bare-earth rasters. Published
   overviews never enter this path. Project metadata must establish the units
   and spacing before a raster can contribute; feet become metres once. */
'use strict';
const {limitedUpstream}=require('./upstream.js');
const {send}=require('./http.js'),{TRANSPARENT,isTiff}=require('./images.js');
const {TTL_TILE,key,cacheGet,cachePut}=require('./tile-cache.js');
const {terrainTask}=require('./terrain.js');
const {mercBbox}=require('../cache-budget.js');
const {oregonTileAllowed}=require('../public-terrain.js');
const HOST='gis.dogami.oregon.gov',ROOT='/arcgis/rest/services/lidar/';
const SERVICE=ROOT+'DIGITAL_TERRAIN_MODEL_MOSAIC/ImageServer';
const PROJECTS=ROOT+'DOGAMI_Lidar_Project_Status/MapServer/1';
const VERSION='oregon-olc-v1',CATALOG_TTL=10*60*1000;
const normalize=name=>String(name||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
function selectSources(items,projects){
  return items.filter(item=>item.Category===1&&Number.isInteger(item.OBJECTID)&&item.LowPS>0&&item.LowPS*0.3048<=1.001)
    .map(item=>{
      // Raster ids and project ids are unrelated. Match the survey name/year;
      // an overlapping footprint or coincident id cannot establish provenance.
      const matches=projects.filter(p=>p.Project&&normalize(item.Name).includes(normalize(p.Project)));
      if(matches.length!==1)return null;
      const p=matches[0];
      if(!/^feet$/i.test(p.Vert_Units||'')||!/^3\s+FOOT$/i.test(p.CELL_SIZE||''))return null;
      return {datasetId:item.OBJECTID,project:p.Project,provider:'Oregon DOGAMI',nativeMeters:item.LowPS*0.3048,
        acquisition:p.ACQ_DATES||null,verticalDatum:p.Vert_Datum||null,horizontalDatum:p.Horz_Datum||null,
        sourceVerticalUnits:p.Vert_Units,verticalUnits:'meters',verticalUnitBasis:'DOGAMI completed OLC project metadata',
        metadataDatasetId:p.OBJECTID,metadataURL:p.Report||null,order:item.ZOrder||0,
        contribution:'Selected primary mosaic raster; per-pixel contributor is not exposed by the service'};
    }).filter(Boolean).sort((a,b)=>a.nativeMeters-b.nativeMeters||b.order-a.order).slice(0,8);
}
async function jsonQuery(path,params,signal){
  const url=path+'/query?'+new URLSearchParams({f:'json',returnGeometry:'false',...params});
  const result=await limitedUpstream(VERSION+url,{host:HOST,path:url,__timeout:20000,__maxBody:2*1024*1024},null,signal);
  if(result.status!==200)throw Error('DOGAMI catalog HTTP '+result.status);
  const value=JSON.parse(result.body);if(value.error||!Array.isArray(value.features)||value.exceededTransferLimit)throw Error('DOGAMI catalog incomplete');
  return value.features.map(f=>f.attributes);
}
async function catalog(z,x,y,signal){
  // Nearby detail tiles share two small discovery queries at z12. The extent
  // may contain raster holes; only actual exported numeric pixels claim cover.
  const dz=Math.max(0,z-12),cz=z-dz,cx=Math.floor(x/2**dz),cy=Math.floor(y/2**dz);
  const ck=key(`${VERSION}:catalog:${cz}/${cx}/${cy}`),hit=cacheGet(ck,CATALOG_TTL);
  if(hit)return JSON.parse(hit.body);
  const spatial={geometry:JSON.stringify({...mercEnvelope(mercBbox(cz,cx,cy).split(',').map(Number)),spatialReference:{wkid:3857}}),
    geometryType:'esriGeometryEnvelope',inSR:'3857',spatialRel:'esriSpatialRelIntersects'};
  const [items,projects]=await Promise.all([
    jsonQuery(SERVICE,{...spatial,where:'Category = 1 AND LowPS <= 3.281',outFields:'OBJECTID,Name,Category,LowPS,ZOrder'},signal),
    jsonQuery(PROJECTS,{...spatial,where:'1=1',outFields:'OBJECTID,Project,CELL_SIZE,Vert_Units,Vert_Datum,Horz_Datum,ACQ_DATES,Report'},signal)
  ]);
  const selected=selectSources(items,projects);cachePut(ck,200,'application/json',Buffer.from(JSON.stringify(selected)));return selected;
}
const mercEnvelope=([xmin,ymin,xmax,ymax])=>({xmin,ymin,xmax,ymax});
const headers=(sources,coverage,cache)=>({'X-Oregon-Sources':encodeURIComponent(JSON.stringify(sources)),
  'X-Coverage':String(coverage),'X-Cache':cache,'Cache-Control':'public, max-age=604800, immutable'});
async function elevation(req,res,{p,signal}){
  const m=/^\/api\/oregon\/elev\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(p);
  const [z,x,y]=m?m.slice(1).map(Number):[];
  if(!m||!Number.isInteger(z)||z<0||z>18||x<0||y<0||x>=2**z||y>=2**z)
    return send(res,400,'text/plain',Buffer.from('bad Oregon tile'));
  if(!oregonTileAllowed({z,x,y}))return send(res,200,'image/png',TRANSPARENT,headers([],'none','outside'));
  const ck=key(`${VERSION}:${z}/${x}/${y}`),hit=cacheGet(ck,TTL_TILE);
  if(hit)return send(res,200,'image/png',hit.status===204?TRANSPARENT:hit.body,
    headers(hit.sourceMeta?.sources||[],hit.status===204?'none':hit.sourceMeta.coverage,'hit'));
  try{
    const sources=await catalog(z,x,y,signal);signal?.throwIfAborted();
    if(!sources.length){cachePut(ck,204,'image/png',Buffer.alloc(0));return send(res,200,'image/png',TRANSPARENT,headers([],'none','miss'));}
    const params=new URLSearchParams({bbox:mercBbox(z,x,y),bboxSR:'3857',imageSR:'3857',size:'256,256',
      format:'tiff',pixelType:'F32',f:'image',interpolation:'RSP_BilinearInterpolation',
      renderingRule:JSON.stringify({rasterFunction:'None'}),
      mosaicRule:JSON.stringify({mosaicMethod:'esriMosaicLockRaster',lockRasterIds:sources.map(s=>s.datasetId),mosaicOperation:'MT_FIRST'})});
    const result=await limitedUpstream(ck,{host:HOST,path:SERVICE+'/exportImage?'+params,__timeout:25000},null,signal);
    if(result.status!==200||!isTiff(result.body))throw Error('DOGAMI numeric raster unavailable');
    const out=await terrainTask('oregon:'+ck,'terrarium-tiff',{body:result.body,verticalScale:0.3048},
      {priority:50,timeoutMs:15000},signal);
    const coverage=out?.coverage||0;
    cachePut(ck,out?200:204,'image/png',out?.png||Buffer.alloc(0),{coverage,sources:out?sources:[]});
    return send(res,200,'image/png',out?.png||TRANSPARENT,headers(out?sources:[],out?coverage:'none','miss'));
  }catch(error){
    if(signal?.aborted||error?.code==='ABORT_ERR')return;
    return send(res,503,'image/png',TRANSPARENT,{'Cache-Control':'no-store','Retry-After':'2','X-CSP-Error':'Oregon elevation unavailable'});
  }
}
module.exports={selectSources,routes:{'/api/oregon/elev/':elevation}};
