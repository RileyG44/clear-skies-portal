"use strict";
const {parentPort}=require("worker_threads");
parentPort.on("message",async message=>{
  const {id,action,args}=message;
  try{
    let result;
    if(action==="echo") result=args;
    else if(action==="delay") result=await new Promise(resolve=>setTimeout(()=>resolve(args.value),args.ms));
    else if(action==="spin"){
      const end=Date.now()+args.ms;
      while(Date.now()<end){}
      result="finished";
    }else throw new Error("bad fixture action");
    parentPort.postMessage({id,ok:true,result});
  }catch(error){ parentPort.postMessage({id,ok:false,error:String(error.message||error)}) }
});

