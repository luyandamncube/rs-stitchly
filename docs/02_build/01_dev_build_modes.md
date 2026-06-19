# Dev Build Modes

Stitchly's default backend build is the full local app:

```bash
scripts/dev_ui_agent.sh build
scripts/dev_ui_agent.sh restart --no-open
```

This includes concrete runtime adapters, including DuckDB/parquet-backed paths.

For UI and control-plane work that does not need real table execution, use the light backend mode:

```bash
scripts/dev_ui_agent.sh build server-light
scripts/dev_ui_agent.sh check server-light
scripts/dev_ui_agent.sh timings server-light
scripts/dev_ui_agent.sh restart --no-open --light
```

Light mode builds `runtime_server` with `--no-default-features`. The server composes `RuntimeService::default()` instead of `runtime_adapters::RuntimeAdapters`, and it omits DuckDB-backed workspace catalog storage. Workflow validation and lightweight text/preview/email execution remain available without compiling concrete adapters, DuckDB, libduckdb-sys, or Arrow.

In light mode, workspace catalog endpoints remain mounted but return HTTP 503 because they require the `duckdb-storage` feature. Use full backend mode when catalog browsing, table deletion, DuckDB run mirroring, or real table execution is part of the work.

## DuckDB Linkage

The default build enables bundled DuckDB so the app works without a system DuckDB install:

```toml
runtime_server default features = ["duckdb-storage", "bundled-duckdb", "full-adapters"]
```

The current `duckdb`/`libduckdb-sys` crate feature graph makes parquet support imply bundled DuckDB:

```text
duckdb/parquet -> libduckdb-sys/parquet -> bundled
```

That means a non-bundled DuckDB experiment is only meaningful for the server storage path without full adapters right now:

```bash
scripts/dev_ui_agent.sh check server-system-duckdb
scripts/dev_ui_agent.sh timings server-system-duckdb
cargo +nightly -Znext-lockfile-bump build -p runtime_server --bin stitchly-server --no-default-features --features duckdb-storage
```

`server-system-duckdb` builds `runtime_server` with `--no-default-features --features duckdb-storage`. Use it only when a compatible system DuckDB is installed and discoverable through `pkg-config` or `vcpkg`. Full adapter mode still compiles bundled DuckDB because parquet-backed adapters require it with the current dependency version.
