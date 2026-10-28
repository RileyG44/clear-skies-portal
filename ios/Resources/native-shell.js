/* Clear Skies native shell adapter (docs/ios CR-001, Stage 2).

   The iPhone app draws the search, sheet, route pages, map tools and pop-ups
   natively. This script describes the web client's live controls for it and
   applies native changes back to those same controls, so the web code stays
   the only owner of state, sources, loading and rendering. Nothing here
   re-implements app behaviour: a native switch clicks the web switch, a native
   slider sets the web slider and sends the input and change events a person
   would, and a native search calls the bridge the web search calls.

   Injected by the app after the page's own scripts; absent everywhere else.
   One message type carries every update to the app: {type:"shell", json},
   where json holds only the parts that changed since the last message. */
(() => {
  "use strict";
  const handler = window.webkit?.messageHandlers?.cspNative;
  if (!handler || !window.CSPNativeHost || window.CSPNativeShell) return;
  const send = update => handler.postMessage({ type: "shell", json: JSON.stringify(update) }).catch(() => {});
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const clean = text => String(text || "").replace(/\s+/g, " ").trim();
  const bridge = () => window.ClearSkiesPortalBridge;

  /* ---------------------------------------------------------------- refs
     Elements keep their own id where they have one; others get a data
     attribute the first time they are described. A ref that no longer
     resolves (the web rebuilt that part) fails quietly and the page is
     described again. */
  let nextRef = 1;
  const REF = "data-cspn";
  const refOf = el => {
    if (el.id) return "#" + el.id;
    let ref = el.getAttribute(REF);
    if (!ref) { ref = "n" + nextRef++; el.setAttribute(REF, ref); }
    return "@" + ref;
  };
  const elementFor = ref => typeof ref !== "string" ? null
    : ref.startsWith("#") ? document.getElementById(ref.slice(1))
    : ref.startsWith("@") ? document.querySelector(`[${REF}="${CSS.escape(ref.slice(1))}"]`) : null;

  /* --------------------------------------------------------- visibility
     The web panel is moved off screen in the app, never hidden, so layout
     still says what the web itself shows. Closed <details>, [hidden] and
     route-hidden panes have no boxes. display:contents has no box of its
     own; it is shown when anything inside it is. */
  const shown = el => {
    if (!el || el.nodeType !== 1) return false;
    const style = getComputedStyle(el);
    if (style.display === "none") return false;
    if (style.display === "contents") return [...el.children].some(shown);
    return style.visibility !== "hidden" && el.getClientRects().length > 0;
  };

  const FORM = "input,select,textarea,button,[role=button],[role=radio],[role=option],[role=switch],[role=slider]";
  const CONTROLS = FORM + ",a[href]";
  const iconOf = el => {
    const img = el?.matches?.("img") ? el : el?.querySelector?.("img[src*='icons/']");
    const match = img && (img.getAttribute("src") || "").match(/icons\/([a-z0-9-]+)\.svg/);
    return match ? match[1] : undefined;
  };
  /* Text a person reads, without the control's own text or icons. */
  const textWithout = (el, exclude) => {
    const copy = el.cloneNode(true);
    for (const node of copy.querySelectorAll(exclude)) node.remove();
    return clean(copy.textContent);
  };
  const labelFor = el => {
    const own = el.labels?.[0];
    const text = own ? textWithout(own, CONTROLS + ",output,.csp-switch") : "";
    if (text) return text;
    return clean(el.getAttribute("aria-label") || el.closest("label[aria-label]")?.getAttribute("aria-label") || el.title || el.placeholder || "");
  };
  /* "ft" beside a number field belongs to the field. */
  const unitOf = el => clean(el.closest(".unit-field")?.querySelector(".unit-suffix")?.textContent) || undefined;
  const toHex = value => {
    const text = String(value || "").trim();
    if (/^#[0-9a-f]{6}$/i.test(text)) return text.toLowerCase();
    if (/^#[0-9a-f]{3}$/i.test(text)) return "#" + [...text.slice(1)].map(c => c + c).join("").toLowerCase();
    const match = text.match(/rgba?\(([^)]+)\)/);
    if (!match) return undefined;
    const [r, g, b, a] = match[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    if (a === 0) return undefined;
    return "#" + [r, g, b].map(n => Math.round(n).toString(16).padStart(2, "0")).join("");
  };
  const colorOf = el => {
    const style = getComputedStyle(el);
    const swatch = style.getPropertyValue("--swatch").trim() || style.getPropertyValue("--c").trim();
    return toHex(swatch || style.backgroundColor);
  };
  /* The first CSS linear-gradient on an element as [{color, opacity, at}],
     for a native gradient. Later layers (a checkerboard under a ramp) are
     backdrops, not colors. */
  const firstGradient = text => {
    const start = text.indexOf("linear-gradient(");
    if (start < 0) return "";
    let depth = 0;
    for (let i = start + 15; i < text.length; i++) {
      if (text[i] === "(") depth++;
      else if (text[i] === ")" && --depth === 0) return text.slice(start + 16, i);
    }
    return "";
  };
  const gradientOf = el => {
    if (!el) return undefined;
    const text = firstGradient(el.style.background || el.style.backgroundImage || "") || firstGradient(getComputedStyle(el).backgroundImage || "");
    const stops = [];
    for (const match of text.matchAll(/(rgba?\([^)]*\)|#[0-9a-f]{3,8}\b)\s*(-?[\d.]+%)?/gi)) {
      const rgba = match[1].match(/rgba?\(([^)]+)\)/), parts = rgba && rgba[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      const opacity = parts && parts.length > 3 ? parts[3] : 1;
      const hex = parts ? "#" + parts.slice(0, 3).map(n => Math.round(n).toString(16).padStart(2, "0")).join("") : toHex(match[1]);
      stops.push({ color: hex || "#000000", opacity, at: match[2] === undefined ? undefined : parseFloat(match[2]) / 100 });
    }
    if (stops.length < 2) return undefined;
    stops.forEach((stop, index) => { if (stop.at === undefined) stop.at = index / (stops.length - 1); });
    return stops;
  };

  /* Canvas pictures (look previews, legends) are encoded once per canvas and
     again at most every two seconds; a description never stalls on them. */
  const pictures = new WeakMap(), imageAssets = new Map(), activeImages = new Set(), changedImages = new Map();
  const pictureOf = canvas => {
    if (!canvas.width || !canvas.height || canvas.width * canvas.height > 600000) return undefined;
    const now = performance.now(), cached = pictures.get(canvas);
    const keep = (src, key) => {
      activeImages.add(key);
      if (imageAssets.get(key) !== src) { imageAssets.set(key, src); changedImages.set(key, src); }
      return key;
    };
    if (cached && now - cached.at < 2000 && cached.w === canvas.width && cached.h === canvas.height)
      return keep(cached.src, cached.key);
    try {
      const src = canvas.toDataURL("image/png");
      const key = "csp-image:" + refOf(canvas);
      pictures.set(canvas, { src, key, at: now, w: canvas.width, h: canvas.height });
      return keep(src, key);
    } catch (error) { return undefined; }
  };

  /* Inline text with links, as Markdown the app renders with live links. */
  const escapeMarkdown = text => text.replace(/([\\[\]*_`])/g, "\\$1");
  function markdownOf(el) {
    let out = "";
    for (const node of el.childNodes) {
      if (node.nodeType === 3) { out += escapeMarkdown(node.textContent.replace(/\s+/g, " ")); continue; }
      if (node.nodeType !== 1 || !shown(node)) continue;
      const tag = node.tagName;
      if (tag === "BR") { out += "\n"; continue; }
      if (tag === "A" && node.href && /^https?:/i.test(node.href)) { out += `[${escapeMarkdown(clean(node.textContent))}](${node.href.replace(/\)/g, "%29")})`; continue; }
      const inner = markdownOf(node);
      if (tag === "B" || tag === "STRONG") out += inner.trim() ? `**${inner.trim()}**` : "";
      else if (/^(P|DIV|LI|H\d)$/.test(tag)) out += "\n" + inner.trim() + "\n";
      else out += inner;
    }
    return out;
  }
  const tidyMarkdown = text => text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

  /* ---------------------------------------------------------- describe */
  function controlItem(el, context = {}) {
    const tag = el.tagName.toLowerCase(), type = (el.getAttribute("type") || "").toLowerCase();
    const title = context.title ?? labelFor(el);
    const base = { ref: refOf(el), title, detail: context.detail || undefined, disabled: !!el.disabled || el.getAttribute("aria-disabled") === "true" };
    if (tag === "input" && (type === "checkbox" || type === "radio")) return { kind: "toggle", ...base, value: el.checked, radio: type === "radio" || undefined };
    if (tag === "input" && type === "range") {
      const output = context.output || (el.id && $(`output[for~="${CSS.escape(el.id)}"]`)) || (el.nextElementSibling?.matches("output") ? el.nextElementSibling : null);
      return { kind: "slider", ...base, value: Number(el.value), min: Number(el.min || 0), max: Number(el.max === "" ? 100 : el.max),
        step: el.step === "any" ? 0 : Number(el.step || 1), display: output ? clean(output.textContent) : undefined };
    }
    if (tag === "input" && type === "color") return { kind: "color", ...base, value: el.value };
    if (tag === "select") return { kind: "picker", ...base, value: el.value,
      options: [...el.options].map(option => ({ value: option.value, title: clean(option.textContent), disabled: option.disabled || undefined })) };
    if (tag === "input" || tag === "textarea") return { kind: "field", ...base, value: el.value, placeholder: el.placeholder || undefined,
      input: tag === "textarea" ? "multiline" : (type || "text"), min: el.min || undefined, max: el.max || undefined, step: el.step || undefined,
      unit: unitOf(el) };
    if (el.getAttribute("role") === "slider") return { kind: "text", style: "hint", title: clean(el.getAttribute("aria-valuetext") || el.getAttribute("aria-label")) };
    // Analysis choices have a short name and a separate scientific description.
    if (el.matches(".al-menu-item")) return {kind:"button",...base,role:"option",
      title:clean($(".al-menu-text > span",el)?.textContent),detail:clean($(".al-menu-hint",el)?.textContent)||undefined};
    // Buttons and links.
    const own = textWithout(el, "svg,img");
    const aria = clean(el.getAttribute("aria-label"));
    const label = context.title || own || aria || clean(el.title);
    // Pills, export actions and text buttons are buttons. A menu item is a
    // row. Anything else stays unset so a disclosure (aria-expanded) can
    // still draw as a row.
    const role = el.matches(".linkbtn") ? "link"
      : el.matches(".snapshot-action-primary,.primary,.ls-pill-primary,.snap-sel-save") ? "primary"
      : el.matches(".danger,.mk-btn-danger,.mk-btn-danger-text") ? "destructive"
      : el.getAttribute("role") === "menuitem" ? "option"
      : el.matches(".ls-pill,.snapshot-action,.ghost") ? "action" : undefined;
    return { kind: tag === "a" ? "link" : "button", ...base, title: label, accessibility: aria && aria !== label ? aria : undefined, icon: iconOf(el),
      pressed: el.hasAttribute("aria-pressed") ? el.getAttribute("aria-pressed") === "true" : undefined,
      expanded: el.hasAttribute("aria-expanded") ? el.getAttribute("aria-expanded") === "true" : undefined,
      role, href: tag === "a" ? el.href : undefined };
  }

  function choiceGroup(el) {
    const options = $$("[role=radio],button[aria-pressed]", el).filter(shown).filter(option => option.closest("[role=radiogroup],[role=group]") === el);
    const swatches = options.length && options.every(option => !clean(option.textContent) && colorOf(option));
    const title = clean(el.getAttribute("aria-label"));
    if (swatches) {
      const custom = $$("input[type=color]", el.parentElement || el).find(shown);
      return { kind: "swatches", ref: refOf(el), title,
        options: options.map(option => ({ ref: refOf(option), title: clean(option.getAttribute("aria-label") || option.title), color: colorOf(option),
          selected: option.getAttribute("aria-checked") === "true" || option.getAttribute("aria-pressed") === "true" })),
        custom: custom ? { ref: refOf(custom), value: custom.value, title: labelFor(custom) } : undefined };
    }
    const icons = options.some(option => iconOf(option));
    return { kind: icons ? "choices" : "segmented", ref: refOf(el), title,
      disabled: el.getAttribute("aria-disabled") === "true" || undefined,
      options: options.map(option => ({ ref: refOf(option), title: clean(option.getAttribute("aria-label") || option.textContent), icon: iconOf(option),
        selected: option.getAttribute("aria-checked") === "true" || option.getAttribute("aria-pressed") === "true", disabled: option.disabled || undefined })) };
  }

  /* A labelled row: settings rows, field rows and switch rows put a title
     (and sometimes a description) beside one control. */
  function row(el, out) {
    const text = $(".csp-setting-text", el);
    const strong = text ? $("strong", text) : null;
    const title = strong ? clean(strong.textContent) : text ? textWithout(text, CONTROLS) : textWithout(el, CONTROLS + ",output,.csp-switch,.csp-accent-name");
    const detailEl = text ? $$("span", text).find(span => !span.querySelector("strong") && clean(span.textContent)) : null;
    const detail = detailEl && clean(detailEl.textContent) !== title ? clean(detailEl.textContent) : undefined;
    const value = $(".csp-accent-name", el);
    const controls = $$("input,select,textarea,button,a[href]", el).filter(shown).filter(c => !c.closest(".csp-setting-text"));
    const group = $("[role=group],[role=radiogroup]", el);
    if (group && shown(group)) { out.push({ ...choiceGroup(group), title, detail }); return; }
    if (!controls.length) { out.push({ kind: "text", style: "row", title, detail, value: value ? clean(value.textContent) || undefined : undefined }); return; }
    if (controls.length === 1) { out.push(controlItem(controls[0], { title, detail })); return; }
    // Several controls in one row (for example Auto plus a color well).
    out.push({ kind: "text", style: "row", title, detail });
    for (const control of controls) out.push(controlItem(control));
  }

  function layerCard(el) {
    const toggle = $(".csp-switch input", el), range = $(".csp-layer-range", el), title = $(".csp-layer-name", el);
    // The title and pencil are the same action. Keep one menu entry, and no
    // edit entry on a compact card inside the editor that is already open.
    const actionButtons = $$(".csp-layer-tools button", el);
    if (!actionButtons.some(button => button.dataset.action === "edit") &&
        !el.classList.contains("csp-layer-compact") && title?.matches("button")) actionButtons.push(title);
    const actions = actionButtons.map(button => ({
      ref: refOf(button), action: button.dataset.action || "", title: clean(button.getAttribute("aria-label") || button.title || button.textContent),
      disabled: button.disabled || undefined }));
    return { kind: "layer", ref: refOf(el), id: el.dataset.layerId, title: clean(title?.textContent), detail: clean($(".csp-layer-meta", el)?.textContent) || undefined,
      locked: el.classList.contains("csp-layer-locked") || undefined,
      edit: title?.matches("button") && !el.classList.contains("csp-layer-compact") ? {ref: refOf(title)} : undefined,
      toggle: toggle ? { ref: refOf(toggle), value: toggle.checked, disabled: toggle.disabled || undefined } : undefined,
      opacity: range ? { ref: refOf(range), value: Number(range.value), display: clean($(".csp-layer-opacity output", el)?.textContent) } : undefined,
      actions };
  }

  /* Markup layers: a colored dot, a name, a switch and a row of actions, or
     a confirmation in their place. */
  function markupCard(el) {
    const toggle = $(".csp-switch input", el), confirm = $(".mk-confirm", el);
    const buttons = $$(".mk-actions button", el).filter(shown);
    return { kind: "layer", ref: refOf(el), id: "markup:" + (el.dataset.id || ""), title: clean($(".mk-layer-title", el)?.textContent),
      detail: clean($(".mk-layer-meta", el)?.textContent) || undefined, color: colorOf($(".mk-dot", el) || el),
      rename: $(".mk-layer-title", el) ? refOf($(".mk-layer-title", el)) : undefined,
      active: el.classList.contains("mk-active") || undefined,
      toggle: toggle ? { ref: refOf(toggle), value: toggle.checked, disabled: toggle.disabled || undefined } : undefined,
      confirm: confirm ? clean($("p", confirm)?.textContent) : undefined,
      buttons: buttons.map(button => controlItem(button)) };
  }

  function overlayRow(el) {
    const input = $("input[type=checkbox]", el);
    return { kind: "toggle", ref: input ? refOf(input) : refOf(el), title: clean($(".nm", el)?.textContent) || labelFor(input),
      detail: clean($(".via", el)?.textContent) || undefined, badge: clean($(".nc", el)?.textContent) || undefined,
      color: $(".sw", el) ? colorOf($(".sw", el)) : undefined, value: !!input?.checked, disabled: !!input?.disabled || el.classList.contains("dead") || undefined };
  }

  function sceneItem(el) {
    const img = $("img.thumb", el);
    return { kind: "scene", ref: refOf(el), title: clean($(".ttl", el)?.textContent), detail: clean($(".dt", el)?.textContent),
      tags: $$(".tag", el).map(tag => ({ title: clean(tag.textContent), style: [...tag.classList].filter(c => c !== "tag").join(" ") || undefined })),
      src: img && img.style.visibility !== "hidden" && /^https?:|^data:/.test(img.src) ? img.src : undefined, selected: el.classList.contains("sel") || undefined };
  }

  /* ------------------------------------------------------ LiDAR studio */
  /* Each preset is an option holding its button and, for a saved preset
     only, the delete button beside it. */
  function looksItem(el) {
    return { kind: "looks", ref: refOf(el), title: clean(el.getAttribute("aria-label")) || "Presets",
      options: $$(".ls-look", el).map(look => {
        const remove = $("[data-remove-look]", look.closest(".ls-preset-option") || look);
        return { ref: refOf(look), title: clean($(".ls-look-name", look)?.textContent), selected: look.getAttribute("aria-checked") === "true",
          src: $("canvas", look) ? pictureOf($("canvas", look)) : undefined, remove: remove ? refOf(remove) : undefined };
      }) };
  }
  function palettesItem(el) {
    return { kind: "palettes", ref: refOf(el), title: clean(el.getAttribute("aria-label")) || "Palette",
      options: $$("[data-palette]", el).map(chip => ({ ref: refOf(chip), title: clean($(".ls-palette-name", chip)?.textContent),
        stops: gradientOf($(".ls-palette-bar", chip)), selected: chip.getAttribute("aria-checked") === "true" })) };
  }
  function lidarLayer(el, out) {
    const eye = $(".ls-eye", el), main = $(".ls-layer-main", el), editor = $(".ls-editor", el);
    const items = [];
    if (editor && shown(editor)) walk(editor, items);
    out.push({ kind: "lidarLayer", ref: main ? refOf(main) : refOf(el), title: clean($(".ls-layer-name", el)?.textContent),
      detail: clean($(".ls-layer-meta", el)?.textContent) || undefined, stops: gradientOf($("[data-swatch]", el)),
      visible: eye ? eye.getAttribute("aria-pressed") === "true" : true, eye: eye ? refOf(eye) : undefined,
      open: el.classList.contains("is-open"), items });
  }
  function rampItem(el) {
    const bar = $(".ls-ramp", el), color = $(".ls-colour input[type=color]", el), remove = $(".ls-stop-controls .ls-pill", el);
    const position = $(".ls-stop-position", el);
    return { kind: "ramp", ref: bar ? refOf(bar) : refOf(el), title: "Colors", stops: gradientOf(bar),
      handles: $$(".ls-stop", el).map(stop => ({ ref: refOf(stop), at: (parseFloat(stop.style.left) || 0) / 100,
        color: toHex(stop.style.getPropertyValue("--stop")) || "#000000", selected: stop.classList.contains("is-selected") })),
      well: color ? { ref: refOf(color), value: color.value } : undefined,
      position: position ? clean(position.textContent) : undefined,
      remove: remove ? { ref: refOf(remove), disabled: remove.disabled || undefined } : undefined };
  }
  /* The two sun sliders are one dial in the app. */
  function sunItem() {
    const az = $("#terSunAz"), alt = $("#terSunAlt");
    if (!az || !alt) return null;
    const slider = input => controlItem(input, { output: $(`output[for="${input.id}"]`) });
    return { kind: "sun", ref: refOf(az), title: "Sun", azimuth: slider(az), altitude: slider(alt) };
  }

  function walk(root, out) {
    for (const el of root.children) {
      if (!shown(el)) continue;
      if (handle(el, out)) continue;
      walk(el, out);
    }
  }

  /* How each kind of web element is described, in order of precedence. A
     describer that returns false lets the element fall to the next match;
     anything matching none is read as text or walked into. */
  const skip = () => true;
  function menuSection(el, out) {
    const heading = $(":scope > .csp-section-label", el), card = $(":scope > .csp-menu-card", el), items = [];
    if (card) walk(card, items);
    out.push({kind: "group", ref: refOf(el), title: clean(heading?.textContent), items});
  }
  function pane(el, out) {
    const head = $(":scope > .pane-h", el), title = head && $(".pane-t", head), toggle = head && $(".pane-x", head);
    const body = $(":scope > .pane-b", el), open = !el.classList.contains("min");
    const items = [];
    if (open && body && shown(body)) walk(body, items);
    if (title && shown(head)) out.push({ kind: "group", ref: refOf(toggle || head), pane: true, title: clean(title.textContent),
      detail: clean($(".pane-n", head)?.textContent) || undefined, open, items });
    else out.push(...items);
  }
  function detailsGroup(el, out) {
    const summary = $(":scope > summary", el);
    const items = [];
    const disclosure = el.matches(DISCLOSURES) || undefined;
    const description = summary && $(".terrain-disclosure-description", summary);
    if (el.open) for (const child of el.children) if (child !== summary && shown(child) && !handle(child, items)) walk(child, items);
    /* A button in the summary (Elevation highlights' Reset) acts on the
       whole section, so it ends the section's rows. */
    if (summary) for (const button of $$("button", summary).filter(shown)) items.push(controlItem(button));
    const swatch = summary && $(".ls-swatch", summary);
    out.push({ kind: "group", ref: refOf(el), title: summary ? textWithout(summary, ".pane-n,button,.ls-disclosure-value,.ls-preset-status,.ls-swatch,.terrain-disclosure-description") : "",
      detail: summary ? clean((description || $(".pane-n,.ls-disclosure-value,.ls-preset-status", summary))?.textContent) || undefined : undefined,
      stops: swatch ? gradientOf(swatch) : undefined, open: el.open, disclosure, items });
  }
  function header(el, out) {
    const count = $(".pane-n", el);
    out.push({ kind: "header", title: count ? textWithout(el, ".pane-n") : clean(el.textContent), detail: count ? clean(count.textContent) || undefined : undefined });
  }
  function sceneSearch(el, out) {
    const input = $("#cspSatQuery", el);
    out.push({ kind: "scenesearch", ref: input ? refOf(input) : refOf(el), placeholder: input?.placeholder, value: input?.value || undefined });
    const note = $("#cspSatNote", el);
    if (note && shown(note)) out.push({ kind: "text", style: "status", title: clean(note.textContent) });
    for (const child of $(".csp-sat-card", el)?.children || []) {
      if (child.matches("form,.csp-sat-filters,#cspSatNote") || !shown(child)) continue;
      if (!handle(child, out)) walk(child, out);
    }
    const filters = $(".csp-sat-filters", el);
    if (filters && shown(filters)) walk(filters, out);
  }
  /* The web puts Save current in the card's heading. In the app's list it
     follows the presets it would add to. */
  function presetCard(el, out) {
    const items = [];
    for (const child of el.children) if (shown(child) && !handle(child, items)) walk(child, items);
    const save = $(".ls-save-look", el), at = save ? items.findIndex(item => item.ref === refOf(save)) : -1;
    if (at >= 0) {
      const [action] = items.splice(at, 1), looks = items.findIndex(item => item.kind === "looks");
      items.splice(looks + 1, 0, action);
    }
    out.push(...items);
  }
  function lidarField(el, out) {
    const label = $(".ls-field-label", el), control = $$(CONTROLS, el).find(shown);
    if (!label || !control || control.matches("input[type=number]")) return false;
    out.push(controlItem(control, { title: clean(label.textContent) }));
  }
  function choiceLabel(el, out) {
    const input = $("input[type=checkbox],input[type=radio]", el);
    if (!input) return false;
    // A caption in its own element ("Map info" / "Coordinates, elevation…")
    // is a title and a detail. Reading the label as one string joins them
    // with no space, because the markup puts none between the two.
    const readout = $(".snapshot-readout-text", el);
    const caption = $("small", el);
    if (readout || caption) {
      const titleEl = readout ? readout.querySelector(":scope > span") : null;
      const title = clean(titleEl?.textContent) || textWithout(el, CONTROLS + ",.csp-switch,small") || labelFor(input);
      const detail = clean((readout ? $("small", readout) : caption)?.textContent) || undefined;
      out.push(controlItem(input, { title, detail: detail && detail !== title ? detail : undefined }));
      return;
    }
    out.push(controlItem(input, { title: textWithout(el, CONTROLS + ",.csp-switch") || labelFor(input) }));
  }
  function sliderField(el, out) {
    const range = $("input[type=range]", el);
    if (range) {
      if (range.id === "terSunAlt") return;
      if (range.id === "terSunAz") { const item = sunItem(); if (item) { out.push(item); return; } }
      /* A slider and the number field beside it set one value; the app
         shows them as one row, each still driving its own web input. */
      const head = $(".elev-label-row", el), entry = $$("input[type=number]", el).find(shown);
      const slider = controlItem(range, { title: head ? textWithout(head, "output,.elev-value," + CONTROLS) : entry ? labelFor(entry) : labelFor(range),
        output: $("output", el) || $(".elev-value", el) });
      if (entry) slider.entry = { ref: refOf(entry), value: entry.value, unit: unitOf(entry) || $("select", el)?.value || undefined,
        disabled: entry.disabled || undefined };
      out.push(slider);
      for (const extra of $$(CONTROLS, el).filter(c => c !== range && c !== entry && shown(c))) out.push(controlItem(extra));
      const hint = $$(".control-hint", el).find(h => !h.matches("label") && shown(h));
      if (hint) out.push({ kind: "text", style: "hint", title: clean(hint.textContent) });
      return;
    }
    const threshold = $(".elev-threshold-row", el);
    const number = threshold && $("input[type=number]", threshold), color = threshold && $("input[type=color]", threshold);
    if (!number || !color) return false;
    out.push({ ...controlItem(number), title: labelFor(number), well: { ref: refOf(color), value: color.value, title: labelFor(color) } });
  }
  function spectrum(el, out) {
    const bar = el.matches(".elevRamp") ? el : $(".elevRamp", el), stops = gradientOf(bar);
    if (stops) out.push({ kind: "gradient", ref: bar.id ? "#" + bar.id : undefined, stops,
      labels: $$(".elevKey span", el).map(span => clean(span.textContent)).filter(Boolean) });
  }
  function lineOpacity(el, out) {
    const range = $("input[type=range]", el);
    if (range) out.push(controlItem(range, { title: textWithout($(".ov-line-label", el) || el, "output," + CONTROLS) || "Opacity", output: $("output", el) }));
  }
  function choices(el, out) {
    if (!$$("[role=radio],button[aria-pressed]", el).some(shown)) return false;
    out.push(choiceGroup(el));
  }
  function listbox(el, out) {
    for (const option of $$("[role=option]", el).filter(shown)) out.push({ kind: "button", ref: refOf(option), role: "option", title: clean(option.textContent) });
  }
  function formControl(el, out) {
    if (!el.matches("input[type=hidden]")) out.push(controlItem(el));
  }
  function image(el, out) {
    if (!/icons\//.test(el.getAttribute("src") || "") && el.naturalWidth > 32) out.push({ kind: "image", src: el.src, title: el.alt || undefined, aspect: el.naturalWidth / Math.max(1, el.naturalHeight) });
  }
  function canvas(el, out) {
    const src = pictureOf(el);
    if (src) out.push({ kind: "image", src, aspect: el.width / el.height, ref: refOf(el) });
  }
  function pair(el, out) {
    if (!$(".fk", el) || !$(".fv", el)) return false;
    out.push({ kind: "text", style: "pair", title: clean($(".fk", el).textContent), value: clean($(".fv", el).textContent) });
  }
  const DESCRIBERS = [
    ["script,style,template", skip],
    [".csp-menu-section", menuSection],
    [".pane", pane],
    ["details", detailsGroup],
    [".csp-section-label,.menu-section-title,.ovgrp,h1,h2,h3,h4", header],
    [".csp-sat-search", sceneSearch],
    [".ls-looks", (el, out) => { out.push(looksItem(el)); }],
    [".ls-preset-card", presetCard],
    // The preset strip scrolls natively; its previous/next buttons are web-only.
    [".ls-preset-navigation", skip],
    // The picker below carries the terrain card's field label as its title.
    ["#terLidar .terrain-fields > label[for]", skip],
    [".sun-dial", (el, out) => { const item = sunItem(); if (item) out.push(item); }],
    [".ls-palettes", (el, out) => { out.push(palettesItem(el)); }],
    [".ls-layer", lidarLayer],
    [".ls-ramp-wrap", (el, out) => { out.push(rampItem(el)); }],
    [".ls-field:not(.ls-field-wide)", lidarField],
    [".csp-setting-row,.csp-field-row", row],
    [".mk-layer", (el, out) => { out.push(markupCard(el)); }],
    ["label", choiceLabel],
    [".elev-field,.ls-slider", sliderField],
    [".unit-suffix", skip],
    [".elev-spectrum-scale,.elevRamp", spectrum],
    [".ovrow", (el, out) => { out.push(overlayRow(el)); }],
    [".ov-line-control", lineOpacity],
    [".csp-layer-card", (el, out) => { out.push(layerCard(el)); }],
    [".item[data-i]", (el, out) => { out.push(sceneItem(el)); }],
    [".grp[data-g]", (el, out) => { out.push({ kind: "button", ref: refOf(el), role: "group", title: textWithout(el, ".car"), detail: clean($(".car", el)?.textContent) || undefined }); }],
    [".csp-available-row", (el, out) => {
      out.push({ kind: "button", ref: refOf(el), role: "navigate", title: clean($("strong", el)?.textContent), detail: clean($("span", el)?.textContent) || undefined,
        icon: undefined, disabled: el.disabled || undefined });
    }],
    ["[role=radiogroup],[role=group]", choices],
    ["[role=listbox]", listbox],
    ["input,select,textarea,button,a[href],[role=button],[role=slider]", formControl],
    ["img", image],
    ["canvas", canvas],
    ["svg", skip],
    [".fr", pair],
    ["progress", (el, out) => { out.push({ kind: "progress", value: el.max ? Number(el.value) / Number(el.max) : undefined }); }]
  ];

  function handle(el, out) {
    for (const [selector, describe] of DESCRIBERS)
      if (el.matches(selector) && describe(el, out) !== false) return true;
    if (el.querySelector(FORM + ",details,canvas,progress,img:not([src*='icons/'])")) return false;
    if (el.querySelector("a[href]")) {
      const markdown = tidyMarkdown(markdownOf(el));
      if (markdown) out.push({ kind: "text", ref: el.id ? "#" + el.id : undefined, title: clean(el.textContent), markdown, style: textStyle(el) });
      return true;
    }
    const text = clean(el.innerText);
    if (text) out.push({ kind: "text", ref: el.id ? "#" + el.id : undefined, title: text, style: textStyle(el) });
    return true;
  }

  function textStyle(el) {
    const classes = typeof el.className === "string" ? el.className : "";
    if (/\b(err|warn)\b/.test(classes) || el.querySelector(".err,.warn") || el.dataset.state === "partial") return "warning";
    if (/\bok\b/.test(classes) || el.querySelector(".ok")) return "success";
    if (el.getAttribute("role") === "status" || el.id === "status" || /\b(status|warmmsg)\b/.test(classes)) return "status";
    if (/hint|note|meta|via|empty|foot|blurb|sr-only/.test(classes) || el.tagName === "SMALL") return "hint";
    return "body";
  }

  function describeRoot(root) {
    const items = [];
    if (root && shown(root)) walk(root, items);
    else if (root) for (const child of root.children) if (shown(child) && !handle(child, items)) walk(child, items);
    return items;
  }

  /* The app groups a page's sections into its own list, so the web sections
     behind it are kept open: every row is described and none waits on a tap.
     Opening one only syncs its label and remembers it is open
     (ui-system.js, lidar-studio.js); nothing loads. The LiDAR page's own
     disclosures stay disclosures in the app, open or closed as on the web. */
  const DISCLOSURES = "#terLayerSettings,#terDataOffline,.ls-customize";
  const openSections = root => {
    if (root) for (const details of $$("details:not([open])", root)) if (!details.matches(DISCLOSURES)) details.open = true;
  };

  function describePage() {
    const shell = window.CSPShell;
    const description = $("#cspWorkspaceDescription"), scroll = $("#cspWorkspaceScroll");
    openSections(scroll);
    return {
      route: shell?.current?.() || "",
      title: clean($("#cspWorkspaceTitle")?.textContent),
      description: description?.hidden ? "" : clean(description?.textContent),
      items: describeRoot(scroll)
    };
  }

  /* Pop-ups the app presents natively. Each keeps its web element as the
     source of truth; closing the native sheet closes the web pop-up. */
  const PANELS = {
    snapshotPanel: { body: ".snapshot-export-body", close: "#snapshotClose" },
    serverPanel: { body: "#srvBox", close: "#srvClose" },
    terrainSourcePanel: { body: "#terrainSourcePanelBody", close: "#terrainSourceClose" },
    ctl: { body: "#ctlBody", close: "#ctlCollapse", title: "Displayed on map" }
  };
  const openPanel = () => Object.keys(PANELS).find(id => { const el = document.getElementById(id); return el && !el.hidden; }) || null;

  // Toolbar panels use task-sized native cards rather than a literal walk of
  // desktop form layout. All controls still refer to their original elements.
  const panelControl = (selector, context) => {
    const el = $(selector);
    return el ? controlItem(el, context) : null;
  };
  const panelGroup = (ref, title, items, detail) => ({
    kind: "group", ref, title, detail, items: items.filter(Boolean)
  });
  function imageryPanelItems() {
    const items = [];
    const status = clean($("#mosStat")?.textContent);
    if (status) items.push({kind: "text", style: "status", title: status});
    const actions = [
      panelControl("#ctlReset", {title: "Reset opacity"}),
      panelControl("#fillNow", {title: "Fill surroundings", detail: "Load neighbouring scenes for this view once."}),
      panelControl("#clr", {title: "Clear imagery"})
    ].filter(item => {
      const el = item && elementFor(item.ref);
      return el && !el.hidden && getComputedStyle(el).display !== "none";
    });
    for (const item of actions) {
      item.role = item.ref === "#clr" ? "destructive" : "utility";
      if (item.ref === "#ctlReset") item.icon = "rotate-ccw";
      if (item.ref === "#clr") item.icon = "trash";
    }
    if (actions.length) items.push({kind: "actionmenu", title: "Imagery actions", items: actions});
    const links = $("#ctlLink");
    if (clean(links?.textContent)) items.push({kind: "text", style: "hint", title: clean(links.textContent), markdown: tidyMarkdown(markdownOf(links))});
    return items;
  }

  function describePanel(id) {
    const spec = PANELS[id], el = document.getElementById(id);
    if (!spec || !el || el.hidden) return null;
    const body = $(spec.body, el);
    const items = [];
    if (id === "ctl") {
      items.push({ kind: "text", style: "row", title: clean($("#ctlName")?.textContent), detail: clean($("#ctlDate")?.textContent) || undefined });
    }
    if (id === "snapshotPanel") {
      const resolution = panelControl("#snapshotScale", {title: "Resolution"});
      if (resolution) resolution.options.forEach(option => { option.title = `${option.value}×`; });
      const metadata = clean($("#snapshotMeta")?.textContent);
      items.push(panelGroup("export:settings", "Image settings", [
        resolution,
        metadata ? {kind: "text", style: "status", title: metadata} : null,
        panelControl("#snapshotReadout", {title: "Include map info", detail: "Coordinates, elevation and color keys"})
      ]));
      items.push({kind: "text", style: "hint", title: "Higher resolutions request finer source tiles where available. Enlarging a source adds no new detail."});
      const capture = panelControl("#snapshotCapture", {title: "Capture view", detail: "Save the whole map view."});
      const select = panelControl("#snapshotSelect", {title: "Select area", detail: "Draw a rectangle on the map to save."});
      if (capture) capture.icon = "camera";
      if (select) select.icon = "scan";
      items.push({kind: "actions", items: [select, capture].filter(Boolean)});
    } else if (id === "serverPanel") {
      items.push({kind: "text", style: "hint", title: "Connect to your Mac for its terrain cache and processing. The engine is optional; public map sources work without it."});
      const address = panelControl("#srvUrl", {title: "Engine address"});
      if (address) address.detail = "Use the Tailscale HTTPS address from your Mac.";
      const metadata = clean($("#srvMeta")?.textContent);
      items.push(panelGroup("engine:connection", "Connection", [
        address,
        metadata ? {kind: "text", style: $("#srvMeta")?.classList.contains("warn") ? "warning" : "status", title: metadata} : null
      ]));
      const copy = panelControl("#srvCopyLink", {title: "Copy engine address"});
      const forget = panelControl("#srvForget", {title: "Forget saved address", detail: "Remove the connection saved on this device."});
      if (copy) { copy.role = "utility"; copy.icon = "copy"; }
      if (forget) {
        forget.role = "destructive"; forget.icon = "trash";
        forget.confirm = "Forget the saved engine address? You can reconnect by entering it again.";
      }
      items.push(panelGroup("engine:saved", "Saved address", [copy, forget]));
      const connect = panelControl("#srvConnect");
      if (connect) { connect.role = "primary"; items.push({kind: "actions", items: [connect]}); }
    } else if (id === "terrainSourcePanel" && body) {
      const status = $(".terrain-source-panel-status", body);
      if (status && !status.hidden) items.push({kind: "text", title: clean(status.textContent), style: "status"});
      for (const row of $$(".terrain-source-panel-row", body)) {
        const controls = $$("label.tsp-control", row).map(label => controlItem($("input", label),
          {title: clean($("span", label)?.textContent), output: $("output", label)}));
        const name = $(".terrain-source-panel-name", row);
        const detail = clean($(".terrain-source-panel-meta", row)?.textContent);
        if (row.dataset.id === "scene") controls.push(...imageryPanelItems());
        items.push({kind: "source", ref: "source:" + row.dataset.id, id: row.dataset.id,
          title: clean(name?.textContent), detail, items: controls,
          edit: name?.matches("button") ? {ref: refOf(name), title: "Edit layer"} : undefined});
      }
      // Zero opacity hides the web's active row, but its controls must remain
      // reachable after removing the redundant imagery button from this dock.
      if (!$(".terrain-source-panel-row[data-id=scene]", body) && $("#mapInfoToggle")?.hidden === false) {
        const opacity = panelControl("#op", {title: "Opacity"});
        if (opacity) opacity.display = `${opacity.value}%`;
        items.unshift({kind: "source", ref: "source:scene", id: "scene", title: clean($("#ctlName")?.textContent),
          detail: clean($("#ctlDate")?.textContent), items: [opacity, ...imageryPanelItems()].filter(Boolean)});
      }
      if (!items.some(item => item.kind === "source")) {
        const empty = clean($(".tsp-rows", body)?.textContent);
        if (empty) items.push({kind: "text", style: "hint", title: empty});
      }
      const references = $("#mapSourceReferences", body);
      const notes = $$(".terrain-source-panel-note", body).filter(el => el !== references)
        .map(note => ({kind: "text", style: "hint", title: clean(note.textContent)}));
      if (references && clean(references.textContent)) notes.push({kind: "text", title: clean(references.textContent), markdown: tidyMarkdown(markdownOf(references))});
      if (notes.length) items.push({kind: "disclosure", ref: "sources:references", title: "Sources & attribution", items: notes});
    } else     if (body) for (const child of body.children) if (!handle(child, items)) walk(child, items);
    return { id, title: id === "serverPanel" ? "Terrain engine" : spec.title || clean($(".tool-popover-title", el)?.textContent), state: id === "terrainSourcePanel" ? undefined : clean($(".tool-popover-state", el)?.textContent) || undefined, items };
  }

  /* ------------------------------------------------------------- state */
  function counts() {
    const result = {};
    for (const badge of $$(".csp-nav-count[data-count]")) { const text = clean(badge.textContent); if (text) result[badge.dataset.count] = text; }
    return result;
  }

  function searchState() {
    const state = bridge()?.searchState?.() || { version: 0, label: "", coordinates: null };
    const copy = $("#coordCopy"), open = $("#coordOpen");
    const available = !!copy && !copy.disabled;
    return {
      version: state.version || 0,
      label: state.label || "",
      lat: state.coordinates?.lat ?? undefined, lng: state.coordinates?.lng ?? undefined,
      query: $("#q")?.value || "",
      canCopy: available,
      coordinates: available ? clean((copy.title || "").replace(/^Copy\s+/, "")) : "",
      mapsURL: open && !open.disabled ? $("#coordGoogleMaps")?.href || "" : "",
      earthURL: open && !open.disabled ? $("#coordGoogleEarth")?.href || "" : "",
      canClear: !!$("#qClear") && !$("#qClear").hidden
    };
  }

  const currentMode = () => $("#terModePoints")?.getAttribute("aria-pressed") === "true" ? "points"
    : $("#terMode3d")?.getAttribute("aria-pressed") === "true" ? "3d" : "2d";
  let bearing = 0;
  function mapState() {
    const body = document.body;
    const visible = id => { const el = document.getElementById(id); return !!el && !el.hidden; };
    return {
      mode: currentMode(),
      theme: document.documentElement.dataset.uiTheme || "",
      pointCloud: body.classList.contains("point-cloud-open"),
      terrain3d: body.classList.contains("terrain-3d"),
      selecting: body.classList.contains("dnr-selecting") || visible("snapSel") || visible("dnrSelectionBar"),
      drawing: visible("mkBar"),
      bearing: Math.round(bearing * 10) / 10
    };
  }

  function appearanceState() {
    const settings = window.CSPShell?.appearance?.();
    if (settings) return settings;
    const root=document.documentElement, style=root.style;
    return {toggle:style.getPropertyValue("--csp-control-on").trim()||null,
      track:style.getPropertyValue("--csp-slider-track").trim()||null,
      button:style.getPropertyValue("--ui-accent").trim()||null,
      fontColor:style.getPropertyValue("--ui-text").trim()||null,
      font:$("[data-font-select]")?.value||"system",
      textSize:Number(style.getPropertyValue("--csp-text-zoom"))||1};
  }

  function dockState() {
    return $$("#mapDock > .map-tool").map(button => ({
      ref: refOf(button), id: button.id, tool: button.dataset.tool || button.id,
      title: clean(button.getAttribute("aria-label") || button.title),
      hidden: button.hidden || button.dataset.tool === "scene" || undefined, disabled: button.disabled || undefined,
      pressed: button.getAttribute("aria-pressed") === "true" || button.classList.contains("active") || undefined,
      expanded: button.getAttribute("aria-expanded") === "true" || undefined,
      dot: button.id === "serverToggle" ? ($("#srvDot")?.classList.contains("on") ? "on" : "off") : undefined
    }));
  }

  function statusState() {
    const terrain = $("#terrainLoadStatus"), message = $("#status"), snapshot = $("#snapshotStatus");
    const readout = bridge()?.mapReadoutState?.();
    return {
      mapInfo: readout ? { ...readout, keys: $$("#mapReadout .map-colour-key").map(key => ({
        name: clean($(".key-name", key)?.textContent),
        stops: gradientOf($(".key-ramp", key)),
        labels: $$(".key-ticks span", key).map(el => clean(el.textContent)),
        swatches: $$(".key-swatch", key).map(el => ({ label: clean(el.textContent), src: $("img", el)?.src || "" }))
      })) } : null,
      terrain: terrain && !terrain.hidden && clean(terrain.textContent) ? { state: terrain.dataset.state || "", text: clean(terrain.textContent) } : null,
      message: message ? { kind: message.dataset.kind || "", text: clean(message.textContent), error: !!$(".err", message) } : null,
      snapshot: snapshot && clean(snapshot.textContent) ? clean(snapshot.textContent) : null,
      engine: { online: !!$("#srvDot")?.classList.contains("on"), state: clean($("#srvState")?.textContent) }
    };
  }

  /* --------------------------------------------------------- publishing
     The app says what it shows; only that is described. The route page is
     not walked while the sheet is closed, nor a pop-up while it is not
     presented, so map gestures never wait on a description. */
  const view = { sheet: "closed", page: null, panel: null };
  const last = {};
  let timer = 0, forceNext = false;
  function publish() {
    timer = 0;
    activeImages.clear();
    const force = forceNext;
    forceNext = false;
    const update = {};
    const offer = (key, value) => {
      const json = JSON.stringify(value);
      if (force || json !== last[key]) { last[key] = json; update[key] = value; }
    };
    offer("route", window.CSPShell?.current?.() || "");
    offer("counts", counts());
    offer("search", searchState());
    offer("map", mapState());
    offer("appearance", appearanceState());
    if (bridge()?.sessionState) offer("session", bridge().sessionState());
    offer("dock", dockState());
    offer("status", statusState());
    offer("panelOpen", openPanel());
    if (view.sheet !== "closed" && view.page) offer("page", describePage());
    if (view.panel) offer("panel", describePanel(view.panel));
    for (const key of imageAssets.keys()) if (!activeImages.has(key)) { imageAssets.delete(key); changedImages.delete(key); }
    // Pictures travel once, separately from frequently changing control values.
    // Retain only the assets referenced by the currently presented page/panel.
    offer("imageKeys", [...activeImages]);
    if (force || changedImages.size) update.images = Object.fromEntries(force ? imageAssets : changedImages);
    changedImages.clear();
    if (Object.keys(update).length) send(update);
  }
  const schedule = (delay = 60) => { if (!timer) timer = setTimeout(publish, delay); };
  const flush = () => { clearTimeout(timer); timer = 0; publish(); };

  /* -------------------------------------------------------------- acting */
  const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));
  const key = (el, name, shift = false) => el.dispatchEvent(new KeyboardEvent("keydown", { key: name, shiftKey: shift, bubbles: true, cancelable: true }));
  function act(ref, op, value) {
    const el = elementFor(ref);
    if (!el || el.matches(":disabled") || el.getAttribute("aria-disabled") === "true") { schedule(0); return false; }
    if (op === "select" && el.matches("select") && ![...el.options].some(option => option.value === String(value) && !option.disabled && !option.closest("optgroup[disabled]"))) return false;
    const routeBefore = window.CSPShell?.current?.();
    const editsLayer = el.matches(".csp-layer-title,[data-action=edit]");
    const fromPanel = !!view.panel;
    switch (op) {
      case "toggle":
        if (el.checked !== !!value) el.click();
        break;
      case "input":
        el.value = String(value);
        fire(el, "input");
        break;
      case "commit":
        if (value !== undefined && value !== null) { el.value = String(value); fire(el, "input"); }
        fire(el, "change");
        break;
      case "select":
        el.value = String(value);
        fire(el, "input");
        fire(el, "change");
        break;
      case "open":
        if (el.matches("details")) el.open = !!value;
        else if (el.matches(".pane-x,.pane-h")) { const pane = el.closest(".pane"); if (pane && pane.classList.contains("min") === !!value) el.click(); }
        else el.click();
        break;
      case "focus":
        el.focus({ preventScroll: true });
        break;
      case "rampAdd": {
        /* The bar adds a stop where it is pressed, with the color shown there. */
        const rect = el.getBoundingClientRect(), x = rect.left + Math.max(0, Math.min(1, Number(value))) * rect.width;
        el.dispatchEvent(new PointerEvent("pointerdown", { clientX: x, clientY: rect.top + rect.height / 2, bubbles: true, cancelable: true, pointerId: 1, isPrimary: true }));
        break;
      }
      case "rampMove": {
        /* Stops move with the bar's own arrow keys: one percent per step,
           ten with Shift. ArrowRight always moves a stop right as drawn,
           reversed palette or not, so the app works in drawn positions. */
        el.focus({ preventScroll: true });
        let steps = Math.round(Number(value) * 100) - Math.round(parseFloat(el.style.left) || 0);
        for (let guard = 0; steps !== 0 && guard < 120; guard++) {
          const target = document.activeElement?.closest?.(".ls-stop") || el;
          const big = Math.abs(steps) >= 10;
          key(target, steps > 0 ? "ArrowRight" : "ArrowLeft", big);
          steps -= Math.sign(steps) * (big ? 10 : 1);
        }
        break;
      }
      case "key":
        key(el, String(value));
        break;
      case "submit":
        if (el.form) el.form.requestSubmit(); else el.closest("form")?.requestSubmit();
        break;
      case "click":
      default:
        el.click();
    }
    const routeAfter = window.CSPShell?.current?.();
    // A toolbar popover is a different native sheet from the tool editor.
    // A route report alone cannot switch sheets (or reopen the same route).
    if (fromPanel && routeAfter && (routeAfter !== routeBefore || editsLayer)) send({openRoute: routeAfter});
    schedule(0);
    return true;
  }

  /* ------------------------------------------------------------- search */
  let places = [], suggestAbort = null, suggestionVersion = 0;
  const shell = window.CSPShell;
  window.CSPNativeShell = Object.freeze({
    /* {sheet:"closed"|"medium"|"large", page:route|null, panel:id|null} */
    setView(next) {
      Object.assign(view, next || {});
      forceNext = true;
      flush();
    },
    groups: () => shell?.groups?.() || [],
    open(route) {
      const opened = !!shell?.activate?.(route);
      view.page = route;
      flush();
      return opened;
    },
    refresh() { forceNext = true; flush(); },
    describe: () => describePage(),
    describePanel,
    act,
    async suggest(text) {
      suggestAbort?.abort();
      suggestAbort = new AbortController();
      const signal = suggestAbort.signal;
      try {
        const found = await bridge().placeSuggestions(text, signal) || [];
        if (signal.aborted) return null;
        places = found;
        const version = ++suggestionVersion;
        return found.map((place, index) => ({ index, version, primary: place.primary || "", secondary: place.secondary || "", kind: place.kind || "" }));
      } catch (error) {
        if (error?.name === "AbortError" || signal.aborted) return null;
        throw error;
      }
    },
    pick(index, version) {
      if (version !== suggestionVersion) return false;
      const place = places[index];
      if (!place) return false;
      bridge().searchPlace(place);
      schedule(0);
      return true;
    },
    routeMatches(text) {
      const query = String(text || "").trim().toLocaleLowerCase().replace(/\s+/g, " ");
      if (query.length < 2 || !shell?.keywords) return [];
      const found = new Map();
      for (const [keyword, route] of shell.keywords()) if (keyword.startsWith(query) || (query.length >= 3 && keyword.includes(query))) {
        if (!found.has(route)) found.set(route, keyword);
      }
      return [...found].map(([route, keyword]) => ({ route, keyword }));
    },
    submit(text) {
      const route = shell?.routeForText?.(text);
      if (route) return { route };
      bridge().searchText(text);
      schedule(0);
      return {};
    },
    searchText(text) { bridge().searchText(String(text || "")); schedule(0); },
    searchMapCenter() { bridge().searchMapCenter(); schedule(0); },
    searchSelected() { const searched = bridge().searchSelected(); schedule(0); return searched; },
    clear() { $("#qClear")?.click(); schedule(0); },
    locate() { $("#loc")?.click(); schedule(0); },
    copyCoordinates() { $("#coordCopy")?.click(); schedule(0); },
    centerSelected() {
      const point = bridge().searchState()?.coordinates;
      if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return false;
      const globe = bridge().map3d?.();
      if (globe) globe.jumpTo({ center: [point.lng, point.lat] });
      else bridge().map.setView([point.lat, point.lng], bridge().map.getZoom(), { animate: false });
      schedule(0);
      return true;
    },
    async bestImagery() {
      this.centerSelected();
      try { return await bridge().searchBestImagery(); }
      finally { schedule(0); }
    },
    moveTool(id, index) {
      const others = $$("#mapDock > .map-tool").filter(el => !el.hidden && el.id !== id);
      const native = others.filter(el => el.dataset.tool !== "scene");
      const target = native[Math.max(0, Math.min(native.length, index))];
      const moved = bridge().moveDockTool(id, target ? others.indexOf(target) : others.length);
      flush(); return moved;
    },
    setMode(mode) {
      const item = $(`#mapModeMenu [data-mode="${CSS.escape(String(mode))}"]`);
      if (item) item.click();
      schedule(0);
    },
    tool(id) {
      const button = document.getElementById(String(id));
      if (!button || !button.closest("#mapDock")) return false;
      button.click();
      flush();
      return true;
    },
    closePanel(id) {
      const spec = PANELS[id], el = document.getElementById(id);
      if (spec && el && !el.hidden) $(spec.close)?.click();
      if (view.panel === id) view.panel = null;
      schedule(0);
    },
    statusText: () => clean($("#status")?.textContent)
  });

  /* -------------------------------------------------------------- watching */
  const start = async () => {
    if (window.CSPNativeHost.resume) {
      try { await bridge()?.restoreSession?.(window.CSPNativeHost.resume); }
      catch (error) { console.warn("Map recovery could not restore 3D", error); }
    }
    // The web panel stays collapsed for good inside the app.
    if (!document.body.classList.contains("collapsed")) $("#sideToggle")?.click();
    // These controls have native equivalents. Moving them off screen keeps
    // layout available to the adapter; hide the duplicates from VoiceOver.
    for (const selector of ["#side", ...Object.keys(PANELS).map(id => "#" + id)])
      $(selector)?.setAttribute("aria-hidden", "true");
    const observer = new MutationObserver(records => {
      if (records.every(record => record.type === "attributes" && record.attributeName === REF)) return;
      schedule();
    });
    const watched = ["#side", "#mapDock", "#serverPanel", "#snapshotPanel", "#terrainSourcePanel", "#ctl", "#snapshotStatus", "#mapReadout"];
    for (const target of watched.map(selector => $(selector)).filter(Boolean))
      observer.observe(target, { subtree: true, childList: true, attributes: true, characterData: true });
    const flags = new MutationObserver(() => schedule());
    for (const target of ["#pointCloudPanel", "#mkBar", "#snapSel", "#dnrSelectionBar", "#mapModeMenu"].map(selector => $(selector)).filter(Boolean))
      flags.observe(target, { attributes: true, attributeFilter: ["hidden"] });
    flags.observe(document.body, { attributes: true, attributeFilter: ["class", "data-csp-route"] });
    flags.observe(document.documentElement, { attributes: true, attributeFilter: ["data-ui-theme"] });
    document.addEventListener("input", () => schedule(), true);
    document.addEventListener("change", () => schedule(), true);
    document.addEventListener("csp:appearance", () => schedule(0));
    document.addEventListener("csp:location", () => schedule(0));
    document.addEventListener("csp:layers-changed", () => schedule());
    document.addEventListener("csp:open-route", event => {
      const route = event.detail?.route || event.detail;
      if (typeof route === "string") send({ openRoute: route });
    });
    /* The compass follows the map. Rotation fires per frame; the app only
       needs the needle's angle a few times a second. */
    let bearingTimer = 0;
    const rotate = () => {
      const map = bridge()?.map, map3d = bridge()?.map3d?.();
      bearing = document.body.classList.contains("terrain-3d") && map3d ? map3d.getBearing() : (map?.getBearing?.() || 0);
      if (!bearingTimer) bearingTimer = setTimeout(() => { bearingTimer = 0; schedule(0); }, 80);
    };
    bridge()?.map?.on?.("rotate", rotate);
    bridge()?.map?.on?.("moveend", () => schedule(0));
    let watched3d = null;
    new MutationObserver(() => {
      const map3d = bridge()?.map3d?.();
      if (map3d && map3d !== watched3d) { watched3d = map3d; map3d.on("rotate", rotate); map3d.on("moveend", () => schedule(0)); }
      rotate();
    }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
    send({ groups: window.CSPNativeShell.groups(), ready: true });
    forceNext = true;
    flush();
    handler.postMessage({type: "ready"}).catch(() => {});
  };
  if (document.documentElement.classList.contains("csp-boot")) {
    document.documentElement.addEventListener("csp:ready", start, { once: true });
  } else {
    start();
  }
})();
