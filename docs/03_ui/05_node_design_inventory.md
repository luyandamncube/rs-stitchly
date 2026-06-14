# 05 Node Design Inventory

## Purpose

Map the Stitchly node taxonomy into a practical UI design backlog.

This doc answers:

- which node types need design coverage
- which node types can share one visual archetype
- which node types are already declared in the foundation docs
- which additional node types are worth considering for the future

This doc is intentionally pre-implementation.
It is the approval surface for deciding which node studies we should build in the design lab.

## How To Use This Doc

Each candidate node has a stable `NODE_*` key.

Use those keys to approve or reject rows, for example:

- `approve: NODE_TRG_SCHEDULE, NODE_CTL_BRANCH, NODE_CMP_API_REQUEST`
- `reject: NODE_SYS_CACHE`

Important:

- approving a node does not always mean a unique new visual design
- many nodes should share one archetype and differ only by content or small variants

## Design Archetypes

These archetypes are the reusable visual patterns we should design once and then apply across multiple node types.

| Archetype Key | Name | Intended Use |
| --- | --- | --- |
| `ARC_TRIGGER_ROLE` | Trigger with role chip | Start-of-flow nodes with a small role chip above the card and one primary schedule/event/manual row |
| `ARC_INPUT_LITERAL` | Literal input | Small input nodes that inject direct values such as text or JSON |
| `ARC_INPUT_REFERENCE` | Reference input | Input nodes that point at external files, tables, datasets, or object-store paths |
| `ARC_COMPUTE_REQUEST` | Request / endpoint compute | HTTP-like request nodes and similar request-driven compute surfaces |
| `ARC_COMPUTE_CODE` | Code / transform compute | Python, Rust, SQL, and generic transform nodes with config + preview/duration structure |
| `ARC_CONTROL_CONDITION` | Conditional branch | Nodes that evaluate a condition and expose multiple labeled outputs |
| `ARC_CONTROL_FLOW` | Flow control | Merge, map, subgraph, and similar control-flow structures |
| `ARC_DATA_MOVEMENT` | Data movement | Extract, load, and materialize nodes that move or persist data between systems |
| `ARC_OUTPUT_RESULT` | Result output | Preview, file, JSON, table, and notification-style result nodes |
| `ARC_SYSTEM_OBSERVE` | Debug / meta observe | Debug and note-style nodes with lower operational weight |
| `ARC_SYSTEM_ASSERT` | Assertions / quality | Quality-check nodes that communicate pass/fail expectations clearly |
| `ARC_SYSTEM_CACHE` | Cache / reuse | Nodes that emphasize reuse, freshness, and cache hits/misses |
| `ARC_HUMAN_GATE` | Human gate | Approval or pause nodes that wait for human action |

## Node Design Inventory

