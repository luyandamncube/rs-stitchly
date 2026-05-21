# 06 Preview Output

Type: `surface-study`

Purpose:

- create the first `ARC_OUTPUT_RESULT` node study in the design lab
- define the base visual language for human-readable output nodes
- keep the card result-focused rather than making it feel like an input or a
  compute step

What this sample is testing:

- an `Output` role chip
- single left-side input handle
- a compact title row
- a stronger preview/result row
- a quiet footer summary for last emit state
- shared-CSS support for output-result cards

Reference direction:

- not a direct copy of the supplied reference images
- derived from the shared node grammar and the `NODE_OUT_PREVIEW` platform need

Still unresolved:

- whether output nodes should always have a role chip
- whether preview outputs should show more than one preview line
- whether `Last emit` is the right footer summary versus timestamp or status

Shared styling:

- this sample uses `../shared.css`
- it should remain inside the shared node-language system unless a later review
  justifies a local override

Review questions:

- does this feel like an output/result node rather than another input card?
- is the `Title` row useful enough to keep visible in the compact shell?
- does the preview row feel strong enough as the main resolved result surface?
- is this a strong base for other `ARC_OUTPUT_RESULT` nodes later?
