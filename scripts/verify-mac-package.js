"use strict";
const fs=require("fs"),path=require("path"),os=require("os"),assert=require("assert/strict"),crypto=require("crypto");
const {execFileSync,spawn}=require("child_process"),{once}=require("events"),net=require("net");
const run=(file,args)=>execFileSync(file,args,{encoding:"utf8",stdio:["ignore","pipe","pipe"]});
const hash=file=>crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

async function smoke(appPath,arch){
  if(arch!==process.arch){
    try{run("/usr/bin/arch",[arch==="x64"?"-x86_64":"-arm64","/usr/bin/true"]);}
    catch{console.log(`Cannot execute ${arch} on this host; package and signature checks still required.`);return;}
  }
  const listener=net.createServer();listener.listen(0,"127.0.0.1");await once(listener,"listening");
  const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
  const scratch=fs.mkdtempSync(path.join(os.tmpdir(),"csp-mac-smoke-"));
  const resources=path.join(appPath,"Contents/Resources");
  const child=spawn(path.join(appPath,"Contents/MacOS/ClearSkies"),[path.join(resources,"app/server.js")],{
    env:{...process.env,ELECTRON_RUN_AS_NODE:"1",HOST:"127.0.0.1",PORT:String(port),
      CSP_CACHE_DIR:path.join(scratch,"cache"),CSP_MARKUP_DIR:path.join(scratch,"markup")},
  });
  let output="",spawnError;
  child.stdout.on("data",data=>{output+=data;});child.stderr.on("data",data=>{output+=data;});
  child.on("error",error=>{spawnError=error;});
  try{
    let healthy=false;
    // Rosetta can spend minutes translating the first signed Electron image.
    const attempts=arch===process.arch?100:900;
    console.log(`${arch}: starting bundled engine from mounted DMG${arch===process.arch?"":" (Rosetta translation may take several minutes)"}.`);
    for(let attempt=0;attempt<attempts;attempt++){
      if(spawnError)throw spawnError;
      if(child.exitCode!==null || child.signalCode!==null)throw Error(`Packaged ${arch} engine exited: ${output}`);
      try{
        const health=await fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(1000)});
        if((await health.json()).ok){healthy=true;break;}
      }catch{/* Engine startup is bounded by the attempt limit. */}
      await new Promise(resolve=>setTimeout(resolve,200));
    }
    assert(healthy,`Packaged ${arch} engine did not become healthy: ${output}`);
    const page=await fetch(`http://127.0.0.1:${port}/`);assert.equal(page.status,200);
    assert.match(await page.text(),/ClearSkies/);
    const client=await fetch(`http://127.0.0.1:${port}/app.js`);assert.equal(client.status,200);
    assert((await client.text()).length>1000,"Bundled client must assemble successfully");
    console.log(`${arch}: engine from mounted DMG served healthy API, map and assembled client.`);
  }finally{
    if(child.pid && child.exitCode===null && child.signalCode===null){child.kill();await once(child,"exit");}
    fs.rmSync(scratch,{recursive:true,force:true});
  }
}

async function verify(){
  assert.equal(process.platform,"darwin","Mac packages must be verified on macOS");
  const {extractFile}=await import("@electron/asar");
  const site=require("../site.json"),version=require("../package.json").version,sums=[];
  for(const arch of ["arm64","x64"]){
    const appPath=path.resolve(`dist/mac${arch==="arm64"?"-arm64":""}/ClearSkies.app`);
    const contents=path.join(appPath,"Contents"),resources=path.join(contents,"Resources");
    assert.equal(run("/usr/bin/lipo",["-archs",path.join(contents,"MacOS/ClearSkies")]).trim(),arch==="x64"?"x86_64":arch);
    assert.equal(run("/usr/bin/plutil",["-extract","CFBundleIdentifier","raw","-o","-",path.join(contents,"Info.plist")]).trim(),"com.rileyg44.clear-skies-portal");
    run("/usr/bin/codesign",["--verify","--deep","--strict",appPath]);
    for(const file of [...site.web,...site.app,...site.engine,...site.vendor])
      assert(fs.existsSync(path.join(resources,"app",file)),`Packaged engine/client file missing (${arch}): ${file}`);
    for(const file of ["main.js","preload.js","window-chrome.js","engine-storage.js","setup-config.js","setup/index.html","setup/guide.html","setup/setup.js","setup/setup.css","setup/icon.png","setup/terrain-welcome.webp","setup/fonts/Pacifico.ttf","setup/fonts/Inter.woff2"])
      assert(extractFile(path.join(resources,"app.asar"),`electron/${file}`).length,`Missing shell asset (${arch}): ${file}`);
    for(const name of [`ClearSkies-Setup-${version}-${arch}.dmg`,`ClearSkies-${version}-${arch}.zip`]){
      const file=path.resolve("dist",name);assert(fs.statSync(file).size>1e6,`Empty package: ${name}`);
      if(name.endsWith(".zip"))run("/usr/bin/unzip",["-tq",file]);
      sums.push(`${hash(file)}  ${name}`);
    }
    const mount=fs.mkdtempSync(path.join(os.tmpdir(),"csp-mac-dmg-"));let attached=false;
    try{
      run("/usr/bin/hdiutil",["attach","-readonly","-nobrowse","-mountpoint",mount,path.resolve("dist",`ClearSkies-Setup-${version}-${arch}.dmg`)]);
      attached=true;
      assert.equal(fs.readlinkSync(path.join(mount,"Applications")),"/Applications");
      const installed=path.join(mount,"ClearSkies.app");
      assert.equal(hash(path.join(installed,"Contents/Resources/app.asar")),hash(path.join(resources,"app.asar")));
      run("/usr/bin/codesign",["--verify","--deep","--strict",installed]);
      await smoke(installed,arch);
    }finally{
      if(attached){
        try{run("/usr/bin/hdiutil",["detach",mount]);}
        catch{run("/usr/bin/hdiutil",["detach","-force",mount]);}
      }
      fs.rmSync(mount,{recursive:true,force:true});
    }
  }
  fs.writeFileSync("dist/SHA256SUMS-Mac.txt",sums.join("\n")+"\n");
  console.log("Verified Apple Silicon and Intel DMGs/ZIPs, signatures, bundled engines and welcome pages.");
}
verify().catch(error=>{console.error(error);process.exitCode=1;});
