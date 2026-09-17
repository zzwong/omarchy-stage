// Keyboard editing: what a key event means (routeKey), where a move sends the
// pane (moveDestinationIndex), and what the compositor is asked to do about a
// swap (swapLua). All three come from StageLogic.js verbatim; the generated
// Lua is then executed by tests/chunk.lua against a mocked Hyprland API, so
// the exact string Stage dispatches is what gets tested.
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { StageLogic: L } = require('./load.cjs');

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
assert.equal(L.KEY.meta, 0x01000022);
assert.equal(L.KEY.superL, 0x01000053);
assert.equal(L.KEY.superR, 0x01000054);
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
const PANE = { panes: true };
const LIST = { panes: false };

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
// A vertical move has no meaning in a one-dimensional workspace row.
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

// In cycle mode Super is held down for the overlay's whole life, so every key
// arrives carrying MetaModifier. Stage has no Super chord of its own, so the
// flag is never a discriminator -- and without masking it, cycle mode
// swallows every plain navigation key.
is(route(K.right, M.meta), 'advance', 1);
is(route(K.left, M.meta), 'advance', -1);
is(route(K.up, M.meta), 'zoomOut');
is(route(K.ret, M.meta), 'activate');
is(route(0x34 /* Key_4 */, M.meta), 'workspace', 4);
is(route(K.x, M.meta, PANE), 'close');
is(route(K.right, M.meta | M.shift, PANE), 'swap', 'right');
is(route(K.right, M.meta | M.control | M.shift, PANE), 'move', 'right');
is(route(K.tab, M.meta | M.shift), 'advance', -1);
// Masking Super does not let anything else through.
is(route(K.right, M.meta | M.control), 'consume');
is(route(K.right, M.meta | M.alt), 'consume');

