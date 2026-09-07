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
| `×` on a thumbnail / title pill | request graceful close without leaving Stage |
| the `+` slot at the end | create the next workspace |
| `Esc` / click outside | close |

Below the carousel, one pill per window. Windows with an MPRIS player
(Spotify, browsers, mpv) show album art, artist — track, and a play/pause
button that works without leaving the overview. Windows emitting audio
without MPRIS get a speaker badge. Labels that don't fit marquee on hover.
Every pill is click-to-focus outside its dedicated controls.

### Closing windows

The 32px `×` target appears on thumbnail hover, or on keyboard-selected
panes. Picker carousel/grid expose it on the selected workspace only; title
pills also have an always-visible `×` as a fallback for tiny previews. Cards
expose hover controls on individual previews, but have no pane mode or title
pill fallback. Thumbnails smaller than 64px in either dimension omit the
control rather than covering ordinary click targets; use picker pills for
those windows. This change adds no movement or dragging controls.

Closing sends Hyprland's normal close request, **never kill**. Stage stays
open and previews disappear only when the compositor removes the window.
Selection tracks the same window across geometry changes; when it actually
closes, the next pane (or previous at the end) is selected. Empty workspaces
leave pane mode. Duplicate requests to the same address are suppressed for
two seconds; after that you can retry if the application declines. Unsaved-work
dialogs may require focusing the application to answer them. Closing disarms
hold-to-cycle's release-to-focus action.

#### Close-controls QA

Automated: `node tests/close-controls.test.cjs`, plus the lint workflow commands.
Manual checklist (requires an isolated compositor or disposable windows; not
performed as part of the draft implementation):

- In carousel, grid, and cards, hover a preview and click `×`: Stage stays
  open; clicking elsewhere still focuses normally. Check small previews and
  picker pill fallback, including media play/pause and long titles.
- Enter pane mode with `↓`, close first/middle/last windows using `X`, and
  hold `X` across removal: only the original window receives a request.
- Modified `X`, grid/cards `X`, and autorepeat must not close windows.
- Decline an unsaved-work prompt; preview remains, and retry works after two
  seconds. Verify closing a pending window externally and workspace removal.
- Reorder window geometry externally: selection stays at the same address.
  Close the last pane; no stale selection or accidental focus/dismissal.
- Begin a mouse close after a cycle step: releasing Super must not activate.
  Inspect hover/keyboard visibility, 32px hit targets, clipping and accessibility
  names at different display scales.

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
