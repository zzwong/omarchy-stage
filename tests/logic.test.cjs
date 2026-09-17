// Direct tests of StageLogic.js: the file Stage.qml imports is the file
// loaded here, verbatim, in a bare context (no QML, no compositor).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const L = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(root, 'StageLogic.js'), 'utf8'), L);

// --- addresses and dispatch strings ---------------------------------------
for (const bad of ['', null, undefined, '0x', '0', '0000', '0x000', 'xyz',
                   'abc" })', ' abcd', 'abc\nhl.dsp'])
  assert.equal(L.closeLua(bad), '', 'rejects ' + JSON.stringify(bad));
assert.equal(L.address('0xABC'), '0xabc');
assert.equal(L.address('abc'), '0xabc', 'Quickshell omits the 0x prefix');
assert.equal(L.closeLua('abc'), 'hl.dsp.window.close({ window = "address:0xabc" })');
assert.equal(L.focusWindowLua('0xABC'), 'hl.dsp.focus({ window = "address:0xabc" })');
assert.equal(L.focusWindowLua('nope'), '');
assert.equal(L.focusWorkspaceLua(3), 'hl.dsp.focus({ workspace = "3" })');
assert.equal(L.focusWorkspaceLua('4'), 'hl.dsp.focus({ workspace = "4" })');
assert.equal(L.focusWorkspaceLua('1" }) hl.dsp.exit({'), '', 'rejects injection');
assert.equal(L.focusWorkspaceLua(1.5), '');

// --- close requests --------------------------------------------------------
assert.equal(L.canRequest('0xa', ['0xa'], {}, 100), true);
assert.equal(L.canRequest('', ['0xa'], {}, 100), false, 'no address, no request');
assert.equal(L.canRequest('0xa', [], {}, 100), false, 'stale preview is a no-op');
assert.equal(L.canRequest('0xa', ['0xa'], { '0xa': 200 }, 100), false, 'debounced');
assert.equal(L.canRequest('0xa', ['0xa'], { '0xb': 200 }, 100), true, 'per address');
assert.equal(L.canRequest('0xa', ['0xa'], { '0xa': 200 }, 200), true,
             'a declined request may be retried once it expires');

// The module builds its objects in its own realm; compare own properties.
const own = o => Object.assign({}, o);
const list = a => Array.from(a);
assert.deepEqual(own(L.prunePending({ '0xa': 150, '0xb': 250 }, 200)), { '0xb': 250 },
                 'expired entries are dropped');
assert.deepEqual(own(L.prunePending({ '0xa': 250, '0xb': 250 }, 200, '0xa')),
                 { '0xb': 250 }, 'the closed window is dropped early');
assert.deepEqual(own(L.prunePending({}, 200)), {});
{
  const before = { '0xa': 250 };
  L.prunePending(before, 200, '0xa');
  assert.deepEqual(own(before), { '0xa': 250 }, 'the input is not mutated');
}

// --- panes -----------------------------------------------------------------
const pane = (addr, x, y) => ({ address: addr, lastIpcObject: { at: [x, y] } });
{
  const panes = L.sortPanes([pane('d', 960, 540), pane('b', 0, 540),
                             pane('c', 960, 0), pane('a', 0, 0)]);
  assert.deepEqual(list(panes).map(p => p.address), ['a', 'b', 'c', 'd'],
                   'left to right, then top to bottom');
  const unsorted = [pane('a', 10, 10)];
  assert.notEqual(L.sortPanes(unsorted), unsorted, 'returns a copy');
  assert.deepEqual(list(L.sortPanes([{ address: 'x' }, pane('y', -5, 0)]))
                    .map(p => p.address), ['y', 'x'], 'missing geometry sorts at 0');
}
assert.equal(L.paneIndexFor([pane('a', 0, 0), pane('b', 1, 0)], 'b'), 1);
assert.equal(L.paneIndexFor([pane('a', 0, 0)], 'b'), -1);
assert.equal(L.paneIndexFor([pane('a', 0, 0)], ''), -1, 'no selection');

