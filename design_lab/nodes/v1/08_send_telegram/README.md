# 08 Send Telegram

Type: `surface-study`

Purpose:

- create a second concrete notification-style output node in the design lab
- compare a chat-based sink against `send_email` while keeping the same compact
  output-result shell
- test whether a message-first communication node feels distinct enough from
  email and preview output

What this sample is testing:

- a `Notify` role chip
- single left-side input handle
- compact chat target row
- stronger message row as the main content surface
- quiet footer summary for send state
- shared-CSS support for chat-style notification nodes

Reference direction:

- not a direct copy of the supplied reference images
- derived from the shared node grammar and a useful future `send_telegram` node

Still unresolved:

- whether chat-based sinks should use a different icon language from email
- whether `Chat` is the right label versus `Channel` or `Target`
- whether message sinks should expose delivery mode in the compact shell

Shared styling:

- this sample uses `../shared.css`
- it should remain inside the shared node-language system unless a later review
  justifies a local override

Review questions:

- does this feel distinct enough from `Send email` while still belonging to the
  same family?
- is `Chat` the right compact metadata row?
- is message the right primary emphasis for this node?
- is this a strong second concrete notification-style sink?
