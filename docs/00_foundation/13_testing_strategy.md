# 13 Testing Strategy

## Purpose

Define how Stitchly stays easy to test as frontend and backend features evolve together.

## Core Problem To Avoid

The main failure mode is letting the frontend and backend develop separate truths:

- the frontend tests one workflow shape
- the backend validates another
- mocks drift from real runtime behavior
- end-to-end testing becomes slow, rare, and fragile

Stitchly should avoid that by making shared contracts and shared fixtures the center of the testing model.

## Core Principles

1. The backend owns the canonical workflow schema.
2. The frontend consumes generated or shared types from that schema rather than recreating them by hand.
3. Every feature should be testable at the smallest sensible layer first.
4. Shared workflow fixtures should be reusable across backend, frontend, and end-to-end tests.
5. Every new node type should ship with at least one fixture workflow and one execution-oriented test.
6. Performance regressions should be testable separately from correctness regressions.

## Recommended Repository Shape

The repo should eventually make contracts and fixtures easy to share.

Example layout:

```text
stitchly/
  apps/
    web/
  crates/
    api_contract/
    workflow_schema/
    runtime_core/
    node_registry/
  tests/
    fixtures/
      workflows/
      runs/
      adapters/
    integration/
    e2e/
    benchmarks/
```

The exact folder names can change, but the important point is that fixtures and contracts should not live only inside one side of the stack.

## Testing Layers

### 1. Rust Unit Tests

Use for:

- graph planning
- schema validation
- scheduler behavior
- node config parsing
- adapter selection

These should be fast and run constantly during development.

Recommended loop:

- `cargo fmt --check`
- `cargo check`
- `cargo clippy --all-targets --all-features`
- `cargo test` or `cargo nextest run`

If we want a tighter inner loop later, add `cargo watch` or an equivalent file-watcher command.

### 2. Backend Integration Tests

Use for:

- workflow validation against real fixtures
- run lifecycle behavior
- artifact passing between nodes
- adapter behavior with fakes or local test doubles

These should consume canonical workflow JSON fixtures rather than handwritten inline data where possible.

Examples:

- validate a `python_script` workflow fixture
- execute a `dolt_repo_source -> dolt_dump_csv -> load` flow against a fake adapter
- verify cancellation and retry behavior

### 3. Frontend Component Tests

Use for:

- node rendering
- inspector forms
- edge validation behavior
- run status display
- fixture workflow loading and editing

The frontend should load the same canonical workflow fixtures used by backend tests, then stub backend responses at the API boundary.

Recommended loop:

- `pnpm install`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test --watch`

Vitest is a good fit for the component/unit layer because it is fast and works well with modern React tooling.

### 4. API Contract Tests

Use for:

- request and response schemas
- generated client compatibility
- streaming event payload stability
- REST endpoint behavior and snapshot shapes

These tests protect the seam between the frontend and the Rust backend.

The goal is that mocked frontend responses are derived from real contracts, not invented ad hoc inside UI tests.

The event stream format, especially SSE payloads, should be fixture-driven and contract-tested just like normal JSON responses.

### 5. End-To-End App Tests

Use for:

- open app
- load fixture workflow
- edit config
- validate
- run
- inspect logs and outputs

These tests should run a real backend and real frontend together.

Keep this suite intentionally small. It should cover a few critical happy paths and failure paths, not every permutation.

Recommended tool:

- Playwright for browser-driven end-to-end tests

### 6. Benchmark And Performance Tests

Use for:

- scheduler overhead
- startup time
- artifact transfer overhead
- throughput under many small nodes
- engine adapter overhead

These do not replace correctness tests. They protect the lightweight runtime goal.

## Shared Fixture Strategy

Shared fixtures are the key to reducing drift.

We should keep reusable fixtures for:

- saved workflow definitions
- expected validation errors
- expected run events
- example node configs
- sample artifacts and small datasets

Examples:

- `tests/fixtures/workflows/file_python_preview.json`
- `tests/fixtures/workflows/dolt_earnings_ingest.json`
- `tests/fixtures/runs/dolt_earnings_success.json`
- `tests/fixtures/api/run_created_response.json`
- `tests/fixtures/api/run_events_success.sse`

One fixture should ideally support multiple layers:

- backend validation test
- frontend rendering test
- API response contract test
- end-to-end smoke test

## How To Keep Frontend And Backend In Sync

The cleanest model is:

1. define the workflow schema in Rust
2. generate or export machine-readable contract artifacts
3. consume those artifacts in the frontend
4. build tests from the same fixtures on both sides

That means we should avoid:

- duplicated TypeScript workflow models with manual drift
- frontend-only fake node definitions that do not exist in the backend
- backend-only fixture workflows the UI never loads

## Node-Level Testability Rules

Every node type should eventually provide:

- schema definition
- one valid config fixture
- one invalid config fixture
- one minimal happy-path workflow fixture
- declared fake or test-double behavior for external adapters where applicable

For external systems such as Dolt or ClickHouse, test in three rings:

1. pure unit tests for config and planning
2. adapter tests with local fakes or stubs
3. optional smoke tests against a real local dependency or container

This keeps normal CI fast while still allowing higher-confidence checks.

## Recommended Daily Build Loops

### Rust Loop

Use for fast backend iteration:

1. `cargo check`
2. `cargo test` or `cargo nextest run`
3. `cargo clippy --all-targets --all-features`

This loop should complete quickly enough to run many times per day.

### Frontend Loop

Use for fast UI iteration:

1. `pnpm dev`
2. `pnpm typecheck`
3. `pnpm test --watch`

This loop should let us change node UIs, edge validation, and run panels without waiting on full app startup every time.

### Cross-Stack Loop

Use for integration confidence:

1. start the Rust backend locally
2. start the frontend locally
3. load a shared fixture workflow
4. validate or run it through the real API
5. assert logs, outputs, and status transitions

This should be wrapped in a single command once the app exists.

Example direction:

- `just test-backend`
- `just test-frontend`
- `just test-integration`
- `just test-e2e`

The exact task runner can be `just`, `make`, or npm scripts, but there should be one obvious command path for each layer.

## Feature Completion Rule

A feature is not complete unless it adds automated coverage at the right layer.

Examples:

- new workflow schema field: Rust validation test plus fixture update
- new node inspector: frontend component test plus fixture update
- new runtime node: backend execution test plus end-to-end smoke test when user-visible
- new engine adapter: adapter tests plus one integration or smoke path

## MVP Testing Recommendation

For the first usable version, we do not need a massive test matrix.

We do need:

- Rust unit tests for schema, planning, and runtime basics
- frontend component tests for canvas and node inspectors
- shared workflow fixtures
- one end-to-end path for a simple workflow
- one end-to-end path for a dataflow example

That is enough to create a reliable loop without overbuilding the testing system before the product itself exists.
