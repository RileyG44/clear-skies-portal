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
    const out={},t=document.createElement('canvas');t.width=t.height=N;const light=terrainLighting();
    for(const style of ["hs","hsmulti","tint","slope","aspect","northness","c2","c5","c10","c25"]){
      const ref=CSPTerrainRaster.renderRgba(style,{grid,width:N,height:N,groundRes:0.6,lighting:light});
      terrainGpu.paint(t,grid,0.6,style,light);const g=t.getContext('2d').getImageData(0,0,N,N).data;
      let max=0,over=0,n=0;
      for(let y=1;y<N-1;y++)for(let x=1;x<N-1;x++){const o=(y*N+x)*4;n++;let m=0;
        // compare premultiplied-ish: ignore colour where both effectively transparent
        if(ref[o+3]<8&&g[o+3]<8)continue;
        for(let c=0;c<4;c++)m=Math.max(m,Math.abs(ref[o+c]-g[o+c]));max=Math.max(max,m);if(m>3)over++}
      out[style]=`max ${max} >3: ${(100*over/n).toFixed(2)}%`;
    }
    return JSON.stringify(out);
  }));await b.close();
})();
