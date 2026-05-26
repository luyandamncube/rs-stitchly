use std::collections::BTreeMap;

use node_registry::NodeDefinition;
use serde::Deserialize;
use thiserror::Error;
use workflow_schema::{TypedValue, WorkflowNode};

pub type PortValues = BTreeMap<String, TypedValue>;

#[derive(Clone, Debug, Default)]
pub struct RuntimeAdapters;

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
        match definition.type_id.as_str() {
            "text_input" => execute_text_input(node),
            "text_transform" => execute_text_transform(node, inputs),
            "preview_output" => execute_preview_output(node, inputs),
            "send_email" => execute_send_email(node, inputs),
            _ => Err(AdapterError::UnsupportedNode(definition.type_id.clone())),
        }
    }
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
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum SendEmailBodyMode {
    Input,
    Custom,
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

    Ok(NodeExecutionResult {
        outputs: PortValues::new(),
        logs: vec![format!(
            "Queued {content_type} email via `{connection_id}` to {} with subject `{}`: {}",
            config.to, config.subject, body
        )],
    })
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
    use serde_json::json;
    use workflow_schema::{NodePosition, WorkflowNode};

    use super::RuntimeAdapters;
    use crate::PortValues;
    use node_registry::builtin_node_definitions;

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
}
