/* Fixed, camera-facing-at-placement markup planes for MapLibre's Mercator view.
   Saved GeoJSON remains a geographic encoding of plane-local XY. Navigation
   changes only the projection matrix, never the saved anchor or plane axes. */
(function(){
"use strict";
const GEO_CIRC=40075016.686, GL_CIRC=2*Math.PI*6371008.8;
const MAX_LAT=85.0511287798066, MAX_EXTENT=1e7, MAX_TEXTURE=2048;
const TOTAL_PIXELS=8*1024*1024, FEATURE_PIXELS=1024*1024;
const views=new WeakMap();
const finite=a=>a.every(Number.isFinite);
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const sub=(a,b)=>a.map((x,i)=>x-b[i]);
const unit=a=>{const n=Math.hypot(...a);return n>1e-15&&finite(a)?a.map(x=>x/n):null};
const scaleAt=(lat,circ=GL_CIRC)=>1/(circ*Math.cos(lat*Math.PI/180));
const merc=(lng,lat)=>[(lng+180)/360,(1-Math.log(Math.tan(Math.PI/4+lat*Math.PI/360))/Math.PI)/2];
const geographic=p=>({lng:p[0]*360-180,lat:(2*Math.atan(Math.exp((1-2*p[1])*Math.PI))-Math.PI/2)*180/Math.PI});
function apply(m,p){return [0,1,2,3].map(r=>m[r]*p[0]+m[4+r]*p[1]+m[8+r]*p[2]+m[12+r]*p[3])}
function divide(p){return Number.isFinite(p[3])&&Math.abs(p[3])>1e-18?p.slice(0,3).map(x=>x/p[3]):null}
/* Gauss-Jordan in Float64 keeps the camera/anchor subtraction on the CPU. */
function inverse(m){
  const rows=Array.from({length:4},(_,r)=>Array.from({length:8},(_,c)=>c<4?m[c*4+r]:+(c-4===r)));
  for(let c=0;c<4;c++){
    let k=c;for(let r=c+1;r<4;r++)if(Math.abs(rows[r][c])>Math.abs(rows[k][c]))k=r;
    if(!Number.isFinite(rows[k][c])||Math.abs(rows[k][c])<1e-20)return null;
    [rows[k],rows[c]]=[rows[c],rows[k]];
    const d=rows[c][c];for(let j=0;j<8;j++)rows[c][j]/=d;
    for(let r=0;r<4;r++)if(r!==c){const f=rows[r][c];for(let j=0;j<8;j++)rows[r][j]-=f*rows[c][j]}
  }
  const out=new Float64Array(16);for(let r=0;r<4;r++)for(let c=0;c<4;c++)out[c*4+r]=rows[r][c+4];
  return finite(Array.from(out))?out:null;
}
function dimensions(v){const c=v.getCanvas?.();return {width:c?.clientWidth||0,height:c?.clientHeight||0}}
function frame(v,args){
  const state=views.get(v),m=args?.defaultProjectionData?.mainMatrix;
  /* Globe has no single planar world matrix. This layer deliberately supports
     Mercator only, which is the application's terrain projection. */
  const projection=v.getProjection?.()?.type;
  if(!state||!m||m.length!==16||(projection&&projection!=="mercator")){if(state)state.frame=null;return null}
  const matrix=new Float64Array(m),inv=inverse(matrix),d=dimensions(v);
  if(!inv||!d.width||!d.height)return state.frame=null;
  /* A perspective camera maps to homogeneous clip [0,0,1,0]. Unlike the
     near-plane unprojection, this gives the actual optical origin. */
  const camera=divide(apply(inv,[0,0,1,0]));
  if(!camera||!finite(camera))return state.frame=null;
  return state.frame={matrix,inv,camera,...d};
}
function ray(f,px){
  if(!f||!px||!Number.isFinite(px.x)||!Number.isFinite(px.y))return null;
  const x=2*px.x/f.width-1,y=1-2*px.y/f.height;
  const near=divide(apply(f.inv,[x,y,-1,1]));
  const direction=near&&unit(sub(near,f.camera));
  return direction?{origin:f.camera,direction}:null;
}
function plane(space){
  if(!space||!Array.isArray(space.anchor)||space.anchor.length!==3||!finite(space.anchor)||Math.abs(space.anchor[1])>MAX_LAT)return null;
  if(!Array.isArray(space.right)||!Array.isArray(space.up)||space.right.length!==3||space.up.length!==3)return null;
  const right=unit(space.right),up=unit(space.up);
  if(!right||!up||Math.abs(dot(right,up))>1e-4)return null;
  const n=unit(cross(right,up));if(!n)return null;
  const a=merc(space.anchor[0],space.anchor[1]),s=scaleAt(space.anchor[1]);
  return {anchor:[a[0],a[1],space.anchor[2]*s],right:[right[0],-right[1],right[2]],up:[up[0],-up[1],up[2]],normal:[n[0],-n[1],n[2]],scale:s,geoScale:scaleAt(space.anchor[1],GEO_CIRC)};
}
function local(coords,p){
  const lng=Array.isArray(coords)?coords[0]:coords?.lng,lat=Array.isArray(coords)?coords[1]:coords?.lat;
  if(!Number.isFinite(lng)||!Number.isFinite(lat)||Math.abs(lat)>MAX_LAT)return null;
  const q=merc(lng,lat);let dx=q[0]-p.anchor[0];dx-=Math.round(dx);
  return [dx/p.geoScale,(p.anchor[1]-q[1])/p.geoScale];
}
function world(xy,p){return p.anchor.map((a,i)=>a+p.scale*(p.right[i]*xy[0]+p.up[i]*xy[1]))}
function localGeographic(xy,p){return geographic([p.anchor[0]+xy[0]*p.geoScale,p.anchor[1]-xy[1]*p.geoScale])}
function createPlacement(v,px,distanceM){
  const f=views.get(v)?.frame,r=ray(f,px);
  if(!r||!Number.isFinite(distanceM)||distanceM<=0||distanceM>MAX_EXTENT)return null;
  const cameraLL=geographic(f.camera),d=distanceM*scaleAt(cameraLL.lat);
  const at=r.origin.map((x,i)=>x+r.direction[i]*d),ll=geographic(at);
  if(!finite([ll.lng,ll.lat])||Math.abs(ll.lat)>MAX_LAT)return null;
  /* Inverse projection differentials are screen-right/up directions. They
     remain fixed world directions after this one placement operation. */
  const a=divide(apply(f.inv,[-1,0,-1,1])),b=divide(apply(f.inv,[1,0,-1,1]));
  const c=divide(apply(f.inv,[0,-1,-1,1])),e=divide(apply(f.inv,[0,1,-1,1]));
  if(!a||!b||!c||!e)return null;
  const enu=q=>[q[0],-q[1],q[2]],right=unit(enu(sub(b,a))),up=unit(enu(sub(e,c)));
  if(!right||!up)return null;
  const anchor=[ll.lng,ll.lat,at[2]/scaleAt(ll.lat)],space={anchor,right,up,metresPerPixel:1};
  const p=plane(space);if(!p)return null;
  const q=screenToGround(v,{x:px.x+1,y:px.y},space),xy=q&&local(q,p);
  if(!xy)return null;space.metresPerPixel=Math.hypot(...xy);
  return Number.isFinite(space.metresPerPixel)&&space.metresPerPixel>0?space:null;
}
function screenToGround(v,px,space){
  const p=plane(space),r=ray(views.get(v)?.frame,px);if(!p||!r||!isVisible(v,space))return null;
  const den=dot(r.direction,p.normal);if(Math.abs(den)<1e-10)return null;
  const t=dot(sub(p.anchor,r.origin),p.normal)/den;if(t<=0||!Number.isFinite(t))return null;
  const q=r.origin.map((x,i)=>x+r.direction[i]*t-p.anchor[i]);
  const xy=[dot(q,p.right)/p.scale,dot(q,p.up)/p.scale];
  if(!finite(xy)||Math.max(...xy.map(Math.abs))>MAX_EXTENT)return null;
  return localGeographic(xy,p);
}
function isVisible(v,space){
  const f=views.get(v)?.frame,p=plane(space);
  return !!(f&&p&&dot(sub(f.camera,p.anchor),p.normal)>1e-12);
}
function project(v,coords,space){
  const f=views.get(v)?.frame,p=plane(space),xy=p&&local(coords,p);if(!f||!xy||!isVisible(v,space))return {x:NaN,y:NaN,visible:false};
  const q=apply(f.matrix,[...world(xy,p),1]);
  if(!finite(q)||q[3]<=0)return {x:NaN,y:NaN,visible:false};
  const x=q[0]/q[3],y=q[1]/q[3],z=q[2]/q[3];
  return {x:(x+1)*f.width/2,y:(1-y)*f.height/2,visible:x>=-1&&x<=1&&y>=-1&&y<=1&&z>=-1&&z<=1};
}
function coordinateList(g){
  if(g?.type==="Point")return [g.coordinates];
  if(g?.type==="LineString")return g.coordinates;
  if(g?.type==="Polygon")return g.coordinates.flat();
  return [];
}
function bounds(feature,p,ctx){
  const prop=feature.properties,coords=coordinateList(feature.geometry),xy=coords.map(c=>local(c,p));
  if(!xy.length||xy.some(q=>!q||!finite(q)))return null;
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  for(const q of xy){minX=Math.min(minX,q[0]);maxX=Math.max(maxX,q[0]);minY=Math.min(minY,q[1]);maxY=Math.max(maxY,q[1])}
  const width=Math.abs(Number(prop.width)||0),size=Math.abs(Number(prop.size)||20);
  let margin=Math.max(width*5+5,(Number(prop.space3d.metresPerPixel)||1)*4,.05);
  if(prop.kind==="circle")margin+=Math.abs(Number(prop.radius)||0);
  if(prop.kind==="text"||prop.kind==="pin"){
    const fs=prop.kind==="pin"?13.2:24,lines=String(prop.text||"").split("\n");
    ctx.font=`650 ${fs}px -apple-system, BlinkMacSystemFont, sans-serif`;
    const textWidth=Math.max(0,...lines.map(t=>ctx.measureText(t).width));
    const halfHeight=(lines.length*fs*1.2)/2+fs*.25;
    const halfWidth=prop.kind==="pin"?textWidth+10+fs*.2:textWidth/2+fs*.2;
    margin+=Math.max(26,Math.hypot(halfWidth,halfHeight+ (prop.kind==="pin"?15:0)))*size/24;
  }
  minX-=margin;maxX+=margin;minY-=margin;maxY+=margin;
  const w=maxX-minX,h=maxY-minY;
  return finite([minX,minY,maxX,maxY])&&w>0&&h>0&&Math.max(w,h)<MAX_EXTENT?{minX,minY,maxX,maxY,w,h}:null;
}
function compile(gl,type,source){
  const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);
  if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){const error=gl.getShaderInfoLog(shader);gl.deleteShader(shader);throw new Error(`3D markup shader: ${error}`)}return shader;
}
function createProgram(gl){
  const vertex=compile(gl,gl.VERTEX_SHADER,`#version 300 es
in vec2 a_position;in vec2 a_uv;uniform mat4 u_matrix;out vec2 v_uv;
void main(){v_uv=a_uv;gl_Position=u_matrix*vec4(a_position,0.0,1.0);}`);
  let fragment=null,program=null;
  try{
    fragment=compile(gl,gl.FRAGMENT_SHADER,`#version 300 es
precision highp float;in vec2 v_uv;uniform sampler2D u_texture;uniform float u_opacity;out vec4 color;
void main(){color=texture(u_texture,v_uv)*u_opacity;if(color.a<0.0039)discard;}`);
    program=gl.createProgram();gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(`3D markup program: ${gl.getProgramInfoLog(program)}`);
    return program;
  }catch(error){if(program)gl.deleteProgram(program);throw error}
  finally{gl.deleteShader(vertex);if(fragment)gl.deleteShader(fragment)}
}
/* Compose mainMatrix * [fixed plane axes / anchor] in Float64 first. Its
   translation column subtracts the large world coordinates before float32
   upload; the GPU receives only metre-sized vertex offsets. */
