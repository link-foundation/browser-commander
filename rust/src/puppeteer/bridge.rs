//! The client side of `browser-commander serve --stdio` (issue #108).
//!
//! The JavaScript CLI serves Puppeteer's live objects as remote handles over
//! JSON-RPC 2.0, one message per line (docs/cli-and-bridge.md). This module
//! starts that server through command-stream, matches responses to requests,
//! routes `events.emit` notifications to subscriptions and converts values
//! between Rust and the bridge's value encoding. The generated wrappers in
//! [`super::api`] are thin typed calls on top of [`RemoteHandle`].

use std::collections::{HashMap, VecDeque};
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use base64::Engine as _;
use command_stream::{quote::quote, ProcessRunner, RunOptions, StdinOption};
use serde_json::{json, Map, Value};
use thiserror::Error;
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, oneshot, Mutex};

use crate::utilities::subprocess::kill_owned_process_tree;

/// Path of the JavaScript CLI (`js/bin/browser-commander.js`), when it is not
/// found next to the crate or in `node_modules`.
pub const JS_CLI_ENV: &str = "BROWSER_COMMANDER_JS_CLI";

const STDERR_LINES: usize = 50;
const EXIT_GRACE: Duration = Duration::from_secs(5);

/// Errors from the bridge.
#[derive(Debug, Error)]
pub enum BridgeError {
    /// The server, or Puppeteer behind it, rejected a call.
    #[error("{name}: {message}")]
    Remote {
        /// JSON-RPC error code (`-32000` for errors thrown by Puppeteer).
        code: i64,
        /// Error class (`TimeoutError`, `TypeError`, …) or `RpcError`.
        name: String,
        /// Error message.
        message: String,
        /// Server-side stack, when it sent one.
        stack: Option<String>,
    },
    /// The server went away, or the bridge was closed.
    #[error("serve --stdio closed: {0}")]
    Closed(String),
    /// Reading or writing the pipe failed.
    #[error("serve --stdio I/O error: {0}")]
    Io(#[from] std::io::Error),
    /// A message was not valid JSON.
    #[error("serve --stdio sent invalid JSON: {0}")]
    Json(#[from] serde_json::Error),
    /// A value did not have the type the wrapper declares.
    #[error("expected {expected} from the bridge, got {value}")]
    Decode {
        /// The declared type.
        expected: &'static str,
        /// What arrived.
        value: Value,
    },
    /// Node.js or the JavaScript CLI could not be found or started.
    #[error("serve --stdio unavailable: {0}")]
    Unavailable(String),
}

impl BridgeError {
    /// Whether Puppeteer reported a timeout.
    pub fn is_timeout(&self) -> bool {
        matches!(self, BridgeError::Remote { name, .. } if name == "TimeoutError")
    }

    fn decode(expected: &'static str, value: Value) -> Self {
        BridgeError::Decode { expected, value }
    }
}

fn remote_error(error: &Value) -> BridgeError {
    let data = error.get("data");
    let text = |value: Option<&Value>| value.and_then(Value::as_str).map(str::to_string);
    BridgeError::Remote {
        code: error.get("code").and_then(Value::as_i64).unwrap_or(-32000),
        name: text(data.and_then(|d| d.get("name"))).unwrap_or_else(|| "RpcError".into()),
        message: text(error.get("message")).unwrap_or_default(),
        stack: text(data.and_then(|d| d.get("stack"))),
    }
}

/// A caller waiting for its response; `subscribe` marks `events.subscribe`.
struct Waiter {
    sender: oneshot::Sender<Result<Value, BridgeError>>,
    subscribe: bool,
}

type Pending = HashMap<u64, Waiter>;
type Subscribers = HashMap<String, mpsc::UnboundedSender<Vec<Value>>>;
type Receivers = HashMap<String, mpsc::UnboundedReceiver<Vec<Value>>>;

struct Inner {
    writer: Mutex<Box<dyn AsyncWrite + Send + Unpin>>,
    next_id: AtomicU64,
    pending: StdMutex<Pending>,
    subscribers: StdMutex<Subscribers>,
    /// Channels of subscriptions whose `events.subscribe` has been answered
    /// but not yet picked up by [`RemoteHandle::subscribe`].
    receivers: StdMutex<Receivers>,
    closed: StdMutex<Option<String>>,
    reader: StdMutex<Option<tokio::task::JoinHandle<()>>>,
}

impl Drop for Inner {
    fn drop(&mut self) {
        if let Some(task) = self.reader.get_mut().ok().and_then(Option::take) {
            task.abort();
        }
    }
}

/// A JSON-RPC conversation with one `serve --stdio` server.
///
/// Requests are pipelined: any number can be in flight, and each call waits
/// for the response with its own id.
#[derive(Clone)]
pub struct BridgeClient {
    inner: Arc<Inner>,
}

impl fmt::Debug for BridgeClient {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("BridgeClient")
            .field("closed", &self.close_reason())
            .finish()
    }
}

impl BridgeClient {
    /// Talk to a server over its stdout (`reader`) and stdin (`writer`).
    /// Lines are read on a background task.
    pub fn new<R, W>(reader: R, writer: W) -> Self
    where
        R: AsyncRead + Send + Unpin + 'static,
        W: AsyncWrite + Send + Unpin + 'static,
    {
        let inner = Arc::new(Inner {
            writer: Mutex::new(Box::new(writer)),
            next_id: AtomicU64::new(1),
            pending: StdMutex::new(HashMap::new()),
            subscribers: StdMutex::new(HashMap::new()),
            receivers: StdMutex::new(HashMap::new()),
            closed: StdMutex::new(None),
            reader: StdMutex::new(None),
        });
        let weak = Arc::downgrade(&inner);
        let task = tokio::spawn(async move {
            let mut lines = BufReader::new(reader).lines();
            let reason = loop {
                let line = match lines.next_line().await {
                    Ok(Some(line)) => line,
                    Ok(None) => break "the server closed its output".to_string(),
                    Err(err) => break format!("reading from the server failed: {err}"),
                };
                let Some(inner) = weak.upgrade() else {
                    return;
                };
                let client = BridgeClient { inner };
                match serde_json::from_str::<Value>(&line) {
                    Ok(message) => client.dispatch(message),
                    Err(err) => {
                        tracing::debug!(target: "browser_commander::puppeteer", "ignored line {line:?}: {err}");
                    }
                }
            };
            if let Some(inner) = weak.upgrade() {
                BridgeClient { inner }.mark_closed(reason);
            }
        });
        if let Ok(mut slot) = inner.reader.lock() {
            *slot = Some(task);
        }
        Self { inner }
    }

