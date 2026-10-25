/* GPU time per terrain pass (height field, derived fields, shade) while the
 * view pans by 1 CSS px per frame, for hillshade and the Aurora REM look at two
 * zooms. Uses the engine's diagnostic debugGpuTiming(), which waits for each
 * pass with a one-pixel read and averages over the frames: numbers include
 * that synchronisation, so compare passes and styles, not frame rates. Runs as an iOS Debug probe body
 * (ios/scripts/verify_shell_on_device.py --activate --probe ...) or in a page. */
const wait=ms=>new Promise(r=>setTimeout(r,ms));await wait(4000);
const B=ClearSkiesPortalBridge,m=B.map,g=B.gpuTerrain(),e=g.getEngine(),store=g.getStore(),saved=B.sessionState();
const style=document.getElementById('terStyle'),originalStyle=style.value;
const pct=(a,p)=>{const s=a.slice().sort((x,y)=>x-y);return s.length?+s[Math.min(s.length-1,Math.ceil(s.length*p)-1)].toFixed(2):null;};
const sum=a=>({n:a.length,p50:pct(a,.5),p95:pct(a,.95),max:a.length?+Math.max(...a).toFixed(2):null});
async function settle(limit){const t0=performance.now();while(store.stats().pending&&performance.now()-t0<limit)await wait(250);await wait(400);}
async function look(name){
  style.value=name==='hs'?'hs':'rem';style.dispatchEvent(new Event('change',{bubbles:true}));await wait(250);
  if(name!=='hs')document.querySelector(`#terStudio [data-look="${name}"]`)?.click();await wait(400);
}
const runs=[];
try{
  for(const zoom of [16,13]){
    m.setBearing?.(0);m.setView([47.858,-118.33],zoom,{animate:false});await settle(25000);
    for(const name of ['hs','aurora']){
      await look(name);await settle(8000);
      const js=[];let totals;const frameDt=[];let last;
      e.debugGpuTiming(true);
      try{
        for(let i=0;i<60;i++){
          const t=await new Promise(requestAnimationFrame);if(last!==undefined)frameDt.push(t-last);last=t;
          m._rawPanBy(L.point(1,0));m.fire('move');
          const p=e.stats().phaseMs;js.push(p.want+p.seed+p.upload+p.plan);
        }
      }finally{totals=e.debugGpuTiming(false);}
      const st=e.stats(),per=k=>totals.frames?+(totals[k]/totals.frames).toFixed(2):null;
      runs.push({zoom,look:name,gpuMsPerFrame:{height:per('height'),aux:per('aux'),shade:per('shade'),frames:totals.frames},syncedFrameDt:sum(frameDt),jsMs:sum(js),
        planEntries:st.planEntries,drawCalls:st.drawCalls,textures:st.textures,field:[g._canvas.width,g._canvas.height],
        stack:g._state?.terrain?.stack?{layers:g._state.terrain.stack.layers.map(l=>l.style),detail:g._state.terrain.stack.detail,
          detailRadius:g._state.terrain.stack.detailRadius,remRadius:g._state.terrain.stack.remRadius}:null});
    }
  }
}finally{
  style.value=originalStyle;style.dispatchEvent(new Event('change',{bubbles:true}));
  m.setView(saved.center,saved.zoom,{animate:false});m.setBearing?.(saved.bearing||0);
}
return {passed:true,build:CSP_BUILD,viewport:[innerWidth,innerHeight],dpr:devicePixelRatio,native:!!window.CSPNativeShell,runs};
