# Docs Contract

## Purpose

`docs` is the long-lived product and engineering memory for Stitchly. Agents should use it as a routed reference, not as a blob to load wholesale.

## Routing

- Product and architecture: `00_foundation/00_intro.md`, `02_architecture.md`, `10_mvp_scope.md`, `11_decision_log.md`.
- Repo/build/test shape: `00_foundation/13_testing_strategy.md`, `14_repo_structure_and_build.md`.
- Frontend UI: `03_ui/*`.
- Runs/runtime/debugging: `00_foundation/18_run_lifecycle_and_events.md`, `22_run_history_and_debugging_spec.md`, `04_execution/06_run_execution_implementation_spec.md`.
- Node contracts: `00_foundation/15_node_definition_spec.md`, `04_execution/01_node_io_and_execution_contracts.md` through `05_multi_edge_semantics.md`.
- Auth/workspace/storage: `00_foundation/20_app_auth_and_workspace_spec.md` through `24_workflow_duckdb_storage_spec.md`.
- Workflow examples and research: `01_workflows/*`, `06_trading_research/*`.
- Venture/idea evaluation: `05_venture/*`.

## Rules

- Prefer extending an existing numbered doc over adding a new overlapping doc.
- Add a decision-log entry only for durable product or architecture decisions.
- Do not use `02_build/00_llm_build_prompt.md` as routine task context; it is a broad bootstrap prompt.
- Keep docs aligned with implementation reality when changing a contract.
