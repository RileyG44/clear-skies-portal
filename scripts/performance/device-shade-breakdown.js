/* Which parts of the Aurora REM look cost GPU time: the same view and data
 * shaded with the detail blur, the hillshade overlay or the valley base each
 * switched off in turn (engine.setState only; nothing is saved). Uses the
 * engine's diagnostic debugGpuTiming(); compare variants, not frame rates.
 * Runs as an iOS Debug probe body or in a page (gesture-repro.js --probe). */
const wait=ms=>new Promise(r=>setTimeout(r,ms));await wait(4000);
const B=ClearSkiesPortalBridge,m=B.map,g=B.gpuTerrain(),e=g.getEngine(),store=g.getStore(),saved=B.sessionState();
const style=document.getElementById('terStyle'),originalStyle=style.value;
async function settle(limit){const t0=performance.now();while(store.stats().pending&&performance.now()-t0<limit)await wait(250);await wait(400);}
style.value='rem';style.dispatchEvent(new Event('change',{bubbles:true}));await wait(250);
document.querySelector('#terStudio [data-look="aurora"]')?.click();await wait(400);
const runs=[];
try{
  for(const zoom of [16,13]){
    m.setBearing?.(0);m.setView([47.858,-118.33],zoom,{animate:false});await settle(25000);
    const base=JSON.parse(JSON.stringify(g._state)),stack=base.terrain.stack;
    const variants={
      aurora:s=>s,
      noDetail:s=>{s.terrain.stack.detail=0;return s;},
      remOnly:s=>{s.terrain.stack.layers=s.terrain.stack.layers.filter(l=>l.style==='rem');return s;},
      remOnlyNoDetail:s=>{s.terrain.stack.layers=s.terrain.stack.layers.filter(l=>l.style==='rem');s.terrain.stack.detail=0;return s;},
      hsOnlyNoDetail:s=>{s.terrain.stack.layers=s.terrain.stack.layers.filter(l=>l.style==='hs');s.terrain.stack.detail=0;return s;},
      noValleyBase:s=>{s.terrain.stack.remRadius=0;return s;}
    };
    for(const [name,edit] of Object.entries(variants)){
      e.setState(edit(JSON.parse(JSON.stringify(base))));
      for(let i=0;i<3;i++){await new Promise(requestAnimationFrame);m._rawPanBy(L.point(1,0));m.fire('move');}
      e.debugGpuTiming(true);let totals;
      try{for(let i=0;i<50;i++){await new Promise(requestAnimationFrame);m._rawPanBy(L.point(1,0));m.fire('move');}}
      finally{totals=e.debugGpuTiming(false);}
      const per=k=>totals.frames?+(totals[k]/totals.frames).toFixed(2):null;
      runs.push({zoom,variant:name,height:per('height'),aux:per('aux'),shade:per('shade'),frames:totals.frames,
        layers:e.stats().planEntries,stack:{layers:(edit(JSON.parse(JSON.stringify(base))).terrain.stack.layers||[]).map(l=>l.style+':'+l.blend),
          detail:stack.detail,detailRadius:stack.detailRadius,remRadius:stack.remRadius}});
    }
    e.setState(base);
  }
}finally{
  style.value=originalStyle;style.dispatchEvent(new Event('change',{bubbles:true}));
  m.setView(saved.center,saved.zoom,{animate:false});m.setBearing?.(saved.bearing||0);
}
return {passed:true,build:CSP_BUILD,viewport:[innerWidth,innerHeight],dpr:devicePixelRatio,field:[g._canvas.width,g._canvas.height],runs};
