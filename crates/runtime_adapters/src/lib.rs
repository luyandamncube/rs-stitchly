use std::{
    any::Any,
    collections::BTreeMap,
    env, fs,
    panic::{catch_unwind, AssertUnwindSafe},
    path::{Path, PathBuf},
    process::Command,
    time::Duration as StdDuration,
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::Utc;
use duckdb::Connection as DuckDbConnection;
use node_registry::NodeDefinition;
use serde::Deserialize;
use serde_json::{json, Value};
use thiserror::Error;
use workflow_schema::{DataType, TypedValue, WorkflowNode};

pub type PortValues = BTreeMap<String, TypedValue>;

fn panic_payload_to_string(payload: Box<dyn Any + Send + 'static>) -> String {
    if let Some(message) = payload.downcast_ref::<&str>() {
        return (*message).to_string();
    }
    if let Some(message) = payload.downcast_ref::<String>() {
        return message.clone();
    }

    "non-string panic payload".to_string()
}

#[derive(Clone, Debug, Default)]
pub struct RuntimeAdapters;

#[derive(Clone, Debug, Default)]
pub struct AdapterExecutionContext {
    pub workflow_id: Option<String>,
    pub run_id: Option<String>,
    pub workspace_duckdb_path: Option<PathBuf>,
    pub workflow_root_path: Option<PathBuf>,
    pub workflow_files_root: Option<PathBuf>,
    pub workflow_duckdb_path: Option<PathBuf>,
    pub disable_live_dolt: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct NodeExecutionResult {
    pub outputs: PortValues,
    pub logs: Vec<String>,
}

#[derive(Debug, Error)]
pub enum AdapterError {
    #[error("invalid config for node `{node_id}`: {message}")]
    InvalidConfig { node_id: String, message: String },
    #[error("missing input port `{port}` for node `{node_id}`")]
    MissingInput { node_id: String, port: String },
    #[error("text value expected on port `{port}` for node `{node_id}`")]
    TextTypeMismatch { node_id: String, port: String },
    #[error("dataset ref value expected on port `{port}` for node `{node_id}`")]
    DatasetRefTypeMismatch { node_id: String, port: String },
    #[error("connection failed for node `{node_id}`: {message}")]
    ConnectionFailed { node_id: String, message: String },
    #[error("execution failed for node `{node_id}`: {message}")]
    ExecutionFailed { node_id: String, message: String },
    #[error("unsupported node type `{0}`")]
    UnsupportedNode(String),
}

impl RuntimeAdapters {
    pub fn execute(
        &self,
        definition: &NodeDefinition,
        node: &WorkflowNode,
        inputs: &PortValues,
    ) -> Result<NodeExecutionResult, AdapterError> {
        self.execute_with_context(
            definition,
            node,
            inputs,
            &AdapterExecutionContext::default(),
        )
    }

    pub fn execute_with_context(
        &self,
        definition: &NodeDefinition,
        node: &WorkflowNode,
        inputs: &PortValues,
        context: &AdapterExecutionContext,
    ) -> Result<NodeExecutionResult, AdapterError> {
        match definition.type_id.as_str() {
            "checkpoint_read" => execute_checkpoint_read(node),
            "checkpoint_write" => execute_checkpoint_write(node, inputs, context),
            "dolt_repo_source" => execute_dolt_repo_source(node, context),
            "dolt_repo_sync" => execute_dolt_repo_sync(node, inputs),
            "dolt_change_manifest" => execute_dolt_change_manifest(node, inputs),
            "dolt_dump" => execute_dolt_dump(node, inputs, context),
            "dolt_diff_export" => execute_dolt_diff_export(node, inputs),
            "load_to_duckdb" => execute_load_to_duckdb(node, inputs, context),
            "quality_check" => execute_quality_check(node, inputs),
            "sql_transform" => execute_sql_transform(node, inputs, context),
            "table_merge" => execute_table_merge(node, inputs, context),
            "text_input" => execute_text_input(node),
            "text_transform" => execute_text_transform(node, inputs),
            "table_input" => execute_table_input(node),
            "table_schema" => execute_table_schema(node),
            "preview_output" => execute_preview_output(node, inputs),
            "table_output" => execute_table_output(node, inputs),
            "send_email" => execute_send_email(node, inputs),
            _ => Err(AdapterError::UnsupportedNode(definition.type_id.clone())),
        }
    }
}

#[derive(Deserialize)]
struct CheckpointReadConfig {
    checkpoint_table: String,
    source_repo: String,
    branch: String,
    #[serde(default)]
    emit_bootstrap_marker_if_missing: Option<bool>,
    #[serde(default)]
    fail_on_stale_checkpoint: Option<bool>,
}

#[derive(Deserialize)]
struct CheckpointWriteConfig {
    checkpoint_table: String,
    #[serde(default)]
    commit_source: Option<CheckpointWriteCommitSource>,
    #[serde(default)]
    write_timing: Option<CheckpointWriteTiming>,
    #[serde(default)]
    only_persist_on_full_success: Option<bool>,
    #[serde(default)]
    advance_on_partial_success: Option<bool>,
}

#[derive(Deserialize)]
struct QualityCheckConfig {
    #[serde(default)]
    suite_preset: Option<QualityCheckSuitePreset>,
    #[serde(default)]
    schema_drift_rule: Option<QualityCheckSchemaDriftRule>,
    #[serde(default)]
    null_key_policy: Option<QualityCheckNullKeyPolicy>,
    #[serde(default)]
    warning_budget: Option<u64>,
    #[serde(default)]
    block_checkpoint_write_on_failure: Option<bool>,
    #[serde(default)]
    allow_warning_only_runs_to_continue: Option<bool>,
}

#[derive(Deserialize)]
struct DoltRepoSourceConfig {
    connection_ref: String,
    repository: String,
    branch: String,
    #[serde(default)]
    checkout_ref: Option<String>,
    #[serde(default)]
    clone_mode: Option<DoltCloneMode>,
    #[serde(default)]
    sync_strategy: Option<DoltSyncStrategy>,
}

#[derive(Deserialize)]
struct DoltRepoSyncConfig {
    #[serde(default)]
    sync_action: Option<DoltRepoSyncAction>,
    #[serde(default)]
    no_change_behavior: Option<DoltRepoSyncNoChangeBehavior>,
    #[serde(default)]
    branch_guard: Option<DoltRepoSyncBranchGuard>,
    #[serde(default)]
    dirty_working_copy_policy: Option<DoltRepoSyncDirtyWorkingCopyPolicy>,
}

#[derive(Deserialize)]
struct DoltChangeManifestConfig {
    #[serde(default)]
    table_scope: Option<DoltChangeManifestTableScope>,
    #[serde(default)]
    selected_tables: Option<Vec<String>>,
    #[serde(default)]
    schema_change_policy: Option<DoltChangeManifestSchemaChangePolicy>,
}

#[derive(Deserialize)]
struct DoltDumpConfig {
    #[serde(default)]
    output_format: Option<DoltDumpOutputFormat>,
    #[serde(default)]
    table_selection_mode: Option<DoltDumpTableSelectionMode>,
    #[serde(default)]
    selected_tables: Option<Vec<String>>,
    #[serde(default)]
    artifact_retention: Option<DoltDumpArtifactRetention>,
    #[serde(default)]
    output_directory_policy: Option<DoltDumpOutputDirectoryPolicy>,
}

#[derive(Deserialize)]
struct DoltDiffExportConfig {
    #[serde(default)]
    output_format: Option<DoltDumpOutputFormat>,
    #[serde(default)]
    change_filter: Option<DoltDiffExportChangeFilter>,
    #[serde(default)]
    deleted_row_handling: Option<DoltDiffExportDeletedRowHandling>,
}

#[derive(Deserialize)]
struct LoadToDuckDbConfig {
    target_schema: String,
    #[serde(default)]
    table_mapping: Option<LoadToDuckDbTableMapping>,
    #[serde(default)]
    schema_handling: Option<LoadToDuckDbSchemaHandling>,
    #[serde(default)]
    delta_context_preservation: Option<LoadToDuckDbDeltaContextPreservation>,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum CheckpointWriteCommitSource {
    #[serde(rename = "metadata.current_commit")]
    MetadataCurrentCommit,
}

impl CheckpointWriteCommitSource {
    fn as_str(self) -> &'static str {
        match self {
            Self::MetadataCurrentCommit => "metadata.current_commit",
        }
    }
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum CheckpointWriteTiming {
    AfterMergeSuccess,
    AfterQualityGate,
}

impl CheckpointWriteTiming {
    fn as_str(self) -> &'static str {
        match self {
            Self::AfterMergeSuccess => "after_merge_success",
            Self::AfterQualityGate => "after_quality_gate",
        }
    }
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum QualityCheckSuitePreset {
    PostMergeIngestGate,
    CustomRuleBundle,
}

impl QualityCheckSuitePreset {
    fn as_str(self) -> &'static str {
        match self {
            Self::PostMergeIngestGate => "post_merge_ingest_gate",
            Self::CustomRuleBundle => "custom_rule_bundle",
        }
    }
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum QualityCheckSchemaDriftRule {
    FailOnRequiredColumnDrift,
    AllowAdditiveSchemaNotes,
}

impl QualityCheckSchemaDriftRule {
    fn as_str(self) -> &'static str {
        match self {
            Self::FailOnRequiredColumnDrift => "fail_on_required_column_drift",
            Self::AllowAdditiveSchemaNotes => "allow_additive_schema_notes",
        }
    }
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum QualityCheckNullKeyPolicy {
    BlockOnPrimaryKeyNulls,
    AllowNullsWithWarning,
}

impl QualityCheckNullKeyPolicy {
    fn as_str(self) -> &'static str {
        match self {
            Self::BlockOnPrimaryKeyNulls => "block_on_primary_key_nulls",
            Self::AllowNullsWithWarning => "allow_nulls_with_warning",
        }
    }
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum DoltCloneMode {
    ReuseLocalCopy,
    FreshClone,
    Depth1,
}

impl DoltCloneMode {
    fn as_str(self) -> &'static str {
        match self {
            Self::ReuseLocalCopy => "reuse_local_copy",
            Self::FreshClone => "fresh_clone",
            Self::Depth1 => "depth_1",
        }
    }

    fn working_copy_label(self) -> &'static str {
        match self {
            Self::ReuseLocalCopy => "reused across runs",
            Self::FreshClone => "fresh clone per run",
            Self::Depth1 => "shallow clone reused",
        }
    }
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum DoltSyncStrategy {
    PullBeforeExecution,
    CloneOnly,
    Manual,
}

impl DoltSyncStrategy {
    fn as_str(self) -> &'static str {
        match self {
            Self::PullBeforeExecution => "pull_before_execution",
            Self::CloneOnly => "clone_only",
            Self::Manual => "manual",
        }
    }
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum DoltRepoSyncAction {
    PullRemoteHead,
    FetchAndCheckout,
    RefreshCheckout,
}

impl DoltRepoSyncAction {
    fn as_str(self) -> &'static str {
        match self {
            Self::PullRemoteHead => "pull_remote_head",
            Self::FetchAndCheckout => "fetch_and_checkout",
            Self::RefreshCheckout => "refresh_checkout",
        }
    }
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum DoltRepoSyncNoChangeBehavior {
    EmitCurrentRange,
    EmitNoOpMarker,
}

impl DoltRepoSyncNoChangeBehavior {
    fn as_str(self) -> &'static str {
        match self {
            Self::EmitCurrentRange => "emit_current_range",
            Self::EmitNoOpMarker => "emit_no_op_marker",
        }
    }
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum DoltRepoSyncBranchGuard {
    RequireTrackedBranchMatch,
    AllowDetachedHead,
}

impl DoltRepoSyncBranchGuard {
    fn as_str(self) -> &'static str {
        match self {
            Self::RequireTrackedBranchMatch => "require_tracked_branch_match",
            Self::AllowDetachedHead => "allow_detached_head",
        }
    }
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum DoltRepoSyncDirtyWorkingCopyPolicy {
    FailIfDirty,
    StashAndContinue,
}

impl DoltRepoSyncDirtyWorkingCopyPolicy {
    fn as_str(self) -> &'static str {
        match self {
            Self::FailIfDirty => "fail_if_dirty",
            Self::StashAndContinue => "stash_and_continue",
        }
    }
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum DoltChangeManifestTableScope {
    AllTables,
    Allowlist,
}

impl DoltChangeManifestTableScope {
    fn as_str(self) -> &'static str {
        match self {
            Self::AllTables => "all_tables",
            Self::Allowlist => "allowlist",
        }
    }
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum DoltChangeManifestSchemaChangePolicy {
    FlagAndContinue,
    FailRun,
}

impl DoltChangeManifestSchemaChangePolicy {
    fn as_str(self) -> &'static str {
        match self {
            Self::FlagAndContinue => "flag_and_continue",
            Self::FailRun => "fail_run",
        }
    }
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum DoltDumpOutputFormat {
    Csv,
    Parquet,
}

impl DoltDumpOutputFormat {
    fn as_str(self) -> &'static str {
        match self {
            Self::Csv => "csv",
            Self::Parquet => "parquet",
        }
    }

    fn file_extension(self) -> &'static str {
        self.as_str()
    }
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum DoltDumpTableSelectionMode {
    PreferManifestScope,
    AllTables,
    ManualTables,
}

impl DoltDumpTableSelectionMode {
    fn as_str(self) -> &'static str {
        match self {
            Self::PreferManifestScope => "prefer_manifest_scope",
            Self::AllTables => "all_tables",
            Self::ManualTables => "manual_tables",
        }
    }
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum DoltDumpArtifactRetention {
    KeepLatestSuccess,
    EphemeralPerRun,
    PersistAll,
}

impl DoltDumpArtifactRetention {
    fn as_str(self) -> &'static str {
        match self {
            Self::KeepLatestSuccess => "keep_latest_success",
            Self::EphemeralPerRun => "ephemeral_per_run",
            Self::PersistAll => "persist_all",
        }
    }
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum DoltDumpOutputDirectoryPolicy {
    EphemeralRunBundle,
    StableRepoCache,
}

impl DoltDumpOutputDirectoryPolicy {
    fn as_str(self) -> &'static str {
        match self {
            Self::EphemeralRunBundle => "ephemeral_run_bundle",
            Self::StableRepoCache => "stable_repo_cache",
        }
    }
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum DoltDiffExportChangeFilter {
    AllChanges,
    NonDeleteChanges,
    AddedOnly,
    ModifiedOnly,
    RemovedOnly,
}

impl DoltDiffExportChangeFilter {
    fn as_str(self) -> &'static str {
        match self {
            Self::AllChanges => "all_changes",
            Self::NonDeleteChanges => "non_delete_changes",
            Self::AddedOnly => "added_only",
            Self::ModifiedOnly => "modified_only",
            Self::RemovedOnly => "removed_only",
        }
    }
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum DoltDiffExportDeletedRowHandling {
    EmitDeleteMarkers,
    OmitDeleteRows,
}

impl DoltDiffExportDeletedRowHandling {
    fn as_str(self) -> &'static str {
        match self {
            Self::EmitDeleteMarkers => "emit_delete_markers",
            Self::OmitDeleteRows => "omit_delete_rows",
        }
    }
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum LoadToDuckDbTableMapping {
    BundleAwareStagingNames,
}

impl LoadToDuckDbTableMapping {
    fn as_str(self) -> &'static str {
        match self {
            Self::BundleAwareStagingNames => "bundle_aware_staging_names",
        }
    }
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum LoadToDuckDbSchemaHandling {
    InferOnFirstLoadValidateOnRecurring,
}

impl LoadToDuckDbSchemaHandling {
    fn as_str(self) -> &'static str {
        match self {
            Self::InferOnFirstLoadValidateOnRecurring => {
                "infer_on_first_load_validate_on_recurring"
            }
        }
    }
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum LoadToDuckDbDeltaContextPreservation {
    PreserveCommitRangeAndDeleteFlags,
}

impl LoadToDuckDbDeltaContextPreservation {
    fn as_str(self) -> &'static str {
        match self {
            Self::PreserveCommitRangeAndDeleteFlags => "preserve_commit_range_and_delete_flags",
        }
    }
}

#[derive(Clone, Copy)]
struct MockDoltRepoProfile {
    repo_family: &'static str,
    previous_commit: &'static str,
    current_commit: &'static str,
}

#[derive(Clone, Copy)]
struct MockDoltChangeManifestTableSummary {
    added_rows: u64,
    modified_rows: u64,
    removed_rows: u64,
    schema_changed: bool,
    table_name: &'static str,
}

#[derive(Deserialize)]
struct DoltRepoDatasetPayload {
    kind: String,
    repo_ref: DoltRepoReferencePayload,
    #[serde(default)]
    metadata: Option<DoltRepoDatasetMetadataPayload>,
}

#[derive(Deserialize)]
struct DoltChangeManifestDatasetPayload {
    repo_ref: DoltRepoReferencePayload,
    #[serde(default)]
    metadata: Option<DoltChangeManifestDatasetMetadataPayload>,
}

#[derive(Default, Deserialize)]
struct DoltRepoDatasetMetadataPayload {
    #[serde(default)]
    current_commit: Option<String>,
    #[serde(default)]
    previous_commit: Option<String>,
    #[serde(default)]
    repo_family: Option<String>,
    #[serde(default)]
    resolution_mode: Option<String>,
    #[serde(default)]
    working_copy_path: Option<String>,
}

#[derive(Default, Deserialize)]
struct CheckpointContextPayload {
    kind: String,
    #[serde(default)]
    checkpoint_table: Option<String>,
    #[serde(default, rename = "source_repo")]
    _source_repo: Option<String>,
    #[serde(default, rename = "branch")]
    _branch: Option<String>,
    #[serde(default)]
    last_synced_commit: Option<String>,
    #[serde(default)]
    last_success_at: Option<String>,
    #[serde(default)]
    last_ingest_mode: Option<String>,
    #[serde(default)]
    bootstrap_pending: bool,
    #[serde(default, rename = "fail_on_stale_checkpoint")]
    _fail_on_stale_checkpoint: bool,
    #[serde(default, rename = "stale_checkpoint")]
    _stale_checkpoint: bool,
}

#[derive(Default, Deserialize)]
struct DoltChangeManifestDatasetMetadataPayload {
    #[serde(default)]
    changed_tables: Option<Vec<String>>,
    #[serde(default)]
    current_commit: Option<String>,
    #[serde(default)]
    previous_commit: Option<String>,
    #[serde(default)]
    repo_family: Option<String>,
    #[serde(default)]
    row_change_summary: Option<BTreeMap<String, DoltChangeRowSummaryPayload>>,
    #[serde(default)]
    schema_change_flags: Option<Vec<String>>,
}

#[derive(Clone, Default, Deserialize)]
struct DoltChangeRowSummaryPayload {
    #[serde(default)]
    added: u64,
    #[serde(default)]
    modified: u64,
    #[serde(default)]
    removed: u64,
}

#[derive(Clone)]
struct ResolvedDoltDiffTableSummary {
    added_rows: u64,
    modified_rows: u64,
    removed_rows: u64,
    table_name: String,
}

#[derive(Deserialize)]
struct DoltRepoReferencePayload {
    connection_ref: String,
    repository: String,
    branch: String,
    #[serde(default)]
    checkout_ref: Option<String>,
    current_commit: String,
}

#[derive(Deserialize)]
struct DirectoryReferencePayload {
    path: String,
    #[serde(default)]
    format: Option<String>,
}

#[derive(Deserialize)]
struct DoltDumpBundlePayload {
    kind: String,
    directory_ref: DirectoryReferencePayload,
    repo_ref: DoltRepoReferencePayload,
    #[serde(default)]
    metadata: Option<DoltDumpBundleMetadataPayload>,
}

#[derive(Default, Deserialize)]
struct DoltDumpBundleMetadataPayload {
    #[serde(default)]
    exported_tables: Option<Vec<DoltDumpExportedTablePayload>>,
    #[serde(default)]
    previous_commit: Option<String>,
    #[serde(default)]
    repo_family: Option<String>,
}

#[derive(Default, Deserialize)]
struct DoltDumpExportedTablePayload {
    #[serde(default)]
    file_path: Option<String>,
    #[serde(default)]
    row_count: Option<u64>,
    source_table: String,
}

#[derive(Deserialize)]
struct DoltDiffExportBundlePayload {
    kind: String,
    directory_ref: DirectoryReferencePayload,
    repo_ref: DoltRepoReferencePayload,
    #[serde(default)]
    metadata: Option<DoltDiffExportBundleMetadataPayload>,
}

#[derive(Default, Deserialize)]
struct DoltDiffExportBundleMetadataPayload {
    #[serde(default)]
    current_commit: Option<String>,
    #[serde(default)]
    delete_rows_present: Option<bool>,
    #[serde(default)]
    delta_manifest: Option<Vec<DoltDiffDeltaManifestPayload>>,
    #[serde(default)]
    previous_commit: Option<String>,
    #[serde(default)]
    repo_family: Option<String>,
}

#[derive(Default, Deserialize)]
struct DoltDiffDeltaManifestPayload {
    #[serde(default)]
    added_rows: Option<u64>,
    #[serde(default)]
    delete_marker_path: Option<String>,
    #[serde(default)]
    delete_markers_emitted: Option<bool>,
    #[serde(default)]
    file_path: Option<String>,
    #[serde(default)]
    modified_rows: Option<u64>,
    #[serde(default)]
    removed_rows: Option<u64>,
    source_table: String,
}

