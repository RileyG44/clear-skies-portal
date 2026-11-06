'use strict';
/* Native port gates that run with the Node suite:
   - docs/native/ROUTES.md lists every route the engine answers (phase 0);
   - today's cog.js still decodes the frozen L1 TIFF goldens it matched when
     they were frozen (native/fixtures), so the JS reference and the Rust
     port are measured against the same truth. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const inventory=require('./native/inventory/routes.js');
assert.equal(fs.readFileSync(inventory.OUT,'utf8'),inventory.build(),'docs/native/ROUTES.md is stale: run node native/inventory/routes.js');

const cog=require('./cog.js');
const manifest=JSON.parse(fs.readFileSync('native/fixtures/goldens.json','utf8'));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
let checked=0;
for(const c of manifest.cases){
  const file=fs.readFileSync(path.join('native/fixtures',c.file));
  assert.equal(sha(file),c.sha256,`${c.name}: fixture bytes changed`);
  if(!c.jsParity) continue;
  const t=cog.parseTiff(file);
  assert.equal(t.complete,true,c.name);
  c.levels.forEach((want,i)=>{
    const L=t.levels[i];
    assert.deepEqual([L.w,L.h,L.tw,L.th,L.comp,L.pred],[want.w,want.h,want.tw,want.th,want.comp,want.pred],`${c.name} level ${i}`);
    want.blocks.forEach((hash,j)=>{
      const px=Float32Array.from(cog.decodeTile(file.subarray(L.offsets[j],L.offsets[j]+L.counts[j]),L));
      assert.equal(sha(Buffer.from(px.buffer)),hash,`${c.name} level ${i} block ${j}`);checked++;
    });
  });
}
assert(checked>=30);
console.log(`native inventory passed (route list current, cog.js matches ${checked} frozen golden blocks)`);
