/* Display-only land/water geography shared by range sampling, 2D and 3D.
 * Natural Earth's generalized shoreline includes major bays and inland lakes.
 * Narrow coastlines remain limited by the display mask's cell spacing.
 * Never infer water from negative elevation.
 * No network request, elevation mutation, or new scientific source is involved. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./water-geography-data.js'));
  else root.CSPWaterGeography=factory(root.CSPWaterGeographyData);
})(typeof globalThis!=='undefined'?globalThis:this,function(encoded){
  'use strict';
  const WIDTH=16384,HEIGHT=8192,STRIDE=WIDTH/8;
  let packed=null;
  function bytes(){
    if(packed)return packed;
    const raw=typeof atob==='function'?atob(encoded):Buffer.from(encoded,'base64').toString('binary');
    const result=new Uint8Array(STRIDE*HEIGHT);let offset=0;
    for(let i=0;i<raw.length;){
      const value=raw.charCodeAt(i++);let count=0,shift=0,part;
      do{part=raw.charCodeAt(i++);count+=(part&127)*2**shift;shift+=7}while(part&128);
      result.fill(value,offset,offset+count);offset+=count;
    }
    if(offset!==result.length)throw new Error('Invalid bundled water geography');
    return packed=result;
  }
  function waterAt(lon,lat){
    if(!Number.isFinite(lon)||!Number.isFinite(lat)||lat < -90||lat > 90)return false;
    const x=Math.min(WIDTH-1,Math.floor(((lon+180)%360+360)%360/360*WIDTH));
    const y=Math.min(HEIGHT-1,Math.floor((90-lat)/180*HEIGHT));
    return !!(bytes()[((y>>2)*STRIDE+(x>>3))*4+(y&3)]&(128>>(x&7)));
  }
  function waterAtMercator(x,y){
    return waterAt(x*360-180,Math.atan(Math.sinh(Math.PI*(1-2*y)))*180/Math.PI);
  }
  function upload(gl){
    const texture=gl.createTexture();
    if(!texture)throw new Error('Water geography allocation failed');
    try{
      gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.texStorage2D(gl.TEXTURE_2D,1,gl.RGBA8,STRIDE,HEIGHT/4);
      gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,STRIDE,HEIGHT/4,gl.RGBA,gl.UNSIGNED_BYTE,bytes());
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      return texture;
    }catch(error){gl.deleteTexture(texture);throw error}
  }
  return Object.freeze({WIDTH,HEIGHT,bytes,waterAt,waterAtMercator,upload});
});
