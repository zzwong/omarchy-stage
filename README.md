# Stage

[![lint](https://github.com/zzwong/omarchy-stage/actions/workflows/lint.yml/badge.svg)](https://github.com/zzwong/omarchy-stage/actions/workflows/lint.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![marketplace](https://img.shields.io/badge/omarchy-marketplace-8839ef.svg)](https://omarchyplugins.com/plugin.html?id=zzwong.stage)

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
| the `+` slot at the end | create the next workspace |
| `Esc` / click outside | close |

Below the carousel, one pill per window. Windows with an MPRIS player
(Spotify, browsers, mpv) show album art, artist — track, and a play/pause
button that works without leaving the overview. Windows emitting audio
without MPRIS get a speaker badge. Labels that don't fit marquee on hover.
Every pill is click-to-focus.

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

## Notes

- Workspace previews map the monitor's usable area (bar struts excluded) and
  overscan slightly so outer gaps never show.
- Only workspaces on the focused monitor are shown; special workspaces are
  skipped.
- Colors come entirely from the Omarchy theme (`image-picker` and `menu`
  surfaces, plus the accent), so it re-themes with `omarchy theme set`.

## License

MIT