#[derive(Deserialize)]
struct TextInputConfig {
    text: String,
    #[serde(default)]
    include_line_breaks: Option<bool>,
    #[serde(default)]
    preserve_whitespace: Option<bool>,
    #[serde(default)]
    trim_mode: Option<TextTrimMode>,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum TextTrimMode {
    Automatic,
    Trim,
    Exact,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum TransformOperation {
    Identity,
    Uppercase,
    Trim,
}

#[derive(Deserialize)]
struct TextTransformConfig {
    #[serde(default)]
    operation: Option<TransformOperation>,
}

#[derive(Deserialize)]
struct PreviewOutputConfig {
    #[serde(default)]
    title: Option<String>,
}

#[derive(Deserialize)]
struct TableInputConfig {
    #[serde(default)]
    catalog: Option<String>,
    schema_name: String,
    table_name: String,
    #[serde(default)]
    output_alias: Option<String>,
    #[serde(default)]
    selected_columns: Option<Vec<String>>,
    #[serde(default)]
    row_filter: Option<String>,
    #[serde(default)]
    row_limit: Option<u64>,
    #[serde(default)]
    refresh_schema: Option<bool>,
    #[serde(default)]
    open_in_catalog: Option<bool>,
}

#[derive(Clone, Deserialize)]
struct TableSchemaColumn {
    name: String,
    #[serde(rename = "type")]
    column_type: String,
    #[serde(default)]
    nullable: Option<bool>,
    #[serde(default)]
    primary_key: Option<bool>,
    #[serde(default)]
    default: Option<String>,
}

#[derive(Clone, Deserialize)]
struct TableSchemaTableConfig {
    schema_name: String,
    table_name: String,
    #[serde(default)]
    output_alias: Option<String>,
    columns: Vec<TableSchemaColumn>,
    #[serde(default)]
    primary_key: Option<Vec<String>>,
    #[serde(default)]
    checks: Option<Vec<String>>,
    #[serde(default)]
    create_mode: Option<String>,
    #[serde(default)]
    if_target_exists: Option<String>,
}

#[derive(Deserialize)]
struct TableSchemaConfig {
    #[serde(default)]
    catalog: Option<String>,
    schema_name: String,
    table_name: String,
    #[serde(default)]
    output_alias: Option<String>,
    columns: Vec<TableSchemaColumn>,
    #[serde(default)]
    primary_key: Option<Vec<String>>,
    #[serde(default)]
    checks: Option<Vec<String>>,
    #[serde(default)]
    create_mode: Option<String>,
    #[serde(default)]
    if_target_exists: Option<String>,
    #[serde(default)]
    open_in_catalog: Option<bool>,
    #[serde(default)]
    tables: Option<Vec<TableSchemaTableConfig>>,
}

#[derive(Deserialize)]
struct TableOutputConfig {
    target_schema: String,
    table_name: String,
    #[serde(default)]
    write_mode: Option<TableWriteMode>,
    #[serde(default)]
    input_shape: Option<TableInputShape>,
    #[serde(default)]
    value_column: Option<String>,
    #[serde(default)]
    include_run_id: Option<bool>,
    #[serde(default)]
    include_written_at: Option<bool>,
    #[serde(default)]
    open_in_catalog: Option<bool>,
}

#[derive(Deserialize)]
struct SqlTransformConfig {
    target_schema: String,
    output_table_name: String,
    sql_text: String,
    #[serde(default)]
    source_table_name: Option<String>,
    #[serde(default)]
    materialization_mode: Option<SqlTransformMaterializationMode>,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum SqlTransformMaterializationMode {
    View,
}

#[derive(Deserialize)]
struct TableMergeConfig {
    target_schema: String,
    #[serde(default)]
    write_policy: Option<TableMergeWritePolicy>,
    #[serde(default)]
    merge_key_columns: Option<Vec<String>>,
    #[serde(default)]
    delete_handling: Option<TableMergeDeleteHandling>,
    #[serde(default)]
    schema_drift_behavior: Option<TableMergeSchemaDriftBehavior>,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum TableMergeWritePolicy {
    Upsert,
    AppendOnly,
    SnapshotReplace,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum TableMergeDeleteHandling {
    ApplyDeleteMarkers,
    IgnoreDeleteMarkers,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum TableMergeSchemaDriftBehavior {
    FailAndRequireReview,
    AllowAdditiveChanges,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum TableWriteMode {
    Append,
    Replace,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum TableInputShape {
    SingleTextRow,
    SourceTable,
    TableSchema,
}

#[derive(Deserialize)]
struct TableReferencePayload {
    kind: String,
    catalog: String,
    schema_name: String,
    table_name: String,
    output_alias: String,
    #[serde(default)]
    selected_columns: Vec<String>,
    #[serde(default)]
    row_filter: Option<String>,
    #[serde(default)]
    row_limit: Option<u64>,
    #[serde(default, rename = "refresh_schema")]
    _refresh_schema: bool,
    #[serde(default)]
    open_in_catalog: bool,
    #[serde(default)]
    schema_definition: Option<Value>,
    #[serde(default)]
    schema_definitions: Option<Value>,
    #[serde(default)]
    load_manifest_ref: Option<Value>,
    #[serde(default)]
    metadata: Option<Value>,
}

#[derive(Deserialize)]
struct SendEmailConfig {
    to: String,
    subject: String,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    body_mode: Option<SendEmailBodyMode>,
    #[serde(default)]
    body_text: Option<String>,
    #[serde(default)]
    connection_id: Option<String>,
    #[serde(default)]
    content_type: Option<String>,
    #[serde(default)]
    runtime_delivery: Option<SendEmailRuntimeDelivery>,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum SendEmailBodyMode {
    Input,
    Custom,
}

#[derive(Deserialize)]
struct SendEmailRuntimeDelivery {
    provider: String,
    #[serde(default)]
    access_token: Option<String>,
    #[serde(default)]
    send_as_email: Option<String>,
    #[serde(default)]
    connection_id: Option<String>,
    #[serde(default)]
    connection_label: Option<String>,
}

#[derive(Deserialize)]
struct GmailSendResponse {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    thread_id: Option<String>,
}

fn execute_dolt_repo_source(
    node: &WorkflowNode,
    context: &AdapterExecutionContext,
) -> Result<NodeExecutionResult, AdapterError> {
    let config: DoltRepoSourceConfig =
        serde_json::from_value(node.config.clone()).map_err(|error| {
            AdapterError::InvalidConfig {
                node_id: node.node_id.clone(),
                message: error.to_string(),
            }
        })?;

    let clone_mode = config.clone_mode.unwrap_or(DoltCloneMode::ReuseLocalCopy);
    let sync_strategy = config
        .sync_strategy
        .unwrap_or(DoltSyncStrategy::PullBeforeExecution);
    let repository = config.repository.trim().to_string();
    let repo_family = derive_dolt_repo_family(&repository);
    let checkout_ref = normalize_optional_config_string(config.checkout_ref);
    let managed_workflow_storage = managed_workflow_root_from_context(context).is_some();
    let (current_commit, resolution_mode, working_copy_path) =
        if managed_workflow_storage && !context.disable_live_dolt {
            let prepared = prepare_actual_dolt_working_copy(
                context,
                &repository,
                config.branch.trim(),
                checkout_ref.as_deref(),
                clone_mode,
                sync_strategy,
                &node.node_id,
            )?;
            (
                prepared.current_commit,
                "live_dolt".to_string(),
                Some(prepared.repo_dir.display().to_string()),
            )
        } else {
            let profile = mock_dolt_repo_profile(&repository);
            (
                resolve_dolt_current_commit(profile, checkout_ref.as_deref()),
                if context.disable_live_dolt {
                    "mock_profile_live_dolt_disabled".to_string()
                } else {
                    "mock_profile".to_string()
                },
                None,
            )
        };
    let log_commit = current_commit.clone();
    let mut outputs = PortValues::new();
    let repo_payload = TypedValue {
        data_type: DataType::DatasetRef,
        value: json!({
            "kind": "dolt_repo_dataset",
            "repo_ref": {
                "connection_ref": config.connection_ref.trim(),
                "repository": repository,
                "branch": config.branch.trim(),
                "checkout_ref": checkout_ref,
                "current_commit": current_commit,
            },
            "metadata": {
                "repo_family": repo_family,
                "current_commit": current_commit,
                "clone_mode": clone_mode.as_str(),
                "sync_strategy": sync_strategy.as_str(),
                "working_copy": clone_mode.working_copy_label(),
                "working_copy_path": working_copy_path,
                "resolution_mode": resolution_mode,
            }
        }),
    };
    outputs.insert("repo_out".to_string(), repo_payload.clone());
    outputs.insert("repo".to_string(), repo_payload);

    Ok(NodeExecutionResult {
        outputs,
        logs: vec![format!(
            "Prepared Dolt repo `{}` at commit `{}` with `{}` sync strategy.",
            config.repository.trim(),
            log_commit,
            sync_strategy.as_str()
        )],
    })
}

fn execute_checkpoint_read(node: &WorkflowNode) -> Result<NodeExecutionResult, AdapterError> {
    let config: CheckpointReadConfig =
        serde_json::from_value(node.config.clone()).map_err(|error| {
            AdapterError::InvalidConfig {
                node_id: node.node_id.clone(),
                message: error.to_string(),
            }
        })?;

    let checkpoint_table = config.checkpoint_table.trim().to_string();
    let source_repo = config.source_repo.trim().to_string();
    let branch = config.branch.trim().to_string();

    if checkpoint_table.is_empty() || source_repo.is_empty() || branch.is_empty() {
        return Err(AdapterError::InvalidConfig {
            node_id: node.node_id.clone(),
            message: "`checkpoint_table`, `source_repo`, and `branch` must all be non-empty."
                .to_string(),
        });
    }

    let emit_bootstrap_marker_if_missing = config.emit_bootstrap_marker_if_missing.unwrap_or(true);
    let fail_on_stale_checkpoint = config.fail_on_stale_checkpoint.unwrap_or(false);
    let profile = mock_dolt_repo_profile(&source_repo);

    let (last_synced_commit, last_success_at, last_ingest_mode, bootstrap_pending) =
        if let Some(profile) = profile {
            (
                Some(profile.previous_commit.to_string()),
                Some(mock_checkpoint_success_at(&source_repo).to_string()),
                Some(mock_checkpoint_ingest_mode(&source_repo).to_string()),
                false,
            )
        } else if emit_bootstrap_marker_if_missing {
            (None, None, Some("bootstrap_pending".to_string()), true)
        } else {
            return Err(AdapterError::ExecutionFailed {
                node_id: node.node_id.clone(),
                message: format!(
                    "no checkpoint was found for `{}` on branch `{}`.",
                    source_repo, branch
                ),
            });
        };

    let mut outputs = PortValues::new();
    outputs.insert(
        "checkpoint".to_string(),
        TypedValue {
            data_type: DataType::Json,
            value: json!({
                "kind": "checkpoint_context",
                "checkpoint_table": checkpoint_table,
                "source_repo": source_repo,
                "branch": branch,
                "last_synced_commit": last_synced_commit,
                "last_success_at": last_success_at,
                "last_ingest_mode": last_ingest_mode,
                "bootstrap_pending": bootstrap_pending,
                "fail_on_stale_checkpoint": fail_on_stale_checkpoint,
                "stale_checkpoint": false,
            }),
        },
    );

    Ok(NodeExecutionResult {
        outputs,
        logs: vec![format!(
            "Resolved checkpoint context for `{}` on `{}` from `{}` (bootstrap pending: {}).",
            config.source_repo.trim(),
            config.branch.trim(),
            config.checkpoint_table.trim(),
            bootstrap_pending
        )],
    })
}

fn execute_dolt_repo_sync(
    node: &WorkflowNode,
    inputs: &PortValues,
) -> Result<NodeExecutionResult, AdapterError> {
    let config: DoltRepoSyncConfig =
        serde_json::from_value(node.config.clone()).map_err(|error| {
            AdapterError::InvalidConfig {
                node_id: node.node_id.clone(),
                message: error.to_string(),
            }
        })?;

    let repo_input = inputs
        .get("repo")
        .ok_or_else(|| AdapterError::MissingInput {
            node_id: node.node_id.clone(),
            port: "repo".to_string(),
        })?;

    if repo_input.data_type != DataType::DatasetRef {
        return Err(AdapterError::DatasetRefTypeMismatch {
            node_id: node.node_id.clone(),
            port: "repo".to_string(),
        });
    }

    let repo_payload: DoltRepoDatasetPayload = serde_json::from_value(repo_input.value.clone())
        .map_err(|error| AdapterError::ExecutionFailed {
            node_id: node.node_id.clone(),
            message: format!("invalid repo dataset payload: {error}"),
        })?;

    if repo_payload.kind != "dolt_repo_dataset" {
        return Err(AdapterError::ExecutionFailed {
            node_id: node.node_id.clone(),
            message: format!("unsupported repo dataset kind `{}`", repo_payload.kind),
        });
    }

    let checkpoint_payload = if let Some(checkpoint_input) = inputs.get("checkpoint") {
        if checkpoint_input.data_type != DataType::Json {
            return Err(AdapterError::ExecutionFailed {
                node_id: node.node_id.clone(),
                message: "dolt_repo_sync expects an optional `json` checkpoint input.".to_string(),
            });
        }

        let payload: CheckpointContextPayload =
            serde_json::from_value(checkpoint_input.value.clone()).map_err(|error| {
                AdapterError::ExecutionFailed {
                    node_id: node.node_id.clone(),
                    message: format!("invalid checkpoint payload: {error}"),
                }
            })?;

        if payload.kind != "checkpoint_context" {
            return Err(AdapterError::ExecutionFailed {
                node_id: node.node_id.clone(),
                message: format!("unsupported checkpoint kind `{}`", payload.kind),
            });
        }

        Some(payload)
    } else {
        None
    };

    let sync_action = config
        .sync_action
        .unwrap_or(DoltRepoSyncAction::PullRemoteHead);
    let no_change_behavior = config
        .no_change_behavior
        .unwrap_or(DoltRepoSyncNoChangeBehavior::EmitCurrentRange);
    let branch_guard = config
        .branch_guard
        .unwrap_or(DoltRepoSyncBranchGuard::RequireTrackedBranchMatch);
    let dirty_working_copy_policy = config
        .dirty_working_copy_policy
        .unwrap_or(DoltRepoSyncDirtyWorkingCopyPolicy::FailIfDirty);
    let repository = repo_payload.repo_ref.repository.trim().to_string();
    let repo_family = derive_dolt_repo_family(&repository);
    let profile = mock_dolt_repo_profile(&repository);
    let previous_commit = if let Some(payload) = checkpoint_payload.as_ref() {
        normalize_non_empty_string(payload.last_synced_commit.clone())
            .unwrap_or_else(|| "pending_checkpoint".to_string())
    } else {
        resolve_dolt_previous_commit(profile)
    };
    let current_commit =
        normalize_non_empty_string(Some(repo_payload.repo_ref.current_commit.clone()))
            .unwrap_or_else(|| resolve_dolt_current_commit(profile, None));
    let connection_ref = repo_payload.repo_ref.connection_ref.trim().to_string();
    let branch = repo_payload.repo_ref.branch.trim().to_string();
    let checkout_ref = normalize_optional_config_string(repo_payload.repo_ref.checkout_ref);
    let mut outputs = PortValues::new();
    outputs.insert(
        "repo_out".to_string(),
        TypedValue {
            data_type: DataType::DatasetRef,
            value: json!({
                "kind": "dolt_repo_dataset",
                "repo_ref": {
                    "connection_ref": connection_ref,
                    "repository": repository,
                    "branch": branch,
                    "checkout_ref": checkout_ref,
                    "current_commit": current_commit.clone(),
                },
                "metadata": {
                    "repo_family": repo_family,
                    "previous_commit": previous_commit.clone(),
                    "current_commit": current_commit.clone(),
                    "checkpoint_table": checkpoint_payload
                        .as_ref()
                        .and_then(|payload| payload.checkpoint_table.clone()),
                    "checkpoint_last_success_at": checkpoint_payload
                        .as_ref()
                        .and_then(|payload| payload.last_success_at.clone()),
                    "checkpoint_last_ingest_mode": checkpoint_payload
                        .as_ref()
                        .and_then(|payload| payload.last_ingest_mode.clone()),
                    "checkpoint_bootstrap_pending": checkpoint_payload
                        .as_ref()
                        .map(|payload| payload.bootstrap_pending)
                        .unwrap_or(false),
                    "sync_action": sync_action.as_str(),
                    "no_change_behavior": no_change_behavior.as_str(),
                    "branch_guard": branch_guard.as_str(),
                    "dirty_working_copy_policy": dirty_working_copy_policy.as_str(),
                }
            }),
        },
    );

    Ok(NodeExecutionResult {
        outputs,
        logs: vec![format!(
            "Synced Dolt repo `{}` from `{}` to `{}` using `{}`.",
            repo_payload.repo_ref.repository.trim(),
            previous_commit,
            current_commit,
            sync_action.as_str()
        )],
    })
}

fn execute_dolt_change_manifest(
    node: &WorkflowNode,
    inputs: &PortValues,
) -> Result<NodeExecutionResult, AdapterError> {
    let config: DoltChangeManifestConfig =
        serde_json::from_value(node.config.clone()).map_err(|error| {
            AdapterError::InvalidConfig {
                node_id: node.node_id.clone(),
                message: error.to_string(),
            }
        })?;

    let repo_input = inputs
        .get("repo")
        .ok_or_else(|| AdapterError::MissingInput {
            node_id: node.node_id.clone(),
            port: "repo".to_string(),
        })?;

    if repo_input.data_type != DataType::DatasetRef {
        return Err(AdapterError::DatasetRefTypeMismatch {
            node_id: node.node_id.clone(),
            port: "repo".to_string(),
        });
    }

    let repo_payload: DoltRepoDatasetPayload = serde_json::from_value(repo_input.value.clone())
        .map_err(|error| AdapterError::ExecutionFailed {
            node_id: node.node_id.clone(),
            message: format!("invalid repo dataset payload: {error}"),
        })?;

    if repo_payload.kind != "dolt_repo_dataset" {
        return Err(AdapterError::ExecutionFailed {
            node_id: node.node_id.clone(),
            message: format!("unsupported repo dataset kind `{}`", repo_payload.kind),
        });
    }

    let table_scope = config
        .table_scope
        .unwrap_or(DoltChangeManifestTableScope::AllTables);
    let schema_change_policy = config
        .schema_change_policy
        .unwrap_or(DoltChangeManifestSchemaChangePolicy::FlagAndContinue);
    let selected_tables = normalize_selected_table_names(config.selected_tables);
    let repository = repo_payload.repo_ref.repository.trim().to_string();
    let profile = mock_dolt_repo_profile(&repository);
    let repo_family = repo_payload
        .metadata
        .as_ref()
        .and_then(|metadata| normalize_non_empty_string(metadata.repo_family.clone()))
        .unwrap_or_else(|| derive_dolt_repo_family(&repository));
    let previous_commit = repo_payload
        .metadata
        .as_ref()
        .and_then(|metadata| normalize_non_empty_string(metadata.previous_commit.clone()))
        .unwrap_or_else(|| resolve_dolt_previous_commit(profile));
    let current_commit = repo_payload
        .metadata
        .as_ref()
        .and_then(|metadata| normalize_non_empty_string(metadata.current_commit.clone()))
        .or_else(|| normalize_non_empty_string(Some(repo_payload.repo_ref.current_commit.clone())))
        .unwrap_or_else(|| resolve_dolt_current_commit(profile, None));
    let changed_tables = filter_manifest_table_summaries_for_scope(
        mock_dolt_change_manifest_summaries(&repository),
        table_scope,
        &selected_tables,
    );
    let changed_table_names: Vec<String> = changed_tables
        .iter()
        .map(|summary| summary.table_name.to_string())
        .collect();
    let schema_change_flags: Vec<String> = changed_tables
        .iter()
        .filter(|summary| summary.schema_changed)
        .map(|summary| summary.table_name.to_string())
        .collect();
    let row_change_summary = changed_tables
        .iter()
        .map(|summary| {
            (
                summary.table_name.to_string(),
                json!({
                    "added": summary.added_rows,
                    "modified": summary.modified_rows,
                    "removed": summary.removed_rows
                }),
            )
        })
        .collect::<serde_json::Map<String, Value>>();

    let mut outputs = PortValues::new();
    outputs.insert(
        "manifest".to_string(),
        TypedValue {
            data_type: DataType::DatasetRef,
            value: json!({
                "kind": "dolt_change_manifest_dataset",
                "repo_ref": {
                    "connection_ref": repo_payload.repo_ref.connection_ref.trim(),
                    "repository": repository,
                    "branch": repo_payload.repo_ref.branch.trim(),
                    "checkout_ref": normalize_optional_config_string(repo_payload.repo_ref.checkout_ref),
                    "current_commit": current_commit.clone(),
                },
                "manifest_ref": {
                    "previous_commit": previous_commit.clone(),
                    "current_commit": current_commit.clone(),
                    "table_scope": table_scope.as_str(),
                },
                "metadata": {
                    "repo_family": repo_family,
                    "previous_commit": previous_commit.clone(),
                    "current_commit": current_commit.clone(),
                    "table_scope": table_scope.as_str(),
                    "selected_tables": selected_tables,
                    "schema_change_policy": schema_change_policy.as_str(),
                    "changed_tables": changed_table_names,
                    "schema_change_flags": schema_change_flags,
                    "row_change_summary": row_change_summary,
                }
            }),
        },
    );

    Ok(NodeExecutionResult {
        outputs,
        logs: vec![format!(
            "Computed Dolt change manifest for `{}` across `{}` -> `{}` with `{}` changed table(s).",
            repo_payload.repo_ref.repository.trim(),
            previous_commit,
            current_commit,
            changed_tables.len()
        )],
    })
}

fn execute_dolt_dump(
    node: &WorkflowNode,
    inputs: &PortValues,
    context: &AdapterExecutionContext,
) -> Result<NodeExecutionResult, AdapterError> {
    let config: DoltDumpConfig = serde_json::from_value(node.config.clone()).map_err(|error| {
        AdapterError::InvalidConfig {
            node_id: node.node_id.clone(),
            message: error.to_string(),
        }
    })?;

    let repo_input = inputs
        .get("repo")
        .ok_or_else(|| AdapterError::MissingInput {
            node_id: node.node_id.clone(),
            port: "repo".to_string(),
        })?;

    if repo_input.data_type != DataType::DatasetRef {
        return Err(AdapterError::DatasetRefTypeMismatch {
            node_id: node.node_id.clone(),
            port: "repo".to_string(),
        });
    }

    let input_kind = repo_input
        .value
        .get("kind")
        .and_then(Value::as_str)
        .unwrap_or_default();

    let output_format = config
        .output_format
        .unwrap_or(DoltDumpOutputFormat::Parquet);
    let table_selection_mode = config
        .table_selection_mode
        .unwrap_or(DoltDumpTableSelectionMode::PreferManifestScope);
    let selected_tables = normalize_selected_table_names(config.selected_tables);
    let artifact_retention = config
        .artifact_retention
        .unwrap_or(DoltDumpArtifactRetention::KeepLatestSuccess);
    let output_directory_policy = config
        .output_directory_policy
        .unwrap_or(DoltDumpOutputDirectoryPolicy::EphemeralRunBundle);

    let (
        connection_ref,
        repository,
        branch,
        checkout_ref,
        current_commit,
        previous_commit,
        repo_family,
        manifest_changed_tables,
        upstream_live_working_copy_path,
        source_kind_label,
    ) = match input_kind {
        "dolt_repo_dataset" => {
            let repo_payload: DoltRepoDatasetPayload =
                serde_json::from_value(repo_input.value.clone()).map_err(|error| {
                    AdapterError::ExecutionFailed {
                        node_id: node.node_id.clone(),
                        message: format!("invalid repo dataset payload: {error}"),
                    }
                })?;
            let repository = repo_payload.repo_ref.repository.trim().to_string();
            let profile = mock_dolt_repo_profile(&repository);
            let current_commit =
                normalize_non_empty_string(Some(repo_payload.repo_ref.current_commit.clone()))
                    .unwrap_or_else(|| resolve_dolt_current_commit(profile, None));
            let previous_commit = repo_payload
                .metadata
                .as_ref()
                .and_then(|metadata| normalize_non_empty_string(metadata.previous_commit.clone()))
                .unwrap_or_else(|| resolve_dolt_previous_commit(profile));
            let repo_family = repo_payload
                .metadata
                .as_ref()
                .and_then(|metadata| normalize_non_empty_string(metadata.repo_family.clone()))
                .unwrap_or_else(|| derive_dolt_repo_family(&repository));
            let upstream_live_working_copy_path =
                resolve_upstream_live_working_copy_path(repo_payload.metadata.as_ref());

            (
                repo_payload.repo_ref.connection_ref.trim().to_string(),
                repository,
                repo_payload.repo_ref.branch.trim().to_string(),
                normalize_optional_config_string(repo_payload.repo_ref.checkout_ref),
                current_commit,
                previous_commit,
                repo_family,
                Vec::new(),
                upstream_live_working_copy_path,
                "repo_handle",
            )
        }
        "dolt_change_manifest_dataset" => {
            let manifest_payload: DoltChangeManifestDatasetPayload =
                serde_json::from_value(repo_input.value.clone()).map_err(|error| {
                    AdapterError::ExecutionFailed {
                        node_id: node.node_id.clone(),
                        message: format!("invalid change manifest dataset payload: {error}"),
                    }
                })?;
            let repository = manifest_payload.repo_ref.repository.trim().to_string();
            let profile = mock_dolt_repo_profile(&repository);
            let current_commit = manifest_payload
                .metadata
                .as_ref()
                .and_then(|metadata| normalize_non_empty_string(metadata.current_commit.clone()))
                .or_else(|| {
                    normalize_non_empty_string(Some(
                        manifest_payload.repo_ref.current_commit.clone(),
                    ))
                })
                .unwrap_or_else(|| resolve_dolt_current_commit(profile, None));
            let previous_commit = manifest_payload
                .metadata
                .as_ref()
                .and_then(|metadata| normalize_non_empty_string(metadata.previous_commit.clone()))
                .unwrap_or_else(|| resolve_dolt_previous_commit(profile));
            let repo_family = manifest_payload
                .metadata
                .as_ref()
                .and_then(|metadata| normalize_non_empty_string(metadata.repo_family.clone()))
                .unwrap_or_else(|| derive_dolt_repo_family(&repository));
            let manifest_changed_tables = manifest_payload
                .metadata
                .as_ref()
                .and_then(|metadata| metadata.changed_tables.clone())
                .unwrap_or_default();

            (
                manifest_payload.repo_ref.connection_ref.trim().to_string(),
                repository,
                manifest_payload.repo_ref.branch.trim().to_string(),
                normalize_optional_config_string(manifest_payload.repo_ref.checkout_ref),
                current_commit,
                previous_commit,
                repo_family,
                manifest_changed_tables,
                None,
                "change_manifest",
            )
        }
        other => {
            return Err(AdapterError::ExecutionFailed {
                node_id: node.node_id.clone(),
                message: format!("unsupported dolt dump input kind `{other}`"),
            })
        }
    };

    let export_table_names = resolve_dolt_dump_table_selection(
        &repository,
        table_selection_mode,
        &selected_tables,
        &manifest_changed_tables,
    );
    let mut actual_materialization_error = None;
    let materialized_bundle = if dolt_cli_is_available() && !context.disable_live_dolt {
        match try_materialize_actual_dolt_dump_bundle(
            context,
            output_format,
            &repository,
            &branch,
            checkout_ref.as_deref(),
            &repo_family,
            &current_commit,
            &export_table_names,
            upstream_live_working_copy_path.as_deref(),
            &node.node_id,
        ) {
            Ok(bundle) => bundle,
            Err(error) => {
                actual_materialization_error = Some(error.to_string());
                None
            }
        }
    } else {
        None
    };
    let managed_workflow_storage = managed_workflow_root_from_context(context).is_some();
    let (
        bundle_path,
        effective_current_commit,
        effective_output_format,
        exported_tables,
        materialization_label,
    ) = if let Some(bundle) = materialized_bundle {
        (
            bundle.bundle_path,
            bundle.current_commit,
            bundle.effective_format,
            bundle.exported_tables,
            "materialized bundle files",
        )
    } else if let Some(bundle) = try_resolve_existing_dolt_dump_bundle(
        context,
        output_format,
        &repo_family,
        &current_commit,
        &export_table_names,
    ) {
        (
            bundle.bundle_path,
            bundle.current_commit,
            bundle.effective_format,
            bundle.exported_tables,
            "existing bundle files",
        )
    } else if let Some(bundle) = try_materialize_seeded_dolt_dump_bundle(
        context,
        output_format,
        &repo_family,
        &current_commit,
        &export_table_names,
        &node.node_id,
    )? {
        (
            bundle.bundle_path,
            bundle.current_commit,
            bundle.effective_format,
            bundle.exported_tables,
            "seeded export files",
        )
    } else {
        if managed_workflow_storage {
            let example_table = export_table_names
                .first()
                .map(String::as_str)
                .unwrap_or("table_name");
            let seed_hints = dolt_dump_seed_hints(context, &repo_family, example_table);
            return Err(AdapterError::ExecutionFailed {
                    node_id: node.node_id.clone(),
                    message: format!(
                        "dolt_dump could not materialize bundle files for `{repository}`. Install the Dolt CLI, reuse an existing bundle under `files/{}`, or seed exported files such as {}.{}",
                        build_dolt_dump_bundle_path(&repo_family, &current_commit, output_format),
                        seed_hints
                            .iter()
                            .map(|hint| format!("`{hint}`"))
                            .collect::<Vec<_>>()
                            .join(" or "),
                        actual_materialization_error
                            .as_deref()
                            .map(|detail| format!(" Last Dolt attempt: {detail}"))
                            .unwrap_or_default()
                    ),
                });
        }

        let exported_tables = export_table_names
            .iter()
            .map(|table_name| {
                json!({
                    "source_table": table_name,
                    "file_path": format!(
                        "{}/{}.{}",
                        build_dolt_dump_bundle_path(&repo_family, &current_commit, output_format),
                        table_name,
                        output_format.file_extension()
                    ),
                    "row_count": Value::Null,
                })
            })
            .collect::<Vec<_>>();
        (
            build_dolt_dump_bundle_path(&repo_family, &current_commit, output_format),
            current_commit.clone(),
            output_format,
            exported_tables,
            "metadata-only bundle",
        )
    };

    let mut outputs = PortValues::new();
    outputs.insert(
        "bundle".to_string(),
        TypedValue {
            data_type: DataType::DirectoryRef,
            value: json!({
                "kind": "dolt_dump_bundle",
                "directory_ref": {
                    "path": bundle_path,
                    "format": effective_output_format.as_str(),
                },
                "repo_ref": {
                    "connection_ref": connection_ref,
                    "repository": repository,
                    "branch": branch,
                    "checkout_ref": checkout_ref,
                    "current_commit": effective_current_commit,
                },
                "metadata": {
                    "repo_family": repo_family,
                    "previous_commit": previous_commit,
                    "table_selection_mode": table_selection_mode.as_str(),
                    "selected_tables": selected_tables,
                    "manifest_changed_tables": manifest_changed_tables,
                    "artifact_retention": artifact_retention.as_str(),
                    "output_directory_policy": output_directory_policy.as_str(),
                    "exported_tables": exported_tables,
                }
            }),
        },
    );

    Ok(NodeExecutionResult {
        outputs,
        logs: vec![format!(
            "Exported {} Dolt table(s) from `{}` as `{}` using `{}` input ({materialization_label}).",
            export_table_names.len(),
            repository,
            effective_output_format.as_str(),
            source_kind_label
        )],
    })
}

fn execute_dolt_diff_export(
    node: &WorkflowNode,
    inputs: &PortValues,
) -> Result<NodeExecutionResult, AdapterError> {
    let config: DoltDiffExportConfig =
        serde_json::from_value(node.config.clone()).map_err(|error| {
            AdapterError::InvalidConfig {
                node_id: node.node_id.clone(),
                message: error.to_string(),
            }
        })?;

    let manifest_input = inputs
        .get("manifest")
        .ok_or_else(|| AdapterError::MissingInput {
            node_id: node.node_id.clone(),
            port: "manifest".to_string(),
        })?;

    if manifest_input.data_type != DataType::DatasetRef {
        return Err(AdapterError::DatasetRefTypeMismatch {
            node_id: node.node_id.clone(),
            port: "manifest".to_string(),
        });
    }

    let input_kind = manifest_input
        .value
        .get("kind")
        .and_then(Value::as_str)
        .unwrap_or_default();

    if input_kind != "dolt_change_manifest_dataset" {
        return Err(AdapterError::ExecutionFailed {
            node_id: node.node_id.clone(),
            message: format!("unsupported dolt diff export input kind `{input_kind}`"),
        });
    }

    let manifest_payload: DoltChangeManifestDatasetPayload =
        serde_json::from_value(manifest_input.value.clone()).map_err(|error| {
            AdapterError::ExecutionFailed {
                node_id: node.node_id.clone(),
                message: format!("invalid change manifest dataset payload: {error}"),
            }
        })?;

    let output_format = config
        .output_format
        .unwrap_or(DoltDumpOutputFormat::Parquet);
    let change_filter = config
        .change_filter
        .unwrap_or(DoltDiffExportChangeFilter::AllChanges);
    let deleted_row_handling = config
        .deleted_row_handling
        .unwrap_or(DoltDiffExportDeletedRowHandling::EmitDeleteMarkers);
    let repository = manifest_payload.repo_ref.repository.trim().to_string();
    let profile = mock_dolt_repo_profile(&repository);
    let current_commit = manifest_payload
        .metadata
        .as_ref()
        .and_then(|metadata| normalize_non_empty_string(metadata.current_commit.clone()))
        .or_else(|| {
            normalize_non_empty_string(Some(manifest_payload.repo_ref.current_commit.clone()))
        })
        .unwrap_or_else(|| resolve_dolt_current_commit(profile, None));
    let previous_commit = manifest_payload
        .metadata
        .as_ref()
        .and_then(|metadata| normalize_non_empty_string(metadata.previous_commit.clone()))
        .unwrap_or_else(|| resolve_dolt_previous_commit(profile));
    let repo_family = manifest_payload
        .metadata
        .as_ref()
        .and_then(|metadata| normalize_non_empty_string(metadata.repo_family.clone()))
        .unwrap_or_else(|| derive_dolt_repo_family(&repository));
    let manifest_changed_tables = manifest_payload
        .metadata
        .as_ref()
        .and_then(|metadata| metadata.changed_tables.clone())
        .unwrap_or_default();
    let schema_change_flags = manifest_payload
        .metadata
        .as_ref()
        .and_then(|metadata| metadata.schema_change_flags.clone())
        .unwrap_or_default();
    let row_change_summary = manifest_payload
        .metadata
        .as_ref()
        .and_then(|metadata| metadata.row_change_summary.as_ref());

    let resolved_summaries = resolve_dolt_diff_export_table_summaries(
        &repository,
        &manifest_changed_tables,
        row_change_summary,
    );
    let bundle_path = build_dolt_diff_export_bundle_path(
        &repo_family,
        &previous_commit,
        &current_commit,
        output_format,
    );
    let delta_manifest: Vec<Value> = resolved_summaries
        .iter()
        .filter_map(|summary| {
            let filtered = filter_dolt_diff_export_summary(summary, change_filter)?;
            let operation_types = build_dolt_diff_operation_types(&filtered);
            let delete_markers_emitted = filtered.removed_rows > 0
                && matches!(
                    deleted_row_handling,
                    DoltDiffExportDeletedRowHandling::EmitDeleteMarkers
                );

            Some(json!({
                "source_table": filtered.table_name,
                "file_path": format!(
                    "{}/{}.{}",
                    bundle_path,
                    filtered.table_name,
                    output_format.file_extension()
                ),
                "added_rows": filtered.added_rows,
                "modified_rows": filtered.modified_rows,
                "removed_rows": filtered.removed_rows,
                "operation_types": operation_types,
                "delete_markers_emitted": delete_markers_emitted,
                "delete_marker_path": if delete_markers_emitted {
                    Some(format!(
                        "{}/delete_markers/{}.jsonl",
                        bundle_path, filtered.table_name
                    ))
                } else {
                    None
                }
            }))
        })
        .collect();
    let delete_rows_present = delta_manifest.iter().any(|entry| {
        entry
            .get("removed_rows")
            .and_then(Value::as_u64)
            .unwrap_or(0)
            > 0
    });
    let filtered_tables: Vec<String> = delta_manifest
        .iter()
        .filter_map(|entry| {
            entry
                .get("source_table")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .collect();
    let filtered_table_count = filtered_tables.len();

    let mut outputs = PortValues::new();
    outputs.insert(
        "bundle".to_string(),
        TypedValue {
            data_type: DataType::DirectoryRef,
            value: json!({
                "kind": "dolt_diff_export_bundle",
                "directory_ref": {
                    "path": bundle_path,
                    "format": output_format.as_str(),
                },
                "repo_ref": {
                    "connection_ref": manifest_payload.repo_ref.connection_ref.trim(),
                    "repository": repository,
                    "branch": manifest_payload.repo_ref.branch.trim(),
                    "checkout_ref": normalize_optional_config_string(manifest_payload.repo_ref.checkout_ref),
                    "current_commit": current_commit.clone(),
                },
                "metadata": {
                    "repo_family": repo_family,
                    "previous_commit": previous_commit.clone(),
                    "current_commit": current_commit.clone(),
                    "change_filter": change_filter.as_str(),
                    "deleted_row_handling": deleted_row_handling.as_str(),
                    "manifest_changed_tables": manifest_changed_tables,
                    "filtered_tables": filtered_tables,
                    "schema_change_flags": schema_change_flags,
                    "delete_rows_present": delete_rows_present,
                    "delta_manifest": delta_manifest,
                }
            }),
        },
    );

    Ok(NodeExecutionResult {
        outputs,
        logs: vec![format!(
            "Exported Dolt row deltas for `{}` across `{}` -> `{}` with `{}` table(s) using `{}`.",
            manifest_payload.repo_ref.repository.trim(),
            previous_commit,
            current_commit,
            filtered_table_count,
            change_filter.as_str()
        )],
    })
}

fn managed_workflow_root_from_context(context: &AdapterExecutionContext) -> Option<PathBuf> {
    if let Some(root) = context.workflow_root_path.as_ref() {
        return Some(absolutize_runtime_path(root));
    }

    let workflow_duckdb_path = context.workflow_duckdb_path.as_ref()?;
    let db_dir = workflow_duckdb_path.parent()?;
    let file_name = workflow_duckdb_path.file_name()?.to_str()?;
    let db_dir_name = db_dir.file_name()?.to_str()?;

    if file_name.eq_ignore_ascii_case("workflow.duckdb") && db_dir_name == "db" {
        db_dir.parent().map(absolutize_runtime_path)
    } else {
        None
    }
}

fn workflow_root_from_context(context: &AdapterExecutionContext) -> Option<PathBuf> {
    managed_workflow_root_from_context(context).or_else(|| {
        context
            .workflow_duckdb_path
            .as_ref()
            .and_then(|path| path.parent())
            .map(absolutize_runtime_path)
    })
}

fn workflow_files_root_from_context(context: &AdapterExecutionContext) -> Option<PathBuf> {
    context
        .workflow_files_root
        .clone()
        .map(|path| absolutize_runtime_path(&path))
        .or_else(|| workflow_root_from_context(context).map(|root| root.join("files")))
}

fn absolutize_runtime_path(path: &Path) -> PathBuf {
    if path.is_absolute() {
        return path.to_path_buf();
    }

    env::current_dir()
        .map(|current_dir| current_dir.join(path))
        .unwrap_or_else(|_| path.to_path_buf())
}

fn runtime_duckdb_path_from_context(context: &AdapterExecutionContext) -> Option<&Path> {
    context
        .workspace_duckdb_path
        .as_deref()
        .or(context.workflow_duckdb_path.as_deref())
}

fn resolve_workflow_file_path(
    context: &AdapterExecutionContext,
    file_path: &str,
) -> Option<PathBuf> {
    let candidate = PathBuf::from(file_path);
    if candidate.is_absolute() {
        return Some(candidate);
    }

    workflow_files_root_from_context(context).map(|root| root.join(candidate))
}

fn duckdb_scan_sql_for_file_path(file_path: &Path, node_id: &str) -> Result<String, AdapterError> {
    let path_literal = quote_duckdb_string_literal(file_path.to_string_lossy().as_ref());
    let extension = file_path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase());

    match extension.as_deref() {
        Some("csv") => Ok(format!(
            "select * from read_csv_auto({path_literal}, header = true)"
        )),
        Some("parquet") => Ok(format!("select * from read_parquet({path_literal})")),
        Some(other) => Err(AdapterError::ExecutionFailed {
            node_id: node_id.to_string(),
            message: format!(
                "unsupported artifact file extension `.{other}` at `{}`.",
                file_path.display()
            ),
        }),
        None => Err(AdapterError::ExecutionFailed {
            node_id: node_id.to_string(),
            message: format!(
                "artifact file `{}` is missing a supported extension.",
                file_path.display()
            ),
        }),
    }
}

fn describe_duckdb_table_columns(
    connection: &DuckDbConnection,
    schema_name: &str,
    table_name: &str,
    node_id: &str,
) -> Result<Vec<Value>, AdapterError> {
    let mut stmt = connection
        .prepare(
            "select column_name,
                    data_type,
                    case when is_nullable = 'YES' then 1 else 0 end as nullable
             from information_schema.columns
             where table_schema = ?1
               and table_name = ?2
             order by ordinal_position asc",
        )
        .map_err(|error| AdapterError::ExecutionFailed {
            node_id: node_id.to_string(),
            message: format!(
                "failed to inspect created table `{schema_name}.{table_name}` columns: {error}"
            ),
        })?;

    stmt.query_map([schema_name, table_name], |row| {
        Ok(json!({
            "name": row.get::<_, String>(0)?,
            "type": row.get::<_, String>(1)?,
            "nullable": row.get::<_, i64>(2)? != 0,
            "primary_key": false
        }))
    })
    .map_err(|error| AdapterError::ExecutionFailed {
        node_id: node_id.to_string(),
        message: format!(
            "failed to query created table `{schema_name}.{table_name}` columns: {error}"
        ),
    })?
    .collect::<duckdb::Result<Vec<_>>>()
    .map_err(|error| AdapterError::ExecutionFailed {
        node_id: node_id.to_string(),
        message: format!(
            "failed to collect created table `{schema_name}.{table_name}` columns: {error}"
        ),
    })
}

fn load_duckdb_table_row_count(
    connection: &DuckDbConnection,
    schema_name: &str,
    table_name: &str,
    node_id: &str,
) -> Result<u64, AdapterError> {
    let qualified_table = format!(
        "{}.{}",
        quote_duckdb_identifier(schema_name),
        quote_duckdb_identifier(table_name)
    );
    connection
        .query_row(
            &format!("select count(*) from {qualified_table}"),
            [],
            |row| row.get::<_, i64>(0),
        )
        .map(|count| count.max(0) as u64)
        .map_err(|error| AdapterError::ExecutionFailed {
            node_id: node_id.to_string(),
            message: format!(
                "failed to count rows in created table `{schema_name}.{table_name}`: {error}"
            ),
        })
}

fn load_duckdb_query_column_names(
    connection: &DuckDbConnection,
    query_sql: &str,
    node_id: &str,
) -> Result<Vec<String>, AdapterError> {
    let mut statement = connection
        .prepare(&format!(
            "describe select * from ({query_sql}) as source_data"
        ))
        .map_err(|error| AdapterError::ExecutionFailed {
            node_id: node_id.to_string(),
            message: format!(
                "failed to inspect workflow DuckDB query columns for file-backed load: {error}"
            ),
        })?;

    statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| AdapterError::ExecutionFailed {
            node_id: node_id.to_string(),
            message: format!(
                "failed to query workflow DuckDB query columns for file-backed load: {error}"
            ),
        })?
        .collect::<duckdb::Result<Vec<_>>>()
        .map_err(|error| AdapterError::ExecutionFailed {
            node_id: node_id.to_string(),
            message: format!(
                "failed to collect workflow DuckDB query columns for file-backed load: {error}"
            ),
        })
}

fn build_load_to_duckdb_file_projection_sql(
    connection: &DuckDbConnection,
    scan_sql: &str,
    repository: &str,
    bundle_kind: &str,
    current_commit: &str,
    previous_commit: Option<&str>,
    delete_rows_present: bool,
    source_table: &str,
    node_id: &str,
) -> Result<String, AdapterError> {
    let source_columns = load_duckdb_query_column_names(connection, scan_sql, node_id)?
        .into_iter()
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

    push_metadata_projection("source_repo", quote_duckdb_string_literal(repository));
    push_metadata_projection("source_table", quote_duckdb_string_literal(source_table));
    push_metadata_projection("batch_id", quote_duckdb_string_literal(current_commit));
    push_metadata_projection(
        "ingested_at",
        "cast(current_timestamp as timestamp)".to_string(),
    );
    push_metadata_projection("bundle_kind", quote_duckdb_string_literal(bundle_kind));
    if let Some(previous_commit) = previous_commit {
        push_metadata_projection(
            "previous_commit",
            quote_duckdb_string_literal(previous_commit),
        );
    }
    push_metadata_projection(
        "current_commit",
        quote_duckdb_string_literal(current_commit),
    );
    push_metadata_projection(
        "delete_rows_present",
        if delete_rows_present {
            "true".to_string()
        } else {
            "false".to_string()
        },
    );

    if metadata_projections.is_empty() {
        return Ok(format!(
            "select source_data.* from ({scan_sql}) as source_data"
        ));
    }

    Ok(format!(
        "select source_data.*, {} from ({scan_sql}) as source_data",
        metadata_projections.join(", ")
    ))
}

fn persist_load_to_duckdb_tables_from_files(
    connection: &DuckDbConnection,
    context: &AdapterExecutionContext,
    target_schema: &str,
    resolved_bundle: &mut ResolvedLoadToDuckDbBundle,
    node_id: &str,
) -> Result<bool, AdapterError> {
    let resolved_paths = resolved_bundle
        .loaded_tables
        .iter()
        .map(|table| {
            resolve_workflow_file_path(context, &table.file_path).ok_or_else(|| {
                AdapterError::ExecutionFailed {
                    node_id: node_id.to_string(),
                    message: format!(
                        "failed to resolve workflow artifact path for `{}`.",
                        table.file_path
                    ),
                }
            })
        })
        .collect::<Result<Vec<_>, _>>()?;

    if !resolved_paths.iter().any(|path| path.is_file()) {
        return Ok(false);
    }

    let schema_identifier = quote_duckdb_identifier(target_schema);
    connection
        .execute_batch(&format!("create schema if not exists {schema_identifier};"))
        .map_err(|error| AdapterError::ExecutionFailed {
            node_id: node_id.to_string(),
            message: format!(
                "failed to ensure staging schema `{target_schema}` exists in workflow DuckDB: {error}"
            ),
        })?;

    let repository = resolved_bundle.repository.clone();
    let bundle_kind = resolved_bundle.bundle_kind;
    let current_commit = resolved_bundle.current_commit.clone();
    let previous_commit = resolved_bundle.previous_commit.clone();
    let delete_rows_present = resolved_bundle.delete_rows_present;

    for (table, resolved_path) in resolved_bundle
        .loaded_tables
        .iter_mut()
        .zip(resolved_paths.iter())
    {
        if !resolved_path.is_file() {
            return Err(AdapterError::ExecutionFailed {
                node_id: node_id.to_string(),
                message: format!(
                    "expected bundle artifact `{}` for `{}` but the file does not exist.",
                    resolved_path.display(),
                    table.source_table
                ),
            });
        }

        let scan_sql = duckdb_scan_sql_for_file_path(resolved_path, node_id)?;
        let projection_sql = build_load_to_duckdb_file_projection_sql(
            connection,
            &scan_sql,
            &repository,
            bundle_kind,
            &current_commit,
            previous_commit.as_deref(),
            delete_rows_present,
            &table.source_table,
            node_id,
        )?;
        let qualified_table = format!(
            "{}.{}",
            schema_identifier,
            quote_duckdb_identifier(&table.staging_table_name)
        );
        connection
            .execute_batch(&format!(
                "create or replace table {qualified_table} as {projection_sql};"
            ))
            .map_err(|error| AdapterError::ExecutionFailed {
                node_id: node_id.to_string(),
                message: format!(
                    "failed to load `{}` into staging table `{target_schema}.{}`
using DuckDB: {error}",
                    resolved_path.display(),
                    table.staging_table_name
                ),
            })?;

        table.columns = describe_duckdb_table_columns(
            connection,
            target_schema,
            &table.staging_table_name,
            node_id,
        )?;
        table.row_count = Some(load_duckdb_table_row_count(
            connection,
            target_schema,
            &table.staging_table_name,
            node_id,
        )?);
    }

    Ok(true)
}

fn dolt_cli_is_available() -> bool {
    let mut command = Command::new("dolt");
    command.arg("version");
    apply_dolt_command_environment(&mut command);
    command
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn apply_dolt_command_environment(command: &mut Command) {
    if let Some(home_dir) = ensure_dolt_home_dir() {
        command.env("HOME", &home_dir);
    }
    command.env("NO_COLOR", "1");
    command.env("CLICOLOR", "0");
    command.env("TERM", "dumb");
}

fn ensure_dolt_home_dir() -> Option<PathBuf> {
    let home_dir = resolve_dolt_home_dir()?;
    fs::create_dir_all(home_dir.join(".dolt")).ok()?;
    Some(home_dir)
}

fn resolve_dolt_home_dir() -> Option<PathBuf> {
    if let Some(explicit_home) = env::var_os("STITCHLY_DOLT_HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
    {
        return Some(explicit_home);
    }

    let state_dir = env::var_os("STITCHLY_STATE_DIR")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from);
    let current_dir = env::current_dir().ok();

    build_dolt_home_dir_path(state_dir.as_deref(), current_dir.as_deref())
}

fn build_dolt_home_dir_path(
    state_dir: Option<&Path>,
    current_dir: Option<&Path>,
) -> Option<PathBuf> {
    state_dir
        .map(|path| path.join("tooling").join("dolt-home"))
        .or_else(|| {
            current_dir.map(|path| path.join(".stitchly").join("tooling").join("dolt-home"))
        })
}

fn sanitize_repository_storage_name(repository: &str) -> String {
    repository
        .chars()
        .map(|character| match character {
            'a'..='z' | 'A'..='Z' | '0'..='9' => character,
            _ => '_',
        })
        .collect()
}

fn run_command_capture_stdout(
    program: &str,
    args: &[&str],
    current_dir: Option<&Path>,
    node_id: &str,
) -> Result<String, AdapterError> {
    let mut command = Command::new(program);
    command.args(args);
    if let Some(current_dir) = current_dir {
        command.current_dir(current_dir);
    }
    if program == "dolt" {
        apply_dolt_command_environment(&mut command);
    }

    let output = command
        .output()
        .map_err(|error| AdapterError::ExecutionFailed {
            node_id: node_id.to_string(),
            message: format!("failed to start `{program}`: {error}"),
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            format!("process exited with status {:?}", output.status)
        };

        return Err(AdapterError::ExecutionFailed {
            node_id: node_id.to_string(),
            message: format!("`{program} {}` failed: {detail}", args.join(" ")),
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn strip_ansi_escape_sequences(text: &str) -> String {
    let mut cleaned = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();

    while let Some(character) = chars.next() {
        if character == '\u{1b}' {
            if matches!(chars.peek(), Some('[')) {
                chars.next();
                while let Some(next_character) = chars.next() {
                    if matches!(next_character, '@'..='~') {
                        break;
                    }
                }
                continue;
            }
        }

        cleaned.push(character);
    }

    cleaned
}

fn parse_dolt_head_commit(output: &str) -> Option<String> {
    strip_ansi_escape_sequences(output)
        .lines()
        .map(str::trim)
        .find_map(|line| line.strip_prefix("commit ").map(str::trim))
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn first_visible_output_line(output: &str) -> String {
    let cleaned = strip_ansi_escape_sequences(output);
    if let Some(first_line) = cleaned.lines().map(str::trim).find(|line| !line.is_empty()) {
        return first_line.to_string();
    }

    "<empty output>".to_string()
}

fn try_resolve_dolt_head_commit(repo_dir: &Path, node_id: &str) -> Result<String, AdapterError> {
    let output = run_command_capture_stdout("dolt", &["log", "-n", "1"], Some(repo_dir), node_id)?;
    parse_dolt_head_commit(&output).ok_or_else(|| AdapterError::ExecutionFailed {
        node_id: node_id.to_string(),
        message: format!(
            "`dolt log -n 1` returned unexpected output while resolving HEAD commit in `{}`: {}",
            repo_dir.display(),
            first_visible_output_line(&output)
        ),
    })
}

fn resolve_upstream_live_working_copy_path(
    metadata: Option<&DoltRepoDatasetMetadataPayload>,
) -> Option<PathBuf> {
    let metadata = metadata?;
    if metadata.resolution_mode.as_deref()? != "live_dolt" {
        return None;
    }

    metadata
        .working_copy_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn resolve_dolt_dump_csv_path(
    dump_dir: &Path,
    repo_dir: &Path,
    table_name: &str,
) -> Option<PathBuf> {
    let candidate_paths = [
        dump_dir.join(format!("{table_name}.csv")),
        repo_dir.join(format!("{table_name}.csv")),
        repo_dir.join("doltdump").join(format!("{table_name}.csv")),
    ];

    candidate_paths.into_iter().find(|path| path.is_file())
}

fn workflow_relative_bundle_path(bundle_relative_path: &str, file_name: &str) -> String {
    format!("{bundle_relative_path}/{file_name}")
}

struct ActualDoltDumpBundle {
    bundle_path: String,
    current_commit: String,
    effective_format: DoltDumpOutputFormat,
    exported_tables: Vec<Value>,
}

struct PreparedDoltWorkingCopy {
    current_commit: String,
    repo_dir: PathBuf,
}

#[derive(Clone, Copy)]
enum SeededArtifactFormat {
    Csv,
    Parquet,
}

impl SeededArtifactFormat {
    fn file_extension(self) -> &'static str {
        match self {
            Self::Csv => "csv",
            Self::Parquet => "parquet",
        }
    }
}

struct SeededArtifactSource {
    path: PathBuf,
    format: SeededArtifactFormat,
}

fn dolt_seed_source_roots(context: &AdapterExecutionContext, repo_family: &str) -> Vec<PathBuf> {
    let mut roots = Vec::new();

    if let Some(files_root) = workflow_files_root_from_context(context) {
        roots.push(files_root.join("raw").join("dolt").join(repo_family));
        roots.push(files_root.join("seeds").join("dolt").join(repo_family));
    }

    if let Some(seed_root) = env::var("STITCHLY_DOLT_EXPORT_ROOT")
        .ok()
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
    {
        roots.push(seed_root.join(repo_family));
        roots.push(seed_root);
    }

    if let Ok(current_dir) = env::current_dir() {
        roots.push(
            current_dir
                .join("data")
                .join("raw")
                .join("dolt")
                .join(repo_family),
        );
    }

    let mut deduped = Vec::new();
    for root in roots {
        if !deduped.iter().any(|existing: &PathBuf| existing == &root) {
            deduped.push(root);
        }
    }

    deduped
}

fn resolve_seeded_artifact_source(
    seed_root: &Path,
    table_name: &str,
    output_format: DoltDumpOutputFormat,
) -> Option<SeededArtifactSource> {
    let direct_preferred =
        seed_root.join(format!("{table_name}.{}", output_format.file_extension()));
    if direct_preferred.is_file() {
        return Some(SeededArtifactSource {
            path: direct_preferred,
            format: match output_format {
                DoltDumpOutputFormat::Csv => SeededArtifactFormat::Csv,
                DoltDumpOutputFormat::Parquet => SeededArtifactFormat::Parquet,
            },
        });
    }

    let nested_preferred = seed_root
        .join(output_format.as_str())
        .join(format!("{table_name}.{}", output_format.file_extension()));
    if nested_preferred.is_file() {
        return Some(SeededArtifactSource {
            path: nested_preferred,
            format: match output_format {
                DoltDumpOutputFormat::Csv => SeededArtifactFormat::Csv,
                DoltDumpOutputFormat::Parquet => SeededArtifactFormat::Parquet,
            },
        });
    }

    let fallback_format = match output_format {
        DoltDumpOutputFormat::Csv => SeededArtifactFormat::Parquet,
        DoltDumpOutputFormat::Parquet => SeededArtifactFormat::Csv,
    };
    let direct_fallback =
        seed_root.join(format!("{table_name}.{}", fallback_format.file_extension()));
    if direct_fallback.is_file() {
        return Some(SeededArtifactSource {
            path: direct_fallback,
            format: fallback_format,
        });
    }

    let nested_fallback = seed_root
        .join(fallback_format.file_extension())
        .join(format!("{table_name}.{}", fallback_format.file_extension()));
    if nested_fallback.is_file() {
        return Some(SeededArtifactSource {
            path: nested_fallback,
            format: fallback_format,
        });
    }

    None
}

fn copy_or_convert_seeded_artifact(
    source: &SeededArtifactSource,
    destination_file: &Path,
    output_format: DoltDumpOutputFormat,
    conversion_connection: Option<&DuckDbConnection>,
    node_id: &str,
) -> Result<(), AdapterError> {
    copy_or_convert_tabular_artifact(
        &source.path,
        source.format,
        destination_file,
        output_format,
        conversion_connection,
        node_id,
        "seeded artifact",
    )
}

fn copy_or_convert_actual_dolt_dump_artifact(
    source_csv: &Path,
    destination_file: &Path,
    output_format: DoltDumpOutputFormat,
    conversion_connection: Option<&DuckDbConnection>,
    node_id: &str,
) -> Result<(), AdapterError> {
    copy_or_convert_tabular_artifact(
        source_csv,
        SeededArtifactFormat::Csv,
        destination_file,
        output_format,
        conversion_connection,
        node_id,
        "Dolt dump artifact",
    )
}

fn copy_or_convert_tabular_artifact(
    source_path: &Path,
    source_format: SeededArtifactFormat,
    destination_file: &Path,
    output_format: DoltDumpOutputFormat,
    conversion_connection: Option<&DuckDbConnection>,
    node_id: &str,
    source_label: &str,
) -> Result<(), AdapterError> {
    match (source_format, output_format) {
        (SeededArtifactFormat::Csv, DoltDumpOutputFormat::Csv)
        | (SeededArtifactFormat::Parquet, DoltDumpOutputFormat::Parquet) => {
            fs::copy(source_path, destination_file).map_err(|error| {
                AdapterError::ExecutionFailed {
                    node_id: node_id.to_string(),
                    message: format!(
                        "failed to copy {source_label} `{}` to `{}`: {error}",
                        source_path.display(),
                        destination_file.display()
                    ),
                }
            })?;
        }
        (SeededArtifactFormat::Csv, DoltDumpOutputFormat::Parquet) => {
            let connection =
                conversion_connection.ok_or_else(|| AdapterError::ExecutionFailed {
                    node_id: node_id.to_string(),
                    message: format!(
                        "failed to open workflow DuckDB for {source_label} CSV -> parquet conversion."
                    ),
                })?;
            let source_sql = duckdb_scan_sql_for_file_path(source_path, node_id)?;
            connection
                .execute_batch(&format!(
                    "copy ({source_sql}) to {} (format parquet);",
                    quote_duckdb_string_literal(destination_file.to_string_lossy().as_ref())
                ))
                .map_err(|error| AdapterError::ExecutionFailed {
                    node_id: node_id.to_string(),
                    message: format!(
                        "failed to convert {source_label} CSV `{}` to parquet at `{}`: {error}",
                        source_path.display(),
                        destination_file.display()
                    ),
                })?;
        }
        (SeededArtifactFormat::Parquet, DoltDumpOutputFormat::Csv) => {
            let connection =
                conversion_connection.ok_or_else(|| AdapterError::ExecutionFailed {
                    node_id: node_id.to_string(),
                    message: format!(
                        "failed to open workflow DuckDB for {source_label} parquet -> CSV conversion."
                    ),
                })?;
            let source_sql = duckdb_scan_sql_for_file_path(source_path, node_id)?;
            connection
                .execute_batch(&format!(
                    "copy ({source_sql}) to {} (header true, format csv);",
                    quote_duckdb_string_literal(destination_file.to_string_lossy().as_ref())
                ))
                .map_err(|error| AdapterError::ExecutionFailed {
                    node_id: node_id.to_string(),
                    message: format!(
                        "failed to convert {source_label} parquet `{}` to CSV at `{}`: {error}",
                        source_path.display(),
                        destination_file.display()
                    ),
                })?;
        }
    }

    Ok(())
}

fn try_resolve_existing_dolt_dump_bundle(
    context: &AdapterExecutionContext,
    output_format: DoltDumpOutputFormat,
    repo_family: &str,
    current_commit: &str,
    export_table_names: &[String],
) -> Option<ActualDoltDumpBundle> {
    let files_root = workflow_files_root_from_context(context)?;
    let bundle_path = build_dolt_dump_bundle_path(repo_family, current_commit, output_format);
    let bundle_root = files_root.join(&bundle_path);
    if !bundle_root.is_dir() {
        return None;
    }

    let exported_tables = export_table_names
        .iter()
        .map(|table_name| {
            let relative_path = workflow_relative_bundle_path(
                &bundle_path,
                &format!("{table_name}.{}", output_format.file_extension()),
            );
            let absolute_path = files_root.join(&relative_path);
            if !absolute_path.is_file() {
                return None;
            }

            Some(json!({
                "source_table": table_name,
                "file_path": relative_path,
                "row_count": Value::Null,
            }))
        })
        .collect::<Option<Vec<_>>>()?;

    Some(ActualDoltDumpBundle {
        bundle_path,
        current_commit: current_commit.to_string(),
        effective_format: output_format,
        exported_tables,
    })
}

fn try_materialize_seeded_dolt_dump_bundle(
    context: &AdapterExecutionContext,
    output_format: DoltDumpOutputFormat,
    repo_family: &str,
    current_commit: &str,
    export_table_names: &[String],
    node_id: &str,
) -> Result<Option<ActualDoltDumpBundle>, AdapterError> {
    let Some(files_root) = workflow_files_root_from_context(context) else {
        return Ok(None);
    };

    let seed_roots = dolt_seed_source_roots(context, repo_family);

    for seed_root in seed_roots {
        let seeded_sources = export_table_names
            .iter()
            .map(|table_name| resolve_seeded_artifact_source(&seed_root, table_name, output_format))
            .collect::<Option<Vec<_>>>();

        let Some(seeded_sources) = seeded_sources else {
            continue;
        };

        let effective_format = output_format;
        let bundle_path =
            build_dolt_dump_bundle_path(repo_family, current_commit, effective_format);
        let bundle_root = files_root.join(&bundle_path);

        if bundle_root.exists() {
            fs::remove_dir_all(&bundle_root).map_err(|error| AdapterError::ExecutionFailed {
                node_id: node_id.to_string(),
                message: format!(
                    "failed to clear existing seeded bundle directory `{}`: {error}",
                    bundle_root.display()
                ),
            })?;
        }
        fs::create_dir_all(&bundle_root).map_err(|error| AdapterError::ExecutionFailed {
            node_id: node_id.to_string(),
            message: format!(
                "failed to create seeded bundle directory `{}`: {error}",
                bundle_root.display()
            ),
        })?;

        let needs_conversion = seeded_sources.iter().any(|source| {
            matches!(
                (source.format, effective_format),
                (SeededArtifactFormat::Csv, DoltDumpOutputFormat::Parquet)
                    | (SeededArtifactFormat::Parquet, DoltDumpOutputFormat::Csv)
            )
        });
        let conversion_connection = if needs_conversion {
            open_runtime_workflow_duckdb(context, node_id)?
        } else {
            None
        };

        let mut exported_tables = Vec::with_capacity(export_table_names.len());
        for (table_name, source) in export_table_names.iter().zip(seeded_sources.iter()) {
            let destination_file = bundle_root.join(format!(
                "{table_name}.{}",
                effective_format.file_extension()
            ));
            copy_or_convert_seeded_artifact(
                source,
                &destination_file,
                effective_format,
                conversion_connection.as_ref(),
                node_id,
            )?;
            exported_tables.push(json!({
                "source_table": table_name,
                "file_path": workflow_relative_bundle_path(
                    &bundle_path,
                    &format!("{table_name}.{}", effective_format.file_extension())
                ),
                "row_count": Value::Null,
            }));
        }

        return Ok(Some(ActualDoltDumpBundle {
            bundle_path,
            current_commit: current_commit.to_string(),
            effective_format,
            exported_tables,
        }));
    }

    Ok(None)
}

fn dolt_dump_seed_hints(
    context: &AdapterExecutionContext,
    repo_family: &str,
    table_name: &str,
) -> Vec<String> {
    let mut hints = Vec::new();

    hints.push(format!("data/raw/dolt/{repo_family}/{table_name}.csv"));
    hints.push(format!("data/raw/dolt/{repo_family}/{table_name}.parquet"));

    if workflow_files_root_from_context(context).is_some() {
        hints.push(format!("files/raw/dolt/{repo_family}/{table_name}.csv"));
        hints.push(format!("files/raw/dolt/{repo_family}/{table_name}.parquet"));
    }

    hints
}

fn prepare_actual_dolt_working_copy(
    context: &AdapterExecutionContext,
    repository: &str,
    branch: &str,
    checkout_ref: Option<&str>,
    clone_mode: DoltCloneMode,
    sync_strategy: DoltSyncStrategy,
    node_id: &str,
) -> Result<PreparedDoltWorkingCopy, AdapterError> {
    let files_root =
        workflow_files_root_from_context(context).ok_or_else(|| AdapterError::ExecutionFailed {
            node_id: node_id.to_string(),
            message: "dolt_repo_source requires managed workflow storage for live Dolt execution."
                .to_string(),
        })?;
    if !dolt_cli_is_available() {
        return Err(AdapterError::ExecutionFailed {
            node_id: node_id.to_string(),
            message: "dolt_repo_source requires the Dolt CLI for live execution.".to_string(),
        });
    }
    if matches!(clone_mode, DoltCloneMode::Depth1) {
        return Err(AdapterError::ExecutionFailed {
            node_id: node_id.to_string(),
            message: "live dolt_repo_source does not yet support clone_mode `depth_1`.".to_string(),
        });
    }

    let working_copy_root = files_root.join("artifacts").join("dolt_working_copies");
    fs::create_dir_all(&working_copy_root).map_err(|error| AdapterError::ExecutionFailed {
        node_id: node_id.to_string(),
        message: format!(
            "failed to create Dolt working copy root `{}`: {error}",
            working_copy_root.display()
        ),
    })?;

    let repo_dir_name = sanitize_repository_storage_name(repository);
    let repo_dir = working_copy_root.join(&repo_dir_name);
    if matches!(clone_mode, DoltCloneMode::FreshClone) && repo_dir.exists() {
        fs::remove_dir_all(&repo_dir).map_err(|error| AdapterError::ExecutionFailed {
            node_id: node_id.to_string(),
            message: format!(
                "failed to reset Dolt working copy `{}` for fresh clone: {error}",
                repo_dir.display()
            ),
        })?;
    }

    if !repo_dir.exists() {
        run_command_capture_stdout(
            "dolt",
            &["clone", repository, &repo_dir_name],
            Some(&working_copy_root),
            node_id,
        )?;
    } else if matches!(sync_strategy, DoltSyncStrategy::PullBeforeExecution) {
        refresh_actual_dolt_working_copy_to_branch_head(&repo_dir, branch, node_id)?;
    }

    if let Some(checkout_ref) = checkout_ref.filter(|value| !value.trim().is_empty()) {
        run_command_capture_stdout(
            "dolt",
            &["checkout", checkout_ref],
            Some(&repo_dir),
            node_id,
        )?;
    } else if !branch.trim().is_empty() {
        run_command_capture_stdout("dolt", &["checkout", branch], Some(&repo_dir), node_id)?;
    }

    let current_commit =
        try_resolve_dolt_head_commit(&repo_dir, node_id).map_err(|error| match error {
            AdapterError::ExecutionFailed { message, .. } => AdapterError::ExecutionFailed {
                node_id: node_id.to_string(),
                message: format!(
                    "failed to resolve the current Dolt commit for `{}` from `{}`: {message}",
                    repository,
                    repo_dir.display()
                ),
            },
            other => other,
        })?;

    Ok(PreparedDoltWorkingCopy {
        current_commit,
        repo_dir,
    })
}

fn refresh_actual_dolt_working_copy_to_branch_head(
    repo_dir: &Path,
    branch: &str,
    node_id: &str,
) -> Result<(), AdapterError> {
    let branch = branch.trim();
    if branch.is_empty() {
        run_command_capture_stdout(
            "dolt",
            &["fetch", "--prune", "origin"],
            Some(repo_dir),
            node_id,
        )?;
        return Ok(());
    }

    run_command_capture_stdout("dolt", &["checkout", branch], Some(repo_dir), node_id)?;
    run_command_capture_stdout(
        "dolt",
        &["fetch", "--prune", "origin"],
        Some(repo_dir),
        node_id,
    )?;

    let remote_branch_ref = format!("origin/{branch}");
    // Keep read-oriented workflows aligned to remote head without creating merge commits.
    run_command_capture_stdout(
        "dolt",
        &["reset", "--hard", remote_branch_ref.as_str()],
        Some(repo_dir),
        node_id,
    )?;

    Ok(())
}

fn try_materialize_actual_dolt_dump_bundle(
    context: &AdapterExecutionContext,
    output_format: DoltDumpOutputFormat,
    repository: &str,
    branch: &str,
    checkout_ref: Option<&str>,
    repo_family: &str,
    current_commit: &str,
    export_table_names: &[String],
    upstream_live_working_copy_path: Option<&Path>,
    node_id: &str,
) -> Result<Option<ActualDoltDumpBundle>, AdapterError> {
    let Some(files_root) = workflow_files_root_from_context(context) else {
        return Ok(None);
    };
    if !dolt_cli_is_available() {
        return Ok(None);
    }

    let working_copy_root = files_root.join("artifacts").join("dolt_working_copies");
    fs::create_dir_all(&working_copy_root).map_err(|error| AdapterError::ExecutionFailed {
        node_id: node_id.to_string(),
        message: format!(
            "failed to create Dolt working copy root `{}`: {error}",
            working_copy_root.display()
        ),
    })?;

    let repo_dir_name = sanitize_repository_storage_name(repository);
    let repo_dir = if let Some(upstream_repo_dir) = upstream_live_working_copy_path {
        if !upstream_repo_dir.is_dir() {
            return Err(AdapterError::ExecutionFailed {
                node_id: node_id.to_string(),
                message: format!(
                    "upstream live Dolt working copy `{}` no longer exists for `{repository}`.",
                    upstream_repo_dir.display()
                ),
            });
        }

        upstream_repo_dir.to_path_buf()
    } else {
        let repo_dir = working_copy_root.join(&repo_dir_name);
        if !repo_dir.exists() {
            run_command_capture_stdout(
                "dolt",
                &["clone", repository, &repo_dir_name],
                Some(&working_copy_root),
                node_id,
            )?;
        } else {
            refresh_actual_dolt_working_copy_to_branch_head(&repo_dir, branch, node_id)?;
        }

        if let Some(checkout_ref) = checkout_ref.filter(|value| !value.trim().is_empty()) {
            run_command_capture_stdout(
                "dolt",
                &["checkout", checkout_ref],
                Some(&repo_dir),
                node_id,
            )?;
        } else if !branch.trim().is_empty() {
            run_command_capture_stdout("dolt", &["checkout", branch], Some(&repo_dir), node_id)?;
        }

        repo_dir
    };

    let actual_commit = try_resolve_dolt_head_commit(&repo_dir, node_id)
        .unwrap_or_else(|_| current_commit.to_string());
    let effective_format = output_format;
    let dump_dir = files_root
        .join("artifacts")
        .join("dolt_dump_work")
        .join(repo_family)
        .join(&actual_commit)
        .join("csv");
    if dump_dir.exists() {
        fs::remove_dir_all(&dump_dir).map_err(|error| AdapterError::ExecutionFailed {
            node_id: node_id.to_string(),
            message: format!(
                "failed to clear Dolt dump work directory `{}`: {error}",
                dump_dir.display()
            ),
        })?;
    }
    fs::create_dir_all(&dump_dir).map_err(|error| AdapterError::ExecutionFailed {
        node_id: node_id.to_string(),
        message: format!(
            "failed to create Dolt dump work directory `{}`: {error}",
            dump_dir.display()
        ),
    })?;
    let dump_dir_arg = dump_dir.to_string_lossy().to_string();
    run_command_capture_stdout(
        "dolt",
        &["dump", "-f", "-r", "csv", "-d", dump_dir_arg.as_str()],
        Some(&repo_dir),
        node_id,
    )?;
    let bundle_path = build_dolt_dump_bundle_path(repo_family, &actual_commit, effective_format);
    let bundle_root = files_root.join(&bundle_path);
    if bundle_root.exists() {
        fs::remove_dir_all(&bundle_root).map_err(|error| AdapterError::ExecutionFailed {
            node_id: node_id.to_string(),
            message: format!(
                "failed to clear existing bundle directory `{}`: {error}",
                bundle_root.display()
            ),
        })?;
    }
    fs::create_dir_all(&bundle_root).map_err(|error| AdapterError::ExecutionFailed {
        node_id: node_id.to_string(),
        message: format!(
            "failed to create bundle directory `{}`: {error}",
            bundle_root.display()
        ),
    })?;
    let conversion_connection = if matches!(effective_format, DoltDumpOutputFormat::Parquet) {
        open_runtime_workflow_duckdb(context, node_id)?
    } else {
        None
    };

    let mut exported_tables = Vec::with_capacity(export_table_names.len());
    for table_name in export_table_names {
        let Some(source_csv) = resolve_dolt_dump_csv_path(&dump_dir, &repo_dir, table_name) else {
            return Err(AdapterError::ExecutionFailed {
                node_id: node_id.to_string(),
                message: format!(
                    "expected Dolt dump to produce `{table_name}.csv` under `{}`, `{}`, or `{}`, but no file was found.",
                    dump_dir.display(),
                    repo_dir.display(),
                    repo_dir.join("doltdump").display()
                ),
            });
        };

        let destination_file = bundle_root.join(format!(
            "{table_name}.{}",
            effective_format.file_extension()
        ));
        copy_or_convert_actual_dolt_dump_artifact(
            &source_csv,
            &destination_file,
            effective_format,
            conversion_connection.as_ref(),
            node_id,
        )?;

        exported_tables.push(json!({
            "source_table": table_name,
            "file_path": workflow_relative_bundle_path(
                &bundle_path,
                &format!("{table_name}.{}", effective_format.file_extension())
            ),
            "row_count": Value::Null,
        }));
    }

    Ok(Some(ActualDoltDumpBundle {
        bundle_path,
        current_commit: actual_commit,
        effective_format,
        exported_tables,
    }))
}

fn open_runtime_workflow_duckdb(
    context: &AdapterExecutionContext,
    node_id: &str,
) -> Result<Option<DuckDbConnection>, AdapterError> {
    let Some(database_path) = runtime_duckdb_path_from_context(context) else {
        return Ok(None);
    };

    ensure_runtime_workflow_duckdb_parent(database_path, node_id)?;

    open_duckdb_connection_for_path(database_path)
        .map(Some)
        .map_err(|error| AdapterError::ExecutionFailed {
            node_id: node_id.to_string(),
            message: format!(
                "failed to open workflow DuckDB at `{}`: {error}",
                database_path.display()
            ),
        })
}

fn ensure_runtime_workflow_duckdb_parent(
    database_path: &Path,
    node_id: &str,
) -> Result<(), AdapterError> {
    if let Some(parent) = database_path.parent() {
        fs::create_dir_all(parent).map_err(|error| AdapterError::ExecutionFailed {
            node_id: node_id.to_string(),
            message: format!(
                "failed to create workflow DuckDB parent directory `{}`: {error}",
                parent.display()
            ),
        })?;
    }

    Ok(())
}

fn open_duckdb_connection_for_path(database_path: &Path) -> Result<DuckDbConnection, String> {
    match catch_unwind(AssertUnwindSafe(|| DuckDbConnection::open(database_path))) {
        Ok(Ok(connection)) => Ok(connection),
        Ok(Err(error)) => Err(error.to_string()),
        Err(payload) => Err(format!(
            "panicked while opening database: {}",
            panic_payload_to_string(payload)
        )),
    }
}

fn validate_runtime_workflow_duckdb_connection(
    connection: &DuckDbConnection,
    database_path: &Path,
    node_id: &str,
) -> Result<(), String> {
    match catch_unwind(AssertUnwindSafe(|| {
        connection.query_row(
            "select count(*) from information_schema.tables",
            [],
            |row| row.get::<_, i64>(0),
        )
    })) {
        Ok(Ok(_)) => Ok(()),
        Ok(Err(error)) => Err(format!(
            "workflow DuckDB at `{}` failed validation before load for node `{node_id}`: {error}",
            database_path.display()
        )),
        Err(payload) => Err(format!(
            "workflow DuckDB at `{}` panicked during validation before load for node `{node_id}`: {}",
            database_path.display(),
            panic_payload_to_string(payload)
        )),
    }
}

fn quarantine_workflow_duckdb_file(
    database_path: &Path,
    reason: &str,
    node_id: &str,
) -> Result<Option<PathBuf>, AdapterError> {
    if !database_path.exists() {
        return Ok(None);
    }

    let quarantine_suffix = format!("corrupt.{}", Utc::now().format("%Y%m%d%H%M%S"));
    let quarantine_path = database_path.with_extension(format!(
        "{}.{quarantine_suffix}",
        database_path
            .extension()
            .and_then(|extension| extension.to_str())
            .unwrap_or("duckdb")
    ));

    fs::rename(database_path, &quarantine_path).map_err(|error| AdapterError::ExecutionFailed {
        node_id: node_id.to_string(),
        message: format!(
            "workflow DuckDB at `{}` failed open/validation and could not be quarantined at `{}`: {error}. Failure reason: {reason}",
            database_path.display(),
            quarantine_path.display()
        ),
    })?;

    for sidecar_extension in ["wal", "tmp"] {
        let sidecar_path = database_path.with_extension(format!(
            "{}.{sidecar_extension}",
            database_path
                .extension()
                .and_then(|extension| extension.to_str())
                .unwrap_or("duckdb")
        ));
        if sidecar_path.exists() {
            let sidecar_quarantine_path =
                sidecar_path.with_extension(format!("{sidecar_extension}.{quarantine_suffix}"));
            fs::rename(&sidecar_path, &sidecar_quarantine_path).map_err(|error| {
                AdapterError::ExecutionFailed {
                    node_id: node_id.to_string(),
                    message: format!(
                        "workflow DuckDB sidecar `{}` was present after quarantining `{}` but could not be moved to `{}`: {error}",
                        sidecar_path.display(),
                        database_path.display(),
                        sidecar_quarantine_path.display()
                    ),
                }
            })?;
        }
    }

    Ok(Some(quarantine_path))
}

fn open_recovering_runtime_workflow_duckdb_for_load(
    context: &AdapterExecutionContext,
    node_id: &str,
) -> Result<Option<(DuckDbConnection, Option<PathBuf>)>, AdapterError> {
    let Some(database_path) = runtime_duckdb_path_from_context(context) else {
        return Ok(None);
    };

    ensure_runtime_workflow_duckdb_parent(database_path, node_id)?;
    let connection = match open_duckdb_connection_for_path(database_path) {
        Ok(connection) => connection,
        Err(open_failure) => {
            let failure_reason = format!(
                "workflow DuckDB at `{}` failed to open before load for node `{node_id}`: {open_failure}",
                database_path.display()
            );
            let quarantine_path =
                quarantine_workflow_duckdb_file(database_path, &failure_reason, node_id)?;
            let recreated_connection =
                open_duckdb_connection_for_path(database_path).map_err(|error| {
                    AdapterError::ExecutionFailed {
                        node_id: node_id.to_string(),
                        message: format!(
                            "workflow DuckDB at `{}` was recreated after open failure, but the new database could not be opened: {error}",
                            database_path.display()
                        ),
                    }
                })?;
            validate_runtime_workflow_duckdb_connection(
                &recreated_connection,
                database_path,
                node_id,
            )
            .map_err(|error| AdapterError::ExecutionFailed {
                node_id: node_id.to_string(),
                message: format!(
                    "workflow DuckDB at `{}` was recreated after open failure, but the new database failed validation: {error}",
                    database_path.display()
                ),
            })?;

            return Ok(Some((recreated_connection, quarantine_path)));
        }
    };

    match validate_runtime_workflow_duckdb_connection(&connection, database_path, node_id) {
        Ok(()) => Ok(Some((connection, None))),
        Err(validation_failure) => {
            drop(connection);
            let quarantine_path =
                quarantine_workflow_duckdb_file(database_path, &validation_failure, node_id)?;
            let Some(recreated_connection) = open_runtime_workflow_duckdb(context, node_id)? else {
                return Ok(None);
            };
            validate_runtime_workflow_duckdb_connection(
                &recreated_connection,
                database_path,
                node_id,
            )
            .map_err(|error| AdapterError::ExecutionFailed {
                node_id: node_id.to_string(),
                message: format!(
                    "workflow DuckDB at `{}` was recreated after validation failure, but the new database also failed validation: {error}",
                    database_path.display()
                ),
            })?;

            Ok(Some((recreated_connection, quarantine_path)))
        }
    }
}

fn quote_duckdb_identifier(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}

fn quote_duckdb_string_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn build_duckdb_column_definition_sql(
    columns: &[Value],
    node_id: &str,
) -> Result<String, AdapterError> {
    if columns.is_empty() {
        return Err(AdapterError::ExecutionFailed {
            node_id: node_id.to_string(),
            message: "cannot materialize a DuckDB table without any declared columns.".to_string(),
        });
    }

    let mut definitions = Vec::with_capacity(columns.len());
    for column in columns {
        let Some(object) = column.as_object() else {
            return Err(AdapterError::ExecutionFailed {
                node_id: node_id.to_string(),
                message: "declared table columns must be JSON objects.".to_string(),
            });
        };
        let column_name = object
            .get("name")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| AdapterError::ExecutionFailed {
                node_id: node_id.to_string(),
                message: "declared table columns must include a non-empty `name`.".to_string(),
            })?;
        let column_type = object
            .get("type")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| AdapterError::ExecutionFailed {
                node_id: node_id.to_string(),
                message: format!(
                    "declared table column `{column_name}` must include a non-empty `type`."
                ),
            })?;

        let mut definition = format!("{} {}", quote_duckdb_identifier(column_name), column_type);
        let nullable = object
            .get("nullable")
            .and_then(Value::as_bool)
            .unwrap_or(true);
        if !nullable {
            definition.push_str(" not null");
        }
        if let Some(default_expression) = object
            .get("default")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            definition.push_str(" default ");
            definition.push_str(default_expression);
        }

        definitions.push(definition);
    }

    Ok(definitions.join(", "))
}

fn persist_load_to_duckdb_tables(
    connection: &DuckDbConnection,
    target_schema: &str,
    resolved_bundle: &ResolvedLoadToDuckDbBundle,
    node_id: &str,
) -> Result<(), AdapterError> {
    let schema_identifier = quote_duckdb_identifier(target_schema);
    connection
        .execute_batch(&format!("create schema if not exists {schema_identifier};"))
        .map_err(|error| AdapterError::ExecutionFailed {
            node_id: node_id.to_string(),
            message: format!(
                "failed to ensure staging schema `{target_schema}` exists in workflow DuckDB: {error}"
            ),
        })?;

    for table in &resolved_bundle.loaded_tables {
        let table_identifier = quote_duckdb_identifier(&table.staging_table_name);
        let column_sql = build_duckdb_column_definition_sql(&table.columns, node_id)?;
        connection
            .execute_batch(&format!(
                "drop table if exists {schema_identifier}.{table_identifier};
                 create table {schema_identifier}.{table_identifier} ({column_sql});"
            ))
            .map_err(|error| AdapterError::ExecutionFailed {
                node_id: node_id.to_string(),
                message: format!(
                    "failed to create staging table `{target_schema}.{}`
                     in workflow DuckDB: {error}",
                    table.staging_table_name
                ),
            })?;
    }

    Ok(())
}

fn duckdb_table_exists(
    connection: &DuckDbConnection,
    schema_name: &str,
    table_name: &str,
    node_id: &str,
) -> Result<bool, AdapterError> {
    connection
        .query_row(
            "select count(*)
             from information_schema.tables
             where table_schema = ?1
               and table_name = ?2
               and table_type = 'BASE TABLE'",
            [schema_name, table_name],
            |row| row.get::<_, i64>(0),
        )
        .map(|count| count > 0)
        .map_err(|error| AdapterError::ExecutionFailed {
            node_id: node_id.to_string(),
            message: format!(
                "failed to inspect workflow DuckDB table `{schema_name}.{table_name}`: {error}"
            ),
        })
}

fn load_duckdb_table_column_names(
    connection: &DuckDbConnection,
    schema_name: &str,
    table_name: &str,
    node_id: &str,
) -> Result<Vec<String>, AdapterError> {
    let mut stmt = connection
        .prepare(
            "select column_name
             from information_schema.columns
             where table_schema = ?1
               and table_name = ?2
             order by ordinal_position asc",
        )
        .map_err(|error| AdapterError::ExecutionFailed {
            node_id: node_id.to_string(),
            message: format!(
                "failed to inspect columns for workflow DuckDB table `{schema_name}.{table_name}`: {error}"
            ),
        })?;

    stmt.query_map([schema_name, table_name], |row| row.get::<_, String>(0))
        .map_err(|error| AdapterError::ExecutionFailed {
            node_id: node_id.to_string(),
            message: format!(
                "failed to query columns for workflow DuckDB table `{schema_name}.{table_name}`: {error}"
            ),
        })?
        .collect::<duckdb::Result<Vec<_>>>()
        .map_err(|error| AdapterError::ExecutionFailed {
            node_id: node_id.to_string(),
            message: format!(
                "failed to collect columns for workflow DuckDB table `{schema_name}.{table_name}`: {error}"
            ),
        })
        .and_then(|columns| {
            if !columns.is_empty() {
                return Ok(columns);
            }

            let qualified_table = format!(
                "{}.{}",
                quote_duckdb_identifier(schema_name),
                quote_duckdb_identifier(table_name)
            );
            load_duckdb_query_column_names(
                connection,
                &format!("select * from {qualified_table}"),
                node_id,
            )
        })
}

fn source_tables_from_table_reference(
    table_payload: &TableReferencePayload,
    node_id: &str,
) -> Result<Vec<(String, String)>, AdapterError> {
    if let Some(definitions) = table_payload
        .schema_definitions
        .as_ref()
        .and_then(Value::as_array)
        .filter(|definitions| !definitions.is_empty())
    {
        return definitions
            .iter()
            .map(|definition| {
                let Some(object) = definition.as_object() else {
                    return Err(AdapterError::ExecutionFailed {
                        node_id: node_id.to_string(),
                        message: "table reference schema definitions must be JSON objects."
                            .to_string(),
                    });
                };
                let schema_name = object
                    .get("schema_name")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .unwrap_or(table_payload.schema_name.as_str())
                    .to_string();
                let table_name = object
                    .get("table_name")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .ok_or_else(|| AdapterError::ExecutionFailed {
                        node_id: node_id.to_string(),
                        message: "table reference schema definitions must include `table_name`."
                            .to_string(),
                    })?
                    .to_string();
                Ok((schema_name, table_name))
            })
            .collect();
    }

    Ok(vec![(
        table_payload.schema_name.clone(),
        table_payload.table_name.clone(),
    )])
}

fn resolve_sql_transform_source_table(
    table_payload: &TableReferencePayload,
    source_table_name: Option<&str>,
    node_id: &str,
) -> Result<(String, String), AdapterError> {
    let source_tables = source_tables_from_table_reference(table_payload, node_id)?;
    if let Some(source_table_name) = source_table_name
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let (schema_name, table_name) = parse_qualified_duckdb_table_name(
            source_table_name,
            &table_payload.schema_name,
            node_id,
        )?;
        if source_tables
            .iter()
            .any(|(candidate_schema, candidate_table)| {
                candidate_schema.eq_ignore_ascii_case(&schema_name)
                    && candidate_table.eq_ignore_ascii_case(&table_name)
            })
        {
            return Ok((schema_name, table_name));
        }

        return Err(AdapterError::ExecutionFailed {
            node_id: node_id.to_string(),
            message: format!(
                "sql_transform source table `{source_table_name}` did not match any incoming table references. Available tables: `{}`.",
                source_tables
                    .iter()
                    .map(|(schema_name, table_name)| format!("{schema_name}.{table_name}"))
                    .collect::<Vec<_>>()
                    .join("`, `")
            ),
        });
    }

    if source_tables.len() == 1 {
        return Ok(source_tables[0].clone());
    }

    Err(AdapterError::ExecutionFailed {
        node_id: node_id.to_string(),
        message: format!(
            "sql_transform requires `source_table_name` when multiple upstream tables are present. Available tables: `{}`.",
            source_tables
                .iter()
                .map(|(schema_name, table_name)| format!("{schema_name}.{table_name}"))
                .collect::<Vec<_>>()
                .join("`, `")
        ),
    })
}

fn render_sql_transform_sql(
    sql_text: &str,
    source_schema_name: &str,
    source_table_name: &str,
) -> String {
    let qualified_source = format!(
        "{}.{}",
        quote_duckdb_identifier(source_schema_name),
        quote_duckdb_identifier(source_table_name)
    );
    if let Some(rewritten_sql) =
        rewrite_simple_unpivot_sql_transform(sql_text, qualified_source.as_str())
    {
        return rewritten_sql;
    }

    sql_text
        .replace("{{source}}", &qualified_source)
        .replace(
            "{{source_schema}}",
            &quote_duckdb_identifier(source_schema_name),
        )
        .replace(
            "{{source_table}}",
            &quote_duckdb_identifier(source_table_name),
        )
}

fn find_ascii_case_insensitive(haystack: &str, needle: &str) -> Option<usize> {
    haystack
        .to_ascii_lowercase()
        .find(&needle.to_ascii_lowercase())
}

fn split_sql_comma_list(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .map(str::to_string)
        .collect()
}

fn trim_duckdb_identifier_quotes(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.len() >= 2 && trimmed.starts_with('"') && trimmed.ends_with('"') {
        return trimmed[1..trimmed.len() - 1].replace("\"\"", "\"");
    }
    trimmed.to_string()
}

fn rewrite_simple_unpivot_sql_transform(sql_text: &str, qualified_source: &str) -> Option<String> {
    let trimmed_sql = sql_text.trim();
    let select_prefix_end = find_ascii_case_insensitive(trimmed_sql, "select")?;
    if trimmed_sql[..select_prefix_end].trim().len() != 0 {
        return None;
    }

    let from_token = "from {{source}}";
    let from_index = find_ascii_case_insensitive(trimmed_sql, from_token)?;
    let select_list = trimmed_sql[select_prefix_end + "select".len()..from_index].trim();
    let after_source = trimmed_sql[from_index + from_token.len()..].trim();
    let unpivot_index = find_ascii_case_insensitive(after_source, "unpivot")?;
    if after_source[..unpivot_index].trim().len() != 0 {
        return None;
    }

    let unpivot_body = after_source[unpivot_index + "unpivot".len()..].trim();
    if !unpivot_body.starts_with('(') || !unpivot_body.ends_with(')') {
        return None;
    }
    let unpivot_body = unpivot_body[1..unpivot_body.len() - 1].trim();
    let for_index = find_ascii_case_insensitive(unpivot_body, " for ")?;
    let in_index = find_ascii_case_insensitive(unpivot_body, " in ")?;
    if for_index >= in_index {
        return None;
    }

    let value_alias = trim_duckdb_identifier_quotes(unpivot_body[..for_index].trim());
    let name_alias =
        trim_duckdb_identifier_quotes(unpivot_body[for_index + " for ".len()..in_index].trim());
    let in_list = unpivot_body[in_index + " in ".len()..].trim();
    if !in_list.starts_with('(') || !in_list.ends_with(')') {
        return None;
    }

    let source_columns = split_sql_comma_list(&in_list[1..in_list.len() - 1])
        .into_iter()
        .map(|column| trim_duckdb_identifier_quotes(column.as_str()))
        .collect::<Vec<_>>();
    if source_columns.is_empty() {
        return None;
    }

    let select_expressions = split_sql_comma_list(select_list);
    if select_expressions.is_empty() {
        return None;
    }

    let union_queries = source_columns
        .iter()
        .map(|source_column| {
            let source_identifier = quote_duckdb_identifier(source_column);
            let rewritten_select = select_expressions
                .iter()
                .map(|expression| {
                    let normalized_expression = trim_duckdb_identifier_quotes(expression);
                    if normalized_expression.eq_ignore_ascii_case(name_alias.as_str()) {
                        format!(
                            "{} as {}",
                            quote_duckdb_string_literal(source_column),
                            quote_duckdb_identifier(name_alias.as_str())
                        )
                    } else if normalized_expression.eq_ignore_ascii_case(value_alias.as_str()) {
                        format!(
                            "{source_identifier} as {}",
                            quote_duckdb_identifier(value_alias.as_str())
                        )
                    } else {
                        expression.clone()
                    }
                })
                .collect::<Vec<_>>()
                .join(", ");

            format!(
                "select {rewritten_select} from {qualified_source} where {source_identifier} is not null"
            )
        })
        .collect::<Vec<_>>();

    Some(union_queries.join(" union all "))
}

fn sql_transform_requires_table_materialization(sql_text: &str) -> bool {
    sql_text.to_ascii_lowercase().contains("unpivot")
}

fn merge_live_source_sql(qualified_source: &str, source_columns: &[String]) -> String {
    if source_columns
        .iter()
        .any(|column| column.eq_ignore_ascii_case("change_op"))
    {
        format!(
            "(select * from {qualified_source} where coalesce({}, '') <> 'removed')",
            quote_duckdb_identifier("change_op")
        )
    } else {
        qualified_source.to_string()
    }
}

fn duckdb_projection_for_columns(columns: &[String]) -> String {
    columns
        .iter()
        .map(|column| quote_duckdb_identifier(column))
        .collect::<Vec<_>>()
        .join(", ")
}

fn persist_table_merge_tables(
    connection: &DuckDbConnection,
    table_payload: &TableReferencePayload,
    target_schema: &str,
    write_policy: TableMergeWritePolicy,
    merge_key_columns: &[String],
    delete_handling: TableMergeDeleteHandling,
    node_id: &str,
) -> Result<(), AdapterError> {
    let target_schema_identifier = quote_duckdb_identifier(target_schema);
    connection
        .execute_batch(&format!(
            "create schema if not exists {target_schema_identifier};"
        ))
        .map_err(|error| AdapterError::ExecutionFailed {
            node_id: node_id.to_string(),
            message: format!(
                "failed to ensure durable schema `{target_schema}` exists in workflow DuckDB: {error}"
            ),
        })?;

    for (source_schema_name, source_table_name) in
        source_tables_from_table_reference(table_payload, node_id)?
    {
        let source_columns = load_duckdb_table_column_names(
            connection,
            &source_schema_name,
            &source_table_name,
            node_id,
        )?;
        if source_columns.is_empty() {
            return Err(AdapterError::ExecutionFailed {
                node_id: node_id.to_string(),
                message: format!(
                    "source staging table `{source_schema_name}.{source_table_name}` has no columns to merge."
                ),
            });
        }

        let qualified_source = format!(
            "{}.{}",
            quote_duckdb_identifier(&source_schema_name),
            quote_duckdb_identifier(&source_table_name)
        );
        let qualified_target = format!(
            "{}.{}",
            target_schema_identifier,
            quote_duckdb_identifier(&source_table_name)
        );
        let target_exists =
            duckdb_table_exists(connection, target_schema, &source_table_name, node_id)?;

        match write_policy {
            TableMergeWritePolicy::SnapshotReplace => {
                let source_projection = duckdb_projection_for_columns(&source_columns);
                connection
                    .execute_batch(&format!(
                        "create or replace table {qualified_target} as select {source_projection} from {qualified_source};"
                    ))
                    .map_err(|error| AdapterError::ExecutionFailed {
                        node_id: node_id.to_string(),
                        message: format!(
                            "failed to snapshot-replace `{target_schema}.{source_table_name}` from `{source_schema_name}.{source_table_name}`: {error}"
                        ),
                    })?;
            }
            TableMergeWritePolicy::AppendOnly => {
                if !target_exists {
                    let source_projection = duckdb_projection_for_columns(&source_columns);
                    connection
                        .execute_batch(&format!(
                            "create table {qualified_target} as select {source_projection} from {qualified_source};"
                        ))
                        .map_err(|error| AdapterError::ExecutionFailed {
                            node_id: node_id.to_string(),
                            message: format!(
                                "failed to create append target `{target_schema}.{source_table_name}` from `{source_schema_name}.{source_table_name}`: {error}"
                            ),
                        })?;
                } else {
                    let insert_columns = duckdb_projection_for_columns(&source_columns);
                    let source_projection = duckdb_projection_for_columns(&source_columns);
                    connection
                        .execute_batch(&format!(
                            "insert into {qualified_target} ({insert_columns}) select {source_projection} from {qualified_source};"
                        ))
                        .map_err(|error| AdapterError::ExecutionFailed {
                            node_id: node_id.to_string(),
                            message: format!(
                                "failed to append staged rows into `{target_schema}.{source_table_name}`: {error}"
                            ),
                        })?;
                }
            }
            TableMergeWritePolicy::Upsert => {
                if !target_exists {
                    let source_projection = duckdb_projection_for_columns(&source_columns);
                    connection
                        .execute_batch(&format!(
                            "create table {qualified_target} as select {source_projection} from {qualified_source};"
                        ))
                        .map_err(|error| AdapterError::ExecutionFailed {
                            node_id: node_id.to_string(),
                            message: format!(
                                "failed to create bootstrap merge target `{target_schema}.{source_table_name}` from `{source_schema_name}.{source_table_name}`: {error}"
                            ),
                        })?;
                    continue;
                }

                let available_columns = source_columns
                    .iter()
                    .map(|column| column.to_ascii_lowercase())
                    .collect::<Vec<_>>();
                let missing_merge_keys = merge_key_columns
                    .iter()
                    .filter_map(|key| {
                        let trimmed = key.trim();
                        if trimmed.is_empty()
                            || available_columns.contains(&trimmed.to_ascii_lowercase())
                        {
                            None
                        } else {
                            Some(trimmed.to_string())
                        }
                    })
                    .collect::<Vec<_>>();
                if !missing_merge_keys.is_empty() {
                    return Err(AdapterError::ExecutionFailed {
                        node_id: node_id.to_string(),
                        message: format!(
                            "merge key(s) `{}` do not exist on staging table `{source_schema_name}.{source_table_name}`.",
                            missing_merge_keys.join(", ")
                        ),
                    });
                }
                let normalized_merge_keys = merge_key_columns
                    .iter()
                    .map(|value| value.trim())
                    .filter(|value| !value.is_empty())
                    .collect::<Vec<_>>();
                if normalized_merge_keys.is_empty() {
                    return Err(AdapterError::ExecutionFailed {
                        node_id: node_id.to_string(),
                        message: format!(
                            "upsert merge into `{target_schema}.{source_table_name}` requires at least one merge key column."
                        ),
                    });
                }
                let target_columns = load_duckdb_table_column_names(
                    connection,
                    target_schema,
                    &source_table_name,
                    node_id,
                )?;
                let available_target_columns = target_columns
                    .iter()
                    .map(|column| column.to_ascii_lowercase())
                    .collect::<Vec<_>>();
                let missing_target_merge_keys = normalized_merge_keys
                    .iter()
                    .filter_map(|key| {
                        if available_target_columns.contains(&key.to_ascii_lowercase()) {
                            None
                        } else {
                            Some((*key).to_string())
                        }
                    })
                    .collect::<Vec<_>>();
                if !missing_target_merge_keys.is_empty() {
                    return Err(AdapterError::ExecutionFailed {
                        node_id: node_id.to_string(),
                        message: format!(
                            "merge key(s) `{}` do not exist on durable target table `{target_schema}.{source_table_name}`. Existing target columns: `{}`.",
                            missing_target_merge_keys.join(", "),
                            target_columns.join("`, `")
                        ),
                    });
                }
                let on_clause = normalized_merge_keys
                    .iter()
                    .map(|column| {
                        let identifier = quote_duckdb_identifier(column);
                        format!("target.{identifier} = source.{identifier}")
                    })
                    .collect::<Vec<_>>()
                    .join(" and ");

                if matches!(
                    delete_handling,
                    TableMergeDeleteHandling::ApplyDeleteMarkers
                ) && source_columns
                    .iter()
                    .any(|column| column.eq_ignore_ascii_case("change_op"))
                {
                    connection
                        .execute_batch(&format!(
                            "delete from {qualified_target} as target
                             using {qualified_source} as source
                             where {on_clause}
                               and source.{} = 'removed';",
                            quote_duckdb_identifier("change_op")
                        ))
                        .map_err(|error| AdapterError::ExecutionFailed {
                            node_id: node_id.to_string(),
                            message: format!(
                                "failed to apply delete markers into `{target_schema}.{source_table_name}`: {error}"
                            ),
                        })?;
                }

                let update_columns = source_columns
                    .iter()
                    .map(|column| {
                        let identifier = quote_duckdb_identifier(column);
                        format!("{identifier} = source.{identifier}")
                    })
                    .collect::<Vec<_>>()
                    .join(", ");
                let insert_columns = source_columns
                    .iter()
                    .map(|column| quote_duckdb_identifier(column))
                    .collect::<Vec<_>>()
                    .join(", ");
                let insert_values = source_columns
                    .iter()
                    .map(|column| {
                        let identifier = quote_duckdb_identifier(column);
                        format!("source.{identifier}")
                    })
                    .collect::<Vec<_>>()
                    .join(", ");
                let live_source_sql = merge_live_source_sql(&qualified_source, &source_columns);

                connection
                    .execute_batch(&format!(
                        "merge into {qualified_target} as target
                         using {live_source_sql} as source
                         on {on_clause}
                         when matched then
                           update set {update_columns}
                         when not matched then
                           insert ({insert_columns}) values ({insert_values});"
                    ))
                    .map_err(|error| AdapterError::ExecutionFailed {
                        node_id: node_id.to_string(),
                        message: format!(
                            "failed to upsert `{target_schema}.{source_table_name}` from `{source_schema_name}.{source_table_name}`: {error}"
                        ),
                    })?;
            }
        }
    }

    Ok(())
}

fn parse_qualified_duckdb_table_name(
    value: &str,
    default_schema: &str,
    node_id: &str,
) -> Result<(String, String), AdapterError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(AdapterError::ExecutionFailed {
            node_id: node_id.to_string(),
            message: "qualified DuckDB table name must not be empty.".to_string(),
        });
    }

    if let Some((schema_name, table_name)) = trimmed.rsplit_once('.') {
        let schema_name = schema_name.trim();
        let table_name = table_name.trim();
        if schema_name.is_empty() || table_name.is_empty() {
            return Err(AdapterError::ExecutionFailed {
                node_id: node_id.to_string(),
                message: format!("invalid qualified DuckDB table name `{trimmed}`."),
            });
        }
        Ok((schema_name.to_string(), table_name.to_string()))
    } else {
        Ok((default_schema.to_string(), trimmed.to_string()))
    }
}

fn persist_checkpoint_write_row(
    connection: &DuckDbConnection,
    checkpoint_table: &str,
    repository: &str,
    branch: &str,
    current_commit: &str,
    last_ingest_mode: &str,
    persisted_at: &str,
    commit_source: &str,
    write_timing: &str,
    table_payload: &TableReferencePayload,
    context: &AdapterExecutionContext,
    node_id: &str,
) -> Result<(), AdapterError> {
    let (schema_name, table_name) =
        parse_qualified_duckdb_table_name(checkpoint_table, "tables", node_id)?;
    let schema_identifier = quote_duckdb_identifier(&schema_name);
    let table_identifier = quote_duckdb_identifier(&table_name);
    let qualified_table = format!("{schema_identifier}.{table_identifier}");

    connection
        .execute_batch(&format!(
            "create schema if not exists {schema_identifier};
             create table if not exists {qualified_table} (
                 source_repo varchar not null,
                 branch varchar not null,
                 last_synced_commit varchar not null,
                 last_success_at varchar not null,
                 last_ingest_mode varchar not null,
                 persisted_at varchar not null,
                 commit_source varchar not null,
                 write_timing varchar not null,
                 target_schema varchar null,
                 target_table varchar null,
                 workflow_id varchar null,
                 run_id varchar null,
                 primary key (source_repo, branch)
             );"
        ))
        .map_err(|error| AdapterError::ExecutionFailed {
            node_id: node_id.to_string(),
            message: format!(
                "failed to ensure checkpoint table `{schema_name}.{table_name}` exists in workflow DuckDB: {error}"
            ),
        })?;

    connection
        .execute_batch(&format!(
            "insert or replace into {qualified_table} (
                 source_repo,
                 branch,
                 last_synced_commit,
                 last_success_at,
                 last_ingest_mode,
                 persisted_at,
                 commit_source,
                 write_timing,
                 target_schema,
                 target_table,
                 workflow_id,
                 run_id
             ) values (
                 {},
                 {},
                 {},
                 {},
                 {},
                 {},
                 {},
                 {},
                 {},
                 {},
                 {},
                 {}
             );",
            quote_duckdb_string_literal(repository),
            quote_duckdb_string_literal(branch),
            quote_duckdb_string_literal(current_commit),
            quote_duckdb_string_literal(persisted_at),
            quote_duckdb_string_literal(last_ingest_mode),
            quote_duckdb_string_literal(persisted_at),
            quote_duckdb_string_literal(commit_source),
            quote_duckdb_string_literal(write_timing),
            quote_duckdb_string_literal(table_payload.schema_name.trim()),
            quote_duckdb_string_literal(table_payload.table_name.trim()),
            quote_duckdb_string_literal(context.workflow_id.as_deref().unwrap_or_default()),
            quote_duckdb_string_literal(context.run_id.as_deref().unwrap_or_default()),
        ))
        .map_err(|error| AdapterError::ExecutionFailed {
            node_id: node_id.to_string(),
            message: format!(
                "failed to persist checkpoint row into `{schema_name}.{table_name}`: {error}"
            ),
        })?;

    Ok(())
}

fn execute_load_to_duckdb(
    node: &WorkflowNode,
    inputs: &PortValues,
    context: &AdapterExecutionContext,
) -> Result<NodeExecutionResult, AdapterError> {
    let config: LoadToDuckDbConfig =
        serde_json::from_value(node.config.clone()).map_err(|error| {
            AdapterError::InvalidConfig {
                node_id: node.node_id.clone(),
                message: error.to_string(),
            }
        })?;

    let bundle_input = inputs
        .get("bundle")
        .ok_or_else(|| AdapterError::MissingInput {
            node_id: node.node_id.clone(),
            port: "bundle".to_string(),
        })?;

    if bundle_input.data_type != DataType::DirectoryRef {
        return Err(AdapterError::ExecutionFailed {
            node_id: node.node_id.clone(),
            message: "load_to_duckdb expects a `directory_ref` bundle input.".to_string(),
        });
    }

    let target_schema = config.target_schema.trim();
    if target_schema.is_empty() {
        return Err(AdapterError::InvalidConfig {
            node_id: node.node_id.clone(),
            message: "`target_schema` must not be empty.".to_string(),
        });
    }

    let table_mapping = config
        .table_mapping
        .unwrap_or(LoadToDuckDbTableMapping::BundleAwareStagingNames);
    let schema_handling = config
        .schema_handling
        .unwrap_or(LoadToDuckDbSchemaHandling::InferOnFirstLoadValidateOnRecurring);
    let delta_context_preservation = config
        .delta_context_preservation
        .unwrap_or(LoadToDuckDbDeltaContextPreservation::PreserveCommitRangeAndDeleteFlags);
    let input_kind = bundle_input
        .value
        .get("kind")
        .and_then(Value::as_str)
        .unwrap_or_default();

    let mut resolved_bundle = match input_kind {
        "dolt_dump_bundle" => {
            let payload: DoltDumpBundlePayload = serde_json::from_value(bundle_input.value.clone())
                .map_err(|error| AdapterError::ExecutionFailed {
                    node_id: node.node_id.clone(),
                    message: format!("invalid dolt dump bundle payload: {error}"),
                })?;
            resolve_load_to_duckdb_dump_bundle(payload)
        }
        "dolt_diff_export_bundle" => {
            let payload: DoltDiffExportBundlePayload =
                serde_json::from_value(bundle_input.value.clone()).map_err(|error| {
                    AdapterError::ExecutionFailed {
                        node_id: node.node_id.clone(),
                        message: format!("invalid dolt diff export bundle payload: {error}"),
                    }
                })?;
            resolve_load_to_duckdb_diff_bundle(payload)
        }
        other => {
            return Err(AdapterError::ExecutionFailed {
                node_id: node.node_id.clone(),
                message: format!(
                    "unsupported load_to_duckdb input kind `{other}`; expected `dolt_dump_bundle` or `dolt_diff_export_bundle`"
                ),
            })
        }
    }?;

    let load_manifest_path = build_load_to_duckdb_manifest_path(
        &resolved_bundle.repo_family,
        &resolved_bundle.bundle_kind,
        resolved_bundle.previous_commit.as_deref(),
        &resolved_bundle.current_commit,
    );
    let mut loaded_from_files = false;
    let mut recovered_duckdb_path = None;
    if let Some((connection, quarantine_path)) =
        open_recovering_runtime_workflow_duckdb_for_load(context, &node.node_id)?
    {
        recovered_duckdb_path = quarantine_path;
        loaded_from_files = persist_load_to_duckdb_tables_from_files(
            &connection,
            context,
            target_schema,
            &mut resolved_bundle,
            &node.node_id,
        )?;
        if !loaded_from_files {
            persist_load_to_duckdb_tables(
                &connection,
                target_schema,
                &resolved_bundle,
                &node.node_id,
            )?;
        }
    }

    let primary_table =
        resolved_bundle
            .loaded_tables
            .first()
            .ok_or_else(|| AdapterError::ExecutionFailed {
                node_id: node.node_id.clone(),
                message: "bundle did not resolve any loadable tables.".to_string(),
            })?;
    let schema_definitions = resolved_bundle
        .loaded_tables
        .iter()
        .map(|table| {
            json!({
                "schema_name": target_schema,
                "table_name": table.staging_table_name,
                "output_alias": table.staging_table_name,
                "columns": table.columns,
                "primary_key": [],
                "checks": [],
                "source_table": table.source_table,
                "load_mode": table.load_mode,
            })
        })
        .collect::<Vec<_>>();
    let loaded_tables_metadata = resolved_bundle
        .loaded_tables
        .iter()
        .map(|table| {
            let mut value = json!({
                "source_table": table.source_table,
                "target_table": format!("{target_schema}.{}", table.staging_table_name),
                "load_mode": table.load_mode,
                "file_path": table.file_path,
            });
            if let Some(row_count) = table.row_count {
                value["row_count"] = json!(row_count);
            }
            if let Some(added_rows) = table.added_rows {
                value["added_rows"] = json!(added_rows);
            }
            if let Some(modified_rows) = table.modified_rows {
                value["modified_rows"] = json!(modified_rows);
            }
            if let Some(removed_rows) = table.removed_rows {
                value["removed_rows"] = json!(removed_rows);
            }
            if let Some(delete_markers_emitted) = table.delete_markers_emitted {
                value["delete_markers_emitted"] = json!(delete_markers_emitted);
            }
            if let Some(delete_marker_path) = &table.delete_marker_path {
                value["delete_marker_path"] = json!(delete_marker_path);
            }
            value
        })
        .collect::<Vec<_>>();

    let mut outputs = PortValues::new();
    outputs.insert(
        "table".to_string(),
        TypedValue {
            data_type: DataType::TableRef,
            value: json!({
                "kind": "table_reference",
                "catalog": "workflow.duckdb",
                "schema_name": target_schema,
                "table_name": primary_table.staging_table_name,
                "output_alias": primary_table.staging_table_name,
                "selected_columns": [],
                "row_filter": Value::Null,
                "row_limit": Value::Null,
                "refresh_schema": true,
                "open_in_catalog": false,
                "schema_definition": {
                    "columns": primary_table.columns,
                    "primary_key": [],
                    "checks": [],
                    "load_mode": primary_table.load_mode,
                },
                "schema_definitions": if schema_definitions.len() > 1 {
                    Some(Value::Array(schema_definitions))
                } else {
                    None
                },
                "load_manifest_ref": {
                    "kind": "load_manifest_ref",
                    "path": load_manifest_path,
                    "target_schema": target_schema,
                },
                "metadata": {
                    "bundle_kind": resolved_bundle.bundle_kind,
                    "branch": resolved_bundle.branch,
                    "directory_format": resolved_bundle.directory_format,
                    "directory_path": resolved_bundle.directory_path,
                    "repo_family": resolved_bundle.repo_family,
                    "repository": resolved_bundle.repository,
                    "table_mapping": table_mapping.as_str(),
                    "schema_handling": schema_handling.as_str(),
                    "delta_context_preservation": delta_context_preservation.as_str(),
                    "previous_commit": resolved_bundle.previous_commit,
                    "current_commit": resolved_bundle.current_commit,
                    "delete_rows_present": resolved_bundle.delete_rows_present,
                    "loaded_tables": loaded_tables_metadata,
                }
            }),
        },
    );

    let table_count = resolved_bundle.loaded_tables.len();
    let bundle_label = if input_kind == "dolt_diff_export_bundle" {
        "delta bundle"
    } else {
        "snapshot bundle"
    };
    let merge_context_summary = if resolved_bundle.delete_rows_present {
        format!(
            "commit range {} -> {} with delete markers",
            resolved_bundle
                .previous_commit
                .as_deref()
                .unwrap_or("pending_checkpoint"),
            resolved_bundle.current_commit
        )
    } else if let Some(previous_commit) = resolved_bundle.previous_commit.as_deref() {
        format!(
            "commit range {previous_commit} -> {}",
            resolved_bundle.current_commit
        )
    } else {
        format!("current commit {}", resolved_bundle.current_commit)
    };

    let mut logs = Vec::new();
    if let Some(quarantine_path) = recovered_duckdb_path {
        logs.push(format!(
            "Recreated workflow DuckDB after open/validation failure; quarantined previous database at `{}`.",
            quarantine_path.display()
        ));
    }
    logs.push(format!(
        "Prepared {table_count} staging table(s) in `{target_schema}` from {bundle_label} for `{repository}` using `{table_mapping}` and `{schema_handling}` ({merge_context_summary}; {load_summary}).",
        repository = resolved_bundle.repository,
        table_mapping = table_mapping.as_str(),
        schema_handling = schema_handling.as_str(),
        load_summary = if loaded_from_files {
            "loaded bundle files into DuckDB"
        } else {
            "used bundle metadata only"
        }
    ));

    Ok(NodeExecutionResult { outputs, logs })
}

fn execute_table_merge(
    node: &WorkflowNode,
    inputs: &PortValues,
    context: &AdapterExecutionContext,
) -> Result<NodeExecutionResult, AdapterError> {
    let config: TableMergeConfig =
        serde_json::from_value(node.config.clone()).map_err(|error| {
            AdapterError::InvalidConfig {
                node_id: node.node_id.clone(),
                message: error.to_string(),
            }
        })?;

    let table_input = inputs
        .get("table")
        .ok_or_else(|| AdapterError::MissingInput {
            node_id: node.node_id.clone(),
            port: "table".to_string(),
        })?;

    if table_input.data_type != DataType::TableRef {
        return Err(AdapterError::ExecutionFailed {
            node_id: node.node_id.clone(),
            message: "table_merge expects a `table_ref` input.".to_string(),
        });
    }

    let table_payload: TableReferencePayload = serde_json::from_value(table_input.value.clone())
        .map_err(|error| AdapterError::ExecutionFailed {
            node_id: node.node_id.clone(),
            message: format!("invalid table reference payload: {error}"),
        })?;

    if table_payload.kind != "table_reference" {
        return Err(AdapterError::ExecutionFailed {
            node_id: node.node_id.clone(),
            message: format!("unsupported table reference kind `{}`", table_payload.kind),
        });
    }

    let target_schema = config.target_schema.trim();
    if target_schema.is_empty() {
        return Err(AdapterError::InvalidConfig {
            node_id: node.node_id.clone(),
            message: "`target_schema` must not be empty.".to_string(),
        });
    }

    let write_policy = config.write_policy.unwrap_or(TableMergeWritePolicy::Upsert);
    let delete_handling = config
        .delete_handling
        .unwrap_or(TableMergeDeleteHandling::ApplyDeleteMarkers);
    let schema_drift_behavior = config
        .schema_drift_behavior
        .unwrap_or(TableMergeSchemaDriftBehavior::FailAndRequireReview);
    let merge_key_columns = config
        .merge_key_columns
        .unwrap_or_default()
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    let merged_table_count = table_payload
        .schema_definitions
        .as_ref()
        .and_then(Value::as_array)
        .map(|entries| entries.len())
        .unwrap_or(1);

    let write_policy_label = match write_policy {
        TableMergeWritePolicy::AppendOnly => "append_only",
        TableMergeWritePolicy::SnapshotReplace => "snapshot_replace",
        TableMergeWritePolicy::Upsert => "upsert",
    };
    let delete_handling_label = match delete_handling {
        TableMergeDeleteHandling::IgnoreDeleteMarkers => "ignore_delete_markers",
        TableMergeDeleteHandling::ApplyDeleteMarkers => "apply_delete_markers",
    };
    let schema_drift_label = match schema_drift_behavior {
        TableMergeSchemaDriftBehavior::AllowAdditiveChanges => "allow_additive_changes",
        TableMergeSchemaDriftBehavior::FailAndRequireReview => "fail_and_require_review",
    };
    let mut metadata = match table_payload.metadata.clone() {
        Some(Value::Object(object)) => Value::Object(object),
        Some(_) | None => json!({}),
    };
    if let Some(metadata_object) = metadata.as_object_mut() {
        metadata_object.insert(
            "source_schema".to_string(),
            json!(table_payload.schema_name.clone()),
        );
        metadata_object.insert("write_policy".to_string(), json!(write_policy_label));
        metadata_object.insert(
            "merge_key_columns".to_string(),
            json!(merge_key_columns.clone()),
        );
        metadata_object.insert("delete_handling".to_string(), json!(delete_handling_label));
        metadata_object.insert(
            "schema_drift_behavior".to_string(),
            json!(schema_drift_label),
        );
        metadata_object.insert("merged_table_count".to_string(), json!(merged_table_count));
        metadata_object.insert(
            "merge_summary".to_string(),
            json!({
                "write_policy": write_policy_label,
                "merge_key_columns": merge_key_columns,
                "delete_handling": delete_handling_label,
                "schema_drift_behavior": schema_drift_label,
                "merged_table_count": merged_table_count,
            }),
        );
    }

    if let Some(connection) = open_runtime_workflow_duckdb(context, &node.node_id)? {
        persist_table_merge_tables(
            &connection,
            &table_payload,
            target_schema,
            write_policy,
            &merge_key_columns,
            delete_handling,
            &node.node_id,
        )?;
    }

    let mut outputs = PortValues::new();
    outputs.insert(
        "table".to_string(),
        TypedValue {
            data_type: DataType::TableRef,
            value: json!({
                "kind": "table_reference",
                "catalog": table_payload.catalog,
                "schema_name": target_schema,
                "table_name": table_payload.table_name,
                "output_alias": table_payload.output_alias,
                "selected_columns": table_payload.selected_columns,
                "row_filter": table_payload.row_filter,
                "row_limit": table_payload.row_limit,
                "refresh_schema": true,
                "open_in_catalog": table_payload.open_in_catalog,
                "schema_definition": table_payload.schema_definition,
                "schema_definitions": table_payload.schema_definitions,
                "load_manifest_ref": table_payload.load_manifest_ref,
                "metadata": metadata,
            }),
        },
    );

    Ok(NodeExecutionResult {
        outputs,
        logs: vec![format!(
            "Prepared {write_policy_label} merge into `{target_schema}` from `{}.{}` across {merged_table_count} table definition(s){}.",
            table_payload.schema_name,
            table_payload.table_name,
            if merge_key_columns.is_empty() {
                String::new()
            } else {
                format!(" using merge key `{}`", merge_key_columns.join(", "))
            }
        )],
    })
}

fn execute_sql_transform(
    node: &WorkflowNode,
    inputs: &PortValues,
    context: &AdapterExecutionContext,
) -> Result<NodeExecutionResult, AdapterError> {
    let config: SqlTransformConfig =
        serde_json::from_value(node.config.clone()).map_err(|error| {
            AdapterError::InvalidConfig {
                node_id: node.node_id.clone(),
                message: error.to_string(),
            }
        })?;

    let table_input = inputs
        .get("table")
        .ok_or_else(|| AdapterError::MissingInput {
            node_id: node.node_id.clone(),
            port: "table".to_string(),
        })?;

    if table_input.data_type != DataType::TableRef {
        return Err(AdapterError::ExecutionFailed {
            node_id: node.node_id.clone(),
            message: "sql_transform expects a `table_ref` input.".to_string(),
        });
    }

    let table_payload: TableReferencePayload = serde_json::from_value(table_input.value.clone())
        .map_err(|error| AdapterError::ExecutionFailed {
            node_id: node.node_id.clone(),
            message: format!("invalid table reference payload: {error}"),
        })?;

    if table_payload.kind != "table_reference" {
        return Err(AdapterError::ExecutionFailed {
            node_id: node.node_id.clone(),
            message: format!("unsupported table reference kind `{}`", table_payload.kind),
        });
    }

    let target_schema = config.target_schema.trim();
    if target_schema.is_empty() {
        return Err(AdapterError::InvalidConfig {
            node_id: node.node_id.clone(),
            message: "`target_schema` must not be empty.".to_string(),
        });
    }

    let output_table_name = config.output_table_name.trim();
    if output_table_name.is_empty() {
        return Err(AdapterError::InvalidConfig {
            node_id: node.node_id.clone(),
            message: "`output_table_name` must not be empty.".to_string(),
        });
    }

    let sql_text = config.sql_text.trim();
    if sql_text.is_empty() {
        return Err(AdapterError::InvalidConfig {
            node_id: node.node_id.clone(),
            message: "`sql_text` must not be empty.".to_string(),
        });
    }

    let materialization_mode = config
        .materialization_mode
        .unwrap_or(SqlTransformMaterializationMode::View);
    let materialize_as_table = sql_transform_requires_table_materialization(sql_text);
    let (source_schema_name, source_table_name) = resolve_sql_transform_source_table(
        &table_payload,
        config.source_table_name.as_deref(),
        &node.node_id,
    )?;

    let connection = open_runtime_workflow_duckdb(context, &node.node_id)?.ok_or_else(|| {
        AdapterError::ExecutionFailed {
            node_id: node.node_id.clone(),
            message: "sql_transform requires a workflow-local DuckDB context.".to_string(),
        }
    })?;

    if !materialize_as_table
        && duckdb_table_exists(&connection, target_schema, output_table_name, &node.node_id)?
    {
        return Err(AdapterError::ExecutionFailed {
            node_id: node.node_id.clone(),
            message: format!(
                "sql_transform cannot create view `{target_schema}.{output_table_name}` because a base table with that name already exists."
            ),
        });
    }

    let schema_identifier = quote_duckdb_identifier(target_schema);
    let table_identifier = quote_duckdb_identifier(output_table_name);
    let qualified_output = format!("{schema_identifier}.{table_identifier}");
    let rendered_sql = render_sql_transform_sql(sql_text, &source_schema_name, &source_table_name);
    let materialization_sql = if materialize_as_table {
        format!(
            "create schema if not exists {schema_identifier};
             create or replace table {qualified_output} as {rendered_sql};"
        )
    } else {
        format!(
            "create schema if not exists {schema_identifier};
             create or replace view {qualified_output} as {rendered_sql};"
        )
    };
    connection
        .execute_batch(&materialization_sql)
        .map_err(|error| AdapterError::ExecutionFailed {
            node_id: node.node_id.clone(),
            message: format!(
                "failed to materialize sql_transform `{target_schema}.{output_table_name}`: {error}"
            ),
        })?;

    let transformed_columns = describe_duckdb_table_columns(
        &connection,
        target_schema,
        output_table_name,
        &node.node_id,
    )?;
    let mut metadata = match table_payload.metadata.clone() {
        Some(Value::Object(object)) => Value::Object(object),
        Some(_) | None => json!({}),
    };
    if let Some(metadata_object) = metadata.as_object_mut() {
        metadata_object.insert(
            "source_schema".to_string(),
            json!(source_schema_name.clone()),
        );
        metadata_object.insert("source_table".to_string(), json!(source_table_name.clone()));
        metadata_object.insert("transform_kind".to_string(), json!("sql_transform"));
        metadata_object.insert(
            "materialization_mode".to_string(),
            json!(if materialize_as_table {
                "table"
            } else {
                "view"
            }),
        );
        metadata_object.insert("target_schema".to_string(), json!(target_schema));
        metadata_object.insert("target_table".to_string(), json!(output_table_name));
    }

    let mut outputs = PortValues::new();
    outputs.insert(
        "table".to_string(),
        TypedValue {
            data_type: DataType::TableRef,
            value: json!({
                "kind": "table_reference",
                "catalog": table_payload.catalog,
                "schema_name": target_schema,
                "table_name": output_table_name,
                "output_alias": output_table_name,
                "selected_columns": [],
                "row_filter": Value::Null,
                "row_limit": Value::Null,
                "refresh_schema": true,
                "open_in_catalog": table_payload.open_in_catalog,
                "schema_definition": {
                    "columns": transformed_columns,
                    "primary_key": [],
                    "checks": [],
                },
                "schema_definitions": Value::Null,
                "load_manifest_ref": table_payload.load_manifest_ref,
                "metadata": metadata,
            }),
        },
    );

    let mode_label = match materialization_mode {
        SqlTransformMaterializationMode::View => "view",
    };
    let mode_label = if materialize_as_table {
        "table"
    } else {
        mode_label
    };

    Ok(NodeExecutionResult {
        outputs,
        logs: vec![format!(
            "Prepared sql_transform {mode_label} `{target_schema}.{output_table_name}` from `{source_schema_name}.{source_table_name}` using workflow-local DuckDB."
        )],
    })
}

fn execute_quality_check(
    node: &WorkflowNode,
    inputs: &PortValues,
) -> Result<NodeExecutionResult, AdapterError> {
    let config: QualityCheckConfig =
        serde_json::from_value(node.config.clone()).map_err(|error| {
            AdapterError::InvalidConfig {
                node_id: node.node_id.clone(),
                message: error.to_string(),
            }
        })?;

    let table_input = inputs
        .get("table")
        .ok_or_else(|| AdapterError::MissingInput {
            node_id: node.node_id.clone(),
            port: "table".to_string(),
        })?;

    if table_input.data_type != DataType::TableRef {
        return Err(AdapterError::ExecutionFailed {
            node_id: node.node_id.clone(),
            message: "quality_check expects a `table_ref` input.".to_string(),
        });
    }

    let table_payload: TableReferencePayload = serde_json::from_value(table_input.value.clone())
        .map_err(|error| AdapterError::ExecutionFailed {
            node_id: node.node_id.clone(),
            message: format!("invalid table reference payload: {error}"),
        })?;

    if table_payload.kind != "table_reference" {
        return Err(AdapterError::ExecutionFailed {
            node_id: node.node_id.clone(),
            message: format!("unsupported table reference kind `{}`", table_payload.kind),
        });
    }

    let suite_preset = config
        .suite_preset
        .unwrap_or(QualityCheckSuitePreset::PostMergeIngestGate);
    let schema_drift_rule = config
        .schema_drift_rule
        .unwrap_or(QualityCheckSchemaDriftRule::FailOnRequiredColumnDrift);
    let null_key_policy = config
        .null_key_policy
        .unwrap_or(QualityCheckNullKeyPolicy::BlockOnPrimaryKeyNulls);
    let warning_budget = config.warning_budget.unwrap_or(2);
    let block_checkpoint_write_on_failure =
        config.block_checkpoint_write_on_failure.unwrap_or(true);
    let allow_warning_only_runs_to_continue =
        config.allow_warning_only_runs_to_continue.unwrap_or(true);
    let metadata = match table_payload.metadata.clone() {
        Some(Value::Object(object)) => Value::Object(object),
        Some(_) | None => json!({}),
    };
    let repository = metadata
        .get("repository")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("unknown_repo")
        .to_string();

    let warning_rules = if repository == "post-no-preference/earnings" {
        vec![
            "freshness lag".to_string(),
            "soft schema drift note".to_string(),
        ]
    } else {
        Vec::new()
    };
    let mut failing_rules = Vec::new();
    let gate_status = if warning_rules.len() as u64 > warning_budget {
        failing_rules.push("warning_budget_exceeded".to_string());
        "fail"
    } else if !warning_rules.is_empty() {
        "warn"
    } else {
        "pass"
    };

    if gate_status == "fail" && block_checkpoint_write_on_failure {
        return Err(AdapterError::ExecutionFailed {
            node_id: node.node_id.clone(),
            message: format!(
                "quality gate failed for `{}` and checkpoint advancement is blocked.",
                repository
            ),
        });
    }

    if gate_status == "warn" && !allow_warning_only_runs_to_continue {
        return Err(AdapterError::ExecutionFailed {
            node_id: node.node_id.clone(),
            message: format!(
                "quality gate returned warnings for `{}` and warning-only continuation is disabled.",
                repository
            ),
        });
    }

    let approved_table_set = extract_table_reference_table_names(&table_payload)
        .into_iter()
        .map(|table_name| format!("{}.{}", table_payload.schema_name, table_name))
        .collect::<Vec<_>>();

    let quality_gate_result = json!({
        "kind": "quality_gate_result",
        "suite_preset": suite_preset.as_str(),
        "schema_drift_rule": schema_drift_rule.as_str(),
        "null_key_policy": null_key_policy.as_str(),
        "warning_budget": warning_budget,
        "gate_status": gate_status,
        "failing_rules": failing_rules,
        "warning_rules": warning_rules,
        "approved_table_set": approved_table_set,
        "block_checkpoint_write_on_failure": block_checkpoint_write_on_failure,
        "allow_warning_only_runs_to_continue": allow_warning_only_runs_to_continue,
    });
    let mut next_metadata = metadata;
    if let Some(metadata_object) = next_metadata.as_object_mut() {
        metadata_object.insert("quality_check".to_string(), quality_gate_result);
    }

    let mut outputs = PortValues::new();
    outputs.insert(
        "table".to_string(),
        TypedValue {
            data_type: DataType::TableRef,
            value: json!({
                "kind": "table_reference",
                "catalog": table_payload.catalog,
                "schema_name": table_payload.schema_name,
                "table_name": table_payload.table_name,
                "output_alias": table_payload.output_alias,
                "selected_columns": table_payload.selected_columns,
                "row_filter": table_payload.row_filter,
                "row_limit": table_payload.row_limit,
                "refresh_schema": true,
                "open_in_catalog": table_payload.open_in_catalog,
                "schema_definition": table_payload.schema_definition,
                "schema_definitions": table_payload.schema_definitions,
                "load_manifest_ref": table_payload.load_manifest_ref,
                "metadata": next_metadata,
            }),
        },
    );

    Ok(NodeExecutionResult {
        outputs,
        logs: vec![format!(
            "Applied quality gate `{}` to `{}` with status `{}` and warning budget {}.",
            suite_preset.as_str(),
            repository,
            gate_status,
            warning_budget
        )],
    })
}

fn execute_checkpoint_write(
    node: &WorkflowNode,
    inputs: &PortValues,
    context: &AdapterExecutionContext,
) -> Result<NodeExecutionResult, AdapterError> {
    let config: CheckpointWriteConfig =
        serde_json::from_value(node.config.clone()).map_err(|error| {
            AdapterError::InvalidConfig {
                node_id: node.node_id.clone(),
                message: error.to_string(),
            }
        })?;

    let table_input = inputs
        .get("table")
        .ok_or_else(|| AdapterError::MissingInput {
            node_id: node.node_id.clone(),
            port: "table".to_string(),
        })?;

    if table_input.data_type != DataType::TableRef {
        return Err(AdapterError::ExecutionFailed {
            node_id: node.node_id.clone(),
            message: "checkpoint_write expects a `table_ref` input.".to_string(),
        });
    }

    let table_payload: TableReferencePayload = serde_json::from_value(table_input.value.clone())
        .map_err(|error| AdapterError::ExecutionFailed {
            node_id: node.node_id.clone(),
            message: format!("invalid table reference payload: {error}"),
        })?;

    if table_payload.kind != "table_reference" {
        return Err(AdapterError::ExecutionFailed {
            node_id: node.node_id.clone(),
            message: format!("unsupported table reference kind `{}`", table_payload.kind),
        });
    }

    let checkpoint_table = config.checkpoint_table.trim();
    if checkpoint_table.is_empty() {
        return Err(AdapterError::InvalidConfig {
            node_id: node.node_id.clone(),
            message: "`checkpoint_table` must not be empty.".to_string(),
        });
    }

    let commit_source = config
        .commit_source
        .unwrap_or(CheckpointWriteCommitSource::MetadataCurrentCommit);
    let write_timing = config
        .write_timing
        .unwrap_or(CheckpointWriteTiming::AfterMergeSuccess);
    let only_persist_on_full_success = config.only_persist_on_full_success.unwrap_or(true);
    let advance_on_partial_success = config.advance_on_partial_success.unwrap_or(false);
    let metadata = match table_payload.metadata.clone() {
        Some(Value::Object(object)) => Value::Object(object),
        Some(_) | None => json!({}),
    };
    let repository = metadata
        .get("repository")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AdapterError::ExecutionFailed {
            node_id: node.node_id.clone(),
            message: "checkpoint_write requires upstream table metadata to include `repository`."
                .to_string(),
        })?
        .to_string();
    let branch = metadata
        .get("branch")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AdapterError::ExecutionFailed {
            node_id: node.node_id.clone(),
            message: "checkpoint_write requires upstream table metadata to include `branch`."
                .to_string(),
        })?
        .to_string();
    let current_commit = metadata
        .get("current_commit")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AdapterError::ExecutionFailed {
            node_id: node.node_id.clone(),
            message:
                "checkpoint_write requires upstream table metadata to include `current_commit`."
                    .to_string(),
        })?
        .to_string();
    let previous_commit = metadata
        .get("previous_commit")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let last_ingest_mode = if previous_commit.is_some() {
        "recurring_delta"
    } else {
        "bootstrap_refresh"
    };
    let persisted_at = if runtime_duckdb_path_from_context(context).is_some() {
        Utc::now().to_rfc3339()
    } else {
        mock_checkpoint_success_at(&repository).to_string()
    };
    let checkpoint_write_result = json!({
        "kind": "checkpoint_write_result",
        "checkpoint_table": checkpoint_table,
        "source_repo": repository.clone(),
        "branch": branch.clone(),
        "last_synced_commit": current_commit.clone(),
        "last_success_at": persisted_at.clone(),
        "last_ingest_mode": last_ingest_mode,
        "persisted_at": persisted_at.clone(),
        "commit_source": commit_source.as_str(),
        "write_timing": write_timing.as_str(),
        "only_persist_on_full_success": only_persist_on_full_success,
        "advance_on_partial_success": advance_on_partial_success,
    });

    if let Some(connection) = open_runtime_workflow_duckdb(context, &node.node_id)? {
        persist_checkpoint_write_row(
            &connection,
            checkpoint_table,
            &repository,
            &branch,
            &current_commit,
            last_ingest_mode,
            &persisted_at,
            commit_source.as_str(),
            write_timing.as_str(),
            &table_payload,
            context,
            &node.node_id,
        )?;
    }

    let mut next_metadata = metadata;
    if let Some(metadata_object) = next_metadata.as_object_mut() {
        metadata_object.insert("checkpoint_write".to_string(), checkpoint_write_result);
    }

    let mut outputs = PortValues::new();
    outputs.insert(
        "table".to_string(),
        TypedValue {
            data_type: DataType::TableRef,
            value: json!({
                "kind": "table_reference",
                "catalog": table_payload.catalog,
                "schema_name": table_payload.schema_name,
                "table_name": table_payload.table_name,
                "output_alias": table_payload.output_alias,
                "selected_columns": table_payload.selected_columns,
                "row_filter": table_payload.row_filter,
                "row_limit": table_payload.row_limit,
                "refresh_schema": true,
                "open_in_catalog": table_payload.open_in_catalog,
                "schema_definition": table_payload.schema_definition,
                "schema_definitions": table_payload.schema_definitions,
                "load_manifest_ref": table_payload.load_manifest_ref,
                "metadata": next_metadata,
            }),
        },
    );

    Ok(NodeExecutionResult {
        outputs,
        logs: vec![format!(
            "Prepared checkpoint write to `{checkpoint_table}` for `{repository}` on `{branch}` at commit `{current_commit}` using `{}`.",
            write_timing.as_str()
        )],
    })
}

struct ResolvedLoadToDuckDbBundle {
    branch: String,
    bundle_kind: &'static str,
    current_commit: String,
    delete_rows_present: bool,
    directory_format: String,
    directory_path: String,
    loaded_tables: Vec<ResolvedLoadToDuckDbTable>,
    previous_commit: Option<String>,
    repo_family: String,
    repository: String,
}

struct ResolvedLoadToDuckDbTable {
    added_rows: Option<u64>,
    columns: Vec<Value>,
    delete_marker_path: Option<String>,
    delete_markers_emitted: Option<bool>,
    file_path: String,
    load_mode: &'static str,
    modified_rows: Option<u64>,
    removed_rows: Option<u64>,
    row_count: Option<u64>,
    source_table: String,
    staging_table_name: String,
}

fn resolve_load_to_duckdb_dump_bundle(
    payload: DoltDumpBundlePayload,
) -> Result<ResolvedLoadToDuckDbBundle, AdapterError> {
    if payload.kind != "dolt_dump_bundle" {
        return Err(AdapterError::ExecutionFailed {
            node_id: "load_to_duckdb".to_string(),
            message: "load_to_duckdb received a non-dump payload for dump bundle handling."
                .to_string(),
        });
    }

    let metadata = payload.metadata.unwrap_or_default();
    let branch = payload.repo_ref.branch.trim().to_string();
    let repository = payload.repo_ref.repository.trim().to_string();
    let repo_family = metadata
        .repo_family
        .clone()
        .and_then(|value| normalize_non_empty_string(Some(value)))
        .unwrap_or_else(|| derive_dolt_repo_family(&repository));
    let current_commit = normalize_non_empty_string(Some(payload.repo_ref.current_commit.clone()))
        .unwrap_or_else(|| "pending_sync".to_string());
    let previous_commit = metadata
        .previous_commit
        .clone()
        .and_then(|value| normalize_non_empty_string(Some(value)));
    let directory_format = normalize_non_empty_string(payload.directory_ref.format.clone())
        .unwrap_or_else(|| "parquet".to_string());
    let directory_path = payload.directory_ref.path.trim().to_string();
    let loaded_tables = metadata
        .exported_tables
        .unwrap_or_default()
        .into_iter()
        .map(|table| {
            let source_table = table.source_table.trim().to_string();
            let file_path = table
                .file_path
                .clone()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| {
                    format!("{}/{}.{}", directory_path, source_table, directory_format)
                });
            let staging_table_name =
                build_load_to_duckdb_staging_table_name(&repo_family, &source_table, "snapshot");

            ResolvedLoadToDuckDbTable {
                added_rows: None,
                columns: build_load_to_duckdb_staging_columns(
                    &repository,
                    &source_table,
                    "dolt_dump_bundle",
                    previous_commit.as_deref(),
                ),
                delete_marker_path: None,
                delete_markers_emitted: None,
                file_path,
                load_mode: "snapshot",
                modified_rows: None,
                removed_rows: None,
                row_count: table.row_count,
                source_table,
                staging_table_name,
            }
        })
        .collect::<Vec<_>>();

    Ok(ResolvedLoadToDuckDbBundle {
        branch,
        bundle_kind: "dolt_dump_bundle",
        current_commit,
        delete_rows_present: false,
        directory_format,
        directory_path,
        loaded_tables,
        previous_commit,
        repo_family,
        repository,
    })
}

fn resolve_load_to_duckdb_diff_bundle(
    payload: DoltDiffExportBundlePayload,
) -> Result<ResolvedLoadToDuckDbBundle, AdapterError> {
    if payload.kind != "dolt_diff_export_bundle" {
        return Err(AdapterError::ExecutionFailed {
            node_id: "load_to_duckdb".to_string(),
            message: "load_to_duckdb received a non-diff payload for diff bundle handling."
                .to_string(),
        });
    }

    let metadata = payload.metadata.unwrap_or_default();
    let branch = payload.repo_ref.branch.trim().to_string();
    let repository = payload.repo_ref.repository.trim().to_string();
    let repo_family = metadata
        .repo_family
        .clone()
        .and_then(|value| normalize_non_empty_string(Some(value)))
        .unwrap_or_else(|| derive_dolt_repo_family(&repository));
    let current_commit = metadata
        .current_commit
        .clone()
        .and_then(|value| normalize_non_empty_string(Some(value)))
        .or_else(|| normalize_non_empty_string(Some(payload.repo_ref.current_commit.clone())))
        .unwrap_or_else(|| "pending_sync".to_string());
    let previous_commit = metadata
        .previous_commit
        .clone()
        .and_then(|value| normalize_non_empty_string(Some(value)));
    let directory_format = normalize_non_empty_string(payload.directory_ref.format.clone())
        .unwrap_or_else(|| "parquet".to_string());
    let directory_path = payload.directory_ref.path.trim().to_string();
    let loaded_tables = metadata
        .delta_manifest
        .unwrap_or_default()
        .into_iter()
        .map(|table| {
            let source_table = table.source_table.trim().to_string();
            let file_path = table
                .file_path
                .clone()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| {
                    format!("{}/{}.{}", directory_path, source_table, directory_format)
                });
            let staging_table_name =
                build_load_to_duckdb_staging_table_name(&repo_family, &source_table, "delta");

            ResolvedLoadToDuckDbTable {
                added_rows: table.added_rows,
                columns: build_load_to_duckdb_staging_columns(
                    &repository,
                    &source_table,
                    "dolt_diff_export_bundle",
                    previous_commit.as_deref(),
                ),
                delete_marker_path: table.delete_marker_path,
                delete_markers_emitted: table.delete_markers_emitted,
                file_path,
                load_mode: "delta",
                modified_rows: table.modified_rows,
                removed_rows: table.removed_rows,
                row_count: None,
                source_table,
                staging_table_name,
            }
        })
        .collect::<Vec<_>>();
    let delete_rows_present = metadata.delete_rows_present.unwrap_or_else(|| {
        loaded_tables
            .iter()
            .any(|table| table.removed_rows.unwrap_or_default() > 0)
    });

    Ok(ResolvedLoadToDuckDbBundle {
        branch,
        bundle_kind: "dolt_diff_export_bundle",
        current_commit,
        delete_rows_present,
        directory_format,
        directory_path,
        loaded_tables,
        previous_commit,
        repo_family,
        repository,
    })
}

fn build_load_to_duckdb_manifest_path(
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

fn build_load_to_duckdb_staging_table_name(
    repo_family: &str,
    source_table: &str,
    suffix: &str,
) -> String {
    format!("{repo_family}__{source_table}__{suffix}")
}

fn build_load_to_duckdb_staging_columns(
    repository: &str,
    source_table: &str,
    bundle_kind: &str,
    previous_commit: Option<&str>,
) -> Vec<Value> {
    let mut columns = mock_dolt_table_columns(repository, source_table);
    if bundle_kind == "dolt_diff_export_bundle" {
        columns.push(json!({
            "name": "change_op",
            "type": "varchar",
            "nullable": false,
            "primary_key": false
        }));
    }
    columns.push(json!({
        "name": "source_repo",
        "type": "varchar",
        "nullable": false,
        "primary_key": false
    }));
    columns.push(json!({
        "name": "source_table",
        "type": "varchar",
        "nullable": false,
        "primary_key": false
    }));
    columns.push(json!({
        "name": "batch_id",
        "type": "varchar",
        "nullable": false,
        "primary_key": false
    }));
    columns.push(json!({
        "name": "ingested_at",
        "type": "timestamp",
        "nullable": false,
        "primary_key": false
    }));
    columns.push(json!({
        "name": "bundle_kind",
        "type": "varchar",
        "nullable": false,
        "primary_key": false
    }));
    if previous_commit.is_some() {
        columns.push(json!({
            "name": "previous_commit",
            "type": "varchar",
            "nullable": true,
            "primary_key": false
        }));
    }
    columns.push(json!({
        "name": "current_commit",
        "type": "varchar",
        "nullable": false,
        "primary_key": false
    }));
    columns.push(json!({
        "name": "delete_rows_present",
        "type": "boolean",
        "nullable": false,
        "primary_key": false
    }));
    columns
}

fn extract_table_reference_table_names(table_payload: &TableReferencePayload) -> Vec<String> {
    let mut table_names = table_payload
        .schema_definitions
        .as_ref()
        .and_then(Value::as_array)
        .map(|entries| {
            entries
                .iter()
                .filter_map(|entry| {
                    entry
                        .get("table_name")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(str::to_string)
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    if table_names.is_empty() {
        let table_name = table_payload.table_name.trim();
        if !table_name.is_empty() {
            table_names.push(table_name.to_string());
        }
    }

    table_names
}

fn mock_dolt_table_columns(repository: &str, table_name: &str) -> Vec<Value> {
    let columns = match (repository, table_name) {
        ("post-no-preference/earnings", "earnings_calendar") => vec![
            ("symbol", "varchar", false),
            ("report_date", "date", false),
            ("eps_estimate", "decimal(18,4)", true),
        ],
        ("post-no-preference/earnings", "eps_history") => vec![
            ("symbol", "varchar", false),
            ("report_date", "date", false),
            ("eps_actual", "decimal(18,4)", true),
        ],
        ("post-no-preference/earnings", "income_statement") => vec![
            ("symbol", "varchar", false),
            ("fiscal_period", "varchar", false),
            ("revenue", "decimal(18,2)", true),
        ],
        ("post-no-preference/earnings", "balance_sheet_assets")
        | ("post-no-preference/earnings", "balance_sheet_equity")
        | ("post-no-preference/earnings", "balance_sheet_liabilities")
        | ("post-no-preference/earnings", "cash_flow_statement")
        | ("post-no-preference/earnings", "eps_estimate")
        | ("post-no-preference/earnings", "rank_score")
        | ("post-no-preference/earnings", "sales_estimate") => vec![
            ("symbol", "varchar", false),
            ("fiscal_period", "varchar", false),
            ("value", "decimal(18,2)", true),
        ],
        ("post-no-preference/options", "option_chain") => vec![
            ("underlying_symbol", "varchar", false),
            ("quote_date", "date", false),
            ("expiry_date", "date", false),
            ("strike", "decimal(18,4)", false),
            ("option_type", "varchar", false),
        ],
        ("post-no-preference/options", "volatility_history") => vec![
            ("symbol", "varchar", false),
            ("quote_date", "date", false),
            ("realized_volatility", "decimal(18,6)", true),
        ],
        ("post-no-preference/rates", "us_treasury") => vec![
            ("curve_date", "date", false),
            ("tenor", "varchar", false),
            ("yield_pct", "decimal(10,6)", true),
        ],
        _ => vec![
            ("entity_id", "varchar", false),
            ("as_of_date", "date", true),
            ("value", "double", true),
        ],
    };

    columns
        .into_iter()
        .map(|(name, data_type, nullable)| {
            json!({
                "name": name,
                "type": data_type,
                "nullable": nullable,
                "primary_key": false
            })
        })
        .collect()
}

fn mock_dolt_repo_profile(repository: &str) -> Option<MockDoltRepoProfile> {
    match repository {
        "post-no-preference/earnings" => Some(MockDoltRepoProfile {
            repo_family: "earnings",
            previous_commit: "92fd7ac",
            current_commit: "a34ef9c",
        }),
        "post-no-preference/options" => Some(MockDoltRepoProfile {
            repo_family: "options",
            previous_commit: "ac31f0b",
            current_commit: "b91c2aa",
        }),
        "post-no-preference/rates" => Some(MockDoltRepoProfile {
            repo_family: "rates",
            previous_commit: "c83f10d",
            current_commit: "d0f61b4",
        }),
        _ => None,
    }
}

fn mock_checkpoint_success_at(repository: &str) -> &'static str {
    match repository {
        "post-no-preference/options" => "2026-06-08T14:22:11Z",
        "post-no-preference/rates" => "2026-06-08T09:15:42Z",
        _ => "2026-06-07T18:04:09Z",
    }
}

fn mock_checkpoint_ingest_mode(repository: &str) -> &'static str {
    match repository {
        "post-no-preference/earnings" => "bootstrap_refresh",
        _ => "recurring_delta",
    }
}

fn mock_dolt_change_manifest_summaries(
    repository: &str,
) -> &'static [MockDoltChangeManifestTableSummary] {
    match repository {
        "post-no-preference/earnings" => &[
            MockDoltChangeManifestTableSummary {
                table_name: "earnings_calendar",
                added_rows: 24,
                modified_rows: 3,
                removed_rows: 0,
                schema_changed: false,
            },
            MockDoltChangeManifestTableSummary {
                table_name: "eps_history",
                added_rows: 18,
                modified_rows: 5,
                removed_rows: 0,
                schema_changed: false,
            },
            MockDoltChangeManifestTableSummary {
                table_name: "income_statement",
                added_rows: 4,
                modified_rows: 2,
                removed_rows: 0,
                schema_changed: true,
            },
        ],
        "post-no-preference/options" => &[
            MockDoltChangeManifestTableSummary {
                table_name: "option_chain",
                added_rows: 440,
                modified_rows: 182,
                removed_rows: 17,
                schema_changed: false,
            },
            MockDoltChangeManifestTableSummary {
                table_name: "volatility_history",
                added_rows: 32,
                modified_rows: 4,
                removed_rows: 0,
                schema_changed: false,
            },
        ],
        "post-no-preference/rates" => &[MockDoltChangeManifestTableSummary {
            table_name: "us_treasury",
            added_rows: 6,
            modified_rows: 1,
            removed_rows: 0,
            schema_changed: false,
        }],
        _ => &[],
    }
}

fn normalize_selected_table_names(selected_tables: Option<Vec<String>>) -> Vec<String> {
    let mut names = Vec::new();

    for table_name in selected_tables.unwrap_or_default() {
        let normalized = table_name.trim();
        if normalized.is_empty() {
            continue;
        }

        if !names.iter().any(|existing| existing == normalized) {
            names.push(normalized.to_string());
        }
    }

    names
}

fn filter_manifest_table_summaries_for_scope(
    summaries: &'static [MockDoltChangeManifestTableSummary],
    table_scope: DoltChangeManifestTableScope,
    selected_tables: &[String],
) -> Vec<MockDoltChangeManifestTableSummary> {
    if matches!(table_scope, DoltChangeManifestTableScope::AllTables) {
        return summaries.to_vec();
    }

    if selected_tables.is_empty() {
        return Vec::new();
    }

    summaries
        .iter()
        .copied()
        .filter(|summary| {
            selected_tables
                .iter()
                .any(|table_name| table_name == summary.table_name)
        })
        .collect()
}

fn mock_dolt_dump_table_catalog(repository: &str) -> &'static [(&'static str, u64)] {
    match repository {
        "post-no-preference/earnings" => &[
            ("balance_sheet_assets", 1800),
            ("balance_sheet_equity", 1800),
            ("balance_sheet_liabilities", 1800),
            ("cash_flow_statement", 1800),
            ("earnings_calendar", 920),
            ("eps_estimate", 860),
            ("eps_history", 1100),
            ("income_statement", 1800),
            ("rank_score", 760),
            ("sales_estimate", 880),
        ],
        "post-no-preference/options" => &[("option_chain", 126_000), ("volatility_history", 4_200)],
        "post-no-preference/rates" => &[("us_treasury", 520)],
        _ => &[],
    }
}

fn resolve_dolt_dump_table_selection(
    repository: &str,
    table_selection_mode: DoltDumpTableSelectionMode,
    selected_tables: &[String],
    manifest_changed_tables: &[String],
) -> Vec<String> {
    match table_selection_mode {
        DoltDumpTableSelectionMode::ManualTables => selected_tables.to_vec(),
        DoltDumpTableSelectionMode::PreferManifestScope if !manifest_changed_tables.is_empty() => {
            manifest_changed_tables.to_vec()
        }
        DoltDumpTableSelectionMode::PreferManifestScope | DoltDumpTableSelectionMode::AllTables => {
            mock_dolt_dump_table_catalog(repository)
                .iter()
                .map(|(table_name, _)| table_name.to_string())
                .collect()
        }
    }
}

fn resolve_dolt_diff_export_table_summaries(
    repository: &str,
    manifest_changed_tables: &[String],
    row_change_summary: Option<&BTreeMap<String, DoltChangeRowSummaryPayload>>,
) -> Vec<ResolvedDoltDiffTableSummary> {
    if let Some(row_change_summary) = row_change_summary {
        let ordered_table_names = if manifest_changed_tables.is_empty() {
            row_change_summary.keys().cloned().collect::<Vec<_>>()
        } else {
            manifest_changed_tables.to_vec()
        };

        return ordered_table_names
            .into_iter()
            .filter_map(|table_name| {
                let summary = row_change_summary.get(&table_name)?;
                Some(ResolvedDoltDiffTableSummary {
                    table_name,
                    added_rows: summary.added,
                    modified_rows: summary.modified,
                    removed_rows: summary.removed,
                })
            })
            .collect();
    }

    let allowed_tables = if manifest_changed_tables.is_empty() {
        None
    } else {
        Some(
            manifest_changed_tables
                .iter()
                .map(String::as_str)
                .collect::<Vec<_>>(),
        )
    };

    mock_dolt_change_manifest_summaries(repository)
        .iter()
        .filter(|summary| {
            allowed_tables
                .as_ref()
                .map(|tables| {
                    tables
                        .iter()
                        .any(|table_name| *table_name == summary.table_name)
                })
                .unwrap_or(true)
        })
        .map(|summary| ResolvedDoltDiffTableSummary {
            table_name: summary.table_name.to_string(),
            added_rows: summary.added_rows,
            modified_rows: summary.modified_rows,
            removed_rows: summary.removed_rows,
        })
        .collect()
}

fn filter_dolt_diff_export_summary(
    summary: &ResolvedDoltDiffTableSummary,
    change_filter: DoltDiffExportChangeFilter,
) -> Option<ResolvedDoltDiffTableSummary> {
    let (added_rows, modified_rows, removed_rows) = match change_filter {
        DoltDiffExportChangeFilter::AllChanges => (
            summary.added_rows,
            summary.modified_rows,
            summary.removed_rows,
        ),
        DoltDiffExportChangeFilter::NonDeleteChanges => {
            (summary.added_rows, summary.modified_rows, 0)
        }
        DoltDiffExportChangeFilter::AddedOnly => (summary.added_rows, 0, 0),
        DoltDiffExportChangeFilter::ModifiedOnly => (0, summary.modified_rows, 0),
        DoltDiffExportChangeFilter::RemovedOnly => (0, 0, summary.removed_rows),
    };

    if added_rows == 0 && modified_rows == 0 && removed_rows == 0 {
        return None;
    }

    Some(ResolvedDoltDiffTableSummary {
        table_name: summary.table_name.clone(),
        added_rows,
        modified_rows,
        removed_rows,
    })
}

fn build_dolt_diff_operation_types(summary: &ResolvedDoltDiffTableSummary) -> Vec<&'static str> {
    let mut operation_types = Vec::new();

    if summary.added_rows > 0 {
        operation_types.push("added");
    }
    if summary.modified_rows > 0 {
        operation_types.push("modified");
    }
    if summary.removed_rows > 0 {
        operation_types.push("removed");
    }

    operation_types
}

fn build_dolt_dump_bundle_path(
    repo_family: &str,
    current_commit: &str,
    output_format: DoltDumpOutputFormat,
) -> String {
    format!(
        "artifacts/dolt_dump/{repo_family}/{current_commit}/{}",
        output_format.as_str()
    )
}

fn build_dolt_diff_export_bundle_path(
    repo_family: &str,
    previous_commit: &str,
    current_commit: &str,
    output_format: DoltDumpOutputFormat,
) -> String {
    format!(
        "artifacts/dolt_diff_export/{repo_family}/{}_to_{}/{}",
        previous_commit,
        current_commit,
        output_format.as_str()
    )
}

fn derive_dolt_repo_family(repository: &str) -> String {
    mock_dolt_repo_profile(repository)
        .map(|profile| profile.repo_family.to_string())
        .or_else(|| repository.rsplit('/').next().map(str::to_string))
        .unwrap_or_else(|| "repo".to_string())
}

fn normalize_optional_config_string(value: Option<String>) -> Option<String> {
    value
        .map(|entry| entry.trim().to_string())
        .filter(|entry| !entry.is_empty())
}

fn normalize_non_empty_string(value: Option<String>) -> Option<String> {
    value
        .map(|entry| entry.trim().to_string())
        .filter(|entry| !entry.is_empty())
}

fn resolve_dolt_previous_commit(profile: Option<MockDoltRepoProfile>) -> String {
    profile
        .map(|entry| entry.previous_commit.to_string())
        .unwrap_or_else(|| "pending_checkpoint".to_string())
}

fn resolve_dolt_current_commit(
    profile: Option<MockDoltRepoProfile>,
    checkout_ref: Option<&str>,
) -> String {
    if let Some(checkout_ref) = checkout_ref {
        return checkout_ref.chars().take(12).collect();
    }

    profile
        .map(|entry| entry.current_commit.to_string())
        .unwrap_or_else(|| "pending_sync".to_string())
}

fn execute_text_input(node: &WorkflowNode) -> Result<NodeExecutionResult, AdapterError> {
    let config: TextInputConfig = serde_json::from_value(node.config.clone()).map_err(|error| {
        AdapterError::InvalidConfig {
            node_id: node.node_id.clone(),
            message: error.to_string(),
        }
    })?;

    let output_text = normalize_text_input_value(
        &config.text,
        config.trim_mode.as_ref(),
        config.preserve_whitespace.unwrap_or(true),
        config.include_line_breaks.unwrap_or(true),
    );
    let mut outputs = PortValues::new();
    outputs.insert("text".to_string(), TypedValue::text(output_text.clone()));

    Ok(NodeExecutionResult {
        outputs,
        logs: vec![format!(
            "Loaded {} characters from text input.",
            output_text.chars().count()
        )],
    })
}

fn execute_text_transform(
    node: &WorkflowNode,
    inputs: &PortValues,
) -> Result<NodeExecutionResult, AdapterError> {
    let config: TextTransformConfig =
        serde_json::from_value(node.config.clone()).map_err(|error| {
            AdapterError::InvalidConfig {
                node_id: node.node_id.clone(),
                message: error.to_string(),
            }
        })?;

    let input = inputs
        .get("source")
        .ok_or_else(|| AdapterError::MissingInput {
            node_id: node.node_id.clone(),
            port: "source".to_string(),
        })?
        .as_text()
        .ok_or_else(|| AdapterError::TextTypeMismatch {
            node_id: node.node_id.clone(),
            port: "source".to_string(),
        })?;

    let operation = config.operation.unwrap_or(TransformOperation::Identity);
    let output_text = match operation {
        TransformOperation::Identity => input.to_string(),
        TransformOperation::Uppercase => input.to_uppercase(),
        TransformOperation::Trim => input.trim().to_string(),
    };
    let operation_name = match operation {
        TransformOperation::Identity => "identity",
        TransformOperation::Uppercase => "uppercase",
        TransformOperation::Trim => "trim",
    };

    let mut outputs = PortValues::new();
    outputs.insert("text".to_string(), TypedValue::text(output_text));

    Ok(NodeExecutionResult {
        outputs,
        logs: vec![format!("Applied `{operation_name}` text transform.")],
    })
}

fn execute_preview_output(
    node: &WorkflowNode,
    inputs: &PortValues,
) -> Result<NodeExecutionResult, AdapterError> {
    let config: PreviewOutputConfig =
        serde_json::from_value(node.config.clone()).map_err(|error| {
            AdapterError::InvalidConfig {
                node_id: node.node_id.clone(),
                message: error.to_string(),
            }
        })?;

    let input = inputs
        .get("text")
        .ok_or_else(|| AdapterError::MissingInput {
            node_id: node.node_id.clone(),
            port: "text".to_string(),
        })?
        .as_text()
        .ok_or_else(|| AdapterError::TextTypeMismatch {
            node_id: node.node_id.clone(),
            port: "text".to_string(),
        })?;

    let heading = config.title.unwrap_or_else(|| "Preview".to_string());

    Ok(NodeExecutionResult {
        outputs: PortValues::new(),
        logs: vec![format!("{heading}: {input}")],
    })
}

fn execute_table_input(node: &WorkflowNode) -> Result<NodeExecutionResult, AdapterError> {
    let config: TableInputConfig =
        serde_json::from_value(node.config.clone()).map_err(|error| {
            AdapterError::InvalidConfig {
                node_id: node.node_id.clone(),
                message: error.to_string(),
            }
        })?;

    let catalog = config
        .catalog
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("workflow.duckdb");
    let schema_name = config.schema_name.trim();
    if schema_name.is_empty() {
        return Err(AdapterError::InvalidConfig {
            node_id: node.node_id.clone(),
            message: "`schema_name` must not be empty.".to_string(),
        });
    }

    let table_name = config.table_name.trim();

    if table_name.is_empty() {
        return Err(AdapterError::InvalidConfig {
            node_id: node.node_id.clone(),
            message: "`table_name` must not be empty.".to_string(),
        });
    }

    let output_alias = config
        .output_alias
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(table_name);
    let selected_columns = config
        .selected_columns
        .unwrap_or_default()
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    let row_filter = config
        .row_filter
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let row_limit = config.row_limit.filter(|value| *value > 0);
    let refresh_schema = config.refresh_schema.unwrap_or(true);
    let open_in_catalog = config.open_in_catalog.unwrap_or(false);

    let projection_summary = if selected_columns.is_empty() {
        "all columns".to_string()
    } else {
        format!("{} columns", selected_columns.len())
    };
    let limit_summary = row_limit
        .map(|value| format!("limit {value}"))
        .unwrap_or_else(|| "no row limit".to_string());
    let filter_summary = row_filter
        .as_deref()
        .map(|value| format!("filter `{value}`"))
        .unwrap_or_else(|| "no filter".to_string());

    let mut outputs = PortValues::new();
    outputs.insert(
        "table".to_string(),
        TypedValue {
            data_type: DataType::TableRef,
            value: json!({
                "kind": "table_reference",
                "catalog": catalog,
                "schema_name": schema_name,
                "table_name": table_name,
                "output_alias": output_alias,
                "selected_columns": selected_columns,
                "row_filter": row_filter,
                "row_limit": row_limit,
                "refresh_schema": refresh_schema,
                "open_in_catalog": open_in_catalog
            }),
        },
    );

    Ok(NodeExecutionResult {
        outputs,
        logs: vec![format!(
            "Prepared table reference `{schema_name}.{table_name}` from `{catalog}` ({projection_summary}; {filter_summary}; {limit_summary})."
        )],
    })
}

#[derive(Clone)]
struct NormalizedTableSchemaDefinition {
    schema_name: String,
    table_name: String,
    output_alias: String,
    columns: Vec<Value>,
    primary_key: Vec<String>,
    checks: Vec<String>,
    create_mode: String,
    if_target_exists: String,
}

fn normalize_table_schema_columns(
    node: &WorkflowNode,
    columns: Vec<TableSchemaColumn>,
) -> Result<Vec<Value>, AdapterError> {
    columns
        .into_iter()
        .map(|column| {
            let name = column.name.trim();
            if name.is_empty() {
                return Err(AdapterError::InvalidConfig {
                    node_id: node.node_id.clone(),
                    message: "every schema column requires a non-empty `name`.".to_string(),
                });
            }

            let column_type = column.column_type.trim();
            if column_type.is_empty() {
                return Err(AdapterError::InvalidConfig {
                    node_id: node.node_id.clone(),
                    message: format!("schema column `{name}` requires a non-empty `type`."),
                });
            }

            Ok(json!({
                "name": name,
                "type": column_type,
                "nullable": column.nullable.unwrap_or(true),
                "primary_key": column.primary_key.unwrap_or(false),
                "default": column.default.as_deref().map(str::trim).filter(|value| !value.is_empty())
            }))
        })
        .collect::<Result<Vec<_>, _>>()
}

fn normalize_table_schema_definition(
    node: &WorkflowNode,
    schema_name: String,
    table_name: String,
    output_alias: Option<String>,
    columns: Vec<TableSchemaColumn>,
    primary_key: Option<Vec<String>>,
    checks: Option<Vec<String>>,
    create_mode: Option<String>,
    if_target_exists: Option<String>,
) -> Result<NormalizedTableSchemaDefinition, AdapterError> {
    let schema_name = schema_name.trim().to_string();
    if schema_name.is_empty() {
        return Err(AdapterError::InvalidConfig {
            node_id: node.node_id.clone(),
            message: "`schema_name` must not be empty.".to_string(),
        });
    }

    let table_name = table_name.trim().to_string();
    if table_name.is_empty() {
        return Err(AdapterError::InvalidConfig {
            node_id: node.node_id.clone(),
            message: "`table_name` must not be empty.".to_string(),
        });
    }

    if columns.is_empty() {
        return Err(AdapterError::InvalidConfig {
            node_id: node.node_id.clone(),
            message: "`columns` must include at least one column.".to_string(),
        });
    }

    let output_alias = output_alias
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(table_name.as_str())
        .to_string();
    let columns = normalize_table_schema_columns(node, columns)?;
    let primary_key = primary_key
        .unwrap_or_default()
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    let checks = checks
        .unwrap_or_default()
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    let create_mode = create_mode
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("create_if_missing")
        .to_string();
    let if_target_exists = if_target_exists
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("keep_existing")
        .to_string();

    Ok(NormalizedTableSchemaDefinition {
        schema_name,
        table_name,
        output_alias,
        columns,
        primary_key,
        checks,
        create_mode,
        if_target_exists,
    })
}

fn normalize_table_schema_definitions(
    node: &WorkflowNode,
    config: TableSchemaConfig,
) -> Result<(String, bool, Vec<NormalizedTableSchemaDefinition>), AdapterError> {
    let catalog = config
        .catalog
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("workflow.duckdb")
        .to_string();
    let open_in_catalog = config.open_in_catalog.unwrap_or(false);
    let tables = if let Some(tables) = config.tables {
        if tables.is_empty() {
            return Err(AdapterError::InvalidConfig {
                node_id: node.node_id.clone(),
                message: "`tables` must include at least one table definition.".to_string(),
            });
        }

        tables
            .into_iter()
            .map(|table| {
                normalize_table_schema_definition(
                    node,
                    table.schema_name,
                    table.table_name,
                    table.output_alias,
                    table.columns,
                    table.primary_key,
                    table.checks,
                    table.create_mode,
                    table.if_target_exists,
                )
            })
            .collect::<Result<Vec<_>, _>>()?
    } else {
        vec![normalize_table_schema_definition(
            node,
            config.schema_name,
            config.table_name,
            config.output_alias,
            config.columns,
            config.primary_key,
            config.checks,
            config.create_mode,
            config.if_target_exists,
        )?]
    };

    Ok((catalog, open_in_catalog, tables))
}

fn execute_table_schema(node: &WorkflowNode) -> Result<NodeExecutionResult, AdapterError> {
    let config: TableSchemaConfig =
        serde_json::from_value(node.config.clone()).map_err(|error| {
            AdapterError::InvalidConfig {
                node_id: node.node_id.clone(),
                message: error.to_string(),
            }
        })?;
    let (catalog, open_in_catalog, tables) = normalize_table_schema_definitions(node, config)?;
    let primary_table = tables
        .first()
        .cloned()
        .ok_or_else(|| AdapterError::InvalidConfig {
            node_id: node.node_id.clone(),
            message: "table schema requires at least one table definition.".to_string(),
        })?;
    let primary_schema_name = primary_table.schema_name.clone();
    let primary_table_name = primary_table.table_name.clone();
    let primary_output_alias = primary_table.output_alias.clone();
    let primary_columns = primary_table.columns.clone();
    let primary_primary_key = primary_table.primary_key.clone();
    let primary_checks = primary_table.checks.clone();
    let primary_create_mode = primary_table.create_mode.clone();
    let primary_if_target_exists = primary_table.if_target_exists.clone();
    let column_count = primary_columns.len();

    let mut outputs = PortValues::new();
    let schema_definitions = tables
        .iter()
        .map(|table| {
            json!({
                "schema_name": table.schema_name,
                "table_name": table.table_name,
                "output_alias": table.output_alias,
                "columns": table.columns,
                "primary_key": table.primary_key,
                "checks": table.checks,
                "create_mode": table.create_mode,
                "if_target_exists": table.if_target_exists
            })
        })
        .collect::<Vec<_>>();
    outputs.insert(
        "table".to_string(),
        TypedValue {
            data_type: DataType::TableRef,
            value: json!({
                "kind": "table_reference",
                "catalog": catalog,
                "schema_name": primary_schema_name,
                "table_name": primary_table_name,
                "output_alias": primary_output_alias,
                "selected_columns": [],
                "row_filter": Value::Null,
                "row_limit": Value::Null,
                "refresh_schema": true,
                "open_in_catalog": open_in_catalog,
                "schema_definition": {
                    "columns": primary_columns,
                    "primary_key": primary_primary_key,
                    "checks": primary_checks,
                    "create_mode": primary_create_mode,
                    "if_target_exists": primary_if_target_exists
                },
                "schema_definitions": if schema_definitions.len() > 1 {
                    Some(Value::Array(schema_definitions))
                } else {
                    None
                }
            }),
        },
    );

    let primary_key_summary = if primary_table.primary_key.is_empty() {
        "no primary key".to_string()
    } else {
        format!("primary key {}", primary_table.primary_key.join(", "))
    };
    let check_summary = if primary_table.checks.is_empty() {
        "no checks".to_string()
    } else if primary_table.checks.len() == 1 {
        "1 check".to_string()
    } else {
        format!("{} checks", primary_table.checks.len())
    };
    let table_summary = if tables.len() == 1 {
        format!(
            "Prepared table schema `{schema}.{table}` from `{catalog}`",
            schema = primary_table.schema_name,
            table = primary_table.table_name
        )
    } else {
        format!("Prepared {} table schemas from `{catalog}`", tables.len())
    };

    Ok(NodeExecutionResult {
        outputs,
        logs: vec![format!(
            "{table_summary} ({} columns in primary table; {primary_key_summary}; {check_summary}; mode `{create_mode}` / `{if_target_exists}`).",
            column_count,
            create_mode = primary_table.create_mode,
            if_target_exists = primary_table.if_target_exists
        )],
    })
}

fn execute_table_output(
    node: &WorkflowNode,
    inputs: &PortValues,
) -> Result<NodeExecutionResult, AdapterError> {
    let config: TableOutputConfig =
        serde_json::from_value(node.config.clone()).map_err(|error| {
            AdapterError::InvalidConfig {
                node_id: node.node_id.clone(),
                message: error.to_string(),
            }
        })?;

    let input = inputs
        .get("text")
        .ok_or_else(|| AdapterError::MissingInput {
            node_id: node.node_id.clone(),
            port: "text".to_string(),
        })?;

    let target_schema = config.target_schema.trim();
    if target_schema.is_empty() {
        return Err(AdapterError::InvalidConfig {
            node_id: node.node_id.clone(),
            message: "`target_schema` must not be empty.".to_string(),
        });
    }

    let configured_table_name = config.table_name.trim();

    let value_column = config
        .value_column
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("content");
    let write_mode = config.write_mode.unwrap_or(TableWriteMode::Append);
    let configured_input_shape = config.input_shape.unwrap_or(TableInputShape::SingleTextRow);
    let include_run_id = config.include_run_id.unwrap_or(true);
    let include_written_at = config.include_written_at.unwrap_or(true);
    let open_in_catalog = config.open_in_catalog.unwrap_or(false);

    let write_mode_label = match write_mode {
        TableWriteMode::Append => "append",
        TableWriteMode::Replace => "replace",
    };

    let mut metadata_columns = Vec::new();
    if include_run_id {
        metadata_columns.push("run_id");
    }
    if include_written_at {
        metadata_columns.push("written_at");
    }

    let metadata_summary = if metadata_columns.is_empty() {
        "no metadata columns".to_string()
    } else {
        format!("metadata columns: {}", metadata_columns.join(", "))
    };
    let mut outputs = PortValues::new();
    match input.data_type {
        DataType::Text => {
            if matches!(configured_input_shape, TableInputShape::TableSchema) {
                return Err(AdapterError::ExecutionFailed {
                    node_id: node.node_id.clone(),
                    message:
                        "table output input_shape `table_schema` requires a table schema input."
                            .to_string(),
                });
            }

            if configured_table_name.is_empty() {
                return Err(AdapterError::InvalidConfig {
                    node_id: node.node_id.clone(),
                    message: "`table_name` must not be empty.".to_string(),
                });
            }

            let input = input
                .as_text()
                .ok_or_else(|| AdapterError::TextTypeMismatch {
                    node_id: node.node_id.clone(),
                    port: "text".to_string(),
                })?;
            let catalog_hint = if open_in_catalog {
                " Catalog open requested."
            } else {
                ""
            };

            outputs.insert(
                "write_result".to_string(),
                TypedValue {
                    data_type: DataType::Json,
                    value: json!({
                        "kind": "table_output_write",
                        "target_schema": target_schema,
                        "table_name": configured_table_name,
                        "write_mode": write_mode_label,
                        "input_shape": "single_text_row",
                        "value_column": value_column,
                        "include_run_id": include_run_id,
                        "include_written_at": include_written_at,
                        "open_in_catalog": open_in_catalog,
                        "value_text": input
                    }),
                },
            );

            Ok(NodeExecutionResult {
                outputs,
                logs: vec![format!(
                    "Prepared {write_mode_label} write to `{target_schema}.{table_name}` using `{value_column}` from single text row ({char_count} chars; {metadata_summary}).{catalog_hint}",
                    table_name = configured_table_name,
                    char_count = input.chars().count()
                )],
            })
        }
        DataType::TableRef => {
            let source_table: TableReferencePayload = serde_json::from_value(input.value.clone())
                .map_err(|error| {
                AdapterError::ExecutionFailed {
                    node_id: node.node_id.clone(),
                    message: format!("invalid table reference payload: {error}"),
                }
            })?;

            if source_table.kind != "table_reference" {
                return Err(AdapterError::ExecutionFailed {
                    node_id: node.node_id.clone(),
                    message: "table input payload is not a `table_reference`.".to_string(),
                });
            }

            let projection_summary = if source_table.selected_columns.is_empty() {
                "all columns".to_string()
            } else {
                format!("{} columns", source_table.selected_columns.len())
            };
            let limit_summary = source_table
                .row_limit
                .map(|value| format!("limit {value}"))
                .unwrap_or_else(|| "no row limit".to_string());
            let filter_summary = source_table
                .row_filter
                .as_deref()
                .map(|value| format!("filter `{value}`"))
                .unwrap_or_else(|| "no filter".to_string());
            let catalog_hint = if open_in_catalog || source_table.open_in_catalog {
                " Catalog open requested."
            } else {
                ""
            };
            let schema_definitions = source_table
                .schema_definitions
                .as_ref()
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let has_schema_definition =
                source_table.schema_definition.is_some() || !schema_definitions.is_empty();
            let resolved_shape = if has_schema_definition {
                "table_schema"
            } else {
                match configured_input_shape {
                    TableInputShape::SourceTable | TableInputShape::SingleTextRow => "source_table",
                    TableInputShape::TableSchema => {
                        return Err(AdapterError::ExecutionFailed {
                            node_id: node.node_id.clone(),
                            message:
                                "table output input_shape `table_schema` requires schema_definition metadata on the incoming table reference."
                                    .to_string(),
                        });
                    }
                }
            };
            let effective_table_name = if resolved_shape == "table_schema" {
                schema_definitions
                    .first()
                    .and_then(|value| value.get("table_name"))
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string)
                    .or_else(|| {
                        let source_table_name = source_table.table_name.trim();
                        if source_table_name.is_empty() {
                            None
                        } else {
                            Some(source_table_name.to_string())
                        }
                    })
                    .ok_or_else(|| AdapterError::ExecutionFailed {
                        node_id: node.node_id.clone(),
                        message:
                            "table schema input did not include a usable destination table name."
                                .to_string(),
                    })?
            } else if configured_table_name.is_empty() {
                return Err(AdapterError::InvalidConfig {
                    node_id: node.node_id.clone(),
                    message: "`table_name` must not be empty.".to_string(),
                });
            } else {
                configured_table_name.to_string()
            };
            let source_catalog = source_table.catalog.clone();
            let source_schema_name = source_table.schema_name.clone();
            let source_table_name = source_table.table_name.clone();
            let source_output_alias = source_table.output_alias.clone();
            let source_selected_columns = source_table.selected_columns.clone();
            let source_row_filter = source_table.row_filter.clone();
            let source_row_limit = source_table.row_limit;
            let source_schema_definition = source_table.schema_definition.clone();
            let source_schema_definitions = if schema_definitions.is_empty() {
                None
            } else {
                Some(Value::Array(schema_definitions.clone()))
            };

            outputs.insert(
                "write_result".to_string(),
                TypedValue {
                    data_type: DataType::Json,
                    value: json!({
                        "kind": "table_output_write",
                        "target_schema": target_schema,
                        "table_name": effective_table_name.clone(),
                        "write_mode": write_mode_label,
                        "input_shape": resolved_shape,
                        "value_column": value_column,
                        "include_run_id": include_run_id,
                        "include_written_at": include_written_at,
                        "open_in_catalog": open_in_catalog,
                        "schema_definition": source_schema_definition,
                        "schema_definitions": source_schema_definitions,
                        "source_table": {
                            "catalog": source_catalog,
                            "schema_name": source_schema_name,
                            "table_name": source_table_name,
                            "output_alias": source_output_alias,
                            "selected_columns": source_selected_columns,
                            "row_filter": source_row_filter,
                            "row_limit": source_row_limit
                        }
                    }),
                },
            );

            if resolved_shape == "table_schema" {
                let schema_table_count = if schema_definitions.is_empty() {
                    usize::from(source_table.schema_definition.is_some())
                } else {
                    schema_definitions.len()
                };
                let schema_column_count = if !schema_definitions.is_empty() {
                    schema_definitions
                        .iter()
                        .filter_map(|value| value.get("columns").and_then(Value::as_array))
                        .map(Vec::len)
                        .sum::<usize>()
                } else {
                    source_table
                        .schema_definition
                        .as_ref()
                        .and_then(|value| value.get("columns"))
                        .and_then(Value::as_array)
                        .map(|columns| columns.len())
                        .unwrap_or(0)
                };
                let schema_check_count = if !schema_definitions.is_empty() {
                    schema_definitions
                        .iter()
                        .filter_map(|value| value.get("checks").and_then(Value::as_array))
                        .map(Vec::len)
                        .sum::<usize>()
                } else {
                    source_table
                        .schema_definition
                        .as_ref()
                        .and_then(|value| value.get("checks"))
                        .and_then(Value::as_array)
                        .map(|checks| checks.len())
                        .unwrap_or(0)
                };
                let check_summary = if schema_check_count == 0 {
                    "no checks".to_string()
                } else if schema_check_count == 1 {
                    "1 check".to_string()
                } else {
                    format!("{schema_check_count} checks")
                };
                let bootstrap_target = if schema_table_count <= 1 {
                    format!(
                        "`{target_schema}.{table_name}`",
                        table_name = effective_table_name
                    )
                } else {
                    format!("schema `{target_schema}`")
                };

                return Ok(NodeExecutionResult {
                    outputs,
                    logs: vec![format!(
                        "Prepared {write_mode_label} schema bootstrap for {bootstrap_target} from declared schema bundle `{schema}.{table}` ({schema_table_count} table(s); {schema_column_count} columns; {check_summary}; {metadata_summary}).{catalog_hint}",
                        schema = source_table.schema_name,
                        table = source_table.table_name
                    )],
                });
            }

            Ok(NodeExecutionResult {
                outputs,
                logs: vec![format!(
                    "Prepared {write_mode_label} write to `{target_schema}.{table_name}` from source table `{schema}.{table}` ({projection_summary}; {filter_summary}; {limit_summary}; {metadata_summary}).{catalog_hint}",
                    table_name = effective_table_name,
                    schema = source_table.schema_name,
                    table = source_table.table_name
                )],
            })
        }
        _ => Err(AdapterError::ExecutionFailed {
            node_id: node.node_id.clone(),
            message: "table output expects text or table reference input on `text`.".to_string(),
        }),
    }
}

fn execute_send_email(
    node: &WorkflowNode,
    inputs: &PortValues,
) -> Result<NodeExecutionResult, AdapterError> {
    let config: SendEmailConfig = serde_json::from_value(node.config.clone()).map_err(|error| {
        AdapterError::InvalidConfig {
            node_id: node.node_id.clone(),
            message: error.to_string(),
        }
    })?;

    let upstream_body = match inputs.get("body") {
        Some(value) => Some(
            value
                .as_text()
                .ok_or_else(|| AdapterError::TextTypeMismatch {
                    node_id: node.node_id.clone(),
                    port: "body".to_string(),
                })?
                .to_string(),
        ),
        None => None,
    };
    let configured_body = config
        .body_text
        .clone()
        .or(config.body.clone())
        .unwrap_or_default();
    let body_mode = config.body_mode.unwrap_or_else(|| {
        if upstream_body.is_some() {
            SendEmailBodyMode::Input
        } else if configured_body.trim().is_empty() {
            SendEmailBodyMode::Input
        } else {
            SendEmailBodyMode::Custom
        }
    });

    let body = match body_mode {
        SendEmailBodyMode::Input => upstream_body.ok_or_else(|| AdapterError::MissingInput {
            node_id: node.node_id.clone(),
            port: "body".to_string(),
        })?,
        SendEmailBodyMode::Custom => {
            if configured_body.trim().is_empty() {
                return Err(AdapterError::InvalidConfig {
                    node_id: node.node_id.clone(),
                    message: "custom body mode requires non-empty `body_text`.".to_string(),
                });
            }
            configured_body
        }
    };
    let content_type = config.content_type.as_deref().unwrap_or("text/plain");
    let connection_id = config.connection_id.as_deref().unwrap_or("default_mailer");

    if let Some(runtime_delivery) = config.runtime_delivery.as_ref() {
        return execute_runtime_email_delivery(
            node,
            &config,
            runtime_delivery,
            connection_id,
            content_type,
            &body,
        );
    }

    Ok(NodeExecutionResult {
        outputs: PortValues::new(),
        logs: vec![format!(
            "Queued {content_type} email via `{connection_id}` to {} with subject `{}`: {}",
            config.to, config.subject, body
        )],
    })
}

fn execute_runtime_email_delivery(
    node: &WorkflowNode,
    config: &SendEmailConfig,
    runtime_delivery: &SendEmailRuntimeDelivery,
    connection_id: &str,
    content_type: &str,
    body: &str,
) -> Result<NodeExecutionResult, AdapterError> {
    match runtime_delivery.provider.as_str() {
        "gmail" => execute_gmail_send(
            node,
            config,
            runtime_delivery,
            connection_id,
            content_type,
            body,
        ),
        other => Err(AdapterError::InvalidConfig {
            node_id: node.node_id.clone(),
            message: format!("unsupported runtime delivery provider `{other}`"),
        }),
    }
}

fn execute_gmail_send(
    node: &WorkflowNode,
    config: &SendEmailConfig,
    runtime_delivery: &SendEmailRuntimeDelivery,
    connection_id: &str,
    content_type: &str,
    body: &str,
) -> Result<NodeExecutionResult, AdapterError> {
    let access_token = runtime_delivery
        .access_token
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AdapterError::InvalidConfig {
            node_id: node.node_id.clone(),
            message: "gmail delivery requires a non-empty runtime access token.".to_string(),
        })?;
    let send_as_email = runtime_delivery
        .send_as_email
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AdapterError::InvalidConfig {
            node_id: node.node_id.clone(),
            message: "gmail delivery requires a non-empty `send_as_email` value.".to_string(),
        })?;

    let mime_message = build_gmail_mime_message(
        send_as_email,
        &config.to,
        &config.subject,
        body,
        content_type,
    )
    .map_err(|error| AdapterError::InvalidConfig {
        node_id: node.node_id.clone(),
        message: error.to_string(),
    })?;
    let raw = URL_SAFE_NO_PAD.encode(mime_message.as_bytes());

    let client = reqwest::blocking::Client::builder()
        .connect_timeout(StdDuration::from_secs(10))
        .timeout(StdDuration::from_secs(30))
        .build()
        .map_err(|error| AdapterError::ExecutionFailed {
            node_id: node.node_id.clone(),
            message: format!("failed to build Gmail HTTP client: {error}"),
        })?;
    let response = client
        .post("https://gmail.googleapis.com/gmail/v1/users/me/messages/send")
        .bearer_auth(access_token)
        .json(&json!({ "raw": raw }))
        .send()
        .map_err(|error| AdapterError::ConnectionFailed {
            node_id: node.node_id.clone(),
            message: format!("Gmail send request failed: {error}"),
        })?;

    let status = response.status();
    if !status.is_success() {
        let error_body = response.text().unwrap_or_default();
        let error_detail = summarize_remote_error(&error_body);
        return Err(AdapterError::ConnectionFailed {
            node_id: node.node_id.clone(),
            message: format!("Gmail send returned {status}: {error_detail}"),
        });
    }

    let payload: GmailSendResponse =
        response
            .json()
            .map_err(|error| AdapterError::ExecutionFailed {
                node_id: node.node_id.clone(),
                message: format!("failed to decode Gmail send response: {error}"),
            })?;
    let message_id = payload.id.unwrap_or_else(|| "unknown".to_string());
    let runtime_connection_id = runtime_delivery
        .connection_id
        .as_deref()
        .filter(|value| !value.trim().is_empty());
    let delivery_label = runtime_delivery
        .connection_label
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .or(runtime_connection_id)
        .unwrap_or(connection_id);
    let mut success_log = format!(
        "Sent {content_type} email via `{delivery_label}` to {} with subject `{}` (message_id: {message_id})",
        config.to, config.subject
    );
    if let Some(thread_id) = payload.thread_id.filter(|value| !value.trim().is_empty()) {
        success_log.push_str(&format!(", thread_id: {thread_id}"));
    }

    Ok(NodeExecutionResult {
        outputs: PortValues::new(),
        logs: vec![success_log],
    })
}

