/* Reserve a separate macOS drag strip. The map may show faintly through it,
   while every panel uses the same safe-top offset below the window buttons. */
if(process.platform==="darwin"){
  const addChrome=()=>{
    document.documentElement.classList.add("csp-electron");
    if(document.getElementById("cspElectronTitlebar"))return;
    const bar=document.createElement("div");bar.id="cspElectronTitlebar";
    bar.setAttribute("aria-hidden","true");document.body.prepend(bar);
  };
  document.addEventListener("DOMContentLoaded",addChrome,{once:true});
}
