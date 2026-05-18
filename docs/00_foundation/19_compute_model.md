# 19 Compute Model

## Purpose

Define how Stitchly performs computation across built-in nodes, custom code nodes, CLI-backed integrations, and engine-backed data workloads.

## Core Principle

Stitchly should treat Rust as the control plane, not as the place where every kind of work must execute directly.

The backend should own:

- validation
- planning
- scheduling
- run lifecycle
- retries and cancellation
- artifact and ref orchestration
- event streaming

Actual compute can happen in different places depending on node type.

## Three Compute Lanes

### 1. Orchestration Compute

This is the work the Rust runtime always owns.

Examples:

- compiling the workflow graph
- resolving dependencies
- selecting ready nodes
- dispatching executors
- recording state transitions
- emitting run events

This should stay lightweight and low-overhead.

### 2. Local Execution Compute

This is work that runs under backend-managed execution locally.

Examples:

- built-in Rust transforms
- Python glue logic
- controlled CLI-backed tools such as Dolt

This lane is useful for:

- small to medium tasks
- local-first development
- typed integration nodes
- workflows that do not justify an external engine

### 3. External Engine Compute

This is work that executes outside the Rust process in a specialized system.

Examples:

- ClickHouse SQL transforms
- bulk loads into a warehouse
- engine-native materializations

This lane is the preferred path for heavy data processing.

## Executor Kinds

The runtime should dispatch work based on executor kind.

### `rust_native`

Runs inside the Rust process.

Use for:

- lightweight built-in nodes
- cheap deterministic transforms
- metadata and validation-oriented nodes

Pros:

- fastest startup
- lowest overhead
- easiest to test

Risks:

- poor fit for untrusted code
- should not be used for workloads that can block the runtime carelessly

### `python`

Runs Python-based work through backend-managed execution.

Recommended first mode:

- subprocess execution in a controlled working directory

Use for:

- custom Python logic
- data wrangling glue steps
- user-defined scripting nodes

Pros:

- good developer ergonomics
- faster iteration than container-per-node execution

Risks:

- weaker isolation than containers
- dependency management must be controlled deliberately

### `process`

Runs controlled external CLI-backed work.

Use for:

- Dolt-backed operations
- tightly scoped tool integrations
- transitional adapters where a typed backend node wraps a real command-line tool

Pros:

- practical for proven tools
- easier to adopt than building a native integration immediately

Risks:

- host dependency drift
- command environment can become fragile if not standardized

### `engine_adapter`

Delegates work to external engines.

Use for:

- ClickHouse transforms
- warehouse loads
- engine-native workloads

Pros:

- heavy compute happens where it belongs
- keeps Stitchly runtime thin

Risks:

- needs strong connection handling
- error mapping and observability are more complex

### Future `container_worker`

This should be a later executor mode, not the default starting point.

Use for:

- stronger isolation
- multi-tenant or lower-trust code execution
- reproducible runtime packaging when subprocess mode becomes insufficient

## Isolation Modes

Executor kind and isolation mode are related but not identical.

Useful early isolation modes:

- `in_process`
- `subprocess`
- `external_engine`

Useful later isolation modes:

- `container`
- `remote_worker`

This separation matters because:

- a `python` executor might start in `subprocess` mode
- the same logical node type might later run in `container` mode
- an `engine_adapter` is usually `external_engine` even though Rust still orchestrates it

## Why Not Default To Docker Now

Containerizing every node execution sounds clean, but it is usually a poor first step.

Problems with a container-first v1:

- image-build overhead slows iteration
- startup latency hurts local workflows
- volume and artifact mounting adds complexity
- dependency packaging work arrives before the node model is stable
- debugging becomes more awkward
- test loops become heavier than necessary

For the first implementation, Docker would likely add more friction than leverage.

## Recommended V1 Execution Model

### Built-In Nodes

Run as `rust_native` in-process tasks.

Examples:

- `file_input`
- `text_input`
- `preview_output`
- simple metadata or ref manipulation nodes

