# 11 Decision Log

Use this file to capture important product and technical decisions in a compact format.

## Template

### YYYY-MM-DD - Decision Title

- status:
- context:
- decision:
- consequence:

## Entries

### 2026-05-18 - Rust owns runtime execution

- status: accepted
- context: Stitchly aims to be a lightweight workflow system that stays performant as execution volume grows.
- decision: put validation, planning, and execution in a Rust backend rather than in the frontend.
- consequence: the frontend can stay focused on workflow editing while the runtime evolves independently.

### 2026-05-18 - React Flow is the initial canvas layer

- status: accepted
- context: the product needs a graph editor quickly without spending early cycles on low-level canvas mechanics.
- decision: use React Flow for the first workflow authoring experience.
- consequence: we can validate product ergonomics early while keeping the workflow semantics backend-owned.

### 2026-05-18 - Frontend defines workflows semantically only

- status: accepted
- context: we want a clean separation between editing and execution.
- decision: the frontend will create and edit workflow definitions but will not process workflow nodes directly.
- consequence: backend APIs and schema design become the source of truth for execution behavior.

### 2026-05-18 - Dataflow orchestration is a first-class product lane

- status: accepted
- context: Stitchly should support not only script-oriented automation flows but also ingestion and transformation workloads similar to data orchestration tools.
- decision: treat dataflow workflows and engine-backed workload nodes as core product capabilities rather than add-ons.
- consequence: the node model, runtime, API, persistence, and security design all need to account for external data engines from the start.

### 2026-05-18 - Stitchly orchestrates data engines instead of replacing them

- status: accepted
- context: engines such as ClickHouse are better suited for heavy data execution than a generic workflow runtime.
- decision: keep Rust as the control plane and orchestration layer, while delegating heavy data processing to specialized engines where appropriate.
- consequence: the architecture needs engine adapters, workload planning, credential indirection, and performance benchmarks that distinguish orchestration cost from engine cost.

### 2026-05-18 - Shared workflow contracts drive testing across frontend and backend

- status: accepted
- context: prior proof-of-concept work became harder to test as the frontend and Python backend evolved separately with different assumptions and duplicated test setup.
- decision: make the backend-owned workflow schema and shared fixtures the contract for backend tests, frontend component tests, API tests, and end-to-end tests.
- consequence: feature work must be expressed in canonical workflow artifacts first, which reduces drift and makes cross-stack testing easier to automate.

### 2026-05-18 - Executor model comes before container-first execution

- status: accepted
- context: Stitchly needs a compute model that stays lightweight and easy to iterate on during early development, while still allowing stronger isolation later.
- decision: model compute around executor kinds such as `rust_native`, `python`, `engine_adapter`, and `process`, and avoid making Docker the default execution path for every node in v1.
- consequence: the Rust runtime stays focused on orchestration, subprocess and engine adapters cover early execution needs, and container workers can be added later where trust or scaling requirements justify them.

### 2026-05-18 - The API control plane is built in Rust with REST plus SSE first

- status: accepted
- context: Stitchly's API is tightly coupled to workflow validation, planning, run lifecycle, and structured event streaming, all of which already belong in the Rust backend.
- decision: build the first API server in Rust, likely with `axum`, use REST for control operations and metadata, and use SSE as the first streaming transport for run events.
- consequence: the frontend stays thin, API contracts remain close to runtime logic, and we avoid adding a second backend language just to expose transport endpoints.
