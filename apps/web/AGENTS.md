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

## Frontend Validation Policy

For changes under `apps/web`, prefer frontend-only validation first.

### Default frontend validation

Run frontend tests for behavior changes:

```bash
corepack pnpm --dir apps/web test --run
```

Run frontend typecheck when touching props, API shapes, or shared helpers:

```bash
corepack pnpm --dir apps/web typecheck
```

When a narrower Vitest command is available, prefer the narrower command.

### Avoid unnecessary Rust rebuilds

Do not run Rust builds for frontend-only changes unless the change also affects:

- API contracts,
- backend routes,
- generated node definitions,
- runtime execution behavior,
- workflow schema compatibility,
- frontend/backend integration that requires a live backend.

### Live app validation

If the frontend needs a live backend, use the project script instead of ad hoc backend commands:

```bash
scripts/dev_ui_agent.sh restart --no-open
```

Do not launch separate `cargo check`, `cargo build`, or `cargo test` commands in parallel with the startup script.

### Canvas/workflow areas

For canvas and workflow UI changes, inspect the focused files first:

- `src/App.jsx`
- `src/components/CanvasWorkspace.jsx`
- `src/components/WorkflowCanvas.jsx`
- `src/lib/workflow.js`
- `src/lib/workflowTemplates.js`
- `src/lib/workspaceConnectionsSync.js`
- `src/lib/runSync.js`
- `src/styles.css`

Prefer nearby tests before broad test runs.

### Reporting validation

If validation is skipped or unavailable, state that explicitly in the handoff. Include the exact command run and the first meaningful error when a command fails.
