# 06 Run Execution Implementation Spec

## Purpose

Define the phased implementation plan for turning Stitchly from a workflow editor with persisted run history into a system that can execute real workflows, update node and run state live, persist debugging data, and move typed values between nodes.

This doc is intentionally execution-focused. It assumes the broader product, persistence, UI, and contract docs are already the source of truth for:

- workflow graph shape
- run lifecycle states
- node runtime contracts
- stored run history
- workflow-local DuckDB layout

## Source Docs

This implementation plan depends on:

- `docs/00_foundation/04_execution_runtime.md`
- `docs/00_foundation/18_run_lifecycle_and_events.md`
- `docs/00_foundation/22_run_history_and_debugging_spec.md`
- `docs/00_foundation/24_workflow_duckdb_storage_spec.md`
- `docs/04_execution/01_node_io_and_execution_contracts.md`
- `docs/04_execution/02_output_contract.md`
- `docs/04_execution/03_execution_contract.md`
- `docs/04_execution/04_adapter_contract.md`
- `docs/04_execution/05_multi_edge_semantics.md`
- `docs/03_ui/01_node_state_model.md`

## Implementation Goal

Deliver a real first execution slice that can:

1. execute a simple workflow end to end
2. move typed data between nodes
3. transition run and node states correctly
4. persist snapshots, events, and logs durably
5. reflect those state changes in the canvas and runs UI
6. begin writing workflow-local execution artifacts into `workflow.duckdb`

## Initial Scope

The first real execution slice should support:

- manual workflow runs only
- fail-fast workflow behavior
- single input value per input port
- output fan-out to multiple downstream nodes
- mocked/local-safe output behavior for `send_email`

Initial executable node types:

- `text_input`
- `send_email`

Initial happy-path workflow shapes:

- `text_input -> send_email`
- `text_input -> send_email`
  with two downstream `send_email` nodes fed by the same output

## Deferred For Later

The following are explicitly out of scope for the first implementation slice:

- scheduler-backed run creation
- generalized retry orchestration
- fan-in / multiple upstream values to one input port
- branch skip semantics beyond the existing run-state model
- external email side effects in the first default adapter
- advanced artifact tables and dataset refs beyond what is needed for the first workflow-local output path
- multi-engine ETL execution

## System Areas Required

Real runs require the following subsystems to work together.

### 1. Runtime Execution Loop

The runtime must:

- validate the workflow
- compute a topological execution order
- resolve node inputs from upstream outputs
- execute one node at a time
- store node outputs for downstream consumers
- fail or complete the run deterministically

### 2. Run State Machine

Workflow-level states:

- `created`
- `queued`
- `planning`
- `running`
- `succeeded`
- `failed`
- `cancelling`
- `cancelled`

Node-level states:

- `pending`
- `ready`
- `running`
- `succeeded`
- `failed`
- `skipped`
- `retrying`
- `cancelling`
- `cancelled`

### 3. Persistence

The backend must persist:

- latest run snapshot
- append-only run events
- append-only run logs
- denormalized run-list columns for fast workspace history queries

Workflow-local storage must create and maintain:

- `<workflow_id>/workflow.json`
- `<workflow_id>/db/workflow.duckdb`
- `<workflow_id>/files/`

### 4. Canvas Runtime Presentation

The frontend must:

- show live workflow-level run state
- show live node-level state changes
- reflect persisted final states after refresh
- render the runs popup using real workspace run history

### 5. Node Data Contracts

Each executable node must define:

- required config
- accepted inputs by port id
- emitted outputs by port id
- output value type
- failure behavior
- persistence behavior if it writes artifacts or workflow-local tables

## Phase Plan

## Phase 1 - Happy-Path Execution

### Goal

Make the smallest real workflow run successfully through the backend runtime and persist real run history.

### Scope

Implement:

- manual run creation from the current workflow
- workflow validation before run start
- workflow-level state transitions:
  - `created -> queued -> planning -> running -> succeeded|failed`
- node-level state transitions for `text_input` and `send_email`
- single-value input resolution per input port
- output fan-out from one upstream output to multiple downstream consumers
- durable snapshot/event/log persistence during and after execution

### Required Node Behavior

#### `text_input`

- source of truth remains node config text
- emits a `text` output as `TypedValue::Text`
- no upstream input required

#### `send_email`

- consumes body text from upstream `body` input when connected
- otherwise falls back to local config if allowed by the node contract
- first pass should use a safe local/mock adapter by default
- must produce structured logs and a success/failure result

### Acceptance Criteria

