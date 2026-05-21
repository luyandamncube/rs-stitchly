# 04 JSON Input

Type: `surface-study`

Purpose:

- create the second `ARC_INPUT_LITERAL` node study in the design lab
- define the structured-value sibling to `text_input`
- keep the shell aligned with `Text input` while making the preview feel more
  data-like and less prose-like

What this sample is testing:

- a compact structured-input header
- a code-like JSON preview row
- a quiet footer summary for key count
- single right-side output handle
- shared-CSS support for structured literal cards

Reference direction:

- not a direct copy of the supplied reference images
- derived from the shared node grammar and the `NODE_IN_JSON` platform need

Still unresolved:

- whether JSON input should stay single-row or gain a second metadata row later
- whether the footer should summarize `keys`, `bytes`, or `schema` instead
- whether structured literal nodes should use slightly denser padding than text
  inputs

Shared styling:

- this sample uses `../shared.css`
- it should remain inside the shared node-language system unless a later review
  justifies a local override

Review questions:

- does this feel like a close sibling to `Text input` without looking identical?
- is the code-style preview legible enough at this density?
- is `3 keys` the right kind of quiet summary for the footer?
- is this a strong base for future structured-literal nodes beyond JSON?
