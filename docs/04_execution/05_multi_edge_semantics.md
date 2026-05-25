# 05 Multi-Edge Semantics

## Purpose

Define how the workflow graph should behave when one node or one port connects to multiple edges.

This doc answers:

- what fan-out means in v1
- what is allowed today
- what is intentionally deferred
- how node types should document their edge participation rules

## V1 Global Direction

### Supported In V1

V1 should support outbound fan-out.

That means:

- one output port may feed many downstream target ports

Example:

- `input_text.text -> send_email_a.body`
- `input_text.text -> send_email_b.body`

Runtime expectation:

- upstream node executes once
- output is stored once
- all downstream edges resolve from that same stored output

### Not Supported Yet

V1 does **not** need inbound multi-input merge behavior yet.

That means:

- one target input port should still resolve to one final `TypedValue`
- merge, list-aggregation, and fan-in semantics are deferred

So for now:

- fan-out yes
- fan-in no

### Target-Port Rule

For v1, a target input port should still behave as single-valued.

If a future node needs multi-input semantics, we should add that deliberately with:

- a stronger runtime contract
- explicit collection semantics
- UI and validation support

## Why This Matters

We do not need multi-input support in order to build useful workflows now.

We do need outbound fan-out because many practical workflows will want:

- one source to feed multiple notifications
- one transform to feed multiple sinks
- one conditional branch output to feed multiple downstream steps later

## Running Multi-Edge Semantics Table

| Node type | Inbound rule | Outbound rule | V1 multi-edge participation |
| --- | --- | --- | --- |
| `text_input` | no inbound edges expected | one output may fan out to many downstream targets | fully compatible with outbound fan-out |
| `text_transform` | one value per input port | one output may fan out to many downstream targets | transform output may be reused by multiple downstream nodes |
| `preview_output` | one value per input port | no outputs | terminal sink; no outbound fan-out |
| `send_email` | one optional value for `body` | no outputs | terminal sink; consumes one resolved body value only |

## Notes By Node

### Source And Transform Nodes

Source and transform nodes are the primary participants in v1 fan-out.

They should be treated as:

- execute once
- share result across all downstream consumers

### Sink Nodes

Sink nodes such as `send_email` and `preview_output` do not participate in outbound fan-out because they emit no graph outputs.

## Future Expansion

When we eventually implement inbound multi-input support, this doc should grow to define:

- collection-shaped inputs
- ordering semantics
- deduplication semantics
- merge-node behavior
- validation rules for `multiple: true`

Until then, this doc should remain strict and simple:

- outbound fan-out is supported
- inbound merge semantics are deferred
