/* Run as the body of -cspDebugScript in a Debug app (see ios/README.md).
   Records what the web publishes to the native shell on a fresh launch:
   the menu groups, the dock, every page and every tool pop-up, exactly as
   ShellModel decodes them. The native shell backend reproduces these
   (ios/Tests/Fixtures/shell), so the native app keeps the same look and
   flow without the page. Opens pages and pop-ups only; changes nothing. */
return (async () => {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  for (let attempts = 0; !window.CSPNativeShell && attempts < 200; attempts++) await wait(50);
  const shell = window.CSPNativeShell;
  if (!shell) throw new Error("The native shell adapter did not initialize");
  await wait(1500);
  const groups = typeof shell.groups === "function" ? shell.groups() : shell.groups;
  const pages = {};
  for (const group of groups) for (const route of group.routes) {
    shell.open(route.key);
    shell.setView({ sheet: "large", page: route.key, panel: null });
    await wait(400);
    pages[route.key] = shell.describe();
  }
  shell.setView({ sheet: "closed", page: null, panel: null });
  // A pop-up describes itself only while open: open each from its dock
  // button as the app does, describe it, then close it again.
  const panels = {};
  for (const id of ["mkBar", "snapshotPanel", "terrainSourcePanel", "serverPanel", "ctl"]) {
    const button = document.querySelector(`#mapDock [aria-controls="${id}"]`);
    if (!button) { panels[id] = { missing: true }; continue; }
    shell.tool(button.id);
    shell.setView({ sheet: "medium", page: null, panel: id });
    await wait(500);
    try { panels[id] = shell.describePanel(id); } catch (error) { panels[id] = { error: String(error) }; }
    shell.closePanel?.(id);
    shell.setView({ sheet: "closed", page: null, panel: null });
    await wait(200);
  }
  const dock = [...document.querySelectorAll("#mapDock > .map-tool")].map(el => ({
    id: el.id, title: el.getAttribute("aria-label") || el.title || "", hidden: el.hidden }));
  return JSON.stringify({ groups, dock, pages, panels });
})();
