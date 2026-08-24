/* Clear Skies Portal — deterministic terrain display rasterizer.
 *
 * This is the browser-safe counterpart to the raw-lidar worker renderer. It
 * accepts either an ordinary width × height elevation tile or the worker's
 * one-pixel-skirt surface, then produces the same stable hillshade, slope,
 * aspect, tint, and contour colours. Keeping this math independent from
 * Leaflet means it is regression-tested and remains the CPU fallback when
 * WebGL is unavailable or recovering from context loss. */
(function(root,factory){
  "use strict";
  if(typeof module==="object"&&module.exports) module.exports=factory(require("./terrain-core.js"));
  else root.CSPTerrainRaster=factory(root.CSPTerrain);
})(typeof globalThis!=="undefined"?globalThis:this,function(terrain){
  "use strict";
  if(!terrain) throw new Error("terrain-core.js must load before terrain-raster.js");

  const D2R=Math.PI/180;
  const NODATA_LIMIT=-1e20;
  const SHADE_315=terrain.createHillshade({azimuth:315,altitude:45,ambient:0.12});
  const SHADE_MULTI=terrain.createMultidirectionalHillshade({altitude:45,ambient:0.12});
  const TINT_OF=terrain.createElevationColorizer("topographic",{space:"linear-rgb"});
  const SLOPE_OF=terrain.createElevationColorizer([
    [0,"#f2f4ee"],[5,"#b1d28b"],[15,"#f6da6f"],[30,"#f09649"],
    [45,"#d54650"],[60,"#762c69"],[90,"#321948"]
  ]);
  const ASPECT_OF=terrain.createElevationColorizer([
    [0,"#4d78c8"],[45,"#3ba5b0"],[90,"#57a765"],[135,"#c9ad4f"],
    [180,"#d96b52"],[225,"#c45b82"],[270,"#8d65bb"],[315,"#5e77c5"],[360,"#4d78c8"]
  ]);
  const ASPECT_FLAT_GRADE=Math.tan(0.5*D2R);
  const CONTOUR_FT={c2:2,c5:5,c10:10,c25:25};
  const MIN_CONTOUR_PX=3;
  const STYLES=Object.freeze(["hs","hsmulti","tint","slope","aspect","northness","c2","c5","c10","c25"]);

  function surfaceInfo(surface){
    if(!surface||!surface.grid) throw new TypeError("surface.grid is required");
    const skirted=Number.isInteger(surface.size)&&Number.isInteger(surface.n)&&surface.n===surface.size+2;
    const width=skirted?surface.size:Number(surface.width||surface.size);
    const height=skirted?surface.size:Number(surface.height||surface.size);
    if(!Number.isInteger(width)||width<=0||!Number.isInteger(height)||height<=0)
      throw new RangeError("surface width and height must be positive integers");
    const stride=skirted?surface.n:width;
    if(surface.grid.length<stride*(skirted?surface.n:height)) throw new RangeError("surface grid is too short");
    const groundRes=Number(surface.groundRes);
    if(!Number.isFinite(groundRes)||groundRes<=0) throw new RangeError("surface.groundRes must be positive");
    return {grid:surface.grid,width,height,stride,skirted,groundRes,noData:surface.noData};
  }

  function valid(value,noData){
    return Number.isFinite(value)&&value>NODATA_LIMIT&&(noData===undefined||!Object.is(value,noData));
  }

  function valueAt(info,x,y){
    if(info.skirted) return info.grid[(y+1)*info.stride+x+1];
    const sx=Math.max(0,Math.min(info.width-1,x)),sy=Math.max(0,Math.min(info.height-1,y));
    return info.grid[sy*info.stride+sx];
  }

  function gradientAt(info,x,y){
    const a=valueAt(info,x-1,y-1),b=valueAt(info,x,y-1),c=valueAt(info,x+1,y-1);
    const d=valueAt(info,x-1,y),f=valueAt(info,x+1,y);
    const g=valueAt(info,x-1,y+1),h=valueAt(info,x,y+1),k=valueAt(info,x+1,y+1);
    if(![a,b,c,d,f,g,h,k].every(value=>valid(value,info.noData))) return null;
    return {dzdx:((c+2*f+k)-(a+2*d+g))/(8*info.groundRes),
            dzdy:((g+2*h+k)-(a+2*b+c))/(8*info.groundRes)};
  }

  function hasData(surface){
    if(!surface||!surface.grid) return false;
    const marker=surface.noData;
    for(let index=0;index<surface.grid.length;index++) if(valid(surface.grid[index],marker)) return true;
    return false;
  }

  function renderRgba(style,surface){
    if(!STYLES.includes(style)) style="hs";
    const info=surfaceInfo(surface),out=new Uint8ClampedArray(info.width*info.height*4);
    for(let y=0;y<info.height;y++) for(let x=0;x<info.width;x++){
      const value=valueAt(info,x,y),offset=(y*info.width+x)*4;
      if(!valid(value,info.noData)) continue;
      const gradient=gradientAt(info,x,y);
      if(!gradient) continue;

      if(Object.prototype.hasOwnProperty.call(CONTOUR_FT,style)){
        const feet=value*3.28084;
        let interval=CONTOUR_FT[style];
        const perPixel=Math.hypot(gradient.dzdx,gradient.dzdy)*info.groundRes*3.28084;
        if(perPixel>0){
          const spacing=interval/perPixel;
          if(spacing<MIN_CONTOUR_PX){
            if(spacing*5>=MIN_CONTOUR_PX) interval*=5;
            else continue;
          }
        }
        const multiple=feet/interval;
        const distance=Math.abs(multiple-Math.round(multiple))*interval;
        const width=Math.max(0.35,Math.min(interval*0.5,perPixel*0.7));
        if(distance>=width) continue;
        const index=Math.round(multiple)%5===0;
        out[offset]=index?120:150;out[offset+1]=index?70:110;out[offset+2]=index?40:80;out[offset+3]=index?255:200;
        continue;
      }

      let colour;
      if(style==="slope") colour=SLOPE_OF(Math.atan(Math.hypot(gradient.dzdx,gradient.dzdy))/D2R);
      else if(style==="aspect"){
        const aspect=terrain.aspectDegrees(gradient,{flatThreshold:ASPECT_FLAT_GRADE});
        if(aspect===null) continue;
        colour=ASPECT_OF(aspect);
      }else if(style==="northness"){
        const aspect=terrain.aspectDegrees(gradient,{flatThreshold:ASPECT_FLAT_GRADE});
        if(aspect===null) continue;
        const northness=Math.cos(aspect*D2R),neutral=[247,243,224],north=[55,137,92],south=[214,82,78];
        const target=northness>=0?north:south,t=Math.abs(northness);
        colour=[Math.round(neutral[0]+(target[0]-neutral[0])*t),
                Math.round(neutral[1]+(target[1]-neutral[1])*t),
                Math.round(neutral[2]+(target[2]-neutral[2])*t),255];
      }else if(style==="tint"){
        const tint=TINT_OF(value),multiplier=0.42+0.58*SHADE_315(gradient.dzdx,gradient.dzdy);
        colour=[Math.round(tint[0]*multiplier),Math.round(tint[1]*multiplier),Math.round(tint[2]*multiplier),255];
      }else{
        const shade=(style==="hsmulti"?SHADE_MULTI:SHADE_315)(gradient.dzdx,gradient.dzdy);
        const byte=Math.round(shade*255);colour=[byte,byte,byte,255];
      }
      out[offset]=colour[0];out[offset+1]=colour[1];out[offset+2]=colour[2];out[offset+3]=colour[3]===undefined?255:colour[3];
    }
    return out;
  }

  return Object.freeze({VERSION:1,STYLES,ASPECT_FLAT_GRADE,CONTOUR_FT,hasData,renderRgba});
});
