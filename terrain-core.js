/* Clear Skies Portal — dependency-free scientific terrain primitives.
   The module is shared by Node workers and browsers. Raster rows are assumed
   to increase toward the south unless rowAxis:"north" is explicitly passed. */
(function(root,factory){
  const api=factory();
  if(typeof module==="object" && module.exports) module.exports=api;
  if(root) root.CSPTerrain=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";

  const DEG_TO_RAD=Math.PI/180;
  const RAD_TO_DEG=180/Math.PI;
  const DEFAULT_FLAT_EPSILON=1e-12;
  const hasOwn=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

  function finiteNumber(value){
    return typeof value==="number" && Number.isFinite(value);
  }

  function positiveNumber(value,name){
    if(!finiteNumber(value) || value<=0) throw new RangeError(`${name} must be a finite number greater than zero`);
    return value;
  }

  function nonNegativeNumber(value,name){
    if(!finiteNumber(value) || value<0) throw new RangeError(`${name} must be a finite non-negative number`);
    return value;
  }

  function optionNumber(options,key,fallback){
    if(!options || !hasOwn(options,key)) return fallback;
    if(!finiteNumber(options[key])) throw new TypeError(`${key} must be a finite number`);
    return options[key];
  }

  function rowAxisOf(options){
    const axis=options&&options.rowAxis||"south";
    if(axis!=="south" && axis!=="north") throw new RangeError('rowAxis must be "south" or "north"');
    return axis;
  }

  function isNoData(value,options){
    if(!finiteNumber(value)) return true;
    if(!options) return false;
    const marker=options.noData;
    if(typeof marker==="function" && marker(value)) return true;
    if(Array.isArray(marker) && marker.some(entry=>Object.is(entry,value))) return true;
    if(marker!==undefined && !Array.isArray(marker) && typeof marker!=="function" && Object.is(marker,value)) return true;
    if(finiteNumber(options.validMin) && value<options.validMin) return true;
    if(finiteNumber(options.validMax) && value>options.validMax) return true;
    return false;
  }

  /* Horn's weighted 3x3 finite difference. dx and dy are positive physical
     sample spacing. dzdy follows raster rows: positive means elevation rises
     toward the bottom of a conventional north-up raster. */
  function hornGradient3x3(values,dx,dy,options){
    positiveNumber(dx,"dx");
    positiveNumber(dy,"dy");
    if(!values || typeof values.length!=="number" || values.length!==9)
      throw new RangeError("Horn gradient requires exactly nine row-major samples");
    const samples=Array.from(values);
    if(samples.some(value=>isNoData(value,options))) return null;
    const dzdx=((samples[2]+2*samples[5]+samples[8])-(samples[0]+2*samples[3]+samples[6]))/(8*dx);
    const dzdy=((samples[6]+2*samples[7]+samples[8])-(samples[0]+2*samples[1]+samples[2]))/(8*dy);
    return {dzdx,dzdy};
  }

  function gridIndex(index,limit,edge){
    if(index>=0 && index<limit) return index;
    if(edge==="clamp") return clamp(index,0,limit-1);
    if(edge==="mirror"){
      if(limit===1) return 0;
      const period=2*(limit-1);
      let reflected=((index%period)+period)%period;
      if(reflected>=limit) reflected=period-reflected;
      return reflected;
    }
    return -1;
  }

  function hornGradientGrid(grid,width,height,x,y,dx,dy,options){
    positiveNumber(dx,"dx");
    positiveNumber(dy,"dy");
    if(!Number.isInteger(width)||width<=0||!Number.isInteger(height)||height<=0)
      throw new RangeError("width and height must be positive integers");
    if(!grid || typeof grid.length!=="number" || grid.length<width*height)
      throw new RangeError("grid does not contain width times height samples");
    if(!Number.isInteger(x)||!Number.isInteger(y)||x<0||x>=width||y<0||y>=height)
      throw new RangeError("x and y must identify a sample inside the grid");
    const edge=options&&options.edge||"nodata";
    if(!["nodata","clamp","mirror"].includes(edge)) throw new RangeError('edge must be "nodata", "clamp", or "mirror"');
    const values=[];
    for(let oy=-1;oy<=1;oy++) for(let ox=-1;ox<=1;ox++){
      const sx=gridIndex(x+ox,width,edge), sy=gridIndex(y+oy,height,edge);
      if(sx<0||sy<0) return null;
      values.push(grid[sy*width+sx]);
    }
    return hornGradient3x3(values,dx,dy,options);
  }

  /* Convenience overloads:
       hornGradient(samples3x3, dx, dy, options)
       hornGradient(grid, width, height, x, y, dx, dy, options) */
  function hornGradient(){
    const args=arguments;
    if(args.length>=7) return hornGradientGrid(args[0],args[1],args[2],args[3],args[4],args[5],args[6],args[7]);
    return hornGradient3x3(args[0],args[1],args[2],args[3]);
  }

  function gradientArguments(first,second,third){
    if(first && typeof first==="object" && !Array.isArray(first) && hasOwn(first,"dzdx"))
      return {dzdx:first.dzdx,dzdy:first.dzdy,options:second||{}};
    return {dzdx:first,dzdy:second,options:third||{}};
  }

  function scaledGradient(first,second,third){
    const parsed=gradientArguments(first,second,third);
    if(!finiteNumber(parsed.dzdx)||!finiteNumber(parsed.dzdy)) return null;
    const zFactor=optionNumber(parsed.options,"zFactor",1);
    nonNegativeNumber(zFactor,"zFactor");
    return {dzdx:parsed.dzdx*zFactor,dzdy:parsed.dzdy*zFactor,options:parsed.options};
  }

  function slopeRadians(first,second,third){
    const gradient=scaledGradient(first,second,third);
    return gradient ? Math.atan(Math.hypot(gradient.dzdx,gradient.dzdy)) : null;
  }

  function slopeDegrees(first,second,third){
    const radians=slopeRadians(first,second,third);
    return radians===null ? null : radians*RAD_TO_DEG;
  }

  function slopePercent(first,second,third){
    const gradient=scaledGradient(first,second,third);
    return gradient ? Math.hypot(gradient.dzdx,gradient.dzdy)*100 : null;
  }

  function slopeMetrics(first,second,third){
    const gradient=scaledGradient(first,second,third);
    if(!gradient) return null;
    const grade=Math.hypot(gradient.dzdx,gradient.dzdy);
    return {radians:Math.atan(grade),degrees:Math.atan(grade)*RAD_TO_DEG,percent:grade*100,grade};
  }

  const CARDINAL_LABELS={
    4:["N","E","S","W"],
    8:["N","NE","E","SE","S","SW","W","NW"],
    16:["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"]
  };

  function normalizeDegrees(degrees){
    return ((degrees%360)+360)%360;
  }

  function cardinalDirection(degrees,points,labels){
    if(!finiteNumber(degrees)) return null;
    const count=points===undefined?8:points;
    const names=labels||CARDINAL_LABELS[count];
    if(!Array.isArray(names)||names.length!==count||![4,8,16].includes(count))
      throw new RangeError("cardinal points must be 4, 8, or 16 with the same number of labels");
    return names[Math.round(normalizeDegrees(degrees)/(360/count))%count];
  }

  function analyzeAspect(first,second,third){
    const parsed=gradientArguments(first,second,third), options=parsed.options;
    const noDataValue=hasOwn(options,"noDataValue")?options.noDataValue:null;
    const noDataLabel=hasOwn(options,"noDataLabel")?options.noDataLabel:null;
    if(!finiteNumber(parsed.dzdx)||!finiteNumber(parsed.dzdy))
      return {degrees:noDataValue,cardinal:noDataLabel,flat:false,noData:true};
    const zFactor=optionNumber(options,"zFactor",1);
    nonNegativeNumber(zFactor,"zFactor");
    const dzdx=parsed.dzdx*zFactor, dzdy=parsed.dzdy*zFactor;
    const flatThreshold=hasOwn(options,"flatThreshold")?nonNegativeNumber(options.flatThreshold,"flatThreshold"):DEFAULT_FLAT_EPSILON;
    if(Math.hypot(dzdx,dzdy)<=flatThreshold){
      return {degrees:hasOwn(options,"flatValue")?options.flatValue:null,
              cardinal:hasOwn(options,"flatLabel")?options.flatLabel:"Flat",flat:true,noData:false};
    }
    /* Convert the raster-row derivative to a north-positive derivative, then
       express the downhill vector as a compass bearing clockwise from north. */
    const dzNorth=rowAxisOf(options)==="south"?-dzdy:dzdy;
    const degrees=normalizeDegrees(Math.atan2(-dzdx,-dzNorth)*RAD_TO_DEG);
    return {degrees,cardinal:cardinalDirection(degrees,options.cardinalPoints,options.cardinalLabels),flat:false,noData:false};
  }

  function aspectDegrees(first,second,third){ return analyzeAspect(first,second,third).degrees; }
  function aspectCardinal(first,second,third){ return analyzeAspect(first,second,third).cardinal; }

  function validatedLighting(options){
    const altitude=optionNumber(options,"altitude",45);
    if(altitude<0||altitude>90) throw new RangeError("altitude must be between 0 and 90 degrees");
    const azimuth=optionNumber(options,"azimuth",315);
    const ambient=optionNumber(options,"ambient",0);
    if(ambient<0||ambient>1) throw new RangeError("ambient must be between zero and one");
    const zFactor=optionNumber(options,"zFactor",1);
    nonNegativeNumber(zFactor,"zFactor");
    return {azimuth:normalizeDegrees(azimuth),altitude,ambient,zFactor,rowAxis:rowAxisOf(options)};
  }

  function directIllumination(dzdx,dzdy,lighting){
    const east=dzdx*lighting.zFactor;
    const north=(lighting.rowAxis==="south"?-dzdy:dzdy)*lighting.zFactor;
    const normalLength=Math.hypot(east,north,1);
    const azimuth=lighting.azimuth*DEG_TO_RAD, altitude=lighting.altitude*DEG_TO_RAD;
    const lightEast=Math.cos(altitude)*Math.sin(azimuth);
    const lightNorth=Math.cos(altitude)*Math.cos(azimuth);
    const lightUp=Math.sin(altitude);
    return clamp((-east*lightEast-north*lightNorth+lightUp)/normalLength,0,1);
  }

  /* Compile invariant lighting once for hot pixel loops.  The scalar helpers
     below remain convenient for probes and tests, while tile renderers avoid
     reparsing the same azimuth, altitude and blend options 65,536 times. */
  function createHillshade(options){
    const lighting=validatedLighting(options||{});
    return function compiledHillshade(dzdx,dzdy){
      if(!finiteNumber(dzdx)||!finiteNumber(dzdy)) return null;
      const direct=directIllumination(dzdx,dzdy,lighting);
      return lighting.ambient+(1-lighting.ambient)*direct;
    };
  }

  function hillshade(first,second,third){
    const parsed=gradientArguments(first,second,third);
    if(!finiteNumber(parsed.dzdx)||!finiteNumber(parsed.dzdy)) return null;
    const lighting=validatedLighting(parsed.options);
    const direct=directIllumination(parsed.dzdx,parsed.dzdy,lighting);
    return lighting.ambient+(1-lighting.ambient)*direct;
  }

  function directionsOf(options){
    if(Array.isArray(options.directions)){
      if(!options.directions.length) throw new RangeError("directions must not be empty");
      return options.directions.map((direction,index)=>{
        if(finiteNumber(direction)) return {azimuth:direction,altitude:optionNumber(options,"altitude",45),weight:null};
        if(!direction||typeof direction!=="object") throw new TypeError(`direction ${index} is invalid`);
        return {azimuth:optionNumber(direction,"azimuth",NaN),
                altitude:hasOwn(direction,"altitude")?optionNumber(direction,"altitude",45):optionNumber(options,"altitude",45),
                weight:hasOwn(direction,"weight")?optionNumber(direction,"weight",1):null};
      });
    }
    /* Mark's multidirectional hillshade, also used by GDAL, samples these four
       northwest-through-north illuminants and weights them by terrain aspect. */
    const azimuths=options.azimuths||[225,270,315,360];
    if(!Array.isArray(azimuths)||!azimuths.length) throw new RangeError("azimuths must be a non-empty array");
    const altitudes=Array.isArray(options.altitudes)?options.altitudes:null;
    const weights=Array.isArray(options.weights)?options.weights:null;
    if(altitudes&&altitudes.length!==azimuths.length) throw new RangeError("altitudes must match azimuths");
    if(weights&&weights.length!==azimuths.length) throw new RangeError("weights must match azimuths");
    return azimuths.map((azimuth,index)=>({azimuth,
      altitude:altitudes?altitudes[index]:optionNumber(options,"altitude",45),
      weight:weights?weights[index]:null}));
  }

  function multidirectionalHillshade(first,second,third){
    const parsed=gradientArguments(first,second,third), options=parsed.options;
    if(!finiteNumber(parsed.dzdx)||!finiteNumber(parsed.dzdy)) return null;
    const base=validatedLighting(options), directions=directionsOf(options);
    const hasExplicitWeights=directions.some(direction=>direction.weight!==null);
    const weighting=options.weighting||(hasExplicitWeights?"explicit":"aspect");
    if(!["aspect","equal","explicit"].includes(weighting))
      throw new RangeError('weighting must be "aspect", "equal", or "explicit"');
    const aspect=analyzeAspect(parsed.dzdx,parsed.dzdy,{rowAxis:base.rowAxis,zFactor:base.zFactor});
    const values=[]; let totalWeight=0;
    for(const direction of directions){
      if(!finiteNumber(direction.azimuth)) throw new TypeError("each azimuth must be finite");
      if(!finiteNumber(direction.altitude)||direction.altitude<0||direction.altitude>90)
        throw new RangeError("each altitude must be between 0 and 90 degrees");
      let weight;
      if(weighting==="equal" || (weighting==="aspect"&&aspect.flat)) weight=1;
      else if(weighting==="aspect") weight=Math.sin((aspect.degrees-normalizeDegrees(direction.azimuth))*DEG_TO_RAD)**2;
      else weight=direction.weight===null?1:direction.weight;
      if(!finiteNumber(weight)||weight<0) throw new RangeError("each weight must be a finite non-negative number");
      if(weight===0) continue;
      const lighting={...base,azimuth:normalizeDegrees(direction.azimuth),altitude:direction.altitude,ambient:0};
      values.push({value:directIllumination(parsed.dzdx,parsed.dzdy,lighting),weight});
      totalWeight+=weight;
    }
    if(totalWeight<=0) throw new RangeError("at least one multidirectional weight must be greater than zero");
    const blend=options.blend||"mean";
    let direct;
    if(blend==="maximum") direct=Math.max(...values.map(entry=>entry.value));
    else if(blend==="rms") direct=Math.sqrt(values.reduce((sum,entry)=>sum+entry.weight*entry.value*entry.value,0)/totalWeight);
    else if(blend==="mean") direct=values.reduce((sum,entry)=>sum+entry.weight*entry.value,0)/totalWeight;
    else throw new RangeError('blend must be "mean", "rms", or "maximum"');
    return base.ambient+(1-base.ambient)*direct;
  }

  function createMultidirectionalHillshade(options){
    const settings=options||{}, base=validatedLighting(settings), directions=directionsOf(settings);
    const hasExplicitWeights=directions.some(direction=>direction.weight!==null);
    const weighting=settings.weighting||(hasExplicitWeights?"explicit":"aspect");
    if(!["aspect","equal","explicit"].includes(weighting))
      throw new RangeError('weighting must be "aspect", "equal", or "explicit"');
    const blend=settings.blend||"mean";
    if(!["mean","rms","maximum"].includes(blend))
      throw new RangeError('blend must be "mean", "rms", or "maximum"');
    const compiled=directions.map(direction=>{
      if(!finiteNumber(direction.azimuth)) throw new TypeError("each azimuth must be finite");
      if(!finiteNumber(direction.altitude)||direction.altitude<0||direction.altitude>90)
        throw new RangeError("each altitude must be between 0 and 90 degrees");
      const weight=direction.weight===null?1:direction.weight;
      if(!finiteNumber(weight)||weight<0) throw new RangeError("each weight must be a finite non-negative number");
      return {azimuth:normalizeDegrees(direction.azimuth),weight,
              lighting:{...base,azimuth:normalizeDegrees(direction.azimuth),altitude:direction.altitude,ambient:0}};
    });
    if(weighting==="explicit"&&!compiled.some(direction=>direction.weight>0))
      throw new RangeError("at least one multidirectional weight must be greater than zero");
    return function compiledMultidirectionalHillshade(dzdx,dzdy){
      if(!finiteNumber(dzdx)||!finiteNumber(dzdy)) return null;
      const east=dzdx*base.zFactor;
      const north=(base.rowAxis==="south"?-dzdy:dzdy)*base.zFactor;
      const flat=Math.hypot(east,north)<=DEFAULT_FLAT_EPSILON;
      const aspect=flat?0:normalizeDegrees(Math.atan2(-east,-north)*RAD_TO_DEG);
      let totalWeight=0, sum=0, squares=0, maximum=0;
      for(const direction of compiled){
        const weight=weighting==="equal"||(weighting==="aspect"&&flat) ? 1
          : weighting==="aspect" ? Math.sin((aspect-direction.azimuth)*DEG_TO_RAD)**2
          : direction.weight;
        if(weight<=0) continue;
        const value=directIllumination(dzdx,dzdy,direction.lighting);
        totalWeight+=weight; sum+=weight*value; squares+=weight*value*value;
        if(value>maximum) maximum=value;
      }
      if(totalWeight<=0) throw new RangeError("at least one multidirectional weight must be greater than zero");
      const direct=blend==="maximum"?maximum:blend==="rms"?Math.sqrt(squares/totalWeight):sum/totalWeight;
      return base.ambient+(1-base.ambient)*direct;
    };
  }

  function hillshadeByte(first,second,third){
    const value=hillshade(first,second,third);
    return value===null?null:Math.round(clamp(value,0,1)*255);
  }

  function multidirectionalHillshadeByte(first,second,third){
    const value=multidirectionalHillshade(first,second,third);
    return value===null?null:Math.round(clamp(value,0,1)*255);
  }

  const ELEVATION_RAMPS=Object.freeze({
    topographic:Object.freeze([
      Object.freeze([-500,Object.freeze([20,61,111,255])]),
      Object.freeze([0,Object.freeze([181,214,229,255])]),
      Object.freeze([1,Object.freeze([220,232,190,255])]),
      Object.freeze([250,Object.freeze([157,190,108,255])]),
      Object.freeze([750,Object.freeze([204,191,126,255])]),
      Object.freeze([1500,Object.freeze([169,132,96,255])]),
      Object.freeze([2500,Object.freeze([139,112,105,255])]),
      Object.freeze([4000,Object.freeze([205,205,210,255])]),
      Object.freeze([6000,Object.freeze([245,247,250,255])]),
      Object.freeze([9000,Object.freeze([255,255,255,255])])
    ]),
    terrain:Object.freeze([
      Object.freeze([-1000,Object.freeze([28,74,125,255])]),
      Object.freeze([0,Object.freeze([159,205,224,255])]),
      Object.freeze([1,Object.freeze([69,120,76,255])]),
      Object.freeze([300,Object.freeze([111,148,85,255])]),
      Object.freeze([800,Object.freeze([164,161,104,255])]),
      Object.freeze([1400,Object.freeze([190,157,112,255])]),
      Object.freeze([2200,Object.freeze([166,135,125,255])]),
      Object.freeze([3200,Object.freeze([203,203,207,255])]),
      Object.freeze([5000,Object.freeze([246,248,250,255])])
    ]),
    grayscale:Object.freeze([
      Object.freeze([-500,Object.freeze([24,24,27,255])]),
      Object.freeze([4500,Object.freeze([248,248,250,255])])
    ]),
    spectral:Object.freeze([
      Object.freeze([-500,Object.freeze([49,54,149,255])]),
      Object.freeze([0,Object.freeze([69,117,180,255])]),
      Object.freeze([500,Object.freeze([116,173,209,255])]),
      Object.freeze([1000,Object.freeze([171,217,233,255])]),
      Object.freeze([1500,Object.freeze([224,243,248,255])]),
      Object.freeze([2000,Object.freeze([255,255,191,255])]),
      Object.freeze([2500,Object.freeze([254,224,144,255])]),
      Object.freeze([3000,Object.freeze([253,174,97,255])]),
      Object.freeze([3500,Object.freeze([244,109,67,255])]),
      Object.freeze([4000,Object.freeze([215,48,39,255])]),
      Object.freeze([4500,Object.freeze([165,0,38,255])])
    ])
  });

  function colorChannel(value,name){
    if(!finiteNumber(value)) throw new TypeError(`${name} must be finite`);
    return clamp(value,0,255);
  }

  function parseColor(color){
    if(Array.isArray(color)||ArrayBuffer.isView(color)){
      if(color.length!==3&&color.length!==4) throw new RangeError("colors must have three or four channels");
      return [colorChannel(color[0],"red"),colorChannel(color[1],"green"),colorChannel(color[2],"blue"),
              color.length===4?colorChannel(color[3],"alpha"):255];
    }
    if(color&&typeof color==="object")
      return [colorChannel(color.r,"red"),colorChannel(color.g,"green"),colorChannel(color.b,"blue"),
              hasOwn(color,"a")?colorChannel(color.a,"alpha"):255];
    if(typeof color!=="string"||!/^#[0-9a-f]{3,8}$/i.test(color)||![4,5,7,9].includes(color.length))
      throw new TypeError("color must be RGB(A) channels or a 3, 4, 6, or 8 digit hex color");
    let hex=color.slice(1);
    if(hex.length===3||hex.length===4) hex=hex.split("").map(value=>value+value).join("");
    if(hex.length===6) hex+="ff";
    return [0,2,4,6].map(index=>parseInt(hex.slice(index,index+2),16));
  }

  function rampByName(ramp){
    if(typeof ramp!=="string") return ramp;
    const key=ramp.toLowerCase();
    if(!hasOwn(ELEVATION_RAMPS,key)) throw new RangeError(`unknown elevation ramp: ${ramp}`);
    return ELEVATION_RAMPS[key];
  }

  function normalizeColorRamp(ramp){
    const source=rampByName(ramp===undefined?"topographic":ramp);
    if(!Array.isArray(source)||!source.length) throw new RangeError("an elevation color ramp needs at least one stop");
    const byValue=new Map();
    for(const stop of source){
      const value=Array.isArray(stop)?stop[0]:stop&&(hasOwn(stop,"value")?stop.value:stop.elevation);
      const color=Array.isArray(stop)?stop[1]:stop&&stop.color;
      if(!finiteNumber(value)) throw new TypeError("each elevation ramp stop needs a finite value");
      byValue.set(value,{value,color:parseColor(color)});
    }
    return Array.from(byValue.values()).sort((a,b)=>a.value-b.value);
  }

  function srgbToLinear(channel){
    const value=channel/255;
    return value<=0.04045?value/12.92:Math.pow((value+0.055)/1.055,2.4);
  }

  function linearToSrgb(channel){
    const value=channel<=0.0031308?12.92*channel:1.055*Math.pow(channel,1/2.4)-0.055;
    return clamp(value,0,1)*255;
  }

  function interpolateColor(left,right,fraction,space){
    const t=clamp(fraction,0,1), result=[];
    for(let channel=0;channel<3;channel++){
      if(space==="linear-rgb"){
        const linear=srgbToLinear(left[channel])+(srgbToLinear(right[channel])-srgbToLinear(left[channel]))*t;
        result[channel]=Math.round(linearToSrgb(linear));
      }else result[channel]=Math.round(left[channel]+(right[channel]-left[channel])*t);
    }
    result[3]=Math.round(left[3]+(right[3]-left[3])*t);
    return result;
  }

  /* Does moving the sun change this picture?
     Two independent reasons it may not, and the terrain panel could admit
     neither in a way a reader could act on. Kept here so the answer is one
     tested rule rather than a condition duplicated across the UI.

     - Slope, aspect, northness and contours are derived from gradient and
       elevation. There is no light source in them to move.
     - Published hillshade (WA DNR, and the 3DEP export composited under it)
       arrives as a finished image with its shadows already baked. "Best
       available" switches to it silently once you pass z13 over Washington
       with the engine connected, so the slider that worked at a wider zoom
       stops working here with nothing said. */
  const SUN_LIT_STYLES=Object.freeze(["hs","hsmulti","tint"]);
  const PRERENDERED_SOURCES=Object.freeze(["wadnr"]);
  function sunAffectsTerrain(style,source){
    if(!style||style==="off") return {live:false,reason:"off"};
    if(!SUN_LIT_STYLES.includes(style)) return {live:false,reason:"derived"};
    if(PRERENDERED_SOURCES.includes(source)) return {live:false,reason:"prerendered"};
    return {live:true,reason:"live"};
  }

  function createElevationColorizer(ramp,options){
    const stops=normalizeColorRamp(ramp), settings=options||{};
    const space=settings.space||"srgb";
    if(space!=="srgb"&&space!=="linear-rgb") throw new RangeError('space must be "srgb" or "linear-rgb"');
    const noDataColor=parseColor(settings.noDataColor||[0,0,0,0]);
    const domain=settings.domain;
    if(domain!==undefined && (!Array.isArray(domain)||domain.length!==2||!finiteNumber(domain[0])||!finiteNumber(domain[1])||domain[1]<=domain[0]))
      throw new RangeError("domain must be an increasing pair of finite numbers");
    const clampOutside=settings.clamp!==false;
    return function colorize(elevation){
      if(!finiteNumber(elevation)) return noDataColor.slice();
      let value=elevation;
      if(domain){
        const fraction=(value-domain[0])/(domain[1]-domain[0]);
        value=stops[0].value+fraction*(stops[stops.length-1].value-stops[0].value);
      }
      if(value<stops[0].value) return clampOutside?stops[0].color.slice():noDataColor.slice();
      if(value>stops[stops.length-1].value) return clampOutside?stops[stops.length-1].color.slice():noDataColor.slice();
      if(value===stops[0].value||stops.length===1) return stops[0].color.slice();
      let low=0, high=stops.length-1;
      while(high-low>1){
        const middle=(low+high)>>1;
        if(value<stops[middle].value) high=middle; else low=middle;
      }
      if(value===stops[low].value) return stops[low].color.slice();
      if(value===stops[high].value) return stops[high].color.slice();
      return interpolateColor(stops[low].color,stops[high].color,
                              (value-stops[low].value)/(stops[high].value-stops[low].value),space);
    };
  }

  function colorForElevation(elevation,ramp,options){
    return createElevationColorizer(ramp,options)(elevation);
  }

  function niceContourInterval(raw,options){
    if(!finiteNumber(raw)||raw<=0) return null;
    const settings=typeof options==="string"?{mode:options}:options||{};
    const steps=(settings.steps||[1,2,2.5,5,10]).slice().sort((a,b)=>a-b);
    if(!steps.length||steps.some(step=>!finiteNumber(step)||step<=0)) throw new RangeError("contour steps must be positive finite numbers");
    const mode=settings.mode||"ceil";
    if(!["ceil","nearest","floor"].includes(mode)) throw new RangeError('mode must be "ceil", "nearest", or "floor"');
    const exponent=Math.floor(Math.log10(raw));
    const candidates=[];
    for(let power=exponent-1;power<=exponent+2;power++)
      for(const step of steps) candidates.push(step*Math.pow(10,power));
    const unique=Array.from(new Set(candidates)).sort((a,b)=>a-b);
    if(mode==="ceil") return unique.find(value=>value>=raw*(1-1e-12))||unique[unique.length-1];
    if(mode==="floor"){
      for(let index=unique.length-1;index>=0;index--) if(unique[index]<=raw*(1+1e-12)) return unique[index];
      return unique[0];
    }
    return unique.reduce((best,value)=>Math.abs(Math.log(value/raw))<Math.abs(Math.log(best/raw))?value:best,unique[0]);
  }

  function contourSettings(first,second,third){
    if(first&&typeof first==="object"&&!Array.isArray(first)) return {...first};
    return {...(third||{}),min:first,max:second};
  }

  function contourIntervalDetails(first,second,third){
    const settings=contourSettings(first,second,third);
    if(!finiteNumber(settings.min)||!finiteNumber(settings.max)) return null;
    const low=Math.min(settings.min,settings.max), high=Math.max(settings.min,settings.max), range=high-low;
    if(range===0) return null;
    const targetCount=hasOwn(settings,"targetCount")?positiveNumber(settings.targetCount,"targetCount"):12;
    const minPixelSpacing=hasOwn(settings,"minPixelSpacing")?nonNegativeNumber(settings.minPixelSpacing,"minPixelSpacing"):4;
    let verticalPerPixel=0;
    if(hasOwn(settings,"verticalPerPixel")) verticalPerPixel=nonNegativeNumber(settings.verticalPerPixel,"verticalPerPixel");
    else if(hasOwn(settings,"groundResolution")){
      const resolution=positiveNumber(settings.groundResolution,"groundResolution");
      let grade=0;
      if(hasOwn(settings,"slopeGrade")) grade=nonNegativeNumber(settings.slopeGrade,"slopeGrade");
      else if(hasOwn(settings,"slopePercent")) grade=nonNegativeNumber(settings.slopePercent,"slopePercent")/100;
      else if(hasOwn(settings,"slopeDegrees")){
        const degrees=nonNegativeNumber(settings.slopeDegrees,"slopeDegrees");
        if(degrees>=90) throw new RangeError("slopeDegrees must be less than 90");
        grade=Math.tan(degrees*DEG_TO_RAD);
      }
      verticalPerPixel=resolution*grade*optionNumber(settings,"zFactor",1);
    }
    const rangeDriven=range/targetCount;
    const spacingDriven=verticalPerPixel*minPixelSpacing;
    const minimum=hasOwn(settings,"minInterval")?nonNegativeNumber(settings.minInterval,"minInterval"):0;
    const raw=Math.max(rangeDriven,spacingDriven,minimum);
    let interval;
    if(settings.allowedIntervals){
      const allowed=settings.allowedIntervals.slice().sort((a,b)=>a-b);
      if(!allowed.length||allowed.some(value=>!finiteNumber(value)||value<=0))
        throw new RangeError("allowedIntervals must contain positive finite numbers");
      interval=allowed.find(value=>value>=raw*(1-1e-12))||allowed[allowed.length-1];
    }else interval=niceContourInterval(raw,{mode:settings.mode||"ceil",steps:settings.steps});
    if(hasOwn(settings,"maxInterval")) interval=Math.min(interval,positiveNumber(settings.maxInterval,"maxInterval"));
    return {interval,range,rangeDriven,spacingDriven,verticalPerPixel,targetCount,minPixelSpacing};
  }

  function adaptiveContourInterval(first,second,third){
    const details=contourIntervalDetails(first,second,third);
    return details&&details.interval;
  }

  function indexContourInterval(interval,indexEvery){
    positiveNumber(interval,"interval");
    const every=indexEvery===undefined?5:indexEvery;
    if(!Number.isInteger(every)||every<=0) throw new RangeError("indexEvery must be a positive integer");
    return interval*every;
  }

  function contourLevels(min,max,interval,options){
    if(!finiteNumber(min)||!finiteNumber(max)) return [];
    positiveNumber(interval,"interval");
    const settings=options||{}, low=Math.min(min,max), high=Math.max(min,max);
    const base=optionNumber(settings,"base",0);
    const maxLevels=hasOwn(settings,"maxLevels")?settings.maxLevels:10000;
    if(!Number.isInteger(maxLevels)||maxLevels<=0) throw new RangeError("maxLevels must be a positive integer");
    const tolerance=interval*1e-10;
    const start=base+Math.ceil((low-base-tolerance)/interval)*interval;
    const count=Math.max(0,Math.floor((high-start+tolerance)/interval)+1);
    if(count>maxLevels) throw new RangeError(`contour level count exceeds maxLevels (${maxLevels})`);
    const precision=Math.max(0,Math.min(14,Math.ceil(-Math.log10(interval))+10));
    return Array.from({length:count},(_,index)=>Number((start+index*interval).toFixed(precision)));
  }

  return {
    hornGradient,hornGradient3x3,hornGradientGrid,
    slopeRadians,slopeDegrees,slopePercent,slopeMetrics,
    analyzeAspect,aspectDegrees,aspectCardinal,cardinalDirection,normalizeDegrees,
    hillshade,singleHillshade:hillshade,hillshadeByte,createHillshade,
    multidirectionalHillshade,multiHillshade:multidirectionalHillshade,multidirectionalHillshadeByte,
    createMultidirectionalHillshade,
    ELEVATION_RAMPS,SUN_LIT_STYLES,PRERENDERED_SOURCES,sunAffectsTerrain,normalizeColorRamp,createElevationColorizer,colorForElevation,elevationColor:colorForElevation,
    niceContourInterval,adaptiveContourInterval,contourIntervalDetails,indexContourInterval,contourLevels
  };
});
