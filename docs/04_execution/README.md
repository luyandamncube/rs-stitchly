# Execution Docs

This folder is for runtime-focused execution contracts and operational behavior that deserve their own track outside the broader foundation docs.

## Contents

- `01_node_io_and_execution_contracts.md`: shared node input/output rules, v1 fan-out behavior, and the running per-node execution contract table
- `02_output_contract.md`: node output rules, inline-vs-ref direction, and the running per-node output table
- `03_execution_contract.md`: runtime execution shape, preconditions, outcomes, and the running per-node execution table
- `04_adapter_contract.md`: runtime-to-adapter boundary, return/error rules, and the running per-node adapter table
- `05_multi_edge_semantics.md`: outbound fan-out rules, deferred fan-in semantics, and the running per-node edge-participation table
- `06_run_execution_implementation_spec.md`: phased rollout plan for real workflow execution, live runtime UI feedback, durable debugging, and workflow-local DuckDB integration
