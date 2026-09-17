// Keyboard editing: what a key press means (routeKey) and what the compositor
// is asked to do about it (editLua). Both come from StageLogic.js verbatim;
// the generated Lua is then executed by tests/edit.lua against a mocked
// Hyprland API, so the exact string Stage dispatches is what gets tested.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const L = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(root, 'StageLogic.js'), 'utf8'), L);

// --- the Qt values the module repeats ------------------------------------
// routeKey compares against its own copies so node needs no QML engine; they
// are Qt's public enum values and these are them.
assert.equal(L.KEY.escape, 0x01000000);
assert.equal(L.KEY.tab, 0x01000001);
assert.equal(L.KEY.backtab, 0x01000002);
assert.equal(L.KEY.ret, 0x01000004);
assert.equal(L.KEY.enter, 0x01000005);
assert.equal(L.KEY.left, 0x01000012);
assert.equal(L.KEY.up, 0x01000013);
assert.equal(L.KEY.right, 0x01000014);
assert.equal(L.KEY.down, 0x01000015);
assert.equal(L.KEY.zero, 0x30);
assert.equal(L.KEY.nine, 0x39);
assert.equal(L.KEY.x, 0x58);
assert.equal(L.MOD.shift, 0x02000000);
assert.equal(L.MOD.control, 0x04000000);
assert.equal(L.MOD.alt, 0x08000000);
assert.equal(L.MOD.meta, 0x10000000);
assert.equal(L.MOD.keypad, 0x20000000);

// --- routeKey -------------------------------------------------------------
const K = L.KEY, M = L.MOD;
const PANE = { panes: true, editBusy: false, closeKeyHeld: false };
const LIST = { panes: false, editBusy: false, closeKeyHeld: false };

function route(key, modifiers, ctx, extra) {
  return L.routeKey(Object.assign({ key: key, modifiers: modifiers || 0,
                                    isAutoRepeat: false }, extra || {}),
                    ctx || LIST);
}
// The decision comes out of the vm context, so its fields are compared
// rather than the object.
function is(decision, action, arg) {
  assert.equal(decision.action, action);
  assert.equal(decision.arg, arg === undefined ? null : arg);
}

// Pane mode: the four Shift+arrows are swaps, and only Ctrl+Shift+←/→ moves.
is(route(K.left, M.shift, PANE), 'swap', 'left');
is(route(K.right, M.shift, PANE), 'swap', 'right');
is(route(K.up, M.shift, PANE), 'swap', 'up');
is(route(K.down, M.shift, PANE), 'swap', 'down');
is(route(K.left, M.control | M.shift, PANE), 'move', 'left');
is(route(K.right, M.control | M.shift, PANE), 'move', 'right');
// A vertical move has no meaning in a one-dimensional workspace list.
is(route(K.up, M.control | M.shift, PANE), 'consume');
is(route(K.down, M.control | M.shift, PANE), 'consume');

// Outside pane mode there is no window selected to edit, and the chord must
// still not navigate.
for (const key of [K.left, K.right, K.up, K.down]) {
  is(route(key, M.shift, LIST), 'consume');
  is(route(key, M.control | M.shift, LIST), 'consume');
}

// The keypad's arrows, Enter and digits carry KeypadModifier and are the
// same keys.
is(route(K.right, M.keypad | M.shift, PANE), 'swap', 'right');
is(route(K.left, M.keypad | M.control | M.shift, PANE), 'move', 'left');
is(route(K.enter, M.keypad), 'activate');
is(route(K.ret, M.keypad), 'activate');
is(route(K.down, M.keypad, PANE), 'zoomIn');
is(route(0x33 /* Key_3 */, M.keypad), 'workspace', 3);

// Every other modified key is swallowed: Ctrl+Left must not walk the
// carousel, and no chord may reach navigation by accident.
for (const mods of [M.control, M.alt, M.meta, M.control | M.alt,
                    M.alt | M.shift, M.meta | M.shift, M.control | M.meta]) {
  is(route(K.left, mods, PANE), 'consume');
  is(route(K.right, mods, LIST), 'consume');
  is(route(K.ret, mods, PANE), 'consume');
  is(route(0x31 /* Key_1 */, mods), 'consume');
}

// Shift+Tab navigation survives, on both of the keys it arrives as.
is(route(K.tab, M.shift), 'advance', -1);
is(route(K.backtab, M.shift), 'advance', -1);
is(route(K.backtab, 0), 'advance', -1);
is(route(K.tab, 0), 'advance', 1);

// Ordinary navigation is unchanged.
is(route(K.left, 0), 'advance', -1);
is(route(K.right, 0), 'advance', 1);
is(route(K.up, 0), 'zoomOut');
is(route(K.down, 0), 'zoomIn');
is(route(K.ret, 0), 'activate');
is(route(K.enter, 0), 'activate');
is(route(K.escape, 0), 'dismiss');
is(route(0x39 /* Key_9 */, 0), 'workspace', 9);
is(route(0x30 /* Key_0 */, 0), 'none', null); // there is no workspace 0
is(route(0x41 /* Key_A */, 0), 'none', null);

