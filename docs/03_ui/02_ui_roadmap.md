# 02 UI Roadmap

## Purpose

Provide a phased roadmap for building the Stitchly frontend UI in a deliberate, testable way.

This doc is meant to answer:

- which UI layers come next
- why they are sequenced this way
- how new UI elements should be introduced and validated

## Delivery Method

The preferred method for new UI elements is:

1. define the element and its states
2. build a minimal sandbox or harness when interaction is uncertain
3. add visual and interaction tests
4. verify multi-element behavior if relevant
5. integrate the proven element into the real shell or node system
6. keep debug visibility until the element is stable

This approach is now proven by the sandbox-first node state work in `WorkflowCanvas.jsx`.

## Phase 0: State Sandbox Foundation

Status: complete first pass

Purpose:

- prove the node state model before reintegrating with real nodes

Includes:

- interaction states
- connection states
- validation states
- runtime states
- debug panel controls
- per-state tests

Outcome:

- a trusted reference implementation for future UI behavior

## Phase 1: Real Node Surface

Purpose:

- rebuild the real node card on top of the proven state system

Includes:

- node shell
- top chip
- header row
- icon slot
- title
- overflow affordance
- body rows
- footer row
- integrated handles
- full state styling on the real node card

Suggested sub-phases:

- `1A`: node shell and card frame
- `1B`: header, chip, and icon
- `1C`: body rows and footer
- `1D`: integrated handles
- `1E`: convert sandbox card behavior into real nodes

## Phase 2: Edge And Connection System

Purpose:

- make connections feel as intentional as the nodes

Includes:

- lava-colored default edges
- edge hover state
- edge selection state
- connection preview line
- valid and invalid connection feedback
- source and target handle animation
- branch or split edge treatment later

## Phase 3: Canvas Interaction Layer

Purpose:

- make the workspace feel predictable and fast

Includes:

- pan rules
- zoom rules
- select and unselect behavior
- keyboard focus flow
- drag placement behavior
- alignment or snapping helpers later
- multi-select later
- marquee selection later
- viewport controls

## Phase 4: Canvas UI Chrome

Purpose:

- bring back product shell pieces in a controlled way

Includes:

- left rail
- drawer
- floating card
- section switching
- shell open and close motion
- lightweight search entry
- contextual card open states

## Phase 5: Node Inspector And Editing Surfaces

Purpose:

- make nodes editable without crowding the canvas

Includes:

- floating node inspector
- label editing
- structured config fields
- JSON fallback editor
- validation messages in context
- apply, reset, and save behavior

## Phase 6: Run And Validation Surfaces

Purpose:

- connect the UI to workflow execution truth

Includes:

- run control card
- run detail card
- validation issues surface
- node-level live runtime mapping
- event and log views
- problem-to-node focus flow

## Phase 7: Creation Workflows

Purpose:

- let users create and expand graphs comfortably

Includes:

- node library drawer
- add-node actions
- drag-to-add or click-to-add node creation
- contextual insert actions
- duplicate flow
- delete flow

## Phase 8: Polish And Product Feel

Purpose:

- turn the editor from correct into polished

Includes:

- motion tuning
- spacing and density tuning
- typography refinement
- empty states
- loading states
- keyboard shortcuts
- accessibility pass
- responsive behavior

## Recommended Build Order

Implement UI work in this order:

1. `Phase 1: Real Node Surface`
2. `Phase 2: Edge And Connection System`
3. `Phase 3: Canvas Interaction Layer`
4. `Phase 4: Canvas UI Chrome`
5. `Phase 5: Node Inspector And Editing Surfaces`
6. `Phase 6: Run And Validation Surfaces`
7. `Phase 7: Creation Workflows`
8. `Phase 8: Polish And Product Feel`

## Recommended Next Step

The strongest next implementation phase is `Phase 1: Real Node Surface`.

Reason:

- the node state model is already proven
- the current sandbox should now be turned into a real visual node surface
- this unlocks better progress on edges, inspector work, and eventual React Flow reintegration

## Relationship To Other Docs

- `03_ui/00_frontend_canvas.md` defines the broader canvas shell and visual direction
- `03_ui/01_node_state_model.md` defines the state model that this roadmap assumes
- `00_foundation/15_node_definition_spec.md` defines the shared node metadata and card contract
