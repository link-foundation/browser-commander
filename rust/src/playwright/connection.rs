//! Runtime for the generated Playwright protocol bindings.
//!
//! The Playwright driver speaks a JSON message protocol over a pipe. The client
//! sends `{id, guid, method, params, metadata}` calls to an object (a
//! "channel") and the driver answers with `{id, result}` or `{id, error}`. The
//! driver also pushes messages without an `id`: `__create__` announces a new
//! object together with its initializer, `__adopt__` moves an object to a new
//! parent, `__dispose__` drops an object and its children, and anything else
//! is an event on the object named by `guid`.
//!
//! [`Connection`] owns that conversation. The generated types in
//! [`crate::playwright::protocol`] are thin [`ChannelType`] wrappers around a
//! [`Channel`] (the object's guid plus the connection).

use std::collections::HashMap;
use std::fmt;
use std::marker::PhantomData;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};

use serde::de::DeserializeOwned;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::{json, Value};
use thiserror::Error;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::sync::{broadcast, oneshot, Mutex};
use tokio::task::JoinHandle;

use super::protocol::{Playwright, Root, RootInitializeParams, SDKLanguage};
use super::transport::{read_message, write_message};

/// Base64-encoded bytes, the protocol's `binary` type.
pub type Binary = String;

/// Errors from the Playwright protocol runtime.
#[derive(Debug, Error)]
pub enum ProtocolError {
    /// The driver rejected a call.
    #[error("{name}: {message}")]
    Remote {
        /// Error class reported by the driver (e.g. `TimeoutError`).
        name: String,
        /// Error message.
        message: String,
        /// Driver-side stack, when it sent one.
        stack: Option<String>,
    },
    /// The driver went away, or the connection was closed.
    #[error("Playwright driver connection closed: {0}")]
    Closed(String),
    /// Reading or writing the pipe failed.
    #[error("Playwright driver I/O error: {0}")]
    Io(#[from] std::io::Error),
    /// A message did not match the protocol types.
    #[error("Playwright protocol message did not match the spec: {0}")]
    Json(#[from] serde_json::Error),
    /// A reference named an object the driver never created (or disposed).
    #[error("unknown Playwright object {0}")]
    UnknownObject(String),
    /// A reference named an object of another interface.
    #[error("Playwright object {guid} is a {actual}, expected {expected}")]
    WrongInterface {
        /// The object's guid.
        guid: String,
        /// The interface the caller asked for.
        expected: &'static str,
        /// The interface the driver created.
        actual: String,
    },
    /// The driver could not be found or started.
    #[error("Playwright driver unavailable: {0}")]
    Driver(String),
}

impl ProtocolError {
    /// Whether the driver reported a timeout.
    pub fn is_timeout(&self) -> bool {
        matches!(self, ProtocolError::Remote { name, .. } if name == "TimeoutError")
    }
}

/// A typed reference to a channel object, serialized as `{"guid": ...}`.
pub struct Ref<T> {
    /// The referenced object's guid.
    pub guid: String,
    marker: PhantomData<fn() -> T>,
}

impl<T> Ref<T> {
    /// A reference to the object with this guid.
    pub fn new(guid: impl Into<String>) -> Self {
        Self {
            guid: guid.into(),
            marker: PhantomData,
        }
    }
}

impl<T: ChannelType> From<&T> for Ref<T> {
    fn from(object: &T) -> Self {
        Ref::new(object.channel().guid())
    }
}

impl<T> Clone for Ref<T> {
    fn clone(&self) -> Self {
        Ref::new(self.guid.clone())
    }
}

impl<T> Default for Ref<T> {
    fn default() -> Self {
        Ref::new(String::new())
    }
}

impl<T> PartialEq for Ref<T> {
    fn eq(&self, other: &Self) -> bool {
        self.guid == other.guid
    }
}

impl<T> fmt::Debug for Ref<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Ref({})", self.guid)
    }
}

impl<T> Serialize for Ref<T> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        ObjectRef {
            guid: self.guid.clone(),
        }
        .serialize(serializer)
    }
}

impl<'de, T> Deserialize<'de> for Ref<T> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Ok(Ref::new(ObjectRef::deserialize(deserializer)?.guid))
    }
}

/// An untyped reference to any channel object (the spec's `Channel` type).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ObjectRef {
    /// The referenced object's guid.
    pub guid: String,
}

