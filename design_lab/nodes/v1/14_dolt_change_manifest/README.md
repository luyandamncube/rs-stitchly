# 14 Dolt Change Manifest

Type: `surface-study`

Purpose:

- create the first concrete `dolt_change_manifest` node study in the design lab
- define how table-aware Dolt change detection should read before export and
  load nodes exist in the real app
- review the compact manifest card together with its config panel

What this sample is testing:

- a compact manifest card for a two-commit comparison
- a summary shell centered on `Range`, `Scope`, and `Schema drift`
- a config panel focused on read-only upstream range, table scope, and
  schema-change policy
- a clear boundary between manifest creation and file export

Still unresolved:

- whether table scope needs only `all_tables` vs allowlist in the first app cut
- how much schema-drift detail belongs on the card itself
- whether the output should be a dedicated `change_manifest_ref` type or a
  dataset ref with manifest metadata attached
