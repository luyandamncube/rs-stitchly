# 20 App Auth And Workspace Spec

## Purpose

Define the first real application-shell contract for Stitchly beyond the current mock login and in-memory workspace scaffold.

This doc covers:

- authentication
- protected routes
- workspace selection and persistence
- workflow ownership boundaries
- the minimum backend and frontend changes needed to make the app shell real

This is a `v1 platform spec draft`.

The recommendations in this doc are intended to be approved before implementation starts.

## Spec Lock Summary

This first step is not implementation yet.

The goal of `spec lock` is to confirm the small set of platform decisions that all later auth, routing, workspace, and persistence work depends on.

If we accept the recommended v1 direction, the simplest approval reply is:

```text
approve: AUTH_01, ROUTE_01, WS_01, DATA_01, ACL_01, WF_01, BOOT_01, SHELL_01, RUN_01
```

If any key needs a different direction, reply with:

```text
change: <KEY> -> <new direction>
```

Example:

```text
approve: AUTH_01, ROUTE_01, WS_01, ACL_01, WF_01, BOOT_01, SHELL_01, RUN_01
change: DATA_01 -> postgres instead of sqlite
```

## Why This Exists

The current frontend shell is intentionally scaffolded:

- login is local-only
- session state lives in browser storage
- screen navigation is not URL-driven
- the canvas uses a local starter workflow fixture
- workspaces are not yet first-class persisted entities

That was useful for UI iteration, but it is now the main blocker to making the application behave like a real product.

We need a shared contract that makes the next implementation step explicit across:

- frontend routing
- backend APIs
- persistence
- application boot flow

## Approval Keys

Use these keys to approve or reject the proposed v1 direction.

## Spec Lock Checklist

This section is the shortest useful version of the decision set.

### Approval Table

| Key | Decision Area | Recommended V1 Choice | Main Alternative | Why The Recommendation Wins For V1 |
| --- | --- | --- | --- | --- |
| `AUTH_01` | Authentication model | Backend-managed email/password with HTTP-only session cookie | Browser-held JWT/token auth | Simpler same-origin control plane, fewer token-handling mistakes, backend stays auth source of truth |
| `ROUTE_01` | Navigation model | Real route-based navigation with protected routes | Keep conditional screen rendering longer | Needed for real auth redirects, deep links, and workspace-scoped URLs |
| `WS_01` | Workspace model | Multi-workspace membership, one active workspace | Single workspace per user | Multi-workspace keeps future team/org growth open without much extra complexity now |
| `DATA_01` | Persistence backend | SQLite in Rust backend | Postgres first | Smallest useful persistent baseline, easy local development, enough for auth/workspaces/workflows/runs |
| `ACL_01` | Authorization roles | `owner` and `editor` only | Add `viewer` now | Two roles are enough to unblock product flow without premature permission complexity |
| `WF_01` | Workflow persistence | Canonical workflows by workspace with lightweight versions | Single mutable workflow record only | Version snapshots protect saved state and make runs easier to reason about |
| `BOOT_01` | First-run boot flow | Users without workspaces must create one before app entry | Auto-create a default workspace silently | Explicit creation makes the container model visible and avoids hidden defaults |
| `SHELL_01` | Authenticated app shell | URL-addressable, workspace-scoped shell | App state stays client-conditional only | Required for protected routes, reload safety, and shareable internal navigation |
| `RUN_01` | Run ownership model | Runs belong to a workspace and link to workflows when possible | Runs are global or loosely attached | Workspace scoping keeps data boundaries coherent from the start |

### Decision Boundaries

These choices are strongly recommended for v1:

- `AUTH_01`
- `ROUTE_01`
- `BOOT_01`
- `SHELL_01`
- `RUN_01`

These choices are still recommended, but are more open to change without breaking the whole implementation approach:

- `DATA_01`
- `ACL_01`
- `WF_01`
- `WS_01`

### What A Change Would Cost

- Changing `AUTH_01` later is expensive because it affects backend sessions, frontend boot logic, route guards, and security assumptions.
- Changing `ROUTE_01` later is expensive because it affects every screen entry path and protected redirect behavior.
- Changing `DATA_01` later is manageable if schema boundaries stay clean, but it is still best to decide now.
- Changing `ACL_01` later is easy if we start with a membership table and role field.
- Changing `WF_01` later is moderate cost because workflow save/load behavior and run linkage depend on it.

### `AUTH_01`

- proposed:
  Use email/password authentication with backend-owned server-side sessions stored in an HTTP-only cookie.

- rationale:
  Best fit for the current same-origin app and simplest secure baseline for a Rust-owned control plane.

- viable alternative:
  JWT or token-based auth in browser storage, which is more flexible later but adds avoidable v1 complexity.

### `ROUTE_01`

- proposed:
  Use real route-based navigation with public auth routes and protected workspace-scoped application routes.

- rationale:
  Required for proper auth redirects, reload-safe screen state, and workspace URLs.

- viable alternative:
  Keep the current conditional screen shell longer, which is faster short-term but blocks real protected routing.

### `WS_01`

