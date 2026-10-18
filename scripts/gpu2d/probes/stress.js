const pw=require(process.env.PW);
(async()=>{
  const b=await pw.chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--enable-precise-memory-info','--js-flags=--expose-gc']});
  const ctx=await b.newContext({viewport:{width:1280,height:800},deviceScaleFactor:2});const p=await ctx.newPage();
  const logs=[];p.on('console',m=>{if(m.type()!=='log')logs.push(m.type()+' '+m.text().slice(0,140))});p.on('pageerror',e=>logs.push('PAGEERR '+e));p.on('crash',()=>logs.push('PAGE CRASH'));
  await p.addInitScript(()=>{window.__lost=0;window.__gl=0;const o=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(t,a){const c=o.call(this,t,a);if(c&&/webgl/.test(t)&&!this.__h){this.__h=1;window.__gl++;this.addEventListener('webglcontextlost',()=>{window.__lost++})}return c}});
  await p.goto('http://127.0.0.1:8799/');await p.waitForTimeout(3500);
  const cdp=await ctx.newCDPSession(p);await cdp.send('Performance.enable');
  const mem=async()=>{await p.evaluate(()=>window.gc?.());const m=(await cdp.send('Performance.getMetrics')).metrics;const g=k=>m.find(x=>x.name===k)?.value;
    const d=await p.evaluate(()=>({canv:document.querySelectorAll('canvas').length,gl:window.__gl,lost:window.__lost}));
    return `heap ${(g('JSHeapUsedSize')/1e6).toFixed(0)}MB nodes ${g('Nodes')} canvases ${d.canv} glCreated ${d.gl} lost ${d.lost}`};
  await p.evaluate(()=>document.querySelector('#sideToggle')?.click());
  await p.evaluate(`ClearSkiesPortalBridge.map.setView([47.858,-118.33],15,{animate:false})`);
  await p.evaluate(`(()=>{for(const [id,v] of [['#terStyle','hs']]){const s=document.querySelector(id);s.value=v;s.dispatchEvent(new Event('change',{bubbles:true}))}const e=document.querySelector('#elevSh');e.checked=true;e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await p.waitForTimeout(4000);console.log('start',await mem());
  if(process.env.PAN){
    for(let i=0;i<40;i++){const z=14+Math.random()*6,lat=47.84+Math.random()*0.04,lng=-118.42+Math.random()*0.12;
      await p.evaluate(`ClearSkiesPortalBridge.map.setView([${lat},${lng}],${z},{animate:false})`);await p.waitForTimeout(700);
      if(i%10===9)console.log('pan',i+1,await mem());}
  }
  if(process.env.TOGGLE){
    for(let i=0;i<8;i++){await p.evaluate(()=>document.querySelector('#terMode3d').click());await p.waitForTimeout(5000);
      await p.evaluate(()=>document.querySelector('#terMode2d').click());await p.waitForTimeout(2000);console.log('3d toggle',i+1,await mem());}
  }
  console.log([...new Set(logs)].filter(l=>!/GL Driver|willRead|503/.test(l)).slice(0,10).join('\n'));await b.close();
})();
