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
  function sourceUrl(source,c){return typeof source.url==='function'?source.url(c.z,c.x,c.y):source.url.replace('{z}',c.z).replace('{x}',c.x).replace('{y}',c.y);}
  function matchesSource(source,record){return !!source&&record.url===sourceUrl(source,record)&&record.rank===source.rank&&
    record.label===source.label&&record.cacheKey===source.cacheKey&&native(source,record.z)>=record.z;}
  function resolution(c,w=256){return EARTH*Math.cos(latitude((c.y+.5)/2**c.z)*Math.PI/180)/(2**c.z*w);}
  /* A coarse backdrop from sources marked `backdrop`, kept loaded far beyond
     the view: zooming out or flinging then shows blurred terrain at once while
     the proper level loads, instead of empty map. Each level is relative to
     the on-screen zoom and covers 2^k times the view's span, which takes
     about as many tiles as the view itself. */
  const BACKDROP_LEVELS=[3,6],FALLBACK_LEVELS=4;
  function backdropTiles(bounds,dz){
    const out=[];
    for(const k of BACKDROP_LEVELS){
      const z=bounds.z-dz-k;if(z<0)continue;
      const scale=2**(dz+k),n=2**z,cx=(bounds.x0+bounds.x1+1)/2,cy=(bounds.y0+bounds.y1+1)/2;
      const hx=(bounds.x1-bounds.x0+1)*2**k/2,hy=(bounds.y1-bounds.y0+1)*2**k/2;
      const x0=Math.floor((cx-hx)/scale),x1=Math.floor((cx+hx)/scale);
      const y0=Math.max(0,Math.floor((cy-hy)/scale)),y1=Math.min(n-1,Math.floor((cy+hy)/scale));
      for(let y=y0;y<=y1;y++)for(let x=x0;x<=Math.min(x1,x0+n-1);x++)out.push({z,x:mod(x,n),y});
    }
    return out;
  }
  /* Unwrapped bounds of same-level display tiles; null across the antimeridian
     (callers that know the view pass its bounds instead). */
  function boundsOf(tiles){
    if(!tiles.length)return null;
    const z=tiles[0].z,xs=new Set();let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;
    for(const d of tiles){if(d.z!==z)return null;xs.add(d.x);x0=Math.min(x0,d.x);x1=Math.max(x1,d.x);y0=Math.min(y0,d.y);y1=Math.max(y1,d.y);}
    return xs.size===x1-x0+1?{z,x0,x1,y0,y1}:null;
  }
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
    this._bytes=0;this._revision=0;this._epoch=0;this._demand=0;this._destroyed=false;
    this._levels=new Map();this._summaries=new Map();this._retryTimer=0;
    this.retryDelayMs=Math.max(1,this.options.retryDelayMs??10000);
    this.maxBytes=Math.max(0,this.options.maxBytes??192*1024*1024);
  }
  ElevationTileStore.prototype.on=function(event,fn){(this._listeners[event]||(this._listeners[event]=new Set())).add(fn);return this;};
  ElevationTileStore.prototype.off=function(event,fn){this._listeners[event]?.delete(fn);return this;};
  ElevationTileStore.prototype._emit=function(event,value){for(const fn of this._listeners[event]||[])fn(value);};
  ElevationTileStore.prototype._invalidateSummaries=function(record){
    for(const [key,entry] of this._summaries){
      const d=entry.coords,z=Math.min(d.z,record.z),a=coords(d,z),b=coords(record,z);
      if(a.x===b.x&&a.y===b.y)this._summaries.delete(key);
    }
  };
  ElevationTileStore.prototype._remove=function(key){
    const r=this._tiles.get(key);if(!r)return;
    this._tiles.delete(key);this._bytes-=r.grid.byteLength;this._invalidateSummaries(r);
    const levels=this._levels.get(r.sourceId),count=levels.get(r.z)-1;
    if(count)levels.set(r.z,count);else levels.delete(r.z);
    if(!levels.size)this._levels.delete(r.sourceId);
  };
  ElevationTileStore.prototype._evict=function(){
    if(this._bytes<=this.maxBytes)return;
    // Prefer old, offscreen records; a hard cap still applies to huge views.
    for(const protectedPass of [false,true])for(const [key,r] of this._tiles){
      if(this._bytes<=this.maxBytes)return;
      if(!protectedPass&&this._wanted.has(key))continue;
      this._remove(key);
    }
  };
  ElevationTileStore.prototype.get=function(key){
    const r=this._tiles.get(key);if(r){this._tiles.delete(key);this._tiles.set(key,r);}return r;
  };
  // Whether the current view, its refinement or its backdrop needs this key.
  ElevationTileStore.prototype.wants=function(key){return this._wanted.has(key);};
  ElevationTileStore.prototype.accepts=function(record){
    const sources=typeof this.options.sources==='function'?this.options.sources():this.options.sources||[];
    return matchesSource(sources.find(s=>s.id===record.sourceId),record);
  };
  ElevationTileStore.prototype.finestFor=function(id,c){
    const levels=[...(this._levels.get(id)?.keys()||[])].filter(z=>z<=c.z).sort((a,b)=>b-a);
    for(const z of levels){const t=coords(c,z),r=this.get(tileKey(id,z,t.x,t.y));if(r)return r;}
  };
  ElevationTileStore.prototype._scheduleRetry=function(){
    clearTimeout(this._retryTimer);this._retryTimer=0;
    if(this._destroyed)return;
    let next=Infinity;
    for(const [key,until] of this._failed)if(this._wanted.has(key)&&!this._tiles.has(key))next=Math.min(next,until);
    if(!Number.isFinite(next))return;
    this._retryTimer=setTimeout(()=>{
      this._retryTimer=0;
      if(!this._destroyed)this.want(this._displays,{generation:this._generation,bounds:this._bounds});
    },Math.max(0,next-Date.now()));
    this._retryTimer?.unref?.();
  };
  /* A decoded response as a native record: masked, sentinels as NaN. */
  ElevationTileStore.prototype._record=function(job,data){
    const {key,source,c}=job;
    if(!data)throw new Error('Elevation tile unavailable');
    const width=data.width,height=data.height;
    if(!Number.isInteger(width)||width<1||!Number.isInteger(height)||height<1||!data.grid||data.grid.length!==width*height)throw new Error('Invalid native elevation grid');
    // Decoder caches may share the returned array. Masking and sentinel
    // normalization must never alter a different consumer's native data.
    let grid=data.grid instanceof Float32Array?data.grid:new Float32Array(data.grid);
    if(this.options.mask)grid=this.options.mask(grid.slice(),width,height,c,source);
    if(!(grid instanceof Float32Array)||grid.length!==width*height)throw new Error('Invalid masked elevation grid');
    // One pass counts valid samples and finds non-NaN sentinels. Tiles arrive
    // in bursts while the map moves, so repeated full scans cost frames.
    let validCount=0,normalized=false;
    for(let i=0;i<grid.length;i++){const v=grid[i];if(v>-20000&&v<Infinity)validCount++;else if(v===v)normalized=true;}
    if(normalized){grid=grid.slice();for(let i=0;i<grid.length;i++)if(!valid(grid[i]))grid[i]=NaN;}
    // validCount: finite samples above -20000; every other sample is NaN.
    return {key,url:job.url,cacheKey:source.cacheKey,sourceId:source.id,rank:source.rank,label:source.label+(data.surveys?.some(s=>s.product==="Original Product Resolution DEM")?" + Elwha River OPR (1 m)":""),z:c.z,x:c.x,y:c.y,width,height,grid,
      sampleMeters:typeof source.sampleMeters==='function'?source.sampleMeters(c):source.sampleMeters??resolution(c,width),
      surveys:data.surveys||[],revision:++this._revision,validCount};
  };
  /* Native records for an export finer than the view: for each display tile,
   * the best-ranked source at its own finest level, and lower ranks only
   * where that record leaves samples missing - the order the live view
   * refines in. Records are handed to the caller, never kept here, so an
   * export cannot evict the live view's tiles. reuse(key) lets the caller
   * skip records it already holds: it returns {hasData, allValid} or null,
   * and such a key comes back as {key, reused: true}. */
  ElevationTileStore.prototype.loadDetail=function(displayTiles,options){
    options=options||{};
    if(this._destroyed)return Promise.resolve([]);
    const sources=(this._sources.length?this._sources:(typeof this.options.sources==='function'?this.options.sources():this.options.sources||[]))
      .slice().sort((a,b)=>b.rank-a.rank);
    const signal=options.signal,reuse=options.reuse,loads=new Map(),out=new Map();
    const fetchOne=(source,c)=>{
      const key=tileKey(source.id,c.z,c.x,c.y);
      if(loads.has(key))return loads.get(key);
      let promise;
      const held=reuse&&reuse(key);
      if(held)promise=Promise.resolve({key,reused:true,hasData:!!held.hasData,allValid:!!held.allValid});
      else if(this._tiles.has(key))promise=Promise.resolve(this._tiles.get(key));
      else{
        const job={key,source,c,url:sourceUrl(source,c),sharp:false};
        promise=Promise.resolve().then(()=>signal&&signal.aborted?null:this.options.request(job.url,{
          signal,priority:-1,group:source.group||'overview',kind:source.kind
        })).then(data=>data&&!this._destroyed?this._record(job,data):null).catch(()=>null);
      }
      loads.set(key,promise);return promise;
    };
    return Promise.all(displayTiles.map(async d=>{
      for(const source of sources){
        if(signal&&signal.aborted)break;
        if(source.allowed&&!source.allowed(d))continue;
        const got=await fetchOne(source,coords(d,native(source,d.z)));
        if(!got)continue;
        const hasData=got.reused?got.hasData:got.validCount>0,full=got.reused?got.allValid:got.validCount===got.grid.length;
        // A successful empty DNR answer must also reach the GPU export plan
        // so it can retire a coarse DNR ancestor without hiding lower sources.
        if(hasData||source.authoritativeCoverage)out.set(got.key,got);
        if(full)break;
      }
      if(options.onTile)options.onTile(d);
    })).then(()=>[...out.values()]);
  };
  ElevationTileStore.prototype._load=function(job){
    const {key,source,c,sharp,backdrop}=job;
    if(this._tiles.has(key))return Promise.resolve(this._tiles.get(key));
    if(this._pending.has(key))return this._pending.get(key).promise;
    if((this._failed.get(key)||0)>Date.now())return Promise.resolve(null);
    const controller=new AbortController(),epoch=this._epoch;
    const pending={controller,promise:null,job};this._pending.set(key,pending);
    pending.promise=Promise.resolve().then(()=>{if(controller.signal.aborted)return null;return this.options.request(job.url,{
      signal:controller.signal,priority:backdrop?.5:sharp?0:source.rank===5?2:source.rank,
      group:backdrop?'backdrop':sharp?'sharp':source.group||'overview',kind:source.kind
    });}).then(data=>{
      if(controller.signal.aborted||epoch!==this._epoch||this._destroyed)return null;
      const r=this._record(job,data);
      if(r.grid.byteLength>this.maxBytes){this._failed.set(key,Date.now()+30000);return null;}
      this._tiles.set(key,r);this._bytes+=r.grid.byteLength;
      let levels=this._levels.get(r.sourceId);if(!levels)this._levels.set(r.sourceId,levels=new Map());
      levels.set(r.z,(levels.get(r.z)||0)+1);this._invalidateSummaries(r);this._evict();
      this._emit('tile',r);return r;
    }).catch(error=>{
      if(!controller.signal.aborted&&epoch===this._epoch){this._failed.set(key,Date.now()+this.retryDelayMs);this._emit('error',{key,error});}
      return null;
    }).finally(()=>{
      if(this._pending.get(key)===pending)this._pending.delete(key);
      if(epoch===this._epoch)this._scheduleRetry();
      if(epoch===this._epoch&&!this._destroyed)this._emit('settled',key);
    });
    return pending.promise;
  };
  ElevationTileStore.prototype.want=function(displayTiles,options){
    if(this._destroyed)return;
    const sources=(typeof this.options.sources==='function'?this.options.sources():this.options.sources||[]).slice();
    const changed=sources.length!==this._sources.length||sources.some((s,i)=>s!==this._sources[i]);
    this._sources=sources;this._displays=displayTiles.slice();this._generation=options?.generation;this._bounds=options?.bounds||null;
    const demand=++this._demand;
    // Source identities are stable in the app, but URL revisions must also
    // invalidate cached/offscreen native tiles for other store consumers.
    if(changed){
      this._summaries.clear();const byId=new Map(sources.map(s=>[s.id,s]));
      for(const [key,r] of this._tiles){const s=byId.get(r.sourceId);
        if(!matchesSource(s,r))this._remove(key);}
      for(const [key,p] of this._pending){const s=byId.get(p.job.source.id);
        if(!matchesSource(s,{...p.job.c,url:p.job.url,rank:p.job.source.rank,label:p.job.source.label,cacheKey:p.job.source.cacheKey})){p.controller.abort();this._pending.delete(key);}}
      this._failed.clear();
    }
    const displayKeys=new Set(displayTiles.map(d=>tileKey('',d.z,mod(d.x,2**d.z),d.y)));
    for(const key of this._summaries.keys())if(!displayKeys.has(key))this._summaries.delete(key);
    const wanted=new Map(),groups=[];
    for(const d of displayTiles){
      const jobs=[];
      for(const source of this._sources){
        if(source.allowed&&!source.allowed(d))continue;
        const shown=Math.max(0,d.z-(source.dz??this.options.dz??0));
        for(const sharp of [false,true]){
          if(sharp&&source.sharper===false)continue;
          const z=native(source,sharp?d.z:shown),c=coords(d,z),key=tileKey(source.id,z,c.x,c.y);
          const url=sourceUrl(source,c);
          const job={key,source,c,url,sharp};
          if(!wanted.has(key)||!sharp)wanted.set(key,job);
          jobs.push(job);
          if(shown===d.z)break;
        }
      }
      groups.push(jobs);
    }
    const backdrop=[],bounds=this._bounds||boundsOf(displayTiles);
    if(bounds)for(const source of this._sources){
      if(!source.backdrop)continue;
      for(const t of backdropTiles(bounds,source.dz??this.options.dz??0)){
        if(source.allowed&&!source.allowed(t))continue;
        const c=coords(t,native(source,t.z)),key=tileKey(source.id,c.z,c.x,c.y);
        if(wanted.has(key))continue;
        const job={key,source,c,url:sourceUrl(source,c),sharp:false,backdrop:true};
        wanted.set(key,job);backdrop.push(job);
      }
    }
    /* Coarser backdrop tiles still on their way are fallback for this view: a
       fast zoom in must not cancel them just because it passed their level.
       Only the backdrop's, which are cheap. Kept 1 m, national and DNR tiles
       for the levels a pinch passed through are slow renders; they held every
       detail slot, so the view the zoom ended on waited seconds behind levels
       it no longer shows (measured 4 s on a 17.4 pinch, 2026-10-29). */
    const fallback=new Set();
    for(const d of displayTiles)for(const source of this._sources){
      if(!source.backdrop||source.allowed&&!source.allowed(d))continue;
      const z=native(source,Math.max(0,d.z-(source.dz??this.options.dz??0)));
      for(let k=1;k<=FALLBACK_LEVELS&&z-k>=0;k++){const c=coords(d,z-k);fallback.add(tileKey(source.id,c.z,c.x,c.y));}
    }
    this._wanted=wanted;
    for(const [key,until] of this._failed)if(!wanted.has(key)||until<=Date.now())this._failed.delete(key);
    for(const [key,p] of this._pending)if(!wanted.has(key)&&!fallback.has(key)){p.controller.abort();this._pending.delete(key);}
    // Every primary source is dispatched together; refinement cannot starve it.
    const primary=new Map(),dependents=new Map();
    for(const jobs of groups)for(const j of jobs)if(!j.sharp){
      primary.set(j.key,j);
      if(!dependents.has(j.key))dependents.set(j.key,[]);
      dependents.get(j.key).push(jobs);
    }
    const epoch=this._epoch;
    // Refine each available region independently. One slow/missing primary
    // must not hold every ready region behind a viewport-wide barrier.
    const refine=key=>{
      if(epoch!==this._epoch||demand!==this._demand||this._destroyed)return;
      for(const jobs of dependents.get(key)||[]){
        if(!jobs.length)continue;
        const available=jobs.filter(j=>!j.sharp&&this._tiles.has(j.key)&&this._tiles.get(j.key).validCount>0);
        available.sort((a,b)=>b.source.rank-a.source.rank);
        for(const best of available){
          const sharp=jobs.find(j=>j.sharp&&j.source.id===best.source.id&&j.c.z>best.c.z);
          if(sharp&&this._wanted.has(sharp.key))this._load(sharp);
          // Partial surveys still expose lower-rank fallback pixels. Those
          // pixels need their native detail too; full coverage can hide them.
          if(this._tiles.get(best.key).validCount===this._tiles.get(best.key).grid.length)break;
        }
      }
      this._evict();
    };
    const first=Promise.all([...primary.values()].map(j=>this._load(j).then(record=>{refine(j.key);return record;})));
    // The backdrop queues behind the view's own tiles (see _load priority).
    for(const job of backdrop)this._load(job);
    this._scheduleRetry();
    return first;
  };
  ElevationTileStore.prototype._sampler=function(sources,displayZ){
    const specs=sources.map(s=>({source:s,levels:[...(this._levels.get(s.id)?.keys()||[])].sort((a,b)=>b-a)}));
    return (mx,my)=>{
      if(my<0||my>1)return null;
      mx=mod(mx,1);let best=null;
      for(const {source:s,levels} of specs){
        if(best&&best.rank>s.rank)continue;
        const n=2**displayZ,c={z:displayZ,x:Math.floor(mx*n),y:Math.min(n-1,Math.floor(my*n))};
        if(s.allowed&&!s.allowed(c))continue;
        for(const z of levels){
          const nz=2**z,r=this._tiles.get(tileKey(s.id,z,Math.floor(mx*nz),Math.min(nz-1,Math.floor(my*nz))));
          if(!r)continue;
          const value=r.validCount?sample(r,mx,my):NaN;
          // A finer cached DNR response establishes this survey's coverage,
          // including its holes. Falling through to a startup-scale DNR
          // sample stretches that sample into terrain outside the survey.
          // Failed reads have no record and may still use a useful ancestor.
          if(!valid(value)){if(s.authoritativeCoverage)break;continue;}
          if(!best||r.rank>best.rank||(r.rank===best.rank&&r.z>best.z))best={value,rank:r.rank,label:r.label,z:r.z,sourceId:r.sourceId,record:r};
          break;
        }
      }
      return best;
    };
  };
  ElevationTileStore.prototype._at=function(mx,my,sources){
    const z=this._displays.length?Math.max(...this._displays.map(d=>d.z)):0;
    return this._sampler(sources,z)(mx,my);
  };
  ElevationTileStore.prototype.sampleAt=function(lng,lat){
    if(!Number.isFinite(lng)||!Number.isFinite(lat)||Math.abs(lat)>LIMIT)return null;
    const hit=this._at((lng+180)/360,mercY(lat),this._sources);
    if(!hit)return null;const {record,...result}=hit;return result;
  };
  ElevationTileStore.prototype._summary=function(d){
    const key=tileKey('',d.z,mod(d.x,2**d.z),d.y),cached=this._summaries.get(key);if(cached)return cached;
    const sources=this._sources.filter(s=>!s.allowed||s.allowed(d)),ids=new Set(sources.map(s=>s.id)),records=[];
    // finestFor touches the LRU: resolve it before iterating the live Map.
    const coverageLevels=new Map(sources.filter(s=>s.authoritativeCoverage).map(s=>[s.id,this.finestFor(s.id,d)?.z]));
    for(const r of this._tiles.values()){
      if(!ids.has(r.sourceId)||!r.validCount)continue;
      if(r.z<(coverageLevels.get(r.sourceId)??r.z))continue;
      const z=Math.min(d.z,r.z),a=coords(d,z),b=coords(r,z);if(a.x===b.x&&a.y===b.y)records.push(r);
    }
    records.sort((a,b)=>b.rank-a.rank||b.z-a.z||b.key.localeCompare(a.key));
    const entry={coords:{...d},ranks:{},records:new Set(),covered:0,total:256*256};
    const first=records[0];
    if(first&&first.z<=d.z&&first.validCount===first.grid.length){
      entry.covered=entry.total;entry.ranks[first.rank]=entry.total;entry.records.add(first);
    }else if(records.length){
      // Rank/validity metadata only: no elevation raster or interpolation is
      // produced in the draw/status path. Each display sample has one winner.
      const winners=new Uint8Array(entry.total),mx=mod(d.x,2**d.z);
      for(const r of records){
        const scale=2**(d.z-r.z),rx=r.x*scale,ry=r.y*scale;
        const x0=Math.max(0,Math.ceil((rx-mx)*256-.5)),x1=Math.min(256,Math.ceil((rx+scale-mx)*256-.5));
        const y0=Math.max(0,Math.ceil((ry-d.y)*256-.5)),y1=Math.min(256,Math.ceil((ry+scale-d.y)*256-.5));
        const allValid=r.validCount===r.grid.length;let contributed=0;
        const lower=new Int32Array(256),upper=new Int32Array(256),fraction=new Float64Array(256);
        if(!allValid)for(let x=x0;x<x1;x++){
          const px=Math.max(0,Math.min(r.width-1,((mx+(x+.5)/256-rx)/scale)*r.width-.5));
          lower[x]=Math.floor(px);upper[x]=Math.min(r.width-1,lower[x]+1);fraction[x]=px-lower[x];
        }
        for(let y=y0;y<y1;y++){
          const py=Math.max(0,Math.min(r.height-1,((d.y+(y+.5)/256-ry)/scale)*r.height-.5));
          const by=Math.floor(py),row=by*r.width,next=Math.min(r.height-1,by+1)*r.width,fy=py-by;
          for(let x=x0;x<x1;x++){
            const i=y*256+x;if(winners[i])continue;
            const lo=lower[x],hi=upper[x],fx=fraction[x],g=r.grid;
            if(allValid||valid(g[row+lo])||(fx>0&&valid(g[row+hi]))||(fy>0&&valid(g[next+lo]))||(fx>0&&fy>0&&valid(g[next+hi]))){
              winners[i]=1;contributed++;
            }
          }
        }
        if(contributed){entry.covered+=contributed;entry.ranks[r.rank]=(entry.ranks[r.rank]||0)+contributed;entry.records.add(r);}
        if(entry.covered===entry.total)break;
      }
    }
    this._summaries.set(key,entry);return entry;
  };
  ElevationTileStore.prototype.settled=function(displayTiles){
    const tiles=displayTiles||this._displays;let complete=0,coveredPixels=0,totalPixels=0;
    for(const d of tiles){const s=this._summary(d);if(s.covered===s.total)complete++;coveredPixels+=s.covered;totalPixels+=s.total;}
    // The backdrop is transitional cover, not the view's data: it never holds
    // readiness, refinement or failure status.
    const own=key=>this._wanted.has(key)&&!this._wanted.get(key).backdrop;
    return {complete,total:tiles.length,ratio:totalPixels?coveredPixels/totalPixels:0,coveredPixels,totalPixels,
      refining:[...this._pending.keys()].some(own)||[...this._failed.keys()].some(own)&&!!this._retryTimer,
      failed:[...this._failed.keys()].some(own)};
  };
  ElevationTileStore.prototype.provenance=function(displayTiles){
    const ranks={},labels=new Set(),surveys=new Map(),sampleMeters={};
    for(const d of displayTiles||this._displays){
      const summary=this._summary(d);
      for(const [rank,count] of Object.entries(summary.ranks))ranks[rank]=(ranks[rank]||0)+count;
      for(const r of summary.records){
        labels.add(r.label);if(Number.isFinite(r.sampleMeters))sampleMeters[r.rank]=Math.min(sampleMeters[r.rank]??Infinity,r.sampleMeters);
        for(const survey of r.surveys)surveys.set(JSON.stringify(survey),survey);
      }
    }
    return {ranks,labels:[...labels],surveys:[...surveys.values()],sampleMeters};
  };
  // Numeric pixel winners only. Published hillshade is never in this store.
  ElevationTileStore.prototype.detailGaps=function(displayTiles){
    const tiles=displayTiles||this._displays,status=this.settled(tiles);
    if(!tiles.length||status.refining||status.failed)return null;
    return tiles.filter(d=>{const s=this._summary(d);return (s.ranks[3]||0)+(s.ranks[5]||0)<s.total;}).map(d=>({...d}));
  };
  ElevationTileStore.prototype.gridForView=function(request){
    const b=request.bounds;
    const west=b.getWest?b.getWest():b.west??b[0],south=b.getSouth?b.getSouth():b.south??b[1];
    let east=b.getEast?b.getEast():b.east??b[2];const north=b.getNorth?b.getNorth():b.north??b[3];
    if(east<west)east+=360;
    if(![west,south,east,north,request.zoom].every(Number.isFinite)||east<=west||east-west>360||north<=south)throw new Error('Invalid research bounds');
    const requestedZ=Math.max(0,Math.min(28,Math.round(request.zoom))),displayZ=this._displays.length?Math.max(...this._displays.map(d=>d.z)):requestedZ;
    let density=0;const xWest=(west+180)/360,xEast=(east+180)/360,yNorth=mercY(north),ySouth=mercY(south);
    const specs=new Map(this._sources.map(s=>[s.id,s]));
    for(const r of this._tiles.values()){
      const s=specs.get(r.sourceId);if(!s||!r.validCount)continue;
      const n=2**r.z,rx=r.x/n,ry=r.y/n;
      // A native tile may cover many display tiles, including a selected DNR
      // corner whose native-tile center is outside the selected area.
      if(s.allowed&&!this._displays.some(d=>{
        if(!s.allowed(d))return false;
        const z=Math.min(d.z,r.z),a=coords(d,z),b=coords(r,z);return a.x===b.x&&a.y===b.y;
      }))continue;
      const shift=Math.floor(xWest-rx),overlapsX=[shift,shift+1].some(w=>rx+w<xEast&&rx+1/n+w>xWest);
      if(overlapsX&&ry<ySouth&&ry+1/n>yNorth)density=Math.max(density,Math.max(r.width,r.height)*n);
    }
    if(!density)throw new Error('No elevation pixels are ready for this view.');
    // Display coordinates already include the HiDPI next-zoom level.
    density=Math.min(density,256*2**Math.max(requestedZ,displayZ));
    // Reproduce the research mosaic's box average, streamed into bounded
    // output bins. Never substitute one bilinear center for a downsampled area.
    const ix0=Math.floor(xWest*density+1e-8),ix1=Math.ceil(xEast*density-1e-8),iy0=Math.floor(yNorth*density+1e-8),iy1=Math.ceil(ySouth*density-1e-8);
    const nativeW=Math.max(1,ix1-ix0),nativeH=Math.max(1,iy1-iy0),max=Math.max(1,Math.floor(request.maxSide||640));
    if(nativeW*nativeH>(this.options.maxResearchSamples??16777216))throw new Error('Research view has too many native samples; zoom in before analysis.');
    const factor=Math.max(1,Math.ceil(Math.max(nativeW,nativeH)/max)),width=Math.ceil(nativeW/factor),height=Math.ceil(nativeH/factor);
    const surveys=new Map();
    const grid=new Float32Array(width*height),sums=new Float64Array(grid.length),counts=new Uint32Array(grid.length),labels=new Set();grid.fill(NaN);
    const hitAt=this._sampler(this._sources,displayZ);
    for(let y=0;y<nativeH;y++)for(let x=0;x<nativeW;x++){
      const hit=hitAt((ix0+x+.5)/density,(iy0+y+.5)/density);
      if(hit){const i=Math.floor(y/factor)*width+Math.floor(x/factor);sums[i]+=hit.value;counts[i]++;labels.add(hit.label);for(const survey of hit.record.surveys)surveys.set(JSON.stringify(survey),survey);}
    }
    for(let i=0;i<grid.length;i++)if(counts[i])grid[i]=sums[i]/counts[i];
    if(!labels.size)throw new Error('No elevation pixels are ready for this view.');
    const outputBounds=[[latitude((iy0+height*factor)/density),ix0/density*360-180],[latitude(iy0/density),(ix0+width*factor)/density*360-180]];
    return {grid,width,height,bounds:outputBounds,z:Math.log2(density/256),factor,
      resolution:EARTH*Math.cos((north+south)/2*Math.PI/180)/density*factor,
      provenance:[...labels],surveys:[...surveys.values()],provisional:this._pending.size>0};
  };
  ElevationTileStore.prototype.clear=function(){
    clearTimeout(this._retryTimer);this._retryTimer=0;
    this._epoch++;this._demand++;for(const p of this._pending.values())p.controller.abort();this._pending.clear();
    this._tiles.clear();this._failed.clear();this._wanted.clear();this._displays=[];this._bytes=0;this._levels.clear();this._summaries.clear();this._emit('clear');
  };
  ElevationTileStore.prototype.destroy=function(){this._destroyed=true;this.clear();this._listeners={};};
  ElevationTileStore.prototype.stats=function(){return {tiles:this._tiles.size,bytes:this._bytes,pending:this._pending.size,maxBytes:this.maxBytes};};
  function buildSources(o,e){
    const out=[],dz=e.dz||0,add=(id,rank,label,max,url,allowed,kind)=>out.push({id,rank,label,dz,
      nativeZoom:z=>Math.min(z,max),url,allowed,kind,sharper:true,group:rank===5?'dnr':rank===3?'detail':rank===2?'national':'overview',sampleMeters:e.sourceSampleMeters});
    if(e.proxy&&o.dnrEndpoint){add('dnr',5,'WA DNR elevation',18,(z,x,y)=>e.api(`${o.dnrEndpoint}/${z}/${x}/${y}.png?acquire=0&revision=${e.dnrRevision||0}`),e.dnrTileAllowed);out[out.length-1].cacheKey=o.dnrMaskKey;out[out.length-1].authoritativeCoverage=true;}
    if(e.proxy&&o.rawEndpoint)add('raw',3,'USGS 3.3 ft',o.rawNativeZoom??28,(z,x,y)=>e.api(`${o.rawEndpoint}/${z}/${x}/${y}.png?${e.rawCoverageQuery||''}`),c=>c.z-dz>=13);
    if(e.proxy&&o.nationalEndpoint)add('national',2,'National elevation',o.nationalNativeZoom??28,(z,x,y)=>e.api(`${o.nationalEndpoint}/${z}/${x}/${y}.png`),c=>c.z-dz>=13||o.refineOverview);
    if(!e.proxy&&o.fallback)add('national',2,'USGS 3DEP elevation',18,(z,x,y)=>e.nationalUrl({z,x,y}),()=>true,'lerc');
    if(o.fallback){add('overview',1,'Overview elevation',o.fallbackNativeZoom??28,(z,x,y)=>typeof o.fallback==='function'?o.fallback({z,x,y}):o.fallback.replace('{z}',z).replace('{x}',x).replace('{y}',y),()=>true,typeof o.fallback==='function'?'lerc':undefined);
      out[out.length-1].backdrop=true;}
    return out;
  }
  return Object.freeze({VERSION:'1',tileKey,ElevationTileStore,buildSources});
});