/// An event type generated for one interface.
pub trait ProtocolEvent: Sized + Send + 'static {
    /// Decode the event named `method` from its raw parameters.
    fn parse(method: &str, params: Value) -> Result<Self, serde_json::Error>;
}

/// A generated channel type (one per protocol interface).
pub trait ChannelType: Sized + Clone + Send + Sync + 'static {
    /// Interface name in the spec.
    const INTERFACE: &'static str;
    /// The initializer the driver sends in `__create__`.
    type Initializer: DeserializeOwned;
    /// The events the interface can emit.
    type Event: ProtocolEvent;

    /// Whether an object of `interface` can be used as this type (an
    /// `ElementHandle` is also a `JSHandle`).
    fn accepts(interface: &str) -> bool;
    /// Wrap a channel.
    fn from_channel(channel: Channel) -> Self;
    /// The underlying channel.
    fn channel(&self) -> &Channel;

    /// The object's guid.
    fn guid(&self) -> &str {
        self.channel().guid()
    }

    /// The typed initializer the driver created this object with.
    fn initializer(&self) -> Result<Self::Initializer, ProtocolError> {
        let raw = self.channel().connection().raw_initializer(self.guid())?;
        Ok(serde_json::from_value(raw)?)
    }

    /// Subscribe to this object's events from now on.
    fn events(&self) -> EventStream<Self::Event> {
        EventStream {
            guid: self.guid().to_string(),
            receiver: self.channel().connection().subscribe(),
            marker: PhantomData,
        }
    }
}

/// One object on a [`Connection`]: its guid and the connection.
#[derive(Clone)]
pub struct Channel {
    guid: Arc<str>,
    connection: Connection,
}

impl fmt::Debug for Channel {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Channel({})", self.guid)
    }
}

impl Channel {
    /// The object's guid.
    pub fn guid(&self) -> &str {
        &self.guid
    }

    /// The connection the object lives on.
    pub fn connection(&self) -> &Connection {
        &self.connection
    }

    /// Call `method` and decode its result.
    pub async fn send<P, R>(&self, method: &str, params: &P) -> Result<R, ProtocolError>
    where
        P: Serialize + ?Sized,
        R: DeserializeOwned,
    {
        self.send_with_timeout(method, params, self.connection.default_timeout())
            .await
    }

    /// [`send`](Self::send) with its own timeout, in milliseconds (`None`
    /// waits as long as the driver does).
    pub async fn send_with_timeout<P, R>(
        &self,
        method: &str,
        params: &P,
        timeout_ms: Option<f64>,
    ) -> Result<R, ProtocolError>
    where
        P: Serialize + ?Sized,
        R: DeserializeOwned,
    {
        let params = serde_json::to_value(params)?;
        let result = match self
            .connection
            .call_with_timeout(&self.guid, method, params, timeout_ms)
            .await?
        {
            // A result whose fields are all absent can arrive as no result.
            Value::Null => json!({}),
            result => result,
        };
        Ok(serde_json::from_value(result)?)
    }

    /// Call a `method` that returns nothing.
    pub async fn send_no_result<P>(&self, method: &str, params: &P) -> Result<(), ProtocolError>
    where
        P: Serialize + ?Sized,
    {
        let params = serde_json::to_value(params)?;
        self.connection.call(&self.guid, method, params).await?;
        Ok(())
    }
}

/// A raw event as the driver sent it.
#[derive(Debug, Clone, PartialEq)]
pub struct RawEvent {
    /// Object the event belongs to.
    pub guid: String,
    /// Event name.
    pub method: String,
    /// Event parameters.
    pub params: Value,
}

/// A stream of one object's typed events.
pub struct EventStream<E> {
    guid: String,
    receiver: broadcast::Receiver<RawEvent>,
    marker: PhantomData<fn() -> E>,
}

impl<E: ProtocolEvent> EventStream<E> {
    /// Wait for the object's next event.
    ///
    /// Events that arrive while the subscriber lags far behind are dropped
    /// rather than buffered without bound.
    pub async fn recv(&mut self) -> Result<E, ProtocolError> {
        loop {
            match self.receiver.recv().await {
                Ok(event) if event.guid == self.guid => {
                    return Ok(E::parse(&event.method, event.params)?);
                }
                Ok(_) | Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => {
                    return Err(ProtocolError::Closed("event stream ended".to_string()));
                }
            }
        }
    }
}

