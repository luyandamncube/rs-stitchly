# 04 Text Input Node Manager

This study carries the real node-manager direction from `03_send_email_node_manager`
into a `text_input`-specific panel.

Scope:

- keep the same canvas shell and right-side overlay footprint as `03`
- test a text-first settings panel instead of a delivery/settings panel
- establish the first literal-input manager pattern before implementation
- keep the footer about persistence rather than execution

Settings represented here:

- `Label`
- `Text`
- `Trim mode`
- `Preserve whitespace`
- `Include line breaks`

Reference goals:

- make the panel feel like the same family as `03`, not a different subsystem
- let the main editable text dominate the panel without making it feel oversized
- keep the control count low and practical for a simple literal input node
- preserve the sharper, darker Stitchly canvas language

Current choices:

- selected `Text Input` node on the left for context
- node subtitle uses the deterministic node id
- `Trim mode` stays a dropdown-style control for now
- footer uses `Length` instead of a run/execution metric

Things to judge:

- is `Trim mode` necessary in V1, or should the panel stay text-only?
- should `Preserve whitespace` and `Include line breaks` stay as two toggles or
  collapse into one formatting mode control?
- is character count the right footer summary, or should that move higher?
- does this feel like the right sibling to the `Send Email` manager?
