//! Exercise the native BiDi wire format without an installed browser.
use async_tungstenite::{tokio::accept_async, tungstenite::Message};
use browser_commander::browser::webdriver::bidi::BidiClient;
use futures::StreamExt;
use serde_json::{json, Value};
use std::{sync::Arc, time::Duration};
use tokio::{net::TcpListener, time::timeout};

#[tokio::test]
async fn bidi_matches_responses_by_id_and_delivers_events() -> anyhow::Result<()> {
    timeout(Duration::from_secs(10), async {
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let endpoint = format!("ws://{}", listener.local_addr()?);
        let server = tokio::spawn(async move {
            let (connection, _) = listener.accept().await?;
            let mut ws = accept_async(connection).await?;
            let first: Value = serde_json::from_str(ws.next().await.unwrap()?.to_text()?)?;
            let second: Value = serde_json::from_str(ws.next().await.unwrap()?.to_text()?)?;
            ws.send(Message::Text(json!({"type":"event","method":"log.entryAdded","params":{"text":"native"}}).to_string().into())).await?;
            for call in [second, first] {
                ws.send(Message::Text(json!({"type":"success","id":call["id"],"result":{"method":call["method"]}}).to_string().into())).await?;
            }
            let call: Value = serde_json::from_str(ws.next().await.unwrap()?.to_text()?)?;
            ws.send(Message::Text(json!({"type":"error","id":call["id"],"error":"invalid argument","message":"invalid context"}).to_string().into())).await?;
            let _ = ws.next().await;
            Ok::<(),anyhow::Error>(())
        });
        let client = BidiClient::connect(&endpoint).await?;
        let mut events = client.events();
        let (first,second) = tokio::join!(client.send("first",json!({})),client.send("second",json!({})));
        assert_eq!(first?["method"],"first");
        assert_eq!(second?["method"],"second");
        assert_eq!(events.recv().await?.params["text"],"native");
        let error = client.send("invalid",json!({})).await.unwrap_err();
        assert!(error.to_string().contains("invalid context"));
        client.close().await;
        assert!(client.send("after.close",json!({})).await.is_err());
        server.await??;
        Ok::<(),anyhow::Error>(())
    }).await?
}

#[tokio::test]
async fn cancelled_calls_release_pending_capacity() -> anyhow::Result<()> {
    timeout(Duration::from_secs(10), async {
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let endpoint = format!("ws://{}", listener.local_addr()?);
        let (received, mut calls) = tokio::sync::mpsc::channel(1);
        let server = tokio::spawn(async move {
            let (connection, _) = listener.accept().await?;
            let mut ws = accept_async(connection).await?;
            while let Some(frame) = ws.next().await {
                let frame = frame?;
                if frame.is_close() {
                    break;
                }
                if frame.is_text() {
                    received.send(()).await?;
                }
            }
            Ok::<(), anyhow::Error>(())
        });
        let client = Arc::new(BidiClient::connect(&endpoint).await?);
        // More than the pending limit, but only one live call at a time.
        for _ in 0..65 {
            let session = client.clone();
            let call = tokio::spawn(async move { session.send("cancel", json!({})).await });
            calls.recv().await.unwrap();
            call.abort();
            assert!(call.await.unwrap_err().is_cancelled());
        }
        client.close().await;
        server.await??;
        Ok::<(), anyhow::Error>(())
    })
    .await?
}

#[tokio::test]
async fn bidi_refuses_remote_endpoints() {
    let error = BidiClient::connect("ws://192.0.2.1:1234/")
        .await
        .err()
        .unwrap();
    assert!(error.to_string().contains("loopback"));
}
