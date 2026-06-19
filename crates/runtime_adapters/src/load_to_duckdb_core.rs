pub(crate) struct LoadToDuckDbFileProjection<'a> {
    pub repository: &'a str,
    pub bundle_kind: &'a str,
    pub current_commit: &'a str,
    pub previous_commit: Option<&'a str>,
    pub delete_rows_present: bool,
    pub source_table: &'a str,
}

pub(crate) fn quote_duckdb_identifier(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}

pub(crate) fn quote_duckdb_string_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

pub(crate) fn build_load_to_duckdb_file_projection_sql(
    scan_sql: &str,
    source_columns: &[String],
    projection: &LoadToDuckDbFileProjection<'_>,
) -> String {
    let source_columns = source_columns
        .iter()
        .map(|column| column.to_ascii_lowercase())
        .collect::<Vec<_>>();
    let mut metadata_projections = Vec::new();

    let mut push_metadata_projection = |column_name: &str, expression: String| {
        if !source_columns.contains(&column_name.to_ascii_lowercase()) {
            metadata_projections.push(format!(
                "{expression} as {}",
                quote_duckdb_identifier(column_name)
            ));
        }
    };

    push_metadata_projection(
        "source_repo",
        quote_duckdb_string_literal(projection.repository),
    );
    push_metadata_projection(
        "source_table",
        quote_duckdb_string_literal(projection.source_table),
    );
    push_metadata_projection(
        "batch_id",
        quote_duckdb_string_literal(projection.current_commit),
    );
    push_metadata_projection(
        "ingested_at",
        "cast(current_timestamp as timestamp)".to_string(),
    );
    push_metadata_projection(
        "bundle_kind",
        quote_duckdb_string_literal(projection.bundle_kind),
    );
    if let Some(previous_commit) = projection.previous_commit {
        push_metadata_projection(
            "previous_commit",
            quote_duckdb_string_literal(previous_commit),
        );
    }
    push_metadata_projection(
        "current_commit",
        quote_duckdb_string_literal(projection.current_commit),
    );
    push_metadata_projection(
        "delete_rows_present",
        if projection.delete_rows_present {
            "true".to_string()
        } else {
            "false".to_string()
        },
    );

    if metadata_projections.is_empty() {
        return format!("select source_data.* from ({scan_sql}) as source_data");
    }

    format!(
        "select source_data.*, {} from ({scan_sql}) as source_data",
        metadata_projections.join(", ")
    )
}

pub(crate) fn build_load_to_duckdb_manifest_path(
    repo_family: &str,
    bundle_kind: &str,
    previous_commit: Option<&str>,
    current_commit: &str,
) -> String {
    if bundle_kind == "dolt_diff_export_bundle" {
        format!(
            "artifacts/load_to_duckdb/{repo_family}/{}_to_{current_commit}/load_manifest.json",
            previous_commit.unwrap_or("pending_checkpoint")
        )
    } else {
        format!("artifacts/load_to_duckdb/{repo_family}/{current_commit}/load_manifest.json")
    }
}

pub(crate) fn build_load_to_duckdb_staging_table_name(
    repo_family: &str,
    source_table: &str,
    suffix: &str,
) -> String {
    format!("{repo_family}__{source_table}__{suffix}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn staging_table_name_keeps_repo_table_and_suffix_visible() {
        assert_eq!(
            build_load_to_duckdb_staging_table_name("rates", "us_treasury", "snapshot"),
            "rates__us_treasury__snapshot"
        );
    }

    #[test]
    fn diff_manifest_path_uses_commit_range_with_checkpoint_fallback() {
        assert_eq!(
            build_load_to_duckdb_manifest_path("rates", "dolt_diff_export_bundle", None, "c2"),
            "artifacts/load_to_duckdb/rates/pending_checkpoint_to_c2/load_manifest.json"
        );
        assert_eq!(
            build_load_to_duckdb_manifest_path(
                "rates",
                "dolt_diff_export_bundle",
                Some("c1"),
                "c2"
            ),
            "artifacts/load_to_duckdb/rates/c1_to_c2/load_manifest.json"
        );
    }

    #[test]
    fn file_projection_adds_missing_metadata_and_escapes_literals() {
        let sql = build_load_to_duckdb_file_projection_sql(
            "read_parquet('bundle.parquet')",
            &["id".to_string()],
            &LoadToDuckDbFileProjection {
                repository: "owner/repo's",
                bundle_kind: "dolt_dump_bundle",
                current_commit: "c1",
                previous_commit: None,
                delete_rows_present: false,
                source_table: "orders",
            },
        );

        assert!(sql.contains("'owner/repo''s' as \"source_repo\""));
        assert!(sql.contains("'orders' as \"source_table\""));
        assert!(sql.contains("false as \"delete_rows_present\""));
    }

    #[test]
    fn file_projection_omits_all_metadata_when_source_already_has_it() {
        let sql = build_load_to_duckdb_file_projection_sql(
            "select * from source",
            &[
                "source_repo".to_string(),
                "source_table".to_string(),
                "batch_id".to_string(),
                "ingested_at".to_string(),
                "bundle_kind".to_string(),
                "previous_commit".to_string(),
                "current_commit".to_string(),
                "delete_rows_present".to_string(),
            ],
            &LoadToDuckDbFileProjection {
                repository: "repo",
                bundle_kind: "dolt_diff_export_bundle",
                current_commit: "c2",
                previous_commit: Some("c1"),
                delete_rows_present: true,
                source_table: "orders",
            },
        );

        assert_eq!(
            sql,
            "select source_data.* from (select * from source) as source_data"
        );
    }
}
