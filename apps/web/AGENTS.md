# Web App Contract

## Purpose

`apps/web` is the React/Vite frontend. It owns editing, navigation, observability, and browser-side state. It does not own workflow execution semantics, secret resolution, or canonical backend validation.

## File Map

- `src/App.jsx`: application shell, auth/workspace screens, workflow screens, canvas menu popups, runs-history panel.
- `src/components/CanvasWorkspace.jsx`: canvas orchestration, node management UI, run control, data/catalog panels, floating cards.
- `src/components/WorkflowCanvas.jsx`: React Flow nodes, handles, edges, canvas interactions.
- `src/lib/api.js`: frontend API client.
- `src/lib/workflow.js`: frontend workflow graph helpers.
- `src/lib/nodeCard.js`: node-card presentation helpers.
- `src/lib/*Sync.js`: browser event helpers for cross-component invalidation.
- `src/styles.css`: current monolithic stylesheet.

## Context Rules

- Use `.codex/skills/stitchly-ui-work` for UI, panel, canvas, style, and design-lab integration work.
- Use `.codex/skills/stitchly-run-runtime` for run control, run detail, logs, events, and history UI.
- Use `.codex/skills/stitchly-workspace-storage` for workspace, workflow routing, catalog, and persistence UI.
- Search first. `App.jsx`, `CanvasWorkspace.jsx`, `WorkflowCanvas.jsx`, and `styles.css` are large.
- For CSS changes, search the exact class prefix and read a narrow surrounding range.

## Design Lab Boundary

Use `design_lab` to inspect or create static UI studies. Do not add backend calls, production routing, or real persistence to lab samples.

## Validation

- Run `corepack pnpm --dir apps/web test --run` for behavior changes.
- Run `corepack pnpm --dir apps/web typecheck` when touching props, API shapes, or shared helpers.
