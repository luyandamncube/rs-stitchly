# 03 Node Reference Analysis

## Purpose

Analyze the sample node reference images in detail so Stitchly can adopt the same design language intentionally, rather than approximating it ad hoc.

This doc is about:

- the visual grammar of the sample nodes
- the spacing and hierarchy rules that make them feel clean
- the practical product implications for Stitchly

This doc is not yet the final Stitchly node spec.
It is the reference-analysis step that should inform that later work.

## Scope

The reference images show a compact workflow-node system with:

- a trigger-style node with a top chip
- a condition-style node with multiple outputs
- simple black connector lines
- a light canvas with dotted grid

Stitchly should preserve the structural language while adapting it into:

- the dark `True Black + Lava Core` palette
- the node types and data needs of the Stitchly platform

## First Impression

The sample nodes feel:

- calm
- dense
- highly legible
- structured
- operational rather than decorative

They do not feel like generic dashboard cards.
They feel like purpose-built workflow appliances.

The biggest reason this works is discipline:

- very few visual primitives
- very clear hierarchy
- consistent spacing
- almost no decorative clutter

## Core Design Grammar

The reference uses a small set of recurring building blocks:

1. a rounded outer card
2. an optional small chip above the card
3. a compact header row
4. one or more inner rounded data rows
5. minimal handles attached to the sides
6. restrained edges with clear routing

This grammar repeats across different node types without changing the overall layout language.

## Anatomy Breakdown

### 1. Top Chip

The top chip appears on the trigger-style node as `Start`.

What it does:

- communicates node role, not node type
- sits outside the card
- gives the card a higher-level semantic category

Important traits:

- small pill
- short text
- slightly separated from the main card
- visually lighter than the card itself

Practical implication for Stitchly:

- use this for role markers such as `Start`, `Branch`, `Output`, `Live`
- do not use it for every node
- keep it role-oriented, not type-oriented

### 2. Header Row

The header row is the main identity area of the node.

It contains:

- left icon
- node title
- overflow dots on the right

Important traits:

- icon and title are tightly grouped
- title is the most visually prominent text in the card
- overflow action is visually present but very quiet
- the row is short and compact

Practical implication for Stitchly:

- the node type or instance label should live here
- the category should not become a second headline above the title
- the header should remain one row, not become a stacked mini-layout

### 3. Inner Data Rows

These are the most important visual structure in the sample.

There are two different row behaviors:

- a compact pill-like row for primary key-value content
- a larger grouped panel for secondary or multi-line content

Examples in the sample:

- `Cadence | Every 5 min`
- `Condition | order_total > 100`
- a grouped `Last run` section containing multiple lines
- `Duration | 0.8s`

Important traits:

- data rows are inset from the outer card
- each row is rounded
- rows have their own surface, separate from the card shell
- rows are visually stronger than the footer label text

Practical implication for Stitchly:

- row groups should be the main content primitive
- paragraphs and raw text blocks should be rare
- most node content should become one of:
  - single key-value row
  - grouped stats row
  - compact preview row

### 4. Footer-Like Metric Row

The sample often ends with a smaller row carrying a quiet metric like `Duration`.

Important traits:

- lower emphasis than the header
- still presented inside a rounded inset surface
- aligned exactly to the rest of the card grid

Practical implication for Stitchly:

- use the final row for duration, last status, last emit, or similar quiet signals
- do not let this row compete with the primary content row

## Hierarchy Rules

The reference hierarchy is very clear:

1. node title
2. primary row value
3. grouped content values
4. row labels
5. chip text
6. overflow/menu glyphs

Notably:

- the title is bold and anchors the whole card
- labels are softer and lighter
- values are dark, strong, and easy to scan
- supporting labels do not fight for attention

Practical implication for Stitchly:

- use stronger weight for values than for labels
- keep labels muted
- avoid multiple competing title styles inside the same node

## Spacing Analysis

The sample is effective largely because of spacing discipline.

### Outer Card

Traits:

- generous corner radius
- moderate outer padding
- no wasted vertical space
- wider-than-tall default proportion

Practical implication:

- default nodes should feel horizontally composed
- do not make the shell too tall by default

### Header Spacing

Traits:

- compact vertical height
- small gap between icon and title
- even left/right padding

Practical implication:

- the header should not feel like a toolbar
- the icon must be close enough to the title to read as one unit

### Row Spacing

Traits:

- small, consistent gap between inner rows
- grouped sections are visually unified
- rows do not float randomly inside the card

Practical implication:

- use one spacing scale and repeat it
- avoid uneven gaps between different row types

### Chip Spacing

Traits:

- visible separation between top chip and card
- small enough to feel attached
- large enough to avoid touching

Practical implication:

- the chip should never look glued to the shell
- the chip should never drift so far that it feels unrelated

## Typography Analysis

The sample typography is:

- clean
- product-like
- neutral
- compact

The title is:

- semibold or bold
- large enough to lead
- not oversized

The labels are:

