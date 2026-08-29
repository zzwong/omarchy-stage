## What changed

<!-- A sentence or two; the commit bodies carry the detail. -->

## Smoke checks

README, CI, or metadata only? Delete this section and say so — it exists for
changes that reach the running overlay.

Run these on a real Hyprland session. The compositor consumes keybinds and
gestures before Stage ever sees them, so that path is invisible to qmllint
and is where regressions land.

Leave a box unchecked and say why — hardware you don't have, or a section
your change doesn't touch. An unchecked box with a reason is a fine PR; a
checked box nobody ran is not.

Always:

- [ ] The bound key opens Stage, and pressing it again closes it
- [ ] `←` `→` `Tab` `Shift-Tab` walk the carousel; `Enter` jumps to the selection
- [ ] `Esc` and a click outside both close
- [ ] `omarchy-shell shell hide zzwong.stage` closes Stage

Navigation, the keybind path, or open/close:

- [ ] Stepping keys walk forward and back; releasing `Super` jumps
      (`"keybindMode": "cycle"`)
- [ ] `hide` still closes after a step, rather than stepping again
- [ ] `↓` zooms into panes: `←` `→` walk windows, `Enter` focuses one, `↑` backs out
- [ ] `↑` reaches the grid; arrows move spatially; top and bottom edges fall back
      to the carousel
- [ ] The `+` slot creates the next workspace
- [ ] `1`–`9` jump to that workspace directly

Layout or theming:

- [ ] `"view": "carousel"` and `"view": "grid"` lock to one view
- [ ] `omarchy theme set <theme>` re-colors Stage

Touchpad only — skip if you have none; the `summon`/`hide` calls above reach
the same code these gestures do:

- [ ] Three-finger swipe up opens; swipe down closes
- [ ] Swipe down closes after a step, rather than stepping again
- [ ] Two-finger horizontal swipe walks the carousel, and the panes when zoomed in

Not covered by anything here: multi-monitor, since the previews follow the
focused monitor.

<details>
<summary>Driving Stage without keybinds or gestures</summary>

```bash
omarchy-shell shell summon zzwong.stage                    # open
omarchy-shell shell summon zzwong.stage '{"step":1}'       # step forward
omarchy-shell shell summon zzwong.stage '{"step":-1}'      # step back
omarchy-shell shell hide zzwong.stage                      # close
```

Releasing `Super` to commit has no IPC equivalent — it needs a real key
release, so `"keybindMode": "cycle"` can only be verified by hand.

</details>
