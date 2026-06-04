use std::{collections::BTreeMap, time::Duration as StdDuration};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use node_registry::NodeDefinition;
use serde::Deserialize;
use serde_json::json;
use thiserror::Error;
use workflow_schema::{DataType, TypedValue, WorkflowNode};

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
    #[error("connection failed for node `{node_id}`: {message}")]
    ConnectionFailed { node_id: String, message: String },
    #[error("execution failed for node `{node_id}`: {message}")]
    ExecutionFailed { node_id: String, message: String },
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
            "table_input" => execute_table_input(node),
            "preview_output" => execute_preview_output(node, inputs),
            "table_output" => execute_table_output(node, inputs),
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
struct TableInputConfig {
    #[serde(default)]
    catalog: Option<String>,
    schema_name: String,
    table_name: String,
    #[serde(default)]
    output_alias: Option<String>,
    #[serde(default)]
    selected_columns: Option<Vec<String>>,
    #[serde(default)]
    row_filter: Option<String>,
    #[serde(default)]
    row_limit: Option<u64>,
    #[serde(default)]
    refresh_schema: Option<bool>,
    #[serde(default)]
    open_in_catalog: Option<bool>,
}

#[derive(Deserialize)]
struct TableOutputConfig {
    target_schema: String,
    table_name: String,
    #[serde(default)]
    write_mode: Option<TableWriteMode>,
    #[serde(default)]
    input_shape: Option<TableInputShape>,
    #[serde(default)]
    value_column: Option<String>,
    #[serde(default)]
    include_run_id: Option<bool>,
    #[serde(default)]
    include_written_at: Option<bool>,
    #[serde(default)]
    open_in_catalog: Option<bool>,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum TableWriteMode {
    Append,
    Replace,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum TableInputShape {
    SingleTextRow,
    SourceTable,
}

#[derive(Deserialize)]
struct TableReferencePayload {
    kind: String,
    catalog: String,
    schema_name: String,
    table_name: String,
    output_alias: String,
    #[serde(default)]
    selected_columns: Vec<String>,
    #[serde(default)]
    row_filter: Option<String>,
    #[serde(default)]
    row_limit: Option<u64>,
    #[serde(default, rename = "refresh_schema")]
    _refresh_schema: bool,
    #[serde(default)]
    open_in_catalog: bool,
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
    #[serde(default)]
    runtime_delivery: Option<SendEmailRuntimeDelivery>,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum SendEmailBodyMode {
    Input,
    Custom,
}

#[derive(Deserialize)]
struct SendEmailRuntimeDelivery {
    provider: String,
    #[serde(default)]
    access_token: Option<String>,
    #[serde(default)]
    send_as_email: Option<String>,
    #[serde(default)]
    connection_id: Option<String>,
    #[serde(default)]
    connection_label: Option<String>,
}

#[derive(Deserialize)]
struct GmailSendResponse {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    thread_id: Option<String>,
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

fn execute_table_input(node: &WorkflowNode) -> Result<NodeExecutionResult, AdapterError> {
    let config: TableInputConfig =
        serde_json::from_value(node.config.clone()).map_err(|error| {
            AdapterError::InvalidConfig {
                node_id: node.node_id.clone(),
                message: error.to_string(),
            }
        })?;

    let catalog = config
        .catalog
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("workflow.duckdb");
    let schema_name = config.schema_name.trim();
    if schema_name.is_empty() {
        return Err(AdapterError::InvalidConfig {
            node_id: node.node_id.clone(),
            message: "`schema_name` must not be empty.".to_string(),
        });
    }

    let table_name = config.table_name.trim();
    if table_name.is_empty() {
        return Err(AdapterError::InvalidConfig {
            node_id: node.node_id.clone(),
            message: "`table_name` must not be empty.".to_string(),
        });
    }

    let output_alias = config
        .output_alias
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(table_name);
    let selected_columns = config
        .selected_columns
        .unwrap_or_default()
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    let row_filter = config
        .row_filter
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let row_limit = config.row_limit.filter(|value| *value > 0);
    let refresh_schema = config.refresh_schema.unwrap_or(true);
    let open_in_catalog = config.open_in_catalog.unwrap_or(false);

    let projection_summary = if selected_columns.is_empty() {
        "all columns".to_string()
    } else {
        format!("{} columns", selected_columns.len())
    };
    let limit_summary = row_limit
        .map(|value| format!("limit {value}"))
        .unwrap_or_else(|| "no row limit".to_string());
    let filter_summary = row_filter
        .as_deref()
        .map(|value| format!("filter `{value}`"))
        .unwrap_or_else(|| "no filter".to_string());

    let mut outputs = PortValues::new();
    outputs.insert(
        "table".to_string(),
        TypedValue {
            data_type: DataType::TableRef,
            value: json!({
                "kind": "table_reference",
                "catalog": catalog,
                "schema_name": schema_name,
                "table_name": table_name,
                "output_alias": output_alias,
                "selected_columns": selected_columns,
                "row_filter": row_filter,
                "row_limit": row_limit,
                "refresh_schema": refresh_schema,
                "open_in_catalog": open_in_catalog
            }),
        },
    );

    Ok(NodeExecutionResult {
        outputs,
        logs: vec![format!(
            "Prepared table reference `{schema_name}.{table_name}` from `{catalog}` ({projection_summary}; {filter_summary}; {limit_summary})."
        )],
    })
}

fn execute_table_output(
    node: &WorkflowNode,
    inputs: &PortValues,
) -> Result<NodeExecutionResult, AdapterError> {
    let config: TableOutputConfig =
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
        })?;

    let target_schema = config.target_schema.trim();
    if target_schema.is_empty() {
        return Err(AdapterError::InvalidConfig {
            node_id: node.node_id.clone(),
            message: "`target_schema` must not be empty.".to_string(),
        });
    }

    let table_name = config.table_name.trim();
    if table_name.is_empty() {
        return Err(AdapterError::InvalidConfig {
            node_id: node.node_id.clone(),
            message: "`table_name` must not be empty.".to_string(),
        });
    }

    let value_column = config
        .value_column
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("content");
    let write_mode = config.write_mode.unwrap_or(TableWriteMode::Append);
    let configured_input_shape = config.input_shape.unwrap_or(TableInputShape::SingleTextRow);
    let include_run_id = config.include_run_id.unwrap_or(true);
    let include_written_at = config.include_written_at.unwrap_or(true);
    let open_in_catalog = config.open_in_catalog.unwrap_or(false);

    let write_mode_label = match write_mode {
        TableWriteMode::Append => "append",
        TableWriteMode::Replace => "replace",
    };

    let mut metadata_columns = Vec::new();
    if include_run_id {
        metadata_columns.push("run_id");
    }
    if include_written_at {
        metadata_columns.push("written_at");
    }

    let metadata_summary = if metadata_columns.is_empty() {
        "no metadata columns".to_string()
    } else {
        format!("metadata columns: {}", metadata_columns.join(", "))
    };
    let mut outputs = PortValues::new();
    match input.data_type {
        DataType::Text => {
            let input = input
                .as_text()
                .ok_or_else(|| AdapterError::TextTypeMismatch {
                    node_id: node.node_id.clone(),
                    port: "text".to_string(),
                })?;
            let catalog_hint = if open_in_catalog {
                " Catalog open requested."
            } else {
                ""
            };

            outputs.insert(
                "write_result".to_string(),
                TypedValue {
                    data_type: DataType::Json,
                    value: json!({
                        "kind": "table_output_write",
                        "target_schema": target_schema,
                        "table_name": table_name,
                        "write_mode": write_mode_label,
                        "input_shape": "single_text_row",
                        "value_column": value_column,
                        "include_run_id": include_run_id,
                        "include_written_at": include_written_at,
                        "open_in_catalog": open_in_catalog,
                        "value_text": input
                    }),
                },
            );

            Ok(NodeExecutionResult {
                outputs,
                logs: vec![format!(
                    "Prepared {write_mode_label} write to `{target_schema}.{table_name}` using `{value_column}` from single text row ({char_count} chars; {metadata_summary}).{catalog_hint}",
                    char_count = input.chars().count()
                )],
            })
        }
        DataType::TableRef => {
            let source_table: TableReferencePayload = serde_json::from_value(input.value.clone())
                .map_err(|error| {
                AdapterError::ExecutionFailed {
                    node_id: node.node_id.clone(),
                    message: format!("invalid table reference payload: {error}"),
                }
            })?;

            if source_table.kind != "table_reference" {
                return Err(AdapterError::ExecutionFailed {
                    node_id: node.node_id.clone(),
                    message: "table input payload is not a `table_reference`.".to_string(),
                });
            }

            let projection_summary = if source_table.selected_columns.is_empty() {
                "all columns".to_string()
            } else {
                format!("{} columns", source_table.selected_columns.len())
            };
            let limit_summary = source_table
                .row_limit
                .map(|value| format!("limit {value}"))
                .unwrap_or_else(|| "no row limit".to_string());
            let filter_summary = source_table
                .row_filter
                .as_deref()
                .map(|value| format!("filter `{value}`"))
                .unwrap_or_else(|| "no filter".to_string());
            let catalog_hint = if open_in_catalog || source_table.open_in_catalog {
                " Catalog open requested."
            } else {
                ""
            };
            let resolved_shape = match configured_input_shape {
                TableInputShape::SourceTable => "source_table",
                TableInputShape::SingleTextRow => "source_table",
            };

            outputs.insert(
                "write_result".to_string(),
                TypedValue {
                    data_type: DataType::Json,
                    value: json!({
                        "kind": "table_output_write",
                        "target_schema": target_schema,
                        "table_name": table_name,
                        "write_mode": write_mode_label,
                        "input_shape": resolved_shape,
                        "value_column": value_column,
                        "include_run_id": include_run_id,
                        "include_written_at": include_written_at,
                        "open_in_catalog": open_in_catalog,
                        "source_table": {
                            "catalog": source_table.catalog,
                            "schema_name": source_table.schema_name,
                            "table_name": source_table.table_name,
                            "output_alias": source_table.output_alias,
                            "selected_columns": source_table.selected_columns,
                            "row_filter": source_table.row_filter,
                            "row_limit": source_table.row_limit
                        }
                    }),
                },
            );

            Ok(NodeExecutionResult {
                outputs,
                logs: vec![format!(
                    "Prepared {write_mode_label} write to `{target_schema}.{table_name}` from source table `{schema}.{table}` ({projection_summary}; {filter_summary}; {limit_summary}; {metadata_summary}).{catalog_hint}",
                    schema = source_table.schema_name,
                    table = source_table.table_name
                )],
            })
        }
        _ => Err(AdapterError::ExecutionFailed {
            node_id: node.node_id.clone(),
            message: "table output expects text or table reference input on `text`.".to_string(),
        }),
    }
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

    if let Some(runtime_delivery) = config.runtime_delivery.as_ref() {
        return execute_runtime_email_delivery(
            node,
            &config,
            runtime_delivery,
            connection_id,
            content_type,
            &body,
        );
    }

    Ok(NodeExecutionResult {
        outputs: PortValues::new(),
        logs: vec![format!(
            "Queued {content_type} email via `{connection_id}` to {} with subject `{}`: {}",
            config.to, config.subject, body
        )],
    })
}

fn execute_runtime_email_delivery(
    node: &WorkflowNode,
    config: &SendEmailConfig,
    runtime_delivery: &SendEmailRuntimeDelivery,
    connection_id: &str,
    content_type: &str,
    body: &str,
) -> Result<NodeExecutionResult, AdapterError> {
    match runtime_delivery.provider.as_str() {
        "gmail" => execute_gmail_send(
            node,
            config,
            runtime_delivery,
            connection_id,
            content_type,
            body,
        ),
        other => Err(AdapterError::InvalidConfig {
            node_id: node.node_id.clone(),
            message: format!("unsupported runtime delivery provider `{other}`"),
        }),
    }
}

fn execute_gmail_send(
    node: &WorkflowNode,
    config: &SendEmailConfig,
    runtime_delivery: &SendEmailRuntimeDelivery,
    connection_id: &str,
    content_type: &str,
    body: &str,
) -> Result<NodeExecutionResult, AdapterError> {
    let access_token = runtime_delivery
        .access_token
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AdapterError::InvalidConfig {
            node_id: node.node_id.clone(),
            message: "gmail delivery requires a non-empty runtime access token.".to_string(),
        })?;
    let send_as_email = runtime_delivery
        .send_as_email
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AdapterError::InvalidConfig {
            node_id: node.node_id.clone(),
            message: "gmail delivery requires a non-empty `send_as_email` value.".to_string(),
        })?;

