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

function focusWorkspaceLua(id) {
    var n = Number(id)
    return Number.isFinite(n) && Math.floor(n) === n
        ? 'hl.dsp.focus({ workspace = "' + n + '" })' : ""
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
// whole group, which is never what dragging one thumbnail asks for.
function isGrouped(ipc) {
    return !!(ipc && ipc.grouped && ipc.grouped.length > 0)
}

// Moving is explicit and never follows: the compositor keeps its focus and
// Stage stays open on the workspace the user is looking at. Only a validated
// address and an integer workspace id reach the string.
function moveLua(value, id) {
    var addr = address(value)
    var n = Number(id)
    if (!addr || !Number.isFinite(n) || Math.floor(n) !== n || n <= 0) return ""
    return 'hl.dsp.window.move({ window = "address:' + addr
        + '", workspace = "' + n + '", follow = false })'
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
