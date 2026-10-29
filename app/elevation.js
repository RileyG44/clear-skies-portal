function elevRampRgb(value,level,span,colors=[[248,92,108],[255,255,250],[70,160,255]]){
  const d=(value-level)/Math.max(1,span);
  const t=Math.max(0,Math.min(1,Math.abs(d)));
  const smooth=t*t*(3-2*t);                    // retain a readable white centre
  const target=colors[d>=0?2:0];
  const white=colors[1];
  return white.map((c,i)=>Math.round(c+(target[i]-c)*smooth));
}

/* One shared WebGL context shades every elevation tile. Creating a context per
   Leaflet tile quickly exceeds browser limits; this renderer uploads one
   Float32 elevation texture at a time, draws it on the GPU, then copies the
   finished pixels into the tile's ordinary 2D canvas. */
class ElevationGpuRenderer{
  constructor(){ this.init() }
  /* Re-run when the browser restores a lost context (GPU memory pressure, a
     driver reset); without it shading stayed on the slow CPU path for the rest
     of the session. */
  init(){
    this.ready=false;
    try{
      this.canvas=document.createElement("canvas");
      this.canvas.width=this.canvas.height=256;
      const gl=this.gl=this.canvas.getContext("webgl2",{alpha:true,antialias:false,premultipliedAlpha:true,preserveDrawingBuffer:false});
      if(!gl) return;
      const compile=(type,source)=>{
        const shader=gl.createShader(type); gl.shaderSource(shader,source); gl.compileShader(shader);
        if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader)||"shader compile failed");
        return shader;
      };
      const vertex=compile(gl.VERTEX_SHADER,`#version 300 es
        out vec2 uv;
        void main(){
          vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));
          uv=vec2(p.x,1.0-p.y);
          gl_Position=vec4(p*2.0-1.0,0.0,1.0);
        }`);
      const fragment=compile(gl.FRAGMENT_SHADER,`#version 300 es
        precision highp float;
        uniform sampler2D heights;
        uniform float spectrumOn;
        uniform float spectrumLevel;
        uniform float spectrumSpan;
        uniform float spectrumAlpha;
        uniform vec3 spectrumLow;
        uniform vec3 spectrumMid;
        uniform vec3 spectrumHigh;
        uniform float belowOn;
        uniform float belowLevel;
        uniform vec3 belowColor;
        uniform float aboveOn;
        uniform float aboveLevel;
        uniform vec3 aboveColor;
        uniform float bandAlpha;
        uniform float bandFeather;
        uniform float outlineOn;
        uniform float outlineWidth;
        in vec2 uv;
        out vec4 color;
        void over(inout vec4 base,vec3 rgb,float a){
          a=clamp(a,0.0,1.0);
          base=vec4(rgb*a+base.rgb*(1.0-a),a+base.a*(1.0-a));
        }
        void main(){
          float value=texture(heights,uv).r;
          if(isnan(value)){ discard; }
          vec4 result=vec4(0.0);
          if(spectrumOn>0.5){
            float d=(value-spectrumLevel)/max(1.0,spectrumSpan);
            float t=clamp(abs(d),0.0,1.0);
            float blend=t*t*(3.0-2.0*t);
            vec3 white=spectrumMid;
            vec3 target=d>=0.0?spectrumHigh:spectrumLow;
            over(result,mix(white,target,blend),spectrumAlpha*(0.15+0.85*t));
          }
          float belowCoverage=bandFeather>0.0
            ? 1.0-smoothstep(belowLevel-bandFeather*0.5,belowLevel+bandFeather*0.5,value)
            : step(value,belowLevel);
          float aboveCoverage=bandFeather>0.0
            ? smoothstep(aboveLevel-bandFeather*0.5,aboveLevel+bandFeather*0.5,value)
            : step(aboveLevel,value);
          if(belowOn>0.5) over(result,belowColor,bandAlpha*belowCoverage);
          if(aboveOn>0.5) over(result,aboveColor,bandAlpha*aboveCoverage);
          if(outlineOn>0.5){
            float line=0.0;
            if(belowOn>0.5) line=max(line,1.0-smoothstep(0.0,max(0.001,outlineWidth*0.5),abs(value-belowLevel)));
            if(aboveOn>0.5) line=max(line,1.0-smoothstep(0.0,max(0.001,outlineWidth*0.5),abs(value-aboveLevel)));
            over(result,vec3(1.0),0.88*line);
          }
          color=result;                 // premultiplied, matching the context
        }`);
      const program=this.program=gl.createProgram();
      gl.attachShader(program,vertex); gl.attachShader(program,fragment); gl.linkProgram(program);
      if(!gl.getProgramParameter(program,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program)||"shader link failed");
      gl.deleteShader(vertex); gl.deleteShader(fragment);
      this.texture=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,this.texture);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      this.uniforms={};
      for(const name of ["heights","spectrumOn","spectrumLevel","spectrumSpan","spectrumAlpha","spectrumLow","spectrumMid","spectrumHigh",
        "belowOn","belowLevel","belowColor","aboveOn","aboveLevel","aboveColor","bandAlpha",
        "bandFeather","outlineOn","outlineWidth"])
        this.uniforms[name]=gl.getUniformLocation(program,name);
      this.ready=true;
      this.canvas.addEventListener("webglcontextlost",event=>{ event.preventDefault(); this.ready=false });
      this.canvas.addEventListener("webglcontextrestored",()=>this.init(),{once:true});
    }catch(error){ this.ready=false; console.warn("Elevation GPU disabled:",error) }
  }
  paint(target,elev,settings){
    if(!this.ready||!elev||target.width!==256||target.height!==256) return false;
    try{
      const gl=this.gl; gl.viewport(0,0,256,256); gl.useProgram(this.program);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,this.texture);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.R32F,256,256,0,gl.RED,gl.FLOAT,elev);
      gl.uniform1i(this.uniforms.heights,0);
      gl.uniform1f(this.uniforms.spectrumOn,settings.spectrumOn?1:0);
      gl.uniform1f(this.uniforms.spectrumLevel,settings.level);
      gl.uniform1f(this.uniforms.spectrumSpan,settings.span);
      gl.uniform1f(this.uniforms.spectrumAlpha,settings.spectrumAlpha);
      gl.uniform3f(this.uniforms.spectrumLow,...settings.spectrumLow.map(v=>v/255));
      gl.uniform3f(this.uniforms.spectrumMid,...settings.spectrumMid.map(v=>v/255));
      gl.uniform3f(this.uniforms.spectrumHigh,...settings.spectrumHigh.map(v=>v/255));
      gl.uniform1f(this.uniforms.belowOn,settings.below.enabled?1:0);
      gl.uniform1f(this.uniforms.belowLevel,settings.below.level);
      gl.uniform3f(this.uniforms.belowColor,...settings.below.color);
      gl.uniform1f(this.uniforms.aboveOn,settings.above.enabled?1:0);
      gl.uniform1f(this.uniforms.aboveLevel,settings.above.level);
      gl.uniform3f(this.uniforms.aboveColor,...settings.above.color);
      gl.uniform1f(this.uniforms.bandAlpha,settings.bandAlpha);
      gl.uniform1f(this.uniforms.bandFeather,settings.bandFeather);
      gl.uniform1f(this.uniforms.outlineOn,settings.outline?1:0);
      gl.uniform1f(this.uniforms.outlineWidth,settings.outlineWidth);
      gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLES,0,3);
      const ctx=target.getContext("2d"); ctx.clearRect(0,0,256,256); ctx.drawImage(this.canvas,0,0);
      return true;
    }catch(error){ this.ready=false; console.warn("Elevation GPU paint failed:",error); return false }
  }
}
const elevGpu=new ElevationGpuRenderer();

