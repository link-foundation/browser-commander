# Native extension relay

The companion extension can drive tabs in a signed-in Chrome-family browser
without restarting that browser or adding debugging switches. Chrome displays
its debugger attachment infobar while a tab is attached. Python and Rust host
the relay directly; neither API starts the JavaScript CLI or needs Node.js.

The extension and wire protocol are shared with JavaScript. Each native package
ships the same three extension files; CI compares their bytes. Install the
extension once through `chrome://extensions`: enable Developer mode, choose
**Load unpacked**, and select the directory exposed below. It connects to port
9333 by default. To change the port, open its service-worker console from that
settings page and call `chrome.storage.local.set({port: 9334})`, then reload
the extension.

## Python

Install the optional dependency with `pip install 'browser-commander[extension]'`
once the package is published, or use the source installation documented in
the Python README with the `extension` extra. The supported WebSocket package
range retains Python 3.9 compatibility.

```python
import asyncio
from browser_commander import (
    RelayOptions, attach_via_extension, extension_directory,
)

async def main():
    print("Load unpacked:", extension_directory())
    relay = await attach_via_extension(RelayOptions(
        allowed_extension_ids=["your-extension-id-from-chrome-settings"],
    ))
    async with relay:
        for tab in await relay.tabs():
            print(tab.tab_id, tab.title)
        tab_id = await relay.new_tab("https://example.com")
        session = await relay.session(tab_id)
        result = await session.send("Runtime.evaluate", {
            "expression": "document.title", "returnByValue": True,
        })
        print(result)
        await session.detach()

asyncio.run(main())
```

`ExtensionRelay.listen(RelayOptions(port=0))` returns the chosen `port` and `url`
before waiting for an extension. Configure that port, then call
`wait_for_extension()`. `attach_via_extension` combines those operations and
accepts an `on_listening` callback. Its failure and cancellation paths close
the listener. CDP events arrive through `session.next_event()`; a terminal
`detached` event contains the reason, and later receives raise `ConnectionError`.

## Rust

```rust,no_run
use browser_commander::{
    attach_via_extension, write_extension_directory, RelayOptions,
};
use serde_json::json;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    println!("Load unpacked: {:?}", write_extension_directory("./relay-extension")?);
    let mut relay = attach_via_extension(RelayOptions::default()).await?;
    let tab = relay.new_tab(Some("https://example.com")).await?;
    let session = relay.session(tab).await?;
    let mut events = session.subscribe();
    session.send("Page.enable", json!({})).await?;
    session.send("Page.navigate", json!({"url": "https://example.com"})).await?;
    println!("First event: {:?}", events.recv().await?);
    session.detach().await?;
    relay.close().await;
    Ok(())
}
```

`ExtensionRelay::listen` and `wait_for_extension` expose the same two-stage
startup for dynamically chosen ports. Session handles implement the crate's
`CdpTransport` trait, so the fingerprint helpers accept them directly. Closing
or dropping the relay ends its listener, cancels pending calls and marks its
sessions detached. The user's browser remains open. The extension releases
its debugger attachments when its connection ends.

## Authorization and bounded resources

Both servers bind only to loopback addresses. Upgrade requests must use
`/browser-commander` and exactly one `chrome-extension://<id>` Origin.
`allowed_extension_ids` restricts the accepted extension; an empty list denies
all extensions. Web origins and missing origins receive 403, wrong paths 404,
and a second simultaneous extension 409. Browser-supplied origins prevent web
pages from connecting. Other local programs can forge HTTP headers; this
origin check does not authenticate them.

The extension hello deadline defaults to 60 seconds; requests default to
30 seconds. At most 64 requests remain pending and received messages are
limited to 4 MiB. Cancellation removes outstanding requests immediately.
Disconnect rejects pending calls and emits terminal session events; the
listener accepts a later extension connection.

Each session has a 1,024-event buffer. Python explicitly detaches a session
with `event_buffer_overflow` if it fills. Rust broadcast receivers return
`RecvError::Lagged`; consumers must handle that loss. These signals prevent
callers from assuming a complete event stream after falling behind.

Tests use real loopback WebSockets and cover authorization, tab operations,
CDP calls/events, extension errors, timeouts, disconnects and listener shutdown.
Python additionally tests cancellation, reconnects and concurrent attachment.
The packaged extension is identical to the existing JavaScript extension;
the native servers do not install it into an existing user profile automatically.
