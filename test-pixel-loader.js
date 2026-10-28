'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),crypto=require('node:crypto');
const html=require('./test-fixtures/page-source.js');
const source=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).find(s=>s.includes("Port of Riley's satellite-loader-gen.py"));
// Independently rendered RGB hashes from Riley's updated Python generator,
// SHA256 103ad40e02648228158a04efdefcc643198658a1d725fd6dc1fcd10114fc4a4c.
const reference={0:'61d0912a625112aa6b5280cbc945dc61d7ac6497b1f88afb9a37c8f3635cb06d',24:'373dd22910a194e2ba6e118cd1d083391edffd60c271e9b392445a0196b371fe',48:'54a0e8ca2496762e3318c2ca01ea2b283911f251cbd09f1bc65d32b04708ba0b',96:'45691fd52c1cdf67923243661030f1aa748dbcb0f38dab6e812e5ab8b3c82403',191:'e61160b51f8b3895b0763a9212132853679286eb497ff2cb059f7a610cf173cf'};
function fixture(reduced=false){
 const pixels=Buffer.alloc(240*96*3),events={};let next,cancelled=0,draws=0;
 const ctx={fillStyle:'#000',fillRect(x,y,w,h){draws++;let hex=this.fillStyle.slice(1);if(hex.length===3)hex=hex.split('').map(c=>c+c).join('');const rgb=[0,2,4].map(i=>parseInt(hex.slice(i,i+2),16));for(let py=y;py<y+h;py++)for(let px=x;px<x+w;px++)if(px>=0&&px<240&&py>=0&&py<96)for(let k=0;k<3;k++)pixels[(py*240+px)*3+k]=rgb[k]}};
 const panel={getBoundingClientRect:()=>({width:390,height:844})},canvas={parentElement:panel,style:{},getContext:()=>ctx};
 const boot={done:false};
 const context={document:{getElementById:()=>canvas,documentElement:{classList:{contains:()=>false},addEventListener:(e,fn)=>events[e]=fn}},window:{CSPBoot:boot},getComputedStyle:()=>({paddingLeft:'24',paddingRight:'24',paddingTop:'24',paddingBottom:'24'}),devicePixelRatio:2,matchMedia:()=>({matches:reduced,addEventListener(){},removeEventListener(){}}),performance:{now:()=>0},requestAnimationFrame:fn=>{next=fn;return 1},cancelAnimationFrame:()=>cancelled++,addEventListener(){},removeEventListener(){}};
 vm.runInNewContext(source,context);
 return {pixels,frame:f=>next(f*1000/24+.001),boot,events,draws:()=>draws,cancelled:()=>cancelled};
}
const f=fixture();
for(const [frame,hash] of Object.entries(reference)){if(+frame)f.frame(+frame);assert.equal(crypto.createHash('sha256').update(f.pixels).digest('hex'),hash,`reference frame ${frame}`)}
f.frame(192);assert.equal(crypto.createHash('sha256').update(f.pixels).digest('hex'),reference[0],'loop returns to frame zero');
f.boot.done=true;const count=f.draws();f.frame(193);assert.equal(f.draws(),count,'ready stops rendering');assert(f.cancelled());
const still=fixture(true);assert.equal(crypto.createHash('sha256').update(still.pixels).digest('hex'),reference[0],'reduced motion draws the reference still');
console.log('pixel loader: independent Python reference frames, seamless loop, reduced motion and ready cleanup passed');
