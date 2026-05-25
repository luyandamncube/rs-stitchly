# 11 Decision Log

Use this file to capture important product and technical decisions in a compact format.

## Template

### YYYY-MM-DD - Decision Title

- status:
- context:
- decision:
- consequence:

## Entries

### 2026-05-25 - Storage should split platform identity data from rooted workflow-owned files

- status: proposed
- context: the app now has real backend-owned users, sessions, workspaces, workflows, and run history, but the longer-lived storage model for workflow files, per-workflow runs, table data, and future cloud-hosted deployment is still implicit.
- decision: draft a dedicated storage-root direction built around a control-plane database, a rooted data-plane filesystem keyed by stable IDs, backend-owned Google identity mapping, and a local-first model that can later transplant onto cloud-mounted storage.
- consequence: future storage format choices such as DuckDB, Parquet, or engine-backed table layouts should build on the ownership and root-layout boundaries captured in `23_storage_root_and_identity_architecture.md`.

### 2026-05-25 - Node execution and data passing should be documented in one shared per-node contract matrix

- status: proposed
- context: the workflow graph already carries nodes, ports, and edges, and the runtime already resolves simple typed inputs and outputs, but the exact per-node input/output contract is still too implicit across runtime adapters, frontend node managers, and fixtures.
- decision: draft a dedicated execution-contract doc that locks the v1 single-input model, explicit fan-out support, and a running per-node input/output table instead of splitting this into many node-specific docs.
- consequence: future node implementation and runtime work should add or update rows in `04_execution/01_node_io_and_execution_contracts.md` before deepening execution behavior.

### 2026-05-25 - Run persistence should move from latest snapshot only toward durable history plus debugging layers

- status: proposed
- context: runs are already persisted per workspace as latest snapshots, but durable event and log history are not yet stored separately, which limits later debugging and replay.
- decision: draft a dedicated run-history direction built around a summary `runs` table, append-only `run_events`, separate `run_logs`, summary-first detail retrieval, and simple v1 retention.
- consequence: implementation should wait for approval of the run-history keys captured in `22_run_history_and_debugging_spec.md`.

### 2026-05-24 - Workflow management should move from implicit starter loading to explicit workflow routes and per-workspace CRUD

- status: proposed
- context: workflows are now persisted per workspace, but the product still behaves like a single implicit canvas because users cannot yet list, create, choose, or delete workflows intentionally.
- decision: draft a dedicated workflow-management direction built around explicit workflow routes, backend-owned workflow selection state, list/create/open/archive flows, and per-workspace workflow management screens.
- consequence: implementation should wait for approval of the workflow-management keys captured in `21_workflow_management_spec.md` and the matching UI behavior in `03_ui/06_workflow_management_ui.md`.

### 2026-05-21 - Real app shell should move to backend auth, protected routes, and persisted workspaces

- status: proposed
- context: the current frontend shell is still scaffolded with local-only login, conditional screen rendering, and in-memory workspace/workflow assumptions, which now blocks real product behavior.
- decision: draft a v1 app-platform direction built around backend-owned cookie sessions, protected routes, workspace-scoped URLs, and persisted workflows and runs.
- consequence: implementation should wait for explicit approval of the auth, routing, and workspace keys captured in `20_app_auth_and_workspace_spec.md` before replacing the current scaffold.

### 2026-05-19 - Nodes use a structured operational card design

- status: accepted
- context: generic schema-style node boxes do not match the intended product feel or the desired clarity of the workflow canvas.
- decision: render nodes as compact operational cards with an optional top chip, header row, structured body rows, footer metric, integrated handles, and lava-colored edges.
- consequence: node definitions need richer `ui` metadata, descriptions become lower-emphasis in the visual card, and edges/handles become part of the node design language instead of generic canvas defaults.

### 2026-05-19 - The frontend defaults to a dark canvas-first shell

- status: accepted
- context: the product should feel like a high-performance workflow tool, not a dashboard with the canvas embedded inside it.
- decision: make dark mode, infinite-canvas presentation, and minimal overlay chrome the default frontend direction.
- consequence: future UI work should optimize for fullscreen graph editing with compact overlays instead of permanent headers and sidebars.

### 2026-05-19 - Stitchly uses a rail, drawer, and floating-card navigation shell

- status: accepted
- context: the first UI scaffold exposed header, inspector, and control-pane content at the same time, which reduces canvas focus and does not match the intended premium tool feel.
- decision: use a slim left rail for global navigation, a drawer for section content, and a contextual floating card for focused detail.
- consequence: inspector and run controls move behind toggled navigation, and contextual detail becomes selection-driven instead of permanently visible.

### 2026-05-19 - True Black plus Lava Core is the initial visual palette

- status: accepted
- context: the current frontend styling leans too heavily on cool atmospheric accents for the desired product direction.
- decision: use a strict dark palette with `#0B0B0D`, `#17171C`, `#222229`, `#7A7A85`, `#F56E0F`, `#FF7A1A`, and white as the initial frontend visual system.
- consequence: grayscale surfaces become the baseline, orange becomes the main active accent, and default UI chrome should avoid competing color families.

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
