/* Clear Skies native host. The iPhone app injects this before any page script.
   It exists only inside the app: the hosted web client and the Mac app never
   see it, and the page falls back to its ordinary web path when it is absent.
   The app replaces __CSP_NATIVE_CONFIG__ with {engineBase, appVersion}. */
(() => {
  "use strict";
  const handler = window.webkit?.messageHandlers?.cspNative;
  if (!handler || window.CSPNativeHost) return;
  const config = __CSP_NATIVE_CONFIG__;
  const post = (type, body) => handler.postMessage({ ...(body || {}), type });
  let engineBase = typeof config.engineBase === "string" ? config.engineBase : "";

  /* Geolocation goes through Core Location: one system prompt, worded by the
     app, instead of a second web-content prompt naming clearskies://app. */
  const GEO_MESSAGES = { 1: "User denied Geolocation", 2: "Position unavailable", 3: "Timeout expired" };
  const geoError = reason => {
    const code = reason === "denied" ? 1 : reason === "timeout" ? 3 : 2;
    return Object.freeze({ code, message: GEO_MESSAGES[code], PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
  };
  const position = fix => Object.freeze({
    coords: Object.freeze({
      latitude: fix.latitude, longitude: fix.longitude, accuracy: fix.accuracy,
      altitude: fix.altitude ?? null, altitudeAccuracy: fix.altitudeAccuracy ?? null,
      heading: fix.heading ?? null, speed: fix.speed ?? null
    }),
    timestamp: fix.timestamp
  });
  const reason = error => String(error?.message || error || "");
  const watches = new Map();
  let nextWatch = 1;
  const geolocation = Object.freeze({
    getCurrentPosition(success, failure, options = {}) {
      post("geo.current", {
        highAccuracy: !!options.enableHighAccuracy,
        timeout: Number.isFinite(options.timeout) ? options.timeout : null,
        maximumAge: Number.isFinite(options.maximumAge) ? options.maximumAge : 0
      }).then(fix => success?.(position(fix)), error => failure?.(geoError(reason(error))));
    },
    watchPosition(success, failure, options = {}) {
      const id = nextWatch++;
      watches.set(id, { success, failure });
      post("geo.watch", { id, highAccuracy: !!options.enableHighAccuracy }).catch(error => {
        if (watches.delete(id)) failure?.(geoError(reason(error)));
      });
      return id;
    },
    clearWatch(id) {
      if (watches.delete(id)) post("geo.clear", { id }).catch(() => {});
    }
  });
  try { Object.defineProperty(navigator, "geolocation", { value: geolocation, configurable: true }) } catch (error) {}

  /* WebKit drops Blob request bodies on a custom scheme, so a same-origin
     request that carries one sends the same bytes as an ArrayBuffer. */
  const nativeFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    if (init && typeof Blob === "function" && init.body instanceof Blob) {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url, location.href);
      if (url.origin === location.origin) return init.body.arrayBuffer().then(body => nativeFetch(input, { ...init, body }));
    }
    return nativeFetch(input, init);
  };

  const root = document.documentElement;

  /* Native chrome replaces the web panel (Stage 2). The panel stays in the
     page, laid out and live, because its controls remain the source of truth;
     it only moves out of sight and out of reach of touches. Added before the
     first paint so it never flashes. */
  const chrome = document.createElement("style");
  /* On a phone the collapsed panel shows its search strip and drops the page
     body (display:none). Here the page body is what the native sheet mirrors,
     so it keeps its layout while the panel stays collapsed. */
  chrome.textContent = "html.csp-native-chrome *{-webkit-user-select:none!important;user-select:none!important;-webkit-touch-callout:none!important}"
    /* Map double taps and long presses belong to the map, not WebKit's
       document selection. Keep normal editing/copying in the web tools. */
    + "html.csp-native-chrome :is(input,textarea,[contenteditable=true],[contenteditable=plaintext-only]),html.csp-native-chrome :is([contenteditable=true],[contenteditable=plaintext-only]) *{-webkit-user-select:text!important;user-select:text!important;-webkit-touch-callout:default!important}"
    + "html.csp-native-chrome #side{translate:-400vw 0!important;pointer-events:none!important}"
    + "html.csp-native-chrome #sideToggleDock{display:none!important}"
    + "html.csp-native-chrome body.csp-redesign #side #cspWorkspace{display:flex!important}"
    + "html.csp-native-chrome body.csp-redesign #side #cspWorkspaceScroll{visibility:visible!important}"
    /* The map tools, the view menu and these pop-ups are drawn natively from
       the same elements (native-shell.js). The point-cloud viewer and map selections remain web controls. */
    + "html.csp-native-chrome :is(#mapDock,#mapModeMenu,#mapReadout){display:none!important}"
    /* The web toolbar has no layout box in the app. Background downloads
       sit below the 44pt info control and top fade, clear of native tools. */
    + "html.csp-native-chrome #dnrSelectionBar[data-background=true]{left:calc(env(safe-area-inset-left,0px) + 12px)!important;top:calc(env(safe-area-inset-top,0px) + var(--csp-map-info-height,44px) + 20px)!important;max-width:calc(100vw - env(safe-area-inset-left,0px) - env(safe-area-inset-right,0px) - 88px);max-height:calc(100dvh - env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px) - var(--csp-map-info-height,44px) - 36px);overflow-y:auto;overscroll-behavior:contain}"
    + "html.csp-native-chrome #dnrDownloadToggle{min-height:44px}"
    /* Pop-up controls need their layout boxes too: the adapter uses layout
       to distinguish visible controls from conditional ones. display:none
       on a pop-up would also erase its native fields, sliders and buttons. */
    + "html.csp-native-chrome :is(#serverPanel,#snapshotPanel,#terrainSourcePanel,#ctl,#mkBar,#mkPop){translate:-400vw 0!important;pointer-events:none!important}";
  root.classList.add("csp-native-chrome");
  root.append(chrome);
  /* native-shell.js reports the page's selected theme; SwiftUI mirrors it
     for the native controls and sheets as well as the web map. */
  // The shell reports ready after applying any in-memory recovery checkpoint.

  Object.defineProperty(window, "CSPNativeHost", {
    value: Object.freeze({
      platform: "ios",
      resume: config.resume || null,
      appVersion: String(config.appVersion || ""),
      /* The engine address belongs to the app. The page keeps its requests
         relative and the app forwards them, so nothing is cross-origin. */
      engineBase: () => engineBase,
      setEngineBase: base => post("engine.set", { base: String(base || "") })
        .then(saved => (engineBase = typeof saved === "string" ? saved : "")),
      _geoUpdate(id, fix, failure) {
        const watch = watches.get(id);
        if (!watch) return;
        if (failure) watch.failure?.(geoError(failure));
        else if (fix) watch.success?.(position(fix));
      }
    })
  });
})();
