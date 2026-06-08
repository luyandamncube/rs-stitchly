# 14 Dolt Change Manifest

Type: `surface-study`

Purpose:

- create the first concrete `dolt_change_manifest` node study in the design lab
- define how table-aware Dolt change detection should read before export and
  load nodes exist in the real app
- review the compact manifest card together with its config panel

What this sample is testing:

- a compact manifest card for a two-commit comparison
- a summary shell centered on `Range`, `Changed tables`, and `Schema drift`
- a config panel focused on commit range, table scope, and schema-change
  detection
- a clear boundary between manifest creation and file export

Still unresolved:

- whether row-change counts should always be part of the manifest or optional
- whether table scope belongs in the base panel or should wait for advanced
  filtering
- how much schema-drift detail belongs on the card itself

