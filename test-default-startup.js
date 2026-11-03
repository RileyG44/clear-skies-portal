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
// Each iPhone app session (cold launch) opens on the launch view, even with
// saved preferences; share links and recovery after a WebContent crash still win.
const saved={getItem:()=>'{}'};
assert.equal(env.cspFreshStartup(saved,'',null,true),true,'a new native session owns startup');
assert.equal(env.cspFreshStartup(saved,'#csp=valid',null,true),false,'a share link beats the session start');
assert.equal(env.cspFreshStartup(saved,'',{},true),false,'native recovery beats the session start');
assert.equal(env.cspFreshStartup(saved,'',null,false),false);
assert(source.includes('window.CSPNativeHost?.sessionStart === true'),'only the native host flag starts a session');
const camera=source.slice(source.indexOf('const CSP_STARTUP_VIEW'),source.indexOf('/* Providers'));
vm.runInNewContext(camera+'\nglobalThis.view=CSP_STARTUP_VIEW;',env);
assert.deepEqual([...env.view.center],[47.559373,-117.699455],'Missoula reference center (Medical Lake)');
assert.equal(env.cspStartupZoom(430,932),10.04);
for(const [w,h] of [[440,956],[402,874],[1440,900],[932,430]]){
 const scale=2**(env.cspStartupZoom(w,h)-10.04);assert(scale*430<=w+1e-8&&scale*932<=h+1e-8,'reference geographic extent fits each aspect ratio');
}
const spectrum=fs.readFileSync('app/spectrum.js','utf8');
const start=spectrum.indexOf('if (cspFreshView && lidarStudio)');
const block=spectrum.slice(start,spectrum.indexOf('// The studio mounts',start));
const R=require('./lidar-render.js');let state=R.emptyState();const fields={},stored={};
const field=id=>fields[id]||(fields[id]={});
const order=vm.runInNewContext(camera+'\nCSP_STARTUP_LAYER_ORDER;',{});
vm.runInNewContext(block,{cspFreshView:true,CSPLidarRender:R,CSPLidarStudio:{STORAGE_KEY:"studio"},CSP_STARTUP_LAYER_ORDER:order,localStorage:{setItem(k,v){stored[k]=v}},saveTerrainPrefs(){},$:field,lidarStudio:{state:()=>state,restoreDisplay:s=>{state=s.state}}});
assert.equal(state.look,'missoula');assert.equal(fields['#terStyle'].value,'rem');assert.equal(fields['#terOp'].value,100);
// Missoula is Aurora with the Ember palette.
const looks=Object.fromEntries(R.LOOKS.map(l=>[l.id,l]));
const recolored=JSON.parse(JSON.stringify(looks.aurora.scene));recolored.base.palette='ember';
assert.deepEqual(looks.missoula.scene,recolored);assert.equal(looks.missoula.name,'Missoula');
assert.equal(state.base.rem.palette,'ember');
// Below 2,320 ft in water blue at 35%; spectrum and above band off.
assert.equal(fields['#elevBelowOn'].checked,true);assert.equal(fields['#elevBelowVal'].value,2320);
assert.equal(fields['#elevBelowColor'].value,'#006981');assert.equal(fields['#elevBandAlpha'].value,35);
assert.equal(fields['#elevSh'].checked,false);assert.equal(fields['#elevAboveOn'].checked,false);
// Rivers & lakes on top, then the elevation band, LiDAR terrain below.
assert.deepEqual(JSON.parse(stored['clearskies.active-layer-order.v1']),['overlay:water','elevation-bands','terrain']);
const overlays=fs.readFileSync('app/overlays.js','utf8');
assert(overlays.includes('if (cspFreshView) { ovOn = {water:true}; ovOpacities = {...ovOpacities, water:10}; }'),'Rivers & lakes at 10%');
assert(/if\(cspFreshView\) Object\.assign\(alertPrefs,\{nws:false,quakes:false,volcanoes:false,fires:false\}\)/.test(overlays),'live alert layers start off');
// Default initialization changes only camera and render inputs, never setLoc/q.
assert(!block.includes('setLoc'));assert(!block.includes('#q'));
console.log('Fresh startup eligibility, native session start, restore precedence, responsive fit and the Missoula launch preset passed');
