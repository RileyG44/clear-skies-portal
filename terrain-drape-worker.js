/* Analytical drapes are independent of MapLibre's DEM/mesh workers. A tile's
   skirt, derivatives and palette run here; only the final bitmap crosses back. */
"use strict";
importScripts("terrain-core.js","terrain-raster.js","elevation-bands.js","elevation-tile-core.js","terrain-drape-core.js");
self.onmessage=async({data:job})=>{
  let bitmap;
  try{
    if(job.op==="decode"){
      bitmap=await createImageBitmap(job.blob,{premultiplyAlpha:"none",colorSpaceConversion:"none"});
      const canvas=new OffscreenCanvas(256,256);
      try{
        const context=canvas.getContext("2d",{willReadFrequently:true});context.drawImage(bitmap,0,0,256,256);
        const grid=ElevationTileCore.decodeTerrarium(context.getImageData(0,0,256,256).data,256,256);
        self.postMessage({id:job.id,grid},[grid.buffer]);
      }finally{canvas.width=canvas.height=0;bitmap.close();bitmap=null}
    }else{
      const size=job.size||256,rgba=CSPTerrainDrape.render(job);
      bitmap=await createImageBitmap(new ImageData(rgba,size,size),CSPTerrainDrape.BITMAP_OPTIONS);
      self.postMessage({id:job.id,bitmap},[bitmap]);bitmap=null;
    }
  }catch(error){bitmap?.close();self.postMessage({id:job.id,error:error.message||String(error)})}
};
