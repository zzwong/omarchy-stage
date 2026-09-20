// Stage's pure logic: every decision the overlay makes that does not need a
// live compositor. Stage.qml imports this as `StageLogic` and the tests load
// this same file with node's `vm`, so what ships is what is tested. No
// `.pragma library` (node loads the source verbatim) and no side effects.

// --- Addresses and dispatches ----------------------------------------------

// Quickshell reports toplevel addresses without the 0x prefix and Hyprland
// wants it. Anything that is not a plain non-zero hex handle is rejected, so
// a crafted title can never reach a dispatcher string.
function address(value) {
    var s = String(value || "").toLowerCase().replace(/^0x/, "")
    return /^[0-9a-f]+$/.test(s) && !/^0+$/.test(s) ? "0x" + s : ""
}

function closeLua(value) {
    var addr = address(value)
    return addr ? 'hl.dsp.window.close({ window = "address:' + addr + '" })' : ""
}

function focusWindowLua(value) {
    var addr = address(value)
    return addr ? 'hl.dsp.focus({ window = "address:' + addr + '" })' : ""
}

// A workspace id as Hyprland will take it: a positive integer and nothing
// else, so no dispatch string ever interpolates something a title or a
// settings file could have written. 0 means "not one".
function workspaceId(value) {
    var n = Number(value)
    return Number.isFinite(n) && Math.floor(n) === n && n > 0 ? n : 0
}

function focusWorkspaceLua(id) {
    var n = workspaceId(id)
    return n ? 'hl.dsp.focus({ workspace = ' + n + ' })' : ""
}

// --- Close requests --------------------------------------------------------

// A close is worth sending when the window is still live and no request for
// it is still within its debounce window.
function canRequest(addr, live, pending, now) {
    return !!addr && live.indexOf(addr) >= 0 && !(pending[addr] > now)
}

// Copy of `pending` without expired entries, and without `drop` (the address
// the compositor just told us is gone) when one is given.
function prunePending(pending, now, drop) {
    var next = {}
    for (var key in pending)
        if (pending[key] > now && key !== drop) next[key] = pending[key]
    return next
}

// --- Panes -----------------------------------------------------------------

// Windows of a workspace in column-major order: left to right, and top to
// bottom within a column. Pane stepping and the title pills share it, so
// ←/→ walks a tiled column before moving across.
function sortPanes(toplevels) {
    var arr = []
    for (var i = 0; i < toplevels.length; i++) arr.push(toplevels[i])
    arr.sort(function(a, b) {
        var ia = a.lastIpcObject, ib = b.lastIpcObject
        var ax = ia && ia.at ? ia.at[0] : 0, bx = ib && ib.at ? ib.at[0] : 0
        if (ax !== bx) return ax - bx
        var ay = ia && ia.at ? ia.at[1] : 0, by = ib && ib.at ? ib.at[1] : 0
        return ay - by
    })
    return arr
}

function paneIndexFor(panes, address) {
    if (!address) return -1
    for (var i = 0; i < panes.length; i++)
        if (String(panes[i].address) === address) return i
    return -1
}

// When the selected window goes away -- closed here, or moved off this
// workspace -- hand pane mode to the window that stood next to it rather than
// to whatever has since moved into its slot: a close re-tiles the survivors,
// so the index the selection used to have names a different window by the
// time this runs.
//
//   prev      pane addresses as they were before the change
//   next      pane addresses now
//   selected  the address that has gone
// Returns its index in `next`, or -1 to leave pane mode.
function neighborAfterClose(prev, next, selected) {
    var at = prev.indexOf(selected)
    if (at < 0) return -1
    // The window after it, then the one before; and outwards from there, so a
    // burst that took several windows at once still lands on a survivor.
    for (var i = at + 1; i < prev.length; i++) {
        var after = next.indexOf(prev[i])
        if (after >= 0) return after
    }
    for (var j = at - 1; j >= 0; j--) {
        var before = next.indexOf(prev[j])
        if (before >= 0) return before
    }
    return -1
}

// --- Workspaces ------------------------------------------------------------

function nextWorkspaceId(ids) {
    var max = 0
    for (var i = 0; i < ids.length; i++) if (ids[i] > max) max = ids[i]
    return max + 1
}

// True only when the rebuilt list is a different set of workspace objects:
// reassigning an equal list recreates every delegate, and with it every live
// capture.
function membershipChanged(oldList, newList) {
    if (oldList.length !== newList.length) return true
    for (var i = 0; i < newList.length; i++)
        if (oldList[i] !== newList[i]) return true
    return false
}