#[derive(Debug, Clone)]
struct ObjectEntry {
    interface: String,
    initializer: Value,
    parent: String,
}

type Pending = HashMap<u64, oneshot::Sender<Result<Value, ProtocolError>>>;

struct Inner {
    writer: Mutex<Box<dyn AsyncWrite + Send + Unpin>>,
    next_id: AtomicU64,
    pending: StdMutex<Pending>,
    objects: StdMutex<HashMap<String, ObjectEntry>>,
    events: broadcast::Sender<RawEvent>,
    closed: StdMutex<Option<String>>,
    default_timeout: StdMutex<Option<f64>>,
    reader: StdMutex<Option<JoinHandle<()>>>,
}

impl Drop for Inner {
    fn drop(&mut self) {
        if let Some(reader) = self.reader.lock().ok().and_then(|mut slot| slot.take()) {
            reader.abort();
        }
    }
}

/// A protocol conversation with one Playwright driver.
#[derive(Clone)]
pub struct Connection {
    inner: Arc<Inner>,
}

impl fmt::Debug for Connection {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Connection")
            .field("closed", &self.close_reason())
            .finish()
    }
}

const EVENT_BUFFER: usize = 1024;

impl Connection {
    /// Start a conversation over a framed byte stream (the driver's stdout and
    /// stdin). Messages are read on a background task.
    pub fn new<R, W>(reader: R, writer: W) -> Self
    where
        R: AsyncRead + Send + Unpin + 'static,
        W: AsyncWrite + Send + Unpin + 'static,
    {
        let (events, _) = broadcast::channel(EVENT_BUFFER);
        let inner = Arc::new(Inner {
            writer: Mutex::new(Box::new(writer)),
            next_id: AtomicU64::new(1),
            pending: StdMutex::new(HashMap::new()),
            objects: StdMutex::new(HashMap::new()),
            events,
            closed: StdMutex::new(None),
            default_timeout: StdMutex::new(None),
            reader: StdMutex::new(None),
        });
        let weak = Arc::downgrade(&inner);
        let task = tokio::spawn(async move {
            let mut reader = reader;
            let reason = loop {
                let message = match read_message(&mut reader).await {
                    Ok(Some(message)) => message,
                    Ok(None) => break "the driver closed its output".to_string(),
                    Err(err) => break format!("reading from the driver failed: {err}"),
                };
                let Some(inner) = weak.upgrade() else {
                    return;
                };
                Connection { inner }.dispatch(message);
            };
            if let Some(inner) = weak.upgrade() {
                Connection { inner }.mark_closed(reason);
            }
        });
        if let Ok(mut slot) = inner.reader.lock() {
            *slot = Some(task);
        }
        Self { inner }
    }

    /// Run the `initialize` handshake and return the `Playwright` root object.
    pub async fn initialize(&self) -> Result<Playwright, ProtocolError> {
        let root = Root::from_channel(self.channel(""));
        let result = root
            .initialize(RootInitializeParams {
                sdk_language: SDKLanguage::Javascript,
            })
            .await?;
        self.object(&result.playwright)
    }

    /// A channel for the object with `guid`, without checking that it exists.
    pub fn channel(&self, guid: &str) -> Channel {
        Channel {
            guid: Arc::from(guid),
            connection: self.clone(),
        }
    }

    /// Resolve a typed reference to the object the driver created.
    pub fn object<T: ChannelType>(&self, reference: &Ref<T>) -> Result<T, ProtocolError> {
        self.object_by_guid(&reference.guid)
    }

    /// Resolve a guid to a typed object, checking its interface.
    pub fn object_by_guid<T: ChannelType>(&self, guid: &str) -> Result<T, ProtocolError> {
        let interface = self
            .lock_objects()
            .get(guid)
            .map(|entry| entry.interface.clone())
            .ok_or_else(|| ProtocolError::UnknownObject(guid.to_string()))?;
        if !T::accepts(&interface) {
            return Err(ProtocolError::WrongInterface {
                guid: guid.to_string(),
                expected: T::INTERFACE,
                actual: interface,
            });
        }
        Ok(T::from_channel(self.channel(guid)))
    }

