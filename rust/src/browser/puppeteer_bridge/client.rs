//! Bounded, cancellable JSON-RPC over the shared generic handle bridge.
use crate::utilities::{start_process, ManagedProcess, StartProcessOptions};
use anyhow::{anyhow, bail, Context, Result};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{json, Value};
use std::{collections::HashMap, path::PathBuf, sync::{Arc, Mutex, atomic::{AtomicU64, Ordering}}, time::Duration};
use tokio::{io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader}, net::{TcpListener, tcp::OwnedWriteHalf}, sync::{broadcast, oneshot}, task::JoinHandle};

pub const MAX_MESSAGE_BYTES: usize = 64 * 1024 * 1024;
pub const MAX_PENDING_REQUESTS: usize = 1024;
type Pending = Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>>;

#[derive(Clone, Debug)]
pub struct BridgeOptions {
    pub node_executable: PathBuf,
    /// The npm package's bin/browser-commander.js entry point.
    pub cli_script: PathBuf,
    pub working_dir: Option<PathBuf>,
    pub env: Option<HashMap<String, String>>,
    pub request_timeout: Duration,
}
impl Default for BridgeOptions {
    fn default() -> Self {
        let cli = std::env::var_os("BROWSER_COMMANDER_JS_CLI").map(PathBuf::from).unwrap_or_else(|| {
            let checkout = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../js/bin/browser-commander.js");
            if checkout.is_file() { checkout } else { PathBuf::from("node_modules/browser-commander/bin/browser-commander.js") }
        });
        Self { node_executable: std::env::var_os("BROWSER_COMMANDER_NODE").map(PathBuf::from).unwrap_or_else(|| "node".into()), cli_script:cli, working_dir:None, env:None, request_timeout:Duration::from_secs(30) }
    }
}

