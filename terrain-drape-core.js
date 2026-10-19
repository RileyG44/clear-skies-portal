/* Float elevation skirts and shared 2D/3D spectrum colouring. No canvas or
   Terrarium re-encoding: engine grids keep their original Float32 precision. */
(function(root,factory){
  if(typeof module==="object"&&module.exports)module.exports=factory(require("./terrain-raster.js"),require("./elevation-bands.js"),require("./elevation-tile-core.js"));
  else root.CSPTerrainDrape=factory(root.CSPTerrainRaster,root.ElevationBands,root.ElevationTileCore);
})(typeof globalThis!=="undefined"?globalThis:this,function(raster,bands,elevation){
  "use strict";
  function skirt(tiles,size=256){
    const [centre,west,east,north,south]=tiles,n=size+2;
    if(!centre||centre.length!==size*size)throw new Error("elevation tile unavailable");
    const grid=new Float32Array(n*n);
    for(let y=0;y<size;y++){
      grid.set(centre.subarray(y*size,(y+1)*size),(y+1)*n+1);
      grid[(y+1)*n]=(west||centre)[y*size+(west?size-1:0)];
      grid[(y+1)*n+n-1]=(east||centre)[y*size+(east?0:size-1)];
    }
    grid.set((north||centre).subarray(north?(size-1)*size:0,north?size*size:size),1);
    grid.set((south||centre).subarray(south?0:(size-1)*size,south?size:size*size),(n-1)*n+1);
    // Match the former canvas skirt's four corners: nearest north/south cell.
    grid[0]=grid[1];grid[n-1]=grid[n-2];grid[(n-1)*n]=grid[(n-1)*n+1];grid[n*n-1]=grid[n*n-2];
    // Raw Float32 sources can carry finite nodata sentinels. Match the old
    // Terrarium alpha mask before either derivatives or spectrum colouring.
    for(let i=0;i<grid.length;i++)if(!elevation.isElevation(grid[i]))grid[i]=NaN;
    return grid;
  }
  function elevationColours(elev,count,settings,out,width=count,stride=width,offset=0){
    const low=settings.spectrumLow||[248,92,108],mid=settings.spectrumMid||[255,255,250],high=settings.spectrumHigh||[70,160,255];
    for(let i=0;i<count;i++){
      const v=elev[offset+Math.floor(i/width)*stride+(i%width)],o=i*4;
      if(v!==v) continue;
      let pr=0,pg=0,pb=0,pa=0;
      const over=(r,g,b,a)=>{ pr=r*a+pr*(1-a);pg=g*a+pg*(1-a);pb=b*a+pb*(1-a);pa=a+pa*(1-a) };
      if(settings.spectrumOn){
        const d=(v-settings.level)/Math.max(1,settings.span),t=Math.min(1,Math.abs(d));
        const smooth=t*t*(3-2*t),hi=d>=0,a=settings.spectrumAlpha*(.15+.85*t);
        const target=hi?high:low;
        over((mid[0]+(target[0]-mid[0])*smooth)/255,
             (mid[1]+(target[1]-mid[1])*smooth)/255,
             (mid[2]+(target[2]-mid[2])*smooth)/255,a);
      }
      const band=settings.bandCompiled.rgba(v,"premultiplied"),ba=band[3]/255;
      if(ba>0){ pr=band[0]/255+pr*(1-ba);pg=band[1]/255+pg*(1-ba);
                pb=band[2]/255+pb*(1-ba);pa=ba+pa*(1-ba) }
      if(pa>0){ out[o]=Math.round(pr/pa*255);out[o+1]=Math.round(pg/pa*255);
                out[o+2]=Math.round(pb/pa*255);out[o+3]=Math.round(pa*255) }
    }
    return out;
  }

  function render(job){
    const size=job.size||256,grid=skirt(job.tiles,size);
    if(job.style!=="spectrum")return raster.renderRgba(job.style,{grid,size,n:size+2,groundRes:job.groundRes,lighting:job.lighting});
    const settings={...job.settings,bandCompiled:bands.compileBands(job.settings.bandState)};
    return elevationColours(grid,size*size,settings,new Uint8ClampedArray(size*size*4),size,size+2,size+3);
  }
  /* Raster textures use premultiplied alpha. ImageBitmap ignores WebGL's
     UNPACK_PREMULTIPLY_ALPHA_WEBGL, so premultiply here, just as MapLibre's
     default PNG decoder does. ImageData is sRGB; no profile conversion needed. */
  const BITMAP_OPTIONS=Object.freeze({premultiplyAlpha:"premultiply",colorSpaceConversion:"none"});
  return Object.freeze({skirt,elevationColours,render,BITMAP_OPTIONS});
});
