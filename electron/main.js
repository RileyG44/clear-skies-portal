/* ClearSkies — Electron shell.
   Prefers the terrain engine this Mac already runs (the LaunchAgent on
   its configured loopback port): the page and every /api call come from that
   one local server, sharing its warm tile cache. Only when no engine answers
   does it boot its own server.js on a free loopback port. The web app is
   untouched: every request it makes is relative, so it simply follows
   whichever origin we load.                                                  */
const {app, BrowserWindow, WebContentsView, Menu, shell, dialog, session, ipcMain, nativeTheme} = require("electron");
const {pathToFileURL} = require("url");
const {windowChrome} = require("./window-chrome");
const {engineStorage} = require("./engine-storage");
const {DEFAULTS,validate,readConfig,saveConfig,engineEnvironment,customEngine} = require("./setup-config");
const {fork, execFile} = require("child_process");
const fs   = require("fs");
const os   = require("os");
const path = require("path");
const http = require("http");
const net  = require("net");

/* Keep the Electron shell in ASAR (tamper-resistant and faster to load), while
   the forked zero-dependency server and its static assets live in Resources.
   child_process cannot execute an entry point buried inside an ASAR archive. */
const SERVER = app.isPackaged
  ? path.join(process.resourcesPath,"app","server.js")
  : path.join(__dirname,"..","server.js");
const HOST   = "127.0.0.1";
// Where scripts/install-mac-service.sh puts the always-on engine.
const ENGINE_AGENT = "com.rileyg44.clear-skies-portal";
const ENGINE_PLIST = path.join(os.homedir(), "Library", "LaunchAgents", `${ENGINE_AGENT}.plist`);

let child = null;
let win   = null;
let port  = 0;
let setupConfig = {...DEFAULTS};
let finishingSetup = false;
let setupView = null;
let preparing = null;
const setupFile = path.join(__dirname,"setup","index.html");
const setupURL = pathToFileURL(setupFile).href;
const guideFile = path.join(__dirname,"setup","guide.html");
const setupPages = new Set([setupURL,pathToFileURL(guideFile).href]);
const setupMarker = () => path.join(app.getPath("userData"),"setup-v3.json");
const needsSetup = () => process.argv.includes("--setup") || (["win32","darwin"].includes(process.platform) && !fs.existsSync(setupMarker()));
const preferences = () => ({contextIsolation:true,nodeIntegration:false,preload:path.join(__dirname,"preload.js"),backgroundThrottling:false});
function showSetup(guide=false){
  if(!win)return;
  if(!setupView){
    setupView=new WebContentsView({webPreferences:preferences()});
    setupView.setBackgroundColor("#040c1e");
    win.contentView.addChildView(setupView);
    wireNavigation(setupView.webContents);
    sizeSetup();
  }
  setupView.webContents.loadFile(guide?guideFile:setupFile);
}
function sizeSetup(){
  if(setupView&&win){const {width,height}=win.getContentBounds();setupView.setBounds({x:0,y:0,width,height});}
}
function dismissSetup(){
  if(!setupView)return;
  const view=setupView;setupView=null;
  win?.contentView.removeChildView(view);
  if(!view.webContents.isDestroyed())view.webContents.close();
}
function prepareMap(){
  if(preparing)return preparing;
  preparing=(async()=>{
    if(!port)port=await pickServer();
    if(win)await win.loadURL(`http://${HOST}:${port}/`);
  })().catch(async error=>{await stopServer();port=0;throw error;}).finally(()=>{preparing=null;});
  return preparing;
}

/* Finder launches do not inherit a terminal's CSP_ENGINE_PORT. Read the same
   saved port the service installer keeps, or a healthy updated engine on 8770
   is missed and the app quietly starts its older bundled engine instead. */
async function enginePort(){
  const valid = value => {
    const p = Number(value);
    return Number.isInteger(p) && p > 0 && p <= 65535 ? p : null;
  };
  const override = valid(process.env.CSP_ENGINE_PORT);
  if (override) return override;
  if (process.platform !== "darwin" || !fs.existsSync(ENGINE_PLIST)) return 8765;
  return new Promise(resolve => execFile("/usr/bin/plutil", [
    "-extract", "EnvironmentVariables.CSP_ENGINE_PORT", "raw", "-o", "-", ENGINE_PLIST,
  ], {timeout:2000}, (error, stdout) => resolve((!error && valid(stdout)) || 8765)));
}

/* Ask the OS for a port nobody is using, so we never collide with a
   copy of the portal the user is already running from a terminal. */
