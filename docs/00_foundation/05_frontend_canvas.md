# 05 Frontend Canvas

## Purpose

Document the responsibilities and constraints of the Stitchly workflow editor.

## Frontend Responsibilities

- render the workflow graph
- allow users to create, connect, position, and configure nodes
- enforce basic connection and schema rules in the UI
- show run status, logs, and outputs returned by the backend
- serialize workflow edits into the canonical workflow format
- support component and end-to-end tests using shared workflow fixtures

## Frontend Non-Responsibilities

- executing nodes
- storing secrets used for runtime execution
- deciding scheduling behavior
- managing compute resources

## Early Direction

- Use React Flow as the graph interaction layer.
- Keep node rendering schema-driven where possible.
- Avoid leaking execution implementation details into editor state.
- Prefer generated or shared contract types over hand-maintained duplicate models.

## Open Questions

- Which validations should happen optimistically in the UI versus only in the backend?
- How much run inspection belongs inline on the canvas versus in side panels?
- Do custom nodes define their own inspector UI, or do we generate most of it?
- How do we keep component tests fast while still exercising realistic workflow fixtures?