- a manual run can be started for a valid workflow
- `text_input -> send_email` reaches `succeeded`
- `text_input -> 2x send_email` executes both downstream output nodes
- failed adapter execution marks:
  - node as `failed`
  - run as `failed`
- run snapshot, run events, and run logs persist and survive refresh
- workspace run history shows the run in the correct workspace

### Phase 1 Test Cases

- run a single-node `text_input` workflow
- run `text_input -> send_email`
- run `text_input -> send_email_a + send_email_b`
- run a `send_email` failure path
- reload and verify run still exists in workspace history

## Phase 2 - Live Canvas Runtime Feedback

### Goal

Make execution visible on the actual canvas and keep the visual language aligned with the runtime state model.

### Scope

Implement:

- live node-state updates during execution
- workflow-level run activity indication in the canvas shell
- runtime state mapping from stored snapshot to node visual treatment
- visual alignment with approved `runs_node` lab states

### Acceptance Criteria

- nodes visibly move through `pending`, `running`, and terminal states
- run completion remains visible after refresh from persisted history
- the runs popup updates while the run is active
- the canvas does not need a fresh run stream to show final persisted state

### Phase 2 Test Cases

- begin a run and watch node states advance in order
- refresh after completion and confirm final node states remain inspectable
- verify workspace switch shows the correct workspace’s run set

## Phase 3 - Debugging Surfaces

### Goal

Make real runs debuggable from persisted history.

### Scope

Implement:

- richer run logs per node
- richer error summaries at run and node level
- run detail retrieval using stored events and logs
- UI detail surface for inspecting a selected run

### Acceptance Criteria

- a user can inspect what failed, where it failed, and what the error was
- stored logs are available after the run is complete
- stored events can reconstruct the execution timeline
- retry and error counts in the run list are backed by persisted history

### Phase 3 Test Cases

- inspect a successful run and verify logs/events exist
- inspect a failed run and verify failure node and message are visible
- verify events/logs still load after app restart

## Phase 4 - Workflow DuckDB Integration

### Goal

Write workflow-local execution data into `workflow.duckdb` without moving canonical run history out of the control plane.

### Scope

Implement:

- workflow-local DuckDB bootstrap usage during runs
- first execution writes into workflow-local schemas where appropriate
- optional mirroring of useful run facts into `runs`
- first outputs or execution artifacts into `outputs`

### Ownership Rule

Canonical run history remains in the backend persistence layer.

`workflow.duckdb` is for workflow-local analytical and artifact-oriented data, not the source of truth for:

- users
- sessions
- workspace metadata
- canonical run/event/log history

### Acceptance Criteria

- workflow-local DuckDB file is created for each workflow
- a real run can write workflow-local rows or artifacts
- workflow-local DB survives restarts
- control-plane run history remains unchanged as canonical history

### Phase 4 Test Cases

- run workflow and verify `db/workflow.duckdb` exists
- verify the expected schemas exist
- verify a first output write lands in the expected location

## Phase 5 - Broader Node Rollout

### Goal

Expand execution beyond the first happy-path nodes while preserving the shared execution contract model.

### Scope

Implement additional nodes only after:

- their contract rows are updated in the execution docs
- their node manager config is aligned with the executable contract
- their runtime tests are added

Recommended next nodes:

- `text_transform`
- `preview_output`
- `json_input`

### Acceptance Criteria

- each new node type has:
  - documented contract rows
  - runtime tests
  - persisted run behavior
  - UI-visible runtime state behavior

## Recommended Build Order

Implement in this order:

1. Phase 1 - Happy-path execution
2. Phase 2 - Live canvas runtime feedback
3. Phase 3 - Debugging surfaces
4. Phase 4 - Workflow DuckDB integration
5. Phase 5 - Broader node rollout

## First Slice Decision Set

The first implementation slice should assume:

- manual runs only
- fail-fast workflow behavior
- no generalized automatic retries yet
- one input value per input port
- one output may feed many downstream nodes
- `send_email` defaults to safe mock/local execution first

## Implementation Checklist

Before starting Phase 1:

- confirm `text_input` and `send_email` contract rows are current
- confirm run-state transitions are mapped to persisted snapshots/events
- confirm the frontend has a trigger path for starting manual runs
- confirm test fixtures exist for:
  - success
  - failure
  - fan-out

Before starting Phase 4:

- confirm the exact first DuckDB write target
- confirm whether run facts should be mirrored into workflow-local schemas

## Success Definition

This implementation plan is successful when Stitchly can:

- run a simple workflow for real
- move values between nodes deterministically
- persist and reload the full run outcome
- show run and node state transitions in the UI
- retain enough logs and events to debug failures afterward
- begin writing workflow-local execution data into `workflow.duckdb`
