// Direct tests of StageLogic.js's drag section: the same file Stage.qml
// imports, loaded verbatim in a bare context. Qt owns the threshold, the grab
// and which thumbnail was picked up; what is left is decided here, so none of
// this needs a compositor or a pointer.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const L = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(root, 'StageLogic.js'), 'utf8'), L);

// --- the dispatch string ---------------------------------------------------
assert.equal(L.moveLua('abc', 3),
             'hl.dsp.window.move({ window = "address:0xabc", workspace = "3", '
             + 'follow = false })');
assert.equal(L.moveLua('0xABC', '4'),
             'hl.dsp.window.move({ window = "address:0xabc", workspace = "4", '
             + 'follow = false })', 'ids are coerced to integers');
for (const bad of ['', null, undefined, '0x', '0', 'xyz', 'abc" })',
                   'abc\nhl.dsp.exit({'])
  assert.equal(L.moveLua(bad, 3), '', 'rejects address ' + JSON.stringify(bad));
for (const bad of [0, -1, 1.5, 'nope', '3" }) hl.dsp.exit({', null, NaN])
  assert.equal(L.moveLua('abc', bad), '', 'rejects id ' + JSON.stringify(bad));

// --- grouped windows -------------------------------------------------------
// Moving a group member moves the whole group, so a grouped thumbnail's
// handler stays disabled and the drag never starts.
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

console.log('drag: the gesture\'s lifetime, where a drop lands, '
            + 'and the dispatch string');
