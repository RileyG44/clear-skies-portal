/* Run as the body of -cspDebugScript in a Debug app (see ios/README.md).
   Exercises the real bundled page and native adapter, without stubbing data
   providers, running analyses, connecting an engine or exporting an image. */
return (async () => {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  for (let attempts = 0; !window.CSPNativeShell && attempts < 100; attempts++) await wait(50);
  const shell = window.CSPNativeShell;
  if (!shell) throw new Error("The native shell adapter did not initialize");

  const originalRoute = window.CSPShell.current();
  const failures = [], pages = [], panels = [];
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
  const routes = shell.groups().flatMap(group => group.routes.map(route => route.key));
  check(routes.length === 13 && new Set(routes).size === 13, "Expected all 13 distinct tool routes");
  try {
    for (const route of routes) {
      shell.open(route);
      shell.setView({ sheet: "large", page: route, panel: null });
      await wait(100);
      const page = shell.describe(), rows = flatten(page.items);
      check(page.route === route && rows.length > 0, `${route}: missing page contents`);
      check(!document.querySelector("#cspWorkspaceScroll details:not([open])"), `${route}: a section remains closed`);
      pages.push({ route, rows: rows.length, controls: references(page).size });
      if (route === "elevation") {
        const refs = references(page);
        for (const id of ["elevBandsReset", "elevBelowVal", "elevBelowColor", "elevAboveVal", "elevAboveColor", "elevAlpha"])
          check(refs.has("#" + id), `elevation: missing ${id}`);
      }
    }

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
  } finally {
    shell.open(originalRoute);
    shell.setView({ sheet: "large", page: originalRoute, panel: null });
  }
  return { passed: failures.length === 0, pages, panels, failures };
})();
