"use strict";

const assert=require("assert/strict");
const fs=require("fs");
const vm=require("vm");
const A=require("./research-analysis.js");

const width=25,height=21;
const grid=Float32Array.from({length:width*height},(_,index)=>{
  const x=index%width-12,y=Math.floor(index/width)-10;
  return 150+0.3*x*x+0.04*y;
});

assert.equal(A.VERSION,1);
assert.deepEqual(A.PRODUCTS,["lrm","tpi","tri","residual","northness","curvature","glacial","flood"]);
for(const product of A.PRODUCTS){
  const result=A.run({product,scale:"fine",grid,width,height,resolution:2});
  assert.equal(result.data.length,width*height,product);
  assert.equal(result.width,width);
  assert.equal(result.height,height);
  assert(result.label.length>0);
  assert(result.metadata&&result.metadata.kind);
}

const aspect=A.run({product:"northness",scale:"balanced",grid,width,height,resolution:2});
assert(aspect.secondary instanceof Float32Array);
let wire=A.encodeResult(aspect),decoded=A.decodeResult(wire);
assert.equal(decoded.label,aspect.label);
assert.equal(decoded.metadata.kind,aspect.metadata.kind);
assert.deepEqual(Array.from(decoded.data),Array.from(aspect.data));
assert.deepEqual(Array.from(decoded.secondary),Array.from(aspect.secondary));

const candidate=A.run({product:"flood",scale:"broad",grid,width,height,resolution:2});
decoded=A.decodeResult(new Uint8Array(A.encodeResult(candidate)));
assert.equal(decoded.secondary,null);
assert.equal(decoded.notice.observationalOnly,true);
assert.equal(decoded.notice.diagnostic,false);

assert.equal(A.shouldOffload({connected:false,mobile:true,cells:500000}),false);
assert.equal(A.shouldOffload({connected:true,mobile:true,cells:10000}),true);
assert.equal(A.shouldOffload({connected:true,mobile:false,cells:159999,hardwareConcurrency:8}),false);
assert.equal(A.shouldOffload({connected:true,mobile:false,cells:160000,hardwareConcurrency:8}),true);
assert.equal(A.shouldOffload({connected:true,mobile:false,cells:80000,hardwareConcurrency:4}),true);

assert.throws(()=>A.run({product:"bad",scale:"fine",grid,width,height,resolution:2}),/product/);
assert.throws(()=>A.run({product:"lrm",scale:"huge",grid,width,height,resolution:2}),/scale/);
assert.throws(()=>A.run({product:"lrm",scale:"fine",grid,width:2,height:grid.length/2,resolution:2}),/dimensions/);
assert.throws(()=>A.run({product:"lrm",scale:"fine",grid,width,height,resolution:0}),/resolution/);
assert.throws(()=>A.run({product:"lrm",scale:"fine",grid:grid.subarray(1),width,height,resolution:2}),/length/);
const implausible=new Float32Array(width*height).fill(100);implausible[0]=200000;
assert.throws(()=>A.run({product:"lrm",scale:"fine",grid:implausible,width,height,resolution:2}),/implausible/);
assert.throws(()=>A.decodeResult(new ArrayBuffer(3)),/truncated/);
const corrupt=wire.slice(0);new Uint8Array(corrupt)[0]=0;
assert.throws(()=>A.decodeResult(corrupt),/signature/);

// Ordinary browser loading gets the same API without Node globals.
const browser={globalThis:{CSPGlacialResearch:require("./glacial-research-core.js")},TextEncoder,TextDecoder};
vm.runInNewContext(fs.readFileSync(require.resolve("./research-analysis.js"),"utf8"),browser);
assert.equal(typeof browser.globalThis.CSPResearchAnalysis.shouldOffload,"function");

console.log("research analysis dispatcher checks passed");
