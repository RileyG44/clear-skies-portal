'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(process.env.CSP_TAP_SOURCE||'index.html','utf8');
const source=html.slice(html.indexOf('let fingerTapHandled='),html.indexOf('/* ---------------------------------------------------------------- state */'));
function setup(){
  let now=1000,id=0;const listeners={},handlers={},timers=new Map(),classes=new Set(),calls={locations:[],runs:0};
  const el={append(){},getBoundingClientRect:()=>({left:0,top:0}),addEventListener:(n,f)=>(listeners[n]??=[]).push(f)};
  const ctx={document:{addEventListener(){},removeEventListener(){},body:{classList:{contains:n=>classes.has(n)}},getElementById:n=>n==='map'?el:null,createElement:()=>({})},
    map:{on:(n,f)=>handlers[n]=f,containerPointToLatLng:p=>({lat:p.y,lng:p.x})},map3d:null,
    L:{point:(x,y)=>({x,y}),latLng:(lat,lng)=>({lat,lng})},performance:{now:()=>now},
    setTimeout:f=>{timers.set(++id,f);return id},clearTimeout:i=>timers.delete(i),
    mapEventLocation:e=>e,stageMapLocation:e=>calls.locations.push(e.latlng),run:()=>calls.runs++};
  vm.runInNewContext(source,ctx);
  const touch=(n,x=100,y=200,extra={})=>{const t={clientX:x,clientY:y};for(const f of listeners[n]||[])f({target:{closest:()=>false},touches:n==='touchend'?[]:[t],changedTouches:[t],...extra})};
  return {calls,classes,handlers,touch,advance:n=>now+=n,expire:()=>{for(const f of [...timers.values()])f();timers.clear()},mouse:()=>{for(const f of listeners.pointerdown||[])f({pointerType:'mouse'})}};
}
let s=setup();s.touch('touchstart');s.touch('touchend');
assert.equal(s.calls.locations.length,1,'stationary first touch selects even when WebKit sends no click');
assert.equal(s.calls.locations[0].lat,200);assert.equal(s.calls.locations[0].lng,100);
s.handlers.click({latlng:{lat:1,lng:2}});assert.equal(s.calls.locations.length,1,'compatibility click cannot select twice');
s.advance(200);s.touch('touchstart');s.touch('touchend');s.handlers.dblclick({latlng:{lat:1,lng:2}});
assert.equal(s.calls.runs,1,'double tap loads imagery once');
s.mouse();s.handlers.click({latlng:{lat:1,lng:2}});assert.equal(s.calls.locations.length,3,'real mouse works immediately');
s=setup();s.touch('touchstart');s.touch('touchmove',106,204);s.touch('touchend',106,204);assert.equal(s.calls.locations.length,1,'drifting tap still selects touch-down point');assert.equal(s.calls.locations[0].lng,100);
for(const gesture of ['pan','return-pan','pinch','cancel','hold','button','dnr','cloud']){
 s=setup();if(gesture==='dnr')s.classes.add('dnr-selecting');if(gesture==='cloud')s.classes.add('point-cloud-open');
 s.touch('touchstart',100,200,gesture==='button'?{target:{closest:()=>true}}:{});
 if(gesture==='pan'||gesture==='return-pan')s.touch('touchmove',150,200);
 if(gesture==='pinch')s.touch('touchmove',100,200,{touches:[{},{}]});
 if(gesture==='cancel')s.touch('touchcancel');if(gesture==='hold')s.advance(600);
 s.touch('touchend',gesture==='pan'?150:100,200);assert.equal(s.calls.locations.length,0,gesture+' must not select');
}
s=setup();s.touch('touchstart');s.touch('touchend');s.expire();s.handlers.click({latlng:{lat:1,lng:2}});assert.equal(s.calls.locations.length,2,'suppression expires');
console.log('Map tap regression: stationary first touch, duplicate click, double tap, mouse, drift and gesture exclusions passed');
