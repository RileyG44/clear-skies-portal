'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {startServer,portOpen}=require('./scripts/lib/test-server.js');
const freePort=()=>new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port))})});
(async()=>{
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'csp-browser-tools-'));
  let server;
  try{
    const port=await freePort();
    server=await startServer({port,cacheDir:path.join(temporary,'cache'),markupDir:path.join(temporary,'markup')});
    assert(await portOpen(port));
    const health=await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();
    assert(health.features.includes('wadnr-elevation'),'verification uses the actual engine, not a static server');
    await assert.rejects(startServer({port,cacheDir:path.join(temporary,'wrong')}),/already in use/);
    assert(!fs.existsSync(path.join(temporary,'wrong')),'refusing an occupied port must not prepare another cache');
    const child=server.child;await server.stop();
    assert(child.exitCode!==null||child.signalCode!==null,'stop waits for owned server exit');
    assert.equal(await portOpen(port),false);await server.stop();
    const failedPort=await freePort();
    await assert.rejects(startServer({port:failedPort,root:temporary,cacheDir:path.join(temporary,'failed')}),/server exited/);
    assert.equal(await portOpen(failedPort),false,'failed startup leaves no server');
    await assert.rejects(startServer({port:8765,cacheDir:temporary}),/live service/);
    console.log('Browser tooling lifecycle checks passed (real engine, private storage, occupied-port refusal, cleanup and failed startup)');
  }finally{await server?.stop();fs.rmSync(temporary,{recursive:true,force:true})}
})().catch(error=>{console.error(error);process.exitCode=1});