    /// The live children of `parent` that are `T`s, in no particular order.
    pub fn children<T: ChannelType>(&self, parent: &str) -> Vec<T> {
        let mut guids: Vec<String> = self
            .lock_objects()
            .iter()
            .filter(|(_, entry)| entry.parent == parent && T::accepts(&entry.interface))
            .map(|(guid, _)| guid.clone())
            .collect();
        guids.sort();
        guids
            .into_iter()
            .map(|guid| T::from_channel(self.channel(&guid)))
            .collect()
    }

    /// The raw initializer of a live object.
    pub fn raw_initializer(&self, guid: &str) -> Result<Value, ProtocolError> {
        self.lock_objects()
            .get(guid)
            .map(|entry| entry.initializer.clone())
            .ok_or_else(|| ProtocolError::UnknownObject(guid.to_string()))
    }

    /// Number of live objects the driver has announced.
    pub fn object_count(&self) -> usize {
        self.lock_objects().len()
    }

    /// Subscribe to every event from now on.
    pub fn subscribe(&self) -> broadcast::Receiver<RawEvent> {
        self.inner.events.subscribe()
    }

    /// Why the connection closed, if it has.
    pub fn close_reason(&self) -> Option<String> {
        self.inner
            .closed
            .lock()
            .ok()
            .and_then(|reason| reason.clone())
    }

    /// Set the timeout, in milliseconds, sent with every call that does not
    /// name its own. The driver treats a call without one as unbounded.
    pub fn set_default_timeout(&self, timeout_ms: Option<f64>) {
        if let Ok(mut slot) = self.inner.default_timeout.lock() {
            *slot = timeout_ms;
        }
    }

    /// The timeout sent with calls that do not name their own.
    pub fn default_timeout(&self) -> Option<f64> {
        self.inner
            .default_timeout
            .lock()
            .ok()
            .and_then(|slot| *slot)
    }

    /// Send a raw call and wait for its raw result.
    pub async fn call(
        &self,
        guid: &str,
        method: &str,
        params: Value,
    ) -> Result<Value, ProtocolError> {
        self.call_with_timeout(guid, method, params, self.default_timeout())
            .await
    }

    /// Send a raw call with an explicit timeout in milliseconds (`None` waits
    /// as long as the driver does).
    pub async fn call_with_timeout(
        &self,
        guid: &str,
        method: &str,
        params: Value,
        timeout_ms: Option<f64>,
    ) -> Result<Value, ProtocolError> {
        if let Some(reason) = self.close_reason() {
            return Err(ProtocolError::Closed(reason));
        }
        let id = self.inner.next_id.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = oneshot::channel();
        self.lock_pending().insert(id, sender);
        let message = json!({
            "id": id,
            "guid": guid,
            "method": method,
            "params": params,
            "metadata": match timeout_ms {
                Some(timeout) => json!({ "timeout": timeout }),
                None => json!({}),
            },
        });
        let written = {
            let mut writer = self.inner.writer.lock().await;
            write_message(&mut *writer, &message).await
        };
        if let Err(err) = written {
            self.lock_pending().remove(&id);
            return Err(err.into());
        }
        match receiver.await {
            Ok(result) => result,
            Err(_) => Err(ProtocolError::Closed(
                self.close_reason()
                    .unwrap_or_else(|| "the response was dropped".to_string()),
            )),
        }
    }

    /// Close the pipe to the driver. `run-driver` exits once its input ends;
    /// calls made afterwards fail with [`ProtocolError::Closed`].
    pub async fn close_input(&self) {
        use tokio::io::AsyncWriteExt;
        let mut writer = self.inner.writer.lock().await;
        let _ = writer.shutdown().await;
        // Shutting a child's stdin down only flushes it; the pipe closes when
        // the handle is dropped.
        *writer = Box::new(tokio::io::sink());
        drop(writer);
        if let Ok(mut closed) = self.inner.closed.lock() {
            closed.get_or_insert_with(|| "the connection was closed".to_string());
        }
    }

    fn lock_objects(&self) -> std::sync::MutexGuard<'_, HashMap<String, ObjectEntry>> {
        self.inner
            .objects
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn lock_pending(&self) -> std::sync::MutexGuard<'_, Pending> {
        self.inner
            .pending
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn mark_closed(&self, reason: String) {
        if let Ok(mut closed) = self.inner.closed.lock() {
            closed.get_or_insert(reason.clone());
        }
        let pending: Vec<_> = self.lock_pending().drain().collect();
        for (_, sender) in pending {
            let _ = sender.send(Err(ProtocolError::Closed(reason.clone())));
        }
    }

