const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const logic = vm.createContext({});
vm.runInContext(fs.readFileSync('CloseLogic.js', 'utf8'), logic);
for (const bad of ['', null, '0x', '0', '0000', '0x000', 'xyz', 'abc" })', ' abcd'])
  assert.equal(logic.closeLua(bad), '');
assert.equal(logic.address('0xABC'), '0xabc');
assert.equal(logic.closeLua('abc'), 'hl.dsp.window.close({ window = "address:0xabc" })');
assert.equal(logic.neighbor(['b', 'a'], 'a', 0), 1, 'reorder retains address');
assert.equal(logic.neighbor(['b', 'c'], 'a', 0), 0, 'close selects next');
assert.equal(logic.neighbor(['a'], 'b', 1), 0, 'last close selects previous');
assert.equal(logic.neighbor([], 'a', 0), -1);
assert.equal(logic.neighbor(['a'], '', -1), -1, 'does not enter pane mode');
assert.equal(logic.canRequest('0xa', ['0xa'], {}, 100), true);
assert.equal(logic.canRequest('0xa', [], {}, 100), false, 'stale is no-op');
assert.equal(logic.canRequest('0xa', ['0xa'], {'0xa': 200}, 100), false);
assert.equal(logic.canRequest('0xa', ['0xa'], {'0xa': 200}, 200), true, 'declined request expires');
// Execute the actual QML key branch with mocked Qt/root, including selection
// changing while the physical key is down (even a non-repeat second press).
const qml = fs.readFileSync('Stage.qml', 'utf8');
const start = qml.indexOf('        if (event.key === Qt.Key_X) {', qml.indexOf('function navigate(event)'));
const end = qml.indexOf('\n\n        if (event.key === Qt.Key_Escape)', start);
let requests = [];
const root = { closeKeyHeld: false, paneAddress: 'a', requestWindowClose(a) { requests.push(a); } };
const input = vm.createContext({ root, Qt: {Key_X: 88, NoModifier: 0}, panes: true });
vm.runInContext('function press(event) {' + qml.slice(start, end) + '}', input);
const press = (mods = 0, repeat = false) => input.press({ key: 88, modifiers: mods, isAutoRepeat: repeat });
press(); root.paneAddress = 'b'; press(0, true); press();
assert.deepEqual(requests, ['a']);
root.closeKeyHeld = false; press(1); assert.deepEqual(requests, ['a']);
root.closeKeyHeld = false; input.panes = false; press(); assert.deepEqual(requests, ['a']);
root.closeKeyHeld = false; input.panes = true; press(); assert.deepEqual(requests, ['a', 'b']);
console.log('Close helpers and mocked actual QML key branch passed');