// The single index `rebuildWorkspaces` assigns. Selection is owned by the
// workspace id, not by its position: the compositor may renumber, insert or
// remove workspaces under an open overlay.
//   o.ids       workspace ids of the rebuilt list, in order
//   o.oldId     id the selection was on (-1 when there was none)
//   o.oldIndex  where it sat, used only when its id is gone
//   o.wasPlus   the trailing "new workspace" slot was selected
//   o.focusedId compositor's focused workspace (-1 when none)
//   o.preserve  false on open: start from the focused workspace instead
function reconcileSelection(o) {
    var ids = o.ids
    if (!o.preserve) {
        var index = ids.length > 0 ? 0 : -1
        for (var j = 0; j < ids.length; j++) if (ids[j] === o.focusedId) index = j
        return index
    }
    if (o.wasPlus) return ids.length // the "+" slot keeps its place at the end
    var found = ids.indexOf(o.oldId)
    if (found >= 0) return found
    return ids.length > 0 ? Math.min(Math.max(0, o.oldIndex), ids.length - 1) : -1
}

// --- Compositor events -----------------------------------------------------

// Window geometry lives in each toplevel's lastIpcObject, which only changes
// when something asks Hyprland for it, so Stage refreshes after the events
// that can have moved a window.
//
// That is almost all of them, which is why this is a denylist. An allowlist
// of the obvious movers missed `togglegroup`, `moveintogroup`,
// `moveoutofgroup` and a monitor appearing or going away; and several
// dispatchers re-tile while announcing nothing at all (`swapwindow`,
// `resizeactive`, `layoutmsg`, `centerwindow`, `movewindow` within a
// workspace), for which a neighbouring event is the only hint there is. Name
// the events that provably change nothing Stage draws -- titles, focus,
// layers, audio -- and let the caller's coalescing pay for the rest.
var QUIET_EVENTS = [
    "windowtitle", "windowtitlev2", "activewindow", "activewindowv2",
    "workspace", "workspacev2", "focusedmon", "focusedmonv2", "urgent",
    "submap", "activelayout", "activespecial", "activespecialv2",
    "screencast", "screencastv2", "pin", "minimized", "bell", "configreloaded",
    "openlayer", "closelayer"]

function shouldRefresh(eventName) {
    return QUIET_EVENTS.indexOf(String(eventName)) < 0
}

// --- Geometry --------------------------------------------------------------

// Where a close control sits on a thumbnail, in thumbnail coordinates.
//
// The carousel slab masks its content to a skewed parallelogram and the
// workspace content overscans that mask, so a control anchored to the
// thumbnail's own top-right corner is cut for every window that touches the
// slab's top or right edge. Anchor it to the visible intersection instead:
// the same corner wherever that corner is fully visible, pushed in by the
// overscan fringe and the skew allowance where it is not.
//
//   o.thumb    {x, y, width, height, scale} in content coordinates; pane zoom
//              scales the thumbnail about its own centre
//   o.content  {x, y} of the overscanned workspace content inside the slab
//   o.slab     {width, height, skew}; skew 0 is an unskewed card
//   o.size     control side, o.pad  gap kept from every visible edge
// Returns {x, y, visible}; visible is false when even the clamped control
// would not fit inside the thumbnail.
function closeControlPosition(o) {
    var t = o.thumb, c = o.content, s = o.slab
    var size = o.size, pad = o.pad
    var scale = t.scale || 1
    function toSlabY(py) { return c.y + t.y + t.height / 2 + (py - t.height / 2) * scale }
    function fromSlabX(sx) { return (sx - c.x - t.x - t.width / 2) / scale + t.width / 2 }
    function fromSlabY(sy) { return (sy - c.y - t.y - t.height / 2) / scale + t.height / 2 }

    var y = Math.min(Math.max(pad, fromSlabY(pad)),
                     Math.max(0, t.height - size - pad))
    var h = Math.max(1, s.height)
    // The mask's right edge recedes with the shear, so the control's
    // lower-right corner is the binding one; its left edge advances with the
    // shear, so there the upper-left corner binds.
    var lowY = Math.max(0, toSlabY(y + size))
    var rightAt = s.width - s.skew * lowY / h - pad
    var highY = Math.max(0, toSlabY(y))
    var leftAt = s.skew * (1 - highY / h) + pad
    var x = Math.max(Math.min(t.width - pad - size, fromSlabX(rightAt) - size),
                     fromSlabX(leftAt))
    return {
        x: x,
        y: y,
        // Both clamps can lose: a narrow thumbnail against the slab's
        // advancing left edge is pushed right past its own width, and a short
        // one past its own height. Hide rather than draw a control hanging
        // off the preview it belongs to.
        visible: t.width >= size * 2 && t.height >= size * 2
                 && x >= 0 && x + size <= t.width
                 && y >= 0 && y + size <= t.height
    }
}

