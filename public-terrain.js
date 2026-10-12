/* Browser-direct USGS elevation and truthful rendered-source summaries. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.CSPPublicTerrain=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const SERVICE='https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer';
  const SOURCES=Object.freeze({
    1:{label:'AWS global terrain (overview)',url:'https://registry.opendata.aws/terrain-tiles/',nativeLabel:'~98 ft source spacing (1 arc-second overview)'},
    2:{label:'USGS 3DEP elevation',url:SERVICE,nativeLabel:'Provider mosaic varies; 3.3 ft where available'},
    3:{label:'USGS 3.3 ft DEM',url:'https://www.usgs.gov/3d-elevation-program',nativeLabel:'3.3 ft where the selected survey covers this point'},
    4:{label:'WA DNR published LiDAR hillshade',url:'https://lidarportal.dnr.wa.gov/',nativeLabel:'Project-native spacing varies; published hillshade'},
    5:{label:'WA DNR bare-earth elevation',url:'https://lidarportal.dnr.wa.gov/',nativeLabel:'Numeric DTM; survey spacing varies'}
  });
  function nationalUrl(coords,size=256){
    const {z,x,y}=coords,n=2**z,r=20037508.342789244;
    if(!Number.isInteger(z)||z<0||z>18||!Number.isInteger(x)||!Number.isInteger(y)||y<0||y>=n) throw new RangeError('Invalid elevation tile');
    const wx=((x%n)+n)%n,span=2*r/n,left=-r+wx*span,top=r-y*span;
    return SERVICE+'/exportImage?'+new URLSearchParams({
      bbox:[left,top-span,left+span,top].join(','),bboxSR:'3857',imageSR:'3857',
      size:`${size},${size}`,format:'lerc',pixelType:'F32',f:'image',lercVersion:'2',
      compressionTolerance:'0.01',interpolation:'RSP_BilinearInterpolation',
      renderingRule:JSON.stringify({rasterFunction:'None'})
    });
  }
  function decode(block){
    const {width,height,pixels,mask,bandMasks}=block||{},band=pixels?.[0];
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>1024||height>1024||pixels?.length!==1||band?.length!==width*height) throw new Error('Expected a single-band elevation raster');
    const grid=new Float32Array(width*height);let valid=0;
    for(let i=0;i<grid.length;i++){
      const value=band[i];
      const ok=(!mask||mask[i])&&(!bandMasks?.[0]||bandMasks[0][i])&&Number.isFinite(value)&&value>-20000&&value<100000;
      grid[i]=ok?value:NaN;if(ok)valid++;
    }
    return valid?{grid,width,height}:null;
  }
  function summarize(tiles){
    const counts={},resolutionSums={},nativeSpacings={},surveys={};let total=0,ready=0,refining=false,failed=false;
    for(const tile of tiles){
      if(tile.current===false)continue;total++;
      const el=tile.el;if(!el?._cspHasContent)continue;
      ready++;refining||=!!el._cspRefining;failed||=!!el._cspRefineFailed;
      for(const [rank,count] of Object.entries(el._cspSourceCounts||{})) if(SOURCES[rank]&&count>0){
        counts[rank]=(counts[rank]||0)+count;
        const meters=Number(el._cspSourceResolution?.[rank]);
        if(Number.isFinite(meters)&&meters>0)resolutionSums[rank]=(resolutionSums[rank]||0)+count*meters;
        for(const source of el._cspSurveySources?.[rank]||[]){
          if(Number.isFinite(source.nativeMeters))(nativeSpacings[rank]||=new Set()).add(+source.nativeMeters.toFixed(4));
          if(source.project)(surveys[rank]||=new Map()).set(`${source.datasetId}:${source.project}`,{project:source.project,datasetId:source.datasetId,
            ...(source.verticalUnitBasis?{verticalUnitBasis:source.verticalUnitBasis,metadataDatasetId:source.metadataDatasetId}:{})});
        }
      }
    }
    const pixels=Object.values(counts).reduce((a,b)=>a+b,0);
    const sources=Object.keys(counts).sort((a,b)=>b-a).map(rank=>{
      const spacing=[...(nativeSpacings[rank]||[])].sort((a,b)=>a-b);
      return {...SOURCES[rank],rank:+rank,pixels:counts[rank],percent:100*counts[rank]/pixels,
        sampleMeters:resolutionSums[rank]?resolutionSums[rank]/counts[rank]:null,
        surveys:[...(surveys[rank]?.values()||[])],
        ...(spacing.length?{nativeLabel:`${spacing.map(v=>`${+(v/0.3048).toFixed(2)} ft`).join(' / ')} survey spacing`}:{})};
    });
    return {total,ready,refining,failed,sources,coverage:total?Math.round(100*ready/total):0};
  }
  function identifyUrl(lat,lng,zoom){
    return SERVICE+'/identify?'+new URLSearchParams({
      f:'json',geometry:JSON.stringify({x:lng,y:lat,spatialReference:{wkid:4326}}),geometryType:'esriGeometryPoint',
      pixelSize:JSON.stringify({x:156543.03392804097/2**Math.min(18,zoom),y:156543.03392804097/2**Math.min(18,zoom),spatialReference:{wkid:3857}}),
      renderingRule:JSON.stringify({rasterFunction:'None'}),returnCatalogItems:'true',returnGeometry:'false',maxItemCount:'12'
    });
  }
  return {SERVICE,SOURCES,nationalUrl,decode,summarize,identifyUrl};
});
