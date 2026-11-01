"use strict";
const {parentPort}=require("worker_threads");
const controllers=new Map();
parentPort.on("message",async message=>{
  const {id,action,args}=message;
  if(message.cancel){controllers.get(id)?.abort();return;}
  const controller=new AbortController();controllers.set(id,controller);
  try{
    let result;
    if(action==="echo") result=args;
    else if(action==="delay") result=await new Promise(resolve=>setTimeout(()=>resolve(args.value),args.ms));
    else if(action==="cooperative-delay"||action==="raw-elevation")result=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>resolve(args.value),args.ms);
      controller.signal.addEventListener('abort',()=>{clearTimeout(timer);reject(Error('cancelled'));},{once:true});
    });
    else if(action==="spin"){
      const end=Date.now()+args.ms;
      while(Date.now()<end){}
      result="finished";
    }else throw new Error("bad fixture action");
    parentPort.postMessage({id,ok:true,result});
  }catch(error){ parentPort.postMessage({id,ok:false,error:String(error.message||error)}) }
  finally{controllers.delete(id);}
});

