# 02 Dashboard Table

Type: `data-surface-study`

Purpose:

- push the contained dashboard language into a more realistic `Runs & Logs` table study
- test row density, inline status treatment, error handling, and retry visibility
- refine how much hierarchy should live in the KPI strip versus the table itself

What this sample is testing:

- denser row rhythm than `01_dashboard_shell`
- calmer, more operational topbar copy
- inline error text plus trailing action/toggle affordance
- a larger run-history scan surface with more row-state variety
- whether Stitchly’s dark dashboard can feel sharp without becoming noisy

What this sample intentionally includes:

- same contained dashboard shell as `01`
- sidebar and profile context retained for realism
- tighter `Runs & Logs` heading and filter row
- KPI strip carried forward
- extended table with running, success, and failed states
- inline retry/error visibility inside the table

What this sample intentionally does not solve yet:

- final bulk actions behavior
- expanded row details
- pagination, sticky headers, or virtualized table behavior
- narrow-layout/mobile dashboard adaptation
- final copy and semantics for every metric

Shared styling:

- this sample uses `../shared.css`
- table-study-specific helpers are appended to the shared stylesheet rather than using a local override file

Review questions:

- does this feel more like a serious operational table than `01`?
- is the row spacing too open, too tight, or about right?
- do inline error/toggle treatments feel clear enough without pills everywhere?
- is the current mix of KPIs plus table still balanced, or should the table dominate even more?
