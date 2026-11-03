/* Clear Skies Portal — Electron shell.
   Prefers the terrain engine this Mac already runs (the LaunchAgent on
   its configured loopback port): the page and every /api call come from that
   one local server, sharing its warm tile cache. Only when no engine answers
   does it boot its own server.js on a free loopback port. The web app is
   untouched: every request it makes is relative, so it simply follows
   whichever origin we load.                                                  */
const {app, BrowserWindow, shell, dialog, session, ipcMain} = require("electron");
const {pathToFileURL} = require("url");
const {windowChrome} = require("./window-chrome");
const {engineStorage} = require("./engine-storage");
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
const setupFile = path.join(__dirname,"setup","index.html");
const setupURL = pathToFileURL(setupFile).href;
const setupMarker = () => path.join(app.getPath("userData"),"setup-v1.json");
const showSetup = () => { if(win) win.loadFile(setupFile); };

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

function startServer(p){
  const storage=engineStorage(app.getPath("userData"),app.isPackaged?path.dirname(SERVER):null);
  child = fork(SERVER, [], {
    env: {
      ...process.env,
      PORT: String(p),
      HOST,
      // Keep the tile cache out of the .app bundle: it is read-only once
      // signed, and writing into it would break the signature.
      CSP_CACHE_DIR: storage.cache,
      CSP_MARKUP_DIR: storage.markup,
      ELECTRON_RUN_AS_NODE: "1",
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  child.stdout.on("data", d => process.stdout.write(`[server] ${d}`));
  child.stderr.on("data", d => process.stderr.write(`[server] ${d}`));
  child.on("exit", (code, sig) => {
    child = null;
    if (!app.isQuittingCsp && code !== 0){
      dialog.showErrorBox("Clear Skies Portal",
        `The local server stopped unexpectedly (code ${code}${sig ? `, ${sig}` : ""}).\n\nQuit and reopen the app to try again.`);
    }
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
  if (process.env.CSP_ELECTRON_OWN_SERVER !== "1"){
    const engine = await enginePort();
    if (await engineUp(engine)) return engine;
    if (await kickstartAgent()){
      try{ await waitForServer(engine, 15000); return engine }
      catch(e){ /* fall through to a bundled server */ }
    }
  }
  const p = await freePort();
  startServer(p);
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

function createWindow(){
  const internalOrigin = `http://${HOST}:${port}`;
  const isInternal = value => {
    try{ return new URL(value).origin === internalOrigin }
    catch(e){ return false }
  };
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 900, minHeight: 600,
    backgroundColor: "#000000",
    title: "Clear Skies Portal",
    // macOS draws the traffic lights over the page. The page keeps a clear
    // drag strip; it does not paint a title bar.
    ...windowChrome(process.platform),
    icon:app.isPackaged?path.join(process.resourcesPath,"ClearSkies.ico"):path.join(__dirname,"..","build","icon.ico"),
    webPreferences: {contextIsolation: true, nodeIntegration: false, preload:path.join(__dirname,"preload.js")},
  });

  if(process.platform==="win32") win.setMenu(null);
  if(process.argv.includes("--setup") || (process.platform==="win32" && !fs.existsSync(setupMarker()))) showSetup();
  else win.loadURL(`${internalOrigin}/`);
  win.webContents.on("before-input-event",(event,input)=>{
    if(input.type==="keyDown" && input.key==="F1"){ event.preventDefault(); showSetup(); }
  });
  win.on("closed", () => { win = null; });

  // Anything that is not our own server opens in the real browser,
  // so attribution links don't strand the user inside the app.
  const external = url => {
    if (isInternal(url) || url===setupURL) return false;
    // Never hand file:, javascript: or custom protocols to an external app.
    if(/^https?:\/\//i.test(url)) shell.openExternal(url);
    return true;
  };
  win.webContents.setWindowOpenHandler(({url}) => external(url) ? {action:"deny"} : {action:"allow"});
  win.webContents.on("will-navigate", (e, url) => { if (external(url)) e.preventDefault(); });
}

app.isQuittingCsp = false;
app.setAppUserModelId("com.rileyg44.clear-skies-portal");
ipcMain.handle("csp:finish-setup",async event=>{
  if(!win || event.sender!==win.webContents || event.senderFrame?.url!==setupURL) return false;
  fs.mkdirSync(app.getPath("userData"),{recursive:true});
  fs.writeFileSync(setupMarker(),JSON.stringify({completedAt:new Date().toISOString()}));
  await win.loadURL(`http://${HOST}:${port}/`);
  return true;
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
      port = await pickServer();
      console.log(child ? `[app] started a bundled server on ${port}` : `[app] using the installed terrain engine on ${port}`);
      createWindow();
    } catch (err) {
      dialog.showErrorBox("Clear Skies Portal", `Could not start the local server.\n\n${err.message}`);
      app.quit();
    }
  });

  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0 && port) createWindow(); });
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
  app.on("before-quit", () => { app.isQuittingCsp = true; });
  app.on("will-quit", () => { if (child){ child.kill(); child = null; } });
}
