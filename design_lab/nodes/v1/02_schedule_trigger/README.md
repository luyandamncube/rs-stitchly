# 02 Schedule Trigger

Type: `surface-study`

Purpose:

- modernize the original `schedule_trigger` study so it matches the newer Dolt-era node shell
- treat schedule as an operational control surface rather than just a starter chip
- show how recurring run windows feed downstream checkpoint-aware ingest flows

What this sample is testing:

- a compact trigger card with `Cadence`, `Timezone`, and `Next fire`
- a config panel focused on catch-up policy, dedupe, and emitted run-window metadata
- a clearer downstream handoff into `checkpoint_read`
- a more operator-facing tone for recurring workflow orchestration

Still unresolved:

- whether cron and interval modes should share one field or split into separate layouts
- whether missed-window handling belongs in the main config or an advanced section
- whether run dedupe should be visualized as a protection badge on the node card
