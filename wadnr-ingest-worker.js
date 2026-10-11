"use strict";
const {parentPort}=require("node:worker_threads");
const {acquire}=require("./vendor/dnr-runtime.cjs");
parentPort.on("message",async args=>{
  try{
    const result=await acquire(args,progress=>parentPort.postMessage({progress}));
    parentPort.postMessage({result});
  }catch(error){parentPort.postMessage({error:String(error.message||error)});}
});