    /// Send a request and wait for its result.
    pub async fn request(&self, method: &str, params: Value) -> Result<Value, BridgeError> {
        self.send_request(method, params, false).await
    }

    async fn send_request(
        &self,
        method: &str,
        params: Value,
        subscribe: bool,
    ) -> Result<Value, BridgeError> {
        if let Some(reason) = self.close_reason() {
            return Err(BridgeError::Closed(reason));
        }
        let id = self.inner.next_id.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = oneshot::channel();
        self.lock_pending().insert(id, Waiter { sender, subscribe });
        let mut line = serde_json::to_vec(&json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        }))?;
        line.push(b'\n');
        let written = {
            let mut writer = self.inner.writer.lock().await;
            match writer.write_all(&line).await {
                Ok(()) => writer.flush().await,
                Err(err) => Err(err),
            }
        };
        if let Err(err) = written {
            self.lock_pending().remove(&id);
            return Err(err.into());
        }
        match receiver.await {
            Ok(result) => result,
            Err(_) => Err(BridgeError::Closed(
                self.close_reason()
                    .unwrap_or_else(|| "the response was dropped".to_string()),
            )),
        }
    }

    /// `handle.root`: the engine's entry object (`puppeteer`, `playwright`).
    pub async fn root(&self, name: &str) -> Result<RemoteHandle, BridgeError> {
        let value = self.request("handle.root", json!({ "name": name })).await?;
        RemoteHandle::from_wire(self, value)
    }

    /// Why the bridge closed, if it has.
    pub fn close_reason(&self) -> Option<String> {
        self.inner
            .closed
            .lock()
            .ok()
            .and_then(|reason| reason.clone())
    }

    /// End the server's input. `serve --stdio` finishes in-flight requests,
    /// closes its sessions and exits; later calls fail with
    /// [`BridgeError::Closed`].
    pub async fn close_input(&self) {
        let mut writer = self.inner.writer.lock().await;
        let _ = writer.shutdown().await;
        // Shutting a child's stdin down only flushes it; the pipe closes when
        // the handle is dropped.
        *writer = Box::new(tokio::io::sink());
        drop(writer);
        if let Ok(mut closed) = self.inner.closed.lock() {
            closed.get_or_insert_with(|| "the bridge was closed".to_string());
        }
    }

    fn lock_pending(&self) -> std::sync::MutexGuard<'_, Pending> {
        self.inner
            .pending
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn lock_subscribers(&self) -> std::sync::MutexGuard<'_, Subscribers> {
        self.inner
            .subscribers
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn lock_receivers(&self) -> std::sync::MutexGuard<'_, Receivers> {
        self.inner
            .receivers
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn mark_closed(&self, reason: String) {
        if let Ok(mut closed) = self.inner.closed.lock() {
            closed.get_or_insert(reason.clone());
        }
        let pending: Vec<_> = self.lock_pending().drain().collect();
        for (_, waiter) in pending {
            let _ = waiter.sender.send(Err(BridgeError::Closed(reason.clone())));
        }
        self.lock_subscribers().clear();
        self.lock_receivers().clear();
    }

    /// Route one message: a response to its caller, an `events.emit`
    /// notification to its subscription.
    fn dispatch(&self, message: Value) {
        if let Some(id) = message.get("id").and_then(Value::as_u64) {
            let Some(waiter) = self.lock_pending().remove(&id) else {
                return;
            };
            let outcome = match message.get("error") {
                Some(error) => Err(remote_error(error)),
                None => Ok(message.get("result").cloned().unwrap_or(Value::Null)),
            };
            // The server may emit right after answering, so the channel must
            // exist before the reader handles the next line.
            if let (true, Ok(result)) = (waiter.subscribe, &outcome) {
                if let Some(subscription) = result.get("subscription").and_then(Value::as_str) {
                    let (sender, receiver) = mpsc::unbounded_channel();
                    self.lock_subscribers()
                        .insert(subscription.to_string(), sender);
                    self.lock_receivers()
                        .insert(subscription.to_string(), receiver);
                }
            }
            let _ = waiter.sender.send(outcome);
            return;
        }
        if message.get("method").and_then(Value::as_str) != Some("events.emit") {
            return;
        }
        let params = message.get("params").cloned().unwrap_or(Value::Null);
        let Some(subscription) = params.get("subscription").and_then(Value::as_str) else {
            return;
        };
        let args = match params.get("args") {
            Some(Value::Array(args)) => args.clone(),
            _ => Vec::new(),
        };
        let mut subscribers = self.lock_subscribers();
        if let Some(sender) = subscribers.get(subscription) {
            if sender.send(args).is_err() {
                subscribers.remove(subscription);
            }
        }
    }
}