    let mime_message = build_gmail_mime_message(
        send_as_email,
        &config.to,
        &config.subject,
        body,
        content_type,
    )
    .map_err(|error| AdapterError::InvalidConfig {
        node_id: node.node_id.clone(),
        message: error.to_string(),
    })?;
    let raw = URL_SAFE_NO_PAD.encode(mime_message.as_bytes());

    let client = reqwest::blocking::Client::builder()
        .connect_timeout(StdDuration::from_secs(10))
        .timeout(StdDuration::from_secs(30))
        .build()
        .map_err(|error| AdapterError::ExecutionFailed {
            node_id: node.node_id.clone(),
            message: format!("failed to build Gmail HTTP client: {error}"),
        })?;
    let response = client
        .post("https://gmail.googleapis.com/gmail/v1/users/me/messages/send")
        .bearer_auth(access_token)
        .json(&json!({ "raw": raw }))
        .send()
        .map_err(|error| AdapterError::ConnectionFailed {
            node_id: node.node_id.clone(),
            message: format!("Gmail send request failed: {error}"),
        })?;

    let status = response.status();
    if !status.is_success() {
        let error_body = response.text().unwrap_or_default();
        let error_detail = summarize_remote_error(&error_body);
        return Err(AdapterError::ConnectionFailed {
            node_id: node.node_id.clone(),
            message: format!("Gmail send returned {status}: {error_detail}"),
        });
    }

