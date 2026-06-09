use std::{
    collections::BTreeSet,
    env, fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex},
};

use anyhow::{anyhow, Context};
use api_contract::{
    AuthSessionResponse, DeleteWorkflowResponse, DeleteWorkspaceResponse, EventTargetKind,
    LogLevel, RunErrorCategory, RunEvent, RunEventType, RunLogEntry, RunSnapshot,
    SessionUserSummary, TriggerKind, WorkflowListResponse, WorkflowResponse, WorkflowStateResponse,
    WorkflowSummary, WorkspaceCatalogColumnSummary, WorkspaceCatalogDatabaseSummary,
    WorkspaceCatalogDeleteTablePreviewResponse, WorkspaceCatalogDeleteTableResponse,
    WorkspaceCatalogQueryColumn, WorkspaceCatalogQueryResponse, WorkspaceCatalogResponse,
    WorkspaceCatalogSchemaResponse, WorkspaceCatalogSchemaSummary, WorkspaceCatalogTableResponse,
    WorkspaceCatalogTableSummary, WorkspaceCatalogTableUsageNode,
    WorkspaceCatalogTableUsageWorkflow, WorkspaceConnectionSummary, WorkspaceConnectionsResponse,
    WorkspaceListResponse, WorkspaceMembershipRole, WorkspaceSummary,
};
use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use chrono::{Duration, Utc};
use duckdb::{Connection as DuckDbConnection, OptionalExt};
use rand_core::OsRng;
use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;
use workflow_schema::{DataType, TypedValue, WorkflowDefinition};

const DEMO_EMAIL: &str = "builder@stitchly.dev";
const DEMO_PASSWORD: &str = "stitchly";
const DEMO_DISPLAY_NAME: &str = "Builder";
const SESSION_TTL_DAYS: i64 = 30;

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
enum MirroredTableOutputWriteMode {
    Append,
    Replace,
}

#[derive(Clone, Debug, serde::Deserialize)]
struct MirroredTableReferencePayload {
    schema_name: String,
    table_name: String,
    #[serde(default)]
    selected_columns: Vec<String>,
    #[serde(default)]
    row_filter: Option<String>,
    #[serde(default)]
    row_limit: Option<u64>,
}

#[derive(Clone, Debug, serde::Deserialize)]
struct MirroredTableSchemaColumnPayload {
    name: String,
    #[serde(rename = "type")]
    column_type: String,
    #[serde(default)]
    nullable: Option<bool>,
    #[serde(default)]
    primary_key: Option<bool>,
    #[serde(default)]
    default: Option<String>,
}

#[derive(Clone, Debug, serde::Deserialize)]
struct MirroredTableSchemaDefinitionPayload {
    columns: Vec<MirroredTableSchemaColumnPayload>,
    #[serde(default)]
    primary_key: Vec<String>,
    #[serde(default)]
    checks: Vec<String>,
    #[serde(default, rename = "create_mode")]
    _create_mode: Option<String>,
    #[serde(default, rename = "if_target_exists")]
    _if_target_exists: Option<String>,
}

#[derive(Clone, Debug, serde::Deserialize)]
struct MirroredTableSchemaTargetPayload {
    #[serde(rename = "schema_name")]
    _schema_name: String,
    table_name: String,
    #[serde(default, rename = "output_alias")]
    _output_alias: Option<String>,
    columns: Vec<MirroredTableSchemaColumnPayload>,
    #[serde(default)]
    primary_key: Vec<String>,
    #[serde(default)]
    checks: Vec<String>,
    #[serde(default, rename = "create_mode")]
    _create_mode: Option<String>,
    #[serde(default, rename = "if_target_exists")]
    _if_target_exists: Option<String>,
}

#[derive(Clone, Debug, serde::Deserialize)]
struct MirroredTableOutputPayload {
    kind: String,
    target_schema: String,
    table_name: String,
    #[serde(default)]
    value_column: Option<String>,
    #[serde(default)]
    value_text: Option<String>,
    write_mode: MirroredTableOutputWriteMode,
    #[serde(default, rename = "input_shape")]
    _input_shape: Option<String>,
    #[serde(default)]
    source_table: Option<MirroredTableReferencePayload>,
    #[serde(default)]
    schema_definition: Option<MirroredTableSchemaDefinitionPayload>,
    #[serde(default)]
    schema_definitions: Option<Vec<MirroredTableSchemaTargetPayload>>,
    #[serde(default)]
    include_run_id: bool,
    #[serde(default)]
    include_written_at: bool,
}

#[derive(Clone, Debug)]
struct CatalogTableWorkflowUpdate {
    workflow_id: String,
    storage_owner_user_id: String,
    definition: WorkflowDefinition,
}

#[derive(Clone, Debug)]
struct CatalogTableDeletePlan {
    workflow_id: String,
    workflow_name: String,
    database_name: String,
    schema_name: String,
    table_name: String,
    is_deletable: bool,
    protected_reason: Option<String>,
    affected_workflows: Vec<WorkspaceCatalogTableUsageWorkflow>,
    workflow_updates: Vec<CatalogTableWorkflowUpdate>,
}

#[derive(Clone)]
pub struct PlatformStore {
    connection: Arc<Mutex<Connection>>,
    storage_root: Arc<PathBuf>,
}

#[derive(Clone, Debug)]
pub struct AuthenticatedSession {
    pub session_id: String,
    pub user_id: String,
    pub session: AuthSessionResponse,
}

#[derive(Clone, Debug)]
pub struct GoogleIdentityProfile {
    pub subject: String,
    pub email: String,
    pub email_verified: bool,
    pub display_name: String,
}

#[derive(Clone, Debug)]
pub struct GoogleConnectionTokens {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub token_type: Option<String>,
    pub scopes: Vec<String>,
    pub expires_at: Option<String>,
}

#[derive(Clone, Debug)]
pub struct WorkspaceGmailConnection {
    pub workspace_id: String,
    pub connection_id: String,
    pub display_name: String,
    pub send_as_email: String,
    pub external_account_id: String,
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub token_type: Option<String>,
    pub scopes: Vec<String>,
    pub expires_at: Option<String>,
}

impl PlatformStore {
    pub fn open(database_path: &str) -> anyhow::Result<Self> {
        if database_path != ":memory:" {
            ensure_parent_dir(database_path)?;
        }

        let storage_root = resolve_storage_root(database_path)?;
        fs::create_dir_all(&storage_root).with_context(|| {
            format!(
                "failed to create storage root at `{}`",
                storage_root.display()
            )
        })?;

        Self::open_with_storage_root(database_path, storage_root)
    }

    fn open_with_storage_root(database_path: &str, storage_root: PathBuf) -> anyhow::Result<Self> {
        if database_path != ":memory:" {
            ensure_parent_dir(database_path)?;
        }

        let connection = Connection::open(database_path)
            .with_context(|| format!("failed to open platform database at `{database_path}`"))?;

        let store = Self {
            connection: Arc::new(Mutex::new(connection)),
            storage_root: Arc::new(storage_root),
        };
        store.initialize()?;
        Ok(store)
    }

    pub fn for_tests() -> anyhow::Result<Self> {
        let storage_root = unique_test_storage_root();
        fs::create_dir_all(&storage_root).with_context(|| {
            format!(
                "failed to create test storage root at `{}`",
                storage_root.display()
            )
        })?;
        Self::open_with_storage_root(":memory:", storage_root)
    }

    pub fn authenticate(
        &self,
        email: &str,
        password: &str,
    ) -> anyhow::Result<Option<AuthenticatedSession>> {
        let connection = self.connection();
        let user = find_user_by_email(&connection, email)?;
        let Some(user) = user else {
            return Ok(None);
        };

        let parsed_hash = PasswordHash::new(&user.password_hash)
            .map_err(|error| anyhow!("stored password hash could not be parsed: {error}"))?;
        if Argon2::default()
            .verify_password(password.as_bytes(), &parsed_hash)
            .is_err()
        {
            return Ok(None);
        }

        let session_id = format!("ses_{}", Uuid::new_v4().simple());
        let created_at = Utc::now();
        let expires_at = created_at + Duration::days(SESSION_TTL_DAYS);

        connection.execute(
            "insert into sessions (session_id, user_id, created_at, expires_at)
             values (?1, ?2, ?3, ?4)",
            params![
                session_id,
                user.user_id,
                created_at.to_rfc3339(),
                expires_at.to_rfc3339()
            ],
        )?;

        let response = build_session_response(&connection, &user.user_id)?;
        Ok(Some(AuthenticatedSession {
            session_id,
            user_id: user.user_id,
            session: response,
        }))
    }

    pub fn load_session(&self, session_id: &str) -> anyhow::Result<Option<AuthenticatedSession>> {
        let connection = self.connection();

        let record = connection
            .query_row(
                "select session_id, user_id, expires_at
                 from sessions
                 where session_id = ?1",
                params![session_id],
                |row| {
                    Ok(SessionRecord {
                        session_id: row.get(0)?,
                        user_id: row.get(1)?,
                        expires_at: row.get(2)?,
                    })
                },
            )
            .optional()?;

        let Some(record) = record else {
            return Ok(None);
        };

        let expires_at = chrono::DateTime::parse_from_rfc3339(&record.expires_at)
            .context("stored session expiry is not valid RFC3339")?
            .with_timezone(&Utc);
        if expires_at <= Utc::now() {
            connection.execute(
                "delete from sessions where session_id = ?1",
                params![record.session_id],
            )?;
            return Ok(None);
        }

        let response = build_session_response(&connection, &record.user_id)?;
        Ok(Some(AuthenticatedSession {
            session_id: record.session_id,
            user_id: record.user_id,
            session: response,
        }))
    }

    pub fn delete_session(&self, session_id: &str) -> anyhow::Result<()> {
        let connection = self.connection();
        connection.execute(
            "delete from sessions where session_id = ?1",
            params![session_id],
        )?;
        Ok(())
    }

