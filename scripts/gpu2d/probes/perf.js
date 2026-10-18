const pw=require(process.env.PW);const which=process.env.B||'chrome';
(async()=>{
  const b=which==='webkit'?await pw.webkit.launch():await pw.chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
  const p=await (await b.newContext({viewport:{width:800,height:600}})).newPage();
  await p.route('http://127.0.0.1:8799/',async r=>{const res=await r.fetch();let body=await res.text();
    body=body.replace('window.ClearSkiesPortalBridge={','window.__tg=terrainGpu;window.__tl=terrainLighting;window.ClearSkiesPortalBridge={');r.fulfill({response:res,body})});
  await p.goto('http://127.0.0.1:8799/');await p.waitForTimeout(3500);
  console.log(which,await p.evaluate(()=>{
    const terrainGpu=window.__tg,terrainLighting=window.__tl;if(!terrainGpu)return 'hook missing';
    if(!terrainGpu.ready)return 'gpu not ready';
    const N=256,grid=new Float32Array(N*N);
    for(let y=0;y<N;y++)for(let x=0;x<N;x++)grid[y*N+x]=600+40*Math.sin(x/17)*Math.cos(y/23)+15*Math.sin((x+2*y)/7)+0.3*((x*7919+y*104729)%13)+y*0.8;
    const out={},t=document.createElement('canvas');t.width=t.height=N;const light=terrainLighting();const ctx=t.getContext('2d');
    for(const style of ["hs","hsmulti","slope","tint"]){
      let t0=performance.now();for(let i=0;i<30;i++){const rgba=CSPTerrainRaster.renderRgba(style,{grid,width:N,height:N,groundRes:0.6,lighting:light});ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer),N,N),0,0)}
      const cpu=(performance.now()-t0)/30;
      t0=performance.now();for(let i=0;i<30;i++)terrainGpu.paint(t,grid,0.6,style,light);ctx.getImageData(0,0,1,1);
      const gpu=(performance.now()-t0)/30;out[style]=`cpu ${cpu.toFixed(1)}ms gpu ${gpu.toFixed(2)}ms per tile`;
    }
    return JSON.stringify(out);
  }));await b.close();
})();
