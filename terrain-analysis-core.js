/* Clear Skies Portal — lidar surface analysis toolkit.
 *
 * Dependency-free ports of the terrain products the high-end lidar and GIS
 * packages are known for, sized for one viewport DEM (≤1024² cells):
 *
 *   Relief Visualization Toolbox (ZRC SAZU): sky-view factor, positive and
 *     negative openness (Yokoyama et al. 2002), red relief image map inputs
 *     (Chiba et al. 2008).
 *   GRASS r.geomorphon: ten-class landform patterns (Jasiewicz & Stepinski
 *     2013).
 *   SAGA / WhiteboxTools hydrology: priority-flood depression filling
 *     (Barnes et al. 2014), multiple-flow accumulation, Freeman multiple-flow
 *     topographic wetness index, depth in sink.
 *   ArcGIS Area Solar Radiation / r.sun: clear-sky daily insolation with
 *     terrain cast shadows from per-sector horizon angles.
 *   Snow science: avalanche slope angle and the Winstral et al. (2002)
 *     maximum upwind slope (Sx) wind shelter / exposure index.
 *
 * Grids are row-major, row 0 is north, NaN is no-data, cellSize is metres.
 * Every function returns {data, secondary?, metadata} with Float32 rasters
 * the same size as the input so research-analysis.js can frame them. */