    pub fn authenticate_google_identity(
        &self,
        identity: &GoogleIdentityProfile,
    ) -> anyhow::Result<AuthenticatedSession> {
        let mut connection = self.connection();
        let tx = connection.transaction()?;
        let now = Utc::now().to_rfc3339();

        let existing_user_id: Option<String> = tx
            .query_row(
                "select user_id
                 from auth_identities
                 where provider = 'google' and provider_subject = ?1",
                params![identity.subject.as_str()],
                |row| row.get(0),
            )
            .optional()?;

        let user_id = if let Some(user_id) = existing_user_id {
            tx.execute(
                "update auth_identities
                 set email_at_link = ?1, email_verified = ?2, last_login_at = ?3
                 where provider = 'google' and provider_subject = ?4",
                params![
                    identity.email.as_str(),
                    i64::from(identity.email_verified),
                    now.as_str(),
                    identity.subject.as_str()
                ],
            )?;
            tx.execute(
                "update users
                 set email = ?1, display_name = ?2
                 where user_id = ?3",
                params![
                    identity.email.as_str(),
                    identity.display_name.as_str(),
                    user_id.as_str()
                ],
            )?;
            user_id
        } else if let Some(existing_user) = find_user_by_email(&tx, &identity.email)? {
            tx.execute(
                "insert into auth_identities (
                    provider,
                    provider_subject,
                    user_id,
                    email_at_link,
                    email_verified,
                    created_at,
                    last_login_at
                 ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    "google",
                    identity.subject.as_str(),
                    existing_user.user_id.as_str(),
                    identity.email.as_str(),
                    i64::from(identity.email_verified),
                    now.as_str(),
                    now.as_str()
                ],
            )?;
            tx.execute(
                "update users
                 set display_name = ?1
                 where user_id = ?2",
                params![
                    identity.display_name.as_str(),
                    existing_user.user_id.as_str()
                ],
            )?;
            existing_user.user_id
        } else {
            let user_id = format!("usr_{}", Uuid::new_v4().simple());
            let placeholder_password_hash =
                hash_password(&format!("google_only:{}", Uuid::new_v4().simple()))?;
            tx.execute(
                "insert into users (user_id, email, display_name, password_hash, active_workspace_id, created_at)
                 values (?1, ?2, ?3, ?4, null, ?5)",
                params![
                    user_id.as_str(),
                    identity.email.as_str(),
                    identity.display_name.as_str(),
                    placeholder_password_hash,
                    now.as_str()
                ],
            )?;
            tx.execute(
                "insert into auth_identities (
                    provider,
                    provider_subject,
                    user_id,
                    email_at_link,
                    email_verified,
                    created_at,
                    last_login_at
                 ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    "google",
                    identity.subject.as_str(),
                    user_id.as_str(),
                    identity.email.as_str(),
                    i64::from(identity.email_verified),
                    now.as_str(),
                    now.as_str()
                ],
            )?;
            user_id
        };

        let session_id = create_session_record(&tx, &user_id)?;
        let response = build_session_response(&tx, &user_id)?;
        tx.commit()?;

        Ok(AuthenticatedSession {
            session_id,
            user_id,
            session: response,
        })
    }

    pub fn list_workspaces(&self, user_id: &str) -> anyhow::Result<WorkspaceListResponse> {
        let connection = self.connection();
        let session = build_session_response(&connection, user_id)?;
        Ok(WorkspaceListResponse {
            workspaces: session.workspaces,
            active_workspace_id: session.active_workspace_id,
        })
    }

    pub fn create_workspace(&self, user_id: &str, name: &str) -> anyhow::Result<WorkspaceSummary> {
        let trimmed_name = name.trim();
        if trimmed_name.is_empty() {
            return Err(anyhow!("workspace name cannot be empty"));
        }

        let mut connection = self.connection();
        let tx = connection.transaction()?;

        let slug = unique_slug(&tx, trimmed_name)?;
        let workspace_id = format!("ws_{}", Uuid::new_v4().simple());
        let now = Utc::now().to_rfc3339();
        tx.execute(
            "insert into workspaces (workspace_id, slug, name, created_at, updated_at)
             values (?1, ?2, ?3, ?4, ?5)",
            params![workspace_id, slug, trimmed_name, now, now],
        )?;
        tx.execute(
            "insert into workspace_memberships (workspace_id, user_id, role, created_at)
             values (?1, ?2, ?3, ?4)",
            params![
                workspace_id,
                user_id,
                role_to_db(WorkspaceMembershipRole::Owner),
                now
            ],
        )?;

        let active_workspace_id: Option<String> = tx
            .query_row(
                "select active_workspace_id from users where user_id = ?1",
                params![user_id],
                |row| row.get(0),
            )
            .optional()?
            .flatten();
        if active_workspace_id.is_none() {
            tx.execute(
                "update users set active_workspace_id = ?1 where user_id = ?2",
                params![workspace_id, user_id],
            )?;
        }

        tx.commit()?;

        let role = connection.query_row(
            "select w.workspace_id, w.slug, w.name, m.role
             from workspaces w
             join workspace_memberships m on m.workspace_id = w.workspace_id
             where w.workspace_id = ?1 and m.user_id = ?2",
            params![workspace_id, user_id],
            |row| {
                Ok(WorkspaceSummary {
                    workspace_id: row.get(0)?,
                    slug: row.get(1)?,
                    name: row.get(2)?,
                    role: role_from_db(&row.get::<_, String>(3)?)?,
                })
            },
        )?;

        Ok(role)
    }

    pub fn get_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
    ) -> anyhow::Result<Option<WorkspaceSummary>> {
        let connection = self.connection();
        connection
            .query_row(
                "select w.workspace_id, w.slug, w.name, m.role
                 from workspaces w
                 join workspace_memberships m on m.workspace_id = w.workspace_id
                 where w.workspace_id = ?1 and m.user_id = ?2",
                params![workspace_id, user_id],
                |row| {
                    Ok(WorkspaceSummary {
                        workspace_id: row.get(0)?,
                        slug: row.get(1)?,
                        name: row.get(2)?,
                        role: role_from_db(&row.get::<_, String>(3)?)?,
                    })
                },
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn delete_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
    ) -> anyhow::Result<Option<DeleteWorkspaceResponse>> {
        let mut connection = self.connection();

        let workspace: Option<WorkspaceSummary> = connection
            .query_row(
                "select w.workspace_id, w.slug, w.name, m.role
                 from workspaces w
                 join workspace_memberships m on m.workspace_id = w.workspace_id
                 where w.workspace_id = ?1 and m.user_id = ?2",
                params![workspace_id, user_id],
                |row| {
                    Ok(WorkspaceSummary {
                        workspace_id: row.get(0)?,
                        slug: row.get(1)?,
                        name: row.get(2)?,
                        role: role_from_db(&row.get::<_, String>(3)?)?,
                    })
                },
            )
            .optional()?;

        let Some(workspace) = workspace else {
            return Ok(None);
        };

        ensure_workspace_owner(&workspace, workspace_id)?;

        let workflow_ids = {
            let mut stmt = connection.prepare(
                "select workflow_id
                 from workflows
                 where workspace_id = ?1",
            )?;
            let workflow_ids = stmt
                .query_map(params![workspace_id], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            workflow_ids
        };

        let mut storage_owner_user_ids = BTreeSet::new();
        for workflow_id in workflow_ids {
            let storage_owner_user_id =
                lookup_workflow_storage_owner_user_id(&connection, workspace_id, &workflow_id)?;
            storage_owner_user_ids.insert(storage_owner_user_id);
        }

        let tx = connection.transaction()?;
        tx.execute(
            "update users
             set active_workspace_id = null
             where active_workspace_id = ?1",
            params![workspace_id],
        )?;
        tx.execute(
            "delete from workspaces
             where workspace_id = ?1",
            params![workspace_id],
        )?;
        tx.commit()?;

        drop(connection);

        for storage_owner_user_id in storage_owner_user_ids {
            let workspace_root = self.workspace_root_path(&storage_owner_user_id, workspace_id);
            if let Err(error) = fs::remove_dir_all(&workspace_root) {
                if error.kind() != std::io::ErrorKind::NotFound {
                    eprintln!(
                        "failed to remove workspace storage at `{}`: {error}",
                        workspace_root.display()
                    );
                }
            }
        }

        Ok(Some(DeleteWorkspaceResponse {
            workspace_id: workspace.workspace_id,
            deleted: true,
        }))
    }

    pub fn list_workspace_connections(
        &self,
        user_id: &str,
        workspace_id: &str,
    ) -> anyhow::Result<WorkspaceConnectionsResponse> {
        let connection = self.connection();
        ensure_workspace_access(&connection, user_id, workspace_id)?;

        let mut stmt = connection.prepare(
            "select
                workspace_id,
                connection_id,
                connection_kind,
                display_name,
                comment,
                auth_scheme,
                status,
                external_account_label,
                external_account_id,
                capabilities_json,
                scopes_json,
                created_at,
                updated_at,
                last_error_message
             from workspace_connections
             where workspace_id = ?1
               and archived_at is null
             order by created_at desc, display_name asc",
        )?;
        let connections = stmt
            .query_map(params![workspace_id], |row| {
                let capabilities_json: String = row.get(9)?;
                let scopes_json: String = row.get(10)?;
                Ok(WorkspaceConnectionSummary {
                    workspace_id: row.get(0)?,
                    connection_id: row.get(1)?,
                    connection_kind: row.get(2)?,
                    display_name: row.get(3)?,
                    comment: row.get(4)?,
                    auth_scheme: row.get(5)?,
                    status: row.get(6)?,
                    external_account_label: row.get(7)?,
                    external_account_id: row.get(8)?,
                    capabilities: serde_json::from_str(&capabilities_json).map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            9,
                            rusqlite::types::Type::Text,
                            Box::new(error),
                        )
                    })?,
                    scopes: serde_json::from_str(&scopes_json).map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            10,
                            rusqlite::types::Type::Text,
                            Box::new(error),
                        )
                    })?,
                    created_at: row.get(11)?,
                    updated_at: row.get(12)?,
                    last_error_message: row.get(13)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(WorkspaceConnectionsResponse { connections })
    }

    pub fn upsert_gmail_connection(
        &self,
        user_id: &str,
        workspace_id: &str,
        identity: &GoogleIdentityProfile,
        tokens: &GoogleConnectionTokens,
    ) -> anyhow::Result<WorkspaceConnectionSummary> {
        let mut connection = self.connection();
        ensure_workspace_access(&connection, user_id, workspace_id)?;

        let tx = connection.transaction()?;
        let now = Utc::now().to_rfc3339();
        let existing_connection: Option<(String, String, String)> = tx
            .query_row(
                "select connection_id, created_at, coalesce(
                    (select refresh_token
                     from workspace_connection_oauth_tokens
                     where workspace_id = workspace_connections.workspace_id
                       and connection_id = workspace_connections.connection_id),
                    ''
                 )
                 from workspace_connections
                 where workspace_id = ?1
                   and connection_kind = 'gmail'
                   and external_account_id = ?2
                   and archived_at is null",
                params![workspace_id, identity.subject.as_str()],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()?;

        let (connection_id, created_at, existing_refresh_token) = existing_connection
            .unwrap_or_else(|| {
                (
                    format!("conn_{}", Uuid::new_v4().simple()),
                    now.clone(),
                    String::new(),
                )
            });

        let granted_scopes = if tokens.scopes.is_empty() {
            vec![
                "openid".to_string(),
                "email".to_string(),
                "profile".to_string(),
                "https://www.googleapis.com/auth/gmail.send".to_string(),
            ]
        } else {
            tokens.scopes.clone()
        };

        let display_name = format!("Gmail · {}", identity.email);
        let config_json = serde_json::json!({
            "provider": "google",
            "send_as_email": identity.email
        });
        let capabilities_json = serde_json::json!({
            "send_email": true
        });
        let scopes_json = serde_json::to_string(&granted_scopes)?;

        tx.execute(
            "insert into workspace_connections (
                workspace_id,
                connection_id,
                connection_kind,
                display_name,
                comment,
                auth_scheme,
                status,
                external_account_label,
                external_account_id,
                config_json,
                secret_refs_json,
                scopes_json,
                capabilities_json,
                created_by_user_id,
                created_at,
                updated_at,
                last_validated_at,
                last_used_at,
                last_error_code,
                last_error_message,
                archived_at
             ) values (
                ?1, ?2, 'gmail', ?3, ?4, 'oauth2', 'active', ?5, ?6, ?7, '{}', ?8, ?9, ?10, ?11, ?12, ?13, null, null, null, null
             )
             on conflict(workspace_id, connection_id) do update set
                connection_kind = excluded.connection_kind,
                display_name = excluded.display_name,
                comment = excluded.comment,
                auth_scheme = excluded.auth_scheme,
                status = excluded.status,
                external_account_label = excluded.external_account_label,
                external_account_id = excluded.external_account_id,
                config_json = excluded.config_json,
                scopes_json = excluded.scopes_json,
                capabilities_json = excluded.capabilities_json,
                updated_at = excluded.updated_at,
                last_validated_at = excluded.last_validated_at,
                last_error_code = null,
                last_error_message = null,
                archived_at = null",
            params![
                workspace_id,
                connection_id.as_str(),
                display_name.as_str(),
                "Authorized Gmail sender",
                identity.email.as_str(),
                identity.subject.as_str(),
                serde_json::to_string(&config_json)?,
                scopes_json.as_str(),
                serde_json::to_string(&capabilities_json)?,
                user_id,
                created_at.as_str(),
                now.as_str(),
                now.as_str()
            ],
        )?;

        let refresh_token = tokens
            .refresh_token
            .clone()
            .filter(|value| !value.trim().is_empty())
            .or_else(|| {
                let trimmed = existing_refresh_token.trim();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed.to_string())
                }
            });

        tx.execute(
            "insert into workspace_connection_oauth_tokens (
                workspace_id,
                connection_id,
                provider,
                access_token,
                refresh_token,
                token_type,
                scopes_json,
                expires_at,
                created_at,
                updated_at
             ) values (?1, ?2, 'google', ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             on conflict(workspace_id, connection_id) do update set
                provider = excluded.provider,
                access_token = excluded.access_token,
                refresh_token = coalesce(excluded.refresh_token, workspace_connection_oauth_tokens.refresh_token),
                token_type = excluded.token_type,
                scopes_json = excluded.scopes_json,
                expires_at = excluded.expires_at,
                updated_at = excluded.updated_at",
            params![
                workspace_id,
                connection_id.as_str(),
                tokens.access_token.as_str(),
                refresh_token.as_deref(),
                tokens.token_type.as_deref(),
                scopes_json.as_str(),
                tokens.expires_at.as_deref(),
                created_at.as_str(),
                now.as_str()
            ],
        )?;

        let summary =
            workspace_connection_summary_by_id(&tx, workspace_id, connection_id.as_str())?
                .ok_or_else(|| anyhow!("workspace connection `{connection_id}` was not found"))?;
        tx.commit()?;

        Ok(summary)
    }

    pub fn get_workspace_gmail_connection(
        &self,
        user_id: &str,
        workspace_id: &str,
        connection_id: &str,
    ) -> anyhow::Result<Option<WorkspaceGmailConnection>> {
        let connection = self.connection();
        ensure_workspace_access(&connection, user_id, workspace_id)?;

        connection
            .query_row(
                "select
                    wc.workspace_id,
                    wc.connection_id,
                    wc.display_name,
                    wc.external_account_label,
                    wc.external_account_id,
                    wc.config_json,
                    tokens.access_token,
                    tokens.refresh_token,
                    tokens.token_type,
                    tokens.scopes_json,
                    tokens.expires_at
                 from workspace_connections wc
                 left join workspace_connection_oauth_tokens tokens
                   on tokens.workspace_id = wc.workspace_id
                  and tokens.connection_id = wc.connection_id
                 where wc.workspace_id = ?1
                   and wc.connection_id = ?2
                   and wc.connection_kind = 'gmail'
                   and wc.status = 'active'
                   and wc.archived_at is null",
                params![workspace_id, connection_id],
                |row| {
                    let config_json: String = row.get(5)?;
                    let scopes_json: String = row.get(9)?;
                    let config_value = serde_json::from_str::<serde_json::Value>(&config_json)
                        .map_err(|error| {
                            rusqlite::Error::FromSqlConversionFailure(
                                5,
                                rusqlite::types::Type::Text,
                                Box::new(error),
                            )
                        })?;
                    let send_as_email = config_value
                        .get("send_as_email")
                        .and_then(serde_json::Value::as_str)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(ToString::to_string)
                        .or_else(|| row.get::<_, Option<String>>(3).ok().flatten())
                        .ok_or_else(|| {
                            rusqlite::Error::InvalidColumnType(
                                3,
                                "external_account_label".to_string(),
                                rusqlite::types::Type::Null,
                            )
                        })?;

                    Ok(WorkspaceGmailConnection {
                        workspace_id: row.get(0)?,
                        connection_id: row.get(1)?,
                        display_name: row.get(2)?,
                        send_as_email,
                        external_account_id: row.get(4)?,
                        access_token: row.get(6)?,
                        refresh_token: row.get(7)?,
                        token_type: row.get(8)?,
                        scopes: serde_json::from_str(&scopes_json).map_err(|error| {
                            rusqlite::Error::FromSqlConversionFailure(
                                9,
                                rusqlite::types::Type::Text,
                                Box::new(error),
                            )
                        })?,
                        expires_at: row.get(10)?,
                    })
                },
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn list_workflows(
        &self,
        user_id: &str,
        workspace_id: &str,
    ) -> anyhow::Result<WorkflowListResponse> {
        let connection = self.connection();
        ensure_workspace_access(&connection, user_id, workspace_id)?;

        let mut stmt = connection.prepare(
            "select workflow_id, workspace_id, name, description, current_version, updated_at
             from workflows
             where workspace_id = ?1
               and archived_at is null
             order by updated_at desc, name asc",
        )?;
        let workflows = stmt
            .query_map(params![workspace_id], |row| {
                Ok(WorkflowSummary {
                    workflow_id: row.get(0)?,
                    workspace_id: row.get(1)?,
                    name: row.get(2)?,
                    description: row.get(3)?,
                    version: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(WorkflowListResponse { workflows })
    }

    pub fn list_workspace_catalogs(
        &self,
        user_id: &str,
        workspace_id: &str,
    ) -> anyhow::Result<WorkspaceCatalogResponse> {
        let connection = self.connection();
        ensure_workspace_access(&connection, user_id, workspace_id)?;

        let workflows = list_catalog_workflows(&connection, workspace_id)?;
        let mut catalogs = Vec::with_capacity(workflows.len());

        for workflow in workflows {
            let storage_owner_user_id =
                resolve_catalog_workflow_owner_user_id(&connection, workspace_id, &workflow)?;
            let duckdb_path = self
                .workflow_root_path(
                    storage_owner_user_id.as_str(),
                    workspace_id,
                    workflow.workflow_id.as_str(),
                )
                .join("db")
                .join("workflow.duckdb");
            let duckdb = open_catalog_duckdb(&duckdb_path)?;
            let schemas = load_workspace_catalog_summaries(&duckdb)?;

            catalogs.push(WorkspaceCatalogDatabaseSummary {
                workflow_id: workflow.workflow_id,
                workflow_name: workflow.workflow_name,
                database_name: "workflow.duckdb".to_string(),
                schemas,
            });
        }

        Ok(WorkspaceCatalogResponse { catalogs })
    }

    pub fn get_workspace_catalog_schema(
        &self,
        user_id: &str,
        workspace_id: &str,
        workflow_id: &str,
        schema_name: &str,
    ) -> anyhow::Result<Option<WorkspaceCatalogSchemaResponse>> {
        let connection = self.connection();
        ensure_workspace_access(&connection, user_id, workspace_id)?;

        let Some(workflow) = find_catalog_workflow(&connection, workspace_id, workflow_id)? else {
            return Ok(None);
        };
        let storage_owner_user_id =
            resolve_catalog_workflow_owner_user_id(&connection, workspace_id, &workflow)?;
        let duckdb_path = self
            .workflow_root_path(
                storage_owner_user_id.as_str(),
                workspace_id,
                workflow.workflow_id.as_str(),
            )
            .join("db")
            .join("workflow.duckdb");
        let duckdb = open_catalog_duckdb(&duckdb_path)?;
        if !workspace_catalog_schema_exists(&duckdb, schema_name)? {
            return Ok(None);
        }

        let tables = load_workspace_catalog_table_summaries(&duckdb, schema_name)?;
        Ok(Some(WorkspaceCatalogSchemaResponse {
            workflow_id: workflow.workflow_id,
            workflow_name: workflow.workflow_name,
            database_name: "workflow.duckdb".to_string(),
            schema_name: schema_name.to_string(),
            tables,
        }))
    }

    pub fn get_workspace_catalog_table(
        &self,
        user_id: &str,
        workspace_id: &str,
        workflow_id: &str,
        schema_name: &str,
        table_name: &str,
    ) -> anyhow::Result<Option<WorkspaceCatalogTableResponse>> {
        let connection = self.connection();
        ensure_workspace_access(&connection, user_id, workspace_id)?;

        let Some(workflow) = find_catalog_workflow(&connection, workspace_id, workflow_id)? else {
            return Ok(None);
        };
        let storage_owner_user_id =
            resolve_catalog_workflow_owner_user_id(&connection, workspace_id, &workflow)?;
        let duckdb_path = self
            .workflow_root_path(
                storage_owner_user_id.as_str(),
                workspace_id,
                workflow.workflow_id.as_str(),
            )
            .join("db")
            .join("workflow.duckdb");
        let duckdb = open_catalog_duckdb(&duckdb_path)?;
        if !workspace_catalog_table_exists(&duckdb, schema_name, table_name)? {
            return Ok(None);
        }

        let columns = load_workspace_catalog_columns(&duckdb, schema_name, table_name)?;
        // Sample row materialization currently trips a native DuckDB assertion on some
        // live workspace files, so keep table exploration metadata-only for now.
        let sample_rows = Vec::new();
        let protected_reason = protected_workspace_catalog_table_reason(schema_name, table_name);

        Ok(Some(WorkspaceCatalogTableResponse {
            workflow_id: workflow.workflow_id,
            workflow_name: workflow.workflow_name,
            database_name: "workflow.duckdb".to_string(),
            schema_name: schema_name.to_string(),
            table_name: table_name.to_string(),
            is_deletable: protected_reason.is_none(),
            protected_reason,
            columns,
            sample_rows,
        }))
    }

    pub fn preview_workspace_catalog_table_delete(
        &self,
        user_id: &str,
        workspace_id: &str,
        workflow_id: &str,
        schema_name: &str,
        table_name: &str,
    ) -> anyhow::Result<Option<WorkspaceCatalogDeleteTablePreviewResponse>> {
        let connection = self.connection();
        ensure_workspace_access(&connection, user_id, workspace_id)?;

        let Some(workflow) = find_catalog_workflow(&connection, workspace_id, workflow_id)? else {
            return Ok(None);
        };
        let storage_owner_user_id =
            resolve_catalog_workflow_owner_user_id(&connection, workspace_id, &workflow)?;
        let duckdb_path = self
            .workflow_root_path(
                storage_owner_user_id.as_str(),
                workspace_id,
                workflow.workflow_id.as_str(),
            )
            .join("db")
            .join("workflow.duckdb");
        let duckdb = open_catalog_duckdb(&duckdb_path)?;
        if !workspace_catalog_table_exists(&duckdb, schema_name, table_name)? {
            return Ok(None);
        }

        let plan = build_catalog_table_delete_plan(
            &connection,
            workspace_id,
            &workflow,
            schema_name,
            table_name,
        )?;

        Ok(Some(WorkspaceCatalogDeleteTablePreviewResponse {
            workflow_id: plan.workflow_id,
            workflow_name: plan.workflow_name,
            database_name: plan.database_name,
            schema_name: plan.schema_name,
            table_name: plan.table_name,
            is_deletable: plan.is_deletable,
            protected_reason: plan.protected_reason,
            affected_workflows: plan.affected_workflows,
        }))
    }

    pub fn delete_workspace_catalog_table(
        &self,
        user_id: &str,
        workspace_id: &str,
        workflow_id: &str,
        schema_name: &str,
        table_name: &str,
    ) -> anyhow::Result<Option<WorkspaceCatalogDeleteTableResponse>> {
        let mut connection = self.connection();
        ensure_workspace_access(&connection, user_id, workspace_id)?;

        let Some(workflow) = find_catalog_workflow(&connection, workspace_id, workflow_id)? else {
            return Ok(None);
        };
        let storage_owner_user_id =
            resolve_catalog_workflow_owner_user_id(&connection, workspace_id, &workflow)?;
        let duckdb_path = self
            .workflow_root_path(
                storage_owner_user_id.as_str(),
                workspace_id,
                workflow.workflow_id.as_str(),
            )
            .join("db")
            .join("workflow.duckdb");
        let duckdb = open_catalog_duckdb(&duckdb_path)?;
        if !workspace_catalog_table_exists(&duckdb, schema_name, table_name)? {
            return Ok(None);
        }

        let plan = build_catalog_table_delete_plan(
            &connection,
            workspace_id,
            &workflow,
            schema_name,
            table_name,
        )?;
        if !plan.is_deletable {
            let reason = plan
                .protected_reason
                .unwrap_or_else(|| "This table cannot be deleted.".to_string());
            return Err(anyhow!(reason));
        }

        duckdb.execute_batch(
            format!(
                "drop table {}.{}",
                quote_duckdb_identifier(schema_name.trim()),
                quote_duckdb_identifier(table_name.trim())
            )
            .as_str(),
        )?;
        drop(duckdb);

        if !plan.workflow_updates.is_empty() {
            persist_catalog_table_workflow_updates(
                &mut connection,
                workspace_id,
                plan.workflow_updates.as_slice(),
            )?;
            for workflow_update in &plan.workflow_updates {
                let owner_user_id = workflow_update
                    .storage_owner_user_id
                    .as_str()
                    .trim()
                    .is_empty()
                    .then_some(storage_owner_user_id.as_str())
                    .unwrap_or(workflow_update.storage_owner_user_id.as_str());
                self.bootstrap_workflow_storage(
                    owner_user_id,
                    workspace_id,
                    &workflow_update.definition,
                )?;
            }
        }

        Ok(Some(WorkspaceCatalogDeleteTableResponse {
            workflow_id: plan.workflow_id,
            workflow_name: plan.workflow_name,
            database_name: plan.database_name,
            schema_name: plan.schema_name,
            table_name: plan.table_name,
            deleted: true,
            invalidated_workflows: plan.affected_workflows,
        }))
    }

    pub fn run_workspace_catalog_query(
        &self,
        user_id: &str,
        workspace_id: &str,
        workflow_id: &str,
        query: &str,
    ) -> anyhow::Result<Option<WorkspaceCatalogQueryResponse>> {
        let connection = self.connection();
        ensure_workspace_access(&connection, user_id, workspace_id)?;

        let Some(workflow) = find_catalog_workflow(&connection, workspace_id, workflow_id)? else {
            return Ok(None);
        };
        let storage_owner_user_id =
            resolve_catalog_workflow_owner_user_id(&connection, workspace_id, &workflow)?;
        let duckdb_path = self
            .workflow_root_path(
                storage_owner_user_id.as_str(),
                workspace_id,
                workflow.workflow_id.as_str(),
            )
            .join("db")
            .join("workflow.duckdb");
        initialize_workflow_duckdb(&duckdb_path)?;

        let normalized_query = normalize_workspace_catalog_query(query)?;
        let columns = describe_workspace_catalog_query(&duckdb_path, &normalized_query)?;
        let rows = execute_workspace_catalog_query_rows(&duckdb_path, &normalized_query, &columns)?;

        Ok(Some(WorkspaceCatalogQueryResponse {
            workflow_id: workflow.workflow_id,
            workflow_name: workflow.workflow_name,
            database_name: "workflow.duckdb".to_string(),
            query: normalized_query,
            columns,
            rows,
        }))
    }

    pub fn get_workflow(
        &self,
        user_id: &str,
        workspace_id: &str,
        workflow_id: &str,
    ) -> anyhow::Result<Option<WorkflowResponse>> {
        let connection = self.connection();
        ensure_workspace_access(&connection, user_id, workspace_id)?;

        let row = connection
            .query_row(
                "select w.workflow_id, w.workspace_id, w.name, w.description, w.current_version, w.updated_at, v.definition_json
                 from workflows w
                 join workflow_versions v
                   on v.workspace_id = w.workspace_id
                  and v.workflow_id = w.workflow_id
                  and v.version = w.current_version
                 where w.workspace_id = ?1 and w.workflow_id = ?2
                   and w.archived_at is null",
                params![workspace_id, workflow_id],
                |row| {
                    Ok((
                        WorkflowSummary {
                            workflow_id: row.get(0)?,
                            workspace_id: row.get(1)?,
                            name: row.get(2)?,
                            description: row.get(3)?,
                            version: row.get(4)?,
                            updated_at: row.get(5)?,
                        },
                        row.get::<_, String>(6)?,
                    ))
                },
            )
            .optional()?;

        let Some((workflow, definition_json)) = row else {
            return Ok(None);
        };

        let definition: WorkflowDefinition = serde_json::from_str(&definition_json)
            .context("stored workflow definition is not valid JSON")?;

        Ok(Some(WorkflowResponse {
            workflow,
            definition,
        }))
    }

    pub fn create_workflow(
        &self,
        user_id: &str,
        workspace_id: &str,
        workflow: &WorkflowDefinition,
    ) -> anyhow::Result<WorkflowResponse> {
        let connection = self.connection();
        ensure_workspace_access(&connection, user_id, workspace_id)?;

        let stored_workflow = normalize_workflow_definition(
            workflow,
            &workflow.workflow_id,
            workflow.version.max(1),
        )?;
        let existing: Option<String> = connection
            .query_row(
                "select workflow_id
                 from workflows
                 where workspace_id = ?1 and workflow_id = ?2",
                params![workspace_id, stored_workflow.workflow_id.as_str()],
                |row| row.get(0),
            )
            .optional()?;
        if existing.is_some() {
            return Err(anyhow!(
                "workflow `{}` already exists in workspace `{workspace_id}`",
                stored_workflow.workflow_id
            ));
        }

        let now = Utc::now().to_rfc3339();
        let definition_json = serde_json::to_string(&stored_workflow)
            .context("failed to serialize workflow definition")?;
        let workflow_root =
            self.workflow_root_path(user_id, workspace_id, stored_workflow.workflow_id.as_str());

        let mut connection = connection;
        let tx = connection.transaction()?;
        tx.execute(
            "insert into workflows (
                workspace_id,
                workflow_id,
                name,
                description,
                current_version,
                storage_owner_user_id,
                created_at,
                updated_at
             )
             values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                workspace_id,
                stored_workflow.workflow_id.as_str(),
                stored_workflow.name.as_str(),
                stored_workflow.description.as_deref(),
                stored_workflow.version,
                user_id,
                now,
                now
            ],
        )?;
        tx.execute(
            "insert into workflow_versions (workspace_id, workflow_id, version, definition_json, created_at)
             values (?1, ?2, ?3, ?4, ?5)",
            params![
                workspace_id,
                stored_workflow.workflow_id.as_str(),
                stored_workflow.version,
                definition_json,
                now
            ],
        )?;
        self.bootstrap_workflow_storage(user_id, workspace_id, &stored_workflow)?;
        if let Err(error) = tx.commit() {
            let _ = fs::remove_dir_all(&workflow_root);
            return Err(error.into());
        }

        let workflow = workflow_summary(workspace_id, &stored_workflow);
        Ok(WorkflowResponse {
            workflow,
            definition: stored_workflow,
        })
    }

    pub fn update_workflow(
        &self,
        user_id: &str,
        workspace_id: &str,
        workflow_id: &str,
        workflow: &WorkflowDefinition,
    ) -> anyhow::Result<Option<WorkflowResponse>> {
        let connection = self.connection();
        ensure_workspace_access(&connection, user_id, workspace_id)?;

        let current_version: Option<u32> = connection
            .query_row(
                "select current_version
                 from workflows
                 where workspace_id = ?1 and workflow_id = ?2
                   and archived_at is null",
                params![workspace_id, workflow_id],
                |row| row.get(0),
            )
            .optional()?;
        let Some(current_version) = current_version else {
            return Ok(None);
        };

        let next_version = current_version.saturating_add(1);
        let stored_workflow = normalize_workflow_definition(workflow, workflow_id, next_version)?;
        let now = Utc::now().to_rfc3339();
        let definition_json = serde_json::to_string(&stored_workflow)
            .context("failed to serialize workflow definition")?;

        let mut connection = connection;
        let tx = connection.transaction()?;
        tx.execute(
            "update workflows
             set name = ?3,
                 description = ?4,
                 current_version = ?5,
                 updated_at = ?6
             where workspace_id = ?1 and workflow_id = ?2",
            params![
                workspace_id,
                workflow_id,
                stored_workflow.name.as_str(),
                stored_workflow.description.as_deref(),
                stored_workflow.version,
                now
            ],
        )?;
        tx.execute(
            "insert into workflow_versions (workspace_id, workflow_id, version, definition_json, created_at)
             values (?1, ?2, ?3, ?4, ?5)",
            params![workspace_id, workflow_id, stored_workflow.version, definition_json, now],
        )?;
        tx.commit()?;
        self.bootstrap_workflow_storage(user_id, workspace_id, &stored_workflow)?;

        let workflow = workflow_summary(workspace_id, &stored_workflow);
        Ok(Some(WorkflowResponse {
            workflow,
            definition: stored_workflow,
        }))
    }

    pub fn archive_workflow(
        &self,
        user_id: &str,
        workspace_id: &str,
        workflow_id: &str,
    ) -> anyhow::Result<Option<DeleteWorkflowResponse>> {
        let mut connection = self.connection();
        ensure_workspace_access(&connection, user_id, workspace_id)?;

        let workflow_exists: Option<String> = connection
            .query_row(
                "select workflow_id
                 from workflows
                 where workspace_id = ?1 and workflow_id = ?2
                   and archived_at is null",
                params![workspace_id, workflow_id],
                |row| row.get(0),
            )
            .optional()?;
        let Some(workflow_id) = workflow_exists else {
            return Ok(None);
        };

        let now = Utc::now().to_rfc3339();
        let tx = connection.transaction()?;
        tx.execute(
            "update workflows
             set archived_at = ?3,
                 updated_at = ?3
             where workspace_id = ?1 and workflow_id = ?2",
            params![workspace_id, workflow_id, now],
        )?;
        tx.execute(
            "update user_workspace_state
             set last_opened_workflow_id = null,
                 updated_at = ?2
             where workspace_id = ?1 and last_opened_workflow_id = ?3",
            params![workspace_id, now, workflow_id],
        )?;
        tx.commit()?;

        Ok(Some(DeleteWorkflowResponse {
            workflow_id,
            archived: true,
        }))
    }

    pub fn get_workflow_state(
        &self,
        user_id: &str,
        workspace_id: &str,
    ) -> anyhow::Result<WorkflowStateResponse> {
        let connection = self.connection();
        ensure_workspace_access(&connection, user_id, workspace_id)?;

        let last_opened_workflow_id: Option<String> = connection
            .query_row(
                "select last_opened_workflow_id
                 from user_workspace_state
                 where workspace_id = ?1 and user_id = ?2",
                params![workspace_id, user_id],
                |row| row.get(0),
            )
            .optional()?
            .flatten();

        let Some(last_opened_workflow_id) = last_opened_workflow_id else {
            return Ok(WorkflowStateResponse::default());
        };

        let is_active: Option<String> = connection
            .query_row(
                "select workflow_id
                 from workflows
                 where workspace_id = ?1 and workflow_id = ?2
                   and archived_at is null",
                params![workspace_id, last_opened_workflow_id],
                |row| row.get(0),
            )
            .optional()?;

        Ok(WorkflowStateResponse {
            last_opened_workflow_id: is_active,
        })
    }

    pub fn update_workflow_state(
        &self,
        user_id: &str,
        workspace_id: &str,
        last_opened_workflow_id: Option<&str>,
    ) -> anyhow::Result<WorkflowStateResponse> {
        let connection = self.connection();
        ensure_workspace_access(&connection, user_id, workspace_id)?;

        if let Some(workflow_id) = last_opened_workflow_id {
            let workflow_exists: Option<String> = connection
                .query_row(
                    "select workflow_id
                     from workflows
                     where workspace_id = ?1 and workflow_id = ?2
                       and archived_at is null",
                    params![workspace_id, workflow_id],
                    |row| row.get(0),
                )
                .optional()?;
            if workflow_exists.is_none() {
                return Err(anyhow!(
                    "workflow `{workflow_id}` was not found in workspace `{workspace_id}`"
                ));
            }
        }

        let now = Utc::now().to_rfc3339();
        connection.execute(
            "insert into user_workspace_state (
                workspace_id,
                user_id,
                last_opened_workflow_id,
                created_at,
                updated_at
             )
             values (?1, ?2, ?3, ?4, ?4)
             on conflict(workspace_id, user_id) do update set
                last_opened_workflow_id = excluded.last_opened_workflow_id,
                updated_at = excluded.updated_at",
            params![workspace_id, user_id, last_opened_workflow_id, now],
        )?;

        Ok(WorkflowStateResponse {
            last_opened_workflow_id: last_opened_workflow_id.map(str::to_string),
        })
    }

    pub fn save_run_snapshot(
        &self,
        user_id: &str,
        workspace_id: &str,
        snapshot: &RunSnapshot,
    ) -> anyhow::Result<()> {
        let connection = self.connection();
        ensure_workspace_access(&connection, user_id, workspace_id)?;

        drop(connection);
        self.persist_run_snapshot(workspace_id, Some(user_id), snapshot)
    }

    pub fn persist_run_snapshot(
        &self,
        workspace_id: &str,
        requested_by_user_id: Option<&str>,
        snapshot: &RunSnapshot,
    ) -> anyhow::Result<()> {
        let connection = self.connection();
        persist_run_snapshot_row(&connection, workspace_id, requested_by_user_id, snapshot)?;
        drop(connection);
        if should_sync_workflow_duckdb_run(snapshot) {
            self.sync_workflow_duckdb_run(workspace_id, snapshot)?;
        }
        Ok(())
    }

    pub fn persist_run_history(
        &self,
        workspace_id: &str,
        requested_by_user_id: Option<&str>,
        snapshot: &RunSnapshot,
        events: &[RunEvent],
    ) -> anyhow::Result<()> {
        let mut connection = self.connection();
        let tx = connection.transaction()?;
        persist_run_snapshot_row(&tx, workspace_id, requested_by_user_id, snapshot)?;
        for event in events {
            persist_run_event_row(&tx, workspace_id, &snapshot.run_id, event)?;
        }
        tx.commit()?;
        drop(connection);
        if should_sync_workflow_duckdb_run(snapshot) {
            self.sync_workflow_duckdb_run(workspace_id, snapshot)?;
        }
        Ok(())
    }

    pub fn get_workspace_run_record(
        &self,
        user_id: &str,
        workspace_id: &str,
        run_id: &str,
    ) -> anyhow::Result<Option<StoredRunRecord>> {
        let connection = self.connection();
        ensure_workspace_access(&connection, user_id, workspace_id)?;

        connection
            .query_row(
                "select run_id, snapshot_json
                 from runs
                 where workspace_id = ?1 and run_id = ?2",
                params![workspace_id, run_id],
                |row| {
                    Ok(StoredRunRecord {
                        run_id: row.get(0)?,
                        snapshot_json: row.get(1)?,
                    })
                },
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn list_workspace_run_events(
        &self,
        user_id: &str,
        workspace_id: &str,
        run_id: &str,
    ) -> anyhow::Result<Vec<RunEvent>> {
        let connection = self.connection();
        ensure_workspace_access(&connection, user_id, workspace_id)?;

        let mut stmt = connection.prepare(
            "select event_id, sequence, timestamp, event_type, target_kind, target_node_id, payload_json
             from run_events
             where workspace_id = ?1 and run_id = ?2
             order by sequence asc, timestamp asc",
        )?;
        let rows = stmt
            .query_map(params![workspace_id, run_id], |row| {
                let timestamp = row.get::<_, String>(2)?;
                let payload_json = row.get::<_, String>(6)?;
                let payload = serde_json::from_str(&payload_json).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        6,
                        rusqlite::types::Type::Text,
                        Box::new(error),
                    )
                })?;

                Ok(RunEvent {
                    event_id: row.get(0)?,
                    run_id: run_id.to_string(),
                    sequence: row.get(1)?,
                    timestamp: parse_rfc3339_to_utc(&timestamp).map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            2,
                            rusqlite::types::Type::Text,
                            Box::new(std::io::Error::new(
                                std::io::ErrorKind::InvalidData,
                                error.to_string(),
                            )),
                        )
                    })?,
                    event_type: run_event_type_from_db(&row.get::<_, String>(3)?).map_err(
                        |error| rusqlite::Error::InvalidParameterName(error.to_string()),
                    )?,
                    target: api_contract::EventTarget {
                        kind: event_target_kind_from_db(&row.get::<_, String>(4)?).map_err(
                            |error| rusqlite::Error::InvalidParameterName(error.to_string()),
                        )?,
                        node_id: row.get(5)?,
                    },
                    payload,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(rows)
    }

    pub fn list_workspace_run_logs(
        &self,
        user_id: &str,
        workspace_id: &str,
        run_id: &str,
    ) -> anyhow::Result<Vec<RunLogEntry>> {
        let connection = self.connection();
        ensure_workspace_access(&connection, user_id, workspace_id)?;

        let mut stmt = connection.prepare(
            "select timestamp, level, node_id, message
             from run_logs
             where workspace_id = ?1 and run_id = ?2
             order by timestamp asc, log_id asc",
        )?;
        let rows = stmt
            .query_map(params![workspace_id, run_id], |row| {
                let timestamp = row.get::<_, String>(0)?;
                Ok(RunLogEntry {
                    timestamp: parse_rfc3339_to_utc(&timestamp).map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            0,
                            rusqlite::types::Type::Text,
                            Box::new(std::io::Error::new(
                                std::io::ErrorKind::InvalidData,
                                error.to_string(),
                            )),
                        )
                    })?,
                    level: log_level_from_db(&row.get::<_, String>(1)?).map_err(|error| {
                        rusqlite::Error::InvalidParameterName(error.to_string())
                    })?,
                    node_id: row.get(2)?,
                    message: row.get(3)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(rows)
    }

    pub fn list_workspace_run_records(
        &self,
        user_id: &str,
        workspace_id: &str,
    ) -> anyhow::Result<Vec<StoredRunRecord>> {
        let connection = self.connection();
        ensure_workspace_access(&connection, user_id, workspace_id)?;

        let mut stmt = connection.prepare(
            "select run_id, snapshot_json
             from runs
             where workspace_id = ?1
             order by updated_at desc, created_at desc",
        )?;
        let records = stmt
            .query_map(params![workspace_id], |row| {
                Ok(StoredRunRecord {
                    run_id: row.get(0)?,
                    snapshot_json: row.get(1)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(records)
    }

    fn workspace_root_path(&self, user_id: &str, workspace_id: &str) -> PathBuf {
        self.storage_root
            .join("users")
            .join(user_id)
            .join("workspaces")
            .join(workspace_id)
    }

    fn workflow_root_path(&self, user_id: &str, workspace_id: &str, workflow_id: &str) -> PathBuf {
        self.workspace_root_path(user_id, workspace_id)
            .join("workflows")
            .join(workflow_id)
    }

    pub fn workflow_duckdb_path(
        &self,
        user_id: &str,
        workspace_id: &str,
        workflow_id: &str,
    ) -> anyhow::Result<PathBuf> {
        let connection = self.connection();
        ensure_workspace_access(&connection, user_id, workspace_id)?;
        let storage_owner_user_id =
            lookup_workflow_storage_owner_user_id(&connection, workspace_id, workflow_id)?;
        Ok(self
            .workflow_root_path(storage_owner_user_id.as_str(), workspace_id, workflow_id)
            .join("db")
            .join("workflow.duckdb"))
    }

    fn bootstrap_workflow_storage(
        &self,
        user_id: &str,
        workspace_id: &str,
        workflow: &WorkflowDefinition,
    ) -> anyhow::Result<()> {
        let workflow_root =
            self.workflow_root_path(user_id, workspace_id, workflow.workflow_id.as_str());
        let db_dir = workflow_root.join("db");
        let files_dir = workflow_root.join("files");
        let uploads_dir = files_dir.join("uploads");
        let outputs_dir = files_dir.join("outputs");
        let artifacts_dir = files_dir.join("artifacts");

        fs::create_dir_all(&db_dir).with_context(|| {
            format!("failed to create workflow db dir at `{}`", db_dir.display())
        })?;
        fs::create_dir_all(&uploads_dir).with_context(|| {
            format!(
                "failed to create workflow uploads dir at `{}`",
                uploads_dir.display()
            )
        })?;
        fs::create_dir_all(&outputs_dir).with_context(|| {
            format!(
                "failed to create workflow outputs dir at `{}`",
                outputs_dir.display()
            )
        })?;
        fs::create_dir_all(&artifacts_dir).with_context(|| {
            format!(
                "failed to create workflow artifacts dir at `{}`",
                artifacts_dir.display()
            )
        })?;

        let workflow_json_path = workflow_root.join("workflow.json");
        let workflow_json = serde_json::to_vec_pretty(workflow)
            .context("failed to serialize workflow.json artifact")?;
        fs::write(&workflow_json_path, workflow_json).with_context(|| {
            format!(
                "failed to write workflow artifact at `{}`",
                workflow_json_path.display()
            )
        })?;

        let duckdb_path = db_dir.join("workflow.duckdb");
        initialize_workflow_duckdb(&duckdb_path)?;

        Ok(())
    }

    fn initialize(&self) -> anyhow::Result<()> {
        let connection = self.connection();
        connection.execute_batch(
            "
            pragma foreign_keys = on;

            create table if not exists users (
                user_id text primary key,
                email text not null unique,
                display_name text not null,
                password_hash text not null,
                active_workspace_id text null,
                created_at text not null
            );

            create table if not exists sessions (
                session_id text primary key,
                user_id text not null,
                created_at text not null,
                expires_at text not null,
                foreign key (user_id) references users (user_id) on delete cascade
            );

            create table if not exists auth_identities (
                provider text not null,
                provider_subject text not null,
                user_id text not null,
                email_at_link text null,
                email_verified integer not null default 0,
                created_at text not null,
                last_login_at text not null,
                primary key (provider, provider_subject),
                foreign key (user_id) references users (user_id) on delete cascade
            );

            create table if not exists workspaces (
                workspace_id text primary key,
                slug text not null unique,
                name text not null,
                created_at text not null,
                updated_at text not null
            );

            create table if not exists workspace_memberships (
                workspace_id text not null,
                user_id text not null,
                role text not null,
                created_at text not null,
                primary key (workspace_id, user_id),
                foreign key (workspace_id) references workspaces (workspace_id) on delete cascade,
                foreign key (user_id) references users (user_id) on delete cascade
            );

            create table if not exists workflows (
                workspace_id text not null,
                workflow_id text not null,
                name text not null,
                description text null,
                current_version integer not null,
                storage_owner_user_id text null,
                archived_at text null,
                created_at text not null,
                updated_at text not null,
                primary key (workspace_id, workflow_id),
                foreign key (workspace_id) references workspaces (workspace_id) on delete cascade
            );

            create table if not exists workflow_versions (
                workspace_id text not null,
                workflow_id text not null,
                version integer not null,
                definition_json text not null,
                created_at text not null,
                primary key (workspace_id, workflow_id, version),
                foreign key (workspace_id, workflow_id)
                  references workflows (workspace_id, workflow_id)
                  on delete cascade
            );

            create table if not exists workspace_connections (
                workspace_id text not null,
                connection_id text not null,
                connection_kind text not null,
                display_name text not null,
                comment text null,
                auth_scheme text null,
                status text not null default 'draft',
                external_account_label text null,
                external_account_id text null,
                config_json text not null default '{}',
                secret_refs_json text not null default '{}',
                scopes_json text not null default '[]',
                capabilities_json text not null default '{}',
                created_by_user_id text null,
                created_at text not null,
                updated_at text not null,
                last_validated_at text null,
                last_used_at text null,
                last_error_code text null,
                last_error_message text null,
                archived_at text null,
                primary key (workspace_id, connection_id),
                foreign key (workspace_id) references workspaces (workspace_id) on delete cascade,
                foreign key (created_by_user_id) references users (user_id) on delete set null
            );

            create table if not exists workspace_connection_oauth_tokens (
                workspace_id text not null,
                connection_id text not null,
                provider text not null,
                access_token text null,
                refresh_token text null,
                token_type text null,
                scopes_json text not null default '[]',
                expires_at text null,
                created_at text not null,
                updated_at text not null,
                primary key (workspace_id, connection_id),
                foreign key (workspace_id, connection_id)
                  references workspace_connections (workspace_id, connection_id)
                  on delete cascade
            );

            create table if not exists runs (
                workspace_id text not null,
                run_id text not null,
                workflow_id text not null,
                workflow_name_at_run text null,
                workflow_version integer not null,
                status text not null,
                trigger_kind text null,
                requested_by_user_id text null,
                started_at text null,
                finished_at text null,
                duration_ms integer null,
                error_category text null,
                error_message text null,
                error_count integer not null default 0,
                retry_count integer not null default 0,
                snapshot_json text not null,
                created_at text not null,
                updated_at text not null,
                primary key (workspace_id, run_id),
                foreign key (workspace_id) references workspaces (workspace_id) on delete cascade
            );

            create table if not exists run_events (
                workspace_id text not null,
                run_id text not null,
                event_id text not null,
                sequence integer not null,
                timestamp text not null,
                event_type text not null,
                target_kind text not null,
                target_node_id text null,
                attempt integer null,
                payload_json text not null,
                primary key (workspace_id, run_id, event_id),
                foreign key (workspace_id, run_id)
                  references runs (workspace_id, run_id)
                  on delete cascade
            );

            create table if not exists run_logs (
                workspace_id text not null,
                run_id text not null,
                log_id text not null,
                timestamp text not null,
                level text not null,
                node_id text null,
                message text not null,
                primary key (workspace_id, run_id, log_id),
                foreign key (workspace_id, run_id)
                  references runs (workspace_id, run_id)
                  on delete cascade
            );

            create table if not exists user_workspace_state (
                workspace_id text not null,
                user_id text not null,
                last_opened_workflow_id text null,
                created_at text not null,
                updated_at text not null,
                primary key (workspace_id, user_id),
                foreign key (workspace_id) references workspaces (workspace_id) on delete cascade,
                foreign key (user_id) references users (user_id) on delete cascade
            );

            create index if not exists idx_workspace_connections_workspace_status_created
            on workspace_connections (workspace_id, archived_at, status, created_at desc);

            create index if not exists idx_workspace_connections_workspace_kind
            on workspace_connections (workspace_id, connection_kind, archived_at);

            create index if not exists idx_workspace_connection_oauth_tokens_workspace_provider
            on workspace_connection_oauth_tokens (workspace_id, provider);
            ",
        )?;

        ensure_nullable_text_column(&connection, "workflows", "storage_owner_user_id")?;
        ensure_nullable_text_column(&connection, "workflows", "archived_at")?;
        ensure_nullable_text_column(&connection, "runs", "workflow_name_at_run")?;
        ensure_nullable_text_column(&connection, "runs", "trigger_kind")?;
        ensure_nullable_text_column(&connection, "runs", "requested_by_user_id")?;
        ensure_nullable_text_column(&connection, "runs", "started_at")?;
        ensure_nullable_text_column(&connection, "runs", "finished_at")?;
        ensure_nullable_integer_column(&connection, "runs", "duration_ms")?;
        ensure_nullable_text_column(&connection, "runs", "error_category")?;
        ensure_nullable_text_column(&connection, "runs", "error_message")?;
        ensure_integer_column_with_default(&connection, "runs", "error_count", 0)?;
        ensure_integer_column_with_default(&connection, "runs", "retry_count", 0)?;

        if find_user_by_email(&connection, DEMO_EMAIL)?.is_none() {
            let password_hash = hash_password(DEMO_PASSWORD)?;
            connection.execute(
                "insert into users (user_id, email, display_name, password_hash, active_workspace_id, created_at)
                 values (?1, ?2, ?3, ?4, null, ?5)",
                params![
                    "usr_builder",
                    DEMO_EMAIL,
                    DEMO_DISPLAY_NAME,
                    password_hash,
                    Utc::now().to_rfc3339()
                ],
            )?;
        }

        Ok(())
    }

    fn connection(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.connection
            .lock()
            .expect("platform store mutex poisoned")
    }
}

#[derive(Debug)]
struct StoredUser {
    user_id: String,
    email: String,
    display_name: String,
    password_hash: String,
    active_workspace_id: Option<String>,
}

#[derive(Debug)]
struct SessionRecord {
    session_id: String,
    user_id: String,
    expires_at: String,
}

#[derive(Debug)]
pub struct StoredRunRecord {
    pub run_id: String,
    pub snapshot_json: String,
}

#[derive(Debug)]
struct StoredCatalogWorkflow {
    workflow_id: String,
    workflow_name: String,
    storage_owner_user_id: Option<String>,
}

fn list_catalog_workflows(
    connection: &Connection,
    workspace_id: &str,
) -> anyhow::Result<Vec<StoredCatalogWorkflow>> {
    let mut stmt = connection.prepare(
        "select workflow_id, name, storage_owner_user_id
         from workflows
         where workspace_id = ?1
           and archived_at is null
         order by updated_at desc, name asc",
    )?;
    let workflows = stmt
        .query_map(params![workspace_id], |row| {
            Ok(StoredCatalogWorkflow {
                workflow_id: row.get(0)?,
                workflow_name: row.get(1)?,
                storage_owner_user_id: row.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(workflows)
}

fn find_catalog_workflow(
    connection: &Connection,
    workspace_id: &str,
    workflow_id: &str,
) -> anyhow::Result<Option<StoredCatalogWorkflow>> {
    connection
        .query_row(
            "select workflow_id, name, storage_owner_user_id
             from workflows
             where workspace_id = ?1 and workflow_id = ?2
               and archived_at is null",
            params![workspace_id, workflow_id],
            |row| {
                Ok(StoredCatalogWorkflow {
                    workflow_id: row.get(0)?,
                    workflow_name: row.get(1)?,
                    storage_owner_user_id: row.get(2)?,
                })
            },
        )
        .optional()
        .map_err(Into::into)
}

fn resolve_catalog_workflow_owner_user_id(
    connection: &Connection,
    workspace_id: &str,
    workflow: &StoredCatalogWorkflow,
) -> anyhow::Result<String> {
    if let Some(user_id) = workflow
        .storage_owner_user_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Ok(user_id.to_string());
    }

    lookup_workflow_storage_owner_user_id(connection, workspace_id, workflow.workflow_id.as_str())
}

fn open_catalog_duckdb(database_path: &Path) -> anyhow::Result<DuckDbConnection> {
    initialize_workflow_duckdb(database_path)?;
    DuckDbConnection::open(database_path).with_context(|| {
        format!(
            "failed to open workflow duckdb catalog at `{}`",
            database_path.display()
        )
    })
}

fn load_workspace_catalog_summaries(
    duckdb: &DuckDbConnection,
) -> anyhow::Result<Vec<WorkspaceCatalogSchemaSummary>> {
    let mut stmt = duckdb.prepare(
        "select schema_name
         from information_schema.schemata
         where schema_name not in ('information_schema', 'pg_catalog')
           and (
             schema_name in ('runs', 'staging', 'tables', 'outputs')
             or exists (
               select 1
               from information_schema.tables
               where table_schema = schema_name
                 and table_type in ('BASE TABLE', 'VIEW')
             )
           )
         order by case schema_name
             when 'runs' then 0
             when 'staging' then 1
             when 'tables' then 2
             when 'outputs' then 3
             else 9
           end,
           schema_name asc",
    )?;
    let schema_names = stmt
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;

    let mut schemas = Vec::with_capacity(schema_names.len());
    for schema_name in schema_names {
        let tables = load_workspace_catalog_table_summaries(duckdb, schema_name.as_str())?;
        schemas.push(WorkspaceCatalogSchemaSummary {
            schema_name,
            table_count: tables.len() as u32,
            tables,
        });
    }

    Ok(schemas)
}

fn load_workspace_catalog_table_summaries(
    duckdb: &DuckDbConnection,
    schema_name: &str,
) -> anyhow::Result<Vec<WorkspaceCatalogTableSummary>> {
    let mut stmt = duckdb.prepare(
        "select t.table_name,
                t.table_type,
                coalesce(count(c.column_name), 0) as column_count
         from information_schema.tables t
         left join information_schema.columns c
           on c.table_schema = t.table_schema
          and c.table_name = t.table_name
         where t.table_schema = ?1
           and t.table_type in ('BASE TABLE', 'VIEW')
         group by t.table_name, t.table_type
         order by case t.table_type
             when 'BASE TABLE' then 0
             when 'VIEW' then 1
             else 9
           end,
           t.table_name asc",
    )?;
    let tables = stmt
        .query_map([schema_name], |row| {
            let table_name = row.get::<_, String>(0)?;
            let protected_reason =
                protected_workspace_catalog_table_reason(schema_name, table_name.as_str());
            Ok(WorkspaceCatalogTableSummary {
                table_name,
                table_type: row.get(1)?,
                column_count: row.get::<_, u32>(2)?,
                is_deletable: protected_reason.is_none(),
                protected_reason,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(tables)
}

fn protected_workspace_catalog_table_reason(schema_name: &str, table_name: &str) -> Option<String> {
    match (schema_name.trim(), table_name.trim()) {
        ("runs", "workflow_runs")
        | ("runs", "node_runs")
        | ("runs", "table_output_materializations")
        | ("outputs", "node_outputs") => Some(
            "This is a system-managed table and cannot be deleted from the catalog tree."
                .to_string(),
        ),
        _ => None,
    }
}

fn load_active_workflow_definition(
    connection: &Connection,
    workspace_id: &str,
    workflow_id: &str,
) -> anyhow::Result<Option<(u32, WorkflowDefinition)>> {
    let row = connection
        .query_row(
            "select w.current_version, v.definition_json
             from workflows w
             join workflow_versions v
               on v.workspace_id = w.workspace_id
              and v.workflow_id = w.workflow_id
              and v.version = w.current_version
             where w.workspace_id = ?1 and w.workflow_id = ?2
               and w.archived_at is null",
            params![workspace_id, workflow_id],
            |row| Ok((row.get::<_, u32>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;

    let Some((current_version, definition_json)) = row else {
        return Ok(None);
    };
    let definition: WorkflowDefinition = serde_json::from_str(&definition_json)
        .context("stored workflow definition is not valid JSON")?;
    Ok(Some((current_version, definition)))
}

fn clear_deleted_catalog_table_node_references(
    workflow_definition: &mut WorkflowDefinition,
    catalog_workflow_id: &str,
    schema_name: &str,
    table_name: &str,
) -> Vec<WorkspaceCatalogTableUsageNode> {
    if workflow_definition.workflow_id != catalog_workflow_id {
        return Vec::new();
    }

    let mut nodes = Vec::new();

    for node in &mut workflow_definition.nodes {
        let Some(config) = node.config.as_object_mut() else {
            continue;
        };

        if node.type_id == "table_input" {
            let matches_schema = config
                .get("schema_name")
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                == Some(schema_name.trim());
            let matches_table = config
                .get("table_name")
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                == Some(table_name.trim());

            if matches_schema && matches_table {
                config.insert("schema_name".to_string(), serde_json::Value::Null);
                config.insert("table_name".to_string(), serde_json::Value::Null);
                nodes.push(WorkspaceCatalogTableUsageNode {
                    node_id: node.node_id.clone(),
                    node_type: node.type_id.clone(),
                    usage_kind: "source".to_string(),
                    node_label: node.label.clone(),
                });
            }
        }

        if node.type_id == "table_output" {
            let matches_schema = config
                .get("target_schema")
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                == Some(schema_name.trim());
            let matches_table = config
                .get("table_name")
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                == Some(table_name.trim());

            if matches_schema && matches_table {
                config.insert("target_schema".to_string(), serde_json::Value::Null);
                config.insert("table_name".to_string(), serde_json::Value::Null);
                nodes.push(WorkspaceCatalogTableUsageNode {
                    node_id: node.node_id.clone(),
                    node_type: node.type_id.clone(),
                    usage_kind: "target".to_string(),
                    node_label: node.label.clone(),
                });
            }
        }
    }

    nodes
}

fn build_catalog_table_delete_plan(
    connection: &Connection,
    workspace_id: &str,
    workflow: &StoredCatalogWorkflow,
    schema_name: &str,
    table_name: &str,
) -> anyhow::Result<CatalogTableDeletePlan> {
    let protected_reason = protected_workspace_catalog_table_reason(schema_name, table_name);
    let mut affected_workflows = Vec::new();
    let mut workflow_updates = Vec::new();

    if let Some((current_version, definition)) =
        load_active_workflow_definition(connection, workspace_id, workflow.workflow_id.as_str())?
    {
        let mut next_definition = definition.clone();
        let matching_nodes = clear_deleted_catalog_table_node_references(
            &mut next_definition,
            workflow.workflow_id.as_str(),
            schema_name,
            table_name,
        );

        if !matching_nodes.is_empty() {
            affected_workflows.push(WorkspaceCatalogTableUsageWorkflow {
                workflow_id: workflow.workflow_id.clone(),
                workflow_name: workflow.workflow_name.clone(),
                nodes: matching_nodes,
            });

            let normalized = normalize_workflow_definition(
                &next_definition,
                workflow.workflow_id.as_str(),
                current_version.saturating_add(1),
            )?;
            workflow_updates.push(CatalogTableWorkflowUpdate {
                workflow_id: workflow.workflow_id.clone(),
                storage_owner_user_id: workflow
                    .storage_owner_user_id
                    .as_deref()
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or_default()
                    .to_string(),
                definition: normalized,
            });
        }
    }

    Ok(CatalogTableDeletePlan {
        workflow_id: workflow.workflow_id.clone(),
        workflow_name: workflow.workflow_name.clone(),
        database_name: "workflow.duckdb".to_string(),
        schema_name: schema_name.to_string(),
        table_name: table_name.to_string(),
        is_deletable: protected_reason.is_none(),
        protected_reason,
        affected_workflows,
        workflow_updates,
    })
}

fn persist_catalog_table_workflow_updates(
    connection: &mut Connection,
    workspace_id: &str,
    workflow_updates: &[CatalogTableWorkflowUpdate],
) -> anyhow::Result<()> {
    let now = Utc::now().to_rfc3339();
    let tx = connection.transaction()?;

    for workflow_update in workflow_updates {
        let definition_json = serde_json::to_string(&workflow_update.definition)
            .context("failed to serialize workflow definition")?;
        tx.execute(
            "update workflows
             set name = ?3,
                 description = ?4,
                 current_version = ?5,
                 updated_at = ?6
             where workspace_id = ?1 and workflow_id = ?2",
            params![
                workspace_id,
                workflow_update.workflow_id.as_str(),
                workflow_update.definition.name.as_str(),
                workflow_update.definition.description.as_deref(),
                workflow_update.definition.version,
                now
            ],
        )?;
        tx.execute(
            "insert into workflow_versions (workspace_id, workflow_id, version, definition_json, created_at)
             values (?1, ?2, ?3, ?4, ?5)",
            params![
                workspace_id,
                workflow_update.workflow_id.as_str(),
                workflow_update.definition.version,
                definition_json,
                now
            ],
        )?;
    }

    tx.commit()?;
    Ok(())
}

fn workspace_catalog_schema_exists(
    duckdb: &DuckDbConnection,
    schema_name: &str,
) -> anyhow::Result<bool> {
    let exists: Option<i64> = duckdb
        .query_row(
            "select 1
             from information_schema.schemata
             where schema_name = ?1
               and schema_name not in ('information_schema', 'pg_catalog')",
            [schema_name],
            |row| row.get(0),
        )
        .optional()?;

    Ok(exists.is_some())
}

fn workspace_catalog_table_exists(
    duckdb: &DuckDbConnection,
    schema_name: &str,
    table_name: &str,
) -> anyhow::Result<bool> {
    let exists: Option<i64> = duckdb
        .query_row(
            "select 1
             from information_schema.tables
             where table_schema = ?1
               and table_name = ?2
               and table_type in ('BASE TABLE', 'VIEW')",
            [schema_name, table_name],
            |row| row.get(0),
        )
        .optional()?;

    Ok(exists.is_some())
}

fn load_workspace_catalog_columns(
    duckdb: &DuckDbConnection,
    schema_name: &str,
    table_name: &str,
) -> anyhow::Result<Vec<WorkspaceCatalogColumnSummary>> {
    let mut stmt = duckdb.prepare(
        "select column_name,
                data_type,
                case when is_nullable = 'YES' then 1 else 0 end as nullable
         from information_schema.columns
         where table_schema = ?1 and table_name = ?2
         order by ordinal_position asc",
    )?;
    let columns = stmt
        .query_map([schema_name, table_name], |row| {
            Ok(WorkspaceCatalogColumnSummary {
                column_name: row.get(0)?,
                data_type: row.get(1)?,
                nullable: row.get::<_, i64>(2)? != 0,
                description: None,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(columns)
}

fn normalize_workspace_catalog_query(query: &str) -> anyhow::Result<String> {
    let trimmed = query.trim();
    let without_trailing_semicolons = trimmed.trim_end_matches(';').trim();
    if without_trailing_semicolons.is_empty() {
        return Err(anyhow!("Enter a SQL query to preview sample data."));
    }

    if without_trailing_semicolons.contains(';') {
        return Err(anyhow!(
            "Only a single read-only query can be run in the catalog preview."
        ));
    }

    let normalized_prefix = without_trailing_semicolons
        .chars()
        .take_while(|character| !character.is_whitespace())
        .collect::<String>()
        .to_ascii_lowercase();
    if normalized_prefix != "select" && normalized_prefix != "with" {
        return Err(anyhow!(
            "Only read-only SELECT queries are supported in the catalog preview."
        ));
    }

    Ok(without_trailing_semicolons.to_string())
}

fn resolve_duckdb_cli_path() -> PathBuf {
    env::var("STITCHLY_DUCKDB_CLI_PATH")
        .ok()
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(|| {
            let snap_path = PathBuf::from("/snap/duckdb/current/duckdb");
            if snap_path.is_file() {
                snap_path
            } else {
                PathBuf::from("duckdb")
            }
        })
}

fn run_duckdb_cli_json(database_path: &Path, sql: &str) -> anyhow::Result<String> {
    let cli_path = resolve_duckdb_cli_path();
    let output = Command::new(&cli_path)
        .arg("-readonly")
        .arg("-json")
        .arg(database_path)
        .arg(sql)
        .output()
        .with_context(|| format!("failed to launch DuckDB CLI at `{}`", cli_path.display()))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            format!("process exited with status {:?}", output.status)
        };

        let detail = if detail.contains("Out of Memory Error") {
            format!(
                "{detail}. Try removing heavy preview columns like *_json, *_payload, error_message, created_at, or updated_at."
            )
        } else {
            detail
        };

        return Err(anyhow!("DuckDB query failed: {detail}"));
    }

    String::from_utf8(output.stdout).context("DuckDB CLI returned non-UTF-8 output")
}

#[derive(serde::Deserialize)]
struct DuckDbDescribeColumn {
    column_name: String,
    column_type: String,
}

fn describe_workspace_catalog_query(
    database_path: &Path,
    query: &str,
) -> anyhow::Result<Vec<WorkspaceCatalogQueryColumn>> {
    let output = run_duckdb_cli_json(database_path, &format!("describe {query}"))?;
    let describe_rows: Vec<DuckDbDescribeColumn> =
        serde_json::from_str(&output).context("failed to parse DuckDB query columns")?;

    Ok(describe_rows
        .into_iter()
        .map(|column| WorkspaceCatalogQueryColumn {
            column_name: column.column_name,
            data_type: column.column_type,
        })
        .collect())
}

fn execute_workspace_catalog_query_rows(
    database_path: &Path,
    query: &str,
    columns: &[WorkspaceCatalogQueryColumn],
) -> anyhow::Result<Vec<Vec<Option<String>>>> {
    let capped_query = format!("select * from ({query}) as stitchly_query limit 1000");
    let output = run_duckdb_cli_json(database_path, &capped_query)?;
    if output.trim().is_empty() {
        return Ok(Vec::new());
    }
    let json_rows: Vec<serde_json::Value> =
        serde_json::from_str(&output).context("failed to parse DuckDB query rows")?;
    let mut rows = Vec::with_capacity(json_rows.len());

    for row in json_rows {
        let Some(object) = row.as_object() else {
            return Err(anyhow!(
                "DuckDB returned a non-object row in query results."
            ));
        };

        rows.push(
            columns
                .iter()
                .map(|column| stringify_catalog_query_cell(object.get(&column.column_name)))
                .collect(),
        );
    }

    Ok(rows)
}

fn stringify_catalog_query_cell(value: Option<&serde_json::Value>) -> Option<String> {
    match value {
        None | Some(serde_json::Value::Null) => None,
        Some(serde_json::Value::Bool(boolean)) => Some(boolean.to_string()),
        Some(serde_json::Value::Number(number)) => Some(number.to_string()),
        Some(serde_json::Value::String(string)) => Some(string.clone()),
        Some(other) => Some(other.to_string()),
    }
}

fn persist_run_snapshot_row(
    connection: &Connection,
    workspace_id: &str,
    requested_by_user_id: Option<&str>,
    snapshot: &RunSnapshot,
) -> anyhow::Result<()> {
    let now = Utc::now();
    let workflow_name_at_run =
        lookup_workflow_name_at_run(connection, workspace_id, snapshot.workflow_id.as_str())?;
    let duration_ms = derive_run_duration_ms(snapshot, now);
    let error_count = derive_run_error_count(snapshot);
    let retry_count = derive_run_retry_count(snapshot);
    let now = now.to_rfc3339();
    let snapshot_json =
        serde_json::to_string(snapshot).context("failed to serialize run snapshot")?;

    connection.execute(
        "insert into runs (
            workspace_id,
            run_id,
            workflow_id,
            workflow_name_at_run,
            workflow_version,
            status,
            trigger_kind,
            requested_by_user_id,
            started_at,
            finished_at,
            duration_ms,
            error_category,
            error_message,
            error_count,
            retry_count,
            snapshot_json,
            created_at,
            updated_at
         )
         values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)
         on conflict(workspace_id, run_id) do update set
            workflow_id = excluded.workflow_id,
            workflow_name_at_run = coalesce(runs.workflow_name_at_run, excluded.workflow_name_at_run),
            workflow_version = excluded.workflow_version,
            status = excluded.status,
            trigger_kind = excluded.trigger_kind,
            requested_by_user_id = coalesce(excluded.requested_by_user_id, runs.requested_by_user_id),
            started_at = excluded.started_at,
            finished_at = excluded.finished_at,
            duration_ms = excluded.duration_ms,
            error_category = excluded.error_category,
            error_message = excluded.error_message,
            error_count = excluded.error_count,
            retry_count = excluded.retry_count,
            snapshot_json = excluded.snapshot_json,
            updated_at = excluded.updated_at",
        params![
            workspace_id,
            snapshot.run_id.as_str(),
            snapshot.workflow_id.as_str(),
            workflow_name_at_run.as_str(),
            snapshot.workflow_version,
            run_status_to_db(&snapshot.status),
            trigger_kind_to_db(&snapshot.trigger.kind),
            requested_by_user_id,
            snapshot.started_at.as_ref().map(|value| value.to_rfc3339()),
            snapshot.finished_at.as_ref().map(|value| value.to_rfc3339()),
            duration_ms,
            snapshot.error.as_ref().map(|error| run_error_category_to_db(&error.category)),
            snapshot.error.as_ref().map(|error| error.message.clone()),
            error_count,
            retry_count,
            snapshot_json,
            now,
            now
        ],
    )?;

    Ok(())
}

fn persist_run_event_row(
    connection: &Connection,
    workspace_id: &str,
    run_id: &str,
    event: &RunEvent,
) -> anyhow::Result<()> {
    let payload_json =
        serde_json::to_string(&event.payload).context("failed to serialize run event payload")?;
    let attempt = event
        .payload
        .get("attempt")
        .and_then(|value| value.as_u64());

    connection.execute(
        "insert or ignore into run_events (
            workspace_id,
            run_id,
            event_id,
            sequence,
            timestamp,
            event_type,
            target_kind,
            target_node_id,
            attempt,
            payload_json
         )
         values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            workspace_id,
            run_id,
            event.event_id.as_str(),
            event.sequence,
            event.timestamp.to_rfc3339(),
            run_event_type_to_db(&event.event_type),
            event_target_kind_to_db(&event.target.kind),
            event.target.node_id.as_deref(),
            attempt.map(|value| value as i64),
            payload_json
        ],
    )?;

    if event.event_type == RunEventType::NodeLog {
        let level = event
            .payload
            .get("level")
            .and_then(|value| serde_json::from_value::<LogLevel>(value.clone()).ok())
            .unwrap_or(LogLevel::Info);
        let message = event
            .payload
            .get("message")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_string();
        persist_run_log_row(
            connection,
            workspace_id,
            run_id,
            &event.event_id,
            &RunLogEntry {
                timestamp: event.timestamp,
                level,
                node_id: event.target.node_id.clone(),
                message,
            },
        )?;
    }

    Ok(())
}

fn persist_run_log_row(
    connection: &Connection,
    workspace_id: &str,
    run_id: &str,
    log_id: &str,
    entry: &RunLogEntry,
) -> anyhow::Result<()> {
    connection.execute(
        "insert or ignore into run_logs (
            workspace_id,
            run_id,
            log_id,
            timestamp,
            level,
            node_id,
            message
         )
         values (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            workspace_id,
            run_id,
            log_id,
            entry.timestamp.to_rfc3339(),
            log_level_to_db(&entry.level),
            entry.node_id.as_deref(),
            entry.message.as_str()
        ],
    )?;

    Ok(())
}

fn lookup_workflow_name_at_run(
    connection: &Connection,
    workspace_id: &str,
    workflow_id: &str,
) -> anyhow::Result<String> {
    let workflow_name: Option<String> = connection
        .query_row(
            "select name
             from workflows
             where workspace_id = ?1 and workflow_id = ?2",
            params![workspace_id, workflow_id],
            |row| row.get(0),
        )
        .optional()?;

    Ok(workflow_name.unwrap_or_else(|| workflow_id.to_string()))
}

fn derive_run_duration_ms(snapshot: &RunSnapshot, now: chrono::DateTime<Utc>) -> Option<i64> {
    let started_at = snapshot.started_at?;
    let end = snapshot.finished_at.unwrap_or(now);
    Some((end - started_at).num_milliseconds())
}

fn derive_run_error_count(snapshot: &RunSnapshot) -> i64 {
    let node_error_count = snapshot
        .node_runs
        .iter()
        .filter(|node_run| {
            node_run.error.is_some()
                || matches!(node_run.status, api_contract::NodeRunStatus::Failed)
        })
        .count() as i64;

    if node_error_count == 0 && snapshot.error.is_some() {
        1
    } else {
        node_error_count
    }
}

fn derive_run_retry_count(snapshot: &RunSnapshot) -> i64 {
    snapshot
        .node_runs
        .iter()
        .map(|node_run| node_run.attempt.saturating_sub(1) as i64)
        .sum()
}

fn lookup_workflow_storage_owner_user_id(
    connection: &Connection,
    workspace_id: &str,
    workflow_id: &str,
) -> anyhow::Result<String> {
    let stored_owner: Option<String> = connection
        .query_row(
            "select storage_owner_user_id
             from workflows
             where workspace_id = ?1 and workflow_id = ?2",
            params![workspace_id, workflow_id],
            |row| row.get(0),
        )
        .optional()?
        .flatten();

    if let Some(user_id) = stored_owner.filter(|value| !value.trim().is_empty()) {
        return Ok(user_id);
    }

    let fallback_owner: Option<String> = connection
        .query_row(
            "select user_id
             from workspace_memberships
             where workspace_id = ?1 and role = ?2
             order by created_at asc
             limit 1",
            params![workspace_id, role_to_db(WorkspaceMembershipRole::Owner)],
            |row| row.get(0),
        )
        .optional()?;

    let fallback_owner = fallback_owner.ok_or_else(|| {
        anyhow!(
            "workflow `{workflow_id}` in workspace `{workspace_id}` does not have a storage owner"
        )
    })?;

    connection.execute(
        "update workflows
         set storage_owner_user_id = ?3
         where workspace_id = ?1 and workflow_id = ?2
           and storage_owner_user_id is null",
        params![workspace_id, workflow_id, fallback_owner.as_str()],
    )?;

    Ok(fallback_owner)
}

fn persist_workflow_duckdb_run_snapshot(
    database_path: &Path,
    workspace_id: &str,
    snapshot: &RunSnapshot,
) -> anyhow::Result<()> {
    let connection = DuckDbConnection::open(database_path).with_context(|| {
        format!(
            "failed to open workflow duckdb for run persistence at `{}`",
            database_path.display()
        )
    })?;
    let now = Utc::now().to_rfc3339();
    let duration_ms = derive_run_duration_ms(snapshot, Utc::now());
    let error_count = derive_run_error_count(snapshot);
    let retry_count = derive_run_retry_count(snapshot);
    let completed_node_count = snapshot
        .node_runs
        .iter()
        .filter(|node_run| {
            matches!(
                &node_run.status,
                api_contract::NodeRunStatus::Succeeded
                    | api_contract::NodeRunStatus::Failed
                    | api_contract::NodeRunStatus::Skipped
                    | api_contract::NodeRunStatus::Cancelled
            )
        })
        .count() as i64;
    let snapshot_json =
        serde_json::to_string(snapshot).context("failed to serialize duckdb run snapshot")?;

    connection.execute("begin transaction", [])?;
    connection.execute(
        "delete from runs.node_runs where run_id = ?1",
        [snapshot.run_id.as_str()],
    )?;
    connection.execute(
        "delete from outputs.node_outputs where run_id = ?1",
        [snapshot.run_id.as_str()],
    )?;

    connection.execute(
        "insert or replace into runs.workflow_runs (
            run_id,
            workspace_id,
            workflow_id,
            workflow_version,
            status,
            trigger_kind,
            started_at,
            finished_at,
            duration_ms,
            error_category,
            error_message,
            error_count,
            retry_count,
            node_count,
            completed_node_count,
            snapshot_json,
            created_at,
            updated_at
         )
         values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
        duckdb::params![
            snapshot.run_id.as_str(),
            workspace_id,
            snapshot.workflow_id.as_str(),
            snapshot.workflow_version as i64,
            run_status_to_db(&snapshot.status),
            trigger_kind_to_db(&snapshot.trigger.kind),
            snapshot.started_at.as_ref().map(|value| value.to_rfc3339()),
            snapshot
                .finished_at
                .as_ref()
                .map(|value| value.to_rfc3339()),
            duration_ms,
            snapshot
                .error
                .as_ref()
                .map(|error| run_error_category_to_db(&error.category)),
            snapshot.error.as_ref().map(|error| error.message.as_str()),
            error_count,
            retry_count,
            snapshot.node_runs.len() as i64,
            completed_node_count,
            snapshot_json.as_str(),
            now.as_str(),
            now.as_str(),
        ],
    )?;

    for node_run in &snapshot.node_runs {
        let last_output_json = node_run
            .last_output
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .context("failed to serialize duckdb node output")?;
        let node_duration_ms = node_run
            .started_at
            .as_ref()
            .zip(node_run.finished_at.as_ref())
            .map(|(started_at, finished_at)| (*finished_at - *started_at).num_milliseconds());

        connection.execute(
            "insert or replace into runs.node_runs (
                run_id,
                node_id,
                type_id,
                status,
                attempt,
                started_at,
                finished_at,
                duration_ms,
                log_count,
                error_category,
                error_message,
                last_output_json,
                created_at,
                updated_at
             )
             values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            duckdb::params![
                snapshot.run_id.as_str(),
                node_run.node_id.as_str(),
                node_run.type_id.as_str(),
                node_run_status_to_db(&node_run.status),
                node_run.attempt as i64,
                node_run.started_at.as_ref().map(|value| value.to_rfc3339()),
                node_run
                    .finished_at
                    .as_ref()
                    .map(|value| value.to_rfc3339()),
                node_duration_ms,
                node_run.log_count as i64,
                node_run
                    .error
                    .as_ref()
                    .map(|error| run_error_category_to_db(&error.category)),
                node_run.error.as_ref().map(|error| error.message.as_str()),
                last_output_json.as_deref(),
                now.as_str(),
                now.as_str(),
            ],
        )?;

        if let Some(last_output) = node_run.last_output.as_ref() {
            let output_json = serde_json::to_string(last_output)
                .context("failed to serialize duckdb workflow output")?;
            let output_text_preview = summarize_typed_value_preview(last_output);
            connection.execute(
                "insert or replace into outputs.node_outputs (
                    run_id,
                    node_id,
                    output_data_type,
                    output_json,
                    output_text_preview,
                    produced_at
                 )
                 values (?1, ?2, ?3, ?4, ?5, ?6)",
                duckdb::params![
                    snapshot.run_id.as_str(),
                    node_run.node_id.as_str(),
                    data_type_to_db(&last_output.data_type),
                    output_json.as_str(),
                    output_text_preview,
                    node_run
                        .finished_at
                        .as_ref()
                        .map(|value| value.to_rfc3339())
                        .unwrap_or_else(|| now.clone()),
                ],
            )?;
        }

        materialize_mirrored_table_output(&connection, snapshot, node_run, now.as_str())?;
    }

    connection.execute("commit", [])?;
    Ok(())
}

fn summarize_typed_value_preview(value: &TypedValue) -> Option<String> {
    if let Some(text) = value.as_text() {
        return Some(truncate_for_preview(text, 160));
    }

    serde_json::to_string(&value.value)
        .ok()
        .map(|text| truncate_for_preview(text.as_str(), 160))
}

fn quote_duckdb_identifier(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}

fn quote_duckdb_string_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn extract_mirrored_table_output_payload(
    node_run: &api_contract::NodeRunSnapshot,
) -> anyhow::Result<Option<MirroredTableOutputPayload>> {
    if node_run.type_id != "table_output"
        || !matches!(node_run.status, api_contract::NodeRunStatus::Succeeded)
    {
        return Ok(None);
    }

    let Some(last_output) = node_run.last_output.as_ref() else {
        return Ok(None);
    };
    if last_output.data_type != DataType::Json {
        return Ok(None);
    }

    let payload: MirroredTableOutputPayload = serde_json::from_value(last_output.value.clone())
        .context("failed to parse mirrored table output payload")?;

    if payload.kind != "table_output_write" {
        return Ok(None);
    }

    let has_schema_bundle = payload.schema_definition.is_some()
        || payload
            .schema_definitions
            .as_ref()
            .map(|definitions| !definitions.is_empty())
            .unwrap_or(false);

    if payload.target_schema.trim().is_empty()
        || (!has_schema_bundle && payload.table_name.trim().is_empty())
    {
        return Err(anyhow!(
            "mirrored table output payload is missing target_schema or table_name"
        ));
    }

    if let Some(source_table) = payload.source_table.as_ref() {
        if source_table.schema_name.trim().is_empty() || source_table.table_name.trim().is_empty() {
            return Err(anyhow!(
                "mirrored table output payload is missing source schema_name or table_name"
            ));
        }
    } else if !has_schema_bundle
        && (payload
            .value_column
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .is_none()
            || payload.value_text.is_none())
    {
        return Err(anyhow!(
            "mirrored text table output payload is missing value_column or value_text"
        ));
    }

    Ok(Some(payload))
}

fn ensure_mirrored_table_output_table(
    connection: &DuckDbConnection,
    payload: &MirroredTableOutputPayload,
) -> anyhow::Result<String> {
    let schema_identifier = quote_duckdb_identifier(payload.target_schema.trim());
    let table_identifier = quote_duckdb_identifier(payload.table_name.trim());
    let qualified_table = format!("{schema_identifier}.{table_identifier}");
    let value_column_identifier = quote_duckdb_identifier(
        payload
            .value_column
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| anyhow!("missing value_column for text-based table output"))?,
    );

    connection.execute_batch(&format!("create schema if not exists {schema_identifier};"))?;

    let create_columns = {
        let mut columns = Vec::new();
        if payload.include_run_id {
            columns.push("\"run_id\" varchar".to_string());
        }
        if payload.include_written_at {
            columns.push("\"written_at\" varchar".to_string());
        }
        columns.push(format!("{value_column_identifier} varchar"));
        columns.join(", ")
    };

    if matches!(payload.write_mode, MirroredTableOutputWriteMode::Replace) {
        connection.execute_batch(&format!(
            "drop table if exists {qualified_table};
             create table {qualified_table} ({create_columns});"
        ))?;
        return Ok(qualified_table);
    }

    connection.execute_batch(&format!(
        "create table if not exists {qualified_table} ({create_columns});"
    ))?;

    if payload.include_run_id {
        connection.execute_batch(&format!(
            "alter table {qualified_table} add column if not exists \"run_id\" varchar;"
        ))?;
    }
    if payload.include_written_at {
        connection.execute_batch(&format!(
            "alter table {qualified_table} add column if not exists \"written_at\" varchar;"
        ))?;
    }
    connection.execute_batch(&format!(
        "alter table {qualified_table} add column if not exists {value_column_identifier} varchar;"
    ))?;

    Ok(qualified_table)
}

fn insert_mirrored_table_output_row(
    connection: &DuckDbConnection,
    qualified_table: &str,
    payload: &MirroredTableOutputPayload,
    run_id: &str,
    materialized_at: &str,
) -> anyhow::Result<()> {
    let value_column_identifier = quote_duckdb_identifier(
        payload
            .value_column
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| anyhow!("missing value_column for text-based table output"))?,
    );
    let value_text = payload
        .value_text
        .as_deref()
        .ok_or_else(|| anyhow!("missing value_text for text-based table output"))?;

    let sql = match (payload.include_run_id, payload.include_written_at) {
        (true, true) => format!(
            "insert into {qualified_table} (\"run_id\", \"written_at\", {value_column_identifier}) values (?1, ?2, ?3)"
        ),
        (true, false) => format!(
            "insert into {qualified_table} (\"run_id\", {value_column_identifier}) values (?1, ?2)"
        ),
        (false, true) => format!(
            "insert into {qualified_table} (\"written_at\", {value_column_identifier}) values (?1, ?2)"
        ),
        (false, false) => {
            format!("insert into {qualified_table} ({value_column_identifier}) values (?1)")
        }
    };

    match (payload.include_run_id, payload.include_written_at) {
        (true, true) => {
            connection.execute(&sql, duckdb::params![run_id, materialized_at, value_text])?
        }
        (true, false) => connection.execute(&sql, duckdb::params![run_id, value_text])?,
        (false, true) => connection.execute(&sql, duckdb::params![materialized_at, value_text])?,
        (false, false) => connection.execute(&sql, duckdb::params![value_text])?,
    };

    Ok(())
}

fn build_mirrored_schema_table_columns_from_definition(
    columns: &[MirroredTableSchemaColumnPayload],
    primary_key: &[String],
    checks: &[String],
    include_run_id: bool,
    include_written_at: bool,
) -> anyhow::Result<String> {
    if columns.is_empty() {
        return Err(anyhow!(
            "schema_definition must include at least one declared column"
        ));
    }

    let mut column_definitions = Vec::new();
    let mut column_names = BTreeSet::new();

    for column in columns {
        let column_name = column.name.trim();
        if column_name.is_empty() {
            return Err(anyhow!(
                "schema_definition contains a column with an empty name"
            ));
        }

        let normalized_name = column_name.to_ascii_lowercase();
        if !column_names.insert(normalized_name) {
            return Err(anyhow!(
                "schema_definition contains duplicate column `{column_name}`"
            ));
        }

        let column_type = column.column_type.trim();
        if column_type.is_empty() {
            return Err(anyhow!(
                "schema_definition column `{column_name}` is missing a type"
            ));
        }

        let mut column_sql = format!("{} {}", quote_duckdb_identifier(column_name), column_type);
        if matches!(column.nullable, Some(false)) {
            column_sql.push_str(" not null");
        }
        if let Some(default_expression) = column
            .default
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            column_sql.push_str(" default ");
            column_sql.push_str(default_expression);
        }

        column_definitions.push(column_sql);
    }

    if include_run_id && column_names.insert("run_id".to_string()) {
        column_definitions.push(format!("{} varchar", quote_duckdb_identifier("run_id")));
    }
    if include_written_at && column_names.insert("written_at".to_string()) {
        column_definitions.push(format!("{} varchar", quote_duckdb_identifier("written_at")));
    }

    let primary_key_columns = if primary_key.is_empty() {
        columns
            .iter()
            .filter_map(|column| {
                if column.primary_key.unwrap_or(false) {
                    let column_name = column.name.trim();
                    if column_name.is_empty() {
                        None
                    } else {
                        Some(column_name.to_string())
                    }
                } else {
                    None
                }
            })
            .collect::<Vec<_>>()
    } else {
        primary_key
            .iter()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .collect::<Vec<_>>()
    };

    if !primary_key_columns.is_empty() {
        for column_name in &primary_key_columns {
            if !column_names.contains(&column_name.to_ascii_lowercase()) {
                return Err(anyhow!(
                    "schema_definition primary key references unknown column `{column_name}`"
                ));
            }
        }

        column_definitions.push(format!(
            "primary key ({})",
            primary_key_columns
                .iter()
                .map(|value| quote_duckdb_identifier(value))
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }

    for check_expression in checks
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        column_definitions.push(format!("check ({check_expression})"));
    }

    Ok(column_definitions.join(", "))
}

fn build_mirrored_source_table_select(
    payload: &MirroredTableOutputPayload,
    run_id: &str,
    materialized_at: &str,
) -> anyhow::Result<String> {
    let source_table = payload
        .source_table
        .as_ref()
        .ok_or_else(|| anyhow!("missing source_table payload"))?;
    let source_schema = quote_duckdb_identifier(source_table.schema_name.trim());
    let source_table_name = quote_duckdb_identifier(source_table.table_name.trim());
    let qualified_source = format!("{source_schema}.{source_table_name}");

    let selected_columns = source_table
        .selected_columns
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    let projection = if selected_columns.is_empty()
        || selected_columns
            .iter()
            .any(|value| *value == "*" || *value == "\"*\"")
    {
        "*".to_string()
    } else {
        selected_columns
            .iter()
            .map(|value| quote_duckdb_identifier(value))
            .collect::<Vec<_>>()
            .join(", ")
    };

    let mut select_list = vec![projection];
    if payload.include_run_id {
        select_list.push(format!(
            "{} as {}",
            quote_duckdb_string_literal(run_id),
            quote_duckdb_identifier("run_id")
        ));
    }
    if payload.include_written_at {
        select_list.push(format!(
            "{} as {}",
            quote_duckdb_string_literal(materialized_at),
            quote_duckdb_identifier("written_at")
        ));
    }

    let mut sql = format!("select {} from {qualified_source}", select_list.join(", "));

    if let Some(row_filter) = source_table
        .row_filter
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        sql.push_str(" where ");
        sql.push_str(row_filter);
    }

    if let Some(row_limit) = source_table.row_limit.filter(|value| *value > 0) {
        sql.push_str(&format!(" limit {row_limit}"));
    }

    Ok(sql)
}

fn materialize_mirrored_schema_table_output(
    connection: &DuckDbConnection,
    payload: &MirroredTableOutputPayload,
) -> anyhow::Result<()> {
    let schema_identifier = quote_duckdb_identifier(payload.target_schema.trim());
    connection.execute_batch(&format!("create schema if not exists {schema_identifier};"))?;

    if let Some(schema_definitions) = payload
        .schema_definitions
        .as_ref()
        .filter(|definitions| !definitions.is_empty())
    {
        for definition in schema_definitions {
            let table_identifier = quote_duckdb_identifier(definition.table_name.trim());
            let qualified_table = format!("{schema_identifier}.{table_identifier}");
            let create_columns = build_mirrored_schema_table_columns_from_definition(
                &definition.columns,
                &definition.primary_key,
                &definition.checks,
                payload.include_run_id,
                payload.include_written_at,
            )?;

            if matches!(payload.write_mode, MirroredTableOutputWriteMode::Replace) {
                connection.execute_batch(&format!(
                    "drop table if exists {qualified_table};
                     create table {qualified_table} ({create_columns});"
                ))?;
            } else {
                connection.execute_batch(&format!(
                    "create table if not exists {qualified_table} ({create_columns});"
                ))?;
            }
        }

        return Ok(());
    }

    let schema_definition = payload
        .schema_definition
        .as_ref()
        .ok_or_else(|| anyhow!("missing schema_definition payload"))?;
    let table_identifier = quote_duckdb_identifier(payload.table_name.trim());
    let qualified_table = format!("{schema_identifier}.{table_identifier}");
    let create_columns = build_mirrored_schema_table_columns_from_definition(
        &schema_definition.columns,
        &schema_definition.primary_key,
        &schema_definition.checks,
        payload.include_run_id,
        payload.include_written_at,
    )?;

    if matches!(payload.write_mode, MirroredTableOutputWriteMode::Replace) {
        connection.execute_batch(&format!(
            "drop table if exists {qualified_table};
             create table {qualified_table} ({create_columns});"
        ))?;
        return Ok(());
    }

    connection.execute_batch(&format!(
        "create table if not exists {qualified_table} ({create_columns});"
    ))?;

    Ok(())
}

fn materialize_mirrored_source_table_output(
    connection: &DuckDbConnection,
    payload: &MirroredTableOutputPayload,
    run_id: &str,
    materialized_at: &str,
) -> anyhow::Result<()> {
    let schema_identifier = quote_duckdb_identifier(payload.target_schema.trim());
    let table_identifier = quote_duckdb_identifier(payload.table_name.trim());
    let qualified_table = format!("{schema_identifier}.{table_identifier}");
    let source_select = build_mirrored_source_table_select(payload, run_id, materialized_at)?;
    let wrapped_source_select = format!("select * from ({source_select}) as source_rows");

    connection.execute_batch(&format!("create schema if not exists {schema_identifier};"))?;

    if matches!(payload.write_mode, MirroredTableOutputWriteMode::Replace) {
        connection.execute_batch(&format!(
            "drop table if exists {qualified_table};
             create table {qualified_table} as {wrapped_source_select};"
        ))?;
        return Ok(());
    }

    connection.execute_batch(&format!(
        "create table if not exists {qualified_table} as {wrapped_source_select} limit 0;
         insert into {qualified_table} {wrapped_source_select};"
    ))?;

    Ok(())
}

fn materialize_mirrored_table_output(
    connection: &DuckDbConnection,
    snapshot: &RunSnapshot,
    node_run: &api_contract::NodeRunSnapshot,
    materialized_at: &str,
) -> anyhow::Result<()> {
    let Some(payload) = extract_mirrored_table_output_payload(node_run)? else {
        return Ok(());
    };

    let already_materialized: Option<String> = connection
        .query_row(
            "select run_id
             from runs.table_output_materializations
             where run_id = ?1 and node_id = ?2",
            duckdb::params![snapshot.run_id.as_str(), node_run.node_id.as_str()],
            |row| row.get(0),
        )
        .optional()?;
    if already_materialized.is_some() {
        return Ok(());
    }

    if payload.schema_definition.is_some()
        || payload
            .schema_definitions
            .as_ref()
            .map(|definitions| !definitions.is_empty())
            .unwrap_or(false)
    {
        materialize_mirrored_schema_table_output(connection, &payload)?;
    } else if payload.source_table.is_some() {
        materialize_mirrored_source_table_output(
            connection,
            &payload,
            snapshot.run_id.as_str(),
            materialized_at,
        )?;
    } else {
        let qualified_table = ensure_mirrored_table_output_table(connection, &payload)?;
        insert_mirrored_table_output_row(
            connection,
            qualified_table.as_str(),
            &payload,
            snapshot.run_id.as_str(),
            materialized_at,
        )?;
    }

    let write_mode = match payload.write_mode {
        MirroredTableOutputWriteMode::Append => "append",
        MirroredTableOutputWriteMode::Replace => "replace",
    };
    let target_table_label = payload
        .schema_definitions
        .as_ref()
        .filter(|definitions| !definitions.is_empty())
        .map(|definitions| {
            if definitions.len() == 1 {
                definitions[0].table_name.as_str()
            } else {
                "[multiple tables]"
            }
        })
        .unwrap_or(payload.table_name.as_str());

    connection.execute(
        "insert or replace into runs.table_output_materializations (
            run_id,
            node_id,
            target_schema,
            target_table,
            write_mode,
            materialized_at
         )
         values (?1, ?2, ?3, ?4, ?5, ?6)",
        duckdb::params![
            snapshot.run_id.as_str(),
            node_run.node_id.as_str(),
            payload.target_schema.as_str(),
            target_table_label,
            write_mode,
            materialized_at
        ],
    )?;

    Ok(())
}

fn should_sync_workflow_duckdb_run(snapshot: &RunSnapshot) -> bool {
    if !workflow_duckdb_run_sync_enabled() {
        return false;
    }

    !matches!(
        snapshot.status,
        api_contract::RunStatus::Cancelling | api_contract::RunStatus::Cancelled
    )
}

fn workflow_duckdb_run_sync_enabled() -> bool {
    !matches!(
        env::var("STITCHLY_ENABLE_WORKFLOW_RUN_DUCKDB_SYNC")
            .ok()
            .as_deref()
            .map(|value| value.trim().to_ascii_lowercase()),
        Some(value) if matches!(value.as_str(), "0" | "false" | "no" | "off")
    )
}

fn truncate_for_preview(value: &str, max_chars: usize) -> String {
    let mut preview = value.trim().chars().take(max_chars).collect::<String>();
    if value.chars().count() > max_chars {
        preview.push_str("...");
    }
    preview
}

fn build_session_response(
    connection: &Connection,
    user_id: &str,
) -> anyhow::Result<AuthSessionResponse> {
    let user: StoredUser = connection.query_row(
        "select user_id, email, display_name, password_hash, active_workspace_id
         from users where user_id = ?1",
        params![user_id],
        |row| {
            Ok(StoredUser {
                user_id: row.get(0)?,
                email: row.get(1)?,
                display_name: row.get(2)?,
                password_hash: row.get(3)?,
                active_workspace_id: row.get(4)?,
            })
        },
    )?;

    let mut stmt = connection.prepare(
        "select w.workspace_id, w.slug, w.name, m.role
         from workspaces w
         join workspace_memberships m on m.workspace_id = w.workspace_id
         where m.user_id = ?1
         order by w.created_at asc, w.name asc",
    )?;
    let workspaces = stmt
        .query_map(params![user_id], |row| {
            Ok(WorkspaceSummary {
                workspace_id: row.get(0)?,
                slug: row.get(1)?,
                name: row.get(2)?,
                role: role_from_db(&row.get::<_, String>(3)?)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let active_workspace_id = user
        .active_workspace_id
        .filter(|active_id| {
            workspaces
                .iter()
                .any(|workspace| &workspace.workspace_id == active_id)
        })
        .or_else(|| {
            workspaces
                .first()
                .map(|workspace| workspace.workspace_id.clone())
        });

    Ok(AuthSessionResponse {
        authenticated: true,
        user: Some(SessionUserSummary {
            user_id: user.user_id,
            email: user.email,
            display_name: user.display_name,
        }),
        workspaces,
        active_workspace_id,
    })
}

fn ensure_workspace_access(
    connection: &Connection,
    user_id: &str,
    workspace_id: &str,
) -> anyhow::Result<()> {
    let membership: Option<String> = connection
        .query_row(
            "select workspace_id
             from workspace_memberships
             where workspace_id = ?1 and user_id = ?2",
            params![workspace_id, user_id],
            |row| row.get(0),
        )
        .optional()?;

    if membership.is_some() {
        Ok(())
    } else {
        Err(anyhow!("workspace `{workspace_id}` was not found"))
    }
}

fn ensure_workspace_owner(workspace: &WorkspaceSummary, workspace_id: &str) -> anyhow::Result<()> {
    if matches!(workspace.role, WorkspaceMembershipRole::Owner) {
        Ok(())
    } else {
        Err(anyhow!(
            "workspace `{workspace_id}` requires owner role for deletion"
        ))
    }
}

fn workspace_connection_summary_by_id(
    connection: &Connection,
    workspace_id: &str,
    connection_id: &str,
) -> anyhow::Result<Option<WorkspaceConnectionSummary>> {
    connection
        .query_row(
            "select
                workspace_id,
                connection_id,
                connection_kind,
                display_name,
                comment,
                auth_scheme,
                status,
                external_account_label,
                external_account_id,
                capabilities_json,
                scopes_json,
                created_at,
                updated_at,
                last_error_message
             from workspace_connections
             where workspace_id = ?1
               and connection_id = ?2
               and archived_at is null",
            params![workspace_id, connection_id],
            |row| {
                let capabilities_json: String = row.get(9)?;
                let scopes_json: String = row.get(10)?;
                Ok(WorkspaceConnectionSummary {
                    workspace_id: row.get(0)?,
                    connection_id: row.get(1)?,
                    connection_kind: row.get(2)?,
                    display_name: row.get(3)?,
                    comment: row.get(4)?,
                    auth_scheme: row.get(5)?,
                    status: row.get(6)?,
                    external_account_label: row.get(7)?,
                    external_account_id: row.get(8)?,
                    capabilities: serde_json::from_str(&capabilities_json).map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            9,
                            rusqlite::types::Type::Text,
                            Box::new(error),
                        )
                    })?,
                    scopes: serde_json::from_str(&scopes_json).map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            10,
                            rusqlite::types::Type::Text,
                            Box::new(error),
                        )
                    })?,
                    created_at: row.get(11)?,
                    updated_at: row.get(12)?,
                    last_error_message: row.get(13)?,
                })
            },
        )
        .optional()
        .map_err(Into::into)
}

fn normalize_workflow_definition(
    workflow: &WorkflowDefinition,
    workflow_id: &str,
    version: u32,
) -> anyhow::Result<WorkflowDefinition> {
    let trimmed_workflow_id = workflow_id.trim();
    if trimmed_workflow_id.is_empty() {
        return Err(anyhow!("workflow_id cannot be empty"));
    }

    let trimmed_name = workflow.name.trim();
    if trimmed_name.is_empty() {
        return Err(anyhow!("workflow name cannot be empty"));
    }

    Ok(WorkflowDefinition {
        workflow_id: trimmed_workflow_id.to_string(),
        version,
        name: trimmed_name.to_string(),
        description: workflow
            .description
            .as_ref()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        ..workflow.clone()
    })
}

fn workflow_summary(workspace_id: &str, workflow: &WorkflowDefinition) -> WorkflowSummary {
    WorkflowSummary {
        workflow_id: workflow.workflow_id.clone(),
        workspace_id: workspace_id.to_string(),
        name: workflow.name.clone(),
        description: workflow.description.clone(),
        version: workflow.version,
        updated_at: Utc::now().to_rfc3339(),
    }
}

fn ensure_nullable_text_column(
    connection: &Connection,
    table_name: &str,
    column_name: &str,
) -> anyhow::Result<()> {
    ensure_column(connection, table_name, column_name, "text null")
}

fn ensure_nullable_integer_column(
    connection: &Connection,
    table_name: &str,
    column_name: &str,
) -> anyhow::Result<()> {
    ensure_column(connection, table_name, column_name, "integer null")
}

fn ensure_integer_column_with_default(
    connection: &Connection,
    table_name: &str,
    column_name: &str,
    default_value: i64,
) -> anyhow::Result<()> {
    ensure_column(
        connection,
        table_name,
        column_name,
        &format!("integer not null default {default_value}"),
    )
}

fn ensure_column(
    connection: &Connection,
    table_name: &str,
    column_name: &str,
    column_definition: &str,
) -> anyhow::Result<()> {
    let pragma = format!("pragma table_info({table_name})");
    let mut stmt = connection.prepare(&pragma)?;
    let existing_columns = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?;

    if existing_columns
        .iter()
        .any(|existing| existing == column_name)
    {
        return Ok(());
    }

    connection.execute(
        &format!("alter table {table_name} add column {column_name} {column_definition}"),
        [],
    )?;
    Ok(())
}

fn ensure_parent_dir(database_path: &str) -> anyhow::Result<()> {
    let path = Path::new(database_path);
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).with_context(|| {
                format!(
                    "failed to create platform database directory `{}`",
                    parent.display()
                )
            })?;
        }
    }

    Ok(())
}

fn resolve_storage_root(database_path: &str) -> anyhow::Result<PathBuf> {
    if let Ok(explicit_root) = env::var("STITCHLY_STORAGE_ROOT") {
        let root = PathBuf::from(explicit_root);
        if root.as_os_str().is_empty() {
            return Err(anyhow!("STITCHLY_STORAGE_ROOT cannot be empty"));
        }
        return Ok(root);
    }

    if database_path == ":memory:" {
        return Ok(unique_test_storage_root());
    }

    let database_path = Path::new(database_path);
    let parent = database_path.parent().ok_or_else(|| {
        anyhow!(
            "failed to derive storage root from database path `{}`",
            database_path.display()
        )
    })?;

    if parent.as_os_str().is_empty() {
        return env::current_dir().context("failed to resolve current working directory");
    }

    if parent.file_name().and_then(|value| value.to_str()) == Some("platform") {
        if let Some(root) = parent.parent() {
            if root.as_os_str().is_empty() {
                return env::current_dir().context("failed to resolve current working directory");
            }
            return Ok(root.to_path_buf());
        }
    }

    Ok(parent.to_path_buf())
}

fn unique_test_storage_root() -> PathBuf {
    std::env::temp_dir().join(format!("stitchly-test-storage-{}", Uuid::new_v4().simple()))
}

fn initialize_workflow_duckdb(database_path: &Path) -> anyhow::Result<()> {
    let connection = DuckDbConnection::open(database_path).with_context(|| {
        format!(
            "failed to open workflow duckdb at `{}`",
            database_path.display()
        )
    })?;
    connection.execute_batch(
        "
        create schema if not exists runs;
        create schema if not exists staging;
        create schema if not exists tables;
        create schema if not exists outputs;

        create table if not exists runs.workflow_runs (
            run_id varchar primary key,
            workspace_id varchar not null,
            workflow_id varchar not null,
            workflow_version integer not null,
            status varchar not null,
            trigger_kind varchar,
            started_at varchar,
            finished_at varchar,
            duration_ms bigint,
            error_category varchar,
            error_message varchar,
            error_count bigint not null default 0,
            retry_count bigint not null default 0,
            node_count integer not null default 0,
            completed_node_count integer not null default 0,
            snapshot_json text not null,
            created_at varchar not null,
            updated_at varchar not null
        );

        create table if not exists runs.node_runs (
            run_id varchar not null,
            node_id varchar not null,
            type_id varchar not null,
            status varchar not null,
            attempt integer not null default 0,
            started_at varchar,
            finished_at varchar,
            duration_ms bigint,
            log_count bigint not null default 0,
            error_category varchar,
            error_message varchar,
            last_output_json text,
            created_at varchar not null,
            updated_at varchar not null,
            primary key (run_id, node_id)
        );

        create table if not exists outputs.node_outputs (
            run_id varchar not null,
            node_id varchar not null,
            output_data_type varchar not null,
            output_json text not null,
            output_text_preview varchar,
            produced_at varchar not null,
            primary key (run_id, node_id)
        );

        create table if not exists runs.table_output_materializations (
            run_id varchar not null,
            node_id varchar not null,
            target_schema varchar not null,
            target_table varchar not null,
            write_mode varchar not null,
            materialized_at varchar not null,
            primary key (run_id, node_id)
        );
        ",
    )?;

    Ok(())
}

impl PlatformStore {
    fn sync_workflow_duckdb_run(
        &self,
        workspace_id: &str,
        snapshot: &RunSnapshot,
    ) -> anyhow::Result<()> {
        let connection = self.connection();
        let storage_owner_user_id = lookup_workflow_storage_owner_user_id(
            &connection,
            workspace_id,
            snapshot.workflow_id.as_str(),
        )?;
        let duckdb_path = self
            .workflow_root_path(
                storage_owner_user_id.as_str(),
                workspace_id,
                snapshot.workflow_id.as_str(),
            )
            .join("db")
            .join("workflow.duckdb");
        drop(connection);

        if let Some(parent) = duckdb_path.parent() {
            fs::create_dir_all(parent).with_context(|| {
                format!(
                    "failed to create workflow duckdb parent dir at `{}`",
                    parent.display()
                )
            })?;
        }
        initialize_workflow_duckdb(&duckdb_path)?;
        persist_workflow_duckdb_run_snapshot(&duckdb_path, workspace_id, snapshot)
    }
}

fn find_user_by_email(connection: &Connection, email: &str) -> anyhow::Result<Option<StoredUser>> {
    connection
        .query_row(
            "select user_id, email, display_name, password_hash, active_workspace_id
             from users
             where lower(email) = lower(?1)",
            params![email.trim()],
            |row| {
                Ok(StoredUser {
                    user_id: row.get(0)?,
                    email: row.get(1)?,
                    display_name: row.get(2)?,
                    password_hash: row.get(3)?,
                    active_workspace_id: row.get(4)?,
                })
            },
        )
        .optional()
        .map_err(Into::into)
}

fn create_session_record(connection: &Connection, user_id: &str) -> anyhow::Result<String> {
    let session_id = format!("ses_{}", Uuid::new_v4().simple());
    let created_at = Utc::now();
    let expires_at = created_at + Duration::days(SESSION_TTL_DAYS);

    connection.execute(
        "insert into sessions (session_id, user_id, created_at, expires_at)
         values (?1, ?2, ?3, ?4)",
        params![
            session_id,
            user_id,
            created_at.to_rfc3339(),
            expires_at.to_rfc3339()
        ],
    )?;

    Ok(session_id)
}

fn hash_password(password: &str) -> anyhow::Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    Ok(Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map_err(|error| anyhow!("password hashing failed: {error}"))?
        .to_string())
}

#[cfg(test)]
mod tests {
    use std::{fs, process::Command};

    use api_contract::{
        NodeRunSnapshot, NodeRunStatus, RunErrorCategory, RunErrorSummary, RunSnapshot, RunStatus,
        RunTrigger, TriggerKind, WorkspaceCatalogQueryColumn,
    };
    use chrono::{Duration, TimeZone, Utc};
    use duckdb::{Connection as DuckDbConnection, OptionalExt};
    use rusqlite::params;

    use super::{
        normalize_workspace_catalog_query, resolve_duckdb_cli_path, GoogleConnectionTokens,
        GoogleIdentityProfile, PlatformStore,
    };
    use workflow_schema::{
        NodePosition, TypedValue, WorkflowDefinition, WorkflowEdge, WorkflowNode,
    };

    fn table_output_payload(
        target_schema: &str,
        table_name: &str,
        write_mode: &str,
        value_column: &str,
        value_text: &str,
    ) -> TypedValue {
        TypedValue {
            data_type: workflow_schema::DataType::Json,
            value: serde_json::json!({
                "kind": "table_output_write",
                "target_schema": target_schema,
                "table_name": table_name,
                "write_mode": write_mode,
                "input_shape": "single_text_row",
                "value_column": value_column,
                "include_run_id": true,
                "include_written_at": true,
                "open_in_catalog": false,
                "value_text": value_text
            }),
        }
    }

    fn table_output_source_payload(
        target_schema: &str,
        table_name: &str,
        write_mode: &str,
        source_schema: &str,
        source_table: &str,
    ) -> TypedValue {
        TypedValue {
            data_type: workflow_schema::DataType::Json,
            value: serde_json::json!({
                "kind": "table_output_write",
                "target_schema": target_schema,
                "table_name": table_name,
                "write_mode": write_mode,
                "input_shape": "source_table",
                "include_run_id": true,
                "include_written_at": true,
                "open_in_catalog": false,
                "source_table": {
                    "schema_name": source_schema,
                    "table_name": source_table,
                    "selected_columns": ["workflow_id", "status"],
                    "row_filter": "run_id like 'source_%' and status = 'succeeded'",
                    "row_limit": 10
                }
            }),
        }
    }

    fn table_output_schema_payload(
        target_schema: &str,
        table_name: &str,
        write_mode: &str,
        source_schema: &str,
        source_table: &str,
    ) -> TypedValue {
        TypedValue {
            data_type: workflow_schema::DataType::Json,
            value: serde_json::json!({
                "kind": "table_output_write",
                "target_schema": target_schema,
                "table_name": table_name,
                "write_mode": write_mode,
                "input_shape": "table_schema",
                "include_run_id": true,
                "include_written_at": true,
                "open_in_catalog": false,
                "schema_definition": {
                    "columns": [
                        {
                            "name": "order_id",
                            "type": "bigint",
                            "nullable": false,
                            "primary_key": true,
                            "default": null
                        },
                        {
                            "name": "customer_id",
                            "type": "varchar",
                            "nullable": false,
                            "primary_key": false,
                            "default": "'unknown'"
                        }
                    ],
                    "primary_key": ["order_id"],
                    "checks": ["order_id > 0"],
                    "create_mode": "create_if_missing",
                    "if_target_exists": "keep_existing"
                },
                "source_table": {
                    "schema_name": source_schema,
                    "table_name": source_table,
                    "selected_columns": [],
                    "row_filter": null,
                    "row_limit": null
                }
            }),
        }
    }

    fn table_output_multi_schema_payload(target_schema: &str, write_mode: &str) -> TypedValue {
        TypedValue {
            data_type: workflow_schema::DataType::Json,
            value: serde_json::json!({
                "kind": "table_output_write",
                "target_schema": target_schema,
                "table_name": "orders_bootstrap",
                "write_mode": write_mode,
                "input_shape": "table_schema",
                "include_run_id": true,
                "include_written_at": true,
                "open_in_catalog": false,
                "schema_definition": {
                    "columns": [
                        {
                            "name": "order_id",
                            "type": "bigint",
                            "nullable": false,
                            "primary_key": true,
                            "default": null
                        }
                    ],
                    "primary_key": ["order_id"],
                    "checks": [],
                    "create_mode": "create_if_missing",
                    "if_target_exists": "keep_existing"
                },
                "schema_definitions": [
                    {
                        "schema_name": "tables",
                        "table_name": "orders_bootstrap",
                        "output_alias": "orders_definition",
                        "columns": [
                            {
                                "name": "order_id",
                                "type": "bigint",
                                "nullable": false,
                                "primary_key": true,
                                "default": null
                            }
                        ],
                        "primary_key": ["order_id"],
                        "checks": [],
                        "create_mode": "create_if_missing",
                        "if_target_exists": "keep_existing"
                    },
                    {
                        "schema_name": "tables",
                        "table_name": "order_lines_bootstrap",
                        "output_alias": "order_lines_definition",
                        "columns": [
                            {
                                "name": "line_id",
                                "type": "bigint",
                                "nullable": false,
                                "primary_key": true,
                                "default": null
                            },
                            {
                                "name": "order_id",
                                "type": "bigint",
                                "nullable": false,
                                "primary_key": false,
                                "default": null
                            }
                        ],
                        "primary_key": ["line_id"],
                        "checks": [],
                        "create_mode": "create_if_missing",
                        "if_target_exists": "keep_existing"
                    }
                ],
                "source_table": {
                    "schema_name": "tables",
                    "table_name": "orders",
                    "selected_columns": [],
                    "row_filter": null,
                    "row_limit": null
                }
            }),
        }
    }

    fn table_output_three_table_schema_payload(
        target_schema: &str,
        write_mode: &str,
    ) -> TypedValue {
        TypedValue {
            data_type: workflow_schema::DataType::Json,
            value: serde_json::json!({
                "kind": "table_output_write",
                "target_schema": target_schema,
                "table_name": "orders",
                "write_mode": write_mode,
                "input_shape": "table_schema",
                "include_run_id": true,
                "include_written_at": true,
                "open_in_catalog": false,
                "schema_definition": {
                    "columns": [
                        {
                            "name": "order_id",
                            "type": "bigint",
                            "nullable": false,
                            "primary_key": true,
                            "default": null
                        }
                    ],
                    "primary_key": ["order_id"],
                    "checks": [],
                    "create_mode": "create_if_missing",
                    "if_target_exists": "keep_existing"
                },
                "schema_definitions": [
                    {
                        "schema_name": "tables",
                        "table_name": "orders",
                        "output_alias": "orders_definition",
                        "columns": [
                            {
                                "name": "order_id",
                                "type": "bigint",
                                "nullable": false,
                                "primary_key": true,
                                "default": null
                            },
                            {
                                "name": "customer_id",
                                "type": "varchar",
                                "nullable": false,
                                "primary_key": false,
                                "default": null
                            }
                        ],
                        "primary_key": ["order_id"],
                        "checks": [],
                        "create_mode": "create_if_missing",
                        "if_target_exists": "keep_existing"
                    },
                    {
                        "schema_name": "tables",
                        "table_name": "order_lines",
                        "output_alias": "order_lines_definition",
                        "columns": [
                            {
                                "name": "line_id",
                                "type": "bigint",
                                "nullable": false,
                                "primary_key": true,
                                "default": null
                            },
                            {
                                "name": "order_id",
                                "type": "bigint",
                                "nullable": false,
                                "primary_key": false,
                                "default": null
                            }
                        ],
                        "primary_key": ["line_id"],
                        "checks": [],
                        "create_mode": "create_if_missing",
                        "if_target_exists": "keep_existing"
                    },
                    {
                        "schema_name": "tables",
                        "table_name": "order_payments",
                        "output_alias": "order_payments_definition",
                        "columns": [
                            {
                                "name": "payment_id",
                                "type": "bigint",
                                "nullable": false,
                                "primary_key": true,
                                "default": null
                            },
                            {
                                "name": "order_id",
                                "type": "bigint",
                                "nullable": false,
                                "primary_key": false,
                                "default": null
                            }
                        ],
                        "primary_key": ["payment_id"],
                        "checks": [],
                        "create_mode": "create_if_missing",
                        "if_target_exists": "keep_existing"
                    }
                ],
                "source_table": {
                    "schema_name": "tables",
                    "table_name": "orders",
                    "selected_columns": [],
                    "row_filter": null,
                    "row_limit": null
                }
            }),
        }
    }

    #[test]
    fn google_identity_creates_a_local_user_and_session() {
        let store = PlatformStore::for_tests().expect("platform store");

        let session = store
            .authenticate_google_identity(&GoogleIdentityProfile {
                subject: "google-subject-123".to_string(),
                email: "ops@gmail.com".to_string(),
                email_verified: true,
                display_name: "Ops Builder".to_string(),
            })
            .expect("google auth session");

        assert_eq!(
            session.user_id,
            session.session.user.as_ref().expect("user").user_id
        );
        assert_eq!(
            session.session.user.as_ref().expect("user").email,
            "ops@gmail.com"
        );
        assert!(session.session.authenticated);

        let loaded = store
            .load_session(&session.session_id)
            .expect("session lookup")
            .expect("active session");
        assert_eq!(
            loaded.session.user.as_ref().expect("user").display_name,
            "Ops Builder"
        );
    }

    #[test]
    fn google_identity_links_to_an_existing_email_user() {
        let store = PlatformStore::for_tests().expect("platform store");

        let session = store
            .authenticate_google_identity(&GoogleIdentityProfile {
                subject: "google-subject-builder".to_string(),
                email: "builder@stitchly.dev".to_string(),
                email_verified: true,
                display_name: "Builder Google".to_string(),
            })
            .expect("google auth session");

        assert_eq!(session.user_id, "usr_builder");
        assert_eq!(
            session.session.user.as_ref().expect("user").display_name,
            "Builder Google"
        );

        let second_session = store
            .authenticate_google_identity(&GoogleIdentityProfile {
                subject: "google-subject-builder".to_string(),
                email: "builder@stitchly.dev".to_string(),
                email_verified: true,
                display_name: "Builder Google".to_string(),
            })
            .expect("second google auth session");
        assert_eq!(second_session.user_id, "usr_builder");
    }

    #[test]
    fn create_workflow_bootstraps_rooted_storage_and_duckdb() {
        let store = PlatformStore::for_tests().expect("platform store");
        let workspace = store
            .create_workspace("usr_builder", "DuckDB Workspace")
            .expect("workspace");
        let workflow: WorkflowDefinition = serde_json::from_str(include_str!(
            "../../../tests/fixtures/workflows/basic_text_preview.json"
        ))
        .expect("fixture parses");

        let created = store
            .create_workflow("usr_builder", &workspace.workspace_id, &workflow)
            .expect("workflow creates");

        let workflow_root = store.workflow_root_path(
            "usr_builder",
            &workspace.workspace_id,
            created.workflow.workflow_id.as_str(),
        );
        let workflow_json_path = workflow_root.join("workflow.json");
        let duckdb_path = workflow_root.join("db").join("workflow.duckdb");
        let files_dir = workflow_root.join("files");

        assert!(workflow_root.is_dir(), "workflow root should exist");
        assert!(workflow_json_path.is_file(), "workflow.json should exist");
        assert!(duckdb_path.is_file(), "workflow duckdb should exist");
        assert!(files_dir.is_dir(), "files dir should exist");
        assert!(
            files_dir.join("uploads").is_dir(),
            "uploads dir should exist"
        );
        assert!(
            files_dir.join("outputs").is_dir(),
            "outputs dir should exist"
        );
        assert!(
            files_dir.join("artifacts").is_dir(),
            "artifacts dir should exist"
        );

        let workflow_json =
            fs::read_to_string(&workflow_json_path).expect("workflow.json readable");
        let stored_definition: WorkflowDefinition =
            serde_json::from_str(&workflow_json).expect("workflow.json parses");
        assert_eq!(
            stored_definition.workflow_id, created.workflow.workflow_id,
            "workflow.json should match stored workflow id"
        );

        let duckdb = DuckDbConnection::open(&duckdb_path).expect("duckdb opens");
        let schema_names = ["runs", "staging", "tables", "outputs"];
        for schema_name in schema_names {
            let exists: Option<String> = duckdb
                .query_row(
                    "select schema_name
                     from information_schema.schemata
                     where schema_name = ?1",
                    [schema_name],
                    |row| row.get(0),
                )
                .expect("schema query");
            assert_eq!(
                exists.as_deref(),
                Some(schema_name),
                "schema `{schema_name}` should exist"
            );
        }

        let workflow_runs_table_exists: Option<String> = duckdb
            .query_row(
                "select table_name
                 from information_schema.tables
                 where table_schema = 'runs' and table_name = 'workflow_runs'",
                [],
                |row| row.get(0),
            )
            .expect("workflow_runs table query");
        assert_eq!(workflow_runs_table_exists.as_deref(), Some("workflow_runs"));

        let node_runs_table_exists: Option<String> = duckdb
            .query_row(
                "select table_name
                 from information_schema.tables
                 where table_schema = 'runs' and table_name = 'node_runs'",
                [],
                |row| row.get(0),
            )
            .expect("node_runs table query");
        assert_eq!(node_runs_table_exists.as_deref(), Some("node_runs"));

        let node_outputs_table_exists: Option<String> = duckdb
            .query_row(
                "select table_name
                 from information_schema.tables
                 where table_schema = 'outputs' and table_name = 'node_outputs'",
                [],
                |row| row.get(0),
            )
            .expect("node_outputs table query");
        assert_eq!(node_outputs_table_exists.as_deref(), Some("node_outputs"));
    }

    #[test]
    fn deleting_a_workspace_removes_its_storage_root() {
        let store = PlatformStore::for_tests().expect("platform store");
        let workspace = store
            .create_workspace("usr_builder", "Workspace To Delete")
            .expect("workspace");
        let workflow: WorkflowDefinition = serde_json::from_str(include_str!(
            "../../../tests/fixtures/workflows/basic_text_preview.json"
        ))
        .expect("fixture parses");

        let created = store
            .create_workflow("usr_builder", &workspace.workspace_id, &workflow)
            .expect("workflow creates");
        let workspace_root = store.workspace_root_path("usr_builder", &workspace.workspace_id);
        let workflow_root = store.workflow_root_path(
            "usr_builder",
            &workspace.workspace_id,
            created.workflow.workflow_id.as_str(),
        );

        assert!(workspace_root.is_dir(), "workspace root should exist");
        assert!(workflow_root.is_dir(), "workflow root should exist");

        let deleted = store
            .delete_workspace("usr_builder", &workspace.workspace_id)
            .expect("workspace deletion succeeds")
            .expect("workspace exists");

        assert_eq!(deleted.workspace_id, workspace.workspace_id);
        assert!(deleted.deleted);
        assert!(
            store
                .get_workspace("usr_builder", &workspace.workspace_id)
                .expect("workspace lookup succeeds")
                .is_none(),
            "workspace should be removed from metadata"
        );
        assert!(
            !workspace_root.exists(),
            "workspace storage root should be removed"
        );
    }

    #[test]
    fn workspace_catalog_lists_workflow_duckdbs_across_workflows() {
        let store = PlatformStore::for_tests().expect("platform store");
        let workspace = store
            .create_workspace("usr_builder", "Catalog Workspace")
            .expect("workspace");

        let mut first_workflow: WorkflowDefinition = serde_json::from_str(include_str!(
            "../../../tests/fixtures/workflows/basic_text_preview.json"
        ))
        .expect("fixture parses");
        first_workflow.workflow_id = "wf_catalog_alpha".to_string();
        first_workflow.name = "Catalog Alpha".to_string();
        let created_first = store
            .create_workflow("usr_builder", &workspace.workspace_id, &first_workflow)
            .expect("first workflow creates");

        let mut second_workflow = first_workflow.clone();
        second_workflow.workflow_id = "wf_catalog_beta".to_string();
        second_workflow.name = "Catalog Beta".to_string();
        let created_second = store
            .create_workflow("usr_builder", &workspace.workspace_id, &second_workflow)
            .expect("second workflow creates");

        let second_workflow_root = store.workflow_root_path(
            "usr_builder",
            &workspace.workspace_id,
            created_second.workflow.workflow_id.as_str(),
        );
        let second_duckdb_path = second_workflow_root.join("db").join("workflow.duckdb");
        let second_duckdb = DuckDbConnection::open(&second_duckdb_path).expect("duckdb opens");
        second_duckdb
            .execute_batch(
                "
                create table if not exists tables.customer_orders (
                    order_id integer,
                    status varchar
                );
                ",
            )
            .expect("table bootstrap");

        let catalog = store
            .list_workspace_catalogs("usr_builder", &workspace.workspace_id)
            .expect("workspace catalog");

        assert_eq!(catalog.catalogs.len(), 2);

        let first_catalog = catalog
            .catalogs
            .iter()
            .find(|entry| entry.workflow_id == created_first.workflow.workflow_id)
            .expect("first catalog present");
        assert_eq!(first_catalog.database_name, "workflow.duckdb");
        assert!(first_catalog
            .schemas
            .iter()
            .any(|schema| schema.schema_name == "runs"));
        assert!(first_catalog
            .schemas
            .iter()
            .any(|schema| schema.schema_name == "outputs"));

        let second_catalog = catalog
            .catalogs
            .iter()
            .find(|entry| entry.workflow_id == created_second.workflow.workflow_id)
            .expect("second catalog present");
        let tables_schema = second_catalog
            .schemas
            .iter()
            .find(|schema| schema.schema_name == "tables")
            .expect("tables schema present");
        assert!(tables_schema
            .tables
            .iter()
            .any(|table| table.table_name == "customer_orders"));
    }

    #[test]
    fn workspace_catalog_table_returns_columns() {
        let store = PlatformStore::for_tests().expect("platform store");
        let workspace = store
            .create_workspace("usr_builder", "Catalog Preview Workspace")
            .expect("workspace");
        let mut workflow: WorkflowDefinition = serde_json::from_str(include_str!(
            "../../../tests/fixtures/workflows/basic_text_preview.json"
        ))
        .expect("fixture parses");
        workflow.workflow_id = "wf_catalog_preview".to_string();
        workflow.name = "Catalog Preview".to_string();

        let created = store
            .create_workflow("usr_builder", &workspace.workspace_id, &workflow)
            .expect("workflow creates");

        let workflow_root = store.workflow_root_path(
            "usr_builder",
            &workspace.workspace_id,
            created.workflow.workflow_id.as_str(),
        );
        let duckdb_path = workflow_root.join("db").join("workflow.duckdb");
        let duckdb = DuckDbConnection::open(&duckdb_path).expect("duckdb opens");
        duckdb
            .execute_batch(
                "
                create table if not exists tables.customer_orders (
                    order_id integer,
                    customer_name varchar,
                    is_priority boolean
                );
                insert into tables.customer_orders values
                    (1, 'Acme', true),
                    (2, 'Globex', false);
                ",
            )
            .expect("sample table persists");

        let schema = store
            .get_workspace_catalog_schema(
                "usr_builder",
                &workspace.workspace_id,
                created.workflow.workflow_id.as_str(),
                "tables",
            )
            .expect("schema lookup")
            .expect("schema exists");
        assert!(schema
            .tables
            .iter()
            .any(|table| table.table_name == "customer_orders"));

        let table = store
            .get_workspace_catalog_table(
                "usr_builder",
                &workspace.workspace_id,
                created.workflow.workflow_id.as_str(),
                "tables",
                "customer_orders",
            )
            .expect("table lookup")
            .expect("table exists");
        assert_eq!(table.columns.len(), 3);
        assert_eq!(table.columns[0].column_name, "order_id");
        assert_eq!(table.columns[0].data_type, "INTEGER");
        assert!(table.sample_rows.is_empty());
    }

    #[test]
    fn workspace_catalog_table_skips_sample_rows_for_safety() {
        let store = PlatformStore::for_tests().expect("platform store");
        let workspace = store
            .create_workspace("usr_builder", "Catalog JSON Preview Workspace")
            .expect("workspace");
        let mut workflow: WorkflowDefinition = serde_json::from_str(include_str!(
            "../../../tests/fixtures/workflows/basic_text_preview.json"
        ))
        .expect("fixture parses");
        workflow.workflow_id = "wf_catalog_json_preview".to_string();
        workflow.name = "Catalog JSON Preview".to_string();

        let created = store
            .create_workflow("usr_builder", &workspace.workspace_id, &workflow)
            .expect("workflow creates");

        let workflow_root = store.workflow_root_path(
            "usr_builder",
            &workspace.workspace_id,
            created.workflow.workflow_id.as_str(),
        );
        let duckdb_path = workflow_root.join("db").join("workflow.duckdb");
        let duckdb = DuckDbConnection::open(&duckdb_path).expect("duckdb opens");
        duckdb
            .execute_batch(
                "
                create table if not exists outputs.preview_payloads (
                    run_id varchar,
                    output_json text
                );
                insert into outputs.preview_payloads values
                    ('run_1', '{\"large\":true,\"payload\":\"hello\"}');
                ",
            )
            .expect("sample table persists");

        let table = store
            .get_workspace_catalog_table(
                "usr_builder",
                &workspace.workspace_id,
                created.workflow.workflow_id.as_str(),
                "outputs",
                "preview_payloads",
            )
            .expect("table lookup")
            .expect("table exists");
        assert!(table.sample_rows.is_empty());
    }

    #[test]
    fn workspace_catalog_query_runs_against_table_preview_with_row_cap() {
        if Command::new(resolve_duckdb_cli_path())
            .arg("--version")
            .output()
            .is_err()
        {
            eprintln!("skipping catalog query test because the DuckDB CLI is unavailable");
            return;
        }

        let store = PlatformStore::for_tests().expect("platform store");
        let workspace = store
            .create_workspace("usr_builder", "Catalog Query Workspace")
            .expect("workspace");
        let mut workflow: WorkflowDefinition = serde_json::from_str(include_str!(
            "../../../tests/fixtures/workflows/basic_text_preview.json"
        ))
        .expect("fixture parses");
        workflow.workflow_id = "wf_catalog_query_preview".to_string();
        workflow.name = "Catalog Query Preview".to_string();

        let created = store
            .create_workflow("usr_builder", &workspace.workspace_id, &workflow)
            .expect("workflow creates");

        let workflow_root = store.workflow_root_path(
            "usr_builder",
            &workspace.workspace_id,
            created.workflow.workflow_id.as_str(),
        );
        let duckdb_path = workflow_root.join("db").join("workflow.duckdb");
        let duckdb = DuckDbConnection::open(&duckdb_path).expect("duckdb opens");
        duckdb
            .execute_batch(
                "
                create table if not exists tables.customer_orders (
                    order_id integer,
                    customer_name varchar
                );
                insert into tables.customer_orders
                select value as order_id, concat('Customer ', value::varchar)
                from range(0, 1005) as generated(value);
                ",
            )
            .expect("sample table persists");

        let response = store
            .run_workspace_catalog_query(
                "usr_builder",
                &workspace.workspace_id,
                created.workflow.workflow_id.as_str(),
                "select order_id, customer_name from tables.customer_orders order by order_id",
            )
            .expect("query succeeds")
            .expect("workflow exists");

        assert_eq!(
            response.columns,
            vec![
                WorkspaceCatalogQueryColumn {
                    column_name: "order_id".to_string(),
                    data_type: "INTEGER".to_string(),
                },
                WorkspaceCatalogQueryColumn {
                    column_name: "customer_name".to_string(),
                    data_type: "VARCHAR".to_string(),
                },
            ]
        );
        assert_eq!(response.rows.len(), 1000);
        assert_eq!(
            response.rows.first(),
            Some(&vec![Some("0".to_string()), Some("Customer 0".to_string())])
        );
    }

    #[test]
    fn workspace_catalog_query_rejects_non_select_sql() {
        let error = normalize_workspace_catalog_query("delete from tables.customer_orders")
            .expect_err("query should be rejected");
        assert!(
            error
                .to_string()
                .contains("Only read-only SELECT queries are supported"),
            "unexpected message: {error}"
        );
    }

    #[test]
    fn workspace_catalog_delete_preview_reports_affected_workflow_nodes() {
        let store = PlatformStore::for_tests().expect("platform store");
        let workspace = store
            .create_workspace("usr_builder", "Catalog Delete Preview Workspace")
            .expect("workspace");
        let workflow = WorkflowDefinition {
            schema_version: 1,
            workflow_id: "wf_catalog_delete_preview".to_string(),
            version: 1,
            name: "Catalog Delete Preview".to_string(),
            description: None,
            nodes: vec![
                WorkflowNode {
                    node_id: "table_input_digest".to_string(),
                    type_id: "table_input".to_string(),
                    definition_version: 1,
                    label: Some("Table Input".to_string()),
                    config: serde_json::json!({
                        "catalog": "workflow.duckdb",
                        "schema_name": "tables",
                        "table_name": "daily_digest",
                        "output_alias": "daily_digest"
                    }),
                    position: NodePosition::default(),
                },
                WorkflowNode {
                    node_id: "table_output_digest".to_string(),
                    type_id: "table_output".to_string(),
                    definition_version: 1,
                    label: Some("Table Output".to_string()),
                    config: serde_json::json!({
                        "target_schema": "tables",
                        "table_name": "daily_digest",
                        "write_mode": "replace",
                        "input_shape": "source_table"
                    }),
                    position: NodePosition::default(),
                },
            ],
            edges: vec![WorkflowEdge {
                edge_id: "edge_table_input_to_table_output".to_string(),
                source_node_id: "table_input_digest".to_string(),
                source_port_id: "table".to_string(),
                target_node_id: "table_output_digest".to_string(),
                target_port_id: "text".to_string(),
            }],
            metadata: Default::default(),
        };

        let created = store
            .create_workflow("usr_builder", &workspace.workspace_id, &workflow)
            .expect("workflow creates");
        let duckdb_path = store
            .workflow_root_path(
                "usr_builder",
                &workspace.workspace_id,
                created.workflow.workflow_id.as_str(),
            )
            .join("db")
            .join("workflow.duckdb");
        let duckdb = DuckDbConnection::open(&duckdb_path).expect("duckdb opens");
        duckdb
            .execute_batch(
                "create table if not exists tables.daily_digest (message varchar not null)",
            )
            .expect("digest table persists");

        let preview = store
            .preview_workspace_catalog_table_delete(
                "usr_builder",
                &workspace.workspace_id,
                created.workflow.workflow_id.as_str(),
                "tables",
                "daily_digest",
            )
            .expect("preview succeeds")
            .expect("table exists");

        assert!(preview.is_deletable);
        assert_eq!(preview.affected_workflows.len(), 1);
        assert_eq!(
            preview.affected_workflows[0]
                .nodes
                .iter()
                .map(|node| node.usage_kind.as_str())
                .collect::<Vec<_>>(),
            vec!["source", "target"]
        );
    }

    #[test]
    fn deleting_catalog_table_invalidates_matching_workflow_and_removes_table() {
        let store = PlatformStore::for_tests().expect("platform store");
        let workspace = store
            .create_workspace("usr_builder", "Catalog Delete Workspace")
            .expect("workspace");
        let workflow = WorkflowDefinition {
            schema_version: 1,
            workflow_id: "wf_catalog_delete_apply".to_string(),
            version: 1,
            name: "Catalog Delete Apply".to_string(),
            description: None,
            nodes: vec![
                WorkflowNode {
                    node_id: "table_input_digest".to_string(),
                    type_id: "table_input".to_string(),
                    definition_version: 1,
                    label: Some("Table Input".to_string()),
                    config: serde_json::json!({
                        "catalog": "workflow.duckdb",
                        "schema_name": "tables",
                        "table_name": "daily_digest",
                        "output_alias": "daily_digest"
                    }),
                    position: NodePosition::default(),
                },
                WorkflowNode {
                    node_id: "table_output_digest".to_string(),
                    type_id: "table_output".to_string(),
                    definition_version: 1,
                    label: Some("Table Output".to_string()),
                    config: serde_json::json!({
                        "target_schema": "tables",
                        "table_name": "daily_digest",
                        "write_mode": "replace",
                        "input_shape": "source_table"
                    }),
                    position: NodePosition::default(),
                },
            ],
            edges: vec![],
            metadata: Default::default(),
        };

        let created = store
            .create_workflow("usr_builder", &workspace.workspace_id, &workflow)
            .expect("workflow creates");
        let workflow_root = store.workflow_root_path(
            "usr_builder",
            &workspace.workspace_id,
            created.workflow.workflow_id.as_str(),
        );
        let duckdb_path = workflow_root.join("db").join("workflow.duckdb");
        let duckdb = DuckDbConnection::open(&duckdb_path).expect("duckdb opens");
        duckdb
            .execute_batch(
                "create table if not exists tables.daily_digest (message varchar not null)",
            )
            .expect("digest table persists");
        drop(duckdb);

        let deleted = store
            .delete_workspace_catalog_table(
                "usr_builder",
                &workspace.workspace_id,
                created.workflow.workflow_id.as_str(),
                "tables",
                "daily_digest",
            )
            .expect("delete succeeds")
            .expect("table exists");

        assert!(deleted.deleted);
        assert_eq!(deleted.invalidated_workflows.len(), 1);

        let updated = store
            .get_workflow(
                "usr_builder",
                &workspace.workspace_id,
                created.workflow.workflow_id.as_str(),
            )
            .expect("workflow loads")
            .expect("workflow exists");
        let table_input = updated
            .definition
            .nodes
            .iter()
            .find(|node| node.node_id == "table_input_digest")
            .expect("table input node");
        assert!(table_input.config.get("schema_name").unwrap().is_null());
        assert!(table_input.config.get("table_name").unwrap().is_null());

        let table_output = updated
            .definition
            .nodes
            .iter()
            .find(|node| node.node_id == "table_output_digest")
            .expect("table output node");
        assert!(table_output.config.get("target_schema").unwrap().is_null());
        assert!(table_output.config.get("table_name").unwrap().is_null());

        let stored_workflow_json = fs::read_to_string(workflow_root.join("workflow.json"))
            .expect("workflow.json readable");
        let stored_definition: WorkflowDefinition =
            serde_json::from_str(&stored_workflow_json).expect("workflow json parses");
        let stored_table_input = stored_definition
            .nodes
            .iter()
            .find(|node| node.node_id == "table_input_digest")
            .expect("stored table input node");
        assert!(stored_table_input
            .config
            .get("schema_name")
            .unwrap()
            .is_null());
        assert!(stored_table_input
            .config
            .get("table_name")
            .unwrap()
            .is_null());

        let duckdb = DuckDbConnection::open(&duckdb_path).expect("duckdb reopens");
        let table_exists: Option<String> = duckdb
            .query_row(
                "select table_name
                 from information_schema.tables
                 where table_schema = 'tables' and table_name = 'daily_digest'",
                [],
                |row| row.get(0),
            )
            .optional()
            .expect("table exists query");
        assert!(table_exists.is_none());
    }

    #[test]
    fn run_snapshot_populates_denormalized_run_list_columns() {
        let store = PlatformStore::for_tests().expect("platform store");
        let workspace = store
            .create_workspace("usr_builder", "Run Metrics Workspace")
            .expect("workspace");
        let mut workflow: WorkflowDefinition = serde_json::from_str(include_str!(
            "../../../tests/fixtures/workflows/basic_text_preview.json"
        ))
        .expect("fixture parses");
        workflow.name = "Email Draft Flow".to_string();

        let created = store
            .create_workflow("usr_builder", &workspace.workspace_id, &workflow)
            .expect("workflow creates");

        let started_at = Utc
            .with_ymd_and_hms(2026, 5, 26, 9, 0, 0)
            .single()
            .expect("valid datetime");
        let finished_at = started_at + Duration::seconds(5);
        let snapshot = RunSnapshot {
            run_id: "run_test_projection".to_string(),
            workflow_id: created.workflow.workflow_id.clone(),
            workflow_version: created.workflow.version,
            status: RunStatus::Failed,
            trigger: RunTrigger {
                kind: TriggerKind::Manual,
            },
            started_at: Some(started_at),
            finished_at: Some(finished_at),
            node_runs: vec![
                NodeRunSnapshot {
                    node_id: "input_text".to_string(),
                    type_id: "text_input".to_string(),
                    status: NodeRunStatus::Succeeded,
                    attempt: 1,
                    started_at: Some(started_at),
                    finished_at: Some(started_at + Duration::seconds(1)),
                    last_output: None,
                    log_count: 1,
                    error: None,
                },
                NodeRunSnapshot {
                    node_id: "send_email_notification".to_string(),
                    type_id: "send_email".to_string(),
                    status: NodeRunStatus::Failed,
                    attempt: 3,
                    started_at: Some(started_at + Duration::seconds(1)),
                    finished_at: Some(finished_at),
                    last_output: None,
                    log_count: 2,
                    error: Some(RunErrorSummary {
                        category: RunErrorCategory::ExecutionError,
                        message: "SMTP timeout".to_string(),
                    }),
                },
            ],
            logs: vec![],
            error: Some(RunErrorSummary {
                category: RunErrorCategory::ExecutionError,
                message: "SMTP timeout".to_string(),
            }),
        };

        store
            .persist_run_snapshot(&workspace.workspace_id, Some("usr_builder"), &snapshot)
            .expect("run snapshot persists");

        let connection = store.connection();
        let row = connection
            .query_row(
                "select workflow_name_at_run, duration_ms, error_count, retry_count, error_message
                 from runs
                 where workspace_id = ?1 and run_id = ?2",
                params![workspace.workspace_id, snapshot.run_id],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, Option<i64>>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, i64>(3)?,
                        row.get::<_, Option<String>>(4)?,
                    ))
                },
            )
            .expect("run row");

        assert_eq!(row.0.as_deref(), Some("Email Draft Flow"));
        assert_eq!(row.1, Some(5_000));
        assert_eq!(row.2, 1);
        assert_eq!(row.3, 2);
        assert_eq!(row.4.as_deref(), Some("SMTP timeout"));
    }

    #[test]
    fn run_snapshot_mirrors_into_workflow_duckdb_by_default() {
        let store = PlatformStore::for_tests().expect("platform store");
        let workspace = store
            .create_workspace("usr_builder", "Workflow Mirror Workspace")
            .expect("workspace");
        let mut workflow: WorkflowDefinition = serde_json::from_str(include_str!(
            "../../../tests/fixtures/workflows/basic_text_preview.json"
        ))
        .expect("fixture parses");
        workflow.name = "Mirrored Flow".to_string();

        let created = store
            .create_workflow("usr_builder", &workspace.workspace_id, &workflow)
            .expect("workflow creates");

        let started_at = Utc
            .with_ymd_and_hms(2026, 5, 26, 10, 30, 0)
            .single()
            .expect("valid datetime");
        let finished_at = started_at + Duration::seconds(4);
        let snapshot = RunSnapshot {
            run_id: "run_duckdb_sync".to_string(),
            workflow_id: created.workflow.workflow_id.clone(),
            workflow_version: created.workflow.version,
            status: RunStatus::Succeeded,
            trigger: RunTrigger {
                kind: TriggerKind::Manual,
            },
            started_at: Some(started_at),
            finished_at: Some(finished_at),
            node_runs: vec![
                NodeRunSnapshot {
                    node_id: "input_text".to_string(),
                    type_id: "text_input".to_string(),
                    status: NodeRunStatus::Succeeded,
                    attempt: 1,
                    started_at: Some(started_at),
                    finished_at: Some(started_at + Duration::seconds(1)),
                    last_output: Some(TypedValue::text("Hello from workflow db")),
                    log_count: 1,
                    error: None,
                },
                NodeRunSnapshot {
                    node_id: "send_email_notification".to_string(),
                    type_id: "send_email".to_string(),
                    status: NodeRunStatus::Succeeded,
                    attempt: 1,
                    started_at: Some(started_at + Duration::seconds(1)),
                    finished_at: Some(finished_at),
                    last_output: Some(TypedValue::text("Mock email delivered")),
                    log_count: 2,
                    error: None,
                },
            ],
            logs: vec![],
            error: None,
        };

        store
            .persist_run_snapshot(&workspace.workspace_id, Some("usr_builder"), &snapshot)
            .expect("run snapshot persists");

        let workflow_root = store.workflow_root_path(
            "usr_builder",
            &workspace.workspace_id,
            created.workflow.workflow_id.as_str(),
        );
        let duckdb_path = workflow_root.join("db").join("workflow.duckdb");
        let duckdb = DuckDbConnection::open(&duckdb_path).expect("duckdb opens");

        let workflow_run_rows: i64 = duckdb
            .query_row(
                "select count(*)
                 from runs.workflow_runs
                 where run_id = ?1",
                [snapshot.run_id.as_str()],
                |row| row.get(0),
            )
            .expect("workflow run row count");
        assert_eq!(workflow_run_rows, 1);

        let node_run_count: i64 = duckdb
            .query_row(
                "select count(*)
                 from runs.node_runs
                 where run_id = ?1",
                [snapshot.run_id.as_str()],
                |row| row.get(0),
            )
            .expect("node run count");
        assert_eq!(node_run_count, 2);

        let mirrored_output_rows: i64 = duckdb
            .query_row(
                "select count(*)
                 from outputs.node_outputs
                 where run_id = ?1",
                [snapshot.run_id.as_str()],
                |row| row.get(0),
            )
            .expect("mirrored output row count");
        assert_eq!(mirrored_output_rows, 2);
    }

    #[test]
    fn cancelled_run_updates_do_not_duplicate_mirrored_rows() {
        let store = PlatformStore::for_tests().expect("platform store");
        let workspace = store
            .create_workspace("usr_builder", "DuckDB Idempotent Workspace")
            .expect("workspace");
        let mut workflow: WorkflowDefinition = serde_json::from_str(include_str!(
            "../../../tests/fixtures/workflows/basic_text_preview.json"
        ))
        .expect("fixture parses");
        workflow.name = "Repeat Sync Flow".to_string();

        let created = store
            .create_workflow("usr_builder", &workspace.workspace_id, &workflow)
            .expect("workflow creates");

        let started_at = Utc
            .with_ymd_and_hms(2026, 5, 26, 11, 45, 0)
            .single()
            .expect("valid datetime");
        let snapshot_running = RunSnapshot {
            run_id: "run_repeat_sync".to_string(),
            workflow_id: created.workflow.workflow_id.clone(),
            workflow_version: created.workflow.version,
            status: RunStatus::Running,
            trigger: RunTrigger {
                kind: TriggerKind::Manual,
            },
            started_at: Some(started_at),
            finished_at: None,
            node_runs: vec![NodeRunSnapshot {
                node_id: "input_text".to_string(),
                type_id: "text_input".to_string(),
                status: NodeRunStatus::Running,
                attempt: 1,
                started_at: Some(started_at),
                finished_at: None,
                last_output: None,
                log_count: 1,
                error: None,
            }],
            logs: vec![],
            error: None,
        };

        store
            .persist_run_snapshot(
                &workspace.workspace_id,
                Some("usr_builder"),
                &snapshot_running,
            )
            .expect("running snapshot persists");

        let mut snapshot_cancelled = snapshot_running.clone();
        snapshot_cancelled.status = RunStatus::Cancelled;
        snapshot_cancelled.finished_at = Some(started_at + Duration::seconds(3));
        snapshot_cancelled.error = Some(RunErrorSummary {
            category: RunErrorCategory::Cancellation,
            message: "Run cancelled by user.".to_string(),
        });
        snapshot_cancelled.node_runs[0].status = NodeRunStatus::Cancelled;
        snapshot_cancelled.node_runs[0].finished_at = snapshot_cancelled.finished_at;
        snapshot_cancelled.node_runs[0].error = snapshot_cancelled.error.clone();

        store
            .persist_run_snapshot(
                &workspace.workspace_id,
                Some("usr_builder"),
                &snapshot_cancelled,
            )
            .expect("cancelled snapshot persists");

        let workflow_root = store.workflow_root_path(
            "usr_builder",
            &workspace.workspace_id,
            created.workflow.workflow_id.as_str(),
        );
        let duckdb_path = workflow_root.join("db").join("workflow.duckdb");
        let duckdb = DuckDbConnection::open(&duckdb_path).expect("duckdb opens");

        let workflow_run_rows: i64 = duckdb
            .query_row(
                "select count(*)
                 from runs.workflow_runs
                 where run_id = ?1",
                [snapshot_cancelled.run_id.as_str()],
                |row| row.get(0),
            )
            .expect("workflow run row count");
        assert_eq!(workflow_run_rows, 1);
    }

    #[test]
    fn table_output_snapshot_writes_to_the_configured_target_table() {
        let store = PlatformStore::for_tests().expect("platform store");
        let workspace = store
            .create_workspace("usr_builder", "Table Output Workspace")
            .expect("workspace");
        let workflow: WorkflowDefinition = serde_json::from_str(include_str!(
            "../../../tests/fixtures/workflows/basic_text_preview.json"
        ))
        .expect("fixture parses");
        let created = store
            .create_workflow("usr_builder", &workspace.workspace_id, &workflow)
            .expect("workflow creates");

        let started_at = Utc
            .with_ymd_and_hms(2026, 6, 3, 12, 0, 0)
            .single()
            .expect("valid datetime");
        let finished_at = started_at + Duration::seconds(2);
        let snapshot = RunSnapshot {
            run_id: "run_table_output_target".to_string(),
            workflow_id: created.workflow.workflow_id.clone(),
            workflow_version: created.workflow.version,
            status: RunStatus::Succeeded,
            trigger: RunTrigger {
                kind: TriggerKind::Manual,
            },
            started_at: Some(started_at),
            finished_at: Some(finished_at),
            node_runs: vec![NodeRunSnapshot {
                node_id: "table_output_news_brief".to_string(),
                type_id: "table_output".to_string(),
                status: NodeRunStatus::Succeeded,
                attempt: 1,
                started_at: Some(started_at),
                finished_at: Some(finished_at),
                last_output: Some(table_output_payload(
                    "outputs",
                    "news_brief",
                    "append",
                    "content",
                    "Finance headline digest",
                )),
                log_count: 1,
                error: None,
            }],
            logs: vec![],
            error: None,
        };

        store
            .persist_run_snapshot(&workspace.workspace_id, Some("usr_builder"), &snapshot)
            .expect("run snapshot persists");

        let workflow_root = store.workflow_root_path(
            "usr_builder",
            &workspace.workspace_id,
            created.workflow.workflow_id.as_str(),
        );
        let duckdb_path = workflow_root.join("db").join("workflow.duckdb");
        let duckdb = DuckDbConnection::open(&duckdb_path).expect("duckdb opens");

        let row: (String, String, String) = duckdb
            .query_row(
                "select run_id, written_at, content
                 from outputs.news_brief
                 limit 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("target row exists");

        assert_eq!(row.0, snapshot.run_id);
        assert!(!row.1.is_empty());
        assert_eq!(row.2, "Finance headline digest");
    }

    #[test]
    fn table_output_replace_mode_overwrites_previous_target_rows() {
        let store = PlatformStore::for_tests().expect("platform store");
        let workspace = store
            .create_workspace("usr_builder", "Table Output Replace Workspace")
            .expect("workspace");
        let workflow: WorkflowDefinition = serde_json::from_str(include_str!(
            "../../../tests/fixtures/workflows/basic_text_preview.json"
        ))
        .expect("fixture parses");
        let created = store
            .create_workflow("usr_builder", &workspace.workspace_id, &workflow)
            .expect("workflow creates");

        let started_at = Utc
            .with_ymd_and_hms(2026, 6, 3, 12, 15, 0)
            .single()
            .expect("valid datetime");
        let snapshot_one = RunSnapshot {
            run_id: "run_replace_first".to_string(),
            workflow_id: created.workflow.workflow_id.clone(),
            workflow_version: created.workflow.version,
            status: RunStatus::Succeeded,
            trigger: RunTrigger {
                kind: TriggerKind::Manual,
            },
            started_at: Some(started_at),
            finished_at: Some(started_at + Duration::seconds(1)),
            node_runs: vec![NodeRunSnapshot {
                node_id: "table_output_news_brief".to_string(),
                type_id: "table_output".to_string(),
                status: NodeRunStatus::Succeeded,
                attempt: 1,
                started_at: Some(started_at),
                finished_at: Some(started_at + Duration::seconds(1)),
                last_output: Some(table_output_payload(
                    "tables",
                    "daily_digest",
                    "replace",
                    "content",
                    "First digest",
                )),
                log_count: 1,
                error: None,
            }],
            logs: vec![],
            error: None,
        };
        let snapshot_two = RunSnapshot {
            run_id: "run_replace_second".to_string(),
            workflow_id: created.workflow.workflow_id.clone(),
            workflow_version: created.workflow.version,
            status: RunStatus::Succeeded,
            trigger: RunTrigger {
                kind: TriggerKind::Manual,
            },
            started_at: Some(started_at + Duration::seconds(10)),
            finished_at: Some(started_at + Duration::seconds(11)),
            node_runs: vec![NodeRunSnapshot {
                node_id: "table_output_news_brief".to_string(),
                type_id: "table_output".to_string(),
                status: NodeRunStatus::Succeeded,
                attempt: 1,
                started_at: Some(started_at + Duration::seconds(10)),
                finished_at: Some(started_at + Duration::seconds(11)),
                last_output: Some(table_output_payload(
                    "tables",
                    "daily_digest",
                    "replace",
                    "content",
                    "Second digest",
                )),
                log_count: 1,
                error: None,
            }],
            logs: vec![],
            error: None,
        };

        store
            .persist_run_snapshot(&workspace.workspace_id, Some("usr_builder"), &snapshot_one)
            .expect("first run snapshot persists");
        store
            .persist_run_snapshot(&workspace.workspace_id, Some("usr_builder"), &snapshot_two)
            .expect("second run snapshot persists");

        let workflow_root = store.workflow_root_path(
            "usr_builder",
            &workspace.workspace_id,
            created.workflow.workflow_id.as_str(),
        );
        let duckdb_path = workflow_root.join("db").join("workflow.duckdb");
        let duckdb = DuckDbConnection::open(&duckdb_path).expect("duckdb opens");

        let row_count: i64 = duckdb
            .query_row("select count(*) from tables.daily_digest", [], |row| {
                row.get(0)
            })
            .expect("target row count");
        let latest_content: String = duckdb
            .query_row(
                "select content
                 from tables.daily_digest
                 limit 1",
                [],
                |row| row.get(0),
            )
            .expect("target row exists");

        assert_eq!(row_count, 1);
        assert_eq!(latest_content, "Second digest");
    }

    #[test]
    fn table_output_source_table_materialization_copies_filtered_rows_into_target_table() {
        let store = PlatformStore::for_tests().expect("platform store");
        let workspace = store
            .create_workspace("usr_builder", "Table Input Output Workspace")
            .expect("workspace");
        let workflow: WorkflowDefinition = serde_json::from_str(include_str!(
            "../../../tests/fixtures/workflows/basic_text_preview.json"
        ))
        .expect("fixture parses");
        let created = store
            .create_workflow("usr_builder", &workspace.workspace_id, &workflow)
            .expect("workflow creates");

        let workflow_root = store.workflow_root_path(
            "usr_builder",
            &workspace.workspace_id,
            created.workflow.workflow_id.as_str(),
        );
        let duckdb_path = workflow_root.join("db").join("workflow.duckdb");
        let duckdb = DuckDbConnection::open(&duckdb_path).expect("duckdb opens");

        for (run_id, status, error_category, error_message) in [
            ("source_run_one", "succeeded", None::<&str>, None::<&str>),
            (
                "source_run_two",
                "failed",
                Some("execution_error"),
                Some("boom"),
            ),
        ] {
            duckdb
                .execute(
                    "insert into runs.workflow_runs (
                        run_id,
                        workspace_id,
                        workflow_id,
                        workflow_version,
                        status,
                        trigger_kind,
                        started_at,
                        finished_at,
                        duration_ms,
                        error_category,
                        error_message,
                        error_count,
                        retry_count,
                        node_count,
                        completed_node_count,
                        snapshot_json,
                        created_at,
                        updated_at
                    ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
                    duckdb::params![
                        run_id,
                        workspace.workspace_id.as_str(),
                        created.workflow.workflow_id.as_str(),
                        created.workflow.version as i64,
                        status,
                        "manual",
                        "2026-06-03T12:00:00Z",
                        "2026-06-03T12:00:02Z",
                        2000_i64,
                        error_category,
                        error_message,
                        if status == "failed" { 1_i64 } else { 0_i64 },
                        0_i64,
                        2_i64,
                        if status == "failed" { 1_i64 } else { 2_i64 },
                        "{}",
                        "2026-06-03T12:00:00Z",
                        "2026-06-03T12:00:02Z"
                    ],
                )
                .expect("seed source workflow row");
        }
        drop(duckdb);

        let started_at = Utc
            .with_ymd_and_hms(2026, 6, 3, 13, 0, 0)
            .single()
            .expect("valid datetime");
        let finished_at = started_at + Duration::seconds(2);
        let snapshot = RunSnapshot {
            run_id: "run_table_copy_target".to_string(),
            workflow_id: created.workflow.workflow_id.clone(),
            workflow_version: created.workflow.version,
            status: RunStatus::Succeeded,
            trigger: RunTrigger {
                kind: TriggerKind::Manual,
            },
            started_at: Some(started_at),
            finished_at: Some(finished_at),
            node_runs: vec![NodeRunSnapshot {
                node_id: "table_output_copy".to_string(),
                type_id: "table_output".to_string(),
                status: NodeRunStatus::Succeeded,
                attempt: 1,
                started_at: Some(started_at),
                finished_at: Some(finished_at),
                last_output: Some(table_output_source_payload(
                    "tables",
                    "workflow_runs_copy",
                    "append",
                    "runs",
                    "workflow_runs",
                )),
                log_count: 1,
                error: None,
            }],
            logs: vec![],
            error: None,
        };

        store
            .persist_run_snapshot(&workspace.workspace_id, Some("usr_builder"), &snapshot)
            .expect("run snapshot persists");

        let duckdb = DuckDbConnection::open(&duckdb_path).expect("duckdb reopens");

        let copied_count: i64 = duckdb
            .query_row(
                "select count(*) from tables.workflow_runs_copy",
                [],
                |row| row.get(0),
            )
            .expect("copied row count");
        let copied_row: (String, String, String, String) = duckdb
            .query_row(
                "select workflow_id, status, run_id, written_at
                 from tables.workflow_runs_copy
                 limit 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("copied row exists");

        assert_eq!(copied_count, 1);
        assert_eq!(copied_row.0, created.workflow.workflow_id);
        assert_eq!(copied_row.1, "succeeded");
        assert_eq!(copied_row.2, snapshot.run_id);
        assert!(!copied_row.3.is_empty());
    }

    #[test]
    fn table_output_schema_materialization_bootstraps_target_table() {
        let store = PlatformStore::for_tests().expect("platform store");
        let workspace = store
            .create_workspace("usr_builder", "Table Schema Output Workspace")
            .expect("workspace");
        let workflow: WorkflowDefinition = serde_json::from_str(include_str!(
            "../../../tests/fixtures/workflows/basic_text_preview.json"
        ))
        .expect("fixture parses");
        let created = store
            .create_workflow("usr_builder", &workspace.workspace_id, &workflow)
            .expect("workflow creates");

        let workflow_root = store.workflow_root_path(
            "usr_builder",
            &workspace.workspace_id,
            created.workflow.workflow_id.as_str(),
        );
        let duckdb_path = workflow_root.join("db").join("workflow.duckdb");

        let started_at = Utc
            .with_ymd_and_hms(2026, 6, 3, 14, 0, 0)
            .single()
            .expect("valid datetime");
        let finished_at = started_at + Duration::seconds(2);
        let snapshot = RunSnapshot {
            run_id: "run_table_schema_target".to_string(),
            workflow_id: created.workflow.workflow_id.clone(),
            workflow_version: created.workflow.version,
            status: RunStatus::Succeeded,
            trigger: RunTrigger {
                kind: TriggerKind::Manual,
            },
            started_at: Some(started_at),
            finished_at: Some(finished_at),
            node_runs: vec![NodeRunSnapshot {
                node_id: "table_output_schema".to_string(),
                type_id: "table_output".to_string(),
                status: NodeRunStatus::Succeeded,
                attempt: 1,
                started_at: Some(started_at),
                finished_at: Some(finished_at),
                last_output: Some(table_output_schema_payload(
                    "tables",
                    "orders_bootstrap",
                    "append",
                    "output",
                    "orders",
                )),
                log_count: 1,
                error: None,
            }],
            logs: vec![],
            error: None,
        };

        store
            .persist_run_snapshot(&workspace.workspace_id, Some("usr_builder"), &snapshot)
            .expect("run snapshot persists");

        let duckdb = DuckDbConnection::open(&duckdb_path).expect("duckdb reopens");
        let columns = duckdb
            .prepare("pragma table_info('tables.orders_bootstrap')")
            .expect("prepare table info")
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, bool>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, bool>(5)?,
                ))
            })
            .expect("query table info")
            .collect::<duckdb::Result<Vec<_>>>()
            .expect("collect columns");
        let row_count: i64 = duckdb
            .query_row("select count(*) from tables.orders_bootstrap", [], |row| {
                row.get(0)
            })
            .expect("row count");

        assert_eq!(row_count, 0);
        assert_eq!(columns.len(), 4);
        assert_eq!(columns[0].0, "order_id");
        assert_eq!(columns[0].1.to_ascii_lowercase(), "bigint");
        assert!(columns[0].2);
        assert!(columns[0].4);
        assert_eq!(columns[1].0, "customer_id");
        assert_eq!(columns[1].1.to_ascii_lowercase(), "varchar");
        assert!(columns[1].2);
        assert!(columns[1]
            .3
            .as_deref()
            .map(|value| value.contains("unknown"))
            .unwrap_or(false));
        assert_eq!(columns[2].0, "run_id");
        assert_eq!(columns[2].1.to_ascii_lowercase(), "varchar");
        assert_eq!(columns[3].0, "written_at");
        assert_eq!(columns[3].1.to_ascii_lowercase(), "varchar");
    }

    #[test]
    fn table_output_schema_materialization_bootstraps_multiple_target_tables() {
        let store = PlatformStore::for_tests().expect("platform store");
        let workspace = store
            .create_workspace("usr_builder", "Multi Table Schema Output Workspace")
            .expect("workspace");
        let workflow: WorkflowDefinition = serde_json::from_str(include_str!(
            "../../../tests/fixtures/workflows/basic_text_preview.json"
        ))
        .expect("fixture parses");
        let created = store
            .create_workflow("usr_builder", &workspace.workspace_id, &workflow)
            .expect("workflow creates");

        let workflow_root = store.workflow_root_path(
            "usr_builder",
            &workspace.workspace_id,
            created.workflow.workflow_id.as_str(),
        );
        let duckdb_path = workflow_root.join("db").join("workflow.duckdb");

        let started_at = Utc
            .with_ymd_and_hms(2026, 6, 3, 14, 5, 0)
            .single()
            .expect("valid datetime");
        let finished_at = started_at + Duration::seconds(2);
        let snapshot = RunSnapshot {
            run_id: "run_multi_table_schema_target".to_string(),
            workflow_id: created.workflow.workflow_id.clone(),
            workflow_version: created.workflow.version,
            status: RunStatus::Succeeded,
            trigger: RunTrigger {
                kind: TriggerKind::Manual,
            },
            started_at: Some(started_at),
            finished_at: Some(finished_at),
            node_runs: vec![NodeRunSnapshot {
                node_id: "table_output_schema_bundle".to_string(),
                type_id: "table_output".to_string(),
                status: NodeRunStatus::Succeeded,
                attempt: 1,
                started_at: Some(started_at),
                finished_at: Some(finished_at),
                last_output: Some(table_output_multi_schema_payload("tables", "append")),
                log_count: 1,
                error: None,
            }],
            logs: vec![],
            error: None,
        };

        store
            .persist_run_snapshot(&workspace.workspace_id, Some("usr_builder"), &snapshot)
            .expect("run snapshot persists");

        let duckdb = DuckDbConnection::open(&duckdb_path).expect("duckdb reopens");
        let created_tables = duckdb
            .prepare(
                "select table_name
                 from information_schema.tables
                 where table_schema = 'tables'
                   and table_name in ('orders_bootstrap', 'order_lines_bootstrap')
                 order by table_name",
            )
            .expect("prepare table listing")
            .query_map([], |row| row.get::<_, String>(0))
            .expect("query table listing")
            .collect::<duckdb::Result<Vec<_>>>()
            .expect("collect table listing");
        let order_line_columns = duckdb
            .prepare("pragma table_info('tables.order_lines_bootstrap')")
            .expect("prepare order_lines table info")
            .query_map([], |row| {
                Ok((row.get::<_, String>(1)?, row.get::<_, String>(2)?))
            })
            .expect("query order_lines table info")
            .collect::<duckdb::Result<Vec<_>>>()
            .expect("collect order_lines columns");

        assert_eq!(
            created_tables,
            vec![
                "order_lines_bootstrap".to_string(),
                "orders_bootstrap".to_string()
            ]
        );
        assert_eq!(order_line_columns.len(), 4);
        assert_eq!(order_line_columns[0].0, "line_id");
        assert_eq!(order_line_columns[0].1.to_ascii_lowercase(), "bigint");
        assert_eq!(order_line_columns[1].0, "order_id");
        assert_eq!(order_line_columns[1].1.to_ascii_lowercase(), "bigint");
        assert_eq!(order_line_columns[2].0, "run_id");
        assert_eq!(order_line_columns[3].0, "written_at");
    }

    #[test]
    fn table_output_schema_materialization_adds_new_tables_when_primary_already_exists() {
        let store = PlatformStore::for_tests().expect("platform store");
        let workspace = store
            .create_workspace("usr_builder", "Existing Primary Schema Output Workspace")
            .expect("workspace");
        let workflow: WorkflowDefinition = serde_json::from_str(include_str!(
            "../../../tests/fixtures/workflows/basic_text_preview.json"
        ))
        .expect("fixture parses");
        let created = store
            .create_workflow("usr_builder", &workspace.workspace_id, &workflow)
            .expect("workflow creates");

        let workflow_root = store.workflow_root_path(
            "usr_builder",
            &workspace.workspace_id,
            created.workflow.workflow_id.as_str(),
        );
        let duckdb_path = workflow_root.join("db").join("workflow.duckdb");

        let started_at = Utc
            .with_ymd_and_hms(2026, 6, 3, 14, 10, 0)
            .single()
            .expect("valid datetime");
        let finished_at = started_at + Duration::seconds(2);

        let single_snapshot = RunSnapshot {
            run_id: "run_single_table_schema_target".to_string(),
            workflow_id: created.workflow.workflow_id.clone(),
            workflow_version: created.workflow.version,
            status: RunStatus::Succeeded,
            trigger: RunTrigger {
                kind: TriggerKind::Manual,
            },
            started_at: Some(started_at),
            finished_at: Some(finished_at),
            node_runs: vec![NodeRunSnapshot {
                node_id: "table_output_schema".to_string(),
                type_id: "table_output".to_string(),
                status: NodeRunStatus::Succeeded,
                attempt: 1,
                started_at: Some(started_at),
                finished_at: Some(finished_at),
                last_output: Some(table_output_schema_payload(
                    "outputs", "orders", "append", "output", "orders",
                )),
                log_count: 1,
                error: None,
            }],
            logs: vec![],
            error: None,
        };

        store
            .persist_run_snapshot(
                &workspace.workspace_id,
                Some("usr_builder"),
                &single_snapshot,
            )
            .expect("single run snapshot persists");

        let multi_started_at = started_at + Duration::minutes(1);
        let multi_finished_at = multi_started_at + Duration::seconds(2);
        let multi_snapshot = RunSnapshot {
            run_id: "run_multi_table_schema_target".to_string(),
            workflow_id: created.workflow.workflow_id.clone(),
            workflow_version: created.workflow.version,
            status: RunStatus::Succeeded,
            trigger: RunTrigger {
                kind: TriggerKind::Manual,
            },
            started_at: Some(multi_started_at),
            finished_at: Some(multi_finished_at),
            node_runs: vec![NodeRunSnapshot {
                node_id: "table_output_schema_bundle".to_string(),
                type_id: "table_output".to_string(),
                status: NodeRunStatus::Succeeded,
                attempt: 1,
                started_at: Some(multi_started_at),
                finished_at: Some(multi_finished_at),
                last_output: Some(table_output_three_table_schema_payload("outputs", "append")),
                log_count: 1,
                error: None,
            }],
            logs: vec![],
            error: None,
        };

        store
            .persist_run_snapshot(
                &workspace.workspace_id,
                Some("usr_builder"),
                &multi_snapshot,
            )
            .expect("multi run snapshot persists");

        let duckdb = DuckDbConnection::open(&duckdb_path).expect("duckdb reopens");
        let created_tables = duckdb
            .prepare(
                "select table_name
                 from information_schema.tables
                 where table_schema = 'outputs'
                   and table_name in ('orders', 'order_lines', 'order_payments')
                 order by table_name",
            )
            .expect("prepare table listing")
            .query_map([], |row| row.get::<_, String>(0))
            .expect("query table listing")
            .collect::<duckdb::Result<Vec<_>>>()
            .expect("collect table listing");

        assert_eq!(
            created_tables,
            vec![
                "order_lines".to_string(),
                "order_payments".to_string(),
                "orders".to_string()
            ]
        );
    }

    #[test]
    fn workspace_connections_table_has_expected_columns() {
        let store = PlatformStore::for_tests().expect("platform store");
        let connection = store.connection();
        let mut stmt = connection
            .prepare("pragma table_info(workspace_connections)")
            .expect("prepare pragma table_info");
        let columns = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .expect("table_info query")
            .collect::<rusqlite::Result<Vec<_>>>()
            .expect("collect columns");

        let expected = [
            "workspace_id",
            "connection_id",
            "connection_kind",
            "display_name",
            "comment",
            "auth_scheme",
            "status",
            "external_account_label",
            "external_account_id",
            "config_json",
            "secret_refs_json",
            "scopes_json",
            "capabilities_json",
            "created_by_user_id",
            "created_at",
            "updated_at",
            "last_validated_at",
            "last_used_at",
            "last_error_code",
            "last_error_message",
            "archived_at",
        ];

        for column in expected {
            assert!(
                columns.iter().any(|value| value == column),
                "missing workspace_connections column `{column}`"
            );
        }
    }

    #[test]
    fn workspace_connection_oauth_tokens_table_has_expected_columns() {
        let store = PlatformStore::for_tests().expect("platform store");
        let connection = store.connection();
        let mut stmt = connection
            .prepare("pragma table_info(workspace_connection_oauth_tokens)")
            .expect("prepare pragma table_info");
        let columns = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .expect("table_info query")
            .collect::<rusqlite::Result<Vec<_>>>()
            .expect("collect columns");

        let expected = [
            "workspace_id",
            "connection_id",
            "provider",
            "access_token",
            "refresh_token",
            "token_type",
            "scopes_json",
            "expires_at",
            "created_at",
            "updated_at",
        ];

        for column in expected {
            assert!(
                columns.iter().any(|value| value == column),
                "missing workspace_connection_oauth_tokens column `{column}`"
            );
        }
    }

    #[test]
    fn upsert_gmail_connection_persists_workspace_record_and_tokens() {
        let store = PlatformStore::for_tests().expect("platform store");
        let workspace = store
            .create_workspace("usr_builder", "Gmail Workspace")
            .expect("workspace");

        let summary = store
            .upsert_gmail_connection(
                "usr_builder",
                &workspace.workspace_id,
                &GoogleIdentityProfile {
                    subject: "google-subject-456".to_string(),
                    email: "ops@gmail.com".to_string(),
                    email_verified: true,
                    display_name: "Ops Builder".to_string(),
                },
                &GoogleConnectionTokens {
                    access_token: "access-token-1".to_string(),
                    refresh_token: Some("refresh-token-1".to_string()),
                    token_type: Some("Bearer".to_string()),
                    scopes: vec![
                        "openid".to_string(),
                        "email".to_string(),
                        "profile".to_string(),
                        "https://www.googleapis.com/auth/gmail.send".to_string(),
                    ],
                    expires_at: Some("2026-05-27T12:34:56Z".to_string()),
                },
            )
            .expect("gmail connection");

        assert_eq!(summary.connection_kind, "gmail");
        assert_eq!(summary.status, "active");
        assert_eq!(
            summary.external_account_label.as_deref(),
            Some("ops@gmail.com")
        );
        assert!(summary
            .scopes
            .iter()
            .any(|scope| scope == "https://www.googleapis.com/auth/gmail.send"));

        let listed = store
            .list_workspace_connections("usr_builder", &workspace.workspace_id)
            .expect("list workspace connections");
        assert_eq!(listed.connections.len(), 1);
        assert_eq!(listed.connections[0].connection_id, summary.connection_id);

        let connection = store.connection();
        let token_row = connection
            .query_row(
                "select provider, access_token, refresh_token, token_type, expires_at
                 from workspace_connection_oauth_tokens
                 where workspace_id = ?1 and connection_id = ?2",
                params![workspace.workspace_id, summary.connection_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, Option<String>>(3)?,
                        row.get::<_, Option<String>>(4)?,
                    ))
                },
            )
            .expect("oauth token row");

        assert_eq!(token_row.0, "google");
        assert_eq!(token_row.1.as_deref(), Some("access-token-1"));
        assert_eq!(token_row.2.as_deref(), Some("refresh-token-1"));
        assert_eq!(token_row.3.as_deref(), Some("Bearer"));
        assert_eq!(token_row.4.as_deref(), Some("2026-05-27T12:34:56Z"));
    }

    #[test]
    fn workspace_gmail_connection_lookup_returns_runtime_tokens() {
        let store = PlatformStore::for_tests().expect("platform store");
        let workspace = store
            .create_workspace("usr_builder", "Gmail Runtime Workspace")
            .expect("workspace");

        let summary = store
            .upsert_gmail_connection(
                "usr_builder",
                &workspace.workspace_id,
                &GoogleIdentityProfile {
                    subject: "google-subject-runtime".to_string(),
                    email: "runtime@gmail.com".to_string(),
                    email_verified: true,
                    display_name: "Runtime Sender".to_string(),
                },
                &GoogleConnectionTokens {
                    access_token: "runtime-access-token".to_string(),
                    refresh_token: Some("runtime-refresh-token".to_string()),
                    token_type: Some("Bearer".to_string()),
                    scopes: vec![
                        "openid".to_string(),
                        "email".to_string(),
                        "profile".to_string(),
                        "https://www.googleapis.com/auth/gmail.send".to_string(),
                    ],
                    expires_at: Some("2026-05-27T12:34:56Z".to_string()),
                },
            )
            .expect("gmail connection");

        let runtime_connection = store
            .get_workspace_gmail_connection(
                "usr_builder",
                &workspace.workspace_id,
                &summary.connection_id,
            )
            .expect("lookup succeeds")
            .expect("runtime connection exists");

        assert_eq!(runtime_connection.connection_id, summary.connection_id);
        assert_eq!(runtime_connection.send_as_email, "runtime@gmail.com");
        assert_eq!(
            runtime_connection.access_token.as_deref(),
            Some("runtime-access-token")
        );
        assert_eq!(
            runtime_connection.refresh_token.as_deref(),
            Some("runtime-refresh-token")
        );
    }
}