// Every other modified key is swallowed: Ctrl+Left must not walk the
// carousel, and no chord may reach navigation by accident.
for (const mods of [M.control, M.alt, M.control | M.alt, M.alt | M.shift,
                    M.control | M.meta, M.control | M.alt | M.shift]) {
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

// X closes only an unmodified, non-repeat press in pane mode; every other X
// is still Stage's key and is swallowed rather than typed anywhere.
is(route(K.x, 0, PANE), 'close');
is(route(K.x, 0, LIST), 'consume');
is(route(K.x, M.shift, PANE), 'consume');
is(route(K.x, 0, PANE, { isAutoRepeat: true }), 'consume');
is(route(K.escape, 0, PANE, { isAutoRepeat: true }), 'consume'); // a held Escape never dismisses

// A held thumbnail: Escape cancels the drag, nothing else moves the selection.
const DRAG = { panes: false, dragPending: true };
is(route(K.escape, 0, DRAG), 'dragCancel');
is(route(K.escape, 0, DRAG, { isAutoRepeat: true }), 'consume');
for (const [key, mods] of [[K.right, 0], [K.up, 0], [K.ret, 0], [K.tab, 0],
                           [0x31, 0], [K.right, M.shift]])
  is(route(key, mods, DRAG), 'consume');

// Releases. Only the modifier hold-to-cycle is waiting on commits, and only
// where a step armed it: an overlay that was never stepped goes on meaning
// hide, and a gesture in progress owns the keyboard.
const ARMED = { panes: false, armed: true };
const release = (key, ctx, extra) =>
  L.routeKey(Object.assign({ type: 'release', key: key, modifiers: 0,
                             isAutoRepeat: false }, extra || {}), ctx);
for (const key of [K.meta, K.superL, K.superR]) {
  is(release(key, ARMED), 'commit');
  is(release(key, LIST), 'none', null);          // never stepped
  is(release(key, { armed: true, dragPending: true }), 'none', null);
  is(release(key, ARMED, { isAutoRepeat: true }), 'none', null);
}
// Any other release is not a commit, however armed the overlay is.
for (const key of [K.escape, K.right, K.ret, K.x, K.tab, 0x31])
  is(release(key, ARMED), 'none', null);

// --- moveDestinationIndex -------------------------------------------------
// A move walks the row Stage is showing -- 1, 3, 7 -- never the next
// workspace number, never wrapping, and never off either end.
const SHOWN = [1, 3, 7];
assert.equal(L.moveDestinationIndex(SHOWN, 1, false), 1);
assert.equal(L.moveDestinationIndex(SHOWN, 3, false), 2);
assert.equal(L.moveDestinationIndex(SHOWN, 7, false), -1, 'no wrap past the end');
assert.equal(L.moveDestinationIndex(SHOWN, 7, true), 1);
assert.equal(L.moveDestinationIndex(SHOWN, 3, true), 0);
assert.equal(L.moveDestinationIndex(SHOWN, 1, true), -1, 'no wrap past the start');
assert.equal(L.moveDestinationIndex(SHOWN, 4, false), -1, 'a workspace not in the row');
assert.equal(L.moveDestinationIndex([], 1, false), -1);
assert.equal(L.moveDestinationIndex([5], 5, false), -1, 'nowhere to go');

// --- swapLua: rejected input ----------------------------------------------
for (const bad of ['', null, undefined, '0x', '0', '0000', 'zz', 'abc" })',
                   'ab cd', 'abc\nhl.dsp.exit({'])
  assert.equal(L.swapLua(bad, 'right', 1), '',
               'rejects address ' + JSON.stringify(bad));
for (const bad of ['', null, 'diagonal', 'LEFT', 'up-left'])
  assert.equal(L.swapLua('0xa', bad, 1), '',
               'rejects direction ' + JSON.stringify(bad));
for (const bad of [0, -1, 1.5, '3; hl.dsp.exit({', NaN, null, '3px', {}])
  assert.equal(L.swapLua('0xa', 'right', bad), '',
               'rejects workspace ' + JSON.stringify(bad));

// --- swapLua: the chunk ---------------------------------------------------
{
  const swap = L.swapLua('0XAB', 'up', 2);
  assert.ok(swap.startsWith('function()\n') && swap.endsWith('\nend'),
            'the chunk is one Lua expression');
  assert.ok(swap.includes('hl.get_window("address:0xab")'), 'lowercased, prefixed');
  assert.ok(swap.includes('s.workspace.id ~= 2'),
            'a window that has moved since is not rearranged');
  assert.ok(swap.includes('hl.get_windows({ workspace = s.workspace })'),
            "candidates come from the source's own workspace");
  assert.ok(swap.includes('t.monitor.id == s.monitor.id'), 'same monitor only');
  // Up and down measure along y and overlap on x; left and right the other
  // way. The axis names appear once, as locals.
  assert.ok(swap.includes('local along, across = "y", "x"'));
  assert.ok(swap.includes('local sign = -1'));
  assert.ok(L.swapLua('0xab', 'right', 2).includes('local along, across = "x", "y"'));
  assert.ok(L.swapLua('0xab', 'right', 2).includes('local sign = 1'));
  assert.ok(!swap.includes('hl.dsp.window.move'), 'a swap never moves');
  assert.equal((swap.match(/hl\.dispatch/g) || []).length, 2,
               'the swap, and the cursor Hyprland warped');
}

// --- the chunks, executed -------------------------------------------------
// Every scenario runs the generated Lua against tests/chunk.lua's mocked
// `hl`. In the `tiled` world 0xa is top-left, 0xb top-right, 0xc bottom-left
// and 0xd bottom-right of workspace 1, with 0xe alone on 3 and 0xf alone on 7.
const restored = ' cursor{x=640,y=480}';
const swapped = (source, target) =>
  'swap swap{target=address:' + target + ',window=address:' + source + '}' + restored;

const scenarios = [
  // 2x2: each direction picks the neighbour that shares a span with it.
  ['tiled', '0xa', 'right', 1, swapped('0xa', '0xb')],
  ['tiled', '0xa', 'down', 1, swapped('0xa', '0xc')],
  ['tiled', '0xd', 'left', 1, swapped('0xd', '0xc')],
  ['tiled', '0xd', 'up', 1, swapped('0xd', '0xb')],
  // Edges: there is nothing that way.
  ['tiled', '0xa', 'left', 1, 'noop '],
  ['tiled', '0xa', 'up', 1, 'noop '],
  ['tiled', '0xd', 'right', 1, 'noop '],
  ['tiled', '0xd', 'down', 1, 'noop '],
  // A window that only touches the source diagonally is not a neighbour.
  ['diagonal', '0xa', 'right', 1, 'noop '],
  ['diagonal', '0xa', 'down', 1, 'noop '],
  // A swap rearranges a tiling, so unsupported sources dispatch nothing.
  ['floating', '0xa', 'right', 1, 'noop '],
  ['grouped', '0xa', 'right', 1, 'noop '],
  ['fullscreen', '0xa', 'right', 1, 'noop '],
  ['fullscreenclient', '0xa', 'right', 1, 'noop '],
  ['unmapped', '0xa', 'right', 1, 'noop '],
  ['hiddensource', '0xa', 'right', 1, 'noop '],
  ['gone', '0xa', 'right', 1, 'noop '],
  // Unsupported and off-monitor candidates are skipped, not swapped with.
  ['candidates', '0xa', 'right', 1, swapped('0xa', '0xf')],
  // Ties: perpendicular distance first, then the address.
  ['ties', '0xa', 'right', 1, swapped('0xa', '0xc')],
  ['duplicates', '0xa', 'right', 1, swapped('0xa', '0xb')],
  // The window has moved since Stage drew it on workspace 1.
  ['stale', '0xa', 'right', 1, 'noop '],
];

for (const [world, source, direction, workspace, expected] of scenarios) {
  const lua = L.swapLua(source, direction, workspace);
  assert.notEqual(lua, '', 'a chunk for ' + [world, source, direction]);
  let out;
  try {
    out = execFileSync('lua', [path.join(__dirname, 'chunk.lua'), world],
                       { input: lua, encoding: 'utf8' });
  } catch (err) {
    throw new Error('lua failed for ' + [world, source, direction].join(' ')
                    + ': ' + (err.stderr || err.message));
  }
  assert.equal(out.trim(), expected.trim(), [world, source, direction].join(' '));
}

console.log('keyboard: key routing, move destinations, and ' + scenarios.length
            + ' Lua swap scenarios against a mocked compositor');
