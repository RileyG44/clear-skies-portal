"use strict";
if(window.clearSkiesSetup?.platform==="darwin"){
  const copy={
    "tailscale-download":{text:"Download Tailscale for Mac ↗",href:"https://tailscale.com/download/mac"},
    "tailscale-download-note":{text:"The Mac button opens Tailscale’s official macOS download page. You can install Tailscale during setup or come back later. Tailscale is installed separately and sign-in stays with Tailscale."},
    "reopen-guide":{text:"Reopen this guide from Help → Terrain Engine & Tailscale, or press F1 (Fn-F1 on some keyboards)."},
    "pin-app":{text:"To keep ClearSkies in your Dock, open it from Applications, then Control-click its Dock icon and choose Options → Keep in Dock."},
  };
  for(const [id,value] of Object.entries(copy)){
    const element=document.getElementById(id);
    if(element){element.textContent=value.text;if(value.href)element.href=value.href;}
  }
}
const form=document.getElementById("configuration"),finish=document.getElementById("finish");
let configurationReady=false;
if(form){
  finish.disabled=true;
  const populate=config=>{for(const [key,value] of Object.entries(config))if(form.elements.namedItem(key))form.elements.namedItem(key).value=String(value);};
  window.clearSkiesSetup.configuration().then(result=>{
    if(!result)throw Error("Configuration unavailable");
    populate(result.config);configurationReady=true;finish.disabled=false;
    document.getElementById("restore-defaults").addEventListener("click",()=>populate(result.defaults));
  }).catch(()=>{const error=document.getElementById("error");error.textContent="Could not load setup settings. Close and reopen ClearSkies to try again.";error.hidden=false;});
  form.addEventListener("submit",event=>event.preventDefault());
  document.getElementById("apply-configuration").addEventListener("click",()=>finish.click());
}
document.getElementById("finish").addEventListener("click",async event=>{
  const button=event.currentTarget,error=document.getElementById("error");
  let config;
  if(form){
    if(!configurationReady || !form.reportValidity())return;
    config=Object.fromEntries(Array.from(form.elements).filter(element=>element.name)
      .map(element=>[element.name,element.name==="panShading"?element.value:Number(element.value)]));
    if(config.dnrArchiveGiB>config.dnrCacheGiB){error.textContent="DNR download cache cannot exceed the DNR terrain cache.";error.hidden=false;return;}
  }
  button.disabled=true;error.hidden=true;
  try{if(!await window.clearSkiesSetup.finish(config)) throw new Error("Setup not completed");}
  catch{error.textContent="Could not open the map. Please check your settings and try again.";error.hidden=false;button.disabled=false;}
});
