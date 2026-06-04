use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use workflow_schema::DataType;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PortDirection {
    Input,
    Output,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ExecutorKind {
    RustNative,
    Python,
    Process,
    EngineAdapter,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum IsolationMode {
    InProcess,
    Subprocess,
    ExternalEngine,
    Container,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
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

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct RuntimeBinding {
    pub executor_kind: ExecutorKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub adapter_id: Option<String>,
    pub isolation_mode: IsolationMode,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
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

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
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

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
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

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct NodeCardTopChip {
    #[serde(default)]
    pub visible: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct NodeCardHeader {
    pub title_source: String,
    #[serde(default)]
    pub show_overflow_menu: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subtitle: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status_badge: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
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

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct NodeCardValueBinding {
    pub source: String,
    pub path: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct NodeCardFooter {
    pub kind: String,
    pub label: String,
    pub value: NodeCardValueBinding,
    pub formatter: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon_key: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct NodeCardHandles {
    pub input_layout: String,
    pub output_layout: String,
    pub show_labels: String,
    #[serde(default)]
    pub align_to_rows: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct NodeCardSize {
    pub width: u32,
    pub density: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
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
                        "enum": ["single_text_row", "source_table"],
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
