# 03 Text Input

Type: `surface-study`

Purpose:

- create the first `ARC_INPUT_LITERAL` node study in the design lab
- define the base visual language for literal-value inputs such as `text_input`
  and later `json_input`
- keep the node compact and content-first instead of treating it like a trigger
  or compute card

What this sample is testing:

- a quiet input header without a role chip
- one compact preview-first text body
- a small footer summary row for type + length
- single right-side output handle
- shared-CSS support for literal input cards

Reference direction:

- not a direct copy of the supplied reference images
- derived from the shared node grammar plus the `NODE_IN_TEXT` product need

Still unresolved:

- whether literal input nodes should ever show an `Input` or `Start` chip
- whether longer text should clamp to two lines or expand more generously
- whether `json_input` should stay in the exact same shell or use a denser
  preview pattern

Shared styling:

- this sample uses `../shared.css`
- it should remain inside the shared node-language system unless a later review
  justifies a local override

Review questions:

- does this feel distinct enough from trigger and compute nodes?
- is the text preview the right primary content choice?
- does the footer summary feel sufficient, or should literal inputs expose one
  more inline metadata row?
- does this now feel visually aligned enough with the newer `Send Email`
  compact shell direction?
- is this a strong base for `json_input` later?
