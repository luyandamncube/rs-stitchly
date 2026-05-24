# 21 Workflow Management Spec

## Purpose

Define how Stitchly stores, creates, opens, renames, versions, and deletes workflows inside a workspace.

This doc is the next platform spec after `20_app_auth_and_workspace_spec.md`.

It covers:

- workflow identity and routing
- workflow lifecycle inside a workspace
- storage model and schema additions
- API surface for workflow management
- the minimum behavior needed before richer workflow history and templates

This is a `v1 workflow-management spec draft`.

## Why This Exists

We already have:

- persisted workspaces
- persisted workflows and workflow versions
- a real canvas route
- autosave against the backend

But the current product still behaves like a single implicit workflow editor because:

- the canvas loads the first workflow in a workspace
- there is no workflow list screen
- there is no create workflow flow beyond backend fallback bootstrap
- there is no delete or archive behavior
- there is no persisted “last opened workflow” state

That makes workflow persistence real, but workflow management incomplete.

## Spec Lock Summary

If the recommended v1 direction is acceptable as-is, the shortest approval reply is:

```text
approve: WFM_01, WFM_02, WFM_03, WFM_04, WFM_05, WFM_06
```

If a key needs a different direction, reply with:

```text
change: <KEY> -> <new direction>
```

Example:

```text
approve: WFM_01, WFM_02, WFM_04, WFM_05, WFM_06
change: WFM_03 -> hard delete instead of soft archive
```

## Approval Table

| Key | Decision Area | Recommended V1 Choice | Main Alternative | Why The Recommendation Wins For V1 |
| --- | --- | --- | --- | --- |
| `WFM_01` | Workflow route model | Canvas routes use explicit `:workflowId` | Keep opening the first workflow in a workspace | Real workflow management needs stable deep links and explicit ownership |
| `WFM_02` | New workflow creation | Support `Blank` and `Starter` creation only | Auto-create a default workflow silently | Explicit creation is clearer and avoids hidden workflow state |
| `WFM_03` | Delete model | Soft archive workflows in v1 | Hard delete workflows immediately | Safer product behavior, easier recovery, keeps room for restore later |
| `WFM_04` | Current workflow persistence | Store per-user, per-workspace state in `user_workspace_state` | Store “last opened workflow” in local storage only | Keeps canonical navigation state backend-owned and multi-device-safe |
| `WFM_05` | Save model | Keep autosave as the primary save behavior | Add manual save-as-draft first | Matches current canvas direction and keeps the first management slice smaller |
| `WFM_06` | Workspace landing behavior | Workspaces open into workflow list or remembered workflow | Always route straight into canvas | A list-first entry makes create/open/delete management visible and understandable |

## Recommended V1 Direction

If accepted, the recommended v1 workflow-management direction is:

- workflows belong to a workspace
- the canvas always opens a concrete workflow id
- a workspace can contain many workflows
- users can create workflows from `Blank` or `Starter`
- workflows are autosaved
- delete is implemented as archive, not hard removal
- the backend remembers the last opened workflow per user and workspace
- the workspace can open into a workflow list when there is no active workflow yet

## Goals

The first workflow-management implementation should achieve all of the following:

- list workflows in the current workspace
- create a new workflow in the current workspace
- open a specific workflow in the canvas
- rename a workflow
- archive a workflow
- remember the last opened workflow per user and workspace
- stop loading “the first workflow we found” as the only canvas behavior

## Non-Goals For This Pass

The following are explicitly out of scope for the first workflow-management implementation:

- rich workflow folders
- tags and labels
- team sharing controls beyond workspace membership
- branching or forked workflow trees
- restore-from-history UI
- duplicate-from-version UI
- workflow publishing
- template marketplace behavior

## Workflow Ownership Model

### Workspace Boundary

- a workspace contains many workflows
- a workflow belongs to exactly one workspace
- runs remain scoped to a workspace and should link to a workflow id and workflow version where possible

### User State

Each user should also have lightweight workflow-navigation state inside a workspace:

- last opened workflow id
- last visited workflow screen later if useful

This state is user-specific, not workspace-global.

## Route Model

### Recommended Routes

- `/w/:workspaceSlug/workflows`
- `/w/:workspaceSlug/workflows/new`
- `/flow/:workflowId`

Optional later:

- `/w/:workspaceSlug/workflows/:workflowId/settings`
- `/w/:workspaceSlug/workflows/:workflowId/history`

### Route Rules

- entering `/w/:workspaceSlug` should not guess a canvas target blindly
- if a remembered workflow exists for the user in that workspace:
  redirect to `/flow/:workflowId`
- otherwise:
  redirect to `/w/:workspaceSlug/workflows`

