#!/usr/bin/env node
'use strict';
/* Numerical GPU + DOM/native-adapter integration regression. No live providers.
 * node scripts/gpu2d/water-scaling.js [chrome|webkit] */
const path=require('node:path'),fs=require('node:fs');
const root=path.resolve(__dirname,'../..'),pw=require('../lib/playwright.js');
(async()=>{
  const browser=process.argv[2]==='webkit'?await pw.webkit.launch():await pw.chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
  try{
    const page=await browser.newPage();
    await page.setContent('<div id="cspWorkspaceScroll"><div id="terStudio"></div><div id="terLegend"></div></div>');
    for(const file of ['elevation-tile-core.js','terrain-core.js','terrain-raster.js','terrain-drape-core.js','elevation-bands.js','water-geography-data.js','water-geography.js','gpu-terrain-shaders.js','lidar-render.js','lidar-studio.js','gpu-terrain-engine.js','gpu-terrain-3d-renderer.js'])await page.addScriptTag({path:path.join(root,file)});
    const result=await page.evaluate(async()=>{
      const check=(v,msg)=>{if(!v)throw new Error(msg)};
      const R=CSPLidarRender,G=CSPWaterGeography,S=CSPGpuTerrainShaders;
      const coord={z:4,x:2,y:6},size=128,n=130,view={centerMerc:[2.5/16,6.5/16],zoom:3,bearing:0,cssSize:[size,size],dpr:1,dz:1};
      const grid=new Float32Array(n*n),inner=new Float32Array(size*size),water=new Uint8Array(size*size);
      for(let y=-1;y<=size;y++)for(let x=-1;x<=size;x++){
        const merc=[(coord.x+(x+.5)/size)/16,(coord.y+(y+.5)/size)/16];
        const wet=G.waterAtMercator(...merc),h=wet?-5000+25*x:-86+4*x;
        grid[(y+1)*n+x+1]=h;
        if(x>=0&&y>=0&&x<size&&y<size){inner[y*size+x]=h;water[y*size+x]=+wet}
      }
      check(water.some(Boolean)&&water.some(v=>!v),'fixture must include land and water');
      const state=R.emptyState();state.base.tint={...R.defaultLayer('tint'),auto:true,palette:'viridis',param:0,gamma:.7,stops:[[0,'#44015455'],[1,'#fde725cc']]};
      const fit=R.fitElevation(inner,water),stack=R.buildStack(state,'tint',{base:fit});
      const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl2',{antialias:false});
      const renderer=CSPGpuTerrain3DRenderer.create({gl});check(renderer,'3D renderer startup');
      const target=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,target);gl.texStorage2D(gl.TEXTURE_2D,8,gl.RGBA8,size,size);
      const external=gl.createTexture(),sampler=gl.createSampler();gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,external);gl.bindSampler(3,sampler);
      const job={key:'coast',revision:1,grid,size,targetTexture:target,coord,groundRes:100,state:{terrain:{style:'tint',stack}}};
      renderer.renderBatch([job]);
      check(gl.getParameter(gl.TEXTURE_BINDING_2D)===external&&gl.getParameter(gl.SAMPLER_BINDING)===sampler,'3D preserves MapLibre unit 3 texture/sampler');
      const fbo=gl.createFramebuffer();gl.bindFramebuffer(gl.READ_FRAMEBUFFER,fbo);gl.framebufferTexture2D(gl.READ_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,target,0);
      const actual=new Uint8Array(size*size*4);gl.readPixels(0,0,size,size,gl.RGBA,gl.UNSIGNED_BYTE,actual);
      const expected=R.renderStack(stack,{grid:inner,width:size,height:size,res:100,water});
      let maxError=0;
      for(let i=0;i<actual.length;i++){
        const ref=i%4===3?expected[i]:Math.round(expected[i]*expected[(i>>2)*4+3]/255);
        maxError=Math.max(maxError,Math.abs(actual[i]-ref));
      }
      check(maxError<=2,'3D coastline, transparency and curve GPU/CPU parity '+maxError);
      check(renderer.stats().waterMaskBytes===16*1024*1024,'GPU geography allocation accounted');
      const uploads=renderer.stats().uploads;renderer.renderBatch([job]);check(renderer.stats().uploads===uploads,'recoloring reuses elevation');
      // 3D REM must use absolute seabed values, a land-only fallback floor,
      // and the legacy floor for a manual REM overlay in the same stack.
      const remState=R.emptyState();remState.base.rem={...R.defaultLayer('rem'),palette:'ember',param:0};
      remState.overlays=[{...R.defaultLayer('rem'),auto:false,min:0,max:10000,palette:'viridis',param:0,opacity:.25,blend:'multiply'}];
      const remStack=R.buildStack(remState,'rem',{base:{land:[0,500],water:fit.water}},{remFlatBase:-6000,remLandBase:-90});
      renderer.renderBatch([{...job,state:{terrain:{style:'rem',stack:remStack}}}]);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER,fbo);gl.readPixels(0,0,size,size,gl.RGBA,gl.UNSIGNED_BYTE,actual);
      const remExpected=R.renderStack(remStack,{grid:inner,width:size,height:size,res:100,water,flat:true});
      let remError=0;
      for(let i=0;i<actual.length;i++){
        const ref=i%4===3?remExpected[i]:Math.round(remExpected[i]*remExpected[(i>>2)*4+3]/255);
        remError=Math.max(remError,Math.abs(actual[i]-ref));
      }
      check(remError<=2,'3D REM mixed floors/water GPU/CPU parity '+remError);
      // Real lake geography must not replace supplied lakebed/shore terrain
      // with a saturated ocean ramp, even in a mixed land/ocean stack.
      let inlandChecks=0;
      for(const [name,lon,lat] of [['Lake Victoria',33,-1],['Lake Superior',-87,47.5],['Great Salt Lake',-112.5,41.2],['Dead Sea',35.47,31.5],['Caspian Sea',50,42]]){
        const z=9,scale=2**z,mx=(lon+180)/360,my=(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2;
        const lakeCoord={z,x:Math.floor(mx*scale),y:Math.floor(my*scale)},lakeGrid=new Float32Array(n*n),lakeInner=new Float32Array(size*size),floor=name==='Dead Sea'?-500:lat>35?100:1050;
        check(!G.waterAt(lon,lat),name+' keeps terrestrial relief even below sea level');
        for(let y=-1;y<=size;y++)for(let x=-1;x<=size;x++){
          const value=floor+50+50*Math.sin(x/11)*Math.cos(y/17);
          lakeGrid[(y+1)*n+x+1]=value;
          if(x>=0&&y>=0&&x<size&&y<size)lakeInner[y*size+x]=value;
        }
        for(const style of ['tint','rem']){
          const range=style==='rem'?[0,100]:[floor,floor+100];
          const layer={...remStack.layers[0],style,min:range[0],max:range[1],gamma:1,water:[-6000,0],separateRem:style==='rem'};
          const lakeStack={...remStack,layers:[layer],remFlatBase:floor,remLandBase:floor};
          renderer.renderBatch([{...job,key:name,grid:lakeGrid,coord:lakeCoord,state:{terrain:{style,stack:lakeStack}}}]);
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER,fbo);gl.readPixels(0,0,size,size,gl.RGBA,gl.UNSIGNED_BYTE,actual);
          const reference=R.renderStack({...lakeStack,layers:[{...layer,water:null}]},{grid:lakeInner,width:size,height:size,res:100,flat:true});
          let error=0;const colours=new Set();
          for(let i=0;i<actual.length;i++){
            const expected=i%4===3?reference[i]:Math.round(reference[i]*reference[(i>>2)*4+3]/255);
            error=Math.max(error,Math.abs(actual[i]-expected));
            if(i%4===0)colours.add(actual.slice(i,i+3).join(','));
          }
          check(error<=2,name+' '+style+' retains loaded terrain colors: '+error);
          check(colours.size>30,name+' '+style+' retains terrain variation');inlandChecks++;
        }
        // 2D must also include supplied inland heights in its local floor,
        // rather than treating a lake footprint as missing terrain.
        const source={id:'lake',rank:1,allowed:()=>true},record={key:`lake/${z}/${lakeCoord.x}/${lakeCoord.y}`,sourceId:'lake',rank:1,...lakeCoord,width:size,height:size,grid:lakeInner,revision:1};
        const callbacks=new Set(),store={options:{sources:()=>[source]},on:(_event,fn)=>callbacks.add(fn),off:(_event,fn)=>callbacks.delete(fn),want(){},get:()=>record,finestFor:()=>record};
        const cv=document.createElement('canvas'),e=CSPGpuTerrainEngine.create({canvas:cv,store,shaders:S});check(e,name+' 2D engine');
        try{
          const v={centerMerc:[(lakeCoord.x+.5)/scale,(lakeCoord.y+.5)/scale],zoom:z-1,bearing:0,cssSize:[size,size],dpr:1,dz:1};
          const localStack={...remStack,remRadius:S.metersPerPixel(v)*2};
          e.setState({terrain:{style:'rem',stack:localStack}});callbacks.forEach(fn=>fn(record));e.render(v);
          const samples=e.sampleValues();check(samples?.heights.length===size*size,name+' 2D loaded heights');
          check(!samples.water.some(Boolean),name+' 2D does not apply ocean coloring');
          let valid=0;
          for(let i=0;i<samples.heights.length;i++){
            check(Number.isFinite(samples.landRelative[i])===Number.isFinite(samples.relative[i]),name+' preserves local-floor validity');
            if(Number.isFinite(samples.relative[i])){check(Math.abs(samples.relative[i]-samples.landRelative[i])<.002,name+' preserves local terrain floor');valid++}
          }
          check(valid>size*size*.9,name+' local relief available across lake');inlandChecks++;
        }finally{e.destroy()}
      }
      renderer.destroy();check(gl.isTexture(external)&&gl.isTexture(target),'destroy retains caller textures');
      check(gl.getError()===gl.NO_ERROR,'3D GL error');
      // Real 2D engine: sampling flags must follow readback row order and bearing.
      const records=[],specs=[{id:'syn',rank:1,label:'Synthetic test elevation',nativeZoom:()=>4,allowed:()=>true}];
      for(let y=5;y<=7;y++)for(let x=1;x<=3;x++)records.push({key:`syn/4/${x}/${y}`,sourceId:'syn',rank:1,label:'Synthetic',z:4,x,y,width:256,height:256,grid:new Float32Array(65536).fill(50+x+y*100),revision:1});
      const tiles=new Map(records.map(r=>[r.key,r]));
      const store={options:{sources:()=>specs},sources:()=>specs,get:k=>tiles.get(k),on(){},off(){},want(){},settled:t=>({complete:true,total:t.length,ratio:1}),provenance:()=>({}),
        finestFor:(id,t)=>records.find(r=>r.z<=t.z&&Math.floor(t.x/2**(t.z-r.z))===r.x&&Math.floor(t.y/2**(t.z-r.z))===r.y)};
      const canvas2=document.createElement('canvas'),errors=[];
      const engine=CSPGpuTerrainEngine.create({canvas:canvas2,store,shaders:S,onNeedsFrame(){},onError:e=>errors.push(String(e))});check(engine,'2D engine startup '+errors);
      engine.setState({terrain:{style:'tint',stack}});
      let samples;
      for(const bearing of [0,37,90,180]){
        const v={...view,bearing};for(let i=0;i<5;i++)engine.render(v);
        check(engine.ready,'2D engine render '+engine.stats().error);
        samples=engine.sampleValues();check(samples.heights.length===size*size,'all sample pixels valid '+samples.heights.length+' '+JSON.stringify(engine.stats()));
        for(let i=0;i<samples.water.length;i++){
          const merc=S.screenToMercator(v,[(i%size+.5)/size,1-(Math.floor(i/size)+.5)/size]);
          check(samples.water[i]===+G.waterAtMercator(...merc),'rotated sampling flags '+bearing+'/'+i);
          // Constant tile heights independently verify the vertical row order.
          const x=Math.floor(merc[0]*16),y=Math.floor(merc[1]*16);
          const value=50+x+y*100;
          if(Math.abs(merc[0]*16-x-.5)<.45&&Math.abs(merc[1]*16-y-.5)<.45)check(Math.abs(samples.heights[i]-value)<1,'sample height/geography alignment');
        }
      }
      const remRadius=S.metersPerPixel(view)*2;
      engine.setState({terrain:{style:'rem',stack:{...remStack,remRadius}}});
      for(const bearing of [0,37,90]){
        const v={...view,bearing};engine.render(v);
        const sampled=engine.sampleValues(),field=engine.debugReadHeight();
        check(sampled.relative.length===sampled.heights.length&&sampled.landRelative.length===sampled.heights.length,'both bases stay sample-aligned');
        const topGrid=Float32Array.from({length:size*size},(_,i)=>field.data[i*2]);
        const topWater=Uint8Array.from({length:size*size},(_,i)=>+G.waterAtMercator(...S.screenToMercator(v,[(i%size+.5)/size,(Math.floor(i/size)+.5)/size])));
        const base=R.relativeBase({grid:topGrid,width:size,height:size,water:topWater},2,true);
        for(let i=0;i<sampled.heights.length;i++){
          const top=(size-1-Math.floor(i/size))*size+i%size;
          const expected=Math.max(0,topGrid[top]-base[top]),actual=sampled.landRelative[i];
          check(Number.isFinite(actual)===Number.isFinite(expected),'land-floor sample validity '+i);
          if(Number.isFinite(expected))check(Math.abs(actual-expected)<.003,'rotated land-only floor reference '+bearing+'/'+i);
        }
      }
      const v={...view,bearing:37};
      const capture=await engine.renderToCanvas(v,size,size),ctx=capture.getContext('2d'),pixels=ctx.getImageData(0,0,size,size).data;
      check(pixels.some((value,i)=>i%4===3&&value>0),'exports render separate scales');engine.releaseExport();engine.destroy();
      // Studio uses the same state owner for web and the native adapter.
      let values={heights:inner,water},changes=0;
      window.studio=CSPLidarStudio.mount(document.getElementById('terStudio'),{getStyle:()=> 'tint',storage:{getItem:()=>JSON.stringify(state)},sample:()=>values,onChange:()=>changes++});
      check(studio.fitFromView(true),'fit initial view');
      check(studio.legend('tint').secondary,'mixed-view legend includes water');
      document.querySelector('.ls-layer-main').click();
      const select=document.querySelector('[aria-label="Elevation scale"]');check(select?.options.length===3,'scale control integrated');
      select.value='full';select.dispatchEvent(new Event('change',{bubbles:true}));
      check(!studio.legend('tint').secondary&&!studio.stack('tint').layers[0].water,'continuous mode updates render and legend');
      const saved=studio.displayState();studio.restoreDisplay(saved);check(studio.state().base.tint.rangeMode==='full','display state roundtrip');
      document.querySelector('.ls-layer-main').click();
      const next=document.querySelector('[aria-label="Elevation scale"]');next.value='separate';next.dispatchEvent(new Event('change',{bubbles:true}));
      check(studio.legend('tint').secondary,'separate mode restored');
      values={heights:new Float32Array(20).fill(-1200),water:new Uint8Array(20).fill(1)};studio.fitFromView(true);
      check(!studio.legend('tint').secondary&&studio.legend('tint').caption.startsWith('Ocean'),'all-water legend');
      values={heights:new Float32Array(20).fill(-86),water:new Uint8Array(20)};studio.fitFromView(true);
      check(!studio.stack('tint').layers[0].water,'all-land view drops previous water range');
      values={heights:inner,water};studio.fitFromView(true);
      document.querySelectorAll('details').forEach(el=>el.open=true);
      const legend=studio.legend('tint');
      document.getElementById('terLegend').innerHTML=[legend,legend.secondary].filter(Boolean).map(key=>`<div class="terlegend-scale"><div class="caption">${key.caption}</div><div class="bar" style="background:${key.bar};height:10px"></div><div class="ticks">${key.ticks.map(t=>`<span>${t}</span>`).join('')}</div></div>`).join('');
      window.nativeMessages=[];
      window.webkit={messageHandlers:{cspNative:{postMessage:value=>{nativeMessages.push(value);return Promise.resolve()}}}};window.CSPNativeHost=true;
      window.CSPShell={current:()=> 'terrain',groups:()=>[],activate:()=>true};
      document.documentElement.classList.add('csp-boot');
      return {max3DError:maxError,maxRem3DError:remError,rotated2DSamples:samples.heights.length,inlandChecks,changes};
    });
    await page.addScriptTag({path:path.join(root,'ios/Resources/native-shell.js')});
    const native=await page.evaluate(()=>{
      window.CSPNativeShell.setView({sheet:'large',page:'terrain'});
      const payload=nativeMessages.map(m=>m.json&&JSON.parse(m.json)).find(m=>m?.page)?.page;
      const flatten=items=>(items||[]).flatMap(i=>[i,...flatten(i.items)]),items=flatten(payload?.items);
      const scale=items.find(i=>i.title==='Elevation scale');
      if(!scale||!scale.ref||scale.options?.length!==3)throw new Error('Native elevation scale picker not described '+JSON.stringify(scale));
      if(items.filter(i=>i.kind==='gradient').length<2)throw new Error('Native dual legends missing');
      CSPNativeShell.act(scale.ref,'select','full');
      if(studio.state().base.tint.rangeMode!=='full')throw new Error('Native picker did not update shared state');
      return true;
    });
    const remNative=await page.evaluate(()=>{
      const check=(value,message)=>{if(!value)throw Error(message)},R=CSPLidarRender;
      studio.destroy();
      const state=R.applyScene(R.emptyState(),R.LOOKS.find(look=>look.id==='missoula').scene,'missoula').state;
      let values={heights:Float32Array.from({length:40},(_,i)=>i<20?-5000+i*100:1000+i*10),
        relative:Float32Array.from({length:40},(_,i)=>i<20?800+i:10+i),
        landRelative:Float32Array.from({length:40},(_,i)=>i<20?NaN:10+i),water:Uint8Array.from({length:40},(_,i)=>+(i<20))};
      studio=CSPLidarStudio.mount(document.getElementById('terStudio'),{getStyle:()=> 'rem',storage:{getItem:()=>JSON.stringify(state)},sample:options=>{check(options.water,'REM requests geography');return values}});
      check(studio.fitFromView(true),'REM initial fit');
      check(studio.stack().layers[0].water[0]===-5000,'REM water uses absolute height');
      check(studio.stack().layers[0].max<60,'REM land fit excludes ocean relief');
      const snapshot=studio.displayState(),overlaySnapshot=structuredClone(studio.displayState());
      values={...values,heights:Float32Array.from(values.heights,(h,i)=>i<20?h:h+100)};
      check(studio.fitFromView(false),'3D floor changes notify even when local relative fit stays the same');
      check(studio.stack('rem',{flat:true}).remLandBase>snapshot.remLandFloor,'3D floor follows changed land');
      check(studio.stack('rem',{flat:true}).remLandBase>=1000,'3D floor excludes the ocean');
      studio.restoreDisplay(snapshot);check(studio.legend().secondary.caption.includes('absolute elevation'),'REM water caption');
      document.querySelector('[data-key="base"] .ls-layer-main').click();document.querySelectorAll('details').forEach(el=>el.open=true);
      const legend=studio.legend();document.getElementById('terLegend').innerHTML=legend.scales.map(key=>`<div class="terlegend-scale"><div class="caption">${key.caption}</div><div class="bar" style="background:${key.bar};height:10px"></div><div class="ticks">${key.ticks.map(t=>`<span>${t}</span>`).join('')}</div></div>`).join('');
      nativeMessages.length=0;CSPNativeShell.setView({sheet:'large',page:'terrain'});
      const page=nativeMessages.map(m=>m.json&&JSON.parse(m.json)).find(m=>m?.page)?.page;
      const flatten=items=>(items||[]).flatMap(i=>[i,...flatten(i.items)]),items=flatten(page?.items),scale=items.find(i=>i.title==='Elevation scale');
      check(scale?.options.length===2,'native REM scale picker '+JSON.stringify({scale,titles:items.map(i=>i.title)}));
      check(items.filter(i=>i.kind==='gradient').length>=2,'native REM water legend');
      CSPNativeShell.act(scale.ref,'select','full');check(!studio.stack().layers[0].water,'native single-scale action');
      studio.restoreDisplay(snapshot);
      values={heights:new Float32Array(20).fill(-4000),relative:new Float32Array(20).fill(NaN),landRelative:new Float32Array(20).fill(NaN),water:new Uint8Array(20).fill(1)};
      studio.fitFromView(true);check(studio.legend().caption.startsWith('Ocean')&&!studio.legend().secondary,'REM water-only without a base');
      values={heights:new Float32Array(20).fill(1200),relative:new Float32Array(20).fill(5),landRelative:new Float32Array(20).fill(5),water:new Uint8Array(20)};
      studio.fitFromView(true);check(!studio.legend().secondary&&!studio.stack().layers[0].water,'REM land-only clears water');
      values={...values,landRelative:new Float32Array(20).fill(NaN)};studio.fitFromView(true);
      check(studio.legend().caption.startsWith('Relative elevation'),'overview without a local floor still fits land');
      overlaySnapshot.state.overlays.push({...R.defaultLayer('rem'),palette:'viridis'});
      overlaySnapshot.fitted['overlay:1']=structuredClone(overlaySnapshot.fitted.base);
      overlaySnapshot.flatFitted['overlay:1']=structuredClone(overlaySnapshot.flatFitted.base);
      studio.restoreDisplay(overlaySnapshot);
      check(studio.legend().scales.length===4,'REM overlays expose their own land and water keys');
      return true;
    });
    if(!native)throw new Error('Native adapter unavailable');
    console.log(JSON.stringify({browser:process.argv[2]||'chrome',...result,nativeAdapter:true,remNativeAdapter:remNative}));
  }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