- smaller
- lighter
- quieter

The values are:

- strong
- legible
- often right-aligned in key-value rows

Practical implication for Stitchly:

- node typography should stay operational, not expressive
- dramatic display typography belongs to shell branding, not node internals

## Iconography Analysis

The sample icons are:

- tiny
- line-like
- functional
- visually subordinate to the title

Important trait:

- the left icon is not inside a prominent badge or colored block
- it behaves more like a small inline symbol than a decorative emblem

Practical implication for Stitchly:

- the current sandbox icon boxes are too heavy compared with the sample
- eventual node icons should be lighter, smaller, and more inline
- the node type should still be recognized, but the title should remain primary

## Surface Treatment

The sample nodes are not glassmorphic.

They feel:

- opaque
- soft
- clean
- matte

Important traits:

- the outer card is solid
- the inner rows are solid
- shadows are soft and restrained
- borders are minimal or nearly invisible

Practical implication for Stitchly:

- solid charcoal surfaces are the right adaptation
- rely on shape, spacing, and shadow first
- use lava accents for state and focus, not for every surface edge

## Handle Analysis

The handles are extremely simple.

Traits:

- circular
- small
- attached to the card edge
- strong contrast against the edge line

Important trait:

- they do not dominate the card
- they look like technical anchors, not decorative knobs

Practical implication for Stitchly:

- keep handles smaller than the current sandbox if possible
- attach them precisely to the card edge
- avoid large glowing defaults unless a state is active

## Edge Analysis

The edges are:

- thick enough to be legible
- smoothly curved
- dark and confident
- routed with simple clarity

For Stitchly, we already decided to translate this into lava-colored edges.

What should carry over from the sample:

- the smooth routing
- the confidence of stroke weight
- the low-clutter connection language

What should change for Stitchly:

- use lava instead of black
- reserve brighter lava or glow for active states

## Data Layout Patterns In The Sample

The sample reveals several reusable node-content patterns.

### Pattern A: Primary Key-Value Row

Example:

- `Cadence | Every 5 min`
- `Condition | order_total > 100`

Best for:

- a single most-important setting
- a concise configuration summary

### Pattern B: Grouped Status Panel

Example:

- `Last run`
- `Last`
- `Next`

or:

- `Last run`
- `True (Premium) 23`
- `False (Standar) 14`

Best for:

- multi-line metrics
- branch summaries
- status snapshots

### Pattern C: Quiet Footer Metric

Example:

- `Duration | 0.8s`

Best for:

- timing
- latest result status
- secondary system metadata

## Practical Considerations For Stitchly

The sample cannot be copied one-to-one because Stitchly has different node needs.

### 1. The Sample Uses Node Types As Headers

Examples:

- `Schedule trigger`
- `Conditional`
- `HTTP API Request`

Practical implication:

- the header should usually show the node type or instance label
- do not move essential type identity into a smaller caption
- if instance labels are user-editable later, decide whether the header shows:
  - user label
  - type name
  - or both

### 2. Trigger Nodes Need The Chip More Often

The sample shows the top chip on the trigger node but not on the conditional node.

Practical implication:

- trigger, branch, and terminal nodes may use chips more often
- compute/transform nodes probably should not all have chips

### 3. Different Node Types Need Different Row Grammars

The sample already shows this:

- the trigger node uses schedule and timing rows
- the condition node uses expression and branch summary rows

Practical implication:

- Stitchly should use one visual system with different content patterns per node family
- not every node should have identical rows

### 4. The Sample Is More Productized Than Schema-Driven

The sample hides complexity behind very compact summaries.

Practical implication:

- the visible node should show the operational summary
- deeper configuration should live in the inspector
- the node surface should not try to expose full raw config

### 5. The Sample Uses Strong Right-Aligned Values

This is important for scanability.

Practical implication:

- key-value rows should usually right-align the value
- grouped stats should align consistently within their section

## What Stitchly Should Preserve Closely

These traits should stay very close to the sample:

- top chip placement
- small inline icon behavior
- one-row header identity
- rounded inset row surfaces
- quiet overflow action
- strong value alignment
- restrained handle size
- compact vertical rhythm

## What Stitchly Should Adapt

These traits should be adapted rather than copied literally:

- palette
  Stitchly should stay dark with lava accents.

- edge color
  Stitchly should use lava edges instead of black.

- runtime and validation signaling
  Stitchly needs stronger state expression than the neutral sample.

- content types
  Stitchly nodes will need workflow-specific rows such as previews, branch counts, runtime status, and output summaries.

## What This Analysis Suggests Next

Before designing specific Stitchly node types, the next design step should define:

1. the shared node grammar Stitchly will use
2. the row patterns available to all nodes
3. which node families use chips
4. how headers behave for type name vs instance label
5. how trigger, compute, condition, output, and control nodes differ within one visual language

That should happen in a follow-up doc focused on:

- Stitchly node design language
- per-node-family adaptations
- practical row templates for each node category