/// A Puppeteer object that lives in the server, such as a `Page`.
///
/// Handles are cheap to clone; every clone names the same object. The
/// generated wrappers hold one each.
#[derive(Clone)]
pub struct RemoteHandle {
    client: BridgeClient,
    id: Arc<str>,
    type_name: Arc<str>,
}

impl fmt::Debug for RemoteHandle {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("RemoteHandle")
            .field("id", &self.id)
            .field("type", &self.type_name)
            .finish()
    }
}

impl PartialEq for RemoteHandle {
    fn eq(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.client.inner, &other.client.inner) && self.id == other.id
    }
}

impl RemoteHandle {
    /// The server's id for the object (`h1`, `h2`, …).
    pub fn id(&self) -> &str {
        &self.id
    }

    /// The object's runtime class as the server reports it (`CdpPage`).
    pub fn type_name(&self) -> &str {
        &self.type_name
    }

    /// The bridge the object lives in.
    pub fn client(&self) -> &BridgeClient {
        &self.client
    }

    /// The handle as an argument: `{"$handle": "h1"}`.
    pub fn to_wire(&self) -> Value {
        json!({ "$handle": &*self.id })
    }

    /// `handle.call`: call a method. `None` arguments are sent as
    /// `undefined`; trailing ones are left out, as JavaScript does.
    pub async fn call<T: FromWire>(
        &self,
        method: &str,
        args: Vec<Option<Value>>,
    ) -> Result<T, BridgeError> {
        let value = self
            .client
            .request(
                "handle.call",
                json!({ "handle": &*self.id, "method": method, "args": encode_args(args) }),
            )
            .await?;
        T::from_wire(&self.client, value)
    }

