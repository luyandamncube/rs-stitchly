# 00 Frontend Canvas

## Purpose

Document the responsibilities, shell model, visual direction, and interaction rules of the Stitchly workflow editor.

## Frontend Responsibilities

- render the workflow graph
- allow users to create, connect, position, and configure nodes
- enforce basic connection and schema rules in the UI
- show run status, logs, and outputs returned by the backend
- serialize workflow edits into the canonical workflow format
- support component and end-to-end tests using shared workflow fixtures

## Frontend Non-Responsibilities

- executing nodes
- storing secrets used for runtime execution
- deciding scheduling behavior
- managing compute resources

## Core UX Direction

- Use React Flow as the graph interaction layer.
- Keep node rendering schema-driven where possible.
- Avoid leaking execution implementation details into editor state.
- Prefer generated or shared contract types over hand-maintained duplicate models.
- Default to a dark-mode-only editor in the first product slice.
- Treat the canvas as the primary product surface, not as a card inside a dashboard page.
- Keep workflow chrome lightweight and collapsible so the graph stays visible.
- Prefer high-performance interaction and low-noise motion over decorative UI.

## Current Implementation Note

As of `2026-05-20`, node-state behavior is being validated in a sandbox-first canvas implementation before being pushed back into final workflow nodes.

Current reality:

- React Flow is temporarily acting as the canvas shell
- standalone sandbox elements sit above the canvas for node-state testing
- this is deliberate and temporary

Reason:

- custom-node hover and interaction behavior became unreliable while the shell was still changing
- the sandbox approach lets us prove interaction, connection, validation, and runtime states one at a time
- once stable, the proven state model can be migrated back into real node components with less ambiguity

## Shell Model

The frontend should move toward a canvas-first shell with overlay chrome.

The intended default experience is:

- the workflow canvas fills the screen
- a slim left rail remains visible for global navigation
- a drawer opens from the rail for section-level navigation and actions
- a floating card opens beside the drawer for contextual detail
- the header, inspector, and control pane do not stay permanently visible on the main surface

This is a deliberate change from a dashboard-like page layout.

The product should feel like:

- dark mode
- infinite canvas
- high performance
- compact overlay controls

## Visual Direction

### Palette

Initial palette:

- background: `#0B0B0D`
- surface: `#17171C`
- elevated: `#222229`
- muted grey: `#7A7A85`
- primary accent: `#F56E0F`
- secondary accent: `#FF7A1A`
- text: `#FFFFFF`

### Styling Principles

- keep the base interface grayscale and high contrast
- use orange as the main energy source for active and primary states
- avoid cool accent colors in the default shell
- use soft borders, restrained shadows, and rounded surfaces
- prefer minimal visual noise so the canvas remains the hero

The intended vibe is:

- ultra clean
- bold
- high contrast
- minimal
- close to a premium developer tool rather than a dashboard

## Node Visual Direction

The node design should feel like a compact operational card rather than a generic schema box.

The visual reference direction is:

- compact workflow appliance card
- structured content rows
- strong header row with icon and title
- precise edge anchors
- restrained internal spacing
- minimal descriptive noise

We should preserve this structure while keeping the Stitchly shell palette.

### Node Anatomy

The default node anatomy should have four layers:

1. optional top chip
2. header row
3. structured body rows
4. low-emphasis footer row

#### Optional Top Chip

Use for roles such as:

- start
- branch
- output
- live later if needed

This is especially useful for trigger and terminal nodes.

#### Header Row

The header should contain:

- left icon
- primary node title
- overflow menu on the right

The header should not use the old stacked category-over-title pattern as the main node identity.

#### Body Rows

The body should be made of one to three compact rounded rows or row groups.

These rows should carry the useful operational content such as:

- cadence
- condition
- method
- endpoint
- last run
- output preview
- duration

Prefer structured rows over paragraph-style descriptions inside the node.

#### Footer Row

The footer should carry one quiet metric or status summary such as:

- duration
- last status
- last emit
- executor later if useful

### Typography Inside Nodes

Node card typography should be calmer and denser than the shell chrome.

Direction:

- medium or semibold title
- small muted labels
- slightly stronger values
- tight line-height
- minimal use of large display styling

Even if the broader app keeps its current font stack, node internals should feel product-like and operational rather than editorial.

### Spacing And Layout

The node layout should favor:

- wider-than-tall cards
- consistent outer padding
- disciplined row spacing
- compact content rhythm
- rounded inset rows