// --- Colour ----------------------------------------------------------------

function luminance(c) { return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b }

// The accent fill on hover can be lighter or darker than the menu background
// depending on the theme, and a foreground glyph on a light accent is
// unreadable. Pick whichever theme token contrasts more with the fill that is
// actually painted.
function contrastColor(fill, a, b) {
    var f = luminance(fill)
    return Math.abs(luminance(a) - f) >= Math.abs(luminance(b) - f) ? a : b
}

// --- Drag ------------------------------------------------------------------
//
// Dragging a grid thumbnail onto another workspace card. The gesture itself
// is a DragHandler on the thumbnail, so Qt decides what is a click and what
// is a drag and which item the pointer picked up; what is left -- where a
// drop may land, what the move is allowed to do, and when the gesture is
// over -- is decided here, with no pointer and no compositor.

// How far the pointer must travel before a press becomes a drag rather than
// a click, in logical pixels. Handed to DragHandler.dragThreshold.
var DRAG_THRESHOLD = 12

// `hl.dsp.window.move` with a selector naming a grouped window moves the
// whole group, which is never what dragging one thumbnail asks for. The
// refusal itself is in the move chunk, in the compositor; this is the
// affordance, so a grouped thumbnail does not lift in the first place.
function isGrouped(ipc) {
    return !!(ipc && ipc.grouped && ipc.grouped.length > 0)
}

// Moving a window to another workspace, as one Lua chunk Hyprland runs: it
// resolves the window, checks it and moves it in one call, so nothing is
// decided against state read before the dispatch. Both ways of asking -- a
// dragged thumbnail and Ctrl+Shift+arrow -- build this one chunk, so the two
// can never come to disagree about what a move is allowed to do.
//
// It refuses a window the compositor no longer has, one that is unmapped or
// hidden, and one in a group, because `hl.dsp.window.move` takes the whole
// group with it. Floating and fullscreen windows move perfectly well and are
// not refused; the swap chunk is stricter because a swap rearranges a tiling.
// A destination that exists must be on the source's monitor; one that does
// not exist yet is created, which is what the grid's "+" slot asks for.
//
// `follow = false`: the compositor keeps its focus and Stage stays open on
// the workspace the user is looking at. Returns "" for input it will not
// build a chunk for; "move" or "noop" for what it did.
function moveLua(value, id, create) {
    var window = address(value)
    var dest = workspaceId(id)
    if (!window || !dest) return ""
    var selector = '"address:' + window + '"'
    return [
        'function()',
        '  local s = hl.get_window(' + selector + ')',
        '  if s == nil or not s.mapped or s.hidden or s.group ~= nil',
        '      or s.monitor == nil then return "noop" end',
        '  local target = hl.get_workspace(' + dest + ')',
        '  if target == nil then',
        // Only the "+" slot may bring a workspace into being; a card whose
        // workspace vanished under the pointer, or a keyboard move whose row
        // entry is gone, is refused rather than recreated.
        create ? '    -- the "+" slot: the move itself creates it'
               : '    return "noop"',
        '  elseif target.monitor == nil or target.monitor.id ~= s.monitor.id then',
        '    return "noop"',
        '  end',
        '  hl.dispatch(hl.dsp.window.move({ window = ' + selector + ',',
        '    workspace = ' + dest + ', follow = false }))',
        '  return "move"',
        'end'
    ].join('\n')
}

// The workspace a drop lands on, or 0 for "do nothing". Re-decided from live
// compositor state, both while the pointer hovers (so the highlight can never
// promise an illegal move) and again at release.
//   o.hit           the card under the pointer: {id, workspace, slab}, id 0
//                   is the "+" slot, null when the pointer is over no card
//   o.dragWorkspace workspace the dragged window was picked up from
//   o.sourceLive    the window still exists, on that same workspace
//   o.shownIds      ids of the workspaces Stage is showing -- the focused
//                   monitor's, the same list the "+" card's caption counts
//                   from, so a drop creates the workspace the card names
//   o.workspaces    the compositor's live workspace objects, every monitor's
function dropDecision(o) {
    var hit = o.hit
    if (!hit || !o.sourceLive) return 0
    if (hit.id === 0) // the "+" slot: whatever id it would create right now
        return nextWorkspaceId(o.shownIds || [])
    if (hit.id === o.dragWorkspace) return 0 // same workspace: no reordering
    // Identity, not just the id: a workspace destroyed and recreated under the
    // pointer is a different workspace that nobody aimed at.
    var live = o.workspaces || []
    for (var j = 0; j < live.length; j++)
        if (live[j] === hit.workspace && live[j].id === hit.id) return hit.id
    return 0
}

