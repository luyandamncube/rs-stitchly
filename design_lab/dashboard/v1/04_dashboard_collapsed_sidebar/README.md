# 04 Dashboard Collapsed Sidebar

Type: `collapsed-shell-study`

Purpose:

- explore a compact dashboard navigation state inspired by a slim icon rail
- test whether Stitchly can support a premium collapsed utility shell without losing clarity
- create a side-by-side comparison point against the fuller sidebar study in `03`

What this sample is testing:

- narrow icon-first rail with grouped utilities
- softer active state and badge treatment inside a compact nav
- whether the collapsed shell still feels premium rather than cramped
- how much context the main panel needs while the rail is minimized

What this sample intentionally includes:

- compact top control button
- Stitchly brand tile
- grouped primary and secondary icon actions
- active nav state
- small notification badge
- muted main content placeholders for context

What this sample intentionally does not solve yet:

- hover/tooltips or expanded-on-hover behavior
- keyboard/focus behavior
- animated transition between full and collapsed rails
- mobile navigation treatment
- exact icon set finalization

Shared styling:

- this sample uses `../shared.css`
- collapsed-rail helpers are appended to the shared stylesheet rather than using a local override file

Review questions:

- does the collapsed rail still feel premium and useful?
- is the active treatment too subtle or about right?
- should Stitchly support both full and collapsed dashboard rails?
- is this a better fit for dashboard mode than the fuller sidebar in `03`?
