# 10 MVP Scope

## Purpose

Keep the first deliverable small enough to ship while preserving the long-term architecture.

## Proposed Phases

### Phase 0

- documentation
- architecture choices
- workflow schema draft
- testing strategy draft

### Phase 1

- React Flow canvas
- workflow save/load
- Rust backend skeleton
- local workflow validation
- shared fixture workflow format
- Rust test loop and frontend test loop
- one cross-stack smoke test path
- base executor model with `rust_native` and simple subprocess execution

### Phase 2

- `file_input`
- `text_input`
- `python_script`
- `file_output`
- `preview_output`
- basic run logs and status
- backend-managed Python subprocess execution

### Phase 3

- connection references and secret indirection
- `table_input`
- `load`
- `sql_transform`
- `table_output`
- one engine adapter, likely starting with ClickHouse
- basic workload-oriented node definitions
- engine pushdown for heavy data transforms

### Phase 4

- artifact persistence
- schedules and backfills for data workloads
- richer type validation
- better debugging and failure surfaces
- initial custom node packaging model
- performance regression benchmarks

## Scope Guardrails

- Avoid building distributed infrastructure before local execution is solid.
- Avoid broad integration work before the core node model is proven.
- Support one data engine well before supporting many superficially.
- Prefer a thin but real end-to-end loop over many half-finished features.
- Require each new feature to add tests at the right layer before it is considered complete.
- Do not force containerization into the first implementation unless it clearly improves safety or delivery speed.
