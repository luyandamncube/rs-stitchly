# 00 LLM Build Prompt

## Purpose

Provide a reusable prompt for a coding LLM to start building Stitchly from the current docs.

This prompt is intended to reduce ambiguity by pointing the model at the exact source docs that define product shape, system boundaries, API design, compute, testing, and implementation order.

## How To Use

Paste the prompt below into a coding-capable LLM that has access to this repository.

The LLM should treat the docs in `docs/` as the primary source of truth for product and architecture decisions.

## Prompt

```md
You are building the first real implementation of Stitchly inside this repository.

Stitchly is a visual workflow and dataflow platform with:
- a React Flow-based frontend editor
- a Rust backend that owns validation, planning, execution, run lifecycle, and observability
- an executor model built around `rust_native`, `python`, `process`, and `engine_adapter`
- REST for control operations and SSE for run-event streaming

Your job is to implement the app from the docs already present in this repo.

You must treat the docs under `docs/` as the source of truth.

## Source Of Truth Map

Use these docs for these responsibilities:

- `docs/00_foundation/00_intro.md`
  Product vision, goals, MVP boundaries, and core principles.

- `docs/00_foundation/01_node_types.md`
  Node families, initial node catalog, and early data types.

- `docs/00_foundation/02_architecture.md`
  High-level architecture, boundaries, and backend/frontend responsibilities.

- `docs/00_foundation/03_workflow_schema.md`
  Canonical workflow representation direction.

- `docs/00_foundation/04_execution_runtime.md`
  Runtime behavior, planning, scheduling, retries, cancellation, and execution responsibilities.

- `docs/03_ui/00_frontend_canvas.md`
  Frontend scope and non-responsibilities, shell model, visual direction, and interaction rules.

- `docs/03_ui/01_node_state_model.md`
  Node interaction, connection, validation, and runtime state behavior for the canvas UI.

- `docs/03_ui/02_ui_roadmap.md`
  Recommended UI implementation phases, sequencing, and sandbox-first delivery method.

- `docs/03_ui/03_node_reference_analysis.md`
  Detailed breakdown of the sample node design language, spacing, hierarchy, handles, and what Stitchly should preserve or adapt.

- `docs/03_ui/04_ui_lab_workflow.md`
  Workflow for isolating UI samples, reviewing variants, approving patterns, and then implementing them in the real app.

- `docs/00_foundation/06_backend_api.md`
  API design, endpoint families, Rust API stack, REST and SSE transport model, and sample payloads.

- `docs/00_foundation/07_persistence.md`
  Persistence direction for workflows, runs, artifacts, and metadata.

- `docs/00_foundation/08_security_and_sandboxing.md`
  Security boundaries, subprocess isolation stance, and secret-handling rules.

- `docs/00_foundation/09_performance_and_scaling.md`
  Performance priorities and lightweight runtime goals.

- `docs/00_foundation/10_mvp_scope.md`
  Recommended implementation phases and scope guardrails.

- `docs/00_foundation/11_decision_log.md`
  Accepted decisions that should override vague or conflicting interpretations elsewhere.

- `docs/00_foundation/12_dataflow_and_workloads.md`
  Dataflow role, engine pushdown direction, and workload-oriented orchestration.

- `docs/00_foundation/13_testing_strategy.md`
  Shared fixtures, test layering, and build/test loop expectations.

- `docs/00_foundation/14_repo_structure_and_build.md`
  Recommended repository structure, crates, app layout, commands, and CI direction.

- `docs/00_foundation/15_node_definition_spec.md`
  Exact node definition contract, runtime binding fields, and validation rules.

- `docs/00_foundation/16_connections_and_secrets.md`
  Connection IDs, secret resolution, and what the frontend may safely see.

- `docs/00_foundation/17_artifacts_and_dataset_refs.md`
  `file_ref`, `directory_ref`, `table_ref`, `dataset_ref`, and artifact lifecycle expectations.

- `docs/00_foundation/18_run_lifecycle_and_events.md`
  Run states, node states, event structure, retries, and cancellation model.

- `docs/00_foundation/19_compute_model.md`
  Compute lanes, executor kinds, subprocess-first strategy, and why not to start container-first.

- `docs/01_workflows/20_workflow_example_dolt.md`
  A concrete workflow example that should influence dataflow-oriented implementation decisions.

## Interpretation Rules

When docs overlap, prefer them in this order:

1. `11_decision_log.md`
2. `10_mvp_scope.md`
3. `14_repo_structure_and_build.md`
4. `03_ui/00_frontend_canvas.md`
5. `03_ui/01_node_state_model.md`
6. `03_ui/02_ui_roadmap.md`
7. `03_ui/03_node_reference_analysis.md`
8. `03_ui/04_ui_lab_workflow.md`
9. `06_backend_api.md`
10. `15_node_definition_spec.md`
11. `19_compute_model.md`
12. `18_run_lifecycle_and_events.md`
13. the remaining foundation and UI docs

If details are missing:

- choose the simplest implementation that fits the docs
- avoid speculative enterprise features
- keep the frontend thin
- keep execution semantics in Rust
- prefer shared contracts over duplicated frontend-only models

## Required Architectural Constraints

You must preserve these constraints:

- The frontend is an editor and observability surface, not an execution runtime.
- The API server is written in Rust.
- The first API transport model is REST plus SSE, not WebSocket-first.
- The Rust backend is the control plane.
- Heavy data work should be pushed into external engines where appropriate.
- The compute model is executor-based, not container-first.
- Secrets must stay out of workflow definitions and out of the browser.
- Shared fixtures should drive backend tests, frontend tests, API tests, and integration tests.

## First-Pass Build Goal

Build the smallest real vertical slice that respects the docs.

Target outcome:

1. A Cargo workspace with the recommended backend crate structure.
2. A React app under `apps/web`.
3. Shared workflow and API contract types.
4. A thin Rust API server that exposes a minimal but real set of endpoints.
5. A minimal runtime that can validate a workflow, create a run, and stream run events.
6. Shared fixtures and tests proving the contract across backend and frontend.

## Recommended Initial Implementation Scope

Implement in this approximate order:

### Phase A: Repository Scaffold

- create the Rust workspace
- create crates:
  - `workflow_schema`
  - `api_contract`
  - `node_registry`
  - `runtime_core`
  - `runtime_adapters`
  - `runtime_server`
- create `apps/web`
- add top-level task commands or scripts aligned with the docs

### Phase B: Shared Contracts

- define the first canonical workflow structs
- define node definition structs
- define run snapshot and run event types
- define API request and response types
- add fixture files under a shared `tests/fixtures` tree

### Phase C: Minimal Backend

Implement a Rust API server using the documented stack and shape:

- `POST /api/workflows/validate`
- `POST /api/runs`
- `GET /api/runs/:run_id`
- `GET /api/runs/:run_id/events`
- `GET /api/node-definitions`
- `GET /api/connections`

Behavior expectations:

- validation returns structured success or error payloads
- run creation returns a `run_id`
- run snapshot returns structured run state
- events stream uses SSE with structured event payloads

### Phase D: Minimal Runtime

Implement a minimal runtime flow that supports:

- workflow validation
- run creation
- `planning -> running -> succeeded` or `failed`
- in-memory run tracking for now if persistence is not yet built
- minimal node execution for a tiny starter set

Reasonable starter nodes:

- `text_input`
- `preview_output`
- one trivial `rust_native` transform or passthrough node

### Phase E: Frontend Vertical Slice

Implement the smallest useful frontend that can:

- load node definitions
- edit or load a basic workflow
- call validate
- create a run
- subscribe to SSE run events
- display status and logs

The frontend should not contain duplicated execution logic.

### Phase F: Tests

Add:

- Rust unit tests
- API contract tests
- shared fixture validation
- a frontend test for consuming a real fixture workflow
- one integration path that exercises validate plus run plus event stream

## Technical Guidance

Follow these implementation preferences unless the repo state forces a better option:

- use `axum` for the Rust API layer
- use `tokio` for async runtime behavior
- use `serde` for JSON payloads
- use SSE for run-event streaming
- use `pnpm` on the frontend side
- use Vite and Vitest for the frontend app

## Non-Goals For The First Pass

Do not overbuild these yet unless required by the docs:

- multi-tenant auth
- distributed workers
- container-per-node execution
- complex scheduling
- broad external integration coverage
- advanced persistence layers
- a large node marketplace

## Output Expectations

As you work:

- explain which docs you are following for major decisions
- keep code modular and aligned with the documented crate boundaries
- add tests for each meaningful contract you introduce
- surface any document ambiguity clearly

When making assumptions:

- choose the smallest viable design
- state the assumption explicitly
- keep it easy to evolve later

Your goal is not to prototype loosely.
Your goal is to create the first implementation pass that faithfully follows the current Stitchly docs.
```

## Notes

This prompt is intentionally biased toward:

- a thin frontend
- a Rust control plane
- shared contracts
- incremental end-to-end delivery

If the foundation docs change materially, this prompt should be updated to match them.