assert.equal(L.neighborAfterClose(['b', 'a'], 'a', 0), 1, 'a reorder keeps the address');
assert.equal(L.neighborAfterClose(['b', 'c'], 'a', 0), 0, 'a close selects the next');
assert.equal(L.neighborAfterClose(['a'], 'b', 1), 0, 'the last close selects the previous');
assert.equal(L.neighborAfterClose([], 'a', 0), -1, 'an empty workspace leaves pane mode');
assert.equal(L.neighborAfterClose(['a'], '', -1), -1, 'never enters pane mode');

// --- workspaces ------------------------------------------------------------
assert.equal(L.nextWorkspaceId([]), 1);
assert.equal(L.nextWorkspaceId([1, 2, 5]), 6);
assert.equal(L.nextWorkspaceId([3]), 4, 'gaps are not filled');

assert.equal(L.membershipChanged([], []), false);
{
  const a = {}, b = {}, c = {};
  assert.equal(L.membershipChanged([a, b], [a, b]), false, 'an equal list is not a change');
  assert.equal(L.membershipChanged([a, b], [a, c]), true);
  assert.equal(L.membershipChanged([a], [a, b]), true);
  assert.equal(L.membershipChanged([a, b], [b, a]), true, 'a reorder is a change');
}

const sel = o => L.reconcileSelection(Object.assign(
  { ids: [], oldId: -1, oldIndex: -1, wasPlus: false, focusedId: -1, preserve: true }, o));
assert.equal(sel({ ids: [1, 2, 3], oldId: 2, oldIndex: 1 }), 1, 'kept selection keeps its id');
assert.equal(sel({ ids: [1, 2, 3], oldId: 2, oldIndex: 0 }), 1,
             'the id wins over the stale index');
assert.equal(sel({ ids: [1, 3], oldId: 2, oldIndex: 1 }), 1,
             'a removed selection falls to its neighbour');
assert.equal(sel({ ids: [1, 2], oldId: 3, oldIndex: 2 }), 1, 'clamped to the last slot');
assert.equal(sel({ ids: [], oldId: 1, oldIndex: 0 }), -1, 'nothing left to select');
assert.equal(sel({ ids: [1, 2, 3], wasPlus: true, oldIndex: 2 }), 3,
             'the "+" slot stays at the end');
assert.equal(sel({ ids: [1, 2, 3, 4], wasPlus: true, oldIndex: 3 }), 4,
             'and follows a new workspace');
assert.equal(sel({ ids: [1, 2, 3], oldId: 2, oldIndex: 1, focusedId: 3, preserve: false }), 2,
             'opening starts on the focused workspace');
assert.equal(sel({ ids: [1, 2, 3], oldId: 3, oldIndex: 2, focusedId: 9, preserve: false }), 0,
             'an unknown focus falls back to the first');
assert.equal(sel({ ids: [1, 2, 3], oldId: 3, oldIndex: 2, focusedId: 3, preserve: true }), 2,
             'a reconcile never jumps to the focused workspace');
assert.equal(sel({ ids: [], preserve: false }), -1);

// --- compositor events -----------------------------------------------------
for (const name of ['openwindow', 'closewindow', 'movewindow', 'movewindowv2',
                    'changefloatingmode', 'fullscreen', 'fullscreenv2',
                    'createworkspace', 'createworkspacev2', 'destroyworkspace',
                    'destroyworkspacev2', 'moveworkspace', 'moveworkspacev2',
                    'togglegroup', 'moveintogroup', 'moveoutofgroup',
                    'monitoradded', 'monitoraddedv2', 'monitorremoved',
                    'monitorremovedv2', 'an-event-hyprland-adds-later'])
  assert.equal(L.shouldRefresh(name), true, name + ' can have moved a window');
