# Nodes V1

This folder holds the first shared node-language pass for the Stitchly design lab.

Conventions:

- `shared.css`
  The shared stylesheet for all node samples in `nodes/v1/`.

- `00_xxx/`
  A specific node sample folder.

Each node sample folder should usually contain:

- `index.html`
- `README.md`

Preferred rule:

- all node samples in `nodes/v1/` should use `shared.css`
- avoid per-node CSS files unless a sample genuinely needs a tiny local override
- if a local override is ever needed later, keep it minimal and clearly justified

Reason:

- keeps the design language consistent
- makes design review easier
- makes later translation into production UI much more straightforward