pub struct BridgeClient {
    writer: tokio::sync::Mutex<Option<OwnedWriteHalf>>,
    pending: Pending,
    next_id: AtomicU64,
    events: broadcast::Sender<Value>,
    reader: Option<JoinHandle<()>>,
    process: ManagedProcess,
    timeout: Duration,
}
fn reject_all(pending: &Pending, message: &str) {
    for (_, sender) in pending.lock().unwrap_or_else(|e|e.into_inner()).drain() {
        let _ = sender.send(Err(message.into()));
    }
}
struct RequestGuard { id: u64, pending: Pending }
impl Drop for RequestGuard {
    fn drop(&mut self) { self.pending.lock().unwrap_or_else(|e|e.into_inner()).remove(&self.id); }
}
impl Drop for BridgeClient {
    fn drop(&mut self) {
        reject_all(&self.pending,"generic bridge owner dropped");
        if let Some(reader) = self.reader.take() { reader.abort(); }
        // ManagedProcess also reaps its owned group after runtime shutdown.
        self.process.kill();
    }
}
impl BridgeClient {
    pub async fn start(options: BridgeOptions) -> Result<Self> {
        if options.request_timeout.is_zero() { bail!("request_timeout must be positive"); }
        let cli = options.cli_script.canonicalize().context("resolve companion npm CLI")?;
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST,0)).await?;
        let mut entropy = [0u8;32];
        getrandom::fill(&mut entropy).map_err(|e|anyhow!("bridge handshake: {e}"))?;
        let token = entropy.iter().map(|b|format!("{b:02x}")).collect::<String>();
        let process = start_process(&options.node_executable.to_string_lossy(), &[
            "-e".into(), include_str!("bridge_bootstrap.cjs").into(), cli.to_string_lossy().into_owned(), listener.local_addr()?.port().to_string(), token.clone()
        ], StartProcessOptions { cwd:options.working_dir, env:options.env, on_stderr: vec![Arc::new(|bytes|tracing::debug!("Puppeteer bridge: {}",String::from_utf8_lossy(bytes)))], ..Default::default() }).await?;
        let socket = tokio::time::timeout(options.request_timeout, async {
            let (mut socket,_) = listener.accept().await?;
            let mut received = [0u8;65]; socket.read_exact(&mut received).await?;
            if received.as_slice() != format!("{token}\n").as_bytes() { bail!("generic bridge handshake mismatch"); }
            Ok::<_,anyhow::Error>(socket)
        }).await??;
        socket.set_nodelay(true)?;
        let (input,output) = socket.into_split();
        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
        let (events,_) = broadcast::channel(1024);
        let responses = pending.clone();
        let notifications = events.clone();
        let reader = tokio::spawn(async move {
            let mut input = BufReader::new(input);
            loop {
                let mut line = Vec::new();
                let read = (&mut input).take((MAX_MESSAGE_BYTES+1) as u64).read_until(b'\n', &mut line).await;
                if !matches!(read,Ok(n) if n>0) || line.len()>MAX_MESSAGE_BYTES || line.last()!=Some(&b'\n') { break; }
                let Ok(mut message) = serde_json::from_slice::<Value>(&line) else { break; };
                if let Some(id) = message["id"].as_u64() {
                    let sender = responses.lock().unwrap_or_else(|e|e.into_inner()).remove(&id);
                    if let Some(sender) = sender {
                        let response = if !message["error"].is_null() { Err(message["error"].to_string()) } else { Ok(message["result"].take()) };
                        let _ = sender.send(response);
                    }
                } else { let _ = notifications.send(message); }
            }
            reject_all(&responses,"generic bridge disconnected or sent an invalid/oversized message");
        });
        Ok(Self {writer:tokio::sync::Mutex::new(Some(output)),pending,next_id:AtomicU64::new(1),events,reader:Some(reader),process,timeout:options.request_timeout})
    }
    pub fn pid(&self) -> Option<u32> { self.process.pid() }
    pub fn events(&self) -> broadcast::Receiver<Value> { self.events.subscribe() }
    pub async fn request(&self, method: &str, params: Value) -> Result<Value> {
        let id = self.next_id.fetch_add(1,Ordering::Relaxed);
        let (sender,reply) = oneshot::channel();
        {
            let mut pending = self.pending.lock().unwrap_or_else(|e|e.into_inner());
            if pending.len()>=MAX_PENDING_REQUESTS { bail!("generic bridge outstanding request limit exceeded"); }
            pending.insert(id,sender);
        }
        let _guard = RequestGuard {id,pending:self.pending.clone()};
        let mut message = serde_json::to_vec(&json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}))?;
        if message.len()>=MAX_MESSAGE_BYTES { bail!("generic bridge request exceeds frame limit"); }
        message.push(b'\n');
        tokio::time::timeout(self.timeout, async {
            {
                let mut writer = self.writer.lock().await;
                let writer = writer.as_mut().ok_or_else(||anyhow!("generic bridge is closed"))?;
                writer.write_all(&message).await?; writer.flush().await?;
            }
            reply.await.map_err(|_|anyhow!("generic bridge reply cancelled"))?.map_err(anyhow::Error::msg)
        }).await.context("generic bridge request deadline")?
    }
    pub async fn root<T: DeserializeOwned>(&self) -> Result<T> {
        Ok(serde_json::from_value(self.request("handle.root",json!({"name":"puppeteer"})).await?)?)
    }
    pub async fn call<P: Serialize,R: DeserializeOwned>(&self, handle: &str, method: &str, args: P) -> Result<R> {
        let mut response = self.request("handle.call",json!({"handle":handle,"method":method,"args":serde_json::to_value(args)?})).await?;
        normalize_undefined(&mut response);
        Ok(serde_json::from_value(response)?)
    }
    pub async fn get<R: DeserializeOwned>(&self, handle: &str, property: &str) -> Result<R> {
        let mut response = self.request("handle.get",json!({"handle":handle,"property":property})).await?;
        normalize_undefined(&mut response); Ok(serde_json::from_value(response)?)
    }
    pub async fn close(&self) -> Result<()> {
        if let Some(mut writer) = self.writer.lock().await.take() { writer.shutdown().await?; }
        if self.process.wait_timeout(Duration::from_secs(5)).await.is_none() {
            self.process.kill(); self.process.wait_timeout(Duration::from_secs(3)).await;
        }
        reject_all(&self.pending,"generic bridge closed"); Ok(())
    }
}
fn normalize_undefined(value: &mut Value) {
    match value {
        Value::Object(map) if map.get("$undefined")==Some(&Value::Bool(true)) => *value=Value::Null,
        Value::Object(map) => map.values_mut().for_each(normalize_undefined),
        Value::Array(values) => values.iter_mut().for_each(normalize_undefined),
        _ => ()
    }
}
