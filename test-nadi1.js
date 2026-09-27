/* The bundled NADI-1 ice-margin slices: one best-estimate fill per slice, every
   slice the overlay's slider can reach, and nothing outside the clip box. */
"use strict";
const assert=require("assert");
const data=require("./nadi1-cordilleran.json");

let passed=0;
const ok=(name,fn)=>{ fn();passed++;console.log("  ok  ",name) };

const expected=Array.from({length:30},(_,i)=>25-i*.5);
const [w,s,e,n]=data.bbox;

ok("is a FeatureCollection with a cited source",()=>{
  assert.strictEqual(data.type,"FeatureCollection");
  assert.match(data.source.doi,/10\.1016\/j\.quascirev\.2023\.108345/);
  assert.match(data.source.data,/zenodo\.8161764/);
});
ok("lists exactly the slices the overlay slider offers",()=>{
  assert.deepStrictEqual(data.slices,expected);
});
ok("every slice has one ice fill and a best-estimate margin",()=>{
  for(const ka of expected){
    const kinds=data.features.filter(f=>f.properties.ka===ka).map(f=>f.properties.kind);
    assert.strictEqual(kinds.filter(k=>k==="ice").length,1,`ice fill at ${ka} ka`);
    assert.ok(kinds.includes("optimal"),`optimal margin at ${ka} ka`);
  }
});
ok("uses only known feature kinds",()=>{
  for(const f of data.features) assert.ok(["ice","optimal","min","max"].includes(f.properties.kind));
});
ok("stays inside its clip box",()=>{
  const walk=c=>typeof c[0]==="number"
    ? assert.ok(c[0]>=w-1e-6&&c[0]<=e+1e-6&&c[1]>=s-1e-6&&c[1]<=n+1e-6,`coordinate ${c}`)
    : c.forEach(walk);
  for(const f of data.features) walk(f.geometry.coordinates);
});
ok("ice retreats north between the maximum and the youngest slice",()=>{
  const south=ka=>{
    let min=Infinity;
    const walk=c=>typeof c[0]==="number"?(min=Math.min(min,c[1])):c.forEach(walk);
    walk(data.features.find(f=>f.properties.ka===ka&&f.properties.kind==="ice").geometry.coordinates);
    return min;
  };
  assert.ok(south(10.5)>south(17.5));
});

console.log(`\n${passed} passed, 0 failed\nNADI-1 ice-margin checks passed`);
