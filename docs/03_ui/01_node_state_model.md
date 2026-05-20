# 01 Node State Model

## Purpose

Define the UI state model for workflow nodes so interaction and visual feedback stay consistent as the canvas grows richer.

This doc focuses on frontend behavior and presentation.
Execution truth still comes from backend run snapshots and run events.

## Why This Exists

The node card is no longer a static schema box.
It should behave like a live workflow unit that acknowledges:

- pointer hover
- selection
- dragging
- connection intent
- validation issues
- runtime progress

Without a shared state model, the node UI becomes inconsistent and hard to test.

## Modeling Rule

Do not model node awareness as one giant enum such as:

- `hovered-selected-running-warning`

Instead, model node awareness as a small set of orthogonal layers:

1. interaction state
2. connection state
3. validation state
4. runtime state

A node can combine states across layers.
For example, a node may be:

- `hover + warning`
- `selected + running`
- `selected + connect-target-valid`

## Layer 1: Interaction State

This layer answers how the user is currently engaging with the node.

### States

- `idle`
- `hover`
- `selected`
- `dragging`
- `focused`
- `pressed`

### Definitions

#### `idle`

Default resting node state.

#### `hover`

Pointer is over the node and the node should acknowledge it.

#### `selected`

The node is the current active canvas selection.

#### `dragging`

The node is actively being repositioned on the canvas.

#### `focused`

Keyboard focus is on the node, independent of pointer hover.

#### `pressed`

Short-lived pointer-down state before the action resolves into click or drag.

### Visual Direction

- `idle`: quiet border, baseline elevation
- `hover`: subtle lift, slightly brighter border, slightly brighter inset rows
- `selected`: stronger lava emphasis, clearest active ring or outline
- `dragging`: increased elevation, motion confidence, `grabbing` cursor
- `focused`: accessible focus ring distinct from hover
- `pressed`: slightly compressed or tightened response, very short-lived

### Notes

- Hover should communicate awareness without looking selected.
- Selection should remain visible after the pointer leaves the node.
- Dragging should inherit selection.

## Layer 2: Connection State

This layer answers how the node participates in an in-progress edge creation flow.

### States

- `none`
- `connect-source-active`
- `connect-target-valid`
- `connect-target-invalid`
- `connect-preview`

### Definitions

#### `none`

No connection gesture currently involves the node.

#### `connect-source-active`

The user is dragging a new connection from this node.

#### `connect-target-valid`

The user is hovering a compatible target on this node during a connect gesture.

#### `connect-target-invalid`

The user is hovering an incompatible target on this node during a connect gesture.

#### `connect-preview`

Temporary candidate state while the user is approaching a possible target.

### Visual Direction

- `connect-source-active`: active lava handle and slightly energized edge origin
- `connect-target-valid`: positive acceptance cue using lava emphasis, not a separate color family
- `connect-target-invalid`: restrained reject cue that is still visible against the dark palette
- `connect-preview`: soft pre-activation hint without implying success yet

### Notes

- Keep handle awareness precise and local.
- Avoid turning the whole card into a loud error state for a brief invalid hover.

## Layer 3: Validation State

This layer answers whether the node definition or current configuration is structurally ready.

### States

- `valid`
- `warning`
- `error`

### Definitions

#### `valid`

No current schema or configuration issues.

#### `warning`

The node is usable but deserves attention.

#### `error`

The node is incomplete, invalid, or blocked from successful planning or execution.

### Visual Direction

- `valid`: no extra treatment beyond base styling
- `warning`: soft caution signal, likely using amber or lava-adjacent emphasis
- `error`: the strongest non-selected alert treatment, visible in both card and handle regions

### Notes

- Validation state should persist until the underlying issue is resolved.
- Validation state should not be confused with transient connection hover.

## Layer 4: Runtime State

This layer answers what happened during the latest run or what is happening right now.

### States

- `idle`
- `queued`
- `running`
- `succeeded`
- `failed`
- `skipped`

### Definitions

#### `idle`

No active run is touching the node right now.

#### `queued`

The node is ready and waiting to execute.

#### `running`

The node is actively executing.

#### `succeeded`

The most recent execution completed successfully.

