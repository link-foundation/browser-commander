//! Native typed relay for the shared Chrome companion extension, without Node.
//!
//! The browser supplies `chrome-extension://<id>` as the WebSocket Origin.
//! An optional ID allowlist restricts installed extensions. This guards against
//! web pages; other local programs can construct their own HTTP headers.
//! Load `js/extension` once with Chrome's “Load unpacked” developer option.
//! [`ExtensionRelay::listen`] returns its actual port before awaiting the hello.

mod protocol;
mod server;
mod state;

pub use protocol::{extension_id_from_origin, DEFAULT_RELAY_PORT, RELAY_PATH};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use state::{PendingGuard, SessionState, State};
use std::{
    sync::{atomic::Ordering, Arc},
    time::Duration,
};
use tokio::{
    net::TcpListener,
    sync::{broadcast, oneshot},
    task::JoinHandle,
    time::timeout,
};

#[derive(Clone, Debug)]
pub struct RelayOptions {
    pub host: String,
    pub port: u16,
    pub timeout: Duration,
    pub request_timeout: Duration,
    pub allowed_extension_ids: Option<Vec<String>>,
}

impl Default for RelayOptions {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".into(),
            port: DEFAULT_RELAY_PORT,
            timeout: Duration::from_secs(60),
            request_timeout: Duration::from_secs(30),
            allowed_extension_ids: None,
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum RelayError {
    #[error("{0}")]
    InvalidOptions(String),
    #[error("Extension relay I/O failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("Extension relay response is invalid: {0}")]
    Protocol(#[from] serde_json::Error),
    #[error("{0}")]
    Disconnected(String),
    #[error("Extension request failed: {0}")]
    Remote(String),
    #[error("Extension relay timed out")]
    Timeout,
    #[error("Too many pending extension requests")]
    Busy,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayExtension {
    pub id: String,
    pub version: String,
    pub user_agent: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayTab {
    pub tab_id: i64,
    pub url: String,
    pub title: String,
    pub active: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RelayEvent {
    pub method: String,
    pub params: Value,
}

/// An owned listener. Closing or dropping it ends sessions and pending calls;
/// Chrome keeps running and the companion extension detaches its debugger tabs.
pub struct ExtensionRelay {
    state: Arc<State>,
    url: String,
    port: u16,
    task: Option<JoinHandle<()>>,
}

impl ExtensionRelay {
    pub async fn listen(options: RelayOptions) -> Result<Self, RelayError> {
        protocol::validate(&options)?;
        let host = if options.host == "localhost" {
            "127.0.0.1"
        } else {
            &options.host
        };
        let listener = TcpListener::bind((host, options.port)).await?;
        let address = listener.local_addr()?;
        let state = Arc::new(State::new(options));
        let task = tokio::spawn(server::serve(listener, state.clone()));
        Ok(Self {
            state,
            url: format!("ws://{address}{RELAY_PATH}"),
            port: address.port(),
            task: Some(task),
        })
    }

    pub fn url(&self) -> &str {
        &self.url
    }
    pub fn port(&self) -> u16 {
        self.port
    }
    pub fn connected(&self) -> bool {
        self.state.extension.borrow().is_some()
    }
    pub fn extension(&self) -> Option<RelayExtension> {
        self.state.extension.borrow().clone()
    }

    pub async fn wait_for_extension(&self) -> Result<RelayExtension, RelayError> {
        let mut extension = self.state.extension.subscribe();
        let mut shutdown = self.state.shutdown.subscribe();
        timeout(self.state.options.timeout, async {
            loop {
                if *shutdown.borrow() { return Err(RelayError::Disconnected("the relay was closed".into())); }
                if let Some(info) = extension.borrow().clone() { return Ok(info); }
                tokio::select! {
                    result = extension.changed() => { result.map_err(|_| RelayError::Disconnected("the relay was closed".into()))?; }
                    _ = shutdown.changed() => return Err(RelayError::Disconnected("the relay was closed".into())),
                }
            }
        }).await.map_err(|_| RelayError::Timeout)?
    }

    pub async fn tabs(&self) -> Result<Vec<RelayTab>, RelayError> {
        Ok(serde_json::from_value(
            request(&self.state, "tabs.list", json!({})).await?,
        )?)
    }

    pub async fn new_tab(&self, url: Option<&str>) -> Result<i64, RelayError> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Tab {
            tab_id: i64,
        }
        let params = url
            .map(|url| json!({"url":url}))
            .unwrap_or_else(|| json!({}));
        let tab: Tab = serde_json::from_value(request(&self.state, "tabs.create", params).await?)?;
        Ok(tab.tab_id)
    }

    pub async fn session(&self, tab_id: i64) -> Result<RelaySession, RelayError> {
        let _lock = self.state.session_lock.lock().await;
        let existing = self
            .state
            .sessions
            .lock()
            .unwrap()
            .get(&tab_id)
            .and_then(std::sync::Weak::upgrade)
            .filter(|session| !session.detached.load(Ordering::Acquire));
        if let Some(state) = existing {
            return Ok(RelaySession { state });
        }
        let session = Arc::new(SessionState {
            tab_id,
            detached: false.into(),
            events: broadcast::channel(1024).0,
            relay: self.state.clone(),
        });
        self.state
            .sessions
            .lock()
            .unwrap()
            .insert(tab_id, Arc::downgrade(&session));
        // Cancellation must also detach the provisional session.
        struct AttachGuard(Arc<SessionState>, bool);
        impl Drop for AttachGuard {
            fn drop(&mut self) {
                if !self.1 {
                    self.0.mark_detached("attach_failed");
                }
            }
        }
        let mut guard = AttachGuard(session.clone(), false);
        request(&self.state, "debugger.attach", json!({"tabId":tab_id})).await?;
        guard.1 = true;
        Ok(RelaySession { state: session })
    }

    pub async fn close(&mut self) {
        self.state.shutdown.send_replace(true);
        if let Some(task) = self.task.take() {
            let _ = task.await;
        }
    }
}

impl Drop for ExtensionRelay {
    fn drop(&mut self) {
        self.state.shutdown.send_replace(true);
        self.state.disconnect("the relay was closed");
        if let Some(task) = self.task.take() {
            task.abort();
        }
    }
}

#[derive(Clone)]
pub struct RelaySession {
    state: Arc<SessionState>,
}

impl RelaySession {
    pub fn tab_id(&self) -> i64 {
        self.state.tab_id
    }
    pub fn is_detached(&self) -> bool {
        self.state.detached.load(Ordering::Acquire)
    }
    /// The bounded event stream reports `RecvError::Lagged` if a consumer falls
    /// behind; callers must handle that explicit loss rather than assume replay.
    pub fn subscribe(&self) -> broadcast::Receiver<RelayEvent> {
        self.state.events.subscribe()
    }
    pub async fn send(&self, method: &str, params: Value) -> Result<Value, RelayError> {
        if self.is_detached() {
            return Err(RelayError::Disconnected(
                "Debugger session is detached".into(),
            ));
        }
        request(
            &self.state.relay,
            "cdp.send",
            json!({"tabId":self.tab_id(),"method":method,"params":params}),
        )
        .await
    }
    pub async fn detach(&self) -> Result<(), RelayError> {
        if !self.is_detached() {
            request(
                &self.state.relay,
                "debugger.detach",
                json!({"tabId":self.tab_id()}),
            )
            .await?;
            self.state.mark_detached("detached_by_client");
        }
        Ok(())
    }
}

#[async_trait::async_trait]
impl crate::fingerprint::CdpTransport for RelaySession {
    async fn send(&self, method: &str, params: Value) -> anyhow::Result<Value> {
        Ok(RelaySession::send(self, method, params).await?)
    }
}

async fn request(state: &Arc<State>, method: &str, params: Value) -> Result<Value, RelayError> {
    let sender = state.outgoing.lock().unwrap().clone().ok_or_else(|| {
        RelayError::Disconnected("The Browser Commander Relay extension is not connected".into())
    })?;
    let id = state.next_id.fetch_add(1, Ordering::Relaxed);
    let (response, result) = oneshot::channel();
    {
        let mut pending = state.pending.lock().unwrap();
        if pending.len() >= 64 {
            return Err(RelayError::Busy);
        }
        pending.insert(id, response);
    }
    let _guard = PendingGuard {
        id,
        state: state.clone(),
    };
    sender
        .try_send(json!({"id":id,"method":method,"params":params}))
        .map_err(|error| match error {
            tokio::sync::mpsc::error::TrySendError::Full(_) => RelayError::Busy,
            _ => RelayError::Disconnected("the extension disconnected".into()),
        })?;
    timeout(state.options.request_timeout, result)
        .await
        .map_err(|_| RelayError::Timeout)?
        .map_err(|_| RelayError::Disconnected("the extension disconnected".into()))?
}

/// Await the already configured companion extension on the chosen port.
/// Dropping this future closes a partially started listener.
pub async fn attach_via_extension(options: RelayOptions) -> Result<ExtensionRelay, RelayError> {
    let relay = ExtensionRelay::listen(options).await?;
    relay.wait_for_extension().await?;
    Ok(relay)
}

/// Write the bundled companion extension for Chrome's “Load unpacked” dialog.
/// Only the three named extension files are written; other files are retained.
pub fn write_extension_directory(
    destination: impl AsRef<std::path::Path>,
) -> Result<std::path::PathBuf, RelayError> {
    let destination = destination.as_ref();
    std::fs::create_dir_all(destination)?;
    for (name, contents) in [
        (
            "manifest.json",
            include_str!("extension_assets/manifest.json"),
        ),
        (
            "background.js",
            include_str!("extension_assets/background.js"),
        ),
        (
            "relay-handler.js",
            include_str!("extension_assets/relay-handler.js"),
        ),
    ] {
        std::fs::write(destination.join(name), contents)?;
    }
    Ok(destination.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn cancelled_requests_release_pending_slots_and_ignore_late_responses() {
        let state = Arc::new(State::new(RelayOptions::default()));
        let (sender, mut messages) = tokio::sync::mpsc::channel(64);
        *state.outgoing.lock().unwrap() = Some(sender);
        let task_state = state.clone();
        let task = tokio::spawn(async move { request(&task_state, "tabs.list", json!({})).await });
        let sent = timeout(Duration::from_secs(2), messages.recv())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(state.pending.lock().unwrap().len(), 1);
        task.abort();
        assert!(task.await.unwrap_err().is_cancelled());
        assert!(state.pending.lock().unwrap().is_empty());
        state.message(json!({"id":sent["id"], "result":[]}));
        assert!(state.pending.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn pending_request_count_is_bounded_and_disconnect_releases_all_slots() {
        let state = Arc::new(State::new(RelayOptions::default()));
        let (sender, mut messages) = tokio::sync::mpsc::channel(64);
        *state.outgoing.lock().unwrap() = Some(sender);
        let mut tasks = tokio::task::JoinSet::new();
        for _ in 0..64 {
            let state = state.clone();
            tasks.spawn(async move { request(&state, "tabs.list", json!({})).await });
        }
        for _ in 0..64 {
            timeout(Duration::from_secs(2), messages.recv())
                .await
                .unwrap()
                .unwrap();
        }
        assert!(matches!(
            request(&state, "tabs.list", json!({})).await,
            Err(RelayError::Busy)
        ));
        state.disconnect("test disconnected");
        while let Some(result) = tasks.join_next().await {
            assert!(matches!(result.unwrap(), Err(RelayError::Disconnected(_))));
        }
        assert!(state.pending.lock().unwrap().is_empty());
    }

    #[test]
    fn bundled_extension_matches_the_javascript_protocol() {
        let directory =
            crate::browser::profile_directory::create_temporary_user_data_dir(None).unwrap();
        write_extension_directory(&directory).unwrap();
        for name in ["manifest.json", "background.js", "relay-handler.js"] {
            assert_eq!(
                std::fs::read(directory.join(name)).unwrap(),
                std::fs::read(
                    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                        .join("../js/extension")
                        .join(name)
                )
                .unwrap()
            );
        }
        std::fs::remove_dir_all(directory).unwrap();
    }
}
