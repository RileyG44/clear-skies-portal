'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),os=require('node:os');
const main=fs.readFileSync('electron/main.js','utf8');
const code=main.slice(0,main.indexOf('app.isQuittingCsp = false;'));

function fixture({env={},platform='darwin',installed=true,saved='8770\n',error=null,healthy=true,kickstart=false,config}={}){
  const calls={reads:[],probes:[],waits:[],starts:[],kicks:0};
  const context={__dirname:__dirname+'/electron',process:{platform,env},
    require(name){
      if(name==='electron')return {app:{isPackaged:false}};
      if(name==='fs')return {existsSync:()=>installed};
      if(name==='./window-chrome')return require('./electron/window-chrome');
      if(name==='./engine-storage')return require('./electron/engine-storage');
      if(name==='./setup-config')return require('./electron/setup-config');
      if(name==='./startup-cache')return require('./electron/startup-cache');
      if(name==='child_process')return {execFile:(file,args,options,callback)=>{
        calls.reads.push({file,args,options});callback(error,saved);
      }};
      return require(name);
    }};
  vm.runInNewContext(code,context);
  if(config)vm.runInNewContext(`setupConfig=${JSON.stringify(config)}`,context);
  context.engineUp=async port=>{calls.probes.push(port);return healthy;};
  context.kickstartAgent=async()=>{calls.kicks++;return kickstart;};
  context.freePort=async()=>49152;
  context.startServer=port=>calls.starts.push(port);
  context.waitForServer=async(port,timeout)=>calls.waits.push({port,timeout});
  return {calls,run:()=>context.pickServer()};
}

(async()=>{
  let f=fixture();
  assert.equal(await f.run(),8770,'a Finder launch reuses the installed engine on its saved port');
  assert.deepEqual(f.calls.probes,[8770]);assert.deepEqual(f.calls.starts,[],'no second engine or older bundled client');
  assert.equal(f.calls.reads[0].file,'/usr/bin/plutil');
  assert.deepEqual(Array.from(f.calls.reads[0].args.slice(0,5)),['-extract','EnvironmentVariables.CSP_ENGINE_PORT','raw','-o','-']);
  assert.equal(f.calls.reads[0].args[5],path.join(os.homedir(),'Library','LaunchAgents','com.rileyg44.clear-skies-portal.plist'));
  assert.equal(f.calls.reads[0].options.timeout,2000);

  f=fixture({healthy:false,kickstart:true});
  assert.equal(await f.run(),8770,'a stopped installed engine warms up on the same saved port');
  assert.deepEqual(f.calls.waits,[{port:8770,timeout:15000}]);assert.deepEqual(f.calls.starts,[]);

  f=fixture({env:{CSP_ENGINE_PORT:'9001'}});
  assert.equal(await f.run(),9001,'an explicit environment port overrides the saved port');
  assert.equal(f.calls.reads.length,0);
  for(const invalid of ['0','-1','65536','8770.5','not-a-port']){
    f=fixture({env:{CSP_ENGINE_PORT:invalid}});
    assert.equal(await f.run(),8770,'invalid overrides cannot hide the installed service');
    f=fixture({saved:invalid});assert.equal(await f.run(),8765,'invalid saved ports use the default');
  }
  for(const options of [{installed:false},{platform:'win32'},{saved:''},{error:new Error('missing key')}]){
    f=fixture(options);assert.equal(await f.run(),8765,'default-port installations remain supported');
  }
  f=fixture({healthy:false});
  assert.equal(await f.run(),49152,'an unavailable service still falls back to the bundled engine');
  assert.deepEqual(f.calls.starts,[49152]);assert.equal(f.calls.kicks,1);
  f=fixture({env:{CSP_ELECTRON_OWN_SERVER:'1'}});
  assert.equal(await f.run(),49152,'explicit standalone mode stays standalone');
  assert.equal(f.calls.reads.length,0);assert.equal(f.calls.probes.length,0);assert.equal(f.calls.kicks,0);
  f=fixture({config:{...require('./electron/setup-config').DEFAULTS,tileCacheGiB:20}});
  assert.equal(await f.run(),49152,'custom engine settings run in the bundled engine without changing an installed service');
  assert.equal(f.calls.probes.length,0);assert.deepEqual(f.calls.starts,[49152]);
  console.log('Electron startup: saved engine port, Finder launch, warmup, overrides and bundled fallback passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
