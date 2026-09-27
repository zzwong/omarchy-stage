# Settings and keybindings

Stage uses built-in defaults. To customize them, copy the example settings:

```bash
cp ~/.config/omarchy/plugins/zzwong.stage/settings.example.json \
   ~/.config/omarchy/plugins/zzwong.stage/settings.json
```

Stage reads `settings.json` each time it opens.

| Key | Values | Meaning |
|---|---|---|
| `style` | `"picker"` (default), `"cards"` | Slice carousel or a flat row of equal cards |
| `view` | `"auto"` (default), `"carousel"`, `"grid"` | Let `↑`/`↓` switch views, or lock the view |
| `badgeStyle` | `"badge"` (default), `"omarchy"` | In cards style, use a rounded badge or the bar's plain numeral/glyph |
| `keybindMode` | `"toggle"` (default), `"cycle"` | Toggle normally or jump to the selection when `Super` is released after stepping |

## Touchpad gestures

Gestures are configured in Omarchy, not Stage. Add these to
`~/.config/hypr/input.lua` to open and close Stage with three fingers:

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

Two-finger horizontal swipes navigate within Stage's carousel or pane view.

## Stepping keys

A `summon` request with `step` opens Stage, or moves its selection when it is
already open. For example, add these to `~/.config/hypr/bindings.lua`:

```lua
hl.unbind("SUPER + TAB")
hl.unbind("SUPER + SHIFT + TAB")
o.bind("SUPER + TAB", "Stage",
  "omarchy-shell shell summon zzwong.stage '{\"step\":1}'")
o.bind("SUPER + SHIFT + TAB", "Stage back",
  "omarchy-shell shell summon zzwong.stage '{\"step\":-1}'")
```

The unbinds replace Omarchy's stock workspace cycling. You can choose other
chords. Stepping works with either `keybindMode`.

## Hold-to-cycle

Set `"keybindMode": "cycle"` and bind stepping keys to a `Super` chord.
Hold `Super`, tap to walk through workspaces, and release it to jump to the
selection. In pane mode, stepping walks windows and release focuses the
selected one. Opening Stage without stepping arms no jump.

The jump disarms after ten idle seconds. `Enter` still activates the
selection. Editing or dragging a window also disarms the jump; a later step
arms it again.

Hyprland keeps its own `Super`+arrow bindings, so use the stepping keys while
`Super` is held. Release it to browse with arrows. `Esc`, swipe down, and
`omarchy-shell shell hide zzwong.stage` close Stage even after a step.

## Display and theme

Stage shows regular workspaces on the focused monitor and skips special
workspaces. Previews cover the monitor's usable area and overscan slightly so
outer gaps do not show. Colors come from the active Omarchy theme and update
with `omarchy theme set`.
