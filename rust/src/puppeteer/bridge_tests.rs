use super::*;

/// A client wired to an in-memory server that answers with `respond`.
fn fake_server(
    respond: impl Fn(&Value) -> Vec<Value> + Send + 'static,
) -> (BridgeClient, tokio::task::JoinHandle<Vec<Value>>) {
    let (client_side, server_side) = tokio::io::duplex(64 * 1024);
    let (client_read, client_write) = tokio::io::split(client_side);
    let client = BridgeClient::new(client_read, client_write);
    let server = tokio::spawn(async move {
        let (read, mut write) = tokio::io::split(server_side);
        let mut lines = BufReader::new(read).lines();
        let mut seen = Vec::new();
        while let Ok(Some(line)) = lines.next_line().await {
            let request: Value = serde_json::from_str(&line).unwrap();
            for reply in respond(&request) {
                let mut text = serde_json::to_vec(&reply).unwrap();
                text.push(b'\n');
                write.write_all(&text).await.unwrap();
            }
            seen.push(request);
        }
        seen
    });
    (client, server)
}

fn result(request: &Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": request["id"], "result": result })
}

#[tokio::test]
async fn calls_encode_undefined_and_decode_handles() {
    let (client, server) = fake_server(|request| {
        let reply = match request["method"].as_str().unwrap() {
            "handle.root" => json!({ "$handle": "h1", "type": "PuppeteerNode" }),
            "handle.call" => json!([{ "$handle": "h2", "type": "CdpPage" }, null]),
            _ => json!({ "$undefined": true }),
        };
        vec![result(request, reply)]
    });
    let root = client.root("puppeteer").await.unwrap();
    assert_eq!((root.id(), root.type_name()), ("h1", "PuppeteerNode"));
    let pages: Vec<Option<RemoteHandle>> = root
        .call(
            "pages",
            vec![None, Some(json!(1)), Some(binary(b"hi")), None, None],
        )
        .await
        .unwrap();
    assert_eq!(pages[0].as_ref().unwrap().id(), "h2");
    assert!(pages[1].is_none());
    client.close_input().await;
    let seen = server.await.unwrap();
    assert_eq!(
        seen[1]["params"],
        json!({
            "handle": "h1",
            "method": "pages",
            "args": [{ "$undefined": true }, 1, { "$binary": "aGk=" }],
        })
    );
}

#[tokio::test]
async fn errors_carry_the_engine_error_name() {
    let (client, _server) = fake_server(|request| {
        vec![json!({
            "jsonrpc": "2.0",
            "id": request["id"],
            "error": {
                "code": -32000,
                "message": "Waiting for selector `#x` failed",
                "data": { "name": "TimeoutError", "message": "…", "stack": "at x" },
            },
        })]
    });
    let error = client.request("handle.call", json!({})).await.unwrap_err();
    assert!(error.is_timeout(), "{error}");
    assert!(
        matches!(error, BridgeError::Remote { code: -32000, ref stack, .. } if stack.as_deref() == Some("at x"))
    );
}

#[tokio::test]
async fn events_reach_their_subscription() {
    let (client, _server) = fake_server(|request| match request["method"].as_str().unwrap() {
        "events.subscribe" => vec![
            result(request, json!({ "subscription": "e1" })),
            json!({
                "jsonrpc": "2.0",
                "method": "events.emit",
                "params": { "subscription": "e1", "args": [{ "$handle": "h3", "type": "CdpPage" }] },
            }),
        ],
        _ => vec![result(
            request,
            json!({ "$handle": "h1", "type": "CdpBrowser" }),
        )],
    });
    let browser = client.root("puppeteer").await.unwrap();
    let mut subscription = browser.subscribe("targetcreated").await.unwrap();
    let args = subscription.next().await.unwrap();
    let page: RemoteHandle = decode_handle_raw(&client, args[0].clone());
    assert_eq!(page.id(), "h3");
}

fn decode_handle_raw(client: &BridgeClient, value: Value) -> RemoteHandle {
    RemoteHandle::from_wire(client, value).unwrap()
}

#[tokio::test]
async fn a_closed_server_fails_pending_and_later_calls() {
    let (client, server) = fake_server(|_| Vec::new());
    let pending = tokio::spawn({
        let client = client.clone();
        async move { client.request("handle.root", json!({ "name": "x" })).await }
    });
    tokio::time::sleep(Duration::from_millis(50)).await;
    server.abort();
    let error = pending.await.unwrap().unwrap_err();
    assert!(matches!(error, BridgeError::Closed(_)), "{error}");
    assert!(matches!(
        client.request("handle.root", json!({})).await,
        Err(BridgeError::Closed(_))
    ));
}

#[test]
fn values_decode_to_declared_types() {
    let (client, _) = (
        BridgeClient {
            inner: Arc::new(Inner {
                writer: Mutex::new(Box::new(tokio::io::sink())),
                next_id: AtomicU64::new(1),
                pending: StdMutex::new(HashMap::new()),
                subscribers: StdMutex::new(HashMap::new()),
                receivers: StdMutex::new(HashMap::new()),
                closed: StdMutex::new(None),
                reader: StdMutex::new(None),
            }),
        },
        (),
    );
    assert_eq!(String::from_wire(&client, json!("a")).unwrap(), "a");
    assert!(f64::from_wire(&client, Value::Null).unwrap().is_nan());
    assert_eq!(
        Vec::<u8>::from_wire(&client, json!({ "$binary": "aGk=" })).unwrap(),
        b"hi"
    );
    assert_eq!(
        Option::<String>::from_wire(&client, json!({ "$undefined": true })).unwrap(),
        None
    );
    assert!(matches!(
        bool::from_wire(&client, json!("yes")),
        Err(BridgeError::Decode { .. })
    ));
    assert_eq!(
        JsFunction::source("() => 1").to_wire(),
        json!({ "$function": "() => 1" })
    );
    assert_eq!(
        JsFunction::from("document.title").to_wire(),
        json!("document.title")
    );
    assert_eq!(
        options([("a", Some(json!(1))), ("b", None)]),
        json!({ "a": 1 })
    );
}
