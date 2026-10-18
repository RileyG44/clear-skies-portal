const pw=require(process.env.PW);const fs=require('fs');
(async()=>{
  const b=await pw.chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
  const ctx=await b.newContext({viewport:{width:1440,height:900},deviceScaleFactor:2});const p=await ctx.newPage();
  await p.goto('http://127.0.0.1:8799/');await p.waitForTimeout(3500);
  await p.evaluate(()=>document.querySelector('#sideToggle')?.click());
  const set=(id,v)=>p.evaluate(([id,v])=>{const s=document.querySelector(id);if(s.type==='checkbox')s.checked=v;else s.value=v;s.dispatchEvent(new Event('input',{bubbles:true}));s.dispatchEvent(new Event('change',{bubbles:true}))},[id,v]);
  await p.evaluate(`ClearSkiesPortalBridge.map.setView([47.858,-118.36],15,{animate:false})`);
  await set('#terStyle','hs');await set('#elevSh',true);await p.waitForTimeout(6000);   // warm caches
  const cdp=await ctx.newCDPSession(p);await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:200});
  const phase=async(name,fn)=>{await cdp.send('Profiler.start');const t0=Date.now();
    const lt=await p.evaluate(()=>{window.__long=0;window.__lc=0;try{new PerformanceObserver(l=>{for(const e of l.getEntries()){window.__long+=e.duration;window.__lc++}}).observe({type:'longtask'})}catch{}return 1});
    await fn();const {profile}=await cdp.send('Profiler.stop');const wall=Date.now()-t0;
    const self=new Map(),byId=new Map(profile.nodes.map(n=>[n.id,n]));const dt=profile.timeDeltas;let total=0;
    profile.samples.forEach((id,i)=>{const n=byId.get(id);const f=n.callFrame;const k=(f.functionName||'(anon)')+' '+(f.url.split('/').pop()||'')+':'+f.lineNumber;self.set(k,(self.get(k)||0)+(dt[i]||0)/1000);total+=(dt[i]||0)/1000});
    const top=[...self.entries()].filter(([k])=>!/^\(idle\)|^\(program\)|^\(garbage/.test(k)).sort((a,b)=>b[1]-a[1]).slice(0,14);
    const idle=self.get('(idle) :-1')||0,prog=self.get('(program) :-1')||0,gc=self.get('(garbage collector) :-1')||0;
    const long=await p.evaluate(()=>[Math.round(window.__long),window.__lc]);
    console.log(`\n== ${name}: wall ${wall}ms, main-thread busy ${Math.round(total-idle)}ms (program ${Math.round(prog)}, gc ${Math.round(gc)}), long tasks ${long[1]} totalling ${long[0]}ms`);
    for(const [k,v] of top)console.log(`  ${v.toFixed(0).padStart(6)}ms  ${k}`);};
  await phase('pan + zoom (hillshade + spectrum)',async()=>{for(let i=0;i<16;i++){await p.evaluate(`ClearSkiesPortalBridge.map.setView([${47.84+Math.random()*.04},${-118.42+Math.random()*.12}],${14+Math.random()*4},{animate:false})`);await p.waitForTimeout(800)}});
  await phase('drag sun azimuth slider (relight)',async()=>{for(let a=0;a<360;a+=12){await set('#terSunAz',a);await p.waitForTimeout(60)}await p.waitForTimeout(1500)});
  await phase('drag spectrum reference slider',async()=>{for(let v=0;v<1200;v+=40){await set('#elevSlide',v);await p.waitForTimeout(60)}await p.waitForTimeout(1500)});
  await b.close();
})();