fn build_gmail_mime_message(
    from: &str,
    to: &str,
    subject: &str,
    body: &str,
    content_type: &str,
) -> anyhow::Result<String> {
    let from = validate_mail_header_value("From", from)?;
    let to = validate_mail_header_value("To", to)?;
    let subject = validate_mail_header_value("Subject", subject)?;
    let normalized_content_type = normalize_content_type(content_type);

    Ok(format!(
        "From: {from}\r\nTo: {to}\r\nSubject: {subject}\r\nMIME-Version: 1.0\r\nContent-Type: {normalized_content_type}; charset=UTF-8\r\n\r\n{body}"
    ))
}

fn validate_mail_header_value(header_name: &str, value: &str) -> anyhow::Result<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        anyhow::bail!("{header_name} header cannot be empty");
    }
    if trimmed.contains('\r') || trimmed.contains('\n') {
        anyhow::bail!("{header_name} header cannot contain newline characters");
    }

    Ok(trimmed.to_string())
}

fn normalize_content_type(content_type: &str) -> &'static str {
    match content_type.trim().to_ascii_lowercase().as_str() {
        "text/html" => "text/html",
        _ => "text/plain",
    }
}

fn summarize_remote_error(response_body: &str) -> String {
    let trimmed = response_body.trim();
    if trimmed.is_empty() {
        return "empty response body".to_string();
    }

    if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
        if let Some(message) = value
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(serde_json::Value::as_str)
        {
            return message.to_string();
        }
        if let Some(message) = value.get("message").and_then(serde_json::Value::as_str) {
            return message.to_string();
        }
    }

    trimmed.chars().take(180).collect()
}