    /// `handle.get`: read a property (awaited when it is a promise).
    pub async fn get<T: FromWire>(&self, property: &str) -> Result<T, BridgeError> {
        let value = self
            .client
            .request(
                "handle.get",
                json!({ "handle": &*self.id, "property": property }),
            )
            .await?;
        T::from_wire(&self.client, value)
    }

    /// `handle.describe`: the object's type and member names.
    pub async fn describe(&self) -> Result<Value, BridgeError> {
        self.client
            .request("handle.describe", json!({ "handle": &*self.id }))
            .await
    }

    /// `handle.dispose`: forget the handle on the server. The object itself
    /// stays alive; dispose a JS handle with its own `dispose()` method.
    pub async fn release(&self) -> Result<(), BridgeError> {
        self.client
            .request("handle.dispose", json!({ "handle": &*self.id }))
            .await
            .map(|_| ())
    }

    /// `events.subscribe`: receive the arguments of every `event` the object
    /// emits until the [`Subscription`] is closed or dropped.
    pub async fn subscribe(&self, event: &str) -> Result<Subscription, BridgeError> {
        let result = self
            .client
            .send_request(
                "events.subscribe",
                json!({ "handle": &*self.id, "event": event }),
                true,
            )
            .await?;
        let id = result
            .get("subscription")
            .and_then(Value::as_str)
            .ok_or_else(|| BridgeError::decode("a subscription id", result.clone()))?
            .to_string();
        let receiver = self.client.lock_receivers().remove(&id).ok_or_else(|| {
            BridgeError::Closed(
                self.client
                    .close_reason()
                    .unwrap_or_else(|| "the subscription was dropped".to_string()),
            )
        })?;
        Ok(Subscription {
            client: self.client.clone(),
            id,
            receiver,
        })
    }
}

/// Arguments for `handle.call`: `None` is `undefined`, trailing ones dropped.
fn encode_args(mut args: Vec<Option<Value>>) -> Value {
    while matches!(args.last(), Some(None)) {
        args.pop();
    }
    Value::Array(
        args.into_iter()
            .map(|arg| arg.unwrap_or_else(|| json!({ "$undefined": true })))
            .collect(),
    )
}

/// Events from one `events.subscribe`.
#[derive(Debug)]
pub struct Subscription {
    client: BridgeClient,
    id: String,
    receiver: mpsc::UnboundedReceiver<Vec<Value>>,
}

impl Subscription {
    /// The server's subscription id.
    pub fn id(&self) -> &str {
        &self.id
    }

    /// The arguments of the next event, in the bridge's value encoding
    /// ([`decode_handle`] turns `{"$handle": …}` into a typed wrapper).
    /// `None` once the subscription or the bridge is closed.
    pub async fn next(&mut self) -> Option<Vec<Value>> {
        self.receiver.recv().await
    }

    /// `events.unsubscribe`.
    pub async fn close(self) -> Result<(), BridgeError> {
        self.client.lock_subscribers().remove(&self.id);
        self.client
            .request("events.unsubscribe", json!({ "subscription": &self.id }))
            .await
            .map(|_| ())
    }
}

impl Drop for Subscription {
    fn drop(&mut self) {
        // Events stop being delivered; the server-side listener stays until
        // `close` or the end of the bridge.
        self.client.lock_subscribers().remove(&self.id);
    }
}

/// A function argument: `$function` source compiled on the server, or a
/// string, which Puppeteer evaluates as an expression (or treats as a
/// selector where one is expected).
#[derive(Debug, Clone, PartialEq)]
pub struct JsFunction(Value);

impl JsFunction {
    /// A function from its source, such as `"(a, b) => a + b"`.
    pub fn source(source: impl Into<String>) -> Self {
        Self(json!({ "$function": source.into() }))
    }