- proposed:
  Support multiple workspaces per user, with one active workspace selected at a time.

- rationale:
  Keeps the product open for team and client separation without much extra schema cost.

- viable alternative:
  Single workspace per user, which is simpler but likely too limiting very quickly.

### `DATA_01`

- proposed:
  Start with SQLite-backed persistence in the Rust backend for users, sessions, workspaces, workflows, and runs.

- rationale:
  Fastest path to real persistence with low operational overhead and strong local-dev ergonomics.

- viable alternative:
  Postgres first, which is more production-scalable but adds setup and operating complexity now.

### `ACL_01`

- proposed:
  Start with two membership roles only: `owner` and `editor`.

- rationale:
  Enough to define ownership and editing authority without spending time on permission granularity we do not yet need.

- viable alternative:
  Add `viewer` now, which may be useful soon but is not required for the first real shell.

### `WF_01`

- proposed:
  Persist canonical workflows by workspace, with lightweight version history.

- rationale:
  Keeps saved workflows stable and gives us a clean place to attach runs and future restore/history features.

- viable alternative:
  Mutable current-only workflow records, which are simpler but much weaker for real save semantics.

### `BOOT_01`

- proposed:
  If an authenticated user has no workspace, route them into workspace creation before they can enter the main app shell.

- rationale:
  Makes the workspace model explicit and avoids silent default containers the user never intentionally created.

- viable alternative:
  Auto-create a default workspace after signup or first login.

### `SHELL_01`

- proposed:
  The authenticated shell should be URL-addressable and workspace-scoped, not only conditionally rendered client state.

- rationale:
  Needed for real product behavior: deep links, reload safety, protected redirects, and clean screen ownership.

- viable alternative:
  Keep the current local state shell, which is acceptable for a prototype but not for a real app platform.

### `RUN_01`

- proposed:
  Runs should be scoped to a workspace and linked to persisted workflows where possible.

- rationale:
  Keeps execution data inside the same ownership boundary as the workflow that produced it.

- viable alternative:
  Allow looser global or ad-hoc runs, which is easier temporarily but creates data-boundary confusion.

## Recommended V1 Direction

If accepted, the recommended v1 application-platform direction is:

- backend-owned cookie sessions
- `react-router`-based protected routes
- workspace-scoped application URLs
- SQLite persistence in Rust
- persisted workflows and runs
- no social auth
- no invite system yet
- no deep RBAC yet

## Goals

The first real app-shell implementation should achieve all of the following:

- a user can log in and log out against the backend
- the browser can restore a valid session by asking the backend, not by trusting local storage
- the app has real protected routes
- a user can create, list, and select workspaces
- a workspace becomes part of the route and backend request context
- workflows can be persisted and retrieved per workspace
- runs can be viewed in a workspace-scoped way

## Non-Goals For This Pass

The following are explicitly out of scope for the first implementation:

- OAuth or social login
- magic links
- SSO or enterprise identity
- invite acceptance flows
- granular per-resource permissions
- billing and organization administration
- collaborative multi-user live editing
- audit trail UI

## Recommended User Journey

### First-Time User

1. User lands on `/login`
2. User authenticates with email and password
3. Backend creates a session and sets a secure cookie
4. Frontend loads session context
5. If the user has no workspaces:
   route to workspace creation
6. User creates first workspace
7. User enters `/w/:workspaceSlug/overview`

### Returning User

1. Browser loads any protected route
2. Frontend checks session with backend
3. If session is valid:
   load workspace membership list and current workspace
4. Route into last selected workspace, or first available workspace

### Logged-Out User

1. User hits a protected route without a valid session
2. Frontend redirects to `/login`
3. After successful login:
   return to intended protected route if still valid

## Authentication Model

### Recommended Model

Use backend-managed sessions with cookies.

The backend should:

- validate credentials
- issue a session record
- set an HTTP-only session cookie
- expose a session endpoint the frontend can query
- invalidate sessions on logout

The frontend should not:

- store access tokens in local storage
- treat local storage alone as proof of authentication
- own the truth of whether a session is valid

### Why This Model

This is the simplest secure baseline for the first real app shell because:

- the backend already owns the control plane
- the app is same-origin friendly
- it avoids browser-stored token complexity
- it keeps auth state authoritative in Rust

