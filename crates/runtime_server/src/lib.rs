use std::convert::Infallible;

use api_contract::{
    AuthSessionResponse, ConnectionsResponse, CreateRunRequest, CreateWorkspaceRequest,
    ErrorResponse, LoginRequest, NodeDefinitionsResponse, RunSnapshot, ValidateWorkflowRequest,
    ValidateWorkflowResponse, WorkspaceListResponse, WorkspaceResponse,
};
use axum::{
    extract::{Path, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{
        sse::{Event, KeepAlive},
        IntoResponse, Sse,
    },
    routing::{get, post},
    Json, Router,
};
use futures::{stream, StreamExt};
use platform::{AuthenticatedSession, PlatformStore};
use runtime_core::{RunEventSubscription, RuntimeError, RuntimeService};
use tokio_stream::wrappers::BroadcastStream;

pub mod platform;

#[derive(Clone)]
pub struct AppState {
    runtime: RuntimeService,
    platform: PlatformStore,
}

pub fn app(runtime: RuntimeService, platform: PlatformStore) -> Router {
    Router::new()
        .route("/api/auth/login", post(login))
        .route("/api/auth/logout", post(logout))
        .route("/api/auth/session", get(get_session))
        .route("/api/workspaces", get(list_workspaces).post(create_workspace))
        .route("/api/workspaces/:workspace_id", get(get_workspace))
        .route("/api/workflows/validate", post(validate_workflow))
        .route("/api/runs", post(create_run))
        .route("/api/runs/:run_id", get(get_run))
        .route("/api/runs/:run_id/events", get(stream_run_events))
        .route("/api/node-definitions", get(list_node_definitions))
        .route("/api/connections", get(list_connections))
        .with_state(AppState { runtime, platform })
}

async fn login(
    State(state): State<AppState>,
    Json(request): Json<LoginRequest>,
) -> Result<(HeaderMap, Json<AuthSessionResponse>), ApiError> {
    let session = state
        .platform
        .authenticate(&request.email, &request.password)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::unauthorized("Invalid email or password.".to_string()))?;

    let mut headers = HeaderMap::new();
    headers.insert(header::SET_COOKIE, session_cookie_header(&session.session_id));
    Ok((headers, Json(session.session)))
}