/* Terrain derivatives are ideal GPU work: each output pixel reads the same
   3×3 elevation neighbourhood and does no cross-tile bookkeeping. One shared
   WebGL2 context shades tiles serially, then copies the finished image into
   Leaflet's ordinary canvas. This avoids both a context-per-tile limit and the
   pre-coloured ArcGIS tiles that became transparent at deep zoom. */
class TerrainGpuRenderer{
  constructor(){ this.init() }
  init(){   // see ElevationGpuRenderer.init
    this.ready=false;
    try{
      this.canvas=document.createElement("canvas");this.canvas.width=this.canvas.height=256;
      const gl=this.gl=this.canvas.getContext("webgl2",{alpha:true,antialias:false,premultipliedAlpha:false,preserveDrawingBuffer:false});
      if(!gl) return;
      const compile=(type,source)=>{
        const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);
        if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader)||"shader compile failed");
        return shader;
      };
      const vertex=compile(gl.VERTEX_SHADER,`#version 300 es
        out vec2 uv;
        void main(){
          vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));
          uv=vec2(p.x,1.0-p.y);
          gl_Position=vec4(p*2.0-1.0,0.0,1.0);
        }`);
      const fragment=compile(gl.FRAGMENT_SHADER,`#version 300 es
        precision highp float;
        uniform sampler2D heights;
        uniform float groundRes;
        uniform float sunAzimuth;
        uniform float sunAltitude;
        uniform float ambientLight;
        uniform int style;
        in vec2 uv;
        out vec4 color;
        const float PI=3.141592653589793;
        bool bad(float v){ return isnan(v)||isinf(v)||v < -1.0e20; }
        float h(vec2 p){ return texture(heights,p).r; }
        vec3 ramp(float value,vec3 c0,float v1,vec3 c1,float v2,vec3 c2,float v3,vec3 c3,float v4,vec3 c4,float v5,vec3 c5,float v6,vec3 c6){
          if(value<=v1) return mix(c0,c1,clamp(value/max(v1,0.0001),0.0,1.0));
          if(value<=v2) return mix(c1,c2,(value-v1)/(v2-v1));
          if(value<=v3) return mix(c2,c3,(value-v2)/(v3-v2));
          if(value<=v4) return mix(c3,c4,(value-v3)/(v4-v3));
          if(value<=v5) return mix(c4,c5,(value-v4)/(v5-v4));
          if(value<=v6) return mix(c5,c6,(value-v5)/(v6-v5));
          return c6;
        }
        float aspectOf(float dx,float dy){ return mod(degrees(atan(-dx,dy))+360.0,360.0); }
        float directShade(float dx,float dy,float azimuth){
          float east=dx,north=-dy,altitude=radians(sunAltitude),az=radians(azimuth);
          float direct=clamp((-east*cos(altitude)*sin(az)-north*cos(altitude)*cos(az)+sin(altitude))/sqrt(east*east+north*north+1.0),0.0,1.0);
          return direct;
        }
        vec3 slopeColour(float degreesValue){
          return ramp(degreesValue,vec3(242,244,238)/255.0,5.0,vec3(177,210,139)/255.0,
            15.0,vec3(246,218,111)/255.0,30.0,vec3(240,150,73)/255.0,
            45.0,vec3(213,70,80)/255.0,60.0,vec3(118,44,105)/255.0,
            90.0,vec3(50,25,72)/255.0);
        }
        vec3 aspectColour(float degreesValue){
          float sector=floor(degreesValue/45.0),t=fract(degreesValue/45.0);
          vec3 a,b;
          if(sector<1.0){a=vec3(77,120,200);b=vec3(59,165,176);}
          else if(sector<2.0){a=vec3(59,165,176);b=vec3(87,167,101);}
          else if(sector<3.0){a=vec3(87,167,101);b=vec3(201,173,79);}
          else if(sector<4.0){a=vec3(201,173,79);b=vec3(217,107,82);}
          else if(sector<5.0){a=vec3(217,107,82);b=vec3(196,91,130);}
          else if(sector<6.0){a=vec3(196,91,130);b=vec3(141,101,187);}
          else if(sector<7.0){a=vec3(141,101,187);b=vec3(94,119,197);}
          else {a=vec3(94,119,197);b=vec3(77,120,200);}
          return mix(a,b,t)/255.0;
        }
        vec3 srgbToLinear(vec3 value){
          vec3 lo=value/12.92,hi=pow((value+0.055)/1.055,vec3(2.4));
          return mix(hi,lo,lessThanEqual(value,vec3(0.04045)));
        }
        vec3 linearToSrgb(vec3 value){
          vec3 lo=12.92*value,hi=1.055*pow(max(value,vec3(0.0)),vec3(1.0/2.4))-0.055;
          return clamp(mix(hi,lo,lessThanEqual(value,vec3(0.0031308))),0.0,1.0);
        }
        vec3 linearColour(vec3 a,vec3 b,float t){ return linearToSrgb(mix(srgbToLinear(a),srgbToLinear(b),clamp(t,0.0,1.0))); }
        /* The "relief" ramp from terrain-core.js, interpolated in sRGB like it. */
        vec3 tintColour(float value){
          vec3 c0=vec3(22,46,72)/255.0,c1=vec3(40,70,95)/255.0,c2=vec3(70,110,70)/255.0,c3=vec3(128,140,92)/255.0;
          vec3 c4=vec3(160,140,108)/255.0,c5=vec3(190,180,170)/255.0,c6=vec3(245,246,250)/255.0,c7=vec3(255)/255.0;
          if(value<=-500.0) return c0;if(value<=0.0) return mix(c0,c1,(value+500.0)/500.0);
          if(value<=300.0) return mix(c1,c2,value/300.0);if(value<=900.0) return mix(c2,c3,(value-300.0)/600.0);
          if(value<=1600.0) return mix(c3,c4,(value-900.0)/700.0);if(value<=2400.0) return mix(c4,c5,(value-1600.0)/800.0);
          if(value<=3200.0) return mix(c5,c6,(value-2400.0)/800.0);if(value<=6000.0) return mix(c6,c7,(value-3200.0)/2800.0);
          return c7;
        }
        void main(){
          vec2 px=vec2(1.0/256.0,0.0),py=vec2(0.0,1.0/256.0);
          float a=h(uv-px-py),b=h(uv-py),c=h(uv+px-py);
          float d=h(uv-px),v=h(uv),f=h(uv+px);
          float g=h(uv-px+py),q=h(uv+py),k=h(uv+px+py);
          if(bad(v)||bad(a)||bad(b)||bad(c)||bad(d)||bad(f)||bad(g)||bad(q)||bad(k)) discard;
          float dx=((c+2.0*f+k)-(a+2.0*d+g))/(8.0*groundRes);
          float dy=((g+2.0*q+k)-(a+2.0*b+c))/(8.0*groundRes);
          if(style==2){ color=vec4(slopeColour(degrees(atan(length(vec2(dx,dy))))),1.0);return; }
          float aspect=aspectOf(dx,dy);
          if(style==3){ if(length(vec2(dx,dy))<=tan(radians(0.5))) discard;color=vec4(aspectColour(aspect),1.0);return; }
          if(style==4){
            if(length(vec2(dx,dy))<=tan(radians(0.5))) discard;
            float northness=cos(radians(aspect)),amount=abs(northness);
            vec3 neutral=vec3(247,243,224)/255.0;
            vec3 target=(northness>=0.0?vec3(55,137,92):vec3(214,82,78))/255.0;
            color=vec4(mix(neutral,target,amount),1.0);return;
          }
          if(style>=6){
            float interval=style==6?2.0:style==7?5.0:style==8?10.0:25.0;
            float perPixel=length(vec2(dx,dy))*groundRes*3.28084;
            if(perPixel>0.0){
              float spacing=interval/perPixel;
              if(spacing<3.0){if(spacing*5.0>=3.0) interval*=5.0;else discard;}
            }
            float multiple=v*3.28084/interval;
            float distanceToLine=abs(multiple-round(multiple))*interval;
            float lineWidth=max(0.35,min(interval*0.5,perPixel*0.7));
            if(distanceToLine>=lineWidth) discard;
            bool indexLine=abs(mod(round(multiple),5.0))<0.5;
            color=indexLine?vec4(vec3(120,70,40)/255.0,1.0):vec4(vec3(150,110,80)/255.0,200.0/255.0);return;
          }
          if(style==5){
            float shade315=ambientLight+(1.0-ambientLight)*directShade(dx,dy,sunAzimuth);
            color=vec4(min(tintColour(v)*(0.33+0.82*shade315),vec3(1.0)),1.0);return;
          }
          float direct;
          if(style==1){
            float sum=0.0,total=0.0;
            for(int index=0;index<4;index++){
              float az=sunAzimuth-90.0+45.0*float(index);
              /* s*s, not pow(s,2.0): GLSL pow is undefined for a negative base and
                 Apple GPUs return NaN, which turned this style black and failed the
                 self-test - disabling GPU shading for every style. */
              float s=sin(radians(aspect-mod(az,360.0)));
              float weight=length(vec2(dx,dy))<1.0e-12?1.0:s*s;
              sum+=weight*directShade(dx,dy,az);total+=weight;
            }
            direct=sum/max(total,0.00001);
          }else direct=directShade(dx,dy,sunAzimuth);
          float shade=ambientLight+(1.0-ambientLight)*direct;color=vec4(vec3(shade),1.0);
        }`);
      const program=this.program=gl.createProgram();gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);
      if(!gl.getProgramParameter(program,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program)||"program link failed");
      gl.deleteShader(vertex);gl.deleteShader(fragment);
      this.texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.texture);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      this.uniforms={heights:gl.getUniformLocation(program,"heights"),groundRes:gl.getUniformLocation(program,"groundRes"),
        sunAzimuth:gl.getUniformLocation(program,"sunAzimuth"),sunAltitude:gl.getUniformLocation(program,"sunAltitude"),
        ambientLight:gl.getUniformLocation(program,"ambientLight"),style:gl.getUniformLocation(program,"style")};
      this.ready=true;
      if(!this.selfTest()) throw new Error("terrain GPU orientation self-test failed");
      this.canvas.addEventListener("webglcontextlost",event=>{event.preventDefault();this.ready=false});
      this.canvas.addEventListener("webglcontextrestored",()=>this.init(),{once:true});
    }catch(error){this.ready=false;console.warn("Terrain GPU disabled:",error)}
  }
  paint(target,elevation,groundResolution,style,lighting=terrainLighting()){
      const modes={hs:0,hsmulti:1,slope:2,aspect:3,northness:4,tint:5,c2:6,c5:7,c10:8,c25:9};
    if(!this.ready||!elevation||target.width!==256||target.height!==256||!(style in modes)) return false;
    try{
      const gl=this.gl;gl.viewport(0,0,256,256);gl.useProgram(this.program);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.texture);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.R32F,256,256,0,gl.RED,gl.FLOAT,elevation);
      gl.uniform1i(this.uniforms.heights,0);gl.uniform1f(this.uniforms.groundRes,groundResolution);
      gl.uniform1f(this.uniforms.sunAzimuth,lighting.azimuth);gl.uniform1f(this.uniforms.sunAltitude,lighting.altitude);
      gl.uniform1f(this.uniforms.ambientLight,lighting.ambient);gl.uniform1i(this.uniforms.style,modes[style]);
      gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.drawArrays(gl.TRIANGLES,0,3);
      const ctx=target.getContext("2d");ctx.clearRect(0,0,256,256);ctx.drawImage(this.canvas,0,0);
      target.dataset.cspRenderer="webgl2";return true;
    }catch(error){this.ready=false;console.warn("Terrain GPU paint failed:",error);return false}
  }
  selfTest(){
    const target=document.createElement("canvas");target.width=target.height=256;
    const tests=[
      {dx:1,dy:0,expected:[141,101,187]},
      {dx:0,dy:1,expected:[77,120,200]},
      {dx:0,dy:-1,expected:[217,107,82]}
    ];
    for(const test of tests){
      const elevation=Float32Array.from({length:256*256},(_,index)=>100+(index%256)*test.dx+Math.floor(index/256)*test.dy);
      if(!this.paint(target,elevation,1,"aspect")) return false;
      const pixel=target.getContext("2d").getImageData(128,128,1,1).data;
      if(pixel[3]!==255||test.expected.some((value,index)=>Math.abs(pixel[index]-value)>2)){
        console.warn("Terrain GPU aspect self-test mismatch",{expected:test.expected,actual:Array.from(pixel)});return false;
      }
    }
    const elevation=Float32Array.from({length:256*256},(_,index)=>100+(index%256)*0.4+Math.floor(index/256)*-0.25);
    for(const style of ["hs","hsmulti","tint","slope","aspect","northness","c2","c5","c10","c25"]){
      const expected=CSPTerrainRaster.renderRgba(style,{grid:elevation,width:256,height:256,groundRes:1,lighting:terrainLighting()});
      if(!this.paint(target,elevation,1,style)) return false;
      const actual=target.getContext("2d").getImageData(128,128,1,1).data,offset=(128*256+128)*4;
      for(let channel=0;channel<4;channel++) if(Math.abs(actual[channel]-expected[offset+channel])>3){
        console.warn("Terrain GPU style self-test mismatch",{style,expected:Array.from(expected.slice(offset,offset+4)),actual:Array.from(actual)});return false;
      }
    }
    return true;
  }
}
const terrainGpu=new TerrainGpuRenderer();

