# 18 Run Lifecycle And Events

## Purpose

Define how Stitchly represents workflow runs, node execution states, retries, cancellation, and event streams.

## Why This Matters

The runtime, API, frontend, and tests all need the same mental model for what a run is and how it changes over time.

If this model is vague, we will end up with:

- inconsistent UI status behavior
- confusing retry semantics
- brittle tests
- log streams that are hard to reason about

## Core Entities

### Workflow Run

A workflow run is one execution attempt of a workflow definition with a specific config, trigger, and runtime context.

### Node Run

A node run is the execution record for one workflow node during a workflow run.

### Event Stream

The event stream is the ordered sequence of runtime events emitted while a run progresses.

The API should expose this stream directly to the frontend through a stable transport such as SSE in the first version.

## Workflow Run State Machine

Suggested top-level states:

- `created`
- `queued`
- `planning`
- `running`
- `succeeded`
- `failed`
- `cancelling`
- `cancelled`

Notes:

- `queued` may be optional in the earliest local-only runtime, but the model should allow it.
- `planning` should be visible because validation, compilation, or adapter preparation can fail before active execution.

## Node Run State Machine

Suggested node states:

- `pending`
- `ready`
- `running`
- `succeeded`
- `failed`
- `skipped`
- `cancelling`
- `cancelled`
- `retrying`

These states should be detailed enough for useful UI feedback without forcing the frontend to infer hidden runtime behavior.

## Suggested Run Object Shape

Illustrative shape:

```json
{
  "run_id": "run_123",
  "workflow_id": "wf_abc",
  "workflow_version": 3,
  "trigger": {
    "kind": "manual"
  },
  "status": "running",
  "started_at": "2026-05-18T10:00:00Z",
  "finished_at": null
}
```

## Event Categories

The event stream should use structured categories.

Useful early categories:

- run created
- planning started
- planning finished
- node started
- node log emitted
- node progress updated
- node output produced
- node retried
- node failed
- run failed
- cancellation requested
- run cancelled
- run succeeded

## Event Structure

Each event should ideally include:

- `event_id`
- `run_id`
- timestamp
- event type
- target scope such as run or node
- payload

Optional fields:

- sequence number
- correlation ID
- retry attempt number
- severity for log-like events

This structure should be stable enough to serve both:

- live streamed event payloads
- stored event snapshots returned by the API

## Logs Versus Events

We should keep a clean distinction between:

- structured lifecycle events
- unstructured or semi-structured logs

Logs are important, but they should not be the only source of truth for execution state.

The frontend should be able to render run progress from events even when logs are noisy or incomplete.

The UI should be able to consume the same event shape whether it arrives:

- from a live SSE stream
- from a replay or snapshot endpoint

## Retry Model

Retries should be explicit rather than hidden.

At minimum we should record:

- which node retried
- which attempt number is active
- why the retry happened
- whether the retry policy was automatic or user-triggered

The run state should remain understandable even if one node retries multiple times.

## Cancellation Model

Cancellation should be cooperative but visible.

Suggested flow:

1. user or system requests cancellation
2. run enters `cancelling`
3. active nodes receive cancellation signal when supported
4. remaining pending nodes do not start
5. run enters `cancelled` when cleanup is complete

Not every executor will support instant interruption, so the state model should reflect in-progress cancellation rather than pretending it is immediate.

Current v1 implementation applies cancellation at runtime boundaries:
- before the next node starts
- during configured execution waits
- after the current adapter call returns

Long synchronous adapter work is therefore best-effort cancellable for now rather than hard-preempted.

## Failure Model

Failure reporting should separate:

- user-facing summary
- machine-readable error category
- detailed diagnostic payload

Useful error categories:

- validation error
- planning error
- adapter resolution error
- connection error
- execution error
- timeout
- cancellation

## Outputs And Completion

On success, the run should expose:

- final status
- produced refs or declared outputs
- node summaries
- relevant metrics such as duration

On failure, the run should still expose:

- partial node status
- available logs
- any artifacts produced before failure
- machine-readable error summary

## Scheduling And Backfills

The run model should support trigger metadata from the start.

Examples:

- manual trigger
- schedule trigger
- event trigger
- backfill trigger with partition or date range context

This metadata matters for debugging and later observability.

## Frontend Implications

The frontend should be able to:

- render overall run state
- highlight node states
- stream logs without inventing status from logs
- show retries and cancellation clearly
- inspect outputs and failures after completion

This is why the event model needs to be structured and stable.

## Testing Implications

We should keep fixtures for:

- successful run event streams
- validation failures
- node retry flows
- cancellation flows
- partial success with downstream failure

These fixtures should power backend tests, API tests, and frontend run-visualization tests.

## Recommended First Version

For the first usable runtime, we do not need every advanced state.

We do need:

- `planning`, `running`, `succeeded`, `failed`, `cancelled`
- node start and finish events
- structured log events
- retry visibility
- explicit cancellation request handling

That is enough to support a useful UI and stable tests.

## Open Questions

- Do we expose event streams only over SSE at first, or also through polling-friendly snapshots?
- How should partial outputs be represented for failed runs?
- Should node progress be percent-based, stage-based, or adapter-specific?
