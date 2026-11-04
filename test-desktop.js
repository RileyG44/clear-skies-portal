"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const fs=require("fs"),vm=require("vm"),path=require("path"),{EventEmitter}=require("events");
const {windowChrome}=require("./electron/window-chrome");
async function fixture({platform="win32",completed=false,argv=[]}={}){
  const calls={opened:[],writes:[],windows:[],configWrites:[],serverStarts:0,views:[]},handlers={},app=new EventEmitter();
  let ready;
  Object.assign(app,{isPackaged:true,getPath:()=>path.resolve("test-user-data"),
    requestSingleInstanceLock:()=>true,whenReady:()=>({then:fn=>{ready=fn;}}),
    setAppUserModelId:id=>{calls.appId=id;},quit:()=>{calls.quit=true;}});
  class Content extends EventEmitter{
    getURL(){return this.url;}
    loadURL(url){this.url=url;this.loads=(this.loads||0)+1;return Promise.resolve();}
    loadFile(file){return this.loadURL(require("url").pathToFileURL(file).href);}
    setWindowOpenHandler(fn){this.open=fn;}
    executeJavaScript(source){calls.executed=source;return Promise.resolve();}
    isDestroyed(){return !!this.destroyed;}
    close(){this.destroyed=true;}
  }
  class Window extends EventEmitter{
    constructor(options){super();this.options=options;this.webContents=new Content();
      this.contentView={addChildView(){},removeChildView(){}};calls.windows.push(this);}
    get url(){return this.webContents.url;}
    loadURL(url){return this.webContents.loadURL(url);}
    setMenu(value){this.menu=value;}
    getContentBounds(){return {width:1400,height:900};}
    isMinimized(){return false;} focus(){}
  }
  class View{
    constructor(){this.webContents=new Content();calls.views.push(this);}
    get url(){return this.webContents.url;}
    setBounds(bounds){this.bounds=bounds;}
    setBackgroundColor(){}
  }
  const fakeFS={existsSync:()=>completed,mkdirSync:()=>{},writeFileSync:(...args)=>calls.writes.push(args)};
  const context={console,URL,__dirname:path.resolve("electron"),process:{platform,env:{},argv,resourcesPath:path.resolve("resources")},
    require:name=>name==="electron"?{app,BrowserWindow:Window,WebContentsView:View,Menu:{buildFromTemplate:items=>items,setApplicationMenu:items=>{calls.menu=items;}},shell:{openExternal:url=>calls.opened.push(url)},
      dialog:{showErrorBox:(...args)=>{throw Error(args.join(":"));}},session:{defaultSession:{setPermissionRequestHandler(){}}},
      ipcMain:{handle:(name,fn)=>{handlers[name]=fn;},on:(name,fn)=>{handlers[name]=fn;}}}:name==="fs"?fakeFS:name==="./window-chrome"?{windowChrome}:name==="./engine-storage"?require("./electron/engine-storage"):name==="./startup-cache"?{installStartupCache:async()=>({installed:0})}:name==="./setup-config"?{
        ...require("./electron/setup-config"),readConfig:()=>({...require("./electron/setup-config").DEFAULTS}),saveConfig:(_dir,value)=>{calls.configWrites.push(value);return value;},
      }:require(name)};
  vm.runInNewContext(fs.readFileSync("electron/main.js","utf8"),context);
  context.pickServer=async()=>{calls.serverStarts++;return 49152;};
  await ready();
  return {calls,handlers,win:calls.windows[0],get setup(){return calls.views.at(-1);},app};
}
test("Windows first launch shows setup, completion saves once and opens local engine",async()=>{
  const f=await fixture(),w=f.win;
  assert.equal(f.calls.serverStarts,1,"setup starts warming the engine immediately");
  assert.match(f.setup.url,/\/electron\/setup\/index.html$/);assert.equal(w.menu,null);
  assert.equal(w.options.titleBarStyle,"hidden");assert.equal(w.options.titleBarOverlay.height,30);
  assert.equal(w.options.webPreferences.nodeIntegration,false);assert.equal(w.options.webPreferences.contextIsolation,true);
  const finish=f.handlers["csp:finish-setup"],url=f.setup.url;
  const warmed=w.webContents.loads;
  assert.equal(await finish({sender:{},senderFrame:{url}}),false,"another window cannot complete setup");
  assert.equal(await finish({sender:f.setup.webContents,senderFrame:{url:"https://untrusted.example"}}),false);
  assert.equal(f.calls.writes.length,0);
  assert.equal(await finish({sender:f.setup.webContents,senderFrame:{url}}),true);
  assert.equal(f.calls.writes.length,1);assert.equal(w.url,"http://127.0.0.1:49152/");
  assert.ok(JSON.parse(f.calls.writes[0][1]).completedAt);
  assert.equal(f.calls.serverStarts,1);
  assert.equal(w.webContents.loads,warmed,"finishing default setup retains the already-rendering map");
  assert.equal(f.setup.webContents.isDestroyed(),true,"welcome is dismissed after map preparation");
  assert.equal(f.calls.configWrites[0].panShading,"auto");
});
test("Advanced setup applies validated configuration; untrusted pages and invalid values cannot save",async()=>{
  for(const platform of ["win32","darwin"]){
    const f=await fixture({platform}),event={sender:f.setup.webContents,senderFrame:{url:f.setup.url}};
    const loaded=f.handlers["csp:get-setup-config"](event);
    assert.equal(loaded.config.tileCacheGiB,15);assert.equal(loaded.defaults.panShading,"auto");
    assert.equal(f.handlers["csp:get-setup-config"]({sender:{},senderFrame:{url:f.win.url}}),null);
    const config={...loaded.config,tileCacheGiB:23,memoryCacheMiB:128,workers:2,panShading:"on"};
    await assert.rejects(f.handlers["csp:finish-setup"](event,{...config,workers:99}));
    assert.equal(f.calls.configWrites.length,0);assert.equal(f.calls.writes.length,0);
    assert.equal(await f.handlers["csp:finish-setup"](event,config),true);
    assert.equal(f.calls.configWrites[0].tileCacheGiB,23);assert.equal(f.calls.serverStarts,2);
    const mapEvent={sender:f.win.webContents,senderFrame:{url:f.win.url}};
    f.handlers["csp:map-preferences"](mapEvent);assert.equal(mapEvent.returnValue.panShading,"on");
    assert.equal(f.handlers["csp:pan-shading"](mapEvent,"off"),true);
    assert.equal(f.calls.configWrites.at(-1).panShading,"off");
    assert.equal(f.handlers["csp:pan-shading"]({...mapEvent,senderFrame:{url:"https://untrusted.example/"}},"on"),false);
  }
});
test("Map preload carries smoother panning across engine ports and saves in-app changes",async()=>{
  const stored=new Map(),listeners={},updates=[];
  vm.runInNewContext(fs.readFileSync("electron/preload.js","utf8"),{
    process:{platform:"darwin"},location:{protocol:"http:",hostname:"127.0.0.1"},
    localStorage:{setItem:(key,value)=>stored.set(key,value),getItem:key=>stored.get(key)},
    document:{addEventListener:(name,handler)=>{listeners[name]=handler;}},
    require:()=>({ipcRenderer:{sendSync:()=>({panShading:"auto"}),invoke:async(...args)=>updates.push(args)}}),
  });
  assert.equal(stored.get("clearskies.panShading.v1"),"auto");
  stored.set("clearskies.panShading.v1","off");listeners["csp:pan-shading"]();
  assert.deepEqual(updates,[["csp:pan-shading","off"]]);
  listeners.click({target:{closest:selector=>selector==="[data-reset-all]"}});
  assert.deepEqual(updates.at(-1),["csp:pan-shading","auto"],"Reset all preferences restores the desktop default");
});
test("Returning users go straight to the map; F1 and setup shortcut reopen the guide",async()=>{
  const f=await fixture({completed:true});assert.equal(f.win.url,"http://127.0.0.1:49152/");
  let prevented=false;f.win.webContents.emit("before-input-event",{preventDefault:()=>{prevented=true;}},{type:"keyDown",key:"F1"});
  assert.ok(prevented);assert.match(f.setup.url,/setup\/guide.html$/);
  const again=await fixture({completed:true,argv:["--setup"]});assert.match(again.setup.url,/setup\/index.html$/);
  const mac=await fixture({platform:"darwin",completed:true});assert.equal(mac.win.url,"http://127.0.0.1:49152/");
});
test("Mac first launch shares the welcome, remembers completion, and offers native Help entries",async()=>{
  const f=await fixture({platform:"darwin"}),w=f.win;
  assert.match(f.setup.url,/setup\/index.html$/);
  assert.equal(w.options.titleBarStyle,"hidden");
  assert.deepEqual(JSON.parse(JSON.stringify(w.options.trafficLightPosition)),{x:12,y:9});
  assert.equal(await f.handlers["csp:finish-setup"]({sender:f.setup.webContents,senderFrame:{url:f.setup.url}}),true);
  assert.equal(w.url,"http://127.0.0.1:49152/");
  assert.ok(f.calls.writes[0][0].endsWith("setup-v3.json"));
  const help=f.calls.menu.find(item=>item.role==="help").submenu;
  help[1].click();assert.match(f.setup.url,/setup\/guide.html$/);
  help[0].click();assert.match(f.setup.url,/setup\/index.html$/);
  const again=await fixture({platform:"darwin",completed:true,argv:["--setup"]});
  assert.match(again.setup.url,/setup\/index.html$/);
});
test("Setup guide uses the host platform's official download and app instructions",async()=>{
  for(const platform of ["darwin","win32"]){
    const elements=Object.fromEntries(["tailscale-download","tailscale-download-note","reopen-guide","pin-app","finish","error"]
      .map(id=>[id,{textContent:"Windows",href:"https://pkgs.tailscale.com/stable/tailscale-setup-latest.exe",addEventListener(){}}]));
    vm.runInNewContext(fs.readFileSync("electron/setup/setup.js","utf8"),{
      window:{clearSkiesSetup:{platform}},document:{getElementById:id=>elements[id]},
    });
    if(platform==="darwin"){
      assert.equal(elements["tailscale-download"].href,"https://tailscale.com/download/mac");
      assert.match(elements["tailscale-download"].textContent,/for Mac/);
      assert.match(elements["reopen-guide"].textContent,/Help → Terrain Engine/);
      assert.match(elements["pin-app"].textContent,/Keep in Dock/);
      assert(!/Windows|taskbar|in Start/.test(Object.values(elements).map(el=>el.textContent).slice(0,4).join(" ")));
    }else assert.match(elements["tailscale-download"].href,/tailscale-setup-latest.exe$/);
  }
  let exposed;
  vm.runInNewContext(fs.readFileSync("electron/preload.js","utf8"),{
    process:{platform:"darwin"},location:{protocol:"file:",pathname:"/app.asar/electron/setup/guide.html"},
    document:{addEventListener(){}},require:()=>({contextBridge:{exposeInMainWorld:(name,value)=>{exposed=value;}},ipcRenderer:{invoke:async()=>true}}),
  });
  assert.equal(exposed.platform,"darwin");assert.equal(await exposed.finish(),true);
});
test("Both setup pages can launch the app, while other local files cannot",async()=>{
  const f=await fixture(),w=f.setup.webContents;
  const guide=require("url").pathToFileURL(path.resolve("electron/setup/guide.html")).href;
  assert.equal(w.open({url:guide}).action,"allow","learn-more stays in the native setup window");
  assert.equal(w.open({url:w.url}).action,"allow","back to welcome stays in the setup window");
  assert.equal(w.open({url:guide.replace('guide.html','other.html')}).action,"deny");
  assert.equal(await f.handlers['csp:finish-setup']({sender:w,senderFrame:{url:guide}}),true);
  assert.equal(f.win.url,"http://127.0.0.1:49152/");
});
test("Welcome uses the mobile wordmark and offers app access without requiring the Tailscale guide",()=>{
  const welcome=fs.readFileSync("electron/setup/index.html","utf8");
  const guide=fs.readFileSync("electron/setup/guide.html","utf8");
  assert.match(welcome,/<h1 class="wordmark">ClearSkies<\/h1>/);
  assert.match(welcome,/<button id="finish"[^>]*>Open ClearSkies/);
  assert.match(welcome,/<a[^>]*href="guide.html"[^>]*>Learn about Tailscale/);
  assert.match(guide,/href="index.html"/);
  assert.match(guide,/<button id="finish"/);
  assert.equal(fs.readFileSync("electron/setup/fonts/Pacifico.ttf").compare(fs.readFileSync("ios/Resources/Fonts/Pacifico.ttf")),0);
  assert.match(fs.readFileSync("electron/setup/setup.css","utf8"),/\.wordmark\{font-family:Pacifico,cursive;font-weight:400/);
  assert(!/Clear Skies/.test(welcome+guide),"display copy uses the canonical one-word name");
});
test("External download links open in a browser; executable protocols stay blocked",async()=>{
  const f=await fixture();
  for(const url of ["https://tailscale.com/","https://pkgs.tailscale.com/stable/tailscale-setup-latest.exe"]){
    assert.equal(f.setup.webContents.open({url}).action,"deny");assert.equal(f.calls.opened.at(-1),url);
  }
  const count=f.calls.opened.length;
  for(const url of ["file:///C:/Windows/system32/cmd.exe","javascript:alert(1)","powershell:evil"])
    assert.equal(f.setup.webContents.open({url}).action,"deny");
  assert.equal(f.calls.opened.length,count);
});
test("Legacy markup and tombstones migrate outside install files without overwriting new saves",()=>{
  const {engineStorage}=require("./electron/engine-storage"),os=require("os");
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"csp-storage-test-"));
  try{
    const legacy=path.join(dir,"legacy-markup");fs.mkdirSync(legacy);
    fs.writeFileSync(path.join(legacy,"area.geojson"),'original');
    fs.writeFileSync(path.join(legacy,".deleted.json"),'{"deleted":123}');
    const paths=engineStorage(dir,null);
    assert.equal(fs.readFileSync(path.join(paths.markup,"area.geojson"),"utf8"),'original');
    assert.equal(fs.readFileSync(path.join(paths.markup,".deleted.json"),"utf8"),'{"deleted":123}');
    fs.writeFileSync(path.join(paths.markup,"area.geojson"),'newer');engineStorage(dir,null);
    assert.equal(fs.readFileSync(path.join(paths.markup,"area.geojson"),"utf8"),'newer');
    assert.ok(fs.existsSync(path.join(legacy,"area.geojson")),"original backup retained");
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
