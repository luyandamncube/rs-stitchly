---
name: stitchly-node-contract
description: Route Stitchly node definition, node registry, frontend node card, adapter, runtime binding, IO contract, config schema, fixture, and per-node execution behavior changes.
---

# Stitchly Node Contract

Use this skill when adding or changing a node type, node definition, node UI, adapter behavior, IO contract, config schema, or node fixture.

## Context Routing

- Built-in definitions and UI metadata: `crates/node_registry/src/lib.rs`.
- Adapter implementations and per-node runtime behavior: `crates/runtime_adapters/src/lib.rs`.
- Workflow graph/schema types: `crates/workflow_schema/src/lib.rs`.
- API response shape for definitions and runs: `crates/api_contract/src/lib.rs`.
- Frontend node rendering and card metadata: `apps/web/src/components/WorkflowCanvas.jsx`, `apps/web/src/lib/nodeCard.js`, and `apps/web/src/components/CanvasWorkspace.jsx`.
- Fixtures: `tests/fixtures/api/node_definitions.json`, `tests/fixtures/workflows/*`.
- Design studies: `design_lab/nodes/v1/*` and `docs/03_ui/05_node_design_inventory.md`.

## Docs To Load

- Node catalog and taxonomy: `docs/00_foundation/01_node_types.md`.
- Node definition contract: `docs/00_foundation/15_node_definition_spec.md`.
- IO contract: `docs/04_execution/01_node_io_and_execution_contracts.md`.
- Output contract: `docs/04_execution/02_output_contract.md`.
- Execution contract: `docs/04_execution/03_execution_contract.md`.
- Adapter contract: `docs/04_execution/04_adapter_contract.md`.
- Multi-edge semantics when handles/fan-out/fan-in change: `docs/04_execution/05_multi_edge_semantics.md`.
- Node UI state and visuals: `docs/03_ui/01_node_state_model.md` and `docs/03_ui/03_node_reference_analysis.md`.

## Working Rules

1. Treat node registry data as a shared contract consumed by backend tests and frontend fixtures.
2. Keep browser-visible metadata free of secrets or privileged runtime details.
3. Update backend definitions, frontend fixtures, and tests together when the API payload changes.
4. Keep adapter behavior deterministic and return structured logs/errors.
5. For a new node, check registry, adapter, frontend rendering, docs contract table, and fixture coverage.

## Validation

- Node metadata-only changes: prefer `scripts/dev_ui_agent.sh check node-registry` before server builds.
- Adapter behavior changes: prefer `scripts/dev_ui_agent.sh check adapters`; expect DuckDB/parquet to pull Arrow crates.
- Rust contract/runtime changes: run affected package tests first; use `cargo test --workspace` only when the change is cross-crate or risky.
- Frontend node UI changes: run `corepack pnpm --dir apps/web test --run`.
- Fixture changes: inspect generated or copied JSON carefully for drift.
- For detailed compile routing, load `.codex/skills/stitchly-rust-quality/references/compile-routing.md`.

## Token Traps

- `runtime_adapters/src/lib.rs` is large. Search by `type_id`, adapter function, or config key.
- Do not read every node design sample; pick the matching node family.
