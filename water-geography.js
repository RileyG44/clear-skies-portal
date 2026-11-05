/* Display-only land/ocean/inland-water geography shared by sampling, 2D and 3D.
 * Natural Earth's generalized shoreline includes marine bays. Inland lakes and
 * basins retain the terrain palette, including below-sea-level inland seas.
 * Narrow coastlines remain limited by the display mask's cell spacing.
 * Never infer water from negative elevation.
 * No network request, elevation mutation, or new scientific source is involved. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./water-geography-data.js'));
  else root.CSPWaterGeography=factory(root.CSPWaterGeographyData);
})(typeof globalThis!=='undefined'?globalThis:this,function(encoded){
  'use strict';
  const WIDTH=16384,HEIGHT=8192,STRIDE=WIDTH/8,BYTES=STRIDE*HEIGHT*2;
  let packed=null,decoder=null;
  const clock=()=>typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
  /* Decode for at most budgetMs; true once the mask is complete. Lets the
     GPU start-up prepare the mask in slices instead of one long task. */
  function decodeStep(budgetMs){
    if(packed)return true;
    // The base64 decode and the buffer each take a step of their own.
    if(!decoder){decoder={raw:typeof atob==='function'?atob(encoded):Buffer.from(encoded,'base64').toString('binary'),result:null,i:0,offset:0};if(budgetMs!==Infinity)return false}
    if(!decoder.result){decoder.result=new Uint16Array(STRIDE*HEIGHT);if(budgetMs!==Infinity)return false}
    const {raw,result}=decoder,end=clock()+budgetMs;let {i,offset}=decoder,runs=0;
    while(i<raw.length){
      const value=raw.charCodeAt(i++)|(raw.charCodeAt(i++)<<8);let count=0,shift=0,part;
      do{part=raw.charCodeAt(i++);count+=(part&127)*2**shift;shift+=7}while(part&128);
      result.fill(value,offset,offset+count);offset+=count;
      if((++runs&1023)===0&&clock()>end)break;
    }
    decoder.i=i;decoder.offset=offset;
    if(i<raw.length)return false;
    decoder=null;
    if(offset!==result.length)throw new Error('Invalid bundled water geography');
    packed=result;return true;
  }
  function bytes(){
    while(!decodeStep(Infinity));
    return packed;
  }
  // 0: dry land, 1: ocean, 2: inland water. Heights never determine class.
  function classAt(lon,lat){
    if(!Number.isFinite(lon)||!Number.isFinite(lat)||lat < -90||lat > 90)return 0;
    const x=Math.min(WIDTH-1,Math.floor(((lon+180)%360+360)%360/360*WIDTH));
    const y=Math.min(HEIGHT-1,Math.floor((90-lat)/180*HEIGHT));
    return (bytes()[((y>>2)*STRIDE+(x>>3))*4+(y&3)] >> (14-2*(x&7))) & 3;
  }
  // Legacy boolean API selects the ocean scale only. Use classAt for all water.
  const waterAt=(lon,lat)=>classAt(lon,lat)===1;
  function classAtMercator(x,y){
    return classAt(x*360-180,Math.atan(Math.sinh(Math.PI*(1-2*y)))*180/Math.PI);
  }
  function waterAtMercator(x,y){
    return waterAt(x*360-180,Math.atan(Math.sinh(Math.PI*(1-2*y)))*180/Math.PI);
  }
  const ROWS=HEIGHT/4;
  function allocate(gl,empty=false){
    const texture=gl.createTexture();
    if(!texture)throw new Error('Water geography allocation failed');
    try{
      gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.texStorage2D(gl.TEXTURE_2D,1,gl.RGBA16UI,empty?1:STRIDE,empty?1:ROWS);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      if(empty)gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,1,1,gl.RGBA_INTEGER,gl.UNSIGNED_SHORT,new Uint16Array(4));
      return texture;
    }catch(error){gl.deleteTexture(texture);throw error}
  }
  // Texture rows [y, y+count) of the packed mask (ROWS texture rows in all).
  function uploadRows(gl,texture,y,count){
    gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.texSubImage2D(gl.TEXTURE_2D,0,0,y,STRIDE,count,gl.RGBA_INTEGER,gl.UNSIGNED_SHORT,bytes().subarray(y*STRIDE*4,(y+count)*STRIDE*4));
  }
  function upload(gl){
    const texture=allocate(gl);
    try{uploadRows(gl,texture,0,ROWS);return texture}catch(error){gl.deleteTexture(texture);throw error}
  }
  return Object.freeze({WIDTH,HEIGHT,ROWS,BYTES,bytes,decodeStep,classAt,classAtMercator,waterAt,waterAtMercator,allocate,uploadRows,upload});
});
