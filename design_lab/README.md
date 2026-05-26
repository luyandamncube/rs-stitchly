# Design Lab

This folder is the isolated review space for Stitchly UI design work.

Purpose:

- build HTML and CSS samples without touching production UI
- review and reject visual patterns before implementation
- compare variants in a stable, static environment

Structure:

- `nodes/`
  Node-focused design studies.
- `login/`
  Login and authentication screen studies.
- `dashboard/`
  Dashboard and application-shell studies.
- `canvas/`
  Canvas chrome and overlay control studies.
- `menu/`
  Collapsed rail, tooltip, and popout node-shelf studies.
- `runs/`
  Workflow run-state and run-surface studies.
- `runs_node/`
  Node-level runtime state and execution-appearance studies.
- `runs_history/`
  Canvas popup run-history and logs-window studies.

Current convention:

- `nodes/v1/shared.css`
  Shared node-language stylesheet for the current node design pass.

- `nodes/v1/00_xxx/`
  Ordered node design samples for the first node-language pass.

- `login/v1/00_xxx/`
  Ordered login design studies for the first login-shell pass.

- `dashboard/v1/00_xxx/`
  Ordered dashboard design studies for the first dashboard-shell pass.

- `menu/v1/00_xxx/`
  Ordered menu and navigation studies for the first collapsed-rail pass.

How to use:

1. open a sample folder
2. review `README.md` for context
3. open `index.html` in the browser or serve the folder locally
4. approve or reject specific visual elements before implementation

This folder is intentionally static-first.
It is not the production app.
