use std::convert::Infallible;

use api_contract::{
    ConnectionsResponse, CreateRunRequest, ErrorResponse, NodeDefinitionsResponse, RunSnapshot,
    ValidateWorkflowRequest, ValidateWorkflowResponse,
};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{
        sse::{Event, KeepAlive},
        IntoResponse, Sse,
    },
    routing::{get, post},
    Json, Router,
};
use futures::{stream, StreamExt};
use runtime_core::{RunEventSubscription, RuntimeError, RuntimeService};
use tokio_stream::wrappers::BroadcastStream;

#[derive(Clone)]
pub struct AppState {
    runtime: RuntimeService,
}

pub fn app(runtime: RuntimeService) -> Router {
    Router::new()
        .route("/api/workflows/validate", post(validate_workflow))
        .route("/api/runs", post(create_run))
        .route("/api/runs/:run_id", get(get_run))
        .route("/api/runs/:run_id/events", get(stream_run_events))
        .route("/api/node-definitions", get(list_node_definitions))
        .route("/api/connections", get(list_connections))
        .with_state(AppState { runtime })
}

async fn validate_workflow(
    State(state): State<AppState>,
    Json(request): Json<ValidateWorkflowRequest>,
) -> Json<ValidateWorkflowResponse> {
    Json(state.runtime.validate_workflow(&request.workflow))
}

async fn create_run(
    State(state): State<AppState>,
    Json(request): Json<CreateRunRequest>,
) -> Result<(StatusCode, Json<api_contract::CreateRunResponse>), ApiError> {
    let response = state
        .runtime
        .create_run(request)
        .await
        .map_err(ApiError::from)?;
    Ok((StatusCode::ACCEPTED, Json(response)))
}

async fn get_run(
    State(state): State<AppState>,
    Path(run_id): Path<String>,
) -> Result<Json<RunSnapshot>, ApiError> {
    let snapshot = state
        .runtime
        .get_run(&run_id)
        .await
        .ok_or_else(|| ApiError::not_found(format!("Run `{run_id}` was not found.")))?;
    Ok(Json(snapshot))
}

async fn stream_run_events(
    State(state): State<AppState>,
    Path(run_id): Path<String>,
) -> Result<Sse<impl futures::Stream<Item = Result<Event, Infallible>>>, ApiError> {
    let subscription = state
        .runtime
        .subscribe(&run_id)
        .await
        .ok_or_else(|| ApiError::not_found(format!("Run `{run_id}` was not found.")))?;

    Ok(Sse::new(event_stream(subscription)).keep_alive(KeepAlive::default()))
}

async fn list_node_definitions(State(state): State<AppState>) -> Json<NodeDefinitionsResponse> {
    Json(state.runtime.node_definitions())
}

async fn list_connections(State(state): State<AppState>) -> Json<ConnectionsResponse> {
    Json(ConnectionsResponse {
        connections: state.runtime.connections(),
    })
}

fn event_stream(
    subscription: RunEventSubscription,
) -> impl futures::Stream<Item = Result<Event, Infallible>> {
    let history = stream::iter(
        subscription
            .history
            .into_iter()
            .map(|event| Ok(sse_event(event))),
    );
    let live = BroadcastStream::new(subscription.receiver).filter_map(|item| async move {
        match item {
            Ok(event) => Some(Ok(sse_event(event))),
            Err(_) => None,
        }
    });

    history.chain(live)
}

fn sse_event(event: api_contract::RunEvent) -> Event {
    let payload = serde_json::to_string(&event).unwrap_or_else(|_| "{}".to_string());
    Event::default()
        .event("run_event")
        .id(event.event_id)
        .data(payload)
}

#[derive(Debug)]
struct ApiError {
    status: StatusCode,
    message: String,
    validation: Option<ValidateWorkflowResponse>,
}

impl ApiError {
    fn not_found(message: String) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            message,
            validation: None,
        }
    }
}

impl From<RuntimeError> for ApiError {
    fn from(error: RuntimeError) -> Self {
        match error {
            RuntimeError::ValidationFailed(validation) => Self {
                status: StatusCode::BAD_REQUEST,
                message: "Workflow validation failed.".to_string(),
                validation: Some(validation),
            },
            RuntimeError::RunNotFound(run_id) => {
                Self::not_found(format!("Run `{run_id}` was not found."))
            }
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        (
            self.status,
            Json(ErrorResponse {
                message: self.message,
                validation: self.validation,
            }),
        )
            .into_response()
    }
}

#[cfg(test)]
mod tests {
    use std::str;

    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use futures::StreamExt;
    use http_body_util::BodyExt;
    use serde_json::json;
    use tower::ServiceExt;
    use workflow_schema::WorkflowDefinition;

    use super::app;

    #[tokio::test]
    async fn validate_endpoint_accepts_fixture_workflow() {
        let router = app(runtime_core::RuntimeService::default());
        let workflow: WorkflowDefinition = serde_json::from_str(include_str!(
            "../../../tests/fixtures/workflows/basic_text_preview.json"
        ))
        .expect("fixture parses");
        let request = Request::builder()
            .method("POST")
            .uri("/api/workflows/validate")
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::to_vec(&json!({ "workflow": workflow })).expect("request body"),
            ))
            .expect("request builds");

        let response = router.oneshot(request).await.expect("response");
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn events_endpoint_replays_run_history() {
        let router = app(runtime_core::RuntimeService::default());
        let workflow: WorkflowDefinition = serde_json::from_str(include_str!(
            "../../../tests/fixtures/workflows/basic_text_preview.json"
        ))
        .expect("fixture parses");

        let create_request = Request::builder()
            .method("POST")
            .uri("/api/runs")
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::to_vec(&json!({
                    "workflow": workflow,
                    "trigger": { "kind": "manual" },
                    "params": {}
                }))
                .expect("request body"),
            ))
            .expect("request builds");
        let create_response = router
            .clone()
            .oneshot(create_request)
            .await
            .expect("response");
        assert_eq!(create_response.status(), StatusCode::ACCEPTED);

        let body = create_response
            .into_body()
            .collect()
            .await
            .expect("body")
            .to_bytes();
        let payload: api_contract::CreateRunResponse =
            serde_json::from_slice(&body).expect("run creation payload");

        let request = Request::builder()
            .method("GET")
            .uri(format!("/api/runs/{}/events", payload.run_id))
            .body(Body::empty())
            .expect("request builds");
        let response = router.oneshot(request).await.expect("response");
        assert_eq!(response.status(), StatusCode::OK);

        let mut stream = response.into_body().into_data_stream();
        let first_chunk = stream
            .next()
            .await
            .expect("stream item")
            .expect("stream payload");
        let as_text = str::from_utf8(&first_chunk).expect("utf8");

        assert!(as_text.contains("\"event_type\":\"run_created\""));
    }
}