    /// A string passed as is: an expression for `evaluate`, a selector for
    /// `locator`.
    pub fn text(text: impl Into<String>) -> Self {
        Self(Value::String(text.into()))
    }

    /// The encoded argument.
    pub fn to_wire(&self) -> Value {
        self.0.clone()
    }
}

impl From<&str> for JsFunction {
    fn from(text: &str) -> Self {
        Self::text(text)
    }
}

impl From<String> for JsFunction {
    fn from(text: String) -> Self {
        Self::text(text)
    }
}

/// Bytes as an argument (`$binary`).
pub fn binary(bytes: &[u8]) -> Value {
    json!({ "$binary": base64::engine::general_purpose::STANDARD.encode(bytes) })
}

/// A value as it arrives from the bridge, converted to a declared type.
pub trait FromWire: Sized {
    /// Convert, failing with [`BridgeError::Decode`] on a type mismatch.
    fn from_wire(client: &BridgeClient, value: Value) -> Result<Self, BridgeError>;
}

fn is_undefined(value: &Value) -> bool {
    value.get("$undefined").is_some()
}

impl FromWire for () {
    fn from_wire(_: &BridgeClient, _: Value) -> Result<Self, BridgeError> {
        Ok(())
    }
}

impl FromWire for Value {
    fn from_wire(_: &BridgeClient, value: Value) -> Result<Self, BridgeError> {
        Ok(value)
    }
}

impl FromWire for String {
    fn from_wire(_: &BridgeClient, value: Value) -> Result<Self, BridgeError> {
        match value {
            Value::String(text) => Ok(text),
            other => Err(BridgeError::decode("a string", other)),
        }
    }
}

impl FromWire for f64 {
    fn from_wire(_: &BridgeClient, value: Value) -> Result<Self, BridgeError> {
        match &value {
            Value::Number(number) => number
                .as_f64()
                .ok_or_else(|| BridgeError::decode("a number", value.clone())),
            // The bridge sends NaN and the infinities as null.
            Value::Null => Ok(f64::NAN),
            _ => Err(BridgeError::decode("a number", value)),
        }
    }
}

impl FromWire for bool {
    fn from_wire(_: &BridgeClient, value: Value) -> Result<Self, BridgeError> {
        value
            .as_bool()
            .ok_or_else(|| BridgeError::decode("a boolean", value))
    }
}

impl FromWire for Vec<u8> {
    fn from_wire(_: &BridgeClient, value: Value) -> Result<Self, BridgeError> {
        value
            .get("$binary")
            .and_then(Value::as_str)
            .and_then(|data| base64::engine::general_purpose::STANDARD.decode(data).ok())
            .ok_or_else(|| BridgeError::decode("bytes", value))
    }
}

impl<T: FromWire> FromWire for Option<T> {
    fn from_wire(client: &BridgeClient, value: Value) -> Result<Self, BridgeError> {
        if value.is_null() || is_undefined(&value) {
            return Ok(None);
        }
        T::from_wire(client, value).map(Some)
    }
}

impl<T: FromWire> FromWire for Vec<T> {
    fn from_wire(client: &BridgeClient, value: Value) -> Result<Self, BridgeError> {
        match value {
            Value::Array(items) => items
                .into_iter()
                .map(|item| T::from_wire(client, item))
                .collect(),
            other => Err(BridgeError::decode("a list", other)),
        }
    }
}

impl FromWire for RemoteHandle {
    fn from_wire(client: &BridgeClient, value: Value) -> Result<Self, BridgeError> {
        let Some(id) = value.get("$handle").and_then(Value::as_str) else {
            return Err(BridgeError::decode("a remote object", value));
        };
        Ok(RemoteHandle {
            client: client.clone(),
            id: Arc::from(id),
            type_name: Arc::from(value.get("type").and_then(Value::as_str).unwrap_or("")),
        })
    }
}

/// A typed wrapper of a remote Puppeteer object.
pub trait Remote: Sized {
    /// The Puppeteer type it wraps (`Page`).
    const TYPE: &'static str;

    /// Wrap a handle without checking its type.
    fn from_remote(remote: RemoteHandle) -> Self;

    /// The handle behind the wrapper.
    fn remote(&self) -> &RemoteHandle;

