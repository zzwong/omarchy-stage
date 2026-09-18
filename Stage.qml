pragma ComponentBehavior: Bound
import Quickshell
import Quickshell.Io
import Quickshell.Hyprland
import Quickshell.Wayland
import Quickshell.Widgets
import Quickshell.Services.Mpris
import Quickshell.Services.Pipewire
import QtQuick
import "StageLogic.js" as StageLogic
import QtQuick.Effects
import QtQuick.Shapes
import qs.Commons
import qs.Ui

Item {
  id: root

  property var shell: null
  property var manifest: null

  // Feature flags, set in settings.json next to this file (re-read on each
  // open of the overlay):
  //   style: "picker" — omarchy theme-picker pattern: skewed slice carousel,
  //                     selected workspace expands to a large live preview.
  //          "cards"  — flat row of equal workspace cards.
  //   badgeStyle ("cards" style only): "badge" rounded square | "omarchy"
  //                     bar-style numeral/glyph.
  //   view: "auto" — open in the carousel, Up/Down zoom between it and the
  //                  grid (default).
  //         "carousel" | "grid" — lock to a single view; the zoom keys and
  //                  edge fall-throughs to the other view are disabled.
  //   keybindMode: "toggle" — the bound key opens, a second press closes
  //                  (default). "cycle" — releasing the modifier after a
  //                  step jumps to the selection; see the README for the
  //                  stepping keys that go with it.
  property string uiStyle: "picker"
  property string badgeStyle: "badge"
  property string viewPref: "auto"
  property string keybindMode: "toggle"

  // Settings live in a user-replaceable path, so they are never opened in
  // this process: a child rejects symlinks and non-regular files (a FIFO
  // would block the reader), caps the read at 64 KiB, and is time-bounded
  // against open()-to-read races. Re-run on each overlay open.
  Process {
    id: settingsProbe
    running: true
    command: ["sh", "-c",
      'f="$HOME/.config/omarchy/plugins/zzwong.stage/settings.json"; ' +
      '[ -f "$f" ] && [ ! -L "$f" ] && exec timeout 2 head -c 65536 -- "$f"']
    stdout: StdioCollector {
      onStreamFinished: {
        try {
          var s = JSON.parse(String(text))
          if (s.style === "picker" || s.style === "cards") root.uiStyle = s.style
          if (s.badgeStyle === "badge" || s.badgeStyle === "omarchy")
            root.badgeStyle = s.badgeStyle
          if (s.view === "auto" || s.view === "carousel" || s.view === "grid")
            root.viewPref = s.view
          if (s.keybindMode === "toggle" || s.keybindMode === "cycle")
            root.keybindMode = s.keybindMode
        } catch (e) {}
      }
    }
  }

  property bool opened: false
  property int selectedIndex: -1

  // After a navigation keypress the keyboard owns selection; hover only
  // re-takes it once the mouse moves deliberately (see WsSlab).
  property bool kbdPriority: false

  // "carousel" is the zoomed-in slice view; "grid" lays every workspace out.
  // Up zooms out, Down zooms back in.
  property string viewMode: "carousel"

  // Grid-view layout, shared by the grid loader and the key handler's
  // spatial navigation: the column count that maximizes card size.
  readonly property real gridGap: Style.space(18)
  readonly property var gridFit: {
    var availW = panel.width * 0.88
    var availH = panel.height * 0.74
    var best = { cols: 1, w: 0 }
    for (var c = 1; c <= slotCount; c++) {
      var r = Math.ceil(slotCount / c)
      var w = Math.min((availW - gridGap * (c - 1)) / c,
                       ((availH - gridGap * (r - 1)) / r) * monAspect)
      if (w > best.w) best = { cols: c, w: w }
    }
    return best
  }
  readonly property int gridCols: Math.max(1, gridFit.cols)

  // Theme tokens. The picker layout reuses the image-picker surface so the
  // overview matches the theme switcher; the cards layout shares [menu].
  property color background: Color.menu.background
  property color foreground: Color.menu.text
  property color border: Color.menu.border
  property color selectedBorder: Color.accent
  property color pickerText: Color.imagePicker.text
  property color pickerSelectedBorder: Color.imagePicker.selectedBorder
  property color pickerUnselectedBorder: Color.imagePicker.unselectedBorder
  readonly property int cornerRadius: Style.cornerRadius

  // Shear slope shared by every parallelogram (28px over the reference
  // preview height), so all skewed edges stay parallel at any size.
  readonly property real skewSlope: 28 / 519

  readonly property var monitor: Hyprland.focusedMonitor

  // Reserved struts (bar etc.) as [left, top, right, bottom], logical px.
  readonly property var monReserved: (monitor && monitor.lastIpcObject
                                      && monitor.lastIpcObject.reserved)
                                     ? monitor.lastIpcObject.reserved : [0, 0, 0, 0]

  // Usable logical area: monitor (physical px / scale) minus reserved space,
  // so previews map the region windows actually tile in.
  readonly property real monLogicalW: monitor
    ? monitor.width / monitor.scale - monReserved[0] - monReserved[2] : 1920
  readonly property real monLogicalH: monitor
    ? monitor.height / monitor.scale - monReserved[1] - monReserved[3] : 1080
  readonly property real monAspect: monLogicalW / monLogicalH

  // --- Media / audio metadata ------------------------------------------
  readonly property var mprisPlayers: Mpris.players ? Mpris.players.values : []
  readonly property var pwNodes: Pipewire.nodes ? Pipewire.nodes.values : []
  readonly property var audioStreams: {
    var out = []
    for (var i = 0; i < pwNodes.length; i++) {
      var n = pwNodes[i]
      if (n && n.isStream && n.audio
          && (n.isSink === true || String(n.type || "").indexOf("Output") !== -1))
        out.push(n)
    }
    return out
  }
  PwObjectTracker { objects: root.audioStreams }

  function normKey(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "")
  }

  // MPRIS player whose identity matches the window's app id, if any.
  function playerForWindow(topl) {
    var app = normKey((topl.wayland && topl.wayland.appId)
                      || (topl.lastIpcObject && topl.lastIpcObject["class"]) || "")
    if (!app) return null
    for (var i = 0; i < mprisPlayers.length; i++) {
      var p = mprisPlayers[i]
      var key = normKey(p.desktopEntry || p.identity
                        || String(p.dbusName || "").replace(/^org\.mpris\.MediaPlayer2\./, ""))
      if (!key) continue
      if (key === app || key.indexOf(app) !== -1 || app.indexOf(key) !== -1) return p
    }
    return null
  }

  // Whether the window currently has an active PipeWire playback stream.
  function windowHasAudio(topl) {
    var pid = topl.lastIpcObject ? Number(topl.lastIpcObject.pid) : 0
    var app = normKey(topl.wayland ? topl.wayland.appId : "")
    for (var i = 0; i < audioStreams.length; i++) {
      var n = audioStreams[i]
      var props = (n.ready && n.properties) ? n.properties : {}
      if (pid && Number(props["application.process.id"]) === pid) return true
      var label = normKey(props["application.name"] || n.description || n.name || "")
      if (app && label
          && (label === app || label.indexOf(app) !== -1 || app.indexOf(label) !== -1))
        return true
    }
    return false
  }

  // Current omarchy wallpaper, resolved through the state symlink on each
  // open so theme/background switches are picked up.
  property string wallpaperPath: ""
  Process {
    id: wallpaperProbe
    command: ["readlink", "-f",
              Quickshell.env("HOME") + "/.local/state/omarchy/current/background"]
    stdout: StdioCollector {
      onStreamFinished: root.wallpaperPath = String(text).trim()
    }
  }

  property var workspaceList: []

  // Workspace selection is owned by the workspace's id; selectedIndex is
  // only where that workspace currently sits in the list, which the
  // compositor may change under us.
  //
  // Everything about the selection derives from this one property rather
  // than from (workspaceList, selectedIndex) separately. A rebuild assigns
  // those two in sequence, and QML re-evaluates the bindings that depend on
  // them in an order of its own choosing; with a single common source, every
  // derived value read from within a handler belongs to the same workspace.
  readonly property var selectedWorkspace:
    (selectedIndex >= 0 && selectedIndex < workspaceList.length)
      ? workspaceList[selectedIndex] : null
  readonly property int selectedWorkspaceId:
    selectedWorkspace ? selectedWorkspace.id : -1

  // Every workspace selection made by input goes through here: leaving a
  // workspace leaves its pane zoom behind. Without this, returning to a
  // workspace later would silently re-enter pane mode on an address the user
  // last chose several workspaces ago -- or, after a close handed the
  // selection on, on a window they never chose at all.
  function selectWorkspace(index) {
    if (index !== root.selectedIndex) root.selectPane(-1)
    root.selectedIndex = index
  }

  // Pane mode: a third zoom level inside the carousel's expanded preview.
  // The selected window's address owns the selection and paneIndex is
  // derived from it, scoped to the workspace the zoom was entered on. A
  // re-tile, a reorder or a workspace rebuild therefore cannot move the
  // selection onto a different window, and no reconciliation flag has to
  // guard the property writes a rebuild makes.
  property string selectedPaneAddress: ""
  property int paneWorkspaceId: -1
  readonly property int paneIndex:
    (selectedWorkspace && selectedWorkspace.id === paneWorkspaceId)
      ? StageLogic.paneIndexFor(selectedPanes, selectedPaneAddress) : -1

  // Every pane selection goes through here; -1 leaves pane mode.
  function selectPane(index) {
    root.paneWorkspaceId = root.selectedWorkspace ? root.selectedWorkspace.id : -1
    root.selectedPaneAddress = index >= 0 && index < root.selectedPanes.length
      ? String(root.selectedPanes[index].address) : ""
  }

  // When the selected window goes away — closed here, or moved off this
  // workspace — hand pane mode to the window that stood next to it instead of
  // dropping the user out a zoom level. The hand-off follows a window, not a
  // slot, so it needs the order as it was before the change.
  property var paneAddresses: []
  onSelectedPanesChanged: {
    // Scope and membership are both read off `selectedWorkspace`, which
    // `selectedPanes` was just derived from, so this can never hand pane mode
    // to a window on a workspace that is only half-selected.
    var ws = root.selectedWorkspace
    var addr = root.selectedPaneAddress
    var addresses = root.selectedPanes.map(function(p) { return String(p.address) })
    var previous = root.paneAddresses
    root.paneAddresses = addresses
    if (!addr || !ws || ws.id !== root.paneWorkspaceId) return
    if (addresses.indexOf(addr) >= 0) return // still there, only re-tiled
    root.selectPane(StageLogic.neighborAfterClose(previous, addresses, addr))
  }
  onViewModeChanged: root.selectPane(-1)

  // Windows of the selected workspace in column-major order (left to right,
  // top to bottom within a column). A workspace the compositor has destroyed
  // — the last window moved off it — can still be referenced here for the
  // binding pass before the rebuild: the QObject is gone, so reading
  // `toplevels` gives undefined.
  readonly property var selectedPanes:
    (selectedWorkspace && selectedWorkspace.toplevels)
      ? StageLogic.sortPanes(selectedWorkspace.toplevels.values) : []

  readonly property string paneAddress:
    paneIndex >= 0 ? root.selectedPaneAddress : ""

  // One slot per workspace plus the trailing "new workspace" slot.
  readonly property int slotCount: workspaceList.length + 1
  readonly property bool plusSelected: selectedIndex === workspaceList.length

  // The "+" slot's stand-in in the slot model. One instance for the life of
  // the overlay, so the model sees the same object on every rebuild and the
  // slot at the end of the row is never the one that got recreated. A slab
  // renders it as the "+" card by the same `workspace: null` convention the
  // component already uses.
  readonly property QtObject plusSlot: QtObject {}

  // Slot delegates are keyed by workspace identity, not by position. A
  // rebuild reassigns `workspaceList`, and an `int` model (or a plain array)
  // would then hand every slab after an insertion a different workspace:
  // its thumbnails are bound to `workspace.toplevels`, so they are recreated
  // and every live capture restarts on cards nothing happened to.
  // ScriptModel diffs the replaced array and reports only the inserts and
  // removes that really happened, so the untouched slabs survive.
  ScriptModel {
    id: slotModel
    // Identity, not the default structural compare: two workspaces are the
    // same slot when they are the same object, never when they merely look
    // alike.
    comparisonMode: ObjectComparison.Identity
    values: root.workspaceList.concat([root.plusSlot])
  }

  // The "cards" style has no "+" slot, so it takes the list as it is.
  ScriptModel {
    id: workspaceModel
    comparisonMode: ObjectComparison.Identity
    values: root.workspaceList
  }

  // The workspace ids Stage is showing, in the order it shows them: the
  // focused monitor's, which is not the compositor's whole list. The "+"
  // card's caption and the workspace a drop on it creates both count from
  // this one list.
  readonly property var shownIds:
    workspaceList.map(function(w) { return w.id })

  function nextWorkspaceId() {
    return StageLogic.nextWorkspaceId(root.shownIds)
  }

  // Membership changes arrive as a signal from the model itself; nothing
  // polls for them.
  Connections {
    target: Hyprland.workspaces
    function onValuesChanged() {
      if (root.opened) rebuildCoalesce.restart()
    }
  }

  // Single-shot: restarted per trigger, fires once after the burst settles.
  // Quickshell surfaces each newly created workspace in its own turn of the
  // event loop — a `hyprctl --batch` creating two arrives as two signals
  // about 9 ms apart — so `Qt.callLater`, which only collapses what is
  // already queued in one turn, still ran a rebuild per workspace. A short
  // debounce gives a monitor arriving with its workspaces, or a session
  // restoring, the one rebuild it deserves.
  Timer {
    id: rebuildCoalesce
    interval: 30
    repeat: false
    onTriggered: root.rebuildWorkspaces(true)
  }

  // The rebuilt list is filtered by monitor, and a workspace can change
  // monitor without the model's membership changing at all: Quickshell
  // handles `moveworkspacev2` by reassigning the workspace's monitor in
  // place, and a workspace created before its monitor is known resolves it
  // later, both without a `valuesChanged`. Watch each workspace's own
  // monitor, so this overlay does not go on showing another monitor's
  // workspace (or miss one that just arrived on this one).
  Instantiator {
    model: Hyprland.workspaces
    delegate: QtObject {
      required property var modelData
      readonly property var workspaceMonitor: modelData.monitor
      onWorkspaceMonitorChanged: {
        if (root.opened) rebuildCoalesce.restart()
      }
    }
  }

  // Window geometry lives in each toplevel's lastIpcObject, which only
  // changes when something asks Hyprland for it — so after a window closes
  // the survivors keep their pre-close rectangles and render letterboxed
  // until the next refresh. Refresh on the compositor's own events instead,
  // coalescing a burst into one round trip: that batches the IPC and lets
  // the compositor finish re-tiling before the geometry is read.
  Connections {
    target: Hyprland
    function onRawEvent(event) {
      var name = String(event.name)
      // The compositor confirming the window is gone ends the debounce; a
      // handle Hyprland has reused is a different window.
      if (name === "closewindow")
        root.pendingCloses = StageLogic.prunePending(
          root.pendingCloses, Date.now(), StageLogic.address(event.data))
      if (root.opened && StageLogic.shouldRefresh(name)) geometryRefresh.restart()
    }
  }

  // Single-shot: restarted per event, fires once after the burst settles.
  Timer {
    id: geometryRefresh
    interval: 60
    repeat: false
    // Toplevels only: nothing here reads a workspace's `lastIpcObject`, and
    // both the model's membership and each workspace's monitor come from the
    // compositor's own events — Quickshell re-queries the workspaces itself
    // when it sees one created.
    onTriggered: Hyprland.refreshToplevels()
  }

  function rebuildWorkspaces(preserve) {
    var oldId = root.selectedWorkspaceId
    var oldIndex = root.selectedIndex
    var wasPlus = root.plusSelected
    var out = []
    var values = Hyprland.workspaces.values
    for (var i = 0; i < values.length; i++) {
      var ws = values[i]
      if (ws.id <= 0) continue // skip special workspaces
      if (root.monitor && ws.monitor && ws.monitor.id !== root.monitor.id) continue
      out.push(ws)
    }
    out.sort(function(a, b) { return a.id - b.id })

    // Resolve the new index against the rebuilt list before touching either
    // property. `workspaceList` and `selectedIndex` cannot be assigned
    // atomically, so between them `selectedWorkspace` is briefly a workspace
    // nobody selected; dropping a pane zoom the reconciliation moved off its
    // workspace up front makes that intermediate inert, because pane mode is
    // scoped by workspace id and the address is already gone.
    var index = StageLogic.reconcileSelection({
      ids: out.map(function(w) { return w.id }),
      oldId: oldId,
      oldIndex: oldIndex,
      wasPlus: wasPlus,
      focusedId: Hyprland.focusedWorkspace ? Hyprland.focusedWorkspace.id : -1,
      preserve: preserve === true
    })
    var newId = (index >= 0 && index < out.length) ? out[index].id : -1
    if (newId !== oldId) root.selectPane(-1)

    // Only a real membership change may replace the model: reassigning an
    // equal list recreates every delegate, and with it every live capture.
    if (StageLogic.membershipChanged(root.workspaceList, out))
      root.workspaceList = out

    // Exactly one assignment: an intermediate value would notify a
    // selection nobody asked for.
    root.selectedIndex = index
  }

  // --- Hold-to-cycle ("cycle" keybindMode) -----------------------------
  // The compositor eats the bound chord, so a step only reaches us as a
  // summon carrying one. Nothing here guesses at the modifier: only a
  // stepped overlay commits on release, which keeps hide() meaning hide.
  property bool cycled: false

  // Disarm if the release never lands — a gesture opened the overlay, or the
  // grab missed it. Restarted per step and keypress: only idle holds expire.
  Timer {
    id: holdWatchdog
    interval: 10000
    onTriggered: root.cycled = false
  }

  // A close, or anything else that edits the desktop, is not a step:
  // releasing the modifier after one must not jump anywhere. Stopping the
  // watchdog together with the flag keeps the two from drifting apart.
  function disarmCycle() {
    root.cycled = false
    holdWatchdog.stop()
  }

  function cycleStep(delta) {
    // A step arriving mid-drag would move the selection out from under the
    // thumbnail being carried; the drag already disarmed the commit.
    if (root.dragging) return
    root.cycled = true
    root.kbdPriority = true
    root.advance(delta)
    holdWatchdog.restart()
  }

  function open(payloadJson) {
    var payload = ({})
    try { payload = JSON.parse(payloadJson || "{}") || ({}) } catch (e) {}

    // A step while already open is the second keybind asking for
    // previous/next, not a fresh open.
    if (root.opened && payload.step) {
      root.cycleStep(payload.step < 0 ? -1 : 1)
      return
    }

    root.warnUnlessLua()
    Hyprland.refreshWorkspaces()
    Hyprland.refreshToplevels() // fresh geometry in lastIpcObject
    wallpaperProbe.running = true
    settingsProbe.running = true
    root.kbdPriority = false
    root.disarmCycle()
    // Reopening on the same workspace changes neither viewMode nor
    // selectedIndex, so nothing else clears a stale pane zoom.
    root.selectPane(-1)
    root.rebuildWorkspaces(false)
    root.viewMode = root.viewPref === "grid" ? "grid" : "carousel"
    root.opened = true
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }

  function close() {
    root.opened = false
    root.disarmCycle()
    geometryRefresh.stop()
    rebuildCoalesce.stop()
  }

  function dismiss() {
    root.opened = false
    if (root.shell && typeof root.shell.hide === "function")
      root.shell.hide((root.manifest && root.manifest.id) || "zzwong.stage")
  }

  function toggle() {
    if (root.opened) root.dismiss()
    else root.open("{}")
  }

  // Every Stage action is a Hyprland Lua dispatch. Quickshell writes these
  // straight to the socket hyprctl itself talks to — no fork, no exec, no
  // reply to parse here: it logs any answer but "ok" as "Dispatch request
  // … failed with error …" on its own. `dismiss()` only hides the overlay
  // (the plugin is keepLoaded), so a request outlives it.
  //
  // Several Hyprland dispatchers re-tile while announcing nothing at all, so
  // a request Stage sends itself gets the same coalesced refresh the
  // compositor's own events get. Requests on one socket are answered in
  // order, so the geometry the timer reads is the geometry this produced.
  function dispatch(lua) {
    if (!lua) return
    Hyprland.dispatch(lua)
    if (root.opened) geometryRefresh.restart()
  }

  // `hl.dsp.*` exists only under a Lua config (Omarchy's default); under a
  // hyprlang config every Stage action would be a silent no-op. Say so once,
  // rather than per click.
  //
  // Not at load: Quickshell resolves `usingLua` from the compositor, and the
  // reply lands a round trip (~30 ms here) after the shell finishes loading,
  // so the property still reads false then. The first open is the earliest
  // moment the answer means anything, and the last one before it matters.
  property bool luaWarningShown: false
  function warnUnlessLua() {
    if (root.luaWarningShown || Hyprland.usingLua) return
    root.luaWarningShown = true
    console.warn("Stage: Hyprland is running a hyprlang config, which has no"
      + " hl.dsp dispatchers. Stage's focus, workspace and close actions all"
      + " need a Lua Hyprland config (Omarchy's default) and will do nothing"
      + " until this one is converted.")
  }

  // A bounded per-address debounce, not an optimistic removal: applications
  // may decline or show a dialog. Explicit selectors resolve again inside
  // Hyprland at execution; a missing match is a null window, NOT active focus.
  property var pendingCloses: ({})
  function requestWindowClose(value) {
    var addr = StageLogic.address(value)
    var live = Hyprland.toplevels.values.map(function(p) { return StageLogic.address(p.address) })
    var now = Date.now()
    if (!StageLogic.canRequest(addr, live, root.pendingCloses, now)) return
    // Only a request that is actually going out disarms hold-to-cycle: a
    // debounced repeat or a click on a preview the compositor has already
    // dropped must not silently cancel the release-to-focus the user set up.
    root.disarmCycle()
    var next = StageLogic.prunePending(root.pendingCloses, now)
    next[addr] = now + 2000
    root.pendingCloses = next
    root.dispatch(StageLogic.closeLua(addr))
  }

  // One control size for the component and for the placement maths that
  // keeps it inside its thumbnail, on the shell's spacing scale like every
  // other dimension here: a theme that makes the shell denser or roomier
  // moves the control and its clearances with it.
  readonly property real closeControlSize: Style.space(24)
  readonly property real closeControlPad: Style.space(6)

  // Both thumbnail delegates place their control the same way and differ only
  // in what encloses them: an overscanned, sheared carousel slab, or a flat
  // card whose content starts at its own origin. It is only solved for a
  // thumbnail that is actually showing a control: every slab animates its
  // size, and an unselected slice would otherwise re-solve the clamps for
  // each of its windows on every frame of that animation.
  readonly property var closeSpotHidden: ({ x: 0, y: 0, visible: false })
  function closeSpotFor(show, thumb, contentX, contentY, frame, skew) {
    if (!show) return root.closeSpotHidden
    return StageLogic.closeControlPosition({
      thumb: { x: thumb.x, y: thumb.y, width: thumb.width,
               height: thumb.height, scale: thumb.scale },
      content: { x: contentX, y: contentY },
      slab: { width: frame.width, height: frame.height, skew: skew },
      size: root.closeControlSize, pad: root.closeControlPad })
  }

  // The close control is a chip in the picker's own language: an accent
  // parallelogram sharing the slabs' shear, like the workspace number chip,
  // with a drawn cross (the theme font's multiplication sign varies too much
  // in weight and centring to be the glyph). On a rounded title pill the chip
  // would fight the pill, so `inline` drops it and keeps only the cross,
  // dimmed until hovered. A flat card passes `shear: 0` for a plain chip.
  component CloseControl: Item {
    id: closeControl
    required property string address
    property string windowTitle: "window"
    property bool inline: false
    property real shear: root.skewSlope
    readonly property bool hovered: closeHover.hovered
    width: root.closeControlSize
    height: root.closeControlSize
    readonly property real sk: height * shear
    property color ink: inline
      ? Util.alpha(root.pickerText, hovered ? 1 : 0.6)
      : StageLogic.contrastColor(root.pickerSelectedBorder, root.foreground, root.background)
    Behavior on ink { ColorAnimation { duration: 170 } }
    Accessible.role: Accessible.Button
    Accessible.name: "Close " + windowTitle
    Accessible.onPressAction: root.requestWindowClose(closeControl.address)
    Shape {
      visible: !closeControl.inline
      anchors.fill: parent
      antialiasing: true
      preferredRendererType: Shape.CurveRenderer
      opacity: closeControl.hovered ? 1 : 0.82
      Behavior on opacity { NumberAnimation { duration: 170 } }
      ShapePath {
        fillColor: root.pickerSelectedBorder
        strokeColor: "transparent"
        startX: closeControl.sk; startY: 0
        PathLine { x: closeControl.width; y: 0 }
        PathLine { x: closeControl.width - closeControl.sk; y: closeControl.height }
        PathLine { x: 0; y: closeControl.height }
        PathLine { x: closeControl.sk; y: 0 }
      }
    }
    Shape {
      id: closeCross
      anchors.centerIn: parent
      width: Style.space(8)
      height: width
      antialiasing: true
      preferredRendererType: Shape.CurveRenderer
      ShapePath {
        strokeColor: closeControl.ink
        strokeWidth: Math.max(1, Style.space(1))
        capStyle: ShapePath.RoundCap
        fillColor: "transparent"
        startX: 0; startY: 0
        PathLine { x: closeCross.width; y: closeCross.height }
        PathMove { x: 0; y: closeCross.height }
        PathLine { x: closeCross.width; y: 0 }
      }
    }
    // Qt delivers hover to the frontmost item that accepts it, so whatever
    // draws this control takes the pointer away from anything underneath —
    // on a title pill, reaching the × would otherwise drop the pill's
    // highlight and snap its marquee back to the start. The handler keeps
    // that state readable (`hovered`) so an enclosing surface can fold it
    // into its own, and leaves the click to the MouseArea below.
    HoverHandler { id: closeHover }
    MouseArea {
      anchors.fill: parent
      cursorShape: Qt.PointingHandCursor
      // Never propagate to the thumbnail's focus or background dismiss area.
      onClicked: root.requestWindowClose(closeControl.address)
    }
  }

  function focusWorkspace(id) {
    root.dismiss()
    root.dispatch(StageLogic.focusWorkspaceLua(id))
  }

  function createWorkspace() {
    root.focusWorkspace(root.nextWorkspaceId())
  }

  function focusWindow(address) {
    root.dismiss()
    root.dispatch(StageLogic.focusWindowLua(address))
  }

  function selectAdjacent(delta) {
    if (root.slotCount === 0) return
    root.selectWorkspace((root.selectedIndex + delta + root.slotCount) % root.slotCount)
  }

  function activateSelected() {
    if (root.selectedIndex < 0) return
    if (root.selectedIndex < root.workspaceList.length)
      root.focusWorkspace(root.workspaceList[root.selectedIndex].id)
    else
      root.createWorkspace()
  }

  // One ←/→ step: panes when zoomed into them, else workspaces.
  function advance(delta) {
    if (root.paneIndex >= 0 && root.selectedPanes.length > 0)
      root.selectPane((root.paneIndex + delta + root.selectedPanes.length)
                      % root.selectedPanes.length)
    else root.selectAdjacent(delta)
  }

  // Enter, and what releasing the modifier does in "cycle" mode.
  function activateCurrent() {
    if (root.paneIndex >= 0) root.focusWindow(root.paneAddress)
    else root.activateSelected()
  }

  // --- Drag: move a window to another workspace -------------------------
  // Dragging a grid thumbnail onto another workspace card moves that one
  // window there. This is movement inside the overlay — a Qt Quick pointer
  // grab, and one Hyprland dispatch at the end of it — not a native Wayland
  // window drag, and it never follows the window.
  //
  // The gesture is a DragHandler on each grid thumbnail (see WsSlab), so Qt
  // owns the threshold, the grab and the question of which window was picked
  // up: the handler takes the grab off the card's own MouseAreas only once
  // the pointer has travelled far enough to mean a drag, and a press that
  // does not is still their click. Stage decides only what is dragged where.

  // The gesture's lifetime is one pure transition in StageLogic; these are
  // what the bindings that draw it read.
  property var dragState: StageLogic.dragIdle()
  readonly property bool dragging: dragState.phase === "dragging"
  // Pointer position in scene coordinates, from the handler's centroid.
  property point dragPoint: Qt.point(0, 0)

  // The dragged window, still open and still on the workspace it was picked
  // up from. A binding over the live model, so closing or moving the window
  // elsewhere is noticed without waiting for the pointer.
  readonly property bool dragSourceLive: {
    if (!dragState.address) return false
    var values = Hyprland.toplevels.values
    for (var i = 0; i < values.length; i++) {
      if (StageLogic.address(values[i].address) !== dragState.address) continue
      return !!values[i].workspace && values[i].workspace.id === dragState.workspace
    }
    return false
  }
  // Deferred: ending the gesture writes dragState, which the binding above
  // reads, and writing it from inside that binding's own notification is a
  // loop. By the time this runs the window really is gone.
  onDragSourceLiveChanged: if (!root.dragSourceLive) Qt.callLater(root.dropGoneSource)
  function dropGoneSource() {
    if (root.dragging && !root.dragSourceLive) root.endDrag("sourceGone")
  }

  // The card under the pointer, and the workspace a release would move the
  // window to — 0 when nothing would happen. Derived rather than latched:
  // both read Hyprland's live models, so a destination that is destroyed (or
  // a source that goes away) re-decides the highlight with the pointer
  // standing still, and the release re-decides it once more.
  property var dragHover: null
  readonly property int dragDestination: dragging && dragHover
    ? StageLogic.dropDecision({
        hit: dragHover, dragWorkspace: dragState.workspace,
        sourceLive: dragSourceLive, shownIds: root.shownIds,
        workspaces: Hyprland.workspaces.values })
    : 0

  // One condition for the grid view, its thumbnails' handlers and the
  // gesture's lifetime, so they cannot drift apart: a drag belongs to the
  // grid and cannot outlive it. The overlay closing, the view zooming out or
  // the style changing ends it, and takes the handler with it.
  readonly property bool gridActive:
    opened && uiStyle === "picker" && viewMode === "grid"
  onGridActiveChanged: if (!root.gridActive) root.endDrag("cancel")

  function endDrag(reason) {
    root.dragState = StageLogic.dragTransition(root.dragState,
                                               { type: reason }).state
    root.dragHover = null
  }

  // The card under a scene point: the grid's own lookup, or nothing when
  // there is no grid. Cards only — a drop lands on a workspace, never on one
  // of the windows drawn inside it.
  function cardAt(scenePoint) {
    return gridLoader.item ? gridLoader.item.cardAt(scenePoint) : null
  }

  // A thumbnail has been dragged past the threshold. What is being carried
  // comes from the delegate that was grabbed, so nothing has to be hit-tested
  // to find out what the pointer picked up.
  function beginDrag(topl, workspace, scenePoint) {
    root.dragState = StageLogic.dragTransition(root.dragState, {
      type: "start", address: topl.address, title: topl.title || "Window",
      workspace: workspace ? workspace.id : 0 }).state
    root.disarmCycle() // carrying a window off is not a step
    root.dragHover = null
    root.aimDrag(scenePoint)
  }

  // The pointer moved while carrying one: the proxy follows it and the card
  // under it becomes the drop target. Hit testing is card-level and the hit
  // is only rewritten when it names a different card — every write re-runs
  // dropDecision and every card's wash and stroke bindings.
  function aimDrag(scenePoint) {
    if (!root.dragging) return
    root.dragPoint = scenePoint
    var hit = root.cardAt(scenePoint)
    if (hit !== root.dragHover && !StageLogic.sameCard(hit, root.dragHover))
      root.dragHover = hit
  }

  // The button came up. The destination is the one the highlight was already
  // promising, and only if the release really is over the card it named: the
  // grid re-lays out when workspaces come and go, and whatever slid under a
  // standing pointer was never aimed at.
  function commitDrag(scenePoint) {
    var carried = root.dragState
    var hit = root.cardAt(scenePoint)
    var destination = StageLogic.sameCard(hit, root.dragHover)
      ? root.dragDestination : 0
    var create = !!hit && hit.id === 0
    var done = StageLogic.dragTransition(carried, { type: "release" })
    root.dragState = done.state
    root.dragHover = null
    if (done.action === "move" && destination > 0)
      root.moveWindowToWorkspace(carried.address, destination, create)
  }

  // Explicitly addressed, and `follow = false` so the compositor keeps its
  // focus and Stage stays on the workspace being looked at. Every check the
  // move needs is inside the chunk, in the compositor, at the moment it runs:
  // a window that was closed, unmapped or grouped since the thumbnail was
  // picked up is a no-op there, never a fallback to whatever has focus.
  // `create` is true only for a drop on the "+" slot: nothing else may bring
  // a workspace into being.
  function moveWindowToWorkspace(address, workspaceId, create) {
    var lua = StageLogic.moveLua(address, workspaceId, create)
    if (!lua) return
    root.disarmCycle() // moving a window is not a step
    root.dispatch(lua)
  }

  // Skewed workspace slab: the one visual unit shared by the carousel, the
  // grid, and the "new workspace" slot (workspace: null).
  component WsSlab: Item {
    id: slab

    property var workspace: null
    property bool selected: false
    property real skew: 0
    property bool chipAlways: false
    property bool hoverSelect: false
    property real dimOpacity: 0.42
    // Address of the pane-mode highlighted window, "" when off.
    property string highlightAddress: ""

    // The card a drop would land on right now.
    readonly property bool dropTarget: root.dragDestination > 0
                                       && !!root.dragHover
                                       && root.dragHover.slab === slab

    // This card under a scene point, or null when the point misses it: the
    // skewed mask decides, not the bounding box. A drop lands on the card as
    // a whole — the chip and the thumbnails drawn on it are part of it —
    // so nothing inside is hit-tested, and nothing per-window is read.
    function cardAt(scenePoint) {
      var p = slab.mapFromItem(null, scenePoint.x, scenePoint.y)
      var left = slab.skew * (1 - p.y / slab.height)
      if (p.y < 0 || p.y > slab.height || p.x < left
          || p.x > slab.width - slab.skew + left) return null
      return { id: slab.workspace ? slab.workspace.id : 0,
               workspace: slab.workspace, slab: slab }
    }

    signal pressed()
    signal activated()
    signal windowActivated(string address)

    readonly property real topLeft: skew
    readonly property real topRight: width
    readonly property real bottomRight: width - skew
    readonly property real bottomLeft: 0

    Item {
      id: maskShape
      anchors.fill: parent
      visible: false
      layer.enabled: true

      Shape {
        anchors.fill: parent
        antialiasing: true
        preferredRendererType: Shape.CurveRenderer
        ShapePath {
          fillColor: "white"
          strokeColor: "transparent"
          startX: slab.topLeft; startY: 0
          PathLine { x: slab.topRight; y: 0 }
          PathLine { x: slab.bottomRight; y: slab.height }
          PathLine { x: slab.bottomLeft; y: slab.height }
          PathLine { x: slab.topLeft; y: 0 }
        }
      }
    }

    Item {
      anchors.fill: parent
      // Workspace content is wider than a slice; clip before the skew mask
      // so it cannot spill outside the item.
      clip: true
      layer.enabled: true
      layer.smooth: true
      layer.effect: MultiEffect {
        maskEnabled: true
        maskSource: maskShape
        maskThresholdMin: 0.3
        maskSpreadAtMin: 0.3
      }

      // Workspace content at monitor aspect, height-fit and centered so
      // narrow slices show a horizontal crop of the middle.
      Item {
        id: wsContent
        anchors.centerIn: parent
        // Slight overscan crops the workspace's outer gaps so window edges
        // never show inside the preview.
        readonly property real overscan: 1.04
        height: slab.height * overscan
        width: height * root.monAspect

        readonly property real sx: width / root.monLogicalW
        readonly property real sy: height / root.monLogicalH

        Rectangle {
          anchors.fill: parent
          color: root.background
        }

        // The wallpaper is the truthful base layer: what sits behind the
        // windows, and all a fresh workspace shows.
        Image {
          anchors.fill: parent
          source: root.wallpaperPath ? "file://" + root.wallpaperPath : ""
          fillMode: Image.PreserveAspectCrop
          asynchronous: true
          smooth: true
        }

        // Clicking empty selected space activates (jump / create).
        MouseArea {
          anchors.fill: parent
          enabled: slab.selected
          onClicked: slab.activated()
        }

        Repeater {
          // The ObjectModel itself, not its `values` array: an array is a new
          // model on every membership change, which recreates every delegate
          // and restarts every live capture. The model reports inserts and
          // removes, so the surviving thumbnails keep their captures.
          model: slab.workspace ? slab.workspace.toplevels : null

          delegate: Item {
            id: thumb
            required property var modelData

            readonly property var topl: modelData
            readonly property var ipc: topl.lastIpcObject

            readonly property bool hasGeo: ipc !== null && ipc !== undefined
                                           && ipc.at !== undefined && ipc.size !== undefined
            readonly property real wx: hasGeo ? (ipc.at[0] - (root.monitor ? root.monitor.x : 0) - root.monReserved[0]) : root.monLogicalW * 0.1
            readonly property real wy: hasGeo ? (ipc.at[1] - (root.monitor ? root.monitor.y : 0) - root.monReserved[1]) : root.monLogicalH * 0.1
            readonly property real ww: hasGeo ? ipc.size[0] : root.monLogicalW * 0.8
            readonly property real wh: hasGeo ? ipc.size[1] : root.monLogicalH * 0.8

            x: wx * wsContent.sx
            y: wy * wsContent.sy
            width: Math.max(6, ww * wsContent.sx)
            height: Math.max(6, wh * wsContent.sy)

            readonly property bool paneSelected: slab.highlightAddress !== ""
                                                 && slab.highlightAddress === String(topl.address)
            readonly property bool paneDimmed: slab.highlightAddress !== "" && !paneSelected

            // Pane mode: the highlighted window lifts, siblings recede.
            scale: paneSelected ? 1.03 : 1.0
            z: paneSelected ? 5 : 0
            opacity: paneDimmed ? 0.55 : 1.0
            Behavior on scale { NumberAnimation { duration: 140; easing.type: Easing.OutCubic } }
            Behavior on opacity { NumberAnimation { duration: 140 } }

            Rectangle {
              anchors.fill: parent
              color: Qt.darker(root.background, 1.15)
              border.color: thumb.paneSelected ? root.pickerSelectedBorder : root.border
              border.width: thumb.paneSelected ? 2 : (slab.selected ? 1 : 0)
              Behavior on border.color { ColorAnimation { duration: 140 } }
              clip: true

              ScreencopyView {
                anchors.fill: parent
                anchors.margins: slab.selected ? 1 : 0
                captureSource: (root.opened && thumb.topl.wayland) ? thumb.topl.wayland : null
                live: true
              }
            }

            HoverHandler { id: thumbHover }
            MouseArea {
              anchors.fill: parent
              enabled: slab.selected
              onClicked: slab.windowActivated(thumb.topl.address)
            }

            // The slab masks its content to a skewed parallelogram and
            // wsContent overscans that mask, so a control anchored to the
            // thumbnail's own top-right corner is cut for every window that
            // touches the slab's top or right edge. Anchor it to the visible
            // intersection instead: the same corner wherever that corner is
            // fully visible, pushed in by the overscan fringe and the skew
            // allowance where it is not.
            // The pointer grab keeps the thumbnail "hovered" for the whole
            // gesture; a drag is not the time to offer a close button.
            readonly property bool closeArmed: slab.selected && !root.dragging
              && (thumbHover.hovered || thumb.paneSelected)
            readonly property var closeSpot:
              root.closeSpotFor(closeArmed, thumb, wsContent.x, wsContent.y,
                                slab, slab.skew)

            CloseControl {
              x: thumb.closeSpot.x
              y: thumb.closeSpot.y
              // Hidden rather than half-visible if even the clamped control
              // would not fit inside the thumbnail.
              visible: thumb.closeSpot.visible
              address: String(thumb.topl.address)
              windowTitle: String(thumb.topl.title || "window")
            }

            // Carry this window to another workspace card. A handler rather
            // than a grab over the grid: Qt gives it the exclusive grab —
            // cancelling the click the card's own MouseAreas were tracking —
            // only once the pointer has travelled DRAG_THRESHOLD, so every
            // click path is exactly the one that was there before.
            //
            // Grid only: no other view's slabs exist while the grid does. A
            // grouped window never lifts, because `hl.dsp.window.move` would
            // take its whole group along; the chunk refuses it as well.
            DragHandler {
              target: null
              dragThreshold: StageLogic.DRAG_THRESHOLD
              enabled: root.gridActive && !StageLogic.isGrouped(thumb.ipc)
              onActiveChanged: {
                if (active)
                  root.beginDrag(thumb.topl, slab.workspace,
                                 centroid.scenePosition)
                else root.commitDrag(centroid.scenePosition)
              }
              onCentroidChanged: root.aimDrag(centroid.scenePosition)
            }
          }
        }

        // "New workspace" slot content.
        Text {
          visible: slab.workspace === null
          anchors.centerIn: parent
          text: "+"
          color: Util.alpha(root.pickerText, slab.selected ? 0.9 : 0.5)
          font.pixelSize: Math.max(Style.font.display, slab.height * 0.22)
          font.weight: Font.Light
        }

        // Dim unselected slabs, matching the picker's treatment.
        Rectangle {
          anchors.fill: parent
          color: Util.alpha(Color.background, slab.selected ? 0 : slab.dimOpacity)
          Behavior on color { ColorAnimation { duration: 170 } }
        }

        // A valid drop destination washes the whole card in translucent
        // accent: the selected card is already outlined in the same colour,
        // so a difference in stroke width alone is easy to miss.
        Rectangle {
          anchors.fill: parent
          color: Util.alpha(root.selectedBorder, slab.dropTarget ? 0.18 : 0)
          Behavior on color { ColorAnimation { duration: 120 } }
        }
      }
    }

    // Border stroke over the mask.
    Shape {
      anchors.fill: parent
      antialiasing: true
      preferredRendererType: Shape.CurveRenderer
      ShapePath {
        fillColor: "transparent"
        strokeColor: slab.dropTarget ? root.selectedBorder
                     : slab.selected ? root.pickerSelectedBorder
                                     : root.pickerUnselectedBorder
        strokeWidth: slab.dropTarget ? 6 : slab.selected ? 3 : 1
        startX: slab.topLeft; startY: 0
        PathLine { x: slab.topRight; y: 0 }
        PathLine { x: slab.bottomRight; y: slab.height }
        PathLine { x: slab.bottomLeft; y: slab.height }
        PathLine { x: slab.topLeft; y: 0 }
      }
    }

    // Workspace number chip: a small parallelogram sharing the parent's
    // shear slope, accent on theme bg.
    Item {
      id: wsChip
      visible: slab.workspace !== null
      x: slab.skew + Style.space(10)
      y: Style.space(10)
      width: chipText.implicitWidth + Style.space(16)
      height: chipText.implicitHeight + Style.space(8)
      opacity: (slab.chipAlways || slab.selected) ? 1 : 0
      Behavior on opacity { NumberAnimation { duration: 170 } }

      readonly property real chipSk: height * root.skewSlope

      Shape {
        anchors.fill: parent
        antialiasing: true
        preferredRendererType: Shape.CurveRenderer
        ShapePath {
          fillColor: root.pickerSelectedBorder
          strokeColor: "transparent"
          startX: wsChip.chipSk; startY: 0
          PathLine { x: wsChip.width; y: 0 }
          PathLine { x: wsChip.width - wsChip.chipSk; y: wsChip.height }
          PathLine { x: 0; y: wsChip.height }
          PathLine { x: wsChip.chipSk; y: 0 }
        }
      }

      Text {
        id: chipText
        anchors.centerIn: parent
        text: slab.workspace ? slab.workspace.id : ""
        color: Color.menu.background
        font.family: Style.font.menuFamily
        font.pixelSize: Style.font.title
        font.weight: Font.DemiBold
      }
    }

    // Unselected slab: click (or hover, in grid mode) selects it. Hover
    // selection keys off real mouse motion, not onEntered — the area
    // re-enables under an idle cursor whenever the keyboard moves selection
    // away, and an onEntered there would snap selection straight back.
    // While the keyboard has priority, hover must travel a deliberate
    // distance before it re-takes selection.
    MouseArea {
      id: slabMouse
      anchors.fill: parent
      enabled: !slab.selected
      hoverEnabled: slab.hoverSelect
      cursorShape: Qt.PointingHandCursor

      property real refX: -1
      property real refY: -1
      readonly property bool kp: root.kbdPriority
      onKpChanged: { refX = -1; refY = -1 }
      onExited: { refX = -1; refY = -1 }

      // A drag's travel is not hover motion: start measuring again when one
      // ends, so releasing a drag over a card does not also select it.
      readonly property bool held: root.dragging
      onHeldChanged: { refX = -1; refY = -1 }

      onPositionChanged: function(mouse) {
        // Selection is frozen while a window is being carried: the pointer
        // crossing other cards is aiming the drag, not choosing a workspace.
        if (!slab.hoverSelect || root.dragging) return
        if (!root.kbdPriority) { slab.pressed(); return }
        if (refX < 0) { refX = mouse.x; refY = mouse.y; return }
        if (Math.abs(mouse.x - refX) + Math.abs(mouse.y - refY) > 24) {
          root.kbdPriority = false
          slab.pressed()
        }
      }
      onClicked: { root.kbdPriority = false; slab.pressed() }
    }
  }

  PanelWindow {
    id: panel
    visible: root.opened
    anchors { top: true; bottom: true; left: true; right: true }
    color: "transparent"
    WlrLayershell.namespace: "zzwong-stage"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: root.opened ? WlrKeyboardFocus.Exclusive : WlrKeyboardFocus.None
    exclusionMode: ExclusionMode.Ignore

    // Re-grab keyboard focus any time the overlay becomes visible; a missed
    // grab leaves arrows dead.
    onVisibleChanged: if (visible) Qt.callLater(function() { keyCatcher.forceActiveFocus() })

    // Near-opaque themed backdrop: Hyprland blur is disabled on this setup,
    // so a translucent scrim reads as broken glass rather than frosted.
    Rectangle {
      anchors.fill: parent
      color: Qt.alpha(Color.background, 0.92)
    }

    MouseArea {
      anchors.fill: parent
      onClicked: root.dismiss()
    }

    Item {
      id: keyCatcher
      anchors.fill: parent
      focus: true

      Keys.priority: Keys.BeforeItem

      Keys.onPressed: function(event) {
        // Any key that reaches us mid-hold is not an idle hold. Few do —
        // the compositor keeps its own Super chords — so the interval
        // above carries most of the weight.
        if (root.cycled) holdWatchdog.restart()
        keyCatcher.navigate(event)
      }

      // Only the modifier's release is ever delivered — its press precedes
      // the grab — as Key_Meta or Key_Super_L. Super only: a step carries no
      // modifier state, so any other would commit on one never cycled with.
      Keys.onReleased: function(event) {
        if (event.isAutoRepeat) return
        if (root.keybindMode !== "cycle" || !root.cycled) return
        if (event.key !== Qt.Key_Meta && event.key !== Qt.Key_Super_L
            && event.key !== Qt.Key_Super_R) return
        root.disarmCycle()
        root.activateCurrent()
        event.accepted = true
      }

      function navigate(event) {
        // A drag owns the keyboard: Escape cancels the gesture and nothing
        // navigates out from under it. The overlay stays open, so the next
        // Escape is the one that dismisses.
        if (root.dragging) {
          if (event.key === Qt.Key_Escape && !event.isAutoRepeat)
            root.endDrag("escape")
          event.accepted = true
          return
        }

        var grid = root.uiStyle === "picker" && root.viewMode === "grid"
        var caro = root.uiStyle === "picker" && root.viewMode === "carousel"
        var panes = caro && root.paneIndex >= 0

        // Held X must never cascade onto the pane the hand-off selects.
        // QtWayland marks every repeat of a client-side autorepeat, so the
        // first press is the only one without the flag: no latch to hold, and
        // none to be left set when focus leaves mid-hold.
        if (event.key === Qt.Key_X) {
          if (panes && event.modifiers === Qt.NoModifier && !event.isAutoRepeat) {
            root.kbdPriority = true
            root.requestWindowClose(root.paneAddress)
          }
          event.accepted = true
          return
        }

        if (event.key === Qt.Key_Escape) {
          // Autorepeat excluded: holding Escape to cancel a drag must not
          // then dismiss on the same press.
          if (!event.isAutoRepeat) root.dismiss()
          event.accepted = true
        } else if (event.key === Qt.Key_Up) {
          root.kbdPriority = true
          if (panes) {
            root.selectPane(-1)
          } else if (grid) {
            // Move up a row; past the top, fall back into the carousel
            // (unless locked to the grid).
            var up = root.selectedIndex - root.gridCols
            if (up >= 0) root.selectWorkspace(up)
            else if (root.viewPref === "auto") root.viewMode = "carousel"
          } else if (root.uiStyle === "picker" && root.viewPref === "auto") {
            root.viewMode = "grid"
          }
          event.accepted = true
        } else if (event.key === Qt.Key_Down) {
          root.kbdPriority = true
          if (grid) {
            // Move down a row; past the bottom, fall back into the carousel
            // (unless locked to the grid).
            var down = root.selectedIndex + root.gridCols
            if (down < root.slotCount) root.selectWorkspace(down)
            else if (root.viewPref === "auto") root.viewMode = "carousel"
          } else if (caro && root.paneIndex < 0 && root.selectedPanes.length > 0) {
            // Zoom one more level: into the panes of the expanded preview.
            root.selectPane(0)
          }
          event.accepted = true
        } else if (event.key === Qt.Key_Left
                   || (event.key === Qt.Key_Tab && event.modifiers & Qt.ShiftModifier)
                   || event.key === Qt.Key_Backtab) {
          root.kbdPriority = true
          root.advance(-1)
          event.accepted = true
        } else if (event.key === Qt.Key_Right || event.key === Qt.Key_Tab) {
          root.kbdPriority = true
          root.advance(1)
          event.accepted = true
        } else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
          root.activateCurrent()
          event.accepted = true
        } else if (event.key >= Qt.Key_1 && event.key <= Qt.Key_9) {
          root.focusWorkspace(event.key - Qt.Key_0)
          event.accepted = true
        }
      }

      // Two-finger swipe (horizontal scroll) in the carousel walks the
      // workspaces — or the panes when zoomed into them — matching ←/→.
      WheelHandler {
        id: swipeNav
        enabled: root.uiStyle === "picker" && root.viewMode === "carousel"
        target: null
        // Default orientation is Vertical, which drops horizontal events.
        orientation: Qt.Horizontal
        acceptedDevices: PointerDevice.Mouse | PointerDevice.TouchPad
        property real acc: 0
        onWheel: function(event) {
          // Inertia after a step would immediately re-trigger; swallow it.
          if (swipeCooldown.running) return
          // Touchpads on Wayland may report pixelDelta only (~60px ≈ one notch).
          acc += event.angleDelta.x !== 0 ? event.angleDelta.x
                                          : event.pixelDelta.x * 2
          swipeReset.restart()
          if (Math.abs(acc) >= 120) {
            var dir = acc > 0 ? -1 : 1
            acc = 0
            swipeCooldown.restart()
            root.kbdPriority = true
            root.advance(dir)
          }
        }
      }

      // A stale partial swipe must not carry into the next one.
      Timer { id: swipeReset; interval: 400; onTriggered: swipeNav.acc = 0 }
      Timer { id: swipeCooldown; interval: 140 }
    }

    // ------------------------------------------------------------------
    // "picker" style, carousel view: theme-switcher slice carousel.
    // ------------------------------------------------------------------
    Loader {
      active: root.opened && root.uiStyle === "picker" && root.viewMode === "carousel"
      anchors.centerIn: parent

      sourceComponent: Item {
        id: pickerCard

        readonly property real expandedW: Math.min(panel.width * 0.55, 980)
        readonly property real expandedH: expandedW / root.monAspect
        readonly property real sliceW: 108
        readonly property real sliceH: expandedH * 0.91
        readonly property real sliceSpacing: -30
        readonly property real itemStep: sliceW + sliceSpacing
        readonly property real previewX: (width - expandedW) / 2

        width: expandedW + Math.max(2, root.slotCount - 1) * 2 * itemStep + 80
        height: expandedH

        MouseArea { anchors.fill: parent; onClicked: {} }

        Repeater {
          // The slot model, not `slotCount`: an int model re-binds every
          // delegate's `workspace` when the list shifts. See slotModel.
          model: slotModel

          delegate: WsSlab {
            id: caroItem
            required property var modelData
            required property int index

            readonly property int relativeIndex: index - root.selectedIndex

            workspace: modelData === root.plusSlot ? null : modelData
            selected: index === root.selectedIndex
            skew: pickerCard.expandedH * root.skewSlope
            highlightAddress: selected ? root.paneAddress : ""

            x: selected ? pickerCard.previewX
                        : (relativeIndex < 0
                           ? pickerCard.previewX + relativeIndex * pickerCard.itemStep
                           : pickerCard.previewX + pickerCard.expandedW + pickerCard.sliceSpacing
                             + (relativeIndex - 1) * pickerCard.itemStep)
            width: selected ? pickerCard.expandedW : pickerCard.sliceW
            height: selected ? pickerCard.expandedH : pickerCard.sliceH
            y: selected ? 0 : (pickerCard.expandedH - pickerCard.sliceH) / 2
            z: selected ? 100 : 50 - Math.min(Math.abs(relativeIndex), 40)

            Behavior on x { NumberAnimation { duration: 170; easing.type: Easing.OutCubic } }
            Behavior on y { NumberAnimation { duration: 170; easing.type: Easing.OutCubic } }
            Behavior on width { NumberAnimation { duration: 170; easing.type: Easing.OutCubic } }
            Behavior on height { NumberAnimation { duration: 170; easing.type: Easing.OutCubic } }

            onPressed: root.selectWorkspace(index)
            onActivated: { root.selectWorkspace(index); root.activateSelected() }
            onWindowActivated: function(address) { root.focusWindow(address) }
          }
        }
      }
    }

    // ------------------------------------------------------------------
    // "picker" style, grid view: every workspace laid out responsively.
    // ------------------------------------------------------------------
    Loader {
      id: gridLoader
      active: root.gridActive
      anchors.fill: parent

      sourceComponent: Item {
        id: gridView

        readonly property real cardW: root.gridFit.w
        readonly property real cardH: root.gridFit.w / root.monAspect

        // The card under a scene point. Paint order decides overlaps: the
        // selected card is drawn above its siblings, scaled fringe included.
        function cardAt(scenePoint) {
          var selected = gridSlabs.itemAt(root.selectedIndex)
          var hit = selected ? selected.cardAt(scenePoint) : null
          if (hit) return hit
          for (var i = gridSlabs.count - 1; i >= 0; i--) {
            if (i === root.selectedIndex) continue
            hit = gridSlabs.itemAt(i).cardAt(scenePoint)
            if (hit) return hit
          }
          return null
        }

        Grid {
          anchors.centerIn: parent
          columns: root.gridCols
          columnSpacing: root.gridGap
          rowSpacing: root.gridGap

          Repeater {
            id: gridSlabs
            // The slot model. See the carousel Repeater.
            model: slotModel

            delegate: WsSlab {
              required property var modelData
              required property int index

              width: gridView.cardW
              height: gridView.cardH
              workspace: modelData === root.plusSlot ? null : modelData
              selected: index === root.selectedIndex
              skew: gridView.cardH * root.skewSlope
              chipAlways: true
              hoverSelect: true
              dimOpacity: 0.22

              scale: selected ? 1.03 : 1.0
              z: selected ? 2 : 1
              Behavior on scale { NumberAnimation { duration: 160; easing.type: Easing.OutCubic } }

              onPressed: root.selectWorkspace(index)
              onActivated: { root.selectWorkspace(index); root.activateSelected() }
              onWindowActivated: function(address) { root.focusWindow(address) }
            }
          }
        }
      }
    }

    // What is being dragged follows the pointer as a label: a second live
    // capture of the same window would cost another screencopy stream, and
    // the thumbnail it came from is still on screen.
    Rectangle {
      z: 1001
      visible: root.dragging
      // The handler reports its centroid in scene coordinates.
      readonly property point at:
        parent.mapFromItem(null, root.dragPoint.x, root.dragPoint.y)
      x: Math.min(at.x + Style.space(18), panel.width - width)
      y: Math.min(at.y + Style.space(18), panel.height - height)
      width: proxyLabel.width + Style.space(28)
      height: proxyLabel.implicitHeight + Style.space(18)
      radius: root.cornerRadius
      color: root.background
      border.width: 2
      // The same accent the destination card takes, so the pointer says
      // whether a release would do anything.
      border.color: root.dragDestination > 0 ? root.selectedBorder : root.border

      Text {
        id: proxyLabel
        anchors.centerIn: parent
        width: Math.min(implicitWidth, panel.width * 0.28)
        text: root.dragState.title
        textFormat: Text.PlainText
        elide: Text.ElideRight
        color: root.foreground
        font.family: Style.font.menuFamily
        font.pixelSize: Style.font.subtitle
      }
    }

    // Titles of the selected workspace's windows as clickable pills — shared
    // by both picker views. The "+" slot shows a create pill instead.
    Row {
      id: labelBar
      visible: root.opened && root.uiStyle === "picker"
      anchors.bottom: parent.bottom
      anchors.bottomMargin: Style.space(44)
      anchors.horizontalCenter: parent.horizontalCenter
      spacing: Style.space(8)

      Rectangle {
        visible: root.plusSelected
        width: plusText.implicitWidth + Style.space(20)
        height: Style.space(30)
        radius: height / 2
        color: Util.alpha(root.pickerText, plusMouse.containsMouse ? 0.16 : 0.08)
        border.color: Util.alpha(root.pickerSelectedBorder, 0.5)
        border.width: 1

        Text {
          id: plusText
          anchors.centerIn: parent
          text: "New workspace " + root.nextWorkspaceId()
          color: root.pickerText
          font.family: Style.font.menuFamily
          font.pixelSize: Style.font.subtitle
        }

        MouseArea {
          id: plusMouse
          anchors.fill: parent
          hoverEnabled: true
          cursorShape: Qt.PointingHandCursor
          onClicked: root.createWorkspace()
        }
      }

      Text {
        visible: !root.plusSelected && root.selectedPanes.length === 0
        text: "Empty workspace"
        color: Util.alpha(root.pickerText, 0.6)
        font.pixelSize: Style.font.title
        font.weight: Font.DemiBold
      }

      // The pills bind the workspace's ObjectModel, like the thumbnails: an
      // array is a new model on every membership change *and* on every
      // re-tile, and rebuilding a pill re-runs its MPRIS and PipeWire lookups
      // and reloads its album art. So this is not a Row — a Row lays its
      // children out in creation order, and these have to sit in pane order.
      // Each pill takes the x its place in `selectedPanes` earns it, and
      // slides across when a swap reorders them.
      Item {
        id: pillRow
        visible: !root.plusSelected && root.selectedPanes.length > 0
        height: Style.space(30)
        width: Math.max(0, pillRow.offsetOf(pills.count) - pillRow.gap)
        readonly property real gap: labelBar.spacing

        // Where the pill at `order` starts: every pill before it in pane
        // order, each with the gap that follows it. Reading their widths and
        // their order here is what makes the offsets re-evaluate when a title,
        // an album art badge or a swap changes one of them.
        function offsetOf(order) {
          var sum = 0
          for (var i = 0; i < pills.count; i++) {
            var p = pills.itemAt(i)
            if (p && p.order >= 0 && p.order < order) sum += p.width + pillRow.gap
          }
          return sum
        }

        Repeater {
          id: pills
          model: (root.plusSelected || !root.selectedWorkspace)
                 ? null : root.selectedWorkspace.toplevels

          delegate: Rectangle {
            id: pill
            required property var modelData

            readonly property var topl: modelData

            // Where this window sits in pane order, and therefore in the row.
            // A window the sort has not placed yet has nowhere to be drawn.
            readonly property int order:
              StageLogic.paneIndexFor(root.selectedPanes, String(topl.address))
            x: pillRow.offsetOf(pill.order)
            visible: pill.order >= 0
            Behavior on x { NumberAnimation { duration: 140; easing.type: Easing.OutCubic } }

            // The × sits on top of the pill and takes the hover with it, so the
            // pill is "hot" for either.
            readonly property bool hot: pillMouse.containsMouse || pillClose.hovered
            readonly property bool paneSelected: root.paneAddress !== ""
                                                 && root.paneAddress === String(topl.address)
            readonly property var player: root.playerForWindow(topl)
            readonly property bool hasTrack: player !== null
                                             && !!(player.trackTitle || player.trackArtist)
            readonly property bool playing: hasTrack && player.isPlaying === true
            readonly property string artUrl: hasTrack ? (player.trackArtUrl || "") : ""
            readonly property bool audible: !hasTrack && root.windowHasAudio(topl)

            readonly property string label: {
              if (pill.hasTrack) {
                var tt = pill.player.trackTitle || ""
                var ta = pill.player.trackArtist || ""
                return ta && tt ? ta + " — " + tt : (tt || ta)
              }
              var t = String(topl.title || "")
              if (!t && topl.wayland) t = String(topl.wayland.appId || "")
              return t || "Untitled"
            }

            width: content.implicitWidth + Style.space(20)
            height: Style.space(30)
            radius: height / 2
            color: Util.alpha(root.pickerText,
                              (pill.hot || pill.paneSelected) ? 0.16 : 0.08)
            border.color: pill.paneSelected ? root.pickerSelectedBorder
                          : pill.playing ? Util.alpha(root.pickerSelectedBorder, 0.7)
                                         : Util.alpha(root.pickerText, 0.18)
            border.width: 1
            Behavior on border.color { ColorAnimation { duration: 170 } }

            // Soft accent glow ring while playing or pane-highlighted.
            Rectangle {
              anchors.fill: parent
              anchors.margins: -3
              radius: height / 2
              color: "transparent"
              border.color: Util.alpha(root.pickerSelectedBorder, 0.3)
              border.width: 2
              opacity: (pill.playing || pill.paneSelected) ? 1 : 0
              Behavior on opacity { NumberAnimation { duration: 170 } }
            }

            // Vertical sheen + hairline top highlight.
            Rectangle {
              anchors.fill: parent
              radius: parent.radius
              gradient: Gradient {
                GradientStop { position: 0.0; color: Qt.rgba(1, 1, 1, 0.05) }
                GradientStop { position: 0.55; color: "transparent" }
              }
            }

            MouseArea {
              id: pillMouse
              anchors.fill: parent
              hoverEnabled: true
              cursorShape: Qt.PointingHandCursor
              onClicked: root.focusWindow(pill.topl.address)
            }

            Row {
              id: content
              anchors.centerIn: parent
              spacing: Style.space(7)

              // Album art from MPRIS, circle-cropped.
              ClippingRectangle {
                visible: pill.artUrl !== ""
                anchors.verticalCenter: parent.verticalCenter
                width: pill.height - Style.space(8)
                height: width
                radius: width / 2
                color: Util.alpha(root.pickerText, 0.1)

                Image {
                  anchors.fill: parent
                  source: pill.artUrl
                  fillMode: Image.PreserveAspectCrop
                  asynchronous: true
                  smooth: true
                }
              }

              // Play state, clickable to toggle without leaving the overview.
              Text {
                visible: pill.hasTrack
                anchors.verticalCenter: parent.verticalCenter
                text: pill.playing ? "󰏤" : "󰐊"
                color: pill.playing ? root.pickerSelectedBorder : root.pickerText
                font.pixelSize: Style.font.title

                MouseArea {
                  anchors.fill: parent
                  anchors.margins: -Style.space(4)
                  cursorShape: Qt.PointingHandCursor
                  onClicked: pill.player.togglePlaying()
                }
              }

              // Label: elided at rest; overflowing labels marquee on hover.
              Item {
                id: labelClip
                anchors.verticalCenter: parent.verticalCenter
                width: Math.min(measureText.implicitWidth, 320)
                height: measureText.implicitHeight
                clip: true

                readonly property bool overflowing: measureText.implicitWidth > width
                readonly property bool marquee: overflowing && pill.hot
                readonly property real gap: Style.space(24)

                Text {
                  id: measureText
                  visible: false
                  text: pill.label
                  textFormat: Text.PlainText
                  font.family: Style.font.menuFamily
                  font.pixelSize: Style.font.subtitle
                }

                Text {
                  visible: !labelClip.marquee
                  width: labelClip.width
                  text: pill.label
                  textFormat: Text.PlainText
                  color: root.pickerText
                  font.family: Style.font.menuFamily
                  font.pixelSize: Style.font.subtitle
                  elide: Text.ElideRight
                }

                Row {
                  id: scroller
                  visible: labelClip.marquee
                  spacing: labelClip.gap

                  Text {
                    text: pill.label
                    textFormat: Text.PlainText
                    color: root.pickerText
                    font.family: Style.font.menuFamily
                    font.pixelSize: Style.font.subtitle
                  }
                  Text {
                    text: pill.label
                    textFormat: Text.PlainText
                    color: root.pickerText
                    font.family: Style.font.menuFamily
                    font.pixelSize: Style.font.subtitle
                  }
                }

                SequentialAnimation {
                  running: labelClip.marquee
                  loops: Animation.Infinite
                  onRunningChanged: if (!running) scroller.x = 0

                  PauseAnimation { duration: 400 }
                  NumberAnimation {
                    target: scroller
                    property: "x"
                    from: 0
                    to: -(measureText.implicitWidth + labelClip.gap)
                    duration: Math.max(1500, (measureText.implicitWidth + labelClip.gap) * 16)
                  }
                  PauseAnimation { duration: 250 }
                }
              }

              // Always discoverable, including when the preview is too small.
              CloseControl {
                id: pillClose
                inline: true
                anchors.verticalCenter: parent.verticalCenter
                address: String(pill.topl.address)
                windowTitle: pill.label
              }

              // Audio badge for windows making sound without MPRIS metadata.
              Text {
                visible: pill.audible
                anchors.verticalCenter: parent.verticalCenter
                text: "󰕾"
                color: Util.alpha(root.pickerText, 0.7)
                font.pixelSize: Style.font.subtitle
              }
            }
          }
        }
      }
    }

    // ------------------------------------------------------------------
    // "cards" style: flat row of equal workspace cards.
    // ------------------------------------------------------------------
    Loader {
      active: root.opened && root.uiStyle === "cards"
      anchors.centerIn: parent

      sourceComponent: Row {
        id: cardRow

        readonly property int wsCount: Math.max(1, root.workspaceList.length)
        readonly property real cardGap: Style.spacing.md
        readonly property real maxCardW: (panel.width * 0.92 - cardGap * (wsCount - 1)) / wsCount
        readonly property real cardW: Math.min(panel.width * 0.3, maxCardW)
        readonly property real cardH: cardW / root.monAspect

        spacing: cardGap

        Repeater {
          // The model, not the array: a reassigned array is a new model and
          // recreates every card. See slotModel.
          model: workspaceModel

          delegate: Item {
            id: slot
            required property var modelData
            required property int index

            readonly property var workspace: modelData
            readonly property bool selected: root.selectedIndex === index
            readonly property bool isFocused: Hyprland.focusedWorkspace !== null
                                              && Hyprland.focusedWorkspace.id === workspace.id
            readonly property bool highlighted: selected || isFocused

            width: cardRow.cardW
            height: cardRow.cardH

            scale: selected ? 1.05 : (isFocused ? 1.02 : 1.0)
            z: selected ? 2 : (isFocused ? 1 : 0)
            Behavior on scale { NumberAnimation { duration: 160; easing.type: Easing.OutCubic } }

            Rectangle {
              anchors.fill: card
              anchors.margins: -3
              radius: root.cornerRadius + 3
              color: "transparent"
              border.color: Qt.alpha(root.selectedBorder, slot.selected ? 0.6 : 0.35)
              border.width: 3
              opacity: slot.highlighted ? 1 : 0
              Behavior on opacity { NumberAnimation { duration: 160 } }
            }

            Rectangle {
              id: card
              anchors.fill: parent
              radius: root.cornerRadius
              color: root.background
              border.color: slot.highlighted ? root.selectedBorder : root.border
              border.width: slot.highlighted ? 2 : 1
              Behavior on border.color { ColorAnimation { duration: 160 } }
              clip: true

              readonly property real sx: width / root.monLogicalW
              readonly property real sy: height / root.monLogicalH

              MouseArea {
                anchors.fill: parent
                hoverEnabled: true
                onPositionChanged: if (!root.kbdPriority) root.selectWorkspace(slot.index)
                onClicked: root.focusWorkspace(slot.workspace.id)
              }

              Repeater {
                // The model itself, so a close does not restart the
                // surviving captures. See the carousel Repeater.
                model: slot.workspace.toplevels

                delegate: Item {
                  id: thumb
                  required property var modelData

                  readonly property var topl: modelData
                  readonly property var ipc: topl.lastIpcObject

                  readonly property bool hasGeo: ipc !== null && ipc !== undefined
                                                 && ipc.at !== undefined && ipc.size !== undefined
                  readonly property real wx: hasGeo ? (ipc.at[0] - (root.monitor ? root.monitor.x : 0) - root.monReserved[0]) : root.monLogicalW * 0.1
                  readonly property real wy: hasGeo ? (ipc.at[1] - (root.monitor ? root.monitor.y : 0) - root.monReserved[1]) : root.monLogicalH * 0.1
                  readonly property real ww: hasGeo ? ipc.size[0] : root.monLogicalW * 0.8
                  readonly property real wh: hasGeo ? ipc.size[1] : root.monLogicalH * 0.8

                  x: wx * card.sx
                  y: wy * card.sy
                  width: Math.max(8, ww * card.sx)
                  height: Math.max(8, wh * card.sy)

                  Rectangle {
                    anchors.fill: parent
                    radius: Math.max(2, root.cornerRadius * card.sx * 4)
                    color: Qt.darker(root.background, 1.15)
                    border.color: root.border
                    border.width: 1
                    clip: true

                    ScreencopyView {
                      anchors.fill: parent
                      anchors.margins: 1
                      captureSource: (root.opened && thumb.topl.wayland) ? thumb.topl.wayland : null
                      live: true
                    }

                    Text {
                      anchors.centerIn: parent
                      width: parent.width - Style.spacing.md
                      visible: !thumb.topl.wayland
                      text: thumb.topl.title || ""
                      textFormat: Text.PlainText
                      color: root.foreground
                      font.family: Style.font.menuFamily
                      font.pixelSize: Style.font.bodySmall
                      elide: Text.ElideRight
                      horizontalAlignment: Text.AlignHCenter
                    }
                  }

                  HoverHandler { id: cardThumbHover }
                  MouseArea {
                    anchors.fill: parent
                    onClicked: root.focusWindow(thumb.topl.address)
                  }

                  // The card clips its content, so a window hanging over the
                  // monitor edge would lose the control; keep it inside. Same
                  // placement as the carousel with no shear and no overscan.
                  readonly property var closeSpot:
                    root.closeSpotFor(cardThumbHover.hovered, thumb, 0, 0, card, 0)

                  CloseControl {
                    shear: 0 // a flat card has no slant to match
                    x: thumb.closeSpot.x
                    y: thumb.closeSpot.y
                    visible: thumb.closeSpot.visible
                    address: String(thumb.topl.address)
                    windowTitle: String(thumb.topl.title || "window")
                  }
                }
              }

              Rectangle {
                anchors.fill: parent
                radius: root.cornerRadius
                color: Color.background
                opacity: slot.highlighted ? 0 : 0.25
                Behavior on opacity { NumberAnimation { duration: 160 } }
              }

              // Workspace label per badgeStyle flag.
              Text {
                visible: root.badgeStyle === "omarchy"
                anchors { top: parent.top; left: parent.left; margins: Style.space(4) }
                text: slot.isFocused ? "󱓻"
                                     : (slot.workspace.id === 10 ? "0" : String(slot.workspace.id))
                color: slot.isFocused ? root.selectedBorder : root.foreground
                font.family: Style.font.menuFamily
                font.pixelSize: Style.font.bodySmall
                font.bold: true
                style: Text.Outline
                styleColor: Color.background
              }

              Rectangle {
                visible: root.badgeStyle === "badge"
                anchors { top: parent.top; left: parent.left; margins: Style.space(4) }
                readonly property int badgeSize: wsLabel.implicitHeight + Style.space(3)
                width: Math.max(badgeSize, wsLabel.implicitWidth + Style.space(3))
                height: badgeSize
                radius: Style.cornerRadius / 2
                color: slot.isFocused ? root.selectedBorder : Qt.darker(root.background, 1.3)

                Text {
                  id: wsLabel
                  anchors.centerIn: parent
                  text: slot.workspace.id
                  color: slot.isFocused ? Color.menu.background : root.foreground
                  font.family: Style.font.menuFamily
                  font.pixelSize: Style.font.bodySmall
                  font.bold: true
                }
              }
            }
          }
        }
      }
    }
  }
}
