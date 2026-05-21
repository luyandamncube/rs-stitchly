# Design Lab

This folder is the isolated review space for Stitchly UI design work.

Purpose:

- build HTML and CSS samples without touching production UI
- review and reject visual patterns before implementation
- compare variants in a stable, static environment

Structure:

- `nodes/`
  Node-focused design studies.

Current convention:

- `nodes/v1/shared.css`
  Shared node-language stylesheet for the current node design pass.

- `nodes/v1/00_xxx/`
  Ordered node design samples for the first node-language pass.

How to use:

1. open a sample folder
2. review `README.md` for context
3. open `index.html` in the browser or serve the folder locally
4. approve or reject specific visual elements before implementation

This folder is intentionally static-first.
It is not the production app.