function planeMatrix(matrix,p){
  const out=new Float32Array(16);
  const cols=[[...p.right.map(x=>x*p.scale),0],[...p.up.map(x=>x*p.scale),0],[0,0,0,0],[...p.anchor,1]];
  cols.forEach((c,i)=>out.set(apply(matrix,c),i*4));return out;
}
function createLayer(module,v,getLayers,drawGround){
  let gl=null,program=null,vao=null,buffer=null,locations=null,dirty=true,signature="",entries=[];
  const state={frame:null},layer={id:"csp-world-markup",type:"custom",renderingMode:"3d"};
  const release=entry=>{if(entry.texture&&gl)gl.deleteTexture(entry.texture)};
  const fontsChanged=()=>{entries.forEach(e=>e.revision=null);layer.refresh()};
  const clear=()=>{entries.forEach(release);entries=[]};
  layer.refresh=()=>{dirty=true;v.triggerRepaint?.()};
  function raster(feature,color,p,pixelBudget){
    const canvas=document.createElement("canvas"),ctx=canvas.getContext("2d");if(!ctx)return null;
    const b=bounds(feature,p,ctx);if(!b)return null;
    const preferred=Math.max(.001,(Number(feature.properties.space3d.metresPerPixel)||1)/2);
    const limit=Math.min(MAX_TEXTURE,gl.getParameter(gl.MAX_TEXTURE_SIZE));
    let mpp=Math.max(preferred,b.w/limit,b.h/limit,Math.sqrt(b.w*b.h/pixelBudget));
    let width=Math.max(1,Math.ceil(b.w/mpp)),height=Math.max(1,Math.ceil(b.h/mpp));
    /* Rounding must not overrun the budget, including a very narrow feature. */
    if(width*height>pixelBudget){mpp=Math.max(mpp,Math.max(b.w,b.h)/Math.max(1,Math.floor(Math.sqrt(pixelBudget))));width=Math.max(1,Math.ceil(b.w/mpp));height=Math.max(1,Math.ceil(b.h/mpp))}
    canvas.width=width;canvas.height=height;
    const projectLocal=ll=>{const q=local(ll,p);return q?{x:(q[0]-b.minX)/mpp,y:(b.maxY-q[1])/mpp}:{x:NaN,y:NaN}};
    drawGround(ctx,[feature],color,projectLocal,()=>mpp);
    const texture=gl.createTexture(),previousTexture=gl.getParameter(gl.TEXTURE_BINDING_2D);gl.bindTexture(gl.TEXTURE_2D,texture);
    const flip=gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL),premultiply=gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL);
    try{
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,canvas);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    }catch(error){gl.deleteTexture(texture);throw error}
    finally{gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,flip);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,premultiply);gl.bindTexture(gl.TEXTURE_2D,previousTexture);canvas.width=canvas.height=0}
    /* Account for ceil() padding: keep texel-to-world scale isotropic. */
    const x0=b.minX,x1=x0+width*mpp,y1=b.maxY,y0=y1-height*mpp;
    return {texture,p,vertices:new Float32Array([x0,y0,0,0,x1,y0,1,0,x0,y1,0,1,x0,y1,0,1,x1,y0,1,0,x1,y1,1,1])};
  }
  function reconcile(layers){
    const active=layers.filter(l=>l.visible&&Number(l.opacity)>0).sort((a,b)=>(a.rank||0)-(b.rank||0));
    const count=active.reduce((n,l)=>n+(l.doc.features||[]).filter(f=>f.properties?.space3d).length,0);
    const budget=Math.min(FEATURE_PIXELS,Math.max(1,Math.floor(TOTAL_PIXELS/Math.max(1,count))));
    const previous=new Map(entries.map(e=>[e.key,e])),next=[];
    try{for(const source of active){
      const alpha=Math.max(0,Math.min(1,Number(source.opacity)/100));
      (source.doc.features||[]).forEach((feature,index)=>{
        if(!feature.properties?.space3d)return;
        const p=plane(feature.properties.space3d);if(!p)return;
        const key=`${source.doc.markup.id}:${feature.properties.fid??index}`;
        const revision=`${source.renderRevision}:${source.doc.markup.color}:${budget}`;
        let entry=previous.get(key);previous.delete(key);
        if(entry&&entry.revision!==revision){release(entry);entry=null}
        if(!entry){entry=raster(feature,source.doc.markup.color,p,budget);if(entry)Object.assign(entry,{key,revision})}
        if(entry){entry.alpha=alpha;next.push(entry)}
      });
    }}finally{previous.forEach(release);entries=next}
    dirty=false;
  }
  layer.onAdd=(map,context)=>{
    gl=context;views.set(v,state);dirty=true;signature="";
    program=createProgram(gl);vao=gl.createVertexArray();buffer=gl.createBuffer();
    locations={position:gl.getAttribLocation(program,"a_position"),uv:gl.getAttribLocation(program,"a_uv"),matrix:gl.getUniformLocation(program,"u_matrix"),texture:gl.getUniformLocation(program,"u_texture"),opacity:gl.getUniformLocation(program,"u_opacity")};
    document.fonts?.addEventListener?.("loadingdone",fontsChanged);
  };
  layer.render=(context,args)=>{
    if(!program||!frame(v,args))return;
    const old={program:gl.getParameter(gl.CURRENT_PROGRAM),vao:gl.getParameter(gl.VERTEX_ARRAY_BINDING),buffer:gl.getParameter(gl.ARRAY_BUFFER_BINDING),active:gl.getParameter(gl.ACTIVE_TEXTURE),blend:gl.isEnabled(gl.BLEND),depth:gl.isEnabled(gl.DEPTH_TEST),cull:gl.isEnabled(gl.CULL_FACE),depthFunc:gl.getParameter(gl.DEPTH_FUNC),depthMask:gl.getParameter(gl.DEPTH_WRITEMASK),cullMode:gl.getParameter(gl.CULL_FACE_MODE),front:gl.getParameter(gl.FRONT_FACE),equationRGB:gl.getParameter(gl.BLEND_EQUATION_RGB),equationAlpha:gl.getParameter(gl.BLEND_EQUATION_ALPHA),srcRGB:gl.getParameter(gl.BLEND_SRC_RGB),dstRGB:gl.getParameter(gl.BLEND_DST_RGB),srcAlpha:gl.getParameter(gl.BLEND_SRC_ALPHA),dstAlpha:gl.getParameter(gl.BLEND_DST_ALPHA)};
    gl.activeTexture(gl.TEXTURE0);old.texture=gl.getParameter(gl.TEXTURE_BINDING_2D);
    try{
      const sources=Array.from(getLayers()||[]);
      const nextSignature=JSON.stringify(sources.map(l=>[l.doc.markup.id,l.renderRevision,l.visible,l.opacity,l.rank,l.doc.markup.color]));
      if(dirty||nextSignature!==signature){reconcile(sources);signature=nextSignature}
      if(!entries.length)return;
      gl.useProgram(program);gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
      gl.enableVertexAttribArray(locations.position);gl.vertexAttribPointer(locations.position,2,gl.FLOAT,false,16,0);
      gl.enableVertexAttribArray(locations.uv);gl.vertexAttribPointer(locations.uv,2,gl.FLOAT,false,16,8);
      gl.uniform1i(locations.texture,0);
      gl.enable(gl.BLEND);gl.blendEquation(gl.FUNC_ADD);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
      gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.depthMask(false);
      gl.enable(gl.CULL_FACE);gl.cullFace(gl.BACK);gl.frontFace(gl.CCW);
      for(const entry of entries){
        gl.uniformMatrix4fv(locations.matrix,false,planeMatrix(state.frame.matrix,entry.p));
        gl.uniform1f(locations.opacity,entry.alpha);gl.bindTexture(gl.TEXTURE_2D,entry.texture);
        gl.bufferData(gl.ARRAY_BUFFER,entry.vertices,gl.DYNAMIC_DRAW);gl.drawArrays(gl.TRIANGLES,0,6);
      }
    }finally{
      gl.useProgram(old.program);gl.bindVertexArray(old.vao);gl.bindBuffer(gl.ARRAY_BUFFER,old.buffer);
      gl.bindTexture(gl.TEXTURE_2D,old.texture);gl.activeTexture(old.active);
      const restore=(flag,enabled)=>enabled?gl.enable(flag):gl.disable(flag);
      restore(gl.BLEND,old.blend);restore(gl.DEPTH_TEST,old.depth);restore(gl.CULL_FACE,old.cull);
      gl.depthFunc(old.depthFunc);gl.depthMask(old.depthMask);gl.cullFace(old.cullMode);gl.frontFace(old.front);
      gl.blendFuncSeparate(old.srcRGB,old.dstRGB,old.srcAlpha,old.dstAlpha);gl.blendEquationSeparate(old.equationRGB,old.equationAlpha);
    }
  };
  layer.onRemove=()=>{
    document.fonts?.removeEventListener?.("loadingdone",fontsChanged);
    if(views.get(v)===state)views.delete(v);state.frame=null;
    clear();if(gl){if(buffer)gl.deleteBuffer(buffer);if(vao)gl.deleteVertexArray(vao);if(program)gl.deleteProgram(program)}
    buffer=vao=program=locations=null;gl=null;dirty=true;signature="";
  };
  return layer;
}
window.CSPMarkup3D={createPlacement,screenToGround,project,isVisible,createLayer};
})();
