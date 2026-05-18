# 03 Workflow Schema

## Purpose

Define the canonical workflow representation used by Stitchly.

## This Doc Should Eventually Answer

- what a workflow object looks like
- how nodes, edges, ports, and config are represented
- how workload-oriented node definitions are represented
- how schema versioning works
- how validation errors are expressed
- how migrations between schema versions are handled

## Early Direction

- The workflow format should be backend-owned and frontend-editable.
- The schema should be serializable in a stable format such as JSON.
- The frontend graph model should map cleanly onto the canonical backend model, not define a separate source of truth.
- Engine-specific credentials should not be embedded directly in workflow definitions; workflows should reference backend-managed connection or engine descriptors.
- Shared workflow fixtures should be valid against the same canonical schema in backend, frontend, and end-to-end tests.

## Open Questions

- Do we model graph-level inputs and outputs explicitly?
- Are edges typed directly or inferred from connected ports?
- How do we represent engine selection and workload config without hardcoding one engine's shape into the whole schema?
- How much UI-only metadata belongs in the saved workflow definition?
- Which parts of the schema should generate frontend types and test fixtures automatically?
