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
- Workflow planning and example docs live under `01_workflows/`.
- Strategy and naming docs should use lower numbers such as `00_...` and `01_...`.
- Concrete workflow example docs should continue to use numbered filenames starting at `20_...`.
- Each concrete workflow example doc should capture one specific dataflow or automation flow.
- Build prompt and implementation-guidance docs live under `02_build/` and use numbered filenames starting at `00_...`.
- UI-specific product and interaction docs live under `03_ui/` and use numbered filenames starting at `00_...`.
- Execution-specific runtime contract docs live under `04_execution/` and use numbered filenames starting at `01_...`.
- Venture and idea-evaluation docs live under `05_venture/` and use numbered filenames starting at `00_...`.
- Trading-research strategy docs live under `06_trading_research/` and use numbered filenames starting at `00_...`.
- Data-contract docs for concrete source datasets and curated table shapes live under `07_data_contracts/`.
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
- `00_foundation/22_run_history_and_debugging_spec.md`: v1 draft for durable run summaries, event history, log persistence, retrieval layers, and retention direction
- `00_foundation/23_storage_root_and_identity_architecture.md`: rooted local-first storage layout, control-plane vs data-plane boundaries, Google identity mapping direction, and local-to-cloud transplant model
- `00_foundation/24_workflow_duckdb_storage_spec.md`: one-DuckDB-per-workflow direction, rooted workflow-local DB layout, bootstrap rules, and schema ownership boundaries
## UI

- `03_ui/00_frontend_canvas.md`: React Flow editor responsibilities, shell model, visual direction, node design direction, and UX rules
- `03_ui/01_node_state_model.md`: node interaction, connection, validation, and runtime state layers for the canvas UI
- `03_ui/02_ui_roadmap.md`: phased UI delivery plan, sandbox-first build method, and recommended next implementation order
- `03_ui/03_node_reference_analysis.md`: detailed analysis of the sample node design language, spacing, hierarchy, handles, and practical implications for Stitchly
- `03_ui/04_ui_lab_workflow.md`: workflow for building isolated HTML/CSS design samples, reviewing variants, and graduating approved patterns into the real UI
- `03_ui/05_node_design_inventory.md`: node-design approval backlog, shared visual archetypes, and the candidate node list keyed for approve/reject decisions
- `03_ui/06_workflow_management_ui.md`: workflow-list, create/open/delete flow, canvas relationship, and workflow-management screen behavior

## Execution

- `04_execution/01_node_io_and_execution_contracts.md`: shared node input/output execution rules, v1 fan-out behavior, and the running per-node contract table
- `04_execution/02_output_contract.md`: node output rules, inline-vs-ref direction, and the running per-node output contract table
- `04_execution/03_execution_contract.md`: runtime execution shape, preconditions, outcomes, and the running per-node execution contract table
- `04_execution/04_adapter_contract.md`: runtime-to-adapter boundary, return/error rules, and the running per-node adapter contract table
- `04_execution/05_multi_edge_semantics.md`: outbound fan-out rules, deferred fan-in semantics, and the running per-node edge-participation contract table
- `04_execution/06_run_execution_implementation_spec.md`: phased implementation plan for real runs, runtime-state UI, durable debugging, and workflow-local DuckDB writes

## Workflows

- `01_workflows/00_finance_workflow_ideas.md`: first-pass list of realistic finance ingestion workflows, data sources, and candidate node families
- `01_workflows/01_finance_table_grouping_and_naming.md`: scalable naming and grouping convention for finance tables across schemas, grains, providers, and enrichments
- `01_workflows/20_workflow_example_dolt.md`: DoltHub earnings ingest into typed artifacts and warehouse sinks
- `01_workflows/21_dolthub_market_data_duckdb_ingest.md`: DuckDB-oriented plan for ingesting large DoltHub market datasets with append-friendly landing and efficient reingestion

## Build

- `02_build/00_llm_build_prompt.md`: reusable implementation prompt for coding LLMs, with doc source mapping and first-pass build scope

## Venture

- `05_venture/README.md`: index for the venture-evaluation framework and seeded idea records
- `05_venture/00_idea_framework.md`: operating loop for capturing, normalizing, scoring, recommending, and tracking ideas
- `05_venture/01_idea_record_template.md`: fixed per-idea schema and output format for idea records
- `05_venture/02_scoring_rubric.md`: weighted scoring model, confidence rules, and scoring anchors
- `05_venture/03_recommendation_rules.md`: deterministic recommendation thresholds, gating rules, and next-action mapping
- `05_venture/04_portfolio_backlog.md`: portfolio tracker for scored ideas and current next actions
- `05_venture/05_idea_generation_loop.md`: sourcing loop for turning recurring pain and market signals into candidate ideas
- `05_venture/06_idea_source_catalog.md`: repeatable source map for discovering venture signals and capturing them consistently
- `05_venture/07_pre_score_template.md`: lightweight filter used before a full rubric pass
- `05_venture/20_idea_savr.md`: seeded example evaluation for Savr
- `05_venture/21_idea_waterwatch.md`: seeded example evaluation for WaterWatch
- `05_venture/22_idea_gridza.md`: seeded example evaluation for GridZA

## Trading Research

- `06_trading_research/00_systematic_technical_strategy_research.md`: first structured direction for technical strategy research workflows, including research layers, table families, and node implications
- `06_trading_research/01_derivatives_and_volatility_strategy_research.md`: first structured direction for options, volatility, and position-structure research workflows, including dashboards, payoff evaluation, and ranking

## Data Contracts

- `07_data_contracts/00_earnings_curated_tables.md`: first-pass DoltHub earnings source-to-curated table contracts, SQL transforms, durable targets, and merge keys
- `07_data_contracts/01_rates_curated_tables.md`: first-pass DoltHub rates source-to-curated table contracts, treasury snapshot/delta normalization, durable target, and merge keys