fn normalize_text_input_value(
    source: &str,
    trim_mode: Option<&TextTrimMode>,
    preserve_whitespace: bool,
    include_line_breaks: bool,
) -> String {
    let mut normalized = source.replace("\r\n", "\n").replace('\r', "\n");

    if !include_line_breaks {
        normalized = normalized.replace('\n', " ");
    }

    if !preserve_whitespace {
        normalized = normalized.split_whitespace().collect::<Vec<_>>().join(" ");
    }

    match trim_mode.unwrap_or(&TextTrimMode::Automatic) {
        TextTrimMode::Trim => normalized.trim().to_string(),
        TextTrimMode::Exact => normalized,
        TextTrimMode::Automatic => {
            if preserve_whitespace {
                normalized
            } else {
                normalized.trim().to_string()
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::{
        env, fs,
        path::{Path, PathBuf},
        time::{SystemTime, UNIX_EPOCH},
    };

    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    use duckdb::Connection as DuckDbConnection;
    use serde_json::{json, Value};
    use workflow_schema::{DataType, NodePosition, TypedValue, WorkflowNode};

    use super::{
        build_dolt_home_dir_path, build_gmail_mime_message,
        copy_or_convert_actual_dolt_dump_artifact, parse_dolt_head_commit,
        quote_duckdb_string_literal, resolve_dolt_dump_csv_path,
        resolve_upstream_live_working_copy_path, strip_ansi_escape_sequences, AdapterError,
        AdapterExecutionContext, DoltDumpOutputFormat, DoltRepoDatasetMetadataPayload,
        RuntimeAdapters,
    };
    use crate::PortValues;
    use node_registry::builtin_node_definitions;

    fn unique_test_workflow_root(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        env::temp_dir().join(format!(
            "stitchly_runtime_adapters_{label}_{}_{}",
            std::process::id(),
            nanos
        ))
    }

    #[test]
    fn parse_dolt_head_commit_reads_commit_line() {
        let output = "commit 48puq5af61vq4d92l68du7bee0tu9u0v\nAuthor: test\n";
        assert_eq!(
            parse_dolt_head_commit(output).as_deref(),
            Some("48puq5af61vq4d92l68du7bee0tu9u0v")
        );
    }

    #[test]
    fn strip_ansi_escape_sequences_removes_terminal_color_codes() {
        assert_eq!(
            strip_ansi_escape_sequences("\u{1b}[33mcommit abc123 \u{1b}[0m"),
            "commit abc123 "
        );
    }

    #[test]
    fn parse_dolt_head_commit_reads_colorized_commit_line() {
        let output = "\u{1b}[33mcommit 48puq5af61vq4d92l68du7bee0tu9u0v \u{1b}[0m\nAuthor: test\n";
        assert_eq!(
            parse_dolt_head_commit(output).as_deref(),
            Some("48puq5af61vq4d92l68du7bee0tu9u0v")
        );
    }

    #[test]
    fn parse_dolt_head_commit_returns_none_for_unexpected_output() {
        assert_eq!(parse_dolt_head_commit("Author: test\nDate: now\n"), None);
    }

    #[test]
    fn resolve_upstream_live_working_copy_path_reads_live_repo_metadata() {
        let metadata = DoltRepoDatasetMetadataPayload {
            resolution_mode: Some("live_dolt".to_string()),
            working_copy_path: Some("/tmp/stitchly-dolt-live/repo".to_string()),
            ..Default::default()
        };

        assert_eq!(
            resolve_upstream_live_working_copy_path(Some(&metadata)),
            Some(PathBuf::from("/tmp/stitchly-dolt-live/repo"))
        );
    }

    #[test]
    fn resolve_upstream_live_working_copy_path_ignores_mock_repo_metadata() {
        let metadata = DoltRepoDatasetMetadataPayload {
            resolution_mode: Some("mock_profile".to_string()),
            working_copy_path: Some("/tmp/stitchly-dolt-live/repo".to_string()),
            ..Default::default()
        };

        assert_eq!(
            resolve_upstream_live_working_copy_path(Some(&metadata)),
            None
        );
    }

    #[test]
    fn resolve_dolt_dump_csv_path_prefers_controlled_dump_directory() {
        let workflow_root = unique_test_workflow_root("dolt_dump_output_path");
        let repo_dir = workflow_root.join("repo");
        let controlled_dump_dir = workflow_root
            .join("files")
            .join("artifacts")
            .join("dolt_dump_work");
        let dump_dir = repo_dir.join("doltdump");
        fs::create_dir_all(&controlled_dump_dir).expect("controlled dump directory");
        fs::create_dir_all(&dump_dir).expect("doltdump directory");
        fs::write(
            controlled_dump_dir.join("us_treasury.csv"),
            "curve_date,tenor,yield_pct\n2026-06-12,2Y,4.77\n",
        )
        .expect("controlled dump csv");
        fs::write(
            dump_dir.join("us_treasury.csv"),
            "curve_date,tenor,yield_pct\n",
        )
        .expect("dump csv");

        assert_eq!(
            resolve_dolt_dump_csv_path(&controlled_dump_dir, &repo_dir, "us_treasury"),
            Some(controlled_dump_dir.join("us_treasury.csv"))
        );

        let _ = fs::remove_dir_all(&workflow_root);
    }

    #[test]
    fn resolve_dolt_dump_csv_path_falls_back_to_doltdump_subdirectory_output() {
        let workflow_root = unique_test_workflow_root("dolt_dump_output_path_fallback");
        let repo_dir = workflow_root.join("repo");
        let controlled_dump_dir = workflow_root
            .join("files")
            .join("artifacts")
            .join("dolt_dump_work");
        let dump_dir = repo_dir.join("doltdump");
        fs::create_dir_all(&controlled_dump_dir).expect("controlled dump directory");
        fs::create_dir_all(&dump_dir).expect("doltdump directory");
        fs::write(
            dump_dir.join("us_treasury.csv"),
            "curve_date,tenor,yield_pct\n",
        )
        .expect("dump csv");

        assert_eq!(
            resolve_dolt_dump_csv_path(&controlled_dump_dir, &repo_dir, "us_treasury"),
            Some(dump_dir.join("us_treasury.csv"))
        );

        let _ = fs::remove_dir_all(&workflow_root);
    }

    #[test]
    fn workflow_files_root_from_relative_context_is_absolute() {
        let context = AdapterExecutionContext {
            workflow_root_path: Some(PathBuf::from(
                ".stitchly/users/usr_test/workspaces/ws_test/workflows/wf_test",
            )),
            ..AdapterExecutionContext::default()
        };

        let files_root =
            workflow_files_root_from_context(&context).expect("workflow files root should resolve");

        assert!(files_root.is_absolute());
        assert!(files_root
            .ends_with(".stitchly/users/usr_test/workspaces/ws_test/workflows/wf_test/files"));
    }

    #[test]
    fn copy_or_convert_actual_dolt_dump_artifact_writes_parquet() {
        let workflow_root = unique_test_workflow_root("dolt_dump_parquet_conversion");
        let source_csv = workflow_root.join("us_treasury.csv");
        let destination_file = workflow_root.join("bundle").join("us_treasury.parquet");
        fs::create_dir_all(destination_file.parent().expect("bundle parent"))
            .expect("bundle directory");
        fs::write(
            &source_csv,
            "curve_date,tenor,yield_pct\n2026-06-11,2Y,4.75\n2026-06-11,10Y,4.21\n",
        )
        .expect("source csv");

        let duckdb_path = workflow_root.join("workflow.duckdb");
        let duckdb = DuckDbConnection::open(&duckdb_path).expect("duckdb should open");

        copy_or_convert_actual_dolt_dump_artifact(
            &source_csv,
            &destination_file,
            DoltDumpOutputFormat::Parquet,
            Some(&duckdb),
            "dolt_dump",
        )
        .expect("csv to parquet conversion should succeed");

        assert!(destination_file.is_file(), "parquet file should exist");
        let row_count: i64 = duckdb
            .query_row(
                &format!(
                    "select count(*) from read_parquet({})",
                    quote_duckdb_string_literal(destination_file.to_string_lossy().as_ref())
                ),
                [],
                |row| row.get(0),
            )
            .expect("parquet row count query should succeed");
        assert_eq!(row_count, 2);

        let _ = fs::remove_dir_all(&workflow_root);
    }

    #[test]
    fn dolt_repo_source_emits_dataset_reference_metadata() {
        let registry = builtin_node_definitions();
        let definition = registry
            .iter()
            .find(|definition| definition.type_id == "dolt_repo_source")
            .expect("dolt_repo_source definition");
        let node = WorkflowNode {
            node_id: "dolt_repo_source".to_string(),
            type_id: "dolt_repo_source".to_string(),
            definition_version: 1,
            label: Some("Dolt Repo Source".to_string()),
            config: json!({
                "connection_ref": "dolthub_public",
                "repository": "post-no-preference/earnings",
                "branch": "main",
                "clone_mode": "reuse_local_copy",
                "sync_strategy": "pull_before_execution"
            }),
            position: NodePosition::default(),
        };

        let result = RuntimeAdapters::default()
            .execute(definition, &node, &PortValues::new())
            .expect("dolt repo source should succeed");

        let payload = result
            .outputs
            .get("repo")
            .expect("dataset ref output should be present");

        assert_eq!(payload.data_type, DataType::DatasetRef);
        assert_eq!(payload.value["kind"], json!("dolt_repo_dataset"));
        assert_eq!(
            payload.value["repo_ref"]["current_commit"],
            json!("a34ef9c")
        );
        assert_eq!(payload.value["metadata"]["repo_family"], json!("earnings"));
        assert_eq!(
            payload.value["metadata"]["sync_strategy"],
            json!("pull_before_execution")
        );
    }

    #[test]
    fn dolt_repo_source_prefers_checkout_override_for_commit() {
        let registry = builtin_node_definitions();
        let definition = registry
            .iter()
            .find(|definition| definition.type_id == "dolt_repo_source")
            .expect("dolt_repo_source definition");
        let node = WorkflowNode {
            node_id: "dolt_repo_source".to_string(),
            type_id: "dolt_repo_source".to_string(),
            definition_version: 1,
            label: Some("Dolt Repo Source".to_string()),
            config: json!({
                "connection_ref": "dolthub_public",
                "repository": "post-no-preference/options",
                "branch": "main",
                "checkout_ref": "4c9f2ab1d703ef91"
            }),
            position: NodePosition::default(),
        };

        let result = RuntimeAdapters::default()
            .execute(definition, &node, &PortValues::new())
            .expect("dolt repo source should succeed");

        let payload = result
            .outputs
            .get("repo")
            .expect("dataset ref output should be present");

        assert_eq!(
            payload.value["repo_ref"]["current_commit"],
            json!("4c9f2ab1d703")
        );
        assert_eq!(payload.value["metadata"]["repo_family"], json!("options"));
    }

    #[test]
    fn dolt_repo_sync_emits_commit_range_metadata() {
        let registry = builtin_node_definitions();
        let source_definition = registry
            .iter()
            .find(|definition| definition.type_id == "dolt_repo_source")
            .expect("dolt_repo_source definition");
        let sync_definition = registry
            .iter()
            .find(|definition| definition.type_id == "dolt_repo_sync")
            .expect("dolt_repo_sync definition");
        let source_node = WorkflowNode {
            node_id: "dolt_repo_source".to_string(),
            type_id: "dolt_repo_source".to_string(),
            definition_version: 1,
            label: Some("Dolt Repo Source".to_string()),
            config: json!({
                "connection_ref": "dolthub_public",
                "repository": "post-no-preference/earnings",
                "branch": "main"
            }),
            position: NodePosition::default(),
        };
        let source_result = RuntimeAdapters::default()
            .execute(source_definition, &source_node, &PortValues::new())
            .expect("dolt repo source should succeed");
        let sync_node = WorkflowNode {
            node_id: "dolt_repo_sync".to_string(),
            type_id: "dolt_repo_sync".to_string(),
            definition_version: 1,
            label: Some("Dolt Repo Sync".to_string()),
            config: json!({}),
            position: NodePosition::default(),
        };
        let sync_result = RuntimeAdapters::default()
            .execute(sync_definition, &sync_node, &source_result.outputs)
            .expect("dolt repo sync should succeed");

        let payload = sync_result
            .outputs
            .get("repo_out")
            .expect("dataset ref output should be present");

        assert_eq!(payload.data_type, DataType::DatasetRef);
        assert_eq!(
            payload.value["repo_ref"]["current_commit"],
            json!("a34ef9c")
        );
        assert_eq!(
            payload.value["metadata"]["previous_commit"],
            json!("92fd7ac")
        );
        assert_eq!(
            payload.value["metadata"]["current_commit"],
            json!("a34ef9c")
        );
        assert_eq!(
            payload.value["metadata"]["sync_action"],
            json!("pull_remote_head")
        );
    }

    #[test]
    fn checkpoint_read_emits_context_and_dolt_repo_sync_uses_it() {
        let registry = builtin_node_definitions();
        let checkpoint_definition = registry
            .iter()
            .find(|definition| definition.type_id == "checkpoint_read")
            .expect("checkpoint_read definition");
        let source_definition = registry
            .iter()
            .find(|definition| definition.type_id == "dolt_repo_source")
            .expect("dolt_repo_source definition");
        let sync_definition = registry
            .iter()
            .find(|definition| definition.type_id == "dolt_repo_sync")
            .expect("dolt_repo_sync definition");

        let checkpoint_node = WorkflowNode {
            node_id: "checkpoint_read".to_string(),
            type_id: "checkpoint_read".to_string(),
            definition_version: 1,
            label: Some("Checkpoint Read".to_string()),
            config: json!({
                "checkpoint_table": "tables.ingest_checkpoints",
                "source_repo": "post-no-preference/options",
                "branch": "main",
                "emit_bootstrap_marker_if_missing": true
            }),
            position: NodePosition::default(),
        };
        let checkpoint_result = RuntimeAdapters::default()
            .execute(checkpoint_definition, &checkpoint_node, &PortValues::new())
            .expect("checkpoint read should succeed");
        let checkpoint_payload = checkpoint_result
            .outputs
            .get("checkpoint")
            .expect("checkpoint output should be present");
        assert_eq!(checkpoint_payload.data_type, DataType::Json);
        assert_eq!(
            checkpoint_payload.value["last_synced_commit"],
            json!("ac31f0b")
        );

        let source_node = WorkflowNode {
            node_id: "dolt_repo_source".to_string(),
            type_id: "dolt_repo_source".to_string(),
            definition_version: 1,
            label: Some("Dolt Repo Source".to_string()),
            config: json!({
                "connection_ref": "dolthub_public",
                "repository": "post-no-preference/options",
                "branch": "main"
            }),
            position: NodePosition::default(),
        };
        let source_result = RuntimeAdapters::default()
            .execute(source_definition, &source_node, &PortValues::new())
            .expect("dolt repo source should succeed");

        let sync_node = WorkflowNode {
            node_id: "dolt_repo_sync".to_string(),
            type_id: "dolt_repo_sync".to_string(),
            definition_version: 1,
            label: Some("Dolt Repo Sync".to_string()),
            config: json!({}),
            position: NodePosition::default(),
        };

        let mut sync_inputs = source_result.outputs.clone();
        sync_inputs.extend(checkpoint_result.outputs.clone());

        let sync_result = RuntimeAdapters::default()
            .execute(sync_definition, &sync_node, &sync_inputs)
            .expect("dolt repo sync should succeed with checkpoint input");

        let payload = sync_result
            .outputs
            .get("repo_out")
            .expect("dataset ref output should be present");
        assert_eq!(payload.data_type, DataType::DatasetRef);
        assert_eq!(
            payload.value["metadata"]["previous_commit"],
            json!("ac31f0b")
        );
        assert_eq!(
            payload.value["metadata"]["checkpoint_last_ingest_mode"],
            json!("recurring_delta")
        );
    }

    #[test]
    fn dolt_repo_sync_preserves_upstream_repo_handle_and_overrides_behavior() {
        let registry = builtin_node_definitions();
        let source_definition = registry
            .iter()
            .find(|definition| definition.type_id == "dolt_repo_source")
            .expect("dolt_repo_source definition");
        let sync_definition = registry
            .iter()
            .find(|definition| definition.type_id == "dolt_repo_sync")
            .expect("dolt_repo_sync definition");
        let source_node = WorkflowNode {
            node_id: "dolt_repo_source".to_string(),
            type_id: "dolt_repo_source".to_string(),
            definition_version: 1,
            label: Some("Dolt Repo Source".to_string()),
            config: json!({
                "connection_ref": "dolthub_public",
                "repository": "post-no-preference/options",
                "branch": "main",
                "checkout_ref": "4c9f2ab1d703ef91"
            }),
            position: NodePosition::default(),
        };
        let source_result = RuntimeAdapters::default()
            .execute(source_definition, &source_node, &PortValues::new())
            .expect("dolt repo source should succeed");
        let sync_node = WorkflowNode {
            node_id: "dolt_repo_sync".to_string(),
            type_id: "dolt_repo_sync".to_string(),
            definition_version: 1,
            label: Some("Dolt Repo Sync".to_string()),
            config: json!({
                "sync_action": "fetch_and_checkout",
                "no_change_behavior": "emit_no_op_marker",
                "branch_guard": "allow_detached_head",
                "dirty_working_copy_policy": "stash_and_continue"
            }),
            position: NodePosition::default(),
        };
        let sync_result = RuntimeAdapters::default()
            .execute(sync_definition, &sync_node, &source_result.outputs)
            .expect("dolt repo sync should succeed");

        let payload = sync_result
            .outputs
            .get("repo_out")
            .expect("dataset ref output should be present");

        assert_eq!(
            payload.value["repo_ref"]["repository"],
            json!("post-no-preference/options")
        );
        assert_eq!(
            payload.value["repo_ref"]["current_commit"],
            json!("4c9f2ab1d703")
        );
        assert_eq!(
            payload.value["metadata"]["previous_commit"],
            json!("ac31f0b")
        );
        assert_eq!(
            payload.value["metadata"]["sync_action"],
            json!("fetch_and_checkout")
        );
        assert_eq!(
            payload.value["metadata"]["no_change_behavior"],
            json!("emit_no_op_marker")
        );
        assert_eq!(
            payload.value["metadata"]["branch_guard"],
            json!("allow_detached_head")
        );
        assert_eq!(
            payload.value["metadata"]["dirty_working_copy_policy"],
            json!("stash_and_continue")
        );
    }

    #[test]
    fn dolt_change_manifest_emits_changed_table_metadata() {
        let registry = builtin_node_definitions();
        let source_definition = registry
            .iter()
            .find(|definition| definition.type_id == "dolt_repo_source")
            .expect("dolt_repo_source definition");
        let sync_definition = registry
            .iter()
            .find(|definition| definition.type_id == "dolt_repo_sync")
            .expect("dolt_repo_sync definition");
        let manifest_definition = registry
            .iter()
            .find(|definition| definition.type_id == "dolt_change_manifest")
            .expect("dolt_change_manifest definition");
        let source_node = WorkflowNode {
            node_id: "dolt_repo_source".to_string(),
            type_id: "dolt_repo_source".to_string(),
            definition_version: 1,
            label: Some("Dolt Repo Source".to_string()),
            config: json!({
                "connection_ref": "dolthub_public",
                "repository": "post-no-preference/earnings",
                "branch": "main"
            }),
            position: NodePosition::default(),
        };
        let source_result = RuntimeAdapters::default()
            .execute(source_definition, &source_node, &PortValues::new())
            .expect("dolt repo source should succeed");
        let sync_node = WorkflowNode {
            node_id: "dolt_repo_sync".to_string(),
            type_id: "dolt_repo_sync".to_string(),
            definition_version: 1,
            label: Some("Dolt Repo Sync".to_string()),
            config: json!({}),
            position: NodePosition::default(),
        };
        let sync_result = RuntimeAdapters::default()
            .execute(sync_definition, &sync_node, &source_result.outputs)
            .expect("dolt repo sync should succeed");
        let mut manifest_inputs = PortValues::new();
        manifest_inputs.insert(
            "repo".to_string(),
            sync_result
                .outputs
                .get("repo_out")
                .expect("synced repo output should be present")
                .clone(),
        );
        let manifest_node = WorkflowNode {
            node_id: "dolt_change_manifest".to_string(),
            type_id: "dolt_change_manifest".to_string(),
            definition_version: 1,
            label: Some("Dolt Change Manifest".to_string()),
            config: json!({}),
            position: NodePosition::default(),
        };
        let manifest_result = RuntimeAdapters::default()
            .execute(manifest_definition, &manifest_node, &manifest_inputs)
            .expect("dolt change manifest should succeed");

        let payload = manifest_result
            .outputs
            .get("manifest")
            .expect("manifest output should be present");

        assert_eq!(payload.data_type, DataType::DatasetRef);
        assert_eq!(
            payload.value["metadata"]["previous_commit"],
            json!("92fd7ac")
        );
        assert_eq!(
            payload.value["metadata"]["current_commit"],
            json!("a34ef9c")
        );
        assert_eq!(
            payload.value["metadata"]["changed_tables"],
            json!(["earnings_calendar", "eps_history", "income_statement"])
        );
        assert_eq!(
            payload.value["metadata"]["schema_change_flags"],
            json!(["income_statement"])
        );
    }

    #[test]
    fn dolt_change_manifest_respects_allowlist_scope() {
        let registry = builtin_node_definitions();
        let source_definition = registry
            .iter()
            .find(|definition| definition.type_id == "dolt_repo_source")
            .expect("dolt_repo_source definition");
        let sync_definition = registry
            .iter()
            .find(|definition| definition.type_id == "dolt_repo_sync")
            .expect("dolt_repo_sync definition");
        let manifest_definition = registry
            .iter()
            .find(|definition| definition.type_id == "dolt_change_manifest")
            .expect("dolt_change_manifest definition");
        let source_node = WorkflowNode {
            node_id: "dolt_repo_source".to_string(),
            type_id: "dolt_repo_source".to_string(),
            definition_version: 1,
            label: Some("Dolt Repo Source".to_string()),
            config: json!({
                "connection_ref": "dolthub_public",
                "repository": "post-no-preference/options",
                "branch": "main"
            }),
            position: NodePosition::default(),
        };
        let source_result = RuntimeAdapters::default()
            .execute(source_definition, &source_node, &PortValues::new())
            .expect("dolt repo source should succeed");
        let sync_node = WorkflowNode {
            node_id: "dolt_repo_sync".to_string(),
            type_id: "dolt_repo_sync".to_string(),
            definition_version: 1,
            label: Some("Dolt Repo Sync".to_string()),
            config: json!({}),
            position: NodePosition::default(),
        };
        let sync_result = RuntimeAdapters::default()
            .execute(sync_definition, &sync_node, &source_result.outputs)
            .expect("dolt repo sync should succeed");
        let mut manifest_inputs = PortValues::new();
        manifest_inputs.insert(
            "repo".to_string(),
            sync_result
                .outputs
                .get("repo_out")
                .expect("synced repo output should be present")
                .clone(),
        );
        let manifest_node = WorkflowNode {
            node_id: "dolt_change_manifest".to_string(),
            type_id: "dolt_change_manifest".to_string(),
            definition_version: 1,
            label: Some("Dolt Change Manifest".to_string()),
            config: json!({
                "table_scope": "allowlist",
                "selected_tables": ["option_chain"],
                "schema_change_policy": "fail_run"
            }),
            position: NodePosition::default(),
        };
        let manifest_result = RuntimeAdapters::default()
            .execute(manifest_definition, &manifest_node, &manifest_inputs)
            .expect("dolt change manifest should succeed");

        let payload = manifest_result
            .outputs
            .get("manifest")
            .expect("manifest output should be present");

        assert_eq!(payload.value["metadata"]["table_scope"], json!("allowlist"));
        assert_eq!(
            payload.value["metadata"]["schema_change_policy"],
            json!("fail_run")
        );
        assert_eq!(
            payload.value["metadata"]["changed_tables"],
            json!(["option_chain"])
        );
    }

    #[test]
    fn dolt_dump_prefers_manifest_scope_for_exported_tables() {
        let registry = builtin_node_definitions();
        let source_definition = registry
            .iter()
            .find(|definition| definition.type_id == "dolt_repo_source")
            .expect("dolt_repo_source definition");
        let sync_definition = registry
            .iter()
            .find(|definition| definition.type_id == "dolt_repo_sync")
            .expect("dolt_repo_sync definition");
        let manifest_definition = registry
            .iter()
            .find(|definition| definition.type_id == "dolt_change_manifest")
            .expect("dolt_change_manifest definition");
        let dump_definition = registry
            .iter()
            .find(|definition| definition.type_id == "dolt_dump")
            .expect("dolt_dump definition");

        let source_node = WorkflowNode {
            node_id: "dolt_repo_source".to_string(),
            type_id: "dolt_repo_source".to_string(),
            definition_version: 1,
            label: Some("Dolt Repo Source".to_string()),
            config: json!({
                "connection_ref": "dolthub_public",
                "repository": "post-no-preference/earnings",
                "branch": "main"
            }),
            position: NodePosition::default(),
        };
        let source_result = RuntimeAdapters::default()
            .execute(source_definition, &source_node, &PortValues::new())
            .expect("dolt repo source should succeed");

        let sync_node = WorkflowNode {
            node_id: "dolt_repo_sync".to_string(),
            type_id: "dolt_repo_sync".to_string(),
            definition_version: 1,
            label: Some("Dolt Repo Sync".to_string()),
            config: json!({}),
            position: NodePosition::default(),
        };
        let sync_result = RuntimeAdapters::default()
            .execute(sync_definition, &sync_node, &source_result.outputs)
            .expect("dolt repo sync should succeed");

        let mut manifest_inputs = PortValues::new();
        manifest_inputs.insert(
            "repo".to_string(),
            sync_result
                .outputs
                .get("repo_out")
                .expect("synced repo output should be present")
                .clone(),
        );
        let manifest_node = WorkflowNode {
            node_id: "dolt_change_manifest".to_string(),
            type_id: "dolt_change_manifest".to_string(),
            definition_version: 1,
            label: Some("Dolt Change Manifest".to_string()),
            config: json!({}),
            position: NodePosition::default(),
        };
        let manifest_result = RuntimeAdapters::default()
            .execute(manifest_definition, &manifest_node, &manifest_inputs)
            .expect("dolt change manifest should succeed");

        let mut dump_inputs = PortValues::new();
        dump_inputs.insert(
            "repo".to_string(),
            manifest_result
                .outputs
                .get("manifest")
                .expect("manifest output should be present")
                .clone(),
        );
        let dump_node = WorkflowNode {
            node_id: "dolt_dump".to_string(),
            type_id: "dolt_dump".to_string(),
            definition_version: 1,
            label: Some("Dolt Dump".to_string()),
            config: json!({
                "output_format": "parquet",
                "table_selection_mode": "prefer_manifest_scope"
            }),
            position: NodePosition::default(),
        };
        let dump_result = RuntimeAdapters::default()
            .execute(dump_definition, &dump_node, &dump_inputs)
            .expect("dolt dump should succeed");

        let payload = dump_result
            .outputs
            .get("bundle")
            .expect("bundle output should be present");

        assert_eq!(payload.data_type, DataType::DirectoryRef);
        assert_eq!(payload.value["kind"], json!("dolt_dump_bundle"));
        assert_eq!(payload.value["directory_ref"]["format"], json!("parquet"));
        assert_eq!(
            payload.value["metadata"]["table_selection_mode"],
            json!("prefer_manifest_scope")
        );
        assert_eq!(
            payload.value["metadata"]["manifest_changed_tables"],
            json!(["earnings_calendar", "eps_history", "income_statement"])
        );
        assert_eq!(
            payload.value["metadata"]["exported_tables"]
                .as_array()
                .expect("exported tables array")
                .len(),
            3
        );
    }

    #[test]
    fn dolt_dump_respects_manual_selected_tables_from_repo_input() {
        let registry = builtin_node_definitions();
        let source_definition = registry
            .iter()
            .find(|definition| definition.type_id == "dolt_repo_source")
            .expect("dolt_repo_source definition");
        let dump_definition = registry
            .iter()
            .find(|definition| definition.type_id == "dolt_dump")
            .expect("dolt_dump definition");

        let source_node = WorkflowNode {
            node_id: "dolt_repo_source".to_string(),
            type_id: "dolt_repo_source".to_string(),
            definition_version: 1,
            label: Some("Dolt Repo Source".to_string()),
            config: json!({
                "connection_ref": "dolthub_public",
                "repository": "post-no-preference/options",
                "branch": "main"
            }),
            position: NodePosition::default(),
        };
        let source_result = RuntimeAdapters::default()
            .execute(source_definition, &source_node, &PortValues::new())
            .expect("dolt repo source should succeed");

        let mut dump_inputs = PortValues::new();
        dump_inputs.insert(
            "repo".to_string(),
            source_result
                .outputs
                .get("repo")
                .expect("repo output should be present")
                .clone(),
        );
        let dump_node = WorkflowNode {
            node_id: "dolt_dump".to_string(),
            type_id: "dolt_dump".to_string(),
            definition_version: 1,
            label: Some("Dolt Dump".to_string()),
            config: json!({
                "output_format": "csv",
                "table_selection_mode": "manual_tables",
                "selected_tables": ["option_chain"]
            }),
            position: NodePosition::default(),
        };
        let dump_result = RuntimeAdapters::default()
            .execute(dump_definition, &dump_node, &dump_inputs)
            .expect("dolt dump should succeed");

        let payload = dump_result
            .outputs
            .get("bundle")
            .expect("bundle output should be present");

        assert_eq!(payload.data_type, DataType::DirectoryRef);
        assert_eq!(payload.value["directory_ref"]["format"], json!("csv"));
        assert_eq!(
            payload.value["metadata"]["selected_tables"],
            json!(["option_chain"])
        );
        assert_eq!(
            payload.value["metadata"]["exported_tables"],
            json!([
                {
                    "source_table": "option_chain",
                    "file_path": "artifacts/dolt_dump/options/b91c2aa/csv/option_chain.csv",
                    "row_count": Value::Null
                }
            ])
        );
    }

    #[test]
    fn dolt_dump_materializes_parquet_bundle_from_seeded_csv_exports() {
        let registry = builtin_node_definitions();
        let source_definition = registry
            .iter()
            .find(|definition| definition.type_id == "dolt_repo_source")
            .expect("dolt_repo_source definition");
        let dump_definition = registry
            .iter()
            .find(|definition| definition.type_id == "dolt_dump")
            .expect("dolt_dump definition");
        let workspace_root = unique_test_workflow_root("dolt_dump_seeded_csv_workspace");
        let workflow_root = workspace_root.join("workflows").join("wf_seeded_csv");
        let workspace_duckdb_path = workspace_root.join("db").join("workspace.duckdb");
        let workflow_files_root = workflow_root.join("files");
        let seed_dir = workflow_files_root.join("raw").join("dolt").join("rates");
        fs::create_dir_all(&seed_dir).expect("seed directory should be created");
        fs::write(
            seed_dir.join("us_treasury.csv"),
            "curve_date,tenor,yield_pct\n2026-06-01,2Y,4.820000\n2026-06-01,10Y,4.540000\n",
        )
        .expect("seed csv should be written");

        let source_node = WorkflowNode {
            node_id: "dolt_repo_source".to_string(),
            type_id: "dolt_repo_source".to_string(),
            definition_version: 1,
            label: Some("Dolt Repo Source".to_string()),
            config: json!({
                "connection_ref": "dolthub_public",
                "repository": "seeded/rates",
                "branch": "main"
            }),
            position: NodePosition::default(),
        };
        let source_result = RuntimeAdapters::default()
            .execute(source_definition, &source_node, &PortValues::new())
            .expect("dolt repo source should succeed");

        let mut dump_inputs = PortValues::new();
        dump_inputs.insert(
            "repo".to_string(),
            source_result
                .outputs
                .get("repo")
                .expect("repo output should be present")
                .clone(),
        );
        let dump_node = WorkflowNode {
            node_id: "dolt_dump".to_string(),
            type_id: "dolt_dump".to_string(),
            definition_version: 1,
            label: Some("Dolt Dump".to_string()),
            config: json!({
                "output_format": "parquet",
                "table_selection_mode": "manual_tables",
                "selected_tables": ["us_treasury"]
            }),
            position: NodePosition::default(),
        };
        let context = AdapterExecutionContext {
            workspace_duckdb_path: Some(workspace_duckdb_path),
            workflow_root_path: Some(workflow_root.clone()),
            workflow_files_root: Some(workflow_files_root.clone()),
            ..AdapterExecutionContext::default()
        };

        let dump_result = RuntimeAdapters::default()
            .execute_with_context(dump_definition, &dump_node, &dump_inputs, &context)
            .expect("dolt dump should materialize seeded bundle");

        let payload = dump_result
            .outputs
            .get("bundle")
            .expect("bundle output should be present");
        assert_eq!(payload.data_type, DataType::DirectoryRef);
        assert_eq!(payload.value["directory_ref"]["format"], json!("parquet"));
        assert_eq!(
            payload.value["directory_ref"]["path"],
            json!("artifacts/dolt_dump/rates/pending_sync/parquet")
        );

        let bundle_file = workflow_files_root
            .join("artifacts")
            .join("dolt_dump")
            .join("rates")
            .join("pending_sync")
            .join("parquet")
            .join("us_treasury.parquet");
        assert!(bundle_file.is_file(), "parquet bundle file should exist");

        let _ = fs::remove_dir_all(&workspace_root);
    }

    #[test]
    fn dolt_diff_export_emits_delta_bundle_from_manifest_input() {
        let registry = builtin_node_definitions();
        let source_definition = registry
            .iter()
            .find(|definition| definition.type_id == "dolt_repo_source")
            .expect("dolt_repo_source definition");
        let sync_definition = registry
            .iter()
            .find(|definition| definition.type_id == "dolt_repo_sync")
            .expect("dolt_repo_sync definition");
        let manifest_definition = registry
            .iter()
            .find(|definition| definition.type_id == "dolt_change_manifest")
            .expect("dolt_change_manifest definition");
        let diff_definition = registry
            .iter()
            .find(|definition| definition.type_id == "dolt_diff_export")
            .expect("dolt_diff_export definition");

        let source_node = WorkflowNode {
            node_id: "dolt_repo_source".to_string(),
            type_id: "dolt_repo_source".to_string(),
            definition_version: 1,
            label: Some("Dolt Repo Source".to_string()),
            config: json!({
                "connection_ref": "dolthub_public",
                "repository": "post-no-preference/earnings",
                "branch": "main"
            }),
            position: NodePosition::default(),
        };
        let source_result = RuntimeAdapters::default()
            .execute(source_definition, &source_node, &PortValues::new())
            .expect("dolt repo source should succeed");

        let sync_node = WorkflowNode {
            node_id: "dolt_repo_sync".to_string(),
            type_id: "dolt_repo_sync".to_string(),
            definition_version: 1,
            label: Some("Dolt Repo Sync".to_string()),
            config: json!({}),
            position: NodePosition::default(),
        };
        let sync_result = RuntimeAdapters::default()
            .execute(sync_definition, &sync_node, &source_result.outputs)
            .expect("dolt repo sync should succeed");

        let mut manifest_inputs = PortValues::new();
        manifest_inputs.insert(
            "repo".to_string(),
            sync_result
                .outputs
                .get("repo_out")
                .expect("synced repo output should be present")
                .clone(),
        );
        let manifest_node = WorkflowNode {
            node_id: "dolt_change_manifest".to_string(),
            type_id: "dolt_change_manifest".to_string(),
            definition_version: 1,
            label: Some("Dolt Change Manifest".to_string()),
            config: json!({}),
            position: NodePosition::default(),
        };
        let manifest_result = RuntimeAdapters::default()
            .execute(manifest_definition, &manifest_node, &manifest_inputs)
            .expect("dolt change manifest should succeed");

        let mut diff_inputs = PortValues::new();
        diff_inputs.insert(
            "manifest".to_string(),
            manifest_result
                .outputs
                .get("manifest")
                .expect("manifest output should be present")
                .clone(),
        );
        let diff_node = WorkflowNode {
            node_id: "dolt_diff_export".to_string(),
            type_id: "dolt_diff_export".to_string(),
            definition_version: 1,
            label: Some("Dolt Diff Export".to_string()),
            config: json!({
                "output_format": "parquet",
                "change_filter": "all_changes",
                "deleted_row_handling": "emit_delete_markers"
            }),
            position: NodePosition::default(),
        };
        let diff_result = RuntimeAdapters::default()
            .execute(diff_definition, &diff_node, &diff_inputs)
            .expect("dolt diff export should succeed");

        let payload = diff_result
            .outputs
            .get("bundle")
            .expect("bundle output should be present");

        assert_eq!(payload.data_type, DataType::DirectoryRef);
        assert_eq!(payload.value["kind"], json!("dolt_diff_export_bundle"));
        assert_eq!(payload.value["directory_ref"]["format"], json!("parquet"));
        assert_eq!(
            payload.value["metadata"]["change_filter"],
            json!("all_changes")
        );
        assert_eq!(
            payload.value["metadata"]["manifest_changed_tables"],
            json!(["earnings_calendar", "eps_history", "income_statement"])
        );
        assert_eq!(
            payload.value["metadata"]["delta_manifest"]
                .as_array()
                .expect("delta manifest array")
                .len(),
            3
        );
    }

    #[test]
    fn dolt_diff_export_tracks_removed_rows_when_manifest_contains_deletes() {
        let registry = builtin_node_definitions();
        let source_definition = registry
            .iter()
            .find(|definition| definition.type_id == "dolt_repo_source")
            .expect("dolt_repo_source definition");
        let sync_definition = registry
            .iter()
            .find(|definition| definition.type_id == "dolt_repo_sync")
            .expect("dolt_repo_sync definition");
        let manifest_definition = registry
            .iter()
            .find(|definition| definition.type_id == "dolt_change_manifest")
            .expect("dolt_change_manifest definition");
        let diff_definition = registry
            .iter()
            .find(|definition| definition.type_id == "dolt_diff_export")
            .expect("dolt_diff_export definition");

        let source_node = WorkflowNode {
            node_id: "dolt_repo_source".to_string(),
            type_id: "dolt_repo_source".to_string(),
            definition_version: 1,
            label: Some("Dolt Repo Source".to_string()),
            config: json!({
                "connection_ref": "dolthub_public",
                "repository": "post-no-preference/options",
                "branch": "main"
            }),
            position: NodePosition::default(),
        };
        let source_result = RuntimeAdapters::default()
            .execute(source_definition, &source_node, &PortValues::new())
            .expect("dolt repo source should succeed");

        let sync_node = WorkflowNode {
            node_id: "dolt_repo_sync".to_string(),
            type_id: "dolt_repo_sync".to_string(),
            definition_version: 1,
            label: Some("Dolt Repo Sync".to_string()),
            config: json!({}),
            position: NodePosition::default(),
        };
        let sync_result = RuntimeAdapters::default()
            .execute(sync_definition, &sync_node, &source_result.outputs)
            .expect("dolt repo sync should succeed");

        let mut manifest_inputs = PortValues::new();
        manifest_inputs.insert(
            "repo".to_string(),
            sync_result
                .outputs
                .get("repo_out")
                .expect("synced repo output should be present")
                .clone(),
        );
        let manifest_node = WorkflowNode {
            node_id: "dolt_change_manifest".to_string(),
            type_id: "dolt_change_manifest".to_string(),
            definition_version: 1,
            label: Some("Dolt Change Manifest".to_string()),
            config: json!({}),
            position: NodePosition::default(),
        };
        let manifest_result = RuntimeAdapters::default()
            .execute(manifest_definition, &manifest_node, &manifest_inputs)
            .expect("dolt change manifest should succeed");

        let mut diff_inputs = PortValues::new();
        diff_inputs.insert(
            "manifest".to_string(),
            manifest_result
                .outputs
                .get("manifest")
                .expect("manifest output should be present")
                .clone(),
        );
        let diff_node = WorkflowNode {
            node_id: "dolt_diff_export".to_string(),
            type_id: "dolt_diff_export".to_string(),
            definition_version: 1,
            label: Some("Dolt Diff Export".to_string()),
            config: json!({
                "output_format": "csv",
                "change_filter": "removed_only",
                "deleted_row_handling": "emit_delete_markers"
            }),
            position: NodePosition::default(),
        };
        let diff_result = RuntimeAdapters::default()
            .execute(diff_definition, &diff_node, &diff_inputs)
            .expect("dolt diff export should succeed");

        let payload = diff_result
            .outputs
            .get("bundle")
            .expect("bundle output should be present");

        assert_eq!(payload.data_type, DataType::DirectoryRef);
        assert_eq!(payload.value["directory_ref"]["format"], json!("csv"));
        assert_eq!(
            payload.value["metadata"]["filtered_tables"],
            json!(["option_chain"])
        );
        assert_eq!(
            payload.value["metadata"]["delete_rows_present"],
            json!(true)
        );
        assert_eq!(
            payload.value["metadata"]["delta_manifest"],
            json!([
                {
                    "source_table": "option_chain",
                    "file_path": "artifacts/dolt_diff_export/options/ac31f0b_to_b91c2aa/csv/option_chain.csv",
                    "added_rows": 0,
                    "modified_rows": 0,
                    "removed_rows": 17,
                    "operation_types": ["removed"],
                    "delete_markers_emitted": true,
                    "delete_marker_path": "artifacts/dolt_diff_export/options/ac31f0b_to_b91c2aa/csv/delete_markers/option_chain.jsonl"
                }
            ])
        );
    }

    #[test]
    fn load_to_duckdb_emits_staging_table_reference_from_dump_bundle() {
        let registry = builtin_node_definitions();
        let source_definition = registry
            .iter()
            .find(|definition| definition.type_id == "dolt_repo_source")
            .expect("dolt_repo_source definition");
        let sync_definition = registry
            .iter()
            .find(|definition| definition.type_id == "dolt_repo_sync")
            .expect("dolt_repo_sync definition");
        let manifest_definition = registry
            .iter()
            .find(|definition| definition.type_id == "dolt_change_manifest")
            .expect("dolt_change_manifest definition");
        let dump_definition = registry
            .iter()
            .find(|definition| definition.type_id == "dolt_dump")
            .expect("dolt_dump definition");
        let load_definition = registry
            .iter()
            .find(|definition| definition.type_id == "load_to_duckdb")
            .expect("load_to_duckdb definition");

        let source_node = WorkflowNode {
            node_id: "dolt_repo_source".to_string(),
            type_id: "dolt_repo_source".to_string(),
            definition_version: 1,
            label: Some("Dolt Repo Source".to_string()),
            config: json!({
                "connection_ref": "dolthub_public",
                "repository": "post-no-preference/earnings",
                "branch": "main"
            }),
            position: NodePosition::default(),
        };
        let source_result = RuntimeAdapters::default()
            .execute(source_definition, &source_node, &PortValues::new())
            .expect("dolt repo source should succeed");

        let sync_node = WorkflowNode {
            node_id: "dolt_repo_sync".to_string(),
            type_id: "dolt_repo_sync".to_string(),
            definition_version: 1,
            label: Some("Dolt Repo Sync".to_string()),
            config: json!({}),
            position: NodePosition::default(),
        };
        let sync_result = RuntimeAdapters::default()
            .execute(sync_definition, &sync_node, &source_result.outputs)
            .expect("dolt repo sync should succeed");

        let mut manifest_inputs = PortValues::new();
        manifest_inputs.insert(
            "repo".to_string(),
            sync_result
                .outputs
                .get("repo_out")
                .expect("synced repo output should be present")
                .clone(),
        );
        let manifest_node = WorkflowNode {
            node_id: "dolt_change_manifest".to_string(),
            type_id: "dolt_change_manifest".to_string(),
            definition_version: 1,
            label: Some("Dolt Change Manifest".to_string()),
            config: json!({}),
            position: NodePosition::default(),
        };
        let manifest_result = RuntimeAdapters::default()
            .execute(manifest_definition, &manifest_node, &manifest_inputs)
            .expect("dolt change manifest should succeed");

        let mut dump_inputs = PortValues::new();
        dump_inputs.insert(
            "repo".to_string(),
            manifest_result
                .outputs
                .get("manifest")
                .expect("manifest output should be present")
                .clone(),
        );
        let dump_node = WorkflowNode {
            node_id: "dolt_dump".to_string(),
            type_id: "dolt_dump".to_string(),
            definition_version: 1,
            label: Some("Dolt Dump".to_string()),
            config: json!({
                "output_format": "parquet",
                "table_selection_mode": "prefer_manifest_scope"
            }),
            position: NodePosition::default(),
        };
        let dump_result = RuntimeAdapters::default()
            .execute(dump_definition, &dump_node, &dump_inputs)
            .expect("dolt dump should succeed");

        let mut load_inputs = PortValues::new();
        load_inputs.insert(
            "bundle".to_string(),
            dump_result
                .outputs
                .get("bundle")
                .expect("bundle output should be present")
                .clone(),
        );
        let load_node = WorkflowNode {
            node_id: "load_to_duckdb".to_string(),
            type_id: "load_to_duckdb".to_string(),
            definition_version: 1,
            label: Some("Load to DuckDB".to_string()),
            config: json!({
                "target_schema": "staging",
                "table_mapping": "bundle_aware_staging_names",
                "schema_handling": "infer_on_first_load_validate_on_recurring",
                "delta_context_preservation": "preserve_commit_range_and_delete_flags"
            }),
            position: NodePosition::default(),
        };
        let load_result = RuntimeAdapters::default()
            .execute(load_definition, &load_node, &load_inputs)
            .expect("load_to_duckdb should succeed");

        let payload = load_result
            .outputs
            .get("table")
            .expect("table output should be present");

        assert_eq!(payload.data_type, DataType::TableRef);
        assert_eq!(payload.value["kind"], json!("table_reference"));
        assert_eq!(payload.value["schema_name"], json!("staging"));
        assert_eq!(
            payload.value["table_name"],
            json!("earnings__earnings_calendar__snapshot")
        );
        assert_eq!(
            payload.value["metadata"]["bundle_kind"],
            json!("dolt_dump_bundle")
        );
        assert_eq!(
            payload.value["metadata"]["loaded_tables"]
                .as_array()
                .unwrap()
                .len(),
            3
        );
        assert_eq!(
            payload.value["load_manifest_ref"]["path"],
            json!("artifacts/load_to_duckdb/earnings/a34ef9c/load_manifest.json")
        );
    }

    #[test]
    fn load_to_duckdb_reads_actual_bundle_files_when_present() {
        let registry = builtin_node_definitions();
        let load_definition = registry
            .iter()
            .find(|definition| definition.type_id == "load_to_duckdb")
            .expect("load_to_duckdb definition");
        let workspace_root = unique_test_workflow_root("load_to_duckdb_actual_bundle_workspace");
        let workflow_root = workspace_root.join("workflows").join("wf_actual_bundle");
        let duckdb_path = workspace_root.join("db").join("workspace.duckdb");
        let workflow_files_root = workflow_root.join("files");
        let bundle_dir = workflow_files_root
            .join("artifacts")
            .join("dolt_dump")
            .join("rates")
            .join("d0f61b4")
            .join("csv");
        fs::create_dir_all(&bundle_dir).expect("bundle directory should be created");
        fs::write(
            bundle_dir.join("us_treasury.csv"),
            "curve_date,tenor,yield_pct\n2026-06-01,2Y,4.820000\n2026-06-01,10Y,4.540000\n",
        )
        .expect("sample csv should be written");

        let mut inputs = PortValues::new();
        inputs.insert(
            "bundle".to_string(),
            TypedValue {
                data_type: DataType::DirectoryRef,
                value: json!({
                    "kind": "dolt_dump_bundle",
                    "directory_ref": {
                        "path": "artifacts/dolt_dump/rates/d0f61b4/csv",
                        "format": "csv",
                    },
                    "repo_ref": {
                        "connection_ref": "dolthub_public",
                        "repository": "post-no-preference/rates",
                        "branch": "main",
                        "checkout_ref": Value::Null,
                        "current_commit": "d0f61b4",
                    },
                    "metadata": {
                        "repo_family": "rates",
                        "exported_tables": [
                            {
                                "source_table": "us_treasury",
                                "file_path": "artifacts/dolt_dump/rates/d0f61b4/csv/us_treasury.csv",
                                "row_count": Value::Null,
                            }
                        ]
                    }
                }),
            },
        );
        let node = WorkflowNode {
            node_id: "load_to_duckdb".to_string(),
            type_id: "load_to_duckdb".to_string(),
            definition_version: 1,
            label: Some("Load to DuckDB".to_string()),
            config: json!({
                "target_schema": "staging"
            }),
            position: NodePosition::default(),
        };
        let context = AdapterExecutionContext {
            workspace_duckdb_path: Some(duckdb_path.clone()),
            workflow_root_path: Some(workflow_root.clone()),
            workflow_files_root: Some(workflow_files_root),
            ..AdapterExecutionContext::default()
        };

        let result = RuntimeAdapters::default()
            .execute_with_context(load_definition, &node, &inputs, &context)
            .expect("load_to_duckdb should load actual files");
        let payload = result
            .outputs
            .get("table")
            .expect("table output should be present");

        assert_eq!(
            payload.value["table_name"],
            json!("rates__us_treasury__snapshot")
        );
        assert_eq!(
            payload.value["schema_definition"]["columns"][0]["name"],
            json!("curve_date")
        );
        assert_eq!(
            payload.value["schema_definition"]["columns"][1]["name"],
            json!("tenor")
        );
        assert_eq!(
            payload.value["schema_definition"]["columns"][2]["name"],
            json!("yield_pct")
        );
        assert_eq!(
            payload.value["metadata"]["loaded_tables"][0]["row_count"],
            json!(2)
        );

        let duckdb = DuckDbConnection::open(&duckdb_path).expect("duckdb should open");
        let row_count: i64 = duckdb
            .query_row(
                "select count(*) from staging.rates__us_treasury__snapshot",
                [],
                |row| row.get(0),
            )
            .expect("staging row count query should succeed");
        assert_eq!(row_count, 2);
        let loaded_row: (String, String, String, String, bool) = duckdb
            .query_row(
                "select current_commit,
                        source_repo,
                        source_table,
                        batch_id,
                        ingested_at is not null
                 from staging.rates__us_treasury__snapshot
                 limit 1",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .expect("staging metadata query should succeed");
        assert_eq!(loaded_row.0, "d0f61b4");
        assert_eq!(loaded_row.1, "post-no-preference/rates");
        assert_eq!(loaded_row.2, "us_treasury");
        assert_eq!(loaded_row.3, "d0f61b4");
        assert!(loaded_row.4);

        let _ = fs::remove_dir_all(&workspace_root);
    }

    #[test]
    fn load_to_duckdb_adds_metadata_columns_for_actual_csv_bundle_files() {
        let registry = builtin_node_definitions();
        let load_definition = registry
            .iter()
            .find(|definition| definition.type_id == "load_to_duckdb")
            .expect("load_to_duckdb definition");
        let workflow_root = unique_test_workflow_root("load_to_duckdb_metadata_columns");
        let duckdb_path = workflow_root.join("db").join("workflow.duckdb");
        let bundle_dir = workflow_root
            .join("files")
            .join("artifacts")
            .join("dolt_dump")
            .join("rates")
            .join("c0ffee")
            .join("csv");
        fs::create_dir_all(&bundle_dir).expect("bundle directory should be created");
        fs::write(
            bundle_dir.join("us_treasury.csv"),
            "curve_date,tenor,yield_pct\n2026-06-01,2Y,4.820000\n",
        )
        .expect("sample csv should be written");

        let mut inputs = PortValues::new();
        inputs.insert(
            "bundle".to_string(),
            TypedValue {
                data_type: DataType::DirectoryRef,
                value: json!({
                    "kind": "dolt_dump_bundle",
                    "directory_ref": {
                        "path": "artifacts/dolt_dump/rates/c0ffee/csv",
                        "format": "csv",
                    },
                    "repo_ref": {
                        "connection_ref": "dolthub_public",
                        "repository": "post-no-preference/rates",
                        "branch": "main",
                        "checkout_ref": Value::Null,
                        "current_commit": "c0ffee",
                    },
                    "metadata": {
                        "repo_family": "rates",
                        "exported_tables": [
                            {
                                "source_table": "us_treasury",
                                "file_path": "artifacts/dolt_dump/rates/c0ffee/csv/us_treasury.csv",
                                "row_count": Value::Null,
                            }
                        ]
                    }
                }),
            },
        );
        let node = WorkflowNode {
            node_id: "load_to_duckdb".to_string(),
            type_id: "load_to_duckdb".to_string(),
            definition_version: 1,
            label: Some("Load to DuckDB".to_string()),
            config: json!({
                "target_schema": "staging"
            }),
            position: NodePosition::default(),
        };
        let context = AdapterExecutionContext {
            workflow_duckdb_path: Some(duckdb_path.clone()),
            ..AdapterExecutionContext::default()
        };

        let result = RuntimeAdapters::default()
            .execute_with_context(load_definition, &node, &inputs, &context)
            .expect("load_to_duckdb should load actual files and add metadata columns");
        let payload = result
            .outputs
            .get("table")
            .expect("table output should be present");
        let schema_column_names = payload.value["schema_definition"]["columns"]
            .as_array()
            .expect("schema columns should be present")
            .iter()
            .filter_map(|column| column.get("name").and_then(Value::as_str))
            .collect::<Vec<_>>();

        for expected_column in [
            "curve_date",
            "tenor",
            "yield_pct",
            "source_repo",
            "source_table",
            "batch_id",
            "ingested_at",
            "bundle_kind",
            "current_commit",
            "delete_rows_present",
        ] {
            assert!(
                schema_column_names.contains(&expected_column),
                "expected schema to contain `{expected_column}`, got {schema_column_names:?}"
            );
        }

        let duckdb = DuckDbConnection::open(&duckdb_path).expect("duckdb should open");
        let loaded_row: (String, String, String, String, bool) = duckdb
            .query_row(
                "select source_repo,
                        source_table,
                        batch_id,
                        current_commit,
                        delete_rows_present
                 from staging.rates__us_treasury__snapshot
                 limit 1",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .expect("staging metadata query should succeed");
        assert_eq!(loaded_row.0, "post-no-preference/rates");
        assert_eq!(loaded_row.1, "us_treasury");
        assert_eq!(loaded_row.2, "c0ffee");
        assert_eq!(loaded_row.3, "c0ffee");
        assert!(!loaded_row.4);

        let _ = fs::remove_dir_all(&workflow_root);
    }

    #[test]
    fn load_to_duckdb_preserves_merge_metadata_from_diff_bundle() {
        let registry = builtin_node_definitions();
        let source_definition = registry
            .iter()
            .find(|definition| definition.type_id == "dolt_repo_source")
            .expect("dolt_repo_source definition");
        let sync_definition = registry
            .iter()
            .find(|definition| definition.type_id == "dolt_repo_sync")
            .expect("dolt_repo_sync definition");
        let manifest_definition = registry
            .iter()
            .find(|definition| definition.type_id == "dolt_change_manifest")
            .expect("dolt_change_manifest definition");
        let diff_definition = registry
            .iter()
            .find(|definition| definition.type_id == "dolt_diff_export")
            .expect("dolt_diff_export definition");
        let load_definition = registry
            .iter()
            .find(|definition| definition.type_id == "load_to_duckdb")
            .expect("load_to_duckdb definition");

        let source_node = WorkflowNode {
            node_id: "dolt_repo_source".to_string(),
            type_id: "dolt_repo_source".to_string(),
            definition_version: 1,
            label: Some("Dolt Repo Source".to_string()),
            config: json!({
                "connection_ref": "dolthub_public",
                "repository": "post-no-preference/options",
                "branch": "main"
            }),
            position: NodePosition::default(),
        };
        let source_result = RuntimeAdapters::default()
            .execute(source_definition, &source_node, &PortValues::new())
            .expect("dolt repo source should succeed");

        let sync_node = WorkflowNode {
            node_id: "dolt_repo_sync".to_string(),
            type_id: "dolt_repo_sync".to_string(),
            definition_version: 1,
            label: Some("Dolt Repo Sync".to_string()),
            config: json!({}),
            position: NodePosition::default(),
        };
        let sync_result = RuntimeAdapters::default()
            .execute(sync_definition, &sync_node, &source_result.outputs)
            .expect("dolt repo sync should succeed");

        let mut manifest_inputs = PortValues::new();
        manifest_inputs.insert(
            "repo".to_string(),
            sync_result
                .outputs
                .get("repo_out")
                .expect("synced repo output should be present")
                .clone(),
        );
        let manifest_node = WorkflowNode {
            node_id: "dolt_change_manifest".to_string(),
            type_id: "dolt_change_manifest".to_string(),
            definition_version: 1,
            label: Some("Dolt Change Manifest".to_string()),
            config: json!({}),
            position: NodePosition::default(),
        };
        let manifest_result = RuntimeAdapters::default()
            .execute(manifest_definition, &manifest_node, &manifest_inputs)
            .expect("dolt change manifest should succeed");

        let mut diff_inputs = PortValues::new();
        diff_inputs.insert(
            "manifest".to_string(),
            manifest_result
                .outputs
                .get("manifest")
                .expect("manifest output should be present")
                .clone(),
        );
        let diff_node = WorkflowNode {
            node_id: "dolt_diff_export".to_string(),
            type_id: "dolt_diff_export".to_string(),
            definition_version: 1,
            label: Some("Dolt Diff Export".to_string()),
            config: json!({
                "output_format": "csv",
                "change_filter": "removed_only",
                "deleted_row_handling": "emit_delete_markers"
            }),
            position: NodePosition::default(),
        };
        let diff_result = RuntimeAdapters::default()
            .execute(diff_definition, &diff_node, &diff_inputs)
            .expect("dolt diff export should succeed");

        let mut load_inputs = PortValues::new();
        load_inputs.insert(
            "bundle".to_string(),
            diff_result
                .outputs
                .get("bundle")
                .expect("bundle output should be present")
                .clone(),
        );
        let load_node = WorkflowNode {
            node_id: "load_to_duckdb".to_string(),
            type_id: "load_to_duckdb".to_string(),
            definition_version: 1,
            label: Some("Load to DuckDB".to_string()),
            config: json!({
                "target_schema": "staging"
            }),
            position: NodePosition::default(),
        };
        let load_result = RuntimeAdapters::default()
            .execute(load_definition, &load_node, &load_inputs)
            .expect("load_to_duckdb should succeed");

        let payload = load_result
            .outputs
            .get("table")
            .expect("table output should be present");

        assert_eq!(payload.data_type, DataType::TableRef);
        assert_eq!(
            payload.value["table_name"],
            json!("options__option_chain__delta")
        );
        assert_eq!(
            payload.value["metadata"]["bundle_kind"],
            json!("dolt_diff_export_bundle")
        );
        assert_eq!(
            payload.value["metadata"]["previous_commit"],
            json!("ac31f0b")
        );
        assert_eq!(
            payload.value["metadata"]["current_commit"],
            json!("b91c2aa")
        );
        assert_eq!(
            payload.value["metadata"]["delete_rows_present"],
            json!(true)
        );
        assert_eq!(
            payload.value["metadata"]["loaded_tables"][0]["delete_markers_emitted"],
            json!(true)
        );
        assert_eq!(
            payload.value["load_manifest_ref"]["path"],
            json!("artifacts/load_to_duckdb/options/ac31f0b_to_b91c2aa/load_manifest.json")
        );
    }

    #[test]
    fn table_merge_emits_durable_table_reference_output() {
        let registry = builtin_node_definitions();
        let definition = registry
            .iter()
            .find(|definition| definition.type_id == "table_merge")
            .expect("table_merge definition");
        let node = WorkflowNode {
            node_id: "table_merge".to_string(),
            type_id: "table_merge".to_string(),
            definition_version: 1,
            label: None,
            config: json!({
                "target_schema": "tables",
                "write_policy": "upsert",
                "merge_key_columns": ["symbol", "report_date"],
                "delete_handling": "apply_delete_markers",
                "schema_drift_behavior": "fail_and_require_review"
            }),
            position: NodePosition::default(),
        };
        let mut inputs = PortValues::new();
        inputs.insert(
            "table".to_string(),
            TypedValue {
                data_type: DataType::TableRef,
                value: json!({
                    "kind": "table_reference",
                    "catalog": "workflow.duckdb",
                    "schema_name": "staging",
                    "table_name": "earnings_calendar",
                    "output_alias": "earnings_calendar",
                    "selected_columns": [],
                    "row_filter": Value::Null,
                    "row_limit": Value::Null,
                    "refresh_schema": true,
                    "open_in_catalog": false,
                    "schema_definition": {
                        "columns": [],
                        "primary_key": [],
                        "checks": []
                    }
                }),
            },
        );

        let result = RuntimeAdapters::default()
            .execute(definition, &node, &inputs)
            .expect("table merge should succeed");

        let payload = result
            .outputs
            .get("table")
            .expect("table merge table output should be present");
        assert_eq!(payload.data_type, DataType::TableRef);
        assert_eq!(payload.value["schema_name"], json!("tables"));
        assert_eq!(payload.value["table_name"], json!("earnings_calendar"));
        assert_eq!(payload.value["metadata"]["write_policy"], json!("upsert"));
        assert_eq!(
            payload.value["metadata"]["merge_key_columns"],
            json!(["symbol", "report_date"])
        );
        assert_eq!(
            result.logs,
            vec![
                "Prepared upsert merge into `tables` from `staging.earnings_calendar` across 1 table definition(s) using merge key `symbol, report_date`."
            ]
        );
    }

    #[test]
    fn table_merge_reports_missing_target_merge_key_before_duckdb_binder_error() {
        let registry = builtin_node_definitions();
        let definition = registry
            .iter()
            .find(|definition| definition.type_id == "table_merge")
            .expect("table_merge definition");
        let workflow_root = unique_test_workflow_root("table_merge_missing_target_key");
        let duckdb_path = workflow_root.join("db").join("workflow.duckdb");
        fs::create_dir_all(duckdb_path.parent().expect("duckdb parent should exist"))
            .expect("duckdb parent directory should be created");
        let connection = DuckDbConnection::open(&duckdb_path).expect("duckdb should open");
        connection
            .execute_batch(
                "create schema staging;
                 create schema tables;
                 create table staging.rates__us_treasury__snapshot (
                   date date,
                   tenor varchar,
                   yield_pct double
                 );
                 insert into staging.rates__us_treasury__snapshot values
                   ('2026-06-11', '2Y', 4.75);
                 create table tables.rates__us_treasury__snapshot (
                   tenor varchar,
                   batch_id varchar,
                   delete_rows_present boolean
                 );",
            )
            .expect("schemas and tables should be created");
        drop(connection);

        let node = WorkflowNode {
            node_id: "table_merge".to_string(),
            type_id: "table_merge".to_string(),
            definition_version: 1,
            label: None,
            config: json!({
                "target_schema": "tables",
                "write_policy": "upsert",
                "merge_key_columns": ["date"],
                "delete_handling": "apply_delete_markers",
                "schema_drift_behavior": "fail_and_require_review"
            }),
            position: NodePosition::default(),
        };
        let mut inputs = PortValues::new();
        inputs.insert(
            "table".to_string(),
            TypedValue {
                data_type: DataType::TableRef,
                value: json!({
                    "kind": "table_reference",
                    "catalog": "workflow.duckdb",
                    "schema_name": "staging",
                    "table_name": "rates__us_treasury__snapshot",
                    "output_alias": "rates__us_treasury__snapshot",
                    "selected_columns": [],
                    "row_filter": Value::Null,
                    "row_limit": Value::Null,
                    "refresh_schema": true,
                    "open_in_catalog": false,
                    "schema_definition": {
                        "columns": [],
                        "primary_key": [],
                        "checks": []
                    }
                }),
            },
        );
        let context = AdapterExecutionContext {
            workflow_duckdb_path: Some(duckdb_path.clone()),
            ..AdapterExecutionContext::default()
        };

        let error = RuntimeAdapters::default()
            .execute_with_context(definition, &node, &inputs, &context)
            .expect_err("table merge should fail with a clear target schema error");

        match error {
            AdapterError::ExecutionFailed { message, .. } => {
                assert_eq!(
                    message,
                    "merge key(s) `date` do not exist on durable target table `tables.rates__us_treasury__snapshot`. Existing target columns: `tenor`, `batch_id`, `delete_rows_present`."
                );
            }
            other => panic!("unexpected error: {other:?}"),
        }

        let _ = fs::remove_dir_all(&workflow_root);
    }

    #[test]
    fn sql_transform_emits_view_backed_table_reference_output() {
        let registry = builtin_node_definitions();
        let definition = registry
            .iter()
            .find(|definition| definition.type_id == "sql_transform")
            .expect("sql_transform definition");
        let workflow_root = unique_test_workflow_root("sql_transform_view_output");
        let duckdb_path = workflow_root.join("db").join("workflow.duckdb");
        fs::create_dir_all(duckdb_path.parent().expect("duckdb parent should exist"))
            .expect("duckdb parent directory should be created");
        let connection = DuckDbConnection::open(&duckdb_path).expect("duckdb should open");
        connection
            .execute_batch(
                "create schema staging;
                 create table staging.rates__us_treasury__snapshot (
                   date date,
                   tenor varchar,
                   yield_pct double
                 );
                 insert into staging.rates__us_treasury__snapshot values
                   ('2026-06-11', '2Y', 4.75);",
            )
            .expect("staging table should be created");
        drop(connection);

        let node = WorkflowNode {
            node_id: "sql_transform".to_string(),
            type_id: "sql_transform".to_string(),
            definition_version: 1,
            label: None,
            config: json!({
                "target_schema": "staging_curated",
                "output_table_name": "rates__us_treasury__snapshot_normalized",
                "materialization_mode": "view",
                "sql_text": "select date as curve_date, tenor, yield_pct from {{source}}"
            }),
            position: NodePosition::default(),
        };
        let mut inputs = PortValues::new();
        inputs.insert(
            "table".to_string(),
            TypedValue {
                data_type: DataType::TableRef,
                value: json!({
                    "kind": "table_reference",
                    "catalog": "workflow.duckdb",
                    "schema_name": "staging",
                    "table_name": "rates__us_treasury__snapshot",
                    "output_alias": "rates__us_treasury__snapshot",
                    "selected_columns": [],
                    "row_filter": Value::Null,
                    "row_limit": Value::Null,
                    "refresh_schema": true,
                    "open_in_catalog": false,
                    "schema_definition": {
                        "columns": [],
                        "primary_key": [],
                        "checks": []
                    },
                    "metadata": {
                        "repository": "post-no-preference/rates"
                    }
                }),
            },
        );
        let context = AdapterExecutionContext {
            workflow_duckdb_path: Some(duckdb_path.clone()),
            ..AdapterExecutionContext::default()
        };

        let result = RuntimeAdapters::default()
            .execute_with_context(definition, &node, &inputs, &context)
            .expect("sql_transform should succeed");
        let payload = result
            .outputs
            .get("table")
            .expect("table output should be present");
        assert_eq!(payload.data_type, DataType::TableRef);
        assert_eq!(payload.value["schema_name"], json!("staging_curated"));
        assert_eq!(
            payload.value["table_name"],
            json!("rates__us_treasury__snapshot_normalized")
        );
        assert_eq!(
            payload.value["metadata"]["transform_kind"],
            json!("sql_transform")
        );
        assert_eq!(
            payload.value["metadata"]["materialization_mode"],
            json!("view")
        );
        assert_eq!(
            payload.value["schema_definition"]["columns"][0]["name"],
            json!("curve_date")
        );

        let connection = DuckDbConnection::open(&duckdb_path).expect("duckdb should reopen");
        let row: (String, String, f64) = connection
            .query_row(
                "select curve_date::varchar, tenor, yield_pct
                 from staging_curated.rates__us_treasury__snapshot_normalized",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("view should query");
        assert_eq!(row.0, "2026-06-11");
        assert_eq!(row.1, "2Y");
        assert_eq!(row.2, 4.75);

        let _ = fs::remove_dir_all(&workflow_root);
    }

    #[test]
    fn table_merge_bootstraps_from_sql_transform_unpivot_view() {
        let registry = builtin_node_definitions();
        let sql_transform_definition = registry
            .iter()
            .find(|definition| definition.type_id == "sql_transform")
            .expect("sql_transform definition");
        let table_merge_definition = registry
            .iter()
            .find(|definition| definition.type_id == "table_merge")
            .expect("table_merge definition");
        let workflow_root = unique_test_workflow_root("table_merge_unpivot_view");
        let duckdb_path = workflow_root.join("db").join("workflow.duckdb");
        fs::create_dir_all(duckdb_path.parent().expect("duckdb parent should exist"))
            .expect("duckdb parent directory should be created");
        let connection = DuckDbConnection::open(&duckdb_path).expect("duckdb should open");
        connection
            .execute_batch(
                "create schema staging;
                 create table staging.rates__us_treasury__snapshot (
                   date date,
                   \"1_month\" double,
                   \"2_month\" double,
                   source_repo varchar,
                   source_table varchar,
                   batch_id varchar,
                   ingested_at timestamp,
                   current_commit varchar
                 );
                 insert into staging.rates__us_treasury__snapshot values
                   ('2026-06-11', 4.42, 4.45, 'post-no-preference/rates', 'us_treasury', 'batch-1', '2026-06-14 12:00:00', 'abc123'),
                   ('2026-06-12', 4.41, 4.44, 'post-no-preference/rates', 'us_treasury', 'batch-1', '2026-06-14 12:00:00', 'abc123');",
            )
            .expect("source table should be created");
        drop(connection);

        let context = AdapterExecutionContext {
            workflow_duckdb_path: Some(duckdb_path.clone()),
            ..AdapterExecutionContext::default()
        };
        let sql_transform_node = WorkflowNode {
            node_id: "sql_transform".to_string(),
            type_id: "sql_transform".to_string(),
            definition_version: 1,
            label: None,
            config: json!({
                "target_schema": "staging",
                "output_table_name": "us_treasury",
                "materialization_mode": "view",
                "sql_text": "select
  date as curve_date,
  tenor,
  yield_pct,
  source_repo,
  source_table,
  batch_id,
  ingested_at,
  current_commit
from {{source}}
unpivot (
  yield_pct for tenor in (\"1_month\", \"2_month\")
)"
            }),
            position: NodePosition::default(),
        };
        let mut sql_inputs = PortValues::new();
        sql_inputs.insert(
            "table".to_string(),
            TypedValue {
                data_type: DataType::TableRef,
                value: json!({
                    "kind": "table_reference",
                    "catalog": "workflow.duckdb",
                    "schema_name": "staging",
                    "table_name": "rates__us_treasury__snapshot",
                    "output_alias": "rates__us_treasury__snapshot",
                    "selected_columns": [],
                    "row_filter": Value::Null,
                    "row_limit": Value::Null,
                    "refresh_schema": true,
                    "open_in_catalog": false,
                    "schema_definition": {
                        "columns": [],
                        "primary_key": [],
                        "checks": []
                    }
                }),
            },
        );
        let sql_result = RuntimeAdapters::default()
            .execute_with_context(
                sql_transform_definition,
                &sql_transform_node,
                &sql_inputs,
                &context,
            )
            .expect("sql transform should materialize unpivot output");

        let table_merge_node = WorkflowNode {
            node_id: "table_merge".to_string(),
            type_id: "table_merge".to_string(),
            definition_version: 1,
            label: None,
            config: json!({
                "target_schema": "tables",
                "write_policy": "upsert",
                "merge_key_columns": ["curve_date", "tenor"],
                "delete_handling": "apply_delete_markers",
                "schema_drift_behavior": "fail_and_require_review"
            }),
            position: NodePosition::default(),
        };
        let mut merge_inputs = PortValues::new();
        merge_inputs.insert(
            "table".to_string(),
            sql_result
                .outputs
                .get("table")
                .expect("sql transform table output")
                .clone(),
        );
        RuntimeAdapters::default()
            .execute_with_context(
                table_merge_definition,
                &table_merge_node,
                &merge_inputs,
                &context,
            )
            .expect("table merge should bootstrap from unpivot transform output");

        let connection = DuckDbConnection::open(&duckdb_path).expect("duckdb should reopen");
        let row_count: i64 = connection
            .query_row("select count(*) from tables.us_treasury", [], |row| {
                row.get(0)
            })
            .expect("merged table row count");
        assert_eq!(row_count, 4);

        let _ = fs::remove_dir_all(&workflow_root);
    }

    #[test]
    fn checkpoint_write_enriches_table_output_with_persisted_checkpoint_metadata() {
        let registry = builtin_node_definitions();
        let table_merge_definition = registry
            .iter()
            .find(|definition| definition.type_id == "table_merge")
            .expect("table_merge definition");
        let checkpoint_write_definition = registry
            .iter()
            .find(|definition| definition.type_id == "checkpoint_write")
            .expect("checkpoint_write definition");

        let table_merge_node = WorkflowNode {
            node_id: "table_merge".to_string(),
            type_id: "table_merge".to_string(),
            definition_version: 1,
            label: None,
            config: json!({
                "target_schema": "tables",
                "write_policy": "upsert",
                "merge_key_columns": ["symbol", "report_date"],
                "delete_handling": "apply_delete_markers",
                "schema_drift_behavior": "fail_and_require_review"
            }),
            position: NodePosition::default(),
        };
        let mut merge_inputs = PortValues::new();
        merge_inputs.insert(
            "table".to_string(),
            TypedValue {
                data_type: DataType::TableRef,
                value: json!({
                    "kind": "table_reference",
                    "catalog": "workflow.duckdb",
                    "schema_name": "staging",
                    "table_name": "earnings_calendar",
                    "output_alias": "earnings_calendar",
                    "selected_columns": [],
                    "row_filter": Value::Null,
                    "row_limit": Value::Null,
                    "refresh_schema": true,
                    "open_in_catalog": false,
                    "schema_definition": {
                        "columns": [],
                        "primary_key": [],
                        "checks": []
                    },
                    "load_manifest_ref": {
                        "kind": "load_manifest_ref",
                        "path": "artifacts/load_to_duckdb/earnings/a34ef9c/load_manifest.json",
                        "target_schema": "staging"
                    },
                    "metadata": {
                        "bundle_kind": "dolt_dump_bundle",
                        "branch": "main",
                        "current_commit": "a34ef9c",
                        "previous_commit": Value::Null,
                        "repo_family": "earnings",
                        "repository": "post-no-preference/earnings"
                    }
                }),
            },
        );
        let merge_result = RuntimeAdapters::default()
            .execute(table_merge_definition, &table_merge_node, &merge_inputs)
            .expect("table merge should succeed");

        let checkpoint_write_node = WorkflowNode {
            node_id: "checkpoint_write".to_string(),
            type_id: "checkpoint_write".to_string(),
            definition_version: 1,
            label: None,
            config: json!({
                "checkpoint_table": "tables.ingest_checkpoints",
                "commit_source": "metadata.current_commit",
                "write_timing": "after_merge_success",
                "only_persist_on_full_success": true,
                "advance_on_partial_success": false
            }),
            position: NodePosition::default(),
        };
        let mut checkpoint_inputs = PortValues::new();
        checkpoint_inputs.insert(
            "table".to_string(),
            merge_result
                .outputs
                .get("table")
                .expect("merged table output should be present")
                .clone(),
        );
        let checkpoint_result = RuntimeAdapters::default()
            .execute(
                checkpoint_write_definition,
                &checkpoint_write_node,
                &checkpoint_inputs,
            )
            .expect("checkpoint write should succeed");

        let payload = checkpoint_result
            .outputs
            .get("table")
            .expect("checkpoint write table output should be present");
        assert_eq!(payload.data_type, DataType::TableRef);
        assert_eq!(
            payload.value["metadata"]["checkpoint_write"]["checkpoint_table"],
            json!("tables.ingest_checkpoints")
        );
        assert_eq!(
            payload.value["metadata"]["checkpoint_write"]["last_synced_commit"],
            json!("a34ef9c")
        );
        assert_eq!(
            payload.value["metadata"]["checkpoint_write"]["last_ingest_mode"],
            json!("bootstrap_refresh")
        );
        assert_eq!(
            checkpoint_result.logs,
            vec![
                "Prepared checkpoint write to `tables.ingest_checkpoints` for `post-no-preference/earnings` on `main` at commit `a34ef9c` using `after_merge_success`."
            ]
        );
    }

    #[test]
    fn quality_check_passes_through_table_reference_and_checkpoint_write_accepts_it() {
        let registry = builtin_node_definitions();
        let table_merge_definition = registry
            .iter()
            .find(|definition| definition.type_id == "table_merge")
            .expect("table_merge definition");
        let quality_check_definition = registry
            .iter()
            .find(|definition| definition.type_id == "quality_check")
            .expect("quality_check definition");
        let checkpoint_write_definition = registry
            .iter()
            .find(|definition| definition.type_id == "checkpoint_write")
            .expect("checkpoint_write definition");

        let table_merge_node = WorkflowNode {
            node_id: "table_merge".to_string(),
            type_id: "table_merge".to_string(),
            definition_version: 1,
            label: None,
            config: json!({
                "target_schema": "tables",
                "write_policy": "upsert",
                "merge_key_columns": ["symbol", "report_date"],
                "delete_handling": "apply_delete_markers",
                "schema_drift_behavior": "fail_and_require_review"
            }),
            position: NodePosition::default(),
        };
        let mut merge_inputs = PortValues::new();
        merge_inputs.insert(
            "table".to_string(),
            TypedValue {
                data_type: DataType::TableRef,
                value: json!({
                    "kind": "table_reference",
                    "catalog": "workflow.duckdb",
                    "schema_name": "staging",
                    "table_name": "earnings_calendar",
                    "output_alias": "earnings_calendar",
                    "selected_columns": [],
                    "row_filter": Value::Null,
                    "row_limit": Value::Null,
                    "refresh_schema": true,
                    "open_in_catalog": false,
                    "schema_definition": {
                        "columns": [],
                        "primary_key": [],
                        "checks": []
                    },
                    "load_manifest_ref": {
                        "kind": "load_manifest_ref",
                        "path": "artifacts/load_to_duckdb/earnings/a34ef9c/load_manifest.json",
                        "target_schema": "staging"
                    },
                    "metadata": {
                        "bundle_kind": "dolt_dump_bundle",
                        "branch": "main",
                        "current_commit": "a34ef9c",
                        "previous_commit": Value::Null,
                        "repo_family": "earnings",
                        "repository": "post-no-preference/earnings"
                    }
                }),
            },
        );
        let merge_result = RuntimeAdapters::default()
            .execute(table_merge_definition, &table_merge_node, &merge_inputs)
            .expect("table merge should succeed");

        let quality_check_node = WorkflowNode {
            node_id: "quality_check".to_string(),
            type_id: "quality_check".to_string(),
            definition_version: 1,
            label: None,
            config: json!({
                "suite_preset": "post_merge_ingest_gate",
                "schema_drift_rule": "fail_on_required_column_drift",
                "null_key_policy": "block_on_primary_key_nulls",
                "warning_budget": 2,
                "block_checkpoint_write_on_failure": true,
                "allow_warning_only_runs_to_continue": true
            }),
            position: NodePosition::default(),
        };
        let mut quality_inputs = PortValues::new();
        quality_inputs.insert(
            "table".to_string(),
            merge_result
                .outputs
                .get("table")
                .expect("merged table output should be present")
                .clone(),
        );
        let quality_result = RuntimeAdapters::default()
            .execute(
                quality_check_definition,
                &quality_check_node,
                &quality_inputs,
            )
            .expect("quality check should succeed");

        let quality_payload = quality_result
            .outputs
            .get("table")
            .expect("quality check output should be present");
        assert_eq!(
            quality_payload.value["metadata"]["quality_check"]["gate_status"],
            json!("warn")
        );
        assert_eq!(
            quality_payload.value["metadata"]["quality_check"]["warning_rules"],
            json!(["freshness lag", "soft schema drift note"])
        );

        let checkpoint_write_node = WorkflowNode {
            node_id: "checkpoint_write".to_string(),
            type_id: "checkpoint_write".to_string(),
            definition_version: 1,
            label: None,
            config: json!({
                "checkpoint_table": "tables.ingest_checkpoints",
                "commit_source": "metadata.current_commit",
                "write_timing": "after_quality_gate",
                "only_persist_on_full_success": true,
                "advance_on_partial_success": false
            }),
            position: NodePosition::default(),
        };
        let mut checkpoint_inputs = PortValues::new();
        checkpoint_inputs.insert("table".to_string(), quality_payload.clone());
        let checkpoint_result = RuntimeAdapters::default()
            .execute(
                checkpoint_write_definition,
                &checkpoint_write_node,
                &checkpoint_inputs,
            )
            .expect("checkpoint write should succeed after quality check");

        let checkpoint_payload = checkpoint_result
            .outputs
            .get("table")
            .expect("checkpoint write table output should be present");
        assert_eq!(
            checkpoint_payload.value["metadata"]["checkpoint_write"]["write_timing"],
            json!("after_quality_gate")
        );
        assert_eq!(
            checkpoint_result.logs,
            vec![
                "Prepared checkpoint write to `tables.ingest_checkpoints` for `post-no-preference/earnings` on `main` at commit `a34ef9c` using `after_quality_gate`."
            ]
        );
    }

    #[test]
    fn text_transform_uppercases() {
        let registry = builtin_node_definitions();
        let definition = registry
            .iter()
            .find(|definition| definition.type_id == "text_transform")
            .expect("text_transform definition");
        let node = WorkflowNode {
            node_id: "transform".to_string(),
            type_id: "text_transform".to_string(),
            definition_version: 1,
            label: None,
            config: json!({ "operation": "uppercase" }),
            position: NodePosition::default(),
        };
        let mut inputs = PortValues::new();
        inputs.insert(
            "source".to_string(),
            workflow_schema::TypedValue::text("hello"),
        );

        let result = RuntimeAdapters::default()
            .execute(definition, &node, &inputs)
            .expect("transform should succeed");

        assert_eq!(
            result.outputs.get("text").and_then(|value| value.as_text()),
            Some("HELLO")
        );
    }

    #[test]
    fn send_email_accepts_config_only_body() {
        let registry = builtin_node_definitions();
        let definition = registry
            .iter()
            .find(|definition| definition.type_id == "send_email")
            .expect("send_email definition");
        let node = WorkflowNode {
            node_id: "notify".to_string(),
            type_id: "send_email".to_string(),
            definition_version: 1,
            label: None,
            config: json!({
                "to": "ops@stitchly.dev",
                "subject": "Failed refunds need review",
                "body_mode": "custom",
                "body_text": "Please inspect the latest sync."
            }),
            position: NodePosition::default(),
        };

        let result = RuntimeAdapters::default()
            .execute(definition, &node, &PortValues::new())
            .expect("send email should succeed");

        assert_eq!(result.outputs.len(), 0);
        assert_eq!(
            result.logs,
            vec!["Queued text/plain email via `default_mailer` to ops@stitchly.dev with subject `Failed refunds need review`: Please inspect the latest sync."]
        );
    }

    #[test]
    fn send_email_uses_upstream_input_body_when_requested() {
        let registry = builtin_node_definitions();
        let definition = registry
            .iter()
            .find(|definition| definition.type_id == "send_email")
            .expect("send_email definition");
        let node = WorkflowNode {
            node_id: "notify".to_string(),
            type_id: "send_email".to_string(),
            definition_version: 1,
            label: None,
            config: json!({
                "to": "ops@stitchly.dev",
                "subject": "Failed refunds need review",
                "body_mode": "input",
                "body_text": "fallback body"
            }),
            position: NodePosition::default(),
        };
        let mut inputs = PortValues::new();
        inputs.insert(
            "body".to_string(),
            workflow_schema::TypedValue::text("Upstream message"),
        );

        let result = RuntimeAdapters::default()
            .execute(definition, &node, &inputs)
            .expect("send email should succeed");

        assert_eq!(
            result.logs,
            vec!["Queued text/plain email via `default_mailer` to ops@stitchly.dev with subject `Failed refunds need review`: Upstream message"]
        );
    }

    #[test]
    fn table_output_accepts_text_input_and_emits_write_summary() {
        let registry = builtin_node_definitions();
        let definition = registry
            .iter()
            .find(|definition| definition.type_id == "table_output")
            .expect("table_output definition");
        let node = WorkflowNode {
            node_id: "table_output_digest".to_string(),
            type_id: "table_output".to_string(),
            definition_version: 1,
            label: None,
            config: json!({
                "target_schema": "outputs",
                "table_name": "news_brief",
                "write_mode": "append",
                "input_shape": "single_text_row",
                "value_column": "content",
                "include_run_id": true,
                "include_written_at": true
            }),
            position: NodePosition::default(),
        };
        let mut inputs = PortValues::new();
        inputs.insert(
            "text".to_string(),
            workflow_schema::TypedValue::text("Latest market digest"),
        );

        let result = RuntimeAdapters::default()
            .execute(definition, &node, &inputs)
            .expect("table output should succeed");

        let payload = result
            .outputs
            .get("write_result")
            .expect("table output payload should be present");
        assert_eq!(payload.data_type, workflow_schema::DataType::Json);
        assert_eq!(
            payload.value,
            json!({
                "kind": "table_output_write",
                "target_schema": "outputs",
                "table_name": "news_brief",
                "write_mode": "append",
                "input_shape": "single_text_row",
                "value_column": "content",
                "include_run_id": true,
                "include_written_at": true,
                "open_in_catalog": false,
                "value_text": "Latest market digest"
            })
        );
        assert_eq!(
            result.logs,
            vec!["Prepared append write to `outputs.news_brief` using `content` from single text row (20 chars; metadata columns: run_id, written_at)."]
        );
    }

    #[test]
    fn table_input_emits_table_reference_output() {
        let registry = builtin_node_definitions();
        let definition = registry
            .iter()
            .find(|definition| definition.type_id == "table_input")
            .expect("table_input definition");
        let node = WorkflowNode {
            node_id: "table_input_workflow_runs".to_string(),
            type_id: "table_input".to_string(),
            definition_version: 1,
            label: None,
            config: json!({
                "catalog": "workflow.duckdb",
                "schema_name": "runs",
                "table_name": "workflow_runs",
                "output_alias": "workflow_runs",
                "selected_columns": ["workflow_id", "status"],
                "row_filter": "status = 'succeeded'",
                "row_limit": 100
            }),
            position: NodePosition::default(),
        };

        let result = RuntimeAdapters::default()
            .execute(definition, &node, &PortValues::new())
            .expect("table input should succeed");

        let payload = result
            .outputs
            .get("table")
            .expect("table output payload should be present");
        assert_eq!(payload.data_type, workflow_schema::DataType::TableRef);
        assert_eq!(
            payload.value,
            json!({
                "kind": "table_reference",
                "catalog": "workflow.duckdb",
                "schema_name": "runs",
                "table_name": "workflow_runs",
                "output_alias": "workflow_runs",
                "selected_columns": ["workflow_id", "status"],
                "row_filter": "status = 'succeeded'",
                "row_limit": 100,
                "refresh_schema": true,
                "open_in_catalog": false
            })
        );
    }

    #[test]
    fn table_schema_emits_table_reference_output() {
        let registry = builtin_node_definitions();
        let definition = registry
            .iter()
            .find(|definition| definition.type_id == "table_schema")
            .expect("table_schema definition");
        let node = WorkflowNode {
            node_id: "table_schema_orders".to_string(),
            type_id: "table_schema".to_string(),
            definition_version: 1,
            label: None,
            config: json!({
                "catalog": "workflow.duckdb",
                "schema_name": "output",
                "table_name": "orders",
                "output_alias": "orders_definition",
                "columns": [
                    {
                        "name": "order_id",
                        "type": "bigint",
                        "nullable": false,
                        "primary_key": true
                    },
                    {
                        "name": "customer_id",
                        "type": "varchar",
                        "nullable": false,
                        "primary_key": false
                    }
                ],
                "primary_key": ["order_id"],
                "checks": ["order_id > 0"],
                "create_mode": "create_if_missing",
                "if_target_exists": "keep_existing"
            }),
            position: NodePosition::default(),
        };

        let result = RuntimeAdapters::default()
            .execute(definition, &node, &PortValues::new())
            .expect("table schema should succeed");

        let payload = result
            .outputs
            .get("table")
            .expect("table schema payload should be present");
        assert_eq!(payload.data_type, workflow_schema::DataType::TableRef);
        assert_eq!(
            payload.value,
            json!({
                "kind": "table_reference",
                "catalog": "workflow.duckdb",
                "schema_name": "output",
                "table_name": "orders",
                "output_alias": "orders_definition",
                "selected_columns": [],
                "row_filter": null,
                "row_limit": null,
                "refresh_schema": true,
                "open_in_catalog": false,
                "schema_definition": {
                    "columns": [
                        {
                            "name": "order_id",
                            "type": "bigint",
                            "nullable": false,
                            "primary_key": true,
                            "default": null
                        },
                        {
                            "name": "customer_id",
                            "type": "varchar",
                            "nullable": false,
                            "primary_key": false,
                            "default": null
                        }
                    ],
                    "primary_key": ["order_id"],
                    "checks": ["order_id > 0"],
                    "create_mode": "create_if_missing",
                    "if_target_exists": "keep_existing"
                },
                "schema_definitions": null
            })
        );
    }

    #[test]
    fn table_schema_emits_schema_bundle_for_multiple_tables() {
        let registry = builtin_node_definitions();
        let definition = registry
            .iter()
            .find(|definition| definition.type_id == "table_schema")
            .expect("table_schema definition");
        let node = WorkflowNode {
            node_id: "table_schema_bundle".to_string(),
            type_id: "table_schema".to_string(),
            definition_version: 1,
            label: None,
            config: json!({
                "catalog": "workflow.duckdb",
                "schema_name": "tables",
                "table_name": "orders",
                "output_alias": "orders_definition",
                "columns": [
                    {
                        "name": "order_id",
                        "type": "bigint",
                        "nullable": false,
                        "primary_key": true
                    }
                ],
                "primary_key": ["order_id"],
                "checks": [],
                "create_mode": "create_if_missing",
                "if_target_exists": "keep_existing",
                "tables": [
                    {
                        "schema_name": "tables",
                        "table_name": "orders",
                        "output_alias": "orders_definition",
                        "columns": [
                            {
                                "name": "order_id",
                                "type": "bigint",
                                "nullable": false,
                                "primary_key": true
                            }
                        ],
                        "primary_key": ["order_id"],
                        "checks": [],
                        "create_mode": "create_if_missing",
                        "if_target_exists": "keep_existing"
                    },
                    {
                        "schema_name": "tables",
                        "table_name": "order_lines",
                        "output_alias": "order_lines_definition",
                        "columns": [
                            {
                                "name": "line_id",
                                "type": "bigint",
                                "nullable": false,
                                "primary_key": true
                            },
                            {
                                "name": "order_id",
                                "type": "bigint",
                                "nullable": false,
                                "primary_key": false
                            }
                        ],
                        "primary_key": ["line_id"],
                        "checks": [],
                        "create_mode": "create_if_missing",
                        "if_target_exists": "keep_existing"
                    }
                ]
            }),
            position: NodePosition::default(),
        };

        let result = RuntimeAdapters::default()
            .execute(definition, &node, &PortValues::new())
            .expect("table schema bundle should succeed");

        let payload = result
            .outputs
            .get("table")
            .expect("table schema payload should be present");

        assert_eq!(payload.data_type, workflow_schema::DataType::TableRef);
        assert_eq!(
            payload
                .value
                .get("schema_definitions")
                .and_then(Value::as_array)
                .map(Vec::len),
            Some(2)
        );
        assert_eq!(
            payload.value["schema_definitions"][0]["table_name"],
            json!("orders")
        );
        assert_eq!(
            payload.value["schema_definitions"][1]["table_name"],
            json!("order_lines")
        );
    }

    #[test]
    fn table_output_accepts_table_reference_input_and_emits_copy_summary() {
        let registry = builtin_node_definitions();
        let definition = registry
            .iter()
            .find(|definition| definition.type_id == "table_output")
            .expect("table_output definition");
        let node = WorkflowNode {
            node_id: "table_output_digest".to_string(),
            type_id: "table_output".to_string(),
            definition_version: 1,
            label: None,
            config: json!({
                "target_schema": "tables",
                "table_name": "workflow_runs_copy",
                "write_mode": "replace",
                "input_shape": "source_table",
                "include_run_id": true,
                "include_written_at": true
            }),
            position: NodePosition::default(),
        };
        let mut inputs = PortValues::new();
        inputs.insert(
            "text".to_string(),
            TypedValue {
                data_type: DataType::TableRef,
                value: json!({
                    "kind": "table_reference",
                    "catalog": "workflow.duckdb",
                    "schema_name": "runs",
                    "table_name": "workflow_runs",
                    "output_alias": "workflow_runs",
                    "selected_columns": ["workflow_id", "status"],
                    "row_filter": "status = 'succeeded'",
                    "row_limit": 10,
                    "refresh_schema": true,
                    "open_in_catalog": false
                }),
            },
        );

        let result = RuntimeAdapters::default()
            .execute(definition, &node, &inputs)
            .expect("table output should succeed");

        let payload = result
            .outputs
            .get("write_result")
            .expect("table output payload should be present");
        assert_eq!(payload.data_type, workflow_schema::DataType::Json);
        assert_eq!(
            payload.value,
            json!({
                "kind": "table_output_write",
                "target_schema": "tables",
                "table_name": "workflow_runs_copy",
                "write_mode": "replace",
                "input_shape": "source_table",
                "value_column": "content",
                "include_run_id": true,
                "include_written_at": true,
                "open_in_catalog": false,
                "schema_definition": null,
                "schema_definitions": null,
                "source_table": {
                    "catalog": "workflow.duckdb",
                    "schema_name": "runs",
                    "table_name": "workflow_runs",
                    "output_alias": "workflow_runs",
                    "selected_columns": ["workflow_id", "status"],
                    "row_filter": "status = 'succeeded'",
                    "row_limit": 10
                }
            })
        );
    }

    #[test]
    fn table_output_accepts_table_schema_input_and_emits_schema_bootstrap_payload() {
        let registry = builtin_node_definitions();
        let definition = registry
            .iter()
            .find(|definition| definition.type_id == "table_output")
            .expect("table_output definition");
        let node = WorkflowNode {
            node_id: "table_output_schema".to_string(),
            type_id: "table_output".to_string(),
            definition_version: 1,
            label: None,
            config: json!({
                "target_schema": "tables",
                "table_name": "orders_bootstrap",
                "write_mode": "replace",
                "input_shape": "table_schema",
                "include_run_id": true,
                "include_written_at": true
            }),
            position: NodePosition::default(),
        };
        let mut inputs = PortValues::new();
        inputs.insert(
            "text".to_string(),
            TypedValue {
                data_type: DataType::TableRef,
                value: json!({
                    "kind": "table_reference",
                    "catalog": "workflow.duckdb",
                    "schema_name": "output",
                    "table_name": "orders",
                    "output_alias": "orders_definition",
                    "selected_columns": [],
                    "row_filter": null,
                    "row_limit": null,
                    "refresh_schema": true,
                    "open_in_catalog": false,
                    "schema_definition": {
                        "columns": [
                            {
                                "name": "order_id",
                                "type": "bigint",
                                "nullable": false,
                                "primary_key": true,
                                "default": null
                            },
                            {
                                "name": "customer_id",
                                "type": "varchar",
                                "nullable": false,
                                "primary_key": false,
                                "default": "'unknown'"
                            }
                        ],
                        "primary_key": ["order_id"],
                        "checks": ["order_id > 0"],
                        "create_mode": "create_if_missing",
                        "if_target_exists": "keep_existing"
                    }
                }),
            },
        );

        let result = RuntimeAdapters::default()
            .execute(definition, &node, &inputs)
            .expect("table output should succeed");

        let payload = result
            .outputs
            .get("write_result")
            .expect("table output payload should be present");
        assert_eq!(payload.data_type, workflow_schema::DataType::Json);
        assert_eq!(
            payload.value,
            json!({
                "kind": "table_output_write",
                "target_schema": "tables",
                "table_name": "orders",
                "write_mode": "replace",
                "input_shape": "table_schema",
                "value_column": "content",
                "include_run_id": true,
                "include_written_at": true,
                "open_in_catalog": false,
                "schema_definition": {
                    "columns": [
                        {
                            "name": "order_id",
                            "type": "bigint",
                            "nullable": false,
                            "primary_key": true,
                            "default": null
                        },
                        {
                            "name": "customer_id",
                            "type": "varchar",
                            "nullable": false,
                            "primary_key": false,
                            "default": "'unknown'"
                        }
                    ],
                    "primary_key": ["order_id"],
                    "checks": ["order_id > 0"],
                    "create_mode": "create_if_missing",
                    "if_target_exists": "keep_existing"
                },
                "schema_definitions": null,
                "source_table": {
                    "catalog": "workflow.duckdb",
                    "schema_name": "output",
                    "table_name": "orders",
                    "output_alias": "orders_definition",
                    "selected_columns": [],
                    "row_filter": null,
                    "row_limit": null
                }
            })
        );
    }

    #[test]
    fn table_output_accepts_multi_table_schema_input_and_emits_schema_bundle_payload() {
        let registry = builtin_node_definitions();
        let definition = registry
            .iter()
            .find(|definition| definition.type_id == "table_output")
            .expect("table_output definition");
        let node = WorkflowNode {
            node_id: "table_output_schema_bundle".to_string(),
            type_id: "table_output".to_string(),
            definition_version: 1,
            label: None,
            config: json!({
                "target_schema": "tables",
                "table_name": "ignored_target",
                "write_mode": "replace",
                "input_shape": "table_schema",
                "include_run_id": true,
                "include_written_at": true
            }),
            position: NodePosition::default(),
        };
        let mut inputs = PortValues::new();
        inputs.insert(
            "text".to_string(),
            TypedValue {
                data_type: DataType::TableRef,
                value: json!({
                    "kind": "table_reference",
                    "catalog": "workflow.duckdb",
                    "schema_name": "tables",
                    "table_name": "orders",
                    "output_alias": "orders_definition",
                    "selected_columns": [],
                    "row_filter": null,
                    "row_limit": null,
                    "refresh_schema": true,
                    "open_in_catalog": false,
                    "schema_definition": {
                        "columns": [
                            {
                                "name": "order_id",
                                "type": "bigint",
                                "nullable": false,
                                "primary_key": true,
                                "default": null
                            }
                        ],
                        "primary_key": ["order_id"],
                        "checks": [],
                        "create_mode": "create_if_missing",
                        "if_target_exists": "keep_existing"
                    },
                    "schema_definitions": [
                        {
                            "schema_name": "tables",
                            "table_name": "orders",
                            "output_alias": "orders_definition",
                            "columns": [
                                {
                                    "name": "order_id",
                                    "type": "bigint",
                                    "nullable": false,
                                    "primary_key": true,
                                    "default": null
                                }
                            ],
                            "primary_key": ["order_id"],
                            "checks": [],
                            "create_mode": "create_if_missing",
                            "if_target_exists": "keep_existing"
                        },
                        {
                            "schema_name": "tables",
                            "table_name": "order_lines",
                            "output_alias": "order_lines_definition",
                            "columns": [
                                {
                                    "name": "line_id",
                                    "type": "bigint",
                                    "nullable": false,
                                    "primary_key": true,
                                    "default": null
                                },
                                {
                                    "name": "order_id",
                                    "type": "bigint",
                                    "nullable": false,
                                    "primary_key": false,
                                    "default": null
                                }
                            ],
                            "primary_key": ["line_id"],
                            "checks": [],
                            "create_mode": "create_if_missing",
                            "if_target_exists": "keep_existing"
                        }
                    ]
                }),
            },
        );

        let result = RuntimeAdapters::default()
            .execute(definition, &node, &inputs)
            .expect("table output schema bundle should succeed");

        let payload = result
            .outputs
            .get("write_result")
            .expect("table output payload should be present");

        assert_eq!(payload.data_type, workflow_schema::DataType::Json);
        assert_eq!(payload.value["input_shape"], json!("table_schema"));
        assert_eq!(payload.value["table_name"], json!("orders"));
        assert_eq!(
            payload
                .value
                .get("schema_definitions")
                .and_then(Value::as_array)
                .map(Vec::len),
            Some(2)
        );
        assert_eq!(
            payload.value["schema_definitions"][1]["table_name"],
            json!("order_lines")
        );
    }

    #[test]
    fn text_input_respects_trim_and_whitespace_settings() {
        let registry = builtin_node_definitions();
        let definition = registry
            .iter()
            .find(|definition| definition.type_id == "text_input")
            .expect("text_input definition");
        let node = WorkflowNode {
            node_id: "text".to_string(),
            type_id: "text_input".to_string(),
            definition_version: 1,
            label: None,
            config: json!({
                "text": "  hello  \nworld  ",
                "include_line_breaks": false,
                "preserve_whitespace": false,
                "trim_mode": "trim"
            }),
            position: NodePosition::default(),
        };

        let result = RuntimeAdapters::default()
            .execute(definition, &node, &PortValues::new())
            .expect("text input should succeed");

        assert_eq!(
            result.outputs.get("text").and_then(|value| value.as_text()),
            Some("hello world")
        );
    }

    #[test]
    fn gmail_mime_message_contains_expected_headers_and_body() {
        let message = build_gmail_mime_message(
            "ops@gmail.com",
            "alerts@stitchly.dev",
            "Workflow alert",
            "Body text",
            "text/plain",
        )
        .expect("mime message");

        assert!(message.contains("From: ops@gmail.com\r\n"));
        assert!(message.contains("To: alerts@stitchly.dev\r\n"));
        assert!(message.contains("Subject: Workflow alert\r\n"));
        assert!(message.contains("Content-Type: text/plain; charset=UTF-8\r\n\r\nBody text"));
    }

    #[test]
    fn gmail_mime_message_rejects_header_injection() {
        let result = build_gmail_mime_message(
            "ops@gmail.com",
            "alerts@stitchly.dev\r\nBcc: hidden@example.com",
            "Workflow alert",
            "Body text",
            "text/plain",
        );

        assert!(result.is_err());
    }

    #[test]
    fn gmail_message_body_can_be_base64url_encoded() {
        let message = build_gmail_mime_message(
            "ops@gmail.com",
            "alerts@stitchly.dev",
            "Workflow alert",
            "Body text",
            "text/plain",
        )
        .expect("mime message");

        let encoded = URL_SAFE_NO_PAD.encode(message.as_bytes());
        assert!(!encoded.is_empty());
        assert!(!encoded.contains('+'));
        assert!(!encoded.contains('/'));
    }

    #[test]
    fn dolt_home_dir_path_prefers_state_dir() {
        let path = build_dolt_home_dir_path(
            Some(Path::new("/tmp/stitchly-state")),
            Some(Path::new("/workspace")),
        );

        assert_eq!(
            path,
            Some(PathBuf::from("/tmp/stitchly-state/tooling/dolt-home"))
        );
    }

    #[test]
    fn dolt_home_dir_path_falls_back_to_workspace_state_dir() {
        let path = build_dolt_home_dir_path(None, Some(Path::new("/workspace")));

        assert_eq!(
            path,
            Some(PathBuf::from("/workspace/.stitchly/tooling/dolt-home"))
        );
    }
}