    /// View the same object as another type, for example an `ElementHandle`
    /// as the `JSHandle` it extends.
    fn cast<T: Remote>(&self) -> T {
        T::from_remote(self.remote().clone())
    }
}

/// Decode `{"$handle": …}`, such as an event argument, as a typed wrapper.
pub fn decode_handle<T: Remote>(client: &BridgeClient, value: Value) -> Result<T, BridgeError> {
    RemoteHandle::from_wire(client, value).map(T::from_remote)
}

/// Declare a wrapper struct around a [`RemoteHandle`].
macro_rules! remote_type {
    ($(#[$meta:meta])* $name:ident) => {
        $(#[$meta])*
        #[derive(Clone, Debug, PartialEq)]
        pub struct $name {
            pub(crate) remote: $crate::puppeteer::bridge::RemoteHandle,
        }

        impl $crate::puppeteer::bridge::Remote for $name {
            const TYPE: &'static str = stringify!($name);

            fn from_remote(remote: $crate::puppeteer::bridge::RemoteHandle) -> Self {
                Self { remote }
            }

            fn remote(&self) -> &$crate::puppeteer::bridge::RemoteHandle {
                &self.remote
            }
        }

        impl $crate::puppeteer::bridge::FromWire for $name {
            fn from_wire(
                client: &$crate::puppeteer::bridge::BridgeClient,
                value: serde_json::Value,
            ) -> Result<Self, $crate::puppeteer::bridge::BridgeError> {
                $crate::puppeteer::bridge::decode_handle(client, value)
            }
        }
    };
}
pub(crate) use remote_type;

/// Where the JavaScript CLI is: [`JS_CLI_ENV`], then `js/bin` next to the
/// crate sources, then `node_modules/browser-commander` under `working_dir`
/// (or the current directory).
pub fn js_cli_path(working_dir: Option<&Path>) -> Result<PathBuf, BridgeError> {
    let candidates = if let Some(configured) = std::env::var_os(JS_CLI_ENV) {
        vec![PathBuf::from(configured)]
    } else {
        let base = working_dir
            .map(Path::to_path_buf)
            .or_else(|| std::env::current_dir().ok())
            .unwrap_or_default();
        vec![
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../js/bin/browser-commander.js"),
            base.join("node_modules/browser-commander/bin/browser-commander.js"),
        ]
    };
    candidates
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| {
            BridgeError::Unavailable(format!(
                "the JavaScript CLI was not found; install the browser-commander npm package or set {JS_CLI_ENV}"
            ))
        })
}

/// Options for [`PuppeteerBridge::launch`].
#[derive(Debug, Clone, Default)]
pub struct BridgeOptions {
    /// Node.js executable. Defaults to `BROWSER_COMMANDER_NODE`, then `node`.
    pub node: Option<PathBuf>,
    /// The JavaScript CLI. Defaults to [`js_cli_path`].
    pub cli: Option<PathBuf>,
    /// Working directory of the server.
    pub working_dir: Option<PathBuf>,
    /// Echo the server's stderr as it arrives.
    pub verbose: bool,
}

/// A running `browser-commander serve --stdio` and its client.
pub struct PuppeteerBridge {
    client: BridgeClient,
    runner: Mutex<Option<ProcessRunner>>,
    pid: Option<u32>,
    stderr: Arc<StdMutex<VecDeque<String>>>,
}

impl fmt::Debug for PuppeteerBridge {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("PuppeteerBridge")
            .field("pid", &self.pid)
            .finish()
    }
}

