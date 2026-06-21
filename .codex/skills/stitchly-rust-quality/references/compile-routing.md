# Stitchly Compile Routing

Use the cheapest validation that proves the change. Prefer `scripts/dev_ui_agent.sh` helpers and never run concurrent Cargo commands in this repo.

## Surface Map

- `apps/web/**`: React/Vite only. Run `corepack pnpm --dir apps/web test --run`; add `corepack pnpm --dir apps/web typecheck` for props, API shapes, or shared helpers. No Rust compile is needed.
- `design_lab/**`: static UI studies. Validate by opening or serving the study when needed; no production build is implied.
- `crates/node_registry/**`: browser-safe node definitions, metadata, ports, config schema, and card-facing data. Prefer `scripts/dev_ui_agent.sh check node-registry`.
- `crates/workflow_schema/**`: canonical workflow graph/schema. Expect fan-out into contracts, runtime, tests, and frontend fixtures.
- `crates/api_contract/**`: backend/frontend API payloads. Check Rust consumers and matching frontend API/UI tests.
- `crates/runtime_adapter_contract/**`: lightweight adapter trait, context, result, and error boundary. Prefer `scripts/dev_ui_agent.sh check adapter-contract`; this should not pull DuckDB/Arrow.
- `crates/runtime_adapters/**`: concrete node execution adapters. This is the heavy path because DuckDB/parquet pulls `arrow-*`; prefer `scripts/dev_ui_agent.sh check adapters` before building the server.
- `crates/runtime_core/**`: planning, scheduling, run state, events, logs, and cancellation. Prefer `scripts/dev_ui_agent.sh check core`; build the server only when runtime behavior must be exercised over HTTP/SSE.
- `crates/runtime_server/**`: Axum routes, workspace/workflow/catalog endpoints, platform paths. Prefer `scripts/dev_ui_agent.sh check server`; use `scripts/dev_ui_agent.sh check server-light` for UI/control-plane work that does not need concrete runtime adapters or DuckDB-backed catalog storage.
- `tests/**`: run the narrow relevant test first. Use workspace tests only when the change is cross-crate or risky.

## Heavy Dependency Clues

`duckdb` with the `parquet` feature pulls Arrow crates including `arrow-string`. If Arrow or `libduckdb-sys` rebuilds on a no-op run, suspect a changed toolchain, changed Cargo features, invalidated target cache, a fresh target dir, or rust-analyzer using a different toolchain from the dev script.

The repo `rust-toolchain.toml` selects `nightly` so bare Cargo and rust-analyzer align with the dev script. The dev script avoids refreshing nightly unless `STITCHLY_CARGO_UPDATE_TOOLCHAIN=1`.

## Runtime Rules

- Use `scripts/dev_ui_agent.sh build` only when a backend binary is required.
- Use `scripts/dev_ui_agent.sh build server-light` or `scripts/dev_ui_agent.sh restart --no-open --light` for UI/control-plane work that does not need concrete runtime adapters, DuckDB-backed catalog endpoints, or run mirroring into workspace DuckDB.
- Use `scripts/dev_ui_agent.sh restart --no-open --skip-build` when the existing binary is enough.
- Use `scripts/dev_ui_agent.sh timings <target>` when investigating compile bottlenecks.
- Do not use temporary target dirs to dodge locks unless the user explicitly asks for isolated builds.
- See `docs/02_build/01_dev_build_modes.md` before changing DuckDB linkage. `server-light` disables DuckDB storage entirely; `server-system-duckdb` enables DuckDB storage without the bundled feature. Current adapter parquet support implies bundled DuckDB through `libduckdb-sys`.

## Timing Recipes

- No-op backend binary build: `scripts/dev_ui_agent.sh timings server`
- Light backend binary build: `scripts/dev_ui_agent.sh timings server-light`
- Non-bundled DuckDB experiment: `scripts/dev_ui_agent.sh timings server-system-duckdb`
- Node metadata path: `scripts/dev_ui_agent.sh timings node-registry`
- Adapter contract path: `scripts/dev_ui_agent.sh timings adapter-contract`
- Adapter path, including `load_to_duckdb`: `scripts/dev_ui_agent.sh timings adapters`
- Runtime orchestration path: `scripts/dev_ui_agent.sh timings core`
