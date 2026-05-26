use std::{env, fs, net::SocketAddr, path::Path};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    load_local_env_file(".env.server")?;

    let runtime = runtime_core::RuntimeService::default();
    let database_path =
        env::var("STITCHLY_DB_PATH").unwrap_or_else(|_| ".stitchly/platform.sqlite3".to_string());
    let platform = runtime_server::platform::PlatformStore::open(&database_path)?;
    let app = runtime_server::app(runtime, platform);
    let addr = env::var("STITCHLY_SERVER_ADDR")
        .ok()
        .and_then(|value| value.parse::<SocketAddr>().ok())
        .unwrap_or_else(|| SocketAddr::from(([127, 0, 0, 1], 3000)));

    println!("stitchly runtime server listening on http://{addr}");

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

fn load_local_env_file(path: &str) -> anyhow::Result<()> {
    let path = Path::new(path);
    if !path.is_file() {
        return Ok(());
    }

    let contents = fs::read_to_string(path)?;
    for line in contents.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        let Some((raw_key, raw_value)) = trimmed.split_once('=') else {
            continue;
        };

        let key = raw_key.trim();
        if key.is_empty() || env::var_os(key).is_some() {
            continue;
        }

        let value = raw_value.trim().trim_matches('"').trim_matches('\'');
        env::set_var(key, value);
    }

    Ok(())
}
