use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use async_tungstenite::{
    tokio::accept_hdr_async_with_config,
    tungstenite::{
        handshake::server::{Request, Response},
        protocol::WebSocketConfig,
        Message,
    },
};
use futures::StreamExt;
use serde_json::Value;
use tokio::{
    net::{TcpListener, TcpStream},
    sync::{mpsc, watch},
    task::JoinSet,
    time::{timeout, Duration},
};

use super::{
    protocol::authorize,
    state::{ConnectionGuard, State},
    RelayExtension,
};

pub(super) async fn serve(listener: TcpListener, state: Arc<State>) {
    let mut shutdown = state.shutdown.subscribe();
    let mut clients = JoinSet::new();
    // close() can run before this task first polls and subscribes. A watch
    // receiver does not report that initial value through changed().
    while !*shutdown.borrow() {
        tokio::select! {
            _ = shutdown.changed() => break,
            accepted = listener.accept(), if clients.len() < 32 => {
                let Ok((socket, _)) = accepted else { break; };
                clients.spawn(connection(socket, state.clone()));
            }
            Some(result) = clients.join_next(), if !clients.is_empty() => {
                if let Err(error) = result { tracing::debug!(%error, "Extension relay connection ended"); }
            }
        }
    }
    // Abort also drops connection guards and wakes waiting session consumers.
    clients.abort_all();
    while clients.join_next().await.is_some() {}
    state.disconnect("the relay was closed");
}

async fn connection(socket: TcpStream, state: Arc<State>) {
    let owns = Arc::new(AtomicBool::new(false));
    let _guard = ConnectionGuard {
        state: state.clone(),
        owns: owns.clone(),
    };
    let authorized_id = Arc::new(std::sync::Mutex::new(String::new()));
    let callback_id = authorized_id.clone();
    let callback_state = state.clone();
    // Tungstenite's Callback requires this concrete HTTP response error type.
    #[allow(clippy::result_large_err)]
    let callback = move |request: &Request, response: Response| {
        let decision = authorize(request, &callback_state.options).and_then(|id| {
            callback_state
                .connected
                .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                .map_err(|_| 409_u16)?;
            owns.store(true, Ordering::Release);
            Ok(id)
        });
        match decision {
            Ok(id) => {
                *callback_id.lock().unwrap() = id;
                Ok(response)
            }
            Err(status) => Err(async_tungstenite::tungstenite::http::Response::builder()
                .status(status)
                .body(Some("Extension relay upgrade refused".to_owned()))
                .unwrap()),
        }
    };
    let config = WebSocketConfig::default()
        .max_message_size(Some(4 * 1024 * 1024))
        .max_frame_size(Some(4 * 1024 * 1024));
    let accepted = timeout(
        Duration::from_secs(10),
        accept_hdr_async_with_config(socket, callback, Some(config)),
    )
    .await;
    let mut socket = match accepted {
        Ok(Ok(socket)) => socket,
        _ => return,
    };
    let first = timeout(state.options.timeout, socket.next()).await;
    let hello = match first {
        Ok(Some(Ok(Message::Text(text)))) => serde_json::from_str::<Value>(&text).ok(),
        _ => None,
    };
    let Some(hello) =
        hello.filter(|value| value.get("type").and_then(Value::as_str) == Some("hello"))
    else {
        let _ = timeout(Duration::from_secs(1), socket.close(None)).await;
        return;
    };
    let (outgoing, mut requests) = mpsc::channel(64);
    *state.outgoing.lock().unwrap() = Some(outgoing);
    state.extension.send_replace(Some(RelayExtension {
        id: authorized_id.lock().unwrap().clone(),
        version: hello
            .get("extensionVersion")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned(),
        user_agent: hello
            .get("userAgent")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned(),
    }));
    let mut shutdown: watch::Receiver<bool> = state.shutdown.subscribe();
    while !*shutdown.borrow() {
        tokio::select! {
            _ = shutdown.changed() => break,
            Some(request) = requests.recv() => {
                if socket.send(Message::Text(request.to_string().into())).await.is_err() { break; }
            }
            frame = socket.next() => {
                match frame {
                    Some(Ok(Message::Text(text))) => {
                        match serde_json::from_str(&text) {
                            Ok(message) => state.message(message),
                            Err(error) => tracing::debug!(%error, "Ignoring malformed extension message"),
                        }
                    }
                    Some(Ok(Message::Ping(data))) => { if socket.send(Message::Pong(data)).await.is_err() { break; } }
                    Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                    _ => {}
                }
            }
        }
    }
    let _ = timeout(Duration::from_secs(1), socket.close(None)).await;
}
