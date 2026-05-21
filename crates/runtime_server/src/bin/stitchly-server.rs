use std::{env, net::SocketAddr};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let runtime = runtime_core::RuntimeService::default();
    let database_path = env::var("STITCHLY_DB_PATH")
        .unwrap_or_else(|_| ".stitchly/platform.sqlite3".to_string());
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
