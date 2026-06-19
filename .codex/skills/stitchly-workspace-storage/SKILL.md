---
name: stitchly-workspace-storage
description: Route Stitchly auth, workspace selection, workflow CRUD, local storage root, workflow DuckDB, catalog browsing, persistence, identity, and workspace data-plane changes.
---

# Stitchly Workspace Storage

Use this skill for auth/session behavior, workspace routing, workflow CRUD, local-first storage, workflow-root layout, DuckDB catalog browsing, and persistence changes.

## Context Routing

- App shell, workspace screens, workflow routing: `apps/web/src/App.jsx`.
- Canvas workflow persistence and catalog UI: `apps/web/src/components/CanvasWorkspace.jsx`.
- Frontend API client: `apps/web/src/lib/api.js`.
- Backend workspace/workflow/catalog endpoints: `crates/runtime_server/src/lib.rs`.
- Runtime storage and run records: `crates/runtime_core/src/lib.rs`.
- API payloads: `crates/api_contract/src/lib.rs`.
- Platform/local paths: `crates/runtime_server/src/platform.rs`.

## Docs To Load

- Auth and workspace shell: `docs/00_foundation/20_app_auth_and_workspace_spec.md`.
- Workflow management: `docs/00_foundation/21_workflow_management_spec.md`.
- Storage root and identity: `docs/00_foundation/23_storage_root_and_identity_architecture.md`.
- Workflow-local DuckDB: `docs/00_foundation/24_workflow_duckdb_storage_spec.md`.
- Persistence basics: `docs/00_foundation/07_persistence.md`.
- Backend API when endpoints change: `docs/00_foundation/06_backend_api.md`.
- Workflow management UI: `docs/03_ui/06_workflow_management_ui.md`.

## Working Rules

1. Preserve the control-plane/data-plane split from the storage-root docs.
2. Keep secrets and identity-sensitive data out of workflow definitions and browser-visible metadata.
3. Treat workspace ID, workflow ID, and storage-root behavior as compatibility-sensitive.
4. For catalog browsing changes, verify frontend selection state and backend catalog shape together.
5. When changing persistence shape, update docs or decision log only if the long-lived contract changes.

## Validation

- Backend storage/API changes: run the narrow affected package check or test first; load `.codex/skills/stitchly-rust-quality/references/compile-routing.md` when choosing between server check, backend build, and restart.
- Frontend workspace/catalog changes: run `corepack pnpm --dir apps/web test --run`.
- Cross-stack catalog behavior may need the dev UI script: `scripts/dev_ui_agent.sh restart --no-open`, or `scripts/dev_ui_agent.sh restart --no-open --skip-build` when the existing backend binary is enough.

## Token Traps

- Avoid loading all workspace/storage foundation docs; pick the one matching the contract surface.
- Search backend endpoints by path segment before opening `runtime_server/src/lib.rs`.
