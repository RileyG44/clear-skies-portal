'use strict';
const assert=require('node:assert/strict');
const terrain=require('./public-terrain');
const url=new URL(terrain.nationalUrl({z:18,x:44190,y:92080}));
assert.equal(url.searchParams.get('pixelType'),'F32');
assert.equal(url.searchParams.get('format'),'lerc');
assert.deepEqual(JSON.parse(url.searchParams.get('renderingRule')),{rasterFunction:'None'});
assert.equal(terrain.nationalUrl({z:2,x:-1,y:1}),terrain.nationalUrl({z:2,x:3,y:1}),'wrap longitudes consistently');
assert.throws(()=>terrain.nationalUrl({z:19,x:0,y:0}),RangeError);
const block={width:2,height:2,pixels:[new Float32Array([0,15,-3.402823e38,20])],mask:new Uint8Array([1,0,1,1])};
const decoded=terrain.decode(block);
assert.equal(decoded.grid[0],0,'sea level is valid');
assert.ok(Number.isNaN(decoded.grid[1]),'respect LERC masks');
assert.ok(Number.isNaN(decoded.grid[2]),'respect missing elevation sentinels');
assert.equal(decoded.grid[3],20);
assert.equal(terrain.decode({...block,mask:new Uint8Array(4)}),null);
assert.throws(()=>terrain.decode({...block,pixels:[new Float32Array(3)]}));
const tiles=[
  {current:true,el:{_cspHasContent:true,_cspSourceCounts:{1:1,2:3},_cspRefining:true}},
  {current:false,el:{_cspHasContent:true,_cspSourceCounts:{3:100}}},
  {current:true,el:{_cspHasContent:false,_cspSourceCounts:{3:4}}}
];
const summary=terrain.summarize(tiles);
assert.equal(summary.coverage,50);assert.equal(summary.refining,true);
assert.deepEqual(summary.sources.map(s=>[s.rank,s.percent]),[[2,75],[1,25]],'never attribute hidden, failed or retired pixels');
assert.equal(terrain.summarize([]).sources.length,0);
console.log('public terrain checks passed (raw elevation URL, masks, nodata, mixed sources, hidden tiles)');
