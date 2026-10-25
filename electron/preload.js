/* A clear drag strip along the top edge. The traffic lights float over the
   map; panels are not pushed down under an opaque bar. */
if(process.platform==="darwin"){
  const addChrome=()=>{
    document.documentElement.classList.add("csp-electron");
    if(document.getElementById("cspElectronTitlebar"))return;
    const bar=document.createElement("div");bar.id="cspElectronTitlebar";
    bar.setAttribute("aria-hidden","true");document.body.prepend(bar);
  };
  document.addEventListener("DOMContentLoaded",addChrome,{once:true});
}
