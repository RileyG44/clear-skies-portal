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

  /* The status bar and system sheets follow the map's light or dark theme. */
  const root = document.documentElement;
  const sendTheme = () => {
    const theme = root.dataset.uiTheme;
    if (theme) post("theme", { theme }).catch(() => {});
  };
  new MutationObserver(sendTheme).observe(root, { attributes: true, attributeFilter: ["data-ui-theme"] });
  root.addEventListener("csp:ready", () => { sendTheme(); post("ready").catch(() => {}) }, { once: true });

  Object.defineProperty(window, "CSPNativeHost", {
    value: Object.freeze({
      platform: "ios",
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
