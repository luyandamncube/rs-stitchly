use std::{
    fs,
    path::Path,
    sync::{Arc, Mutex},
};

use anyhow::{anyhow, Context};
use api_contract::{
    AuthSessionResponse, DeleteWorkflowResponse, RunSnapshot, SessionUserSummary,
    WorkflowListResponse, WorkflowResponse, WorkflowStateResponse, WorkflowSummary,
    WorkspaceListResponse, WorkspaceMembershipRole, WorkspaceSummary,
};
use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use chrono::{Duration, Utc};
use rand_core::OsRng;
use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;
use workflow_schema::WorkflowDefinition;

const DEMO_EMAIL: &str = "builder@stitchly.dev";
const DEMO_PASSWORD: &str = "stitchly";
const DEMO_DISPLAY_NAME: &str = "Builder";
const SESSION_TTL_DAYS: i64 = 30;

#[derive(Clone)]
pub struct PlatformStore {
    connection: Arc<Mutex<Connection>>,
}

#[derive(Clone, Debug)]
pub struct AuthenticatedSession {
    pub session_id: String,
    pub user_id: String,
    pub session: AuthSessionResponse,
}

impl PlatformStore {
    pub fn open(database_path: &str) -> anyhow::Result<Self> {
        if database_path != ":memory:" {
            ensure_parent_dir(database_path)?;
        }

        let connection = Connection::open(database_path)
            .with_context(|| format!("failed to open platform database at `{database_path}`"))?;

        let store = Self {
            connection: Arc::new(Mutex::new(connection)),
        };
        store.initialize()?;
        Ok(store)
    }

    pub fn for_tests() -> anyhow::Result<Self> {
        Self::open(":memory:")
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

    pub fn load_session(
        &self,
        session_id: &str,
    ) -> anyhow::Result<Option<AuthenticatedSession>> {
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

    pub fn list_workspaces(&self, user_id: &str) -> anyhow::Result<WorkspaceListResponse> {
        let connection = self.connection();
        let session = build_session_response(&connection, user_id)?;
        Ok(WorkspaceListResponse {
            workspaces: session.workspaces,
            active_workspace_id: session.active_workspace_id,
        })
    }

    pub fn create_workspace(
        &self,
        user_id: &str,
        name: &str,
    ) -> anyhow::Result<WorkspaceSummary> {
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
            params![workspace_id, user_id, role_to_db(WorkspaceMembershipRole::Owner), now],
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

        Ok(Some(WorkflowResponse { workflow, definition }))
    }

    pub fn create_workflow(
        &self,
        user_id: &str,
        workspace_id: &str,
        workflow: &WorkflowDefinition,
    ) -> anyhow::Result<WorkflowResponse> {
        let connection = self.connection();
        ensure_workspace_access(&connection, user_id, workspace_id)?;

        let stored_workflow =
            normalize_workflow_definition(workflow, &workflow.workflow_id, workflow.version.max(1))?;
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

        let mut connection = connection;
        let tx = connection.transaction()?;
        tx.execute(
            "insert into workflows (workspace_id, workflow_id, name, description, current_version, created_at, updated_at)
             values (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                workspace_id,
                stored_workflow.workflow_id.as_str(),
                stored_workflow.name.as_str(),
                stored_workflow.description.as_deref(),
                stored_workflow.version,
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
        tx.commit()?;

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

        let now = Utc::now().to_rfc3339();
        let snapshot_json = serde_json::to_string(snapshot)
            .context("failed to serialize run snapshot")?;

        connection.execute(
            "insert into runs (
                workspace_id,
                run_id,
                workflow_id,
                workflow_version,
                status,
                snapshot_json,
                created_at,
                updated_at
             )
             values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             on conflict(workspace_id, run_id) do update set
                workflow_id = excluded.workflow_id,
                workflow_version = excluded.workflow_version,
                status = excluded.status,
                snapshot_json = excluded.snapshot_json,
                updated_at = excluded.updated_at",
            params![
                workspace_id,
                snapshot.run_id.as_str(),
                snapshot.workflow_id.as_str(),
                snapshot.workflow_version,
                run_status_to_db(&snapshot.status),
                snapshot_json,
                now,
                now
            ],
        )?;

        Ok(())
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

            create table if not exists runs (
                workspace_id text not null,
                run_id text not null,
                workflow_id text not null,
                workflow_version integer not null,
                status text not null,
                snapshot_json text not null,
                created_at text not null,
                updated_at text not null,
                primary key (workspace_id, run_id),
                foreign key (workspace_id) references workspaces (workspace_id) on delete cascade
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
            ",
        )?;

        ensure_nullable_text_column(&connection, "workflows", "archived_at")?;

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
        self.connection.lock().expect("platform store mutex poisoned")
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
        .filter(|active_id| workspaces.iter().any(|workspace| &workspace.workspace_id == active_id))
        .or_else(|| workspaces.first().map(|workspace| workspace.workspace_id.clone()));

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
    let pragma = format!("pragma table_info({table_name})");
    let mut stmt = connection.prepare(&pragma)?;
    let existing_columns = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?;

    if existing_columns.iter().any(|existing| existing == column_name) {
        return Ok(());
    }

    connection.execute(
        &format!("alter table {table_name} add column {column_name} text null"),
        [],
    )?;
    Ok(())
}

fn ensure_parent_dir(database_path: &str) -> anyhow::Result<()> {
    let path = Path::new(database_path);
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).with_context(|| {
                format!("failed to create platform database directory `{}`", parent.display())
            })?;
        }
    }

    Ok(())
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

fn hash_password(password: &str) -> anyhow::Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    Ok(Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map_err(|error| anyhow!("password hashing failed: {error}"))?
        .to_string())
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