// X closes only an unmodified first press in pane mode; every other press
// still latches the physical key so a hold cannot cascade.
is(route(K.x, 0, PANE), 'close');
is(route(K.x, 0, LIST), 'closeHeld');
is(route(K.x, M.shift, PANE), 'closeHeld');
is(route(K.x, 0, { panes: true, closeKeyHeld: true }), 'closeHeld');
is(route(K.x, 0, PANE, { isAutoRepeat: true }), 'closeHeld');

// While an edit is in flight every key is dropped rather than queued against
// the geometry it is about to change -- except the one that gets you out.
const BUSY = { panes: true, editBusy: true, closeKeyHeld: false };
is(route(K.escape, 0, BUSY), 'dismiss');
for (const [key, mods] of [[K.right, M.shift], [K.right, 0], [K.x, 0],
                           [K.tab, 0], [K.ret, 0], [0x31, 0]])
  is(route(key, mods, BUSY), 'consume');
is(route(K.right, M.shift, BUSY, { isAutoRepeat: true }), 'consume');

// --- editLua: rejected input ----------------------------------------------
const SHOWN = [1, 3, 7];
for (const bad of ['', null, undefined, '0x', '0', '0000', 'zz', 'abc" })',
                   'ab cd', 'abc\nhl.dsp.exit({'])
  assert.equal(L.editLua(bad, 'swap', 'right', SHOWN), '',
               'rejects address ' + JSON.stringify(bad));
for (const bad of ['', null, 'diagonal', 'LEFT', 'up-left'])
  assert.equal(L.editLua('0xa', 'swap', bad, SHOWN), '',
               'rejects direction ' + JSON.stringify(bad));
for (const bad of ['', null, 'close', 'swap ', 'kill'])
  assert.equal(L.editLua('0xa', bad, 'right', SHOWN), '',
               'rejects action ' + JSON.stringify(bad));
// A move is along the workspace list, which has one dimension.
assert.equal(L.editLua('0xa', 'move', 'up', SHOWN), '');
assert.equal(L.editLua('0xa', 'move', 'down', SHOWN), '');
for (const bad of [[], [1, 0], [1, -3], [1, 2.5], [1, '3; hl.dsp.exit({'],
                   [1, NaN], [1, null], [1, '3px'], [1, {}]])
  assert.equal(L.editLua('0xa', 'move', 'right', bad), '',
               'rejects workspaces ' + JSON.stringify(bad));
// Whatever survives that is an integer, however it was written.
assert.equal(L.editLua('0xa', 'move', 'right', ['1', '3']),
             L.editLua('0xa', 'move', 'right', [1, 3]),
             'numeric strings are the same ids');
assert.ok(L.editLua('0xa', 'move', 'right', ['1e3']).includes('local shown = {1000}'));

// --- editLua: the chunk ---------------------------------------------------
const swap = L.editLua('0XAB', 'swap', 'up', [2]);
assert.ok(swap.startsWith('function()\n') && swap.endsWith('\nend'),
          'the chunk is one Lua expression');
assert.ok(swap.includes('hl.get_window("address:0xab")'), 'lowercased, prefixed');
assert.ok(swap.includes('local shown = {2}'));
assert.ok(swap.includes('hl.get_windows({ workspace = s.workspace })'),
          'candidates come from the source\'s own workspace');
assert.ok(swap.includes('t.monitor.id == s.monitor.id'), 'same monitor only');
// Up and down measure along y and overlap on x; left and right the other way.
assert.ok(swap.includes('local d = -((t.at.y + t.size.y / 2)'));
assert.ok(swap.includes('local lo = math.max(s.at.x, t.at.x)'));
assert.ok(L.editLua('0xab', 'swap', 'right', [2])
           .includes('local d = ((t.at.x + t.size.x / 2)'));
assert.ok(swap.includes('hl.dsp.window.swap({ window = "address:0xab",'));
assert.ok(!swap.includes('hl.dsp.window.move'), 'a swap never moves');
assert.equal((swap.match(/hl\.dispatch/g) || []).length, 1, 'one dispatch');

const move = L.editLua('0xab', 'move', 'right', SHOWN);
assert.ok(move.includes('local shown = {1, 3, 7}'));
assert.ok(move.includes('local dest = shown[here + 1]'), 'the next shown entry');
assert.ok(L.editLua('0xab', 'move', 'left', SHOWN).includes('local dest = shown[here - 1]'));
assert.ok(move.includes('hl.get_workspace(tostring(dest))'), 'it must already exist');
assert.ok(move.includes('follow = false'), 'the desktop workspace stays put');
assert.ok(!move.includes('hl.dsp.window.swap'), 'a move never swaps');
assert.equal((move.match(/hl\.dispatch/g) || []).length, 1, 'one dispatch');

