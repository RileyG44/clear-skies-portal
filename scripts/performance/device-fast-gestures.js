/* Installed Debug app probe: fast pan and pinch through the production camera
 * handlers. No screenshots, GPU synchronization or pixel readback during timing.
 * Run with verify_shell_on_device.py --activate --timeout 180 --probe <this file>.
 * Reports rAF timing on the physical device, not Instruments/compositor FPS. */
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
await wait(2000);
const B=ClearSkiesPortalBridge,m=B.map,g=B.gpuTerrain(),e=g.getEngine(),store=g.getStore();
const saved=B.sessionState(),control=document.getElementById('terStyle'),originalStyle=control.value;
const originalPrefs=localStorage.getItem('clearskies.terrain.v2');
const startup={center:saved.center,zoom:saved.zoom,longitudeSpan:m.getBounds().getEast()-m.getBounds().getWest()};
const stats=a=>{const sorted=a.slice().sort((a,b)=>a-b),p=q=>sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*q)-1)]??null;
  return {n:a.length,p50:p(.5),p95:p(.95),p99:p(.99),max:sorted.at(-1)??null,over33:a.filter(v=>v>33.4).length,over100:a.filter(v=>v>100).length};};
async function ready(){
  const start=performance.now();
  while(store.settled().refining&&performance.now()-start<20000)await wait(200);
  await wait(400);
}
async function reset(style){
  control.value=style;control.dispatchEvent(new Event('change',{bubbles:true}));
  m.setBearing(0);m.setView([47.858,-118.33],16,{animate:false});await ready();
}
async function measure(style,gesture,run){
  await reset(style);
  const before=e.stats(),dt=[],cpu=[],coverage=[];let recording=true,last;
  const tick=t=>{if(!recording)return;if(last!==undefined)dt.push(t-last);last=t;
    coverage.push(g._coverage?.coverage??0);cpu.push(e.stats().lastFrameMs);requestAnimationFrame(tick);};
  requestAnimationFrame(tick);
  let inputs;
  try{inputs=await run();await wait(750);}finally{recording=false;}
  const after=e.stats();
  return {style,gesture,visibility:document.visibilityState,dt:stats(dt),renderJs:stats(cpu),inputs,
    minGeometryCoverage:Math.min(...coverage),uploads:after.uploads-before.uploads,evictions:after.evictions-before.evictions,
    textures:after.textures,textureBytes:after.textureBytes,pending:store.stats().pending,
    stack:g._state?.terrain?.stack,ready:after.ready,error:after.error};
}
async function pinch(){
  const center=m.getCenter(),start=performance.now(),shades=[];m._moveStart(true,false);
  await new Promise(resolve=>{const frame=t=>{const k=Math.min(1,(t-start)/900),zoom=16-5*(1-(1-k)**1.6);
    const before=e.stats().frames;m._move(center,zoom,{pinch:true,round:false});shades.push(e.stats().frames-before);
    if(k<1)requestAnimationFrame(frame);else resolve();};requestAnimationFrame(frame);});
  const before=e.stats().frames;m._animateZoom(center,11,true,0);shades.push(e.stats().frames-before);
  return {n:shades.length,maxShades:Math.max(...shades)};
}
async function swipe(){
  const start=performance.now(),shades=[];m.fire('movestart').fire('dragstart');
  await new Promise(resolve=>{const frame=t=>{const before=e.stats().frames;m._rawPanBy(L.point(45,18));m.fire('move').fire('drag');shades.push(e.stats().frames-before);
    if(t-start<380)requestAnimationFrame(frame);else resolve();};requestAnimationFrame(frame);});
  m.fire('dragend',{distance:600});m.panBy(L.point(1100,440),{duration:1.1,easeLinearity:.2,noMoveStart:true,animate:true});await wait(1200);
  return {n:shades.length,maxShades:Math.max(...shades)};
}
const runs=[];
try{for(const style of ['hs','rem'])for(const [gesture,run] of [['pinch-out',pinch],['swipe',swipe]])runs.push(await measure(style,gesture,run));}
finally{
  control.value=originalStyle;control.dispatchEvent(new Event('change',{bubbles:true}));
  await B.restoreSession(saved);await wait(400);
  if(originalPrefs===null)localStorage.removeItem('clearskies.terrain.v2');else localStorage.setItem('clearskies.terrain.v2',originalPrefs);
}
return {passed:runs.every(r=>r.ready&&!r.error&&r.visibility==='visible'&&r.inputs.maxShades<=1),build:CSP_BUILD,native:!!window.CSPNativeShell,
  viewport:[innerWidth,innerHeight],dpr:devicePixelRatio,startup,runs};