| Node Key | `type_id` | Family | Source | Priority | Archetype | Lab Status | Why It Matters |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `NODE_TRG_MANUAL` | `manual_trigger` | Trigger | Declared | Now | `ARC_TRIGGER_ROLE` | Not started | Needed for simple on-demand workflow starts and local testing flows |
| `NODE_TRG_SCHEDULE` | `schedule_trigger` | Trigger | Declared | Now | `ARC_TRIGGER_ROLE` | `v1` sample exists | Needed for recurring jobs and already useful as the reference trigger study |
| `NODE_TRG_EVENT` | `event_trigger` | Trigger | Declared | Soon | `ARC_TRIGGER_ROLE` | Not started | Needed for webhook and event-driven workflows, but can follow the trigger archetype after manual/schedule |
| `NODE_IN_FILE` | `file_input` | Input | Declared | Now | `ARC_INPUT_REFERENCE` | `v1` sample exists | Core for artifact-based workflows and file-oriented execution |
| `NODE_IN_TEXT` | `text_input` | Input | Declared | Now | `ARC_INPUT_LITERAL` | `v1` sample exists | Already part of the early MVP and useful for simple editor-driven flows |
| `NODE_IN_JSON` | `json_input` | Input | Declared | Now | `ARC_INPUT_LITERAL` | `v1` sample exists | Important for structured control/config payloads without needing a file |
| `NODE_IN_TABLE` | `table_input` | Input | Declared | Now | `ARC_INPUT_REFERENCE` | Not started | Important for dataflow-first workflows and warehouse/table references |
| `NODE_IN_OBJECT_STORE` | `object_store_input` | Input | Declared | Soon | `ARC_INPUT_REFERENCE` | Not started | Useful once staging/object-store workflows become first-class |
| `NODE_CMP_API_REQUEST` | `api_request` | Compute | Proposed | Now | `ARC_COMPUTE_REQUEST` | `v1` sample exists | Missing from the declared taxonomy but highly useful and already a natural fit for the current visual direction |
| `NODE_CMP_PYTHON` | `python_script` | Compute | Declared | Now | `ARC_COMPUTE_CODE` | Not started | Core MVP node for user-defined logic |
| `NODE_CMP_TRANSFORM` | `transform` | Compute | Declared | Now | `ARC_COMPUTE_CODE` | Not started | Good generic transform surface for lightweight built-ins |
| `NODE_CMP_SQL` | `sql_transform` | Compute | Declared | Now | `ARC_COMPUTE_CODE` | `v1` sample exists | Important for warehouse-oriented workflows and engine pushdown |
| `NODE_CMP_RUST_NATIVE` | `rust_native` | Compute | Declared | Soon | `ARC_COMPUTE_CODE` | Not started | Useful for first-class built-in operators once the generic compute archetype is settled |
| `NODE_CMP_ENGINE_WORKLOAD` | `engine_workload` | Compute | Declared | Soon | `ARC_COMPUTE_CODE` | Not started | Needed for adapter-managed engine jobs, but visually can likely follow SQL/code compute with stronger runtime cues |
| `NODE_MOV_EXTRACT` | `extract` | Data Movement | Declared | Soon | `ARC_DATA_MOVEMENT` | Not started | Useful for ingestion-oriented workflows from external systems |
| `NODE_MOV_LOAD` | `load` | Data Movement | Declared | Now | `ARC_DATA_MOVEMENT` | Not started | Important for moving staged data into target systems |
| `NODE_MOV_MATERIALIZE` | `materialize` | Data Movement | Declared | Soon | `ARC_DATA_MOVEMENT` | Not started | Useful for durable intermediate datasets and named tables |
| `NODE_CTL_BRANCH` | `branch` | Control | Declared | Now | `ARC_CONTROL_CONDITION` | `v1` sample exists | Core control node and already represented by the conditional reference study |
| `NODE_CTL_MERGE` | `merge` | Control | Declared | Soon | `ARC_CONTROL_FLOW` | Not started | Important once we have multiple parallel branches to rejoin |
| `NODE_CTL_MAP` | `map` | Control | Declared | Soon | `ARC_CONTROL_FLOW` | Not started | Needed for collection/subgraph repetition flows, but likely after merge |
| `NODE_CTL_APPROVAL_GATE` | `approval_gate` | Control | Proposed | Later | `ARC_HUMAN_GATE` | Not started | Good future workflow primitive for human-in-the-loop orchestration |
| `NODE_CTL_SUBGRAPH` | `subgraph` | Control | Proposed | Later | `ARC_CONTROL_FLOW` | Not started | Useful for encapsulation and reusable workflow blocks once graph composition matures |
| `NODE_OUT_FILE` | `file_output` | Output | Declared | Now | `ARC_OUTPUT_RESULT` | Not started | Core artifact-oriented output surface |
| `NODE_OUT_PREVIEW` | `preview_output` | Output | Declared | Now | `ARC_OUTPUT_RESULT` | `v1` sample exists | Important for fast UI feedback and the current MVP |
| `NODE_OUT_JSON` | `json_output` | Output | Declared | Soon | `ARC_OUTPUT_RESULT` | Not started | Useful for structured downstream consumption or persisted structured results |
| `NODE_OUT_TABLE` | `table_output` | Output | Declared | Now | `ARC_OUTPUT_RESULT` | Not started | Important for dataflow and warehouse-oriented workflows |
| `NODE_OUT_SEND_EMAIL` | `send_email` | Output | Proposed | Soon | `ARC_OUTPUT_RESULT` | `v1` sample exists | Useful concrete notification sink for human-facing workflow alerts and result delivery |
| `NODE_OUT_SEND_TELEGRAM` | `send_telegram` | Output | Proposed | Soon | `ARC_OUTPUT_RESULT` | `v1` sample exists | Useful concrete chat-style notification sink for workflow alerts and operational messaging |
| `NODE_OUT_NOTIFICATION` | `notification` | Output | Proposed | Soon | `ARC_OUTPUT_RESULT` | Not started | Useful future sink for Slack, email, webhook, or alert-style flows |
| `NODE_SYS_CACHE` | `cache` | System | Declared | Soon | `ARC_SYSTEM_CACHE` | Not started | Useful once caching and recomputation semantics become visible in the UI |
| `NODE_SYS_QUALITY_CHECK` | `quality_check` | System | Declared | Soon | `ARC_SYSTEM_ASSERT` | Not started | Important for data quality, expectations, and assertions |
| `NODE_SYS_DEBUG` | `debug` | System | Declared | Now | `ARC_SYSTEM_OBSERVE` | Not started | Helpful for observability and troubleshooting without leaving the canvas |
| `NODE_SYS_NOTE` | `note` | System | Declared | Now | `ARC_SYSTEM_OBSERVE` | Not started | Useful for human-readable graph annotation and product onboarding |

## Recommended First Approval Pass

If we want a practical first design batch rather than the full inventory, the strongest initial set is:

- `NODE_TRG_MANUAL`
- `NODE_TRG_SCHEDULE`
- `NODE_IN_TEXT`
- `NODE_IN_JSON`
- `NODE_IN_TABLE`
- `NODE_CMP_API_REQUEST`
- `NODE_CMP_PYTHON`
- `NODE_CMP_SQL`
- `NODE_CMP_TRANSFORM`
- `NODE_MOV_LOAD`
- `NODE_CTL_BRANCH`
- `NODE_OUT_PREVIEW`
- `NODE_OUT_FILE`
- `NODE_OUT_TABLE`
- `NODE_SYS_DEBUG`
- `NODE_SYS_NOTE`

This would let us establish:

- trigger language
- input language
- compute language
- conditional/control language
- output language
- low-weight system/meta language

without trying to solve every future node at once.

## Notes

- `api_request` is intentionally listed as `Proposed` because it is not currently declared in [docs/00_foundation/01_node_types.md](../00_foundation/01_node_types.md), even though it appears highly useful and already has a strong initial design study.
- `send_email`, `send_telegram`, `notification`, `approval_gate`, and `subgraph` are also listed as `Proposed` future additions, not current declared requirements.
- `send_email` and `send_telegram` are intentionally listed separately from `notification` because they are useful concrete sinks to design and reason about, even if the eventual product model later groups email, chat, webhook, and similar channels under a broader notification family.
- `branch` maps directly to the current `conditional` sample language. The product-facing label can remain `Conditional` even if the stable `type_id` stays `branch`.
- We should generally create one design-lab study per archetype or important variant, not one fully custom design per node row in this table.
