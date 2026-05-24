# Stitchly Docs

This folder is the long-lived product and engineering memory for Stitchly.

The goal is to document:

- what the product is
- how workflows and nodes are modeled
- how data workloads are modeled and executed
- how the frontend and backend divide responsibility
- which decisions we make as the system evolves

## Conventions

- Foundational docs live under `00_foundation/` and use numbered filenames such as `00_intro.md`.
- Earlier numbers describe stable concepts that other docs can depend on.
- Workflow example docs live under `01_workflows/` and use numbered filenames starting at `20_...`.
- Each workflow example doc should capture one concrete dataflow or automation flow.
- Build prompt and implementation-guidance docs live under `02_build/` and use numbered filenames starting at `00_...`.
- UI-specific product and interaction docs live under `03_ui/` and use numbered filenames starting at `00_...`.
- When a major product or technical direction changes, update the relevant doc and add an entry to `00_foundation/11_decision_log.md`.
- Prefer extending an existing numbered doc before creating a new one for overlapping content.

## Foundation

- `00_foundation/00_intro.md`: product vision, goals, principles, MVP boundaries
- `00_foundation/01_node_types.md`: node taxonomy, node contract, first-pass node catalog
- `00_foundation/02_architecture.md`: top-level system architecture and component boundaries
- `00_foundation/03_workflow_schema.md`: canonical workflow graph format and validation rules
- `00_foundation/04_execution_runtime.md`: planning, scheduling, execution lifecycle, resource handling
- `00_foundation/06_backend_api.md`: APIs between the frontend and the Rust backend
- `00_foundation/07_persistence.md`: workflow storage, versioning, runs, and artifact persistence
- `00_foundation/08_security_and_sandboxing.md`: isolation model for custom code and untrusted execution
- `00_foundation/09_performance_and_scaling.md`: performance budgets, benchmarks, and scaling strategy
- `00_foundation/10_mvp_scope.md`: phased delivery plan for the first usable product
- `00_foundation/11_decision_log.md`: compact record of major product and technical decisions
- `00_foundation/12_dataflow_and_workloads.md`: data ingestion, transformation, engine adapters, and workload-oriented orchestration
- `00_foundation/13_testing_strategy.md`: shared contracts, test layers, and frontend/backend build loops
- `00_foundation/14_repo_structure_and_build.md`: monorepo layout, shared packages, task commands, and CI lanes
- `00_foundation/15_node_definition_spec.md`: exact node definition contract for frontend, backend, and runtime
- `00_foundation/16_connections_and_secrets.md`: connection references, secret resolution, and access boundaries
- `00_foundation/17_artifacts_and_dataset_refs.md`: artifact references, dataset references, lifecycle, and lineage
- `00_foundation/18_run_lifecycle_and_events.md`: run states, node states, retries, cancellation, and event streams
- `00_foundation/19_compute_model.md`: compute lanes, executor kinds, isolation strategy, and scaling path
- `00_foundation/20_app_auth_and_workspace_spec.md`: v1 draft for auth, protected routes, workspace persistence, and the real application shell
- `00_foundation/21_workflow_management_spec.md`: v1 draft for workflow identity, storage, lifecycle, routing, archive behavior, and per-workspace workflow management

## UI

- `03_ui/00_frontend_canvas.md`: React Flow editor responsibilities, shell model, visual direction, node design direction, and UX rules
- `03_ui/01_node_state_model.md`: node interaction, connection, validation, and runtime state layers for the canvas UI
- `03_ui/02_ui_roadmap.md`: phased UI delivery plan, sandbox-first build method, and recommended next implementation order
- `03_ui/03_node_reference_analysis.md`: detailed analysis of the sample node design language, spacing, hierarchy, handles, and practical implications for Stitchly
- `03_ui/04_ui_lab_workflow.md`: workflow for building isolated HTML/CSS design samples, reviewing variants, and graduating approved patterns into the real UI
- `03_ui/05_node_design_inventory.md`: node-design approval backlog, shared visual archetypes, and the candidate node list keyed for approve/reject decisions
- `03_ui/06_workflow_management_ui.md`: workflow-list, create/open/delete flow, canvas relationship, and workflow-management screen behavior

## Workflows

- `01_workflows/20_workflow_example_dolt.md`: DoltHub earnings ingest into typed artifacts and warehouse sinks

## Build

- `02_build/00_llm_build_prompt.md`: reusable implementation prompt for coding LLMs, with doc source mapping and first-pass build scope
