/* The ~117 KB official Esri decoder is loaded only when public detail is used. */
'use strict';
importScripts('vendor/lerc/LercDecode.js','public-terrain.js');
const ready=Lerc.load({locateFile:name=>new URL('vendor/lerc/'+name,self.location.href).href});
self.onmessage=async({data:{id,buffer}})=>{
  try{
    await ready;
    const tile=CSPPublicTerrain.decode(Lerc.decode(buffer));
    self.postMessage({id,tile},tile?[tile.grid.buffer]:[]);
  }catch(error){self.postMessage({id,error:error.message||String(error)})}
};
