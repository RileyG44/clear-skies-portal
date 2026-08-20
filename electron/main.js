/* Clear Skies Portal — Electron shell.
   Boots server.js on a free loopback port, waits for /api/health, then shows it.
   The web app is untouched: every request it makes is relative, so it simply
   follows whatever port we picked.                                           */
const {app, BrowserWindow, shell, dialog, session} = require("electron");
const {fork} = require("child_process");
const path = require("path");
const http = require("http");
const net  = require("net");

const SERVER = path.join(__dirname, "..", "server.js");
const HOST   = "127.0.0.1";

let child = null;
let win   = null;
let port  = 0;

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
  child = fork(SERVER, [], {
    env: {
      ...process.env,
      PORT: String(p),
      HOST,
      // Keep the tile cache out of the .app bundle: it is read-only once
      // signed, and writing into it would break the signature.
      CSP_CACHE_DIR: path.join(app.getPath("userData"), "cache"),
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
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 900, minHeight: 600,
    backgroundColor: "#0b0f14",
    title: "Clear Skies Portal",
    titleBarStyle: "hiddenInset",
    webPreferences: {contextIsolation: true, nodeIntegration: false},
  });

  win.loadURL(`http://${HOST}:${port}/`);
  win.on("closed", () => { win = null; });

  // Anything that is not our own server opens in the real browser,
  // so attribution links don't strand the user inside the app.
  const external = url => {
    if (url.startsWith(`http://${HOST}:${port}`)) return false;
    shell.openExternal(url);
    return true;
  };
  win.webContents.setWindowOpenHandler(({url}) => external(url) ? {action:"deny"} : {action:"allow"});
  win.webContents.on("will-navigate", (e, url) => { if (external(url)) e.preventDefault(); });
}

app.isQuittingCsp = false;

if (!app.requestSingleInstanceLock()){
  app.quit();
} else {
  app.on("second-instance", () => { if (win){ if (win.isMinimized()) win.restore(); win.focus(); } });

  app.whenReady().then(async () => {
    // The locate button needs geolocation; grant it only to our own origin.
    session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
      const origin = `http://${HOST}:${port}`;
      cb(permission === "geolocation" && wc.getURL().startsWith(origin));
    });

    try {
      port = await freePort();
      startServer(port);
      await waitForServer(port);
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
