# 06 Dashboard Detail Panel

Type: `detail-panel-study`

Purpose:

- define how a selected run can open a richer contextual inspection surface inside the dashboard
- test the balance between the run list and a structured detail panel
- establish patterns for error context, retries, timeline events, and node-level execution status

What this sample is testing:

- split dashboard stage with list on the left and detail panel on the right
- selected row treatment
- structured run metadata in a compact inspection panel
- inline failure callout plus retry/timeline context
- node execution summary as a lightweight diagnostic section

What this sample intentionally includes:

- contained shell reused from the other dashboard studies
- runs table as the selection surface
- selected failed run
- detail panel with metadata, error, retry tags, timeline, and node-state list

What this sample intentionally does not solve yet:

- actual drawer open/close behavior
- stacked mobile detail behavior
- live log streaming
- sticky row selection or multi-select
- complete run-debugging information architecture

Shared styling:

- this sample uses `../shared.css`
- detail-panel helpers are appended to the shared stylesheet rather than using a local override file

Review questions:

- does the split between list and detail panel feel balanced?
- is the detail panel structured enough without becoming a wall of metadata?
- should run inspection live in a right-side panel like this, or become a deeper full-screen route?
- does this feel like the right diagnostic depth for Stitchly’s first dashboard pass?
