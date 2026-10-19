// Offline regression for the actual QML activation functions and generated Lua.
// QML handlers are extracted as JavaScript, not instantiated: this does not
// prove key/pointer delivery, real monitor placement or compositor semantics.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const source = process.env.STAGE_WORKSPACE_SOURCE || path.join(__dirname, '..');
const { StageLogic: L } = require(path.join(source, 'tests/load.cjs'));
const qml = fs.readFileSync(path.join(source, 'Stage.qml'), 'utf8');
const lua = process.env.STAGE_TEST_LUA || 'lua';

// Same brace-matched extraction approach as stage-qml.test.cjs, retaining the
// whole declaration so parameters and calls remain exactly as shipped.
function declaration(name) {
  const at = qml.indexOf('function ' + name + '(');
  assert.notEqual(at, -1, name + ' exists');
  const open = qml.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < qml.length; i++) {
    if (qml[i] === '{') depth++;
    else if (qml[i] === '}' && --depth === 0) return qml.slice(at, i + 1);
  }
  throw new Error('unbalanced ' + name);
}

function activation(action, monitor = 1, dismissMonitor) {
  const emitted = [];
  const root = {
    monitor: monitor === null ? null : { id: monitor },
    shownIds: [1, 2, 3], workspaceList: [{ id: 1 }, { id: 2 }, { id: 3 }],
    selectedIndex: 3, dismissed: 0,
    dismiss() {
      this.dismissed++;
      if (dismissMonitor !== undefined) this.monitor = { id: dismissMonitor };
    },
    dispatch(chunk) { emitted.push(chunk); },
  };
  const names = ['nextWorkspaceId', 'focusWorkspace', 'createWorkspace', 'activateSelected'];
  const context = vm.createContext({ root, StageLogic: L });
  for (const name of names) {
    root[name] = vm.runInContext('(' + declaration(name) + ')', context);
  }
  if (action === 'existing') root.focusWorkspace(4);
  else root[action]();
  return { emitted, root };
}

function evaluate(chunk, world) {
  return execFileSync(lua, [path.join(__dirname, 'workspace-create.lua'), world], {
    input: chunk, encoding: 'utf8', timeout: 5000,
  }).trim();
}

// The source path override lets the unchanged baseline's createWorkspace run
// against exactly this regression. It fails semantically (one remote focus),
// not because baseline lacks the new helper. Runtime worlds are selected only
// after activation produced its string, modeling state at dispatch time.
for (const action of ['createWorkspace', 'activateSelected']) {
  const { emitted, root } = activation(action);
  assert.equal(emitted.length, 1, action + ' emits one operation');
  assert.equal(root.dismissed, 1, action + ' dismisses once');
  const chunk = emitted[0];
  const remote = evaluate(chunk, 'remote');
  console.log('WORKSPACE_OBSERVATION ' + JSON.stringify({ action, world: 'remote',
                                                        actual: remote, expected: '0 1 0' }));
  assert.equal(remote, '0 1 0', action + ': remote collision must not focus');
  assert.equal(evaluate(chunk, 'localcollision'), '0 1 0', action + ': late local collision must not focus');
  assert.equal(evaluate(chunk, 'free'), '1 1 4', action + ': free target dispatches once');
  assert.equal(evaluate(chunk, 'nomonitor'), '0 nil 0', action + ': missing active monitor refuses');
  assert.equal(evaluate(chunk, 'changed'), '0 2 0', action + ': changed active monitor refuses');
  assert.equal(evaluate(chunk, 'rule'), '1 2 4', action + ': compositor placement policy is not overridden');
}

assert.equal(evaluate(activation('createWorkspace', 0).emitted[0], 'zero'), '1 0 4',
             'monitor zero is a valid ID');
assert.equal(evaluate(activation('createWorkspace', 1, 2).emitted[0], 'changed'), '0 2 0',
             'expected monitor is captured before dismiss changes root.monitor');
assert.equal(evaluate(activation('existing').emitted[0], 'remote'), '1 2 4',
             'ordinary explicit workspace focus remains unrestricted');

for (const monitor of [null, -1, 0.5, NaN, Infinity, undefined, '1', {}, '1; hl.dispatch()']) {
  assert.equal(L.createWorkspaceLua(4, monitor), '', 'invalid monitor ' + String(monitor));
}
for (const id of [0, -1, 0.5, NaN, Infinity, null, undefined, 'bad', '4; hl.dispatch()']) {
  assert.equal(L.createWorkspaceLua(id, 1), '', 'invalid workspace ' + String(id));
}
for (const monitor of [null, -1, 0.5, NaN, Infinity, '1', {}]) {
  const invalid = activation('createWorkspace', monitor);
  assert.equal(invalid.emitted.length, 0, 'invalid monitor emits no operation');
  assert.equal(invalid.root.dismissed, 0, 'invalid monitor leaves overlay alone');
}
assert.equal(L.nextWorkspaceId([1, 2, 3]), 4, 'local numbering is unchanged');
assert.equal(L.dropDecision({ hit: { id: 0 }, sourceLive: true,
                             shownIds: [1, 2, 3], workspaces: [{ id: 4 }] }), 4,
             'drag still chooses locally numbered candidate; moveLua owns refusal');
assert.ok(/onClicked:\s*root\.createWorkspace\(\)/.test(qml), 'click uses creation path');
assert.ok(/onActivated:\s*\{[^}]*root\.activateSelected\(\)/.test(qml),
          'slot activation uses selected path');
console.log('workspace creation: 12 activation worlds, zero/dismiss races, ordinary focus, validation, wiring');
