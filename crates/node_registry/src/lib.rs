use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use utoipa::ToSchema;
use workflow_schema::DataType;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PortDirection {
    Input,
    Output,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ExecutorKind {
    RustNative,
    Python,
    Process,
    EngineAdapter,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum IsolationMode {
    InProcess,
    Subprocess,
    ExternalEngine,
    Container,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct PortDefinition {
    pub port_id: String,
    pub display_name: String,
    pub direction: PortDirection,
    pub data_type: DataType,
    pub required: bool,
    pub multiple: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct RuntimeBinding {
    pub executor_kind: ExecutorKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub adapter_id: Option<String>,
    pub isolation_mode: IsolationMode,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct NodeCapabilities {
    #[serde(default)]
    pub reads_external_state: bool,
    #[serde(default)]
    pub writes_external_state: bool,
    #[serde(default)]
    pub produces_durable_artifacts: bool,
    #[serde(default)]
    pub supports_preview: bool,
    #[serde(default)]
    pub requires_connection: bool,
    #[serde(default)]
    pub may_emit_structured_logs: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct NodeUi {
    pub icon: String,
    pub color_token: String,
    pub default_width: u32,
    pub default_height: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub help_text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub node_card: Option<NodeCardUi>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct NodeCardUi {
    pub variant: String,
    pub icon_key: String,
    pub top_chip: NodeCardTopChip,
    pub header: NodeCardHeader,
    #[serde(default)]
    pub rows: Vec<NodeCardRow>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub footer: Option<NodeCardFooter>,
    pub handles: NodeCardHandles,
    pub size: NodeCardSize,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct NodeCardTopChip {
    #[serde(default)]
    pub visible: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct NodeCardHeader {
    pub title_source: String,
    #[serde(default)]
    pub show_overflow_menu: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subtitle: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status_badge: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct NodeCardRow {
    pub row_id: String,
    pub kind: String,
    pub label: String,
    pub value: NodeCardValueBinding,
    pub formatter: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon_key: Option<String>,
    #[serde(default)]
    pub truncate: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct NodeCardValueBinding {
    pub source: String,
    pub path: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct NodeCardFooter {
    pub kind: String,
    pub label: String,
    pub value: NodeCardValueBinding,
    pub formatter: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon_key: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct NodeCardHandles {
    pub input_layout: String,
    pub output_layout: String,
    pub show_labels: String,
    #[serde(default)]
    pub align_to_rows: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct NodeCardSize {
    pub width: u32,
    pub density: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct NodeDefinition {
    pub type_id: String,
    pub version: u32,
    pub display_name: String,
    pub category: String,
    pub description: String,
    #[serde(default)]
    pub inputs: Vec<PortDefinition>,
    #[serde(default)]
    pub outputs: Vec<PortDefinition>,
    pub config_schema: Value,
    pub runtime: RuntimeBinding,
    pub capabilities: NodeCapabilities,
    pub ui: NodeUi,
}

impl NodeDefinition {
    pub fn input_port(&self, port_id: &str) -> Option<&PortDefinition> {
        self.inputs.iter().find(|port| port.port_id == port_id)
    }

    pub fn output_port(&self, port_id: &str) -> Option<&PortDefinition> {
        self.outputs.iter().find(|port| port.port_id == port_id)
    }
}

#[derive(Clone, Debug)]
pub struct NodeRegistry {
    definitions: HashMap<String, NodeDefinition>,
}

impl NodeRegistry {
    pub fn builtin() -> Self {
        let definitions = builtin_node_definitions()
            .into_iter()
            .map(|definition| (definition.type_id.clone(), definition))
            .collect();

        Self { definitions }
    }

    pub fn get(&self, type_id: &str) -> Option<&NodeDefinition> {
        self.definitions.get(type_id)
    }

    pub fn list(&self) -> Vec<NodeDefinition> {
        let mut definitions = self.definitions.values().cloned().collect::<Vec<_>>();
        definitions.sort_by(|left, right| left.display_name.cmp(&right.display_name));
        definitions
    }
}

fn node_card_value(source: &str, path: &str) -> NodeCardValueBinding {
    NodeCardValueBinding {
        source: source.to_string(),
        path: path.to_string(),
    }
}

fn node_card_row(
    row_id: &str,
    kind: &str,
    label: &str,
    source: &str,
    path: &str,
    formatter: &str,
    icon_key: Option<&str>,
    truncate: bool,
) -> NodeCardRow {
    NodeCardRow {
        row_id: row_id.to_string(),
        kind: kind.to_string(),
        label: label.to_string(),
        value: node_card_value(source, path),
        formatter: formatter.to_string(),
        icon_key: icon_key.map(str::to_string),
        truncate,
    }
}

fn node_card_footer(
    kind: &str,
    label: &str,
    source: &str,
    path: &str,
    formatter: &str,
    icon_key: Option<&str>,
) -> NodeCardFooter {
    NodeCardFooter {
        kind: kind.to_string(),
        label: label.to_string(),
        value: node_card_value(source, path),
        formatter: formatter.to_string(),
        icon_key: icon_key.map(str::to_string),
    }
}

fn node_card_handles(input_layout: &str, output_layout: &str) -> NodeCardHandles {
    NodeCardHandles {
        input_layout: input_layout.to_string(),
        output_layout: output_layout.to_string(),
        show_labels: "never".to_string(),
        align_to_rows: true,
    }
}

fn node_card_size(width: u32) -> NodeCardSize {
    NodeCardSize {
        width,
        density: "comfortable".to_string(),
    }
}

fn visible_top_chip(text: &str) -> NodeCardTopChip {
    NodeCardTopChip {
        visible: true,
        text: Some(text.to_string()),
    }
}

fn hidden_top_chip() -> NodeCardTopChip {
    NodeCardTopChip {
        visible: false,
        text: None,
    }
}

fn standard_header() -> NodeCardHeader {
    NodeCardHeader {
        title_source: "instance_label_or_display_name".to_string(),
        show_overflow_menu: true,
        subtitle: None,
        status_badge: None,
    }
}

pub fn builtin_node_definitions() -> Vec<NodeDefinition> {
    vec![
        NodeDefinition {
            type_id: "text_input".to_string(),
            version: 1,
            display_name: "Text Input".to_string(),
            category: "input".to_string(),
            description: "Injects literal text into the workflow.".to_string(),
            inputs: vec![],
            outputs: vec![PortDefinition {
                port_id: "text".to_string(),
                display_name: "Text".to_string(),
                direction: PortDirection::Output,
                data_type: DataType::Text,
                required: true,
                multiple: false,
                description: Some("The provided text payload.".to_string()),
            }],
            config_schema: json!({
                "type": "object",
                "required": ["text"],
                "properties": {
                    "text": {
                        "type": "string",
                        "title": "Text"
                    },
                    "trim_mode": {
                        "type": "string",
                        "enum": ["automatic", "trim", "exact"],
                        "default": "automatic"
                    },
                    "preserve_whitespace": {
                        "type": "boolean",
                        "default": true
                    },
                    "include_line_breaks": {
                        "type": "boolean",
                        "default": true
                    }
                }
            }),
            runtime: RuntimeBinding {
                executor_kind: ExecutorKind::RustNative,
                adapter_id: None,
                isolation_mode: IsolationMode::InProcess,
            },
            capabilities: NodeCapabilities {
                supports_preview: true,
                may_emit_structured_logs: true,
                ..NodeCapabilities::default()
            },
            ui: NodeUi {
                icon: "type".to_string(),
                color_token: "var(--node-input)".to_string(),
                default_width: 320,
                default_height: 160,
                help_text: Some(
                    "Provide starter text for a flow or quick runtime smoke test.".to_string(),
                ),
                node_card: Some(NodeCardUi {
                    variant: "trigger".to_string(),
                    icon_key: "text_input".to_string(),
                    top_chip: visible_top_chip("Start"),
                    header: standard_header(),
                    rows: vec![
                        node_card_row(
                            "text_value",
                            "text_block",
                            "Text",
                            "config",
                            "text",
                            "text",
                            None,
                            true,
                        ),
                        node_card_row(
                            "char_count",
                            "kv",
                            "Length",
                            "derived",
                            "char_count",
                            "text",
                            Some("metric"),
                            false,
                        ),
                    ],
                    footer: Some(node_card_footer(
                        "metric",
                        "Last run",
                        "runtime",
                        "last_status",
                        "status",
                        Some("status"),
                    )),
                    handles: node_card_handles("none", "single_right"),
                    size: node_card_size(320),
                }),
            },
        },
        NodeDefinition {
            type_id: "text_transform".to_string(),
            version: 1,
            display_name: "Text Transform".to_string(),
            category: "compute".to_string(),
            description: "Runs a tiny built-in Rust text transform.".to_string(),
            inputs: vec![PortDefinition {
                port_id: "source".to_string(),
                display_name: "Source".to_string(),
                direction: PortDirection::Input,
                data_type: DataType::Text,
                required: true,
                multiple: false,
                description: Some("Upstream text value.".to_string()),
            }],
            outputs: vec![PortDefinition {
                port_id: "text".to_string(),
                display_name: "Text".to_string(),
                direction: PortDirection::Output,
                data_type: DataType::Text,
                required: true,
                multiple: false,
                description: Some("Transformed text output.".to_string()),
            }],
            config_schema: json!({
                "type": "object",
                "properties": {
                    "operation": {
                        "type": "string",
                        "enum": ["identity", "uppercase", "trim"],
                        "default": "identity"
                    }
                }
            }),
            runtime: RuntimeBinding {
                executor_kind: ExecutorKind::RustNative,
                adapter_id: None,
                isolation_mode: IsolationMode::InProcess,
            },
            capabilities: NodeCapabilities {
                supports_preview: true,
                may_emit_structured_logs: true,
                ..NodeCapabilities::default()
            },
            ui: NodeUi {
                icon: "wand".to_string(),
                color_token: "var(--node-transform)".to_string(),
                default_width: 340,
                default_height: 156,
                help_text: Some("A starter compute node for the first vertical slice.".to_string()),
                node_card: Some(NodeCardUi {
                    variant: "compute".to_string(),
                    icon_key: "text_transform".to_string(),
                    top_chip: hidden_top_chip(),
                    header: standard_header(),
                    rows: vec![
                        node_card_row(
                            "operation",
                            "kv",
                            "Operation",
                            "config",
                            "operation",
                            "text",
                            Some("logic"),
                            false,
                        ),
                        node_card_row(
                            "preview",
                            "text_block",
                            "Input",
                            "runtime",
                            "last_input_preview",
                            "text",
                            None,
                            true,
                        ),
                    ],
                    footer: Some(node_card_footer(
                        "metric",
                        "Duration",
                        "runtime",
                        "last_duration_ms",
                        "duration_ms",
                        Some("duration"),
                    )),
                    handles: node_card_handles("single_left", "single_right"),
                    size: node_card_size(340),
                }),
            },
        },
        NodeDefinition {
            type_id: "send_email".to_string(),
            version: 1,
            display_name: "Send Email".to_string(),
            category: "output".to_string(),
            description: "Queues an email-style notification from the workflow.".to_string(),
            inputs: vec![PortDefinition {
                port_id: "body".to_string(),
                display_name: "Body".to_string(),
                direction: PortDirection::Input,
                data_type: DataType::Text,
                required: false,
                multiple: false,
                description: Some("Optional upstream message body.".to_string()),
            }],
            outputs: vec![],
            config_schema: json!({
                "type": "object",
                "required": ["to", "subject"],
                "properties": {
                    "to": {
                        "type": "string"
                    },
                    "subject": {
                        "type": "string"
                    },
                    "body": {
                        "type": "string"
                    },
                    "body_mode": {
                        "type": "string",
                        "enum": ["input", "custom"],
                        "default": "input"
                    },
                    "body_text": {
                        "type": "string"
                    },
                    "connection_id": {
                        "type": "string"
                    },
                    "content_type": {
                        "type": "string",
                        "enum": ["text/plain", "text/html"],
                        "default": "text/plain"
                    }
                }
            }),
            runtime: RuntimeBinding {
                executor_kind: ExecutorKind::RustNative,
                adapter_id: None,
                isolation_mode: IsolationMode::InProcess,
            },
            capabilities: NodeCapabilities {
                writes_external_state: true,
                requires_connection: false,
                may_emit_structured_logs: true,
                ..NodeCapabilities::default()
            },
            ui: NodeUi {
                icon: "email".to_string(),
                color_token: "var(--node-output)".to_string(),
                default_width: 392,
                default_height: 176,
                help_text: Some(
                    "Deliver a simple email-style notification from the flow.".to_string(),
                ),
                node_card: Some(NodeCardUi {
                    variant: "output".to_string(),
                    icon_key: "send_email".to_string(),
                    top_chip: visible_top_chip("Notify"),
                    header: standard_header(),
                    rows: vec![
                        node_card_row(
                            "to",
                            "kv",
                            "To",
                            "config",
                            "to",
                            "text",
                            Some("label"),
                            false,
                        ),
                        node_card_row(
                            "subject",
                            "text_block",
                            "Subject",
                            "config",
                            "subject",
                            "text",
                            None,
                            true,
                        ),
                    ],
                    footer: Some(node_card_footer(
                        "metric",
                        "Last send",
                        "runtime",
                        "last_status",
                        "status",
                        Some("status"),
                    )),
                    handles: node_card_handles("single_left", "none"),
                    size: node_card_size(392),
                }),
            },
        },
        NodeDefinition {
            type_id: "table_input".to_string(),
            version: 1,
            display_name: "Table Input".to_string(),
            category: "input".to_string(),
            description: "References a source table from the workflow DuckDB catalog.".to_string(),
            inputs: vec![],
            outputs: vec![PortDefinition {
                port_id: "table".to_string(),
                display_name: "Table".to_string(),
                direction: PortDirection::Output,
                data_type: DataType::TableRef,
                required: false,
                multiple: false,
                description: Some("Resolved workflow table reference.".to_string()),
            }],
            config_schema: json!({
                "type": "object",
                "required": ["schema_name", "table_name"],
                "properties": {
                    "catalog": {
                        "type": "string",
                        "default": "workflow.duckdb"
                    },
                    "schema_name": {
                        "type": "string",
                        "default": "runs"
                    },
                    "table_name": {
                        "type": "string",
                        "default": "workflow_runs"
                    },
                    "output_alias": {
                        "type": "string",
                        "default": "workflow_runs"
                    },
                    "selected_columns": {
                        "type": "array",
                        "items": {
                            "type": "string"
                        },
                        "default": []
                    },
                    "row_filter": {
                        "type": "string"
                    },
                    "row_limit": {
                        "type": "integer",
                        "minimum": 1
                    },
                    "refresh_schema": {
                        "type": "boolean",
                        "default": true
                    },
                    "open_in_catalog": {
                        "type": "boolean",
                        "default": false
                    }
                }
            }),
            runtime: RuntimeBinding {
                executor_kind: ExecutorKind::RustNative,
                adapter_id: None,
                isolation_mode: IsolationMode::InProcess,
            },
            capabilities: NodeCapabilities {
                reads_external_state: true,
                supports_preview: true,
                may_emit_structured_logs: true,
                ..NodeCapabilities::default()
            },
            ui: NodeUi {
                icon: "table_input".to_string(),
                color_token: "var(--node-input)".to_string(),
                default_width: 336,
                default_height: 176,
                help_text: Some(
                    "Read a named source table from the workflow DuckDB file.".to_string(),
                ),
                node_card: Some(NodeCardUi {
                    variant: "input".to_string(),
                    icon_key: "table_output".to_string(),
                    top_chip: hidden_top_chip(),
                    header: standard_header(),
                    rows: vec![
                        node_card_row(
                            "schema_name",
                            "kv",
                            "Schema",
                            "config",
                            "schema_name",
                            "text",
                            Some("table_output"),
                            false,
                        ),
                        node_card_row(
                            "table_name",
                            "kv",
                            "Table",
                            "config",
                            "table_name",
                            "text",
                            Some("label"),
                            false,
                        ),
                    ],
                    footer: Some(node_card_footer(
                        "metric",
                        "Catalog",
                        "config",
                        "catalog",
                        "text",
                        Some("status"),
                    )),
                    handles: node_card_handles("none", "single_right"),
                    size: node_card_size(336),
                }),
            },
        },
        NodeDefinition {
            type_id: "dolt_repo_source".to_string(),
            version: 1,
            display_name: "Dolt Repo Source".to_string(),
            category: "input".to_string(),
            description:
                "Prepares a reusable Dolt working copy and emits repo metadata for downstream sync or export nodes."
                    .to_string(),
            inputs: vec![],
            outputs: vec![PortDefinition {
                port_id: "repo_out".to_string(),
                display_name: "Repo".to_string(),
                direction: PortDirection::Output,
                data_type: DataType::DatasetRef,
                required: false,
                multiple: false,
                description: Some("Dolt repo reference plus checkout metadata.".to_string()),
            }],
            config_schema: json!({
                "type": "object",
                "required": ["connection_ref", "repository", "branch"],
                "properties": {
                    "connection_ref": {
                        "type": "string",
                        "default": "dolthub_public"
                    },
                    "repository": {
                        "type": "string",
                        "default": "post-no-preference/earnings"
                    },
                    "branch": {
                        "type": "string",
                        "default": "main"
                    },
                    "checkout_ref": {
                        "type": "string",
                        "default": ""
                    },
                    "clone_mode": {
                        "type": "string",
                        "enum": ["reuse_local_copy", "fresh_clone", "depth_1"],
                        "default": "reuse_local_copy"
                    },
                    "sync_strategy": {
                        "type": "string",
                        "enum": ["pull_before_execution", "clone_only", "manual"],
                        "default": "pull_before_execution"
                    }
                }
            }),
            runtime: RuntimeBinding {
                executor_kind: ExecutorKind::RustNative,
                adapter_id: None,
                isolation_mode: IsolationMode::InProcess,
            },
            capabilities: NodeCapabilities {
                reads_external_state: true,
                supports_preview: true,
                requires_connection: true,
                may_emit_structured_logs: true,
                ..NodeCapabilities::default()
            },
            ui: NodeUi {
                icon: "dolt_repo_source".to_string(),
                color_token: "var(--node-input)".to_string(),
                default_width: 336,
                default_height: 176,
                help_text: Some(
                    "Track a Dolt repository checkout before sync, dump, or diff export nodes."
                        .to_string(),
                ),
                node_card: Some(NodeCardUi {
                    variant: "input".to_string(),
                    icon_key: "dolt_repo_source".to_string(),
                    top_chip: hidden_top_chip(),
                    header: standard_header(),
                    rows: vec![
                        node_card_row(
                            "repository",
                            "kv",
                            "Repo",
                            "config",
                            "repository",
                            "text",
                            Some("dolt_repo_source"),
                            true,
                        ),
                        node_card_row(
                            "branch",
                            "kv",
                            "Branch",
                            "config",
                            "branch",
                            "text",
                            Some("logic"),
                            false,
                        ),
                        node_card_row(
                            "sync_strategy",
                            "kv",
                            "Sync",
                            "config",
                            "sync_strategy",
                            "text",
                            Some("metric"),
                            false,
                        ),
                    ],
                    footer: Some(node_card_footer(
                        "metric",
                        "Current commit",
                        "derived",
                        "dolt_current_commit",
                        "text",
                        Some("status"),
                    )),
                    handles: node_card_handles("none", "single_right"),
                    size: node_card_size(336),
                }),
            },
        },
        NodeDefinition {
            type_id: "checkpoint_read".to_string(),
            version: 1,
            display_name: "Checkpoint Read".to_string(),
            category: "compute".to_string(),
            description:
                "Recovers the last successful ingest position for a repo and branch before recurring sync resumes."
                    .to_string(),
            inputs: vec![],
            outputs: vec![PortDefinition {
                port_id: "checkpoint".to_string(),
                display_name: "Checkpoint".to_string(),
                direction: PortDirection::Output,
                data_type: DataType::Json,
                required: false,
                multiple: false,
                description: Some(
                    "Checkpoint context carrying the previous successful commit and success metadata."
                        .to_string(),
                ),
            }],
            config_schema: json!({
                "type": "object",
                "required": ["checkpoint_table", "source_repo", "branch"],
                "properties": {
                    "checkpoint_table": {
                        "type": "string",
                        "default": "tables.ingest_checkpoints"
                    },
                    "source_repo": {
                        "type": "string",
                        "default": "post-no-preference/earnings"
                    },
                    "branch": {
                        "type": "string",
                        "default": "main"
                    },
                    "emit_bootstrap_marker_if_missing": {
                        "type": "boolean",
                        "default": true
                    },
                    "fail_on_stale_checkpoint": {
                        "type": "boolean",
                        "default": false
                    }
                }
            }),
            runtime: RuntimeBinding {
                executor_kind: ExecutorKind::RustNative,
                adapter_id: None,
                isolation_mode: IsolationMode::InProcess,
            },
            capabilities: NodeCapabilities {
                reads_external_state: true,
                supports_preview: true,
                may_emit_structured_logs: true,
                produces_durable_artifacts: false,
                ..NodeCapabilities::default()
            },
            ui: NodeUi {
                icon: "checkpoint_read".to_string(),
                color_token: "var(--node-input)".to_string(),
                default_width: 336,
                default_height: 176,
                help_text: Some(
                    "Read the last successful commit boundary before recurring repo sync begins."
                        .to_string(),
                ),
                node_card: Some(NodeCardUi {
                    variant: "compute".to_string(),
                    icon_key: "checkpoint_read".to_string(),
                    top_chip: hidden_top_chip(),
                    header: standard_header(),
                    rows: vec![
                        node_card_row(
                            "source_repo",
                            "kv",
                            "Repo",
                            "config",
                            "source_repo",
                            "text",
                            Some("label"),
                            true,
                        ),
                        node_card_row(
                            "branch",
                            "kv",
                            "Branch",
                            "config",
                            "branch",
                            "text",
                            Some("status"),
                            false,
                        ),
                    ],
                    footer: Some(node_card_footer(
                        "metric",
                        "Checkpoint store",
                        "config",
                        "checkpoint_table",
                        "text",
                        Some("metric"),
                    )),
                    handles: node_card_handles("none", "single_right"),
                    size: node_card_size(336),
                }),
            },
        },
        NodeDefinition {
            type_id: "checkpoint_write".to_string(),
            version: 1,
            display_name: "Checkpoint Write".to_string(),
            category: "control".to_string(),
            description:
                "Persists the new ingest checkpoint only after upstream durable table work is safe to acknowledge."
                    .to_string(),
            inputs: vec![PortDefinition {
                port_id: "table".to_string(),
                display_name: "Table".to_string(),
                direction: PortDirection::Input,
                data_type: DataType::TableRef,
                required: true,
                multiple: false,
                description: Some(
                    "Durable workflow table reference carrying upstream commit and merge metadata."
                        .to_string(),
                ),
            }],
            outputs: vec![PortDefinition {
                port_id: "table".to_string(),
                display_name: "Table".to_string(),
                direction: PortDirection::Output,
                data_type: DataType::TableRef,
                required: false,
                multiple: false,
                description: Some(
                    "The same durable table reference enriched with checkpoint persistence metadata."
                        .to_string(),
                ),
            }],
            config_schema: json!({
                "type": "object",
                "required": ["checkpoint_table"],
                "properties": {
                    "checkpoint_table": {
                        "type": "string",
                        "default": "tables.ingest_checkpoints"
                    },
                    "commit_source": {
                        "type": "string",
                        "enum": ["metadata.current_commit"],
                        "default": "metadata.current_commit"
                    },
                    "write_timing": {
                        "type": "string",
                        "enum": ["after_merge_success", "after_quality_gate"],
                        "default": "after_merge_success"
                    },
                    "only_persist_on_full_success": {
                        "type": "boolean",
                        "default": true
                    },
                    "advance_on_partial_success": {
                        "type": "boolean",
                        "default": false
                    }
                }
            }),
            runtime: RuntimeBinding {
                executor_kind: ExecutorKind::RustNative,
                adapter_id: None,
                isolation_mode: IsolationMode::InProcess,
            },
            capabilities: NodeCapabilities {
                writes_external_state: true,
                supports_preview: true,
                may_emit_structured_logs: true,
                produces_durable_artifacts: true,
                ..NodeCapabilities::default()
            },
            ui: NodeUi {
                icon: "checkpoint_write".to_string(),
                color_token: "var(--node-compute)".to_string(),
                default_width: 336,
                default_height: 176,
                help_text: Some(
                    "Advance the persisted commit boundary only after the durable ingest state is safe."
                        .to_string(),
                ),
                node_card: Some(NodeCardUi {
                    variant: "compute".to_string(),
                    icon_key: "checkpoint_write".to_string(),
                    top_chip: hidden_top_chip(),
                    header: standard_header(),
                    rows: vec![
                        node_card_row(
                            "checkpoint_table",
                            "kv",
                            "Checkpoint",
                            "config",
                            "checkpoint_table",
                            "text",
                            Some("metric"),
                            false,
                        ),
                        node_card_row(
                            "write_timing",
                            "kv",
                            "Timing",
                            "config",
                            "write_timing",
                            "text",
                            Some("status"),
                            false,
                        ),
                    ],
                    footer: Some(node_card_footer(
                        "metric",
                        "Commit source",
                        "config",
                        "commit_source",
                        "text",
                        Some("logic"),
                    )),
                    handles: node_card_handles("single_left", "single_right"),
                    size: node_card_size(336),
                }),
            },
        },
        NodeDefinition {
            type_id: "quality_check".to_string(),
            version: 1,
            display_name: "Quality Check".to_string(),
            category: "control".to_string(),
            description:
                "Applies post-merge validation rules and gates whether checkpoint advancement may continue."
                    .to_string(),
            inputs: vec![PortDefinition {
                port_id: "table".to_string(),
                display_name: "Table".to_string(),
                direction: PortDirection::Input,
                data_type: DataType::TableRef,
                required: true,
                multiple: false,
                description: Some(
                    "Durable workflow table reference ready for post-merge validation.".to_string(),
                ),
            }],
            outputs: vec![PortDefinition {
                port_id: "table".to_string(),
                display_name: "Table".to_string(),
                direction: PortDirection::Output,
                data_type: DataType::TableRef,
                required: false,
                multiple: false,
                description: Some(
                    "The same durable table reference enriched with quality gate metadata."
                        .to_string(),
                ),
            }],
            config_schema: json!({
                "type": "object",
                "properties": {
                    "suite_preset": {
                        "type": "string",
                        "enum": ["post_merge_ingest_gate", "custom_rule_bundle"],
                        "default": "post_merge_ingest_gate"
                    },
                    "schema_drift_rule": {
                        "type": "string",
                        "enum": ["fail_on_required_column_drift", "allow_additive_schema_notes"],
                        "default": "fail_on_required_column_drift"
                    },
                    "null_key_policy": {
                        "type": "string",
                        "enum": ["block_on_primary_key_nulls", "allow_nulls_with_warning"],
                        "default": "block_on_primary_key_nulls"
                    },
                    "warning_budget": {
                        "type": "integer",
                        "minimum": 0,
                        "default": 2
                    },
                    "block_checkpoint_write_on_failure": {
                        "type": "boolean",
                        "default": true
                    },
                    "allow_warning_only_runs_to_continue": {
                        "type": "boolean",
                        "default": true
                    }
                }
            }),
            runtime: RuntimeBinding {
                executor_kind: ExecutorKind::RustNative,
                adapter_id: None,
                isolation_mode: IsolationMode::InProcess,
            },
            capabilities: NodeCapabilities {
                supports_preview: true,
                may_emit_structured_logs: true,
                produces_durable_artifacts: true,
                ..NodeCapabilities::default()
            },
            ui: NodeUi {
                icon: "quality_check".to_string(),
                color_token: "var(--node-compute)".to_string(),
                default_width: 336,
                default_height: 176,
                help_text: Some(
                    "Run a post-merge rule bundle before advancing checkpoint state or downstream publication."
                        .to_string(),
                ),
                node_card: Some(NodeCardUi {
                    variant: "compute".to_string(),
                    icon_key: "quality_check".to_string(),
                    top_chip: hidden_top_chip(),
                    header: standard_header(),
                    rows: vec![
                        node_card_row(
                            "suite_preset",
                            "kv",
                            "Suite",
                            "config",
                            "suite_preset",
                            "text",
                            Some("logic"),
                            false,
                        ),
                        node_card_row(
                            "warning_budget",
                            "kv",
                            "Budget",
                            "config",
                            "warning_budget",
                            "text",
                            Some("metric"),
                            false,
                        ),
                    ],
                    footer: Some(node_card_footer(
                        "metric",
                        "Schema drift",
                        "config",
                        "schema_drift_rule",
                        "text",
                        Some("status"),
                    )),
                    handles: node_card_handles("single_left", "single_right"),
                    size: node_card_size(336),
                }),
            },
        },
        NodeDefinition {
            type_id: "dolt_repo_sync".to_string(),
            version: 1,
            display_name: "Dolt Repo Sync".to_string(),
            category: "compute".to_string(),
            description:
                "Advances a Dolt repo handle and resolves the previous/current commit range for recurring ingest."
                    .to_string(),
            inputs: vec![
                PortDefinition {
                    port_id: "repo".to_string(),
                    display_name: "Repo".to_string(),
                    direction: PortDirection::Input,
                    data_type: DataType::DatasetRef,
                    required: true,
                    multiple: false,
                    description: Some("Upstream Dolt repo reference from a source node.".to_string()),
                },
                PortDefinition {
                    port_id: "checkpoint".to_string(),
                    display_name: "Checkpoint".to_string(),
                    direction: PortDirection::Input,
                    data_type: DataType::Json,
                    required: false,
                    multiple: false,
                    description: Some(
                        "Optional checkpoint context that overrides the previous commit boundary."
                            .to_string(),
                    ),
                },
            ],
            outputs: vec![PortDefinition {
                port_id: "repo_out".to_string(),
                display_name: "Repo".to_string(),
                direction: PortDirection::Output,
                data_type: DataType::DatasetRef,
                required: false,
                multiple: false,
                description: Some(
                    "Synced Dolt repo reference plus resolved commit-range metadata.".to_string(),
                ),
            }],
            config_schema: json!({
                "type": "object",
                "properties": {
                    "sync_action": {
                        "type": "string",
                        "enum": ["pull_remote_head", "fetch_and_checkout", "refresh_checkout"],
                        "default": "pull_remote_head"
                    },
                    "no_change_behavior": {
                        "type": "string",
                        "enum": ["emit_current_range", "emit_no_op_marker"],
                        "default": "emit_current_range"
                    },
                    "branch_guard": {
                        "type": "string",
                        "enum": ["require_tracked_branch_match", "allow_detached_head"],
                        "default": "require_tracked_branch_match"
                    },
                    "dirty_working_copy_policy": {
                        "type": "string",
                        "enum": ["fail_if_dirty", "stash_and_continue"],
                        "default": "fail_if_dirty"
                    }
                }
            }),
            runtime: RuntimeBinding {
                executor_kind: ExecutorKind::RustNative,
                adapter_id: None,
                isolation_mode: IsolationMode::InProcess,
            },
            capabilities: NodeCapabilities {
                reads_external_state: true,
                supports_preview: true,
                may_emit_structured_logs: true,
                ..NodeCapabilities::default()
            },
            ui: NodeUi {
                icon: "dolt_repo_sync".to_string(),
                color_token: "var(--node-input)".to_string(),
                default_width: 336,
                default_height: 176,
                help_text: Some(
                    "Resolve the recurring commit range between a checkpointed repo copy and the latest remote state."
                        .to_string(),
                ),
                node_card: Some(NodeCardUi {
                    variant: "compute".to_string(),
                    icon_key: "dolt_repo_sync".to_string(),
                    top_chip: hidden_top_chip(),
                    header: standard_header(),
                    rows: vec![
                        node_card_row(
                            "previous_commit",
                            "kv",
                            "From",
                            "derived",
                            "dolt_sync_previous_commit",
                            "text",
                            Some("metric"),
                            false,
                        ),
                        node_card_row(
                            "current_commit",
                            "kv",
                            "To",
                            "derived",
                            "dolt_sync_current_commit",
                            "text",
                            Some("status"),
                            false,
                        ),
                    ],
                    footer: Some(node_card_footer(
                        "metric",
                        "Sync action",
                        "derived",
                        "dolt_sync_action",
                        "text",
                        Some("logic"),
                    )),
                    handles: node_card_handles("single_left", "single_right"),
                    size: node_card_size(336),
                }),
            },
        },
        NodeDefinition {
            type_id: "dolt_change_manifest".to_string(),
            version: 1,
            display_name: "Dolt Change Manifest".to_string(),
            category: "compute".to_string(),
            description:
                "Computes a scoped changed-table manifest from an upstream Dolt commit range."
                    .to_string(),
            inputs: vec![PortDefinition {
                port_id: "repo".to_string(),
                display_name: "Repo".to_string(),
                direction: PortDirection::Input,
                data_type: DataType::DatasetRef,
                required: true,
                multiple: false,
                description: Some(
                    "Synced Dolt repo reference with resolved commit-range metadata."
                        .to_string(),
                ),
            }],
            outputs: vec![PortDefinition {
                port_id: "manifest".to_string(),
                display_name: "Manifest".to_string(),
                direction: PortDirection::Output,
                data_type: DataType::DatasetRef,
                required: false,
                multiple: false,
                description: Some(
                    "Changed-table manifest reference plus schema-drift metadata."
                        .to_string(),
                ),
            }],
            config_schema: json!({
                "type": "object",
                "properties": {
                    "table_scope": {
                        "type": "string",
                        "enum": ["all_tables", "allowlist"],
                        "default": "all_tables"
                    },
                    "selected_tables": {
                        "type": "array",
                        "default": [],
                        "items": {
                            "type": "string"
                        }
                    },
                    "schema_change_policy": {
                        "type": "string",
                        "enum": ["flag_and_continue", "fail_run"],
                        "default": "flag_and_continue"
                    }
                }
            }),
            runtime: RuntimeBinding {
                executor_kind: ExecutorKind::RustNative,
                adapter_id: None,
                isolation_mode: IsolationMode::InProcess,
            },
            capabilities: NodeCapabilities {
                reads_external_state: true,
                supports_preview: true,
                may_emit_structured_logs: true,
                ..NodeCapabilities::default()
            },
            ui: NodeUi {
                icon: "dolt_change_manifest".to_string(),
                color_token: "var(--node-input)".to_string(),
                default_width: 336,
                default_height: 176,
                help_text: Some(
                    "Scope changed tables from a resolved Dolt range before diff export or selective re-dump."
                        .to_string(),
                ),
                node_card: Some(NodeCardUi {
                    variant: "compute".to_string(),
                    icon_key: "dolt_change_manifest".to_string(),
                    top_chip: hidden_top_chip(),
                    header: standard_header(),
                    rows: vec![
                        node_card_row(
                            "range",
                            "kv",
                            "Range",
                            "derived",
                            "dolt_manifest_range",
                            "text",
                            Some("metric"),
                            false,
                        ),
                        node_card_row(
                            "scope",
                            "kv",
                            "Scope",
                            "derived",
                            "dolt_manifest_scope",
                            "text",
                            Some("logic"),
                            false,
                        ),
                    ],
                    footer: Some(node_card_footer(
                        "metric",
                        "Schema drift",
                        "derived",
                        "dolt_manifest_schema_drift",
                        "text",
                        Some("status"),
                    )),
                    handles: node_card_handles("single_left", "single_right"),
                    size: node_card_size(336),
                }),
            },
        },
        NodeDefinition {
            type_id: "dolt_dump".to_string(),
            version: 1,
            display_name: "Dolt Dump".to_string(),
            category: "data_movement".to_string(),
            description:
                "Exports whole Dolt tables into a bundle directory for downstream raw landing."
                    .to_string(),
            inputs: vec![PortDefinition {
                port_id: "repo".to_string(),
                display_name: "Repo".to_string(),
                direction: PortDirection::Input,
                data_type: DataType::DatasetRef,
                required: true,
                multiple: false,
                description: Some(
                    "Upstream Dolt repo or manifest dataset that resolves the export scope."
                        .to_string(),
                ),
            }],
            outputs: vec![PortDefinition {
                port_id: "bundle".to_string(),
                display_name: "Bundle".to_string(),
                direction: PortDirection::Output,
                data_type: DataType::DirectoryRef,
                required: false,
                multiple: false,
                description: Some(
                    "Directory reference for the exported file bundle and manifest metadata."
                        .to_string(),
                ),
            }],
            config_schema: json!({
                "type": "object",
                "properties": {
                    "output_format": {
                        "type": "string",
                        "enum": ["csv", "parquet"],
                        "default": "parquet"
                    },
                    "table_selection_mode": {
                        "type": "string",
                        "enum": ["prefer_manifest_scope", "all_tables", "manual_tables"],
                        "default": "prefer_manifest_scope"
                    },
                    "selected_tables": {
                        "type": "array",
                        "default": [],
                        "items": {
                            "type": "string"
                        }
                    },
                    "artifact_retention": {
                        "type": "string",
                        "enum": ["keep_latest_success", "ephemeral_per_run", "persist_all"],
                        "default": "keep_latest_success"
                    },
                    "output_directory_policy": {
                        "type": "string",
                        "enum": ["ephemeral_run_bundle", "stable_repo_cache"],
                        "default": "ephemeral_run_bundle"
                    }
                }
            }),
            runtime: RuntimeBinding {
                executor_kind: ExecutorKind::RustNative,
                adapter_id: None,
                isolation_mode: IsolationMode::InProcess,
            },
            capabilities: NodeCapabilities {
                reads_external_state: true,
                writes_external_state: true,
                produces_durable_artifacts: true,
                supports_preview: true,
                may_emit_structured_logs: true,
                ..NodeCapabilities::default()
            },
            ui: NodeUi {
                icon: "dolt_dump".to_string(),
                color_token: "var(--node-input)".to_string(),
                default_width: 336,
                default_height: 176,
                help_text: Some(
                    "Export Dolt tables into a reusable CSV or Parquet bundle before DuckDB load."
                        .to_string(),
                ),
                node_card: Some(NodeCardUi {
                    variant: "data_movement".to_string(),
                    icon_key: "dolt_dump".to_string(),
                    top_chip: hidden_top_chip(),
                    header: standard_header(),
                    rows: vec![
                        node_card_row(
                            "output_format",
                            "kv",
                            "Format",
                            "config",
                            "output_format",
                            "text",
                            Some("logic"),
                            false,
                        ),
                        node_card_row(
                            "table_selection_mode",
                            "kv",
                            "Tables",
                            "config",
                            "table_selection_mode",
                            "text",
                            Some("metric"),
                            false,
                        ),
                    ],
                    footer: Some(node_card_footer(
                        "metric",
                        "Bundle",
                        "derived",
                        "dolt_dump_bundle",
                        "text",
                        Some("status"),
                    )),
                    handles: node_card_handles("single_left", "single_right"),
                    size: node_card_size(336),
                }),
            },
        },
        NodeDefinition {
            type_id: "dolt_diff_export".to_string(),
            version: 1,
            display_name: "Dolt Diff Export".to_string(),
            category: "data_movement".to_string(),
            description:
                "Exports row-level Dolt deltas from a scoped change manifest into a reusable bundle."
                    .to_string(),
            inputs: vec![PortDefinition {
                port_id: "manifest".to_string(),
                display_name: "Manifest".to_string(),
                direction: PortDirection::Input,
                data_type: DataType::DatasetRef,
                required: true,
                multiple: false,
                description: Some(
                    "Upstream Dolt change manifest that resolves commit range and changed-table scope."
                        .to_string(),
                ),
            }],
            outputs: vec![PortDefinition {
                port_id: "bundle".to_string(),
                display_name: "Bundle".to_string(),
                direction: PortDirection::Output,
                data_type: DataType::DirectoryRef,
                required: false,
                multiple: false,
                description: Some(
                    "Directory reference for row-level delta files plus per-table diff metadata."
                        .to_string(),
                ),
            }],
            config_schema: json!({
                "type": "object",
                "properties": {
                    "output_format": {
                        "type": "string",
                        "enum": ["csv", "parquet"],
                        "default": "parquet"
                    },
                    "change_filter": {
                        "type": "string",
                        "enum": [
                            "all_changes",
                            "non_delete_changes",
                            "added_only",
                            "modified_only",
                            "removed_only"
                        ],
                        "default": "all_changes"
                    },
                    "deleted_row_handling": {
                        "type": "string",
                        "enum": ["emit_delete_markers", "omit_delete_rows"],
                        "default": "emit_delete_markers"
                    }
                }
            }),
            runtime: RuntimeBinding {
                executor_kind: ExecutorKind::RustNative,
                adapter_id: None,
                isolation_mode: IsolationMode::InProcess,
            },
            capabilities: NodeCapabilities {
                reads_external_state: true,
                writes_external_state: true,
                produces_durable_artifacts: true,
                supports_preview: true,
                may_emit_structured_logs: true,
                ..NodeCapabilities::default()
            },
            ui: NodeUi {
                icon: "dolt_diff_export".to_string(),
                color_token: "var(--node-input)".to_string(),
                default_width: 336,
                default_height: 176,
                help_text: Some(
                    "Export row-level Dolt deltas from a change manifest before downstream staging and merge."
                        .to_string(),
                ),
                node_card: Some(NodeCardUi {
                    variant: "data_movement".to_string(),
                    icon_key: "dolt_diff_export".to_string(),
                    top_chip: hidden_top_chip(),
                    header: standard_header(),
                    rows: vec![
                        node_card_row(
                            "range",
                            "kv",
                            "Range",
                            "derived",
                            "dolt_diff_range",
                            "text",
                            Some("metric"),
                            false,
                        ),
                        node_card_row(
                            "filter",
                            "kv",
                            "Filter",
                            "derived",
                            "dolt_diff_filter",
                            "text",
                            Some("logic"),
                            false,
                        ),
                    ],
                    footer: Some(node_card_footer(
                        "metric",
                        "Bundle",
                        "derived",
                        "dolt_diff_bundle",
                        "text",
                        Some("status"),
                    )),
                    handles: node_card_handles("single_left", "single_right"),
                    size: node_card_size(336),
                }),
            },
        },
        NodeDefinition {
            type_id: "load_to_duckdb".to_string(),
            version: 1,
            display_name: "Load to DuckDB".to_string(),
            category: "data_movement".to_string(),
            description:
                "Loads Dolt dump or diff bundles into workflow-local DuckDB staging tables."
                    .to_string(),
            inputs: vec![PortDefinition {
                port_id: "bundle".to_string(),
                display_name: "Bundle".to_string(),
                direction: PortDirection::Input,
                data_type: DataType::DirectoryRef,
                required: true,
                multiple: false,
                description: Some(
                    "Directory reference for either a Dolt dump bundle or a Dolt diff export bundle."
                        .to_string(),
                ),
            }],
            outputs: vec![PortDefinition {
                port_id: "table".to_string(),
                display_name: "Table".to_string(),
                direction: PortDirection::Output,
                data_type: DataType::TableRef,
                required: false,
                multiple: false,
                description: Some(
                    "Workflow-local staging table reference plus load manifest metadata for downstream merge steps."
                        .to_string(),
                ),
            }],
            config_schema: json!({
                "type": "object",
                "required": ["target_schema"],
                "properties": {
                    "target_schema": {
                        "type": "string",
                        "default": "staging"
                    },
                    "table_mapping": {
                        "type": "string",
                        "enum": ["bundle_aware_staging_names"],
                        "default": "bundle_aware_staging_names"
                    },
                    "schema_handling": {
                        "type": "string",
                        "enum": ["infer_on_first_load_validate_on_recurring"],
                        "default": "infer_on_first_load_validate_on_recurring"
                    },
                    "delta_context_preservation": {
                        "type": "string",
                        "enum": ["preserve_commit_range_and_delete_flags"],
                        "default": "preserve_commit_range_and_delete_flags"
                    }
                }
            }),
            runtime: RuntimeBinding {
                executor_kind: ExecutorKind::RustNative,
                adapter_id: None,
                isolation_mode: IsolationMode::InProcess,
            },
            capabilities: NodeCapabilities {
                reads_external_state: true,
                writes_external_state: true,
                produces_durable_artifacts: true,
                supports_preview: true,
                may_emit_structured_logs: true,
                ..NodeCapabilities::default()
            },
            ui: NodeUi {
                icon: "load_to_duckdb".to_string(),
                color_token: "var(--node-input)".to_string(),
                default_width: 336,
                default_height: 176,
                help_text: Some(
                    "Land Dolt snapshot or delta bundles into workflow-local DuckDB staging tables before merge."
                        .to_string(),
                ),
                node_card: Some(NodeCardUi {
                    variant: "data_movement".to_string(),
                    icon_key: "table_output".to_string(),
                    top_chip: hidden_top_chip(),
                    header: standard_header(),
                    rows: vec![
                        node_card_row(
                            "target_schema",
                            "kv",
                            "Target",
                            "config",
                            "target_schema",
                            "text",
                            Some("table_output"),
                            false,
                        ),
                        node_card_row(
                            "bundle_mode",
                            "kv",
                            "Bundle mode",
                            "derived",
                            "load_bundle_mode",
                            "text",
                            Some("logic"),
                            false,
                        ),
                    ],
                    footer: Some(node_card_footer(
                        "metric",
                        "Merge context",
                        "derived",
                        "load_merge_context",
                        "text",
                        Some("status"),
                    )),
                    handles: node_card_handles("single_left", "single_right"),
                    size: node_card_size(336),
                }),
            },
        },
        NodeDefinition {
            type_id: "sql_transform".to_string(),
            version: 1,
            display_name: "SQL Transform".to_string(),
            category: "compute".to_string(),
            description:
                "Creates a workflow-local DuckDB view that reshapes staged tables into merge-ready outputs."
                    .to_string(),
            inputs: vec![PortDefinition {
                port_id: "table".to_string(),
                display_name: "Table".to_string(),
                direction: PortDirection::Input,
                data_type: DataType::TableRef,
                required: true,
                multiple: false,
                description: Some(
                    "Workflow-local staging table reference that will be queried by inline SQL."
                        .to_string(),
                ),
            }],
            outputs: vec![PortDefinition {
                port_id: "table".to_string(),
                display_name: "Table".to_string(),
                direction: PortDirection::Output,
                data_type: DataType::TableRef,
                required: false,
                multiple: false,
                description: Some(
                    "Workflow-local transformed table reference backed by a DuckDB view."
                        .to_string(),
                ),
            }],
            config_schema: json!({
                "type": "object",
                "required": ["target_schema", "output_table_name", "sql_text"],
                "properties": {
                    "target_schema": {
                        "type": "string",
                        "default": "staging_curated"
                    },
                    "output_table_name": {
                        "type": "string",
                        "default": "normalized_view"
                    },
                    "source_table_name": {
                        "type": "string",
                        "default": ""
                    },
                    "materialization_mode": {
                        "type": "string",
                        "enum": ["view"],
                        "default": "view"
                    },
                    "sql_text": {
                        "type": "string",
                        "default": "select *\nfrom {{source}}"
                    }
                }
            }),
            runtime: RuntimeBinding {
                executor_kind: ExecutorKind::RustNative,
                adapter_id: None,
                isolation_mode: IsolationMode::InProcess,
            },
            capabilities: NodeCapabilities {
                supports_preview: true,
                may_emit_structured_logs: true,
                ..NodeCapabilities::default()
            },
            ui: NodeUi {
                icon: "logic".to_string(),
                color_token: "var(--node-transform)".to_string(),
                default_width: 336,
                default_height: 176,
                help_text: Some(
                    "Use inline DuckDB SQL to reshape staging tables into merge-ready workflow views."
                        .to_string(),
                ),
                node_card: Some(NodeCardUi {
                    variant: "compute".to_string(),
                    icon_key: "logic".to_string(),
                    top_chip: hidden_top_chip(),
                    header: standard_header(),
                    rows: vec![
                        node_card_row(
                            "materialization_mode",
                            "kv",
                            "Mode",
                            "config",
                            "materialization_mode",
                            "text",
                            Some("logic"),
                            false,
                        ),
                        node_card_row(
                            "target_schema",
                            "kv",
                            "Target",
                            "config",
                            "target_schema",
                            "text",
                            Some("table_output"),
                            false,
                        ),
                    ],
                    footer: Some(node_card_footer(
                        "metric",
                        "Output",
                        "config",
                        "output_table_name",
                        "text",
                        Some("status"),
                    )),
                    handles: node_card_handles("single_left", "single_right"),
                    size: node_card_size(336),
                }),
            },
        },
        NodeDefinition {
            type_id: "table_merge".to_string(),
            version: 1,
            display_name: "Table Merge".to_string(),
            category: "data_movement".to_string(),
            description:
                "Reconciles staged table batches into durable workflow-owned tables using an explicit merge policy."
                    .to_string(),
            inputs: vec![PortDefinition {
                port_id: "table".to_string(),
                display_name: "Table".to_string(),
                direction: PortDirection::Input,
                data_type: DataType::TableRef,
                required: true,
                multiple: false,
                description: Some(
                    "Workflow-local staged table reference plus merge metadata from upstream landing steps."
                        .to_string(),
                ),
            }],
            outputs: vec![PortDefinition {
                port_id: "table".to_string(),
                display_name: "Table".to_string(),
                direction: PortDirection::Output,
                data_type: DataType::TableRef,
                required: false,
                multiple: false,
                description: Some(
                    "Durable workflow table reference after merge policy has been applied."
                        .to_string(),
                ),
            }],
            config_schema: json!({
                "type": "object",
                "required": ["target_schema"],
                "properties": {
                    "target_schema": {
                        "type": "string",
                        "default": "tables"
                    },
                    "write_policy": {
                        "type": "string",
                        "enum": ["upsert", "append_only", "snapshot_replace"],
                        "default": "upsert"
                    },
                    "merge_key_columns": {
                        "type": "array",
                        "items": { "type": "string" },
                        "default": ["symbol", "report_date"]
                    },
                    "delete_handling": {
                        "type": "string",
                        "enum": ["apply_delete_markers", "ignore_delete_markers"],
                        "default": "apply_delete_markers"
                    },
                    "schema_drift_behavior": {
                        "type": "string",
                        "enum": ["fail_and_require_review", "allow_additive_changes"],
                        "default": "fail_and_require_review"
                    }
                }
            }),
            runtime: RuntimeBinding {
                executor_kind: ExecutorKind::RustNative,
                adapter_id: None,
                isolation_mode: IsolationMode::InProcess,
            },
            capabilities: NodeCapabilities {
                writes_external_state: true,
                produces_durable_artifacts: true,
                supports_preview: true,
                may_emit_structured_logs: true,
                ..NodeCapabilities::default()
            },
            ui: NodeUi {
                icon: "table_output".to_string(),
                color_token: "var(--node-input)".to_string(),
                default_width: 336,
                default_height: 176,
                help_text: Some(
                    "Reconcile staged table batches into durable workflow tables before publish or checkpoint steps."
                        .to_string(),
                ),
                node_card: Some(NodeCardUi {
                    variant: "data_movement".to_string(),
                    icon_key: "logic".to_string(),
                    top_chip: hidden_top_chip(),
                    header: standard_header(),
                    rows: vec![
                        node_card_row(
                            "write_policy",
                            "kv",
                            "Policy",
                            "config",
                            "write_policy",
                            "text",
                            Some("logic"),
                            false,
                        ),
                        node_card_row(
                            "delete_handling",
                            "kv",
                            "Deletes",
                            "config",
                            "delete_handling",
                            "text",
                            Some("metric"),
                            false,
                        ),
                    ],
                    footer: Some(node_card_footer(
                        "metric",
                        "Target",
                        "config",
                        "target_schema",
                        "text",
                        Some("status"),
                    )),
                    handles: node_card_handles("single_left", "single_right"),
                    size: node_card_size(336),
                }),
            },
        },
        NodeDefinition {
            type_id: "table_schema".to_string(),
            version: 1,
            display_name: "Table Schema".to_string(),
            category: "input".to_string(),
            description:
                "Declares a workflow-local table schema and emits a downstream table reference."
                    .to_string(),
            inputs: vec![],
            outputs: vec![PortDefinition {
                port_id: "table".to_string(),
                display_name: "Table".to_string(),
                direction: PortDirection::Output,
                data_type: DataType::TableRef,
                required: false,
                multiple: false,
                description: Some("Declared workflow table reference.".to_string()),
            }],
            config_schema: json!({
                "type": "object",
                "required": ["schema_name", "table_name", "columns"],
                "properties": {
                    "catalog": {
                        "type": "string",
                        "default": "workflow.duckdb"
                    },
                    "schema_name": {
                        "type": "string",
                        "default": "tables"
                    },
                    "table_name": {
                        "type": "string",
                        "default": "orders_fact"
                    },
                    "output_alias": {
                        "type": "string",
                        "default": "orders_fact"
                    },
                    "columns": {
                        "type": "array",
                        "default": [
                            {
                                "name": "order_id",
                                "type": "bigint",
                                "nullable": false,
                                "primary_key": true
                            }
                        ],
                        "items": {
                            "type": "object",
                            "required": ["name", "type"],
                            "properties": {
                                "name": {
                                    "type": "string"
                                },
                                "type": {
                                    "type": "string"
                                },
                                "nullable": {
                                    "type": "boolean",
                                    "default": true
                                },
                                "primary_key": {
                                    "type": "boolean",
                                    "default": false
                                },
                                "default": {
                                    "type": "string"
                                }
                            }
                        }
                    },
                    "primary_key": {
                        "type": "array",
                        "default": [],
                        "items": {
                            "type": "string"
                        }
                    },
                    "checks": {
                        "type": "array",
                        "default": [],
                        "items": {
                            "type": "string"
                        }
                    },
                    "create_mode": {
                        "type": "string",
                        "default": "create_if_missing"
                    },
                    "if_target_exists": {
                        "type": "string",
                        "default": "keep_existing"
                    },
                    "open_in_catalog": {
                        "type": "boolean",
                        "default": false
                    }
                }
            }),
            runtime: RuntimeBinding {
                executor_kind: ExecutorKind::RustNative,
                adapter_id: None,
                isolation_mode: IsolationMode::InProcess,
            },
            capabilities: NodeCapabilities {
                supports_preview: true,
                may_emit_structured_logs: true,
                ..NodeCapabilities::default()
            },
            ui: NodeUi {
                icon: "table_input".to_string(),
                color_token: "var(--node-input)".to_string(),
                default_width: 336,
                default_height: 176,
                help_text: Some(
                    "Define a workflow-local DuckDB table shape before rows are written."
                        .to_string(),
                ),
                node_card: Some(NodeCardUi {
                    variant: "input".to_string(),
                    icon_key: "table_input".to_string(),
                    top_chip: hidden_top_chip(),
                    header: standard_header(),
                    rows: vec![
                        node_card_row(
                            "schema_name",
                            "kv",
                            "Schema",
                            "config",
                            "schema_name",
                            "text",
                            Some("table_input"),
                            false,
                        ),
                        node_card_row(
                            "table_name",
                            "kv",
                            "Table",
                            "config",
                            "table_name",
                            "text",
                            Some("label"),
                            false,
                        ),
                        node_card_row(
                            "create_mode",
                            "kv",
                            "Mode",
                            "config",
                            "create_mode",
                            "text",
                            Some("logic"),
                            false,
                        ),
                    ],
                    footer: Some(node_card_footer(
                        "metric",
                        "Alias",
                        "config",
                        "output_alias",
                        "text",
                        Some("status"),
                    )),
                    handles: node_card_handles("none", "single_right"),
                    size: node_card_size(336),
                }),
            },
        },
        NodeDefinition {
            type_id: "table_output".to_string(),
            version: 1,
            display_name: "Table Output".to_string(),
            category: "output".to_string(),
            description:
                "Persists incoming text or table-backed data into a workflow DuckDB table."
                    .to_string(),
            inputs: vec![PortDefinition {
                port_id: "text".to_string(),
                display_name: "Text".to_string(),
                direction: PortDirection::Input,
                data_type: DataType::Text,
                required: true,
                multiple: false,
                description: Some(
                    "Renderable text row content or a compatible table reference.".to_string(),
                ),
            }],
            outputs: vec![],
            config_schema: json!({
                "type": "object",
                "required": ["target_schema", "table_name"],
                "properties": {
                    "target_schema": {
                        "type": "string",
                        "default": "outputs"
                    },
                    "table_name": {
                        "type": "string",
                        "default": "news_brief"
                    },
                    "write_mode": {
                        "type": "string",
                        "enum": ["append", "replace"],
                        "default": "append"
                    },
                    "input_shape": {
                        "type": "string",
                        "enum": ["single_text_row", "source_table", "table_schema"],
                        "default": "single_text_row"
                    },
                    "value_column": {
                        "type": "string",
                        "default": "content"
                    },
                    "include_run_id": {
                        "type": "boolean",
                        "default": true
                    },
                    "include_written_at": {
                        "type": "boolean",
                        "default": true
                    },
                    "open_in_catalog": {
                        "type": "boolean",
                        "default": false
                    }
                }
            }),
            runtime: RuntimeBinding {
                executor_kind: ExecutorKind::RustNative,
                adapter_id: None,
                isolation_mode: IsolationMode::InProcess,
            },
            capabilities: NodeCapabilities {
                writes_external_state: true,
                produces_durable_artifacts: true,
                may_emit_structured_logs: true,
                ..NodeCapabilities::default()
            },
            ui: NodeUi {
                icon: "table_output".to_string(),
                color_token: "var(--node-output)".to_string(),
                default_width: 336,
                default_height: 176,
                help_text: Some(
                    "Write a simple sink table in the workflow DuckDB file.".to_string(),
                ),
                node_card: Some(NodeCardUi {
                    variant: "output".to_string(),
                    icon_key: "table_output".to_string(),
                    top_chip: visible_top_chip("Persist"),
                    header: standard_header(),
                    rows: vec![
                        node_card_row(
                            "target_schema",
                            "kv",
                            "Schema",
                            "config",
                            "target_schema",
                            "text",
                            Some("table_output"),
                            false,
                        ),
                        node_card_row(
                            "table_name",
                            "kv",
                            "Table",
                            "config",
                            "table_name",
                            "text",
                            Some("label"),
                            false,
                        ),
                        node_card_row(
                            "write_mode",
                            "kv",
                            "Mode",
                            "config",
                            "write_mode",
                            "text",
                            Some("logic"),
                            false,
                        ),
                    ],
                    footer: Some(node_card_footer(
                        "metric",
                        "Last write",
                        "runtime",
                        "last_status",
                        "status",
                        Some("status"),
                    )),
                    handles: node_card_handles("single_left", "none"),
                    size: node_card_size(336),
                }),
            },
        },
        NodeDefinition {
            type_id: "preview_output".to_string(),
            version: 1,
            display_name: "Preview Output".to_string(),
            category: "output".to_string(),
            description: "Surfaces human-readable text in the run log stream.".to_string(),
            inputs: vec![PortDefinition {
                port_id: "text".to_string(),
                display_name: "Text".to_string(),
                direction: PortDirection::Input,
                data_type: DataType::Text,
                required: true,
                multiple: false,
                description: Some("Renderable preview text.".to_string()),
            }],
            outputs: vec![],
            config_schema: json!({
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string"
                    }
                }
            }),
            runtime: RuntimeBinding {
                executor_kind: ExecutorKind::RustNative,
                adapter_id: None,
                isolation_mode: IsolationMode::InProcess,
            },
            capabilities: NodeCapabilities {
                supports_preview: true,
                may_emit_structured_logs: true,
                ..NodeCapabilities::default()
            },
            ui: NodeUi {
                icon: "sparkles".to_string(),
                color_token: "var(--node-output)".to_string(),
                default_width: 332,
                default_height: 160,
                help_text: Some("Expose the final human-readable output in the UI.".to_string()),
                node_card: Some(NodeCardUi {
                    variant: "output".to_string(),
                    icon_key: "preview_output".to_string(),
                    top_chip: visible_top_chip("Output"),
                    header: standard_header(),
                    rows: vec![
                        node_card_row(
                            "title",
                            "kv",
                            "Title",
                            "config",
                            "title",
                            "text",
                            Some("label"),
                            false,
                        ),
                        node_card_row(
                            "preview_text",
                            "text_block",
                            "Preview",
                            "runtime",
                            "last_output_preview",
                            "text",
                            None,
                            true,
                        ),
                    ],
                    footer: Some(node_card_footer(
                        "metric",
                        "Last emit",
                        "runtime",
                        "last_status",
                        "status",
                        Some("status"),
                    )),
                    handles: node_card_handles("single_left", "none"),
                    size: node_card_size(332),
                }),
            },
        },
    ]
}

impl Default for NodeCapabilities {
    fn default() -> Self {
        Self {
            reads_external_state: false,
            writes_external_state: false,
            produces_durable_artifacts: false,
            supports_preview: false,
            requires_connection: false,
            may_emit_structured_logs: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::builtin_node_definitions;

    #[test]
    fn builtin_definitions_have_unique_ports() {
        for definition in builtin_node_definitions() {
            let mut port_ids = definition
                .inputs
                .iter()
                .map(|port| port.port_id.clone())
                .collect::<Vec<_>>();
            port_ids.extend(definition.outputs.iter().map(|port| port.port_id.clone()));
            port_ids.sort();
            port_ids.dedup();

            let total_ports = definition.inputs.len() + definition.outputs.len();
            assert_eq!(
                port_ids.len(),
                total_ports,
                "duplicate port in {}",
                definition.type_id
            );
        }
    }

    #[test]
    fn builtin_definitions_include_node_card_metadata() {
        for definition in builtin_node_definitions() {
            let node_card = definition
                .ui
                .node_card
                .as_ref()
                .expect("built-in nodes should expose node card metadata");

            assert!(
                !node_card.variant.is_empty(),
                "node card variant missing for {}",
                definition.type_id
            );
            assert!(
                !node_card.size.width.eq(&0),
                "node card width missing for {}",
                definition.type_id
            );
        }
    }
}
