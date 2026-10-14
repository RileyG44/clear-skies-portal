/* Object-level moraine candidate integration. All verdicts describe morphology
   only; stage 1 retains the glacial core's current mode A defaults and weights. */
(function(root,factory){
  "use strict";
  var api=typeof module==="object"&&module.exports
    ? factory(require("./glacial-research-core.js"),require("./glacial-segment-core.js"),
      require("./glacial-segment-features.js"),require("./glacial-moraine-classifier.js"))
    : factory(root&&root.CSPGlacialResearch,root&&root.CSPGlacialSegments,
      root&&root.CSPGlacialSegmentFeatures,root&&root.CSPGlacialMoraineClassifier);
  if(typeof module==="object"&&module.exports) module.exports=api;
  if(root) root.CSPGlacialMoraineAnalysis=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(G,S,F,C){
  "use strict";

  var SCREENING_NOTICE=Object.freeze({
    id:"glacial-moraine-object-screen-v2",
    observationalOnly:true,
    diagnostic:false,
    scoreIsProbability:false,
    interpretation:"Likely and possible verdicts rank moraine-like segment morphology using shape, crest prominence, and approximate terrain context; they do not establish glacial origin.",
    cannotDetermine:Object.freeze(["glacial origin","ice limit","age","advance or retreat phase","subsurface continuity"]),
    commonConfounders:Object.freeze(["river terraces","fault scarps","landslides","shorelines","dunes","roads","quarries","DEM seams","modern earthworks"]),
    corroboration:Object.freeze(["surficial geology","stratigraphy","sedimentology","chronology","imagery","field observations"]),
    warning:"Likely and possible describe morphology only, not proof of glaciation. Inspect the evidence and corroborate with mapped geology and field observations."
  });

  function analyzeMoraineCandidates(grid,w,h,opts){
    if(!G||!S||!F||!C) throw new Error("Glacial moraine analysis dependencies are not loaded");
    opts=opts||{};
    var cellMetres=Number(opts.cellSize!==undefined?opts.cellSize:opts.cellMetres!==undefined?opts.cellMetres:1);
    if(!Number.isFinite(cellMetres)||cellMetres<=0) throw new RangeError("cellSize must be a finite number greater than zero");
    var threshold=opts.candidateThreshold===undefined?0.45:Number(opts.candidateThreshold);
    if(!Number.isFinite(threshold)||threshold<0||threshold>1) throw new RangeError("candidateThreshold must be between zero and one");
    if(opts.config!=null&&(typeof opts.config!=="object"||Array.isArray(opts.config)))
      throw new TypeError("config must be an object");
    var config=Object.assign({},C.DEFAULT_CONFIG,opts.config);
    // Pass spacing and units only: do not tune stage-1 radii, weights, or mode.
    var stage1=G.scoreGlacialLobeMarginCandidates(grid,w,h,{
      cellSize:cellMetres,horizontalUnit:"m",verticalUnit:"m",rowAxis:"south",edgePolicy:"shrink"
    });
    var candidates=new Uint8Array(w*h);
    for(var i=0;i<candidates.length;i++)
      if(Number.isFinite(stage1.score[i])&&stage1.score[i]>=threshold) candidates[i]=1;
    var objects=S.extractSegments(candidates,w,h,{cellMetres:cellMetres});
    // Keep each object's pixels for rasterization; publish compact geometry only.
    var entries=objects.map(function(segment){
      return {segment:segment,features:F.segmentFeatures(grid,w,h,segment,{cellMetres:cellMetres})};
    });
    var verdicts=C.classifySegments(entries,config);
    var score=new Float32Array(w*h),mask=new Uint8Array(w*h);
    var segments=objects.map(function(segment,index){
      var verdict=verdicts[index],supported=verdict.verdict==="likely"||verdict.verdict==="possible";
      for(var p=0;p<segment.pixels.length;p++){
        var pixel=segment.pixels[p];
        score[pixel]=verdict.verdict==="likely"?1:verdict.verdict==="possible"?0.55:stage1.score[pixel]*0.3;
        if(supported) mask[pixel]=1;
      }
      return {id:segment.id,verdict:verdict.verdict,score:verdict.score,bbox:segment.bbox,
        centroid:segment.centroid,lengthM:segment.lengthM,areaM2:segment.areaM2,
        pixelCount:segment.pixelCount,evidence:verdict.evidence};
    });
    return {score:score,mask:mask,segments:segments,metadata:Object.assign({},stage1.metadata,{
      kind:"glacial-moraine-object-screen-v2",
      noDataRepresentation:"0 (background)",
      candidateThreshold:threshold,
      minAreaM2:5000,
      config:config,
      stage1:stage1.metadata,
      featureMetadata:F.METADATA,
      rasterValues:{likely:1,possible:0.55,unsupported:"stage-1 score * 0.3",background:0},
      screeningNotice:SCREENING_NOTICE
    })};
  }

  return Object.freeze({analyzeMoraineCandidates:analyzeMoraineCandidates});
});
