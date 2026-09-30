//! Bounded wire tests: fragmented frames, response ordering, disconnect and limits.
use super::transport::{connect, MAX_FRAME_BYTES};
use playwright_rs::server::transport::{TransportReceiver, TransportSender};
use serde_json::{json, Value};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    time::{timeout, Duration},
};

async fn pair() -> (TcpStream, TcpStream) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let client = TcpStream::connect(listener.local_addr().unwrap());
    let (client, server) = tokio::join!(client, listener.accept());
    (client.unwrap(), server.unwrap().0)
}
async fn frame(stream: &mut TcpStream, value: Value) {
    let bytes = serde_json::to_vec(&value).unwrap();
    for byte in (bytes.len() as u32).to_le_bytes() {
        stream.write_all(&[byte]).await.unwrap();
    }
    for chunk in bytes.chunks(3) {
        stream.write_all(chunk).await.unwrap();
    }
}
#[tokio::test]
async fn binary_safe_fragmented_and_out_of_order_responses() {
    timeout(Duration::from_secs(5), async {
        let (client, mut peer) = pair().await;
        let (mut sender, mut receiver, mut messages, _state) = connect(client);
        let reader = tokio::spawn(async move { receiver.run().await });
        sender
            .send(json!({"id":1,"method":"α","params":{"value":"é🙂\u{0}"}}))
            .await
            .unwrap();
        let mut header = [0; 4];
        peer.read_exact(&mut header).await.unwrap();
        let mut body = vec![0; u32::from_le_bytes(header) as usize];
        peer.read_exact(&mut body).await.unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&body).unwrap()["params"]["value"],
            "é🙂\u{0}"
        );
        sender.send(json!({"id":2})).await.unwrap();
        peer.read_exact(&mut header).await.unwrap();
        let mut body = vec![0; u32::from_le_bytes(header) as usize];
        peer.read_exact(&mut body).await.unwrap();
        frame(&mut peer, json!({"id":2,"result":{"binary":"AAEC/w=="}})).await;
        frame(&mut peer, json!({"id":1,"result":{"value":"🙂"}})).await;
        assert_eq!(messages.recv().await.unwrap()["id"], 2);
        assert_eq!(messages.recv().await.unwrap()["id"], 1);
        drop(peer);
        reader.await.unwrap().unwrap();
        assert!(messages.recv().await.is_none());
    })
    .await
    .unwrap();
}
#[tokio::test]
async fn disconnect_rejects_every_outstanding_request() {
    timeout(Duration::from_secs(5), async {
        let (client, peer) = pair().await;
        let (mut sender, mut receiver, mut messages, _state) = connect(client);
        let reader = tokio::spawn(async move { receiver.run().await });
        for id in 1..=8 {
            sender.send(json!({"id":id})).await.unwrap();
        }
        drop(peer);
        let mut ids = Vec::new();
        while let Some(message) = messages.recv().await {
            assert_eq!(message["error"]["error"]["name"], "TargetClosedError");
            ids.push(message["id"].as_u64().unwrap());
        }
        ids.sort();
        assert_eq!(ids, (1..=8).collect::<Vec<_>>());
        assert!(sender.send(json!({"id":9})).await.is_err());
        // A TCP reset and a clean EOF both reject the pending calls.
        let _ = reader.await.unwrap();
    })
    .await
    .unwrap();
}
#[tokio::test]
async fn oversized_header_is_rejected_without_allocating_the_body() {
    timeout(Duration::from_secs(5), async {
        let (client, mut peer) = pair().await;
        let (_sender, mut receiver, mut messages, _state) = connect(client);
        let reader = tokio::spawn(async move { receiver.run().await });
        peer.write_all(&((MAX_FRAME_BYTES + 1) as u32).to_le_bytes())
            .await
            .unwrap();
        let error = reader.await.unwrap().unwrap_err();
        assert!(error.to_string().contains("64 MiB"));
        assert!(messages.recv().await.is_none());
    })
    .await
    .unwrap();
}
