'use strict';
// Keep the terrain backend in development previews; a static file server would
// silently disable WA DNR and all raw-elevation routes.
const {parseArgs}=require('node:util');
const {spawn}=require('node:child_process');
const path=require('node:path');
const {values}=parseArgs({options:{host:{type:'string'},port:{type:'string'},strictPort:{type:'boolean'}}});
const port=values.port||process.env.PORT||'8765';
if(!/^\d+$/.test(port)||+port<1||+port>65535)throw new Error('Port must be between 1 and 65535');
const child=spawn(process.execPath,[path.join(__dirname,'..','server.js')],{
  env:{...process.env,HOST:values.host||process.env.HOST||'127.0.0.1',PORT:port},stdio:'inherit'
});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('exit',code=>{process.exitCode=code??0;});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
