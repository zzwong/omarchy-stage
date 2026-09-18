# Stage

[![version](https://img.shields.io/github/manifest-json/v/zzwong/omarchy-stage?label=version&color=blue)](CHANGELOG.md)
[![lint](https://github.com/zzwong/omarchy-stage/actions/workflows/lint.yml/badge.svg)](https://github.com/zzwong/omarchy-stage/actions/workflows/lint.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![marketplace](https://img.shields.io/badge/omarchy-marketplace-8839ef.svg)](https://plugins.omarchy.org/plugin.html?id=zzwong.stage)

Mission Control for Omarchy. One keypress (or a three-finger swipe) shows
every workspace as a live preview in the theme-picker's slice carousel;
`Esc`, a click outside, or a swipe down closes it.

![Stage carousel](preview-carousel.png)

![Stage grid](preview-grid.png)

The selected workspace expands to a large live preview — real window content
via screencopy, including workspaces you can't see — with the others fanned
out as skewed slices, same shape language as `omarchy theme set`.

## Install

```bash
omarchy plugin add https://github.com/zzwong/omarchy-stage --enable
```

Then bind a key — Omarchy already uses `Super+Tab` for workspace cycling, so
`` Super+` `` (right above Tab) is a good spot, in
`~/.config/hypr/bindings.lua`:

```lua
o.bind("SUPER + GRAVE", "Stage", "omarchy-shell shell toggle zzwong.stage")
```

On a touchpad, three-finger swipes feel great too (gestures are user config
in Omarchy) — add to `~/.config/hypr/input.lua`:

```lua
hl.gesture({
  fingers = 3,
  direction = "up",
  action = function() hl.exec_cmd("omarchy-shell shell toggle zzwong.stage") end,
})
hl.gesture({
  fingers = 3,
  direction = "down",
  action = function() hl.exec_cmd("omarchy-shell shell hide zzwong.stage") end,
})
```

## Uninstall

```bash
omarchy plugin remove zzwong.stage
```

Then drop the keybind or gestures you added.

## Use

| Input | Action |
|---|---|
| `←` `→` `Tab` `Shift-Tab` | move through workspaces |
| two-finger swipe ← → | same, in the carousel (walks panes when zoomed in) |
| `↑` / `↓` | one zoom axis: grid ↕ carousel ↕ panes. In the grid, arrows move spatially and leaving the top or bottom edge falls back to the carousel; in the carousel, `↓` zooms into the workspace's windows — `←` `→` walk them, `Enter` focuses one, `↑` backs out |
| `Enter` | jump to the selected workspace |
| `1`–`9` | jump to that workspace directly |
| click a slice | select it |
| click the expanded preview | jump — window thumbnails are individually clickable |
| `X` (no modifiers, pane mode only) | request graceful close of the selected window; hold/repeat never closes another pane |
| `Shift` + `←` `→` `↑` `↓` (pane mode only) | swap the selected window with its tiled neighbour in that direction |
| `Ctrl-Shift` + `←` `→` (pane mode only) | send the selected window to the previous/next workspace in the row, without leaving Stage |
| `×` on a thumbnail / title pill | request graceful close without leaving Stage |
| the `+` slot at the end | create the next workspace |
| `Esc` / click outside | close |

Below the carousel, one pill per window. Windows with an MPRIS player
(Spotify, browsers, mpv) show album art, artist — track, and a play/pause
button that works without leaving the overview. Windows emitting audio
without MPRIS get a speaker badge. Labels that don't fit marquee on hover.
Every pill is click-to-focus outside its dedicated controls.

### Closing windows

The `×` target appears on thumbnail hover, or on keyboard-selected panes,
sized off the shell's spacing scale like everything else in the overlay. Picker carousel/grid expose it on the selected workspace only; title
pills also have an always-visible `×` as a fallback for tiny previews. Cards
expose hover controls on individual previews, but have no pane mode or title
pill fallback. Thumbnails too small to hold the control clear of the window
omit it rather than covering ordinary click targets; use picker pills for
those windows. The control sits inside the visible part of its preview, so
the workspace slab's skewed mask never clips it, and it takes a contrasting
glyph on hover. This change adds no movement or dragging controls.

Closing sends Hyprland's normal close request, **never kill**. Stage stays
open and previews disappear only when the compositor removes the window.
Selection tracks the same window across geometry changes; when it actually
closes, pane mode goes to the window that stood next to it (the one before it
at the end of the row), wherever the re-tile has since moved that window.
Empty workspaces leave pane mode. The surviving previews pick up the compositor's new tiling
while Stage stays open: Stage refreshes window geometry on the compositor's
events — all of them but the handful that provably move nothing — and after
each request it sends itself, since several Hyprland dispatchers re-tile
while announcing nothing at all. A burst is batched into one refresh, so
nothing has to be reopened to look right. Workspaces arriving and leaving are
batched the same way, and each slot is keyed by its workspace rather than by
its position, so a workspace appearing in the middle of the row leaves the
previews either side of it — and the live captures inside them — running
untouched. Duplicate requests to the same address are suppressed for
two seconds; after that you can retry if the application declines. Unsaved-work
dialogs may require focusing the application to answer them. Closing disarms
hold-to-cycle's release-to-focus action.

Every Stage action — closing, and jumping to a window or workspace — is a
Hyprland **Lua** dispatch, sent over Hyprland's own request socket, so Stage
needs a Lua config (Omarchy's default). Under a hyprlang config those
dispatchers do not exist and the actions do nothing: Stage warns once when it
loads, and Quickshell logs each dispatch the compositor rejects.

#### Close-controls QA

Automated: `node tests/run.cjs`, plus the lint workflow commands.
Manual checklist (requires an isolated compositor or disposable windows):

- In carousel, grid, and cards, hover a preview and click `×`: Stage stays
  open; clicking elsewhere still focuses normally. Check small previews and
  picker pill fallback, including media play/pause and long titles.
- Enter pane mode with `↓`, close first/middle/last windows using `X`, and
  hold `X` across removal: only the original window receives a request.
- Modified `X`, grid/cards `X`, and autorepeat must not close windows.
- Decline an unsaved-work prompt; preview remains, and retry works after two
  seconds. Verify closing a pending window externally and workspace removal.
- With Stage open, create and destroy several workspaces in one `hyprctl
  --batch`: the row settles in one step and the previews on the workspaces
  you did not touch keep playing rather than blinking out and restarting.
- Reorder window geometry externally: selection stays at the same address.
  Close the last pane; no stale selection or accidental focus/dismissal.
- Begin a mouse close after a cycle step: releasing Super must not activate.
  Inspect hover/keyboard visibility, hit targets, clipping and accessibility
  names at different display scales, and that hovering a pill's × keeps the
  pill itself highlighted.

### Moving windows

In the picker's grid (`↑` from the carousel), drag a window's thumbnail onto
another workspace card — or onto the `+` slot — to move that window there.
The thumbnail takes the pointer over once it has travelled 12 logical pixels;
below that the press is still a click, and clicking a thumbnail, a card or
`+` does exactly what it always did. A label of the window being moved
follows the pointer, and the card a release would land on is washed in the
accent colour and takes a thicker border; nothing is highlighted while a
release would do nothing.

A drop lands on a card as a whole. The workspace chip and the thumbnails
drawn on it are part of the card, so releasing anywhere inside its skewed
outline moves the window to that workspace.

Moves do not follow the window: the compositor's focus and the desktop's
workspace stay where they are, and Stage stays open on what you were looking
at. `+` creates the next free workspace, counted at the moment of release
from the workspaces this monitor is showing — the number printed on the card
itself. Thumbnails re-tile in place afterwards, on the compositor's own
events; nothing has to be reopened.

`Esc` cancels the gesture instead of closing Stage, and the release that
follows it does nothing; the next `Esc` closes Stage as usual. Dropping onto
the source workspace, outside every card, onto a workspace that disappeared
while the button was down, or after the window itself was closed or moved
away, all do nothing. Selection is frozen while a window is being carried,
and picking one up disarms hold-to-cycle's release-to-focus action — an
ordinary click does not.

Every move is one Lua chunk Hyprland runs for itself: it resolves the window,
checks it and moves it in one call, so nothing is decided against state read
before the request went out. It refuses a window the compositor no longer
has, one that is unmapped or hidden, one that is **grouped** — Hyprland's
move dispatcher acts on the whole group when its selector names a member, and
moving a group behind a single thumbnail would be a surprise — and a
destination workspace that lives on another monitor. Floating and fullscreen
windows move normally. A destination that no longer exists is refused rather
than recreated; only a drop on the `+` slot may bring a workspace into being.
One guard, in the compositor, for every move Stage asks for.

Grouped windows also refuse to lift at all, so the gesture never starts on
one; ungroup the window first. Dragging is grid-only — not carousel slices,
flat cards or title pills — and dropping a window on its own workspace never
reorders or swaps panes, which is deliberately left to a later change.

#### Drag QA

Automated: `node tests/run.cjs`, plus the lint workflow commands.
Manual checklist (requires an isolated compositor or disposable windows):

- Click, sub-threshold drag, and drag on the selected and unselected cards:
  selection and focus behave exactly as before the gesture existed, including
  a click that drifts a few pixels and a click on `+`.
- Move to another workspace and to `+`; Stage stays open, the desktop does
  not follow, and both cards re-tile without reopening.
- Press `Esc` mid-drag, then release: nothing is focused, Stage stays open,
  and the next `Esc` closes it.
- Release in card gaps, on skew-cut corners, on the source workspace and
  outside every card: nothing happens. Release on another card's workspace
  chip and the window moves, as anywhere else on that card.
- Close the dragged window, and empty the destination workspace, with the
  pointer held still: the highlight goes away and the release does nothing.
- Drag a grouped window: no proxy, and no move even if one is forced past the
  affordance — the compositor refuses it. Drag with a close `×` visible: the
  `×` still closes, and dragging from elsewhere on the thumbnail works.

### Moving windows

In pane mode, `Shift` + an arrow swaps the selected window with the tiled
window next to it in that direction, and `Ctrl-Shift` + `←`/`→` sends it to
the workspace next to this one in the row Stage is showing. Stage stays open
and the selection stays on the window: after a swap the highlight follows it
into its new place, and after a move Stage scrolls to the workspace it landed
on. The desktop's own workspace does not change — nothing is focused and
nothing is switched to until you press `Enter`.

Destinations are the neighbouring entries of the row, not the next workspace
number: with workspaces 1, 3 and 7 on screen the window goes 1 → 3 → 7 and
back. There is no wrapping at either end and no special workspaces; the row
has to already contain the destination, so a keyboard move never reaches a
workspace the `+` slot has not made. Swaps pick the nearest window whose
centre lies in that direction and whose span overlaps the selected window's,
on the same workspace and monitor, so a window that only touches it
diagonally is not a neighbour and an edge is simply a no-op.

A **swap** rearranges a tiling, so both windows have to be ordinary tiled
ones: floating, grouped, hidden and fullscreen windows are left alone, and so
is a window that became one of those since Stage drew it. A **move** only has
to get the window out, so it is the same request a dragged thumbnail makes,
with the same guard: it refuses a window that has gone, is unmapped, is
hidden or is grouped, and a destination on another monitor, but floating and
fullscreen windows move normally.

Each edit is a **single** Hyprland Lua dispatch that resolves the window,
chooses the neighbour and swaps — or moves — inside the compositor, so
nothing is ever decided against geometry that has already changed. There is
no helper process, no polling, no busy state and no Python dependency;
Hyprland answers requests on one socket in order, so a repeat cannot overtake
the edit before it. Hyprland warps the hardware cursor onto a swapped window,
which would leave Stage's hover-select pointing somewhere nobody aimed, so
the swap puts the pointer back where it was. `Esc` still dismisses, and
editing disarms hold-to-cycle's release-to-focus action.

**A move takes the selection with it, and only its own.** Stage knows the
destination when it sends the request, so it scrolls there and keeps the pane
zoom on the same window immediately, rather than trying to notice the window
arrive: Quickshell takes a moved window out of its old workspace before it
puts it in the new one, and a workspace the move empties is destroyed in the
same breath, so a selection inferred from that lands on a sibling. A move
made from outside Stage is not followed — the selection hands over to the
window that stood next to it, as it does for a close.

#### Moving-windows QA

Automated: `node tests/run.cjs` (the `routeKey` matrix for presses and
releases, the move destinations, and the generated Lua executed against a
mocked compositor in `tests/chunk.lua`), plus the lint workflow commands.
Manual checklist (isolated compositor or disposable windows):

- In a 2×2 tiling, `Shift` + each arrow swaps with the right neighbour and the
  highlight stays on the same window as its pane index moves.
- Every outer edge, and a diagonal-only neighbour, are no-ops: no geometry
  change, nothing lands on another workspace or monitor.
- With workspaces 1, 3, 7: `Ctrl-Shift-→` walks 1 → 3 → 7 and `Ctrl-Shift-←`
  back, creating no 2/4/8 and never wrapping. Stage stays open, the selection
  follows, the desktop's workspace does not move, and emptying a workspace
  removes it from the row without warnings.
- Floating, grouped and fullscreen selections do not swap. Grouped windows do
  not move either; floating and fullscreen ones do.
- Hold `Ctrl-Shift-→` from the first workspace: the same window travels along
  the row, never a sibling, and the pane zoom is on it at every stop.
- After each swap the pointer is where it was before the key was pressed.
- Hold an editing chord and alternate chords quickly: no stale edits.
- `Ctrl`/`Alt` + arrow neither edit nor navigate; ordinary arrows,
  `Tab`/`Shift-Tab`, `Enter`, `↑`/`↓` zoom and the keypad's arrows and `Enter`
  still work — including in `cycle` mode, with `Super` held down the whole
  time.
- In `keybindMode: "cycle"`, an edit disarms the commit and a later step
  re-arms it.

## Settings

Optional. Defaults are built in; to override:

```bash
cp ~/.config/omarchy/plugins/zzwong.stage/settings.example.json \
   ~/.config/omarchy/plugins/zzwong.stage/settings.json
```

`settings.json` is re-read each time Stage opens:

| Key | Values | Meaning |
|---|---|---|
| `style` | `"picker"` (default), `"cards"` | slice carousel, or a flat row of equal cards |
| `view` | `"auto"` (default), `"carousel"`, `"grid"` | `auto` opens in the carousel with `↑`/`↓` zooming between views; the others lock Stage to a single view |
| `badgeStyle` | `"badge"` (default), `"omarchy"` | cards style only: rounded-square badge, or the bar's bare numeral/glyph |
| `keybindMode` | `"toggle"` (default), `"cycle"` | `cycle` makes releasing the modifier jump to the selection — see below |

### Stepping keys

A summon carrying a `step` moves the selection when Stage is already open,
and opens Stage when it isn't. Bind one per direction, in
`~/.config/hypr/bindings.lua`:

```lua
hl.unbind("SUPER + TAB")
hl.unbind("SUPER + SHIFT + TAB")
o.bind("SUPER + TAB", "Stage",
  "omarchy-shell shell summon zzwong.stage '{\"step\":1}'")
o.bind("SUPER + SHIFT + TAB", "Stage back",
  "omarchy-shell shell summon zzwong.stage '{\"step\":-1}'")
```

Any chord works; the example unbinds Omarchy's stock `Super+Tab` workspace
cycling only because Stage supersedes it. Stepping works in either
`keybindMode` — on its own it's just another way to move the selection while
Stage is open.

### Hold-to-cycle

Add `"keybindMode": "cycle"` to `settings.json` and those stepping keys
become alt-tab: keep `Super` held, tap to walk the workspaces, release
`Super` to jump to the selected one. Opening Stage without stepping commits
nothing, so a plain tap still just opens it and `←` `→` `Enter` `Esc` behave
as always.

Hold-to-cycle watches for `Super` specifically, so pick a `Super` chord for
your stepping keys — a step carries no modifier of its own, and committing on
any modifier release would jump on one you never cycled with. Leave the hold
idle for ten seconds and the jump disarms; `Enter` still commits.

Stepping is the only navigation available while `Super` is down: Hyprland
keeps its own `Super` chords, so `Super`+arrows stay window focus and never
reach Stage. Release without stepping to browse with the arrows instead.

When Stage is zoomed into a workspace's windows (`↓`), stepping walks those
windows instead, and releasing `Super` focuses the selected one.

Only a step arms the jump, so `hide` always means hide — the swipe-down
gesture and `Esc` close Stage no matter what is held.

## Notes

- Workspace previews map the monitor's usable area (bar struts excluded) and
  overscan slightly so outer gaps never show.
- Only workspaces on the focused monitor are shown; special workspaces are
  skipped.
- Colors come entirely from the Omarchy theme (`image-picker` and `menu`
  surfaces, plus the accent), so it re-themes with `omarchy theme set`.

## License

MIT