async fn logout(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<(HeaderMap, Json<AuthSessionResponse>), ApiError> {
    if let Some(session_id) = read_session_cookie(&headers) {
        state
            .platform
            .delete_session(&session_id)
            .map_err(ApiError::internal)?;
    }

    let mut response_headers = HeaderMap::new();
    response_headers.insert(header::SET_COOKIE, clear_session_cookie_header());
    Ok((response_headers, Json(unauthenticated_session())))
}

async fn get_session(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<AuthSessionResponse>, ApiError> {
    let session = load_session(&state, &headers).map_err(ApiError::internal)?;
    Ok(Json(
        session
            .map(|authenticated| authenticated.session)
            .unwrap_or_else(unauthenticated_session),
    ))
}

async fn list_workspaces(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<WorkspaceListResponse>, ApiError> {
    let session = require_session(&state, &headers)?;
    let workspaces = state
        .platform
        .list_workspaces(&session.user_id)
        .map_err(ApiError::internal)?;
    Ok(Json(workspaces))
}

async fn create_workspace(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<CreateWorkspaceRequest>,
) -> Result<(StatusCode, Json<WorkspaceResponse>), ApiError> {
    let session = require_session(&state, &headers)?;
    let workspace = state
        .platform
        .create_workspace(&session.user_id, &request.name)
        .map_err(map_workspace_create_error)?;
    Ok((StatusCode::CREATED, Json(WorkspaceResponse { workspace })))
}

async fn get_workspace(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(workspace_id): Path<String>,
) -> Result<Json<WorkspaceResponse>, ApiError> {
    let session = require_session(&state, &headers)?;
    let workspace = state
        .platform
        .get_workspace(&session.user_id, &workspace_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found(format!("Workspace `{workspace_id}` was not found.")))?;
    Ok(Json(WorkspaceResponse { workspace }))
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

fn load_session(state: &AppState, headers: &HeaderMap) -> anyhow::Result<Option<AuthenticatedSession>> {
    let Some(session_id) = read_session_cookie(headers) else {
        return Ok(None);
    };

    state.platform.load_session(&session_id)
}

fn require_session(state: &AppState, headers: &HeaderMap) -> Result<AuthenticatedSession, ApiError> {
    load_session(state, headers)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::unauthorized("Authentication required.".to_string()))
}

fn read_session_cookie(headers: &HeaderMap) -> Option<String> {
    let cookie_header = headers.get(header::COOKIE)?.to_str().ok()?;
    cookie_header
        .split(';')
        .filter_map(|segment| {
            let mut parts = segment.trim().splitn(2, '=');
            let name = parts.next()?.trim();
            let value = parts.next()?.trim();
            Some((name, value))
        })
        .find_map(|(name, value)| (name == "stitchly_session").then(|| value.to_string()))
}

fn session_cookie_header(session_id: &str) -> HeaderValue {
    HeaderValue::from_str(&format!(
        "stitchly_session={session_id}; Path=/; HttpOnly; SameSite=Lax; Max-Age={}",
        60 * 60 * 24 * 30
    ))
    .expect("session cookie header value")
}

fn clear_session_cookie_header() -> HeaderValue {
    HeaderValue::from_static(
        "stitchly_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
    )
}

fn unauthenticated_session() -> AuthSessionResponse {
    AuthSessionResponse::default()
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

    fn bad_request(message: String) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message,
            validation: None,
        }
    }

    fn unauthorized(message: String) -> Self {
        Self {
            status: StatusCode::UNAUTHORIZED,
            message,
            validation: None,
        }
    }

    fn internal<E>(_error: E) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: "Internal server error.".to_string(),
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

fn map_workspace_create_error(error: anyhow::Error) -> ApiError {
    let message = error.to_string();
    if message.contains("cannot be empty") {
        ApiError::bad_request(message)
    } else {
        ApiError::internal(error)
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
    use crate::platform::PlatformStore;

    #[tokio::test]
    async fn validate_endpoint_accepts_fixture_workflow() {
        let router = app(
            runtime_core::RuntimeService::default(),
            PlatformStore::for_tests().expect("platform store"),
        );
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
        let router = app(
            runtime_core::RuntimeService::default(),
            PlatformStore::for_tests().expect("platform store"),
        );
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

    #[tokio::test]
    async fn auth_session_and_workspace_flow_round_trips() {
        let router = app(
            runtime_core::RuntimeService::default(),
            PlatformStore::for_tests().expect("platform store"),
        );

        let login_request = Request::builder()
            .method("POST")
            .uri("/api/auth/login")
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::to_vec(&json!({
                    "email": "builder@stitchly.dev",
                    "password": "stitchly"
                }))
                .expect("login request body"),
            ))
            .expect("request builds");
        let login_response = router
            .clone()
            .oneshot(login_request)
            .await
            .expect("login response");
        assert_eq!(login_response.status(), StatusCode::OK);

        let cookie = login_response
            .headers()
            .get("set-cookie")
            .expect("set-cookie header")
            .to_str()
            .expect("header utf8")
            .split(';')
            .next()
            .expect("cookie pair")
            .to_string();

        let session_request = Request::builder()
            .method("GET")
            .uri("/api/auth/session")
            .header("cookie", &cookie)
            .body(Body::empty())
            .expect("request builds");
        let session_response = router
            .clone()
            .oneshot(session_request)
            .await
            .expect("session response");
        assert_eq!(session_response.status(), StatusCode::OK);

        let create_workspace_request = Request::builder()
            .method("POST")
            .uri("/api/workspaces")
            .header("content-type", "application/json")
            .header("cookie", &cookie)
            .body(Body::from(
                serde_json::to_vec(&json!({ "name": "Product Ops" }))
                    .expect("workspace body"),
            ))
            .expect("request builds");
        let create_workspace_response = router
            .clone()
            .oneshot(create_workspace_request)
            .await
            .expect("workspace response");
        assert_eq!(create_workspace_response.status(), StatusCode::CREATED);

        let payload = create_workspace_response
            .into_body()
            .collect()
            .await
            .expect("body")
            .to_bytes();
        let workspace: api_contract::WorkspaceResponse =
            serde_json::from_slice(&payload).expect("workspace payload");
        assert_eq!(workspace.workspace.slug, "product-ops");

        let session_request = Request::builder()
            .method("GET")
            .uri("/api/auth/session")
            .header("cookie", &cookie)
            .body(Body::empty())
            .expect("request builds");
        let session_response = router
            .oneshot(session_request)
            .await
            .expect("session response");
        let body = session_response
            .into_body()
            .collect()
            .await
            .expect("body")
            .to_bytes();
        let session: api_contract::AuthSessionResponse =
            serde_json::from_slice(&body).expect("session payload");
        assert!(session.authenticated);
        assert_eq!(session.workspaces.len(), 1);
        assert_eq!(session.active_workspace_id, Some(workspace.workspace.workspace_id));
    }
}
