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

// Windows of a workspace in left-to-right, top-to-bottom order.
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
// workspace -- hand pane mode to whatever took its place instead of dropping
// the user out a zoom level.
function neighborAfterClose(addresses, selected, fallbackIndex) {
    if (fallbackIndex < 0 || addresses.length === 0) return -1
    var found = addresses.indexOf(selected)
    return found >= 0 ? found : Math.min(fallbackIndex, addresses.length - 1)
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
// when something asks Hyprland for it. These are the events after which the
// rectangles Stage draws are stale; everything else (titles, focus, audio)
// must not cost an IPC round trip.
var REFRESH_EVENTS = [
    "openwindow", "closewindow", "movewindow", "movewindowv2",
    "changefloatingmode", "fullscreen", "createworkspace", "createworkspacev2",
    "destroyworkspace", "destroyworkspacev2", "moveworkspace", "moveworkspacev2"]

function shouldRefresh(eventName) {
    return REFRESH_EVENTS.indexOf(String(eventName)) >= 0
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
        visible: t.width >= size * 2 && t.height >= size * 2
                 && x >= 0 && y + size <= t.height
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
