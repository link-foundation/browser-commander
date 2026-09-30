//! Binary-safe official Playwright framing, independent of output decoding.
use playwright_rs::{
    server::transport::{TransportReceiver, TransportSender},
    Error, Result,
};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    future::Future,
    pin::Pin,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::tcp::{OwnedReadHalf, OwnedWriteHalf},
    sync::mpsc,
};

pub(super) const MAX_FRAME_BYTES: usize = 64 * 1024 * 1024;
const MAX_PENDING: usize = 1024;

pub(super) struct State {
    closed: AtomicBool,
    pending: Mutex<HashSet<u64>>,
    responses: Mutex<Option<mpsc::Sender<Value>>>,
}
impl State {
    async fn dispatch(&self, value: Value) -> Result<()> {
        let sender = self
            .responses
            .lock()
            .unwrap()
            .clone()
            .ok_or(Error::ChannelClosed)?;
        sender.send(value).await.map_err(|_| Error::ChannelClosed)
    }
    pub(super) async fn disconnect(&self) {
        if self.closed.swap(true, Ordering::AcqRel) {
            return;
        }
        let pending: Vec<_> = self.pending.lock().unwrap().drain().collect();
        for id in pending {
            let _ = self.dispatch(json!({"id":id,"error":{"error":{"name":"TargetClosedError","message":"Playwright driver disconnected"}}})).await;
        }
        self.responses.lock().unwrap().take();
    }
}

pub(super) struct Sender {
    writer: OwnedWriteHalf,
    state: Arc<State>,
}
pub(super) struct Receiver {
    reader: OwnedReadHalf,
    state: Arc<State>,
}

pub(super) fn connect(
    stream: tokio::net::TcpStream,
) -> (Sender, Receiver, mpsc::Receiver<Value>, Arc<State>) {
    let (reader, writer) = stream.into_split();
    let (responses, messages) = mpsc::channel(4);
    let state = Arc::new(State {
        closed: AtomicBool::new(false),
        pending: Default::default(),
        responses: Mutex::new(Some(responses)),
    });
    (
        Sender {
            writer,
            state: state.clone(),
        },
        Receiver {
            reader,
            state: state.clone(),
        },
        messages,
        state,
    )
}

impl TransportSender for Sender {
    fn send(&mut self, message: Value) -> Pin<Box<dyn Future<Output = Result<()>> + Send + '_>> {
        Box::pin(async move {
            if self.state.closed.load(Ordering::Acquire) {
                return Err(Error::ChannelClosed);
            }
            let bytes = serde_json::to_vec(&message)?;
            if bytes.len() > MAX_FRAME_BYTES {
                return Err(Error::TransportError(
                    "Playwright frame exceeds 64 MiB".into(),
                ));
            }
            if let Some(id) = message["id"].as_u64() {
                let mut pending = self.state.pending.lock().unwrap();
                if pending.len() >= MAX_PENDING {
                    return Err(Error::TransportError(
                        "Playwright has 1024 outstanding requests".into(),
                    ));
                }
                pending.insert(id);
            }
            let result = async {
                self.writer
                    .write_all(&(bytes.len() as u32).to_le_bytes())
                    .await?;
                self.writer.write_all(&bytes).await?;
                self.writer.flush().await
            }
            .await;
            if result.is_err() {
                self.state.disconnect().await;
            }
            Ok(result?)
        })
    }
}

impl TransportReceiver for Receiver {
    fn run(&mut self) -> Pin<Box<dyn Future<Output = Result<()>> + Send + '_>> {
        Box::pin(async move {
            let result = async {
                loop {
                    let mut header = [0; 4];
                    // A clean EOF is only valid between messages, never in a frame.
                    if self.reader.read(&mut header[..1]).await? == 0 {
                        break;
                    }
                    self.reader.read_exact(&mut header[1..]).await?;
                    let length = u32::from_le_bytes(header) as usize;
                    if length > MAX_FRAME_BYTES {
                        return Err(Error::TransportError(
                            "Playwright frame exceeds 64 MiB".into(),
                        ));
                    }
                    let mut bytes = vec![0; length];
                    self.reader.read_exact(&mut bytes).await?;
                    let message: Value = serde_json::from_slice(&bytes)?;
                    if let Some(id) = message["id"].as_u64() {
                        self.state.pending.lock().unwrap().remove(&id);
                    }
                    self.state.dispatch(message).await?;
                }
                Ok(())
            }
            .await;
            self.state.disconnect().await;
            result
        })
    }
}