for (const name of ['windowtitle', 'windowtitlev2', 'activewindow', 'activewindowv2',
                    'workspace', 'workspacev2', 'focusedmon', 'focusedmonv2',
                    'urgent', 'submap', 'activelayout', 'activespecial',
                    'activespecialv2', 'screencast', 'screencastv2', 'pin',
                    'minimized', 'bell',
                    'configreloaded', 'openlayer', 'closelayer'])
  assert.equal(L.shouldRefresh(name), false,
               name + ' must not cost an IPC round trip');

// --- close control placement ----------------------------------------------
const SIZE = 32, PAD = 8;

// A 1920x1080 monitor drawn into one expanded carousel slab: the workspace
// content overscans the slab by 4% and the slab masks it to a parallelogram
// sheared by `skew`.
function carousel(win, opts) {
  opts = opts || {};
  const slab = { width: 900, height: 506, skew: opts.skew === undefined ? 36 : opts.skew };
  const overscan = 1.04, aspect = 1920 / 1080;
  const contentH = slab.height * overscan, contentW = contentH * aspect;
  const content = { x: (slab.width - contentW) / 2, y: (slab.height - contentH) / 2 };
  const sx = contentW / 1920, sy = contentH / 1080;
  const thumb = { x: win.x * sx, y: win.y * sy, width: win.w * sx, height: win.h * sy,
                  scale: opts.scale || 1 };
  const spot = L.closeControlPosition({ thumb, content, slab, size: SIZE, pad: PAD });
  return { slab, content, thumb, spot };
}

// Corners of the placed control in slab coordinates, through the same pane
// zoom the thumbnail is under.
function corners(c) {
  const t = c.thumb, s = c.spot;
  const toSlab = (px, py) => ({
    x: c.content.x + t.x + t.width / 2 + (px - t.width / 2) * t.scale,
    y: c.content.y + t.y + t.height / 2 + (py - t.height / 2) * t.scale,
  });
  return [toSlab(s.x, s.y), toSlab(s.x + SIZE, s.y), toSlab(s.x, s.y + SIZE),
          toSlab(s.x + SIZE, s.y + SIZE)];
}

// Inside the slab's skewed mask: the top edge starts at `skew`, the bottom
// edge ends `skew` short of the right.
function insideMask(c, p) {
  const { width, height, skew } = c.slab;
  return p.y >= 0 && p.y <= height
    && p.x >= skew * (1 - p.y / height) - 1e-9
    && p.x <= width - skew * p.y / height + 1e-9;
}

function assertPlaced(c, what) {
  assert.ok(c.spot.visible, what + ': control is shown');
  assert.ok(c.spot.x >= 0 && c.spot.x + SIZE <= c.thumb.width + 1e-9,
            what + ': inside the thumbnail horizontally (x=' + c.spot.x + ')');
  assert.ok(c.spot.y >= 0 && c.spot.y + SIZE <= c.thumb.height + 1e-9,
            what + ': inside the thumbnail vertically (y=' + c.spot.y + ')');
  for (const p of corners(c))
    assert.ok(insideMask(c, p), what + ': corner ' + JSON.stringify(p) + ' is inside the mask');
}

// The case that used to clip: a tiled window in the top-right corner, whose
// own top-right corner is outside both the overscan fringe and the shear.
assertPlaced(carousel({ x: 970, y: 10, w: 940, h: 520 }), 'top-right tiled window');
assertPlaced(carousel({ x: 970, y: 10, w: 940, h: 520 }, { scale: 1.03 }),
             'top-right tiled window, pane zoom');
assertPlaced(carousel({ x: 0, y: 0, w: 1920, h: 1080 }), 'full-screen window');
assertPlaced(carousel({ x: 0, y: 0, w: 1920, h: 1080 }, { scale: 1.03 }),
             'full-screen window, pane zoom');