fn unique_slug(connection: &Connection, name: &str) -> anyhow::Result<String> {
    let base = slugify(name);
    let mut candidate = base.clone();
    let mut index = 2_u32;

    loop {
        let exists: Option<String> = connection
            .query_row(
                "select slug from workspaces where slug = ?1",
                params![candidate],
                |row| row.get(0),
            )
            .optional()?;
        if exists.is_none() {
            return Ok(candidate);
        }

        candidate = format!("{base}-{index}");
        index += 1;
    }
}

fn slugify(name: &str) -> String {
    let mut slug = String::new();
    let mut last_was_dash = false;

    for ch in name.trim().chars() {
        let lowered = ch.to_ascii_lowercase();
        if lowered.is_ascii_alphanumeric() {
            slug.push(lowered);
            last_was_dash = false;
        } else if !last_was_dash {
            slug.push('-');
            last_was_dash = true;
        }
    }

    let trimmed = slug.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "workspace".to_string()
    } else {
        trimmed
    }
}

fn role_from_db(value: &str) -> rusqlite::Result<WorkspaceMembershipRole> {
    match value {
        "owner" => Ok(WorkspaceMembershipRole::Owner),
        "editor" => Ok(WorkspaceMembershipRole::Editor),
        _ => Err(rusqlite::Error::InvalidParameterName(format!(
            "unknown workspace role `{value}`"
        ))),
    }
}

