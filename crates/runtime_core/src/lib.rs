use std::{
    collections::{BTreeMap, BTreeSet, HashMap, VecDeque},
    sync::Arc,
};

use api_contract::{
    ConnectionSummary, CreateRunRequest, CreateRunResponse, EventTarget, EventTargetKind,
    IssueSeverity, LogLevel, NodeDefinitionsResponse, NodeRunSnapshot, NodeRunStatus,
    RunErrorCategory, RunErrorSummary, RunEvent, RunEventType, RunLogEntry, RunSnapshot, RunStatus,
    ValidateWorkflowResponse, ValidationIssue,
};
use chrono::Utc;
use node_registry::NodeRegistry;
use runtime_adapters::{AdapterError, PortValues, RuntimeAdapters};
use serde_json::{json, Value};
use thiserror::Error;
use tokio::sync::{broadcast, RwLock};
use uuid::Uuid;
use workflow_schema::{WorkflowDefinition, WorkflowNode, CURRENT_SCHEMA_VERSION};

#[derive(Clone)]
pub struct RuntimeService {
    registry: Arc<NodeRegistry>,
    adapters: Arc<RuntimeAdapters>,
    state: Arc<RwLock<RuntimeState>>,
    connections: Arc<Vec<ConnectionSummary>>,
}

struct RuntimeState {
    runs: HashMap<String, Arc<RunRecord>>,
}

struct RunRecord {
    snapshot: RwLock<RunSnapshot>,
    history: RwLock<Vec<RunEvent>>,
    sender: broadcast::Sender<RunEvent>,
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

            if source_port.data_type != target_port.data_type {
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
        let spawned_run_id = run_id.clone();
        tokio::spawn(async move {
            runtime.execute_run(spawned_run_id, workflow).await;
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

    async fn execute_run(&self, run_id: String, workflow: WorkflowDefinition) {
        let Some(record) = self.get_record(&run_id).await else {
            return;
        };

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
        self.mark_running(&record, &run_id).await;

        let mut outputs = BTreeMap::<(String, String), workflow_schema::TypedValue>::new();
        for node_id in plan {
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

            match self.adapters.execute(definition, node, &inputs) {
                Ok(result) => {
                    for log_line in &result.logs {
                        self.record_log(&record, &run_id, Some(&node.node_id), log_line.clone())
                            .await;
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
                }
                Err(error) => {
                    self.fail_run(
                        &record,
                        &run_id,
                        Some(&node.node_id),
                        to_run_error_from_adapter(node, error),
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
    match node.type_id.as_str() {
        "text_input" => {
            let text = node.config.get("text").and_then(Value::as_str);
            if text.is_none() {
                Some(issue(
                    "invalid_text_input_config",
                    format!(
                        "Node `{}` requires a string `text` config field.",
                        node.node_id
                    ),
                    Some(format!("workflow.nodes.{}.config.text", node.node_id)),
                ))
            } else {
                None
            }
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

            None
        }
        _ => None,
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

fn to_run_error_from_adapter(node: &WorkflowNode, error: AdapterError) -> RunErrorSummary {
    RunErrorSummary {
        category: RunErrorCategory::ExecutionError,
        message: format!("Node `{}` failed: {error}", node.node_id),
    }
}

#[cfg(test)]
mod tests {
    use api_contract::{CreateRunRequest, RunStatus};
    use serde_json::json;
    use tokio::time::{sleep, Duration};
    use workflow_schema::WorkflowDefinition;

    use super::RuntimeService;

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
}
