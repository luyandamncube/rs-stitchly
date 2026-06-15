# Rust Crates Contract

## Purpose

The Rust workspace is the backend control plane. It owns workflow validation, node definitions, execution planning, run lifecycle, persistence-facing behavior, and HTTP/SSE transport.

## Crate Map

- `workflow_schema`: canonical workflow graph types.
- `api_contract`: frontend/backend payloads and shared API models.
- `node_registry`: built-in node definitions and UI-safe metadata.
- `runtime_core`: planner, scheduler, run state, events, logs, cancellation.
- `runtime_adapters`: node execution adapters and integration bridges.
- `runtime_server`: Axum routes, SSE, workspace/workflow/catalog endpoints, platform paths.

## Context Rules

- Use `.codex/skills/stitchly-run-runtime` for run lifecycle, SSE, logs, events, cancellation, and runtime state.
- Use `.codex/skills/stitchly-node-contract` for node definitions, adapters, runtime bindings, and node IO.
- Use `.codex/skills/stitchly-workspace-storage` for workspace, workflow, storage-root, DuckDB, and catalog APIs.
- Search by type name, endpoint path, event type, node type ID, or config key before opening broad file ranges.

## Guardrails

- Keep `runtime_server` thin; delegate business logic to lower-level crates.
- Keep browser-facing API data free of secrets.
- Keep node definition changes aligned with fixtures and frontend consumers.
- Preserve existing persisted IDs and storage-root semantics unless the task explicitly changes that contract.

## Rust Validation Policy

Rust work in this repo must avoid unnecessary native dependency rebuilds and Cargo lock contention.

### Default Rust validation

For changes under `crates/`, run the lightest relevant validation first:

```bash
scripts/dev_ui_agent.sh check
```

Then run the narrowest relevant test:

```bash
scripts/dev_ui_agent.sh test <test-name>
```

Only build the backend binary when the binary is needed:

```bash
scripts/dev_ui_agent.sh build
```

Only restart the full app when live backend/frontend behavior must be checked:

```bash
scripts/dev_ui_agent.sh restart --no-open
```

### Avoid broad tests while iterating

Do not run broad commands such as these during early iteration unless explicitly justified:

```bash
cargo test -p runtime_server
cargo test --workspace
cargo build --workspace
```

Prefer a specific test name when one is known. Use full workspace tests only when the change crosses crate boundaries, changes shared contracts, or the user explicitly asks.

### Cargo concurrency rule

Do not start a new Cargo command while another Cargo command is active. If a command is waiting on a build directory lock, inspect the existing process instead of launching a second command with another `CARGO_TARGET_DIR`.

Avoid this pattern unless the user explicitly asks for isolated builds:

```bash
CARGO_TARGET_DIR=/tmp/stitchly-runtime-server-check cargo check -p runtime_server
```

### DuckDB-heavy paths

DuckDB-related code can trigger expensive native compilation through `libduckdb-sys`. If the change does not touch DuckDB, workspace catalog table preview, table storage, or DuckDB-backed runtime behavior, avoid commands that unnecessarily compile or test DuckDB-heavy paths.

When a DuckDB compile error appears, prefer checking the public API of the installed crate version before changing dependency versions. For example, avoid importing private modules such as `duckdb::config`; prefer public re-exports such as `duckdb::Config` and `duckdb::AccessMode` when available.

### Preserve the WSL-safe build shape

The project is currently tuned to compile safely on limited-memory WSL environments:

```bash
CARGO_BUILD_JOBS=1 cargo +nightly -Znext-lockfile-bump ... -j 1
```

Do not increase build parallelism unless the user explicitly asks.

### Reporting validation

If validation is skipped or unavailable, state that explicitly in the handoff. Include the exact command run and the first meaningful error when a command fails.
