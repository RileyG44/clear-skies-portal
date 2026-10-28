/* Worker/Node algorithm dispatcher for viewport DEM analysis. The page uses
   research-contract.js without loading this computational dependency graph. */
(function(root,factory){
  "use strict";
  var api=typeof module==="object"&&module.exports
    ? factory(require("./glacial-research-core.js"),require("./glacial-zone-core.js"),
      require("./glacial-zone-features.js"),require("./glacial-belt-classifier.js"),require("./glacial-moraine-analysis.js"),
      require("./terrain-analysis-core.js"),require("./research-contract.js"))
    : factory(root&&root.CSPGlacialResearch,root&&root.CSPGlacialZones,
      root&&root.CSPGlacialZoneFeatures,root&&root.CSPGlacialBeltClassifier,root&&root.CSPGlacialMoraineAnalysis,
      root&&root.CSPTerrainAnalysis,root&&root.CSPResearchContract);
  if(typeof module==="object"&&module.exports) module.exports=api;
  if(root) root.CSPResearchAnalysis=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(G,Z,ZF,B,M,T,contract){
  "use strict";

  const {SCALES,TERRAIN_PRODUCTS,validate}=contract;
  /* Horizon-search radius in cells for the lidar visualization products, and
     the upwind search distance in metres for wind exposure, per scale. */
  var HORIZON_CELLS=Object.freeze({fine:8,balanced:20,broad:50});
  var WIND_METRES=Object.freeze({fine:100,balanced:300,broad:600});

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

  function runTerrain(request){
    if(!T) throw new Error("CSPTerrainAnalysis is not loaded");
    var product=request.product,width=request.width,height=request.height,grid=request.grid;
    var options=Object.assign({cellSize:request.resolution,radiusCells:HORIZON_CELLS[request.scale]},request.options);
    var result,label;
    if(product==="svf"){result=T.skyViewFactor(grid,width,height,options);label="Sky-view factor"}
    else if(product==="openpos"){result=T.openness(grid,width,height,options);label="Positive openness"}
    else if(product==="openneg"){result=T.openness(grid,width,height,Object.assign(options,{sign:"negative"}));label="Negative openness"}
    else if(product==="rrim"){result=T.redRelief(grid,width,height,options);label="Red relief image map"}
    else if(product==="geomorphons"){result=T.geomorphons(grid,width,height,Object.assign(options,{radiusCells:HORIZON_CELLS[request.scale]*1.25}));label="Landforms (geomorphons)"}
    else if(product==="drainage"){result=T.drainage(grid,width,height,options);label="Drainage network"}
    else if(product==="wetness"){result=T.wetness(grid,width,height,options);label="Topographic wetness index"}
    else if(product==="depressions"){result=T.depressions(grid,width,height,options);label="Depressions"}
    else if(product==="avalanche"){result=T.avalancheSlope(grid,width,height,options);label="Avalanche slope angle"}
    else if(product==="solar"){delete options.radiusCells;result=T.solarExposure(grid,width,height,options);label="Sun exposure"}
    else{result=T.windExposure(grid,width,height,Object.assign(options,{searchMetres:WIND_METRES[request.scale]}));label="Wind exposure"}
    var notice=result.metadata.caution?{warning:result.metadata.caution}:null;
    return {data:result.data,secondary:result.secondary||null,width:width,height:height,label:label,metadata:result.metadata,notice:notice};
  }

  function run(input){
    var request=validate(input);validateElevations(request.grid);
    if(TERRAIN_PRODUCTS.indexOf(request.product)>=0) return runTerrain(request);
    if(!G) throw new Error("CSPGlacialResearch is not loaded");
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
    }else if(product==="moraine"){
      if(!M) throw new Error("CSPGlacialMoraineAnalysis is not loaded");
      if(!Z||!ZF||!B) throw new Error("Glacial belt analysis dependencies are not loaded");
      result=M.analyzeMoraineCandidates(grid,width,height,options);
      data=result.score;
      notice=Object.freeze(Object.assign({},result.metadata.screeningNotice,{
        id:"glacial-moraine-leads-beta-v3",beta:true,
        interpretation:"Experimental leads based on moraine-like ridges and hummocky belts; terrain shape does not establish glacial origin.",
        warning:"Beta: experimental terrain-shape leads. Landslides and other look-alikes can appear. Compare with Glacial margin and check mapped geology or field evidence."
      }));
      result.metadata=Object.assign({},result.metadata,{beta:true,screeningNotice:notice});
      label="Moraine leads (Beta)";
    }else if(product==="flood"){
      result=G.scoreFloodChannelCandidates(grid,width,height,Object.assign({},options,{radiusCells:radius}));
      data=result.score;notice=result.metadata.screeningNotice;label="Possible flood-channel morphology";
    }
    return {data:data,secondary:secondary,width:width,height:height,label:label,metadata:result.metadata,notice:notice};
  }

  return Object.freeze({...contract,run});
});
