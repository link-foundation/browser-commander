//! Owned persistent sessions sharing the npm package's detached idle watchdog.
use super::{connect_browser, ConnectOptions, LaunchResult};
use crate::{
    core::EngineAdapter,
    utilities::subprocess::{run_command, RunCommandOptions},
};
use serde_json::{json, Value};
use std::{path::PathBuf, sync::Arc, time::Duration};

#[derive(Debug, Clone)]
pub struct PersistentOptions {
    pub connection: ConnectOptions,
    pub user_data_dir: PathBuf,
    pub remote_debugging_port: u16,
    pub idle_timeout: Duration,
    /// Additional launch options in the shared CLI's camelCase format.
    pub launch: Value,
}
impl PersistentOptions {
    pub fn new(profile: impl Into<PathBuf>, port: u16) -> Self {
        Self {
            connection: ConnectOptions::default(),
            user_data_dir: profile.into(),
            remote_debugging_port: port,
            idle_timeout: Duration::from_secs(1800),
            launch: json!({}),
        }
    }
}
async fn worker(payload: Value) -> anyhow::Result<Value> {
    let cli = std::env::var_os("BROWSER_COMMANDER_JS_CLI")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../js/bin/browser-commander.js")
        });
    let worker = cli
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.join("src/browser/session-worker.js"))
        .filter(|p| p.is_file())
        .ok_or_else(|| {
            anyhow::anyhow!("install the companion npm package and set BROWSER_COMMANDER_JS_CLI")
        })?;
    let result = run_command(
        &std::env::var("BROWSER_COMMANDER_NODE").unwrap_or_else(|_| "node".into()),
        &[worker.to_string_lossy().into_owned()],
        RunCommandOptions {
            input: Some(payload.to_string()),
            ..Default::default()
        },
    )
    .await?;
    Ok(serde_json::from_str(&result.stdout)?)
}
pub struct PersistentSession {
    pub connection: LaunchResult,
    pub reused: bool,
    options: ConnectOptions,
    metadata: Value,
    detached: bool,
    closed: bool,
}
impl PersistentSession {
    pub fn page(&self) -> &Arc<dyn EngineAdapter> {
        &self.connection.page
    }
    pub async fn touch(&self) -> anyhow::Result<()> {
        let mut payload = self.metadata.clone();
        payload["operation"] = json!("touch");
        if let Some(target) = self.page().target_id().await? {
            payload["targetId"] = json!(target);
        }
        worker(payload).await?;
        Ok(())
    }
    pub async fn detach(&mut self) -> anyhow::Result<()> {
        if !self.detached {
            self.touch().await?;
            if let Some(downloads) = &self.connection.downloads {
                downloads.dispose().await;
            }
            self.page().detach().await?;
            self.detached = true;
        }
        Ok(())
    }
    pub async fn close(&mut self) -> anyhow::Result<()> {
        if self.closed {
            return Ok(());
        }
        self.detach().await?;
        let mut payload = self.metadata.clone();
        payload["operation"] = json!("close");
        worker(payload).await?;
        self.closed = true;
        Ok(())
    }
    pub async fn reuse_page(
        &mut self,
        target_id: Option<String>,
        url: Option<String>,
    ) -> anyhow::Result<Arc<dyn EngineAdapter>> {
        if self.detached {
            anyhow::bail!("Persistent controller is detached");
        }
        let remembered = self
            .page()
            .target_id()
            .await?
            .or_else(|| self.metadata["targetId"].as_str().map(str::to_owned));
        self.page().detach().await?;
        let mut options = self.options.clone();
        options.target_id = target_id.or_else(|| if url.is_none() { remembered } else { None });
        options.url = url;
        self.connection = connect_browser(options).await?;
        self.touch().await?;
        Ok(self.page().clone())
    }
}
pub async fn connect_or_launch(options: PersistentOptions) -> anyhow::Result<PersistentSession> {
    if options.remote_debugging_port == 0 || options.idle_timeout.is_zero() {
        anyhow::bail!("fixed nonzero port and positive idle timeout required");
    }
    let mut payload = options.launch.clone();
    if !payload.is_object() {
        anyhow::bail!("launch options must be an object");
    }
    payload["engine"] = json!("playwright");
    payload["userDataDir"] = json!(options.user_data_dir);
    payload["remoteDebuggingPort"] = json!(options.remote_debugging_port);
    payload["idleTimeoutMs"] = json!(options.idle_timeout.as_millis().min(u64::MAX as u128) as u64);
    let metadata = worker(payload).await?;
    let mut connection_options = options.connection;
    connection_options.ws_endpoint = None;
    connection_options.cdp_endpoint = metadata["cdpEndpoint"].as_str().map(str::to_owned);
    connection_options.target_id = metadata["targetId"].as_str().map(str::to_owned);
    let connection = connect_browser(connection_options.clone()).await?;
    Ok(PersistentSession {
        connection,
        reused: metadata["reused"] == true,
        options: connection_options,
        metadata,
        detached: false,
        closed: false,
    })
}
