# 22 Run History And Debugging Spec

## Purpose

Define how Stitchly should persist workflow runs as durable history so users can inspect,
debug, and compare runs after execution finishes.

This doc covers:

- how run summaries should be stored
- how structured run history should be stored
- how logs should relate to events
- how run detail should be retrieved
- what v1 retention should look like
- the minimum persistence behavior needed before richer observability UI

This is a `v1 run-history spec draft`.

## Why This Exists

We already have part of the run model in place:

- canonical workflow and node run states
- structured run snapshots
- workspace-scoped run records in SQLite
- SSE event streaming from the live runtime

But the current persistence shape is still incomplete for real debugging because:

- the `runs` table mainly stores the latest snapshot
- durable event history is not yet stored separately
- logs are not yet persisted as a workspace-owned history layer
- later debugging after process restart or long time gaps is therefore limited

If we want run debugging to feel reliable, we need to treat a run as both:

- a latest summary
- and a durable append-only history

## Spec Lock Summary

If the recommended v1 direction is acceptable as-is, the shortest approval reply is:

```text
approve: RH_01, RH_02, RH_03, RH_04, RH_05, RH_06
```

If a key needs a different direction, reply with:

```text
change: <KEY> -> <new direction>
```

Example:

```text
approve: RH_01, RH_02, RH_03, RH_04, RH_06
change: RH_05 -> keep logs and events for 30 days instead of indefinite v1 retention
```

## Approval Table

| Key | Decision Area | Recommended V1 Choice | Main Alternative | Why The Recommendation Wins For V1 |
| --- | --- | --- | --- | --- |
| `RH_01` | Run storage model | Store a latest summary row in `runs` plus a full append-only history behind it | Only store raw snapshots or only store events | Gives fast list reads and still preserves deep debugging history |
| `RH_02` | Event persistence | Persist structured lifecycle events in `run_events` | Keep events live-only over SSE | Durable replay and later debugging depend on saved event history |
| `RH_03` | Log persistence model | Persist logs in a separate `run_logs` table | Mix logs into `run_events` only | Keeps structured state truth separate from noisy debugging output |
| `RH_04` | Detail retrieval model | Load snapshot first, then events/logs on demand | Rebuild all detail views from events every time | Faster run detail loads and simpler v1 UI behavior |
| `RH_05` | Retention policy | No automatic pruning in v1 | Add time-based retention immediately | Simpler local-first behavior and easier debugging while volume is still low |
| `RH_06` | Run list query model | Keep denormalized query columns in `runs` and link history by `run_id` | Query lists from `snapshot_json` or replayed event history | Makes filtering, sorting, and later dashboard metrics practical |

## Recommended V1 Direction

If accepted, the recommended v1 run-history direction is:

- every run keeps a latest summary row in `runs`
- every structured lifecycle event is appended to `run_events`
- every log entry is appended to `run_logs`
- run detail loads the current snapshot first
- event timeline and logs load separately for drilldown
- retention stays simple in v1 with no automatic pruning
- outputs and artifact refs stay attached through snapshot or event payloads for now

## Goals

The first run-history implementation should achieve all of the following:

- every workflow run appears in workspace-scoped history
- each run can be reopened later for debugging
- node-level execution state can be reconstructed from saved history
- retries, cancellations, and failures remain explainable after the live process is gone
- logs can be inspected separately from structured lifecycle events
- list and filter queries stay fast enough for dashboard and workflow-level history views

## Non-Goals For This Pass

The following are explicitly out of scope for the first run-history implementation:

- distributed tracing
- full-text log search
- retention policy UI
- cost analytics and aggregated observability dashboards
- artifact blob storage strategy beyond refs
- archived run restore/export packages
- cross-workspace global run search

## Current State

Today the backend already persists workspace-scoped run records in SQLite.

Current practical shape:

- `runs`
  - `workspace_id`
  - `run_id`
  - `workflow_id`
  - `workflow_version`
  - `status`
  - `snapshot_json`
  - `created_at`
  - `updated_at`

This is enough for:

- a latest run list
- quick status reads
- storing the current run snapshot

It is not yet enough for:

- durable event replay
- durable logs
- precise retry/cancellation debugging after the live runtime is gone

## Storage Model

### Layer 1: `runs`

`runs` should remain the latest summary table.

Purpose:

- fast list queries
- dashboard counts
- filtering by status or workflow
- loading the most recent snapshot quickly

Recommended fields:

| Field | Type | Purpose |
| --- | --- | --- |
| `workspace_id` | text | ownership boundary |
| `run_id` | text | stable run identifier |
| `workflow_id` | text | workflow linkage |
| `workflow_version` | integer | workflow version linkage |
| `trigger_kind` | text | manual, schedule, event, backfill |
| `status` | text | latest top-level workflow run state |
| `requested_by_user_id` | text nullable | later audit/debug usefulness |
| `started_at` | text nullable | run timing |
| `finished_at` | text nullable | run timing |
| `error_category` | text nullable | denormalized list/debug field |
| `error_message` | text nullable | denormalized short summary |
| `snapshot_json` | text | latest structured snapshot |
| `created_at` | text | row creation |
| `updated_at` | text | latest snapshot write |

