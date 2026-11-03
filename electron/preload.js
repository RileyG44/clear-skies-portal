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
    finish:()=>ipcRenderer.invoke("csp:finish-setup"),
  });
}
