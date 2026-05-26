# 23 Storage Root And Identity Architecture

## Purpose

Define how Stitchly should separate:

- platform identity and session data
- workspace and workflow data files
- the local-first storage root we can run today
- the future cloud-hosted shape we can transplant to later

This doc does not define the workflow-local database bootstrap in detail.

That detail is now captured in:

- `24_workflow_duckdb_storage_spec.md`

## Why This Exists

The current backend already persists users, sessions, workspaces, workflows, and runs in SQLite.

That is enough to make the app real, but it does not yet lock the longer-lived storage model for:

- user-owned workflow files
- per-workflow run history files
- table outputs
- uploads and generated artifacts
- future deployment onto cloud-hosted storage

We need a storage direction that:

- works locally right now
- fits backend-owned Google login later
- avoids coupling path layout to mutable names
- can be transplanted to mounted cloud storage later
- keeps room for future object-store or engine-backed evolution

## Core Model

Stitchly should separate storage into two planes:

### Control Plane

The control plane stores:

- users
- auth identities
- sessions
- workspaces
- workflow metadata
- workflow membership
- lightweight workflow state

This data should remain backend-owned and database-backed.

For v1, the control plane should continue using SQLite.

### Data Plane

The data plane stores:

- workflow definitions as files if needed
- workflow-local run history files
- workflow-local tables or datasets
- uploads
- generated outputs
- artifacts that are too large or too file-oriented for the control-plane database

The data plane should live under a rooted storage directory.

## Recommended V1 Direction

Use:

- SQLite for the control plane
- local filesystem for the data plane
- backend-managed sessions
- backend-managed Google login identity mapping

The root storage model should be designed now so it can later move from:

- local disk

to:

- an attached cloud volume
- a mounted network disk
- an object-store-backed implementation

without changing the logical ownership model.

## Root Layout

Recommended logical shape:

```text
<root>/
  platform/
    platform.sqlite3

  users/
    <user_id>/
      workspaces/
        <workspace_id>/
          workflows/
            <workflow_id>/
              workflow.json
              versions/
              db/
                runs/
                  <run_id>/
                    snapshot.json
                    events.ndjson
                    logs.ndjson
                tables/
                  <table_or_dataset_id>/
              files/
                uploads/
                outputs/
                artifacts/
```

Example with illustrative IDs:

```text
<root>/
  platform/platform.sqlite3
  users/usr_01H.../workspaces/ws_01H.../workflows/wf_01H.../db/runs/run_01H.../
```

## Path Rules

Paths should be keyed by stable IDs, not mutable labels.

Use:

- `user_id`
- `workspace_id`
- `workflow_id`
- `run_id`

Do not use:

- e-mail addresses
- workspace names
- workflow titles
- slugs as the canonical filesystem key

Rationale:

- names change
- e-mails may change
- IDs are safer for migration and lookup
- stable IDs reduce path rewrite complexity

Human-readable names belong in metadata, not in the path key.

## Recommended Environment Variable

Use one explicit root configuration:

```text
STITCHLY_STORAGE_ROOT=/data/stitchly
```

This root should contain both:

- `platform/`
- `users/`

The control-plane DB may remain local to the backend process at first, but the logical model should treat it as part of the root-owned deployment footprint.

## Google Login In This Model

Google should be an identity provider, not the owner of app state.

The flow should be:

1. User clicks `Sign in with Google`
2. Browser receives a Google credential or auth code
3. Rust backend verifies it with Google
4. Rust upserts a local user record
5. Rust links the Google identity to that user
6. Rust creates the normal Stitchly session cookie
7. If needed, backend ensures the user root exists under `<root>/users/<user_id>/`

This means:

- Google proves who the user is
- Stitchly still owns:
  - user records
  - sessions
  - workspaces
  - workflow ownership
  - storage layout

## Identity Storage Model

The current `users` table is enough for email/password, but it should evolve to support multiple login methods cleanly.

Recommended direction:

### `users`

Stores:

- `user_id`
- `primary_email`
- `display_name`
- `avatar_url`
- timestamps
- active workspace state if needed

### `auth_identities`

Stores:

- `provider`
- `provider_subject`
- `user_id`
- `email_at_link`
- `email_verified`
- `created_at`
- `last_login_at`

For Google, `provider_subject` should be the Google `sub` claim.

### `user_password_credentials`

Stores:

- `user_id`
- `password_hash`

This lets Stitchly support:

- email/password
- Google login
- later GitHub, Microsoft, or other providers

without overloading one credential field.

## Filesystem Ownership Boundaries

The backend should own filesystem writes.

The frontend should never write directly to storage roots.

Recommended ownership:

- backend creates user roots
- backend creates workspace roots
- backend creates workflow roots
- runtime appends run events and logs
- adapters write workflow outputs through backend-managed paths

## Storage Backend Abstraction

Even though v1 can write directly to local disk, the code should move toward a backend abstraction.

Recommended conceptual interface:

- `ensure_user_root(user_id)`
- `ensure_workspace_root(user_id, workspace_id)`
- `ensure_workflow_root(user_id, workspace_id, workflow_id)`
- `write_workflow_definition(...)`
- `write_run_snapshot(...)`
- `append_run_event(...)`
- `append_run_log(...)`
- `put_file(...)`
- `list_workflow_runs(...)`
- `list_workflow_tables(...)`

This keeps the logical storage model stable even if the backing implementation later changes.

## Local-First To Cloud-Hosted Path

The recommended maturity path is:

### Stage 1

- local SQLite for control plane
- local filesystem root for data plane
- single-machine development

### Stage 2

- same code
- `STITCHLY_STORAGE_ROOT` points to an attached cloud volume
- app runs in a Docker container or VM

### Stage 3

- platform DB may move to Postgres
- data plane may move to object-store-backed implementations
- file and table formats can evolve independently

The key point is that the logical ownership structure should not change between stages.

## Cloud Transplant Strategy

When moved to a cloud-hosted environment, the simplest first deployment should still look like:

- one backend container or VM
- one mounted storage root
- one control-plane database

That means the early local path model is not throwaway work.

It is the same logical system, just moved onto durable remote infrastructure.

## What Not To Do Yet

Do not assume the first data-plane format must be:

- a live shared DuckDB file in object storage
- a hot multi-writer embedded database on remote blob storage
- a fully managed data warehouse from day one

Those decisions belong in the next comparison doc.

This doc only locks:

- ownership boundaries
- root layout
- local-to-cloud transplant model
- identity mapping strategy

## Recommended Early File Conventions

For run history files:

- `snapshot.json`
- `events.ndjson`
- `logs.ndjson`

These are easy to inspect locally and migrate later.

For table storage, defer the exact format decision.

That later comparison should evaluate:

- local querying ergonomics
- append/update semantics
- portability
- cloud-hosting behavior
- connector compatibility

## Relationship To Existing Docs

This doc complements:

- `07_persistence.md`
- `16_connections_and_secrets.md`
- `20_app_auth_and_workspace_spec.md`
- `21_workflow_management_spec.md`
- `22_run_history_and_debugging_spec.md`

Use this doc when deciding:

- where app state lives
- where workflow-owned files live
- how Google login maps into local users
- how to move from local development to cloud-hosted storage

## Open Questions

- Should the control-plane DB remain inside `<root>/platform/` in all environments, or be allowed to move independently while still preserving the same logical structure?
- Which first table/data format best fits workflow-local `db/tables/` storage: DuckDB, Parquet, or another option?
- Should workflow definitions remain DB-backed only, file-backed only, or dual-written for easier portability?
- Which artifacts should stay as files versus promoted into engine-backed datasets?
