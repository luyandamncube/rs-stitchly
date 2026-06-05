use std::{convert::Infallible, env, fs, path::Path as FsPath};

use api_contract::{
    AuthSessionResponse, ConnectionsResponse, CreateRunRequest, CreateWorkflowRequest,
    CreateWorkspaceRequest, DeleteWorkflowResponse, DeleteWorkspaceResponse, ErrorResponse,
    EventTarget, EventTargetKind, GoogleAuthCodeRequest, LogLevel, LoginRequest,
    NodeDefinitionsResponse, NodeRunStatus, RunErrorCategory, RunErrorSummary, RunEvent,
    RunEventType, RunEventsResponse, RunLogsResponse, RunSnapshot, RunStatus,
    UpdateWorkflowRequest, UpdateWorkflowStateRequest, ValidateWorkflowRequest,
    ValidateWorkflowResponse, WorkflowListResponse, WorkflowResponse, WorkflowStateResponse,
    WorkspaceCatalogDeleteTablePreviewResponse, WorkspaceCatalogDeleteTableResponse,
    WorkspaceCatalogQueryRequest, WorkspaceCatalogQueryResponse, WorkspaceCatalogResponse,
    WorkspaceCatalogSchemaResponse, WorkspaceCatalogTableResponse, WorkspaceConnectionResponse,
    WorkspaceConnectionsResponse, WorkspaceListResponse, WorkspaceResponse, WorkspaceRunResponse,
    WorkspaceRunsResponse,
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
use serde::{Deserialize, Serialize};
use tokio_stream::wrappers::BroadcastStream;
use uuid::Uuid;
use workflow_schema::WorkflowDefinition;

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
    TokenRefreshRejected,
    Transport(anyhow::Error),
}

#[derive(Debug, Deserialize)]
struct GoogleTokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    expires_in: Option<i64>,
    #[serde(default)]
    scope: Option<String>,
    #[serde(default)]
    token_type: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GoogleUserInfoResponse {
    sub: String,
    email: String,
    #[serde(default)]
    email_verified: bool,
    name: String,
}

#[derive(Clone, Debug)]
struct GoogleCodeExchangeResult {
    identity: platform::GoogleIdentityProfile,
    access_token: String,
    refresh_token: Option<String>,
    expires_at: Option<String>,
    scopes: Vec<String>,
    token_type: Option<String>,
}

#[derive(Clone, Debug)]
struct GoogleAccessTokenResult {
    access_token: String,
    scopes: Vec<String>,
    token_type: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
struct SendEmailRuntimeDeliveryPayload {
    provider: String,
    access_token: String,
    send_as_email: String,
    connection_id: String,
    connection_label: String,
}

pub fn app(runtime: RuntimeService, platform: PlatformStore) -> Router {
    let google_auth = GoogleAuthClient::from_env_or_local_file();

    Router::new()
        .route("/api/auth/login", post(login))
        .route("/api/auth/google/code", post(login_with_google_code))
        .route("/api/auth/logout", post(logout))
        .route("/api/auth/session", get(get_session))
        .route(
            "/api/workspaces",
            get(list_workspaces).post(create_workspace),
        )
        .route(
            "/api/workspaces/:workspace_id",
            get(get_workspace).delete(delete_workspace),
        )
        .route(
            "/api/workspaces/:workspace_id/connections",
            get(list_workspace_connections),
        )
        .route(
            "/api/workspaces/:workspace_id/connections/gmail/code",
            post(connect_workspace_gmail),
        )
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
            "/api/workspaces/:workspace_id/catalog",
            get(list_workspace_catalogs),
        )
        .route(
            "/api/workspaces/:workspace_id/catalog/:workflow_id/schemas/:schema_name",
            get(get_workspace_catalog_schema),
        )
        .route(
            "/api/workspaces/:workspace_id/catalog/:workflow_id/schemas/:schema_name/tables/:table_name",
            get(get_workspace_catalog_table).delete(delete_workspace_catalog_table),
        )
        .route(
            "/api/workspaces/:workspace_id/catalog/:workflow_id/schemas/:schema_name/tables/:table_name/delete-preview",
            get(preview_workspace_catalog_table_delete),
        )
        .route(
            "/api/workspaces/:workspace_id/catalog/:workflow_id/query",
            post(run_workspace_catalog_query),
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
            "/api/workspaces/:workspace_id/runs/:run_id/cancel",
            post(cancel_workspace_run),
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
        .route("/api/runs/:run_id/cancel", post(cancel_run))
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

    fn from_env_or_local_file() -> Option<Self> {
        Self::from_env().or_else(|| Self::from_env_file(".env.server"))
    }

    fn from_env_file(path: &str) -> Option<Self> {
        let contents = fs::read_to_string(FsPath::new(path)).ok()?;
        let mut client_id = None;
        let mut client_secret = None;

        for line in contents.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }

            let Some((raw_key, raw_value)) = trimmed.split_once('=') else {
                continue;
            };
            let key = raw_key.trim();
            let value = raw_value.trim().trim_matches('"').trim_matches('\'');
            match key {
                "STITCHLY_GOOGLE_CLIENT_ID" if !value.is_empty() => {
                    client_id = Some(value.to_string())
                }
                "STITCHLY_GOOGLE_CLIENT_SECRET" if !value.is_empty() => {
                    client_secret = Some(value.to_string())
                }
                _ => {}
            }
        }

