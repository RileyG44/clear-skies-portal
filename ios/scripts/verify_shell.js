/* Run as the body of -cspDebugScript in a Debug app (see ios/README.md).
   Exercises the real bundled page and native adapter, without stubbing data
   providers, running analyses, connecting an engine or exporting an image. */
return (async () => {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  for (let attempts = 0; !window.CSPNativeShell && attempts < 100; attempts++) await wait(50);
  const shell = window.CSPNativeShell;
  if (!shell) throw new Error("The native shell adapter did not initialize");

  const originalRoute = window.CSPShell.current();
  const originalSession = ClearSkiesPortalBridge.sessionState();
  const originalDock = [...document.querySelectorAll('#mapDock > .map-tool')].map(el => el.id);
  const dockKey = 'clearskies.mapToolOrder.v2', originalDockPreference = localStorage.getItem(dockKey);
  const failures = [], pages = [], panels = [];
  const LIDAR_DISCLOSURES = "#terLayerSettings,#terDataOffline,.ls-customize";
  let lidar = null;
  const check = (condition, message) => { if (!condition) failures.push(message); };
  const flatten = items => items.flatMap(item => [item, ...flatten(item.items || [])]);
  const references = value => {
    const found = new Set();
    const visit = value => {
      if (typeof value === "string" && /^[#@]/.test(value)) found.add(value);
      else if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") Object.values(value).forEach(visit);
    };
    visit(value);
    return found;
  };
  const visible = element => {
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  };
  /* LiDAR: Presets first, then Terrain mode & data; its three disclosures
     open and close the web's own sections; saved presets can be deleted;
     the sun dial sets the web's own inputs. */
  async function verifyLidar() {
    const describe = async () => { shell.refresh(); await wait(120); return shell.describe(); };
    const original = { style: document.getElementById("terStyle").value,
      open: [...document.querySelectorAll(LIDAR_DISCLOSURES)].map(el => [el, el.open]),
      azimuth: document.getElementById("terSunAz").value, altitude: document.getElementById("terSunAlt").value };
    const result = { order: [], disclosures: {}, preset: null, sun: null };
    shell.open("terrain");
    shell.setView({ sheet: "large", page: "terrain", panel: null });
    try {
      shell.act("#terStyle", "select", "hs");
      await wait(400);
      let page = await describe();
      const headers = page.items.filter(item => item.kind === "header").map(item => item.title);
      result.order = headers;
      check(headers[0] === "Presets" && headers.indexOf("Terrain mode & data") > 0, `terrain: Presets must come first (${headers.join(", ")})`);
      check(!flatten(page.items).some(item => /look/i.test(item.title || "") && item.kind !== "looks"), "terrain: Looks naming remains");
      const findGroup = (items, title) => flatten(items).find(item => item.kind === "group" && item.title === title);
      for (const title of ["Customize preset", "Layer settings", "Data sources & offline use"]) {
        let group = findGroup(page.items, title);
        check(group?.disclosure === true, `terrain: ${title} is not a native disclosure`);
        if (!group) continue;
        const element = document.querySelector(`[data-cspn="${group.ref.slice(1)}"]`) || document.getElementById(group.ref.slice(1));
        shell.act(group.ref, "open", false); page = await describe(); group = findGroup(page.items, title);
        const closed = group?.open === false && !(group.items || []).length && element && !element.open;
        shell.act(group.ref, "open", true); page = await describe(); group = findGroup(page.items, title);
        const refs = references(group);
        const opened = group?.open === true && (group.items || []).length > 0 && element.open;
        shell.act(group.ref, "open", true); page = await describe(); // reopening stays open
        result.disclosures[title] = { closed, opened, rows: flatten(group?.items || []).length };
        check(closed && opened, `terrain: ${title} did not close and reopen`);
        const required = { "Layer settings": ["terSrc", "terOp", "terBrightness", "terContrast", "terSaturation", "terLookReset", "terSunAz", "terSunAlt", "terAmbient", "terExaggeration", "terLightReset"],
          "Data sources & offline use": ["terDepth", "terExtent", "terWarm", "dnrSelect", "dnrViewport", "terrainInspectSource"] }[title] || [];
        for (const id of required) check(refs.has("#" + id), `terrain: ${title} missing ${id}`);
        // Every visible web control inside the open disclosure is in the app.
        for (const control of element.querySelectorAll("input:not([type=hidden]),select,textarea,button")) {
          if (!visible(control) || control.closest("summary")) continue;
          const ref = control.id ? "#" + control.id : "@" + control.getAttribute("data-cspn");
          check(refs.has(ref), `terrain: ${title} does not represent ${control.id || control.className || control.tagName}`);
        }
        if (title === "Layer settings") {
          const sun = flatten(group.items).find(item => item.kind === "sun");
          check(sun?.azimuth?.ref === "#terSunAz" && sun?.altitude?.ref === "#terSunAlt", "terrain: sun dial lost its inputs");
        }
      }
      const all = references(page);
      for (const id of ["terStyle", "terReset"]) check(all.has("#" + id), `terrain: missing ${id}`);
      check(!flatten(page.items).some(item => /previous presets|next presets/i.test(item.title || item.accessibility || "")), "terrain: web carousel arrows are drawn natively");
      // A saved preset: built-ins have no delete; the saved one does, and it works.
      const save = flatten(page.items).find(item => item.kind === "button" && item.title === "Save current");
      check(!!save, "terrain: Save current missing");
      if (!save) return result;
      shell.act(save.ref, "click");
      await wait(100);
      const form = document.querySelector("#terStudio .ls-save-row"), field = form?.querySelector("input");
      field.value = "Verify preset"; form.requestSubmit();
      page = await describe();
      let looks = flatten(page.items).find(item => item.kind === "looks");
      const saved = looks?.options?.find(option => option.title === "Verify preset");
      const builtIns = looks?.options?.filter(option => option !== saved) || [];
      check(looks?.title === "Terrain presets", "terrain: preset strip title");
      check(!!saved?.remove, "terrain: saved preset cannot be deleted natively");
      check(builtIns.length > 0 && builtIns.every(option => !option.remove || /^user-/.test(document.querySelector(`[data-cspn="${option.ref.slice(1)}"]`)?.dataset.look || "")),
        "terrain: a built-in preset offers delete");
      if (saved?.remove) shell.act(saved.remove, "click");
      page = await describe();
      looks = flatten(page.items).find(item => item.kind === "looks");
      result.preset = { saved: !!saved?.remove, deleted: !looks?.options?.some(option => option.title === "Verify preset") };
      check(result.preset.deleted, "terrain: deleting a saved preset failed");
      // Sun dial: native commits reach the web inputs, outputs and drawn dial.
      shell.act("#terSunAz", "commit", 100); shell.act("#terSunAlt", "commit", 20);
      await wait(150);
      const transform = document.querySelector(".sun-dial-sun")?.getAttribute("transform");
      const point = CSPLidarStudio.sunPoint(100, 20, 80);
      result.sun = { azimuth: document.getElementById("terSunAzOut").textContent, altitude: document.getElementById("terSunAltOut").textContent, transform };
      check(result.sun.azimuth === "100°" && result.sun.altitude === "20°", "terrain: sun commit did not reach the web");
      check(transform === `translate(${point.x} ${point.y})`, "terrain: web dial did not follow the native dial");
    } finally {
      shell.act("#terSunAz", "commit", original.azimuth); shell.act("#terSunAlt", "commit", original.altitude);
      shell.act("#terStyle", "select", original.style);
      for (const [el, open] of original.open) if (el.isConnected) el.open = open;
    }
    return result;
  }

  const routes = shell.groups().flatMap(group => group.routes.map(route => route.key));
  check(routes.length === 13 && new Set(routes).size === 13, "Expected all 13 distinct tool routes");
  try {
    for (const route of routes) {
      shell.open(route);
      shell.setView({ sheet: "large", page: route, panel: null });
      await wait(100);
      const page = shell.describe(), rows = flatten(page.items);
      check(page.route === route && rows.length > 0, `${route}: missing page contents`);
      // LiDAR's own disclosures stay closed until opened; others are open.
      check(![...document.querySelectorAll("#cspWorkspaceScroll details:not([open])")].some(el => !el.matches(LIDAR_DISCLOSURES)),
        `${route}: a section remains closed`);
      pages.push({ route, rows: rows.length, controls: references(page).size });
      if (route === "elevation") {
        const refs = references(page);
        for (const id of ["elevBandsReset", "elevBelowVal", "elevBelowColor", "elevAboveVal", "elevAboveColor", "elevAlpha"])
          check(refs.has("#" + id), `elevation: missing ${id}`);
      }
    }

    lidar = await verifyLidar();

    for (const [tool, id, required] of [
      ["server", "serverPanel", ["srvUrl", "srvConnect"]],
      ["snapshot", "snapshotPanel", ["snapshotScale", "snapshotReadout", "snapshotCapture", "snapshotSelect"]],
      ["terrain-source", "terrainSourcePanel", []]
    ]) {
      const button = document.querySelector(`#mapDock [data-tool="${tool}"]`);
      check(!!button, `${id}: missing map tool`);
      if (!button) continue;
      shell.tool(button.id);
      await wait(100);
      const panel = shell.describePanel(id), root = document.getElementById(id);
      const refs = references(panel), rows = flatten(panel?.items || []);
      check(root && !root.hidden && rows.length > 0, `${id}: missing native contents`);
      check(root?.getAttribute("aria-hidden") === "true", `${id}: duplicate web accessibility controls`);
      for (const ref of required) check(refs.has("#" + ref), `${id}: missing ${ref}`);
      // Independently compare visible web inputs with the native description.
      // This catches a display:none ancestor silently dropping native fields.
      for (const control of root.querySelectorAll("input:not([type=hidden]),select,textarea,button")) {
        if (!visible(control) || control.closest(".tool-popover-head")) continue;
        const ref = control.id ? "#" + control.id : "@" + control.getAttribute("data-cspn");
        check(refs.has(ref), `${id}: unrepresented ${control.id || control.tagName}`);
      }
      panels.push({ id, rows: rows.length, controls: refs.size });
      shell.closePanel(id);
    }
    check(document.getElementById("side")?.getAttribute("aria-hidden") === "true", "Duplicate web sidebar accessibility controls");
    // Cross the real adapter and SwiftUI state boundary, including persistence.
    const visibleDock = () => [...document.querySelectorAll('#mapDock > .map-tool')].filter(el => !el.hidden && el.dataset.tool !== 'scene').map(el => el.id);
    const tools = visibleDock(), moving = tools[0];
    check(shell.moveTool(moving, tools.length - 1), 'Native dock move was rejected');
    await wait(150);
    const moved = visibleDock(), saved = JSON.parse(localStorage.getItem(dockKey));
    let native = (await window.webkit.messageHandlers.cspNative.postMessage({type: 'debug.configuration'})).navigation;
    check(moved.at(-1) === moving && saved.indexOf(moving) > saved.indexOf(tools.at(-1)), 'Dock order was not saved by the web');
    check(native.dock.join('|') === saved.join('|'), 'Native dock did not follow the saved web order');
    await ClearSkiesPortalBridge.restoreSession({center: [47.858, -118.33], zoom: 16, mode: '2d',
      location: {lat: 47.858, lng: -118.33, label: 'Verification location'}});
    shell.refresh(); await wait(150);
    native = (await window.webkit.messageHandlers.cspNative.postMessage({type: 'debug.configuration'})).navigation;
    check(native.search.label === 'Verification location' && native.search.canClear && native.search.canCopy, 'Selected location did not reach native search');
    check(native.search.mapsURL.includes('47.858') && native.search.earthURL.includes('47.858'), 'Coordinate actions lost the selected point');
    shell.clear(); await wait(150);
    native = (await window.webkit.messageHandlers.cspNative.postMessage({type: 'debug.configuration'})).navigation;
    check(!native.search.label && !native.search.canClear && !native.search.canCopy, 'Clear search did not clear the native selected location/actions');
  } finally {
    const dock = document.getElementById('mapDock');
    for (const id of originalDock) dock.appendChild(document.getElementById(id));
    if (originalDockPreference === null) localStorage.removeItem(dockKey); else localStorage.setItem(dockKey, originalDockPreference);
    await ClearSkiesPortalBridge.restoreSession(originalSession);
    shell.refresh();
    shell.open(originalRoute);
    shell.setView({ sheet: "large", page: originalRoute, panel: null });
  }
  return { passed: failures.length === 0, pages, panels, lidar, failures };
})();
