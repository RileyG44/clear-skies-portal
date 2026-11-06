'use strict';
/* The offline-download size shown before a download starts follows what the
   engine will actually store: about 80 KB per elevation tile, a second one
   from z13 for raw 1 m lidar, and two rendered images for WA DNR. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app/areas.js','utf8');
const slice=(from,to)=>source.slice(source.indexOf(from),source.indexOf(to,source.indexOf(from)));
const ctx={};
vm.runInNewContext(slice('function warmTileEstimate(','/* Ground resolution')+
  slice('const ELEVATION_TILE_BYTES','function warmPreview(')+
  ';this.api={warmTileEstimate,warmTileBytes,warmBytes};',ctx);
const {warmTileEstimate,warmBytes}=ctx.api;
assert(!/TILE_BYTES\s*=\s*18000/.test(source),'the flat PNG-era estimate is gone');
/* A small box near Mount Rainier, as Leaflet bounds. */
const b={getWest:()=>-121.80,getEast:()=>-121.74,getSouth:()=>46.84,getNorth:()=>46.88};
const tiles=(z0,z1)=>warmTileEstimate(b,z0,z1);
assert.equal(warmBytes(b,15,18,'3dep'),tiles(15,18)*80000);
assert.equal(warmBytes(b,15,18,'usgs1m'),tiles(15,18)*160000,'raw keeps the national and the 1 m tile');
assert.equal(warmBytes(b,11,12,'usgs1m'),tiles(11,12)*80000,'below z13 there is no raw tile');
assert.equal(warmBytes(b,12,13,'usgs1m'),tiles(12,12)*80000+tiles(13,13)*160000);
assert.equal(warmBytes(b,15,18,'wadnr'),tiles(15,18)*100000);
assert(warmBytes(b,15,18,'usgs1m')>=tiles(15,18)*18000*8,'raw downloads were understated about ninefold');
console.log('warm estimate passed (source-aware bytes per tile, raw from z13, WA DNR rendered pair)');
