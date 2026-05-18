# 14 Repo Structure And Build

## Purpose

Define the initial repository shape, build system boundaries, and developer command surface for Stitchly.

## Goals

- keep Rust runtime code modular and testable
- keep the frontend isolated as an editor and observability surface
- make shared contracts and fixtures easy to consume from both sides
- make the default build and test commands obvious
- support fast local iteration without complex infrastructure

## Recommended Repository Shape

```text
stitchly/
  apps/
    web/
  crates/
    workflow_schema/
    api_contract/
    node_registry/
    runtime_core/
    runtime_adapters/
    runtime_server/
  tests/
    fixtures/
      workflows/
      runs/
      adapters/
      artifacts/
    integration/
    e2e/
    benchmarks/
  scripts/
  docs/
```

## Directory Responsibilities

### `apps/web`

The React frontend.

Owns:

- workflow canvas
- node inspectors
- run status and logs UI
- API client consumption
- end-to-end browser entrypoint

Does not own:

- canonical workflow validation
- runtime planning
- execution semantics
- secret resolution

### `crates/workflow_schema`

Owns the canonical workflow model.

Responsibilities:

- workflow structs and enums
- schema validation
- schema versioning and migrations
- machine-readable schema export for frontend use

This crate should be one of the lowest-level shared contracts in the repo.

### `crates/api_contract`

Owns API request and response types that cross the frontend/backend boundary.

Responsibilities:

- request and response models
- run event payload definitions
- generated schema artifacts for frontend clients and tests

### `crates/node_registry`

Owns node definitions and node metadata.

Responsibilities:

- built-in node definitions
- node lookup
- config schema registration
- UI metadata that the frontend can consume safely

### `crates/runtime_core`

Owns execution planning and runtime orchestration.

Responsibilities:

- graph planning
- scheduling
- run lifecycle state machine
- retries and cancellation
- artifact handoff orchestration

### `crates/runtime_adapters`

Owns integrations with Python, Dolt, ClickHouse, and future engines or runtimes.

Responsibilities:

- adapter interfaces
- concrete adapter implementations
- adapter-specific test doubles

### `crates/runtime_server`

Owns the backend transport surface.

Responsibilities:

- HTTP endpoints
- SSE event streaming endpoints
- request handling
- auth middleware later if needed
- frontend-facing API assembly

Recommended first stack:

- `axum`
- `tokio`
- `serde`

This crate should stay thin and delegate business logic into lower-level crates.

## Compute Layer Direction

The repo should support multiple executor kinds without forcing every node through the same isolation model.

The early executor set should likely be:

- `rust_native` for built-in low-overhead nodes
- `python` for backend-managed subprocess execution
- `engine_adapter` for ClickHouse and similar systems
- `process` for controlled CLI-backed integrations such as Dolt

Container-backed or remote workers can be added later without changing the frontend model.

### `tests/fixtures`

Shared artifacts reused across backend, frontend, API, and end-to-end tests.

Examples:

- saved workflow JSON files
- expected run-event streams
- sample CSV files
- adapter stub responses

### `tests/integration`

Cross-crate backend tests that exercise more than one internal crate together.

### `tests/e2e`

Cross-stack tests that run the real frontend and backend together.

### `tests/benchmarks`

Performance and regression benchmarks for runtime overhead and adapter behavior.

## Build System Direction

### Rust

Use a Cargo workspace from the start.

Why:

- clear crate boundaries
- fast incremental builds
- standard test and lint tooling
- good fit for shared contracts and modular runtime code

### Frontend

Use a standard Node-based app under `apps/web`.

Recommended defaults:

- `pnpm` as package manager
- Vite for development build tooling
- Vitest for component and unit tests
- Playwright for browser end-to-end tests

### Shared Contract Generation

The backend-owned schema should produce artifacts consumable by the frontend.

Examples:

- JSON Schema for workflow definitions
- generated TypeScript types for API payloads
- node metadata snapshots for frontend tests
- event payload schemas for run streaming

The exact generation tool can be decided later, but the repo should make generated artifacts explicit rather than hand-maintained.

## Compute And Dependency Strategy

For the first version, development speed matters more than universal containerization.

Recommended early approach:

- keep the Rust backend as the orchestrator and scheduler
- run Python nodes through managed subprocesses
- run controlled CLI-backed source nodes through typed process adapters
- push heavy SQL and data processing into external engines

This keeps the local build loop fast and avoids image-build overhead while the runtime model is still stabilizing.

## Developer Command Surface

There should be one obvious command family for each task.

Recommended direction:

- `just dev-backend`
- `just dev-frontend`
- `just generate-contracts`
- `just test-backend`
- `just test-frontend`
- `just test-integration`
- `just test-e2e`
- `just lint`
- `just build`

If we do not want `just`, `make` or script wrappers are acceptable, but we should not make developers remember long ad hoc command chains.

## Local Build Loops

### Backend Loop

Primary commands:

1. `cargo check`
2. `cargo test` or `cargo nextest run`
3. `cargo clippy --all-targets --all-features`

### Frontend Loop

Primary commands:

1. `pnpm dev`
2. `pnpm typecheck`
3. `pnpm test --watch`

### Cross-Stack Loop

Primary flow:

1. start the Rust backend
2. start the frontend
3. load a shared fixture workflow
4. validate or run it through the real API
5. consume SSE run events
6. inspect status, logs, and outputs

This should eventually be runnable by one command for smoke testing.

## CI Lanes

The first CI shape should stay small but structured.

### Fast Lane

Runs on every change:

- Rust formatting and lint
- Rust tests
- frontend typecheck
- frontend component tests

### Integration Lane

Runs on main or PRs as needed:

- backend integration tests
- shared fixture validation
- API contract checks
- run-event stream contract checks

### End-To-End Lane

Runs a small browser-driven suite:

- one simple workflow
- one dataflow example

### Benchmark Lane

Runs less frequently:

- runtime microbenchmarks
- adapter overhead checks

## Build Outputs We Should Expect

At minimum the repo should eventually produce:

- backend binary or binaries
- frontend production bundle
- generated schema and contract artifacts
- benchmark results or summaries

## Implementation Guardrails

- Keep transport code thin and runtime logic reusable.
- Keep generated contract artifacts reproducible.
- Avoid putting shared fixtures only under the frontend or only under a Rust crate.
- Avoid mixing adapter-specific code directly into the core scheduler.
- Prefer adding a crate over creating one giant runtime package once responsibilities diverge clearly.

## Open Questions

- Do we start with one backend binary that embeds both API and runtime, or split later?
- Which contract generation approach best fits Rust-to-TypeScript sharing?
- Do we keep browser end-to-end tests inside the frontend app or under the top-level `tests/` tree?