(function(root,factory){
  "use strict";
  const api=factory();
  if(typeof module==="object"&&module.exports) module.exports=api;
  if(root) root.CSPTerrainAnalysis=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";

  const D2R=Math.PI/180,R2D=180/Math.PI;
  /* Neighbour order: N, NE, E, SE, S, SW, W, NW. */
  const NX=[0,1,1,1,0,-1,-1,-1],NY=[-1,-1,0,1,1,1,0,-1];
  const ND=[1,Math.SQRT2,1,Math.SQRT2,1,Math.SQRT2,1,Math.SQRT2];

  function checkGrid(grid,width,height,options){
    if(!grid||typeof grid.length!=="number"||grid.length!==width*height) throw new RangeError("grid length must equal width times height");
    const cell=Number(options&&options.cellSize);
    if(!Number.isFinite(cell)||cell<=0) throw new RangeError("cellSize must be a positive number of metres");
    return cell;
  }
  function intOption(options,key,fallback,min,max){
    const value=Number(options&&options[key]);
    return Number.isFinite(value)?Math.max(min,Math.min(max,Math.round(value))):fallback;
  }

  /* Horn gradient with clamped edges. dzdx rises east, dzdy rises south. A
     cell whose window touches no-data borrows its own height for that tap so
     survey edges stay painted instead of fraying. */
  function gradients(grid,width,height,cell){
    const n=width*height,gx=new Float32Array(n),gy=new Float32Array(n);
    for(let y=0;y<height;y++){
      const yn=y>0?y-1:0,ys=y<height-1?y+1:y;
      for(let x=0;x<width;x++){
        const i=y*width+x,z=grid[i];
        if(z!==z){gx[i]=NaN;gy[i]=NaN;continue}
        const xw=x>0?x-1:0,xe=x<width-1?x+1:x;
        const at=(xx,yy)=>{const v=grid[yy*width+xx];return v===v?v:z};
        const a=at(xw,yn),b=at(x,yn),c=at(xe,yn),d=at(xw,y),f=at(xe,y),g=at(xw,ys),h=at(x,ys),k=at(xe,ys);
        gx[i]=((c+2*f+k)-(a+2*d+g))/(8*cell);
        gy[i]=((g+2*h+k)-(a+2*b+c))/(8*cell);
      }
    }
    return {gx,gy};
  }
  function slopeDegreesGrid(grid,width,height,cell,grads){
    const {gx,gy}=grads||gradients(grid,width,height,cell),out=new Float32Array(width*height);
    for(let i=0;i<out.length;i++) out[i]=gx[i]===gx[i]?Math.atan(Math.hypot(gx[i],gy[i]))*R2D:NaN;
    return out;
  }

  /* Sample distances for a horizon search: every cell close in, then about
     12% apart, so a 300-cell search costs ~50 lookups instead of 300. */
  function scanDistances(maxCells){
    const steps=[];let d=1;
    while(d<=maxCells){steps.push(d);d=Math.max(d+1,Math.round(d*1.12))}
    return steps;
  }
  function rayOffsets(azimuthDeg,maxCells,cell,width){
    const sx=Math.sin(azimuthDeg*D2R),sy=-Math.cos(azimuthDeg*D2R);
    const ox=[],oy=[],dist=[],delta=[];let lastX=0,lastY=0;
    for(const d of scanDistances(maxCells)){
      const x=Math.round(sx*d),y=Math.round(sy*d);
      if(x===lastX&&y===lastY) continue;
      lastX=x;lastY=y;ox.push(x);oy.push(y);dist.push(Math.hypot(x,y)*cell);delta.push(y*width+x);
    }
    return {ox:Int32Array.from(ox),oy:Int32Array.from(oy),dist:Float64Array.from(dist),delta:Int32Array.from(delta)};
  }

  /* Steepest rise (max) and steepest fall (min) tangent along one ray. A ray
     that leaves the grid before its first sample reports NaN. */
  function scanRay(grid,width,height,x,y,z,ray,out){
    let best=-Infinity,worst=Infinity;const base=y*width+x;
    for(let s=0;s<ray.ox.length;s++){
      const xx=x+ray.ox[s],yy=y+ray.oy[s];
      if(xx<0||yy<0||xx>=width||yy>=height) break;
      const v=grid[base+ray.delta[s]];if(v!==v) continue;
      const t=(v-z)/ray.dist[s];
      if(t>best) best=t;
      if(t<worst) worst=t;
    }
    out[0]=best===-Infinity?NaN:best;out[1]=worst===Infinity?NaN:worst;
  }

  function directions(count){ return Array.from({length:count},(_,k)=>k*360/count) }

  /* Sky-view factor (Zakšek et al. 2011, as in RVT): the share of the upper
     hemisphere visible from each cell, 1 on an open plain, toward 0 in a slot
     canyon. Positive openness / negative openness (Yokoyama 2002): mean
     zenith / nadir angle over eight directions, in degrees. One pass fills
     all three so the red relief map can reuse it. */
  function horizonProducts(grid,width,height,options,want){
    const cell=checkGrid(grid,width,height,options);
    const radius=intOption(options,"radiusCells",20,2,400);
    const count=want.svf?16:8,rays=directions(count).map(a=>rayOffsets(a,radius,cell,width));
    const n=width*height,svf=want.svf?new Float32Array(n):null;
    const pos=want.openness?new Float32Array(n):null,neg=want.openness?new Float32Array(n):null;
    const scan=new Float64Array(2);
    for(let y=0;y<height;y++) for(let x=0;x<width;x++){
      const i=y*width+x,z=grid[i];
      if(z!==z){if(svf)svf[i]=NaN;if(pos){pos[i]=NaN;neg[i]=NaN}continue}
      let skySum=0,posSum=0,negSum=0,used=0;
      for(let k=0;k<count;k++){
        scanRay(grid,width,height,x,y,z,rays[k],scan);
        if(scan[0]!==scan[0]) continue;
        used++;
        const up=Math.atan(scan[0]),down=Math.atan(scan[1]);
        if(svf) skySum+=Math.sin(Math.max(0,up));
        if(pos){posSum+=90-up*R2D;negSum+=90+down*R2D}
      }
      if(!used){if(svf)svf[i]=NaN;if(pos){pos[i]=NaN;neg[i]=NaN}continue}
      if(svf) svf[i]=1-skySum/used;
      if(pos){pos[i]=posSum/used;neg[i]=negSum/used}
    }
    return {svf,pos,neg,radius,cell};
  }

  function skyViewFactor(grid,width,height,options){
    const r=horizonProducts(grid,width,height,options,{svf:true});
    return {data:r.svf,metadata:{kind:"sky-view-factor",unit:"fraction",radiusCells:r.radius,radiusMetres:r.radius*r.cell,directions:16,method:"RVT sky-view factor"}};
  }
  function openness(grid,width,height,options){
    const r=horizonProducts(grid,width,height,options,{openness:true});
    const negative=options&&options.sign==="negative";
    return {data:negative?r.neg:r.pos,metadata:{kind:negative?"negative-openness":"positive-openness",unit:"degrees",
      radiusCells:r.radius,radiusMetres:r.radius*r.cell,directions:8,method:"Yokoyama openness"}};
  }
  /* Red relief image map (Chiba 2008): lightness from differential openness
     (positive − negative)/2, red saturation from slope. data carries the
     differential openness, secondary the slope in degrees. */
  function redRelief(grid,width,height,options){
    const r=horizonProducts(grid,width,height,options,{openness:true});
    const slope=slopeDegreesGrid(grid,width,height,r.cell),diff=new Float32Array(width*height);
    for(let i=0;i<diff.length;i++) diff[i]=(r.pos[i]-r.neg[i])/2;
    return {data:diff,secondary:slope,metadata:{kind:"red-relief-image-map",unit:"degrees",radiusCells:r.radius,
      radiusMetres:r.radius*r.cell,method:"Chiba red relief image map"}};
  }

  /* Geomorphons. GRASS r.geomorphon lookup: rows count lower directions,
     columns count higher directions. */
  const GEOMORPHON_CLASSES=Object.freeze(["","Flat","Peak","Ridge","Shoulder","Spur","Slope","Hollow","Footslope","Valley","Pit"]);
  const FL=1,PK=2,RI=3,SH=4,SP=5,SL=6,HL=7,FS=8,VL=9,PT=10;
  const GEOMORPHON_TABLE=[
    [FL,FL,FL,FS,FS,VL,VL,VL,PT],
    [FL,FL,FS,FS,FS,VL,VL,VL,0],
    [FL,SH,SL,SL,HL,HL,VL,0,0],
    [SH,SH,SL,SL,SL,HL,0,0,0],
    [SH,SH,SP,SL,SL,0,0,0,0],
    [RI,RI,SP,SP,0,0,0,0,0],
    [RI,RI,RI,0,0,0,0,0,0],
    [RI,RI,0,0,0,0,0,0,0],
    [PK,0,0,0,0,0,0,0,0]
  ];
  function geomorphonClass(lower,higher){ return GEOMORPHON_TABLE[lower][higher]||SL }
  function geomorphons(grid,width,height,options){
    const cell=checkGrid(grid,width,height,options);
    const radius=intOption(options,"radiusCells",20,2,400);
    const flat=Math.tan((Number.isFinite(+(options&&options.flatDegrees))?+options.flatDegrees:1)*D2R);
    const rays=directions(8).map(a=>rayOffsets(a,radius,cell,width));
    const out=new Float32Array(width*height),scan=new Float64Array(2),counts=new Uint32Array(11);
    for(let y=0;y<height;y++) for(let x=0;x<width;x++){
      const i=y*width+x,z=grid[i];
      if(z!==z){out[i]=NaN;continue}
      let higher=0,lower=0;
      for(let k=0;k<8;k++){
        scanRay(grid,width,height,x,y,z,rays[k],scan);
        if(scan[0]!==scan[0]) continue;
        const up=Math.max(0,scan[0]),down=Math.max(0,-scan[1]);
        if(up-down>flat) higher++;
        else if(down-up>flat) lower++;
      }
      const form=geomorphonClass(lower,higher);out[i]=form;counts[form]++;
    }
    const total=counts.reduce((a,b)=>a+b,0)||1;
    const shares={};for(let c=1;c<=10;c++) shares[GEOMORPHON_CLASSES[c]]=+(counts[c]/total).toFixed(4);
    return {data:out,metadata:{kind:"geomorphons",unit:"class",classes:GEOMORPHON_CLASSES.slice(1),shares,
      radiusCells:radius,radiusMetres:radius*cell,flatDegrees:Math.atan(flat)*R2D,method:"Jasiewicz & Stepinski geomorphons"}};
  }

  /* ---------------------------------------------------------- hydrology */
  /* Min-heap of cell indices keyed by a Float64 elevation array. */
  function heap(keys,capacity){
    const items=new Int32Array(capacity);let size=0;
    return {
      get size(){return size},
      push(index){
        let at=size++;items[at]=index;const key=keys[index];
        while(at>0){const parent=(at-1)>>1;if(keys[items[parent]]<=key) break;items[at]=items[parent];at=parent}
        items[at]=index;
      },
      pop(){
        const top=items[0],last=items[--size];
        if(size>0){
          let at=0;const key=keys[last];
          for(;;){
            let child=2*at+1;if(child>=size) break;
            if(child+1<size&&keys[items[child+1]]<keys[items[child]]) child++;
            if(keys[items[child]]>=key) break;
            items[at]=items[child];at=child;
          }
          items[at]=last;
        }
        return top;
      }
    };
  }

  /* Priority-flood (Barnes 2014). Cells on the grid edge or beside no-data
     drain out. With epsilon > 0 flats receive a tiny gradient toward their
     outlet so every interior cell has a strictly lower neighbour. Returns the
     filled surface and the pop order, which is ascending filled height and
     so is a valid downstream-first processing order. */
  function priorityFlood(grid,width,height,epsilon){
    const n=width*height,filled=new Float64Array(n),closed=new Uint8Array(n),order=new Int32Array(n),queue=heap(filled,n);
    let popped=0;
    for(let y=0;y<height;y++) for(let x=0;x<width;x++){
      const i=y*width+x,z=grid[i];
      if(z!==z){filled[i]=NaN;closed[i]=1;continue}
      filled[i]=z;
      let edge=x===0||y===0||x===width-1||y===height-1;
      for(let k=0;!edge&&k<8;k++){const v=grid[(y+NY[k])*width+x+NX[k]];if(v!==v) edge=true}
      if(edge){closed[i]=1;queue.push(i)}
    }
    while(queue.size){
      const c=queue.pop();order[popped++]=c;
      const cx=c%width,cy=(c-cx)/width,base=filled[c];
      for(let k=0;k<8;k++){
        const x=cx+NX[k],y=cy+NY[k];
        if(x<0||y<0||x>=width||y>=height) continue;
        const nb=y*width+x;if(closed[nb]) continue;
        closed[nb]=1;
        const floor=epsilon>0?base+epsilon*ND[k]:base;
        if(filled[nb]<floor) filled[nb]=floor;
        queue.push(nb);
      }
    }
    return {filled,order:order.subarray(0,popped)};
  }

  /* Depth in sink (WhiteboxTools DepthInSink): closed basins such as
     kettles, sinkholes, ponds and quarry floors, in metres. */
  function depressions(grid,width,height,options){
    checkGrid(grid,width,height,options);
    const {filled}=priorityFlood(grid,width,height,0),out=new Float32Array(width*height);
    let cells=0,deepest=0;
    for(let i=0;i<out.length;i++){
      const z=grid[i];if(z!==z){out[i]=NaN;continue}
      const depth=filled[i]-z;out[i]=depth>0.005?depth:0;
      if(out[i]>0){cells++;if(depth>deepest)deepest=depth}
    }
    return {data:out,metadata:{kind:"depth-in-sink",unit:"m",sinkCells:cells,maxDepth:deepest,method:"Priority-flood depth in sink"}};
  }

  function flowEpsilon(grid){
    let max=0;for(let i=0;i<grid.length;i++){const v=Math.abs(grid[i]);if(v===v&&v>max)max=v}
    return Math.max(1e-7,max*4e-12);
  }

  /* Freeman (1991) multiple-flow accumulation with Quinn contour lengths, in
     cells. Exponent 1.1 spreads flow for wetness; a high exponent behaves
     like D-infinity: it follows the true steepest direction across planar
     facets instead of the grid-aligned straight runs D8 draws on them. */
  function multipleFlowAccumulation(filled,order,width,height,cell,exponent){
    const n=width*height,acc=new Float64Array(n),weights=new Float64Array(8);
    const contour=[0.5,0.354,0.5,0.354,0.5,0.354,0.5,0.354];
    for(let i=0;i<n;i++) acc[i]=filled[i]===filled[i]?1:0;
    for(let o=order.length-1;o>=0;o--){
      const c=order[o],cx=c%width,cy=(c-cx)/width,z=filled[c];let total=0;
      for(let k=0;k<8;k++){
        weights[k]=0;
        const x=cx+NX[k],y=cy+NY[k];if(x<0||y<0||x>=width||y>=height) continue;
        const v=filled[y*width+x];if(v!==v||v>=z) continue;
        weights[k]=Math.pow((z-v)/(ND[k]*cell),exponent)*contour[k];total+=weights[k];
      }
      if(!(total>0)) continue;
      for(let k=0;k<8;k++) if(weights[k]>0) acc[(cy+NY[k])*width+cx+NX[k]]+=acc[c]*weights[k]/total;
    }
    return acc;
  }

  /* Contributing area in square metres. Upslope area beyond the viewport is
     unknown, so main stems that enter the view are underestimated. */
  function drainage(grid,width,height,options){
    const cell=checkGrid(grid,width,height,options);
    const {filled,order}=priorityFlood(grid,width,height,flowEpsilon(grid));
    const n=width*height,acc=multipleFlowAccumulation(filled,order,width,height,cell,8);
    const out=new Float32Array(n),area=cell*cell;let peak=0;
    for(let i=0;i<n;i++){out[i]=filled[i]===filled[i]?acc[i]*area:NaN;if(out[i]>peak)peak=out[i]}
    /* The view edge is an outlet, so flow piles up running along it. Blank a
       two-cell frame rather than draw those artificial edge streams. */
    for(let y=0;y<height;y++) for(let x=0;x<width;x++)
      if(x<2||y<2||x>=width-2||y>=height-2) out[y*width+x]=NaN;
    return {data:out,metadata:{kind:"flow-accumulation",unit:"m2",maxArea:peak,cellArea:area,method:"Priority-flood + steep multiple flow direction",
      caution:"Only drainage inside this view is counted, so streams that enter from outside it start small."}};
  }

  /* Topographic wetness index ln(a / tan β) with Freeman MFD, exponent 1.1. */
  function wetness(grid,width,height,options){
    const cell=checkGrid(grid,width,height,options);
    const {filled,order}=priorityFlood(grid,width,height,flowEpsilon(grid));
    const n=width*height,acc=multipleFlowAccumulation(filled,order,width,height,cell,1.1),{gx,gy}=gradients(grid,width,height,cell);
    const out=new Float32Array(n);
    for(let i=0;i<n;i++){
      if(filled[i]!==filled[i]){out[i]=NaN;continue}
      const tanB=Math.max(0.001,Math.hypot(gx[i],gy[i]));
      out[i]=Math.log(acc[i]*cell/tanB);
    }
    return {data:out,metadata:{kind:"topographic-wetness-index",unit:"index",method:"Freeman MFD wetness index",
      caution:"Only drainage inside this view is counted; wetness along streams entering the view is underestimated."}};
  }

  /* --------------------------------------------------------- snow & sun */
  function avalancheSlope(grid,width,height,options){
    const cell=checkGrid(grid,width,height,options),slope=slopeDegreesGrid(grid,width,height,cell);
    let start=0,total=0;
    for(let i=0;i<slope.length;i++){const s=slope[i];if(s!==s)continue;total++;if(s>=30&&s<=45)start++}
    return {data:slope,metadata:{kind:"avalanche-slope-angle",unit:"degrees",startZoneShare:total?+(start/total).toFixed(4):0,
      method:"Horn slope angle",caution:"Slope angle is one input to avalanche terrain. It does not account for snowpack, weather or terrain traps, and coarse elevation underestimates short steep rolls."}};
  }

  /* Solar geometry (NOAA low-precision). Hours are local solar time. */
  function sunPosition(latitudeDeg,dayOfYear,solarHour){
    const decl=23.44*D2R*Math.sin(2*Math.PI*(284+dayOfYear)/365),lat=latitudeDeg*D2R,hour=(solarHour-12)*15*D2R;
    const sinAlt=Math.sin(lat)*Math.sin(decl)+Math.cos(lat)*Math.cos(decl)*Math.cos(hour);
    const altitude=Math.asin(Math.max(-1,Math.min(1,sinAlt)));
    const cosAz=(Math.sin(decl)-Math.sin(altitude)*Math.sin(lat))/(Math.cos(altitude)*Math.cos(lat)||1e-12);
    let azimuth=Math.acos(Math.max(-1,Math.min(1,cosAz)))*R2D;
    if(hour>0) azimuth=360-azimuth;
    return {altitude:altitude*R2D,azimuth};
  }
  /* Clear-sky beam normal irradiance, W/m²: Kasten–Young air mass with the
     Meinel transmittance. */
  function beamIrradiance(altitudeDeg,dayOfYear){
    if(altitudeDeg<=0) return 0;
    const am=1/(Math.sin(altitudeDeg*D2R)+0.50572*Math.pow(altitudeDeg+6.07995,-1.6364));
    return 1361*(1+0.033*Math.cos(2*Math.PI*dayOfYear/365))*Math.pow(0.7,Math.pow(am,0.678));
  }

  /* Daily clear-sky insolation with cast shadows. Horizon angles are found
     once in 32 sectors out to ~5 km, then every 10 minutes of daylight each
     cell compares the sun's altitude with its interpolated horizon. data is
     kWh/m²/day; secondary is hours of direct sun. */
  function solarExposure(grid,width,height,options){
    const cell=checkGrid(grid,width,height,options);
    const latitude=Math.max(-85,Math.min(85,Number.isFinite(+(options&&options.latitude))?+options.latitude:45));
    const day=intOption(options,"dayOfYear",355,1,366);
    const radius=intOption(options,"radiusCells",Math.ceil(5000/cell),4,320);
    const sectors=32,rays=directions(sectors).map(a=>rayOffsets(a,radius,cell,width));
    const n=width*height,horizon=new Float32Array(sectors*n),scan=new Float64Array(2);
    for(let y=0;y<height;y++) for(let x=0;x<width;x++){
      const i=y*width+x,z=grid[i];if(z!==z) continue;
      for(let k=0;k<sectors;k++){
        scanRay(grid,width,height,x,y,z,rays[k],scan);
        horizon[k*n+i]=scan[0]===scan[0]?Math.max(0,Math.atan(scan[0])*R2D):0;
      }
    }
    const {gx,gy}=gradients(grid,width,height,cell);
    const energy=new Float64Array(n),hours=new Float32Array(n),stepHours=1/6;
    let daylight=0,noonAltitude=-90;
    for(let t=stepHours/2;t<24;t+=stepHours){
      const sun=sunPosition(latitude,day,t);
      if(sun.altitude>noonAltitude) noonAltitude=sun.altitude;
      if(sun.altitude<=0) continue;
      daylight+=stepHours;
      const beam=beamIrradiance(sun.altitude,day),diffuse=0.12*beam*Math.sin(sun.altitude*D2R);
      const sa=Math.sin(sun.altitude*D2R),ca=Math.cos(sun.altitude*D2R),sz=Math.sin(sun.azimuth*D2R),cz=Math.cos(sun.azimuth*D2R);
      const sector=sun.azimuth/(360/sectors),k0=Math.floor(sector)%sectors,k1=(k0+1)%sectors,f=sector-Math.floor(sector);
      for(let i=0;i<n;i++){
        const east=gx[i];if(east!==east) continue;
        const north=-gy[i],norm=Math.sqrt(east*east+north*north+1);
        const cosI=(sa-east*ca*sz-north*ca*cz)/norm;
        let direct=0;
        if(cosI>0){
          const h=horizon[k0*n+i]*(1-f)+horizon[k1*n+i]*f;
          if(sun.altitude>h){direct=beam*cosI;hours[i]+=stepHours}
        }
        energy[i]+=(direct+diffuse*(1+1/norm)/2)*stepHours;
      }
    }
    const out=new Float32Array(n);let peak=0;
    for(let i=0;i<n;i++){
      if(gx[i]!==gx[i]){out[i]=NaN;hours[i]=NaN;continue}
      out[i]=energy[i]/1000;if(out[i]>peak)peak=out[i];
    }
    return {data:out,secondary:hours,metadata:{kind:"clear-sky-insolation",unit:"kWh/m2/day",secondaryUnit:"hours",
      dayOfYear:day,latitude,daylightHours:+daylight.toFixed(2),noonSunAltitude:+noonAltitude.toFixed(1),maxEnergy:peak,
      horizonMetres:radius*cell,method:"Clear-sky beam with horizon cast shadows",
      caution:"Clear-sky estimate. Clouds, forest canopy and terrain beyond the horizon search are not modelled."}};
  }

  /* Winstral maximum upwind slope Sx: mean over a ±15° fan of the steepest
     upwind horizon within dmax. Positive = sheltered, where wind drops snow;
     negative = exposed, where wind scours it. Degrees. */
  function windExposure(grid,width,height,options){
    const cell=checkGrid(grid,width,height,options);
    const from=((intOption(options,"windAzimuth",270,0,359)%360)+360)%360;
    const reach=Math.max(cell*2,Number.isFinite(+(options&&options.searchMetres))?+options.searchMetres:300);
    const radius=Math.max(2,Math.min(300,Math.ceil(reach/cell)));
    const fan=[-15,-7.5,0,7.5,15].map(o=>rayOffsets(from+o,radius,cell,width));
    const out=new Float32Array(width*height),scan=new Float64Array(2);
    for(let y=0;y<height;y++) for(let x=0;x<width;x++){
      const i=y*width+x,z=grid[i];if(z!==z){out[i]=NaN;continue}
      let sum=0,used=0;
      for(const ray of fan){
        scanRay(grid,width,height,x,y,z,ray,scan);
        if(scan[0]!==scan[0]) continue;
        sum+=Math.atan(scan[0])*R2D;used++;
      }
      out[i]=used?sum/used:NaN;
    }
    return {data:out,metadata:{kind:"winstral-sx",unit:"degrees",windFrom:from,searchMetres:radius*cell,
      method:"Winstral maximum upwind slope",
      caution:"Terrain-only wind index. Real loading depends on wind speed, snow supply and vegetation."}};
  }

  return Object.freeze({
    VERSION:1,GEOMORPHON_CLASSES,
    gradients,slopeDegreesGrid,scanDistances,priorityFlood,sunPosition,beamIrradiance,geomorphonClass,
    skyViewFactor,openness,redRelief,geomorphons,depressions,drainage,wetness,avalancheSlope,solarExposure,windExposure
  });
});
