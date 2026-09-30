//! Native WebDriver BiDi multiplexing with typed context and script operations.

use anyhow::{anyhow, Result};
use async_tungstenite::tungstenite::{protocol::WebSocketConfig, Message};
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tokio::{
    sync::{broadcast, mpsc, oneshot},
    task::JoinHandle,
    time::timeout,
};

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct BidiEvent {
    pub method: String,
    pub params: Value,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowsingContext {
    pub context: String,
    pub url: String,
    pub children: Option<Vec<BrowsingContext>>,
    #[serde(default)]
    pub parent: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ContextTree {
    pub contexts: Vec<BrowsingContext>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct NavigationResult {
    pub navigation: Option<String>,
    pub url: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum ScriptResult {
    Success {
        result: Value,
        realm: String,
    },
    Exception {
        #[serde(rename = "exceptionDetails")]
        exception_details: Value,
        realm: String,
    },
}

struct State {
    closed: AtomicBool,
    pending: Mutex<HashMap<u64, oneshot::Sender<Result<Value>>>>,
    events: broadcast::Sender<BidiEvent>,
}
impl State {
    fn disconnect(&self) {
        if self.closed.swap(true, Ordering::AcqRel) {
            return;
        }
        for (_, sender) in self.pending.lock().unwrap().drain() {
            let _ = sender.send(Err(anyhow!("BiDi disconnected")));
        }
        let _ = self.events.send(BidiEvent {
            method: "disconnected".into(),
            params: json!({}),
        });
    }
}
struct Pending {
    id: u64,
    state: Arc<State>,
}
impl Drop for Pending {
    fn drop(&mut self) {
        self.state.pending.lock().unwrap().remove(&self.id);
    }
}

/// One owned connection. Up to 64 outstanding calls, 4 MiB incoming messages,
/// and 1,024 retained events. Slow subscribers receive `RecvError::Lagged`.
pub struct BidiClient {
    state: Arc<State>,
    next: AtomicU64,
    outgoing: mpsc::Sender<Value>,
    shutdown: tokio::sync::watch::Sender<bool>,
    task: Mutex<Option<JoinHandle<()>>>,
}
impl BidiClient {
    pub async fn connect(url: &str) -> Result<Self> {
        let parsed = url::Url::parse(url)?;
        if !matches!(parsed.scheme(), "ws" | "wss")
            || !matches!(
                parsed.host_str(),
                Some("127.0.0.1" | "localhost" | "[::1]" | "::1")
            )
        {
            return Err(anyhow!(
                "managed BiDi endpoint must be a loopback WebSocket"
            ));
        }
        // The native driver is local. Bound handshake latency as well as frames.
        let config = WebSocketConfig::default()
            .max_message_size(Some(4 * 1024 * 1024))
            .max_frame_size(Some(4 * 1024 * 1024));
        let (mut socket, _) = timeout(
            Duration::from_secs(10),
            async_tungstenite::tokio::connect_async_with_config(url, Some(config)),
        )
        .await??;
        let (outgoing, mut queue) = mpsc::channel::<Value>(64);
        let (shutdown, mut closing) = tokio::sync::watch::channel(false);
        let state = Arc::new(State {
            closed: AtomicBool::new(false),
            pending: Mutex::new(HashMap::new()),
            events: broadcast::channel(1024).0,
        });
        let actor = state.clone();
        let task = tokio::spawn(async move {
            loop {
                tokio::select! {
                    _=closing.changed()=>break,
                    request=queue.recv()=>match request {
                        Some(request)=>if socket.send(Message::Text(request.to_string().into())).await.is_err(){break;},
                        None=>break,
                    },
                    frame=socket.next()=>match frame {
                        Some(Ok(Message::Text(text)))=>{
                            let Ok(message)=serde_json::from_str::<Value>(&text) else {tracing::debug!("Ignoring malformed BiDi message");continue;};
                            if let Some(id)=message.get("id").and_then(Value::as_u64) {
                                if let Some(sender)=actor.pending.lock().unwrap().remove(&id) {
                                    let result=if message.get("type").and_then(Value::as_str)==Some("error") || message.get("error").is_some() {
                                        Err(anyhow!("BiDi {}: {}",message.get("error").and_then(Value::as_str).unwrap_or("error"),message.get("message").and_then(Value::as_str).unwrap_or("unknown error")))
                                    } else {Ok(message.get("result").cloned().unwrap_or(Value::Null))};
                                    let _=sender.send(result);
                                }
                            } else if let Some(method)=message.get("method").and_then(Value::as_str) {
                                let _=actor.events.send(BidiEvent{method:method.into(),params:message.get("params").cloned().unwrap_or_else(||json!({}))});
                            }
                        },
                        Some(Ok(Message::Ping(data)))=>if socket.send(Message::Pong(data)).await.is_err(){break;},
                        None|Some(Err(_))|Some(Ok(Message::Close(_)))=>break,
                        _=>{},
                    }
                }
            }
            actor.disconnect();
            let _ = timeout(Duration::from_secs(1), socket.close(None)).await;
        });
        Ok(Self {
            state,
            next: AtomicU64::new(1),
            outgoing,
            shutdown,
            task: Mutex::new(Some(task)),
        })
    }

    /// Dynamic fallback for newly introduced BiDi protocol commands.
    pub async fn send(&self, method: &str, params: Value) -> Result<Value> {
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = oneshot::channel();
        {
            let mut pending = self.state.pending.lock().unwrap();
            if self.state.closed.load(Ordering::Acquire) {
                return Err(anyhow!("BiDi disconnected"));
            }
            if pending.len() >= 64 {
                return Err(anyhow!("Too many pending BiDi requests"));
            }
            pending.insert(id, sender);
        }
        let _guard = Pending {
            id,
            state: self.state.clone(),
        };
        timeout(Duration::from_secs(30), async {
            self.outgoing
                .send(json!({"id":id,"method":method,"params":params}))
                .await
                .map_err(|_| anyhow!("BiDi disconnected"))?;
            receiver.await.map_err(|_| anyhow!("BiDi disconnected"))?
        })
        .await
        .map_err(|_| anyhow!("BiDi request timed out"))?
    }
    pub fn events(&self) -> broadcast::Receiver<BidiEvent> {
        self.state.events.subscribe()
    }
    pub async fn subscribe(&self, events: &[&str], contexts: Option<&[&str]>) -> Result<()> {
        let mut params = json!({"events":events});
        if let Some(contexts) = contexts {
            params["contexts"] = json!(contexts);
        }
        self.send("session.subscribe", params).await?;
        Ok(())
    }
    pub async fn unsubscribe(&self, events: &[&str], contexts: Option<&[&str]>) -> Result<()> {
        let mut params = json!({"events":events});
        if let Some(contexts) = contexts {
            params["contexts"] = json!(contexts);
        }
        self.send("session.unsubscribe", params).await?;
        Ok(())
    }
    pub async fn get_tree(&self) -> Result<ContextTree> {
        Ok(serde_json::from_value(
            self.send("browsingContext.getTree", json!({})).await?,
        )?)
    }
    pub async fn navigate(&self, context: &str, url: &str) -> Result<NavigationResult> {
        Ok(serde_json::from_value(
            self.send(
                "browsingContext.navigate",
                json!({"context":context,"url":url,"wait":"complete"}),
            )
            .await?,
        )?)
    }
    pub async fn evaluate(&self, context: &str, expression: &str) -> Result<ScriptResult> {
        Ok(serde_json::from_value(self.send("script.evaluate",json!({"target":{"context":context},"expression":expression,"awaitPromise":true,"resultOwnership":"none"})).await?)?)
    }
    pub async fn close(&self) {
        let task = self.task.lock().unwrap().take();
        self.state.disconnect();
        let _ = self.shutdown.send(true);
        if let Some(mut task) = task {
            if timeout(Duration::from_secs(2), &mut task).await.is_err() {
                task.abort();
                let _ = task.await;
            }
        }
    }
}
impl Drop for BidiClient {
    fn drop(&mut self) {
        if let Some(task) = self.task.lock().unwrap().take() {
            task.abort();
        }
        self.state.disconnect();
    }
}