        Some(Self {
            client_id: client_id?,
            client_secret: client_secret?,
            http: reqwest::Client::new(),
        })
    }

    async fn exchange_code(
        &self,
        origin: &str,
        code: &str,
    ) -> Result<GoogleCodeExchangeResult, GoogleAuthError> {
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
            .bearer_auth(&token_payload.access_token)
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

        Ok(GoogleCodeExchangeResult {
            identity: platform::GoogleIdentityProfile {
                subject: userinfo.sub,
                email: userinfo.email,
                email_verified: userinfo.email_verified,
                display_name: userinfo.name,
            },
            access_token: token_payload.access_token,
            refresh_token: token_payload.refresh_token,
            expires_at: token_payload.expires_in.and_then(expires_at_from_seconds),
            scopes: parse_google_scopes(token_payload.scope.as_deref()),
            token_type: token_payload.token_type,
        })
    }

    async fn refresh_access_token(
        &self,
        refresh_token: &str,
    ) -> Result<GoogleAccessTokenResult, GoogleAuthError> {
        let token_response = self
            .http
            .post(GOOGLE_TOKEN_ENDPOINT)
            .form(&[
                ("client_id", self.client_id.as_str()),
                ("client_secret", self.client_secret.as_str()),
                ("grant_type", "refresh_token"),
                ("refresh_token", refresh_token),
            ])
            .send()
            .await
            .map_err(|error| GoogleAuthError::Transport(error.into()))?;

        if matches!(
            token_response.status(),
            StatusCode::BAD_REQUEST | StatusCode::UNAUTHORIZED
        ) {
            return Err(GoogleAuthError::TokenRefreshRejected);
        }

        let token_response = token_response
            .error_for_status()
            .map_err(|error| GoogleAuthError::Transport(error.into()))?;
        let token_payload: GoogleTokenResponse = token_response
            .json()
            .await
            .map_err(|error| GoogleAuthError::Transport(error.into()))?;

        Ok(GoogleAccessTokenResult {
            access_token: token_payload.access_token,
            scopes: parse_google_scopes(token_payload.scope.as_deref()),
            token_type: token_payload.token_type,
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
    headers.insert(
        header::SET_COOKIE,
        session_cookie_header(&session.session_id),
    );
    Ok((headers, Json(session.session)))
}

async fn login_with_google_code(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<GoogleAuthCodeRequest>,
) -> Result<(HeaderMap, Json<AuthSessionResponse>), ApiError> {
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

    if is_local_dev_google_login_code(origin, &request.code) {
        let session = state
            .platform
            .authenticate_google_identity(&platform::GoogleIdentityProfile {
                subject: "google-subject-builder-dev".to_string(),
                email: "builder@stitchly.dev".to_string(),
                email_verified: true,
                display_name: "Builder".to_string(),
            })
            .map_err(ApiError::internal)?;

        let mut response_headers = HeaderMap::new();
        response_headers.insert(
            header::SET_COOKIE,
            session_cookie_header(&session.session_id),
        );
        return Ok((response_headers, Json(session.session)));
    }

    let google_auth = state
        .google_auth
        .clone()
        .or_else(GoogleAuthClient::from_env_or_local_file)
        .ok_or_else(|| ApiError::unavailable("Google login is not configured.".to_string()))?;

    let exchange = google_auth
        .exchange_code(origin, &request.code)
        .await
        .map_err(map_google_auth_error)?;

    let session = state
        .platform
        .authenticate_google_identity(&exchange.identity)
        .map_err(ApiError::internal)?;

    let mut response_headers = HeaderMap::new();
    response_headers.insert(
        header::SET_COOKIE,
        session_cookie_header(&session.session_id),
    );
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

async fn delete_workspace(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(workspace_id): Path<String>,
) -> Result<Json<DeleteWorkspaceResponse>, ApiError> {
    let session = require_session(&state, &headers)?;
    let response = state
        .platform
        .delete_workspace(&session.user_id, &workspace_id)
        .map_err(map_workspace_delete_error)?
        .ok_or_else(|| ApiError::not_found(format!("Workspace `{workspace_id}` was not found.")))?;
    Ok(Json(response))
}

async fn list_workspace_connections(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(workspace_id): Path<String>,
) -> Result<Json<WorkspaceConnectionsResponse>, ApiError> {
    let session = require_session(&state, &headers)?;
    let response = state
        .platform
        .list_workspace_connections(&session.user_id, &workspace_id)
        .map_err(map_workflow_persistence_error)?;
    Ok(Json(response))
}

async fn connect_workspace_gmail(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(workspace_id): Path<String>,
    Json(request): Json<GoogleAuthCodeRequest>,
) -> Result<(StatusCode, Json<WorkspaceConnectionResponse>), ApiError> {
    let session = require_session(&state, &headers)?;
    let google_auth = state
        .google_auth
        .clone()
        .or_else(GoogleAuthClient::from_env_or_local_file)
        .ok_or_else(|| ApiError::unavailable("Gmail integration is not configured.".to_string()))?;

    let requested_with = headers
        .get("x-requested-with")
        .and_then(|value| value.to_str().ok());
    if requested_with != Some("XmlHttpRequest") {
        return Err(ApiError::bad_request(
            "Gmail integration requests must include X-Requested-With.".to_string(),
        ));
    }

    let origin = headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            ApiError::bad_request("Google integration origin is missing.".to_string())
        })?;

    let exchange = google_auth
        .exchange_code(origin, &request.code)
        .await
        .map_err(map_google_auth_error)?;
    let connection = state
        .platform
        .upsert_gmail_connection(
            &session.user_id,
            &workspace_id,
            &exchange.identity,
            &platform::GoogleConnectionTokens {
                access_token: exchange.access_token,
                refresh_token: exchange.refresh_token,
                token_type: exchange.token_type,
                scopes: exchange.scopes,
                expires_at: exchange.expires_at,
            },
        )
        .map_err(ApiError::internal)?;

    Ok((
        StatusCode::CREATED,
        Json(WorkspaceConnectionResponse { connection }),
    ))
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
        .update_workflow(
            &session.user_id,
            &workspace_id,
            &workflow_id,
            &request.workflow,
        )
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

async fn list_workspace_catalogs(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(workspace_id): Path<String>,
) -> Result<Json<WorkspaceCatalogResponse>, ApiError> {
    let session = require_session(&state, &headers)?;
    let catalog = state
        .platform
        .list_workspace_catalogs(&session.user_id, &workspace_id)
        .map_err(map_workflow_persistence_error)?;
    Ok(Json(catalog))
}

async fn get_workspace_catalog_schema(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((workspace_id, workflow_id, schema_name)): Path<(String, String, String)>,
) -> Result<Json<WorkspaceCatalogSchemaResponse>, ApiError> {
    let session = require_session(&state, &headers)?;
    let schema = state
        .platform
        .get_workspace_catalog_schema(
            &session.user_id,
            &workspace_id,
            &workflow_id,
            &schema_name,
        )
        .map_err(map_workflow_persistence_error)?
        .ok_or_else(|| {
            ApiError::not_found(format!(
                "Schema `{schema_name}` was not found in workflow `{workflow_id}` for workspace `{workspace_id}`."
            ))
        })?;
    Ok(Json(schema))
}

async fn get_workspace_catalog_table(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((workspace_id, workflow_id, schema_name, table_name)): Path<(
        String,
        String,
        String,
        String,
    )>,
) -> Result<Json<WorkspaceCatalogTableResponse>, ApiError> {
    let session = require_session(&state, &headers)?;
    let table = state
        .platform
        .get_workspace_catalog_table(
            &session.user_id,
            &workspace_id,
            &workflow_id,
            &schema_name,
            &table_name,
        )
        .map_err(map_workflow_persistence_error)?
        .ok_or_else(|| {
            ApiError::not_found(format!(
                "Table `{schema_name}.{table_name}` was not found in workflow `{workflow_id}` for workspace `{workspace_id}`."
            ))
    })?;
    Ok(Json(table))
}

async fn preview_workspace_catalog_table_delete(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((workspace_id, workflow_id, schema_name, table_name)): Path<(
        String,
        String,
        String,
        String,
    )>,
) -> Result<Json<WorkspaceCatalogDeleteTablePreviewResponse>, ApiError> {
    let session = require_session(&state, &headers)?;
    let preview = state
        .platform
        .preview_workspace_catalog_table_delete(
            &session.user_id,
            &workspace_id,
            &workflow_id,
            &schema_name,
            &table_name,
        )
        .map_err(map_workflow_persistence_error)?
        .ok_or_else(|| {
            ApiError::not_found(format!(
                "Table `{schema_name}.{table_name}` was not found in workflow `{workflow_id}` for workspace `{workspace_id}`."
            ))
        })?;
    Ok(Json(preview))
}

async fn delete_workspace_catalog_table(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((workspace_id, workflow_id, schema_name, table_name)): Path<(
        String,
        String,
        String,
        String,
    )>,
) -> Result<Json<WorkspaceCatalogDeleteTableResponse>, ApiError> {
    let session = require_session(&state, &headers)?;
    let response = state
        .platform
        .delete_workspace_catalog_table(
            &session.user_id,
            &workspace_id,
            &workflow_id,
            &schema_name,
            &table_name,
        )
        .map_err(map_catalog_query_error)?
        .ok_or_else(|| {
            ApiError::not_found(format!(
                "Table `{schema_name}.{table_name}` was not found in workflow `{workflow_id}` for workspace `{workspace_id}`."
            ))
        })?;
    Ok(Json(response))
}

async fn run_workspace_catalog_query(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((workspace_id, workflow_id)): Path<(String, String)>,
    Json(request): Json<WorkspaceCatalogQueryRequest>,
) -> Result<Json<WorkspaceCatalogQueryResponse>, ApiError> {
    let session = require_session(&state, &headers)?;
    let response = state
        .platform
        .run_workspace_catalog_query(
            &session.user_id,
            &workspace_id,
            &workflow_id,
            request.query.as_str(),
        )
        .map_err(map_catalog_query_error)?
        .ok_or_else(|| {
            ApiError::not_found(format!(
                "Workflow `{workflow_id}` was not found for workspace `{workspace_id}`."
            ))
        })?;
    Ok(Json(response))
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
            let snapshot: RunSnapshot =
                serde_json::from_str(&stored.snapshot_json).map_err(ApiError::internal)?;
            runs.push(snapshot);
        }
    }

    Ok(Json(WorkspaceRunsResponse { runs }))
}

