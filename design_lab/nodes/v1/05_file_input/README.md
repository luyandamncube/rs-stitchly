# 05 File Input

Type: `surface-study`

Purpose:

- create the first `ARC_INPUT_REFERENCE` node study in the design lab
- define the base visual language for nodes that point at artifact references
  instead of inline values
- keep the card filename-first and avoid making it feel like a content preview

What this sample is testing:

- a compact reference-input header
- one primary filename row with truncation
- a quiet footer metric for file size
- single right-side output handle
- shared-CSS support for reference-input cards

Reference direction:

- not a direct copy of the supplied reference images
- derived from the shared node grammar and the `NODE_IN_FILE` platform need

Still unresolved:

- whether file reference nodes need a second inline metadata row for type or
  source
- whether the footer should summarize `size`, `rows`, or `lifecycle`
- whether file and object-store inputs should share the exact same shell

Shared styling:

- this sample uses `../shared.css`
- it should remain inside the shared node-language system unless a later review
  justifies a local override

Review questions:

- does this feel distinct from literal inputs while still living in the same
  overall node system?
- is filename-first the right primary emphasis for a file reference?
- is `24.6 MB` the right quiet footer summary?
- is this a strong base for `object_store_input` later?