fn role_to_db(role: WorkspaceMembershipRole) -> &'static str {
    match role {
        WorkspaceMembershipRole::Owner => "owner",
        WorkspaceMembershipRole::Editor => "editor",
    }
}

fn parse_rfc3339_to_utc(value: &str) -> anyhow::Result<chrono::DateTime<Utc>> {
    Ok(chrono::DateTime::parse_from_rfc3339(value)
        .with_context(|| format!("invalid RFC3339 timestamp `{value}`"))?
        .with_timezone(&Utc))
}

fn run_status_to_db(status: &api_contract::RunStatus) -> &'static str {
    match status {
        api_contract::RunStatus::Created => "created",
        api_contract::RunStatus::Queued => "queued",
        api_contract::RunStatus::Planning => "planning",
        api_contract::RunStatus::Running => "running",
        api_contract::RunStatus::Succeeded => "succeeded",
        api_contract::RunStatus::Failed => "failed",
        api_contract::RunStatus::Cancelling => "cancelling",
        api_contract::RunStatus::Cancelled => "cancelled",
    }
}

fn node_run_status_to_db(status: &api_contract::NodeRunStatus) -> &'static str {
    match status {
        api_contract::NodeRunStatus::Pending => "pending",
        api_contract::NodeRunStatus::Ready => "ready",
        api_contract::NodeRunStatus::Running => "running",
        api_contract::NodeRunStatus::Succeeded => "succeeded",
        api_contract::NodeRunStatus::Failed => "failed",
        api_contract::NodeRunStatus::Skipped => "skipped",
        api_contract::NodeRunStatus::Cancelling => "cancelling",
        api_contract::NodeRunStatus::Cancelled => "cancelled",
        api_contract::NodeRunStatus::Retrying => "retrying",
    }
}