assertPlaced(carousel({ x: 10, y: 10, w: 940, h: 520 }), 'top-left tiled window');
assertPlaced(carousel({ x: 970, y: 550, w: 940, h: 520 }), 'bottom-right tiled window');
assertPlaced(carousel({ x: 500, y: 300, w: 900, h: 500 }), 'floating window');
{
  // The top-right window pushed against the skew: without the correction the
  // control would sit at the thumbnail's own inset corner.
  const c = carousel({ x: 970, y: 10, w: 940, h: 520 });
  assert.ok(c.spot.x < c.thumb.width - PAD - SIZE - 1,
            'the control is pushed in from the thumbnail corner by the shear');
  assert.ok(c.spot.y > PAD, 'and down from the top by the overscan fringe');
  const flat = carousel({ x: 970, y: 10, w: 940, h: 520 }, { skew: 0 });
  assert.ok(flat.spot.x > c.spot.x, 'an unsheared slab needs less correction');
}
// Too small to hold a control at all.
{
  const tiny = carousel({ x: 1700, y: 900, w: 100, h: 100 });
  assert.equal(tiny.spot.visible, false, 'a thumbnail under two controls wide has no control');
}
// A narrow window against the slab's advancing left edge: wide enough to pass
// the size gate, but the left clamp pushes the control right past the
// thumbnail's own width. Hidden, or fully contained -- never half off.
{
  const slab = { width: 900, height: 506, skew: 36 };
  const content = { x: -17.6, y: -10.12 };
  for (let w = 68; w <= 78; w++) {
    const thumb = { x: 0, y: 0, width: w, height: 300, scale: 1 };
    const spot = L.closeControlPosition({ thumb, content, slab, size: SIZE, pad: PAD });
    assert.ok(!spot.visible
              || (spot.x >= 0 && spot.x + SIZE <= w
                  && spot.y >= 0 && spot.y + SIZE <= thumb.height),
              'a ' + w + 'px top-left thumbnail: hidden or contained, got x='
              + spot.x + ' visible=' + spot.visible);
  }
}
// A card: no shear, no overscan, but the card clips a window that hangs over
// the monitor edge.
{
  const card = { width: 400, height: 225, skew: 0 };
  const hanging = L.closeControlPosition({
    thumb: { x: 320, y: 20, width: 200, height: 120, scale: 1 },
    content: { x: 0, y: 0 }, slab: card, size: SIZE, pad: PAD });
  assert.ok(hanging.visible, 'still shown');
  assert.ok(320 + hanging.x + SIZE <= card.width - PAD + 1e-9,
            'kept inside the card, not at the thumbnail corner');
  const inside = L.closeControlPosition({
    thumb: { x: 40, y: 20, width: 200, height: 120, scale: 1 },
    content: { x: 0, y: 0 }, slab: card, size: SIZE, pad: PAD });
  assert.equal(inside.x, 200 - PAD - SIZE, 'an unclipped card thumbnail uses its own corner');
  assert.equal(inside.y, PAD);
}

// --- glyph contrast --------------------------------------------------------
{
  const dark = { r: 0.09, g: 0.09, b: 0.12 };   // menu background
  const light = { r: 0.85, g: 0.87, b: 0.92 };  // foreground
  const lightAccent = { r: 0.72, g: 0.78, b: 0.98 };
  const darkAccent = { r: 0.11, g: 0.16, b: 0.30 };
  assert.equal(L.contrastColor(lightAccent, light, dark), dark,
               'a light accent fill takes the dark token');
  assert.equal(L.contrastColor(darkAccent, light, dark), light,
               'a dark accent fill takes the light token');
  assert.equal(L.contrastColor(dark, light, dark), light, 'the resting fill takes the foreground');
  assert.ok(L.luminance(light) > L.luminance(dark));
}

console.log('StageLogic: addresses, dispatch strings, panes, workspaces, events, placement, contrast');
