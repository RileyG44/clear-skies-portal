// Check the actual native popover-to-editor transition and contextual menus.
const failures = [], checks = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (value, text) => { if (!value) failures.push(text); };
const config = () => window.webkit.messageHandlers.cspNative.postMessage({type:'debug.configuration'});
const S = CSPNativeShell, originalRoute = CSPShell.current();
const flatten = items => (items || []).flatMap(item => [item, ...flatten(item.items)]);
let navigation, selectedLayer;
try {
  await wait(1200);
  const before = await config();
  assert(before.navigation.sheet === 'terrainSourcePanel', 'Launch this probe with --panel terrainSourcePanel');
  const panel = S.describePanel('terrainSourcePanel');
  const row = panel.items.find(item => item.ref?.startsWith('source:') && item.items?.[0]?.kind === 'button');
  assert(!!row && !row.title, 'Layer title must be a button, without a repeated heading');
  if (row) {
    const title = row.items[0]; selectedLayer = title.title;
    assert(title.title !== 'Edit layer', 'Layer title was replaced by a redundant edit row');
    S.act(title.ref, 'click');
    await wait(1000);
    navigation = (await config()).navigation;
    assert(navigation.sheet === 'tools', 'Tapping the toolbar layer title did not open the native editor');
    assert(navigation.route === CSPShell.current(), 'Native editor differs from the selected web layer route');
    await window.webkit.messageHandlers.cspNative.postMessage({type:'debug.mapSnapshot'});
    checks.push('Toolbar layer title opens the actual native editor');
  }
  S.open('layers'); await wait(250);
  const cards = flatten(S.describe().items).filter(item => item.kind === 'layer');
  assert(cards.length > 0, 'No active layer cards were checked');
  for (const card of cards) {
    assert((card.actions || []).filter(action => action.action === 'edit').length <= 1, 'Duplicate edit menu entries for ' + card.title);
  }
  checks.push('Active layer menus contain no duplicate edit actions');
} catch (error) { failures.push(error.stack || String(error)); }
finally { S.open(originalRoute); }
return {passed:!failures.length,failures,checks,selectedLayer,navigation};
