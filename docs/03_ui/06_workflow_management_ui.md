# 06 Workflow Management UI

## Purpose

Define how workflow management should appear in the Stitchly app shell before implementation.

This doc describes:

- workflow list entry points
- create/open/rename/delete interactions
- empty states and redirects
- how workflow management relates to the canvas route

This doc depends on:

- `docs/00_foundation/20_app_auth_and_workspace_spec.md`
- `docs/00_foundation/21_workflow_management_spec.md`

## Why This Exists

The product now has:

- real workspaces
- real persisted workflows
- a real canvas route

But users still do not have a real workflow-management surface.

That means we can persist workflows technically, while still missing the product UI for:

- choosing a workflow
- creating a new workflow intentionally
- deleting or archiving a workflow
- understanding what workflow the canvas is actually editing

## Core UI Direction

Workflow management should feel like a natural extension of the current dark shell:

- canvas-first when editing
- list-first when managing many workflows
- light chrome
- compact actions
- no dashboard-style clutter

## Required Screens

### Workflow List Screen

Recommended route:

- `/w/:workspaceSlug/workflows`

This is the management home for workflows in a workspace.

It should show:

- workflow list
- workflow name
- optional short description
- updated time
- current version
- create action
- rename action
- delete/archive action

### Create Workflow Entry

Recommended route:

- `/w/:workspaceSlug/workflows/new`

This can be:

- a dedicated screen
- or a modal/sheet opened from the workflow list

For v1, either is acceptable.

The minimum actions are:

- `Create blank workflow`
- `Create starter workflow`

### Canvas Screen

Recommended route:

- `/flow/:workflowId`

This route should edit one specific workflow only.

## Entry And Redirect Rules

### Workspace Entry

When a user enters a workspace:

- if a remembered workflow exists:
  open that workflow’s canvas route
- otherwise:
  open the workflow list

### No Workflows

If a workspace has no workflows:

- show an empty-state list screen
- emphasize creation actions
- do not auto-create silently

### Missing Workflow

If a user navigates to a workflow id that no longer exists or is archived:

- show a lightweight not-found state
- redirect back to the workflow list

## Workflow List Layout

The v1 list does not need to be complex.

Recommended structure:

1. top bar
   - workspace name
   - `New workflow`

2. workflow list body
   - one row or card per workflow
   - primary action: open
   - secondary actions: rename, delete/archive

3. empty-state block when needed

The list should be compact and operational, not highly editorial.

## Row/Card Contents

Each workflow item should show:

- workflow name
- optional description
- last updated time
- current version

Optional later:

- last run status
- owner/editor
- tag or folder

## Actions

### Open Workflow

Primary click target:

- open the workflow canvas route

### Create Workflow

V1 create options:

- blank
- starter

After creation:

- route directly into the created workflow canvas

### Rename Workflow

V1 rename can be:

- inline
- or a tiny modal

The simplest good v1 approach is inline rename from the list.

### Delete Workflow

Delete UI should be framed as archive in the product, even if the API uses `DELETE`.

Recommended interaction:

- user clicks delete/archive
- confirmation appears
- workflow is removed from the active list

## Canvas Relationship

The canvas route should expose minimal workflow-management affordances:

- visible workflow identity somewhere in shell chrome later
- maybe `Back to workflows`
- maybe `Rename workflow`

But the canvas should not become the main workflow-management screen.

The workflow list remains the canonical place for:

- browsing
- choosing
- creating
- deleting

## Empty States

### No Workflows Yet

Message should explain:

- this workspace has no workflows yet
- create one to start building

Actions:

- `Create blank workflow`
- `Create starter workflow`

### No Search Results Later

If search/filter is added later:

- show a no-results state
- do not reuse the no-workflows-ever state

## First UI Implementation Order

1. add workflow list route and screen
2. add create workflow flow
3. route canvas by `:workflowId`
4. add rename
5. add archive/delete

## Open Questions

- Should the first create flow be a modal, sheet, or full route?
- Should the workflow list use rows or cards in v1?
- Should the canvas route expose a visible workflow breadcrumb immediately, or wait for the list flow to land first?
