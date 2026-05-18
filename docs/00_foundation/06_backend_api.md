# 06 Backend API

## Purpose

Define the interface between the Stitchly frontend and the Rust backend.

## Core API Principle

The API should be a semantic control-plane API.

That means the frontend asks the backend to:

- validate workflows
- save workflows
- plan workflows
- run workflows
- cancel runs
- stream run events
- retrieve outputs and artifacts
- discover nodes, connections, and engine capabilities

The frontend should not be responsible for:

- choosing executor internals
- passing raw secrets
- constructing engine-specific credentials
- invoking subprocesses or containers directly

## Early Direction

- The API should expose semantic operations, not frontend implementation details.
- Validation should be available without a full run.
- Run progress should support streaming updates back to the UI.
- The frontend should describe workloads semantically while the backend resolves engine-specific execution details.
- API request and response contracts should be testable from shared fixtures rather than duplicated frontend mocks.

## Recommended Implementation Stack

The first API server should be built in Rust and live inside the backend workspace.

Recommended stack:

- `axum` for HTTP routing
- `tokio` for async runtime
- `serde` for request and response serialization
- SSE for first-pass run-event streaming

This keeps the API close to validation, planning, scheduling, and run lifecycle logic that already belongs in Rust.

## Backend Layering

The intended request flow is:

1. frontend sends semantic request
2. `runtime_server` handles transport and request parsing
3. `runtime_core` validates, plans, or runs the workflow
4. `runtime_adapters` execute node work when needed
5. `runtime_server` returns snapshots or streams events back to the frontend

The API server should stay thin and delegate business logic into lower-level runtime crates.

## Recommended Transport Model

### REST

Use REST for:

- create and update operations
- validation
- planning
- run creation
- cancellation
- metadata discovery
- artifact lookup

### SSE

Use Server-Sent Events for:

- run lifecycle events
- node state changes
- structured log events
- progress updates

SSE is a good default because Stitchly mainly needs backend-to-frontend streaming for run observability.

### WebSocket Later

WebSocket can be added later if we need:

- richer bidirectional interactions
- collaborative editing
- more complex live control channels

It does not need to be the first transport choice.

## Resource Families

The first API should likely be organized around these resources:

- workflows
- validation and planning
- runs
- run events and logs
- outputs and artifacts
- node definitions
- connections and engine capabilities
- schedules later

## Recommended First-Pass Endpoints

### Workflow Endpoints

- `POST /api/workflows`
- `GET /api/workflows/:workflow_id`
- `PUT /api/workflows/:workflow_id`
- `GET /api/workflows/:workflow_id/versions`

Use these for storing and retrieving canonical workflow definitions.

### Validation And Planning Endpoints

- `POST /api/workflows/validate`
- `POST /api/workflows/plan`

Validation should check the workflow without starting execution.

Planning should return a compile-time or execution-readiness view that helps the UI explain what will happen before a run starts.

### Run Endpoints

- `POST /api/runs`
- `GET /api/runs/:run_id`
- `POST /api/runs/:run_id/cancel`

These endpoints create runs, fetch run snapshots, and request cancellation.

### Run Event And Log Endpoints

- `GET /api/runs/:run_id/events`
- `GET /api/runs/:run_id/logs`

Recommended first behavior:

- `/events` returns an SSE stream
- `/logs` returns a paginated or filterable snapshot view

### Output And Artifact Endpoints

- `GET /api/runs/:run_id/outputs`
- `GET /api/artifacts/:ref_id`

Use these for final outputs, intermediate result inspection, and artifact retrieval.

### Metadata Discovery Endpoints

- `GET /api/node-definitions`
- `GET /api/connections`
- `GET /api/engine-capabilities`

These endpoints give the frontend enough safe metadata to render editors and forms without exposing secrets.

### Scheduling Endpoints Later

- `POST /api/schedules`
- `GET /api/schedules/:schedule_id`
- `POST /api/backfills`

These can arrive after manual run flows are solid.

## Sample Request Shapes

### Validate Workflow

`POST /api/workflows/validate`

```json
{
  "workflow": {
    "workflow_id": "wf_abc",
    "version": 3
  }
}
```

Illustrative response:

```json
{
  "valid": true,
  "errors": [],
  "warnings": []
}
```

### Create Run

`POST /api/runs`

```json
{
  "workflow_id": "wf_abc",
  "workflow_version": 3,
  "trigger": {
    "kind": "manual"
  },
  "params": {
    "target_env": "dev",
    "repo_ref": "main"
  }
}
```

Illustrative response:

```json
{
  "run_id": "run_123",
  "status": "created"
}
```

### Run Snapshot

`GET /api/runs/:run_id`

Illustrative response:

```json
{
  "run_id": "run_123",
  "workflow_id": "wf_abc",
  "workflow_version": 3,
  "status": "running",
  "trigger": {
    "kind": "manual"
  },
  "started_at": "2026-05-18T10:00:00Z",
  "finished_at": null
}
```

## Event Stream Shape

The event API should expose structured events aligned with the run lifecycle model.

Example SSE event payload:

```json
{
  "event_id": "evt_001",
  "run_id": "run_123",
  "event_type": "node_started",
  "timestamp": "2026-05-18T10:00:05Z",
  "target": {
    "kind": "node",
    "node_id": "python_step"
  },
  "payload": {
    "attempt": 1
  }
}
```

The SSE envelope can follow normal SSE conventions, but the payload itself should stay structured and contract-tested.

## Error Model

The API should return machine-readable error categories wherever possible.

Useful early categories:

- validation error
- planning error
- not found
- connection error
- execution error
- timeout
- cancellation

This matters because the frontend should not infer meaning purely from free-form error strings.

## Artifact And Large Input Handling

The API should distinguish between:

- small semantic JSON requests
- large file or artifact transfers

The likely direction is:

- workflow definitions and control actions over JSON
- artifact upload and download through dedicated endpoints
- refs returned by the backend instead of embedding large payloads inline

## Safe Metadata Exposure

The API may expose:

- node definition metadata
- connection IDs and display names
- engine capability summaries
- output refs and artifact metadata

The API should not expose:

- raw secret values
- executor-specific privileged internals unless needed for diagnostics
- backend-only connection resolution details by default

## Testing And Contract Generation

API request and response types should live in shared Rust contract crates and generate artifacts consumable by the frontend.

That means:

- frontend mocks should derive from real contracts
- integration tests should use shared payload fixtures
- streaming event payloads should be contract-tested, not only eyeballed in the UI

## Recommended First Version

For the first usable API, we do not need every advanced capability.

We do need:

- Rust API server
- REST endpoints for workflows, validation, and runs
- SSE event streaming for run progress
- structured run snapshots
- metadata discovery for nodes and connections
- artifact lookup by ref

That is enough to support the first real frontend and the initial workflow and dataflow paths.

## Open Questions

- Do we expose both `/validate` and `/plan` in v1, or only `/validate` first?
- Should run events use SSE only at first, or do we need WebSocket immediately for any workflow UX?
- How should artifact upload work for larger local files?
- How much capability metadata should `GET /api/connections` expose to the frontend?