async fn create_workspace_run(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(workspace_id): Path<String>,
    Json(mut request): Json<CreateRunRequest>,
) -> Result<(StatusCode, Json<api_contract::CreateRunResponse>), ApiError> {
    let session = require_session(&state, &headers)?;
    state
        .platform
        .get_workflow(
            &session.user_id,
            &workspace_id,
            &request.workflow.workflow_id,
        )
        .map_err(ApiError::internal)?
        .ok_or_else(|| {
            ApiError::not_found(format!(
                "Workflow `{}` was not found in workspace `{workspace_id}`.",
                request.workflow.workflow_id
            ))
        })?;

    hydrate_send_email_runtime_delivery(
        &state,
        &session.user_id,
        &workspace_id,
        &mut request.workflow,
    )
    .await?;

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
                            .persist_run_history(&workspace_id, Some(&user_id), &snapshot, &history)
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
    let snapshot =
        deserialize_workspace_run_snapshot(&stored.snapshot_json).map_err(ApiError::internal)?;

    Ok(Json(WorkspaceRunResponse { run: snapshot }))
}

async fn cancel_workspace_run(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((workspace_id, run_id)): Path<(String, String)>,
) -> Result<Json<WorkspaceRunResponse>, ApiError> {
    let session = require_session(&state, &headers)?;

    let stored = state
        .platform
        .get_workspace_run_record(&session.user_id, &workspace_id, &run_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| workspace_run_not_found(&workspace_id, &run_id))?;
    let stored_snapshot =
        deserialize_workspace_run_snapshot(&stored.snapshot_json).map_err(ApiError::internal)?;

    match state.runtime.cancel_run(&run_id).await {
        Ok(_) => {}
        Err(RuntimeError::RunNotFound(_)) => {
            if !is_cancellable_run_status(&stored_snapshot.status) {
                return Err(ApiError::conflict(
                    "Only active runs can be cancelled.".to_string(),
                ));
            }

            let events = state
                .platform
                .list_workspace_run_events(&session.user_id, &workspace_id, &run_id)
                .map_err(ApiError::internal)?;
            let cancelled_snapshot = reconcile_persisted_run_as_cancelled(stored_snapshot);
            let reconciled_history =
                build_persisted_cancellation_history(events, &cancelled_snapshot);

            state
                .platform
                .persist_run_history(
                    &workspace_id,
                    Some(&session.user_id),
                    &cancelled_snapshot,
                    &reconciled_history,
                )
                .map_err(ApiError::internal)?;

            return Ok(Json(WorkspaceRunResponse {
                run: cancelled_snapshot,
            }));
        }
        Err(error) => return Err(ApiError::from(error)),
    }

    let snapshot = state
        .runtime
        .get_run(&run_id)
        .await
        .ok_or_else(|| ApiError::not_found(format!("Run `{run_id}` was not found.")))?;
    let history = state
        .runtime
        .event_history(&run_id)
        .await
        .unwrap_or_default();
    state
        .platform
        .persist_run_history(&workspace_id, Some(&session.user_id), &snapshot, &history)
        .map_err(ApiError::internal)?;

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
        let events = state
            .runtime
            .event_history(&run_id)
            .await
            .unwrap_or_default();
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

    let snapshot =
        deserialize_workspace_run_snapshot(&stored.snapshot_json).map_err(ApiError::internal)?;
    Ok(Json(RunLogsResponse {
        logs: snapshot.logs,
    }))
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

async fn cancel_run(
    State(state): State<AppState>,
    Path(run_id): Path<String>,
) -> Result<Json<RunSnapshot>, ApiError> {
    match state.runtime.cancel_run(&run_id).await {
        Ok(snapshot) => Ok(Json(snapshot)),
        Err(RuntimeError::RunNotFound(_)) => Err(ApiError::conflict(
            "Only active runs can be cancelled.".to_string(),
        )),
        Err(error) => Err(ApiError::from(error)),
    }
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

fn parse_google_scopes(scope_list: Option<&str>) -> Vec<String> {
    scope_list
        .unwrap_or_default()
        .split_whitespace()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .collect()
}

async fn hydrate_send_email_runtime_delivery(
    state: &AppState,
    user_id: &str,
    workspace_id: &str,
    workflow: &mut WorkflowDefinition,
) -> Result<(), ApiError> {
    for node in &mut workflow.nodes {
        if node.type_id != "send_email" {
            continue;
        }

        let selected_connection_id = node
            .config
            .get("connection_id")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("default_mailer");
        let Some(connection) = resolve_send_email_workspace_connection(
            state,
            user_id,
            workspace_id,
            selected_connection_id,
        )
        .await?
        else {
            continue;
        };

        let runtime_delivery =
            resolve_gmail_runtime_delivery_context(state.google_auth.as_ref(), &connection).await?;

        if !node.config.is_object() {
            node.config = serde_json::Value::Object(Default::default());
        }
        let config = node.config.as_object_mut().ok_or_else(|| {
            ApiError::bad_request(format!(
                "Send Email node `{}` must use an object config.",
                node.node_id
            ))
        })?;
        config.insert(
            "runtime_delivery".to_string(),
            serde_json::to_value(&runtime_delivery).map_err(ApiError::internal)?,
        );
    }

    Ok(())
}

async fn resolve_send_email_workspace_connection(
    state: &AppState,
    user_id: &str,
    workspace_id: &str,
    selected_connection_id: &str,
) -> Result<Option<platform::WorkspaceGmailConnection>, ApiError> {
    if selected_connection_id == "default_mailer" {
        let connections = state
            .platform
            .list_workspace_connections(user_id, workspace_id)
            .map_err(ApiError::internal)?;
        let email_capable_connections: Vec<_> = connections
            .connections
            .into_iter()
            .filter(|connection| {
                connection.status == "active"
                    && (connection.capabilities.get("send_email")
                        == Some(&serde_json::Value::Bool(true))
                        || connection.connection_kind == "gmail")
            })
            .collect();

        if email_capable_connections.len() != 1 {
            return Ok(None);
        }

        let connection_id = email_capable_connections[0].connection_id.clone();
        return state
            .platform
            .get_workspace_gmail_connection(user_id, workspace_id, &connection_id)
            .map_err(ApiError::internal);
    }

    let connection = state
        .platform
        .get_workspace_gmail_connection(user_id, workspace_id, selected_connection_id)
        .map_err(ApiError::internal)?;

    match connection {
        Some(connection) => Ok(Some(connection)),
        None => Err(ApiError::bad_request(format!(
            "Send Email references connection `{selected_connection_id}`, but no active Gmail integration with that ID exists in workspace `{workspace_id}`."
        ))),
    }
}

async fn resolve_gmail_runtime_delivery_context(
    google_auth: Option<&GoogleAuthClient>,
    connection: &platform::WorkspaceGmailConnection,
) -> Result<SendEmailRuntimeDeliveryPayload, ApiError> {
    ensure_gmail_send_scope(connection)?;

    let stored_access_token = connection
        .access_token
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    let stored_access_is_valid = stored_access_token.is_some()
        && google_access_token_is_usable(connection.expires_at.as_deref());

    let (access_token, _token_type) = if stored_access_is_valid {
        (
            stored_access_token.expect("stored token already checked"),
            connection.token_type.clone(),
        )
    } else if let Some(refresh_token) = connection
        .refresh_token
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let google_auth = google_auth.ok_or_else(|| {
            ApiError::unavailable(
                "Gmail token refresh is not configured on the backend.".to_string(),
            )
        })?;
        let refreshed = google_auth
            .refresh_access_token(refresh_token)
            .await
            .map_err(map_google_gmail_refresh_error)?;
        let effective_scopes = if refreshed.scopes.is_empty() {
            connection.scopes.clone()
        } else {
            refreshed.scopes.clone()
        };
        ensure_gmail_send_scope_values(&connection.connection_id, &effective_scopes)?;
        (refreshed.access_token, refreshed.token_type)
    } else if let Some(access_token) = stored_access_token {
        if connection.expires_at.is_some() {
            return Err(ApiError::conflict(format!(
                "Gmail connection `{}` needs to be reconnected before it can send mail again.",
                connection.display_name
            )));
        }
        (access_token, connection.token_type.clone())
    } else {
        return Err(ApiError::conflict(format!(
            "Gmail connection `{}` does not currently have a usable access token. Reconnect it and try again.",
            connection.display_name
        )));
    };

    Ok(SendEmailRuntimeDeliveryPayload {
        provider: "gmail".to_string(),
        access_token,
        send_as_email: connection.send_as_email.clone(),
        connection_id: connection.connection_id.clone(),
        connection_label: connection.display_name.clone(),
    })
}

fn ensure_gmail_send_scope(
    connection: &platform::WorkspaceGmailConnection,
) -> Result<(), ApiError> {
    ensure_gmail_send_scope_values(&connection.connection_id, &connection.scopes)
}

fn ensure_gmail_send_scope_values(connection_id: &str, scopes: &[String]) -> Result<(), ApiError> {
    if scopes
        .iter()
        .any(|scope| scope == "https://www.googleapis.com/auth/gmail.send")
    {
        return Ok(());
    }

    Err(ApiError::conflict(format!(
        "Gmail connection `{connection_id}` is missing the gmail.send scope."
    )))
}

fn google_access_token_is_usable(expires_at: Option<&str>) -> bool {
    let Some(expires_at) = expires_at else {
        return true;
    };
    let Ok(expires_at) = chrono::DateTime::parse_from_rfc3339(expires_at) else {
        return false;
    };

    expires_at.with_timezone(&chrono::Utc) > (chrono::Utc::now() + chrono::Duration::seconds(60))
}

fn map_google_gmail_refresh_error(error: GoogleAuthError) -> ApiError {
    match error {
        GoogleAuthError::TokenRefreshRejected => ApiError::conflict(
            "The selected Gmail connection needs to be reconnected before it can send mail."
                .to_string(),
        ),
        GoogleAuthError::Transport(error) => ApiError::internal(error),
        GoogleAuthError::InvalidCode | GoogleAuthError::InvalidIdentity => ApiError::conflict(
            "The selected Gmail connection could not be refreshed. Reconnect it and try again."
                .to_string(),
        ),
    }
}

fn expires_at_from_seconds(seconds: i64) -> Option<String> {
    if seconds <= 0 {
        return None;
    }

    Some((chrono::Utc::now() + chrono::Duration::seconds(seconds)).to_rfc3339())
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

fn is_cancellable_run_status(status: &RunStatus) -> bool {
    matches!(
        status,
        RunStatus::Created
            | RunStatus::Queued
            | RunStatus::Planning
            | RunStatus::Running
            | RunStatus::Cancelling
    )
}

fn reconcile_persisted_run_as_cancelled(mut snapshot: RunSnapshot) -> RunSnapshot {
    let now = chrono::Utc::now();
    let cancellation_error = cancelled_run_error_summary();

    snapshot.status = RunStatus::Cancelled;
    snapshot.finished_at = Some(now);
    snapshot.error = Some(cancellation_error.clone());

    for node_run in &mut snapshot.node_runs {
        match node_run.status {
            NodeRunStatus::Succeeded | NodeRunStatus::Failed | NodeRunStatus::Skipped => {}
            NodeRunStatus::Cancelled => {
                node_run.finished_at = node_run.finished_at.or(Some(now));
                node_run.error = node_run.error.clone().or(Some(cancellation_error.clone()));
            }
            _ => {
                node_run.status = NodeRunStatus::Cancelled;
                node_run.finished_at = Some(now);
                node_run.error = Some(cancellation_error.clone());
            }
        }
    }

    snapshot
}

fn build_persisted_cancellation_history(
    mut events: Vec<RunEvent>,
    snapshot: &RunSnapshot,
) -> Vec<RunEvent> {
    let now = snapshot.finished_at.unwrap_or_else(chrono::Utc::now);
    let next_sequence = events.last().map(|event| event.sequence + 1).unwrap_or(1);
    let already_requested = events
        .iter()
        .any(|event| event.event_type == RunEventType::CancellationRequested);
    let already_cancelled = events
        .iter()
        .any(|event| event.event_type == RunEventType::RunCancelled);

    let mut sequence = next_sequence;

    if !already_requested {
        events.push(RunEvent {
            event_id: format!("evt_{}", Uuid::new_v4().simple()),
            run_id: snapshot.run_id.clone(),
            sequence,
            timestamp: now,
            event_type: RunEventType::CancellationRequested,
            target: EventTarget {
                kind: EventTargetKind::Run,
                node_id: None,
            },
            payload: serde_json::json!({ "status": RunStatus::Cancelling }),
        });
        sequence += 1;
    }

    if !already_cancelled {
        events.push(RunEvent {
            event_id: format!("evt_{}", Uuid::new_v4().simple()),
            run_id: snapshot.run_id.clone(),
            sequence,
            timestamp: now,
            event_type: RunEventType::NodeLog,
            target: EventTarget {
                kind: EventTargetKind::Run,
                node_id: None,
            },
            payload: serde_json::json!({
                "level": LogLevel::Warn,
                "message": "Run was reconciled as cancelled because no live runtime task was found."
            }),
        });
        sequence += 1;

        events.push(RunEvent {
            event_id: format!("evt_{}", Uuid::new_v4().simple()),
            run_id: snapshot.run_id.clone(),
            sequence,
            timestamp: now,
            event_type: RunEventType::RunCancelled,
            target: EventTarget {
                kind: EventTargetKind::Run,
                node_id: None,
            },
            payload: serde_json::json!({
                "status": RunStatus::Cancelled,
                "error": cancelled_run_error_summary(),
            }),
        });
    }

    events
}

fn cancelled_run_error_summary() -> RunErrorSummary {
    RunErrorSummary {
        category: RunErrorCategory::Cancellation,
        message: "Run cancelled by user.".to_string(),
    }
}

fn workspace_run_not_found(workspace_id: &str, run_id: &str) -> ApiError {
    ApiError::not_found(format!(
        "Run `{run_id}` was not found in workspace `{workspace_id}`."
    ))
}

fn is_local_dev_google_login_code(origin: &str, code: &str) -> bool {
    if !cfg!(debug_assertions) || code != "dev-google-auth-code" {
        return false;
    }

    origin
        .parse::<axum::http::Uri>()
        .ok()
        .and_then(|uri| uri.host().map(str::to_string))
        .is_some_and(|host| matches!(host.as_str(), "localhost" | "127.0.0.1"))
}

fn load_session(
    state: &AppState,
    headers: &HeaderMap,
) -> anyhow::Result<Option<AuthenticatedSession>> {
    let Some(session_id) = read_session_cookie(headers) else {
        return Ok(None);
    };

    state.platform.load_session(&session_id)
}

fn require_session(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<AuthenticatedSession, ApiError> {
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
    HeaderValue::from_static("stitchly_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0")
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

    fn forbidden(message: String) -> Self {
        Self {
            status: StatusCode::FORBIDDEN,
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

fn map_workspace_delete_error(error: anyhow::Error) -> ApiError {
    let message = error.to_string();
    if message.contains("requires owner role") {
        ApiError::forbidden(message)
    } else {
        map_workflow_persistence_error(error)
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

fn map_catalog_query_error(error: anyhow::Error) -> ApiError {
    let message = error.to_string();
    if message.contains("Enter a SQL query")
        || message.contains("Only a single read-only query")
        || message.contains("Only read-only SELECT queries")
        || message.contains("DuckDB query failed")
        || message.contains("cannot be deleted")
    {
        ApiError::bad_request(message)
    } else {
        map_workflow_persistence_error(error)
    }
}

fn map_google_auth_error(error: GoogleAuthError) -> ApiError {
    match error {
        GoogleAuthError::InvalidCode => {
            ApiError::unauthorized("Google sign-in could not be completed.".to_string())
        }
        GoogleAuthError::InvalidIdentity => {
            ApiError::bad_request("Google did not return a usable identity profile.".to_string())
        }
        GoogleAuthError::TokenRefreshRejected => {
            ApiError::conflict("Google rejected the stored token refresh request.".to_string())
        }
        GoogleAuthError::Transport(error) => ApiError::internal(error),
    }
}

#[cfg(test)]
mod tests {
    use std::str;

    use api_contract::{
        RunErrorCategory, RunEventType, RunSnapshot, RunStatus, RunTrigger, TriggerKind,
    };
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use futures::StreamExt;
    use http_body_util::BodyExt;
    use serde_json::json;
    use tokio::time::{sleep, Duration};
    use tower::ServiceExt;
    use workflow_schema::{NodePosition, WorkflowDefinition, WorkflowEdge, WorkflowNode};

    use super::{app, hydrate_send_email_runtime_delivery, AppState};
    use crate::platform::{GoogleConnectionTokens, GoogleIdentityProfile, PlatformStore};

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
    async fn validate_endpoint_accepts_table_output_workflow() {
        let router = app(
            runtime_core::RuntimeService::default(),
            PlatformStore::for_tests().expect("platform store"),
        );
        let workflow = WorkflowDefinition {
            schema_version: 1,
            workflow_id: "wf_table_output_validate".to_string(),
            version: 1,
            name: "Table Output Validate".to_string(),
            description: None,
            nodes: vec![
                WorkflowNode {
                    node_id: "input_text".to_string(),
                    type_id: "text_input".to_string(),
                    definition_version: 1,
                    label: Some("Text Input".to_string()),
                    config: json!({
                        "text": "Latest market digest"
                    }),
                    position: NodePosition::default(),
                },
                WorkflowNode {
                    node_id: "table_output_news_brief".to_string(),
                    type_id: "table_output".to_string(),
                    definition_version: 1,
                    label: Some("Table Output".to_string()),
                    config: json!({
                        "target_schema": "outputs",
                        "table_name": "news_brief",
                        "write_mode": "append",
                        "input_shape": "single_text_row",
                        "value_column": "content",
                        "include_run_id": true,
                        "include_written_at": true,
                        "open_in_catalog": false
                    }),
                    position: NodePosition::default(),
                },
            ],
            edges: vec![WorkflowEdge {
                edge_id: "edge_input_text_to_table_output_text".to_string(),
                source_node_id: "input_text".to_string(),
                source_port_id: "text".to_string(),
                target_node_id: "table_output_news_brief".to_string(),
                target_port_id: "text".to_string(),
            }],
            metadata: Default::default(),
        };
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

        let payload = response
            .into_body()
            .collect()
            .await
            .expect("body collects")
            .to_bytes();
        let validation: api_contract::ValidateWorkflowResponse =
            serde_json::from_slice(&payload).expect("validation response parses");
        assert!(
            validation.valid,
            "expected valid response, got: {validation:?}"
        );
    }

    #[tokio::test]
    async fn validate_endpoint_accepts_table_input_to_table_output_workflow() {
        let router = app(
            runtime_core::RuntimeService::default(),
            PlatformStore::for_tests().expect("platform store"),
        );
        let workflow = WorkflowDefinition {
            schema_version: 1,
            workflow_id: "wf_table_input_output_validate".to_string(),
            version: 1,
            name: "Table Input Output Validate".to_string(),
            description: None,
            nodes: vec![
                WorkflowNode {
                    node_id: "table_input_runs".to_string(),
                    type_id: "table_input".to_string(),
                    definition_version: 1,
                    label: Some("Table Input".to_string()),
                    config: json!({
                        "catalog": "workflow.duckdb",
                        "schema_name": "runs",
                        "table_name": "workflow_runs",
                        "output_alias": "workflow_runs"
                    }),
                    position: NodePosition::default(),
                },
                WorkflowNode {
                    node_id: "table_output_copy".to_string(),
                    type_id: "table_output".to_string(),
                    definition_version: 1,
                    label: Some("Table Output".to_string()),
                    config: json!({
                        "target_schema": "tables",
                        "table_name": "workflow_runs_copy",
                        "write_mode": "replace",
                        "input_shape": "source_table",
                        "include_run_id": true,
                        "include_written_at": true,
                        "open_in_catalog": false
                    }),
                    position: NodePosition::default(),
                },
            ],
            edges: vec![WorkflowEdge {
                edge_id: "edge_table_input_to_table_output".to_string(),
                source_node_id: "table_input_runs".to_string(),
                source_port_id: "table".to_string(),
                target_node_id: "table_output_copy".to_string(),
                target_port_id: "text".to_string(),
            }],
            metadata: Default::default(),
        };
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

        let payload = response
            .into_body()
            .collect()
            .await
            .expect("body collects")
            .to_bytes();
        let validation: api_contract::ValidateWorkflowResponse =
            serde_json::from_slice(&payload).expect("validation response parses");
        assert!(
            validation.valid,
            "expected valid response, got: {validation:?}"
        );
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
                serde_json::to_vec(&json!({ "name": "Product Ops" })).expect("workspace body"),
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
        assert_eq!(
            session.active_workspace_id,
            Some(workspace.workspace.workspace_id)
        );
    }

    #[tokio::test]
    async fn local_dev_google_code_creates_builder_session() {
        let router = app(
            runtime_core::RuntimeService::default(),
            PlatformStore::for_tests().expect("platform store"),
        );

        let request = Request::builder()
            .method("POST")
            .uri("/api/auth/google/code")
            .header("content-type", "application/json")
            .header("x-requested-with", "XmlHttpRequest")
            .header("origin", "http://127.0.0.1:5173")
            .body(Body::from(
                serde_json::to_vec(&json!({ "code": "dev-google-auth-code" }))
                    .expect("request body"),
            ))
            .expect("request builds");

        let response = router.oneshot(request).await.expect("response");
        assert_eq!(response.status(), StatusCode::OK);
        assert!(response.headers().get("set-cookie").is_some());

        let body = response
            .into_body()
            .collect()
            .await
            .expect("body")
            .to_bytes();
        let session: api_contract::AuthSessionResponse =
            serde_json::from_slice(&body).expect("session payload");
        assert!(session.authenticated);
        assert_eq!(
            session.user.as_ref().expect("user").email,
            "builder@stitchly.dev"
        );
        assert_eq!(session.active_workspace_id, Some("ws_default".to_string()));
    }

    #[tokio::test]
    async fn workspace_delete_removes_the_workspace_from_session() {
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

        let create_workspace_request = Request::builder()
            .method("POST")
            .uri("/api/workspaces")
            .header("content-type", "application/json")
            .header("cookie", &cookie)
            .body(Body::from(
                serde_json::to_vec(&json!({ "name": "Delete Me" })).expect("workspace body"),
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

        let delete_workspace_request = Request::builder()
            .method("DELETE")
            .uri(format!(
                "/api/workspaces/{}",
                workspace.workspace.workspace_id
            ))
            .header("cookie", &cookie)
            .body(Body::empty())
            .expect("request builds");
        let delete_workspace_response = router
            .clone()
            .oneshot(delete_workspace_request)
            .await
            .expect("delete response");
        assert_eq!(delete_workspace_response.status(), StatusCode::OK);

        let delete_payload = delete_workspace_response
            .into_body()
            .collect()
            .await
            .expect("body")
            .to_bytes();
        let deleted: api_contract::DeleteWorkspaceResponse =
            serde_json::from_slice(&delete_payload).expect("delete payload");
        assert_eq!(deleted.workspace_id, workspace.workspace.workspace_id);
        assert!(deleted.deleted);

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
        assert_eq!(session_response.status(), StatusCode::OK);

        let body = session_response
            .into_body()
            .collect()
            .await
            .expect("body")
            .to_bytes();
        let session: api_contract::AuthSessionResponse =
            serde_json::from_slice(&body).expect("session payload");
        assert!(session.authenticated);
        assert!(session.workspaces.is_empty());
        assert_eq!(session.active_workspace_id, None);
    }

    #[tokio::test]
    async fn gmail_send_email_nodes_receive_runtime_delivery_context_before_run() {
        let platform = PlatformStore::for_tests().expect("platform store");
        let workspace = platform
            .create_workspace("usr_builder", "Hydration Workspace")
            .expect("workspace");
        let connection = platform
            .upsert_gmail_connection(
                "usr_builder",
                &workspace.workspace_id,
                &GoogleIdentityProfile {
                    subject: "google-send-subject".to_string(),
                    email: "ops@gmail.com".to_string(),
                    email_verified: true,
                    display_name: "Ops Sender".to_string(),
                },
                &GoogleConnectionTokens {
                    access_token: "hydration-access-token".to_string(),
                    refresh_token: None,
                    token_type: Some("Bearer".to_string()),
                    scopes: vec![
                        "openid".to_string(),
                        "email".to_string(),
                        "profile".to_string(),
                        "https://www.googleapis.com/auth/gmail.send".to_string(),
                    ],
                    expires_at: None,
                },
            )
            .expect("gmail connection");
        let state = AppState {
            runtime: runtime_core::RuntimeService::default(),
            platform: platform.clone(),
            google_auth: None,
        };
        let mut workflow = WorkflowDefinition {
            schema_version: workflow_schema::CURRENT_SCHEMA_VERSION,
            workflow_id: "wf_gmail_runtime".to_string(),
            version: 1,
            name: "Gmail Runtime Delivery".to_string(),
            description: None,
            nodes: vec![
                WorkflowNode {
                    node_id: "input_text".to_string(),
                    type_id: "text_input".to_string(),
                    definition_version: 1,
                    label: Some("Text Input".to_string()),
                    config: json!({
                        "text": "Test body"
                    }),
                    position: NodePosition::default(),
                },
                WorkflowNode {
                    node_id: "send_email_notification".to_string(),
                    type_id: "send_email".to_string(),
                    definition_version: 1,
                    label: Some("Send Email".to_string()),
                    config: json!({
                        "to": "alerts@stitchly.dev",
                        "subject": "Runtime delivery test",
                        "body_mode": "input",
                        "connection_id": connection.connection_id
                    }),
                    position: NodePosition::default(),
                },
            ],
            edges: vec![WorkflowEdge {
                edge_id: "edge_body".to_string(),
                source_node_id: "input_text".to_string(),
                source_port_id: "text".to_string(),
                target_node_id: "send_email_notification".to_string(),
                target_port_id: "body".to_string(),
            }],
            metadata: Default::default(),
        };

        hydrate_send_email_runtime_delivery(
            &state,
            "usr_builder",
            &workspace.workspace_id,
            &mut workflow,
        )
        .await
        .expect("workflow hydrated");

        let send_email = workflow
            .nodes
            .iter()
            .find(|node| node.node_id == "send_email_notification")
            .expect("send email node");
        assert_eq!(
            send_email
                .config
                .get("runtime_delivery")
                .and_then(|value| value.get("provider"))
                .and_then(serde_json::Value::as_str),
            Some("gmail")
        );
        assert_eq!(
            send_email
                .config
                .get("runtime_delivery")
                .and_then(|value| value.get("access_token"))
                .and_then(serde_json::Value::as_str),
            Some("hydration-access-token")
        );
        assert_eq!(
            send_email
                .config
                .get("runtime_delivery")
                .and_then(|value| value.get("send_as_email"))
                .and_then(serde_json::Value::as_str),
            Some("ops@gmail.com")
        );
    }

    #[tokio::test]
    async fn default_workspace_mailer_uses_single_active_gmail_integration() {
        let platform = PlatformStore::for_tests().expect("platform store");
        let workspace = platform
            .create_workspace("usr_builder", "Default Mailer Workspace")
            .expect("workspace");
        let connection = platform
            .upsert_gmail_connection(
                "usr_builder",
                &workspace.workspace_id,
                &GoogleIdentityProfile {
                    subject: "google-default-mailer".to_string(),
                    email: "default@gmail.com".to_string(),
                    email_verified: true,
                    display_name: "Default Sender".to_string(),
                },
                &GoogleConnectionTokens {
                    access_token: "default-mailer-token".to_string(),
                    refresh_token: None,
                    token_type: Some("Bearer".to_string()),
                    scopes: vec![
                        "openid".to_string(),
                        "email".to_string(),
                        "profile".to_string(),
                        "https://www.googleapis.com/auth/gmail.send".to_string(),
                    ],
                    expires_at: None,
                },
            )
            .expect("gmail connection");
        let state = AppState {
            runtime: runtime_core::RuntimeService::default(),
            platform: platform.clone(),
            google_auth: None,
        };
        let mut workflow = WorkflowDefinition {
            schema_version: workflow_schema::CURRENT_SCHEMA_VERSION,
            workflow_id: "wf_default_mailer".to_string(),
            version: 1,
            name: "Default Mailer".to_string(),
            description: None,
            nodes: vec![
                WorkflowNode {
                    node_id: "input_text".to_string(),
                    type_id: "text_input".to_string(),
                    definition_version: 1,
                    label: Some("Text Input".to_string()),
                    config: json!({
                        "text": "Test body"
                    }),
                    position: NodePosition::default(),
                },
                WorkflowNode {
                    node_id: "send_email_notification".to_string(),
                    type_id: "send_email".to_string(),
                    definition_version: 1,
                    label: Some("Send Email".to_string()),
                    config: json!({
                        "to": "alerts@stitchly.dev",
                        "subject": "Default workspace mailer test",
                        "body_mode": "input",
                        "connection_id": "default_mailer"
                    }),
                    position: NodePosition::default(),
                },
            ],
            edges: vec![WorkflowEdge {
                edge_id: "edge_body".to_string(),
                source_node_id: "input_text".to_string(),
                source_port_id: "text".to_string(),
                target_node_id: "send_email_notification".to_string(),
                target_port_id: "body".to_string(),
            }],
            metadata: Default::default(),
        };

        hydrate_send_email_runtime_delivery(
            &state,
            "usr_builder",
            &workspace.workspace_id,
            &mut workflow,
        )
        .await
        .expect("workflow hydrated");

        let send_email = workflow
            .nodes
            .iter()
            .find(|node| node.node_id == "send_email_notification")
            .expect("send email node");
        assert_eq!(
            send_email
                .config
                .get("runtime_delivery")
                .and_then(|value| value.get("connection_id"))
                .and_then(serde_json::Value::as_str),
            Some(connection.connection_id.as_str())
        );
        assert_eq!(
            send_email
                .config
                .get("runtime_delivery")
                .and_then(|value| value.get("access_token"))
                .and_then(serde_json::Value::as_str),
            Some("default-mailer-token")
        );
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
                serde_json::to_vec(&json!({ "name": "Canvas Ops" })).expect("workspace body"),
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
    async fn workspace_catalog_routes_return_tree_and_table_grains() {
        let platform = PlatformStore::for_tests().expect("platform store");
        let router = app(runtime_core::RuntimeService::default(), platform);

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
                serde_json::to_vec(&json!({ "name": "Catalog Routes" })).expect("workspace body"),
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
        workflow.name = "Catalog Route Workflow".to_string();

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
        let create_workflow_body = create_workflow_response
            .into_body()
            .collect()
            .await
            .expect("body")
            .to_bytes();
        let created: api_contract::WorkflowResponse =
            serde_json::from_slice(&create_workflow_body).expect("workflow payload");

        let catalog_request = Request::builder()
            .method("GET")
            .uri(format!(
                "/api/workspaces/{}/catalog",
                workspace.workspace.workspace_id
            ))
            .header("cookie", &cookie)
            .body(Body::empty())
            .expect("request builds");
        let catalog_response = router
            .clone()
            .oneshot(catalog_request)
            .await
            .expect("catalog response");
        assert_eq!(catalog_response.status(), StatusCode::OK);
        let catalog_body = catalog_response
            .into_body()
            .collect()
            .await
            .expect("body")
            .to_bytes();
        let catalog: api_contract::WorkspaceCatalogResponse =
            serde_json::from_slice(&catalog_body).expect("catalog payload");
        assert_eq!(catalog.catalogs.len(), 1);
        assert!(catalog.catalogs[0]
            .schemas
            .iter()
            .any(|schema| schema.schema_name == "runs"));

        let table_request = Request::builder()
            .method("GET")
            .uri(format!(
                "/api/workspaces/{}/catalog/{}/schemas/runs/tables/workflow_runs",
                workspace.workspace.workspace_id, created.workflow.workflow_id
            ))
            .header("cookie", &cookie)
            .body(Body::empty())
            .expect("request builds");
        let table_response = router
            .clone()
            .oneshot(table_request)
            .await
            .expect("table response");
        assert_eq!(table_response.status(), StatusCode::OK);
        let table_body = table_response
            .into_body()
            .collect()
            .await
            .expect("body")
            .to_bytes();
        let table: api_contract::WorkspaceCatalogTableResponse =
            serde_json::from_slice(&table_body).expect("table payload");
        assert_eq!(table.schema_name, "runs");
        assert_eq!(table.table_name, "workflow_runs");
        assert!(table
            .columns
            .iter()
            .any(|column| column.column_name == "run_id"));

        let query_request = Request::builder()
            .method("POST")
            .uri(format!(
                "/api/workspaces/{}/catalog/{}/query",
                workspace.workspace.workspace_id, created.workflow.workflow_id
            ))
            .header("content-type", "application/json")
            .header("cookie", &cookie)
            .body(Body::from(
                serde_json::to_vec(&json!({
                    "query": "select run_id, workflow_id, status from runs.workflow_runs"
                }))
                .expect("query body"),
            ))
            .expect("request builds");
        let query_response = router
            .clone()
            .oneshot(query_request)
            .await
            .expect("query response");
        assert_eq!(query_response.status(), StatusCode::OK);
        let query_body = query_response
            .into_body()
            .collect()
            .await
            .expect("body")
            .to_bytes();
        let query: api_contract::WorkspaceCatalogQueryResponse =
            serde_json::from_slice(&query_body).expect("query payload");
        assert_eq!(query.workflow_id, created.workflow.workflow_id);
        assert_eq!(
            query
                .columns
                .iter()
                .map(|column| column.column_name.as_str())
                .collect::<Vec<_>>(),
            vec!["run_id", "workflow_id", "status"]
        );
    }

    #[tokio::test]
    async fn workspace_catalog_delete_routes_protect_system_tables() {
        let platform = PlatformStore::for_tests().expect("platform store");
        let router = app(runtime_core::RuntimeService::default(), platform.clone());

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
                serde_json::to_vec(&json!({ "name": "Catalog Delete Routes" }))
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
        workflow.workflow_id = "wf_catalog_delete_route".to_string();
        workflow.name = "Catalog Delete Route Workflow".to_string();

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
        let create_workflow_body = create_workflow_response
            .into_body()
            .collect()
            .await
            .expect("body")
            .to_bytes();
        let created: api_contract::WorkflowResponse =
            serde_json::from_slice(&create_workflow_body).expect("workflow payload");

        let preview_request = Request::builder()
            .method("GET")
            .uri(format!(
                "/api/workspaces/{}/catalog/{}/schemas/runs/tables/workflow_runs/delete-preview",
                workspace.workspace.workspace_id, created.workflow.workflow_id
            ))
            .header("cookie", &cookie)
            .body(Body::empty())
            .expect("request builds");
        let preview_response = router
            .clone()
            .oneshot(preview_request)
            .await
            .expect("preview response");
        assert_eq!(preview_response.status(), StatusCode::OK);
        let preview_body = preview_response
            .into_body()
            .collect()
            .await
            .expect("body")
            .to_bytes();
        let preview: api_contract::WorkspaceCatalogDeleteTablePreviewResponse =
            serde_json::from_slice(&preview_body).expect("preview payload");
        assert!(!preview.is_deletable);
        assert!(preview
            .protected_reason
            .as_deref()
            .unwrap_or_default()
            .contains("system-managed"));

        let delete_request = Request::builder()
            .method("DELETE")
            .uri(format!(
                "/api/workspaces/{}/catalog/{}/schemas/runs/tables/workflow_runs",
                workspace.workspace.workspace_id, created.workflow.workflow_id
            ))
            .header("cookie", &cookie)
            .body(Body::empty())
            .expect("request builds");
        let delete_response = router
            .clone()
            .oneshot(delete_request)
            .await
            .expect("delete response");
        assert_eq!(delete_response.status(), StatusCode::BAD_REQUEST);
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
                serde_json::to_vec(&json!({ "name": "Run Ops" })).expect("workspace body"),
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

    #[tokio::test]
    async fn workspace_run_cancel_route_marks_run_cancelled() {
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
                serde_json::to_vec(&json!({ "name": "Run Ops Cancel" })).expect("workspace body"),
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
        if let Some(text_input) = workflow
            .nodes
            .iter_mut()
            .find(|node| node.node_id == "input_text")
        {
            text_input.config["execution"] = json!({
                "wait_before_seconds": 0.25
            });
        }

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
        let create_run_body = create_run_response
            .into_body()
            .collect()
            .await
            .expect("body")
            .to_bytes();
        let created_run: api_contract::CreateRunResponse =
            serde_json::from_slice(&create_run_body).expect("run payload");

        sleep(Duration::from_millis(40)).await;

        let cancel_run_request = Request::builder()
            .method("POST")
            .uri(format!(
                "/api/workspaces/{}/runs/{}/cancel",
                workspace.workspace.workspace_id, created_run.run_id
            ))
            .header("cookie", &cookie)
            .body(Body::empty())
            .expect("request builds");
        let cancel_run_response = router
            .clone()
            .oneshot(cancel_run_request)
            .await
            .expect("cancel response");
        assert_eq!(cancel_run_response.status(), StatusCode::OK);

        let mut run_detail = None;
        for _ in 0..30 {
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
            let get_run_body = get_run_response
                .into_body()
                .collect()
                .await
                .expect("body")
                .to_bytes();
            let run_response: api_contract::WorkspaceRunResponse =
                serde_json::from_slice(&get_run_body).expect("workspace run payload");

            if run_response.run.status == api_contract::RunStatus::Cancelled {
                run_detail = Some(run_response);
                break;
            }

            sleep(Duration::from_millis(20)).await;
        }

        let run_detail = run_detail.expect("run reaches cancelled state");
        assert_eq!(run_detail.run.status, api_contract::RunStatus::Cancelled);
        assert!(run_detail
            .run
            .error
            .as_ref()
            .is_some_and(|error| error.category == api_contract::RunErrorCategory::Cancellation));

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
            .oneshot(run_events_request)
            .await
            .expect("run events response");
        let run_events_body = run_events_response
            .into_body()
            .collect()
            .await
            .expect("body")
            .to_bytes();
        let run_events: api_contract::RunEventsResponse =
            serde_json::from_slice(&run_events_body).expect("run events payload");
        assert!(run_events.events.iter().any(|event| {
            event.event_type == api_contract::RunEventType::CancellationRequested
        }));
        assert!(run_events
            .events
            .iter()
            .any(|event| event.event_type == api_contract::RunEventType::RunCancelled));
    }

    #[tokio::test]
    async fn workspace_run_cancel_route_reconciles_stale_persisted_runs() {
        let platform = PlatformStore::for_tests().expect("platform store");
        let router = app(runtime_core::RuntimeService::default(), platform.clone());

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
                serde_json::to_vec(&json!({ "name": "Stale Run Ops" })).expect("workspace body"),
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

        let started_at = chrono::Utc::now() - chrono::Duration::hours(2);
        let stale_run = RunSnapshot {
            run_id: "run_stale_cancel".to_string(),
            workflow_id: persisted_workflow.workflow.workflow_id.clone(),
            workflow_version: persisted_workflow.workflow.version,
            status: RunStatus::Running,
            trigger: RunTrigger {
                kind: TriggerKind::Manual,
            },
            started_at: Some(started_at),
            finished_at: None,
            node_runs: vec![],
            logs: vec![],
            error: None,
        };

        platform
            .persist_run_snapshot(
                &workspace.workspace.workspace_id,
                Some("usr_builder"),
                &stale_run,
            )
            .expect("stale run persists");

        let cancel_run_request = Request::builder()
            .method("POST")
            .uri(format!(
                "/api/workspaces/{}/runs/{}/cancel",
                workspace.workspace.workspace_id, stale_run.run_id
            ))
            .header("cookie", &cookie)
            .body(Body::empty())
            .expect("request builds");
        let cancel_run_response = router
            .clone()
            .oneshot(cancel_run_request)
            .await
            .expect("cancel response");
        assert_eq!(cancel_run_response.status(), StatusCode::OK);

        let cancel_body = cancel_run_response
            .into_body()
            .collect()
            .await
            .expect("body")
            .to_bytes();
        let cancelled_run: api_contract::WorkspaceRunResponse =
            serde_json::from_slice(&cancel_body).expect("cancel payload");
        assert_eq!(cancelled_run.run.status, RunStatus::Cancelled);
        assert!(cancelled_run
            .run
            .error
            .as_ref()
            .is_some_and(|error| error.category == RunErrorCategory::Cancellation));

        let run_events = platform
            .list_workspace_run_events(
                "usr_builder",
                &workspace.workspace.workspace_id,
                &stale_run.run_id,
            )
            .expect("run events");
        assert!(run_events
            .iter()
            .any(|event| event.event_type == RunEventType::CancellationRequested));
        assert!(run_events
            .iter()
            .any(|event| event.event_type == RunEventType::RunCancelled));
    }
}
