/* Request bounds, result framing and landform labels shared by page, worker
 * and engine. This contract has no algorithm, DOM or network dependencies. */
(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports) module.exports=api;
  else root.CSPResearchContract=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";
  var VERSION=1,PROTOCOL_VERSION=1,HEADER_BYTES=24;
  var PRODUCTS=Object.freeze(["lrm","tpi","tri","residual","northness","curvature","glacial","moraine","flood",
    "svf","openpos","openneg","rrim","geomorphons","drainage","wetness","depressions","avalanche","solar","wind"]);
  var SCALES=Object.freeze({fine:4,balanced:10,broad:24});
  var TERRAIN_PRODUCTS=Object.freeze(["svf","openpos","openneg","rrim","geomorphons","drainage","wetness","depressions","avalanche","solar","wind"]);

  /* Product parameters. Every field is optional and clamped; anything else
     is dropped, so the server cache key and worker input stay bounded. */
  function analysisOptions(input){
    var source=input&&input.options&&typeof input.options==="object"?input.options:{};
    var out={},day=Number(source.dayOfYear),lat=Number(source.latitude),wind=Number(source.windAzimuth);
    if(Number.isFinite(day)) out.dayOfYear=Math.max(1,Math.min(366,Math.round(day)));
    if(Number.isFinite(lat)) out.latitude=Math.max(-85,Math.min(85,Math.round(lat*1000)/1000));
    if(Number.isFinite(wind)) out.windAzimuth=((Math.round(wind)%360)+360)%360;
    return out;
  }
  var LIMITS=Object.freeze({maxWidth:1024,maxHeight:1024,maxCells:524288,minResolution:0.01,maxResolution:100000});

  function validate(input){
    if(!input||typeof input!=="object") throw new TypeError("analysis request is required");
    var product=String(input.product||""),scale=String(input.scale||"");
    var width=Number(input.width),height=Number(input.height),resolution=Number(input.resolution);
    if(PRODUCTS.indexOf(product)<0) throw new RangeError("unknown research product");
    if(!Object.prototype.hasOwnProperty.call(SCALES,scale)) throw new RangeError("unknown research scale");
    if(!Number.isInteger(width)||width<3||width>LIMITS.maxWidth||
       !Number.isInteger(height)||height<3||height>LIMITS.maxHeight||width*height>LIMITS.maxCells)
      throw new RangeError("analysis dimensions are outside the safe bounds");
    if(!Number.isFinite(resolution)||resolution<LIMITS.minResolution||resolution>LIMITS.maxResolution)
      throw new RangeError("analysis resolution is outside the safe bounds");
    if(!input.grid||typeof input.grid.length!=="number"||input.grid.length!==width*height)
      throw new RangeError("analysis grid length must equal width times height");
    return {product:product,scale:scale,width:width,height:height,resolution:resolution,grid:input.grid,options:analysisOptions(input)};
  }

  const GEOMORPHON_CLASSES=Object.freeze(["","Flat","Peak","Ridge","Shoulder","Spur","Slope","Hollow","Footslope","Valley","Pit"]);

  function utf8Encode(text){
    if(typeof TextEncoder==="function") return new TextEncoder().encode(text);
    return Uint8Array.from(Buffer.from(text,"utf8"));
  }
  function utf8Decode(bytes){
    if(typeof TextDecoder==="function") return new TextDecoder().decode(bytes);
    return Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength).toString("utf8");
  }
  function asArrayBuffer(input){
    if(input instanceof ArrayBuffer) return input;
    if(ArrayBuffer.isView(input)) return input.buffer.slice(input.byteOffset,input.byteOffset+input.byteLength);
    throw new TypeError("analysis response must be an ArrayBuffer or typed-array view");
  }

  /* CSPA binary frame: 24-byte header, UTF-8 JSON metadata padded to four
     bytes, then one or two little-endian Float32 rasters. */
  function encodeResult(result){
    if(!result||!result.data||!Number.isInteger(result.width)||!Number.isInteger(result.height))
      throw new TypeError("complete analysis result is required");
    var count=result.width*result.height;
    if(result.data.length!==count||result.secondary&&result.secondary.length!==count)
      throw new RangeError("analysis result raster length mismatch");
    var descriptor=utf8Encode(JSON.stringify({label:result.label||"",metadata:result.metadata||null,notice:result.notice||null}));
    var padded=(descriptor.length+3)&~3,planes=result.secondary?2:1;
    var buffer=new ArrayBuffer(HEADER_BYTES+padded+count*4*planes),view=new DataView(buffer);
    view.setUint8(0,67);view.setUint8(1,83);view.setUint8(2,80);view.setUint8(3,65); // CSPA
    view.setUint16(4,PROTOCOL_VERSION,true);view.setUint16(6,result.secondary?1:0,true);
    view.setUint32(8,result.width,true);view.setUint32(12,result.height,true);
    view.setUint32(16,descriptor.length,true);view.setUint32(20,count,true);
    new Uint8Array(buffer,HEADER_BYTES,descriptor.length).set(descriptor);
    new Float32Array(buffer,HEADER_BYTES+padded,count).set(result.data);
    if(result.secondary) new Float32Array(buffer,HEADER_BYTES+padded+count*4,count).set(result.secondary);
    return buffer;
  }

  function decodeResult(input){
    var buffer=asArrayBuffer(input);
    if(buffer.byteLength<HEADER_BYTES) throw new RangeError("analysis response is truncated");
    var view=new DataView(buffer);
    if(view.getUint8(0)!==67||view.getUint8(1)!==83||view.getUint8(2)!==80||view.getUint8(3)!==65)
      throw new RangeError("analysis response has an invalid signature");
    if(view.getUint16(4,true)!==PROTOCOL_VERSION) throw new RangeError("unsupported analysis response version");
    var flags=view.getUint16(6,true),width=view.getUint32(8,true),height=view.getUint32(12,true);
    var metadataLength=view.getUint32(16,true),count=view.getUint32(20,true);
    if(!width||!height||width*height!==count||count>LIMITS.maxCells) throw new RangeError("analysis response dimensions are invalid");
    var padded=(metadataLength+3)&~3,planes=flags&1?2:1;
    var expected=HEADER_BYTES+padded+count*4*planes;
    if(expected!==buffer.byteLength) throw new RangeError("analysis response length is invalid");
    var descriptor;
    try{ descriptor=JSON.parse(utf8Decode(new Uint8Array(buffer,HEADER_BYTES,metadataLength))) }
    catch(error){ throw new RangeError("analysis response metadata is invalid") }
    var offset=HEADER_BYTES+padded;
    return {data:new Float32Array(buffer,offset,count),secondary:flags&1?new Float32Array(buffer,offset+count*4,count):null,
      width:width,height:height,label:String(descriptor.label||""),metadata:descriptor.metadata||null,notice:descriptor.notice||null};
  }

  function shouldOffload(input){
    input=input||{};
    if(!input.connected) return false;
    var cells=Number(input.cells)||0,hardware=Number(input.hardwareConcurrency)||0;
    return !!input.mobile || cells>=160000 || (hardware>0&&hardware<=4&&cells>=80000);
  }

  return Object.freeze({VERSION,PROTOCOL_VERSION,PRODUCTS,SCALES,LIMITS,TERRAIN_PRODUCTS,
    GEOMORPHON_CLASSES,analysisOptions,validate,encodeResult,decodeResult,shouldOffload});
});