#### `failed`

The most recent execution failed.

#### `skipped`

The node was intentionally bypassed during the latest run.

### Visual Direction

- `idle`: quiet
- `queued`: low-intensity active hint
- `running`: most animated or energized state, especially in handles or edges
- `succeeded`: quiet success confirmation
- `failed`: clear failure emphasis
- `skipped`: visibly de-emphasized but still readable

### Notes

- Runtime state should come from backend run snapshots and event streams.
- The frontend should not invent execution truth locally.

## Combination Rules

### Layering Strategy

Interaction, connection, validation, and runtime states should combine.

Recommended precedence for strongest visible emphasis:

1. `dragging`
2. `selected`
3. `connect-target-valid` or `connect-target-invalid`
4. `error`
5. `warning`
6. `running`
7. `hover`

This does not mean lower-priority states disappear.
It means the most prominent outline or elevation treatment should come from the highest-priority active layer.

### Practical Examples

- `selected + warning`
  The node remains clearly selected, with a secondary warning signal.

- `hover + error`
  Hover should brighten the card slightly, but the error treatment stays visible.

- `selected + running`
  Selected state owns the main outline while runtime activity shows in subtler live accents.

- `dragging + selected`
  Dragging should dominate the elevation and cursor treatment while keeping the selected identity.

## Initial Implementation Order

Implement the first pass in this order:

1. `hover`
2. `selected`
3. `dragging`
4. `connect-target-valid`
5. `connect-target-invalid`
6. `error`
7. `warning`
8. `running`
9. `succeeded`
10. `failed`

This order gives the biggest interaction payoff first and keeps testing scope manageable.

## Testing Expectations

Each state should eventually have:

- a small unit test for the state-to-class or state-to-style mapping
- a component test covering the visible UI response
- an interaction test if the state is triggered by pointer or keyboard behavior

Recommended early test coverage:

- hover applies a visible node awareness class
- selecting a node applies the selected class
- clicking empty canvas clears selection
- dragging a node applies the dragging class
- valid and invalid connect targets apply different handle or card treatments
- validation errors override base idle styling
- runtime running state is reflected from run snapshot or event data

## Implementation Status

As of `2026-05-20`, the first full pass of this state model is implemented in a sandbox harness in `apps/web/src/components/WorkflowCanvas.jsx`.

This harness is intentionally not the final React Flow node renderer.
It uses two standalone sandbox elements layered over the canvas so state behavior can be validated without React Flow custom-node lifecycle issues obscuring the interaction model.

### Implemented In Sandbox

#### Interaction Layer

- `idle` as the base state
- `hover`
- `selected`
- `dragging`
- `focused`
- `pressed`

#### Connection Layer

- `none` as the base state
- `connect-source-active`
- `connect-target-valid`
- `connect-target-invalid`
- `connect-preview`

#### Validation Layer

- `valid` as the base state
- `warning`
- `error`

#### Runtime Layer

- `idle` as the base state
- `queued`
- `running`
- `succeeded`
- `failed`
- `skipped`

### Verified So Far

- each implemented state has a sandbox-level interaction or attribute test
- the debug panel can inspect active sandbox state live on the canvas
- validation and runtime overrides are scoped to the selected sandbox node
- the two-node sandbox supports exclusive selection and real valid/invalid connection gestures

### Not Integrated Yet

- the sandbox state model is not yet wired back into real workflow nodes
- React Flow is currently acting as the canvas shell, not the final node interaction owner
- validation state is not yet driven by real workflow validation results
- runtime state is not yet driven by backend run snapshots or streamed node events
- the richer node-card presentation needs to be rebuilt on top of this proven state system

### Recommended Next Step

Move from sandbox elements to a reusable real node component while preserving:

- the verified interaction behavior
- the tested state layering rules
- the selected-node scoping for validation and runtime state
- the existing debug visibility during reintegration

## Relationship To Other Docs

- `03_ui/00_frontend_canvas.md` defines the broader canvas shell and node design direction
- `00_foundation/15_node_definition_spec.md` defines the shared node contract, including `ui.node_card`
- `00_foundation/18_run_lifecycle_and_events.md` defines backend run and node lifecycle truth
