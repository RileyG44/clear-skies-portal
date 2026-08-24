/* Shared browser/Node dispatcher and compact binary protocol for viewport DEM
   research analysis. Heavy algorithms remain in glacial-research-core.js. */
(function(root,factory){
  "use strict";
  var api=typeof module==="object"&&module.exports
    ? factory(require("./glacial-research-core.js"))
    : factory(root&&root.CSPGlacialResearch);
  if(typeof module==="object"&&module.exports) module.exports=api;
  if(root) root.CSPResearchAnalysis=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(G){
  "use strict";

  var VERSION=1,PROTOCOL_VERSION=1,HEADER_BYTES=24;
  var PRODUCTS=Object.freeze(["lrm","tpi","tri","residual","northness","curvature","glacial","flood"]);
  var SCALES=Object.freeze({fine:4,balanced:10,broad:24});
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
    return {product:product,scale:scale,width:width,height:height,resolution:resolution,grid:input.grid};
  }

  function validateElevations(grid){
    var finite=0;
    for(var i=0;i<grid.length;i++){
      var value=Number(grid[i]);
      if(!Number.isFinite(value)) continue;
      if(value < -20000 || value > 100000) throw new RangeError("analysis grid contains an implausible finite elevation");
      finite++;
    }
    if(finite<9) throw new RangeError("analysis grid needs at least nine finite elevation samples");
  }

  function run(input){
    if(!G) throw new Error("CSPGlacialResearch is not loaded");
    var request=validate(input);validateElevations(request.grid);
    var product=request.product,width=request.width,height=request.height,grid=request.grid;
    var radius=SCALES[request.scale];
    var options={cellSize:request.resolution,horizontalUnit:"m",verticalUnit:"m",rowAxis:"south",edgePolicy:"shrink"};
    var result,data,secondary=null,notice=null,label="";
    if(product==="lrm"){
      result=G.localReliefModel(grid,width,height,Object.assign({},options,{radiusCells:radius}));
      data=result.data;label="Local relief";
    }else if(product==="tpi"){
      result=G.terrainPositionIndex(grid,width,height,Object.assign({},options,{radiusCells:radius,innerRadiusCells:Math.max(0,Math.floor(radius/3))}));
      data=result.data;label="Terrain position";
    }else if(product==="tri"){
      result=G.terrainRuggednessIndex(grid,width,height,Object.assign({},options,{method:"riley"}));
      data=result.data;label="Terrain ruggedness";
    }else if(product==="residual"){
      var scales=[Math.max(2,Math.floor(radius/2)),radius,radius*2];
      result=G.multiScaleResidualAnalysis(grid,width,height,Object.assign({},options,{scales:scales}));
      data=result.anomaly;label="Multi-scale residual anomaly";
    }else if(product==="northness"){
      result=G.slopeAspectComponents(grid,width,height,options);
      data=result.northness;secondary=result.eastness;label="Aspect components";
    }else if(product==="curvature"){
      result=G.finiteDifferenceCurvature(grid,width,height,options);
      data=result.laplacian;label="Surface curvature";
    }else if(product==="glacial"){
      result=G.scoreGlacialLobeMarginCandidates(grid,width,height,Object.assign({},options,{radiusCells:radius}));
      data=result.score;notice=result.metadata.screeningNotice;label="Possible glacial-margin morphology";
    }else if(product==="flood"){
      result=G.scoreFloodChannelCandidates(grid,width,height,Object.assign({},options,{radiusCells:radius}));
      data=result.score;notice=result.metadata.screeningNotice;label="Possible flood-channel morphology";
    }
    return {data:data,secondary:secondary,width:width,height:height,label:label,metadata:result.metadata,notice:notice};
  }

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

  return Object.freeze({VERSION:VERSION,PROTOCOL_VERSION:PROTOCOL_VERSION,PRODUCTS:PRODUCTS,SCALES:SCALES,LIMITS:LIMITS,
    validate:validate,run:run,encodeResult:encodeResult,decodeResult:decodeResult,shouldOffload:shouldOffload});
});
