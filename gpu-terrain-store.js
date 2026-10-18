/* Native elevation grids shared by the 2D terrain and elevation overlays.
 * Drawing never resamples here; CPU sampling is reserved for readout/research. */
(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else if(typeof define==='function'&&define.amd)define([],factory);
  else root.CSPGpuTerrainStore=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const EARTH=40075016.68557849, LIMIT=85.0511287798;
  const mod=(a,n)=>((a%n)+n)%n;
  const valid=v=>Number.isFinite(v)&&v>-20000;
  const tileKey=(id,z,x,y)=>id+'/'+z+'/'+x+'/'+y;
  const latitude=y=>Math.atan(Math.sinh(Math.PI*(1-2*y)))*180/Math.PI;
  const mercY=lat=>(1-Math.asinh(Math.tan(Math.max(-LIMIT,Math.min(LIMIT,lat))*Math.PI/180))/Math.PI)/2;
  function coords(c,z){const scale=2**(c.z-z),n=2**z;return {z,x:mod(Math.floor(c.x/scale),n),y:Math.floor(c.y/scale)};}
  function native(source,z){return Math.max(0,Math.min(z,Math.floor(typeof source.nativeZoom==='function'?source.nativeZoom(z):source.nativeZoom??z)));}
  function resolution(c,w=256){return EARTH*Math.cos(latitude((c.y+.5)/2**c.z)*Math.PI/180)/(2**c.z*w);}
  function sample(record,mx,my){
    const n=2**record.z,px=Math.max(0,Math.min(record.width-1,(mod(mx,1)*n-record.x)*record.width-.5));
    const py=Math.max(0,Math.min(record.height-1,(my*n-record.y)*record.height-.5));
    const x=Math.floor(px),y=Math.floor(py),fx=px-x,fy=py-y;
    let sum=0,weight=0;
    for(let j=0;j<2;j++)for(let i=0;i<2;i++){
      const w=(i?fx:1-fx)*(j?fy:1-fy),v=record.grid[Math.min(record.height-1,y+j)*record.width+Math.min(record.width-1,x+i)];
      if(w>0&&valid(v)){sum+=v*w;weight+=w;}
    }
    return weight?sum/weight:NaN;
  }
  function ElevationTileStore(options){
    this.options=options||{};this._listeners={};this._tiles=new Map();this._pending=new Map();
    this._failed=new Map();this._wanted=new Map();this._displays=[];this._sources=[];
    this._bytes=0;this._revision=0;this._epoch=0;this._destroyed=false;
    this.maxBytes=Math.max(0,this.options.maxBytes??192*1024*1024);
  }
  ElevationTileStore.prototype.on=function(event,fn){(this._listeners[event]||(this._listeners[event]=new Set())).add(fn);return this;};
  ElevationTileStore.prototype.off=function(event,fn){this._listeners[event]?.delete(fn);return this;};
  ElevationTileStore.prototype._emit=function(event,value){for(const fn of this._listeners[event]||[])fn(value);};
  ElevationTileStore.prototype._evict=function(){
    if(this._bytes<=this.maxBytes)return;
    // Prefer old, offscreen records; a hard cap still applies to huge views.
    for(const protectedPass of [false,true])for(const [key,r] of this._tiles){
      if(this._bytes<=this.maxBytes)return;
      if(!protectedPass&&this._wanted.has(key))continue;
      this._tiles.delete(key);this._bytes-=r.grid.byteLength;
    }
  };
  ElevationTileStore.prototype.get=function(key){
    const r=this._tiles.get(key);if(r){this._tiles.delete(key);this._tiles.set(key,r);}return r;
  };
  ElevationTileStore.prototype.finestFor=function(id,c){
    for(let z=c.z;z>=0;z--){const t=coords(c,z),r=this.get(tileKey(id,z,t.x,t.y));if(r)return r;}
  };
  ElevationTileStore.prototype._load=function(job){
    const {key,source,c,sharp}=job;
    if(this._tiles.has(key))return Promise.resolve(this._tiles.get(key));
    if(this._pending.has(key))return this._pending.get(key).promise;
    if((this._failed.get(key)||0)>Date.now())return Promise.resolve(null);
    const controller=new AbortController(),epoch=this._epoch;
    const pending={controller,promise:null};this._pending.set(key,pending);
    pending.promise=Promise.resolve().then(()=>this.options.request(job.url,{
      signal:controller.signal,priority:sharp?0:source.rank===5?2:source.rank,
      group:sharp?'sharp':source.group||'overview',kind:source.kind
    })).then(data=>{
      if(!data||controller.signal.aborted||epoch!==this._epoch||this._destroyed)return null;
      const width=data.width,height=data.height;
      if(!Number.isInteger(width)||width<1||!Number.isInteger(height)||height<1||!data.grid||data.grid.length!==width*height)throw new Error('Invalid native elevation grid');
      let grid=data.grid instanceof Float32Array?data.grid:new Float32Array(data.grid);
      if(this.options.mask)grid=this.options.mask(grid,width,height,c,source);
      if(!(grid instanceof Float32Array)||grid.length!==width*height)throw new Error('Invalid masked elevation grid');
      const r={key,sourceId:source.id,rank:source.rank,label:source.label,z:c.z,x:c.x,y:c.y,width,height,grid,
        sampleMeters:typeof source.sampleMeters==='function'?source.sampleMeters(c):source.sampleMeters??resolution(c,width),
        surveys:data.surveys||[],revision:++this._revision,validCount:0};
      for(const value of grid)if(valid(value))r.validCount++;
      if(grid.byteLength>this.maxBytes){this._failed.set(key,Date.now()+30000);return null;}
      this._tiles.set(key,r);this._bytes+=grid.byteLength;this._evict();
      this._emit('tile',r);return r;
    }).catch(error=>{
      if(!controller.signal.aborted&&epoch===this._epoch){this._failed.set(key,Date.now()+10000);this._emit('error',{key,error});}
      return null;
    }).finally(()=>{
      if(this._pending.get(key)===pending)this._pending.delete(key);
      if(epoch===this._epoch&&!this._destroyed)this._emit('settled',key);
    });
    return pending.promise;
  };
  ElevationTileStore.prototype.want=function(displayTiles,options){
    if(this._destroyed)return;
    this._sources=(typeof this.options.sources==='function'?this.options.sources():this.options.sources||[]).slice();
    this._displays=displayTiles.slice();this._generation=options?.generation;
    const wanted=new Map(),groups=[];
    for(const d of displayTiles){
      const jobs=[];
      for(const source of this._sources){
        if(source.allowed&&!source.allowed(d))continue;
        const shown=Math.max(0,d.z-(source.dz??this.options.dz??0));
        for(const sharp of [false,true]){
          if(sharp&&source.sharper===false)continue;
          const z=native(source,sharp?d.z:shown),c=coords(d,z),key=tileKey(source.id,z,c.x,c.y);
          const url=typeof source.url==='function'?source.url(z,c.x,c.y):source.url.replace('{z}',z).replace('{x}',c.x).replace('{y}',c.y);
          const job={key,source,c,url,sharp};
          if(!wanted.has(key)||!sharp)wanted.set(key,job);
          jobs.push(job);
          if(shown===d.z)break;
        }
      }
      groups.push(jobs);
    }
    this._wanted=wanted;
    for(const [key,p] of this._pending)if(!wanted.has(key)){p.controller.abort();this._pending.delete(key);}
    // Every primary source is dispatched together; refinement cannot starve it.
    const primary=new Map();for(const jobs of groups)for(const j of jobs)if(!j.sharp)primary.set(j.key,j);
    const epoch=this._epoch;
    const first=Promise.all([...primary.values()].map(j=>this._load(j)));
    first.then(()=>{
      if(epoch!==this._epoch||this._destroyed)return;
      for(const jobs of groups){
        if(!jobs.length)continue;
        const available=jobs.filter(j=>!j.sharp&&this._tiles.has(j.key)&&this._tiles.get(j.key).validCount>0);
        available.sort((a,b)=>b.source.rank-a.source.rank);
        const best=available[0];if(!best)continue;
        const sharp=jobs.find(j=>j.sharp&&j.source.id===best.source.id&&j.c.z>best.c.z);
        if(sharp&&this._wanted.has(sharp.key))this._load(sharp);
      }
      this._evict();
    });
    return first;
  };
  ElevationTileStore.prototype._at=function(mx,my,sources){
    let best=null;
    for(const s of sources){
      if(best&&best.rank>s.rank)continue;
      // Walk finest to coarse within each source, retaining coarse data in holes.
      const max=native(s,28),n=2**max,c={z:max,x:Math.floor(mod(mx,1)*n),y:Math.min(n-1,Math.floor(my*n))};
      if(s.allowed&&!s.allowed(c))continue;
      for(let z=max;z>=0;z--){
        const t=coords(c,z),r=this._tiles.get(tileKey(s.id,z,t.x,t.y));if(!r)continue;
        const value=sample(r,mx,my);if(!valid(value))continue;
        if(!best||r.rank>best.rank||(r.rank===best.rank&&r.z>best.z))best={value,rank:r.rank,label:r.label,z:r.z,sourceId:r.sourceId};
        break;
      }
    }
    return best;
  };
  ElevationTileStore.prototype.sampleAt=function(lng,lat){
    if(!Number.isFinite(lng)||!Number.isFinite(lat))return null;
    return this._at((lng+180)/360,mercY(lat),this._sources);
  };
  ElevationTileStore.prototype.settled=function(displayTiles){
    const tiles=displayTiles||this._displays;let complete=0;
    for(const d of tiles)if(this._sources.some(s=>(!s.allowed||s.allowed(d))&&this.finestFor(s.id,d)?.validCount>0))complete++;
    return {complete,total:tiles.length,ratio:tiles.length?complete/tiles.length:0,refining:this._pending.size>0,failed:this._failed.size>0};
  };
  ElevationTileStore.prototype.provenance=function(displayTiles){
    const ranks={},labels=new Set(),surveys=new Map(),sampleMeters={},seen=new Set();
    for(const d of displayTiles||this._displays)for(const s of this._sources){
      if(s.allowed&&!s.allowed(d))continue;
      // Include ancestors because finer no-data does not replace their ground.
      let r=this.finestFor(s.id,d);
      while(r){
        if(!seen.has(r.key)){
          seen.add(r.key);const count=r.validCount;
          if(count){ranks[r.rank]=(ranks[r.rank]||0)+count;labels.add(r.label);
            sampleMeters[r.rank]=Math.min(sampleMeters[r.rank]??Infinity,r.sampleMeters);
            for(const survey of r.surveys)surveys.set(JSON.stringify(survey),survey);}
        }
        r=r.z?this.finestFor(s.id,{z:r.z-1,x:Math.floor(r.x/2),y:Math.floor(r.y/2)}):null;
      }
    }
    return {ranks,labels:[...labels],surveys:[...surveys.values()],sampleMeters};
  };
  ElevationTileStore.prototype.gridForView=function(request){
    const b=request.bounds;
    const west=b.getWest?b.getWest():b.west??b[0],south=b.getSouth?b.getSouth():b.south??b[1];
    let east=b.getEast?b.getEast():b.east??b[2];const north=b.getNorth?b.getNorth():b.north??b[3];
    if(east<west)east+=360;
    if(![west,south,east,north].every(Number.isFinite)||east<=west||north<=south)throw new Error('Invalid research bounds');
    const x0=(west+180)/360,x1=(east+180)/360,y0=mercY(north),y1=mercY(south),z=Math.max(0,Math.min(22,Math.round(request.zoom)));
    const max=Math.max(1,Math.floor(request.maxSide||640)),nativeW=Math.max(1,(x1-x0)*256*2**z),nativeH=Math.max(1,(y1-y0)*256*2**z);
    const factor=Math.max(1,nativeW/max,nativeH/max),width=Math.max(1,Math.ceil(nativeW/factor)),height=Math.max(1,Math.ceil(nativeH/factor));
    const grid=new Float32Array(width*height);grid.fill(NaN);const labels=new Set();
    // CPU query only: bounded output avoids allocating a huge overzoom mosaic.
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const hit=this._at(x0+(x+.5)/width*(x1-x0),y0+(y+.5)/height*(y1-y0),this._sources);
      if(hit){grid[y*width+x]=hit.value;labels.add(hit.label);}
    }
    if(!labels.size)throw new Error('No elevation pixels are ready for this view.');
    return {grid,width,height,bounds:b,z,factor,resolution:EARTH*Math.cos((north+south)/2*Math.PI/180)*(x1-x0)/width,
      provenance:[...labels],provisional:this._pending.size>0};
  };
  ElevationTileStore.prototype.clear=function(){
    this._epoch++;for(const p of this._pending.values())p.controller.abort();this._pending.clear();
    this._tiles.clear();this._failed.clear();this._wanted.clear();this._displays=[];this._bytes=0;this._emit('clear');
  };
  ElevationTileStore.prototype.destroy=function(){this._destroyed=true;this.clear();this._listeners={};};
  ElevationTileStore.prototype.stats=function(){return {tiles:this._tiles.size,bytes:this._bytes,pending:this._pending.size,maxBytes:this.maxBytes};};
  function buildSources(o,e){
    const out=[],dz=e.dz||0,add=(id,rank,label,max,url,allowed,kind)=>out.push({id,rank,label,dz,
      nativeZoom:z=>Math.min(z,max),url,allowed,kind,sharper:true,group:rank===5?'dnr':rank===3?'detail':rank===2?'national':'overview',sampleMeters:e.sourceSampleMeters});
    if(e.proxy&&o.dnrEndpoint)add('dnr',5,'WA DNR elevation',18,(z,x,y)=>e.api(`${o.dnrEndpoint}/${z}/${x}/${y}.png?acquire=0&revision=${e.dnrRevision||0}`),e.dnrTileAllowed);
    if(e.proxy&&o.rawEndpoint)add('raw',3,'USGS 3.3 ft',o.rawNativeZoom??28,(z,x,y)=>e.api(`${o.rawEndpoint}/${z}/${x}/${y}.png?${e.rawCoverageQuery||''}`),c=>c.z-dz>=13);
    if(e.proxy&&o.nationalEndpoint)add('national',2,'National elevation',o.nationalNativeZoom??28,(z,x,y)=>e.api(`${o.nationalEndpoint}/${z}/${x}/${y}.png`),c=>c.z-dz>=13||o.refineOverview);
    if(!e.proxy&&o.fallback)add('national',2,'USGS 3DEP elevation',18,(z,x,y)=>e.nationalUrl({z,x,y}),()=>true,'lerc');
    if(o.fallback)add('overview',1,'Overview elevation',o.fallbackNativeZoom??28,(z,x,y)=>typeof o.fallback==='function'?o.fallback({z,x,y}):o.fallback.replace('{z}',z).replace('{x}',x).replace('{y}',y),()=>true,typeof o.fallback==='function'?'lerc':undefined);
    return out;
  }
  return Object.freeze({VERSION:'1',tileKey,ElevationTileStore,buildSources});
});
