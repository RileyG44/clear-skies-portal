'use strict';
/* Real WebGL engine against an independent CPU minimum/Gaussian reference.
 * Includes radius/downsample boundaries, viewport edges, and missing data.
 * Run: node scripts/performance/relative-elevation-regression.js [chrome|webkit]
 * Follows the repository's GPU_2D_TERRAIN_SPEC real-GPU browser workflow. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),which=process.argv[2]||'webkit';
const pw=require(which==='webkit'?'/Users/riley/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core':'/Users/riley/.npm/_npx/31e32ef8478fbf80/node_modules/playwright');

async function regression(){
  const results=[];
  function filter(input,radius,axis,minimum){
    const {w,h,v,valid}=input,out={w,h,v:new Float32Array(w*h),valid:new Uint8Array(w*h)},sigma=Math.max(.5,radius/2);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      let total=minimum?Infinity:0,weight=0;
      for(let k=-radius;k<=radius;k++){
        const xx=x+(axis===0?k:0),yy=y+(axis===1?k:0);
        if(xx<0||yy<0||xx>=w||yy>=h||!valid[yy*w+xx])continue;
        if(minimum){total=Math.min(total,v[yy*w+xx]);weight=1;}
        else{const g=Math.exp(-k*k/(2*sigma*sigma));total+=g*v[yy*w+xx];weight+=g;}
      }
      if(weight){out.v[y*w+x]=minimum?total:total/weight;out.valid[y*w+x]=1;}
    }
    return out;
  }
  function reference(field,radius,minimum){
    const factor=Math.min(64,Math.max(1,Math.ceil(radius/32))),r=Math.max(1,Math.min(32,Math.round(radius/factor)));
    let out={w:Math.ceil(field.w/factor),h:Math.ceil(field.h/factor)};
    out.v=new Float32Array(out.w*out.h);out.valid=new Uint8Array(out.v.length);
    for(let y=0;y<out.h;y++)for(let x=0;x<out.w;x++){
      let value=minimum?Infinity:0,count=0;
      for(let j=0;j<factor;j++)for(let i=0;i<factor;i++){
        const xx=x*factor+i,yy=y*factor+j;
        if(xx>=field.w||yy>=field.h||!field.valid[yy*field.w+xx])continue;
        value=minimum?Math.min(value,field.v[yy*field.w+xx]):value+field.v[yy*field.w+xx];count++;
      }
      if(count){out.v[y*out.w+x]=minimum?value:value/count;out.valid[y*out.w+x]=1;}
    }
    if(minimum)out=filter(filter(out,r,0,true),r,1,true);
    return {...filter(filter(out,r,0,false),r,1,false),factor};
  }
  function sample(field,x,y){
    const qx=(x+.5)/field.factor-.5,qy=(y+.5)/field.factor-.5,bx=Math.floor(qx),by=Math.floor(qy),fx=qx-bx,fy=qy-by;
    let total=0,weight=0;
    for(let j=0;j<2;j++)for(let i=0;i<2;i++){
      const xx=Math.max(0,Math.min(field.w-1,bx+i)),yy=Math.max(0,Math.min(field.h-1,by+j)),k=(i?fx:1-fx)*(j?fy:1-fy);
      if(field.valid[yy*field.w+xx]&&k>0){total+=field.v[yy*field.w+xx]*k;weight+=k;}
    }
    return weight?total/weight:NaN;
  }
  for(const missing of [false,true])for(const radius of [.75,1,6,8,13,14,22,31,32,33,127,2048,2300]){
    const canvas=document.createElement('canvas');document.body.append(canvas);
    const listeners=new Set(),grid=new Float32Array(256*256);
    for(let y=0;y<256;y++)for(let x=0;x<256;x++)grid[y*256+x]=missing&&((x-115)**2+(y-123)**2<100||x>145)?NaN:
      500+30*Math.sin(x/11)*Math.cos(y/19)+x*.17+y*.09;
    const record={key:'fixture/0/0/0',sourceId:'fixture',rank:1,z:0,x:0,y:0,width:256,height:256,grid,revision:1};
    const source={id:'fixture',rank:1,allowed:()=>true};
    const store={options:{sources:()=>[source]},on:(event,fn)=>listeners.add(fn),off:(event,fn)=>listeners.delete(fn),
      want(){},get:()=>record,finestFor:()=>record};
    const shaders={VERSION:'test',SHADE_UNIFORMS:[],metersPerPixel:()=>1,uniformValues:()=>({}),
      fullscreenVertexSource:'#version 300 es\nout vec2 v_screenUv;void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));v_screenUv=vec2(p.x,1.-p.y);gl_Position=vec4(p*2.-1.,0.,1.);}',
      shadeFragmentSource:prelude=>'#version 300 es\nprecision highp float;precision highp int;\n'+prelude+
        '\nin vec2 v_screenUv;out vec4 color;void main(){ivec2 p=ivec2(v_screenUv*vec2(csp_size()));color=csp_valid(p)?vec4(.2,.3,.4,1.):vec4(0.);}' };
    const errors=[],engine=CSPGpuTerrainEngine.create({canvas,store,shaders,onError:e=>errors.push(String(e))});
    if(!engine)throw Error('Engine unavailable: '+errors.join(';'));
    try{
      const view={centerMerc:[.5,.5],zoom:0,bearing:0,cssSize:[97,81],dpr:1,dz:0};
      engine.setState({terrain:{stack:{layers:[{style:'rem'}],remRadius:radius}}});
      listeners.forEach(fn=>fn(record));engine.render(view);
      const drawCalls=engine.stats().drawCalls,height=engine.debugReadHeight(),w=height.width,h=height.height;
      const field={w,h,v:new Float32Array(w*h),valid:new Uint8Array(w*h)};
      // GPU filter windows are anchored at the framebuffer's bottom left.
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){
        const i=((h-1-y)*w+x)*2;field.v[y*w+x]=height.data[i];field.valid[y*w+x]=height.data[i+1]>0?1:0;
      }
      const actual=engine.sampleValues(),expected=[];
      if(radius>=1){const base=reference(field,radius,true);
        for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(field.valid[y*w+x]){
          const b=sample(base,x,y);if(Number.isFinite(b))expected.push(Math.max(0,field.v[y*w+x]-b));
        }
      }
      if(actual.relative.length!==expected.length)throw Error(`Validity mismatch ${radius}/${missing}`);
      let maxError=0;
      for(let i=0;i<expected.length;i++)maxError=Math.max(maxError,Math.abs(actual.relative[i]-expected[i]));
      if(maxError>.002)throw Error(`Relative elevation error ${maxError}m at radius ${radius}/${missing}: `+
        JSON.stringify(expected.map((v,i)=>({i,expected:v,actual:actual.relative[i],delta:actual.relative[i]-v})).filter(v=>Math.abs(v.delta)>.002).slice(0,8)));
      if(radius>=1&&radius<8&&drawCalls!==6)throw Error('Unnecessary factor-one copy: '+drawCalls);
      if(!engine.stats().ready||engine.stats().error)throw Error(JSON.stringify(engine.stats()));
      // A detail-only change must invalidate its kernel without losing the
      // existing relative-elevation field or issuing elevation requests.
      engine.setState({terrain:{stack:{layers:[{style:'rem'}],remRadius:radius,detail:.4,detailRadius:3}}});
      engine.render(view);
      const second=engine.sampleValues();
      for(let i=0;i<actual.relative.length;i++)if(Math.abs(second.relative[i]-actual.relative[i])>.002)throw Error('Kernel state leaked between detail and base');
      results.push({radius,missing,samples:expected.length,maxErrorMetres:maxError,drawCalls});
      if(radius===6)for(const style of ['rem','tint']){
        const pictures=[];
        // Force the previous derivative path and compare every output byte
        // with the optimized production ramp, including its nodata boundary.
        for(const forceGradient of [false,true]){
          const cv=document.createElement('canvas');document.body.append(cv);
          const production={...CSPGpuTerrainShaders,uniformValues:(s,v)=>{
            const u=CSPGpuTerrainShaders.uniformValues(s,v);if(forceGradient)u.u_stackGradient=1;return u;}};
          const e=CSPGpuTerrainEngine.create({canvas:cv,store,shaders:production});
          if(!e)throw Error('Production shader unavailable');
          try{
            e.setState({terrain:{style,opacity:1,stack:{detail:.3,detailRadius:3,remRadius:6,
              layers:[{style,param:0,min:style==='rem'?0:480,max:style==='rem'?30:570,
                stops:[[0,.1,.2,.3,1],[1,.9,.8,.7,1]]}]}},spectrum:{spectrumOn:false}});
            listeners.forEach(fn=>fn(record));e.render(view);
            const gl=cv.getContext('webgl2'),pixels=new Uint8Array(w*h*4);
            gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,pixels);pictures.push(pixels);
          }finally{e.destroy();cv.remove();}
        }
        if(pictures[0].some((v,i)=>v!==pictures[1][i]))throw Error(`Derivative optimization changed ${style}/${missing} pixels`);
      }
    }finally{engine.destroy();canvas.remove();}
  }
  return results;
}
(async()=>{
  const browser=which==='webkit'?await pw.webkit.launch():await pw.chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
  try{
    const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
    await page.setContent('<html><body></body></html>');
    for(const file of ['elevation-tile-core.js','terrain-core.js','terrain-raster.js','elevation-bands.js','terrain-drape-core.js','gpu-terrain-shaders.js','gpu-terrain-engine.js'])
      await page.addScriptTag({content:fs.readFileSync(path.join(root,file),'utf8')});
    const results=await page.evaluate(regression);assert.deepEqual(errors,[]);
    const out=path.join(root,'output/performance-audit/relative-elevation');fs.mkdirSync(out,{recursive:true});
    fs.writeFileSync(path.join(out,which+'.json'),JSON.stringify({browser:which,results,errors},null,2)+'\n');
    console.log(JSON.stringify({browser:which,checks:results.length,maxErrorMetres:Math.max(...results.map(r=>r.maxErrorMetres))}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
