# Stitchly Compile Routing

Use the cheapest validation that proves the change. Prefer `scripts/dev_ui_agent.sh` helpers when available, and never run concurrent Cargo commands in this repo.

## Surface Map

- `apps/web/**`: React/Vite only. Run `corepack pnpm --dir apps/web test --run`; add `corepack pnpm --dir apps/web typecheck` for props, API shapes, or shared helpers. No Rust compile is needed.
- `design_lab/**`: static UI studies. Validate by opening or serving the study when needed; no production build is implied.
- `crates/node_registry/**`: browser-safe node definitions, metadata, ports, config schema, and card-facing data. Prefer `cargo check -p node_registry` until the script exposes named checks.
- `crates/workflow_schema/**`: canonical workflow graph/schema. Expect fan-out into contracts, runtime, tests, and frontend fixtures.
- `crates/api_contract/**`: backend/frontend API payloads. Check Rust consumers and matching frontend API/UI tests.
- `crates/runtime_adapters/**`: concrete node execution adapters. This is the heavy path because DuckDB/parquet pulls `arrow-*`; prefer `cargo check -p runtime_adapters` before building the server.
- `crates/runtime_core/**`: planning, scheduling, run state, events, logs, and cancellation. Prefer `cargo check -p runtime_core`; build the server only when runtime behavior must be exercised over HTTP/SSE.
- `crates/runtime_server/**`: Axum routes, workspace/workflow/catalog endpoints, platform paths. Prefer `cargo check -p runtime_server`; build or restart only when the binary must run.
- `tests/**`: run the narrow relevant test first. Use workspace tests only when the change is cross-crate or risky.

## Heavy Dependency Clues

`duckdb` with the `parquet` feature pulls Arrow crates including `arrow-string`. If Arrow or `libduckdb-sys` rebuilds on a no-op run, suspect a changed toolchain, changed Cargo features, invalidated target cache, a fresh target dir, or rust-analyzer using a different toolchain from the dev script.

## Runtime Rules

- Use `scripts/dev_ui_agent.sh build` only when a backend binary is required.
- Use `scripts/dev_ui_agent.sh restart --no-open --skip-build` when the existing binary is enough.
- Use `scripts/dev_ui_agent.sh timings` when investigating compile bottlenecks.
- Do not use temporary target dirs to dodge locks unless the user explicitly asks for isolated builds.