// --- the chunk, executed --------------------------------------------------
// Every scenario runs the generated Lua against tests/edit.lua's mocked `hl`.
// In the `tiled` world 0xa is top-left, 0xb top-right, 0xc bottom-left and
// 0xd bottom-right of workspace 1, with 0xe alone on 3 and 0xf alone on 7.
const W = { window: 'window=address:', target: 'target=address:' };
const swapped = (source, target) =>
  'swap swap{' + W.target + target + ',' + W.window + source + '}';
const moved = (source, workspace) =>
  'move move{follow=false,' + W.window + source + ',workspace=' + workspace + '}';

const scenarios = [
  // 2x2: each direction picks the neighbour that shares a span with it.
  ['tiled', '0xa', 'swap', 'right', SHOWN, swapped('0xa', '0xb')],
  ['tiled', '0xa', 'swap', 'down', SHOWN, swapped('0xa', '0xc')],
  ['tiled', '0xd', 'swap', 'left', SHOWN, swapped('0xd', '0xc')],
  ['tiled', '0xd', 'swap', 'up', SHOWN, swapped('0xd', '0xb')],
  // Edges: there is nothing that way.
  ['tiled', '0xa', 'swap', 'left', SHOWN, 'noop '],
  ['tiled', '0xa', 'swap', 'up', SHOWN, 'noop '],
  ['tiled', '0xd', 'swap', 'right', SHOWN, 'noop '],
  ['tiled', '0xd', 'swap', 'down', SHOWN, 'noop '],
  // A window that only touches the source diagonally is not a neighbour.
  ['diagonal', '0xa', 'swap', 'right', SHOWN, 'noop '],
  ['diagonal', '0xa', 'swap', 'down', SHOWN, 'noop '],
  // Unsupported sources dispatch nothing at all.
  ['floating', '0xa', 'swap', 'right', SHOWN, 'noop '],
  ['grouped', '0xa', 'swap', 'right', SHOWN, 'noop '],
  ['fullscreen', '0xa', 'swap', 'right', SHOWN, 'noop '],
  ['fullscreenclient', '0xa', 'swap', 'right', SHOWN, 'noop '],
  ['unmapped', '0xa', 'swap', 'right', SHOWN, 'noop '],
  ['hiddensource', '0xa', 'swap', 'right', SHOWN, 'noop '],
  ['gone', '0xa', 'swap', 'right', SHOWN, 'noop '],
  ['floating', '0xa', 'move', 'right', SHOWN, 'noop '],
  ['grouped', '0xa', 'move', 'right', SHOWN, 'noop '],
  ['fullscreen', '0xa', 'move', 'right', SHOWN, 'noop '],
  ['gone', '0xa', 'move', 'right', SHOWN, 'noop '],
  // Unsupported and off-monitor candidates are skipped, not swapped with.
  ['candidates', '0xa', 'swap', 'right', SHOWN, swapped('0xa', '0xf')],
  // Ties: perpendicular distance first, then the address.
  ['ties', '0xa', 'swap', 'right', SHOWN, swapped('0xa', '0xc')],
  ['duplicates', '0xa', 'swap', 'right', SHOWN, swapped('0xa', '0xb')],
  // Moves walk the shown list, 1 -> 3 -> 7 and back, and stop at its ends.
  ['tiled', '0xa', 'move', 'right', SHOWN, moved('0xa', 3)],
  ['tiled', '0xe', 'move', 'right', SHOWN, moved('0xe', 7)],
  ['tiled', '0xf', 'move', 'right', SHOWN, 'noop '],
  ['tiled', '0xf', 'move', 'left', SHOWN, moved('0xf', 3)],
  ['tiled', '0xe', 'move', 'left', SHOWN, moved('0xe', 1)],
  ['tiled', '0xa', 'move', 'left', SHOWN, 'noop '],
  // A destination Stage lists but the compositor does not have is not
  // created, and one on another monitor is refused.
  ['missing', '0xa', 'move', 'right', SHOWN, 'noop '],
  ['foreignmonitor', '0xa', 'move', 'right', SHOWN, 'noop '],
  // The window has moved since Stage drew it: its workspace is not shown.
  ['stale', '0xa', 'swap', 'right', SHOWN, 'noop '],
  ['stale', '0xa', 'move', 'right', SHOWN, 'noop '],
];

for (const [world, source, action, direction, shown, expected] of scenarios) {
  const lua = L.editLua(source, action, direction, shown);
  assert.notEqual(lua, '', 'a chunk for ' + [world, source, action, direction]);
  let out;
  try {
    out = execFileSync('lua', [path.join(__dirname, 'edit.lua'), world],
                       { input: lua, encoding: 'utf8' });
  } catch (err) {
    throw new Error('lua failed for ' + [world, source, action, direction].join(' ')
                    + ': ' + (err.stderr || err.message));
  }
  assert.equal(out.trim(), expected.trim(),
               [world, source, action, direction].join(' '));
}

console.log('keyboard: key routing, chunk generation, and ' + scenarios.length
            + ' Lua scenarios against a mocked compositor');
