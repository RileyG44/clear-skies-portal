"use strict";

importScripts("./glacial-research-core.js","./research-analysis.js");

const analysis=self.CSPResearchAnalysis;

self.onmessage=event=>{
  const id=event.data&&event.data.id;
  try{
    const result=analysis.run(event.data),transfer=[result.data.buffer];
    if(result.secondary) transfer.push(result.secondary.buffer);
    self.postMessage({id,ok:true,...result},transfer);
  }catch(error){ self.postMessage({id,ok:false,error:error&&error.message||"Research analysis failed"}) }
};