fn trigger_kind_to_db(kind: &TriggerKind) -> &'static str {
    match kind {
        TriggerKind::Manual => "manual",
        TriggerKind::Schedule => "schedule",
        TriggerKind::Event => "event",
        TriggerKind::Backfill => "backfill",
    }
}

fn data_type_to_db(data_type: &workflow_schema::DataType) -> &'static str {
    match data_type {
        workflow_schema::DataType::Bytes => "bytes",
        workflow_schema::DataType::Text => "text",
        workflow_schema::DataType::Json => "json",
        workflow_schema::DataType::Number => "number",
        workflow_schema::DataType::Boolean => "boolean",
        workflow_schema::DataType::FileRef => "file_ref",
        workflow_schema::DataType::DirectoryRef => "directory_ref",
        workflow_schema::DataType::TableRef => "table_ref",
        workflow_schema::DataType::DatasetRef => "dataset_ref",
    }
}

fn run_error_category_to_db(category: &RunErrorCategory) -> &'static str {
    match category {
        RunErrorCategory::ValidationError => "validation_error",
        RunErrorCategory::PlanningError => "planning_error",
        RunErrorCategory::AdapterResolutionError => "adapter_resolution_error",
        RunErrorCategory::ConnectionError => "connection_error",
        RunErrorCategory::ExecutionError => "execution_error",
        RunErrorCategory::Timeout => "timeout",
        RunErrorCategory::Cancellation => "cancellation",
    }
}

