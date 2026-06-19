use std::{collections::BTreeMap, path::PathBuf};

use node_registry::NodeDefinition;
use thiserror::Error;
use workflow_schema::{TypedValue, WorkflowNode};

pub type PortValues = BTreeMap<String, TypedValue>;

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

pub trait NodeExecutor: Send + Sync {
    fn execute_with_context(
        &self,
        definition: &NodeDefinition,
        node: &WorkflowNode,
        inputs: &PortValues,
        context: &AdapterExecutionContext,
    ) -> Result<NodeExecutionResult, AdapterError>;
}
