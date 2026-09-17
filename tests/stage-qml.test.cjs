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

// The thumbnail Repeaters bind the ObjectModel, not its values array: an
// array is a new model on every membership change, which recreates every
// delegate and restarts every live capture.
for (const line of qml.split('\n'))
  assert.ok(!/^\s*(model|delegate:\s*\w+\s*model):.*toplevels\.values/.test(line),
            'Repeater models bind toplevels, not toplevels.values: ' + line.trim());

// The shared logic lives in one importable module.
assert.ok(/import "StageLogic\.js" as StageLogic/.test(qml), 'StageLogic.js is imported');
assert.ok(!/CloseLogic/.test(qml), 'CloseLogic.js is gone');
assert.ok(fs.existsSync(path.join(root, 'StageLogic.js')));
assert.ok(!/^\s*\.pragma\s/m.test(fs.readFileSync(path.join(root, 'StageLogic.js'), 'utf8')),
          'StageLogic.js stays loadable by the tests verbatim');

console.log('Stage.qml: no polling timer, one selectedIndex assignment, socket dispatch, model-backed Repeaters');
