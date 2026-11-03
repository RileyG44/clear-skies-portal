/* Debug native probe: run with the installed app's cspDebugScript hook and a
   current terrain engine. Exercises real provider pixels, the native store and
   the on-screen GPU field at the reported Mount Hood survey edge. */
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const bridge=ClearSkiesPortalBridge,map=bridge.map,results=[],failures=[];
await wait(1500);
for(const zoom of [12,13,14,15,12]){
  map.setView([45.285,-121.735],zoom,{animate:false});
  await wait(1200);
  const layer=bridge.gpuTerrain(),store=layer.getStore(),engine=layer.getEngine();
  const deadline=performance.now()+18000;
  while(store.stats().pending&&performance.now()<deadline)await wait(250);
  const field=engine.debugReadHeight();let zeroes=0,valid=0,oregon=0,min=Infinity;
  for(let i=0;i<field.data.length;i+=2){
    const height=field.data[i],rank=field.data[i+1];
    if(rank>0&&Number.isFinite(height)){valid++;min=Math.min(min,height);if(height===0)zeroes++;if(rank===6)oregon++;}
  }
  const numeric=[...store._tiles.values()].filter(r=>r.sourceId==='oregon'&&r.validCount);
  const nativeZeroes=numeric.reduce((sum,r)=>sum+r.grid.reduce((n,v)=>n+(v===0),0),0);
  const result={zoom,valid,oregon,zeroes,nativeZeroes,min,store:store.stats(),oregonTiles:numeric.length};
  if(!valid||zeroes||nativeZeroes)failures.push('False/missing terrain at zoom '+zoom+': '+JSON.stringify(result));
  results.push(result);
}
if(!results.some(r=>r.oregon>0))failures.push('No real Oregon detail reached the GPU; this run cannot verify the provider fix.');
return {passed:!failures.length,build:CSP_BUILD,device:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio,native:!!CSPNativeHost},results,failures};
