import Quickshell
import Quickshell.Io
import Quickshell.Hyprland
import Quickshell.Wayland
import Quickshell.Widgets
import Quickshell.Services.Mpris
import Quickshell.Services.Pipewire
import QtQuick
import QtQuick.Effects
import QtQuick.Shapes
import qs.Commons
import qs.Ui

Item {
  id: root

  property var shell: null
  property var manifest: null

  // Feature flags, set in settings.json next to this file (hot-reloads):
  //   style: "picker" — omarchy theme-picker pattern: skewed slice carousel,
  //                     selected workspace expands to a large live preview.
  //          "cards"  — flat row of equal workspace cards.
  //   badgeStyle ("cards" style only): "badge" rounded square | "omarchy"
  //                     bar-style numeral/glyph.
  property string uiStyle: "picker"
  property string badgeStyle: "badge"

  FileView {
    path: Quickshell.env("HOME") + "/.config/omarchy/plugins/zzwong.overview/settings.json"
    onLoaded: {
      try {
        var s = JSON.parse(text())
        if (s.style === "picker" || s.style === "cards") root.uiStyle = s.style
        if (s.badgeStyle === "badge" || s.badgeStyle === "omarchy")
          root.badgeStyle = s.badgeStyle
      } catch (e) {}
    }
  }

  property bool opened: false
  property int selectedIndex: -1

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

  property var workspaceList: []

  function rebuildWorkspaces() {
    var out = []
    var values = Hyprland.workspaces.values
    for (var i = 0; i < values.length; i++) {
      var ws = values[i]
      if (ws.id <= 0) continue // skip special workspaces
      if (root.monitor && ws.monitor && ws.monitor.id !== root.monitor.id) continue
      out.push(ws)
    }
    out.sort(function(a, b) { return a.id - b.id })
    root.workspaceList = out

    root.selectedIndex = out.length > 0 ? 0 : -1
    for (var j = 0; j < out.length; j++) {
      if (Hyprland.focusedWorkspace && out[j].id === Hyprland.focusedWorkspace.id)
        root.selectedIndex = j
    }
  }

  function open(payloadJson) {
    Hyprland.refreshWorkspaces()
    Hyprland.refreshToplevels() // fresh geometry in lastIpcObject
    root.rebuildWorkspaces()
    root.opened = true
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }

  function close() {
    root.opened = false
  }

  function dismiss() {
    root.opened = false
    if (root.shell && typeof root.shell.hide === "function")
      root.shell.hide((root.manifest && root.manifest.id) || "zzwong.overview")
  }

  function toggle() {
    if (root.opened) root.dismiss()
    else root.open("{}")
  }

  function luaDispatch(lua) {
    Quickshell.execDetached(["hyprctl", "dispatch", lua])
  }

  function focusWorkspace(id) {
    root.dismiss()
    root.luaDispatch("hl.dsp.focus({ workspace = \"" + id + "\" })")
  }

  function focusWindow(address) {
    root.dismiss()
    // Quickshell reports toplevel addresses without the 0x prefix.
    var addr = String(address)
    if (addr.indexOf("0x") !== 0) addr = "0x" + addr
    root.luaDispatch("hl.dsp.focus({ window = \"address:" + addr + "\" })")
  }

  function selectAdjacent(delta) {
    if (root.workspaceList.length === 0) return
    root.selectedIndex = (root.selectedIndex + delta + root.workspaceList.length)
                         % root.workspaceList.length
  }

  function activateSelected() {
    if (root.selectedIndex >= 0 && root.selectedIndex < root.workspaceList.length)
      root.focusWorkspace(root.workspaceList[root.selectedIndex].id)
  }

  PanelWindow {
    id: panel
    visible: root.opened
    anchors { top: true; bottom: true; left: true; right: true }
    color: "transparent"
    WlrLayershell.namespace: "zzwong-overview"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: root.opened ? WlrKeyboardFocus.Exclusive : WlrKeyboardFocus.None
    exclusionMode: ExclusionMode.Ignore

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

    // Re-grab keyboard focus any time the overlay becomes visible; a missed
    // grab leaves arrows dead.
    onVisibleChanged: if (visible) Qt.callLater(function() { keyCatcher.forceActiveFocus() })

    Item {
      id: keyCatcher
      anchors.fill: parent
      focus: true

      Keys.priority: Keys.BeforeItem
      Keys.onPressed: function(event) {
        if (event.key === Qt.Key_Escape) {
          root.dismiss()
          event.accepted = true
        } else if (event.key === Qt.Key_Left
                   || (event.key === Qt.Key_Tab && event.modifiers & Qt.ShiftModifier)
                   || event.key === Qt.Key_Backtab) {
          root.selectAdjacent(-1)
          event.accepted = true
        } else if (event.key === Qt.Key_Right || event.key === Qt.Key_Tab) {
          root.selectAdjacent(1)
          event.accepted = true
        } else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
          root.activateSelected()
          event.accepted = true
        } else if (event.key >= Qt.Key_1 && event.key <= Qt.Key_9) {
          root.focusWorkspace(event.key - Qt.Key_0)
          event.accepted = true
        }
      }
    }

    // ------------------------------------------------------------------
    // "picker" style: theme-switcher carousel of skewed workspace slices.
    // ------------------------------------------------------------------
    Loader {
      active: root.opened && root.uiStyle === "picker"
      anchors.centerIn: parent

      sourceComponent: Item {
        id: pickerCard

        readonly property real expandedW: Math.min(panel.width * 0.55, 980)
        readonly property real expandedH: expandedW / root.monAspect
        readonly property real sliceW: 108
        readonly property real sliceH: expandedH * 0.91
        readonly property real sliceSpacing: -30
        readonly property real skewOffset: 28
        readonly property real itemStep: sliceW + sliceSpacing
        readonly property real previewX: (width - expandedW) / 2

        width: expandedW + Math.max(2, root.workspaceList.length - 1) * 2 * itemStep + 80
        height: expandedH + Style.space(24) + labelBar.height

        MouseArea { anchors.fill: parent; onClicked: {} }

        Item {
          id: carousel
          anchors.top: parent.top
          anchors.horizontalCenter: parent.horizontalCenter
          width: pickerCard.width
          height: pickerCard.expandedH
          clip: false

          Repeater {
            model: root.workspaceList

            delegate: Item {
              id: item
              required property var modelData
              required property int index

              readonly property var workspace: modelData
              readonly property int relativeIndex: index - root.selectedIndex
              readonly property bool selected: index === root.selectedIndex

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

              // Every item is a skewed parallelogram, selected included —
              // same shape language as the theme picker.
              readonly property real sk: pickerCard.skewOffset
              readonly property real topLeft: sk
              readonly property real topRight: width
              readonly property real bottomRight: width - sk
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
                    startX: item.topLeft; startY: 0
                    PathLine { x: item.topRight; y: 0 }
                    PathLine { x: item.bottomRight; y: item.height }
                    PathLine { x: item.bottomLeft; y: item.height }
                    PathLine { x: item.topLeft; y: 0 }
                  }
                }
              }

              Item {
                anchors.fill: parent
                // Workspace content is wider than a slice; clip before the
                // skew mask so it cannot spill outside the item.
                clip: true
                layer.enabled: true
                layer.smooth: true
                layer.effect: MultiEffect {
                  maskEnabled: true
                  maskSource: maskShape
                  maskThresholdMin: 0.3
                  maskSpreadAtMin: 0.3
                }

                // Workspace content at monitor aspect, height-fit and centered
                // so narrow slices show a horizontal crop of the middle.
                Item {
                  id: wsContent
                  anchors.centerIn: parent
                  // Slight overscan crops the workspace's outer gaps so window
                  // edges never show inside the preview.
                  readonly property real overscan: 1.04
                  height: item.height * overscan
                  width: height * root.monAspect

                  readonly property real sx: width / root.monLogicalW
                  readonly property real sy: height / root.monLogicalH

                  Rectangle {
                    anchors.fill: parent
                    color: root.background
                  }

                  // Clicking empty preview space jumps to the workspace.
                  MouseArea {
                    anchors.fill: parent
                    enabled: item.selected
                    onClicked: root.focusWorkspace(item.workspace.id)
                  }

                  Repeater {
                    model: item.workspace.toplevels.values

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

                      Rectangle {
                        anchors.fill: parent
                        color: Qt.darker(root.background, 1.15)
                        border.color: root.border
                        border.width: item.selected ? 1 : 0
                        clip: true

                        ScreencopyView {
                          anchors.fill: parent
                          anchors.margins: item.selected ? 1 : 0
                          captureSource: (root.opened && thumb.topl.wayland) ? thumb.topl.wayland : null
                          live: true
                        }
                      }

                      MouseArea {
                        anchors.fill: parent
                        enabled: item.selected
                        onClicked: root.focusWindow(thumb.topl.address)
                      }
                    }
                  }

                  // Dim unselected slices, matching the picker's treatment.
                  Rectangle {
                    anchors.fill: parent
                    color: Util.alpha(Color.background, item.selected ? 0 : 0.42)
                    Behavior on color { ColorAnimation { duration: 170 } }
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
                  strokeColor: item.selected ? root.pickerSelectedBorder : root.pickerUnselectedBorder
                  strokeWidth: item.selected ? 3 : 1
                  startX: item.topLeft; startY: 0
                  PathLine { x: item.topRight; y: 0 }
                  PathLine { x: item.bottomRight; y: item.height }
                  PathLine { x: item.bottomLeft; y: item.height }
                  PathLine { x: item.topLeft; y: 0 }
                }
              }

              // Workspace number chip on the expanded preview: a small
              // parallelogram echoing the slice shape, accent on theme bg.
              Item {
                id: wsChip
                x: item.sk + Style.space(10)
                y: Style.space(10)
                width: chipText.implicitWidth + Style.space(16)
                height: chipText.implicitHeight + Style.space(8)
                opacity: item.selected ? 1 : 0
                Behavior on opacity { NumberAnimation { duration: 170 } }

                // Same shear slope as the parent parallelogram, so the chip's
                // angled edges are parallel to the preview's.
                readonly property real chipSk: height * item.sk / Math.max(1, item.height)

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
                  text: item.workspace.id
                  color: Color.menu.background
                  font.family: Style.font.menuFamily
                  font.pixelSize: Style.font.title
                  font.weight: Font.DemiBold
                }
              }

              // Slice-level click: select it (double action once selected is
              // handled by the inner MouseAreas).
              MouseArea {
                anchors.fill: parent
                enabled: !item.selected
                cursorShape: Qt.PointingHandCursor
                onClicked: root.selectedIndex = item.index
              }
            }
          }
        }

        // Titles of the selected workspace's windows as clickable pills.
        Row {
          id: labelBar
          anchors.top: carousel.bottom
          anchors.topMargin: Style.space(16)
          anchors.horizontalCenter: carousel.horizontalCenter
          spacing: Style.space(8)

          readonly property var selectedToplevels:
            (root.selectedIndex >= 0 && root.selectedIndex < root.workspaceList.length)
            ? root.workspaceList[root.selectedIndex].toplevels.values : []

          Text {
            visible: labelBar.selectedToplevels.length === 0
            text: "Empty workspace"
            color: Util.alpha(root.pickerText, 0.6)
            font.pixelSize: Style.font.title
            font.weight: Font.DemiBold
          }

          Repeater {
            model: labelBar.selectedToplevels

            delegate: Rectangle {
              id: pill
              required property var modelData

              readonly property var topl: modelData
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
              color: Util.alpha(root.pickerText, pillMouse.containsMouse ? 0.16 : 0.08)
              border.color: pill.playing ? Util.alpha(root.pickerSelectedBorder, 0.7)
                                         : Util.alpha(root.pickerText, 0.18)
              border.width: 1
              Behavior on border.color { ColorAnimation { duration: 170 } }

              // Soft accent glow ring while playing.
              Rectangle {
                anchors.fill: parent
                anchors.margins: -3
                radius: height / 2
                color: "transparent"
                border.color: Util.alpha(root.pickerSelectedBorder, 0.3)
                border.width: 2
                opacity: pill.playing ? 1 : 0
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
                  readonly property bool marquee: overflowing && pillMouse.containsMouse
                  readonly property real gap: Style.space(24)

                  Text {
                    id: measureText
                    visible: false
                    text: pill.label
                    font.family: Style.font.menuFamily
                    font.pixelSize: Style.font.subtitle
                  }

                  Text {
                    visible: !labelClip.marquee
                    width: labelClip.width
                    text: pill.label
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
                      color: root.pickerText
                      font.family: Style.font.menuFamily
                      font.pixelSize: Style.font.subtitle
                    }
                    Text {
                      text: pill.label
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
          model: root.workspaceList

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
                onEntered: root.selectedIndex = slot.index
                onClicked: root.focusWorkspace(slot.workspace.id)
              }

              Repeater {
                model: slot.workspace.toplevels.values

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
                      color: root.foreground
                      font.family: Style.font.menuFamily
                      font.pixelSize: Style.font.bodySmall
                      elide: Text.ElideRight
                      horizontalAlignment: Text.AlignHCenter
                    }
                  }

                  MouseArea {
                    anchors.fill: parent
                    onClicked: root.focusWindow(thumb.topl.address)
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
