use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex, Weak,
    },
};

use serde_json::Value;
use tokio::sync::{broadcast, mpsc, oneshot, watch};

use super::{RelayError, RelayEvent, RelayExtension, RelayOptions};

pub(super) type PendingResult = oneshot::Sender<Result<Value, RelayError>>;

pub(super) struct State {
    pub options: RelayOptions,
    pub connected: AtomicBool,
    pub next_id: AtomicU64,
    pub extension: watch::Sender<Option<RelayExtension>>,
    pub outgoing: Mutex<Option<mpsc::Sender<Value>>>,
    pub pending: Mutex<HashMap<u64, PendingResult>>,
    pub sessions: Mutex<HashMap<i64, Weak<SessionState>>>,
    pub session_lock: tokio::sync::Mutex<()>,
    pub shutdown: watch::Sender<bool>,
}

impl State {
    pub fn new(options: RelayOptions) -> Self {
        Self {
            options,
            connected: AtomicBool::new(false),
            next_id: AtomicU64::new(1),
            extension: watch::channel(None).0,
            outgoing: Mutex::new(None),
            pending: Mutex::new(HashMap::new()),
            sessions: Mutex::new(HashMap::new()),
            session_lock: tokio::sync::Mutex::new(()),
            shutdown: watch::channel(false).0,
        }
    }

    pub fn disconnect(&self, reason: &str) {
        self.extension.send_replace(None);
        self.outgoing.lock().unwrap().take();
        for (_, pending) in self.pending.lock().unwrap().drain() {
            let _ = pending.send(Err(RelayError::Disconnected(reason.to_owned())));
        }
        for (_, session) in self.sessions.lock().unwrap().drain() {
            if let Some(session) = session.upgrade() {
                session.mark_detached(reason);
            }
        }
        self.connected.store(false, Ordering::Release);
    }

    pub fn message(&self, message: Value) {
        let kind = message.get("type").and_then(Value::as_str);
        if matches!(kind, Some("event" | "detached")) {
            let session = message.get("tabId").and_then(Value::as_i64).and_then(|id| {
                self.sessions
                    .lock()
                    .unwrap()
                    .get(&id)
                    .and_then(Weak::upgrade)
            });
            if let Some(session) = session {
                if kind == Some("detached") {
                    session.mark_detached(
                        message
                            .get("reason")
                            .and_then(Value::as_str)
                            .unwrap_or("detached"),
                    );
                } else if let Some(method) = message.get("method").and_then(Value::as_str) {
                    let params = message
                        .get("params")
                        .filter(|value| value.is_object())
                        .cloned()
                        .unwrap_or_else(|| serde_json::json!({}));
                    let _ = session.events.send(RelayEvent {
                        method: method.to_owned(),
                        params,
                    });
                }
            }
            return;
        }
        if let Some(id) = message.get("id").and_then(Value::as_u64) {
            if let Some(pending) = self.pending.lock().unwrap().remove(&id) {
                let result =
                    if let Some(error) = message.get("error").filter(|value| !value.is_null()) {
                        Err(RelayError::Remote(
                            error
                                .get("message")
                                .and_then(Value::as_str)
                                .unwrap_or("unknown error")
                                .to_owned(),
                        ))
                    } else {
                        Ok(message.get("result").cloned().unwrap_or(Value::Null))
                    };
                let _ = pending.send(result);
            }
        }
    }
}

pub(super) struct SessionState {
    pub tab_id: i64,
    pub detached: AtomicBool,
    pub events: broadcast::Sender<RelayEvent>,
    pub relay: Arc<State>,
}

impl SessionState {
    pub fn mark_detached(&self, reason: &str) {
        if !self.detached.swap(true, Ordering::AcqRel) {
            let _ = self.events.send(RelayEvent {
                method: "detached".into(),
                params: serde_json::json!({"reason":reason}),
            });
        }
    }
}

/// Cancelling a request immediately removes its outstanding response slot.
pub(super) struct PendingGuard {
    pub id: u64,
    pub state: Arc<State>,
}

impl Drop for PendingGuard {
    fn drop(&mut self) {
        self.state.pending.lock().unwrap().remove(&self.id);
    }
}

/// A failed handshake releases its reservation; an accepted socket rejects
/// pending calls and detaches all sessions on every exit path, including abort.
pub(super) struct ConnectionGuard {
    pub state: Arc<State>,
    pub owns: Arc<AtomicBool>,
}

impl Drop for ConnectionGuard {
    fn drop(&mut self) {
        if self.owns.load(Ordering::Acquire) {
            self.state.disconnect("the extension disconnected");
        }
    }
}
