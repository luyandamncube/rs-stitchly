# 07 Persistence

## Purpose

Describe how Stitchly stores workflows, versions, runs, artifacts, and node metadata.

## Areas To Document

- workflow storage format
- version history
- run history
- artifact storage
- node registry storage
- connection and engine reference storage
- workload templates and lineage metadata
- cleanup and retention

## Early Direction

- Start simple with local-friendly persistence if it accelerates learning.
- Keep storage formats compatible with later migration to database and object-store backends.
- Separate workflow definitions from runtime artifacts and logs.
- Keep secrets and sensitive engine credentials outside normal workflow documents.

## Open Questions

- What should be file-based first versus database-backed first?
- Do artifacts live on disk, in blob storage, or behind an abstraction from day one?
- How should engine connection metadata be stored and referenced?
- How much execution metadata needs long-term retention?