    let payload: GmailSendResponse =
        response
            .json()
            .map_err(|error| AdapterError::ExecutionFailed {
                node_id: node.node_id.clone(),
                message: format!("failed to decode Gmail send response: {error}"),
            })?;
    let message_id = payload.id.unwrap_or_else(|| "unknown".to_string());
    let runtime_connection_id = runtime_delivery
        .connection_id
        .as_deref()
        .filter(|value| !value.trim().is_empty());
    let delivery_label = runtime_delivery
        .connection_label
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .or(runtime_connection_id)
        .unwrap_or(connection_id);
    let mut success_log = format!(
        "Sent {content_type} email via `{delivery_label}` to {} with subject `{}` (message_id: {message_id})",
        config.to, config.subject
    );
    if let Some(thread_id) = payload.thread_id.filter(|value| !value.trim().is_empty()) {
        success_log.push_str(&format!(", thread_id: {thread_id}"));
    }

    Ok(NodeExecutionResult {
        outputs: PortValues::new(),
        logs: vec![success_log],
    })
}

fn build_gmail_mime_message(
    from: &str,
    to: &str,
    subject: &str,
    body: &str,
    content_type: &str,
) -> anyhow::Result<String> {
    let from = validate_mail_header_value("From", from)?;
    let to = validate_mail_header_value("To", to)?;
    let subject = validate_mail_header_value("Subject", subject)?;
    let normalized_content_type = normalize_content_type(content_type);

    Ok(format!(
        "From: {from}\r\nTo: {to}\r\nSubject: {subject}\r\nMIME-Version: 1.0\r\nContent-Type: {normalized_content_type}; charset=UTF-8\r\n\r\n{body}"
    ))
}

