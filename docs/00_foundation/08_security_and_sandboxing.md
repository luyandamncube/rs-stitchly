# 08 Security And Sandboxing

## Purpose

Define how Stitchly safely runs custom logic, especially Python-based nodes.

## Topics To Cover

- trust model
- sandbox boundaries
- filesystem permissions
- network permissions
- secret access
- database and engine credential scoping
- CPU and memory limits
- process isolation
- dependency management

## Early Direction

- Assume custom code execution is one of the highest-risk parts of the system.
- Design security boundaries early, even if the first implementation is local-only.
- Keep the frontend out of secret handling and execution permissions.
- Treat data-engine access with least-privilege defaults so workload nodes do not get broader permissions than required.
- Start with backend-managed subprocess isolation where it keeps development fast, then add stronger container isolation where trust or multi-tenant requirements justify the cost.

## Open Questions

- What is the first sandbox mechanism for Python execution?
- Do we allow arbitrary package installation per node, per workflow, or not at all?
- How do we prevent custom nodes from silently depending on host-machine state?
- How do engine-backed nodes receive credentials safely without exposing them to the frontend?
- Which executor kinds require container boundaries versus lighter process boundaries?
