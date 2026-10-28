'use strict';
/* Owned verification servers only. Attaching to a known server is an explicit
   decision of the caller; a failed start must never measure a different app. */
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {spawn}=require('node:child_process');
const ROOT=path.resolve(__dirname,'../..');
const owned=new Set();
function portOpen(port){
  return new Promise(resolve=>{
    const req=http.get({host:'127.0.0.1',port,path:'/',timeout:1500},res=>{res.resume();resolve(res.statusCode>0&&res.statusCode<500)});
    req.on('error',()=>resolve(false));req.on('timeout',()=>{req.destroy();resolve(false)});
  });
}
function signal(child,name){
  try{process.kill(-child.pid,name)}catch(error){try{child.kill(name)}catch(error){}}
}
function stopChild(child){
  return new Promise(resolve=>{
    if(!child||!child.pid||child.exitCode!==null||child.signalCode!==null){owned.delete(child);return resolve()}
    const timer=setTimeout(()=>signal(child,'SIGKILL'),2500);
    child.once('exit',()=>{clearTimeout(timer);owned.delete(child);resolve()});
    signal(child,'SIGTERM');
  });
}
async function startServer({port,cacheDir,markupDir,root=ROOT,timeout=45000}){
  if(port===8765)throw Error('Port 8765 is the live service.');
  if(await portOpen(port))throw Error(`Port ${port} is already in use; refusing to attach.`);
  fs.mkdirSync(cacheDir,{recursive:true});
  const env={...process.env,HOST:'127.0.0.1',PORT:String(port),CSP_CACHE_DIR:cacheDir};
  env.CSP_MARKUP_DIR=markupDir||path.join(cacheDir,'markup');
  const child=spawn(process.execPath,['server.js'],{cwd:root,env,stdio:['ignore','pipe','pipe'],detached:true});
  owned.add(child);
  let log='',spawnError=null;
  const take=data=>{log=(log+data).slice(-4000)};
  child.stdout.on('data',take);child.stderr.on('data',take);
  child.on('error',error=>{spawnError=error});
  try{
    const start=Date.now();
    while(Date.now()-start<timeout){
      if(spawnError)throw spawnError;
      if(child.exitCode!==null||child.signalCode!==null)throw Error(`server exited ${child.exitCode}\n${log}`);
      if(await portOpen(port))return {port,cacheDir,owned:true,child,stop:()=>stopChild(child)};
      await new Promise(resolve=>setTimeout(resolve,200));
    }
    throw Error(`server did not listen on ${port}\n${log}`);
  }catch(error){await stopChild(child);throw error}
}
process.on('exit',()=>{for(const child of owned)signal(child,'SIGTERM')});
process.on('SIGINT',()=>process.exit(130));
process.on('SIGTERM',()=>process.exit(143));
module.exports={portOpen,startServer,stopChild};
