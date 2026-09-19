// Direct tests of StageLogic.js's drag section: the same file Stage.qml
// imports, loaded verbatim in a bare context. Qt owns the threshold, the grab
// and which thumbnail was picked up; what is left is decided here, so none of
// this needs a compositor or a pointer.
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { StageLogic: L } = require('./load.cjs');

// --- the move chunk --------------------------------------------------------
// Only a validated handle and a positive integer workspace id are ever
// interpolated; everything else the move depends on is read inside Hyprland.
{
  const move = L.moveLua('0xABC', '3');
  assert.ok(move.startsWith('function()\n') && move.endsWith('\nend'),
            'the chunk is one Lua expression');
  assert.ok(move.includes('hl.get_window("address:0xabc")'), 'lowercased, prefixed');
  assert.ok(move.includes('hl.get_workspace(3)'),
            'the destination is looked up by integer id, not by name');
  assert.ok(move.includes('follow = false'), 'the desktop workspace stays put');
  assert.equal((move.match(/hl\.dispatch/g) || []).length, 1, 'one dispatch');
  assert.equal(L.moveLua('abc', 3), L.moveLua('0xABC', '3'),
               'the same window and workspace give the same chunk');
  // What it deliberately does not look at: `movetoworkspacesilent` handles a
  // floating or fullscreen window perfectly well, and only a swap needs a
  // tiling to rearrange. Nothing in the chunk can refuse one.
  for (const field of ['floating', 'fullscreen'])
    assert.ok(!move.includes(field), 'a ' + field + ' source is not inspected');
}
for (const bad of ['', null, undefined, '0x', '0', 'xyz', 'abc" })',
                   'abc\nhl.dsp.exit({'])
  assert.equal(L.moveLua(bad, 3), '', 'rejects address ' + JSON.stringify(bad));
for (const bad of [0, -1, 1.5, 'nope', '3" }) hl.dsp.exit({', null, NaN, {}])
  assert.equal(L.moveLua('abc', bad), '', 'rejects id ' + JSON.stringify(bad));

// The chunk, executed against a mocked compositor: one guard decides what a
// move may do, whether a thumbnail or a keyboard chord asked for it. Every
// world below differs from the ordinary one in something the chunk reads.
const moved = (source, workspace) =>
  'move move{follow=false,window=address:' + source + ',workspace=' + workspace + '}';
const scenarios = [
  // The ordinary case, and the source's own state at the moment it runs.
  ['tiled', '0xa', 3, moved('0xa', 3)],
  ['gone', '0xa', 3, 'noop '],
  ['unmapped', '0xa', 3, 'noop '],
  ['hiddensource', '0xa', 3, 'noop '],
  // A move takes the whole group with it, so a grouped window never moves.
  ['grouped', '0xa', 3, 'noop '],
  // A destination on another monitor is refused. One that does not exist is
  // refused too, unless the "+" slot asked for it: then the move creates it.
  ['foreignmonitor', '0xa', 3, 'noop '],
  ['missing', '0xa', 3, 'noop '],
  ['missing', '0xa', 3, moved('0xa', 3), true],
];
for (const [world, source, destination, expected, create] of scenarios) {
  const lua = L.moveLua(source, destination, create);
  assert.notEqual(lua, '', 'a chunk for ' + [world, source, destination]);
  let out;
  try {
    out = execFileSync('lua', [path.join(__dirname, 'chunk.lua'), world],
                       { input: lua, encoding: 'utf8' });
  } catch (err) {
    throw new Error('lua failed for ' + [world, source, destination].join(' ')
                    + ': ' + (err.stderr || err.message));
  }
  assert.equal(out.trim(), expected.trim(), [world, source, destination].join(' '));
}

// --- grouped windows -------------------------------------------------------
// The chunk refuses a grouped window; this is the affordance that keeps its
// thumbnail's handler disabled, so the drag never starts.
assert.equal(L.isGrouped({ grouped: ['0xa', '0xb'] }), true);
assert.equal(L.isGrouped({ grouped: [] }), false);
assert.equal(L.isGrouped({}), false);
assert.equal(L.isGrouped(null), false);
assert.equal(L.isGrouped(undefined), false);

// --- where a drop lands ----------------------------------------------------
const ws = id => ({ id: id });
const w1 = ws(1), w2 = ws(2), w3 = ws(3);
const live = [w1, w2, w3];
const card = w => ({ id: w ? w.id : 0, workspace: w || null });
const drop = (hit, over) => L.dropDecision(Object.assign(
  { hit: hit, dragWorkspace: 1, sourceLive: true, shownIds: [1, 2, 3],
    workspaces: live }, over));

assert.equal(drop(card(w3)), 3, 'another workspace takes the window');
assert.equal(drop(card(w1)), 0, 'same workspace is a no-op, not a reorder');
assert.equal(drop(null), 0, 'released over no card at all');
assert.equal(drop(card(w3), { sourceLive: false }), 0,
             'the window was closed or moved away mid-drag');