fn run_event_type_to_db(event_type: &RunEventType) -> &'static str {
    match event_type {
        RunEventType::RunCreated => "run_created",
        RunEventType::PlanningStarted => "planning_started",
        RunEventType::PlanningFinished => "planning_finished",
        RunEventType::RunStatusChanged => "run_status_changed",
        RunEventType::NodeStarted => "node_started",
        RunEventType::NodeLog => "node_log",
        RunEventType::NodeFinished => "node_finished",
        RunEventType::RunSucceeded => "run_succeeded",
        RunEventType::RunFailed => "run_failed",
        RunEventType::CancellationRequested => "cancellation_requested",
        RunEventType::RunCancelled => "run_cancelled",
    }
}

fn run_event_type_from_db(value: &str) -> anyhow::Result<RunEventType> {
    match value {
        "run_created" => Ok(RunEventType::RunCreated),
        "planning_started" => Ok(RunEventType::PlanningStarted),
        "planning_finished" => Ok(RunEventType::PlanningFinished),
        "run_status_changed" => Ok(RunEventType::RunStatusChanged),
        "node_started" => Ok(RunEventType::NodeStarted),
        "node_log" => Ok(RunEventType::NodeLog),
        "node_finished" => Ok(RunEventType::NodeFinished),
        "run_succeeded" => Ok(RunEventType::RunSucceeded),
        "run_failed" => Ok(RunEventType::RunFailed),
        "cancellation_requested" => Ok(RunEventType::CancellationRequested),
        "run_cancelled" => Ok(RunEventType::RunCancelled),
        _ => Err(anyhow!("unknown run event type `{value}`")),
    }
}

fn event_target_kind_to_db(kind: &EventTargetKind) -> &'static str {
    match kind {
        EventTargetKind::Run => "run",
        EventTargetKind::Node => "node",
    }
}

fn event_target_kind_from_db(value: &str) -> anyhow::Result<EventTargetKind> {
    match value {
        "run" => Ok(EventTargetKind::Run),
        "node" => Ok(EventTargetKind::Node),
        _ => Err(anyhow!("unknown event target kind `{value}`")),
    }
}

fn log_level_to_db(level: &LogLevel) -> &'static str {
    match level {
        LogLevel::Debug => "debug",
        LogLevel::Info => "info",
        LogLevel::Warn => "warn",
        LogLevel::Error => "error",
    }
}

fn log_level_from_db(value: &str) -> anyhow::Result<LogLevel> {
    match value {
        "debug" => Ok(LogLevel::Debug),
        "info" => Ok(LogLevel::Info),
        "warn" => Ok(LogLevel::Warn),
        "error" => Ok(LogLevel::Error),
        _ => Err(anyhow!("unknown log level `{value}`")),
    }
}
