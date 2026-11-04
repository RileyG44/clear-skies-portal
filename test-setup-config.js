"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("fs"),os=require("os"),path=require("path");
const {DEFAULTS,validate,readConfig,saveConfig,engineEnvironment,customEngine}=require("./electron/setup-config");
test("Setup configuration validates resource limits and stores settings outside the app",()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"csp-setup-config-"));
  try{
    assert.deepEqual(readConfig(dir),DEFAULTS);
    const settings={...DEFAULTS,tileCacheGiB:20,dnrCacheGiB:40,memoryCacheMiB:128,minFreeGiB:4,workers:2,panShading:"on"};
    saveConfig(dir,settings);assert.deepEqual(readConfig(dir),settings);
    for(const invalid of [{tileCacheGiB:0},{dnrCacheGiB:1025},{dnrArchiveGiB:5},{dnrCacheGiB:1,dnrArchiveGiB:2},
      {memoryCacheMiB:31},{minFreeGiB:0},{workers:1.5},{workers:9},{panShading:"ON"},{tileCacheGiB:Infinity},{tileCacheGiB:"15"}]){
      assert.throws(()=>saveConfig(dir,{...settings,...invalid}));
      assert.deepEqual(readConfig(dir),settings,"invalid submissions never replace saved preferences");
    }
    fs.writeFileSync(path.join(dir,"desktop-config.json"),"broken");assert.deepEqual(readConfig(dir),DEFAULTS);
    assert.equal(engineEnvironment(settings).CSP_MEMORY_CACHE_MB,"128");
    assert.equal(engineEnvironment(settings).CSP_TERRAIN_WORKERS,"2");
    assert.equal(engineEnvironment(DEFAULTS).CSP_TERRAIN_WORKERS,"");
    assert.equal(customEngine(DEFAULTS),false);assert.equal(customEngine(settings),true);
    assert.equal(customEngine({...DEFAULTS,panShading:"off"}),false,"panning alone does not replace an installed service");
    assert.deepEqual(validate({...settings,unknown:"ignored"}),settings);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