assert.equal(drop({ id: 3, workspace: ws(3) }), 0,
             'a destination destroyed and recreated is not the one aimed at');
assert.equal(drop(card(w3), { workspaces: [w1, w2] }), 0,
             'a destination that is simply gone');
assert.equal(drop(card(null)), 4, 'the "+" slot creates the next id');
assert.equal(drop(card(null), { shownIds: [1, 9], workspaces: [w1, ws(9)] }), 10,
             '"+" is decided at release, from the live ids');
assert.equal(drop(card(null), { sourceLive: false }), 0,
             '"+" with a stale source creates nothing');
// Multi-monitor: the "+" card counts the workspaces Stage is showing — the
// focused monitor's — so the drop creates the workspace the caption names,
// not one numbered from every monitor's workspaces at once.
{
  const elsewhere = live.concat([ws(40), ws(41)]);
  assert.equal(drop(card(null), { workspaces: elsewhere }), 4);
  assert.equal(L.nextWorkspaceId([1, 2, 3]), 4, 'and 4 is what the card says');
}

// --- the card a release is allowed to land on ------------------------------
// The grid re-lays out when workspaces come and go, so the card that ends up
// under a standing pointer is not the one the highlight named.
{
  const slab = { name: 'card' };
  const shown = { id: 2, workspace: w2, slab: slab };
  assert.equal(L.sameCard({ id: 2, workspace: w2, slab: slab }, shown), true);
  assert.equal(L.sameCard({ id: 3, workspace: w3, slab: slab }, shown), false,
               'the same card now showing another workspace');
  assert.equal(L.sameCard({ id: 2, workspace: ws(2), slab: slab }, shown), false,
               'a recreated workspace with the same id');
  assert.equal(L.sameCard({ id: 2, workspace: w2, slab: { name: 'other' } }, shown),
               false, 'the same workspace on another card');
  assert.equal(L.sameCard(null, shown), false);
  assert.equal(L.sameCard(shown, null), false, 'nothing was highlighted');
}

// --- the gesture's lifetime ------------------------------------------------
// DragHandler.dragThreshold gets this, so Qt decides what is a click.
assert.equal(L.DRAG_THRESHOLD, 12);

const start = over => L.dragTransition(L.dragIdle(), Object.assign(
  { type: 'start', address: '0xaa', workspace: 1, title: 'Editor' }, over));

// A drag begins with what the grabbed delegate is showing, normalized on the
// way in: every later dispatch and binding reads it from here.
{
  const idle = L.dragIdle();
  assert.equal(idle.phase, 'idle');
  const begun = start();
  assert.equal(begun.action, 'none');
  assert.equal(begun.state.phase, 'dragging');
  assert.equal(begun.state.address, '0xaa');
  assert.equal(begun.state.workspace, 1);
  assert.equal(begun.state.title, 'Editor');
  assert.equal(start({ address: 'AA' }).state.address, '0xaa', 'prefixed, lowercased');
  assert.equal(start({ title: null }).state.title, '', 'a window with no title');
}

// The release of a live drag is the only event that moves anything, and the
// state it leaves behind names no window and holds no card: a binding that
// watches a drag must not go on scanning for a gesture that is over.
{
  const done = L.dragTransition(start().state, { type: 'release' });
  assert.equal(done.action, 'move');
  assert.deepEqual(done.state, L.dragIdle(), 'back to the neutral state');
  assert.equal(done.state.address, '', 'the idle state names no window');
  assert.equal('hit' in done.state, false, 'and holds no card');
  assert.equal('slab' in done.state, false, 'and no item of the grid');
}

// Escape, a lost grab and a window that went away all end it where it stands,
// and the release that follows must not move anything.
for (const ender of ['escape', 'cancel', 'sourceGone']) {
  const ended = L.dragTransition(start().state, { type: ender });
  assert.equal(ended.action, 'none', ender + ' does nothing by itself');
  assert.deepEqual(ended.state, L.dragIdle(), ender + ' ends the gesture');
  assert.equal(L.dragTransition(ended.state, { type: 'release' }).action, 'none',
               'the release after ' + ender + ' moves nothing');
}
assert.equal(L.dragTransition(L.dragIdle(), { type: 'release' }).action, 'none',
             'a release with no gesture at all');
assert.equal(L.dragTransition(null, { type: 'release' }).action, 'none',
             'and one with no state at all');

// The input is never mutated: every transition returns a fresh state.
{
  const s = start().state;
  const before = JSON.stringify(s);
  L.dragTransition(s, { type: 'release' });
  L.dragTransition(s, { type: 'escape' });
  assert.equal(JSON.stringify(s), before);
}

console.log('drag: the gesture\'s lifetime, where a drop lands, and '
            + scenarios.length + ' Lua move scenarios against a mocked compositor');
