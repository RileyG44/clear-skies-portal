const wait=ms=>new Promise(r=>setTimeout(r,ms));await wait(5000);
const B=ClearSkiesPortalBridge,m=B.map,g=B.gpuTerrain(),e=g.getEngine(),store=g.getStore(),saved=B.sessionState(),el=document.getElementById('terStyle'),oldStyle=el.value;
const pct=(a,p)=>{const s=a.slice().sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.ceil(s.length*p)-1)]??null;};
const summaries=a=>({n:a.length,p50:pct(a,.5),p95:pct(a,.95),p99:pct(a,.99),max:Math.max(0,...a),over20:a.filter(x=>x>20).length,over50:a.filter(x=>x>50).length,over100:a.filter(x=>x>100).length});
const runs=[];
async function measure(style,pan){
 el.value=style;el.dispatchEvent(new Event('change',{bubbles:true}));await wait(1000);
 const before={gpu:e.stats(),store:store.stats()},dt=[],cpu=[],counts=[],coverage=[];let prev,start;
 if(pan)m.fire('movestart');
 await new Promise(resolve=>{const tick=t=>{if(start===undefined){start=t;prev=t;}else dt.push(t-prev);prev=t;
   const f=e.stats().frames,t0=performance.now();if(pan){m._rawPanBy(L.point(1,0));m.fire('move');}cpu.push(performance.now()-t0);counts.push(e.stats().frames-f);coverage.push(g._coverage?.coverage??null);
   if(t-start>=2500)resolve();else requestAnimationFrame(tick);};requestAnimationFrame(tick);});
 if(pan)m.fire('moveend');
 const result={style,pan,visibility:document.visibilityState,dt:summaries(dt),eventCPU:summaries(cpu),renderCalls:counts.reduce((a,b)=>a+b,0),minGeometryCoverage:Math.min(...coverage.filter(Number.isFinite)),before,after:{gpu:e.stats(),store:store.stats()}};
 m.setView(saved.center,saved.zoom,{animate:false});await wait(400);return result;
}
try{for(const style of ['hs','rem'])for(let r=0;r<2;r++)runs.push({repeat:r+1,...await measure(style,true)});runs.push(await measure('hs',false));}
finally{el.value=oldStyle;el.dispatchEvent(new Event('change',{bubbles:true}));m.setView(saved.center,saved.zoom,{animate:false});m.setBearing(saved.bearing);}
return {passed:true,build:CSP_BUILD,viewport:[innerWidth,innerHeight],dpr:devicePixelRatio,native:!!CSPNativeShell,originalStyle:oldStyle,view:saved,runs};