## Workflow Lifecycle

### Create

V1 creation modes:

- `Blank workflow`
- `Starter workflow`

Rules:

- `Blank workflow` starts with no nodes
- `Starter workflow` uses the current starter fixture or a server-owned starter definition
- creation should immediately produce a persisted workflow record and first version

### Open

Opening a workflow should:

- load that workflow by id
- update per-user workspace state so it becomes the last opened workflow
- render the canvas against that explicit workflow only

### Rename

Renaming should update:

- workflow display name
- workflow `updated_at`

Renaming should not create a special version entry unless the product later decides metadata changes should be versioned separately.

### Save

V1 should keep the current autosave direction:

- edits update the current canonical workflow
- each save produces a new `workflow_versions` row
- the workflow’s `current_version` moves forward

There is no separate draft/published split in this pass.

### Delete

Recommended v1 behavior:

- delete means `archive`
- archived workflows disappear from the default workflow list
- archived workflows are not opened by default route resolution

This protects users from accidental destructive loss while keeping implementation simpler than full restore UX.

## Storage Model

### Existing Tables

Current persisted workflow tables already exist:

- `workflows`
- `workflow_versions`

These remain the canonical workflow store.

### New Table

Add:

- `user_workspace_state`

Recommended fields:

| Field | Type | Purpose |
| --- | --- | --- |
| `workspace_id` | text | workspace boundary |
| `user_id` | text | user boundary |
| `last_opened_workflow_id` | text nullable | remembered workflow |
| `created_at` | text | record creation |
| `updated_at` | text | record update |

Primary key:

- `(workspace_id, user_id)`

### Workflow Archive State

Recommended addition to `workflows`:

- `archived_at text null`

Rules:

- `null` means active
- non-null means archived

This is the minimum soft-delete model.

## API Surface

### Current API We Already Have

Already present in practice:

- `GET /api/workspaces/:workspace_id/workflows`
- `POST /api/workspaces/:workspace_id/workflows`
- `GET /api/workspaces/:workspace_id/workflows/:workflow_id`
- `PUT /api/workspaces/:workspace_id/workflows/:workflow_id`

### New API Needed For Workflow Management

Add:

- `DELETE /api/workspaces/:workspace_id/workflows/:workflow_id`
- `GET /api/workspaces/:workspace_id/workflow-state`
- `PUT /api/workspaces/:workspace_id/workflow-state`

If we want to avoid a separate resource later, `workflow-state` can be renamed to `ui-state`, but `workflow-state` is fine for v1.

### Delete Endpoint Semantics

Recommended v1:

- `DELETE` archives the workflow instead of physically removing it

Illustrative response:

```json
{
  "workflow_id": "wf_marketing_metrics",
  "archived": true
}
```

### Workflow State Endpoint Semantics

Illustrative response:

```json
{
  "last_opened_workflow_id": "wf_marketing_metrics"
}
```

Illustrative request:

```json
{
  "last_opened_workflow_id": "wf_marketing_metrics"
}
```

## Frontend Behavior Contract

The frontend should treat:

- the route as the source of truth for which workflow is open
- the backend as the source of truth for which workflows exist
- autosave as the default persistence model

The frontend should not:

- invent implicit workflow ids on the client
- rely on local storage as the canonical workflow selector
- silently switch to a different workflow because one was deleted

## Empty-State Rules

### No Workflows In Workspace

Show a workflow-management empty state with:

- `Create blank workflow`
- `Create starter workflow`

Do not auto-create one silently if the product is in explicit-management mode.

### Remembered Workflow Missing

If `last_opened_workflow_id` no longer exists or is archived:

- clear it server-side
- redirect to `/w/:workspaceSlug/workflows`

## Implementation Order

### Slice 1: Spec And Contracts

- approve this doc
- approve the UI workflow-management doc
- lock route shape and delete model

### Slice 2: Backend Workflow-Management Contract

- add `archived_at`
- add `user_workspace_state`
- add archive endpoint
- add get/set workflow-state endpoint
- make list endpoint ignore archived workflows by default

### Slice 3: Frontend Workflow List

- add workflow list screen
- add create workflow actions
- add rename
- add archive with confirmation

### Slice 4: Canvas Route Migration

- move canvas route to `:workflowId`
- stop loading the first workflow implicitly
- update last-opened workflow state on open

### Slice 5: Later History Work

- versions/history UI
- restore archived workflows
- duplicate workflow

## Open Questions

- Should `Starter workflow` remain the current seeded flow or move to a separate backend-owned starter library?
- Should rename create a new workflow version entry, or remain metadata-only?
- Should workflow archive be reversible in the first UI pass, or backend-only at first?
