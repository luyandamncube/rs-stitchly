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

Light mode builds `runtime_server` with `--no-default-features --features bundled-duckdb`. The server composes `RuntimeService::default()` instead of `runtime_adapters::RuntimeAdapters`, so workflow validation and lightweight text/preview/email execution remain available without compiling the concrete adapter crate.

Light mode does not remove every DuckDB compile edge yet. `runtime_server` still owns workspace/catalog storage paths that use the `duckdb` crate. It does remove the adapter-heavy edge where `load_to_duckdb`, table adapters, SQL transform, and related runtime adapters enter the server binary.

## DuckDB Linkage

The default build enables bundled DuckDB so the app works without a system DuckDB install:

```toml
runtime_server default features = ["bundled-duckdb", "full-adapters"]
```

The current `duckdb`/`libduckdb-sys` crate feature graph makes parquet support imply bundled DuckDB:

```text
duckdb/parquet -> libduckdb-sys/parquet -> bundled
```

That means a non-bundled DuckDB experiment is only meaningful for the light server/storage path right now:

```bash
scripts/dev_ui_agent.sh check server-system-duckdb
scripts/dev_ui_agent.sh timings server-system-duckdb
cargo +nightly -Znext-lockfile-bump build -p runtime_server --bin stitchly-server --no-default-features
```

Use that only when a compatible system DuckDB is installed and discoverable through `pkg-config` or `vcpkg`. Full adapter mode still compiles bundled DuckDB because parquet-backed adapters require it with the current dependency version.
