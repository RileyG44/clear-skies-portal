'use strict';
// "Smoother panning" (CR-008): the stored mode, the drag latch and auto's
// decision, the CSS-grid drag view, and the shared settings row. No browser.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PAN_SHADING_KEY,panShadingMode,PanShading}=require('./gpu-terrain-layer.js');
const {tileLevel,coverageTiles,gestureView}=require('./gpu-terrain-engine.js')._test;

// Stored mode: only "auto" and "on" are honoured; anything else is off.
const store=value=>({getItem:key=>{assert.equal(key,PAN_SHADING_KEY);return value;}});
assert.equal(PAN_SHADING_KEY,'clearskies.panShading.v1');
assert.equal(panShadingMode(store(null)),'off');
assert.equal(panShadingMode(store('auto')),'auto');
assert.equal(panShadingMode(store('on')),'on');
for(const value of ['off','ON','1','true','',' on'])assert.equal(panShadingMode(store(value)),'off',`stored ${JSON.stringify(value)}`);
assert.equal(panShadingMode(undefined),'off');
assert.equal(panShadingMode({getItem(){throw new Error('denied');}}),'off');

// Off never leaves full resolution, whatever the frames do.
{
  const pan=new PanShading('off');
  assert.equal(pan.begin('k'),false);assert.equal(pan.coarse,false);assert.equal(pan.sampling,false);
  for(let i=0;i<20;i++)assert.equal(pan.frame(200),false);
  assert.equal(pan.coarse,false);assert.equal(pan.end(false),false);
  assert.equal(new PanShading('bogus').mode,'off');assert.equal(new PanShading().mode,'off');
}
// On: coarse from the first dragging move to moveend, never after.
{
  const pan=new PanShading('on');
  assert.equal(pan.begin('k'),true);assert.equal(pan.coarse,true);assert.equal(pan.sampling,false);
  assert.equal(pan.begin('k'),false,'one drag begins once');assert.equal(pan.coarse,true,'inertia keeps the latch');
  assert.equal(pan.end(false),true,'moveend leaves the drag path and asks for a full frame');
  assert.equal(pan.coarse,false);assert.equal(pan.dragging,false);
  // A zoom, rotation or resize ends the path and blocks it until moveend.
  pan.begin('k');assert.equal(pan.end(true),true);
  assert.equal(pan.begin('k'),false);assert.equal(pan.coarse,false,'blocked during a pinch commit');
  pan.end(false);assert.equal(pan.begin('k'),true,'moveend releases the block');
  // Switching modes mid-drag.
  assert.equal(pan.setMode('off'),true);assert.equal(pan.coarse,false);
  assert.equal(pan.setMode('on'),true,'dragging, so on applies at once');assert.equal(pan.coarse,true);
}
// Auto: 3 of the last 8 presented frames over 24 ms switch the rest of that
// drag, and the next drag under the same conditions starts coarse.
{
  const pan=new PanShading('auto');
  assert.equal(pan.begin('a'),false);assert.equal(pan.sampling,true);
  for(const ms of [16.7,16.7,30,16.7,16.7,16.7,24,16.7])assert.equal(pan.frame(ms),false,'24 ms is within budget; one slow frame is not enough');
  assert.equal(pan.frame(25),false);
  assert.equal(pan.frame(40),true,'third slow frame in the window');assert.equal(pan.coarse,true);assert.equal(pan.sampling,false);
  assert.equal(pan.frame(100),false,'already coarse');
  pan.end(false);assert.equal(pan.coarse,false,'settled frames are full resolution');
  assert.equal(pan.begin('a'),true,'remembered for the same state, zoom, viewport and DPR');
  pan.end(false);
  assert.equal(pan.begin('b'),false,'a change forgets it');pan.end(false);
  assert.equal(pan.begin('a'),false,'and stays forgotten');
  // Slow frames that fall out of the 8-frame window do not count.
  const sparse=new PanShading('auto');sparse.begin('c');
  for(const ms of [40,40,16,16,16,16,16,16,16,40])assert.equal(sparse.frame(ms),false);
  assert.equal(sparse.coarse,false);
  // Ignore nonsense intervals; never sample outside a drag or in other modes.
  assert.equal(sparse.frame(NaN),false);assert.equal(sparse.frame(-5),false);
  sparse.end(false);assert.equal(sparse.frame(100),false);
  // Changing mode forgets auto's memory.
  pan.begin('a');for(let i=0;i<3;i++)pan.frame(50);assert.equal(pan.coarse,true);pan.end(false);
  pan.setMode('auto');assert.equal(pan.begin('a'),false);
}

// The CSS-grid drag view keeps the live tile level and every wanted tile;
// only the DPR changes (centre, zoom, bearing and viewport are the same).
for(const zoom of [-3,0,4.49,4.5,13.2,21.4,21.6,24])for(const dpr of [1.5,2,3])for(const dz of [undefined,0,1,2])for(const bearing of [0,37,-90]){
  const live={centerMerc:[0.163,0.352],zoom,bearing,cssSize:[402,874],dpr};
  if(dz!==undefined)live.dz=dz;
  const g=gestureView(live);
  assert.equal(g.dpr,1);assert.deepEqual(g.cssSize,live.cssSize);assert.equal(g.zoom,zoom);assert.equal(g.bearing,bearing);
  assert.deepEqual(g.centerMerc,live.centerMerc);
  assert.equal(tileLevel(g),tileLevel(live),`tile level at z${zoom} dpr${dpr} dz${dz}`);
  assert.deepEqual(coverageTiles(g),coverageTiles(live),`wanted tiles at z${zoom} dpr${dpr} dz${dz}`);
}

// One shared row: the web settings card, persisted only under its key and
// cleared by Reset all preferences; native draws it from the generic row.
const ui=fs.readFileSync('ui-system.js','utf8');
assert.match(ui,/<strong>Smoother panning<\/strong><span>While you drag, terrain is drawn at lower resolution and sharpens when the map stops\./);
assert.match(ui,/<select data-pan-shading aria-label="Smoother panning">\s*<option value="off">Off<\/option><option value="auto">Auto<\/option><option value="on">On<\/option>/);
const reset=ui.match(/const keys=\[([^\]]*)\];/);assert(reset,'reset key list');
assert(reset[1].includes('"clearskies.panShading.v1"'),'Reset all preferences clears the mode');
assert.equal((ui.match(/clearskies\.panShading\.v1/g)||[]).length,3,'written, removed and reset under its own key only');
const sources=fs.readFileSync('app/terrain-sources.js','utf8');
assert.match(sources,/panShading:window\.CSPGpuTerrainLayer\.panShadingMode\(storage\)/);
assert.match(sources,/addEventListener\("csp:pan-shading",event=>gpuTerrainLayer\?\.setPanShading\(event\.detail\?\.mode\)\)/);
const adapter=fs.readFileSync('ios/Resources/native-shell.js','utf8');
assert.match(adapter,/csp-setting-row/,'native renders settings rows generically');
console.log('Pan shading checks passed (mode, drag latch, auto, CSS-grid view, settings row)');
