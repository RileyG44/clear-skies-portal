/* Browser-direct USGS elevation and truthful rendered-source summaries. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.CSPPublicTerrain=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const SERVICE='https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer';
  const SOURCES=Object.freeze({
    1:{label:'AWS global terrain (overview)',url:'https://registry.opendata.aws/terrain-tiles/'},
    2:{label:'USGS 3DEP elevation',url:SERVICE},
    3:{label:'USGS 1 m DEM',url:'https://www.usgs.gov/3d-elevation-program'},
    4:{label:'WA DNR published LiDAR hillshade',url:'https://lidarportal.dnr.wa.gov/'}
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
    const counts={};let total=0,ready=0,refining=false,failed=false;
    for(const tile of tiles){
      if(tile.current===false)continue;total++;
      const el=tile.el;if(!el?._cspHasContent)continue;
      ready++;refining||=!!el._cspRefining;failed||=!!el._cspRefineFailed;
      for(const [rank,count] of Object.entries(el._cspSourceCounts||{})) if(SOURCES[rank]&&count>0)counts[rank]=(counts[rank]||0)+count;
    }
    const pixels=Object.values(counts).reduce((a,b)=>a+b,0);
    const sources=Object.keys(counts).sort((a,b)=>b-a).map(rank=>({...SOURCES[rank],rank:+rank,pixels:counts[rank],percent:100*counts[rank]/pixels}));
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
