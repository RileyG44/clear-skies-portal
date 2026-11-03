"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const fs=require("fs"),vm=require("vm"),path=require("path"),{EventEmitter}=require("events");
const {windowChrome}=require("./electron/window-chrome");
async function fixture({platform="win32",completed=false,argv=[]}={}){
  const calls={opened:[],writes:[],windows:[]},handlers={},app=new EventEmitter();
  let ready;
  Object.assign(app,{isPackaged:true,getPath:()=>path.resolve("test-user-data"),
    requestSingleInstanceLock:()=>true,whenReady:()=>({then:fn=>{ready=fn;}}),
    setAppUserModelId:id=>{calls.appId=id;},quit:()=>{calls.quit=true;}});
  class Window extends EventEmitter{
    constructor(options){super();this.options=options;this.webContents=new EventEmitter();
      this.webContents.getURL=()=>this.url;this.webContents.setWindowOpenHandler=fn=>{this.open=fn;};calls.windows.push(this);}
    loadURL(url){this.url=url;return Promise.resolve();}
    loadFile(file){return this.loadURL(require("url").pathToFileURL(file).href);}
    setMenu(value){this.menu=value;}
    isMinimized(){return false;} focus(){}
  }
  const fakeFS={existsSync:()=>completed,mkdirSync:()=>{},writeFileSync:(...args)=>calls.writes.push(args)};
  const context={console,URL,__dirname:path.resolve("electron"),process:{platform,env:{},argv,resourcesPath:path.resolve("resources")},
    require:name=>name==="electron"?{app,BrowserWindow:Window,shell:{openExternal:url=>calls.opened.push(url)},
      dialog:{showErrorBox:(...args)=>{throw Error(args.join(":"));}},session:{defaultSession:{setPermissionRequestHandler(){}}},
      ipcMain:{handle:(name,fn)=>{handlers[name]=fn;}}}:name==="fs"?fakeFS:name==="./window-chrome"?{windowChrome}:name==="./engine-storage"?require("./electron/engine-storage"):require(name)};
  vm.runInNewContext(fs.readFileSync("electron/main.js","utf8"),context);
  context.pickServer=async()=>49152;
  await ready();
  return {calls,handlers,win:calls.windows[0],app};
}
test("Windows first launch shows setup, completion saves once and opens local engine",async()=>{
  const f=await fixture(),w=f.win;
  assert.match(w.url,/\/electron\/setup\/index.html$/);assert.equal(w.menu,null);
  assert.equal(w.options.titleBarStyle,"hidden");assert.equal(w.options.titleBarOverlay.height,30);
  assert.equal(w.options.webPreferences.nodeIntegration,false);assert.equal(w.options.webPreferences.contextIsolation,true);
  const finish=f.handlers["csp:finish-setup"],url=w.url;
  assert.equal(await finish({sender:{},senderFrame:{url}}),false,"another window cannot complete setup");
  assert.equal(await finish({sender:w.webContents,senderFrame:{url:"https://untrusted.example"}}),false);
  assert.equal(f.calls.writes.length,0);
  assert.equal(await finish({sender:w.webContents,senderFrame:{url}}),true);
  assert.equal(f.calls.writes.length,1);assert.equal(w.url,"http://127.0.0.1:49152/");
  assert.ok(JSON.parse(f.calls.writes[0][1]).completedAt);
});
test("Returning users go straight to the map; F1 and setup shortcut reopen the guide",async()=>{
  const f=await fixture({completed:true});assert.equal(f.win.url,"http://127.0.0.1:49152/");
  let prevented=false;f.win.webContents.emit("before-input-event",{preventDefault:()=>{prevented=true;}},{type:"keyDown",key:"F1"});
  assert.ok(prevented);assert.match(f.win.url,/setup\/index.html$/);
  const again=await fixture({completed:true,argv:["--setup"]});assert.match(again.win.url,/setup\/index.html$/);
  const mac=await fixture({platform:"darwin"});assert.equal(mac.win.url,"http://127.0.0.1:49152/");
});
test("External download links open in a browser; executable protocols stay blocked",async()=>{
  const f=await fixture();
  for(const url of ["https://tailscale.com/","https://pkgs.tailscale.com/stable/tailscale-setup-latest.exe"]){
    assert.equal(f.win.open({url}).action,"deny");assert.equal(f.calls.opened.at(-1),url);
  }
  const count=f.calls.opened.length;
  for(const url of ["file:///C:/Windows/system32/cmd.exe","javascript:alert(1)","powershell:evil"])
    assert.equal(f.win.open({url}).action,"deny");
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
