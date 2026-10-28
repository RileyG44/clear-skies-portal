"use strict";

const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {execFileSync}=require("node:child_process");
const site=require("./site.js");
const root=__dirname;
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),"csp-assets-"));
const web=path.join(temporary,"web");
try {
  execFileSync("python3",["scripts/assemble-site.py",root,web],{cwd:root});
  for(const file of [...site.web,...site.vendor]){
    assert.deepEqual(fs.readFileSync(path.join(web,file)),fs.readFileSync(path.join(root,file)),`assembled bytes: ${file}`);
  }
  assert.equal(fs.readFileSync(path.join(web,"app.js"),"utf8"),site.appSource(),"Python and Node must build identical application bytes");
  for(const file of site.engine) assert(!fs.existsSync(path.join(web,file)),`engine file leaked to web: ${file}`);
  const html=fs.readFileSync(path.join(web,"index.html"),"utf8").replace(/(<script\b[^>]*>)[\s\S]*?<\/script>/gi,"$1</script>");
  for(const [,file] of html.matchAll(/(?:src|href)="([^"?#]+)(?:\?[^"#]*)?"/g)){
    if(/^(?:[a-z]+:|\/|#)/i.test(file)) continue;
    assert(fs.existsSync(path.join(web,file)),`assembled page dependency missing: ${file}`);
  }
  const runtime=path.join(web,"vendor/potree/build/potree/potree.js");
  if(fs.existsSync(path.join(root,"vendor/potree"))) assert(fs.statSync(runtime).size>100000,"installed optional point-cloud runtime must ship");
  console.log("Asset checks passed (actual assembly, byte equivalence, app build, dependency closure, engine isolation)");
} finally {
  fs.rmSync(temporary,{recursive:true,force:true});
}
