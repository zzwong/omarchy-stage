# Manual QA

Run `node tests/run.cjs` and the lint workflow commands for automated checks.
Use an isolated compositor or disposable windows for the manual checks below.

## Close controls

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

## Grid drag

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

## Keyboard window movement

The automated coverage includes the `routeKey` matrix for presses and
releases, move destinations, and generated Lua executed against a mocked
compositor in `tests/chunk.lua`.

- In a 2×2 tiling, `Shift` + each arrow swaps with the right neighbour and
  the highlight stays on the same window as its pane index moves.
- Every outer edge, and a diagonal-only neighbour, are no-ops: no geometry
  change, nothing lands on another workspace or monitor.
- With workspaces 1, 3, 7: `Ctrl-Shift-→` walks 1 → 3 → 7 and
  `Ctrl-Shift-←` back, creating no 2/4/8 and never wrapping. Stage stays
  open, the selection follows, the desktop's workspace does not move, and
  emptying a workspace removes it from the row without warnings.
- Floating, grouped and fullscreen selections do not swap. Grouped windows
  do not move either; floating and fullscreen ones do.
- Hold `Ctrl-Shift-→` from the first workspace: the same window travels along
  the row, never a sibling, and the pane zoom is on it at every stop.
- After each swap the pointer is where it was before the key was pressed.
- Hold an editing chord and alternate chords quickly: no stale edits.
- `Ctrl`/`Alt` + arrow neither edit nor navigate; ordinary arrows,
  `Tab`/`Shift-Tab`, `Enter`, `↑`/`↓` zoom and the keypad's arrows and `Enter`
  still work — including in `cycle` mode, with `Super` held down the whole time.
- In `keybindMode: "cycle"`, an edit disarms the commit and a later step
  re-arms it.
