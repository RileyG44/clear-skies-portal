/* Offline shell for the installed app. Deliberately small: imagery and terrain
   tiles are not cached here — server.js already keeps a disk cache, and a
   single 3 MB elevation read would blow the origin's storage budget for no
   benefit. This exists so the app opens when the network (or the Mac) is
   unreachable, rather than showing a browser error page. */
/* Bump this on every deploy. Keeping the build literal here, plus a versioned
   page-script URL, prevents an older worker from serving a stale version.js
   while a newer HTML shell is already live. */
const CSP_BUILD = "2026-11-05g";
const SHELL = `clear-skies-shell-${CSP_BUILD}`;
const POTREE = `clear-skies-potree-${CSP_BUILD}`;
/* Survives a shell update. The page writes "dark" or "light" here so the
   next installed launch's splash matches the saved map, not the light file. */
const THEME = "clear-skies-map-theme";
/* site.json is the one list of shell files: web, app.js (built from its app
   list) and vendor. Scripts and styles are cached under the same versioned
   URLs the page requests. */
const versioned = asset => /\.(?:js|css)$/.test(asset) ? `./${asset}?build=${CSP_BUILD}` : `./${asset}`;

self.addEventListener("install", e => {
  e.waitUntil(fetch("./site.json", {cache:"reload"})
    .then(r => { if(!r.ok) throw new Error(`site.json HTTP ${r.status}`); return r.json() })
    .then(site => caches.open(SHELL).then(c => c.addAll(["./", ...[...site.web, "app.js", ...site.vendor].filter(a => a !== "sw.js").map(versioned)])))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== SHELL&&k !== POTREE&&k !== THEME).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

/* "dark" or "light" from the last session, or "" when nothing is saved.
   The static files stay light so a first launch follows the device. */
async function savedSplashTheme(){
  const hit=await caches.match(new URL("csp-map-theme",self.location.href).href);
  const theme=hit?(await hit.text()).trim():"";
  return theme==="dark"||theme==="light"?theme:"";
}
function splashColor(theme){return theme==="dark"?"#111416":theme==="light"?"#dbe6eb":""}
/* Installed chrome reads theme-color, and the boot background, before the
   page script. Paint both from the saved theme. A light choice also has to
   sit on <html> so a dark device's media query does not win first. */
function recolorShell(html,theme){
  const color=splashColor(theme);
  if(!color)return html;
  let out=html.replace(/<html\b([^>]*)>/i,(match,attrs)=>{
    const rest=attrs.replace(/\sdata-ui-theme\s*=\s*(["'])(?:dark|light)\1/i,"");
    return `<html${rest} data-ui-theme="${theme}">`;
  });
  out=out.replace(/<meta\b[^>]*\bname\s*=\s*(["'])theme-color\1[^>]*>/gi,tag=>{
    let next=tag.replace(/\scontent\s*=\s*(["'])[^"']*\1/i,` content="${color}"`);
    next=next.replace(/\smedia\s*=\s*(["'])[^"']*\1/gi,"");
    return next;
  });
  out=out.replace(
    /(:is\(html\.csp-boot,html\.csp-reveal\),:is\(html\.csp-boot,html\.csp-reveal\) body\{background:)#[0-9a-fA-F]{6}( linear-gradient\()#[0-9a-fA-F]{6}(,)#[0-9a-fA-F]{6}(\)\})/,
    `$1${color}$2${color}$3${color}$4`);
  return out;
}
async function themedDocument(response,theme){
  if(!theme||!response)return response;
  const headers=new Headers(response.headers||{});
  const type=headers.get("Content-Type")||"";
  if(type&&!/text\/html/i.test(type))return response;
  const html=await response.text();
  headers.set("Content-Type","text/html; charset=utf-8");
  return new Response(html.includes("window.CSPBoot")?recolorShell(html,theme):html,{status:response.status||200,statusText:response.statusText||"",headers});
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // tiles and STAC go straight out
  if (url.pathname.startsWith("/api/")) return;      // never serve stale data

  // The installed splash is painted from this file before any page script.
  // Recolour it from the theme the last session stored. The static file stays
  // the light map colour for a first launch that has no saved theme.
  if(url.pathname.endsWith("/manifest.json")){
    e.respondWith((async()=>{
      const color=splashColor(await savedSplashTheme());
      const response=await fetch(req);
      if(!color||!response.ok)return response;
      const manifest=await response.json();
      manifest.background_color=color;manifest.theme_color=color;
      const headers=new Headers(response.headers);
      headers.set("Content-Type","application/manifest+json");
      return new Response(JSON.stringify(manifest),{status:response.status,headers});
    })());
    return;
  }

  // The optional point-cloud runtime is intentionally not part of atomic shell
  // installation. Cache it on first use so a missing optional asset can never
  // take offline support down for the 2D application.
  if(url.pathname.includes("/vendor/potree/")){
    e.respondWith(caches.open(POTREE).then(cache=>cache.match(req).then(hit=>hit||fetch(req).then(response=>{if(response.ok)cache.put(req,response.clone());return response}))));
    return;
  }

  // Navigation: fresh when we can reach the server, cached shell when we cannot.
  // The saved theme recolours theme-color and the boot background on the way
  // out, including the offline shell. The cached bytes stay as the file, so a
  // later theme still applies. The head script may then follow a share hint.
  if (req.mode === "navigate"){
    /* cache:"reload" so this bypasses the HTTP cache as well. Pages serves the
       page with its own max-age, and without this the worker could fetch
       "fresh" and still be handed a stale copy by the browser cache. */
    e.respondWith((async()=>{
      const theme=savedSplashTheme();
      // Keep the map, landing page and supporting pages in separate entries.
      // Query strings select a view or force reload, not a different shell.
      const documentURL=new URL(req.url);
      documentURL.search="";
      try{
        const response=await fetch(req,{cache:"reload"});
        if(response.ok){
          const copy=response.clone();
          e.waitUntil(caches.open(SHELL).then(cache=>cache.put(documentURL.href,copy)).catch(()=>{}));
        }
        return themedDocument(response,await theme);
      }catch(error){
        return themedDocument(await caches.match(documentURL.href),await theme);
      }
    })());
    return;
  }
  // Worker importScripts() and module dependencies keep literal file paths.
  // Resolve those to the same fresh bytes as the versioned document scripts.
  const cachedURL = new URL(req.url);
  if(!cachedURL.search&&/\.(?:js|css)$/.test(cachedURL.pathname))cachedURL.searchParams.set("build",CSP_BUILD);
  e.respondWith(caches.match(cachedURL.href).then(hit => hit || fetch(req)));
});