const TERRAIN_PREF_KEY="clearskies.terrain.v2";
function saveTerrainPrefs(){
  try{ localStorage.setItem(TERRAIN_PREF_KEY,JSON.stringify({
    style:$("#terStyle").value,source:$("#terSrc").value,opacity:+$("#terOp").value,
    depth:$("#terDepth").value,extent:$("#terExtent").value,fabric:$("#fabBand").value,
    elevationOn:$("#elevSh").checked,elevationM:+$("#elevSlide").value,
    elevationUnit:$("#elevUnit").value,elevationSpanFt:+$("#elevSpan").value,
    elevationAlpha:+$("#elevAlpha").value,elevationSpectrumColors:spectrumHexColors(),elevationBands:elevationBandState(),lighting:terrainLighting()
  })) }catch(e){}
}
function loadTerrainPrefs(){
  try{
    const p=JSON.parse(localStorage.getItem(TERRAIN_PREF_KEY)||"null"); if(!p) return;
    const set=(id,value)=>{ const el=$(id); if(el&&value!=null&&[...el.options||[]].some(o=>o.value===String(value))) el.value=String(value) };
    set("#terStyle",p.style); set("#terSrc",p.source); set("#terDepth",p.depth); set("#terExtent",p.extent);
    set("#fabBand",p.fabric); $("#elevUnit").value="ft";
    const spanFt=Number.isFinite(+p.elevationSpanFt) ? +p.elevationSpanFt
      : Number.isFinite(+p.elevationSpan) ? +p.elevationSpan/0.3048 : 300;
    $("#elevSpan").value=Math.round(Math.max(10,Math.min(20000,spanFt)));
    if(Number.isFinite(+p.opacity)) $("#terOp").value=Math.max(0,Math.min(100,+p.opacity));
    if(Number.isFinite(+p.elevationAlpha)) $("#elevAlpha").value=Math.max(0,Math.min(100,+p.elevationAlpha));
    if(Number.isFinite(+p.elevationM)) $("#elevSlide").value=Math.max(-500,Math.min(4500,+p.elevationM));
    $("#elevSh").checked=!!p.elevationOn;
    if(p.lighting){
      if(Number.isFinite(+p.lighting.azimuth)) $("#terSunAz").value=Math.max(0,Math.min(359,+p.lighting.azimuth));
      if(Number.isFinite(+p.lighting.altitude)) $("#terSunAlt").value=Math.max(5,Math.min(90,+p.lighting.altitude));
      if(Number.isFinite(+p.lighting.ambient)) $("#terAmbient").value=Math.round(Math.max(0,Math.min(.6,+p.lighting.ambient))*100);
      if(Number.isFinite(+p.lighting.exaggeration)) $("#terExaggeration").value=Math.round(Math.max(.25,Math.min(4,+p.lighting.exaggeration))*100);
    }
    if(p.elevationSpectrumColors) for(const [i,id] of SPECTRUM_COLOR_IDS.entries()){
      const value=p.elevationSpectrumColors[i];if(/^#[0-9a-f]{6}$/i.test(value||"")) $(id).value=value;
    }
    syncSpectrumPalette();
    restoreElevationBands(p.elevationBands);
    const m=+$("#elevSlide").value;
    $("#elevVal").value=Math.round(m/ELEV_UNIT[$("#elevUnit").value]);
    $("#elevAlphaOut").textContent=$("#elevAlpha").value+"%";
    $("#elevBandAlphaOut").textContent=$("#elevBandAlpha").value+"%";
    syncTerrainLighting();
  }catch(e){}
}

/* All elevation consumers share decoded source tiles, including cropped parent
   tiles. A bounded queue prevents three layers from saturating the engine. */
/* The engine runs a render per core (two per worker while they wait on S3),
   so the page keeps it fed: six raw 1 m renders in flight instead of two. */
// Sharp work uses at most six slots, leaving twelve for newly exposed terrain.
// A slow primary request must not keep every free slot idle indefinitely.
// The engine groups together take at most fourteen, so the fast overview and
// its backdrop always have slots while slow renders are in flight.
const elevationRequests=new CSPTilePipeline.RequestPool({concurrency:18,groupLimits:{detail:6,national:6,overview:6,sharp:6,dnr:2,backdrop:3}});
function sourceSampleMeters(coords){
  const count=2**coords.z,latitude=Math.atan(Math.sinh(Math.PI*(1-2*(coords.y+.5)/count)));
  return 156543.03392804097*Math.cos(latitude)/count;
}
let publicDecoder=null,publicDecodeId=0,publicNationalRetryAt=0,publicNationalFailures=0;
const publicDecodes=new Map();
function decodePublicElevation(buffer,signal){
  if(signal?.aborted)return Promise.reject(new DOMException("Aborted","AbortError"));
  if(!publicDecoder){
    publicDecoder=new Worker("public-terrain-worker.js");
    publicDecoder.onmessage=({data})=>{
      const job=publicDecodes.get(data.id);if(!job)return;
      job.finish(data.error?new Error(data.error):null,data.tile);
    };
    publicDecoder.onerror=()=>{
      for(const job of [...publicDecodes.values()])job.finish(new Error("Elevation decoder unavailable"));
      publicDecoder?.terminate();publicDecoder=null;
    };
  }
  return new Promise((resolve,reject)=>{
    const id=++publicDecodeId;
    const abort=()=>finish(new DOMException("Aborted","AbortError"));
    const timer=setTimeout(()=>finish(new Error("Elevation decoder timed out")),15000);
    const finish=(error,tile)=>{clearTimeout(timer);signal?.removeEventListener("abort",abort);publicDecodes.delete(id);error?reject(error):resolve(tile)};
    publicDecodes.set(id,{finish});signal?.addEventListener("abort",abort,{once:true});
    publicDecoder.postMessage({id,buffer},[buffer]);
  });
}
async function fetchPublicElevation(url,signal){
  if(Date.now()<publicNationalRetryAt)throw new Error("Public elevation provider is recovering");
  const controller=new AbortController(),abort=()=>controller.abort();
  if(signal?.aborted)throw new DOMException("Aborted","AbortError");
  signal?.addEventListener("abort",abort,{once:true});
  const timeout=setTimeout(abort,18000);
  try{
    const response=await fetch(url,{signal:controller.signal});
    if(!response.ok)throw new Error(`USGS elevation HTTP ${response.status}`);
    const tile=await decodePublicElevation(await response.arrayBuffer(),controller.signal);
    publicNationalFailures=0;publicNationalRetryAt=0;return tile;
  }catch(error){
    /* One slow tile must not blacklist the whole viewport. Pause only after a
       short run of provider failures, while successful detail requests keep
       resetting the breaker and refining the map normally. */
    if(!signal?.aborted&&++publicNationalFailures>=4){publicNationalFailures=0;publicNationalRetryAt=Date.now()+5000;}
    throw error;
  }finally{clearTimeout(timeout);signal?.removeEventListener("abort",abort)}
}
async function publicElevationWithFallback(coords,signal){
  const native=Math.min(coords.z,18),scale=2**(coords.z-native),parent={z:native,x:Math.floor(coords.x/scale),y:Math.floor(coords.y/scale)};
  try{
    const url=CSPPublicTerrain.nationalUrl(parent);
    const tile=await elevationRequests.request(url,s=>fetchPublicElevation(url,s),{signal,priority:2,group:"national"});
    if(tile){
      const crop=scale>1?{x:(coords.x%scale)*tile.width/scale,y:(coords.y%scale)*tile.height/scale,width:tile.width/scale,height:tile.height/scale}:null;
      return {...tile,grid:ElevationTileCore.resampleElevation(tile.grid,tile.width,tile.height,crop,256,256),rank:2};
    }
  }catch(error){if(signal?.aborted)throw error}
  return overviewElevation(coords,signal);
}
async function overviewElevation(coords,signal){
  const z=Math.min(coords.z,15),factor=2**(coords.z-z),x=Math.floor(coords.x/factor),y=Math.floor(coords.y/factor);
  const url=overviewElevationUrl(z,x,y);
  const tile=await elevationRequests.request(url,s=>fetchElevation(url,s),{signal,priority:1,group:"overview"});
  if(!tile)throw new Error("Elevation unavailable");
  const crop=factor>1?{x:(coords.x%factor)*tile.width/factor,y:(coords.y%factor)*tile.height/factor,width:tile.width/factor,height:tile.height/factor}:null;
  return {...tile,grid:ElevationTileCore.resampleElevation(tile.grid,tile.width,tile.height,crop,256,256),rank:1};
}
/* The page's own decode, used by the drape workers' fallback when a worker or
   OffscreenCanvas is unavailable. The worker's "elevation" job is identical. */
async function decodeElevationBlob(blob){
  const bitmap=typeof createImageBitmap==="function"
    ?await createImageBitmap(blob,{colorSpaceConversion:"none",premultiplyAlpha:"none"}):await imageBitmapFromBlob(blob);
  try{
    /* Decode through one shared canvas: draw and read back happen in the
       same task, so concurrent tiles cannot interleave. */
    const canvas=scratch(Math.max(bitmap.width,bitmap.height),"decode");
    const context=canvas.getContext("2d",{willReadFrequently:true});
    context.clearRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0);
    const grid=ElevationTileCore.decodeTerrarium(context.getImageData(0,0,bitmap.width,bitmap.height).data,bitmap.width,bitmap.height);
    return {grid,width:bitmap.width,height:bitmap.height};
  }finally{bitmap.close?.();}
}
async function fetchElevation(url,signal){
  const isDnr=url.includes("/api/wadnr/elev/");
  let pendingChecks=0;
  for(let attempt=0;attempt<3;attempt++){
    if(signal.aborted) throw new DOMException("Aborted","AbortError");
    const controller=new AbortController(),abort=()=>controller.abort();
    signal.addEventListener("abort",abort,{once:true});
    const timeout=setTimeout(abort,10000);
    try{
      const response=await fetchOverviewResponse(url,controller.signal);
      if(isDnr&&response.status===202){
        const value=await response.json();dnrStatus=value.acquisition||dnrStatus;
        if(typeof scheduleTerrainStatus==="function")scheduleTerrainStatus();
        clearTimeout(timeout);
        if(++pendingChecks>60)throw new Error("Elevation processing is still pending");
        await waitElevationRetry(5000,signal);attempt--;continue;
      }
      if(!response.ok||response.headers.get("X-CSP-Error")){
        if(isDnr){try{const value=await response.json();dnrLastError=value.error||`DNR elevation HTTP ${response.status}`;}catch{}scheduleTerrainStatus();}
        throw new Error(`Elevation HTTP ${response.status}`);
      }
      if(isDnr)dnrLastError="";
      if(response.headers.get("X-Coverage")==="none") return null;
      /* A canvas readback costs several milliseconds per tile, and a fast pan
         or zoom brings dozens at once. The drape workers decode it instead. */
      const tile=await drapeWorkers.run({op:"elevation",blob:await response.blob()},signal);
      let surveys=[];
      if(isDnr)try{surveys=JSON.parse(decodeURIComponent(response.headers.get("X-DNR-Sources")||"[]"));}catch{}
      return ElevationTileCore.hasElevation(tile.grid)?{grid:tile.grid,width:tile.width,height:tile.height,surveys}:null;
    }catch(error){
      if(signal.aborted) throw new DOMException("Aborted","AbortError");
      // A timed-out cache connection also retries against the original source.
      const cached=url.match(/\/api\/elev\/overview\/(\d+)\/(\d+)\/(\d+)\.png$/);
      if(cached)url=`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${cached[1]}/${cached[2]}/${cached[3]}.png`;
      if(attempt===2) throw error;
    }finally{clearTimeout(timeout);signal.removeEventListener("abort",abort);}
    await new Promise((resolve,reject)=>{
      const abort=()=>{clearTimeout(timer);reject(new DOMException("Aborted","AbortError"));};
      const timer=setTimeout(()=>{signal.removeEventListener("abort",abort);resolve();},400*2**attempt);
      signal.addEventListener("abort",abort,{once:true});
      if(signal.aborted)abort();
    });
  }
}
function waitElevationRetry(ms,signal){
  return new Promise((resolve,reject)=>{
    const abort=()=>{clearTimeout(timer);reject(new DOMException("Aborted","AbortError"));};
    const timer=setTimeout(()=>{signal.removeEventListener("abort",abort);resolve();},ms);
    signal.addEventListener("abort",abort,{once:true});if(signal.aborted)abort();
  });
}
async function engineElevationWithFallback(coords,signal,mesh=false){
  const requests=[];
  const controller=new AbortController(),abort=()=>controller.abort();
  if(signal.aborted)throw new DOMException("Aborted","AbortError");
  signal.addEventListener("abort",abort,{once:true});
  const requestSignal=controller.signal;
  const request=(url,rank,group)=>elevationRequests.request(api(url),s=>fetchElevation(api(url),s),{signal:requestSignal,priority:rank===5?2:rank,group})
    .then(source=>source?{source,rank}:null).catch(error=>{if(signal.aborted)throw error;return null;});
  const useDnr=dnrTileAllowed(coords);
  if(useDnr)requests.push(request(`/api/wadnr/elev/${coords.z}/${coords.x}/${coords.y}.png?acquire=0&revision=${dnrStatus?.revision||0}`,5,"dnr"));
  requests.push(request(`/api/elev/national/${coords.z}/${coords.x}/${coords.y}.png`,2,"national"));
  const want=$("#terSrc").value;
  const useRaw=coords.z>=13&&want!=="3dep"&&(!mesh||want==="usgs1m");
  if(useRaw)requests.push(request(`/api/usgs/elev/${coords.z}/${coords.x}/${coords.y}.png?${RAW_COVERAGE_QUERY}`,3,"detail"));
  requests.push(overviewElevation(coords,requestSignal).then(source=>({source,rank:1})).catch(error=>{if(signal.aborted)throw error;return null;}));
  const progress=new CSPTilePipeline.ProgressiveGrid(256*256);
  const ranks=[...(useDnr?[5]:[]),2,...(useRaw?[3]:[]),1];
  const pending=new Set(ranks);
  try{
    return await new Promise((resolve,reject)=>{
      const finish=()=>{
        if(signal.aborted){reject(new DOMException("Aborted","AbortError"));return}
        const used=[5,3,2,1].filter(rank=>progress.counts[rank]>0);
        // Complete coverage cannot benefit from remaining lower-ranked sources.
        if(pending.size&&!(progress.valid===progress.grid.length&&Math.max(...pending)<Math.min(...used)))return;
        resolve(!progress.valid?null:{grid:progress.grid,ranks:used});
      };
      requests.forEach((request,i)=>request.then(result=>{
        if(result){const source=result.source;let grid=source.width===256&&source.height===256?source.grid:
          ElevationTileCore.resampleElevation(source.grid,source.width,source.height,null,256,256);
          progress.accept(grid,result.rank)}
        pending.delete(ranks[i]);finish();
      },reject));
    });
  }finally{controller.abort();signal.removeEventListener("abort",abort)}
}
const ElevLayer = L.GridLayer.extend({
  initialize:function(opts){ L.setOptions(this,opts); this._store=new Map(); this._pending=new Map();
    /* High-density screens: each tile covers 128 CSS px and holds the full
       256 px elevation tile of the next zoom down, so one elevation sample
       lands on one physical pixel - Leaflet's detectRetina, done for data
       rather than images. Everything below the grid (fetching, the store,
       ground resolution, research grids) works in those source coordinates;
       only Leaflet's grid is in display coordinates. */
    this._cspDz=HIDPI&&this.options.hiDpi!==false?1:0;
    if(this._cspDz){
      const size=this.options.tileSize||256;
      this.options.tileSize=typeof size==="number"?size/2:L.point(size.x/2,size.y/2);
      if(this.options.maxNativeZoom!=null) this.options.maxNativeZoom-=this._cspDz;
      if(this.options.minNativeZoom!=null) this.options.minNativeZoom=Math.max(0,this.options.minNativeZoom-this._cspDz);
    }
    this.on("tileunload",event=>{
      const key=this._k(this._source(event.coords)),pending=this._pending.get(key);
      if(pending&&pending.canvas===event.tile){pending.controller.abort();this._pending.delete(key);}
      if(this._store.get(key)?.cv===event.tile)this._store.delete(key);
      releaseCanvas(event.tile);
    });
  },
  _k:function(c){return c.z+"/"+c.x+"/"+c.y;},
  _source:function(c){return {z:c.z+(this._cspDz||0),x:c.x,y:c.y}},
  createTile:function(display,done){
    const coords=this._source(display),css=this.getTileSize(),dz=this._cspDz||0;
    const size=L.point(css.x*2**dz,css.y*2**dz),cv=document.createElement("canvas"),key=this._k(coords);
    cv.width=size.x;cv.height=size.y;cv._cspCoords={...coords};cv.dataset.cspZ=String(coords.z);
    this._loadTile(coords,cv,done);
    return cv;
  },
  _loadTile:function(coords,cv,done){
    const size={x:cv.width,y:cv.height},key=this._k(coords),dz=this._cspDz||0;
    this._pending.get(key)?.controller.abort();
    cv._cspRefining=true;
    if(!this.options.fallback){
      cv.getContext("2d").clearRect(0,0,cv.width,cv.height);
      cv._cspHasContent=false;cv._cspSourceCounts={};this._store.delete(key);
    }
    const controller=new AbortController(),pending={controller,canvas:cv};this._pending.set(key,pending);
    const progress=new CSPTilePipeline.ProgressiveGrid(size.x*size.y);
    let settled=false;
    const accept=(values,rank,label,sampleMeters,sharper=false,surveys=[])=>{
      if(controller.signal.aborted||!progress.accept(values,rank,sharper))return;
      cv._cspHasContent=true;
      cv.dataset.cspQuality=String(Math.max(+cv.dataset.cspQuality||0,rank));
      cv._cspSourceCounts={1:progress.counts[1],2:progress.counts[2],3:progress.counts[3],5:progress.counts[5]};
      if(surveys.length){cv._cspSurveySources||={};cv._cspSurveySources[rank]=surveys;}
      cv._cspSourceResolution=cv._cspSourceResolution||{};if(Number.isFinite(sampleMeters))cv._cspSourceResolution[rank]=sampleMeters;
      cv.dataset.cspElevationSource=[5,3,2,1].filter(rank=>progress.counts[rank]>0).map(rank=>CSPPublicTerrain.SOURCES[rank].label).join(" + ");
      this._store.set(key,{cv,elev:progress.grid,coords:{...coords}});
      this._paint(cv,progress.grid,coords);
      if(!settled){settled=true;done(null,cv);}
      this.fire("tilerefine",{tile:cv,coords});
    };
    const load=async(template,native,rank,label,sharper=false)=>{
      const scale=2**(coords.z-native),x=Math.floor(coords.x/scale),y=Math.floor(coords.y/scale);
      const url=typeof template==="function"?template({z:native,x,y}):template.replace("{z}",native).replace("{x}",x).replace("{y}",y);
      const source=await elevationRequests.request(url,signal=>typeof template==="function"?fetchPublicElevation(url,signal):fetchElevation(url,signal),
        {signal:controller.signal,priority:sharper?0:rank===5?2:rank,group:sharper?"sharp":rank===5?"dnr":rank===3?"detail":rank===2?"national":"overview"});
      if(!source||controller.signal.aborted)return;
      const crop=scale>1?{x:(coords.x%scale)*source.width/scale,y:(coords.y%scale)*source.height/scale,width:source.width/scale,height:source.height/scale}:null;
      let values=!crop&&source.width===size.x&&source.height===size.y?source.grid:
        ElevationTileCore.resampleElevation(source.grid,source.width,source.height,crop,size.x,size.y,{smooth:true});
      const sampleMeters=typeof sourceSampleMeters==="function"?sourceSampleMeters({z:native,x,y}):null;
      accept(values,rank,label,sampleMeters,sharper,source.surveys||[]);
    };
    /* On high-density screens this tile holds the next zoom's data (dz), which
       is four times the tiles - and four times the raw-LiDAR renders on the
       engine - of the zoom on screen. Loading all of that before anything
       appeared is what made terrain slow. So the first pass asks for exactly
       what the zoom on screen always did (one request shared by four tiles),
       and the next zoom's data follows at low priority, replacing it in
       place. Raw 1 m LiDAR starts at on-screen z13, as it always has. */
    const shown=coords.z-dz,sources=[];
    if(PROXY&&this.options.dnrEndpoint&&dnrTileAllowed(coords))
      sources.push([api(`${this.options.dnrEndpoint}/{z}/{x}/{y}.png?acquire=0&revision=${dnrStatus?.revision||0}`),18,5,"WA DNR elevation"]);
    if(PROXY&&this.options.rawEndpoint&&shown>=13)
      sources.push([api(`${this.options.rawEndpoint}/{z}/{x}/{y}.png?${RAW_COVERAGE_QUERY}`),this.options.rawNativeZoom??coords.z,3,"USGS 3.3 ft"]);
    if(PROXY&&this.options.nationalEndpoint&&(shown>=13||this.options.refineOverview))
      sources.push([api(`${this.options.nationalEndpoint}/{z}/{x}/{y}.png`),this.options.nationalNativeZoom??coords.z,2,"National elevation"]);
    if(!PROXY&&this.options.fallback)
      sources.push([CSPPublicTerrain.nationalUrl,18,2,"USGS 3DEP elevation"]);
    if(this.options.fallback)
      sources.push([this.options.fallback,this.options.fallbackNativeZoom??coords.z,1,"Overview elevation"]);
    // Dispatch preferred sources immediately. A stalled overview cannot hold
    // higher-resolution terrain hostage; response order never reduces quality.
    const jobs=sources.map(([template,max,rank,label])=>load(template,Math.min(shown,max),rank,label));
    Promise.allSettled(jobs).then(async results=>{
      if(controller.signal.aborted)return;
      if(!settled){settled=true;done(new Error("Elevation unavailable"),cv);}
      const best=sources.find(([,,rank])=>progress.counts[rank]>0);
      if(best&&Math.min(coords.z,best[1])>Math.min(shown,best[1]))
        await load(best[0],Math.min(coords.z,best[1]),best[2],best[3],true).catch(()=>{});
      if(controller.signal.aborted)return;
      cv._cspRefining=false;cv._cspRefineFailed=results.some(result=>result.status==="rejected");
      if(this._pending.get(key)===pending)this._pending.delete(key);
      this.fire("tilerefine",{tile:cv,coords});
    });
  },
  setSourceOptions:function(options){
    if(this.options.sourceKey===options.sourceKey)return;
    // A changed DNR source intent must drop its old pixels at once, even
    // if their replacements later fail; other source changes keep the
    // keep-visible-until-replacement behaviour below.
    const dnrSeg=k=>{const m=/dnr:[^|]*/.exec(k||"");return m?m[0]:""};
    const dnrChanged=dnrSeg(this.options.sourceKey)!==dnrSeg(options.sourceKey);
    Object.assign(this.options,options);
    if(dnrChanged){
      for(const pending of this._pending.values())pending.controller.abort();
      this._pending.clear();
      this._store.clear();
      for(const tile of Object.values(this._tiles||{})){
        const el=tile.el;if(!el?.width)continue;
        el.getContext("2d")?.clearRect(0,0,el.width,el.height);
        el._cspHasContent=false;el._cspSourceCounts={};el._cspSurveySources={};delete el.dataset.cspQuality;
      }
    }
    // Keep existing canvases visible until their first replacement arrives.
    // Repaint in place; source changes do not rebuild the Leaflet tile grid.
    for(const tile of Object.values(this._tiles||{})){
      if(tile.current===false||!tile.el?.width)continue;
      this._loadTile(this._source(tile.coords),tile.el,()=>{});
    }
  },
  _paint:function(cv, elev){
    const ctx=cv.getContext("2d"), w=cv.width, h=cv.height;
    const settings=this.options.render;
    if(elev&&elevGpu.paint(cv,elev,settings)) return;
    const im=ctx.createImageData(w,h);
    if(elev) elevationColours(elev,w*h,settings,im.data);
    ctx.putImageData(im,0,0);
  },
  setRender:function(settings){                  // no refetch: repaint what is held
    this.options.render=settings;
    this._store.forEach(t=>this._paint(t.cv,t.elev,t.coords));
  }
});

