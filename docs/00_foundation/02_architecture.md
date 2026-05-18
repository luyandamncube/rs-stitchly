# 02 Architecture

## Purpose

Define the high-level system architecture for Stitchly and keep the frontend/backend boundary explicit.

## Starting Assumptions

- The frontend is a React application using React Flow for workflow authoring.
- The backend is a Rust service or runtime that owns validation, planning, and execution.
- The first API transport layer should also be Rust so the control plane stays in one backend language.
- The frontend sends workflow definitions to the backend rather than executing graph logic itself.
- Custom node runtimes are invoked through backend-managed execution adapters.
- Some data-oriented nodes delegate heavy execution to external engines such as ClickHouse through backend-managed engine adapters.
- Workload definitions may be represented at the node level, but orchestration semantics should remain standardized in Stitchly.
- The Rust backend acts as a control plane and scheduler, not as the place where all heavy computation must happen.

## Topics To Capture Here

- process boundaries
- service layout
- shared schema and contract packages
- compute plane and executor model
- API transport layer and streaming model
- local versus remote execution modes
- node registry architecture
- engine adapter architecture
- scheduler and trigger model
- eventing and run-status propagation
- testing harness boundaries
- deployment targets

## Immediate Questions

- Is the first backend a single binary or multiple services?
- Do we separate API concerns from runtime concerns in the first release?
- Do we standardize on REST plus SSE first, or introduce WebSocket immediately?
- How do built-in Rust nodes and external runtime nodes coexist cleanly?
- How do engine-backed workload nodes compile into engine-native operations?
- Which executor kinds run in-process, as subprocesses, or through external engines?
- Do we support scheduling and backfills in the first runtime, or after manual execution is solid?
- Which contract artifacts are generated for the frontend so UI and backend validation do not drift?
