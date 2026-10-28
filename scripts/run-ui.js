'use strict';
/* Run a named UI workload against this checkout with private storage. */
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {spawn}=require('node:child_process');
const {startServer}=require('./lib/test-server.js');
const root=path.resolve(__dirname,'..');
async function main(){
  const names=process.argv.slice(2);
  if(!names.length)throw Error('Usage: node scripts/run-ui.js map-popovers [sheet ...]');
  const files=names.map(name=>{
    if(!/^[a-z-]+$/.test(name))throw Error('Invalid suite: '+name);
    const file=path.join(__dirname,`ui-${name}.js`);
    if(!fs.existsSync(file))throw Error('Unknown suite: '+name);
    return file;
  });
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'csp-ui-'));
  const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port))})});
  let server,suiteChild;
  const stopSuite=()=>{if(suiteChild)try{process.kill(-suiteChild.pid,'SIGTERM')}catch(error){}};
  process.once('exit',stopSuite);
  try{
    server=await startServer({port,cacheDir:path.join(temporary,'cache'),markupDir:path.join(temporary,'markup')});
    for(const file of files){
      const result=await new Promise((resolve,reject)=>{
        const child=spawn(process.execPath,[file,`http://127.0.0.1:${port}/`],{cwd:root,env:process.env,stdio:'inherit',detached:true});
        suiteChild=child;
        child.once('error',reject);child.once('exit',(code,signal)=>{suiteChild=null;resolve({code,signal})});
      });
      if(result.code!==0)throw Error(`${path.basename(file)} failed (${result.signal||result.code})`);
    }
  }finally{stopSuite();await server?.stop();fs.rmSync(temporary,{recursive:true,force:true});process.removeListener('exit',stopSuite)}
}
main().catch(error=>{console.error(error);process.exitCode=1});
