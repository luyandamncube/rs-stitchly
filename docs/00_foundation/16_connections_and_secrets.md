# 16 Connections And Secrets

## Purpose

Define how Stitchly references external systems and how secrets are resolved safely at runtime.

## Goals

- keep secrets out of workflow files
- let workflows reference external systems consistently
- support local development and future deployed environments
- enforce least-privilege access for adapters and runtime nodes
- make connection-dependent nodes easy to test

## Core Principle

Workflows should reference connections by stable ID. They should never embed raw credentials directly.

Example:

- good: `clickhouse_market_data`
- bad: host, username, and password copied directly into workflow JSON

## Connection Model

A connection should be a backend-managed object that describes how to reach an external system.

It should include:

- `connection_id`
- `connection_kind`
- human-readable name
- environment or scope tags
- non-secret configuration
- secret references
- capability metadata

## Connection Kinds

Early connection kinds we likely need:

- `clickhouse`
- `postgres`
- `s3_compatible`
- `dolt_repo`
- `http_api`
- `local_filesystem`
- `gmail`
- `google_drive`
- `google_calendar`
- `instagram`
- `whatsapp`
- `twitter`
- `telegram`
- `slack`
- `outlook`
- `notion`

We can add more later, but the top-level shape should stay consistent.

## Workspace Scope

For the current app shell, external integrations should persist as workspace-scoped backend objects.

That means:

- the list shown in the canvas integrations menu belongs to a workspace
- workflows should still reference stable `connection_id` values
- one workspace can hold many connections of the same `connection_kind`
- connections can be archived without losing historical workflow references immediately

## Separation Of Concerns

### Workflow Definition

Stores:

- connection IDs
- logical target names
- environment-independent behavior

Does not store:

- passwords
- tokens
- private keys
- environment-specific host overrides unless explicitly designed for that

### Backend Connection Store

Stores:

- non-secret configuration
- references to secrets
- capability and policy metadata

### Secret Store

Stores:

- actual secret values
- rotation metadata
- secret access policies

The first implementation may use a simple local mechanism, but the conceptual boundary should still exist from day one.

## Recommended Connection Object Shape

Illustrative shape:

```json
{
  "connection_id": "clickhouse_market_data",
  "connection_kind": "clickhouse",
  "display_name": "ClickHouse Market Data",
  "config": {
    "host": "clickhouse.internal",
    "port": 8443,
    "database": "analytics",
    "tls": true
  },
  "secret_refs": {
    "username": "secret://clickhouse_market_data/username",
    "password": "secret://clickhouse_market_data/password"
  },
  "capabilities": {
    "supports_sql_transform": true,
    "supports_table_output": true
  }
}
```

## Concrete SQLite Table

The first persisted table for these backend-managed connectors should be:

- `workspace_connections`

Purpose:

- persist the safe list shown in the integrations popup
- store non-secret connector configuration
- store secret references without storing raw secret material inline
- keep connection lifecycle state, validation state, and last-known provider account metadata

Recommended columns:

| Column | Type | Purpose |
| --- | --- | --- |
| `workspace_id` | `text not null` | Workspace scope for the connection |
| `connection_id` | `text not null` | Stable logical ID referenced by workflows |
| `connection_kind` | `text not null` | Provider/service kind such as `gmail` or `notion` |
| `display_name` | `text not null` | Human-readable name shown in the UI |
| `comment` | `text null` | Optional note shown in the integrations list |
| `auth_scheme` | `text null` | High-level auth strategy such as `oauth2`, `api_key`, or `service_account` |
| `status` | `text not null` | Lifecycle state such as `draft`, `pending_auth`, `active`, `error`, `revoked`, or `archived` |
| `external_account_label` | `text null` | Safe provider-visible account label such as an email or workspace name |
| `external_account_id` | `text null` | Stable provider account ID or subject when available |
| `config_json` | `text not null` | Non-secret configuration payload |
| `secret_refs_json` | `text not null` | Secret reference payload, not raw secrets |
| `scopes_json` | `text not null` | Granted or requested scopes for OAuth-style providers |
| `capabilities_json` | `text not null` | Safe capability metadata for the frontend/runtime |
| `created_by_user_id` | `text null` | User who first created the connection |
| `created_at` | `text not null` | RFC3339 creation timestamp |
| `updated_at` | `text not null` | RFC3339 last-updated timestamp |
| `last_validated_at` | `text null` | Last successful validation timestamp |
| `last_used_at` | `text null` | Last time a run used this connection |
| `last_error_code` | `text null` | Safe machine-readable failure hint |
| `last_error_message` | `text null` | Safe user-visible failure summary |
| `archived_at` | `text null` | Soft-archive timestamp |

Recommended key and FK shape:

- primary key: `(workspace_id, connection_id)`
- foreign key: `workspace_id -> workspaces.workspace_id`
- foreign key: `created_by_user_id -> users.user_id`

Recommended indexes:

- `(workspace_id, archived_at, status, created_at desc)`
- `(workspace_id, connection_kind, archived_at)`

