'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('index.html','utf8'),css=fs.readFileSync('ui-system.css','utf8');
const start=source.indexOf('let map3dGlassTimer='),end=source.indexOf('function setTerrainModeUi(',start);
assert(start>=0&&end>start,'the motion lifecycle must exist');
let now=0,sequence=0,writes=[];
const timers=new Map(),classes=new Set(['terrain-3d']);
const env={map3d:{},document:{body:{classList:{contains:name=>classes.has(name),
  add(name){writes.push(['add',name]);classes.add(name)},remove(name){writes.push(['remove',name]);classes.delete(name)}}}},
  setTimeout(fn,delay){const id=++sequence;timers.set(id,{at:now+delay,fn});return id},clearTimeout:id=>timers.delete(id)};
vm.runInNewContext(source.slice(start,end),env);
const advance=ms=>{now+=ms;for(const [id,timer] of timers) if(timer.at<=now){timers.delete(id);timer.fn()}};
env.mark3dGlassMotion();
assert(classes.has('map3d-moving'),'the first movement immediately disables glass');
for(let frame=0;frame<120;frame++){
  advance(16);env.mark3dGlassMotion();env.mark3dGlassMotion(); // movestart + move per synchronous jumpTo
  assert(classes.has('map3d-moving'),'continuous movement never restores blur');
}
assert.equal(writes.length,1,'frame events must not rewrite the DOM class');
assert.equal(timers.size,1,'movement keeps only one quiet timer');
advance(199);assert(classes.has('map3d-moving'),'blur stays disabled until the quiet interval completes');
advance(1);assert(!classes.has('map3d-moving'),'blur returns after 200 ms without movement');
assert.equal(writes.length,2,'a whole gesture causes only two class writes');
env.mark3dGlassMotion();advance(100);env.reset3dGlassMotion();
assert.equal(timers.size,0,'exit cancels the pending quiet timer');
assert(!classes.has('map3d-moving'),'exit immediately restores glass');
const afterExit=writes.length;advance(500);assert.equal(writes.length,afterExit,'no stale callback writes after exit');
classes.delete('terrain-3d');env.mark3dGlassMotion();
assert.equal(writes.length,afterExit,'2D events cannot activate the override');
assert.equal(timers.size,0,'2D events do not start a quiet timer');
classes.add('terrain-3d');env.map3d=null;env.mark3dGlassMotion();
assert.equal(timers.size,0,'startup without a camera cannot start motion');
env.map3d={};env.mark3dGlassMotion();advance(200);env.mark3dGlassMotion();
assert(classes.has('map3d-moving'),'a later gesture activates glass suppression again');
env.reset3dGlassMotion();env.reset3dGlassMotion();assert.equal(timers.size,0,'cleanup is idempotent');
assert(source.includes('map3d.on("movestart",mark3dGlassMotion);map3d.on("move",mark3dGlassMotion)'),
  'the real camera must register both first-motion and continuous-motion hooks');
assert(!source.includes('map3d.on("moveend",reset3dGlassMotion)'), 'synchronous jumpTo moveend must not restore blur');
assert.match(source,/function exitTerrain3d\(\)\{\s*reset3dGlassMotion\(\)/,'exit must clean up even when there is no map');
assert.match(source,/function setTerrainModeUi\(on,status\)\{\s*if\(!on\) reset3dGlassMotion\(\)/,'failed startup must clean up too');
// Every non-none backdrop rule in the shipped chrome needs a targeted motion
// override. This includes legacy hard-coded blur and collapsed phone fields.
const motionCss=css.slice(css.indexOf('body.terrain-3d.map3d-moving{'));
for(const selector of ['#side','#ac','.coord-menu','.map-tool','.tool-popover','#snapshotStatus','.snap-sel-size','.snap-sel-bar',
  '#ctl','#menu','#blk','#pointCloudPanel','.pc-head','.pane-drag-ghost','.ovgrp','#newBuild','.leaflet-control-zoom',
  '.leaflet-control-attribution','.leaflet-popup-content-wrapper','.leaflet-tooltip','#mapDock','#panes .grp',
  '#side #q','#side #loc','#map3d .maplibregl-ctrl-attrib','#mkBar','#mkPop'])
  assert(motionCss.includes(selector),`missing motion material for ${selector}`);
assert(motionCss.includes('-webkit-backdrop-filter:none!important;backdrop-filter:none!important'), 'both browser filter properties must be overridden');
assert(motionCss.includes('--map3d-motion-fill:var(--ui-surface);--map3d-motion-panel:var(--ui-rail)'), 'motion must reuse the themed opaque fallback palette');
assert(!/transition:.*backdrop-filter/.test(motionCss),'backdrop filters must never animate');
console.log('3D glass motion checks passed (continuous jumpTo, quiet interval, DOM writes, exit, 2D isolation and surface coverage)');
