use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const CURRENT_SCHEMA_VERSION: u32 = 1;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DataType {
    Bytes,
    Text,
    Json,
    Number,
    Boolean,
    FileRef,
    DirectoryRef,
    TableRef,
    DatasetRef,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct TypedValue {
    pub data_type: DataType,
    pub value: Value,
}

impl TypedValue {
    pub fn text(value: impl Into<String>) -> Self {
        Self {
            data_type: DataType::Text,
            value: Value::String(value.into()),
        }
    }

    pub fn as_text(&self) -> Option<&str> {
        if self.data_type == DataType::Text {
            self.value.as_str()
        } else {
            None
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct WorkflowDefinition {
    pub schema_version: u32,
    pub workflow_id: String,
    pub version: u32,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub nodes: Vec<WorkflowNode>,
    #[serde(default)]
    pub edges: Vec<WorkflowEdge>,
    #[serde(default)]
    pub metadata: WorkflowMetadata,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct WorkflowMetadata {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub viewport: Option<ViewportMetadata>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct ViewportMetadata {
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
    #[serde(default = "default_zoom")]
    pub zoom: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct WorkflowNode {
    pub node_id: String,
    pub type_id: String,
    pub definition_version: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default)]
    pub config: Value,
    #[serde(default)]
    pub position: NodePosition,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct NodePosition {
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkflowEdge {
    pub edge_id: String,
    pub source_node_id: String,
    pub source_port_id: String,
    pub target_node_id: String,
    pub target_port_id: String,
}

fn default_zoom() -> f64 {
    1.0
}

#[cfg(test)]
mod tests {
    use super::WorkflowDefinition;

    #[test]
    fn fixture_workflow_parses() {
        let fixture = include_str!("../../../tests/fixtures/workflows/basic_text_preview.json");
        let workflow: WorkflowDefinition =
            serde_json::from_str(fixture).expect("fixture should parse");

        assert_eq!(workflow.workflow_id, "wf_text_preview");
        assert_eq!(workflow.nodes.len(), 2);
        assert_eq!(workflow.edges.len(), 1);
    }
}
