/* Published hillshade is a picture, never a height grid. This existing image
   path is reserved for ordinary hs; analytical/Studio/3D rendering stays on
   numeric elevation. One canvas applies opacity once to the whole mixture. */
const publishedHillshadeRequests=new CSPTilePipeline.RequestPool({concurrency:4,maxBytes:16*1024*1024});
async function fetchPublishedHillshade(url,signal,size){
  const controller=new AbortController(),abort=()=>controller.abort();
  signal.addEventListener("abort",abort,{once:true});
  const timeout=setTimeout(abort,15000);
  let bitmap,canvas;
  try{
    const response=await fetch(url,{signal:controller.signal});
    if(response.status!==200||response.headers.get("X-CSP-Error"))throw new Error("Published DNR hillshade unavailable");
    bitmap=await CompositeTerrainLayer.prototype._bitmap(await response.blob());
    if(signal.aborted)throw new DOMException("Aborted","AbortError");
    canvas=document.createElement("canvas");canvas.width=canvas.height=size;
    const context=canvas.getContext("2d");context.drawImage(bitmap,0,0,size,size);
    // Alpha is the coverage evidence. A valid transparent PNG is final nodata,
    // whereas a timeout/204/503 must remain eligible for stationary retry.
    return context.getImageData(0,0,size,size).data;
  }finally{
    clearTimeout(timeout);signal.removeEventListener("abort",abort);
    bitmap?.close?.();if(canvas)releaseCanvas(canvas);
  }
}
const PublishedHillshadeLayer=AnalyticTerrainLayer.extend({
  initialize:function(options){
    ElevLayer.prototype.initialize.call(this,options);
    this._published=new Map();
    this.on("tileunload",event=>{
      const key=this._k(this._source(event.coords)),job=this._published.get(key);
      if(job?.canvas===event.tile){
        job.controller.abort();clearTimeout(job.retryTimer);this._published.delete(key);
      }
    });
    this.on("tilerefine",event=>{
      const job=this._published.get(this._k(event.coords));
      if(job?.canvas===event.tile)this._publishedStatus(job);
    });
  },
  _progressForTile:function(canvas){return this._published.get(this._k(canvas._cspCoords))?.progress;},
  _currentPublished:function(job){return !job.controller.signal.aborted&&this._published.get(this._k(job.coords))===job;},
  _loadTile:function(coords,canvas,done){
    const key=this._k(coords),old=this._published.get(key);
    if(old){old.controller.abort();clearTimeout(old.retryTimer);}
    const job={coords,canvas,controller:new AbortController(),progress:new CSPTilePipeline.ProgressiveGrid(canvas.width*canvas.height),
      pixels:null,numericActive:false,imageActive:false,numericFailed:false,imageFailed:false,retries:0,retryTimer:null,completed:false,done};
    this._published.set(key,job);
    this._store.set(key,{cv:canvas,elev:job.progress.grid,coords:{...coords},ranks:job.progress.ranks});
    this._loadPublishedNumeric(job);this._loadPublishedImage(job);
  },
  _finishPublished:function(job){
    if(!this._currentPublished(job))return;
    const canvas=job.canvas;
    if(!job.numericFailed&&!job.imageFailed&&job.retryTimer){clearTimeout(job.retryTimer);job.retryTimer=null;}
    if((job.numericFailed&&!job.numericActive||job.imageFailed&&!job.imageActive)&&!job.retryTimer){
      job.retryTimer=setTimeout(()=>{
        job.retryTimer=null;if(!this._currentPublished(job))return;
        if(job.numericFailed&&!job.numericActive)this._loadPublishedNumeric(job);
        if(job.imageFailed&&!job.imageActive)this._loadPublishedImage(job);
        this._publishedStatus(job);
      },Math.min(30000,1000*2**Math.min(5,job.retries++)));
    }
    this._publishedStatus(job);
    if(!job.completed&&(canvas._cspHasContent||!job.numericActive&&!job.imageActive)){
      job.completed=true;job.done(canvas._cspHasContent?null:new Error("Terrain sources unavailable"),canvas);
    }
    this.fire("tilerefine",{tile:canvas,coords:job.coords});
  },
  _publishedStatus:function(job){
    job.canvas._cspRefining=job.numericActive||job.imageActive||!!job.retryTimer;
    job.canvas._cspRefineFailed=job.numericFailed||job.imageFailed;
  },
  _loadPublishedNumeric:function(job){
    job.numericActive=true;this._publishedStatus(job);
    const loaded=ElevLayer.prototype._loadTile.call(this,job.coords,job.canvas,()=>this._finishPublished(job));
    Promise.resolve(loaded).then(results=>{
      if(!this._currentPublished(job))return;
      job.numericActive=false;job.numericFailed=results?.some(r=>r.status==="rejected")||false;
      this._finishPublished(job);
    });
  },
  _loadPublishedImage:function(job){
    const url=this.options.publishedUrl(job.coords,job.canvas.width);
    if(!url){this._finishPublished(job);return;}
    job.imageActive=true;this._publishedStatus(job);
    publishedHillshadeRequests.request(url,signal=>fetchPublishedHillshade(url,signal,job.canvas.width),
      {signal:job.controller.signal,priority:4}).then(pixels=>{
        if(!this._currentPublished(job))return;
        job.pixels=pixels;job.imageFailed=false;
        this._paint(job.canvas,job.progress.grid,job.coords);
      },error=>{if(this._currentPublished(job))job.imageFailed=true;}).finally(()=>{
        if(!this._currentPublished(job))return;
        job.imageActive=false;this._finishPublished(job);
      });
  },
  _paint:function(canvas,elevation,coords){
    AnalyticTerrainLayer.prototype._paint.call(this,canvas,elevation,coords);
    const job=this._published.get(this._k(coords));if(!job)return;
    const context=canvas.getContext("2d"),image=context.getImageData(0,0,canvas.width,canvas.height),rgba=image.data;
    const counts={1:0,2:0,3:0,4:0,5:0},ranks=job.progress.ranks,published=job.pixels;
    for(let i=0;i<ranks.length;i++){
      const offset=i*4,rank=ranks[i],baseAlpha=rgba[offset+3]/255;
      // Numeric DNR always wins. Image gray values never enter progress.grid.
      const alpha=rank===5?0:(published?.[offset+3]||0)/255;
      const outAlpha=alpha+baseAlpha*(1-alpha);
      if(alpha){
        for(let c=0;c<3;c++)rgba[offset+c]=(published[offset+c]*alpha+rgba[offset+c]*baseAlpha*(1-alpha))/outAlpha;
        rgba[offset+3]=Math.round(outAlpha*255);
      }
      counts[4]+=alpha;if(rank)counts[rank]+=baseAlpha*(1-alpha);
    }
    context.putImageData(image,0,0);
    canvas._cspSourceCounts=counts;
    canvas._cspHasContent=Object.values(counts).some(n=>n>0);
    canvas._cspSourceResolution||={};canvas._cspSourceResolution[4]=sourceSampleMeters(coords);
    canvas.dataset.cspRenderer="published-composite";
    canvas.dataset.cspElevationSource=[5,4,3,2,1].filter(rank=>counts[rank]>0).map(rank=>CSPPublicTerrain.SOURCES[rank].label).join(" + ");
    // Keep readout/analysis data numeric and label it from its own pixel rank.
    const tile=this._store.get(this._k(coords));if(tile)tile.ranks=ranks;
  }
});
