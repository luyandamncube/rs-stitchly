# Runs Node Lab

This folder is the isolated review space for node-level runtime state design.

Purpose:

- design how individual nodes look during workflow execution
- keep node-run states separate from top-level workflow run states
- compare runtime appearance patterns before implementing them in the live canvas

Structure:

- `v1/`
  First pass for node-run states and node-level run UI language.

Why this is separate from `runs/`:

- `runs/` focuses on top-level workflow execution surfaces
- `runs_node/` focuses on how each node itself should look while a workflow run is happening

This folder is intentionally static-first.
It is not the production app.
