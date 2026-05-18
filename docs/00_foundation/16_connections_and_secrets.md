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

We can add more later, but the top-level shape should stay consistent.

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

## What The Frontend Can See

The frontend may safely consume:

- connection ID
- display name
- connection kind
- non-sensitive capability metadata
- validation-safe hints for node configuration

The frontend should not receive:

- raw secret values
- secret references unless absolutely necessary for debugging
- privileged environment details that are not needed for authoring

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
