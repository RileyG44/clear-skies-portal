'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app/map.js','utf8');
const fn=source.slice(source.indexOf('function cspFreshStartup('),source.indexOf('const cspFreshView'));
const env={URLSearchParams};vm.runInNewContext(fn,env);
const empty={getItem:()=>null};
assert.equal(env.cspFreshStartup(empty,'',null),true);
for(const hash of ['#csp=',' #csp=bad'.trim(),'#csp=valid'])assert.equal(env.cspFreshStartup(empty,hash,null),false,'any share payload owns startup');
assert.equal(env.cspFreshStartup(empty,'',{}),false,'native recovery owns startup');
for(const key of ['terrain.v2','lidarStudio.v1','overlays.v1','alerts.v1','search.v1'])assert.equal(env.cspFreshStartup({getItem:k=>k==='clearskies.'+key?'{}':null},'',null),false);
assert.equal(env.cspFreshStartup({getItem:k=>k==='clearskies.mapTheme.v1'?'dark':null},'',null),true,'theme alone is unrelated');
assert.equal(env.cspFreshStartup({getItem(){throw Error('denied')}},'',null),false);
const camera=source.slice(source.indexOf('const CSP_STARTUP_VIEW'),source.indexOf('/* Providers'));
vm.runInNewContext(camera+'\nglobalThis.view=CSP_STARTUP_VIEW;',env);
assert.equal(env.cspStartupZoom(430,932),4.5);
for(const [w,h] of [[440,956],[402,874],[1440,900],[932,430]]){
 const scale=2**(env.cspStartupZoom(w,h)-4.5);assert(scale*430<=w+1e-8&&scale*932<=h+1e-8,'reference geographic extent fits each aspect ratio');
}
const spectrum=fs.readFileSync('app/spectrum.js','utf8');
const start=spectrum.indexOf('if (cspFreshView && lidarStudio)');
const block=spectrum.slice(start,spectrum.indexOf('// The studio mounts',start));
const R=require('./lidar-render.js');let state=R.emptyState();const fields={'#terStyle':{},'#terOp':{}};
vm.runInNewContext(block,{cspFreshView:true,CSPLidarRender:R,CSPLidarStudio:{STORAGE_KEY:"studio"},localStorage:{setItem(){}},saveTerrainPrefs(){},$:id=>fields[id],lidarStudio:{state:()=>state,restoreDisplay:s=>{state=s.state}}});
assert.equal(state.look,'topo');assert.equal(fields['#terStyle'].value,'tint');assert.equal(fields['#terOp'].value,100);
// Default initialization changes only camera and render inputs, never setLoc/q.
assert(!block.includes('setLoc'));assert(!block.includes('#q'));
console.log('Fresh startup eligibility, restore precedence, responsive fit and real Topographic preset passed');
