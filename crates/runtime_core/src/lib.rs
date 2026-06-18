use std::{
    any::Any,
    collections::{BTreeMap, BTreeSet, HashMap, VecDeque},
    panic::{catch_unwind, AssertUnwindSafe},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

use api_contract::{
    ConnectionSummary, CreateRunRequest, CreateRunResponse, EventTarget, EventTargetKind,
    IssueSeverity, LogLevel, NodeDefinitionsResponse, NodeRunSnapshot, NodeRunStatus,
    RunErrorCategory, RunErrorSummary, RunEvent, RunEventType, RunLogEntry, RunSnapshot, RunStatus,
    ValidateWorkflowResponse, ValidationIssue,
};
use chrono::Utc;
use node_registry::NodeRegistry;
use runtime_adapters::{AdapterError, AdapterExecutionContext, PortValues, RuntimeAdapters};
use serde_json::{json, Value};
use thiserror::Error;
use tokio::sync::{broadcast, Notify, RwLock};
use tokio::task;
use tokio::time::{sleep, Duration};
use uuid::Uuid;
use workflow_schema::{WorkflowDefinition, WorkflowNode, CURRENT_SCHEMA_VERSION};

#[derive(Clone)]
pub struct RuntimeService {
    registry: Arc<NodeRegistry>,
    adapters: Arc<RuntimeAdapters>,
    state: Arc<RwLock<RuntimeState>>,
    connections: Arc<Vec<ConnectionSummary>>,
}

pub const INTERNAL_PARAM_WORKSPACE_DUCKDB_PATH: &str = "__workspace_duckdb_path";
pub const INTERNAL_PARAM_WORKFLOW_ROOT_PATH: &str = "__workflow_root_path";
pub const INTERNAL_PARAM_WORKFLOW_FILES_ROOT: &str = "__workflow_files_root";
pub const INTERNAL_PARAM_WORKFLOW_DUCKDB_PATH: &str = "__workflow_duckdb_path";
pub const INTERNAL_PARAM_DISABLE_LIVE_DOLT: &str = "__disable_live_dolt";

fn panic_payload_to_string(payload: Box<dyn Any + Send + 'static>) -> String {
    if let Some(message) = payload.downcast_ref::<&str>() {
        return (*message).to_string();
    }
    if let Some(message) = payload.downcast_ref::<String>() {
        return message.clone();
    }

    "non-string panic payload".to_string()
}

struct RuntimeState {
    runs: HashMap<String, Arc<RunRecord>>,
}

struct RunRecord {
    snapshot: RwLock<RunSnapshot>,
    history: RwLock<Vec<RunEvent>>,
    sender: broadcast::Sender<RunEvent>,
    cancellation_requested: AtomicBool,
    cancellation_notify: Notify,
}

pub struct RunEventSubscription {
    pub history: Vec<RunEvent>,
    pub receiver: broadcast::Receiver<RunEvent>,
}

#[derive(Debug, Error)]
pub enum RuntimeError {
    #[error("workflow validation failed")]
    ValidationFailed(ValidateWorkflowResponse),
    #[error("run `{0}` not found")]
    RunNotFound(String),
}

impl Default for RuntimeService {
    fn default() -> Self {
        Self::new(NodeRegistry::builtin())
    }
}

impl RuntimeService {
    pub fn new(registry: NodeRegistry) -> Self {
        Self {
            registry: Arc::new(registry),
            adapters: Arc::new(RuntimeAdapters::default()),
            state: Arc::new(RwLock::new(RuntimeState {
                runs: HashMap::new(),
            })),
            connections: Arc::new(default_connections()),
        }
    }

    pub fn validate_workflow(&self, workflow: &WorkflowDefinition) -> ValidateWorkflowResponse {
        let mut errors = Vec::new();
        let warnings = Vec::new();

        if workflow.schema_version != CURRENT_SCHEMA_VERSION {
            errors.push(issue(
                "invalid_schema_version",
                format!(
                    "Workflow schema_version {} does not match supported version {}.",
                    workflow.schema_version, CURRENT_SCHEMA_VERSION
                ),
                Some("workflow.schema_version".to_string()),
            ));
        }

        if workflow.nodes.is_empty() {
            errors.push(issue(
                "missing_nodes",
                "Workflow must include at least one node.".to_string(),
                Some("workflow.nodes".to_string()),
            ));
        }

        let mut node_ids = BTreeSet::new();
        let mut edge_ids = BTreeSet::new();
        for node in &workflow.nodes {
            if !node_ids.insert(node.node_id.clone()) {
                errors.push(issue(
                    "duplicate_node_id",
                    format!("Duplicate node_id `{}` found.", node.node_id),
                    Some(format!("workflow.nodes.{}", node.node_id)),
                ));
            }

            let Some(definition) = self.registry.get(&node.type_id) else {
                errors.push(issue(
                    "unknown_node_type",
                    format!(
                        "Node `{}` references unknown type `{}`.",
                        node.node_id, node.type_id
                    ),
                    Some(format!("workflow.nodes.{}.type_id", node.node_id)),
                ));
                continue;
            };

            if node.definition_version != definition.version {
                errors.push(issue(
                    "definition_version_mismatch",
                    format!(
                        "Node `{}` expects definition version {} but registry provides {}.",
                        node.node_id, node.definition_version, definition.version
                    ),
                    Some(format!(
                        "workflow.nodes.{}.definition_version",
                        node.node_id
                    )),
                ));
            }

            if let Some(error) = validate_node_config(node) {
                errors.push(error);
            }
        }

        let node_map = workflow
            .nodes
            .iter()
            .map(|node| (node.node_id.as_str(), node))
            .collect::<HashMap<_, _>>();
        let mut incoming_counts = HashMap::<(String, String), usize>::new();

        for edge in &workflow.edges {
            if !edge_ids.insert(edge.edge_id.clone()) {
                errors.push(issue(
                    "duplicate_edge_id",
                    format!("Duplicate edge_id `{}` found.", edge.edge_id),
                    Some(format!("workflow.edges.{}", edge.edge_id)),
                ));
            }

            let Some(source_node) = node_map.get(edge.source_node_id.as_str()) else {
                errors.push(issue(
                    "unknown_source_node",
                    format!(
                        "Edge `{}` references missing source node `{}`.",
                        edge.edge_id, edge.source_node_id
                    ),
                    Some(format!("workflow.edges.{}.source_node_id", edge.edge_id)),
                ));
                continue;
            };
            let Some(target_node) = node_map.get(edge.target_node_id.as_str()) else {
                errors.push(issue(
                    "unknown_target_node",
                    format!(
                        "Edge `{}` references missing target node `{}`.",
                        edge.edge_id, edge.target_node_id
                    ),
                    Some(format!("workflow.edges.{}.target_node_id", edge.edge_id)),
                ));
                continue;
            };

            let Some(source_definition) = self.registry.get(&source_node.type_id) else {
                continue;
            };
            let Some(target_definition) = self.registry.get(&target_node.type_id) else {
                continue;
            };

            let Some(source_port) = source_definition.output_port(&edge.source_port_id) else {
                errors.push(issue(
                    "unknown_source_port",
                    format!(
                        "Edge `{}` references missing source port `{}` on node `{}`.",
                        edge.edge_id, edge.source_port_id, edge.source_node_id
                    ),
                    Some(format!("workflow.edges.{}.source_port_id", edge.edge_id)),
                ));
                continue;
            };
            let Some(target_port) = target_definition.input_port(&edge.target_port_id) else {
                errors.push(issue(
                    "unknown_target_port",
                    format!(
                        "Edge `{}` references missing target port `{}` on node `{}`.",
                        edge.edge_id, edge.target_port_id, edge.target_node_id
                    ),
                    Some(format!("workflow.edges.{}.target_port_id", edge.edge_id)),
                ));
                continue;
            };

            if !ports_are_compatible(source_node, source_port, target_node, target_port) {
                errors.push(issue(
                    "port_type_mismatch",
                    format!(
                        "Edge `{}` connects incompatible types from `{}.{}` to `{}.{}`.",
                        edge.edge_id,
                        edge.source_node_id,
                        edge.source_port_id,
                        edge.target_node_id,
                        edge.target_port_id
                    ),
                    Some(format!("workflow.edges.{}", edge.edge_id)),
                ));
            }

            let key = (edge.target_node_id.clone(), edge.target_port_id.clone());
            let count = incoming_counts.entry(key).or_insert(0);
            *count += 1;
            if *count > 1 && !target_port.multiple {
                errors.push(issue(
                    "too_many_inputs",
                    format!(
                        "Port `{}.{}` only accepts one connection.",
                        edge.target_node_id, edge.target_port_id
                    ),
                    Some(format!("workflow.edges.{}", edge.edge_id)),
                ));
            }
        }

        for node in &workflow.nodes {
            let Some(definition) = self.registry.get(&node.type_id) else {
                continue;
            };
            for input in &definition.inputs {
                let key = (node.node_id.clone(), input.port_id.clone());
                if input.required && incoming_counts.get(&key).copied().unwrap_or_default() == 0 {
                    errors.push(issue(
                        "missing_required_input",
                        format!(
                            "Node `{}` is missing required input `{}`.",
                            node.node_id, input.port_id
                        ),
                        Some(format!("workflow.nodes.{}.{}", node.node_id, input.port_id)),
                    ));
                }
            }

            if node.type_id == "table_merge" {
                let items_key = (node.node_id.clone(), "items".to_string());
                let items_input_count = incoming_counts.get(&items_key).copied().unwrap_or_default();
                let write_policy = node
                    .config
                    .get("write_policy")
                    .and_then(Value::as_str)
                    .unwrap_or("upsert");
                let has_merge_keys_by_table = node
                    .config
                    .get("merge_keys_by_table")
                    .and_then(Value::as_object)
                    .map(|entries| !entries.is_empty())
                    .unwrap_or(false);

                if items_input_count > 0 && write_policy == "upsert" && !has_merge_keys_by_table {
                    errors.push(issue(
                        "missing_table_merge_keys_by_table",
                        format!(
                            "Node `{}` receives a table collection on `items` with `write_policy=upsert`; configure `merge_keys_by_table` with keys for each table.",
                            node.node_id
                        ),
                        Some(format!(
                            "workflow.nodes.{}.config.merge_keys_by_table",
                            node.node_id
                        )),
                    ));
                }
            }

            if node.type_id == "send_email" {
                let body_mode = node.config.get("body_mode").and_then(Value::as_str);
                let body_key = (node.node_id.clone(), "body".to_string());
                let body_input_count = incoming_counts.get(&body_key).copied().unwrap_or_default();
                let configured_body = node
                    .config
                    .get("body_text")
                    .and_then(Value::as_str)
                    .or_else(|| node.config.get("body").and_then(Value::as_str));

                if body_mode == Some("input") && body_input_count == 0 {
                    errors.push(issue(
                        "missing_send_email_body_input",
                        format!(
                            "Node `{}` uses `body_mode=input` but has no connected `body` input.",
                            node.node_id
                        ),
                        Some(format!("workflow.nodes.{}.config.body_mode", node.node_id)),
                    ));
                }

                if body_mode == Some("custom")
                    && configured_body
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .is_none()
                {
                    errors.push(issue(
                        "invalid_send_email_body_text",
                        format!(
                            "Node `{}` uses `body_mode=custom` but has no non-empty custom body text.",
                            node.node_id
                        ),
                        Some(format!("workflow.nodes.{}.config.body_text", node.node_id)),
                    ));
                }
            }
        }

        if errors.is_empty() {
            if let Err(cycle_issue) = topological_order(workflow) {
                errors.push(cycle_issue);
            }
        }

        ValidateWorkflowResponse {
            valid: errors.is_empty(),
            errors,
            warnings,
        }
    }

    pub fn node_definitions(&self) -> NodeDefinitionsResponse {
        NodeDefinitionsResponse {
            node_definitions: self.registry.list(),
        }
    }

    pub fn connections(&self) -> Vec<ConnectionSummary> {
        self.connections.as_ref().clone()
    }

    pub async fn create_run(
        &self,
        request: CreateRunRequest,
    ) -> Result<CreateRunResponse, RuntimeError> {
        let validation = self.validate_workflow(&request.workflow);
        if !validation.valid {
            return Err(RuntimeError::ValidationFailed(validation));
        }

        let suffix = Uuid::new_v4().simple().to_string();
        let run_id = format!("run_{}", &suffix[..12]);
        let (sender, _) = broadcast::channel(256);
        let snapshot = RunSnapshot {
            run_id: run_id.clone(),
            workflow_id: request.workflow.workflow_id.clone(),
            workflow_version: request.workflow.version,
            status: RunStatus::Created,
            trigger: request.trigger.clone(),
            started_at: None,
            finished_at: None,
            node_runs: request
                .workflow
                .nodes
                .iter()
                .map(|node| NodeRunSnapshot {
                    node_id: node.node_id.clone(),
                    type_id: node.type_id.clone(),
                    status: NodeRunStatus::Pending,
                    attempt: 0,
                    started_at: None,
                    finished_at: None,
                    last_output: None,
                    log_count: 0,
                    error: None,
                })
                .collect(),
            logs: Vec::new(),
            error: None,
        };
        let record = Arc::new(RunRecord {
            snapshot: RwLock::new(snapshot),
            history: RwLock::new(Vec::new()),
            sender,
            cancellation_requested: AtomicBool::new(false),
            cancellation_notify: Notify::new(),
        });

        self.state
            .write()
            .await
            .runs
            .insert(run_id.clone(), Arc::clone(&record));

        self.push_event(
            &record,
            &run_id,
            RunEventType::RunCreated,
            run_target(),
            json!({
                "workflow_id": request.workflow.workflow_id,
                "workflow_version": request.workflow.version
            }),
        )
        .await;

        let runtime = self.clone();
        let workflow = request.workflow;
        let run_params = request.params;
        let spawned_run_id = run_id.clone();
        tokio::spawn(async move {
            runtime
                .execute_run(spawned_run_id, workflow, run_params)
                .await;
        });

        Ok(CreateRunResponse {
            run_id,
            status: RunStatus::Created,
        })
    }

    pub async fn get_run(&self, run_id: &str) -> Option<RunSnapshot> {
        let record = self.get_record(run_id).await?;
        let snapshot = record.snapshot.read().await.clone();
        Some(snapshot)
    }

    pub async fn cancel_run(&self, run_id: &str) -> Result<RunSnapshot, RuntimeError> {
        let record = self
            .get_record(run_id)
            .await
            .ok_or_else(|| RuntimeError::RunNotFound(run_id.to_string()))?;

        let mut should_emit_cancellation_requested = false;
        let snapshot = {
            let mut snapshot = record.snapshot.write().await;
            if is_terminal_run_status(&snapshot.status) || snapshot.status == RunStatus::Cancelled {
                snapshot.clone()
            } else {
                snapshot.status = RunStatus::Cancelling;
                for node_run in &mut snapshot.node_runs {
                    if matches!(node_run.status, NodeRunStatus::Running) {
                        node_run.status = NodeRunStatus::Cancelling;
                    }
                }
                should_emit_cancellation_requested = true;
                snapshot.clone()
            }
        };

        if should_emit_cancellation_requested {
            record.cancellation_requested.store(true, Ordering::SeqCst);
            record.cancellation_notify.notify_waiters();
            self.push_event(
                &record,
                run_id,
                RunEventType::CancellationRequested,
                run_target(),
                json!({ "status": RunStatus::Cancelling }),
            )
            .await;
            self.push_event(
                &record,
                run_id,
                RunEventType::RunStatusChanged,
                run_target(),
                json!({ "status": RunStatus::Cancelling }),
            )
            .await;
        }

        Ok(snapshot)
    }

    pub async fn subscribe(&self, run_id: &str) -> Option<RunEventSubscription> {
        let record = self.get_record(run_id).await?;
        let history = record.history.read().await.clone();
        let receiver = record.sender.subscribe();
        Some(RunEventSubscription { history, receiver })
    }

    pub async fn event_history(&self, run_id: &str) -> Option<Vec<RunEvent>> {
        let record = self.get_record(run_id).await?;
        let history = record.history.read().await.clone();
        Some(history)
    }

    async fn execute_run(
        &self,
        run_id: String,
        workflow: WorkflowDefinition,
        run_params: serde_json::Map<String, Value>,
    ) {
        let Some(record) = self.get_record(&run_id).await else {
            return;
        };

        if self.finalize_run_if_cancelled(&record, &run_id).await {
            return;
        }

        self.mark_planning(&record, &run_id).await;

        let plan = match topological_order(&workflow) {
            Ok(plan) => plan,
            Err(error) => {
                self.fail_run(
                    &record,
                    &run_id,
                    None,
                    to_run_error(error, RunErrorCategory::PlanningError),
                )
                .await;
                return;
            }
        };

        self.push_event(
            &record,
            &run_id,
            RunEventType::PlanningFinished,
            run_target(),
            json!({ "planned_nodes": plan.len() }),
        )
        .await;

        if self.finalize_run_if_cancelled(&record, &run_id).await {
            return;
        }
        self.mark_running(&record, &run_id).await;

        let workspace_duckdb_path = run_params
            .get(INTERNAL_PARAM_WORKSPACE_DUCKDB_PATH)
            .or_else(|| run_params.get(INTERNAL_PARAM_WORKFLOW_DUCKDB_PATH))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(PathBuf::from);
        let workflow_root_path = run_params
            .get(INTERNAL_PARAM_WORKFLOW_ROOT_PATH)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(PathBuf::from);
        let workflow_files_root = run_params
            .get(INTERNAL_PARAM_WORKFLOW_FILES_ROOT)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(PathBuf::from);
        let disable_live_dolt = run_params
            .get(INTERNAL_PARAM_DISABLE_LIVE_DOLT)
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let execution_context = AdapterExecutionContext {
            workflow_id: Some(workflow.workflow_id.clone()),
            run_id: Some(run_id.clone()),
            workspace_duckdb_path,
            workflow_root_path,
            workflow_files_root,
            disable_live_dolt,
            ..AdapterExecutionContext::default()
        };

        let mut outputs = BTreeMap::<(String, String), workflow_schema::TypedValue>::new();
        for node_id in plan {
            if self.finalize_run_if_cancelled(&record, &run_id).await {
                return;
            }

            let Some(node) = workflow
                .nodes
                .iter()
                .find(|candidate| candidate.node_id == node_id)
            else {
                continue;
            };
            let Some(definition) = self.registry.get(&node.type_id) else {
                self.fail_run(
                    &record,
                    &run_id,
                    Some(&node.node_id),
                    RunErrorSummary {
                        category: RunErrorCategory::AdapterResolutionError,
                        message: format!("Missing node definition for `{}`.", node.type_id),
                    },
                )
                .await;
                return;
            };

            let inputs = match collect_inputs(node, &workflow, &outputs) {
                Ok(inputs) => inputs,
                Err(error) => {
                    self.fail_run(
                        &record,
                        &run_id,
                        Some(&node.node_id),
                        RunErrorSummary {
                            category: RunErrorCategory::ExecutionError,
                            message: error,
                        },
                    )
                    .await;
                    return;
                }
            };

            self.mark_node_started(&record, &run_id, node).await;
            if self.finalize_run_if_cancelled(&record, &run_id).await {
                return;
            }
            let execution_timing = node_execution_timing(node);

            if let Some(wait_before) = execution_timing.before_duration() {
                self.record_log(
                    &record,
                    &run_id,
                    Some(&node.node_id),
                    format!(
                        "Waiting {} before execution.",
                        format_execution_wait_seconds(execution_timing.wait_before_seconds)
                    ),
                )
                .await;
                if self.sleep_or_cancel(&record, wait_before).await {
                    self.finalize_run_as_cancelled(&record, &run_id).await;
                    return;
                }
            }

            let adapter_execution = {
                let adapters = Arc::clone(&self.adapters);
                let execution_context = execution_context.clone();
                let definition = definition.clone();
                let node = node.clone();
                let inputs = inputs.clone();
                task::spawn_blocking(move || {
                    catch_unwind(AssertUnwindSafe(|| {
                        adapters.execute_with_context(
                            &definition,
                            &node,
                            &inputs,
                            &execution_context,
                        )
                    }))
                    .unwrap_or_else(|payload| {
                        Err(AdapterError::ExecutionFailed {
                            node_id: node.node_id.clone(),
                            message: format!(
                                "adapter panicked: {}",
                                panic_payload_to_string(payload)
                            ),
                        })
                    })
                })
            };
            let cancellation = record.cancellation_notify.notified();
            tokio::pin!(cancellation);
            if record.cancellation_requested.load(Ordering::SeqCst) {
                adapter_execution.abort();
                self.record_log(
                    &record,
                    &run_id,
                    Some(&node.node_id),
                    "Cancellation requested while node execution was starting.".to_string(),
                )
                .await;
                self.finalize_run_as_cancelled(&record, &run_id).await;
                return;
            }

            let adapter_result = tokio::select! {
                result = adapter_execution => Some(result),
                _ = &mut cancellation => None,
            };

            if adapter_result.is_none() && record.cancellation_requested.load(Ordering::SeqCst) {
                self.record_log(
                    &record,
                    &run_id,
                    Some(&node.node_id),
                    "Cancellation requested while node execution was in flight. Marking the run as cancelled.".to_string(),
                )
                .await;
                self.finalize_run_as_cancelled(&record, &run_id).await;
                return;
            }

            match adapter_result
                .expect("adapter result should exist when cancellation did not win the race")
            {
                Ok(Ok(result)) => {
                    for log_line in &result.logs {
                        self.record_log(&record, &run_id, Some(&node.node_id), log_line.clone())
                            .await;
                    }

                    if let Some(wait_after) = execution_timing.after_duration() {
                        self.record_log(
                            &record,
                            &run_id,
                            Some(&node.node_id),
                            format!(
                                "Waiting {} after execution.",
                                format_execution_wait_seconds(execution_timing.wait_after_seconds)
                            ),
                        )
                        .await;
                        if self.sleep_or_cancel(&record, wait_after).await {
                            self.finalize_run_as_cancelled(&record, &run_id).await;
                            return;
                        }
                    }

                    let last_output = result.outputs.values().next().cloned();
                    for (port_id, value) in result.outputs {
                        outputs.insert((node.node_id.clone(), port_id), value);
                    }

                    self.mark_node_finished(
                        &record,
                        &run_id,
                        node,
                        NodeRunStatus::Succeeded,
                        last_output,
                        None,
                    )
                    .await;

                    if self.finalize_run_if_cancelled(&record, &run_id).await {
                        return;
                    }
                }
                Ok(Err(error)) => {
                    self.fail_run(
                        &record,
                        &run_id,
                        Some(&node.node_id),
                        to_run_error_from_adapter(node, error),
                    )
                    .await;
                    return;
                }
                Err(error) => {
                    self.fail_run(
                        &record,
                        &run_id,
                        Some(&node.node_id),
                        RunErrorSummary {
                            category: RunErrorCategory::ExecutionError,
                            message: format!(
                                "Node `{}` failed: adapter task crashed: {error}",
                                node.node_id
                            ),
                        },
                    )
                    .await;
                    return;
                }
            }
        }

        {
            let mut snapshot = record.snapshot.write().await;
            snapshot.status = RunStatus::Succeeded;
            snapshot.finished_at = Some(Utc::now());
        }

        self.push_event(
            &record,
            &run_id,
            RunEventType::RunSucceeded,
            run_target(),
            json!({ "completed_nodes": workflow.nodes.len() }),
        )
        .await;
    }

    async fn get_record(&self, run_id: &str) -> Option<Arc<RunRecord>> {
        self.state.read().await.runs.get(run_id).cloned()
    }

    async fn mark_planning(&self, record: &Arc<RunRecord>, run_id: &str) {
        {
            let mut snapshot = record.snapshot.write().await;
            snapshot.status = RunStatus::Planning;
            snapshot.started_at = Some(Utc::now());
        }
        self.push_event(
            record,
            run_id,
            RunEventType::PlanningStarted,
            run_target(),
            json!({}),
        )
        .await;
    }

    async fn mark_running(&self, record: &Arc<RunRecord>, run_id: &str) {
        {
            let mut snapshot = record.snapshot.write().await;
            snapshot.status = RunStatus::Running;
        }
        self.push_event(
            record,
            run_id,
            RunEventType::RunStatusChanged,
            run_target(),
            json!({ "status": RunStatus::Running }),
        )
        .await;
    }

    async fn mark_node_started(&self, record: &Arc<RunRecord>, run_id: &str, node: &WorkflowNode) {
        {
            let mut snapshot = record.snapshot.write().await;
            if let Some(node_run) = snapshot
                .node_runs
                .iter_mut()
                .find(|candidate| candidate.node_id == node.node_id)
            {
                node_run.status = NodeRunStatus::Running;
                node_run.attempt = 1;
                node_run.started_at = Some(Utc::now());
            }
        }

        self.push_event(
            record,
            run_id,
            RunEventType::NodeStarted,
            node_target(&node.node_id),
            json!({
                "attempt": 1,
                "type_id": node.type_id
            }),
        )
        .await;
    }

    async fn mark_node_finished(
        &self,
        record: &Arc<RunRecord>,
        run_id: &str,
        node: &WorkflowNode,
        status: NodeRunStatus,
        last_output: Option<workflow_schema::TypedValue>,
        error: Option<RunErrorSummary>,
    ) {
        {
            let mut snapshot = record.snapshot.write().await;
            if let Some(node_run) = snapshot
                .node_runs
                .iter_mut()
                .find(|candidate| candidate.node_id == node.node_id)
            {
                node_run.status = status.clone();
                node_run.finished_at = Some(Utc::now());
                node_run.last_output = last_output;
                node_run.error = error.clone();
            }
        }

        self.push_event(
            record,
            run_id,
            RunEventType::NodeFinished,
            node_target(&node.node_id),
            json!({
                "status": status,
                "error": error
            }),
        )
        .await;
    }

    async fn record_log(
        &self,
        record: &Arc<RunRecord>,
        run_id: &str,
        node_id: Option<&str>,
        message: String,
    ) {
        {
            let mut snapshot = record.snapshot.write().await;
            snapshot.logs.push(RunLogEntry {
                timestamp: Utc::now(),
                level: LogLevel::Info,
                node_id: node_id.map(ToOwned::to_owned),
                message: message.clone(),
            });

            if let Some(node_id) = node_id {
                if let Some(node_run) = snapshot
                    .node_runs
                    .iter_mut()
                    .find(|candidate| candidate.node_id == node_id)
                {
                    node_run.log_count += 1;
                }
            }
        }

        self.push_event(
            record,
            run_id,
            RunEventType::NodeLog,
            node_id.map(node_target).unwrap_or_else(run_target),
            json!({
                "level": LogLevel::Info,
                "message": message
            }),
        )
        .await;
    }

    async fn fail_run(
        &self,
        record: &Arc<RunRecord>,
        run_id: &str,
        node_id: Option<&str>,
        error: RunErrorSummary,
    ) {
        {
            let mut snapshot = record.snapshot.write().await;
            snapshot.status = RunStatus::Failed;
            snapshot.finished_at = Some(Utc::now());
            snapshot.error = Some(error.clone());

            if let Some(node_id) = node_id {
                if let Some(node_run) = snapshot
                    .node_runs
                    .iter_mut()
                    .find(|candidate| candidate.node_id == node_id)
                {
                    node_run.status = NodeRunStatus::Failed;
                    node_run.finished_at = Some(Utc::now());
                    node_run.error = Some(error.clone());
                }
            }
        }

        self.push_event(
            record,
            run_id,
            RunEventType::RunFailed,
            node_id.map(node_target).unwrap_or_else(run_target),
            serde_json::to_value(&error).unwrap_or(Value::Null),
        )
        .await;
    }

    async fn sleep_or_cancel(&self, record: &Arc<RunRecord>, duration: Duration) -> bool {
        if record.cancellation_requested.load(Ordering::SeqCst) {
            return true;
        }

        tokio::select! {
            _ = sleep(duration) => false,
            _ = record.cancellation_notify.notified() => record.cancellation_requested.load(Ordering::SeqCst),
        }
    }

    async fn finalize_run_if_cancelled(&self, record: &Arc<RunRecord>, run_id: &str) -> bool {
        if !record.cancellation_requested.load(Ordering::SeqCst) {
            return false;
        }

        self.finalize_run_as_cancelled(record, run_id).await;
        true
    }

    async fn finalize_run_as_cancelled(&self, record: &Arc<RunRecord>, run_id: &str) {
        let should_emit_run_cancelled = {
            let mut snapshot = record.snapshot.write().await;
            if snapshot.status == RunStatus::Cancelled {
                false
            } else {
                let now = Utc::now();
                snapshot.status = RunStatus::Cancelled;
                snapshot.finished_at = Some(now);
                snapshot.error = Some(cancelled_run_error());

                for node_run in &mut snapshot.node_runs {
                    if matches!(
                        node_run.status,
                        NodeRunStatus::Pending
                            | NodeRunStatus::Ready
                            | NodeRunStatus::Running
                            | NodeRunStatus::Cancelling
                            | NodeRunStatus::Retrying
                    ) {
                        let was_started = node_run.started_at.is_some();
                        node_run.status = NodeRunStatus::Cancelled;
                        if was_started {
                            node_run.finished_at = Some(now);
                            node_run.error = Some(cancelled_run_error());
                        }
                    }
                }
                true
            }
        };

        if should_emit_run_cancelled {
            self.push_event(
                record,
                run_id,
                RunEventType::RunCancelled,
                run_target(),
                json!({
                    "status": RunStatus::Cancelled,
                    "error": cancelled_run_error(),
                }),
            )
            .await;
        }
    }

    async fn push_event(
        &self,
        record: &Arc<RunRecord>,
        run_id: &str,
        event_type: RunEventType,
        target: EventTarget,
        payload: Value,
    ) {
        let mut history = record.history.write().await;
        let event = RunEvent {
            event_id: format!("evt_{}", Uuid::new_v4().simple()),
            run_id: run_id.to_string(),
            sequence: history.len() as u64 + 1,
            timestamp: Utc::now(),
            event_type,
            target,
            payload,
        };
        history.push(event.clone());
        drop(history);
        let _ = record.sender.send(event);
    }
}

fn default_connections() -> Vec<ConnectionSummary> {
    vec![
        ConnectionSummary {
            connection_id: "local_filesystem".to_string(),
            connection_kind: "local_filesystem".to_string(),
            display_name: "Local Filesystem".to_string(),
            config: json!({
                "root_label": "workspace",
                "mode": "read_write"
            }),
            capabilities: json!({
                "supports_file_input": true,
                "supports_preview_output": true
            }),
        },
        ConnectionSummary {
            connection_id: "clickhouse_demo".to_string(),
            connection_kind: "clickhouse".to_string(),
            display_name: "ClickHouse Demo".to_string(),
            config: json!({
                "database": "analytics",
                "tls": true
            }),
            capabilities: json!({
                "supports_sql_transform": true,
                "supports_table_output": true
            }),
        },
    ]
}

fn issue(code: &str, message: String, path: Option<String>) -> ValidationIssue {
    ValidationIssue {
        code: code.to_string(),
        message,
        severity: IssueSeverity::Error,
        path,
    }
}

fn validate_node_config(node: &WorkflowNode) -> Option<ValidationIssue> {
    if let Some(issue) = validate_execution_timing_config(node) {
        return Some(issue);
    }

    match node.type_id.as_str() {
        "text_input" => {
            let text = node.config.get("text").and_then(Value::as_str);
            if text.is_none() {
                return Some(issue(
                    "invalid_text_input_config",
                    format!(
                        "Node `{}` requires a string `text` config field.",
                        node.node_id
                    ),
                    Some(format!("workflow.nodes.{}.config.text", node.node_id)),
                ));
            }

            if let Some(trim_mode) = node.config.get("trim_mode") {
                match trim_mode.as_str() {
                    Some("automatic" | "trim" | "exact") => {}
                    _ => {
                        return Some(issue(
                            "invalid_text_input_trim_mode",
                            format!("Node `{}` has unsupported `trim_mode` value.", node.node_id),
                            Some(format!("workflow.nodes.{}.config.trim_mode", node.node_id)),
                        ));
                    }
                }
            }

            if let Some(preserve_whitespace) = node.config.get("preserve_whitespace") {
                if !preserve_whitespace.is_boolean() {
                    return Some(issue(
                        "invalid_text_input_preserve_whitespace",
                        format!(
                            "Node `{}` expects boolean `preserve_whitespace` when provided.",
                            node.node_id
                        ),
                        Some(format!(
                            "workflow.nodes.{}.config.preserve_whitespace",
                            node.node_id
                        )),
                    ));
                }
            }

            if let Some(include_line_breaks) = node.config.get("include_line_breaks") {
                if !include_line_breaks.is_boolean() {
                    return Some(issue(
                        "invalid_text_input_include_line_breaks",
                        format!(
                            "Node `{}` expects boolean `include_line_breaks` when provided.",
                            node.node_id
                        ),
                        Some(format!(
                            "workflow.nodes.{}.config.include_line_breaks",
                            node.node_id
                        )),
                    ));
                }
            }

            None
        }
        "text_transform" => {
            if let Some(operation) = node.config.get("operation") {
                match operation.as_str() {
                    Some("identity" | "uppercase" | "trim") => None,
                    _ => Some(issue(
                        "invalid_text_transform_operation",
                        format!(
                            "Node `{}` has unsupported operation `{operation}`.",
                            node.node_id
                        ),
                        Some(format!("workflow.nodes.{}.config.operation", node.node_id)),
                    )),
                }
            } else {
                None
            }
        }
        "preview_output" => {
            if let Some(title) = node.config.get("title") {
                if !title.is_string() {
                    return Some(issue(
                        "invalid_preview_title",
                        format!("Node `{}` expects optional string `title`.", node.node_id),
                        Some(format!("workflow.nodes.{}.config.title", node.node_id)),
                    ));
                }
            }
            None
        }
        "table_input" => {
            if let Some(catalog) = node.config.get("catalog") {
                match catalog.as_str() {
                    Some(value) if !value.trim().is_empty() => {}
                    _ => {
                        return Some(issue(
                            "invalid_table_input_catalog",
                            format!(
                                "Node `{}` expects non-empty string `catalog` when provided.",
                                node.node_id
                            ),
                            Some(format!("workflow.nodes.{}.config.catalog", node.node_id)),
                        ));
                    }
                }
            }

            let schema_name = node.config.get("schema_name").and_then(Value::as_str);
            if schema_name.map_or(true, |value| value.trim().is_empty()) {
                return Some(issue(
                    "invalid_table_input_schema_name",
                    format!(
                        "Node `{}` requires a non-empty string `schema_name` config field.",
                        node.node_id
                    ),
                    Some(format!(
                        "workflow.nodes.{}.config.schema_name",
                        node.node_id
                    )),
                ));
            }

            let table_name = node.config.get("table_name").and_then(Value::as_str);
            if table_name.map_or(true, |value| value.trim().is_empty()) {
                return Some(issue(
                    "invalid_table_input_table_name",
                    format!(
                        "Node `{}` requires a non-empty string `table_name` config field.",
                        node.node_id
                    ),
                    Some(format!("workflow.nodes.{}.config.table_name", node.node_id)),
                ));
            }

            if let Some(output_alias) = node.config.get("output_alias") {
                match output_alias.as_str() {
                    Some(value) if !value.trim().is_empty() => {}
                    _ => {
                        return Some(issue(
                            "invalid_table_input_output_alias",
                            format!(
                                "Node `{}` expects non-empty string `output_alias` when provided.",
                                node.node_id
                            ),
                            Some(format!(
                                "workflow.nodes.{}.config.output_alias",
                                node.node_id
                            )),
                        ));
                    }
                }
            }

            if let Some(selected_columns) = node.config.get("selected_columns") {
                let Some(columns) = selected_columns.as_array() else {
                    return Some(issue(
                        "invalid_table_input_selected_columns",
                        format!(
                            "Node `{}` expects `selected_columns` to be an array of strings.",
                            node.node_id
                        ),
                        Some(format!(
                            "workflow.nodes.{}.config.selected_columns",
                            node.node_id
                        )),
                    ));
                };

                if columns.iter().any(|value| {
                    value
                        .as_str()
                        .map(str::trim)
                        .filter(|column| !column.is_empty())
                        .is_none()
                }) {
                    return Some(issue(
                        "invalid_table_input_selected_columns",
                        format!(
                            "Node `{}` expects every `selected_columns` entry to be a non-empty string.",
                            node.node_id
                        ),
                        Some(format!(
                            "workflow.nodes.{}.config.selected_columns",
                            node.node_id
                        )),
                    ));
                }
            }

            if let Some(row_filter) = node.config.get("row_filter") {
                if !row_filter.is_string() {
                    return Some(issue(
                        "invalid_table_input_row_filter",
                        format!(
                            "Node `{}` expects optional string `row_filter`.",
                            node.node_id
                        ),
                        Some(format!("workflow.nodes.{}.config.row_filter", node.node_id)),
                    ));
                }
            }

            if let Some(row_limit) = node.config.get("row_limit") {
                match row_limit.as_u64() {
                    Some(value) if value > 0 => {}
                    _ => {
                        return Some(issue(
                            "invalid_table_input_row_limit",
                            format!(
                                "Node `{}` expects positive integer `row_limit` when provided.",
                                node.node_id
                            ),
                            Some(format!("workflow.nodes.{}.config.row_limit", node.node_id)),
                        ));
                    }
                }
            }

            for (key, code) in [
                ("refresh_schema", "invalid_table_input_refresh_schema"),
                ("open_in_catalog", "invalid_table_input_open_in_catalog"),
            ] {
                if let Some(value) = node.config.get(key) {
                    if !value.is_boolean() {
                        return Some(issue(
                            code,
                            format!(
                                "Node `{}` expects boolean `{key}` when provided.",
                                node.node_id
                            ),
                            Some(format!("workflow.nodes.{}.config.{key}", node.node_id)),
                        ));
                    }
                }
            }

            None
        }
        "dolt_repo_source" => {
            let connection_ref = node.config.get("connection_ref").and_then(Value::as_str);
            if connection_ref.map_or(true, |value| value.trim().is_empty()) {
                return Some(issue(
                    "invalid_dolt_repo_source_connection_ref",
                    format!(
                        "Node `{}` requires a non-empty string `connection_ref` config field.",
                        node.node_id
                    ),
                    Some(format!(
                        "workflow.nodes.{}.config.connection_ref",
                        node.node_id
                    )),
                ));
            }

            let repository = node.config.get("repository").and_then(Value::as_str);
            let Some(repository) = repository.map(str::trim).filter(|value| !value.is_empty())
            else {
                return Some(issue(
                    "invalid_dolt_repo_source_repository",
                    format!(
                        "Node `{}` requires a non-empty string `repository` config field.",
                        node.node_id
                    ),
                    Some(format!("workflow.nodes.{}.config.repository", node.node_id)),
                ));
            };

            let repository_parts = repository
                .split('/')
                .map(str::trim)
                .filter(|segment| !segment.is_empty())
                .collect::<Vec<_>>();
            if repository_parts.len() != 2 {
                return Some(issue(
                    "invalid_dolt_repo_source_repository",
                    format!(
                        "Node `{}` expects `repository` in `owner/repo` format.",
                        node.node_id
                    ),
                    Some(format!("workflow.nodes.{}.config.repository", node.node_id)),
                ));
            }

            let branch = node.config.get("branch").and_then(Value::as_str);
            if branch.map_or(true, |value| value.trim().is_empty()) {
                return Some(issue(
                    "invalid_dolt_repo_source_branch",
                    format!(
                        "Node `{}` requires a non-empty string `branch` config field.",
                        node.node_id
                    ),
                    Some(format!("workflow.nodes.{}.config.branch", node.node_id)),
                ));
            }

            if let Some(checkout_ref) = node.config.get("checkout_ref") {
                match checkout_ref.as_str() {
                    Some(_) => {}
                    None => {
                        return Some(issue(
                            "invalid_dolt_repo_source_checkout_ref",
                            format!(
                                "Node `{}` expects optional string `checkout_ref`.",
                                node.node_id
                            ),
                            Some(format!(
                                "workflow.nodes.{}.config.checkout_ref",
                                node.node_id
                            )),
                        ));
                    }
                }
            }

            if let Some(clone_mode) = node.config.get("clone_mode") {
                match clone_mode.as_str() {
                    Some("reuse_local_copy" | "fresh_clone" | "depth_1") => {}
                    _ => {
                        return Some(issue(
                            "invalid_dolt_repo_source_clone_mode",
                            format!(
                                "Node `{}` has unsupported `clone_mode` value.",
                                node.node_id
                            ),
                            Some(format!("workflow.nodes.{}.config.clone_mode", node.node_id)),
                        ));
                    }
                }
            }

            if let Some(sync_strategy) = node.config.get("sync_strategy") {
                match sync_strategy.as_str() {
                    Some("pull_before_execution" | "clone_only" | "manual") => {}
                    _ => {
                        return Some(issue(
                            "invalid_dolt_repo_source_sync_strategy",
                            format!(
                                "Node `{}` has unsupported `sync_strategy` value.",
                                node.node_id
                            ),
                            Some(format!(
                                "workflow.nodes.{}.config.sync_strategy",
                                node.node_id
                            )),
                        ));
                    }
                }
            }

            None
        }
        "checkpoint_read" => {
            let checkpoint_table = node.config.get("checkpoint_table").and_then(Value::as_str);
            if checkpoint_table.map_or(true, |value| value.trim().is_empty()) {
                return Some(issue(
                    "invalid_checkpoint_read_table",
                    format!(
                        "Node `{}` requires a non-empty string `checkpoint_table` config field.",
                        node.node_id
                    ),
                    Some(format!(
                        "workflow.nodes.{}.config.checkpoint_table",
                        node.node_id
                    )),
                ));
            }

            let source_repo = node.config.get("source_repo").and_then(Value::as_str);
            if source_repo.map_or(true, |value| value.trim().is_empty()) {
                return Some(issue(
                    "invalid_checkpoint_read_source_repo",
                    format!(
                        "Node `{}` requires a non-empty string `source_repo` config field.",
                        node.node_id
                    ),
                    Some(format!(
                        "workflow.nodes.{}.config.source_repo",
                        node.node_id
                    )),
                ));
            }

            let branch = node.config.get("branch").and_then(Value::as_str);
            if branch.map_or(true, |value| value.trim().is_empty()) {
                return Some(issue(
                    "invalid_checkpoint_read_branch",
                    format!(
                        "Node `{}` requires a non-empty string `branch` config field.",
                        node.node_id
                    ),
                    Some(format!("workflow.nodes.{}.config.branch", node.node_id)),
                ));
            }

            if let Some(emit_bootstrap_marker_if_missing) =
                node.config.get("emit_bootstrap_marker_if_missing")
            {
                if !emit_bootstrap_marker_if_missing.is_boolean() {
                    return Some(issue(
                        "invalid_checkpoint_read_emit_bootstrap_marker_if_missing",
                        format!(
                            "Node `{}` expects `emit_bootstrap_marker_if_missing` to be a boolean.",
                            node.node_id
                        ),
                        Some(format!(
                            "workflow.nodes.{}.config.emit_bootstrap_marker_if_missing",
                            node.node_id
                        )),
                    ));
                }
            }

            if let Some(fail_on_stale_checkpoint) = node.config.get("fail_on_stale_checkpoint") {
                if !fail_on_stale_checkpoint.is_boolean() {
                    return Some(issue(
                        "invalid_checkpoint_read_fail_on_stale_checkpoint",
                        format!(
                            "Node `{}` expects `fail_on_stale_checkpoint` to be a boolean.",
                            node.node_id
                        ),
                        Some(format!(
                            "workflow.nodes.{}.config.fail_on_stale_checkpoint",
                            node.node_id
                        )),
                    ));
                }
            }

            None
        }
        "checkpoint_write" => {
            let checkpoint_table = node.config.get("checkpoint_table").and_then(Value::as_str);
            if checkpoint_table.map_or(true, |value| value.trim().is_empty()) {
                return Some(issue(
                    "invalid_checkpoint_write_table",
                    format!(
                        "Node `{}` requires a non-empty string `checkpoint_table` config field.",
                        node.node_id
                    ),
                    Some(format!(
                        "workflow.nodes.{}.config.checkpoint_table",
                        node.node_id
                    )),
                ));
            }

            if let Some(commit_source) = node.config.get("commit_source") {
                match commit_source.as_str() {
                    Some("metadata.current_commit") => {}
                    _ => {
                        return Some(issue(
                            "invalid_checkpoint_write_commit_source",
                            format!(
                                "Node `{}` has unsupported `commit_source` value.",
                                node.node_id
                            ),
                            Some(format!(
                                "workflow.nodes.{}.config.commit_source",
                                node.node_id
                            )),
                        ));
                    }
                }
            }

            if let Some(write_timing) = node.config.get("write_timing") {
                match write_timing.as_str() {
                    Some("after_merge_success" | "after_quality_gate") => {}
                    _ => {
                        return Some(issue(
                            "invalid_checkpoint_write_timing",
                            format!(
                                "Node `{}` has unsupported `write_timing` value.",
                                node.node_id
                            ),
                            Some(format!(
                                "workflow.nodes.{}.config.write_timing",
                                node.node_id
                            )),
                        ));
                    }
                }
            }

            if let Some(only_persist_on_full_success) =
                node.config.get("only_persist_on_full_success")
            {
                if !only_persist_on_full_success.is_boolean() {
                    return Some(issue(
                        "invalid_checkpoint_write_only_persist_on_full_success",
                        format!(
                            "Node `{}` expects `only_persist_on_full_success` to be a boolean.",
                            node.node_id
                        ),
                        Some(format!(
                            "workflow.nodes.{}.config.only_persist_on_full_success",
                            node.node_id
                        )),
                    ));
                }
            }

            if let Some(advance_on_partial_success) = node.config.get("advance_on_partial_success")
            {
                if !advance_on_partial_success.is_boolean() {
                    return Some(issue(
                        "invalid_checkpoint_write_advance_on_partial_success",
                        format!(
                            "Node `{}` expects `advance_on_partial_success` to be a boolean.",
                            node.node_id
                        ),
                        Some(format!(
                            "workflow.nodes.{}.config.advance_on_partial_success",
                            node.node_id
                        )),
                    ));
                }
            }

            None
        }
        "quality_check" => {
            if let Some(suite_preset) = node.config.get("suite_preset") {
                match suite_preset.as_str() {
                    Some("post_merge_ingest_gate" | "custom_rule_bundle") => {}
                    _ => {
                        return Some(issue(
                            "invalid_quality_check_suite_preset",
                            format!(
                                "Node `{}` has unsupported `suite_preset` value.",
                                node.node_id
                            ),
                            Some(format!(
                                "workflow.nodes.{}.config.suite_preset",
                                node.node_id
                            )),
                        ));
                    }
                }
            }

            if let Some(schema_drift_rule) = node.config.get("schema_drift_rule") {
                match schema_drift_rule.as_str() {
                    Some("fail_on_required_column_drift" | "allow_additive_schema_notes") => {}
                    _ => {
                        return Some(issue(
                            "invalid_quality_check_schema_drift_rule",
                            format!(
                                "Node `{}` has unsupported `schema_drift_rule` value.",
                                node.node_id
                            ),
                            Some(format!(
                                "workflow.nodes.{}.config.schema_drift_rule",
                                node.node_id
                            )),
                        ));
                    }
                }
            }

            if let Some(null_key_policy) = node.config.get("null_key_policy") {
                match null_key_policy.as_str() {
                    Some("block_on_primary_key_nulls" | "allow_nulls_with_warning") => {}
                    _ => {
                        return Some(issue(
                            "invalid_quality_check_null_key_policy",
                            format!(
                                "Node `{}` has unsupported `null_key_policy` value.",
                                node.node_id
                            ),
                            Some(format!(
                                "workflow.nodes.{}.config.null_key_policy",
                                node.node_id
                            )),
                        ));
                    }
                }
            }

            if let Some(warning_budget) = node.config.get("warning_budget") {
                if warning_budget.as_u64().is_none() {
                    return Some(issue(
                        "invalid_quality_check_warning_budget",
                        format!(
                            "Node `{}` expects `warning_budget` to be a non-negative integer.",
                            node.node_id
                        ),
                        Some(format!(
                            "workflow.nodes.{}.config.warning_budget",
                            node.node_id
                        )),
                    ));
                }
            }

            if let Some(block_checkpoint_write_on_failure) =
                node.config.get("block_checkpoint_write_on_failure")
            {
                if !block_checkpoint_write_on_failure.is_boolean() {
                    return Some(issue(
                        "invalid_quality_check_block_checkpoint_write_on_failure",
                        format!(
                            "Node `{}` expects `block_checkpoint_write_on_failure` to be a boolean.",
                            node.node_id
                        ),
                        Some(format!(
                            "workflow.nodes.{}.config.block_checkpoint_write_on_failure",
                            node.node_id
                        )),
                    ));
                }
            }

            if let Some(allow_warning_only_runs_to_continue) =
                node.config.get("allow_warning_only_runs_to_continue")
            {
                if !allow_warning_only_runs_to_continue.is_boolean() {
                    return Some(issue(
                        "invalid_quality_check_allow_warning_only_runs_to_continue",
                        format!(
                            "Node `{}` expects `allow_warning_only_runs_to_continue` to be a boolean.",
                            node.node_id
                        ),
                        Some(format!(
                            "workflow.nodes.{}.config.allow_warning_only_runs_to_continue",
                            node.node_id
                        )),
                    ));
                }
            }

            None
        }
        "dolt_repo_sync" => {
            if let Some(sync_action) = node.config.get("sync_action") {
                match sync_action.as_str() {
                    Some("pull_remote_head" | "fetch_and_checkout" | "refresh_checkout") => {}
                    _ => {
                        return Some(issue(
                            "invalid_dolt_repo_sync_action",
                            format!(
                                "Node `{}` has unsupported `sync_action` value.",
                                node.node_id
                            ),
                            Some(format!(
                                "workflow.nodes.{}.config.sync_action",
                                node.node_id
                            )),
                        ));
                    }
                }
            }

            if let Some(no_change_behavior) = node.config.get("no_change_behavior") {
                match no_change_behavior.as_str() {
                    Some("emit_current_range" | "emit_no_op_marker") => {}
                    _ => {
                        return Some(issue(
                            "invalid_dolt_repo_sync_no_change_behavior",
                            format!(
                                "Node `{}` has unsupported `no_change_behavior` value.",
                                node.node_id
                            ),
                            Some(format!(
                                "workflow.nodes.{}.config.no_change_behavior",
                                node.node_id
                            )),
                        ));
                    }
                }
            }

            if let Some(branch_guard) = node.config.get("branch_guard") {
                match branch_guard.as_str() {
                    Some("require_tracked_branch_match" | "allow_detached_head") => {}
                    _ => {
                        return Some(issue(
                            "invalid_dolt_repo_sync_branch_guard",
                            format!(
                                "Node `{}` has unsupported `branch_guard` value.",
                                node.node_id
                            ),
                            Some(format!(
                                "workflow.nodes.{}.config.branch_guard",
                                node.node_id
                            )),
                        ));
                    }
                }
            }

            if let Some(dirty_working_copy_policy) = node.config.get("dirty_working_copy_policy") {
                match dirty_working_copy_policy.as_str() {
                    Some("fail_if_dirty" | "stash_and_continue") => {}
                    _ => {
                        return Some(issue(
                            "invalid_dolt_repo_sync_dirty_working_copy_policy",
                            format!(
                                "Node `{}` has unsupported `dirty_working_copy_policy` value.",
                                node.node_id
                            ),
                            Some(format!(
                                "workflow.nodes.{}.config.dirty_working_copy_policy",
                                node.node_id
                            )),
                        ));
                    }
                }
            }

            None
        }
        "dolt_change_manifest" => {
            if let Some(table_scope) = node.config.get("table_scope") {
                match table_scope.as_str() {
                    Some("all_tables" | "allowlist") => {}
                    _ => {
                        return Some(issue(
                            "invalid_dolt_change_manifest_table_scope",
                            format!(
                                "Node `{}` has unsupported `table_scope` value.",
                                node.node_id
                            ),
                            Some(format!(
                                "workflow.nodes.{}.config.table_scope",
                                node.node_id
                            )),
                        ));
                    }
                }
            }

            if let Some(schema_change_policy) = node.config.get("schema_change_policy") {
                match schema_change_policy.as_str() {
                    Some("flag_and_continue" | "fail_run") => {}
                    _ => {
                        return Some(issue(
                            "invalid_dolt_change_manifest_schema_change_policy",
                            format!(
                                "Node `{}` has unsupported `schema_change_policy` value.",
                                node.node_id
                            ),
                            Some(format!(
                                "workflow.nodes.{}.config.schema_change_policy",
                                node.node_id
                            )),
                        ));
                    }
                }
            }

            if let Some(selected_tables) = node.config.get("selected_tables") {
                match selected_tables.as_array() {
                    Some(values)
                        if values.iter().all(|value| {
                            value
                                .as_str()
                                .map(|candidate| !candidate.trim().is_empty())
                                .unwrap_or(false)
                        }) => {}
                    Some(values) if values.is_empty() => {}
                    _ => {
                        return Some(issue(
                            "invalid_dolt_change_manifest_selected_tables",
                            format!(
                                "Node `{}` must store `selected_tables` as an array of non-empty table names.",
                                node.node_id
                            ),
                            Some(format!(
                                "workflow.nodes.{}.config.selected_tables",
                                node.node_id
                            )),
                        ));
                    }
                }
            }

            None
        }
        "table_schema" => {
            if let Some(catalog) = node.config.get("catalog") {
                match catalog.as_str() {
                    Some(value) if !value.trim().is_empty() => {}
                    _ => {
                        return Some(issue(
                            "invalid_table_schema_catalog",
                            format!(
                                "Node `{}` expects non-empty string `catalog` when provided.",
                                node.node_id
                            ),
                            Some(format!("workflow.nodes.{}.config.catalog", node.node_id)),
                        ));
                    }
                }
            }

            let schema_name = node.config.get("schema_name").and_then(Value::as_str);
            if schema_name.map_or(true, |value| value.trim().is_empty()) {
                return Some(issue(
                    "invalid_table_schema_name",
                    format!(
                        "Node `{}` requires a non-empty string `schema_name` config field.",
                        node.node_id
                    ),
                    Some(format!(
                        "workflow.nodes.{}.config.schema_name",
                        node.node_id
                    )),
                ));
            }

            let table_name = node.config.get("table_name").and_then(Value::as_str);
            if table_name.map_or(true, |value| value.trim().is_empty()) {
                return Some(issue(
                    "invalid_table_schema_table_name",
                    format!(
                        "Node `{}` requires a non-empty string `table_name` config field.",
                        node.node_id
                    ),
                    Some(format!("workflow.nodes.{}.config.table_name", node.node_id)),
                ));
            }

            if let Some(output_alias) = node.config.get("output_alias") {
                match output_alias.as_str() {
                    Some(value) if !value.trim().is_empty() => {}
                    _ => {
                        return Some(issue(
                            "invalid_table_schema_output_alias",
                            format!(
                                "Node `{}` expects non-empty string `output_alias` when provided.",
                                node.node_id
                            ),
                            Some(format!(
                                "workflow.nodes.{}.config.output_alias",
                                node.node_id
                            )),
                        ));
                    }
                }
            }

            let Some(columns) = node.config.get("columns").and_then(Value::as_array) else {
                return Some(issue(
                    "invalid_table_schema_columns",
                    format!(
                        "Node `{}` requires `columns` to be an array of column objects.",
                        node.node_id
                    ),
                    Some(format!("workflow.nodes.{}.config.columns", node.node_id)),
                ));
            };

            if columns.is_empty() {
                return Some(issue(
                    "invalid_table_schema_columns",
                    format!(
                        "Node `{}` requires at least one column definition.",
                        node.node_id
                    ),
                    Some(format!("workflow.nodes.{}.config.columns", node.node_id)),
                ));
            }

            let mut column_names = BTreeSet::new();
            for (index, column) in columns.iter().enumerate() {
                let Some(column_object) = column.as_object() else {
                    return Some(issue(
                        "invalid_table_schema_column",
                        format!(
                            "Node `{}` expects every column entry to be an object.",
                            node.node_id
                        ),
                        Some(format!(
                            "workflow.nodes.{}.config.columns.{}",
                            node.node_id, index
                        )),
                    ));
                };

                let column_name = column_object.get("name").and_then(Value::as_str);
                let Some(column_name) =
                    column_name.map(str::trim).filter(|value| !value.is_empty())
                else {
                    return Some(issue(
                        "invalid_table_schema_column_name",
                        format!(
                            "Node `{}` expects every column entry to include a non-empty string `name`.",
                            node.node_id
                        ),
                        Some(format!(
                            "workflow.nodes.{}.config.columns.{}.name",
                            node.node_id, index
                        )),
                    ));
                };

                if !column_names.insert(column_name.to_string()) {
                    return Some(issue(
                        "duplicate_table_schema_column_name",
                        format!(
                            "Node `{}` defines duplicate column name `{}`.",
                            node.node_id, column_name
                        ),
                        Some(format!(
                            "workflow.nodes.{}.config.columns.{}.name",
                            node.node_id, index
                        )),
                    ));
                }

                let column_type = column_object.get("type").and_then(Value::as_str);
                if column_type
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .is_none()
                {
                    return Some(issue(
                        "invalid_table_schema_column_type",
                        format!(
                            "Node `{}` expects every column entry to include a non-empty string `type`.",
                            node.node_id
                        ),
                        Some(format!(
                            "workflow.nodes.{}.config.columns.{}.type",
                            node.node_id, index
                        )),
                    ));
                }

                for key in ["nullable", "primary_key"] {
                    if let Some(value) = column_object.get(key) {
                        if !value.is_boolean() {
                            return Some(issue(
                                "invalid_table_schema_column_flag",
                                format!(
                                    "Node `{}` expects boolean `{key}` when provided for every column.",
                                    node.node_id
                                ),
                                Some(format!(
                                    "workflow.nodes.{}.config.columns.{}.{}",
                                    node.node_id, index, key
                                )),
                            ));
                        }
                    }
                }

                if let Some(default_value) = column_object.get("default") {
                    if !default_value.is_string() {
                        return Some(issue(
                            "invalid_table_schema_column_default",
                            format!(
                                "Node `{}` expects optional string `default` for each column.",
                                node.node_id
                            ),
                            Some(format!(
                                "workflow.nodes.{}.config.columns.{}.default",
                                node.node_id, index
                            )),
                        ));
                    }
                }
            }

            if let Some(primary_key) = node.config.get("primary_key") {
                let Some(columns) = primary_key.as_array() else {
                    return Some(issue(
                        "invalid_table_schema_primary_key",
                        format!(
                            "Node `{}` expects `primary_key` to be an array of strings.",
                            node.node_id
                        ),
                        Some(format!(
                            "workflow.nodes.{}.config.primary_key",
                            node.node_id
                        )),
                    ));
                };

                for (index, column) in columns.iter().enumerate() {
                    let Some(column_name) = column
                        .as_str()
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                    else {
                        return Some(issue(
                            "invalid_table_schema_primary_key",
                            format!(
                                "Node `{}` expects every `primary_key` entry to be a non-empty string.",
                                node.node_id
                            ),
                            Some(format!(
                                "workflow.nodes.{}.config.primary_key.{}",
                                node.node_id, index
                            )),
                        ));
                    };

                    if !column_names.contains(column_name) {
                        return Some(issue(
                            "invalid_table_schema_primary_key_column",
                            format!(
                                "Node `{}` references unknown primary key column `{}`.",
                                node.node_id, column_name
                            ),
                            Some(format!(
                                "workflow.nodes.{}.config.primary_key.{}",
                                node.node_id, index
                            )),
                        ));
                    }
                }
            }

            if let Some(checks) = node.config.get("checks") {
                let Some(check_expressions) = checks.as_array() else {
                    return Some(issue(
                        "invalid_table_schema_checks",
                        format!(
                            "Node `{}` expects `checks` to be an array of strings.",
                            node.node_id
                        ),
                        Some(format!("workflow.nodes.{}.config.checks", node.node_id)),
                    ));
                };

                if check_expressions.iter().any(|value| {
                    value
                        .as_str()
                        .map(str::trim)
                        .filter(|expression| !expression.is_empty())
                        .is_none()
                }) {
                    return Some(issue(
                        "invalid_table_schema_checks",
                        format!(
                            "Node `{}` expects every `checks` entry to be a non-empty string.",
                            node.node_id
                        ),
                        Some(format!("workflow.nodes.{}.config.checks", node.node_id)),
                    ));
                }
            }

            for (key, code) in [
                ("create_mode", "invalid_table_schema_create_mode"),
                ("if_target_exists", "invalid_table_schema_if_target_exists"),
            ] {
                if let Some(value) = node.config.get(key) {
                    match value.as_str() {
                        Some(text) if !text.trim().is_empty() => {}
                        _ => {
                            return Some(issue(
                                code,
                                format!(
                                    "Node `{}` expects non-empty string `{key}` when provided.",
                                    node.node_id
                                ),
                                Some(format!("workflow.nodes.{}.config.{key}", node.node_id)),
                            ));
                        }
                    }
                }
            }

            if let Some(value) = node.config.get("open_in_catalog") {
                if !value.is_boolean() {
                    return Some(issue(
                        "invalid_table_schema_open_in_catalog",
                        format!(
                            "Node `{}` expects boolean `open_in_catalog` when provided.",
                            node.node_id
                        ),
                        Some(format!(
                            "workflow.nodes.{}.config.open_in_catalog",
                            node.node_id
                        )),
                    ));
                }
            }

            None
        }
        "table_output" => {
            let target_schema = node.config.get("target_schema").and_then(Value::as_str);
            if target_schema.map_or(true, |value| value.trim().is_empty()) {
                return Some(issue(
                    "invalid_table_output_target_schema",
                    format!(
                        "Node `{}` requires a non-empty string `target_schema` config field.",
                        node.node_id
                    ),
                    Some(format!(
                        "workflow.nodes.{}.config.target_schema",
                        node.node_id
                    )),
                ));
            }

            let table_name = node.config.get("table_name").and_then(Value::as_str);
            if table_name.map_or(true, |value| value.trim().is_empty()) {
                return Some(issue(
                    "invalid_table_output_table_name",
                    format!(
                        "Node `{}` requires a non-empty string `table_name` config field.",
                        node.node_id
                    ),
                    Some(format!("workflow.nodes.{}.config.table_name", node.node_id)),
                ));
            }

            if let Some(write_mode) = node.config.get("write_mode") {
                match write_mode.as_str() {
                    Some("append" | "replace") => {}
                    _ => {
                        return Some(issue(
                            "invalid_table_output_write_mode",
                            format!(
                                "Node `{}` has unsupported `write_mode` value.",
                                node.node_id
                            ),
                            Some(format!("workflow.nodes.{}.config.write_mode", node.node_id)),
                        ));
                    }
                }
            }

            if let Some(input_shape) = node.config.get("input_shape") {
                match input_shape.as_str() {
                    Some("single_text_row" | "source_table" | "table_schema") => {}
                    _ => {
                        return Some(issue(
                            "invalid_table_output_input_shape",
                            format!(
                                "Node `{}` has unsupported `input_shape` value.",
                                node.node_id
                            ),
                            Some(format!(
                                "workflow.nodes.{}.config.input_shape",
                                node.node_id
                            )),
                        ));
                    }
                }
            }

            if let Some(value_column) = node.config.get("value_column") {
                match value_column.as_str() {
                    Some(value) if !value.trim().is_empty() => {}
                    _ => {
                        return Some(issue(
                            "invalid_table_output_value_column",
                            format!(
                                "Node `{}` expects non-empty string `value_column` when provided.",
                                node.node_id
                            ),
                            Some(format!(
                                "workflow.nodes.{}.config.value_column",
                                node.node_id
                            )),
                        ));
                    }
                }
            }

            for (key, code) in [
                ("include_run_id", "invalid_table_output_include_run_id"),
                (
                    "include_written_at",
                    "invalid_table_output_include_written_at",
                ),
                ("open_in_catalog", "invalid_table_output_open_in_catalog"),
            ] {
                if let Some(value) = node.config.get(key) {
                    if !value.is_boolean() {
                        return Some(issue(
                            code,
                            format!(
                                "Node `{}` expects boolean `{key}` when provided.",
                                node.node_id
                            ),
                            Some(format!("workflow.nodes.{}.config.{key}", node.node_id)),
                        ));
                    }
                }
            }

            None
        }
        "send_email" => {
            let to = node.config.get("to").and_then(Value::as_str);
            if to.is_none() {
                return Some(issue(
                    "invalid_send_email_recipient",
                    format!(
                        "Node `{}` requires a string `to` config field.",
                        node.node_id
                    ),
                    Some(format!("workflow.nodes.{}.config.to", node.node_id)),
                ));
            }

            let subject = node.config.get("subject").and_then(Value::as_str);
            if subject.is_none() {
                return Some(issue(
                    "invalid_send_email_subject",
                    format!(
                        "Node `{}` requires a string `subject` config field.",
                        node.node_id
                    ),
                    Some(format!("workflow.nodes.{}.config.subject", node.node_id)),
                ));
            }

            if let Some(body) = node.config.get("body") {
                if !body.is_string() {
                    return Some(issue(
                        "invalid_send_email_body",
                        format!("Node `{}` expects optional string `body`.", node.node_id),
                        Some(format!("workflow.nodes.{}.config.body", node.node_id)),
                    ));
                }
            }

            if let Some(body_text) = node.config.get("body_text") {
                if !body_text.is_string() {
                    return Some(issue(
                        "invalid_send_email_body_text",
                        format!(
                            "Node `{}` expects optional string `body_text`.",
                            node.node_id
                        ),
                        Some(format!("workflow.nodes.{}.config.body_text", node.node_id)),
                    ));
                }
            }

            if let Some(body_mode) = node.config.get("body_mode") {
                match body_mode.as_str() {
                    Some("input" | "custom") => {}
                    _ => {
                        return Some(issue(
                            "invalid_send_email_body_mode",
                            format!("Node `{}` has unsupported `body_mode` value.", node.node_id),
                            Some(format!("workflow.nodes.{}.config.body_mode", node.node_id)),
                        ));
                    }
                }
            }

            if let Some(connection_id) = node.config.get("connection_id") {
                if !connection_id.is_string() {
                    return Some(issue(
                        "invalid_send_email_connection_id",
                        format!(
                            "Node `{}` expects optional string `connection_id`.",
                            node.node_id
                        ),
                        Some(format!(
                            "workflow.nodes.{}.config.connection_id",
                            node.node_id
                        )),
                    ));
                }
            }

            if let Some(content_type) = node.config.get("content_type") {
                match content_type.as_str() {
                    Some("text/plain" | "text/html") => {}
                    _ => {
                        return Some(issue(
                            "invalid_send_email_content_type",
                            format!(
                                "Node `{}` has unsupported `content_type` value.",
                                node.node_id
                            ),
                            Some(format!(
                                "workflow.nodes.{}.config.content_type",
                                node.node_id
                            )),
                        ));
                    }
                }
            }

            None
        }
        "dolt_dump" => {
            if let Some(output_format) = node.config.get("output_format") {
                match output_format.as_str() {
                    Some("csv" | "parquet") => {}
                    _ => {
                        return Some(issue(
                            "invalid_dolt_dump_output_format",
                            format!(
                                "Node `{}` has unsupported `output_format` value.",
                                node.node_id
                            ),
                            Some(format!(
                                "workflow.nodes.{}.config.output_format",
                                node.node_id
                            )),
                        ));
                    }
                }
            }

            if let Some(table_selection_mode) = node.config.get("table_selection_mode") {
                match table_selection_mode.as_str() {
                    Some("prefer_manifest_scope" | "all_tables" | "manual_tables") => {}
                    _ => {
                        return Some(issue(
                            "invalid_dolt_dump_table_selection_mode",
                            format!(
                                "Node `{}` has unsupported `table_selection_mode` value.",
                                node.node_id
                            ),
                            Some(format!(
                                "workflow.nodes.{}.config.table_selection_mode",
                                node.node_id
                            )),
                        ));
                    }
                }
            }

            if let Some(selected_tables) = node.config.get("selected_tables") {
                match selected_tables.as_array() {
                    Some(values)
                        if values.iter().all(|value| {
                            value
                                .as_str()
                                .map(|candidate| !candidate.trim().is_empty())
                                .unwrap_or(false)
                        }) => {}
                    Some(values) if values.is_empty() => {}
                    _ => {
                        return Some(issue(
                            "invalid_dolt_dump_selected_tables",
                            format!(
                                "Node `{}` must store `selected_tables` as an array of non-empty table names.",
                                node.node_id
                            ),
                            Some(format!(
                                "workflow.nodes.{}.config.selected_tables",
                                node.node_id
                            )),
                        ));
                    }
                }
            }

            if let Some(artifact_retention) = node.config.get("artifact_retention") {
                match artifact_retention.as_str() {
                    Some("keep_latest_success" | "ephemeral_per_run" | "persist_all") => {}
                    _ => {
                        return Some(issue(
                            "invalid_dolt_dump_artifact_retention",
                            format!(
                                "Node `{}` has unsupported `artifact_retention` value.",
                                node.node_id
                            ),
                            Some(format!(
                                "workflow.nodes.{}.config.artifact_retention",
                                node.node_id
                            )),
                        ));
                    }
                }
            }

            if let Some(output_directory_policy) = node.config.get("output_directory_policy") {
                match output_directory_policy.as_str() {
                    Some("ephemeral_run_bundle" | "stable_repo_cache") => {}
                    _ => {
                        return Some(issue(
                            "invalid_dolt_dump_output_directory_policy",
                            format!(
                                "Node `{}` has unsupported `output_directory_policy` value.",
                                node.node_id
                            ),
                            Some(format!(
                                "workflow.nodes.{}.config.output_directory_policy",
                                node.node_id
                            )),
                        ));
                    }
                }
            }

            None
        }
        "dolt_diff_export" => {
            if let Some(output_format) = node.config.get("output_format") {
                match output_format.as_str() {
                    Some("csv" | "parquet") => {}
                    _ => {
                        return Some(issue(
                            "invalid_dolt_diff_export_output_format",
                            format!(
                                "Node `{}` has unsupported `output_format` value.",
                                node.node_id
                            ),
                            Some(format!(
                                "workflow.nodes.{}.config.output_format",
                                node.node_id
                            )),
                        ));
                    }
                }
            }

            if let Some(change_filter) = node.config.get("change_filter") {
                match change_filter.as_str() {
                    Some(
                        "all_changes" | "non_delete_changes" | "added_only" | "modified_only"
                        | "removed_only",
                    ) => {}
                    _ => {
                        return Some(issue(
                            "invalid_dolt_diff_export_change_filter",
                            format!(
                                "Node `{}` has unsupported `change_filter` value.",
                                node.node_id
                            ),
                            Some(format!(
                                "workflow.nodes.{}.config.change_filter",
                                node.node_id
                            )),
                        ));
                    }
                }
            }

            if let Some(deleted_row_handling) = node.config.get("deleted_row_handling") {
                match deleted_row_handling.as_str() {
                    Some("emit_delete_markers" | "omit_delete_rows") => {}
                    _ => {
                        return Some(issue(
                            "invalid_dolt_diff_export_deleted_row_handling",
                            format!(
                                "Node `{}` has unsupported `deleted_row_handling` value.",
                                node.node_id
                            ),
                            Some(format!(
                                "workflow.nodes.{}.config.deleted_row_handling",
                                node.node_id
                            )),
                        ));
                    }
                }
            }

            None
        }
        "load_to_duckdb" => {
            let target_schema = node.config.get("target_schema").and_then(Value::as_str);
            if target_schema.map_or(true, |value| value.trim().is_empty()) {
                return Some(issue(
                    "invalid_load_to_duckdb_target_schema",
                    format!(
                        "Node `{}` requires a non-empty string `target_schema` config field.",
                        node.node_id
                    ),
                    Some(format!(
                        "workflow.nodes.{}.config.target_schema",
                        node.node_id
                    )),
                ));
            }

            if let Some(table_mapping) = node.config.get("table_mapping") {
                match table_mapping.as_str() {
                    Some("bundle_aware_staging_names") => {}
                    _ => {
                        return Some(issue(
                            "invalid_load_to_duckdb_table_mapping",
                            format!(
                                "Node `{}` has unsupported `table_mapping` value.",
                                node.node_id
                            ),
                            Some(format!(
                                "workflow.nodes.{}.config.table_mapping",
                                node.node_id
                            )),
                        ));
                    }
                }
            }

            if let Some(schema_handling) = node.config.get("schema_handling") {
                match schema_handling.as_str() {
                    Some("infer_on_first_load_validate_on_recurring") => {}
                    _ => {
                        return Some(issue(
                            "invalid_load_to_duckdb_schema_handling",
                            format!(
                                "Node `{}` has unsupported `schema_handling` value.",
                                node.node_id
                            ),
                            Some(format!(
                                "workflow.nodes.{}.config.schema_handling",
                                node.node_id
                            )),
                        ));
                    }
                }
            }

            if let Some(delta_context_preservation) = node.config.get("delta_context_preservation")
            {
                match delta_context_preservation.as_str() {
                    Some("preserve_commit_range_and_delete_flags") => {}
                    _ => {
                        return Some(issue(
                            "invalid_load_to_duckdb_delta_context_preservation",
                            format!(
                                "Node `{}` has unsupported `delta_context_preservation` value.",
                                node.node_id
                            ),
                            Some(format!(
                                "workflow.nodes.{}.config.delta_context_preservation",
                                node.node_id
                            )),
                        ));
                    }
                }
            }

            None
        }
        "sql_transform" => {
            let target_schema = node.config.get("target_schema").and_then(Value::as_str);
            if target_schema.map_or(true, |value| value.trim().is_empty()) {
                return Some(issue(
                    "invalid_sql_transform_target_schema",
                    format!(
                        "Node `{}` requires a non-empty string `target_schema` config field.",
                        node.node_id
                    ),
                    Some(format!(
                        "workflow.nodes.{}.config.target_schema",
                        node.node_id
                    )),
                ));
            }

            let output_table_name = node.config.get("output_table_name").and_then(Value::as_str);
            let output_table_name_template = node
                .config
                .get("output_table_name_template")
                .and_then(Value::as_str);
            let has_output_table_name = output_table_name
                .map(str::trim)
                .map(|value| !value.is_empty())
                .unwrap_or(false);
            let has_output_table_name_template = output_table_name_template
                .map(str::trim)
                .map(|value| !value.is_empty())
                .unwrap_or(false);
            if !has_output_table_name && !has_output_table_name_template {
                return Some(issue(
                    "invalid_sql_transform_output_table_name",
                    format!(
                        "Node `{}` requires either non-empty `output_table_name` or `output_table_name_template` config field.",
                        node.node_id
                    ),
                    Some(format!(
                        "workflow.nodes.{}.config.output_table_name_template",
                        node.node_id
                    )),
                ));
            }

            let sql_text = node.config.get("sql_text").and_then(Value::as_str);
            if sql_text.map_or(true, |value| value.trim().is_empty()) {
                return Some(issue(
                    "invalid_sql_transform_sql_text",
                    format!(
                        "Node `{}` requires a non-empty string `sql_text` config field.",
                        node.node_id
                    ),
                    Some(format!("workflow.nodes.{}.config.sql_text", node.node_id)),
                ));
            }

            if let Some(materialization_mode) = node.config.get("materialization_mode") {
                match materialization_mode.as_str() {
                    Some("view") => {}
                    _ => {
                        return Some(issue(
                            "invalid_sql_transform_materialization_mode",
                            format!(
                                "Node `{}` has unsupported `materialization_mode` value.",
                                node.node_id
                            ),
                            Some(format!(
                                "workflow.nodes.{}.config.materialization_mode",
                                node.node_id
                            )),
                        ));
                    }
                }
            }

            None
        }
        "table_merge" => {
            let target_schema = node.config.get("target_schema").and_then(Value::as_str);
            if target_schema.map_or(true, |value| value.trim().is_empty()) {
                return Some(issue(
                    "invalid_table_merge_target_schema",
                    format!(
                        "Node `{}` requires a non-empty string `target_schema` config field.",
                        node.node_id
                    ),
                    Some(format!(
                        "workflow.nodes.{}.config.target_schema",
                        node.node_id
                    )),
                ));
            }

            if let Some(write_policy) = node.config.get("write_policy") {
                match write_policy.as_str() {
                    Some("upsert" | "append_only" | "snapshot_replace") => {}
                    _ => {
                        return Some(issue(
                            "invalid_table_merge_write_policy",
                            format!(
                                "Node `{}` has unsupported `write_policy` value.",
                                node.node_id
                            ),
                            Some(format!(
                                "workflow.nodes.{}.config.write_policy",
                                node.node_id
                            )),
                        ));
                    }
                }
            }

            if let Some(merge_key_columns) = node.config.get("merge_key_columns") {
                match merge_key_columns {
                    Value::Array(entries)
                        if entries.iter().all(|entry| {
                            entry
                                .as_str()
                                .map(|value| !value.trim().is_empty())
                                .unwrap_or(false)
                        }) => {}
                    Value::Array(_) => {
                        return Some(issue(
                            "invalid_table_merge_key_columns",
                            format!(
                                "Node `{}` expects `merge_key_columns` to contain only non-empty strings.",
                                node.node_id
                            ),
                            Some(format!(
                                "workflow.nodes.{}.config.merge_key_columns",
                                node.node_id
                            )),
                        ));
                    }
                    _ => {
                        return Some(issue(
                            "invalid_table_merge_key_columns",
                            format!(
                                "Node `{}` expects `merge_key_columns` to be an array of strings.",
                                node.node_id
                            ),
                            Some(format!(
                                "workflow.nodes.{}.config.merge_key_columns",
                                node.node_id
                            )),
                        ));
                    }
                }
            }

            if let Some(merge_keys_by_table) = node.config.get("merge_keys_by_table") {
                match merge_keys_by_table {
                    Value::Object(entries)
                        if entries.iter().all(|(table_name, columns)| {
                            !table_name.trim().is_empty()
                                && columns.as_array().map(|columns| {
                                    !columns.is_empty()
                                        && columns.iter().all(|column| {
                                            column
                                                .as_str()
                                                .map(|value| !value.trim().is_empty())
                                                .unwrap_or(false)
                                        })
                                }).unwrap_or(false)
                        }) => {}
                    Value::Object(_) => {
                        return Some(issue(
                            "invalid_table_merge_keys_by_table",
                            format!(
                                "Node `{}` expects `merge_keys_by_table` to map table names to non-empty arrays of non-empty key column strings.",
                                node.node_id
                            ),
                            Some(format!(
                                "workflow.nodes.{}.config.merge_keys_by_table",
                                node.node_id
                            )),
                        ));
                    }
                    _ => {
                        return Some(issue(
                            "invalid_table_merge_keys_by_table",
                            format!(
                                "Node `{}` expects `merge_keys_by_table` to be an object like `{{ \"orders_fact\": [\"order_id\"] }}`.",
                                node.node_id
                            ),
                            Some(format!(
                                "workflow.nodes.{}.config.merge_keys_by_table",
                                node.node_id
                            )),
                        ));
                    }
                }
            }

            if let Some(delete_handling) = node.config.get("delete_handling") {
                match delete_handling.as_str() {
                    Some("apply_delete_markers" | "ignore_delete_markers") => {}
                    _ => {
                        return Some(issue(
                            "invalid_table_merge_delete_handling",
                            format!(
                                "Node `{}` has unsupported `delete_handling` value.",
                                node.node_id
                            ),
                            Some(format!(
                                "workflow.nodes.{}.config.delete_handling",
                                node.node_id
                            )),
                        ));
                    }
                }
            }

            if let Some(schema_drift_behavior) = node.config.get("schema_drift_behavior") {
                match schema_drift_behavior.as_str() {
                    Some("fail_and_require_review" | "allow_additive_changes") => {}
                    _ => {
                        return Some(issue(
                            "invalid_table_merge_schema_drift_behavior",
                            format!(
                                "Node `{}` has unsupported `schema_drift_behavior` value.",
                                node.node_id
                            ),
                            Some(format!(
                                "workflow.nodes.{}.config.schema_drift_behavior",
                                node.node_id
                            )),
                        ));
                    }
                }
            }

            None
        }
        _ => None,
    }
}

fn ports_are_compatible(
    source_node: &WorkflowNode,
    source_port: &node_registry::PortDefinition,
    target_node: &WorkflowNode,
    target_port: &node_registry::PortDefinition,
) -> bool {
    if target_node.type_id == "quality_check" && target_port.port_id == "table" {
        return source_node.type_id == "table_merge"
            && source_port.data_type == workflow_schema::DataType::TableRef;
    }

    if target_node.type_id == "checkpoint_write" && target_port.port_id == "table" {
        return (source_node.type_id == "table_merge" || source_node.type_id == "quality_check")
            && source_port.data_type == workflow_schema::DataType::TableRef;
    }

    if source_port.data_type == target_port.data_type {
        return true;
    }

    target_node.type_id == "table_output"
        && target_port.port_id == "text"
        && source_port.data_type == workflow_schema::DataType::TableRef
}

#[derive(Clone, Copy, Debug, Default)]
struct NodeExecutionTiming {
    wait_before_seconds: f64,
    wait_after_seconds: f64,
}

impl NodeExecutionTiming {
    fn before_duration(&self) -> Option<Duration> {
        duration_from_seconds(self.wait_before_seconds)
    }

    fn after_duration(&self) -> Option<Duration> {
        duration_from_seconds(self.wait_after_seconds)
    }
}

fn node_execution_timing(node: &WorkflowNode) -> NodeExecutionTiming {
    let execution = node.config.get("execution").and_then(Value::as_object);

    NodeExecutionTiming {
        wait_before_seconds: execution
            .and_then(|config| config.get("wait_before_seconds"))
            .and_then(Value::as_f64)
            .filter(|value| value.is_finite() && *value > 0.0)
            .unwrap_or(0.0),
        wait_after_seconds: execution
            .and_then(|config| config.get("wait_after_seconds"))
            .and_then(Value::as_f64)
            .filter(|value| value.is_finite() && *value > 0.0)
            .unwrap_or(0.0),
    }
}

fn validate_execution_timing_config(node: &WorkflowNode) -> Option<ValidationIssue> {
    let Some(execution) = node.config.get("execution") else {
        return None;
    };

    let execution_object = execution.as_object().ok_or_else(|| {
        issue(
            "invalid_node_execution_config",
            format!(
                "Node `{}` expects optional object `execution` when provided.",
                node.node_id
            ),
            Some(format!("workflow.nodes.{}.config.execution", node.node_id)),
        )
    });

    let execution_object = match execution_object {
        Ok(value) => value,
        Err(issue) => return Some(issue),
    };

    for field_name in ["wait_before_seconds", "wait_after_seconds"] {
        let Some(value) = execution_object.get(field_name) else {
            continue;
        };

        let Some(seconds) = value.as_f64() else {
            return Some(issue(
                "invalid_node_execution_wait",
                format!(
                    "Node `{}` expects numeric `execution.{field_name}` when provided.",
                    node.node_id
                ),
                Some(format!(
                    "workflow.nodes.{}.config.execution.{field_name}",
                    node.node_id
                )),
            ));
        };

        if !seconds.is_finite() || seconds < 0.0 {
            return Some(issue(
                "invalid_node_execution_wait",
                format!(
                    "Node `{}` requires non-negative finite `execution.{field_name}`.",
                    node.node_id
                ),
                Some(format!(
                    "workflow.nodes.{}.config.execution.{field_name}",
                    node.node_id
                )),
            ));
        }
    }

    None
}

fn duration_from_seconds(seconds: f64) -> Option<Duration> {
    if !seconds.is_finite() || seconds <= 0.0 {
        return None;
    }

    Some(Duration::from_secs_f64(seconds))
}

fn format_execution_wait_seconds(seconds: f64) -> String {
    if (seconds.fract()).abs() < f64::EPSILON {
        format!("{seconds:.0}s")
    } else {
        format!("{seconds:.2}s")
    }
}

fn topological_order(workflow: &WorkflowDefinition) -> Result<Vec<String>, ValidationIssue> {
    let mut indegree = workflow
        .nodes
        .iter()
        .map(|node| (node.node_id.clone(), 0usize))
        .collect::<HashMap<_, _>>();
    let mut adjacency = workflow
        .nodes
        .iter()
        .map(|node| (node.node_id.clone(), Vec::<String>::new()))
        .collect::<HashMap<_, _>>();

    for edge in &workflow.edges {
        if let Some(target) = indegree.get_mut(&edge.target_node_id) {
            *target += 1;
        }
        adjacency
            .entry(edge.source_node_id.clone())
            .or_default()
            .push(edge.target_node_id.clone());
    }

    let mut queue = workflow
        .nodes
        .iter()
        .filter(|node| indegree.get(&node.node_id).copied().unwrap_or_default() == 0)
        .map(|node| node.node_id.clone())
        .collect::<VecDeque<_>>();
    let mut ordered = Vec::new();

    while let Some(node_id) = queue.pop_front() {
        ordered.push(node_id.clone());
        if let Some(children) = adjacency.get(&node_id) {
            for child in children {
                if let Some(count) = indegree.get_mut(child) {
                    *count -= 1;
                    if *count == 0 {
                        queue.push_back(child.clone());
                    }
                }
            }
        }
    }

    if ordered.len() != workflow.nodes.len() {
        return Err(issue(
            "cyclic_workflow",
            "Workflow graph contains a cycle and cannot be planned.".to_string(),
            Some("workflow.edges".to_string()),
        ));
    }

    Ok(ordered)
}

fn collect_inputs(
    node: &WorkflowNode,
    workflow: &WorkflowDefinition,
    outputs: &BTreeMap<(String, String), workflow_schema::TypedValue>,
) -> Result<PortValues, String> {
    let mut inputs = PortValues::new();
    for edge in workflow
        .edges
        .iter()
        .filter(|edge| edge.target_node_id == node.node_id)
    {
        let Some(value) = outputs.get(&(edge.source_node_id.clone(), edge.source_port_id.clone()))
        else {
            return Err(format!(
                "Node `{}` is missing upstream output from `{}.{}`.",
                node.node_id, edge.source_node_id, edge.source_port_id
            ));
        };
        inputs.insert(edge.target_port_id.clone(), value.clone());
    }
    Ok(inputs)
}

fn run_target() -> EventTarget {
    EventTarget {
        kind: EventTargetKind::Run,
        node_id: None,
    }
}

fn node_target(node_id: &str) -> EventTarget {
    EventTarget {
        kind: EventTargetKind::Node,
        node_id: Some(node_id.to_string()),
    }
}

fn to_run_error(issue: ValidationIssue, category: RunErrorCategory) -> RunErrorSummary {
    RunErrorSummary {
        category,
        message: issue.message,
    }
}

fn cancelled_run_error() -> RunErrorSummary {
    RunErrorSummary {
        category: RunErrorCategory::Cancellation,
        message: "Run cancelled by user.".to_string(),
    }
}

fn is_terminal_run_status(status: &RunStatus) -> bool {
    matches!(
        status,
        RunStatus::Succeeded | RunStatus::Failed | RunStatus::Cancelled
    )
}

fn to_run_error_from_adapter(node: &WorkflowNode, error: AdapterError) -> RunErrorSummary {
    let category = match &error {
        AdapterError::UnsupportedNode(_) => RunErrorCategory::AdapterResolutionError,
        AdapterError::ConnectionFailed { .. } => RunErrorCategory::ConnectionError,
        AdapterError::ExecutionFailed { .. }
        | AdapterError::InvalidConfig { .. }
        | AdapterError::MissingInput { .. }
        | AdapterError::TextTypeMismatch { .. }
        | AdapterError::DatasetRefTypeMismatch { .. } => RunErrorCategory::ExecutionError,
    };

    RunErrorSummary {
        category,
        message: format!("Node `{}` failed: {error}", node.node_id),
    }
}

#[cfg(test)]
mod tests {
    use std::{
        env, fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    use api_contract::{CreateRunRequest, RunStatus};
    use duckdb::Connection as DuckDbConnection;
    use serde_json::json;
    use tokio::time::{sleep, Duration};
    use workflow_schema::{NodePosition, WorkflowDefinition, WorkflowEdge, WorkflowNode};

    use super::{RuntimeService, INTERNAL_PARAM_WORKFLOW_DUCKDB_PATH};

    fn unique_test_duckdb_path(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        env::temp_dir().join(format!(
            "stitchly_{label}_{}_{}.duckdb",
            std::process::id(),
            nanos
        ))
    }

    #[tokio::test]
    async fn fixture_workflow_runs_to_completion() {
        let runtime = RuntimeService::default();
        let workflow: WorkflowDefinition = serde_json::from_str(include_str!(
            "../../../tests/fixtures/workflows/basic_text_preview.json"
        ))
        .expect("fixture parses");

        let run = runtime
            .create_run(CreateRunRequest {
                workflow,
                trigger: Default::default(),
                params: json!({}).as_object().cloned().unwrap_or_default(),
            })
            .await
            .expect("run should be created");

        let mut status = RunStatus::Created;
        for _ in 0..50 {
            let snapshot = runtime.get_run(&run.run_id).await.expect("run snapshot");
            status = snapshot.status;
            if matches!(status, RunStatus::Succeeded | RunStatus::Failed) {
                break;
            }
            sleep(Duration::from_millis(20)).await;
        }

        assert_eq!(status, RunStatus::Succeeded);
        let history = runtime
            .event_history(&run.run_id)
            .await
            .expect("event history");
        assert!(history
            .iter()
            .any(|event| event.event_type == api_contract::RunEventType::RunSucceeded));
    }

    #[tokio::test]
    async fn fan_out_workflow_runs_both_send_email_nodes() {
        let runtime = RuntimeService::default();
        let mut workflow: WorkflowDefinition = serde_json::from_str(include_str!(
            "../../../tests/fixtures/workflows/basic_text_preview.json"
        ))
        .expect("fixture parses");
        workflow.nodes.push(WorkflowNode {
            node_id: "send_email_secondary".to_string(),
            type_id: "send_email".to_string(),
            definition_version: 1,
            label: Some("Second Email".to_string()),
            config: json!({
                "to": "alerts@stitchly.dev",
                "subject": "Secondary notification",
                "body_mode": "input"
            }),
            position: NodePosition { x: 880.0, y: 180.0 },
        });
        workflow.edges.push(WorkflowEdge {
            edge_id: "edge_input_text_to_send_email_secondary_body".to_string(),
            source_node_id: "input_text".to_string(),
            source_port_id: "text".to_string(),
            target_node_id: "send_email_secondary".to_string(),
            target_port_id: "body".to_string(),
        });

        let run = runtime
            .create_run(CreateRunRequest {
                workflow,
                trigger: Default::default(),
                params: json!({}).as_object().cloned().unwrap_or_default(),
            })
            .await
            .expect("run should be created");

        let mut snapshot = runtime.get_run(&run.run_id).await.expect("run snapshot");
        for _ in 0..50 {
            snapshot = runtime.get_run(&run.run_id).await.expect("run snapshot");
            if matches!(snapshot.status, RunStatus::Succeeded | RunStatus::Failed) {
                break;
            }
            sleep(Duration::from_millis(20)).await;
        }

        assert_eq!(snapshot.status, RunStatus::Succeeded);
        assert_eq!(snapshot.node_runs.len(), 3);
        assert!(snapshot
            .node_runs
            .iter()
            .filter(|node_run| node_run.type_id == "send_email")
            .all(|node_run| node_run.status == api_contract::NodeRunStatus::Succeeded));
    }

    #[tokio::test]
    async fn execution_waits_are_logged_and_applied() {
        let runtime = RuntimeService::default();
        let mut workflow: WorkflowDefinition = serde_json::from_str(include_str!(
            "../../../tests/fixtures/workflows/basic_text_preview.json"
        ))
        .expect("fixture parses");

        if let Some(text_input) = workflow
            .nodes
            .iter_mut()
            .find(|node| node.node_id == "input_text")
        {
            text_input.config["execution"] = json!({
                "wait_before_seconds": 0.01
            });
        }

        if let Some(send_email) = workflow
            .nodes
            .iter_mut()
            .find(|node| node.node_id == "send_email_notification")
        {
            send_email.config["execution"] = json!({
                "wait_after_seconds": 0.01
            });
        }

        let run = runtime
            .create_run(CreateRunRequest {
                workflow,
                trigger: Default::default(),
                params: json!({}).as_object().cloned().unwrap_or_default(),
            })
            .await
            .expect("run should be created");

        let mut snapshot = runtime.get_run(&run.run_id).await.expect("run snapshot");
        for _ in 0..80 {
            snapshot = runtime.get_run(&run.run_id).await.expect("run snapshot");
            if matches!(snapshot.status, RunStatus::Succeeded | RunStatus::Failed) {
                break;
            }
            sleep(Duration::from_millis(20)).await;
        }

        assert_eq!(snapshot.status, RunStatus::Succeeded);
        assert!(snapshot
            .logs
            .iter()
            .any(|entry| entry.message.contains("Waiting 0.01s before execution.")));
        assert!(snapshot
            .logs
            .iter()
            .any(|entry| entry.message.contains("Waiting 0.01s after execution.")));
    }

    #[tokio::test]
    async fn dolt_repo_source_can_feed_dolt_dump_during_runtime_execution() {
        let runtime = RuntimeService::default();
        let workflow = WorkflowDefinition {
            schema_version: 1,
            workflow_id: "wf_dolt_repo_source_dump_runtime".to_string(),
            version: 1,
            name: "Dolt Repo Source Dump Runtime".to_string(),
            description: None,
            nodes: vec![
                WorkflowNode {
                    node_id: "dolt_repo_source".to_string(),
                    type_id: "dolt_repo_source".to_string(),
                    definition_version: 1,
                    label: Some("Dolt Repo Source".to_string()),
                    config: json!({
                        "connection_ref": "dolthub_public",
                        "repository": "post-no-preference/rates",
                        "branch": "main"
                    }),
                    position: NodePosition::default(),
                },
                WorkflowNode {
                    node_id: "dolt_dump".to_string(),
                    type_id: "dolt_dump".to_string(),
                    definition_version: 1,
                    label: Some("Dolt Dump".to_string()),
                    config: json!({
                        "output_format": "parquet",
                        "table_selection_mode": "all_tables",
                        "artifact_retention": "keep_latest_success",
                        "output_directory_policy": "ephemeral_run_bundle"
                    }),
                    position: NodePosition::default(),
                },
            ],
            edges: vec![WorkflowEdge {
                edge_id: "edge_repo_source_to_dolt_dump".to_string(),
                source_node_id: "dolt_repo_source".to_string(),
                source_port_id: "repo_out".to_string(),
                target_node_id: "dolt_dump".to_string(),
                target_port_id: "repo".to_string(),
            }],
            metadata: Default::default(),
        };

        let run = runtime
            .create_run(CreateRunRequest {
                workflow,
                trigger: Default::default(),
                params: json!({}).as_object().cloned().unwrap_or_default(),
            })
            .await
            .expect("run should be created");

        let mut status = RunStatus::Created;
        for _ in 0..50 {
            let snapshot = runtime.get_run(&run.run_id).await.expect("run snapshot");
            status = snapshot.status;
            if matches!(status, RunStatus::Succeeded | RunStatus::Failed) {
                break;
            }
            sleep(Duration::from_millis(20)).await;
        }

        assert_eq!(status, RunStatus::Succeeded);
    }

    #[tokio::test]
    async fn bootstrap_dolt_ingest_persists_staging_merge_and_checkpoint_tables() {
        let runtime = RuntimeService::default();
        let duckdb_path = unique_test_duckdb_path("bootstrap_dolt_ingest");
        let workflow = WorkflowDefinition {
            schema_version: 1,
            workflow_id: "wf_dolt_bootstrap_real_pass".to_string(),
            version: 1,
            name: "Dolt Bootstrap Real Pass".to_string(),
            description: None,
            nodes: vec![
                WorkflowNode {
                    node_id: "dolt_repo_source".to_string(),
                    type_id: "dolt_repo_source".to_string(),
                    definition_version: 1,
                    label: Some("Dolt Repo Source".to_string()),
                    config: json!({
                        "connection_ref": "dolthub_public",
                        "repository": "post-no-preference/rates",
                        "branch": "main"
                    }),
                    position: NodePosition::default(),
                },
                WorkflowNode {
                    node_id: "dolt_dump".to_string(),
                    type_id: "dolt_dump".to_string(),
                    definition_version: 1,
                    label: Some("Dolt Dump".to_string()),
                    config: json!({
                        "output_format": "parquet",
                        "table_selection_mode": "all_tables"
                    }),
                    position: NodePosition::default(),
                },
                WorkflowNode {
                    node_id: "load_to_duckdb".to_string(),
                    type_id: "load_to_duckdb".to_string(),
                    definition_version: 1,
                    label: Some("Load to DuckDB".to_string()),
                    config: json!({
                        "target_schema": "staging"
                    }),
                    position: NodePosition::default(),
                },
                WorkflowNode {
                    node_id: "table_merge".to_string(),
                    type_id: "table_merge".to_string(),
                    definition_version: 1,
                    label: Some("Table Merge".to_string()),
                    config: json!({
                        "target_schema": "tables",
                        "write_policy": "upsert",
                        "merge_key_columns": ["curve_date", "tenor"],
                        "delete_handling": "apply_delete_markers",
                        "schema_drift_behavior": "fail_and_require_review"
                    }),
                    position: NodePosition::default(),
                },
                WorkflowNode {
                    node_id: "checkpoint_write".to_string(),
                    type_id: "checkpoint_write".to_string(),
                    definition_version: 1,
                    label: Some("Checkpoint Write".to_string()),
                    config: json!({
                        "checkpoint_table": "tables.ingest_checkpoints",
                        "commit_source": "metadata.current_commit",
                        "write_timing": "after_merge_success",
                        "only_persist_on_full_success": true,
                        "advance_on_partial_success": false
                    }),
                    position: NodePosition::default(),
                },
            ],
            edges: vec![
                WorkflowEdge {
                    edge_id: "edge_repo_source_to_dolt_dump".to_string(),
                    source_node_id: "dolt_repo_source".to_string(),
                    source_port_id: "repo_out".to_string(),
                    target_node_id: "dolt_dump".to_string(),
                    target_port_id: "repo".to_string(),
                },
                WorkflowEdge {
                    edge_id: "edge_dolt_dump_to_load".to_string(),
                    source_node_id: "dolt_dump".to_string(),
                    source_port_id: "bundle".to_string(),
                    target_node_id: "load_to_duckdb".to_string(),
                    target_port_id: "bundle".to_string(),
                },
                WorkflowEdge {
                    edge_id: "edge_load_to_merge".to_string(),
                    source_node_id: "load_to_duckdb".to_string(),
                    source_port_id: "table".to_string(),
                    target_node_id: "table_merge".to_string(),
                    target_port_id: "table".to_string(),
                },
                WorkflowEdge {
                    edge_id: "edge_merge_to_checkpoint".to_string(),
                    source_node_id: "table_merge".to_string(),
                    source_port_id: "table".to_string(),
                    target_node_id: "checkpoint_write".to_string(),
                    target_port_id: "table".to_string(),
                },
            ],
            metadata: Default::default(),
        };

        let run = runtime
            .create_run(CreateRunRequest {
                workflow,
                trigger: Default::default(),
                params: json!({
                    INTERNAL_PARAM_WORKFLOW_DUCKDB_PATH: duckdb_path.display().to_string()
                })
                .as_object()
                .cloned()
                .unwrap_or_default(),
            })
            .await
            .expect("run should be created");

        let mut status = RunStatus::Created;
        for _ in 0..60 {
            let snapshot = runtime.get_run(&run.run_id).await.expect("run snapshot");
            status = snapshot.status;
            if matches!(status, RunStatus::Succeeded | RunStatus::Failed) {
                break;
            }
            sleep(Duration::from_millis(20)).await;
        }

        assert_eq!(status, RunStatus::Succeeded);

        let duckdb = DuckDbConnection::open(&duckdb_path).expect("duckdb opens");
        let staging_exists: i64 = duckdb
            .query_row(
                "select count(*)
                 from information_schema.tables
                 where table_schema = 'staging'
                   and table_name = 'rates__us_treasury__snapshot'",
                [],
                |row| row.get(0),
            )
            .expect("staging table existence query succeeds");
        let durable_exists: i64 = duckdb
            .query_row(
                "select count(*)
                 from information_schema.tables
                 where table_schema = 'tables'
                   and table_name = 'rates__us_treasury__snapshot'",
                [],
                |row| row.get(0),
            )
            .expect("durable table existence query succeeds");
        let checkpoint_row: (String, String, String) = duckdb
            .query_row(
                "select source_repo, branch, last_synced_commit
                 from tables.ingest_checkpoints
                 where source_repo = 'post-no-preference/rates'
                   and branch = 'main'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("checkpoint row query succeeds");

        assert_eq!(staging_exists, 1);
        assert_eq!(durable_exists, 1);
        assert_eq!(
            checkpoint_row,
            (
                "post-no-preference/rates".to_string(),
                "main".to_string(),
                "d0f61b4".to_string()
            )
        );

        let _ = fs::remove_file(&duckdb_path);
    }

    #[tokio::test]
    async fn cancellation_requested_during_wait_finishes_run_as_cancelled() {
        let runtime = RuntimeService::default();
        let mut workflow: WorkflowDefinition = serde_json::from_str(include_str!(
            "../../../tests/fixtures/workflows/basic_text_preview.json"
        ))
        .expect("fixture parses");

        if let Some(text_input) = workflow
            .nodes
            .iter_mut()
            .find(|node| node.node_id == "input_text")
        {
            text_input.config["execution"] = json!({
                "wait_before_seconds": 0.25
            });
        }

        let run = runtime
            .create_run(CreateRunRequest {
                workflow,
                trigger: Default::default(),
                params: json!({}).as_object().cloned().unwrap_or_default(),
            })
            .await
            .expect("run should be created");

        sleep(Duration::from_millis(40)).await;
        let cancelling_snapshot = runtime
            .cancel_run(&run.run_id)
            .await
            .expect("run should accept cancellation");
        assert_eq!(cancelling_snapshot.status, RunStatus::Cancelling);

        let mut snapshot = runtime.get_run(&run.run_id).await.expect("run snapshot");
        for _ in 0..50 {
            snapshot = runtime.get_run(&run.run_id).await.expect("run snapshot");
            if snapshot.status == RunStatus::Cancelled {
                break;
            }
            sleep(Duration::from_millis(20)).await;
        }

        assert_eq!(snapshot.status, RunStatus::Cancelled);
        assert!(snapshot
            .error
            .as_ref()
            .is_some_and(|error| error.category == api_contract::RunErrorCategory::Cancellation));
        assert!(snapshot
            .node_runs
            .iter()
            .any(|node_run| { node_run.status == api_contract::NodeRunStatus::Cancelled }));

        let history = runtime
            .event_history(&run.run_id)
            .await
            .expect("event history");
        assert!(history.iter().any(|event| {
            event.event_type == api_contract::RunEventType::CancellationRequested
        }));
        assert!(history
            .iter()
            .any(|event| event.event_type == api_contract::RunEventType::RunCancelled));
    }

    #[test]
    fn send_email_input_mode_requires_body_connection() {
        let runtime = RuntimeService::default();
        let workflow = WorkflowDefinition {
            schema_version: 1,
            workflow_id: "wf_send_email_input".to_string(),
            version: 1,
            name: "Send Email Input Mode".to_string(),
            description: None,
            nodes: vec![WorkflowNode {
                node_id: "send_email_notification".to_string(),
                type_id: "send_email".to_string(),
                definition_version: 1,
                label: Some("Send Email".to_string()),
                config: json!({
                    "to": "ops@stitchly.dev",
                    "subject": "Needs input",
                    "body_mode": "input"
                }),
                position: NodePosition::default(),
            }],
            edges: vec![],
            metadata: Default::default(),
        };

        let validation = runtime.validate_workflow(&workflow);
        assert!(!validation.valid);
        assert!(validation
            .errors
            .iter()
            .any(|error| error.code == "missing_send_email_body_input"));
    }

    #[test]
    fn table_output_requires_non_empty_table_name() {
        let runtime = RuntimeService::default();
        let workflow = WorkflowDefinition {
            schema_version: 1,
            workflow_id: "wf_table_output_invalid".to_string(),
            version: 1,
            name: "Table Output Invalid".to_string(),
            description: None,
            nodes: vec![
                WorkflowNode {
                    node_id: "input_text".to_string(),
                    type_id: "text_input".to_string(),
                    definition_version: 1,
                    label: Some("Text Input".to_string()),
                    config: json!({
                        "text": "Latest market digest"
                    }),
                    position: NodePosition::default(),
                },
                WorkflowNode {
                    node_id: "table_output_digest".to_string(),
                    type_id: "table_output".to_string(),
                    definition_version: 1,
                    label: Some("Table Output".to_string()),
                    config: json!({
                        "target_schema": "outputs",
                        "table_name": "   "
                    }),
                    position: NodePosition::default(),
                },
            ],
            edges: vec![WorkflowEdge {
                edge_id: "edge_input_text_to_table_output_text".to_string(),
                source_node_id: "input_text".to_string(),
                source_port_id: "text".to_string(),
                target_node_id: "table_output_digest".to_string(),
                target_port_id: "text".to_string(),
            }],
            metadata: Default::default(),
        };

        let validation = runtime.validate_workflow(&workflow);
        assert!(!validation.valid);
        assert!(validation
            .errors
            .iter()
            .any(|error| error.code == "invalid_table_output_table_name"));
    }

    #[test]
    fn dolt_repo_source_requires_owner_repo_repository_format() {
        let runtime = RuntimeService::default();
        let workflow = WorkflowDefinition {
            schema_version: 1,
            workflow_id: "wf_dolt_repo_invalid".to_string(),
            version: 1,
            name: "Dolt Repo Invalid".to_string(),
            description: None,
            nodes: vec![WorkflowNode {
                node_id: "dolt_repo_source".to_string(),
                type_id: "dolt_repo_source".to_string(),
                definition_version: 1,
                label: Some("Dolt Repo Source".to_string()),
                config: json!({
                    "connection_ref": "dolthub_public",
                    "repository": "earnings",
                    "branch": "main"
                }),
                position: NodePosition::default(),
            }],
            edges: vec![],
            metadata: Default::default(),
        };

        let validation = runtime.validate_workflow(&workflow);
        assert!(!validation.valid);
        assert!(validation
            .errors
            .iter()
            .any(|error| error.code == "invalid_dolt_repo_source_repository"));
    }

    #[test]
    fn checkpoint_read_requires_non_empty_source_repo() {
        let runtime = RuntimeService::default();
        let workflow = WorkflowDefinition {
            schema_version: 1,
            workflow_id: "wf_checkpoint_read_invalid".to_string(),
            version: 1,
            name: "Checkpoint Read Invalid".to_string(),
            description: None,
            nodes: vec![WorkflowNode {
                node_id: "checkpoint_read".to_string(),
                type_id: "checkpoint_read".to_string(),
                definition_version: 1,
                label: Some("Checkpoint Read".to_string()),
                config: json!({
                    "checkpoint_table": "tables.ingest_checkpoints",
                    "source_repo": "",
                    "branch": "main"
                }),
                position: NodePosition::default(),
            }],
            edges: vec![],
            metadata: Default::default(),
        };

        let validation = runtime.validate_workflow(&workflow);
        assert!(!validation.valid);
        assert!(validation
            .errors
            .iter()
            .any(|error| error.code == "invalid_checkpoint_read_source_repo"));
    }

    #[test]
    fn checkpoint_write_requires_non_empty_checkpoint_table() {
        let runtime = RuntimeService::default();
        let workflow = WorkflowDefinition {
            schema_version: 1,
            workflow_id: "wf_checkpoint_write_invalid".to_string(),
            version: 1,
            name: "Checkpoint Write Invalid".to_string(),
            description: None,
            nodes: vec![WorkflowNode {
                node_id: "checkpoint_write".to_string(),
                type_id: "checkpoint_write".to_string(),
                definition_version: 1,
                label: Some("Checkpoint Write".to_string()),
                config: json!({
                    "checkpoint_table": "   ",
                    "commit_source": "metadata.current_commit",
                    "write_timing": "after_merge_success"
                }),
                position: NodePosition::default(),
            }],
            edges: vec![],
            metadata: Default::default(),
        };

        let validation = runtime.validate_workflow(&workflow);
        assert!(!validation.valid);
        assert!(validation
            .errors
            .iter()
            .any(|error| error.code == "invalid_checkpoint_write_table"));
    }

    #[test]
    fn quality_check_requires_non_negative_warning_budget() {
        let runtime = RuntimeService::default();
        let workflow = WorkflowDefinition {
            schema_version: 1,
            workflow_id: "wf_quality_check_invalid".to_string(),
            version: 1,
            name: "Quality Check Invalid".to_string(),
            description: None,
            nodes: vec![WorkflowNode {
                node_id: "quality_check".to_string(),
                type_id: "quality_check".to_string(),
                definition_version: 1,
                label: Some("Quality Check".to_string()),
                config: json!({
                    "suite_preset": "post_merge_ingest_gate",
                    "warning_budget": -1
                }),
                position: NodePosition::default(),
            }],
            edges: vec![],
            metadata: Default::default(),
        };

        let validation = runtime.validate_workflow(&workflow);
        assert!(!validation.valid);
        assert!(validation
            .errors
            .iter()
            .any(|error| error.code == "invalid_quality_check_warning_budget"));
    }

    #[test]
    fn dolt_repo_sync_rejects_unsupported_sync_action() {
        let runtime = RuntimeService::default();
        let workflow = WorkflowDefinition {
            schema_version: 1,
            workflow_id: "wf_dolt_repo_sync_invalid".to_string(),
            version: 1,
            name: "Dolt Repo Sync Invalid".to_string(),
            description: None,
            nodes: vec![
                WorkflowNode {
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
                },
                WorkflowNode {
                    node_id: "dolt_repo_sync".to_string(),
                    type_id: "dolt_repo_sync".to_string(),
                    definition_version: 1,
                    label: Some("Dolt Repo Sync".to_string()),
                    config: json!({
                        "sync_action": "teleport_head"
                    }),
                    position: NodePosition::default(),
                },
            ],
            edges: vec![WorkflowEdge {
                edge_id: "edge_repo_source_to_repo_sync".to_string(),
                source_node_id: "dolt_repo_source".to_string(),
                source_port_id: "repo".to_string(),
                target_node_id: "dolt_repo_sync".to_string(),
                target_port_id: "repo".to_string(),
            }],
            metadata: Default::default(),
        };

        let validation = runtime.validate_workflow(&workflow);
        assert!(!validation.valid);
        assert!(validation
            .errors
            .iter()
            .any(|error| error.code == "invalid_dolt_repo_sync_action"));
    }

    #[test]
    fn dolt_change_manifest_rejects_unsupported_schema_change_policy() {
        let runtime = RuntimeService::default();
        let workflow = WorkflowDefinition {
            schema_version: 1,
            workflow_id: "wf_dolt_change_manifest_invalid".to_string(),
            version: 1,
            name: "Dolt Change Manifest Invalid".to_string(),
            description: None,
            nodes: vec![
                WorkflowNode {
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
                },
                WorkflowNode {
                    node_id: "dolt_repo_sync".to_string(),
                    type_id: "dolt_repo_sync".to_string(),
                    definition_version: 1,
                    label: Some("Dolt Repo Sync".to_string()),
                    config: json!({}),
                    position: NodePosition::default(),
                },
                WorkflowNode {
                    node_id: "dolt_change_manifest".to_string(),
                    type_id: "dolt_change_manifest".to_string(),
                    definition_version: 1,
                    label: Some("Dolt Change Manifest".to_string()),
                    config: json!({
                        "schema_change_policy": "warn_loudly"
                    }),
                    position: NodePosition::default(),
                },
            ],
            edges: vec![
                WorkflowEdge {
                    edge_id: "edge_repo_source_to_repo_sync".to_string(),
                    source_node_id: "dolt_repo_source".to_string(),
                    source_port_id: "repo".to_string(),
                    target_node_id: "dolt_repo_sync".to_string(),
                    target_port_id: "repo".to_string(),
                },
                WorkflowEdge {
                    edge_id: "edge_repo_sync_to_change_manifest".to_string(),
                    source_node_id: "dolt_repo_sync".to_string(),
                    source_port_id: "repo_out".to_string(),
                    target_node_id: "dolt_change_manifest".to_string(),
                    target_port_id: "repo".to_string(),
                },
            ],
            metadata: Default::default(),
        };

        let validation = runtime.validate_workflow(&workflow);
        assert!(!validation.valid);
        assert!(validation
            .errors
            .iter()
            .any(|error| { error.code == "invalid_dolt_change_manifest_schema_change_policy" }));
    }

    #[test]
    fn dolt_dump_rejects_unsupported_output_format() {
        let runtime = RuntimeService::default();
        let workflow = WorkflowDefinition {
            schema_version: 1,
            workflow_id: "wf_dolt_dump_invalid".to_string(),
            version: 1,
            name: "Dolt Dump Invalid".to_string(),
            description: None,
            nodes: vec![
                WorkflowNode {
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
                },
                WorkflowNode {
                    node_id: "dolt_dump".to_string(),
                    type_id: "dolt_dump".to_string(),
                    definition_version: 1,
                    label: Some("Dolt Dump".to_string()),
                    config: json!({
                        "output_format": "jsonl"
                    }),
                    position: NodePosition::default(),
                },
            ],
            edges: vec![WorkflowEdge {
                edge_id: "edge_repo_source_to_dolt_dump".to_string(),
                source_node_id: "dolt_repo_source".to_string(),
                source_port_id: "repo_out".to_string(),
                target_node_id: "dolt_dump".to_string(),
                target_port_id: "repo".to_string(),
            }],
            metadata: Default::default(),
        };

        let validation = runtime.validate_workflow(&workflow);
        assert!(!validation.valid);
        assert!(validation
            .errors
            .iter()
            .any(|error| error.code == "invalid_dolt_dump_output_format"));
    }

    #[test]
    fn dolt_diff_export_rejects_unsupported_change_filter() {
        let runtime = RuntimeService::default();
        let workflow = WorkflowDefinition {
            schema_version: 1,
            workflow_id: "wf_dolt_diff_export_invalid".to_string(),
            version: 1,
            name: "Dolt Diff Export Invalid".to_string(),
            description: None,
            nodes: vec![
                WorkflowNode {
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
                },
                WorkflowNode {
                    node_id: "dolt_repo_sync".to_string(),
                    type_id: "dolt_repo_sync".to_string(),
                    definition_version: 1,
                    label: Some("Dolt Repo Sync".to_string()),
                    config: json!({}),
                    position: NodePosition::default(),
                },
                WorkflowNode {
                    node_id: "dolt_change_manifest".to_string(),
                    type_id: "dolt_change_manifest".to_string(),
                    definition_version: 1,
                    label: Some("Dolt Change Manifest".to_string()),
                    config: json!({}),
                    position: NodePosition::default(),
                },
                WorkflowNode {
                    node_id: "dolt_diff_export".to_string(),
                    type_id: "dolt_diff_export".to_string(),
                    definition_version: 1,
                    label: Some("Dolt Diff Export".to_string()),
                    config: json!({
                        "change_filter": "upserts_only"
                    }),
                    position: NodePosition::default(),
                },
            ],
            edges: vec![
                WorkflowEdge {
                    edge_id: "edge_repo_source_to_dolt_repo_sync".to_string(),
                    source_node_id: "dolt_repo_source".to_string(),
                    source_port_id: "repo_out".to_string(),
                    target_node_id: "dolt_repo_sync".to_string(),
                    target_port_id: "repo".to_string(),
                },
                WorkflowEdge {
                    edge_id: "edge_dolt_repo_sync_to_change_manifest".to_string(),
                    source_node_id: "dolt_repo_sync".to_string(),
                    source_port_id: "repo_out".to_string(),
                    target_node_id: "dolt_change_manifest".to_string(),
                    target_port_id: "repo".to_string(),
                },
                WorkflowEdge {
                    edge_id: "edge_change_manifest_to_dolt_diff_export".to_string(),
                    source_node_id: "dolt_change_manifest".to_string(),
                    source_port_id: "manifest".to_string(),
                    target_node_id: "dolt_diff_export".to_string(),
                    target_port_id: "manifest".to_string(),
                },
            ],
            metadata: Default::default(),
        };

        let validation = runtime.validate_workflow(&workflow);
        assert!(!validation.valid);
        assert!(validation
            .errors
            .iter()
            .any(|error| error.code == "invalid_dolt_diff_export_change_filter"));
    }

    #[test]
    fn load_to_duckdb_rejects_unsupported_table_mapping() {
        let runtime = RuntimeService::default();
        let workflow = WorkflowDefinition {
            schema_version: 1,
            workflow_id: "wf_load_to_duckdb_invalid".to_string(),
            version: 1,
            name: "Load to DuckDB Invalid".to_string(),
            description: None,
            nodes: vec![
                WorkflowNode {
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
                },
                WorkflowNode {
                    node_id: "dolt_repo_sync".to_string(),
                    type_id: "dolt_repo_sync".to_string(),
                    definition_version: 1,
                    label: Some("Dolt Repo Sync".to_string()),
                    config: json!({}),
                    position: NodePosition::default(),
                },
                WorkflowNode {
                    node_id: "dolt_change_manifest".to_string(),
                    type_id: "dolt_change_manifest".to_string(),
                    definition_version: 1,
                    label: Some("Dolt Change Manifest".to_string()),
                    config: json!({}),
                    position: NodePosition::default(),
                },
                WorkflowNode {
                    node_id: "dolt_dump".to_string(),
                    type_id: "dolt_dump".to_string(),
                    definition_version: 1,
                    label: Some("Dolt Dump".to_string()),
                    config: json!({}),
                    position: NodePosition::default(),
                },
                WorkflowNode {
                    node_id: "load_to_duckdb".to_string(),
                    type_id: "load_to_duckdb".to_string(),
                    definition_version: 1,
                    label: Some("Load to DuckDB".to_string()),
                    config: json!({
                        "target_schema": "staging",
                        "table_mapping": "custom_names"
                    }),
                    position: NodePosition::default(),
                },
            ],
            edges: vec![
                WorkflowEdge {
                    edge_id: "edge_repo_source_to_dolt_repo_sync".to_string(),
                    source_node_id: "dolt_repo_source".to_string(),
                    source_port_id: "repo_out".to_string(),
                    target_node_id: "dolt_repo_sync".to_string(),
                    target_port_id: "repo".to_string(),
                },
                WorkflowEdge {
                    edge_id: "edge_dolt_repo_sync_to_change_manifest".to_string(),
                    source_node_id: "dolt_repo_sync".to_string(),
                    source_port_id: "repo_out".to_string(),
                    target_node_id: "dolt_change_manifest".to_string(),
                    target_port_id: "repo".to_string(),
                },
                WorkflowEdge {
                    edge_id: "edge_change_manifest_to_dolt_dump".to_string(),
                    source_node_id: "dolt_change_manifest".to_string(),
                    source_port_id: "manifest".to_string(),
                    target_node_id: "dolt_dump".to_string(),
                    target_port_id: "repo".to_string(),
                },
                WorkflowEdge {
                    edge_id: "edge_dolt_dump_to_load_to_duckdb".to_string(),
                    source_node_id: "dolt_dump".to_string(),
                    source_port_id: "bundle".to_string(),
                    target_node_id: "load_to_duckdb".to_string(),
                    target_port_id: "bundle".to_string(),
                },
            ],
            metadata: Default::default(),
        };

        let validation = runtime.validate_workflow(&workflow);
        assert!(!validation.valid);
        assert!(validation
            .errors
            .iter()
            .any(|error| error.code == "invalid_load_to_duckdb_table_mapping"));
    }

    #[test]
    fn dolt_dump_can_connect_to_load_to_duckdb() {
        let runtime = RuntimeService::default();
        let workflow = WorkflowDefinition {
            schema_version: 1,
            workflow_id: "wf_dolt_dump_load_to_duckdb".to_string(),
            version: 1,
            name: "Dolt Dump Load".to_string(),
            description: None,
            nodes: vec![
                WorkflowNode {
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
                },
                WorkflowNode {
                    node_id: "dolt_repo_sync".to_string(),
                    type_id: "dolt_repo_sync".to_string(),
                    definition_version: 1,
                    label: Some("Dolt Repo Sync".to_string()),
                    config: json!({}),
                    position: NodePosition::default(),
                },
                WorkflowNode {
                    node_id: "dolt_change_manifest".to_string(),
                    type_id: "dolt_change_manifest".to_string(),
                    definition_version: 1,
                    label: Some("Dolt Change Manifest".to_string()),
                    config: json!({}),
                    position: NodePosition::default(),
                },
                WorkflowNode {
                    node_id: "dolt_dump".to_string(),
                    type_id: "dolt_dump".to_string(),
                    definition_version: 1,
                    label: Some("Dolt Dump".to_string()),
                    config: json!({}),
                    position: NodePosition::default(),
                },
                WorkflowNode {
                    node_id: "load_to_duckdb".to_string(),
                    type_id: "load_to_duckdb".to_string(),
                    definition_version: 1,
                    label: Some("Load to DuckDB".to_string()),
                    config: json!({
                        "target_schema": "staging"
                    }),
                    position: NodePosition::default(),
                },
            ],
            edges: vec![
                WorkflowEdge {
                    edge_id: "edge_repo_source_to_dolt_repo_sync".to_string(),
                    source_node_id: "dolt_repo_source".to_string(),
                    source_port_id: "repo_out".to_string(),
                    target_node_id: "dolt_repo_sync".to_string(),
                    target_port_id: "repo".to_string(),
                },
                WorkflowEdge {
                    edge_id: "edge_dolt_repo_sync_to_change_manifest".to_string(),
                    source_node_id: "dolt_repo_sync".to_string(),
                    source_port_id: "repo_out".to_string(),
                    target_node_id: "dolt_change_manifest".to_string(),
                    target_port_id: "repo".to_string(),
                },
                WorkflowEdge {
                    edge_id: "edge_change_manifest_to_dolt_dump".to_string(),
                    source_node_id: "dolt_change_manifest".to_string(),
                    source_port_id: "manifest".to_string(),
                    target_node_id: "dolt_dump".to_string(),
                    target_port_id: "repo".to_string(),
                },
                WorkflowEdge {
                    edge_id: "edge_dolt_dump_to_load_to_duckdb".to_string(),
                    source_node_id: "dolt_dump".to_string(),
                    source_port_id: "bundle".to_string(),
                    target_node_id: "load_to_duckdb".to_string(),
                    target_port_id: "bundle".to_string(),
                },
            ],
            metadata: Default::default(),
        };

        let validation = runtime.validate_workflow(&workflow);
        assert!(validation.valid, "expected valid flow, got: {validation:?}");
    }

    #[test]
    fn checkpoint_read_can_connect_to_dolt_repo_sync() {
        let runtime = RuntimeService::default();
        let workflow = WorkflowDefinition {
            schema_version: 1,
            workflow_id: "wf_checkpoint_read_dolt_repo_sync".to_string(),
            version: 1,
            name: "Checkpoint Read Dolt Repo Sync".to_string(),
            description: None,
            nodes: vec![
                WorkflowNode {
                    node_id: "checkpoint_read".to_string(),
                    type_id: "checkpoint_read".to_string(),
                    definition_version: 1,
                    label: Some("Checkpoint Read".to_string()),
                    config: json!({
                        "checkpoint_table": "tables.ingest_checkpoints",
                        "source_repo": "post-no-preference/options",
                        "branch": "main"
                    }),
                    position: NodePosition::default(),
                },
                WorkflowNode {
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
                },
                WorkflowNode {
                    node_id: "dolt_repo_sync".to_string(),
                    type_id: "dolt_repo_sync".to_string(),
                    definition_version: 1,
                    label: Some("Dolt Repo Sync".to_string()),
                    config: json!({}),
                    position: NodePosition::default(),
                },
            ],
            edges: vec![
                WorkflowEdge {
                    edge_id: "edge_checkpoint_read_to_dolt_repo_sync".to_string(),
                    source_node_id: "checkpoint_read".to_string(),
                    source_port_id: "checkpoint".to_string(),
                    target_node_id: "dolt_repo_sync".to_string(),
                    target_port_id: "checkpoint".to_string(),
                },
                WorkflowEdge {
                    edge_id: "edge_repo_source_to_dolt_repo_sync".to_string(),
                    source_node_id: "dolt_repo_source".to_string(),
                    source_port_id: "repo_out".to_string(),
                    target_node_id: "dolt_repo_sync".to_string(),
                    target_port_id: "repo".to_string(),
                },
            ],
            metadata: Default::default(),
        };

        let validation = runtime.validate_workflow(&workflow);
        assert!(validation.valid, "expected valid flow, got: {validation:?}");
    }

    #[test]
    fn dolt_diff_export_can_connect_to_load_to_duckdb() {
        let runtime = RuntimeService::default();
        let workflow = WorkflowDefinition {
            schema_version: 1,
            workflow_id: "wf_dolt_diff_export_load_to_duckdb".to_string(),
            version: 1,
            name: "Dolt Diff Export Load".to_string(),
            description: None,
            nodes: vec![
                WorkflowNode {
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
                },
                WorkflowNode {
                    node_id: "dolt_repo_sync".to_string(),
                    type_id: "dolt_repo_sync".to_string(),
                    definition_version: 1,
                    label: Some("Dolt Repo Sync".to_string()),
                    config: json!({}),
                    position: NodePosition::default(),
                },
                WorkflowNode {
                    node_id: "dolt_change_manifest".to_string(),
                    type_id: "dolt_change_manifest".to_string(),
                    definition_version: 1,
                    label: Some("Dolt Change Manifest".to_string()),
                    config: json!({}),
                    position: NodePosition::default(),
                },
                WorkflowNode {
                    node_id: "dolt_diff_export".to_string(),
                    type_id: "dolt_diff_export".to_string(),
                    definition_version: 1,
                    label: Some("Dolt Diff Export".to_string()),
                    config: json!({}),
                    position: NodePosition::default(),
                },
                WorkflowNode {
                    node_id: "load_to_duckdb".to_string(),
                    type_id: "load_to_duckdb".to_string(),
                    definition_version: 1,
                    label: Some("Load to DuckDB".to_string()),
                    config: json!({
                        "target_schema": "staging"
                    }),
                    position: NodePosition::default(),
                },
            ],
            edges: vec![
                WorkflowEdge {
                    edge_id: "edge_repo_source_to_dolt_repo_sync".to_string(),
                    source_node_id: "dolt_repo_source".to_string(),
                    source_port_id: "repo_out".to_string(),
                    target_node_id: "dolt_repo_sync".to_string(),
                    target_port_id: "repo".to_string(),
                },
                WorkflowEdge {
                    edge_id: "edge_dolt_repo_sync_to_change_manifest".to_string(),
                    source_node_id: "dolt_repo_sync".to_string(),
                    source_port_id: "repo_out".to_string(),
                    target_node_id: "dolt_change_manifest".to_string(),
                    target_port_id: "repo".to_string(),
                },
                WorkflowEdge {
                    edge_id: "edge_change_manifest_to_dolt_diff_export".to_string(),
                    source_node_id: "dolt_change_manifest".to_string(),
                    source_port_id: "manifest".to_string(),
                    target_node_id: "dolt_diff_export".to_string(),
                    target_port_id: "manifest".to_string(),
                },
                WorkflowEdge {
                    edge_id: "edge_dolt_diff_export_to_load_to_duckdb".to_string(),
                    source_node_id: "dolt_diff_export".to_string(),
                    source_port_id: "bundle".to_string(),
                    target_node_id: "load_to_duckdb".to_string(),
                    target_port_id: "bundle".to_string(),
                },
            ],
            metadata: Default::default(),
        };

        let validation = runtime.validate_workflow(&workflow);
        assert!(validation.valid, "expected valid flow, got: {validation:?}");
    }

    #[test]
    fn load_to_duckdb_can_connect_to_table_merge() {
        let runtime = RuntimeService::default();
        let workflow = WorkflowDefinition {
            schema_version: 1,
            workflow_id: "wf_load_to_duckdb_table_merge".to_string(),
            version: 1,
            name: "Load To DuckDB Table Merge".to_string(),
            description: None,
            nodes: vec![
                WorkflowNode {
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
                },
                WorkflowNode {
                    node_id: "dolt_repo_sync".to_string(),
                    type_id: "dolt_repo_sync".to_string(),
                    definition_version: 1,
                    label: Some("Dolt Repo Sync".to_string()),
                    config: json!({}),
                    position: NodePosition::default(),
                },
                WorkflowNode {
                    node_id: "dolt_change_manifest".to_string(),
                    type_id: "dolt_change_manifest".to_string(),
                    definition_version: 1,
                    label: Some("Dolt Change Manifest".to_string()),
                    config: json!({}),
                    position: NodePosition::default(),
                },
                WorkflowNode {
                    node_id: "dolt_dump".to_string(),
                    type_id: "dolt_dump".to_string(),
                    definition_version: 1,
                    label: Some("Dolt Dump".to_string()),
                    config: json!({}),
                    position: NodePosition::default(),
                },
                WorkflowNode {
                    node_id: "load_to_duckdb".to_string(),
                    type_id: "load_to_duckdb".to_string(),
                    definition_version: 1,
                    label: Some("Load to DuckDB".to_string()),
                    config: json!({
                        "target_schema": "staging"
                    }),
                    position: NodePosition::default(),
                },
                WorkflowNode {
                    node_id: "table_merge".to_string(),
                    type_id: "table_merge".to_string(),
                    definition_version: 1,
                    label: Some("Table Merge".to_string()),
                    config: json!({
                        "target_schema": "tables",
                        "write_policy": "upsert",
                        "merge_key_columns": ["symbol", "report_date"],
                        "delete_handling": "apply_delete_markers",
                        "schema_drift_behavior": "fail_and_require_review"
                    }),
                    position: NodePosition::default(),
                },
            ],
            edges: vec![
                WorkflowEdge {
                    edge_id: "edge_repo_source_to_dolt_repo_sync".to_string(),
                    source_node_id: "dolt_repo_source".to_string(),
                    source_port_id: "repo_out".to_string(),
                    target_node_id: "dolt_repo_sync".to_string(),
                    target_port_id: "repo".to_string(),
                },
                WorkflowEdge {
                    edge_id: "edge_dolt_repo_sync_to_change_manifest".to_string(),
                    source_node_id: "dolt_repo_sync".to_string(),
                    source_port_id: "repo_out".to_string(),
                    target_node_id: "dolt_change_manifest".to_string(),
                    target_port_id: "repo".to_string(),
                },
                WorkflowEdge {
                    edge_id: "edge_change_manifest_to_dolt_dump".to_string(),
                    source_node_id: "dolt_change_manifest".to_string(),
                    source_port_id: "manifest".to_string(),
                    target_node_id: "dolt_dump".to_string(),
                    target_port_id: "repo".to_string(),
                },
                WorkflowEdge {
                    edge_id: "edge_dolt_dump_to_load_to_duckdb".to_string(),
                    source_node_id: "dolt_dump".to_string(),
                    source_port_id: "bundle".to_string(),
                    target_node_id: "load_to_duckdb".to_string(),
                    target_port_id: "bundle".to_string(),
                },
                WorkflowEdge {
                    edge_id: "edge_load_to_duckdb_to_table_merge".to_string(),
                    source_node_id: "load_to_duckdb".to_string(),
                    source_port_id: "table".to_string(),
                    target_node_id: "table_merge".to_string(),
                    target_port_id: "table".to_string(),
                },
            ],
            metadata: Default::default(),
        };

        let validation = runtime.validate_workflow(&workflow);
        assert!(validation.valid, "expected valid flow, got: {validation:?}");
    }

    #[test]
    fn load_to_duckdb_can_connect_to_sql_transform_to_table_merge() {
        let runtime = RuntimeService::default();
        let workflow = WorkflowDefinition {
            schema_version: 1,
            workflow_id: "wf_load_to_duckdb_sql_transform_table_merge".to_string(),
            version: 1,
            name: "Load To DuckDB SQL Transform Table Merge".to_string(),
            description: None,
            nodes: vec![
                WorkflowNode {
                    node_id: "dolt_repo_source".to_string(),
                    type_id: "dolt_repo_source".to_string(),
                    definition_version: 1,
                    label: Some("Dolt Repo Source".to_string()),
                    config: json!({
                        "connection_ref": "dolthub_public",
                        "repository": "post-no-preference/rates",
                        "branch": "master"
                    }),
                    position: NodePosition::default(),
                },
                WorkflowNode {
                    node_id: "dolt_dump".to_string(),
                    type_id: "dolt_dump".to_string(),
                    definition_version: 1,
                    label: Some("Dolt Dump".to_string()),
                    config: json!({}),
                    position: NodePosition::default(),
                },
                WorkflowNode {
                    node_id: "load_to_duckdb".to_string(),
                    type_id: "load_to_duckdb".to_string(),
                    definition_version: 1,
                    label: Some("Load to DuckDB".to_string()),
                    config: json!({
                        "target_schema": "staging"
                    }),
                    position: NodePosition::default(),
                },
                WorkflowNode {
                    node_id: "sql_transform".to_string(),
                    type_id: "sql_transform".to_string(),
                    definition_version: 1,
                    label: Some("SQL Transform".to_string()),
                    config: json!({
                        "target_schema": "staging_curated",
                        "output_table_name": "rates__us_treasury__snapshot_normalized",
                        "materialization_mode": "view",
                        "sql_text": "select * from {{source}}"
                    }),
                    position: NodePosition::default(),
                },
                WorkflowNode {
                    node_id: "table_merge".to_string(),
                    type_id: "table_merge".to_string(),
                    definition_version: 1,
                    label: Some("Table Merge".to_string()),
                    config: json!({
                        "target_schema": "tables",
                        "write_policy": "upsert",
                        "merge_key_columns": ["curve_date", "tenor"],
                        "delete_handling": "apply_delete_markers",
                        "schema_drift_behavior": "fail_and_require_review"
                    }),
                    position: NodePosition::default(),
                },
            ],
            edges: vec![
                WorkflowEdge {
                    edge_id: "edge_repo_dump".to_string(),
                    source_node_id: "dolt_repo_source".to_string(),
                    source_port_id: "repo_out".to_string(),
                    target_node_id: "dolt_dump".to_string(),
                    target_port_id: "repo".to_string(),
                },
                WorkflowEdge {
                    edge_id: "edge_dump_load".to_string(),
                    source_node_id: "dolt_dump".to_string(),
                    source_port_id: "bundle".to_string(),
                    target_node_id: "load_to_duckdb".to_string(),
                    target_port_id: "bundle".to_string(),
                },
                WorkflowEdge {
                    edge_id: "edge_load_transform".to_string(),
                    source_node_id: "load_to_duckdb".to_string(),
                    source_port_id: "table".to_string(),
                    target_node_id: "sql_transform".to_string(),
                    target_port_id: "table".to_string(),
                },
                WorkflowEdge {
                    edge_id: "edge_transform_merge".to_string(),
                    source_node_id: "sql_transform".to_string(),
                    source_port_id: "table".to_string(),
                    target_node_id: "table_merge".to_string(),
                    target_port_id: "table".to_string(),
                },
            ],
            metadata: Default::default(),
        };

        let validation = runtime.validate_workflow(&workflow);
        assert!(validation.valid, "expected valid flow, got: {validation:?}");
    }

    #[test]
    fn table_merge_can_connect_to_checkpoint_write() {
        let runtime = RuntimeService::default();
        let workflow = WorkflowDefinition {
            schema_version: 1,
            workflow_id: "wf_table_merge_checkpoint_write".to_string(),
            version: 1,
            name: "Table Merge Checkpoint Write".to_string(),
            description: None,
            nodes: vec![
                WorkflowNode {
                    node_id: "table_input_source".to_string(),
                    type_id: "table_input".to_string(),
                    definition_version: 1,
                    label: Some("Table Input".to_string()),
                    config: json!({
                        "catalog": "workflow",
                        "schema_name": "staging",
                        "table_name": "earnings_calendar"
                    }),
                    position: NodePosition::default(),
                },
                WorkflowNode {
                    node_id: "table_merge".to_string(),
                    type_id: "table_merge".to_string(),
                    definition_version: 1,
                    label: Some("Table Merge".to_string()),
                    config: json!({
                        "target_schema": "tables",
                        "write_policy": "upsert",
                        "merge_key_columns": ["symbol", "report_date"],
                        "delete_handling": "apply_delete_markers",
                        "schema_drift_behavior": "fail_and_require_review"
                    }),
                    position: NodePosition::default(),
                },
                WorkflowNode {
                    node_id: "checkpoint_write".to_string(),
                    type_id: "checkpoint_write".to_string(),
                    definition_version: 1,
                    label: Some("Checkpoint Write".to_string()),
                    config: json!({
                        "checkpoint_table": "tables.ingest_checkpoints",
                        "commit_source": "metadata.current_commit",
                        "write_timing": "after_merge_success"
                    }),
                    position: NodePosition::default(),
                },
            ],
            edges: vec![
                WorkflowEdge {
                    edge_id: "edge_table_input_to_table_merge".to_string(),
                    source_node_id: "table_input_source".to_string(),
                    source_port_id: "table".to_string(),
                    target_node_id: "table_merge".to_string(),
                    target_port_id: "table".to_string(),
                },
                WorkflowEdge {
                    edge_id: "edge_table_merge_to_checkpoint_write".to_string(),
                    source_node_id: "table_merge".to_string(),
                    source_port_id: "table".to_string(),
                    target_node_id: "checkpoint_write".to_string(),
                    target_port_id: "table".to_string(),
                },
            ],
            metadata: Default::default(),
        };

        let validation = runtime.validate_workflow(&workflow);
        assert!(validation.valid, "expected valid flow, got: {validation:?}");
    }

    #[test]
    fn table_merge_can_connect_to_quality_check_and_checkpoint_write() {
        let runtime = RuntimeService::default();
        let workflow = WorkflowDefinition {
            schema_version: 1,
            workflow_id: "wf_table_merge_quality_check_checkpoint_write".to_string(),
            version: 1,
            name: "Table Merge Quality Check Checkpoint Write".to_string(),
            description: None,
            nodes: vec![
                WorkflowNode {
                    node_id: "table_input_source".to_string(),
                    type_id: "table_input".to_string(),
                    definition_version: 1,
                    label: Some("Table Input".to_string()),
                    config: json!({
                        "catalog": "workflow",
                        "schema_name": "staging",
                        "table_name": "earnings_calendar"
                    }),
                    position: NodePosition::default(),
                },
                WorkflowNode {
                    node_id: "table_merge".to_string(),
                    type_id: "table_merge".to_string(),
                    definition_version: 1,
                    label: Some("Table Merge".to_string()),
                    config: json!({
                        "target_schema": "tables",
                        "write_policy": "upsert",
                        "merge_key_columns": ["symbol", "report_date"],
                        "delete_handling": "apply_delete_markers",
                        "schema_drift_behavior": "fail_and_require_review"
                    }),
                    position: NodePosition::default(),
                },
                WorkflowNode {
                    node_id: "quality_check".to_string(),
                    type_id: "quality_check".to_string(),
                    definition_version: 1,
                    label: Some("Quality Check".to_string()),
                    config: json!({
                        "suite_preset": "post_merge_ingest_gate",
                        "schema_drift_rule": "fail_on_required_column_drift",
                        "null_key_policy": "block_on_primary_key_nulls",
                        "warning_budget": 2,
                        "block_checkpoint_write_on_failure": true,
                        "allow_warning_only_runs_to_continue": true
                    }),
                    position: NodePosition::default(),
                },
                WorkflowNode {
                    node_id: "checkpoint_write".to_string(),
                    type_id: "checkpoint_write".to_string(),
                    definition_version: 1,
                    label: Some("Checkpoint Write".to_string()),
                    config: json!({
                        "checkpoint_table": "tables.ingest_checkpoints",
                        "commit_source": "metadata.current_commit",
                        "write_timing": "after_quality_gate"
                    }),
                    position: NodePosition::default(),
                },
            ],
            edges: vec![
                WorkflowEdge {
                    edge_id: "edge_table_input_to_table_merge".to_string(),
                    source_node_id: "table_input_source".to_string(),
                    source_port_id: "table".to_string(),
                    target_node_id: "table_merge".to_string(),
                    target_port_id: "table".to_string(),
                },
                WorkflowEdge {
                    edge_id: "edge_table_merge_to_quality_check".to_string(),
                    source_node_id: "table_merge".to_string(),
                    source_port_id: "table".to_string(),
                    target_node_id: "quality_check".to_string(),
                    target_port_id: "table".to_string(),
                },
                WorkflowEdge {
                    edge_id: "edge_quality_check_to_checkpoint_write".to_string(),
                    source_node_id: "quality_check".to_string(),
                    source_port_id: "table".to_string(),
                    target_node_id: "checkpoint_write".to_string(),
                    target_port_id: "table".to_string(),
                },
            ],
            metadata: Default::default(),
        };

        let validation = runtime.validate_workflow(&workflow);
        assert!(validation.valid, "expected valid flow, got: {validation:?}");
    }

    #[test]
    fn table_merge_can_connect_to_table_output() {
        let runtime = RuntimeService::default();
        let workflow = WorkflowDefinition {
            schema_version: 1,
            workflow_id: "wf_table_merge_table_output".to_string(),
            version: 1,
            name: "Table Merge Table Output".to_string(),
            description: None,
            nodes: vec![
                WorkflowNode {
                    node_id: "table_input_source".to_string(),
                    type_id: "table_input".to_string(),
                    definition_version: 1,
                    label: Some("Table Input".to_string()),
                    config: json!({
                        "catalog": "workspace",
                        "schema_name": "staging",
                        "table_name": "earnings_calendar"
                    }),
                    position: NodePosition::default(),
                },
                WorkflowNode {
                    node_id: "table_merge".to_string(),
                    type_id: "table_merge".to_string(),
                    definition_version: 1,
                    label: Some("Table Merge".to_string()),
                    config: json!({
                        "target_schema": "tables",
                        "write_policy": "upsert",
                        "merge_key_columns": ["symbol", "report_date"],
                        "delete_handling": "apply_delete_markers",
                        "schema_drift_behavior": "fail_and_require_review"
                    }),
                    position: NodePosition::default(),
                },
                WorkflowNode {
                    node_id: "table_output".to_string(),
                    type_id: "table_output".to_string(),
                    definition_version: 1,
                    label: Some("Table Output".to_string()),
                    config: json!({
                        "target_schema": "outputs",
                        "table_name": "published_tables",
                        "input_shape": "source_table",
                        "write_mode": "append"
                    }),
                    position: NodePosition::default(),
                },
            ],
            edges: vec![
                WorkflowEdge {
                    edge_id: "edge_table_input_to_table_merge".to_string(),
                    source_node_id: "table_input_source".to_string(),
                    source_port_id: "table".to_string(),
                    target_node_id: "table_merge".to_string(),
                    target_port_id: "table".to_string(),
                },
                WorkflowEdge {
                    edge_id: "edge_table_merge_to_table_output".to_string(),
                    source_node_id: "table_merge".to_string(),
                    source_port_id: "table".to_string(),
                    target_node_id: "table_output".to_string(),
                    target_port_id: "text".to_string(),
                },
            ],
            metadata: Default::default(),
        };

        let validation = runtime.validate_workflow(&workflow);
        assert!(validation.valid, "expected valid flow, got: {validation:?}");
    }

    #[test]
    fn table_input_can_connect_to_table_output() {
        let runtime = RuntimeService::default();
        let workflow = WorkflowDefinition {
            schema_version: 1,
            workflow_id: "wf_table_input_output".to_string(),
            version: 1,
            name: "Table Input Output".to_string(),
            description: None,
            nodes: vec![
                WorkflowNode {
                    node_id: "table_input_runs".to_string(),
                    type_id: "table_input".to_string(),
                    definition_version: 1,
                    label: Some("Table Input".to_string()),
                    config: json!({
                        "catalog": "workflow.duckdb",
                        "schema_name": "runs",
                        "table_name": "workflow_runs",
                        "output_alias": "workflow_runs"
                    }),
                    position: NodePosition::default(),
                },
                WorkflowNode {
                    node_id: "table_output_copy".to_string(),
                    type_id: "table_output".to_string(),
                    definition_version: 1,
                    label: Some("Table Output".to_string()),
                    config: json!({
                        "target_schema": "tables",
                        "table_name": "workflow_runs_copy",
                        "input_shape": "source_table",
                        "write_mode": "replace"
                    }),
                    position: NodePosition::default(),
                },
            ],
            edges: vec![WorkflowEdge {
                edge_id: "edge_table_input_to_table_output".to_string(),
                source_node_id: "table_input_runs".to_string(),
                source_port_id: "table".to_string(),
                target_node_id: "table_output_copy".to_string(),
                target_port_id: "text".to_string(),
            }],
            metadata: Default::default(),
        };

        let validation = runtime.validate_workflow(&workflow);
        assert!(validation.valid, "expected valid flow, got: {validation:?}");
    }

    #[test]
    fn table_schema_can_connect_to_table_output() {
        let runtime = RuntimeService::default();
        let workflow = WorkflowDefinition {
            schema_version: 1,
            workflow_id: "wf_table_schema_output".to_string(),
            version: 1,
            name: "Table Schema Output".to_string(),
            description: None,
            nodes: vec![
                WorkflowNode {
                    node_id: "table_schema".to_string(),
                    type_id: "table_schema".to_string(),
                    definition_version: 1,
                    label: Some("Table Schema".to_string()),
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
                },
                WorkflowNode {
                    node_id: "table_output".to_string(),
                    type_id: "table_output".to_string(),
                    definition_version: 1,
                    label: Some("Table Output".to_string()),
                    config: json!({
                        "target_schema": "outputs",
                        "table_name": "news_brief",
                        "input_shape": "table_schema",
                        "write_mode": "append"
                    }),
                    position: NodePosition::default(),
                },
            ],
            edges: vec![WorkflowEdge {
                edge_id: "edge_table_schema_table_to_table_output_text".to_string(),
                source_node_id: "table_schema".to_string(),
                source_port_id: "table".to_string(),
                target_node_id: "table_output".to_string(),
                target_port_id: "text".to_string(),
            }],
            metadata: Default::default(),
        };

        let validation = runtime.validate_workflow(&workflow);
        assert!(validation.valid, "expected valid flow, got: {validation:?}");
    }
}
