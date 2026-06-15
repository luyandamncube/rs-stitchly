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

## Build and Validation

Stitchly has expensive Rust dependencies, including DuckDB-backed paths. Validation must be cheap, sequential, and targeted.

### Use the project script first

Prefer the project startup/debug script over ad hoc Cargo commands:

```bash
scripts/dev_ui_agent.sh check
scripts/dev_ui_agent.sh test <test-name>
scripts/dev_ui_agent.sh build
scripts/dev_ui_agent.sh timings
scripts/dev_ui_agent.sh restart --no-open
```

The backend compile path is intentionally WSL-safe and low-memory:

```bash
CARGO_BUILD_JOBS=1 cargo +nightly -Znext-lockfile-bump ... -j 1
```

Preserve this behavior unless the user explicitly asks to tune build parallelism.

### One Cargo command at a time

Never run multiple Cargo commands concurrently in this repo. Do not start `cargo check`, `cargo build`, and `cargo test` at the same time. Cargo target-dir lock contention is expensive here and can make debugging much slower.

Before starting a long Rust validation, check whether another Cargo command is already running. If one is active, do not start another command. Wait for the current command, cancel the redundant command, or tell the user validation is blocked by the existing process.

### Do not bypass lock contention with temporary target dirs

Avoid commands like this unless the user explicitly asks for isolated builds:

```bash
CARGO_TARGET_DIR=/tmp/stitchly-runtime-server-check cargo check -p runtime_server
```

Using a temporary target dir may avoid a lock, but it creates a separate cache and can duplicate expensive dependency work.

### Validation ladder

Use the cheapest validation that proves the change.

1. For frontend-only changes under `apps/web`, run frontend tests first:

   ```bash
   corepack pnpm --dir apps/web test --run
   ```

2. Run frontend typecheck when touching props, API shapes, or shared helpers:

   ```bash
   corepack pnpm --dir apps/web typecheck
   ```

3. For Rust-only changes, run:

   ```bash
   scripts/dev_ui_agent.sh check
   ```

4. If a specific Rust test is relevant, run:

   ```bash
   scripts/dev_ui_agent.sh test <test-name>
   ```

5. Only build the backend binary when a binary is required:

   ```bash
   scripts/dev_ui_agent.sh build
   ```

6. Only restart the live app when runtime behavior must be exercised:

   ```bash
   scripts/dev_ui_agent.sh restart --no-open
   ```

7. Only run broad Rust tests when the user explicitly asks or the change is risky enough to justify it:

   ```bash
   cargo test --workspace
   ```

### Dev UI stack

For normal app startup, prefer:

```bash
scripts/dev_ui_agent.sh restart --no-open
```

Use `npm run dev:ui:no-open` only when explicitly validating the package-script path.

### Reporting validation

When reporting validation results, include:

- the exact command run,
- whether it passed or failed,
- the first meaningful error if it failed,
- any skipped validation and why it was skipped.
