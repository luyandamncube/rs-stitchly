# 04 Adapter Contract

## Purpose

Define the boundary between the runtime planner and the code that actually performs node work.

This doc answers:

- what the adapter/executor layer receives
- what it must return
- how errors and logs should surface
- how per-node adapter behavior should be tracked

## V1 Global Contract

### Adapter Boundary

The adapter layer should be the thinnest possible execution boundary beneath the runtime.

The runtime is responsible for:

- graph planning
- input resolution
- node state transitions
- run state transitions
- event history

The adapter layer is responsible for:

- node-specific execution
- interpreting config for that node
- consuming resolved inputs
- returning outputs and logs

### Request Shape

In practical terms, an adapter execution should receive:

- node definition
- workflow node instance
- resolved inputs

That is already close to the current Rust runtime adapter shape.

### Response Shape

For v1, adapter execution should return:

- `outputs`
- `logs`

And on failure:

- a structured adapter/runtime error

### Error Contract

The adapter layer should never be responsible for deciding graph-level recovery.

It should only report execution failure such as:

- invalid config at execution time
- missing input at execution time
- type mismatch
- external side-effect failure

The runtime then turns that into:

- run failure
- node failure
- events
- persisted history

## Running Adapter Contract Table

| Node type | Current executor lane | Adapter responsibility | Returns | Failure surface | V1 adapter note |
| --- | --- | --- | --- | --- | --- |
| `text_input` | `rust_native` / in-process | read config, emit text output | outputs + logs | invalid config only | no external dependency |
| `text_transform` | `rust_native` / in-process | read transform mode, apply transform to upstream text | outputs + logs | invalid config, missing input, type mismatch | deterministic synchronous adapter |
| `preview_output` | `rust_native` / in-process | read title config, consume text, emit preview log | logs only | invalid config, missing input, type mismatch | sink-style adapter with no graph outputs |
| `send_email` | `rust_native` / in-process | read recipient config, resolve body from input/config, record send intent/logs | logs only | invalid config, type mismatch, future delivery failure | currently modeled as side-effect intent without external provider binding |

## Notes By Node

### `text_input`

`text_input` is the cleanest adapter baseline:

- zero upstream dependency
- zero external dependency
- one direct output

### `send_email`

`send_email` is the first adapter that hints at future provider integration.

In v1 it should remain simple, but this table is where we will later record:

- provider binding expectations
- connection requirements
- delivery error categories

## Future Adapter Extensions

As new executor lanes arrive, this doc should expand to cover:

- `python`
- `process`
- `engine_adapter`
- future container/external-engine execution

Later additions should also capture:

- timeout policy
- retry hint interpretation
- resource hints
- cancellation handoff rules
