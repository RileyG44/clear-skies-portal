'use strict';
// Security overrides cross major versions of the packaging helpers. Exercise
// their actual consumers: native-module unpacking, template file lists and
// the Windows installer's tracked temporary-directory cleanup.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const asar=require('@electron/asar'),{FileList}=require('filelist'),temp=require('temp');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'csp-packaging-'));
(async()=>{
  try{
    const source=path.join(directory,'source'),archive=path.join(directory,'app.asar');
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(source,'main.js'),'module.exports = 42;');
    fs.writeFileSync(path.join(source,'native.node'),'native fixture');
    await asar.createPackageWithOptions(source,archive,{unpack:'*.node'});
    assert.equal(asar.extractFile(archive,'main.js').toString(),'module.exports = 42;');
    assert.equal(fs.readFileSync(path.join(archive+'.unpacked','native.node'),'utf8'),'native fixture');
    const pattern=path.join(source,'*.js');
    for(const glob of [pattern.replaceAll('\\','/'),pattern.replaceAll('/','\\')])
      assert(new FileList(glob).toArray().some(file=>path.basename(file)==='main.js'),'template patterns accept either path separator');

    temp.track();
    const sync=temp.mkdirSync({dir:directory,prefix:'installer-sync-'});
    fs.writeFileSync(path.join(sync,'payload'),'fixture');
    temp.cleanupSync();assert.equal(fs.existsSync(sync),false);
    const asyncDir=await new Promise((resolve,reject)=>temp.mkdir({dir:directory,prefix:'installer-async-'},(error,name)=>error?reject(error):resolve(name)));
    fs.writeFileSync(path.join(asyncDir,'payload'),'fixture');
    await new Promise((resolve,reject)=>temp.cleanup(error=>error?reject(error):resolve()));
    assert.equal(fs.existsSync(asyncDir),false);
    console.log('Packaging dependency compatibility passed (ASAR unpacking, template glob, installer temp cleanup)');
  }finally{temp.track(false);fs.rmSync(directory,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