/* Relief that reads at every scale. Slopes averaged over a zoomed-out pixel
   - kilometres of ground - are gentle, so a true-scale hillshade of a
   continent comes out as a flat grey smear. The shading therefore uses Esri's
   scaled z-factor, z = 1 + 0.024 * cellsize^0.664 (their defaults): about 1x
   at lidar scales, 1.5x at 100 m cells, 9x at a continental 6 km cell. It
   applies to lighting only - slope, aspect and contours stay true values. */
const SHADED_STYLES=new Set(["hs","hsmulti","tint"]);
function reliefZFactor(cellMetres){ return 1+0.024*Math.pow(Math.max(0,cellMetres),0.664) }
function reliefResolution(cellMetres,style){
  return SHADED_STYLES.has(style)?cellMetres/reliefZFactor(cellMetres):cellMetres;
}
function tileGroundResolution(coords){
  const count=Math.pow(2,coords.z);
  const latitude=Math.atan(Math.sinh(Math.PI*(1-2*(coords.y+0.5)/count)));
  return 156543.03392804097*Math.cos(latitude)/count;
}

/* Every analytical terrain style now uses the same progressive elevation
   tile: public Terrarium for an immediate complete frame, national 3DEP from
   the M2 when connected, and raw 1 m DEM pixels as an in-place refinement.
   The palette is therefore identical across sources and Leaflet never stacks
   differently coloured images over one another. */
ElevLayer.prototype._cspExpensive=true;   // loads once per pinch, at lift-off
const AnalyticTerrainLayer=ElevLayer.extend({
  _paint:function(canvas,elevation,coords){
    const context=canvas.getContext("2d"),width=canvas.width,height=canvas.height;
    context.clearRect(0,0,width,height);
    canvas.dataset.cspStyle=this.options.style||"hs";
    canvas.dataset.cspSource=this.options.sourceLabel||"national";
    if(!elevation){canvas._cspHasContent=false;return}
    const groundResolution=reliefResolution(tileGroundResolution(coords||canvas._cspCoords),this.options.style);
    if(terrainGpu.paint(canvas,elevation,groundResolution,this.options.style)){
      canvas._cspHasContent=CSPTerrainRaster.hasData({grid:elevation});return;
    }
    const rgba=CSPTerrainRaster.renderRgba(this.options.style,{grid:elevation,width,height,groundRes:groundResolution,lighting:terrainLighting()});
    const image=context.createImageData(width,height);image.data.set(rgba);context.putImageData(image,0,0);
    canvas.dataset.cspRenderer="cpu";
    canvas._cspHasContent=CSPTerrainRaster.hasData({grid:elevation});
  }
});