Avoid:

- large unused vertical space
- long descriptive text blocks
- visually noisy chip collections as the default content model

### Edge Direction

Edges should use the app palette and be lava colored by default.

Direction:

- smooth rounded connectors
- confident stroke weight
- muted lava by default
- hotter lava on hover or selection
- optional soft glow for active or selected states

Do not default to cool accent edges.

### Handle Direction

Handles should feel integrated into the node card rather than bolted onto it.

Direction:

- small circular handles
- visually attached to the card edge
- aligned to meaningful row positions when possible
- fewer always-visible text labels

Port labels should not dominate the node body.

### Content Model Direction

Nodes should stop looking like abstract schema blocks and instead look like live workflow units.

That means the default node body should favor:

- key-value rows
- compact previews
- metric summaries
- branch or state summaries later

instead of:

- long freeform descriptions
- category headers as a main visual element
- generic port pill grids as the primary content

## Navigation Model

The first refined navigation shell should use:

1. left rail
2. drawer
3. floating card

### Left Rail

The rail is always visible and should contain only global navigation.

Recommended sections:

- canvas
- nodes
- runs
- problems
- search
- settings

The rail should stay compact, icon-first, and low-noise.

### Drawer

The drawer should open from the rail and present section-level navigation, lists, and quick actions.

Recommended drawer responsibilities:

- section switching
- search within the active section
- lists such as node library, recent runs, or validation issues
- quick workflow actions
- lightweight metadata and summaries

The drawer should not become a permanent full inspector.

### Floating Card

The floating card should appear beside the drawer and show focused detail for the currently selected object.

The floating card should:

- open contextually from the drawer or the canvas
- show one primary focused state at a time
- feel attached to the active selection, not like a second sidebar
- stay compact enough to preserve canvas visibility

## Drawer Content Direction

Recommended section contents:

### Canvas

- workflow name and summary
- reset or quick workflow actions
- viewport actions such as zoom-to-fit later
- recent workflow-level actions or metadata

### Nodes

- node library grouped by family
- node search
- drag or add actions
- lightweight node metadata

### Runs

- validate workflow
- run workflow
- latest run status
- recent runs
- entry points into logs or event detail

### Problems

- validation errors
- validation warnings later
- quick focus actions that jump to a node or edge on the canvas

### Search

- command-style search
- jump to nodes, runs, problems, and later connections

### Settings

- environment info
- backend connectivity info
- shortcuts
- future project-level settings

## Floating Card States

The first refined UI should likely support these content states:

### Node Inspector

Open when a node is selected.

Should show:

- node name
- node type
- node status when available
- key config fields
- ports
- advanced JSON section later or behind a toggle

### Run Control

Open from the runs drawer.

Should show:

- validate action
- run action
- latest run status
- recent lifecycle summary

### Run Detail

Open when a run or node-run is selected.

Should show:

- run status
- node states
- recent logs
- recent events

### Problem Detail

Open when a validation issue is selected.

Should show:

- issue summary
- affected node or edge
- likely fix context
- focus-on-canvas action

## Floating Card Behavior

Initial interaction direction:

- hidden by default
- opened by canvas or drawer selection
- one active floating card at a time
- easy to close
- positioned as an overlapping elevated layer beside the drawer

Possible later behavior:

- pin card open
- swap card content without closing the shell
- expanded mode for dense inspector or log content

## Performance Direction

The UI should feel fast even as workflows grow.

That means:

- keep the canvas as the dominant always-mounted surface
- keep rail, drawer, and floating card lightweight
- avoid expensive always-on visual effects
- prefer subtle motion over large animated layout shifts
- avoid rerendering the full graph when chrome state changes if possible
- treat large lists such as logs and runs as candidates for virtualization later
- keep node cards visually rich but structurally consistent so rendering remains predictable

High performance is a product requirement, not just an implementation detail.

## Current Implementation Gap

The current first-pass UI may temporarily expose a visible header and always-on side panels while the product is being built.

That implementation is acceptable as scaffolding, but it is not the intended steady-state shell.

The long-term direction described here should guide the next UI refinement passes.

## Open Questions

- Which validations should happen optimistically in the UI versus only in the backend?
- How much run inspection belongs inside the floating card versus directly on the canvas?
- Do custom nodes define their own inspector UI, or do we generate most of it?
- How do we keep component tests fast while still exercising realistic workflow fixtures?
- When do we add pinning or expanded states to the floating card?
