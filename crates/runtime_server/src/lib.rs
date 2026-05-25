use std::{convert::Infallible, env};

use api_contract::{
    AuthSessionResponse, ConnectionsResponse, CreateRunRequest, CreateWorkflowRequest,
    CreateWorkspaceRequest, DeleteWorkflowResponse, ErrorResponse, GoogleAuthCodeRequest,
    LoginRequest,
    NodeDefinitionsResponse, RunEventsResponse, RunLogsResponse, RunSnapshot, UpdateWorkflowRequest,
    UpdateWorkflowStateRequest, ValidateWorkflowRequest, ValidateWorkflowResponse,
    WorkflowListResponse, WorkflowResponse, WorkflowStateResponse, WorkspaceListResponse,
    WorkspaceResponse, WorkspaceRunResponse, WorkspaceRunsResponse,
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
use serde::Deserialize;
use tokio_stream::wrappers::BroadcastStream;

pub mod platform;

#[derive(Clone)]
pub struct AppState {
    runtime: RuntimeService,
    platform: PlatformStore,
    google_auth: Option<GoogleAuthClient>,
}

const GOOGLE_TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_ENDPOINT: &str = "https://openidconnect.googleapis.com/v1/userinfo";

#[derive(Clone)]
struct GoogleAuthClient {
    client_id: String,
    client_secret: String,
    http: reqwest::Client,
}

#[derive(Debug)]
enum GoogleAuthError {
    InvalidCode,
    InvalidIdentity,
    Transport(anyhow::Error),
}

#[derive(Debug, Deserialize)]
struct GoogleTokenResponse {
    access_token: String,
}

#[derive(Debug, Deserialize)]
struct GoogleUserInfoResponse {
    sub: String,
    email: String,
    #[serde(default)]
    email_verified: bool,
    name: String,
}

pub fn app(runtime: RuntimeService, platform: PlatformStore) -> Router {
    let google_auth = GoogleAuthClient::from_env();

    Router::new()
        .route("/api/auth/login", post(login))
        .route("/api/auth/google/code", post(login_with_google_code))
        .route("/api/auth/logout", post(logout))
        .route("/api/auth/session", get(get_session))
        .route("/api/workspaces", get(list_workspaces).post(create_workspace))
        .route("/api/workspaces/:workspace_id", get(get_workspace))
        .route(
            "/api/workspaces/:workspace_id/workflows",
            get(list_workflows).post(create_workflow),
        )
        .route(
            "/api/workspaces/:workspace_id/workflows/:workflow_id",
            get(get_workflow)
                .put(update_workflow)
                .delete(delete_workflow),
        )
        .route(
            "/api/workspaces/:workspace_id/workflow-state",
            get(get_workflow_state).put(update_workflow_state),
        )
        .route(
            "/api/workspaces/:workspace_id/runs",
            get(list_workspace_runs).post(create_workspace_run),
        )
        .route(
            "/api/workspaces/:workspace_id/runs/:run_id",
            get(get_workspace_run),
        )
        .route(
            "/api/workspaces/:workspace_id/runs/:run_id/events",
            get(get_workspace_run_events),
        )
        .route(
            "/api/workspaces/:workspace_id/runs/:run_id/logs",
            get(get_workspace_run_logs),
        )
        .route("/api/workflows/validate", post(validate_workflow))
        .route("/api/runs", post(create_run))
        .route("/api/runs/:run_id", get(get_run))
        .route("/api/runs/:run_id/events", get(stream_run_events))
        .route("/api/node-definitions", get(list_node_definitions))
        .route("/api/connections", get(list_connections))
        .with_state(AppState {
            runtime,
            platform,
            google_auth,
        })
}

impl GoogleAuthClient {
    fn from_env() -> Option<Self> {
        let client_id = env::var("STITCHLY_GOOGLE_CLIENT_ID").ok()?;
        let client_secret = env::var("STITCHLY_GOOGLE_CLIENT_SECRET").ok()?;
        if client_id.trim().is_empty() || client_secret.trim().is_empty() {
            return None;
        }

        Some(Self {
            client_id,
            client_secret,
            http: reqwest::Client::new(),
        })
    }

    async fn exchange_code(
        &self,
        origin: &str,
        code: &str,
    ) -> Result<platform::GoogleIdentityProfile, GoogleAuthError> {
        let token_response = self
            .http
            .post(GOOGLE_TOKEN_ENDPOINT)
            .form(&[
                ("code", code),
                ("client_id", self.client_id.as_str()),
                ("client_secret", self.client_secret.as_str()),
                ("redirect_uri", origin),
                ("grant_type", "authorization_code"),
            ])
            .send()
            .await
            .map_err(|error| GoogleAuthError::Transport(error.into()))?;

        if token_response.status() == StatusCode::BAD_REQUEST {
            return Err(GoogleAuthError::InvalidCode);
        }

        let token_response = token_response
            .error_for_status()
            .map_err(|error| GoogleAuthError::Transport(error.into()))?;
        let token_payload: GoogleTokenResponse = token_response
            .json()
            .await
            .map_err(|error| GoogleAuthError::Transport(error.into()))?;

        let userinfo_response = self
            .http
            .get(GOOGLE_USERINFO_ENDPOINT)
            .bearer_auth(token_payload.access_token)
            .send()
            .await
            .map_err(|error| GoogleAuthError::Transport(error.into()))?
            .error_for_status()
            .map_err(|error| GoogleAuthError::Transport(error.into()))?;
        let userinfo: GoogleUserInfoResponse = userinfo_response
            .json()
            .await
            .map_err(|error| GoogleAuthError::Transport(error.into()))?;

        if userinfo.sub.trim().is_empty()
            || userinfo.email.trim().is_empty()
            || userinfo.name.trim().is_empty()
        {
            return Err(GoogleAuthError::InvalidIdentity);
        }

        Ok(platform::GoogleIdentityProfile {
            subject: userinfo.sub,
            email: userinfo.email,
            email_verified: userinfo.email_verified,
            display_name: userinfo.name,
        })
    }
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

async fn login_with_google_code(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<GoogleAuthCodeRequest>,
) -> Result<(HeaderMap, Json<AuthSessionResponse>), ApiError> {
    let google_auth = state
        .google_auth
        .as_ref()
        .ok_or_else(|| ApiError::unavailable("Google login is not configured.".to_string()))?;

    let requested_with = headers
        .get("x-requested-with")
        .and_then(|value| value.to_str().ok());
    if requested_with != Some("XmlHttpRequest") {
        return Err(ApiError::bad_request(
            "Google login requests must include X-Requested-With.".to_string(),
        ));
    }

    let origin = headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| ApiError::bad_request("Google login origin is missing.".to_string()))?;

    let identity = google_auth
        .exchange_code(origin, &request.code)
        .await
        .map_err(map_google_auth_error)?;

    let session = state
        .platform
        .authenticate_google_identity(&identity)
        .map_err(ApiError::internal)?;

    let mut response_headers = HeaderMap::new();
    response_headers.insert(header::SET_COOKIE, session_cookie_header(&session.session_id));
    Ok((response_headers, Json(session.session)))
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

async fn list_workflows(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(workspace_id): Path<String>,
) -> Result<Json<WorkflowListResponse>, ApiError> {
    let session = require_session(&state, &headers)?;
    let workflows = state
        .platform
        .list_workflows(&session.user_id, &workspace_id)
        .map_err(map_workflow_persistence_error)?;
    Ok(Json(workflows))
}

async fn create_workflow(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(workspace_id): Path<String>,
    Json(request): Json<CreateWorkflowRequest>,
) -> Result<(StatusCode, Json<WorkflowResponse>), ApiError> {
    let session = require_session(&state, &headers)?;
    let workflow = state
        .platform
        .create_workflow(&session.user_id, &workspace_id, &request.workflow)
        .map_err(map_workflow_persistence_error)?;
    Ok((StatusCode::CREATED, Json(workflow)))
}

async fn get_workflow(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((workspace_id, workflow_id)): Path<(String, String)>,
) -> Result<Json<WorkflowResponse>, ApiError> {
    let session = require_session(&state, &headers)?;
    let workflow = state
        .platform
        .get_workflow(&session.user_id, &workspace_id, &workflow_id)
        .map_err(map_workflow_persistence_error)?
        .ok_or_else(|| {
            ApiError::not_found(format!(
                "Workflow `{workflow_id}` was not found in workspace `{workspace_id}`."
            ))
        })?;
    Ok(Json(workflow))
}

async fn update_workflow(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((workspace_id, workflow_id)): Path<(String, String)>,
    Json(request): Json<UpdateWorkflowRequest>,
) -> Result<Json<WorkflowResponse>, ApiError> {
    let session = require_session(&state, &headers)?;
    let workflow = state
        .platform
        .update_workflow(&session.user_id, &workspace_id, &workflow_id, &request.workflow)
        .map_err(map_workflow_persistence_error)?
        .ok_or_else(|| {
            ApiError::not_found(format!(
                "Workflow `{workflow_id}` was not found in workspace `{workspace_id}`."
            ))
        })?;
    Ok(Json(workflow))
}

async fn delete_workflow(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((workspace_id, workflow_id)): Path<(String, String)>,
) -> Result<Json<DeleteWorkflowResponse>, ApiError> {
    let session = require_session(&state, &headers)?;
    let response = state
        .platform
        .archive_workflow(&session.user_id, &workspace_id, &workflow_id)
        .map_err(map_workflow_persistence_error)?
        .ok_or_else(|| {
            ApiError::not_found(format!(
                "Workflow `{workflow_id}` was not found in workspace `{workspace_id}`."
            ))
        })?;
    Ok(Json(response))
}

async fn get_workflow_state(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(workspace_id): Path<String>,
) -> Result<Json<WorkflowStateResponse>, ApiError> {
    let session = require_session(&state, &headers)?;
    let state_response = state
        .platform
        .get_workflow_state(&session.user_id, &workspace_id)
        .map_err(map_workflow_persistence_error)?;
    Ok(Json(state_response))
}

async fn update_workflow_state(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(workspace_id): Path<String>,
    Json(request): Json<UpdateWorkflowStateRequest>,
) -> Result<Json<WorkflowStateResponse>, ApiError> {
    let session = require_session(&state, &headers)?;
    let state_response = state
        .platform
        .update_workflow_state(
            &session.user_id,
            &workspace_id,
            request.last_opened_workflow_id.as_deref(),
        )
        .map_err(map_workflow_persistence_error)?;
    Ok(Json(state_response))
}

async fn list_workspace_runs(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(workspace_id): Path<String>,
) -> Result<Json<WorkspaceRunsResponse>, ApiError> {
    let session = require_session(&state, &headers)?;
    let stored_runs = state
        .platform
        .list_workspace_run_records(&session.user_id, &workspace_id)
        .map_err(ApiError::internal)?;

    let mut runs = Vec::with_capacity(stored_runs.len());
    for stored in stored_runs {
        if let Some(snapshot) = sync_live_workspace_run_history(
            &state.runtime,
            &state.platform,
            &session.user_id,
            &workspace_id,
            &stored.run_id,
        )
        .await
        .map_err(ApiError::internal)?
        {
            runs.push(snapshot);
        } else {
            let snapshot: RunSnapshot = serde_json::from_str(&stored.snapshot_json)
                .map_err(ApiError::internal)?;
            runs.push(snapshot);
        }
    }

    Ok(Json(WorkspaceRunsResponse { runs }))
}

async fn create_workspace_run(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(workspace_id): Path<String>,
    Json(request): Json<CreateRunRequest>,
) -> Result<(StatusCode, Json<api_contract::CreateRunResponse>), ApiError> {
    let session = require_session(&state, &headers)?;
    state
        .platform
        .get_workflow(&session.user_id, &workspace_id, &request.workflow.workflow_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| {
            ApiError::not_found(format!(
                "Workflow `{}` was not found in workspace `{workspace_id}`.",
                request.workflow.workflow_id
            ))
        })?;

    let response = state
        .runtime
        .create_run(request)
        .await
        .map_err(ApiError::from)?;

    let subscription = state.runtime.subscribe(&response.run_id).await;
    if let Some(snapshot) = state.runtime.get_run(&response.run_id).await {
        if let Some(subscription) = subscription {
            state
                .platform
                .persist_run_history(
                    &workspace_id,
                    Some(&session.user_id),
                    &snapshot,
                    &subscription.history,
                )
                .map_err(ApiError::internal)?;

            if !is_terminal_run_status(&snapshot.status) {
                let runtime = state.runtime.clone();
                let platform = state.platform.clone();
                let run_id = response.run_id.clone();
                let workspace_id = workspace_id.clone();
                let user_id = session.user_id.clone();
                let mut receiver = subscription.receiver;

                tokio::spawn(async move {
                    while receiver.recv().await.is_ok() {
                        let Some(snapshot) = runtime.get_run(&run_id).await else {
                            break;
                        };
                        let history = runtime.event_history(&run_id).await.unwrap_or_default();

                        if platform
                            .persist_run_history(
                                &workspace_id,
                                Some(&user_id),
                                &snapshot,
                                &history,
                            )
                            .is_err()
                        {
                            break;
                        }

                        if is_terminal_run_status(&snapshot.status) {
                            break;
                        }
                    }
                });
            }
        } else {
            state
                .platform
                .save_run_snapshot(&session.user_id, &workspace_id, &snapshot)
                .map_err(ApiError::internal)?;
        }
    }

    Ok((StatusCode::ACCEPTED, Json(response)))
}

async fn get_workspace_run(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((workspace_id, run_id)): Path<(String, String)>,
) -> Result<Json<WorkspaceRunResponse>, ApiError> {
    let session = require_session(&state, &headers)?;

    if let Some(snapshot) = sync_live_workspace_run_history(
        &state.runtime,
        &state.platform,
        &session.user_id,
        &workspace_id,
        &run_id,
    )
    .await
    .map_err(ApiError::internal)?
    {
        return Ok(Json(WorkspaceRunResponse { run: snapshot }));
    }

    let stored = state
        .platform
        .get_workspace_run_record(&session.user_id, &workspace_id, &run_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| workspace_run_not_found(&workspace_id, &run_id))?;
    let snapshot = deserialize_workspace_run_snapshot(&stored.snapshot_json).map_err(ApiError::internal)?;

    Ok(Json(WorkspaceRunResponse { run: snapshot }))
}

async fn get_workspace_run_events(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((workspace_id, run_id)): Path<(String, String)>,
) -> Result<Json<RunEventsResponse>, ApiError> {
    let session = require_session(&state, &headers)?;

    if sync_live_workspace_run_history(
        &state.runtime,
        &state.platform,
        &session.user_id,
        &workspace_id,
        &run_id,
    )
    .await
    .map_err(ApiError::internal)?
    .is_some()
    {
        let events = state.runtime.event_history(&run_id).await.unwrap_or_default();
        return Ok(Json(RunEventsResponse { events }));
    }

    state
        .platform
        .get_workspace_run_record(&session.user_id, &workspace_id, &run_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| workspace_run_not_found(&workspace_id, &run_id))?;

    let events = state
        .platform
        .list_workspace_run_events(&session.user_id, &workspace_id, &run_id)
        .map_err(ApiError::internal)?;

    Ok(Json(RunEventsResponse { events }))
}

async fn get_workspace_run_logs(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((workspace_id, run_id)): Path<(String, String)>,
) -> Result<Json<RunLogsResponse>, ApiError> {
    let session = require_session(&state, &headers)?;

    if let Some(snapshot) = sync_live_workspace_run_history(
        &state.runtime,
        &state.platform,
        &session.user_id,
        &workspace_id,
        &run_id,
    )
    .await
    .map_err(ApiError::internal)?
    {
        return Ok(Json(RunLogsResponse {
            logs: snapshot.logs,
        }));
    }

    let stored = state
        .platform
        .get_workspace_run_record(&session.user_id, &workspace_id, &run_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| workspace_run_not_found(&workspace_id, &run_id))?;

    let logs = state
        .platform
        .list_workspace_run_logs(&session.user_id, &workspace_id, &run_id)
        .map_err(ApiError::internal)?;
    if !logs.is_empty() {
        return Ok(Json(RunLogsResponse { logs }));
    }

    let snapshot = deserialize_workspace_run_snapshot(&stored.snapshot_json).map_err(ApiError::internal)?;
    Ok(Json(RunLogsResponse { logs: snapshot.logs }))
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

async fn sync_live_workspace_run_history(
    runtime: &RuntimeService,
    platform: &PlatformStore,
    user_id: &str,
    workspace_id: &str,
    run_id: &str,
) -> anyhow::Result<Option<RunSnapshot>> {
    let Some(snapshot) = runtime.get_run(run_id).await else {
        return Ok(None);
    };
    let history = runtime.event_history(run_id).await.unwrap_or_default();
    platform.persist_run_history(workspace_id, Some(user_id), &snapshot, &history)?;
    Ok(Some(snapshot))
}

fn deserialize_workspace_run_snapshot(snapshot_json: &str) -> anyhow::Result<RunSnapshot> {
    serde_json::from_str(snapshot_json).map_err(Into::into)
}

fn is_terminal_run_status(status: &api_contract::RunStatus) -> bool {
    matches!(
        status,
        api_contract::RunStatus::Succeeded
            | api_contract::RunStatus::Failed
            | api_contract::RunStatus::Cancelled
    )
}

fn workspace_run_not_found(workspace_id: &str, run_id: &str) -> ApiError {
    ApiError::not_found(format!(
        "Run `{run_id}` was not found in workspace `{workspace_id}`."
    ))
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

    fn conflict(message: String) -> Self {
        Self {
            status: StatusCode::CONFLICT,
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

    fn unavailable(message: String) -> Self {
        Self {
            status: StatusCode::SERVICE_UNAVAILABLE,
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

fn map_workflow_persistence_error(error: anyhow::Error) -> ApiError {
    let message = error.to_string();
    if message.contains("cannot be empty") {
        ApiError::bad_request(message)
    } else if message.contains("already exists") {
        ApiError::conflict(message)
    } else if message.contains("was not found") {
        ApiError::not_found(message)
    } else {
        ApiError::internal(error)
    }
}

fn map_google_auth_error(error: GoogleAuthError) -> ApiError {
    match error {
        GoogleAuthError::InvalidCode => {
            ApiError::unauthorized("Google sign-in could not be completed.".to_string())
        }
        GoogleAuthError::InvalidIdentity => ApiError::bad_request(
            "Google did not return a usable identity profile.".to_string(),
        ),
        GoogleAuthError::Transport(error) => ApiError::internal(error),
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
    use tokio::time::{sleep, Duration};
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

    #[tokio::test]
    async fn workspace_workflow_round_trip_supports_create_get_and_update() {
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

        let create_workspace_request = Request::builder()
            .method("POST")
            .uri("/api/workspaces")
            .header("content-type", "application/json")
            .header("cookie", &cookie)
            .body(Body::from(
                serde_json::to_vec(&json!({ "name": "Canvas Ops" }))
                    .expect("workspace body"),
            ))
            .expect("request builds");
        let create_workspace_response = router
            .clone()
            .oneshot(create_workspace_request)
            .await
            .expect("workspace response");
        let workspace_payload = create_workspace_response
            .into_body()
            .collect()
            .await
            .expect("body")
            .to_bytes();
        let workspace: api_contract::WorkspaceResponse =
            serde_json::from_slice(&workspace_payload).expect("workspace payload");

        let mut workflow: WorkflowDefinition = serde_json::from_str(include_str!(
            "../../../tests/fixtures/workflows/basic_text_preview.json"
        ))
        .expect("fixture parses");
        workflow.name = "Persisted Canvas Flow".to_string();

        let create_workflow_request = Request::builder()
            .method("POST")
            .uri(format!(
                "/api/workspaces/{}/workflows",
                workspace.workspace.workspace_id
            ))
            .header("content-type", "application/json")
            .header("cookie", &cookie)
            .body(Body::from(
                serde_json::to_vec(&json!({ "workflow": workflow })).expect("workflow body"),
            ))
            .expect("request builds");
        let create_workflow_response = router
            .clone()
            .oneshot(create_workflow_request)
            .await
            .expect("workflow response");
        assert_eq!(create_workflow_response.status(), StatusCode::CREATED);

        let create_workflow_body = create_workflow_response
            .into_body()
            .collect()
            .await
            .expect("body")
            .to_bytes();
        let created: api_contract::WorkflowResponse =
            serde_json::from_slice(&create_workflow_body).expect("workflow payload");
        assert_eq!(created.workflow.version, 1);
        assert_eq!(created.definition.name, "Persisted Canvas Flow");

        let get_workflow_request = Request::builder()
            .method("GET")
            .uri(format!(
                "/api/workspaces/{}/workflows/{}",
                workspace.workspace.workspace_id, created.workflow.workflow_id
            ))
            .header("cookie", &cookie)
            .body(Body::empty())
            .expect("request builds");
        let get_workflow_response = router
            .clone()
            .oneshot(get_workflow_request)
            .await
            .expect("get workflow response");
        assert_eq!(get_workflow_response.status(), StatusCode::OK);

        let list_workflows_request = Request::builder()
            .method("GET")
            .uri(format!(
                "/api/workspaces/{}/workflows",
                workspace.workspace.workspace_id
            ))
            .header("cookie", &cookie)
            .body(Body::empty())
            .expect("request builds");
        let list_workflows_response = router
            .clone()
            .oneshot(list_workflows_request)
            .await
            .expect("list workflows response");
        let list_workflows_body = list_workflows_response
            .into_body()
            .collect()
            .await
            .expect("body")
            .to_bytes();
        let listed: api_contract::WorkflowListResponse =
            serde_json::from_slice(&list_workflows_body).expect("workflow list payload");
        assert_eq!(listed.workflows.len(), 1);

        let mut updated_workflow = created.definition.clone();
        updated_workflow.name = "Persisted Canvas Flow v2".to_string();
        updated_workflow.description = Some("Updated in round-trip test.".to_string());

        let update_workflow_request = Request::builder()
            .method("PUT")
            .uri(format!(
                "/api/workspaces/{}/workflows/{}",
                workspace.workspace.workspace_id, created.workflow.workflow_id
            ))
            .header("content-type", "application/json")
            .header("cookie", &cookie)
            .body(Body::from(
                serde_json::to_vec(&json!({ "workflow": updated_workflow }))
                    .expect("workflow body"),
            ))
            .expect("request builds");
        let update_workflow_response = router
            .oneshot(update_workflow_request)
            .await
            .expect("update workflow response");
        assert_eq!(update_workflow_response.status(), StatusCode::OK);

        let update_workflow_body = update_workflow_response
            .into_body()
            .collect()
            .await
            .expect("body")
            .to_bytes();
        let updated: api_contract::WorkflowResponse =
            serde_json::from_slice(&update_workflow_body).expect("updated workflow payload");
        assert_eq!(updated.workflow.version, 2);
        assert_eq!(updated.definition.version, 2);
        assert_eq!(updated.definition.name, "Persisted Canvas Flow v2");
        assert_eq!(
            updated.definition.description.as_deref(),
            Some("Updated in round-trip test.")
        );
    }

    #[tokio::test]
    async fn workspace_run_route_creates_and_lists_runs_for_the_workspace() {
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

        let create_workspace_request = Request::builder()
            .method("POST")
            .uri("/api/workspaces")
            .header("content-type", "application/json")
            .header("cookie", &cookie)
            .body(Body::from(
                serde_json::to_vec(&json!({ "name": "Run Ops" }))
                    .expect("workspace body"),
            ))
            .expect("request builds");
        let create_workspace_response = router
            .clone()
            .oneshot(create_workspace_request)
            .await
            .expect("workspace response");
        let workspace_payload = create_workspace_response
            .into_body()
            .collect()
            .await
            .expect("body")
            .to_bytes();
        let workspace: api_contract::WorkspaceResponse =
            serde_json::from_slice(&workspace_payload).expect("workspace payload");

        let workflow: WorkflowDefinition = serde_json::from_str(include_str!(
            "../../../tests/fixtures/workflows/basic_text_preview.json"
        ))
        .expect("fixture parses");
        let create_workflow_request = Request::builder()
            .method("POST")
            .uri(format!(
                "/api/workspaces/{}/workflows",
                workspace.workspace.workspace_id
            ))
            .header("content-type", "application/json")
            .header("cookie", &cookie)
            .body(Body::from(
                serde_json::to_vec(&json!({ "workflow": workflow })).expect("workflow body"),
            ))
            .expect("request builds");
        let create_workflow_response = router
            .clone()
            .oneshot(create_workflow_request)
            .await
            .expect("workflow response");
        let workflow_payload = create_workflow_response
            .into_body()
            .collect()
            .await
            .expect("body")
            .to_bytes();
        let persisted_workflow: api_contract::WorkflowResponse =
            serde_json::from_slice(&workflow_payload).expect("workflow payload");

        let create_run_request = Request::builder()
            .method("POST")
            .uri(format!(
                "/api/workspaces/{}/runs",
                workspace.workspace.workspace_id
            ))
            .header("content-type", "application/json")
            .header("cookie", &cookie)
            .body(Body::from(
                serde_json::to_vec(&json!({
                    "workflow": persisted_workflow.definition,
                    "trigger": { "kind": "manual" },
                    "params": {}
                }))
                .expect("run body"),
            ))
            .expect("request builds");
        let create_run_response = router
            .clone()
            .oneshot(create_run_request)
            .await
            .expect("run response");
        assert_eq!(create_run_response.status(), StatusCode::ACCEPTED);
        let create_run_body = create_run_response
            .into_body()
            .collect()
            .await
            .expect("body")
            .to_bytes();
        let created_run: api_contract::CreateRunResponse =
            serde_json::from_slice(&create_run_body).expect("run payload");

        let list_runs_request = Request::builder()
            .method("GET")
            .uri(format!(
                "/api/workspaces/{}/runs",
                workspace.workspace.workspace_id
            ))
            .header("cookie", &cookie)
            .body(Body::empty())
            .expect("request builds");
        let list_runs_response = router
            .clone()
            .oneshot(list_runs_request)
            .await
            .expect("list runs response");
        assert_eq!(list_runs_response.status(), StatusCode::OK);

        let list_runs_body = list_runs_response
            .into_body()
            .collect()
            .await
            .expect("body")
            .to_bytes();
        let runs: api_contract::WorkspaceRunsResponse =
            serde_json::from_slice(&list_runs_body).expect("workspace runs payload");
        assert_eq!(runs.runs.len(), 1);
        assert_eq!(
            runs.runs[0].workflow_id,
            persisted_workflow.workflow.workflow_id
        );

        let mut run_detail = None;
        for _ in 0..20 {
            let get_run_request = Request::builder()
                .method("GET")
                .uri(format!(
                    "/api/workspaces/{}/runs/{}",
                    workspace.workspace.workspace_id, created_run.run_id
                ))
                .header("cookie", &cookie)
                .body(Body::empty())
                .expect("request builds");
            let get_run_response = router
                .clone()
                .oneshot(get_run_request)
                .await
                .expect("run detail response");
            assert_eq!(get_run_response.status(), StatusCode::OK);

            let get_run_body = get_run_response
                .into_body()
                .collect()
                .await
                .expect("body")
                .to_bytes();
            let run_response: api_contract::WorkspaceRunResponse =
                serde_json::from_slice(&get_run_body).expect("workspace run payload");

            if matches!(
                run_response.run.status,
                api_contract::RunStatus::Succeeded | api_contract::RunStatus::Failed
            ) {
                run_detail = Some(run_response);
                break;
            }

            sleep(Duration::from_millis(25)).await;
        }

        let run_detail = run_detail.expect("run reaches terminal state");
        assert_eq!(
            run_detail.run.workflow_id,
            persisted_workflow.workflow.workflow_id
        );

        let run_events_request = Request::builder()
            .method("GET")
            .uri(format!(
                "/api/workspaces/{}/runs/{}/events",
                workspace.workspace.workspace_id, created_run.run_id
            ))
            .header("cookie", &cookie)
            .body(Body::empty())
            .expect("request builds");
        let run_events_response = router
            .clone()
            .oneshot(run_events_request)
            .await
            .expect("run events response");
        assert_eq!(run_events_response.status(), StatusCode::OK);
        let run_events_body = run_events_response
            .into_body()
            .collect()
            .await
            .expect("body")
            .to_bytes();
        let run_events: api_contract::RunEventsResponse =
            serde_json::from_slice(&run_events_body).expect("run events payload");
        assert!(!run_events.events.is_empty());
        assert_eq!(run_events.events[0].run_id, created_run.run_id);

        let run_logs_request = Request::builder()
            .method("GET")
            .uri(format!(
                "/api/workspaces/{}/runs/{}/logs",
                workspace.workspace.workspace_id, created_run.run_id
            ))
            .header("cookie", &cookie)
            .body(Body::empty())
            .expect("request builds");
        let run_logs_response = router
            .oneshot(run_logs_request)
            .await
            .expect("run logs response");
        assert_eq!(run_logs_response.status(), StatusCode::OK);
        let run_logs_body = run_logs_response
            .into_body()
            .collect()
            .await
            .expect("body")
            .to_bytes();
        let run_logs: api_contract::RunLogsResponse =
            serde_json::from_slice(&run_logs_body).expect("run logs payload");
        assert!(!run_logs.logs.is_empty());
    }
}
