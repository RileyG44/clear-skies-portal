/* Display-only land/ocean geography shared by range sampling, 2D and 3D.
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
  const WIDTH=16384,HEIGHT=8192,STRIDE=WIDTH/8;
  let packed=null,decoder=null;
  const clock=()=>typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
  /* Decode for at most budgetMs; true once the mask is complete. Lets the
     GPU start-up prepare the mask in slices instead of one long task. */
  function decodeStep(budgetMs){
    if(packed)return true;
    // The base64 decode and the buffer each take a step of their own.
    if(!decoder){decoder={raw:typeof atob==='function'?atob(encoded):Buffer.from(encoded,'base64').toString('binary'),result:null,i:0,offset:0};if(budgetMs!==Infinity)return false}
    if(!decoder.result){decoder.result=new Uint8Array(STRIDE*HEIGHT);if(budgetMs!==Infinity)return false}
    const {raw,result}=decoder,end=clock()+budgetMs;let {i,offset}=decoder,runs=0;
    while(i<raw.length){
      const value=raw.charCodeAt(i++);let count=0,shift=0,part;
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
  // Legacy API name: true selects the separate ocean scale, not inland water.
  function waterAt(lon,lat){
    if(!Number.isFinite(lon)||!Number.isFinite(lat)||lat < -90||lat > 90)return false;
    const x=Math.min(WIDTH-1,Math.floor(((lon+180)%360+360)%360/360*WIDTH));
    const y=Math.min(HEIGHT-1,Math.floor((90-lat)/180*HEIGHT));
    return !!(bytes()[((y>>2)*STRIDE+(x>>3))*4+(y&3)]&(128>>(x&7)));
  }
  function waterAtMercator(x,y){
    return waterAt(x*360-180,Math.atan(Math.sinh(Math.PI*(1-2*y)))*180/Math.PI);
  }
  const ROWS=HEIGHT/4;
  function allocate(gl){
    const texture=gl.createTexture();
    if(!texture)throw new Error('Water geography allocation failed');
    try{
      gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.texStorage2D(gl.TEXTURE_2D,1,gl.RGBA8,STRIDE,ROWS);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      return texture;
    }catch(error){gl.deleteTexture(texture);throw error}
  }
  // Texture rows [y, y+count) of the packed mask (ROWS texture rows in all).
  function uploadRows(gl,texture,y,count){
    gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.texSubImage2D(gl.TEXTURE_2D,0,0,y,STRIDE,count,gl.RGBA,gl.UNSIGNED_BYTE,bytes().subarray(y*STRIDE*4,(y+count)*STRIDE*4));
  }
  function upload(gl){
    const texture=allocate(gl);
    try{uploadRows(gl,texture,0,ROWS);return texture}catch(error){gl.deleteTexture(texture);throw error}
  }
  return Object.freeze({WIDTH,HEIGHT,ROWS,bytes,decodeStep,waterAt,waterAtMercator,allocate,uploadRows,upload});
});
