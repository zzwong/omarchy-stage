# Window management

Stage lets you close, drag, and move windows without leaving the overview.
The picker style offers carousel, grid, and pane views; the cards style has
its own thumbnails and close controls.

## Window title pills

Below the carousel, each window has a title pill. Windows with an MPRIS
player, such as Spotify, a browser, or mpv, show album art, track details,
and a play/pause button. Windows emitting audio without MPRIS get a speaker
badge. Long labels scroll on hover. Clicking a pill outside its controls
focuses the window.

## Close a window

Press `↓` from the carousel to enter pane mode, select a window, then press
unmodified `X`. You can also click `×` on a thumbnail or title pill. The
close control appears on thumbnail hover or on the selected pane. In the
picker, only the selected workspace exposes thumbnail controls; its title
pills provide a fallback when a preview is too small. Cards show controls
on hover but have no pane mode or title pills.

Stage sends Hyprland's normal close request, so an application can show an
unsaved-work dialog. Stage remains open and removes the preview only after
the compositor removes the window. If the application declines, you can
retry after two seconds. You may need to focus the application to answer its
dialog. Holding `X` or letting it auto-repeat does not close another pane.

Selection follows the same window through geometry changes. When it closes,
pane mode selects the window that stood next to it, or leaves pane mode if
none remains. The surviving previews reflect the new tiling without
reopening Stage. Closing a window disarms a pending hold-to-cycle jump.

## Drag between workspaces

In the picker's grid, drag a window thumbnail onto another workspace card to
move it there, or onto `+` to create the next workspace and move it there.
Dragging begins after 12 logical pixels; a shorter movement is still a
click. A label follows the pointer, and a valid destination gets an accent
highlight. The whole card is a drop target, including its workspace chip
and thumbnails.

Stage stays open on the same workspace after a move. The compositor's focus
and the desktop's workspace do not change. The destination's windows re-tile
in place. `+` uses the next free workspace number on the current monitor at
the time of release.

Press `Esc` during a drag to cancel it; the next `Esc` closes Stage. Drops on
the source workspace, outside a card, or on a workspace that disappeared
while dragging have no effect. A drag also cancels if the window closes or
moves away before release. Selection stays fixed during the drag, and
starting one disarms a pending hold-to-cycle jump.

Grouped windows cannot be dragged: Hyprland would move the whole group from
a single thumbnail. Ungroup the window first. Floating and fullscreen
windows can move. Dragging is available in the grid, not on carousel slices,
cards, or title pills. Dropping on the source workspace does not swap panes;
use the keyboard controls below.

## Move with the keyboard

In pane mode, `Shift` + an arrow swaps the selected tiled window with its
neighbour in that direction. `Ctrl-Shift` + `←`/`→` moves it to the previous
or next workspace in Stage's row. Stage remains open. Selection stays on the
window after a swap and follows it to the destination workspace after a move.
The desktop's workspace does not change until you press `Enter`.

Workspace moves use the displayed row, not consecutive numbers: with
workspaces 1, 3, and 7, the keys walk 1 → 3 → 7 and back. They do not wrap,
create a workspace, or use special workspaces. A swap requires a tiled
neighbour whose span overlaps the selected window's in the requested
direction; a diagonal-only window and an outer edge do nothing.

Both windows in a swap must be ordinary tiled windows. Floating, grouped,
hidden, and fullscreen windows cannot swap. A workspace move refuses a
window that is gone, unmapped, hidden, or grouped, or a destination on
another monitor. Floating and fullscreen windows can move. Editing disarms
a pending hold-to-cycle jump.

## Compositor behavior

Window actions run through Hyprland Lua dispatches, so they require Omarchy's
default Lua config. A hyprlang config lacks these dispatchers: Stage warns
when it loads and Quickshell logs rejected requests.

For moves and swaps, Stage resolves the window and validates the destination
inside one compositor request. This keeps a change in window state between
input and dispatch from moving the wrong window. Swaps restore the pointer
after Hyprland warps it. If a window moves away outside Stage, selection
passes to the pane that stood next to it; a move started inside Stage keeps
selection on the moved window.