Rules:

- one row per `(workspace_id, run_id)`
- update the row as the run progresses
- keep `snapshot_json` as the canonical latest summary blob
- also keep key query fields denormalized for practical list performance

### Layer 2: `run_events`

`run_events` should be append-only and store structured lifecycle history.

Purpose:

- timeline replay
- debugging failures and retries
- reconstructing node state transitions
- later event export or audit analysis

Recommended fields:

| Field | Type | Purpose |
| --- | --- | --- |
| `workspace_id` | text | ownership boundary |
| `run_id` | text | parent run |
| `event_id` | text | stable event identifier |
| `sequence` | integer | in-run order |
| `timestamp` | text | event time |
| `event_type` | text | `run_created`, `node_started`, etc |
| `target_kind` | text | run or node |
| `target_node_id` | text nullable | node target when relevant |
| `attempt` | integer nullable | useful for retries |
| `payload_json` | text | structured event payload |

Rules:

- append only
- never mutate prior event rows
- use the same event shape for live SSE and stored replay

### Layer 3: `run_logs`

`run_logs` should store log entries separately from `run_events`.

Purpose:

- preserve noisy debugging detail
- avoid making lifecycle events carry unstructured output
- allow separate UI treatment for timeline versus logs

Recommended fields:

| Field | Type | Purpose |
| --- | --- | --- |
| `workspace_id` | text | ownership boundary |
| `run_id` | text | parent run |
| `log_id` | text | stable log row identifier |
| `timestamp` | text | log time |
| `level` | text | debug/info/warn/error |
| `node_id` | text nullable | node linkage |
| `message` | text | log line |

Rules:

- append only
- logs are not the source of truth for lifecycle state
- logs may be noisy or incomplete without breaking run history

### Later Layer: `run_artifacts`

This does not need to exist in v1.

Early recommendation:

- keep artifact refs inside `snapshot_json` or relevant event payloads
- add a dedicated `run_artifacts` table later only when artifact browsing becomes a real product need

## Retrieval Model

### Run List

Run lists should read from `runs`, not from replayed event history.

Use cases:

- workflow history
- workspace history
- dashboard summaries
- filtering by:
  - status
  - workflow
  - date
  - trigger kind

### Run Detail

Run detail should load in layers:

1. `runs` summary row first
2. `run_events` timeline second
3. `run_logs` panel or tab separately

This gives:

- fast first paint for detail views
- simpler UI state management
- cleaner separation between summary, timeline, and logs

### Replay Model

The saved event history should be able to support:

- timeline playback in order
- node-level debugging
- retry attempt reconstruction
- cancellation and cleanup explanation

Without requiring the frontend to infer hidden runtime state from logs alone.

## API Surface

### Current Practical Baseline

In practice, the app already has:

- `POST /api/workspaces/:workspace_id/runs`
- `GET /api/workspaces/:workspace_id/runs`

And the runtime server already exposes global run routes such as:

- `GET /api/runs/:run_id`
- `GET /api/runs/:run_id/events`

### Recommended Workspace-Scoped History API

For the real run-history surface, prefer workspace-scoped endpoints:

- `GET /api/workspaces/:workspace_id/runs`
- `GET /api/workspaces/:workspace_id/runs/:run_id`
- `GET /api/workspaces/:workspace_id/runs/:run_id/events`
- `GET /api/workspaces/:workspace_id/runs/:run_id/logs`
- `POST /api/workspaces/:workspace_id/runs/:run_id/cancel`

Recommended behavior:

- list endpoint reads from `runs`
- detail endpoint returns latest snapshot from `runs`
- events endpoint returns stored `run_events`, optionally plus live tail later
- logs endpoint returns stored `run_logs`

## Retention Model

### Recommended V1 Behavior

Keep retention simple:

- keep run summary rows
- keep events
- keep logs
- do not add automatic pruning yet

Why:

- local SQLite-first product stage
- easier debugging while behavior is still stabilizing
- avoids retention complexity before we understand run volume

### Later Retention Direction

Later we can add:

- separate retention windows for summaries versus events/logs
- per-workspace quotas
- artifact cleanup strategies
- export-before-delete flows

But none of that is required for the first durable history layer.

## Debugging Model

The practical debugging experience should become:

1. open workspace run history
2. pick a run
3. see summary and final status immediately
4. inspect node timeline from `run_events`
5. inspect detailed log lines from `run_logs`
6. inspect partial outputs or artifact refs when present

This should work:

- after page reload
- after server restart
- long after the live SSE session is gone

## Implementation Slices

Recommended order:

1. add schema for `run_events` and `run_logs`
2. persist events and logs during live runtime execution
3. enrich `runs` with denormalized query columns
4. add workspace-scoped detail and history endpoints
5. build run-detail UI on top of summary, events, and logs

## Open Questions

- do we want a separate `requested_by_user_id` field now, or can that wait?
- should event replay endpoints support incremental pagination in v1?
- should logs be paginated immediately, or only when volume forces it?
- when we add artifacts, do we want a dedicated `run_artifacts` table or to stay ref-in-payload longer?
