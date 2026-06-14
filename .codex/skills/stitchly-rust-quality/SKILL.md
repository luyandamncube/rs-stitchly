---
name: stitchly-rust-quality
description: Apply Stitchly-specific Rust quality checks when writing, reviewing, or refactoring code in crates/**, including async runtime state, API contracts, adapters, error handling, ownership, tests, and performance-sensitive paths.
---

# Stitchly Rust Quality

Use this skill for Rust implementation and review work. Apply concise, repo-specific checks instead of loading broad generic Rust rule packs.

## Crate Routing

- `crates/workflow_schema`: canonical workflow graph types and validation-oriented structures.
- `crates/api_contract`: serde payloads crossing the frontend/backend boundary.
- `crates/node_registry`: browser-safe node definitions and UI metadata.
- `crates/runtime_core`: planning, scheduling, run state, events, logs, cancellation.
- `crates/runtime_adapters`: built-in node execution and integration adapters.
- `crates/runtime_server`: Axum routes, SSE, workspace/workflow/catalog endpoints.

Search by type name, endpoint path, node type ID, event type, or config key before reading broad file ranges.

## Core Checks

- Prefer borrowing over cloning, but do not fight the borrow checker into obscure code.
- Use `Result` for expected failures. Do not panic for user input, workspace state, runtime execution, or external process errors.
- Avoid `.unwrap()` and casual `.expect()` in production paths. If an invariant is truly internal, make the expectation message precise.
- Add useful error context at crate boundaries, especially filesystem, process, JSON, DuckDB, and HTTP request paths.
- Keep browser-facing API payloads free of secrets, local credential material, and privileged backend-only state.
- Keep public contract enums and structs stable unless the task intentionally changes the API.
- Use typed structs/enums for structured state instead of passing stringly-typed maps through internal Rust code.

## Async And State

- Do not hold `Mutex`, `RwLock`, or similar guards across `.await`.
- Clone or extract the needed value before awaiting.
- Use bounded channels or explicit backpressure where a producer can outpace consumers.
- Treat run cancellation and terminal states as race-sensitive; check idempotency.
- For SSE/event-stream work, verify disconnect, terminal event, and replay/persistence behavior.
- Keep `runtime_server` thin; put durable logic in `runtime_core` or lower-level helpers.

## Error Handling Direction

- Library-style crates should prefer typed errors where callers can respond meaningfully.
- Application/server glue may use `anyhow` where errors are immediately translated to API responses or logs.
- Preserve lower-case, no-trailing-period error messages when they are exposed as Rust errors.
- Do not collapse distinct runtime, validation, storage, and adapter failures into one vague category.

## Adapter Checks

- Keep adapters deterministic for the same inputs where the integration allows it.
- Return structured logs and meaningful errors.
- Do not leak secrets in logs, payloads, fixtures, or frontend-visible error messages.
- Keep process/CLI execution paths explicit about command, cwd, environment, timeout, and captured output.
- Avoid adding heavy optimization crates or allocation tricks before profiling.

## API And Serde Checks

- Check `crates/api_contract/src/lib.rs` and frontend consumers together when payloads change.
- Preserve field names expected by `apps/web/src/lib/api.js` and tests.
- Prefer additive payload changes unless a breaking change is intentional.
- Use `Option` for genuinely absent data; avoid sentinel strings for missing values.
- Keep timestamps, IDs, statuses, and node type IDs consistent with existing contract naming.

## Testing

- Add or update focused unit tests for pure Rust behavior.
- Use integration tests in `tests/integration` for cross-crate runtime/API behavior.
- Update shared fixtures when contract output changes.
- Use descriptive test names that state behavior, not implementation detail.

Run when practical:

- `cargo test --workspace`
- `cargo test -p <crate>` for narrow crate changes
- frontend tests too when Rust API payloads affect `apps/web`

## Performance Restraint

- Profile or identify a hot path before adding specialized collections, arenas, SIMD, PGO, or release-profile changes.
- Reasonable low-risk improvements are fine: `with_capacity` when size is known, `entry` API for map updates, avoiding obvious repeated parse/serialize loops.
- Favor simple, maintainable Rust in control-plane code over micro-optimizations.

## Review Checklist

When reviewing Rust changes, check:

- lock guards are not held across `.await`
- no new production `.unwrap()` on fallible external input
- errors preserve actionable context
- API payload changes are reflected in frontend/tests/fixtures
- adapter logs cannot expose secrets
- terminal run/cancellation behavior is idempotent
- tests cover the changed contract or state transition
