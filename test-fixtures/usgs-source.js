'use strict';
/* Production source code, real TIFF parsing/deflate decoding and disk caches;
   only HTTPS and its clock are controlled. No provider or installed service. */
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),{execFileSync}=require('node:child_process');
const {EventEmitter}=require('node:events'),zlib=require('node:zlib');
const root=path.resolve(__dirname,'..'),sourceRequire=createRequire(path.join(root,'usgs.js'));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function sourceCode(file,ref){return ref?execFileSync('git',['show',`${ref}:${file}`],{cwd:root,encoding:'utf8'}):fs.readFileSync(path.join(root,file),'utf8');}
function tiff(){
  const pixels=Buffer.alloc(512*512*4);for(let i=0;i<pixels.length;i+=4)pixels.writeFloatLE(123.5,i);
  const block=zlib.deflateSync(pixels),offset=65536;
  const tags=[[256,4,512],[257,4,512],[258,3,32],[259,3,8],[277,3,1],[317,3,1],
    [322,4,512],[323,4,512],[324,4,offset],[325,4,block.length],[339,3,3]];
  const buffer=Buffer.alloc(offset+block.length);buffer.write('II');buffer.writeUInt16LE(42,2);
  buffer.writeUInt32LE(8,4);buffer.writeUInt16LE(tags.length,8);
  tags.forEach(([tag,type,value],i)=>{const p=10+i*12;buffer.writeUInt16LE(tag,p);buffer.writeUInt16LE(type,p+2);
    buffer.writeUInt32LE(1,p+4);if(type===3)buffer.writeUInt16LE(value,p+8);else buffer.writeUInt32LE(value,p+8);});
  block.copy(buffer,offset);return buffer;
}
function fixture({ref,concurrency=1,latency=20}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'csp-source-queue-')),bytes=tiff(),requests=[];
  const counters={parses:0,decodes:0,maxActive:0};let now=0;
  const cog=sourceRequire('./cog.js');
  const fakeHttps={Agent:class{},request:(options,callback)=>{
    const req=new EventEmitter();req.setTimeout=()=>req;
    req.destroy=error=>{if(error)queueMicrotask(()=>req.emit('error',error));};
    req.end=()=>{
      const [,a,b]=options.headers.Range.match(/bytes=(\d+)-(\d+)/);
      requests.push({req,callback,path:options.path,a:+a,b:+b,at:now+latency,active:true});
      counters.maxActive=Math.max(counters.maxActive,requests.filter(r=>r.active).length);
    };
    return req;
  }};
  const context={module:{exports:{}},Buffer,AbortController,console,setTimeout,clearTimeout,
    process:{...process,env:{...process.env,CSP_S3_INFLIGHT:String(concurrency)}},
    require:name=>name==='https'?fakeHttps:name==='fs'?{...fs,statfsSync:()=>({bavail:1e9,bsize:4096})}:
      name==='./cog.js'?{...cog,parseTiff:(...args)=>{counters.parses++;return cog.parseTiff(...args);},
        decodeTile:(...args)=>{counters.decodes++;return cog.decodeTile(...args);}}:sourceRequire(name)};
  vm.runInNewContext(sourceCode('usgs.js',ref)+`\nmodule.exports.queueStats=()=>({active:s3Inflight,queued:s3Queue.length});
    module.exports.testGate={take:takeS3Slot,release:releaseS3Slot};`,context,{filename:'usgs.js'});
  const source=context.module.exports;source.init(dir);
  function complete(request,{status=206,body}={}){
    if(!request?.active)throw Error('no active fixture request');
    request.active=false;
    const response=new EventEmitter();response.statusCode=status;response.headers={};request.callback(response);
    response.emit('data',body??bytes.subarray(request.a,request.b+1));response.emit('end');
  }
  async function advance(){
    await tick();const next=requests.filter(r=>r.active).sort((a,b)=>a.at-b.at)[0];
    if(!next)return false;now=next.at;complete(next);await tick();return true;
  }
  async function drain(){for(let i=0;i<10000;i++){if(!await advance())return;}throw Error('source fixture did not drain');}
  return {source,requests,counters,bytes,complete,advance,drain,tick,get now(){return now;},
    close:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
module.exports={fixture,sourceCode,tick,root};
