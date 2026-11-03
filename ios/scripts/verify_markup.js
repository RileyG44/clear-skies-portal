/* Debug-app integration probe for the native markup pane: drives the real web
   markup controls through the same bridge calls the SwiftUI pane makes, in the
   app's own WebKit, and checks the description the pane is drawn from.
   Run against a test engine: it draws, undoes and restyles marks on the first
   editable layer and restores the pen's width and colour afterwards.

   xcrun simctl launch <sim> <bundle> -cspDebugScript "$(cat ios/scripts/verify_markup.js)" */
return (async () => {
  const S = CSPNativeShell, B = ClearSkiesPortalBridge, checks = [];
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const check = (ok, name, detail) => { checks.push({ ok: !!ok, name, detail: ok ? undefined : detail }); };
  const panel = () => S.describePanel("mkBar");
  const first = (kind, p = panel()) => p?.items.find(item => item.kind === kind);
  const style = () => first("group");
  const row = kind => style()?.items.find(item => item.kind === kind);
  const tool = id => first("markupTools").options.find(option => option.value === id);
  const marks = () => first("markupMarks")?.value || 0;
  // Map taps as a finger makes them, at a point on the map container.
  const tapAt = async point => {
    const rect = B.map.getContainer().getBoundingClientRect(), x = rect.left + point.x, y = rect.top + point.y;
    const target = document.elementFromPoint(x, y);
    const options = { clientX: x, clientY: y, pointerId: 11, pointerType: "touch", isPrimary: true, bubbles: true, cancelable: true, button: 0 };
    target.dispatchEvent(new PointerEvent("pointerdown", options)); await wait(40);
    window.dispatchEvent(new PointerEvent("pointerup", options)); await wait(160);
  };

  // The pen's saved style is put back exactly at the end (for the next launch):
  // a width typed here would otherwise replace a zoom-relative default.
  const STYLE_KEY = "clearskies.markup.style.v1", savedStyle = localStorage.getItem(STYLE_KEY);
  for (let i = 0; i < 60 && !document.querySelector(".mk-layer"); i++) { if (i % 8 === 0) CSPShell.open?.("markup"); await wait(250); }
  if (!CSPMarkup.isEditing()) CSPMarkup.quickDraw();
  await wait(700);
  check(!!panel(), "markup pane is described", "no #mkBar description");
  S.act(tool("pen").ref); await wait(250);

  // The pane's structure.
  const items = panel().items.map(item => item.kind);
  check(["markupTools", "markupHistory", "markupFinish", "group", "markupLayer"].every(kind => items.includes(kind)), "task-shaped description", items.join(","));
  check(first("markupTools").options.length === 8, "all eight tools at once", first("markupTools").options.length);
  check(!items.slice(0, items.indexOf("group")).includes("text"), "no stray label rows above the style", items.join(","));
  check(/^[^:]*:pen:new$/.test(style().id), "style rows owned by layer, tool and mark", style().id);

  // Exact sizes: an owner mismatch is refused; a valid value is held; a
  // rejected value keeps the web's field and message until Escape.
  const width = () => row("markupSize"), original = width().edit.value;
  let result = S.enterValue(width().edit.ref, "3", "width", "another:pen:new");
  check(!result.accepted && /changed/.test(result.message), "a size typed for another owner is refused", JSON.stringify(result));
  check(width().edit.value === original, "a refused size leaves the value", width().edit.value);
  result = S.enterValue(width().edit.ref, "2.5", "width", style().id); await wait(150);
  check(result.accepted && width().edit.value === 2.5 && width().display === "2.5 ft", "an accepted size is held by the web", JSON.stringify({ result, value: width().edit.value, display: width().display }));
  result = S.enterValue(width().edit.ref, "0", "width", style().id); await wait(150);
  check(!result.accepted && /0\.1 ft/.test(result.message), "a rejected size returns the web's message", JSON.stringify(result));
  check(width().expanded === true && width().entry?.value === "0", "the rejected value stays in the web's field", JSON.stringify(width()));
  S.act(width().entry.ref, "key", "Escape"); await wait(150);
  check(!width().expanded, "Escape discards the rejected value", JSON.stringify(width()));
  S.enterValue(width().edit.ref, String(original), "width", style().id); await wait(150);
  check(Math.abs(width().edit.value - original) < 1e-6, "the original width is restored", width().edit.value);

  // Colours go through the web's own swatches.
  const colour = () => row("markupColor"), originalColour = colour().color;
  S.act(colour().ref, "pick", "#0a84ff"); await wait(200);
  check(colour().color === "#0a84ff" && !colour().expanded, "a picked shade is applied and the palette closes", JSON.stringify({ color: colour().color, open: colour().expanded }));
  S.act(colour().ref, "pick", originalColour); await wait(200);
  check(colour().color === originalColour, "the original colour is restored", colour().color);

  // Freeform: three points, kept through Pan, resumed with Add points, and
  // closed by tapping the first point where it is drawn after the map moved.
  const before = marks();
  S.act(tool("shape").ref); await wait(250);
  const freeform = first("markupTools").items?.flatMap(group => group.options).find(option => option.value === "freeform");
  check(!!freeform, "the shape gallery opens with the Shapes tool", JSON.stringify(first("markupTools").items));
  S.act(freeform.ref); await wait(250);
  const size = B.map.getSize(), points = [{ x: size.x * 0.35, y: size.y * 0.22 }, { x: size.x * 0.62, y: size.y * 0.25 }, { x: size.x * 0.5, y: size.y * 0.38 }];
  await tapAt(points[0]); await tapAt(points[1]);
  check(first("markupFinish").disabled === true && /2 of 3/.test(first("markupHistory").title), "Finish waits for a third point", JSON.stringify(first("markupFinish")));
  await tapAt(points[2]);
  check(first("markupFinish").id === "finish" && !first("markupFinish").disabled, "three points can finish", JSON.stringify(first("markupFinish")));
  S.act(tool("pan").ref); await wait(250);
  check(first("markupFinish").id === "finish" && first("markupFinish").buttons.some(button => button.id === "resume-shape"), "the shape survives Pan, with Add points", JSON.stringify(first("markupFinish")));
  check(/Panning/.test(panel().state || ""), "the subtitle says the map is panning", panel().state);
  B.map.panBy([60, 40], { animate: false }); await wait(250);
  S.act(first("markupFinish").buttons.find(button => button.id === "resume-shape").ref); await wait(250);
  check(tool("shape").selected === true && first("markupFinish").id === "finish", "Add points resumes the same shape", JSON.stringify(first("markupFinish")));
  await tapAt({ x: points[0].x - 60, y: points[0].y - 40 });
  check(marks() === before + 1 && first("markupFinish").id === "done", "the moved first point closes the shape", JSON.stringify({ before, after: marks(), finish: first("markupFinish").id }));
  S.act(first("markupHistory").buttons.find(button => button.id === "undo").ref); await wait(250);
  check(marks() === before, "undo removes the shape", marks());
  B.map.panBy([-60, -40], { animate: false });

  // The mark list selects a mark only when the web confirms it.
  const listed = first("markupMarks")?.options || [];
  const target = listed[listed.length - 1];
  if (target) {
    result = S.selectMark(target.ref, target.value, 300); await wait(250);
    check(result.selected && first("markupSelection") && style().id.endsWith(":" + target.value), "a listed mark is selected and owns the style", JSON.stringify({ result, owner: style().id }));
    result = S.selectMark("@stale", target.value, 300);
    check(result.selected === true || result.selected === false, "a stale list entry reports an outcome", JSON.stringify(result));
    S.act(tool("pen").ref); await wait(200);
  } else check(false, "the layer has marks to list", "no listed marks");

  // Hidden tools leave a status on the map, with the web's Done button.
  const handler = window.webkit.messageHandlers.cspNative, send = handler.postMessage.bind(handler);
  let status = null;
  handler.postMessage = message => { try { const json = JSON.parse(message.json || "{}"); if ("map" in json) status = json.map.markup; } catch (error) {} return send(message); };
  document.querySelector("#mkBar [data-act=close]").click(); await wait(300); S.refresh(); await wait(200);
  check(status?.tool === "pen" && status?.title === "Pen" && !!status?.done, "hiding the tools reports the active tool and Done", JSON.stringify(status));
  handler.postMessage = send;
  CSPMarkup.quickDraw(); await wait(400);

  if (savedStyle === null) localStorage.removeItem(STYLE_KEY); else localStorage.setItem(STYLE_KEY, savedStyle);
  const failed = checks.filter(item => !item.ok);
  return { passed: checks.length - failed.length, failed: failed.length, checks };
})();
