//! Complete typed Playwright through its official driver, owned by command-stream.
//! No Browser Commander npm package is needed. The driver's Node binary and
//! JavaScript package are bundled/resolved by the pinned playwright-rs crate.
mod channel;
mod options;
mod transport;
#[cfg(test)]
mod transport_tests;
pub use channel::{AnyChannel, Channel, ChannelRef};
mod adapter;
pub mod generated;
pub use adapter::NativePlaywrightPage;
pub use playwright_rs as api;
pub use playwright_rs::Playwright;

use crate::utilities::{start_process, ManagedProcess, StartProcessOptions};
use anyhow::{anyhow, Context, Result};
use playwright_rs::server::connection::{Connection, ConnectionExt, ConnectionLike};
use std::{collections::HashMap, path::PathBuf, sync::Arc, time::Duration};
use tokio::{io::AsyncReadExt, net::TcpListener, sync::OnceCell, task::JoinHandle, time::timeout};

const BOOTSTRAP: &str = include_str!("driver_bootstrap.cjs");

#[derive(Clone, Debug)]
pub struct PlaywrightDriverOptions {
    /// Overrides must be supplied together; otherwise use the bundled driver.
    pub node_executable: Option<PathBuf>,
    pub cli_script: Option<PathBuf>,
    pub env: Option<HashMap<String, String>>,
    pub launch_timeout: Duration,
}
impl Default for PlaywrightDriverOptions {
    fn default() -> Self {
        Self {
            node_executable: None,
            cli_script: None,
            env: None,
            launch_timeout: Duration::from_secs(30),
        }
    }
}

struct Owned {
    child: Option<ManagedProcess>,
    task: Option<JoinHandle<()>>,
}
impl Drop for Owned {
    fn drop(&mut self) {
        if let Some(task) = self.task.take() {
            task.abort();
        }
        // ManagedProcess kills the owned process group even after runtime shutdown.
        self.child.take();
    }
}

/// Every typed playwright-rs API is available through `client()`/`api`. This
/// handle owns the official driver and closes all its browsers on shutdown.
pub struct ManagedPlaywright {
    client: Playwright,
    connection: Arc<Connection>,
    state: Arc<transport::State>,
    owned: tokio::sync::Mutex<Owned>,
    closed: OnceCell<()>,
}
impl ManagedPlaywright {
    /// Bind a schema-generated channel to an official driver object GUID.
    pub fn channel<T: Clone>(&self, guid: impl Into<String>) -> Channel<T> {
        Channel::new(self.connection.clone(), guid.into())
    }
    pub fn connection(&self) -> Arc<Connection> {
        self.connection.clone()
    }
    pub fn client(&self) -> &Playwright {
        &self.client
    }
    pub fn driver_pid(&self) -> Option<u32> {
        self.owned
            .try_lock()
            .ok()
            .and_then(|owned| owned.child.as_ref().and_then(ManagedProcess::pid))
    }
    pub async fn close(&self) -> Result<()> {
        self.closed
            .get_or_try_init(|| async {
                // Dropping the write half sends EOF, invoking the official driver's
                // graceful browser cleanup, before any command-stream kill fallback.
                self.connection.close_writer();
                let mut owned = self.owned.lock().await;
                if let Some(child) = owned.child.take() {
                    if child.wait_timeout(Duration::from_secs(5)).await.is_none() {
                        child.kill();
                        child.wait_timeout(Duration::from_secs(3)).await;
                    }
                }
                self.state.disconnect().await;
                if let Some(mut task) = owned.task.take() {
                    if timeout(Duration::from_secs(2), &mut task).await.is_err() {
                        task.abort();
                        let _ = task.await;
                    }
                }
                Ok::<_, anyhow::Error>(())
            })
            .await?;
        Ok(())
    }
}
impl Drop for ManagedPlaywright {
    fn drop(&mut self) {
        self.connection.close_writer();
    }
}

/// Start the official `run-driver` and initialize its full typed object tree.
/// The small TCP stdio bootstrap runs in that same owned process; it translates
/// no API operations and does not depend on the Browser Commander npm CLI.
pub async fn launch_playwright(options: PlaywrightDriverOptions) -> Result<ManagedPlaywright> {
    if options.launch_timeout.is_zero() {
        return Err(anyhow!("Playwright launch_timeout must be positive"));
    }
    let (node, cli) = match (&options.node_executable, &options.cli_script) {
        (Some(node), Some(cli)) => (node.clone(), cli.clone()),
        (None, None) => playwright_rs::server::driver::get_driver_executable()?,
        _ => {
            return Err(anyhow!(
                "node_executable and cli_script must be supplied together"
            ))
        }
    };
    let cli = cli
        .canonicalize()
        .context("resolve official Playwright driver script")?;
    let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).await?;
    let mut random = [0u8; 32];
    getrandom::fill(&mut random)
        .map_err(|error| anyhow!("driver handshake randomness: {error}"))?;
    let token: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
    let mut env = options.env.unwrap_or_default();
    env.entry("PW_LANG_NAME".into()).or_insert("rust".into());
    env.entry("PW_LANG_NAME_VERSION".into())
        .or_insert(env!("CARGO_PKG_VERSION").into());
    let child = start_process(
        node.to_string_lossy().as_ref(),
        &[
            "-e".to_owned(),
            BOOTSTRAP.to_owned(),
            cli.to_string_lossy().into_owned(),
            listener.local_addr()?.port().to_string(),
            token.clone(),
        ],
        StartProcessOptions {
            env: Some(env),
            on_stderr: vec![Arc::new(|bytes| {
                tracing::debug!("Playwright driver: {}", String::from_utf8_lossy(bytes))
            })],
            ..Default::default()
        },
    )
    .await
    .context("start official Playwright driver")?;
    let mut owned = Owned {
        child: Some(child),
        task: None,
    };
    timeout(options.launch_timeout, async {
        // Authenticate the exact owned process before reading protocol frames.
        let (mut stream, _) = listener.accept().await?;
        let mut received = vec![0u8; token.len() + 1];
        stream.read_exact(&mut received).await?;
        if received != format!("{token}\n").as_bytes() {
            return Err(anyhow!("Playwright driver handshake mismatch"));
        }
        let (sender, receiver, messages, state) = transport::connect(stream);
        let connection = Arc::new(Connection::new(sender, receiver, messages));
        let actor = connection.clone();
        owned.task = Some(tokio::spawn(async move {
            actor.run().await;
        }));
        let root = connection.initialize_playwright().await?;
        let client = connection.get_typed::<Playwright>(root.guid()).await?;
        Ok(ManagedPlaywright {
            client,
            connection,
            state,
            owned: tokio::sync::Mutex::new(owned),
            closed: OnceCell::new(),
        })
    })
    .await
    .context("official Playwright driver launch deadline")?
}
