use std::{
    fs,
    path::Path,
    sync::{Arc, Mutex},
};

use anyhow::{anyhow, Context};
use api_contract::{
    AuthSessionResponse, SessionUserSummary, WorkspaceListResponse, WorkspaceMembershipRole,
    WorkspaceSummary,
};
use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use chrono::{Duration, Utc};
use rand_core::OsRng;
use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

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
            ",
        )?;

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