    /// Route one message from the driver.
    pub(crate) fn dispatch(&self, message: Value) {
        if let Some(id) = message.get("id").and_then(Value::as_u64) {
            let Some(sender) = self.lock_pending().remove(&id) else {
                return;
            };
            let outcome = match message.get("error") {
                Some(error) => Err(remote_error(error)),
                None => Ok(message.get("result").cloned().unwrap_or(Value::Null)),
            };
            let _ = sender.send(outcome);
            return;
        }
        let guid = message
            .get("guid")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let method = message
            .get("method")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let params = message.get("params").cloned().unwrap_or(Value::Null);
        match method.as_str() {
            "__create__" => {
                let child = params["guid"].as_str().unwrap_or_default().to_string();
                let entry = ObjectEntry {
                    interface: params["type"].as_str().unwrap_or_default().to_string(),
                    initializer: params.get("initializer").cloned().unwrap_or(json!({})),
                    parent: guid,
                };
                self.lock_objects().insert(child, entry);
            }
            "__adopt__" => {
                if let Some(child) = params["guid"].as_str() {
                    if let Some(entry) = self.lock_objects().get_mut(child) {
                        entry.parent = guid;
                    }
                }
            }
            "__dispose__" => self.dispose(&guid),
            _ => {
                self.track_live_state(&guid, &method, &params);
                let _ = self.inner.events.send(RawEvent {
                    guid,
                    method,
                    params,
                });
            }
        }
    }

    /// Keep the state the official clients track from events in the
    /// initializer, so it reads current: a frame's `url` and `name` follow
    /// `navigated`, and its `loadStates` follow `loadstate`.
    fn track_live_state(&self, guid: &str, method: &str, params: &Value) {
        let mut objects = self.lock_objects();
        let Some(entry) = objects.get_mut(guid) else {
            return;
        };
        if entry.interface != "Frame" {
            return;
        }
        let Some(initializer) = entry.initializer.as_object_mut() else {
            return;
        };
        match method {
            "navigated" if params.get("error").is_none() => {
                for key in ["url", "name"] {
                    if let Some(value) = params.get(key) {
                        initializer.insert(key.to_string(), value.clone());
                    }
                }
            }
            "loadstate" => {
                let states = initializer.entry("loadStates").or_insert_with(|| json!([]));
                let Some(states) = states.as_array_mut() else {
                    return;
                };
                if let Some(added) = params.get("add") {
                    if !states.contains(added) {
                        states.push(added.clone());
                    }
                }
                if let Some(removed) = params.get("remove") {
                    states.retain(|state| state != removed);
                }
            }
            _ => {}
        }
    }

    fn dispose(&self, guid: &str) {
        let mut objects = self.lock_objects();
        let mut stack = vec![guid.to_string()];
        while let Some(current) = stack.pop() {
            objects.remove(&current);
            stack.extend(
                objects
                    .iter()
                    .filter(|(_, entry)| entry.parent == current)
                    .map(|(child, _)| child.clone()),
            );
        }
    }
}

