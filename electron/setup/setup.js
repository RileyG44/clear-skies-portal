"use strict";
document.getElementById("finish").addEventListener("click",async event=>{
  const button=event.currentTarget,error=document.getElementById("error");
  button.disabled=true;error.hidden=true;
  try{if(!await window.clearSkiesSetup.finish()) throw new Error("Setup not completed");}
  catch{error.hidden=false;button.disabled=false;}
});
