# 03 Send Email Node Manager

This study turns the generic panel language from `02_node_management_panel` into a real
node-specific manager for `send_email`.

Scope:

- use the agreed V1 `Send Email` settings only
- keep the same right-side overlay pattern from `02`
- test denser text/select/textarea controls instead of the placeholder slider mix
- make the footer about workflow persistence rather than run controls

Settings represented here:

- `Label`
- `To`
- `Subject`
- `Body source`
- `Custom body`
- `Connection`
- `Format`

Reference goals:

- keep the panel in the same dark Stitchly canvas language as `02`
- make the controls feel practical and immediately editable
- show one realistic static variant with `Body source = Custom text`
- establish a concrete pattern we can fork for `04` and `05`

Current choices:

- selected `Send Email` node on the left for context
- node subtitle uses the deterministic node id
- `Format` uses a segmented control instead of a dropdown
- footer focuses on save/persistence context rather than execution

Things to judge:

- should `Body source` stay a dropdown or become a segmented switch too?
- is `Format` better as a two-option segment than a select?
- should `Node ID` stay in the footer or move back into the header/subheader?
- does this feel like the right first real node manager before we implement it?
