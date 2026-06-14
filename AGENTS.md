# Repository Contract

## Purpose

Stitchly is a local-first visual workflow and dataflow app. The frontend is a React editor and observability surface. The Rust backend owns validation, planning, execution, run lifecycle, persistence, and API transport.

This file is the first stop for agents. Keep it short. Load deeper docs only when the task requires them.

## Project Map

- `apps/web`: React/Vite app, app shell, canvas, menus, panels, frontend API client, and frontend tests.
- `crates/workflow_schema`: canonical workflow graph model and validation types.
- `crates/api_contract`: request/response and run/event payload contracts crossing the frontend/backend boundary.
- `crates/node_registry`: built-in node definitions and browser-safe node metadata.
- `crates/runtime_core`: planning, scheduling, run state, events, logs, cancellation, and runtime orchestration.
- `crates/runtime_adapters`: built-in node adapter implementations and integration/runtime bridges.
- `crates/runtime_server`: Axum HTTP/SSE API surface, workspace/workflow endpoints, platform paths.
- `tests`: shared fixtures and cross-crate integration tests.
- `design_lab`: isolated static UI studies; not production app code.
- `docs`: long-lived product and engineering memory.

## Context Routing

- Frontend UI, canvas, panels, CSS, design lab: use `.codex/skills/stitchly-ui-work`.
- Runs, logs, events, cancellation, SSE, run detail/history: use `.codex/skills/stitchly-run-runtime`.
- Node definitions, node cards, adapters, IO contracts: use `.codex/skills/stitchly-node-contract`.
- Auth, workspaces, workflow CRUD, storage roots, DuckDB catalogs: use `.codex/skills/stitchly-workspace-storage`.

Do not load `docs/02_build/00_llm_build_prompt.md` for routine work. It is a broad bootstrap prompt, not the daily context map.

## Doc Precedence

When docs overlap, prefer:

1. `docs/00_foundation/11_decision_log.md`
2. `docs/00_foundation/10_mvp_scope.md`
3. `docs/00_foundation/14_repo_structure_and_build.md`
4. the task-specific foundation/UI/execution doc
5. implementation reality in code and tests

Update the decision log only when a durable product or architecture direction changes.

## Working Style

- Start with `rg` and narrow file ranges; avoid reading large files end-to-end.
- Search by component, endpoint path, type name, event type, class prefix, or config key.
- Keep frontend execution-thin: it may invoke, render, and observe runs; Rust owns execution semantics.
- Keep secrets out of workflow definitions, frontend fixtures, and browser-visible metadata.
- Prefer existing local patterns over new abstractions.
- Do not edit generated fixtures or docs unless the contract change requires it.

## Validation

- Frontend tests: `corepack pnpm --dir apps/web test --run`
- Frontend typecheck: `corepack pnpm --dir apps/web typecheck`
- Rust tests: `cargo test --workspace`
- Dev UI stack: `npm run dev:ui:no-open`

If validation is skipped or unavailable, state that explicitly in the handoff.