// Two hits name the same card. A release only moves a window where the
// highlight promised it would: the cards slide under a standing pointer when
// the workspace list changes, and whatever arrives under it is not what
// anybody aimed at.
function sameCard(a, b) {
    return !!a && !!b && a.slab === b.slab && a.id === b.id
        && a.workspace === b.workspace
}

// The gesture's lifetime, as one pure transition. The threshold, the grab and
// which thumbnail was picked up are Qt's to decide -- a drag begins when the
// handler goes active -- so what is left is what the gesture is carrying and
// whether a release still counts:
//   phase       "idle" | "dragging"
//   address     the dragged window, normalized
//   workspace   id of the card it was picked up from, as the model gave it:
//               nothing interpolates it, it is only ever compared
//   title       proxy label
// Events: {type: "start", address, workspace, title}, {type: "release"}, and
// "escape" / "cancel" / "sourceGone", which end the gesture where it stands.
//
// Returns the next state and, separately, the one thing the caller must do
// because of this transition -- "move" or "none". The result is not the
// state: an idle state carrying the last gesture's window would keep every
// binding that watches a live drag scanning for it.
function dragIdle() {
    return { phase: "idle", address: "", workspace: 0, title: "" }
}

function dragTransition(state, event) {
    var s = state || dragIdle()
    if (event.type === "start")
        return { state: { phase: "dragging", address: address(event.address),
                          workspace: event.workspace,
                          title: event.title ? String(event.title) : "" },
                 action: "none" }
    // Everything else ends the gesture, and only the release of one that is
    // still running does anything: a release after an Escape, a lost grab or
    // a window that went away must not move a thing.
    return { state: dragIdle(),
             action: event.type === "release" && s.phase === "dragging"
                 ? "move" : "none" }
}

// --- Keyboard editing ------------------------------------------------------
//
// Qt enum values are repeated here so tests can load this module without QML.
var KEY = {
    escape: 0x01000000, tab: 0x01000001, backtab: 0x01000002,
    ret: 0x01000004, enter: 0x01000005,
    left: 0x01000012, up: 0x01000013, right: 0x01000014, down: 0x01000015,
    meta: 0x01000022, superL: 0x01000053, superR: 0x01000054,
    zero: 0x30, nine: 0x39, x: 0x58
}

var MOD = {
    none: 0x00000000, shift: 0x02000000, control: 0x04000000,
    alt: 0x08000000, meta: 0x10000000, keypad: 0x20000000
}

// The compositor owns the opening press, so Stage only sees these releases.
var MODIFIER_KEYS = [KEY.meta, KEY.superL, KEY.superR]

// Swap axis, overlap axis, and coordinate direction.
var DIRECTIONS = {
    left:  { axis: "x", across: "y", negative: true },
    right: { axis: "x", across: "y", negative: false },
    up:    { axis: "y", across: "x", negative: true },
    down:  { axis: "y", across: "x", negative: false }
}

var ARROW_DIRECTIONS = {}
ARROW_DIRECTIONS[KEY.left] = "left"
ARROW_DIRECTIONS[KEY.right] = "right"
ARROW_DIRECTIONS[KEY.up] = "up"
ARROW_DIRECTIONS[KEY.down] = "down"

function arrowDirection(key) { return ARROW_DIRECTIONS[key] || "" }

// Adjacent index in the displayed workspace row, or -1 at either edge.
function moveDestinationIndex(ids, fromId, negative) {
    var here = ids.indexOf(fromId)
    if (here < 0) return -1
    var to = here + (negative ? -1 : 1)
    return (to >= 0 && to < ids.length) ? to : -1
}

