"use strict";

importScripts("./glacial-research-core.js","./glacial-segment-core.js","./glacial-segment-features.js",
  "./glacial-moraine-classifier.js","./glacial-zone-core.js","./glacial-zone-features.js","./glacial-belt-classifier.js","./glacial-moraine-analysis.js","./research-analysis.js");

const analysis=self.CSPResearchAnalysis;

self.onmessage=event=>{
  const id=event.data&&event.data.id;
  try{
    const result=analysis.run(event.data),transfer=[result.data.buffer];
    if(result.secondary) transfer.push(result.secondary.buffer);
    self.postMessage({id,ok:true,...result},transfer);
  }catch(error){ self.postMessage({id,ok:false,error:error&&error.message||"Research analysis failed"}) }
};