### Python Nodes

Run as backend-managed subprocesses.

Recommended behavior:

- create controlled working directory
- pass typed inputs in a predictable format
- capture stdout and stderr as logs
- collect declared outputs into typed refs
- enforce timeout and resource hints where possible

### CLI-Backed Integration Nodes

Run as typed `process` adapters.

Examples:

- `dolt_repo_source`
- `dolt_dump_csv`

These should be modeled as real node types, not generic shell-command nodes.

### Data Engine Nodes

Run as `engine_adapter`.

Examples:

- `load`
- `sql_transform`
- `table_output`

Rust should submit or compile the work, then monitor status, collect outputs, and map results into refs and events.

## Artifact Passing Strategy

The runtime should prefer passing typed refs rather than large in-memory payloads.

Examples:

- `python_script` receives a `file_ref`
- `dolt_dump_csv` emits a `directory_ref`
- `load` consumes that `directory_ref` and emits one or more `table_ref` values

This keeps the orchestration layer thin and makes executor boundaries easier to manage.

## Scheduling And Dispatch

The scheduler should not care about Python versus ClickHouse at a high level.

It should:

1. determine which nodes are ready
2. inspect each node's runtime binding
3. dispatch to the correct executor
4. update run and node state based on structured events

This is why executor kind belongs in the node definition contract.

## Resource Management

Resource hints should shape dispatch behavior even in v1.

Useful early hints:

- timeout
- expected CPU intensity
- expected memory intensity
- concurrency group or pool

We do not need a fully sophisticated scheduler on day one, but we should not assume every node has identical compute needs.

## Cancellation And Retries

Each executor kind needs different control behavior.

### `rust_native`

- easiest to observe directly
- cancellation can be cooperative inside the runtime

### `python`

- cancellation means signaling and cleaning up subprocesses
- retries should start a fresh execution attempt

### `process`

- similar to Python subprocess control
- requires explicit cleanup of temp work and partial outputs

### `engine_adapter`

- cancellation may mean issuing a remote cancel request or marking the run as cancelled while cleanup continues

The run model should hide these differences from the frontend while still preserving accurate backend behavior.

## Security Implications

Compute choices directly affect security posture.

Recommended early stance:

- trusted built-in Rust nodes may run in-process
- Python and CLI nodes run in controlled subprocesses
- external data engines get least-privilege connections
- container isolation arrives when trust boundaries or packaging needs justify it

This keeps development fast without pretending subprocess execution solves every security problem.

## Testing Implications

Each compute lane should be testable differently.

### `rust_native`

- unit tests
- planner tests
- runtime state tests

### `python` and `process`

- subprocess adapter tests
- fixture-driven integration tests
- optional smoke tests with real local dependencies

### `engine_adapter`

- fake adapter tests
- integration tests against local or containerized engine dependencies when useful

Docker is often more valuable in testing and reproducible dependency setup than as the default runtime for every node.

## Scaling Path

The compute model should evolve in stages.

### Stage 1

- local Rust orchestration
- in-process built-ins
- subprocess Python and CLI nodes
- engine pushdown for heavy data work

### Stage 2

- pooled workers for repeated Python execution
- better concurrency controls
- stronger artifact lifecycle management

### Stage 3

- optional container workers
- optional remote workers
- richer scheduling and isolation policies

This progression keeps the first version lightweight while still leaving room to grow.

## Recommended First Implementation

If we implement compute soon, the first executor set should likely be:

- `rust_native`
- `python` using subprocess execution
- `process` for Dolt-style typed integrations
- `engine_adapter` for ClickHouse

That is enough to support both:

- `file_input -> python_script -> output`
- `dolt_repo_source -> dolt_dump_csv -> load -> sql_transform -> table_output`

## Open Questions

- Do we want long-lived Python worker pools in the first local runtime, or only fresh subprocesses?
- How opinionated should dependency packaging be for Python nodes in v1?
- When does container isolation become worth the complexity cost?