// Build one compositor-side swap. The workspace id prevents a stale Stage
// view from rearranging a window that has since moved elsewhere.
function swapLua(addr, direction, wsId) {
    var window = address(addr)
    var dir = DIRECTIONS[direction]
    var here = workspaceId(wsId)
    if (!window || !dir || !here) return ""
    var selector = '"address:' + window + '"'
    return [
        'function()',
        '  local function ok(w)',
        '    return w ~= nil and w.mapped and not w.hidden and not w.floating',
        '      and w.fullscreen == 0 and w.fullscreen_client == 0 and w.group == nil',
        '  end',
        '  local s = hl.get_window(' + selector + ')',
        '  if not ok(s) or s.workspace == nil or s.monitor == nil',
        '      or s.workspace.id ~= ' + here + ' then return "noop" end',
        '  local along, across = "' + dir.axis + '", "' + dir.across + '"',
        '  local sign = ' + (dir.negative ? '-1' : '1'),
        // Stable geometric neighbour selection, independent of enumeration order.
        '  local best, bd, bp = nil, 0, 0',
        '  for _, t in ipairs(hl.get_windows({ workspace = s.workspace })) do',
        '    if t.address ~= s.address and ok(t) and t.monitor ~= nil',
        '        and t.monitor.id == s.monitor.id then',
        '      local d = sign * ((t.at[along] + t.size[along] / 2)',
        '        - (s.at[along] + s.size[along] / 2))',
        '      local lo = math.max(s.at[across], t.at[across])',
        '      local hi = math.min(s.at[across] + s.size[across],',
        '        t.at[across] + t.size[across])',
        '      if d > 0 and hi > lo then',
        '        local p = math.abs((t.at[across] + t.size[across] / 2)',
        '          - (s.at[across] + s.size[across] / 2))',
        '        if best == nil or d < bd or (d == bd and (p < bp',
        '            or (p == bp and t.address < best.address))) then',
        '          best, bd, bp = t, d, p',
        '        end',
        '      end',
        '    end',
        '  end',
        '  if best == nil then return "noop" end',
        // Hyprland's swap warps the cursor; restore it to avoid hover-select.
        '  local cursor = hl.get_cursor_pos()',
        '  hl.dispatch(hl.dsp.window.swap({ window = ' + selector + ',',
        '    target = "address:" .. best.address }))',
        '  if cursor ~= nil then',
        '    hl.dispatch(hl.dsp.cursor.move({ x = cursor.x, y = cursor.y }))',
        '  end',
        '  return "swap"',
        'end'
    ].join('\n')
}

// Map a key event to one action. "none" is unhandled; every other action is
// consumed so unsupported modifier chords cannot fall through to navigation.
function routeKey(event, ctx) {
    var key = Number(event.key)
    // Keypad keys carry KeypadModifier, and cycle mode keeps Super held.
    // Neither distinguishes a Stage chord, so mask both before exact matches.
    var mods = Number(event.modifiers || 0) & ~(MOD.keypad | MOD.meta)
    var panes = !!ctx.panes

    // Only an armed cycle modifier release commits.
    if (event.type === "release") {
        if (event.isAutoRepeat || !ctx.armed || ctx.dragPending)
            return decision("none")
        return MODIFIER_KEYS.indexOf(key) >= 0
            ? decision("commit") : decision("none")
    }

    // A drag owns the keyboard; its first Escape cancels only the gesture.
    if (key === KEY.escape) {
        if (event.isAutoRepeat) return decision("consume")
        return decision(ctx.dragPending ? "dragCancel" : "dismiss")
    }
    if (ctx.dragPending) return decision("consume")

    // Swallow repeated X presses so a close cannot cascade to the next pane.
    if (key === KEY.x)
        return decision(panes && mods === MOD.none && !event.isAutoRepeat
                        ? "close" : "consume")

    var direction = arrowDirection(key)
    if (direction && mods === MOD.shift)
        return panes ? decision("swap", direction) : decision("consume")
    if (direction && mods === (MOD.control | MOD.shift))
        return panes && DIRECTIONS[direction].axis === "x"
            ? decision("move", direction) : decision("consume")

    // Shift+Tab may arrive as Backtab or as a shifted Tab.
    if ((key === KEY.backtab && (mods === MOD.none || mods === MOD.shift))
        || (key === KEY.tab && mods === MOD.shift))
        return decision("advance", -1)
    if (mods !== MOD.none) return decision("consume")

    if (key === KEY.up) return decision("zoomOut")
    if (key === KEY.down) return decision("zoomIn")
    if (key === KEY.left) return decision("advance", -1)
    if (key === KEY.right || key === KEY.tab) return decision("advance", 1)
    if (key === KEY.ret || key === KEY.enter) return decision("activate")
    if (key > KEY.zero && key <= KEY.nine) return decision("workspace", key - KEY.zero)
    return decision("none")
}

function decision(action, arg) {
    return { action: action, arg: arg === undefined ? null : arg }
}
