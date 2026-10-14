/* Object-level moraine candidate integration. All verdicts describe morphology
   only; stage 1 retains the glacial core's current mode A defaults and weights. */
(function(root,factory){
  "use strict";
  var api=typeof module==="object"&&module.exports
    ? factory(require("./glacial-research-core.js"),require("./glacial-segment-core.js"),
      require("./glacial-segment-features.js"),require("./glacial-moraine-classifier.js"),
      require("./glacial-zone-core.js"),require("./glacial-zone-features.js"),require("./glacial-belt-classifier.js"))
    : factory(root&&root.CSPGlacialResearch,root&&root.CSPGlacialSegments,
      root&&root.CSPGlacialSegmentFeatures,root&&root.CSPGlacialMoraineClassifier,
      root&&root.CSPGlacialZones,root&&root.CSPGlacialZoneFeatures,root&&root.CSPGlacialBeltClassifier);
  if(typeof module==="object"&&module.exports) module.exports=api;
  if(root) root.CSPGlacialMoraineAnalysis=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(G,S,F,C,Z,ZF,B){
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
    // Belt overrides belong to their own classifier, which has separate keys.
    delete config.belt;
    if(!opts.config||!Object.prototype.hasOwnProperty.call(opts.config,"allowLikely"))
      config.allowLikely=cellMetres<=5;
    var stage1TpiFilter=opts.stage1TpiFilter===undefined?true:opts.stage1TpiFilter;
    if(typeof stage1TpiFilter!=="boolean") throw new TypeError("stage1TpiFilter must be boolean");
    // Pass spacing and units only: do not tune stage-1 radii, weights, or mode.
    var stage1=G.scoreGlacialLobeMarginCandidates(grid,w,h,{
      cellSize:cellMetres,horizontalUnit:"m",verticalUnit:"m",rowAxis:"south",edgePolicy:"shrink"
    });
    var candidates=new Uint8Array(w*h);
    var terrainPosition=stage1.evidence.terrainPosition;
    for(var i=0;i<candidates.length;i++)
      if(Number.isFinite(stage1.score[i])&&stage1.score[i]>=threshold&&
          (!stage1TpiFilter||terrainPosition[i]>0)) candidates[i]=1;
    var objects=S.extractSegments(candidates,w,h,{cellMetres:cellMetres});
    var featureOpts={cellMetres:cellMetres};
    var context=F.createViewContext(grid,w,h,featureOpts);
    // Retain original membership for every object independent of raster winners.
    var entries=objects.map(function(segment){
      var geometryPasses=Number.isFinite(segment.lengthM)&&segment.lengthM>=config.minLengthM&&
        Number.isFinite(segment.elongation)&&segment.elongation>=config.minElongation;
      return {segment:segment,features:geometryPasses?
        F.segmentFeatures(grid,w,h,segment,{cellMetres:cellMetres,context:context}):null};
    });
    var verdicts=C.classifySegments(entries,config);
    var score=new Float32Array(w*h),mask=new Uint8Array(w*h),segmentRaster=new Int32Array(w*h);
    function paint(pixels,id,verdict){
      var supported=verdict==="likely"||verdict==="possible";
      for(var p=0;p<pixels.length;p++){
        var pixel=pixels[p];
        // Closed morphology can bridge missing cells; no-data remains background.
        if(!Number.isFinite(Number(grid[pixel]))) continue;
        // stage1.score may be NaN over no-data; paint 0 there so the
        // returned score raster never carries NaN.
        var unsupportedScore=Number.isFinite(stage1.score[pixel])?stage1.score[pixel]*0.3:0;
        // Compare at raster precision so equal contributions keep the first id.
        var value=Math.fround(verdict==="likely"?1:verdict==="possible"?0.55:unsupportedScore);
        if(!segmentRaster[pixel]||value>score[pixel]){
          segmentRaster[pixel]=id;
          score[pixel]=value;
        }
        if(supported) mask[pixel]=1;
      }
    }
    var segments=objects.map(function(segment,index){
      var verdict=verdicts[index];
      paint(segment.pixels,segment.id,verdict.verdict);
      var published={id:segment.id,objectType:segment.objectType||"ridge",verdict:verdict.verdict,score:verdict.score,bbox:segment.bbox,
        centroid:segment.centroid,lengthM:segment.lengthM,areaM2:segment.areaM2,
        pixelCount:segment.pixelCount,pixels:segment.pixels,evidence:verdict.evidence};
      ["branched","closedLoop","simpleCycle"].forEach(function(key){
        if(Object.prototype.hasOwnProperty.call(segment,key)) published[key]=segment[key];
      });
      return published;
    });
    var belt={zones:0,likely:0,possible:0};
    // Extract the disable boolean before treating config.belt as overrides:
    // config.belt === false disables, an object is classifier overrides.
    var beltDisabled=opts.belt===false||!!(opts.config&&opts.config.belt===false);
    var maxRidgeId=objects.reduce(function(max,segment){return Math.max(max,segment.id||0);},0);
    var beltIdOffset=Math.max(100000,maxRidgeId+1);
    if(!beltDisabled){
      if(!Z||!ZF||!B) throw new Error("Glacial belt analysis dependencies are not loaded");
      var zones=Z.extractZones(candidates,w,h,{cellMetres:cellMetres});
      var zoneEntries=zones.map(function(zone){
        var features=ZF.zoneFeatures(grid,w,h,zone,{
          cellMetres:cellMetres,context:context,stageScore:stage1.score,segments:objects
        });
        var membership=new Set(zone.zonePixels);
        var elongated=Number.isFinite(zone.elongation)&&zone.elongation>=2;
        // Only likely ridges count, and only when both their centroid and
        // at least one ridge pixel lie in the zone. For elongated zones
        // (elongation >= 2) the ridge must also lie within ~30 degrees of
        // the zone's axial orientation.
        features.ridgeSupport=objects.reduce(function(count,segment,index){
          if(verdicts[index].verdict!=="likely") return count;
          var cx=Math.round(segment.centroid[0]),cy=Math.round(segment.centroid[1]);
          if(!(cx>=0&&cx<w&&cy>=0&&cy<h&&membership.has(cy*w+cx))) return count;
          var overlaps=false;
          for(var rp=0;rp<segment.pixels.length;rp++)
            if(membership.has(segment.pixels[rp])){overlaps=true;break;}
          if(!overlaps) return count;
          if(elongated){
            if(!Number.isFinite(segment.orientationRad)||!Number.isFinite(zone.orientationRad)) return count;
            var diff=Math.abs(segment.orientationRad-zone.orientationRad)%Math.PI;
            if(diff>Math.PI/2) diff=Math.PI-diff;
            if(diff>Math.PI/6) return count;
          }
          return count+1;
        },0);
        return {zone:zone,features:features};
      });
      var rawBeltConfig=opts.beltConfig!==undefined?opts.beltConfig:
        (opts.config&&opts.config.belt&&typeof opts.config.belt==="object"?opts.config.belt:
        (opts.belt&&typeof opts.belt==="object"?opts.belt:undefined));
      var beltConfig;
      if(rawBeltConfig==null){
        beltConfig={allowLikely:cellMetres<=5};
      } else if(typeof rawBeltConfig==="object"&&!Array.isArray(rawBeltConfig)){
        beltConfig=Object.assign({},rawBeltConfig);
        // Like the ridge path, likely is off by default on coarse cells
        // unless explicitly set.
        if(!Object.prototype.hasOwnProperty.call(beltConfig,"allowLikely"))
          beltConfig.allowLikely=cellMetres<=5;
      } else {
        beltConfig=rawBeltConfig;
      }
      var beltVerdicts=B.classifyZones(zoneEntries,beltConfig);
      belt.zones=zones.length;
      zones.forEach(function(zone,index){
        var verdict=beltVerdicts[index];
        // Belt ids occupy beltIdOffset + zone.id, clear of every ridge id.
        var id=beltIdOffset+zone.id;
        paint(zone.zonePixels,id,verdict.verdict);
        if(verdict.verdict==="likely"||verdict.verdict==="possible") belt[verdict.verdict]++;
        segments.push({id:id,objectType:"belt",verdict:verdict.verdict,score:verdict.score,
          bbox:zone.bbox,centroid:zone.centroid,areaM2:zone.areaM2,pixelCount:zone.pixelCount,
          // A broad belt has no single crest length; retain the public field.
          lengthM:null,evidence:verdict.evidence,
          pixels:zone.pixels,zonePixels:zone.zonePixels,touchesEdge:zone.touchesEdge});
      });
    }
    var seenIds=new Set();
    for(var si=0;si<segments.length;si++){
      if(seenIds.has(segments[si].id)) throw new Error("Duplicate segment id: "+segments[si].id);
      seenIds.add(segments[si].id);
    }
    return {score:score,mask:mask,segmentRaster:segmentRaster,segments:segments,metadata:Object.assign({},stage1.metadata,{
      kind:"glacial-moraine-object-screen-v2",
      noDataRepresentation:"0 (background)",
      candidateThreshold:threshold,
      stage1TpiFilter:stage1TpiFilter,
      minAreaM2:5000,
      config:config,
      belt:belt,
      beltIdOffset:beltIdOffset,
      stage1:stage1.metadata,
      featureMetadata:F.METADATA,
      rasterValues:{likely:1,possible:0.55,unsupported:"stage-1 score * 0.3",background:0},
      screeningNotice:SCREENING_NOTICE
    })};
  }

  return Object.freeze({analyzeMoraineCandidates:analyzeMoraineCandidates});
});
