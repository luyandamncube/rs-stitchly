use chrono::{DateTime, Utc};
use node_registry::NodeDefinition;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use workflow_schema::{TypedValue, WorkflowDefinition};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum IssueSeverity {
    Error,
    Warning,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ValidationIssue {
    pub code: String,
    pub message: String,
    pub severity: IssueSeverity,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ValidateWorkflowRequest {
    pub workflow: WorkflowDefinition,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ValidateWorkflowResponse {
    pub valid: bool,
    #[serde(default)]
    pub errors: Vec<ValidationIssue>,
    #[serde(default)]
    pub warnings: Vec<ValidationIssue>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct RunTrigger {
    pub kind: TriggerKind,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TriggerKind {
    #[default]
    Manual,
    Schedule,
    Event,
    Backfill,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
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

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
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

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
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

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct RunErrorSummary {
    pub category: RunErrorCategory,
    pub message: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct RunLogEntry {
    pub timestamp: DateTime<Utc>,
    pub level: LogLevel,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub node_id: Option<String>,
    pub message: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
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

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
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

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct CreateRunRequest {
    pub workflow: WorkflowDefinition,
    #[serde(default)]
    pub trigger: RunTrigger,
    #[serde(default)]
    pub params: Map<String, Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct CreateRunResponse {
    pub run_id: String,
    pub status: RunStatus,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EventTargetKind {
    Run,
    Node,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct EventTarget {
    pub kind: EventTargetKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub node_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
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

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct RunEvent {
    pub event_id: String,
    pub run_id: String,
    pub sequence: u64,
    pub timestamp: DateTime<Utc>,
    pub event_type: RunEventType,
    pub target: EventTarget,
    pub payload: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct NodeDefinitionsResponse {
    pub node_definitions: Vec<NodeDefinition>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ConnectionSummary {
    pub connection_id: String,
    pub connection_kind: String,
    pub display_name: String,
    #[serde(default)]
    pub config: Value,
    #[serde(default)]
    pub capabilities: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ConnectionsResponse {
    pub connections: Vec<ConnectionSummary>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
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

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct WorkspaceConnectionsResponse {
    #[serde(default)]
    pub connections: Vec<WorkspaceConnectionSummary>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct WorkspaceConnectionResponse {
    pub connection: WorkspaceConnectionSummary,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceMembershipRole {
    Owner,
    Editor,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct SessionUserSummary {
    pub user_id: String,
    pub email: String,
    pub display_name: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspaceSummary {
    pub workspace_id: String,
    pub slug: String,
    pub name: String,
    pub role: WorkspaceMembershipRole,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct AuthSessionResponse {
    pub authenticated: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user: Option<SessionUserSummary>,
    #[serde(default)]
    pub workspaces: Vec<WorkspaceSummary>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_workspace_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct GoogleAuthCodeRequest {
    pub code: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct CreateWorkspaceRequest {
    pub name: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspaceListResponse {
    #[serde(default)]
    pub workspaces: Vec<WorkspaceSummary>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_workspace_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspaceResponse {
    pub workspace: WorkspaceSummary,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct WorkflowSummary {
    pub workflow_id: String,
    pub workspace_id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub version: u32,
    pub updated_at: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct WorkflowListResponse {
    #[serde(default)]
    pub workflows: Vec<WorkflowSummary>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct WorkflowResponse {
    pub workflow: WorkflowSummary,
    pub definition: WorkflowDefinition,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkflowStateResponse {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_opened_workflow_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct CreateWorkflowRequest {
    pub workflow: WorkflowDefinition,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct UpdateWorkflowRequest {
    pub workflow: WorkflowDefinition,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct UpdateWorkflowStateRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_opened_workflow_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeleteWorkflowResponse {
    pub workflow_id: String,
    pub archived: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct WorkspaceRunsResponse {
    #[serde(default)]
    pub runs: Vec<RunSnapshot>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct WorkspaceRunResponse {
    pub run: RunSnapshot,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct RunEventsResponse {
    #[serde(default)]
    pub events: Vec<RunEvent>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct RunLogsResponse {
    #[serde(default)]
    pub logs: Vec<RunLogEntry>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
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