function freePort(){
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, HOST, () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

async function startServer(p){
  const storage=engineStorage(app.getPath("userData"),app.isPackaged?path.dirname(SERVER):null);
  child = fork(SERVER, [], {
    env: {
      ...process.env,
      ...engineEnvironment(setupConfig),
      PORT: String(p),
      HOST,
      // Keep the tile cache out of the .app bundle: it is read-only once
      // signed, and writing into it would break the signature.
      CSP_CACHE_DIR: storage.cache,
      CSP_STARTUP_CACHE_DIR:app.isPackaged?path.join(process.resourcesPath,"startup-cache"):path.join(__dirname,"..","build","startup-cache"),
      CSP_MARKUP_DIR: storage.markup,
      ELECTRON_RUN_AS_NODE: "1",
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  child.stdout.on("data", d => process.stdout.write(`[server] ${d}`));
  child.stderr.on("data", d => process.stderr.write(`[server] ${d}`));
  const server = child;
  server.on("exit", (code, sig) => {
    if(child===server) child = null;
    if (!app.isQuittingCsp && !server.cspStopping && code !== 0){
      dialog.showErrorBox("ClearSkies",
        `The local server stopped unexpectedly (code ${code}${sig ? `, ${sig}` : ""}).\n\nQuit and reopen the app to try again.`);
    }
  });
}

async function stopServer(){
  const server=child;if(!server)return;
  server.cspStopping=true;
  await new Promise(resolve=>{
    const timer=setTimeout(()=>server.kill("SIGKILL"),5000);
    server.once("exit",()=>{clearTimeout(timer);resolve();});server.kill();
  });
}

/* One /api/health probe: does a healthy engine already answer on this port? */
function engineUp(p, timeoutMs = 800){
  return new Promise(resolve => {
    const req = http.get({host: HOST, port: p, path: "/api/health", timeout: timeoutMs}, res => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", d => { body += d; });
      res.on("end", () => {
        try{ resolve(res.statusCode === 200 && JSON.parse(body).ok === true) }
        catch(e){ resolve(false) }
      });
    });
    req.on("error",   () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

/* The installed engine is down (crashed, or unloaded): ask launchd to start it
   rather than running a second engine with a cold cache next to it. */
function kickstartAgent(){
  if (process.platform !== "darwin" || !fs.existsSync(ENGINE_PLIST)) return Promise.resolve(false);
  const target = `gui/${process.getuid()}`;
  const run = args => new Promise(resolve => execFile("/bin/launchctl", args, err => resolve(!err)));
  return run(["kickstart", `${target}/${ENGINE_AGENT}`])
    .then(ok => ok || run(["bootstrap", target, ENGINE_PLIST]));
}

/* Use the Mac's engine if it is up or can be woken; otherwise our own copy. */
async function pickServer(){
  if (process.env.CSP_ELECTRON_OWN_SERVER !== "1" && !customEngine(setupConfig)){
    const engine = await enginePort();
    if (await engineUp(engine)) return engine;
    if (await kickstartAgent()){
      try{ await waitForServer(engine, 15000); return engine }
      catch(e){ /* fall through to a bundled server */ }
    }
  }
  const p = await freePort();
  await startServer(p);
  await waitForServer(p);
  return p;
}

/* Poll /api/health rather than guessing at a sleep. */
function waitForServer(p, timeoutMs = 20000){
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    (function attempt(){
      if (Date.now() > deadline) return reject(new Error("server did not answer /api/health in time"));
      const req = http.get({host: HOST, port: p, path: "/api/health", timeout: 1500}, res => {
        res.resume();
        if (res.statusCode === 200) return resolve();
        setTimeout(attempt, 200);
      });
      req.on("error",   () => setTimeout(attempt, 200));
      req.on("timeout", () => { req.destroy(); setTimeout(attempt, 200); });
    })();
  });
}

function wireNavigation(contents){
  const isInternal = value => {
    try{ return new URL(value).origin === `http://${HOST}:${port}` }
    catch(e){ return false }
  };
  contents.on("before-input-event",(event,input)=>{
    if(input.type==="keyDown" && input.key==="F1"){event.preventDefault();showSetup(true);}
  });
  const external = url => {
    if (isInternal(url) || setupPages.has(url)) return false;
    if(/^https?:\/\//i.test(url))shell.openExternal(url);
    return true;
  };
  contents.setWindowOpenHandler(({url})=>external(url)?{action:"deny"}:{action:"allow"});
  contents.on("will-navigate",(event,url)=>{if(external(url))event.preventDefault();});
}
/* The window paints its background before the page can. Use the map theme
   the page last reported, so a saved dark map never opens on a light window. */
const mapThemeFile=()=>path.join(app.getPath("userData"),"map-theme.txt");
function windowBackground(){
  let theme="";
  try{theme=fs.readFileSync(mapThemeFile(),"utf8").trim();}catch{}
  if(theme!=="dark"&&theme!=="light")theme=nativeTheme.shouldUseDarkColors?"dark":"light";
  return theme==="dark"?"#111416":"#dbe6eb";
}
function createWindow(){
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 900, minHeight: 600,
    // The map's own canvas color, so the window never flashes black before
    // the page paints.
    backgroundColor: windowBackground(),
    title: "ClearSkies",
    // macOS draws the traffic lights over the page. The page keeps a clear
    // drag strip; it does not paint a title bar.
    ...windowChrome(process.platform),
    icon:app.isPackaged?path.join(process.resourcesPath,"ClearSkies.ico"):path.join(__dirname,"..","build","icon.ico"),
    webPreferences: preferences(),
  });

  if(process.platform==="win32") win.setMenu(null);
  wireNavigation(win.webContents);
  win.on("resize",sizeSetup);
  if(needsSetup()){
    showSetup();
    prepareMap().catch(error=>console.warn(`[app] setup map preparation: ${error.message}`));
  }
  else win.loadURL(`http://${HOST}:${port}/`);
  win.on("closed", () => {win=null;dismissSetup();});
}

app.isQuittingCsp = false;
app.setAppUserModelId("com.rileyg44.clear-skies-portal");
const trustedSetup = event => setupView && event.sender===setupView.webContents && setupPages.has(event.senderFrame?.url);
const trustedMap = event => win && event.sender===win.webContents && event.senderFrame?.url?.startsWith(`http://${HOST}:${port}/`);
ipcMain.handle("csp:get-setup-config",event=>trustedSetup(event)?{config:setupConfig,defaults:DEFAULTS}:null);
ipcMain.on("csp:map-theme",(event,theme)=>{
  if(!trustedMap(event)||(theme!=="dark"&&theme!=="light"))return;
  try{fs.writeFileSync(mapThemeFile(),theme);}catch{}
});
ipcMain.on("csp:map-preferences",event=>{event.returnValue=trustedMap(event)?{panShading:setupConfig.panShading}:null;});
ipcMain.handle("csp:pan-shading",(event,mode)=>{
  if(!trustedMap(event) || !["off","auto","on"].includes(mode))return false;
  setupConfig=saveConfig(app.getPath("userData"),{...setupConfig,panShading:mode});return true;
});
ipcMain.handle("csp:finish-setup",async (event,config)=>{
  if(!trustedSetup(event) || finishingSetup) return false;
  finishingSetup=true;
  try{
    const next=config===undefined?setupConfig:validate(config);
    const engineChanged=JSON.stringify(engineEnvironment(next))!==JSON.stringify(engineEnvironment(setupConfig));
    if(preparing)await preparing.catch(()=>{});
    setupConfig=saveConfig(app.getPath("userData"),next);
    if(engineChanged){await stopServer();port=0;}
    if(!port)await prepareMap();
    else if(!engineChanged)await win.webContents.executeJavaScript(`localStorage.setItem("clearskies.panShading.v1",${JSON.stringify(next.panShading)});document.dispatchEvent(new CustomEvent("csp:pan-shading",{detail:{mode:${JSON.stringify(next.panShading)}}}));`);
    fs.mkdirSync(app.getPath("userData"),{recursive:true});
    fs.writeFileSync(setupMarker(),JSON.stringify({completedAt:new Date().toISOString()}));
    dismissSetup();
    return true;
  }finally{finishingSetup=false;}
});

if (!app.requestSingleInstanceLock()){
  app.quit();
} else {
  app.on("second-instance", (_event,argv) => { if (win){ if(argv.includes("--setup")) showSetup(); if (win.isMinimized()) win.restore(); win.focus(); } });

  app.whenReady().then(async () => {
    // The locate button needs geolocation; grant it only to our own origin.
    session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
      const origin = `http://${HOST}:${port}`;
      let internal=false;
      try{ internal=new URL(wc.getURL()).origin===origin }catch(e){}
      cb(permission === "geolocation" && internal);
    });

    try {
      setupConfig=readConfig(app.getPath("userData"));
      // Render the real map underneath setup, retaining its tiles/GPU state.
      if(!needsSetup())port = await pickServer();
      createWindow();
      if(process.platform==="darwin") Menu.setApplicationMenu(Menu.buildFromTemplate([
        {role:"appMenu"}, {role:"editMenu"}, {role:"viewMenu"}, {role:"windowMenu"},
        {role:"help",submenu:[
          {label:"Welcome to ClearSkies",click:()=>showSetup()},
          {label:"Terrain Engine & Tailscale",accelerator:"F1",click:()=>showSetup(true)},
        ]},
      ]));
    } catch (err) {
      dialog.showErrorBox("ClearSkies", `Could not start the local server.\n\n${err.message}`);
      app.quit();
    }
  });

  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0 && port) createWindow(); });
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
  app.on("before-quit", () => { app.isQuittingCsp = true; });
  app.on("will-quit", () => { if (child){ child.kill(); child = null; } });
}