fn validate_mail_header_value(header_name: &str, value: &str) -> anyhow::Result<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        anyhow::bail!("{header_name} header cannot be empty");
    }
    if trimmed.contains('\r') || trimmed.contains('\n') {
        anyhow::bail!("{header_name} header cannot contain newline characters");
    }

    Ok(trimmed.to_string())
}

fn normalize_content_type(content_type: &str) -> &'static str {
    match content_type.trim().to_ascii_lowercase().as_str() {
        "text/html" => "text/html",
        _ => "text/plain",
    }
}

fn summarize_remote_error(response_body: &str) -> String {
    let trimmed = response_body.trim();
    if trimmed.is_empty() {
        return "empty response body".to_string();
    }

    if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
        if let Some(message) = value
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(serde_json::Value::as_str)
        {
            return message.to_string();
        }
        if let Some(message) = value.get("message").and_then(serde_json::Value::as_str) {
            return message.to_string();
        }
    }

    trimmed.chars().take(180).collect()
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
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    use serde_json::json;
    use workflow_schema::{DataType, NodePosition, TypedValue, WorkflowNode};

    use super::{build_gmail_mime_message, RuntimeAdapters};
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
    fn table_output_accepts_text_input_and_emits_write_summary() {
        let registry = builtin_node_definitions();
        let definition = registry
            .iter()
            .find(|definition| definition.type_id == "table_output")
            .expect("table_output definition");
        let node = WorkflowNode {
            node_id: "table_output_digest".to_string(),
            type_id: "table_output".to_string(),
            definition_version: 1,
            label: None,
            config: json!({
                "target_schema": "outputs",
                "table_name": "news_brief",
                "write_mode": "append",
                "input_shape": "single_text_row",
                "value_column": "content",
                "include_run_id": true,
                "include_written_at": true
            }),
            position: NodePosition::default(),
        };
        let mut inputs = PortValues::new();
        inputs.insert(
            "text".to_string(),
            workflow_schema::TypedValue::text("Latest market digest"),
        );

        let result = RuntimeAdapters::default()
            .execute(definition, &node, &inputs)
            .expect("table output should succeed");

        let payload = result
            .outputs
            .get("write_result")
            .expect("table output payload should be present");
        assert_eq!(payload.data_type, workflow_schema::DataType::Json);
        assert_eq!(
            payload.value,
            json!({
                "kind": "table_output_write",
                "target_schema": "outputs",
                "table_name": "news_brief",
                "write_mode": "append",
                "input_shape": "single_text_row",
                "value_column": "content",
                "include_run_id": true,
                "include_written_at": true,
                "open_in_catalog": false,
                "value_text": "Latest market digest"
            })
        );
        assert_eq!(
            result.logs,
            vec!["Prepared append write to `outputs.news_brief` using `content` from single text row (20 chars; metadata columns: run_id, written_at)."]
        );
    }

    #[test]
    fn table_input_emits_table_reference_output() {
        let registry = builtin_node_definitions();
        let definition = registry
            .iter()
            .find(|definition| definition.type_id == "table_input")
            .expect("table_input definition");
        let node = WorkflowNode {
            node_id: "table_input_workflow_runs".to_string(),
            type_id: "table_input".to_string(),
            definition_version: 1,
            label: None,
            config: json!({
                "catalog": "workflow.duckdb",
                "schema_name": "runs",
                "table_name": "workflow_runs",
                "output_alias": "workflow_runs",
                "selected_columns": ["workflow_id", "status"],
                "row_filter": "status = 'succeeded'",
                "row_limit": 100
            }),
            position: NodePosition::default(),
        };

        let result = RuntimeAdapters::default()
            .execute(definition, &node, &PortValues::new())
            .expect("table input should succeed");

        let payload = result
            .outputs
            .get("table")
            .expect("table output payload should be present");
        assert_eq!(payload.data_type, workflow_schema::DataType::TableRef);
        assert_eq!(
            payload.value,
            json!({
                "kind": "table_reference",
                "catalog": "workflow.duckdb",
                "schema_name": "runs",
                "table_name": "workflow_runs",
                "output_alias": "workflow_runs",
                "selected_columns": ["workflow_id", "status"],
                "row_filter": "status = 'succeeded'",
                "row_limit": 100,
                "refresh_schema": true,
                "open_in_catalog": false
            })
        );
    }

    #[test]
    fn table_output_accepts_table_reference_input_and_emits_copy_summary() {
        let registry = builtin_node_definitions();
        let definition = registry
            .iter()
            .find(|definition| definition.type_id == "table_output")
            .expect("table_output definition");
        let node = WorkflowNode {
            node_id: "table_output_digest".to_string(),
            type_id: "table_output".to_string(),
            definition_version: 1,
            label: None,
            config: json!({
                "target_schema": "tables",
                "table_name": "workflow_runs_copy",
                "write_mode": "replace",
                "input_shape": "source_table",
                "include_run_id": true,
                "include_written_at": true
            }),
            position: NodePosition::default(),
        };
        let mut inputs = PortValues::new();
        inputs.insert(
            "text".to_string(),
            TypedValue {
                data_type: DataType::TableRef,
                value: json!({
                    "kind": "table_reference",
                    "catalog": "workflow.duckdb",
                    "schema_name": "runs",
                    "table_name": "workflow_runs",
                    "output_alias": "workflow_runs",
                    "selected_columns": ["workflow_id", "status"],
                    "row_filter": "status = 'succeeded'",
                    "row_limit": 10,
                    "refresh_schema": true,
                    "open_in_catalog": false
                }),
            },
        );

        let result = RuntimeAdapters::default()
            .execute(definition, &node, &inputs)
            .expect("table output should succeed");

        let payload = result
            .outputs
            .get("write_result")
            .expect("table output payload should be present");
        assert_eq!(payload.data_type, workflow_schema::DataType::Json);
        assert_eq!(
            payload.value,
            json!({
                "kind": "table_output_write",
                "target_schema": "tables",
                "table_name": "workflow_runs_copy",
                "write_mode": "replace",
                "input_shape": "source_table",
                "value_column": "content",
                "include_run_id": true,
                "include_written_at": true,
                "open_in_catalog": false,
                "source_table": {
                    "catalog": "workflow.duckdb",
                    "schema_name": "runs",
                    "table_name": "workflow_runs",
                    "output_alias": "workflow_runs",
                    "selected_columns": ["workflow_id", "status"],
                    "row_filter": "status = 'succeeded'",
                    "row_limit": 10
                }
            })
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

    #[test]
    fn gmail_mime_message_contains_expected_headers_and_body() {
        let message = build_gmail_mime_message(
            "ops@gmail.com",
            "alerts@stitchly.dev",
            "Workflow alert",
            "Body text",
            "text/plain",
        )
        .expect("mime message");

        assert!(message.contains("From: ops@gmail.com\r\n"));
        assert!(message.contains("To: alerts@stitchly.dev\r\n"));
        assert!(message.contains("Subject: Workflow alert\r\n"));
        assert!(message.contains("Content-Type: text/plain; charset=UTF-8\r\n\r\nBody text"));
    }

    #[test]
    fn gmail_mime_message_rejects_header_injection() {
        let result = build_gmail_mime_message(
            "ops@gmail.com",
            "alerts@stitchly.dev\r\nBcc: hidden@example.com",
            "Workflow alert",
            "Body text",
            "text/plain",
        );

        assert!(result.is_err());
    }

    #[test]
    fn gmail_message_body_can_be_base64url_encoded() {
        let message = build_gmail_mime_message(
            "ops@gmail.com",
            "alerts@stitchly.dev",
            "Workflow alert",
            "Body text",
            "text/plain",
        )
        .expect("mime message");

        let encoded = URL_SAFE_NO_PAD.encode(message.as_bytes());
        assert!(!encoded.is_empty());
        assert!(!encoded.contains('+'));
        assert!(!encoded.contains('/'));
    }
}
