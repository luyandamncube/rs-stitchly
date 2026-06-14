---
name: stitchly-run-runtime
description: Route Stitchly run execution, run history, event stream, persisted logs, cancellation, runtime state, SSE, run detail UI, runtime_core, runtime_server, and API contract changes.
---

# Stitchly Run Runtime

Use this skill for changes that affect workflow runs, node runs, run detail, events, logs, cancellation, execution state, or the run-history UI.

## Context Routing

- Runtime state machine and in-memory run records: `crates/runtime_core/src/lib.rs`.
- HTTP and SSE endpoints: `crates/runtime_server/src/lib.rs`.
- Frontend API calls: `apps/web/src/lib/api.js`.
- Run popup/history UI: `apps/web/src/App.jsx` around `CanvasRunsHistoryPanel`.
- Canvas run control and floating run detail: `apps/web/src/components/CanvasWorkspace.jsx`.
- Shared API payload types: `crates/api_contract/src/lib.rs`.
- Integration fixtures: `tests/fixtures/runs/*` and `tests/integration/run_flow.rs`.

## Docs To Load

- Run lifecycle and event model: `docs/00_foundation/18_run_lifecycle_and_events.md`.
- Durable run history and debugging: `docs/00_foundation/22_run_history_and_debugging_spec.md`.
- Real run implementation plan: `docs/04_execution/06_run_execution_implementation_spec.md`.
- Backend API shape when endpoints change: `docs/00_foundation/06_backend_api.md`.
- Testing expectations: `docs/00_foundation/13_testing_strategy.md`.

Load execution contract docs only when node execution semantics change:

- `docs/04_execution/01_node_io_and_execution_contracts.md`
- `docs/04_execution/03_execution_contract.md`
- `docs/04_execution/04_adapter_contract.md`

## Working Rules

1. Identify whether the task is UI-only, API-only, runtime-only, or cross-stack.
2. Preserve backend ownership of execution semantics; frontend should observe and invoke.
3. For polling, streams, and detail views, check stale-state and duplicate-fetch behavior.
4. Keep stored events/logs durable enough to survive refresh and backend restart where the current storage layer supports it.
5. Validate Rust changes with `cargo test --workspace` or the narrow affected package test when practical.
6. Validate frontend run UI changes with `corepack pnpm --dir apps/web test --run`.

## Token Traps

- Do not read all of `runtime_core`, `runtime_server`, `App.jsx`, or `CanvasWorkspace.jsx` up front.
- Search by endpoint path, event type, run status, component name, or API helper.
- Avoid loading broad build prompts; the run-specific docs above are the source map.
