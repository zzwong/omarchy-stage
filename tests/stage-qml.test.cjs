// Static guards on Stage.qml: properties that are easy to regress in a merge
// and expensive to catch by eye. Nothing here parses QML semantics -- the
// decisions themselves are tested directly in logic.test.cjs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const qml = fs.readFileSync(path.join(root, 'Stage.qml'), 'utf8');

// Body of a `function name(...) { ... }`, brace-matched.
function functionBody(source, name) {
  const at = source.indexOf('function ' + name + '(');
  assert.notEqual(at, -1, name + ' exists');
  const open = source.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(open + 1, i);
  }
  throw new Error('unbalanced braces in ' + name);
}

// Reconciliation is event-driven; a polling timer would be a regression.
assert.ok(!/repeat:\s*true/.test(qml), 'no repeating Timer in Stage.qml');

// Quickshell surfaces each newly created workspace in its own turn of the
// event loop, so Qt.callLater -- which only collapses what one turn already
// queued -- ran a rebuild per workspace of a batch. A short debounce, one
// timer restarted by both triggers, is what actually coalesces a burst.
assert.ok(!/Qt\.callLater\(\s*root\.rebuildWorkspaces/.test(qml),
          'rebuilds are coalesced by a debounce timer, not by Qt.callLater');
assert.ok(/id:\s*rebuildCoalesce/.test(qml), 'the rebuild debounce timer exists');
assert.equal((qml.match(/rebuildCoalesce\.restart\(\)/g) || []).length, 2,
             'both rebuild triggers restart the one debounce timer');

// An intermediate value notifies a selection nobody asked for, and the
// derived pane/workspace bindings are real observers: the rebuild assigns once.
const rebuild = functionBody(qml, 'rebuildWorkspaces');
const assignments = rebuild.match(/selectedIndex\s*=[^=]/g) || [];
assert.equal(assignments.length, 1,
             'rebuildWorkspaces assigns selectedIndex exactly once, got '
             + assignments.length);

// Moving the selection off a workspace has to drop that workspace's pane
// zoom, or coming back re-enters pane mode on a window the user is no longer
// looking at. Every input path goes through selectWorkspace(), so the only
// other assignment is the reconciliation above.
assert.ok(/selectedIndex\s*=[^=]/.test(functionBody(qml, 'selectWorkspace')),
          'selectWorkspace assigns selectedIndex');
const everyAssignment = (qml.match(/selectedIndex\s*=[^=]/g) || []).length;
assert.equal(everyAssignment, 2,
             'only selectWorkspace and rebuildWorkspaces assign selectedIndex, got '
             + everyAssignment);

// Compositor actions go over Quickshell's own Hyprland socket. A detached
// exec would fail silently, and a `hyprctl dispatch` child would fork a
// process per click for a reply Quickshell already logs.
assert.ok(!/execDetached/.test(qml), 'no fire-and-forget dispatch in Stage.qml');
assert.ok(!/"hyprctl",\s*"dispatch"/.test(qml),
          'dispatches go through Hyprland.dispatch, not a hyprctl child');
assert.ok(/Hyprland\.dispatch\(/.test(qml), 'Hyprland.dispatch is used');

// Every Repeater over windows binds the ObjectModel, not a JS array: an array
// is a new model on every membership change *and* on every re-tile (sortPanes
// returns a fresh one), which recreates every delegate -- every live capture
// with the thumbnails, every MPRIS and PipeWire lookup with the pills.
for (const line of qml.split('\n')) {
  assert.ok(!/^\s*(model|delegate:\s*\w+\s*model):.*toplevels\.values/.test(line),
            'Repeater models bind toplevels, not toplevels.values: ' + line.trim());
  assert.ok(!/^\s*model:.*selectedPanes/.test(line),
            'Repeater models bind toplevels, not the sorted array: ' + line.trim());
  // Slabs are keyed by workspace identity, for the same reason. An int model
  // re-binds `workspace` on every slab after an insertion -- and with it the
  // thumbnails bound to `workspace.toplevels` -- and a plain array is a new
  // model on every rebuild, so both restart live captures on cards nothing
  // happened to.
  assert.ok(!/^\s*model:\s*root\.slotCount\b/.test(line),
            'slab Repeaters bind the slot model, not a count: ' + line.trim());
  assert.ok(!/^\s*model:\s*root\.workspaceList\b/.test(line),
            'slab Repeaters bind the slot model, not the array: ' + line.trim());
}
const scriptModels = (qml.match(/^\s*ScriptModel\s*\{/gm) || []).length;
assert.equal(scriptModels, 2, 'the slot and workspace models are ScriptModels');
assert.equal((qml.match(/comparisonMode:\s*ObjectComparison\.Identity/g) || []).length,
             scriptModels,
             'every ScriptModel keys its rows by object identity, not by shape');

// A close, a drag or an edit disarms hold-to-cycle and stops the watchdog
// together; two writers of `cycled` is how one of them gets forgotten.
assert.ok(/function disarmCycle\(\)/.test(qml), 'disarmCycle() exists');
const disarmers = (qml.match(/cycled\s*=\s*false/g) || []).length;
assert.equal(disarmers, 2,
             'only disarmCycle() and the watchdog clear `cycled`, got ' + disarmers);

// The shared logic lives in one importable module.
assert.ok(/import "StageLogic\.js" as StageLogic/.test(qml), 'StageLogic.js is imported');
assert.ok(fs.existsSync(path.join(root, 'StageLogic.js')));
assert.ok(!/^\s*\.pragma\s/m.test(fs.readFileSync(path.join(root, 'StageLogic.js'), 'utf8')),
          'StageLogic.js stays loadable by the tests verbatim');

console.log('Stage.qml: debounced rebuilds, one selectedIndex assignment, socket dispatch, identity-keyed models, one cycle disarm');