### Minimum Auth Endpoints

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/session`

Illustrative session response:

```json
{
  "authenticated": true,
  "user": {
    "user_id": "usr_001",
    "email": "builder@stitchly.dev",
    "display_name": "Builder"
  },
  "workspaces": [
    {
      "workspace_id": "ws_001",
      "slug": "default",
      "name": "Default Workspace",
      "role": "owner"
    }
  ],
  "active_workspace_id": "ws_001"
}
```

## Protected Route Model

### Public Routes

- `/login`

### Protected Routes

- `/workspaces/new`
- `/w/:workspaceSlug/overview`
- `/w/:workspaceSlug/canvas`
- `/w/:workspaceSlug/runs`
- `/w/:workspaceSlug/connections`
- `/w/:workspaceSlug/settings`

### Route Rules

- all `/w/:workspaceSlug/*` routes require authentication
- the referenced workspace must belong to the user
- if the workspace slug does not resolve for the current user:
  show a not-found or unauthorized shell state
- if the user is authenticated but has no workspaces:
  redirect to `/workspaces/new`

### Recommended Frontend Mechanism

Use `react-router` with:

- public route tree
- protected route wrapper
- workspace loader logic
- redirect handling for invalid or missing session state

## Workspace Model

### Workspace As First-Class Entity

A workspace is the container for:

- workflows
- workflow versions
- runs
- connections later
- settings later

### Minimum Workspace Fields

- `workspace_id`
- `slug`
- `name`
- `created_at`
- `updated_at`

### Membership Model

Use a membership join table so one user can belong to many workspaces.

Minimum membership fields:

- `workspace_id`
- `user_id`
- `role`

### Initial Roles

- `owner`
- `editor`

Do not introduce finer-grained roles yet.

## Workflow Persistence Model

### V1 Rule

Workflows should no longer be frontend-only fixtures once this spec is implemented.

Each workflow should be scoped to a workspace and persisted by the backend.

### Minimum Workflow Fields

- `workflow_id`
- `workspace_id`
- `name`
- `description`
- `latest_version`
- `created_at`
- `updated_at`

### Version Model

Use lightweight version history.

Recommended first-pass split:

- `workflows`
  identity and latest metadata
- `workflow_versions`
  immutable saved definition snapshots

The exact persistence shape can evolve, but the frontend should treat saved workflows as backend-owned canonical artifacts.

## Run Persistence Model

### V1 Rule

Runs should be linked to:

- a workspace
- a workflow when available
- a workflow version when available

### Minimum Run Fields

- `run_id`
- `workspace_id`
- `workflow_id`
- `workflow_version`
- `status`
- `trigger_kind`
- `started_at`
- `finished_at`

This aligns with the existing run snapshot model already documented elsewhere.

## Recommended Persistence Choice

### V1 Database

Use SQLite in the Rust backend.

Why:

- local-friendly
- low operational overhead
- enough for auth, workspaces, workflows, and runs
- easy migration path later if the schema is kept clean

### Minimum Persisted Tables

- `users`
- `sessions`
- `workspaces`
- `workspace_memberships`
- `workflows`
- `workflow_versions`
- `runs`

This is the smallest useful persisted application shell.

## Backend Work Required

### New API Families

#### Auth

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/session`

#### Workspaces

- `GET /api/workspaces`
- `POST /api/workspaces`
- `GET /api/workspaces/:workspace_id`

#### Workspace Workflows

- `GET /api/workspaces/:workspace_id/workflows`
- `POST /api/workspaces/:workspace_id/workflows`
- `GET /api/workspaces/:workspace_id/workflows/:workflow_id`
- `PUT /api/workspaces/:workspace_id/workflows/:workflow_id`

#### Workspace Runs

- `GET /api/workspaces/:workspace_id/runs`

### Existing Endpoints That Need Evolution

The current control-plane endpoints should become workspace-aware where relevant.

Examples:

- workflow validation can still remain semantic and stateless
- run creation should carry workspace context
- run lookup should enforce workspace membership

## Frontend Work Required

### Replace Scaffolded Session Logic

Remove the current local-only session assumption from the app shell and replace it with:

- session bootstrap from backend
- logout via backend
- auth redirect behavior

### Add Real Routing

Move from conditional screen rendering toward route-driven screens.

The frontend should:

- mount routes once
- protect route trees
- derive current screen from URL
- derive current workspace from URL and session context

### Add Workspace State

The frontend needs a small app-level workspace layer:

- current workspace
- available workspaces
- workspace selection
- create workspace flow

### Persisted Canvas Context

The canvas screen should stop depending only on local fixtures and be able to:

- load saved workflows for the active workspace
- save workflow changes
- create runs against saved workflow identity

## Security Notes

### Session Storage

The frontend may cache non-sensitive UI hints, but it must not treat browser storage as the source of truth for auth.

### Workspace Authorization

Every protected workspace request must confirm membership on the backend.

### Secrets

This spec does not change the existing secret-handling rules:

- secrets remain backend-owned
- browser-visible workspace objects must not include raw secrets

## MVP Slice To Implement First

The recommended implementation slice is:

1. backend session endpoints
2. frontend protected routes
3. backend workspace CRUD
4. frontend workspace selection/create flow
5. backend workflow persistence
6. frontend workflow list/load/save
7. workspace-scoped runs screen

This is the minimum slice that turns the current shell into a real app platform.

## Explicitly Deferred

Defer these until after the v1 app shell is working:

- invites
- multi-factor auth
- social auth
- deep RBAC
- billing
- collaborative editing
- full organization administration

## Suggested Approval Reply Format

Example:

```text
approve: AUTH_01, ROUTE_01, WS_01, DATA_01, ACL_01, WF_01, BOOT_01, SHELL_01, RUN_01
```

Or:

```text
approve: AUTH_01, ROUTE_01, WS_01
change: DATA_01 -> postgres instead of sqlite
change: ACL_01 -> owner, editor, viewer
```
