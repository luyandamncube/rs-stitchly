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
            _ => Err(AdapterError::UnsupportedNode(definition.type_id.clone())),
        }
    }
}

#[derive(Deserialize)]
struct TextInputConfig {
    text: String,
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

fn execute_text_input(node: &WorkflowNode) -> Result<NodeExecutionResult, AdapterError> {
    let config: TextInputConfig = serde_json::from_value(node.config.clone()).map_err(|error| {
        AdapterError::InvalidConfig {
            node_id: node.node_id.clone(),
            message: error.to_string(),
        }
    })?;

    let mut outputs = PortValues::new();
    outputs.insert("text".to_string(), TypedValue::text(config.text.clone()));

    Ok(NodeExecutionResult {
        outputs,
        logs: vec![format!(
            "Loaded {} characters from text input.",
            config.text.chars().count()
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
}