Notes:

- `config_json`, `secret_refs_json`, `scopes_json`, and `capabilities_json` stay flexible while the connector set grows
- raw access tokens, refresh tokens, passwords, and private keys should still not be stored directly in this row unless the project later adds an explicit encrypted secret-value layer
- the integrations popup can safely list `display_name`, `connection_kind`, `created_at`, `comment`, `status`, and `external_account_label`

## Backend-Owned OAuth Token Table

The first real OAuth connector slice should keep durable provider tokens in a separate backend-only table:

- `workspace_connection_oauth_tokens`

Purpose:

- store access and refresh tokens outside the safe frontend list row
- keep token expiry and granted scopes close to the connector record
- let Gmail be implemented without leaking raw token material into `workspace_connections`

Recommended columns:

| Column | Type | Purpose |
| --- | --- | --- |
| `workspace_id` | `text not null` | Workspace scope for the token row |
| `connection_id` | `text not null` | Connection row the tokens belong to |
| `provider` | `text not null` | OAuth provider such as `google` |
| `access_token` | `text null` | Latest access token stored backend-side only |
| `refresh_token` | `text null` | Long-lived refresh token stored backend-side only |
| `token_type` | `text null` | Returned token type such as `Bearer` |
| `scopes_json` | `text not null` | Granted scope list for the stored tokens |
| `expires_at` | `text null` | RFC3339 access-token expiry when known |
| `created_at` | `text not null` | RFC3339 creation timestamp |
| `updated_at` | `text not null` | RFC3339 last-updated timestamp |

Key shape:

- primary key: `(workspace_id, connection_id)`
- foreign key: `(workspace_id, connection_id) -> workspace_connections(workspace_id, connection_id)`

Notes:

- this table is backend-owned and should never be returned directly to the browser
- it is the first practical place where Gmail refresh tokens can live while the project still uses local SQLite
- once a stronger encrypted secret-value layer exists, the raw token columns can be migrated behind that boundary without changing the frontend connection list contract

## What The Frontend Can See

The frontend may safely consume:

- connection ID
- display name
- connection kind
- comment
- status
- created-at metadata
- safe provider account label
- non-sensitive capability metadata
- validation-safe hints for node configuration

The frontend should not receive:

- raw secret values
- secret references unless absolutely necessary for debugging
- privileged environment details that are not needed for authoring
- raw access tokens or refresh tokens

## Environment Strategy

Connections should support environment-aware resolution.

Examples:

- `clickhouse_market_data` resolves differently in local, staging, and production
- the same workflow can run against different environments without being rewritten

We should prefer:

- stable logical connection IDs in workflows
- environment-specific binding in the backend

## Secret Resolution

At runtime, the adapter should ask the backend for resolved connection material rather than reading secrets directly from the workflow or frontend.

Recommended flow:

1. workflow references `connection_id`
2. runtime asks connection resolver for a usable connection
3. resolver combines connection config and secret values
4. adapter receives only what it needs for execution

This keeps the resolution boundary explicit and auditable.

## Access Scoping

Connections should eventually support least-privilege policies.

Examples:

- read-only warehouse connection for `table_input`
- write-limited warehouse connection for `table_output`
- object-store connection restricted to a specific bucket or prefix

Nodes should not automatically inherit broader access than they need.

## Local Development Direction

The first local setup can be simple, but it should match the same conceptual model.

Acceptable early approach:

- local connection config file
- environment variables for secrets
- backend resolver that merges both

Even in local mode, workflows should still only refer to connection IDs.

## Testing Direction

Connections should be easy to substitute in tests.

We should support:

- fake connection objects
- local test credentials
- adapter stubs
- fixture-driven connection resolution

Tests should not depend on production secret stores or ad hoc manual setup.

## Audit And Observability

The runtime should log connection usage in a safe way.

Examples:

- which `connection_id` was used
- which adapter resolved it
- whether access was read or write oriented

The runtime should not log:

- passwords
- tokens
- raw DSNs containing secrets

## Gmail Runtime Delivery

For `send_email`, the saved workflow should continue to persist only `connection_id`.

At run start:

1. the backend resolves the selected workspace Gmail connection
2. it reads the current OAuth token material from backend-owned storage
3. it injects a short-lived runtime delivery context into the in-memory run request
4. the `send_email` adapter uses that runtime-only context to call Gmail `users.messages.send`

The persisted workflow definition should not store:

- Gmail access tokens
- Gmail refresh tokens
- runtime-only delivery context objects

This keeps the workflow artifact portable while still allowing real delivery during execution.

## Failure Model

Connection-related failures should be distinguishable.

Useful categories:

- connection not found
- secret missing
- permission denied
- network unreachable
- authentication failed
- capability mismatch

These categories matter for both user-facing debugging and automated retries.

## Open Questions

- Where should the first local connection store live?
- Do we need per-project connection scopes, per-workspace scopes, or both?
- How should secret rotation affect long-running scheduled workflows?
