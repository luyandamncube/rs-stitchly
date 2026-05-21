# 07 Send Email

Type: `surface-study`

Purpose:

- create a concrete notification-style output node in the design lab
- test how a human-facing sink can live inside the shared `ARC_OUTPUT_RESULT`
  family
- keep the card action-oriented while still fitting the same compact node system

What this sample is testing:

- a `Notify` role chip
- single left-side input handle
- compact recipient row
- stronger subject row as the main content surface
- quiet footer summary for send state
- shared-CSS support for notification-style output nodes

Reference direction:

- not a direct copy of the supplied reference images
- derived from the shared node grammar and a useful future `send_email` node

Still unresolved:

- whether notification nodes should use `Notify` or `Output` as the role chip
- whether recipient and subject should stay visible together in the compact shell
- whether send-state nodes should show status, last timestamp, or delivery mode
  in the footer

Shared styling:

- this sample uses `../shared.css`
- it should remain inside the shared node-language system unless a later review
  justifies a local override

Review questions:

- does this feel meaningfully different from `Preview output` while still being
  in the same family?
- is the `Notify` chip a good role marker?
- is subject the right primary emphasis for this node?
- is this a good first concrete notification-style sink?
