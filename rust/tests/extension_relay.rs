//! Native extension wire-protocol tests, using actual loopback WebSockets.

use async_tungstenite::{
    tokio::{connect_async, ConnectStream},
    tungstenite::{client::IntoClientRequest, Message},
    WebSocketStream,
};
use browser_commander::browser::extension_relay::{ExtensionRelay, RelayOptions};
use futures::StreamExt;
use serde_json::{json, Value};
use std::time::Duration;

const ORIGIN: &str = "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
type Client = WebSocketStream<ConnectStream>;

#[tokio::test]
async fn immediately_closing_a_new_listener_finishes() {
    let mut relay = ExtensionRelay::listen(RelayOptions {
        port: 0,
        ..Default::default()
    })
    .await
    .unwrap();
    tokio::time::timeout(Duration::from_secs(2), relay.close())
        .await
        .unwrap();
}

async fn connect(url: &str, origin: &str) -> Result<Client, async_tungstenite::tungstenite::Error> {
    let mut request = url.into_client_request().unwrap();
    request
        .headers_mut()
        .insert("Origin", origin.parse().unwrap());
    connect_async(request).await.map(|(socket, _)| socket)
}

async fn answer(client: &mut Client, result: Value) -> Value {
    let frame = client.next().await.unwrap().unwrap();
    let request: Value = serde_json::from_str(frame.to_text().unwrap()).unwrap();
    client
        .send(Message::Text(
            json!({"id":request["id"], "result":result})
                .to_string()
                .into(),
        ))
        .await
        .unwrap();
    request
}

// feature-parity: attach.extension@native-typed
#[tokio::test]
async fn native_relay_tabs_sessions_events_and_shutdown() {
    tokio::time::timeout(Duration::from_secs(10), async {
        let mut relay = ExtensionRelay::listen(RelayOptions {port:0, ..Default::default()}).await.unwrap();
        let url = relay.url().to_owned();
        let mut extension = connect(&url, ORIGIN).await.unwrap();
        extension.send(Message::Text(json!({"type":"hello", "extensionVersion":"1.0", "userAgent":"Chrome"}).to_string().into())).await.unwrap();
        assert_eq!(relay.wait_for_extension().await.unwrap().version, "1.0");
        let (tabs, request) = tokio::join!(relay.tabs(), answer(&mut extension, json!([{"tabId":7,"url":"about:blank","title":"Tab","active":true}])));
        assert_eq!(request["method"], "tabs.list");
        assert_eq!(tabs.unwrap()[0].tab_id, 7);
        let (tab, request) = tokio::join!(relay.new_tab(Some("https://example.test")), answer(&mut extension, json!({"tabId":8})));
        assert_eq!(request["params"]["url"], "https://example.test");
        assert_eq!(tab.unwrap(), 8);
        let (session, request) = tokio::join!(relay.session(7), answer(&mut extension, json!({"attached":true})));
        assert_eq!(request["method"], "debugger.attach");
        let session = session.unwrap();
        let mut events = session.subscribe();
        let (response, request) = tokio::join!(session.send("Runtime.evaluate", json!({"expression":"1"})), answer(&mut extension, json!({"result":{"value":1}})));
        assert_eq!(request["params"]["tabId"], 7);
        assert_eq!(response.unwrap()["result"]["value"], 1);
        extension.send(Message::Text(json!({"type":"event","tabId":7,"method":"Page.loadEventFired","params":{"timestamp":2}}).to_string().into())).await.unwrap();
        assert_eq!(events.recv().await.unwrap().method, "Page.loadEventFired");
        let (detached, request) = tokio::join!(session.detach(), answer(&mut extension, json!({"detached":true})));
        detached.unwrap();
        assert_eq!(request["method"], "debugger.detach");
        assert!(session.is_detached());
        assert!(session.send("Runtime.enable", json!({})).await.is_err());
        relay.close().await;
        assert!(tokio::net::TcpStream::connect(url.split('/').nth(2).unwrap()).await.is_err());
    }).await.unwrap();
}

#[tokio::test]
async fn native_relay_authorization_and_single_extension() {
    tokio::time::timeout(Duration::from_secs(10), async {
        let mut relay = ExtensionRelay::listen(RelayOptions {
            port: 0,
            allowed_extension_ids: Some(vec!["a".repeat(32)]),
            ..Default::default()
        })
        .await
        .unwrap();
        for (url, origin, status) in [
            (relay.url().to_owned(), "https://example.test", 403),
            (
                relay.url().to_owned(),
                "chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                403,
            ),
            (
                relay.url().replace("/browser-commander", "/wrong"),
                ORIGIN,
                404,
            ),
        ] {
            let error = connect(&url, origin).await.unwrap_err();
            match error {
                async_tungstenite::tungstenite::Error::Http(response) => {
                    assert_eq!(response.status().as_u16(), status)
                }
                error => panic!("Unexpected error: {error}"),
            }
        }
        let _extension = connect(relay.url(), ORIGIN).await.unwrap();
        match connect(relay.url(), ORIGIN).await.unwrap_err() {
            async_tungstenite::tungstenite::Error::Http(response) => {
                assert_eq!(response.status().as_u16(), 409)
            }
            error => panic!("Unexpected error: {error}"),
        }
        relay.close().await;
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn native_relay_failure_timeout_disconnect_and_drop() {
    tokio::time::timeout(Duration::from_secs(10), async {
        assert!(ExtensionRelay::listen(RelayOptions {
            host: "0.0.0.0".into(),
            ..Default::default()
        })
        .await
        .is_err());
        let relay = ExtensionRelay::listen(RelayOptions {
            port: 0,
            request_timeout: Duration::from_millis(50),
            ..Default::default()
        })
        .await
        .unwrap();
        let url = relay.url().to_owned();
        let mut extension = connect(&url, ORIGIN).await.unwrap();
        extension
            .send(Message::Text(json!({"type":"hello"}).to_string().into()))
            .await
            .unwrap();
        relay.wait_for_extension().await.unwrap();
        let (result, ()) = tokio::join!(relay.tabs(), async {
            let request: Value =
                serde_json::from_str(extension.next().await.unwrap().unwrap().to_text().unwrap())
                    .unwrap();
            extension
                .send(Message::Text(
                    json!({"id":request["id"],"error":{"message":"permission denied"}})
                        .to_string()
                        .into(),
                ))
                .await
                .unwrap();
        });
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("permission denied"));
        let (result, _) = tokio::join!(relay.tabs(), extension.next());
        assert!(result.unwrap_err().to_string().contains("timed out"));
        let (result, ()) = tokio::join!(relay.tabs(), async {
            extension.next().await.unwrap().unwrap();
            extension.close(None).await.unwrap();
        });
        assert!(result.unwrap_err().to_string().contains("disconnected"));
        drop(relay);
        tokio::task::yield_now().await;
        assert!(
            tokio::net::TcpStream::connect(url.split('/').nth(2).unwrap())
                .await
                .is_err()
        );
    })
    .await
    .unwrap();
}
