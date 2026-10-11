/* Node-only DNR raster reader. Bundled into vendor/dnr-runtime.cjs at build
   time; no browser bundle or installed npm tree is needed by the engine.
   Downloads and overview construction run in a dedicated background worker. */
import {fromFile} from "geotiff";
import proj4 from "proj4";
import yauzl from "yauzl";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import https from "node:https";
import zlib from "node:zlib";
import {pipeline} from "node:stream/promises";
import {Transform} from "node:stream";

const fsp=fs.promises, HOST="lidarportal.dnr.wa.gov";
const US_FOOT=1200/3937;
const FACTORS=[4,16,64,256];
const valid=v=>Number.isFinite(v)&&v>-20000&&v<10000;
const hash=s=>crypto.createHash("sha256").update(s).digest("hex").slice(0,32);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
/* DNR metadata dataset 1547 includes WGS_QA_columbia_valley_fema_north_2020.pdf,
   p3 ("Units: US Survey Feet"), and the vendor report p2. The derived DTM
   dataset 1543 incorrectly labels its stored feet as metres. Independent
   rasterio reads and national 3DEP heights confirm the scale discrepancy.
   This is an explicit survey correction, never inferred from horizontal CRS. */
export function surveyInfo(info,datasetId){
  if(Number(datasetId)!==1543)return info;
  return {...info,declaredVerticalMeters:info.verticalMeters,verticalMeters:US_FOOT,
    verticalUnitBasis:"DNR survey QA report: US survey feet; conflicting TIFF metre tag corrected",
    metadataDatasetId:1547};
}
function wktPart(text,name){
  const start=text.indexOf(name+"[");if(start<0)return null;
  let depth=0,quoted=false;
  for(let i=start;i<text.length;i++){
    if(text[i]==='"')quoted=!quoted;
    if(quoted)continue;
    if(text[i]==="[")depth++;
    if(text[i]==="]"&&!--depth)return text.slice(start,i+1);
  }
  return null;
}
function unitMeters(code){
  if(code===9001)return 1;
  if(code===9002)return .3048;
  if(code===9003)return US_FOOT;
  return null;
}
export function projection(keys){
  const epsg=keys.ProjectedCSTypeGeoKey;
  const citation=[keys.PCSCitationGeoKey,keys.GTCitationGeoKey].filter(Boolean).join("|");
  const wkt=wktPart(citation,"PROJCS");
  if(wkt)return {definition:wkt,unitMeters:unitMeters(keys.ProjLinearUnitsGeoKey)||(/Foot_US/i.test(wkt)?US_FOOT:/UNIT\["(?:Foot|feet)",/i.test(wkt)?.3048:1)};
  if((epsg>=26901&&epsg<=26923)||(epsg>=32601&&epsg<=32660))
    return {definition:`+proj=utm +zone=${epsg%100} +datum=${epsg<30000?"NAD83":"WGS84"} +units=m +no_defs`,unitMeters:1};
  if(epsg===3857)return {definition:"EPSG:3857",unitMeters:1};
  const north=[2285,2926,32148].includes(epsg),south=[2286,2927,32149].includes(epsg);
  if(north||south){
    const feet=[2285,2286,2926,2927].includes(epsg);
    return {definition:`+proj=lcc +lat_1=${north?48.73333333333333:47.33333333333333} +lat_2=${north?47.5:45.83333333333333} +lat_0=${north?47:45.33333333333333} +lon_0=${north?-120.83333333333333:-120.5} +x_0=500000 +y_0=0 +datum=NAD83 +units=${feet?"us-ft":"m"} +no_defs`,unitMeters:feet?US_FOOT:1};
  }
  if(keys.GeographicTypeGeoKey===4326||keys.GeographicTypeGeoKey===4269)
    return {definition:"EPSG:4326",unitMeters:null};
  throw new Error("DNR raster coordinate system is not supported; no elevation was substituted");
}
export function verticalMeters(keys){
  const explicit=unitMeters(keys.VerticalUnitsGeoKey);if(explicit)return explicit;
  const citation=[keys.PCSCitationGeoKey,keys.GTCitationGeoKey,keys.VerticalCitationGeoKey].filter(Boolean).join("|");
  const vertical=wktPart(citation,"VERTCS")||wktPart(citation,"VERT_CS");
  if(vertical){
    const units=[...vertical.matchAll(/UNIT\["[^"]+",\s*([0-9.e+-]+)/gi)];
    if(units.length){const value=+units.at(-1)[1];if(value>0&&value<=1)return value;}
  }
  const label=/Unit Name\s*=\s*(Meter|Metre|Foot_US|Feet|Foot)/i.exec(keys.VerticalCitationGeoKey||"")?.[1];
  if(label)return /meter|metre/i.test(label)?1:/Foot_US/i.test(label)?US_FOOT:.3048;
  // A horizontal coordinate unit is not evidence of the elevation unit.
  throw new Error("DNR raster does not declare vertical units");
}
export async function inspect(file){
  const tiff=await fromFile(file);
  try{
    const image=await tiff.getImage(),keys=image.getGeoKeys(),p=projection(keys);
    const vertical=verticalMeters(keys),width=image.getWidth(),height=image.getHeight();
    if(image.getSamplesPerPixel()!==1)throw new Error("DNR DTM must be a single elevation band");
    const origin=image.getOrigin(),resolution=image.getResolution();
    const matrix=image.fileDirectory.ModelTransformation;
    if(matrix&&(matrix[1]!==0||matrix[4]!==0))throw new Error("Rotated DNR raster grids are not supported");
    if(!(resolution[0]>0&&resolution[1]<0))throw new Error("DNR raster must have a north-up pixel grid");
    const transform=proj4(p.definition,"EPSG:4326"),bbox=image.getBoundingBox();
    const points=[];
    for(let i=0;i<=16;i++){
      const f=i/16;
      for(const xy of [[bbox[0]+f*(bbox[2]-bbox[0]),bbox[1]],[bbox[0]+f*(bbox[2]-bbox[0]),bbox[3]],[bbox[0],bbox[1]+f*(bbox[3]-bbox[1])],[bbox[2],bbox[1]+f*(bbox[3]-bbox[1])]])points.push(transform.forward(xy));
    }
    const bounds=[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))];
    const mercator=keys.ProjectedCSTypeGeoKey===3857;
    let nativeMeters=Math.abs(resolution[0])*(p.unitMeters||111320*Math.cos((bounds[1]+bounds[3])*Math.PI/360))*
      (mercator?Math.cos((bounds[1]+bounds[3])*Math.PI/360):1);
    const blockBytes=image.getTileWidth()*image.getTileHeight()*4;
    if(blockBytes>32*1024*1024)throw new Error("DNR raster block exceeds the 32 MiB decoding budget");
    return {width,height,origin:origin.slice(0,2),resolution:resolution.slice(0,2),definition:p.definition,
      verticalMeters:vertical,nativeMeters,nodata:image.getGDALNoData(),bounds,pixelIsArea:image.pixelIsArea()};
  }finally{await tiff.close();}
}
/* Build four small numeric overviews once. Process one 512-row strip at a
   time and never materialize the original DEM. Analytical pans then read a
   window of the appropriate overview, rather than decoding hundreds of
   millions of native samples for every zoomed-out tile. Values are metres. */
export async function buildOverviews(file,info,dir,onProgress=()=>{}){
  await fsp.mkdir(dir,{recursive:true});
  const tiff=await fromFile(file),image=await tiff.getImage();
  const levels=FACTORS.map(factor=>({factor,width:Math.ceil(info.width/factor),height:Math.ceil(info.height/factor),path:path.join(dir,`f${factor}.bin`)}));
  const handles=[];
  try{
    for(const level of levels){const h=await fsp.open(level.path,"w");await h.truncate(level.width*level.height*4);handles.push(h);}
    for(let y=0;y<info.height;y+=512){
      const height=Math.min(512,info.height-y);
      const strips=levels.map(l=>new Float32Array(l.width*Math.ceil(height/l.factor)).fill(NaN));
      for(let x=0;x<info.width;x+=512){
        const width=Math.min(512,info.width-x);
        const raster=(await image.readRasters({window:[x,y,x+width,y+height],samples:[0]}))[0];
        // Subsequent levels reduce the previous level, keeping work linear.
        let previous=raster,pw=width,ph=height,oldFactor=1;
        for(let li=0;li<levels.length;li++){
          const level=levels[li],step=level.factor/oldFactor,w=Math.ceil(pw/step),h=Math.ceil(ph/step),reduced=new Float32Array(w*h).fill(NaN);
          for(let j=0;j<h;j++)for(let i=0;i<w;i++){
            let sum=0,count=0;
            for(let dy=0;dy<step&&j*step+dy<ph;dy++)for(let dx=0;dx<step&&i*step+dx<pw;dx++){
              let v=previous[(j*step+dy)*pw+i*step+dx];
              if(li===0){if(v===info.nodata)continue;v*=info.verticalMeters;}
              if(valid(v)){sum+=v;count++;}
            }
            if(count)reduced[j*w+i]=sum/count;
          }
          for(let j=0;j<h;j++)strips[li].set(reduced.subarray(j*w,(j+1)*w),j*level.width+x/level.factor);
          previous=reduced;pw=w;ph=h;oldFactor=level.factor;
        }
        await tick();
      }
      for(let i=0;i<levels.length;i++){
        const a=strips[i],b=Buffer.from(a.buffer);
        await handles[i].write(b,0,b.length,(y/levels[i].factor)*levels[i].width*4);
      }
      onProgress(Math.min(1,(y+height)/info.height));
    }
    return levels.map(l=>({...l,path:path.basename(l.path)}));
  }finally{await Promise.all(handles.map(h=>h.close()));await tiff.close();}
}

function response(pathname,cookie){
  return new Promise((resolve,reject)=>{
    let received=null;
    const req=https.get({host:HOST,path:pathname,headers:{"User-Agent":"ClearSkiesPortal/1.0",
      ...(cookie?{Cookie:cookie,Referer:`https://${HOST}/`}:{})}},res=>{received=res;resolve(res);});
    req.setTimeout(120000,()=>req.destroy(new Error("DNR download timed out")));
    req.on("error",error=>received?received.destroy(error):reject(error));
  });
}
/* Use the documented website session and download link. The ZIP is streamed
   directly to bounded temporary files, not buffered on the HTTP event loop.
   Archive paths are identifiers only; no archive path is written to disk. */
export async function acquire({cacheDir,datasetId,project,bbox,maxBytes,minFreeBytes,known=[]},onProgress=()=>{}){
  const base=path.join(cacheDir,"wadnr"),tmp=await fsp.mkdtemp(path.join(base,"download-"));
  onProgress({tempDir:tmp});
  let received=0,written=0,lastCheck=0;
  const knownMap=new Map(known.map(f=>[f.archivePath,f])),files=[];
  let remote,zip;
  try{
    const page=await response("/");
    if(page.statusCode!==200){page.resume();throw new Error(`DNR session HTTP ${page.statusCode}`);}
    const cookie=(page.headers["set-cookie"]||[]).map(v=>v.split(";")[0]).join(";");page.resume();
    const [w,s,e,n]=bbox,geometry={type:"Polygon",coordinates:[[[w,s],[e,s],[e,n],[w,n],[w,s]]]};
    remote=await response("/download?"+new URLSearchParams({ids:String(datasetId),geojson:JSON.stringify(geometry)}),cookie);
    if(remote.statusCode!==200||!/zip|octet-stream/i.test(remote.headers["content-type"]||"")){
      remote.resume();throw new Error(`DNR elevation download HTTP ${remote.statusCode}`);
    }
    const archive=path.join(tmp,"download.zip");
    const downloadBudget=new Transform({transform(chunk,encoding,callback){
      received+=chunk.length;
      if(received>maxBytes)return callback(new Error("DNR archive exceeds the acquisition budget"));
      if(received-lastCheck>8*1024*1024){
        lastCheck=received;
        const stat=fs.statfsSync(cacheDir);
        if(Number(stat.bavail)*Number(stat.bsize)<minFreeBytes+8*1024*1024)return callback(new Error("DNR download paused at the free-disk reserve"));
        onProgress({state:"downloading",bytes:received,project});
      }
      callback(null,chunk);
    }});
    await pipeline(remote,downloadBudget,fs.createWriteStream(archive,{flags:"wx"}));
    zip=await new Promise((resolve,reject)=>yauzl.open(archive,{lazyEntries:true,autoClose:false,validateEntrySizes:true},(error,file)=>error?reject(error):resolve(file)));
    lastCheck=0;
    const processEntry=async entry=>{
      const archivePath=entry.fileName;
      if(!/\.tiff?$/i.test(archivePath))return;
      if(files.length>=32)throw new Error("DNR archive contains too many elevation files");
      const previous=knownMap.get(archivePath);
      if(previous){files.push(previous);return;}
      if(written+entry.uncompressedSize>maxBytes)throw new Error("DNR extracted data exceeds the acquisition budget");
      const key=hash(`${datasetId}:${archivePath}`),file=path.join(tmp,key+".tif");
      const stream=await new Promise((resolve,reject)=>zip.openReadStream(entry,(error,stream)=>error?reject(error):resolve(stream)));
      let crc=0;
      const budget=new Transform({transform(chunk,encoding,callback){
        written+=chunk.length;
        crc=zlib.crc32(chunk,crc);
        if(written>maxBytes)return callback(new Error("DNR extracted data exceeds the acquisition budget"));
        if(written-lastCheck>8*1024*1024){
          lastCheck=written;
          const stat=fs.statfsSync(cacheDir);
          if(Number(stat.bavail)*Number(stat.bsize)<minFreeBytes+8*1024*1024)return callback(new Error("DNR download paused at the free-disk reserve"));
          onProgress({state:"preparing",bytes:received,project});
        }
        callback(null,chunk);
      }});
      await pipeline(stream,budget,fs.createWriteStream(file,{flags:"wx"}));
      if((crc>>>0)!==entry.crc32)throw new Error("DNR elevation archive checksum failed");
      const info=surveyInfo(await inspect(file),datasetId),overviewDir=path.join(tmp,key);
      const overviewBytes=FACTORS.reduce((sum,f)=>sum+Math.ceil(info.width/f)*Math.ceil(info.height/f)*4,0);
      if(written+overviewBytes>maxBytes)throw new Error("DNR numeric overviews exceed the acquisition budget");
      const levels=await buildOverviews(file,info,overviewDir,fraction=>onProgress({state:"preparing",bytes:received,project,fraction}));
      written+=overviewBytes;
      files.push({...info,key,project,datasetId,archivePath,file:key+".tif",overviewDir:key,levels,bytes:(await fsp.stat(file)).size+overviewBytes});
    };
    await new Promise((resolve,reject)=>{
      zip.on("error",reject);zip.on("end",resolve);
      zip.on("entry",entry=>processEntry(entry).then(()=>zip.readEntry(),reject));
      zip.readEntry();
    });
    if(!files.length)throw new Error("DNR download contained no readable elevation files");
    for(const file of files){
      if(knownMap.has(file.archivePath))continue;
      await fsp.rename(path.join(tmp,file.file),path.join(base,file.file));
      await fsp.rename(path.join(tmp,file.overviewDir),path.join(base,file.overviewDir));
    }
    return {files,bytes:received};
  }finally{
    remote?.destroy();
    if(zip?.isOpen)await new Promise(resolve=>{zip.once("close",resolve);zip.close();});
    await fsp.rm(tmp,{recursive:true,force:true});
  }
}

const opened=new Map();
export async function close(){
  const entries=[...opened.values()];opened.clear();
  await Promise.all(entries.map(value=>value.tiff.close()));
}
async function open(file){
  let value=opened.get(file);
  if(value){opened.delete(file);opened.set(file,value);return value;}
  const tiff=await fromFile(file),image=await tiff.getImage();value={tiff,image};
  opened.set(file,value);
  while(opened.size>8){const key=opened.keys().next().value,old=opened.get(key);opened.delete(key);await old.tiff.close();}
  return value;
}
async function readWindow(base,file,factor,window){
  const [x,y,right,bottom]=window,w=right-x,h=bottom-y;
  if(w*h>2*1024*1024)throw new Error("DNR sampling window exceeds the memory budget");
  if(factor===1){
    const {image}=await open(path.join(base,file.file));
    const values=(await image.readRasters({window,samples:[0]}))[0],out=new Float32Array(values.length).fill(NaN);
    for(let i=0;i<out.length;i++){const v=values[i];if(v!==file.nodata&&valid(v*file.verticalMeters))out[i]=v*file.verticalMeters;}
    return out;
  }
  const level=file.levels.find(l=>l.factor===factor),handle=await fsp.open(path.join(base,file.overviewDir,level.path),"r");
  const out=new Float32Array(w*h),buffer=Buffer.from(out.buffer);
  try{for(let row=0;row<h;row++){const r=await handle.read(buffer,row*w*4,w*4,((y+row)*level.width+x)*4);if(r.bytesRead!==w*4)throw new Error("Incomplete DNR overview");}}finally{await handle.close();}
  return out;
}
export async function sample({cacheDir,files,z,x,y,size=256}){
  const n=2**z,r=20037508.342789244,span=2*r/n,left=-r+x*span,top=r-y*span,step=span/size;
  const latitude=my=>Math.atan(Math.sinh(my/6378137))*180/Math.PI;
  const midLat=latitude(top-span/2),groundRes=step*Math.cos(midLat*Math.PI/180),grid=new Float32Array(size*size).fill(NaN);
  const bbox=[left/r*180,latitude(top-span),(left+span)/r*180,latitude(top)];
  const candidates=files.filter(f=>f.bounds[0]<bbox[2]&&f.bounds[2]>bbox[0]&&f.bounds[1]<bbox[3]&&f.bounds[3]>bbox[1])
    .sort((a,b)=>a.nativeMeters-b.nativeMeters||b.year-a.year);
  if(candidates.length>32)throw new Error("Too many DNR source files overlap this tile");
  const sources=[];
  for(const file of candidates){
    const transform=proj4("EPSG:4326",file.definition);
    let factor=1;for(const level of file.levels||[])if(level.factor*file.nativeMeters<=groundRes)factor=level.factor;
    const width=Math.ceil(file.width/factor),height=Math.ceil(file.height/factor);
    const px=new Float64Array(size*size),py=new Float64Array(size*size);
    // Project a coarse lattice and interpolate, as the USGS reader does.
    const k=8,m=Math.ceil((size-1)/k)+1,nodes=[];
    for(let j=0;j<m;j++)for(let i=0;i<m;i++)nodes.push(transform.forward([(left+(i*k+.5)*step)/r*180,latitude(top-(j*k+.5)*step)]));
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    const shift=file.pixelIsArea?.5:.5-.5/factor;
    for(let j=0;j<size;j++)for(let i=0;i<size;i++){
      const ix=Math.floor(i/k),iy=Math.floor(j/k),dx=(i%k)/k,dy=(j%k)/k;
      const a=nodes[iy*m+ix],b=nodes[iy*m+ix+1],c=nodes[(iy+1)*m+ix],d=nodes[(iy+1)*m+ix+1];
      const sx=a[0]*(1-dx)*(1-dy)+b[0]*dx*(1-dy)+c[0]*(1-dx)*dy+d[0]*dx*dy;
      const sy=a[1]*(1-dx)*(1-dy)+b[1]*dx*(1-dy)+c[1]*(1-dx)*dy+d[1]*dx*dy;
      const at=j*size+i,xx=(sx-file.origin[0])/(file.resolution[0]*factor)-shift,yy=(sy-file.origin[1])/(file.resolution[1]*factor)-shift;
      px[at]=xx;py[at]=yy;minX=Math.min(minX,xx);maxX=Math.max(maxX,xx);minY=Math.min(minY,yy);maxY=Math.max(maxY,yy);
    }
    const x0=Math.max(0,Math.floor(minX)),y0=Math.max(0,Math.floor(minY)),x1=Math.min(width,Math.ceil(maxX)+2),y1=Math.min(height,Math.ceil(maxY)+2);
    if(x0>=x1||y0>=y1)continue;
    const values=await readWindow(path.join(cacheDir,"wadnr"),file,factor,[x0,y0,x1,y1]),w=x1-x0;
    let used=0;
    for(let i=0;i<grid.length;i++){
      if(Number.isFinite(grid[i]))continue;
      const fx=px[i]-x0,fy=py[i]-y0,xx=Math.floor(fx),yy=Math.floor(fy),dx=fx-xx,dy=fy-yy;
      if(fx<-.5||fy<-.5||fx>w-.5||fy>y1-y0-.5)continue;
      let sum=0,weight=0;
      for(let j=0;j<=1;j++)for(let k=0;k<=1;k++){
        const cx=xx+k,cy=yy+j;if(cx<0||cy<0||cx>=w||cy>=y1-y0)continue;
        const v=values[cy*w+cx],ww=(k?dx:1-dx)*(j?dy:1-dy);
        if(valid(v)&&ww>0){sum+=v*ww;weight+=ww;}
      }
      if(weight){grid[i]=sum/weight;used++;}
    }
    if(used)sources.push({project:file.project,datasetId:file.datasetId,nativeMeters:file.nativeMeters,sampleMeters:file.nativeMeters*factor,pixels:used,verticalUnits:"metres",
      ...(file.verticalUnitBasis?{verticalUnitBasis:file.verticalUnitBasis,metadataDatasetId:file.metadataDatasetId}:{})});
    await tick();
  }
  const covered=sources.reduce((sum,s)=>sum+s.pixels,0);
  return covered?{grid,coverage:covered/grid.length,groundRes,sources}:null;
}
