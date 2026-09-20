# Changelog

## 0.3.0

- Added graceful close controls to window thumbnails and title pills, plus
  `X` to close the selected pane without leaving Stage.
- Added thumbnail drag and drop between workspaces, including the `+` slot,
  with compositor-side validation and stable click behavior.
- Added `Shift` + arrow pane swaps and `Ctrl-Shift` + `←`/`→` workspace moves.
  Selection follows the edited window and swaps preserve the pointer position.
- Reworked workspace and pane reconciliation around stable identities, reducing
  preview churn and keeping geometry current after compositor changes.
- Consolidated input and compositor logic into an importable module with
  executed Lua scenarios and broader CI coverage.

## 0.2.1

- Security: window titles, app ids, and MPRIS track labels now render with
  `textFormat: Text.PlainText`. Qt's default `AutoText` could interpret an
  attacker-controlled title (e.g. a web page's tab title) as rich text
  inside the shell process. Reported by the marketplace baseline review.

## 0.2.0

- Hold-to-cycle: bind stepping keys and set `"keybindMode": "cycle"` for
  alt-tab workspace switching — hold `Super`, tap to walk, release to jump.
  Opt-in; the bound key behaves exactly as before without it.
- Stepping keys work in either mode, as another way to move the selection
  while Stage is open.
- Fixed: reopening Stage on the same workspace could restore a stale pane
  zoom from the previous open.

## 0.1.0

- Initial marketplace release.
