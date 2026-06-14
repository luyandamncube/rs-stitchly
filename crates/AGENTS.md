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

## Validation

- Prefer `cargo test --workspace` for cross-crate changes.
- Use affected package tests for narrow edits when full workspace tests are too slow.
