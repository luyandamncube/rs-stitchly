#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <path-to-workflow.duckdb>" >&2
  exit 2
fi

db_path="$1"

if [ ! -f "$db_path" ]; then
  echo "workflow DuckDB file does not exist: $db_path" >&2
  exit 1
fi

if command -v lsof >/dev/null 2>&1 && lsof "$db_path" >/dev/null 2>&1; then
  echo "workflow DuckDB appears to be open; stop stitchly-server before repair: $db_path" >&2
  exit 1
fi

timestamp="$(date +%Y%m%d%H%M%S)"
quarantine_path="${db_path}.corrupt.${timestamp}"

mv "$db_path" "$quarantine_path"
echo "quarantined: $quarantine_path"

for sidecar in "${db_path}.wal" "${db_path}.tmp"; do
  if [ -e "$sidecar" ]; then
    sidecar_quarantine="${sidecar}.corrupt.${timestamp}"
    mv "$sidecar" "$sidecar_quarantine"
    echo "quarantined sidecar: $sidecar_quarantine"
  fi
done

echo "left workflow DuckDB absent for Stitchly embedded DuckDB to recreate: $db_path"
