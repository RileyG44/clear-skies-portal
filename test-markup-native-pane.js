'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const markup = fs.readFileSync('markup.js', 'utf8');
// Exercise the actual map-dismissal listener: native map input retains tools,
// while the existing browser/Electron popover behavior stays intact.
const listener = markup.slice(markup.indexOf('mapEl.addEventListener("pointerdown",event=>{'), markup.indexOf('function setTool(next)'));
for (const native of [false, true]) {
  let callback, dismissed = 0;
  vm.runInNewContext(listener, {window:{CSPNativeHost:native ? {} : undefined},toolsOpen:true,
    mapEl:{addEventListener(_, fn){callback=fn}},setToolsOpen(){dismissed++}});
  callback({target:{closest:()=>null}});
  assert.equal(dismissed, native ? 0 : 1);
  callback({target:{closest:()=>({})}});
  assert.equal(dismissed, native ? 0 : 1, 'pane/dock touches never dismiss tools');
}

/* A small DOM for the toolbar markup paintBar and openPop write: enough HTML
   and selector support for the adapter's markup description. */
class Node {
  constructor(tag, attrs = {}) { this.tagName = tag.toUpperCase(); this.attrs = attrs; this.children = []; this.text = ''; this.parentElement = null; }
  get id() { return this.attrs.id || ''; }
  get hidden() { return 'hidden' in this.attrs; }
  get disabled() { return 'disabled' in this.attrs; }
  get classList() { const names = (this.attrs.class || '').split(/\s+/); return {contains: name => names.includes(name)}; }
  get dataset() {
    return Object.fromEntries(Object.entries(this.attrs).filter(([key]) => key.startsWith('data-'))
      .map(([key, value]) => [key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()), value]));
  }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
  get previousElementSibling() { const siblings = this.parentElement.children; return siblings[siblings.indexOf(this) - 1] || null; }
  get value() { return this.tagName === 'SELECT' ? (this.options.find(o => 'selected' in o.attrs) || this.options[0])?.attrs.value : this.attrs.value; }
  get options() { return this.all().filter(el => el.tagName === 'OPTION'); }
  get selectedOptions() { return this.options.filter(o => o.attrs.value === this.value); }
  getAttribute(name) { return name in this.attrs ? this.attrs[name] : null; }
  all() { return this.children.flatMap(child => [child, ...child.all()]); }
  matches(selector, scope) { return split(selector).some(part => matchComplex(this, part, scope)); }
  querySelectorAll(selector) { return this.all().filter(el => el.matches(selector, this)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
const split = selector => selector.split(/,(?![^(]*\))/).map(part => part.trim());
function matchCompound(el, compound, scope) {
  for (const [token] of compound.matchAll(/:scope|:not\([^)]*\)|\[[^\]]+\]|[.#]?[\w-]+|\*/g)) {
    if (token === '*') continue;
    if (token === ':scope') { if (el !== scope) return false; continue; }
    if (token.startsWith(':not(')) { if (matchCompound(el, token.slice(5, -1), scope)) return false; continue; }
    if (token[0] === '.') { if (!el.classList.contains(token.slice(1))) return false; continue; }
    if (token[0] === '#') { if (el.id !== token.slice(1)) return false; continue; }
    if (token[0] === '[') {
      const [, name, value] = token.match(/^\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]$/);
      if (!(name in el.attrs) || (value !== undefined && el.attrs[name] !== value)) return false;
      continue;
    }
    if (el.tagName !== token.toUpperCase()) return false;
  }
  return true;
}
function matchComplex(el, selector, scope) {
  const parts = selector.replace(/\s*>\s*/g, ' > ').split(/\s+/);
  const test = (node, index) => {
    if (!node || !matchCompound(node, parts[index], scope)) return false;
    if (index === 0) return true;
    if (parts[index - 1] === '>') return test(node.parentElement, index - 2);
    for (let up = node.parentElement; up; up = up.parentElement) if (test(up, index - 1)) return true;
    return false;
  };
  return test(el, parts.length - 1);
}
function parse(html) {
  const root = new Node('div'), stack = [root];
  for (const [, close, tag, attrs, text] of html.matchAll(/<(\/?)([a-z0-9]+)([^>]*)>|([^<]+)/gi)) {
    const top = stack[stack.length - 1];
    if (text !== undefined) { top.text += text.trim() ? text : ''; continue; }
    if (close) { stack.pop(); continue; }
    const node = new Node(tag, Object.fromEntries([...attrs.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(([, key, value]) => [key, value ?? ''])));
    node.parentElement = top; top.children.push(node);
    if (!/^(input|img|br)$/i.test(tag)) stack.push(node);
  }
  return root;
}

// The actual adapter code, with its shared describers reduced to what the
// markup pane reads from them.
const adapter = fs.readFileSync('ios/Resources/native-shell.js', 'utf8');
const describe = adapter.slice(adapter.indexOf('  const MARKUP_KINDS'), adapter.indexOf('  // Toolbar panels use task-sized'));
let refs = 0, document;
const refOf = el => el.attrs['data-cspn'] || (el.attrs['data-cspn'] = '@n' + ++refs);
const clean = text => String(text || '').replace(/\s+/g, ' ').trim();
const context = {
  $: (selector, root = document) => root.querySelector(selector), $$: (selector, root = document) => root.querySelectorAll(selector),
  refOf, clean, shown: el => !el.hidden,
  iconOf: el => el.querySelector('img')?.attrs.src?.match(/icons\/([a-z0-9-]+)\.svg/)?.[1],
  labelFor: el => clean(el.attrs['aria-label']), colorOf: el => (el.attrs.style || '').match(/--c:(#[0-9a-f]{6})/i)?.[1],
  controlItem: (el, extra = {}) => ({kind: el.tagName === 'INPUT' ? (el.attrs.type === 'range' ? 'slider' : 'field') : 'button', ref: refOf(el),
    title: extra.title ?? (clean(el.textContent) || clean(el.attrs['aria-label'])), disabled: el.disabled,
    pressed: 'aria-pressed' in el.attrs ? el.attrs['aria-pressed'] === 'true' : undefined}),
  handle: (el, out) => { out.push({kind: 'text', title: clean(el.textContent)}); return true; }, walk() {}
};
vm.runInNewContext(describe, context);
const tool = (id, label, on) => `<button class="mk-tool" data-tool="${id}"${id === 'shape' ? ' data-current-shape="ellipse"' : ''} aria-pressed="${on}" aria-label="${label}"><img src="vendor/icons/x.svg"><span class="mk-tool-label">${label}</span></button>`;
const toolbar = active => ['select', 'pan', 'pen', 'highlight', 'eraser', 'shape', 'text', 'pin'].map(id => tool(id, id[0].toUpperCase() + id.slice(1), id === active)).join('<span class="mk-sep"></span>');
const layer = `<div class="mk-context"><div class="mk-context-row"><span class="mk-dot" style="--c:#ff3b30"></span>
  <div class="mk-context-title"><button class="mk-context-text mk-layer-name" data-edit-detail="name">Field notes</button></div>
  <div class="mk-context-actions"><button class="mk-detail-button" data-act="edit-layer-details" aria-label="Edit layer details"></button>
  <label class="mk-layer-picker"><select aria-label="Active markup layer" data-layer-select><option value="route">Route ideas</option><option value="field" selected>Field notes</option></select></label></div></div>
  <button class="mk-context-text mk-layer-description" data-edit-detail="description">Moraine survey</button></div>`;
const footer = finish => `<div class="mk-footer"><div class="mk-history"><button class="mk-icon-btn" data-act="undo" aria-label="Undo"></button>
  <button class="mk-icon-btn" data-act="redo" aria-label="Redo" disabled></button></div><div class="mk-finish"><button class="mk-done" data-act="${finish}">x</button></div></div>`;
const describeBar = (bar, pop = '<div id="mkPop" hidden></div>') => {
  document = parse(`<div id="mkBar"><div class="mk-tools">${bar.tools}</div>${layer}<div class="mk-opts">${bar.opts}</div>${footer(bar.finish || 'done')}</div>${pop}`);
  const items = [];
  context.markupItems(items, document.querySelector('#mkBar'));
  return JSON.parse(JSON.stringify(items)); // plain objects from this realm
};

// Pen with its colour palette open: the palette belongs to the colour row.
let items = describeBar({tools: toolbar('pen'), opts: `<div class="mk-color-option"><span>Colour</span><button class="mk-chip" data-pop="color" style="--c:#ff3b30" aria-label="Colour" aria-expanded="true"><span></span></button></div>
  <div class="mk-slider mk-ground" data-ground="width" data-label="Width" data-feet="2.5" data-feet-min="0.1"><span>Width</span><input type="range" data-ground-range="width" min="0" max="1000" step="1" value="420" aria-label="Width"><button class="mk-value" data-edit-ground="width">2.5 ft</button></div>
  <label class="mk-slider"><span>Opacity</span><input type="range" data-style="opacity" min="5" max="100" value="80" aria-label="Opacity"><output>80%</output></label>`},
  `<div id="mkPop" data-kind="color"><div class="mk-pop-label">Colour</div><div class="mk-color-grid">${['#ff3b30', '#0a84ff'].map(c => `<button class="mk-swatch" data-pick="${c}" style="--c:${c}" aria-pressed="${c === '#ff3b30'}" aria-label="Colour ${c}"></button>`).join('')}</div><label class="mk-custom"><span>Custom colour</span><input type="color" value="#ff3b30"></label></div>`);
assert.deepEqual(items.map(item => item.kind), ['markupTools', 'markupHistory', 'markupFinish', 'group', 'markupLayer'], 'no pop-up group is placed above the tools');
const tools = items[0];
assert.equal(tools.options.length, 8, 'every tool is described at once');
assert.deepEqual(tools.options.filter(option => option.selected).map(option => option.value), ['pen']);
assert.equal(tools.value, 'ellipse', 'the Shapes tool shows the current shape');
assert.equal(items[1].title, 'Drag on the map to draw');
assert.deepEqual(items[1].buttons.map(button => [button.id, button.disabled]), [['undo', false], ['redo', true]]);
assert.equal(items[2].id, 'done');
const [colour, width, opacity] = items[3].items;
assert.equal(colour.kind, 'markupColor');
assert.equal(colour.color, '#ff3b30');
assert.equal(colour.expanded, true);
assert.deepEqual(colour.options.map(option => [option.color, option.selected]), [['#ff3b30', true], ['#0a84ff', false]]);
assert.equal(colour.custom.value, '#ff3b30');
assert.equal(width.kind, 'markupSize');
assert.equal(width.display, '2.5 ft');
assert.equal(width.edit.value, 2.5);
assert.equal(width.value, 420);
assert.equal(width.expanded, undefined);
assert.deepEqual([opacity.kind, opacity.title], ['slider', 'Opacity']);
assert.deepEqual([items[3].title, items[3].detail], ['Pen style', 'For new marks']);
assert.equal(width.id, 'width:new');
assert.equal(items[3].id, 'field:pen:new', 'style rows belong to one layer, tool and mark');
assert.equal(items[3].items.length, 3, 'each setting appears once, without separate label rows');
assert.deepEqual([items[4].title, items[4].detail, items[4].color, items[4].value], ['Field notes', 'Moraine survey', '#ff3b30', 'field']);
assert.deepEqual(items[4].options.map(option => option.title), ['Route ideas', 'Field notes']);

// A fill that follows the outline says so, and a shape's short web labels
// gain their noun as rows.
items = describeBar({tools: toolbar('shape'), opts: `<div class="mk-color-option"><span>Fill colour</span><button class="mk-chip" data-pop="fill" data-mode="auto" style="--c:#ff3b30" aria-label="Fill colour"></button></div>
  <label class="mk-slider"><span>Fill</span><input type="range" data-style="fillOpacity" min="0" max="100" value="18" aria-label="Fill"><output>18%</output></label>`});
assert.deepEqual(items[3].items.map(item => [item.kind, item.title]), [['markupColor', 'Fill colour'], ['slider', 'Fill opacity']]);
assert.equal(items[3].items[0].value, 'auto');
assert.equal(items[3].title, 'Shape style');

// The shape gallery opens with the Shapes tool, in its two web groups.
const shapeTools = toolbar('shape').replace('data-tool="shape"', 'data-tool="shape" aria-expanded="true"');
items = describeBar({tools: shapeTools, opts: ''}, `<div id="mkPop" data-kind="shape"><div class="mk-pop-label">Lines</div><div class="mk-shape-grid"><button class="mk-shape-btn" data-shape="line" aria-pressed="false" aria-label="Line"></button></div>
  <div class="mk-pop-label">Shapes</div><div class="mk-shape-grid"><button class="mk-shape-btn" data-shape="ellipse" aria-pressed="true" aria-label="Oval"></button><button class="mk-shape-btn" data-shape="star" aria-pressed="false" aria-label="Star"></button></div></div>`);
assert.equal(items[0].expanded, true);
assert.deepEqual(items[0].items.map(group => [group.title, group.options.map(option => option.value + (option.selected ? '*' : ''))]),
  [['Lines', ['line']], ['Shapes', ['ellipse*', 'star']]]);
assert.equal(items[1].title, 'Drag on the map to draw a shape');

// A selected pin: its actions are a card of their own, and a rejected typed
// size reports its error on that size's row.
items = describeBar({tools: toolbar('select'), opts: `<div class="mk-slider mk-ground" data-ground="size" data-label="Size" data-feet="40" data-feet-min="0.1"><span>Size</span><input type="range" data-ground-range="size" min="0" max="1000" value="600" aria-label="Size"><button class="mk-value" data-edit-ground="size" aria-expanded="true">40 ft</button></div>
  <div class="mk-selection-actions" data-kind="pin" data-shape="" data-fid="pin1"><button class="mk-text-btn" data-act="edit-text">Edit text</button><button class="mk-icon-btn" data-act="duplicate" aria-label="Duplicate"></button><button class="mk-icon-btn mk-danger" data-act="delete" aria-label="Delete selected"></button></div>`},
  `<div id="mkPop" data-kind="value"><form><input id="mkValueInput" value="abc"><button type="submit">Set</button><div class="mk-value-error" role="alert">Enter a number of feet.</div></form></div>`);
const selection = items.find(item => item.kind === 'markupSelection');
assert.equal(selection.title, 'Pin');
assert.deepEqual(selection.buttons.map(button => button.id), ['edit-text', 'duplicate', 'delete']);
const style = items.find(item => item.kind === 'group');
assert.deepEqual([style.title, style.detail], ['Pin style', 'Selected mark only']);
assert.equal(style.id, 'field:select:pin1', 'style rows belong to the selected mark');
assert.deepEqual(style.items.map(item => item.kind), ['markupSize'], 'selection actions are not repeated as style rows');
assert.deepEqual([style.items[0].expanded, style.items[0].detail], [true, 'Enter a number of feet.']);
assert.equal(style.items[0].entry.value, 'abc', 'Cancel can reach the web field itself');
assert.equal(style.items[0].id, 'size:pin1', 'a typed size belongs to the selected mark');
assert.match(items.find(item => item.kind === 'markupHistory').title, /handles/);

// A freeform shape in progress offers Finish shape instead of Done, only
// once it has three points, beside taking back a point or cancelling.
const draftBar = points => {
  document = parse(`<div id="mkBar"><div class="mk-tools">${toolbar('shape')}</div>${layer}<div class="mk-opts"></div><div class="mk-footer"><div class="mk-history"><button data-act="undo" aria-label="Undo"></button></div><div class="mk-finish"><button class="mk-text-btn" data-act="cancel-shape">Cancel</button><button class="mk-text-btn" data-act="undo-point"${points > 1 ? '' : ' disabled'}>Undo point</button><button class="mk-done" data-act="finish" data-points="${points}"${points < 3 ? ' disabled' : ''}>Finish shape</button></div></div></div><div id="mkPop" hidden></div>`);
  const out = [];
  context.markupItems(out, document.querySelector('#mkBar'));
  return JSON.parse(JSON.stringify(out));
};
items = draftBar(2);
assert.deepEqual([items[2].id, items[2].role, items[2].disabled, items[2].value], ['finish', 'primary', true, 2]);
assert.deepEqual(items[2].buttons.map(button => [button.id, button.disabled]), [['undo-point', false], ['cancel-shape', false]]);
assert.equal(items[1].title, '2 of 3 points · tap 1 more to make a shape');
items = draftBar(3);
assert.equal(items[2].disabled, false);
assert.equal(items[1].title, '3 points · tap Finish shape or the first point');
// The web keeps a draft with fewer than three points rather than dropping it.
assert.match(markup.slice(markup.indexOf('function finishArea(){'), markup.indexOf('function finishArea(){') + 120), /points\.length<3\) return/);

// Exact sizes report the web's verdict, and find their control again by key
// when the toolbar was rebuilt while the person typed.
const enterFn = adapter.slice(adapter.indexOf('    enterValue(ref, value, key, owner) {'), adapter.indexOf('    describe: () => describePage(),'));
assert.match(enterFn, /data-edit-ground=/);
assert.match(enterFn, /markupOwner\(bar\) !== owner/, 'a typed size applies only to the layer, tool and mark it was typed for');
assert.match(enterFn, /Math\.abs\(held - Number\(value\)\)/, 'accepted means the web now holds the value');
// Hidden tools leave a status on the map with the web's own Done button.
const statusFn = adapter.slice(adapter.indexOf('  function markupStatus() {'), adapter.indexOf('  function appearanceState() {'));
assert.match(statusFn, /done: done\?\.dataset\.act === "done"/);
// The first point closes a shape where it is drawn now, after any panning.
assert.match(markup, /px\.distanceTo\(llPx\(draft\.points\[0\],draft\.space3d\)\)<14/);
// In the app, the layer's marks are listed for choosing one without a tap:
// every mark, in drawing order, with older ones loading in pages.
assert.match(markup, /window\.CSPNativeHost\?markList\(\):""/);
assert.match(markup, /data-index="\$\{all\.length-i\}"/);
assert.match(markup, /data-act="more-marks"/);
// A listed mark is revealed only once the web confirms it is selected.
const selectFn = adapter.slice(adapter.indexOf('    selectMark(ref, fid, inset) {'), adapter.indexOf('    enterValue(ref, value, key, owner) {'));
assert.match(selectFn, /dataset\.fid === String\(fid\)/);
assert.match(selectFn, /if \(selected\) window\.CSPMarkup\?\.revealSelected/);
// After panning, a freeform shape resumes; choosing Freeform again resumes it.
assert.match(markup, /data-act="resume-shape">Add points/);
assert.match(markup, /const resume=draft\?\.kind==="area"&&b\.dataset\.shape==="freeform"/);
// Palette picks press the web's own swatch, reopening for shades on request.
const pickFn = adapter.slice(adapter.indexOf('      case "pick": {'), adapter.indexOf('      case "enter": {'));
assert.match(pickFn, /data-pick=/);
assert.match(pickFn, /aria-expanded/);
// Typed sizes go through the web's own field: open it, type, submit.
const actFn = adapter.slice(adapter.indexOf('      case "enter": {'), adapter.indexOf('      case "click":'));
assert.match(actFn, /aria-expanded/);
assert.match(actFn, /#mkValueInput/);
assert.match(actFn, /requestSubmit/);

// A panel without a body selector must describe the panel root itself, and
// markup reports the layer being drawn on as its subtitle.
const panelFn = adapter.slice(adapter.indexOf('  function describePanel('), adapter.indexOf('  function describePanel(') + 1500);
const panelEnd = panelFn.indexOf('\n  }') + 4;
let describedRoot;
const root = {hidden: false};
const panelContext = {PANELS: {mkBar: {title: 'Markup', state: () => 'Drawing on Field notes', items(items, body) { describedRoot = body; }}},
  document: {getElementById: () => root}, $: () => null, clean: x => x, walkBody() {}};
vm.runInNewContext(panelFn.slice(0, panelEnd), panelContext);
const panel = panelContext.describePanel('mkBar');
assert.equal(panel.title, 'Markup');
assert.equal(panel.state, 'Drawing on Field notes');
assert.equal(describedRoot, root);
console.log('Native markup pane: map touch behavior, task layout and in-place choices passed');
