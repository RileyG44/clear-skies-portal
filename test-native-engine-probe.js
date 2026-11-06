'use strict';
/* Whether the page asks for an engine at all. The iPhone app used to be
   treated as engine-less outright, so an engine built into the app could
   never be found; now the app says whether it has one. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app/terrain-sources.js','utf8');
const from=source.indexOf('const NATIVE_HOST='),to=source.indexOf('let nativeEngineSync=',from);
const gate=source.slice(from,to);
const expected=(host,hostname,base)=>{
  const ctx={window:host===undefined?{}:{CSPNativeHost:host},location:{hostname}};
  vm.runInNewContext(gate+';this.result=engineExpected(base)',Object.assign(ctx,{base}));
  return ctx.result;
};
assert.equal(expected({},'app',''),false,'the app without its own engine asks nothing');
assert.equal(expected({builtInEngine:true},'app',''),true,'the app with a built-in engine probes it');
assert.equal(expected({builtInEngine:'yes'},'app',''),false,'only an explicit true counts');
assert.equal(expected({},'app','https://dell.tail.ts.net'),true,'an entered address is always asked');
assert.equal(expected(undefined,'rileyg44.github.io',''),false,'GitHub Pages is static');
assert.equal(expected(undefined,'rileyg44.github.io','https://dell.tail.ts.net'),true);
assert.equal(expected(undefined,'localhost',''),true,'locally served pages auto-detect');
for(const file of ['app/terrain.js','app/controls.js']){
  const code=fs.readFileSync(file,'utf8');
  assert(!/NATIVE_HOST\|\|\/\\\.github/.test(code),`${file} no longer hard-codes the app as engine-less`);
  assert(code.includes('engineExpected('),`${file} uses the shared gate`);
}
const host=fs.readFileSync('ios/Resources/native-host.js','utf8'),swift=fs.readFileSync('ios/Sources/Web/WebHost.swift','utf8');
assert.match(host,/builtInEngine: config\.builtInEngine === true/);
assert.match(swift,/"builtInEngine": builtInEngine/);
console.log('native engine probe passed (app asks only when it has an engine, Pages stays static, addresses always asked)');
