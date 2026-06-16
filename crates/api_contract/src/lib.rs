use chrono::{DateTime, Utc};
use node_registry::NodeDefinition;
use serde::{Deserialize, Serialize};
#[allow(unused_imports)]
use serde_json::json;
use serde_json::{Map, Value};
use utoipa::ToSchema;
use workflow_schema::{TypedValue, WorkflowDefinition};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum IssueSeverity {
    Error,
    Warning,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct ValidationIssue {
    pub code: String,
    pub message: String,
    pub severity: IssueSeverity,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct ValidateWorkflowRequest {
    pub workflow: WorkflowDefinition,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct ValidateWorkflowResponse {
    pub valid: bool,
    #[serde(default)]
    pub errors: Vec<ValidationIssue>,
    #[serde(default)]
    pub warnings: Vec<ValidationIssue>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct RunTrigger {
    pub kind: TriggerKind,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum TriggerKind {
    #[default]
    Manual,
    Schedule,
    Event,
    Backfill,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RunStatus {
    Created,
    Queued,
    Planning,
    Running,
    Succeeded,
    Failed,
    Cancelling,
    Cancelled,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum NodeRunStatus {
    Pending,
    Ready,
    Running,
    Succeeded,
    Failed,
    Skipped,
    Cancelling,
    Cancelled,
    Retrying,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum LogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RunErrorCategory {
    ValidationError,
    PlanningError,
    AdapterResolutionError,
    ConnectionError,
    ExecutionError,
    Timeout,
    Cancellation,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct RunErrorSummary {
    pub category: RunErrorCategory,
    pub message: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct RunLogEntry {
    pub timestamp: DateTime<Utc>,
    pub level: LogLevel,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub node_id: Option<String>,
    pub message: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct NodeRunSnapshot {
    pub node_id: String,
    pub type_id: String,
    pub status: NodeRunStatus,
    pub attempt: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub started_at: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_output: Option<TypedValue>,
    #[serde(default)]
    pub log_count: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<RunErrorSummary>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct RunSnapshot {
    pub run_id: String,
    pub workflow_id: String,
    pub workflow_version: u32,
    pub status: RunStatus,
    pub trigger: RunTrigger,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub started_at: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub node_runs: Vec<NodeRunSnapshot>,
    #[serde(default)]
    pub logs: Vec<RunLogEntry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<RunErrorSummary>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct CreateRunRequest {
    pub workflow: WorkflowDefinition,
    #[serde(default)]
    pub trigger: RunTrigger,
    #[serde(default)]
    pub params: Map<String, Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct CreateRunResponse {
    pub run_id: String,
    pub status: RunStatus,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum EventTargetKind {
    Run,
    Node,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct EventTarget {
    pub kind: EventTargetKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub node_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RunEventType {
    RunCreated,
    PlanningStarted,
    PlanningFinished,
    RunStatusChanged,
    NodeStarted,
    NodeLog,
    NodeFinished,
    RunSucceeded,
    RunFailed,
    CancellationRequested,
    RunCancelled,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct RunEvent {
    pub event_id: String,
    pub run_id: String,
    pub sequence: u64,
    pub timestamp: DateTime<Utc>,
    pub event_type: RunEventType,
    pub target: EventTarget,
    pub payload: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct NodeDefinitionsResponse {
    pub node_definitions: Vec<NodeDefinition>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct ConnectionSummary {
    pub connection_id: String,
    pub connection_kind: String,
    pub display_name: String,
    #[serde(default)]
    pub config: Value,
    #[serde(default)]
    pub capabilities: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct ConnectionsResponse {
    pub connections: Vec<ConnectionSummary>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum TestingDiagnosticStatus {
    Ok,
    Warn,
    Error,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
pub struct TestingDiagnosticCheck {
    pub key: String,
    pub label: String,
    pub status: TestingDiagnosticStatus,
    pub detail: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
pub struct DoltDiagnosticsResponse {
    pub installed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub executable_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stitchly_dolt_home: Option<String>,
    #[serde(default)]
    pub diagnostics: Vec<TestingDiagnosticCheck>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum TestingDoltDumpOutputFormat {
    Csv,
    #[default]
    Parquet,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum TestingDoltDumpTableSelectionMode {
    PreferManifestScope,
    #[default]
    AllTables,
    ManualTables,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, ToSchema)]
#[schema(example = json!({
    "repo": "post-no-preference/rates",
    "branch": "master",
    "output_format": "parquet",
    "table_selection_mode": "all_tables",
    "selected_tables": [],
    "persist_bundle": true,
    "timeout_seconds": 60
}))]
pub struct TestingDoltRepoDumpRequest {
    pub repo: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(default)]
    pub output_format: TestingDoltDumpOutputFormat,
    #[serde(default)]
    pub table_selection_mode: TestingDoltRepoDumpTableSelectionMode,
    #[serde(default)]
    pub selected_tables: Vec<String>,
    #[serde(default)]
    pub persist_bundle: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout_seconds: Option<u64>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum TestingDoltRepoDumpTableSelectionMode {
    #[default]
    AllTables,
    ManualTables,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, ToSchema)]
#[schema(example = json!({
    "run_id": "run_a1b2c3d4e5f6",
    "completed": true,
    "timed_out": false,
    "workflow_root": ".stitchly/testing/dolt_repo_dump/demo",
    "workflow_duckdb_path": ".stitchly/testing/dolt_repo_dump/demo/db/workflow.duckdb",
    "bundle_output": {
        "data_type": "directory_ref",
        "value": {
            "kind": "dolt_dump_bundle",
            "directory_ref": {
                "path": "artifacts/dolt_dump/rates/48puq5af61vq4d92l68du7bee0tu9u0v/parquet",
                "format": "parquet"
            },
            "manifest_ref": {
                "kind": "dolt_dump_table_manifest_ref",
                "bundle_path": "artifacts/dolt_dump/rates/48puq5af61vq4d92l68du7bee0tu9u0v/parquet",
                "file_format": "parquet",
                "table_count": 1
            },
            "table_manifest": {
                "kind": "dolt_dump_table_manifest",
                "manifest_ref": {
                    "bundle_path": "artifacts/dolt_dump/rates/48puq5af61vq4d92l68du7bee0tu9u0v/parquet",
                    "file_format": "parquet",
                    "table_count": 1
                },
                "tables": [
                    {
                        "source_table": "us_treasury",
                        "file_path": "artifacts/dolt_dump/rates/48puq5af61vq4d92l68du7bee0tu9u0v/parquet/us_treasury.parquet",
                        "row_count": null
                    }
                ]
            },
            "repo_ref": {
                "connection_ref": "dolthub_public",
                "repository": "post-no-preference/rates",
                "branch": "master",
                "checkout_ref": null,
                "current_commit": "48puq5af61vq4d92l68du7bee0tu9u0v"
            },
            "metadata": {
                "repo_family": "rates",
                "current_commit": "48puq5af61vq4d92l68du7bee0tu9u0v",
                "table_selection_mode": "all_tables",
                "exported_tables": [
                    {
                        "source_table": "us_treasury",
                        "file_path": "artifacts/dolt_dump/rates/48puq5af61vq4d92l68du7bee0tu9u0v/parquet/us_treasury.parquet",
                        "row_count": null
                    }
                ]
            }
        }
    },
    "snapshot": {
        "run_id": "run_a1b2c3d4e5f6",
        "workflow_id": "wf_testing_dolt_repo_dump_abc123",
        "workflow_version": 1,
        "status": "succeeded",
        "trigger": {
            "kind": "manual"
        },
        "started_at": "2026-06-10T13:41:17.931Z",
        "finished_at": "2026-06-10T13:41:18.500Z",
        "node_runs": [],
        "logs": [],
        "error": null
    }
}))]
pub struct TestingDoltRepoDumpResponse {
    pub run_id: String,
    pub completed: bool,
    pub timed_out: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workflow_root: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workflow_duckdb_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bundle_output: Option<TypedValue>,
    pub snapshot: RunSnapshot,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, ToSchema)]
#[schema(example = json!({
    "repository": "post-no-preference/rates",
    "connection_ref": "dolthub_public",
    "branch": "main",
    "output_format": "parquet",
    "table_selection_mode": "all_tables",
    "selected_tables": [],
    "persist_bundle": false,
    "timeout_seconds": 30
}))]
pub struct TestingDoltDumpRequest {
    pub repository: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connection_ref: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checkout_ref: Option<String>,
    #[serde(default)]
    pub output_format: TestingDoltDumpOutputFormat,
    #[serde(default)]
    pub table_selection_mode: TestingDoltDumpTableSelectionMode,
    #[serde(default)]
    pub selected_tables: Vec<String>,
    #[serde(default)]
    pub persist_bundle: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout_seconds: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, ToSchema)]
#[schema(example = json!({
    "run_id": "run_a1b2c3d4e5f6",
    "completed": true,
    "timed_out": false,
    "workflow_root": null,
    "workflow_duckdb_path": null,
    "bundle_output": {
        "data_type": "directory_ref",
        "value": {
            "kind": "dolt_dump_bundle",
            "directory_ref": {
                "path": "artifacts/dolt_dump/rates/d0f61b4/parquet",
                "format": "parquet"
            },
            "manifest_ref": {
                "kind": "dolt_dump_table_manifest_ref",
                "bundle_path": "artifacts/dolt_dump/rates/d0f61b4/parquet",
                "file_format": "parquet",
                "table_count": 1
            },
            "table_manifest": {
                "kind": "dolt_dump_table_manifest",
                "manifest_ref": {
                    "bundle_path": "artifacts/dolt_dump/rates/d0f61b4/parquet",
                    "file_format": "parquet",
                    "table_count": 1
                },
                "tables": [
                    {
                        "source_table": "us_treasury",
                        "file_path": "artifacts/dolt_dump/rates/d0f61b4/parquet/us_treasury.parquet",
                        "row_count": null
                    }
                ]
            },
            "repo_ref": {
                "connection_ref": "dolthub_public",
                "repository": "post-no-preference/rates",
                "branch": "main",
                "checkout_ref": null,
                "current_commit": "d0f61b4"
            },
            "metadata": {
                "repo_family": "rates",
                "current_commit": "d0f61b4",
                "table_selection_mode": "all_tables",
                "exported_tables": [
                    {
                        "source_table": "us_treasury",
                        "file_path": "artifacts/dolt_dump/rates/d0f61b4/parquet/us_treasury.parquet",
                        "row_count": null
                    }
                ]
            }
        }
    },
    "snapshot": {
        "run_id": "run_a1b2c3d4e5f6",
        "workflow_id": "wf_testing_dolt_dump_abc123",
        "workflow_version": 1,
        "status": "succeeded",
        "trigger": {
            "kind": "manual"
        },
        "started_at": "2026-06-10T13:41:17.931Z",
        "finished_at": "2026-06-10T13:41:18.500Z",
        "node_runs": [
            {
                "node_id": "dolt_repo_source",
                "type_id": "dolt_repo_source",
                "status": "succeeded",
                "attempt": 1,
                "started_at": "2026-06-10T13:41:17.940Z",
                "finished_at": "2026-06-10T13:41:18.020Z",
                "last_output": {
                    "data_type": "dataset_ref",
                    "value": {
                        "kind": "dolt_repo_dataset"
                    }
                },
                "log_count": 1,
                "error": null
            },
            {
                "node_id": "dolt_dump",
                "type_id": "dolt_dump",
                "status": "succeeded",
                "attempt": 1,
                "started_at": "2026-06-10T13:41:18.025Z",
                "finished_at": "2026-06-10T13:41:18.500Z",
                "last_output": {
                    "data_type": "directory_ref",
                    "value": {
                        "kind": "dolt_dump_bundle"
                    }
                },
                "log_count": 1,
                "error": null
            }
        ],
        "logs": [
            {
                "timestamp": "2026-06-10T13:41:18.500Z",
                "level": "info",
                "node_id": "dolt_dump",
                "message": "Prepared dolt dump bundle for post-no-preference/rates."
            }
        ],
        "error": null
    }
}))]
pub struct TestingDoltDumpResponse {
    pub run_id: String,
    pub completed: bool,
    pub timed_out: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workflow_root: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workflow_duckdb_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bundle_output: Option<TypedValue>,
    pub snapshot: RunSnapshot,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[schema(example = json!({
    "repo": "post-no-preference/rates",
    "branch": "master"
}))]
pub struct TestingDoltRepoRequest {
    pub repo: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct TestingDoltRepoResponse {
    pub run_id: String,
    pub completed: bool,
    pub timed_out: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workflow_root: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workflow_duckdb_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo_output: Option<TypedValue>,
    pub snapshot: RunSnapshot,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, ToSchema)]
#[schema(example = json!({
    "repository": "post-no-preference/rates",
    "connection_ref": "dolthub_public",
    "branch": "main",
    "output_format": "parquet",
    "table_selection_mode": "all_tables",
    "selected_tables": [],
    "target_schema": "staging",
    "seed_export_root": "/tmp/stitchly-dolt-seeds",
    "timeout_seconds": 30
}))]
pub struct TestingDoltDumpLoadRequest {
    pub repository: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connection_ref: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checkout_ref: Option<String>,
    #[serde(default)]
    pub output_format: TestingDoltDumpOutputFormat,
    #[serde(default)]
    pub table_selection_mode: TestingDoltDumpTableSelectionMode,
    #[serde(default)]
    pub selected_tables: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_schema: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seed_export_root: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout_seconds: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
pub struct TestingLoadedTableCount {
    pub source_table: String,
    pub target_schema: String,
    pub target_table: String,
    pub row_count: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, ToSchema)]
#[schema(example = json!({
    "run_id": "run_0f1e2d3c4b5a",
    "completed": true,
    "timed_out": false,
    "workflow_root": ".stitchly/testing/dolt_dump_load/demo",
    "workflow_duckdb_path": ".stitchly/testing/dolt_dump_load/demo/db/workflow.duckdb",
    "bundle_output": {
        "data_type": "directory_ref",
        "value": {
            "kind": "dolt_dump_bundle"
        }
    },
    "table_output": {
        "data_type": "table_ref",
        "value": {
            "kind": "table_reference",
            "schema_name": "staging",
            "table_name": "rates__us_treasury__snapshot"
        }
    },
    "loaded_table_counts": [
        {
            "source_table": "us_treasury",
            "target_schema": "staging",
            "target_table": "rates__us_treasury__snapshot",
            "row_count": 2
        }
    ],
    "snapshot": {
        "run_id": "run_0f1e2d3c4b5a",
        "workflow_id": "wf_testing_dolt_dump_load_abc123",
        "workflow_version": 1,
        "status": "succeeded",
        "trigger": {
            "kind": "manual"
        },
        "started_at": "2026-06-10T13:41:17.931Z",
        "finished_at": "2026-06-10T13:41:18.500Z",
        "node_runs": [],
        "logs": [],
        "error": null
    }
}))]
pub struct TestingDoltDumpLoadResponse {
    pub run_id: String,
    pub completed: bool,
    pub timed_out: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workflow_root: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workflow_duckdb_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bundle_output: Option<TypedValue>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub table_output: Option<TypedValue>,
    #[serde(default)]
    pub loaded_table_counts: Vec<TestingLoadedTableCount>,
    pub snapshot: RunSnapshot,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct WorkspaceConnectionSummary {
    pub workspace_id: String,
    pub connection_id: String,
    pub connection_kind: String,
    pub display_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth_scheme: Option<String>,
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub external_account_label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub external_account_id: Option<String>,
    #[serde(default)]
    pub capabilities: Value,
    #[serde(default)]
    pub scopes: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_error_message: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct WorkspaceConnectionsResponse {
    #[serde(default)]
    pub connections: Vec<WorkspaceConnectionSummary>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct WorkspaceConnectionResponse {
    pub connection: WorkspaceConnectionSummary,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceMembershipRole {
    Owner,
    Editor,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
pub struct SessionUserSummary {
    pub user_id: String,
    pub email: String,
    pub display_name: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
pub struct WorkspaceSummary {
    pub workspace_id: String,
    pub slug: String,
    pub name: String,
    pub role: WorkspaceMembershipRole,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
pub struct AuthSessionResponse {
    pub authenticated: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user: Option<SessionUserSummary>,
    #[serde(default)]
    pub workspaces: Vec<WorkspaceSummary>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_workspace_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
pub struct GoogleAuthCodeRequest {
    pub code: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
pub struct CreateWorkspaceRequest {
    pub name: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
pub struct WorkspaceListResponse {
    #[serde(default)]
    pub workspaces: Vec<WorkspaceSummary>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_workspace_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
pub struct WorkspaceResponse {
    pub workspace: WorkspaceSummary,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
pub struct DeleteWorkspaceResponse {
    pub workspace_id: String,
    pub deleted: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct WorkflowSummary {
    pub workflow_id: String,
    pub workspace_id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub version: u32,
    pub updated_at: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct WorkflowListResponse {
    #[serde(default)]
    pub workflows: Vec<WorkflowSummary>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct WorkflowResponse {
    pub workflow: WorkflowSummary,
    pub definition: WorkflowDefinition,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
pub struct WorkflowStateResponse {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_opened_workflow_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
pub struct WorkspaceCatalogTableSummary {
    pub table_name: String,
    pub table_type: String,
    pub column_count: u32,
    #[serde(default)]
    pub is_deletable: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub protected_reason: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
pub struct WorkspaceCatalogSchemaSummary {
    pub schema_name: String,
    pub table_count: u32,
    #[serde(default)]
    pub tables: Vec<WorkspaceCatalogTableSummary>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
pub struct WorkspaceCatalogDatabaseSummary {
    pub workflow_id: String,
    pub workflow_name: String,
    pub database_name: String,
    #[serde(default)]
    pub schemas: Vec<WorkspaceCatalogSchemaSummary>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
pub struct WorkspaceCatalogResponse {
    #[serde(default)]
    pub catalogs: Vec<WorkspaceCatalogDatabaseSummary>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
pub struct WorkspaceCatalogSchemaResponse {
    pub workflow_id: String,
    pub workflow_name: String,
    pub database_name: String,
    pub schema_name: String,
    #[serde(default)]
    pub tables: Vec<WorkspaceCatalogTableSummary>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
pub struct WorkspaceCatalogColumnSummary {
    pub column_name: String,
    pub data_type: String,
    pub nullable: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
pub struct WorkspaceCatalogTableResponse {
    pub workflow_id: String,
    pub workflow_name: String,
    pub database_name: String,
    pub schema_name: String,
    pub table_name: String,
    #[serde(default)]
    pub is_deletable: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub protected_reason: Option<String>,
    #[serde(default)]
    pub columns: Vec<WorkspaceCatalogColumnSummary>,
    #[serde(default)]
    pub sample_rows: Vec<Vec<Option<String>>>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
pub struct WorkspaceCatalogTableUsageNode {
    pub node_id: String,
    pub node_type: String,
    pub usage_kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub node_label: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
pub struct WorkspaceCatalogTableUsageWorkflow {
    pub workflow_id: String,
    pub workflow_name: String,
    #[serde(default)]
    pub nodes: Vec<WorkspaceCatalogTableUsageNode>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
pub struct WorkspaceCatalogDeleteTablePreviewResponse {
    pub workflow_id: String,
    pub workflow_name: String,
    pub database_name: String,
    pub schema_name: String,
    pub table_name: String,
    #[serde(default)]
    pub is_deletable: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub protected_reason: Option<String>,
    #[serde(default)]
    pub affected_workflows: Vec<WorkspaceCatalogTableUsageWorkflow>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
pub struct WorkspaceCatalogDeleteTableResponse {
    pub workflow_id: String,
    pub workflow_name: String,
    pub database_name: String,
    pub schema_name: String,
    pub table_name: String,
    pub deleted: bool,
    #[serde(default)]
    pub invalidated_workflows: Vec<WorkspaceCatalogTableUsageWorkflow>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
pub struct WorkspaceCatalogQueryRequest {
    pub query: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
pub struct WorkspaceCatalogQueryColumn {
    pub column_name: String,
    pub data_type: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
pub struct WorkspaceCatalogQueryResponse {
    pub workflow_id: String,
    pub workflow_name: String,
    pub database_name: String,
    pub query: String,
    #[serde(default)]
    pub columns: Vec<WorkspaceCatalogQueryColumn>,
    #[serde(default)]
    pub rows: Vec<Vec<Option<String>>>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct CreateWorkflowRequest {
    pub workflow: WorkflowDefinition,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct UpdateWorkflowRequest {
    pub workflow: WorkflowDefinition,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
pub struct UpdateWorkflowStateRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_opened_workflow_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
pub struct DeleteWorkflowResponse {
    pub workflow_id: String,
    pub archived: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct WorkspaceRunsResponse {
    #[serde(default)]
    pub runs: Vec<RunSnapshot>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct WorkspaceRunResponse {
    pub run: RunSnapshot,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct RunEventsResponse {
    #[serde(default)]
    pub events: Vec<RunEvent>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct RunLogsResponse {
    #[serde(default)]
    pub logs: Vec<RunLogEntry>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct ErrorResponse {
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub validation: Option<ValidateWorkflowResponse>,
}

#[cfg(test)]
mod tests {
    use super::RunEventType;

    #[test]
    fn run_event_type_serializes_as_snake_case() {
        let event_type = serde_json::to_string(&RunEventType::PlanningStarted).expect("serializes");
        assert_eq!(event_type, "\"planning_started\"");
    }
}