fn remote_error(error: &Value) -> ProtocolError {
    let details = error.get("error").unwrap_or(error);
    let text = |key: &str| details.get(key).and_then(Value::as_str).map(str::to_string);
    ProtocolError::Remote {
        name: text("name").unwrap_or_else(|| "Error".to_string()),
        message: text("message").unwrap_or_else(|| details.to_string()),
        stack: text("stack"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::playwright::protocol::{
        BrowserContext, ElementHandle, JSHandle, Page, PageEvent, PageInitializer,
    };

    fn offline() -> Connection {
        let (client, _server) = tokio::io::duplex(1024);
        let (reader, writer) = tokio::io::split(client);
        Connection::new(reader, writer)
    }

    fn create(connection: &Connection, parent: &str, interface: &str, guid: &str, init: Value) {
        connection.dispatch(json!({
            "guid": parent,
            "method": "__create__",
            "params": { "type": interface, "guid": guid, "initializer": init },
        }));
    }

    #[tokio::test]
    async fn references_resolve_to_typed_objects_and_check_the_interface() {
        let connection = offline();
        create(
            &connection,
            "",
            "ElementHandle",
            "handle@1",
            json!({ "preview": "<a>" }),
        );

        let as_element: ElementHandle = connection.object(&Ref::new("handle@1")).unwrap();
        assert_eq!(as_element.guid(), "handle@1");
        // An ElementHandle is also a JSHandle (`extends: JSHandle`).
        let as_js: JSHandle = connection.object(&Ref::new("handle@1")).unwrap();
        assert_eq!(as_js.initializer().unwrap().preview, "<a>");
        let wrong = connection.object::<Page>(&Ref::new("handle@1"));
        assert!(matches!(wrong, Err(ProtocolError::WrongInterface { .. })));
        let missing = connection.object::<Page>(&Ref::new("nope"));
        assert!(matches!(missing, Err(ProtocolError::UnknownObject(_))));
    }

    #[tokio::test]
    async fn dispose_drops_children_and_adopt_moves_them() {
        let connection = offline();
        create(&connection, "", "BrowserContext", "context@1", json!({}));
        create(&connection, "", "BrowserContext", "context@2", json!({}));
        create(&connection, "context@1", "Page", "page@1", json!({}));
        assert_eq!(connection.children::<Page>("context@1").len(), 1);

        connection.dispatch(json!({
            "guid": "context@2", "method": "__adopt__", "params": { "guid": "page@1" },
        }));
        assert!(connection.children::<Page>("context@1").is_empty());
        assert_eq!(connection.children::<Page>("context@2").len(), 1);
        assert_eq!(connection.children::<BrowserContext>("").len(), 2);

        connection.dispatch(json!({ "guid": "context@2", "method": "__dispose__", "params": {} }));
        assert_eq!(connection.object_count(), 1);
        assert!(connection.raw_initializer("page@1").is_err());
    }

    #[tokio::test]
    async fn frame_urls_and_load_states_follow_their_events() {
        use crate::playwright::protocol::{Frame, LifecycleEvent};
        let connection = offline();
        create(
            &connection,
            "",
            "Frame",
            "frame@1",
            json!({ "url": "about:blank", "name": "", "loadStates": ["load"] }),
        );
        let frame: Frame = connection.object(&Ref::new("frame@1")).unwrap();
        let event = |method: &str, params: Value| {
            connection.dispatch(json!({ "guid": "frame@1", "method": method, "params": params }));
        };

        event("navigated", json!({ "url": "https://a.test/", "name": "" }));
        event("loadstate", json!({ "remove": "load" }));
        event("loadstate", json!({ "add": "domcontentloaded" }));
        // A failed navigation leaves the committed URL in place.
        event(
            "navigated",
            json!({ "url": "https://b.test/", "name": "", "error": "net::ERR" }),
        );

        let state = frame.initializer().unwrap();
        assert_eq!(state.url, "https://a.test/");
        assert_eq!(state.load_states, vec![LifecycleEvent::Domcontentloaded]);
    }

    #[tokio::test]
    async fn events_are_typed_and_filtered_by_object() {
        let connection = offline();
        create(&connection, "", "Page", "page@1", json!({}));
        create(&connection, "", "Page", "page@2", json!({}));
        let page: Page = connection.object(&Ref::new("page@1")).unwrap();
        let mut events = page.events();

        connection.dispatch(json!({ "guid": "page@2", "method": "close", "params": {} }));
        connection.dispatch(json!({ "guid": "page@1", "method": "crash", "params": {} }));
        connection
            .dispatch(json!({ "guid": "page@1", "method": "brandNew", "params": { "x": 1 } }));

        assert_eq!(events.recv().await.unwrap(), PageEvent::Crash);
        assert!(matches!(
            events.recv().await.unwrap(),
            PageEvent::Unknown { method, .. } if method == "brandNew"
        ));
        // The generated initializer type ignores fields it does not model.
        let _: Result<PageInitializer, _> = page.initializer();
    }

    #[tokio::test]
    async fn remote_errors_carry_the_driver_error_name() {
        let error = remote_error(&json!({
            "error": { "name": "TimeoutError", "message": "Timeout 5ms exceeded", "stack": "s" }
        }));
        assert!(error.is_timeout());
        assert_eq!(error.to_string(), "TimeoutError: Timeout 5ms exceeded");
    }
}
