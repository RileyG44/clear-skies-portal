/* A clear drag strip along the top edge. The traffic lights float over the
   map; panels are not pushed down under an opaque bar. */
if(process.platform==="darwin" || process.platform==="win32"){
  const addChrome=()=>{
    document.documentElement.classList.add("csp-electron");
    if(document.getElementById("cspElectronTitlebar"))return;
    const bar=document.createElement("div");bar.id="cspElectronTitlebar";
    bar.setAttribute("aria-hidden","true");document.body.prepend(bar);
  };
  document.addEventListener("DOMContentLoaded",addChrome,{once:true});
}
// Only this bundled, isolated setup document receives the completion bridge.
if(location.protocol==="file:" && /\/setup\/(index|guide)\.html$/.test(location.pathname)){
  const {contextBridge,ipcRenderer}=require("electron");
  contextBridge.exposeInMainWorld("clearSkiesSetup",{
    platform:process.platform,
    configuration:()=>ipcRenderer.invoke("csp:get-setup-config"),
    finish:config=>ipcRenderer.invoke("csp:finish-setup",config),
  });
}
// Seed preferences before page scripts run; the engine's free port can change.
if(location.protocol==="http:" && location.hostname==="127.0.0.1"){
  const {ipcRenderer}=require("electron");
  const preferences=ipcRenderer.sendSync("csp:map-preferences");
  if(preferences){
    try{localStorage.setItem("clearskies.panShading.v1",preferences.panShading);}catch{}
    const savePan=mode=>{try{ipcRenderer.invoke("csp:pan-shading",mode).catch(()=>{});}catch{}};
    document.addEventListener("csp:pan-shading",()=>{
      try{savePan(localStorage.getItem("clearskies.panShading.v1"));}catch{}
    });
    document.addEventListener("click",event=>{
      if(event.target.closest?.("[data-reset-all]"))savePan("auto");
    },true);
  }
}
