"use strict";
const fs=require("fs"),path=require("path"),assert=require("assert/strict"),crypto=require("crypto");
async function verify(){
  const {extractFile}=await import("@electron/asar");
  const root=path.resolve("dist/win-unpacked/resources"),site=require("../site.json");
  for(const file of [...site.web,...site.app,...site.engine,...site.vendor])
    assert(fs.existsSync(path.join(root,"app",file)),`Packaged engine/client file missing: ${file}`);
  for(const file of ["electron/main.js","electron/preload.js","electron/window-chrome.js","electron/engine-storage.js","electron/setup-config.js","electron/startup-cache.js","electron/setup/index.html","electron/setup/guide.html","electron/setup/setup.js","electron/setup/setup.css","electron/setup/icon.png","electron/setup/terrain-welcome.webp","electron/setup/fonts/Pacifico.ttf","electron/setup/fonts/Inter.woff2"])
    assert(extractFile(path.join(root,"app.asar"),path.normalize(file)).length,`Shell asset missing: ${file}`);
  const ico=fs.readFileSync(path.join(root,"ClearSkies.ico"));
  assert.equal(ico.readUInt16LE(2),1);assert.equal(ico.readUInt16LE(4),1);
  const version=require("../package.json").version;
  const names=[`ClearSkies-Setup-${version}-x64.exe`,`ClearSkies-Guided-Setup-${version}-x64.exe`,`ClearSkies-${version}-x64.zip`];
  const sums=names.map(name=>{
    const data=fs.readFileSync(path.join("dist",name));assert(data.length>1e6,`Empty installer: ${name}`);
    if(name.endsWith(".exe"))assert.equal(data.toString("ascii",0,2),"MZ");
    return `${crypto.createHash("sha256").update(data).digest("hex")}  ${name}`;
  });
  fs.writeFileSync("dist/SHA256SUMS-Windows.txt",sums.join("\n")+"\n");
  if(process.platform==="win32"){
    const {spawn}=require("child_process"),{once}=require("events"),net=require("net"),os=require("os");
    const listener=net.createServer();listener.listen(0,"127.0.0.1");await once(listener,"listening");
    const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
    const scratch=fs.mkdtempSync(path.join(os.tmpdir(),"csp-package-smoke-"));
    const child=spawn(path.resolve("dist/win-unpacked/Clear Skies Portal.exe"),[path.join(root,"app/server.js")],{
      env:{...process.env,ELECTRON_RUN_AS_NODE:"1",HOST:"127.0.0.1",PORT:String(port),
        CSP_CACHE_DIR:path.join(scratch,"cache"),CSP_MARKUP_DIR:path.join(scratch,"markup"),CSP_STARTUP_CACHE_DIR:path.join(root,"startup-cache")},windowsHide:true});
    let output="",spawnError;
    child.stdout.on("data",data=>{output+=data;});child.stderr.on("data",data=>{output+=data;});
    child.on("error",error=>{spawnError=error;});
    try{
      let healthy=false;
      for(let attempt=0;attempt<100;attempt++){
        if(spawnError)throw spawnError;
        if(child.exitCode!==null)throw Error(`Packaged engine exited: ${output}`);
        try{
          const health=await fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(1000)});
          if((await health.json()).ok){healthy=true;break;}
        }catch{/* Wait for engine startup, bounded below. */}
        await new Promise(resolve=>setTimeout(resolve,200));
      }
      assert(healthy,`Packaged engine did not become healthy: ${output}`);
      const page=await fetch(`http://127.0.0.1:${port}/`);assert.equal(page.status,200);
      assert.match(await page.text(),/ClearSkies/);
      const seed=await fetch(`http://127.0.0.1:${port}/api/elev/overview/10/177/357.png`);
      assert.equal(seed.headers.get("X-Cache"),"hit");
      console.log("Packaged Electron runtime started the bundled engine: health and client HTTP 200.");
    }finally{
      if(child.exitCode===null){child.kill();await once(child,"exit");}
      fs.rmSync(scratch,{recursive:true,force:true});
    }
  }
  console.log("Verified complete bundled engine, setup guide, icon, both installers and portable ZIP.");
}
verify().catch(error=>{console.error(error);process.exitCode=1;});
