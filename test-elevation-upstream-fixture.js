'use strict';
/* Loaded only into the integration-test child process. Exercise the real HTTP
   handler, TIFF decoder and worker pool without depending on live USGS. */
const https=require('node:https'),{EventEmitter}=require('node:events'),{Readable}=require('node:stream');
function tiff(value){
  const count=10,offset=8+2+count*12+4,size=256*256*4,buffer=Buffer.alloc(offset+size);
  buffer.write('II');buffer.writeUInt16LE(42,2);buffer.writeUInt32LE(8,4);buffer.writeUInt16LE(count,8);
  const tags=[[256,4,256],[257,4,256],[258,3,32],[259,3,1],[262,3,1],[273,4,offset],[277,3,1],[278,4,256],[279,4,size],[339,3,3]];
  tags.forEach(([tag,type,value],i)=>{const p=10+i*12;buffer.writeUInt16LE(tag,p);buffer.writeUInt16LE(type,p+2);buffer.writeUInt32LE(1,p+4);if(type===3)buffer.writeUInt16LE(value,p+8);else buffer.writeUInt32LE(value,p+8);});
  for(let i=offset;i<buffer.length;i+=4)buffer.writeFloatLE(value,i);
  return buffer;
}
https.request=(options,callback)=>{
  if(options.host!=='elevation.nationalmap.gov'||!options.path.startsWith('/arcgis/rest/services/3DEPElevation/ImageServer/exportImage?'))
    throw new Error('Unexpected external request in offline integration test');
  const query=new URL('https://fixture.invalid'+options.path).searchParams;
  const bounds=query.get('bbox').split(',').map(Number);
  const ocean=bounds[0]<-16000000&&bounds[3]===0;
  const response=Readable.from([tiff(ocean?NaN:123.5)]);
  response.statusCode=200;response.headers={'content-type':'image/tiff'};
  const req=new EventEmitter();req.setTimeout=()=>req;req.write=()=>true;
  req.destroy=error=>{req.destroyed=true;if(error)queueMicrotask(()=>req.emit('error',error));};
  req.end=()=>queueMicrotask(()=>{if(!req.destroyed)callback(response);});
  return req;
};