impl PuppeteerBridge {
    /// Start `node <cli> serve --stdio` through command-stream.
    pub async fn launch(options: BridgeOptions) -> Result<Self, BridgeError> {
        let node = options
            .node
            .clone()
            .or_else(|| std::env::var_os("BROWSER_COMMANDER_NODE").map(PathBuf::from))
            .unwrap_or_else(|| PathBuf::from("node"));
        let node = node.to_string_lossy().into_owned();
        let cli = match options.cli.clone() {
            Some(cli) => cli,
            None => js_cli_path(options.working_dir.as_deref())?,
        };
        let cli = cli.to_string_lossy().into_owned();
        let command = [node.as_str(), cli.as_str(), "serve", "--stdio"]
            .into_iter()
            .map(quote)
            .collect::<Vec<_>>()
            .join(" ");

        let mut runner = ProcessRunner::new(
            command,
            RunOptions {
                mirror: false,
                capture: true,
                stdin: StdinOption::Pipe,
                cwd: options.working_dir.clone(),
                shell_operators: false,
                trace: false,
                ..RunOptions::default()
            },
        );
        runner
            .start()
            .await
            .map_err(|err| BridgeError::Unavailable(format!("failed to start {node}: {err}")))?;
        let pid = runner.pid();
        let (stdin, stdout, stderr) = {
            let mut child = runner.child().ok_or_else(|| {
                BridgeError::Unavailable("the server process did not start".to_string())
            })?;
            let native = child.native_mut();
            (
                native.stdin.take(),
                native.stdout.take(),
                native.stderr.take(),
            )
        };
        let (Some(stdin), Some(stdout)) = (stdin, stdout) else {
            if let Some(pid) = pid {
                kill_owned_process_tree(pid);
            }
            return Err(BridgeError::Unavailable(
                "the server's stdin and stdout were not piped".to_string(),
            ));
        };

        let stderr_lines = Arc::new(StdMutex::new(VecDeque::new()));
        if let Some(stderr) = stderr {
            let lines = Arc::clone(&stderr_lines);
            let verbose = options.verbose;
            tokio::spawn(async move {
                let mut reader = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = reader.next_line().await {
                    if verbose {
                        eprintln!("[serve --stdio] {line}");
                    }
                    tracing::debug!(target: "browser_commander::puppeteer", "{line}");
                    if let Ok(mut lines) = lines.lock() {
                        if lines.len() == STDERR_LINES {
                            lines.pop_front();
                        }
                        lines.push_back(line);
                    }
                }
            });
        }

        Ok(Self {
            client: BridgeClient::new(stdout, stdin),
            runner: Mutex::new(Some(runner)),
            pid,
            stderr: stderr_lines,
        })
    }

    /// The JSON-RPC client.
    pub fn client(&self) -> &BridgeClient {
        &self.client
    }

    /// The `puppeteer` module's default export, a `PuppeteerNode`.
    pub async fn puppeteer(&self) -> Result<super::api::PuppeteerNode, BridgeError> {
        let remote = self.client.root("puppeteer").await?;
        Ok(<super::api::PuppeteerNode as Remote>::from_remote(remote))
    }

    /// Process id of the server.
    pub fn pid(&self) -> Option<u32> {
        self.pid
    }

    /// The server's most recent stderr lines.
    pub fn stderr_tail(&self) -> Vec<String> {
        self.stderr
            .lock()
            .map(|lines| lines.iter().cloned().collect())
            .unwrap_or_default()
    }

    /// Stop the server: end its input, give it time to finish, then kill
    /// whatever is left of its process tree. Browsers started with
    /// `PuppeteerNode::launch` should be closed first.
    pub async fn close(&self) {
        self.client.close_input().await;
        let Some(mut runner) = self.runner.lock().await.take() else {
            return;
        };
        let deadline = tokio::time::Instant::now() + EXIT_GRACE;
        loop {
            let exited = runner
                .child()
                .map(|mut child| matches!(child.native_mut().try_wait(), Ok(Some(_))))
                .unwrap_or(true);
            if exited || tokio::time::Instant::now() >= deadline {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        if let Some(pid) = self.pid {
            kill_owned_process_tree(pid);
        }
    }
}

impl Drop for PuppeteerBridge {
    fn drop(&mut self) {
        let still_owned = self
            .runner
            .try_lock()
            .map(|runner| runner.is_some())
            .unwrap_or(true);
        if still_owned {
            if let Some(pid) = self.pid {
                kill_owned_process_tree(pid);
            }
        }
    }
}

/// An object literal from optional fields, leaving out the `None`s.
pub fn options(fields: impl IntoIterator<Item = (&'static str, Option<Value>)>) -> Value {
    Value::Object(
        fields
            .into_iter()
            .filter_map(|(key, value)| value.map(|value| (key.to_string(), value)))
            .collect::<Map<String, Value>>(),
    )
}

#[cfg(test)]
#[path = "bridge_tests.rs"]
mod tests;
