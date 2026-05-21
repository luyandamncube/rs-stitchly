# 04 UI Lab Workflow

## Purpose

Define a practical workflow for refining Stitchly UI design in code before implementing it in the real product UI.

This workflow exists because:

- design iteration should be fast
- not every idea should land directly in production components
- HTML and CSS samples are easier to review than abstract descriptions
- the product needs a repeatable review loop for visual quality

## What The UI Lab Is

The UI lab is a dedicated space in the repo for:

- isolated UI samples
- static mock data
- design variants
- visual review
- approval and rejection before production implementation

It is not the production app.
It is not the backend-integrated frontend.
It is a design and interaction proving ground.

## Why We Want This

The lab should let us:

- explore visual directions safely
- compare variants side by side
- refine spacing, hierarchy, and motion
- approve individual UI patterns before implementation
- avoid destabilizing the real editor during visual iteration

## Core Principle

Design should be approved in isolation before it is integrated into the real app.

That means the order should usually be:

1. build sample
2. review sample
3. refine sample
4. approve sample
5. implement approved pattern in production UI

## Recommended Lab Scope

The lab is a good fit for:

- node shells
- node families
- rails
- drawers
- floating cards
- inspectors
- run surfaces
- validation surfaces
- empty states
- loading states
- edge and handle treatments
- motion studies

The lab is not the right place for:

- real backend integration
- execution logic
- production data fetching
- production routing complexity

## Recommended Structure

When implemented, the UI lab should live in a clearly separate location.

Reasonable options:

- `design_lab/`
- `apps/ui-lab/`
- `apps/web/lab/`

Preferred direction:

- keep it separate from production UI components
- allow shared tokens when useful
- do not force unfinished design experiments into the real app tree

## Sample Types

Each lab sample should declare what kind of exercise it is.

Recommended categories:

- `surface-study`
  For isolated cards, drawers, headers, or node shells.

- `state-study`
  For hover, selection, validation, runtime, and motion states.

- `layout-study`
  For composition, spacing, and screen-level arrangement.

- `interaction-study`
  For click, drag, focus, transitions, and connected behaviors.

- `system-study`
  For comparing multiple related UI elements in one design language.

## Required Characteristics Of A Good Lab Sample

Each sample should:

- use static or mock data
- be visually self-contained
- have a clear review purpose
- be easy to run locally
- isolate the specific design question it is testing

Each sample should avoid:

- production-only complexity
- mixing too many unrelated design questions
- unclear ownership of what is being judged

## Required Metadata For Each Sample

Each lab sample should include a small note describing:

- what the sample is testing
- which reference it follows
- which parts are still unresolved
- which decisions are being asked of the reviewer

This can live:

- in a small README beside the sample
- or in a visible annotation block in the sample page

## Review Workflow

The intended review loop is:

1. choose one surface or UI problem
2. build one or more isolated samples
3. review the samples visually
4. reject or approve specific elements
5. refine the accepted direction
6. implement only the approved pattern in production UI

This is important:

- approval should happen per pattern, not only per full screen
- rejection should be specific
- implementation should follow approval, not precede it

## What Review Should Focus On

Review should explicitly examine:

- hierarchy
- spacing
- proportion
- typography
- surface treatment
- icon treatment
- state expression
- motion behavior if relevant
- consistency with the Stitchly design language

## Variant Strategy

The lab should support multiple variants of the same idea.

Examples:

- `node-shell-a`
- `node-shell-b`
- `node-shell-c`

Or:

- `drawer-compact`
- `drawer-dense`
- `drawer-contextual`

This matters because design review works better when:

- options are concrete
- differences are visible
- tradeoffs can be discussed directly

## Approval Rules

A sample or pattern should be considered approved only when:

- the visual direction is accepted
- the spacing and hierarchy feel resolved
- the interaction model is clear enough
- the sample fits the documented Stitchly design language
- there is a clear mapping from sample to production UI use

Approved does not mean:

- final backend integration is complete
- every production state is wired yet

Approved means:

- this pattern is now a valid implementation target

## Rejection Rules

A sample should be rejected or revised when:

- hierarchy is unclear
- spacing feels unresolved
- the pattern conflicts with the established design language
- it introduces too much visual noise
- it solves too many problems at once
- it cannot clearly map back to a real product surface

## Relationship To Sandbox Work

The UI lab and the interaction sandbox are related, but not identical.

The state sandbox is best for:

- proving interaction models
- validating state layering
- testing runtime and validation treatment

The UI lab is best for:

- visual direction
- spacing
- hierarchy
- layout language
- component composition

They can overlap, but should not be treated as the same tool.

## Graduation Into Production UI

When a lab sample is approved, the next step should be:

1. identify the production surface it maps to
2. identify which parts can be reused directly
3. identify which parts need real data/state wiring
4. implement the approved design into the real UI
5. keep tests and debug visibility where needed

The production implementation should preserve:

- the approved layout
- the approved spacing
- the approved hierarchy
- the approved state behavior

## Practical Development Rules

When building UI lab samples later:

- prefer plain HTML and CSS first when possible
- use minimal JavaScript only when interaction is the thing being tested
- use fake data, not real APIs
- keep samples small and purposeful
- keep approved patterns easy to trace back into the main app

## Suggested First Uses

The first strong candidates for the UI lab are:

- node shell variants
- node family visual language
- rail and drawer variants
- floating card variants
- node inspector layout

## Relationship To Other Docs

- `03_ui/00_frontend_canvas.md` defines the overall frontend visual direction
- `03_ui/01_node_state_model.md` defines node state behavior
- `03_ui/02_ui_roadmap.md` defines phased UI implementation order
- `03_ui/03_node_reference_analysis.md` defines the sample-node design language we may want to emulate
