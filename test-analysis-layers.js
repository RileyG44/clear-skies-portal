'use strict';
const assert=require('node:assert/strict');
const A=require('./analysis-layers.js'),R=require('./lidar-render.js');

/* Styles: defaults fill gaps, bad values are clamped or dropped. */
const defaults={palette:'grey',blend:'multiply',opacity:.82,relief:0,reverse:false,visible:true};
assert.deepEqual(A.normalizeStyle(null,defaults),defaults);
const style=A.normalizeStyle({palette:'lava',blend:'nonsense',opacity:4,relief:-3,reverse:1,visible:false},defaults);
assert.equal(style.palette,'lava');assert.equal(style.blend,'multiply','unknown blends fall back to the look default');
assert.equal(style.opacity,1);assert.equal(style.relief,0);assert.equal(style.reverse,true);assert.equal(style.visible,false);
assert.equal(A.normalizeStyle({relief:42.6},defaults).relief,43);
for(const blend of R.BLENDS) assert(A.BLENDS.some(b=>b.id===blend.id),`studio blend ${blend.id} is offered`);
assert.equal(A.BLENDS.length,R.BLENDS.length,'analysis blends match the studio set');

/* Palettes: own first, then studio ramps that suit a continuous value. */
const own=[{id:'grey',name:'Greyscale',stops:[[0,'#000000'],[1,'#ffffff']]},{id:'ember',name:'Ember',stops:[[0,'#000000'],[1,'#ffffff']]}];
const list=A.paletteChoices(own,R.PALETTES,true),ids=list.map(p=>p.id);
assert.deepEqual(ids.slice(0,2),['grey','ember']);
assert(ids.includes('studio:viridis')&&ids.includes('studio:cool-warm'),'sequential and diverging studio palettes join');
assert(!ids.some(id=>/studio:(default-|style-|hue-wheel|ink-lines|swiss|ice-glow)/.test(id)),'fixed-range, cyclic, line, shade-only and see-through palettes stay out');
assert(!ids.includes('studio:ember'),'a studio palette with the same name as an own one is not listed twice');
assert.deepEqual(A.paletteChoices(own,R.PALETTES,false).map(p=>p.id),['grey','ember'],'class looks keep their own palettes');
assert.deepEqual(A.studioStops('studio:magma',R.PALETTES)[0],[0,'#000004']);
assert.equal(A.studioStops('grey',R.PALETTES),null);assert.equal(A.studioStops('studio:nope',R.PALETTES),null);
assert.equal(A.gradientCss([[0,'#000000'],[1,'#ffffffcc']],true),'linear-gradient(90deg,#ffffff 0%,#000000 100%)');
assert.equal(A.mount(null,{}),null,'no container, no view');
console.log('analysis layer checks passed (styles, blends, palette sharing)');
