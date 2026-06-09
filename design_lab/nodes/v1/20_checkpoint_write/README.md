# 20 Checkpoint Write

Type: `surface-study`

Purpose:

- introduce the first concrete `checkpoint_write` node study for ingest completion
- separate “durable merge succeeded” from “pipeline state may now advance”
- show checkpoint persistence as an explicit success-gated control step

What this sample is testing:

- a compact confirmation card with `Write gate`, `Scope`, and `Commit source`
- a config panel focused on success conditions and persisted resume metadata
- a clearer downstream role after merge and before broader publish or QA steps
- a more conservative control-plane tone than the data movement nodes

Still unresolved:

- whether checkpoint write should emit a downstream control payload or remain terminal
- whether partial-success handling needs its own explicit policy control
- whether per-table checkpointing belongs in this node or in a separate advanced variant
