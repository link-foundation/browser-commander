# Browser Commander

A Rust library for universal browser automation that provides a unified API for different browser automation engines. The key focus is on **stoppable page triggers** - ensuring automation logic is properly mounted/unmounted during page navigation.

See [engine support and native/CLI defaults](https://github.com/link-foundation/browser-commander/blob/main/docs/engine-support.md) for the
cross-language API matrix and Selenium examples.

## Installation

Add this to your `Cargo.toml`:

```toml
[dependencies]
browser-commander = "0.9"
tokio = { version = "1.0", features = ["full"] }
```

### TLS backend

WebDriver connections use `rustls` by default, so a default build pulls no
OpenSSL and needs neither `pkg-config` nor system TLS headers. If you need the
platform's native TLS stack instead, opt in explicitly:

```toml
[dependencies]
browser-commander = { version = "0.9", features = ["native-tls"] }
```

## Core Concept: Page State Machine

Browser Commander manages the browser as a state machine with two states:

```
+------------------+                      +------------------+
|                  |   navigation start   |                  |
|  WORKING STATE   | -------------------> |  LOADING STATE   |
|  (action runs)   |                      |  (wait only)     |
|                  |   <-----------------  |                  |
+------------------+     page ready       +------------------+
```

**LOADING STATE**: Page is loading. Only waiting/tracking operations are allowed. No automation logic runs.

**WORKING STATE**: Page is fully loaded (30 seconds of network idle). Page triggers can safely interact with DOM.

## Quick Start

```rust
use browser_commander::prelude::*;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Launch a browser with chromiumoxide engine
    let options = LaunchOptions::chromiumoxide().headless(true);
    let result = launch_browser(options).await?;
    println!("Browser launched: {:?}", result.browser.engine);

    // `result.page` is an `Arc<dyn EngineAdapter>` you can pass to any
    // of the navigation / interaction helpers.
    let page = result.page.as_ref();

    // Navigate to a URL
    page.goto("https://example.com").await?;

    // Click a button
    page.click("button.submit").await?;

    // Fill a text field
    page.fill("input[name='email']", "test@example.com").await?;

    Ok(())
}
```

## Features

- **Unified API** across multiple browser engines
- **Native Rust Chromiumoxide support**
- **Typed Playwright through the official driver**, with a Node.js bridge
  fallback, and **Puppeteer through a Node.js bridge**
- **Built-in navigation safety handling**
- **Element visibility and scroll management**
- **Click, fill, and other interaction support with verification**
- **Managed downloads whose files outlive the browser**
- **Portable trace bundles, recorded and read the same way in every supported language**
- **Async/await support with Tokio**

For trace budgets/privacy, persistent session adoption and heartbeats, CDP
`noDefaults`, overlay reporting, and the `readyOn`/`concurrency` trigger migration,
see [trace and session hardening](https://github.com/link-foundation/browser-commander/blob/f5e426d6933c681189c4989bac182a1558d8edb8/docs/trace-session-hardening.md).

## API Reference

### Browser Launch

```rust
use browser_commander::prelude::*;

// Launch with chromiumoxide (CDP-based)
let options = LaunchOptions::chromiumoxide()
    .headless(true)
    .user_data_dir("~/.browser-data")
    .with_extra_args(vec!["--lang=en-US".to_string()])
    .ignore_default_args(vec!["--disable-infobars".to_string()]);

let result = launch_browser(options).await?;
```

By default Browser Commander starts the installed browser the way a person
would: `--user-data-dir=<fresh temporary profile>
--remote-debugging-port=<reserved port> about:blank` and nothing else (see
[Launch Command Line and Opt-In Restrictions](https://github.com/link-foundation/browser-commander/blob/main/docs/feature-parity.md#launch-command-line-and-opt-in-restrictions)).
Switches the library used to add, such as `--password-store=basic`, are opt-in
`restrictions` (the `legacy-defaults` preset restores the old set).
`LaunchMode::Engine` keeps the engine launcher, `ignore_all_default_args()`
omits that launcher's own defaults, and `with_args()` remains a compatible
append-only builder.

### Playwright and Puppeteer

Rust Playwright talks to Playwright's own driver, the same process the
official Python, Java and .NET bindings use: `playwright-core/cli.js
run-driver`, started through command-stream. Every interface, command and
event in the driver's `protocol.yml` has a typed Rust binding in
[`browser_commander::playwright::protocol`](src/playwright/protocol), generated
by `scripts/generate-playwright-protocol.mjs`. `launch_browser()` and
`connect_browser()` use it whenever they find a `playwright-core` with the same
protocol version as the bindings (`BROWSER_COMMANDER_PLAYWRIGHT_DRIVER`, then
`node_modules` in `node_working_dir` and its ancestors); otherwise they log why
and fall back to the Node.js bridge. Puppeteer has no driver protocol, so it
always runs through the bridge, which delegates operations to the official
Node package.

The whole Puppeteer API is typed as well.
[`browser_commander::puppeteer`](src/puppeteer) starts the JavaScript CLI's
`serve --stdio` bridge and has one struct for every Puppeteer class and
interface, with an `async fn` for every method and getter, inherited ones
included. `scripts/generate-puppeteer-bindings.mjs` generates them from the
`lib/types.d.ts` that puppeteer-core ships
([`protocol/puppeteer/api.json`](protocol/puppeteer/api.json)):

```rust
use browser_commander::puppeteer::{BridgeOptions, JsFunction, PuppeteerBridge};
use serde_json::json;

let bridge = PuppeteerBridge::launch(BridgeOptions::default()).await?;
let browser = bridge.puppeteer().await?.launch(Some(json!({ "headless": true }))).await?;
let page = browser.new_page(None).await?;
page.goto("https://example.com", None).await?;
let title: String = page.title().await?;
let sum = page.evaluate(JsFunction::source("(a, b) => a + b"), &[json!(1), json!(2)]).await?;
let mut console = page.remote().subscribe("console").await?;
browser.close().await?;
bridge.close().await;
```

Puppeteer's option objects stay `serde_json::Value`; results, handles and
errors are typed (`BridgeError::is_timeout()` matches Puppeteer's
`TimeoutError`). The bridge needs Node.js, the JavaScript CLI
(`BROWSER_COMMANDER_JS_CLI`, or the `browser-commander` npm package in
`node_modules`) and `puppeteer-core` or `puppeteer` where Node resolves it.

```rust
use browser_commander::playwright::protocol::{
    PageSetViewportSizeParams, PageSetViewportSizeParamsViewportSize,
};
use browser_commander::{PlaywrightDriverPage, PlaywrightLaunch};

let page = PlaywrightDriverPage::launch(PlaywrightLaunch {
    user_data_dir: "./profile".into(),
    headless: true,
    ..Default::default()
})
.await?;
// The common operations go through `EngineAdapter`; the rest of Playwright is
// one typed call away.
let (_browser, _context, typed_page, _frame) = page.objects();
typed_page
    .set_viewport_size(PageSetViewportSizeParams {
        viewport_size: PageSetViewportSizeParamsViewportSize { width: 640, height: 480 },
    })
    .await?;
page.close().await?;
```

Install the package you want Node to resolve:

```bash
npm install playwright
npm install puppeteer
```

Then configure the bridge working directory if the packages are not installed from the process current directory:

```rust
use browser_commander::prelude::*;

let playwright = LaunchOptions::playwright()
    .headless(true)
    .node_working_dir("./js");

let puppeteer = LaunchOptions::puppeteer()
    .headless(true)
    .node_working_dir("./js");
```

Reuse a system-installed Chrome-family browser by selecting its channel or
providing an explicit executable path. `channel` applies to the Playwright and
Puppeteer engines; `executable_path` also applies to Chromiumoxide:

```rust
let playwright = LaunchOptions::playwright()
    .channel("chrome")
    .headless(true)
    .node_working_dir("./js");

let chromiumoxide = LaunchOptions::chromiumoxide()
    .executable_path("/usr/bin/google-chrome")
    .headless(true);
```

### Portable session state

Export cookies and the current page origin's localStorage in Playwright's
`cookies`/`origins` format. The same JSON file can be restored by the
Chromiumoxide, Playwright, and Puppeteer engines before the first caller
navigation, in either real or engine launch mode:

```rust
use browser_commander::{launch_browser, save_storage_state, LaunchOptions};
use std::path::Path;

let first = launch_browser(LaunchOptions::chromiumoxide().headless(true)).await?;
first.page.goto("https://example.com").await?;
save_storage_state(first.page.as_ref(), Some(Path::new("session.json"))).await?;
first.close().await?;

let next = launch_browser(
    LaunchOptions::playwright()
        .headless(true)
        .storage_state(Path::new("session.json")),
).await?;
next.page.goto("https://example.com").await?;
```

`ConnectOptions::storage_state(...)` restores the same format when attaching
to a running browser. `save_storage_state(page, None)` returns a typed
`StorageState` without writing a file. Chromiumoxide and Puppeteer capture
localStorage for the current page origin; Playwright captures every visited
origin in its context.

You can also set a custom Node executable:

```rust
let options = LaunchOptions::playwright()
    .node_executable("/usr/local/bin/node")
    .node_working_dir("./js");
```

`LaunchOptions::fantoccini()` is still accepted for source compatibility, but `launch_browser()` does not yet start a managed WebDriver process.

### Connect to a Running Browser over CDP

`connect_browser()` attaches to an externally managed Chrome-family browser
and returns the same `LaunchResult` page adapter as `launch_browser()`. Use
Chromiumoxide natively, Playwright through its driver, or the Puppeteer Node.js
bridge:

```rust
use browser_commander::prelude::*;

let native = connect_browser(
    ConnectOptions::chromiumoxide()
        .cdp_endpoint("http://127.0.0.1:9222"),
).await?;

let playwright = connect_browser(
    ConnectOptions::playwright()
        .ws_endpoint("ws://127.0.0.1:9222/devtools/browser/<id>")
        .node_working_dir("./js"),
).await?;

native.page.goto("https://example.com").await?;
```

Exactly one endpoint is required. When starting Chrome 136 or newer yourself,
pass a non-default `--user-data-dir` together with the remote-debugging flag;
Chrome intentionally disables remote debugging for its default data directory.
Cookies can be supplied explicitly with `ConnectOptions::seed_cookies()`.
Because connection is attach-only, it cannot retrofit launch flags. Start the
external process with the documented defaults or use `launch_real_browser()`.

### Installed browser cookies

Discover profiles and read cookies in the same shape accepted by browser
contexts:

```rust
use browser_commander::{
    list_browser_profiles, read_browser_cookies, BrowserCookieReadOptions,
    BrowserProfileOptions,
};

let profiles = list_browser_profiles(
    BrowserProfileOptions::default().browser("chrome"),
)?;
println!("{profiles:#?}");

let cookies = read_browser_cookies(
    BrowserCookieReadOptions::new("chrome")
        .profile("Default")
        .domain_filter("example.com")
        .ttl_minutes(60.0),
)?;
# Ok::<(), anyhow::Error>(())
```

Each `BrowserCookie` contains `name`, `value`, `domain`, `path`, `expires`,
`http_only`, `secure`, and `same_site` (serialized as the Playwright-compatible
`httpOnly` and `sameSite` names). The explicit helper supports Chrome, Edge,
Brave, Chromium, and Firefox and never sends imported data anywhere.

Decrypted results and derived keys default to
`~/.browser-commander/cookie-cache/` with owner-only permissions. A process
lock and the default 60-minute TTL keep Keychain, libsecret/KWallet, or DPAPI
access to at most one read across concurrent and repeated processes. Use
`.refresh(true)` to coordinate a new read, `.cache_dir(...)` and
`.ttl_minutes(...)` to customize storage, or `.cache(false)` to opt out.

| Browser family                | macOS                                | Linux                                                                       | Windows                                       |
| ----------------------------- | ------------------------------------ | --------------------------------------------------------------------------- | --------------------------------------------- |
| Chrome, Edge, Brave, Chromium | Keychain + AES-128-CBC (`v10`/`v11`) | libsecret/KWallet + AES-128-CBC (`v11`), or the Chromium `v10` fallback key | DPAPI-protected AES-256-GCM key (`v10`/`v11`) |
| Firefox                       | `cookies.sqlite`                     | `cookies.sqlite`                                                            | `cookies.sqlite`                              |

Chromium database-version-24 domain hashes and 1601-based timestamps are
handled automatically. Current Windows Chromium may use app-bound `v20`
encryption, which requires the browser's privileged service and cannot be
decrypted by an ordinary external process. The helper reports this boundary;
use a browser-supported export or saved Browser Commander storage state for
those cookies. `.ignore_decryption_errors(true)` returns the remaining
decryptable cookies. Treat imported cookies like passwords: use a short TTL,
never commit cache files, and seed only a dedicated automation profile.

### Launch and Connect to an Installed Browser

`launch_real_browser()` discovers and starts genuine installed Chrome, Edge,
Brave, or Chromium with a dedicated profile, waits for its loopback CDP
endpoint, and attaches with Chromiumoxide or the Playwright/Puppeteer bridges:

```rust
use browser_commander::prelude::*;
use serde_json::json;

let result = launch_real_browser(
    RealBrowserOptions::playwright()
        .channel("chrome")
        .user_data_dir("/tmp/browser-commander-profile")
        .with_extra_args(vec!["--lang=en-US".to_string()])
        .ignore_default_args(vec!["--disable-infobars".to_string()])
        .seed_cookies(vec![json!({
            "name": "session",
            "value": "saved",
            "url": "https://example.com"
        })])
        .node_working_dir("./js"),
).await?;

result.page.goto("https://example.com").await?;
println!("CDP endpoint: {}", result.cdp_endpoint);
```

An explicit `executable_path` can replace channel discovery. Known default
profiles and custom arguments that override the loopback address, debugging
port, or profile are rejected. `RealBrowserLaunchResult` owns a
`browser_process` handle and terminates the spawned browser when dropped.
`launch_and_connect_real_browser()` is an alias.
The remote-debugging address, port, and profile remain managed; headless mode
is opt-in and uses `--headless=new`.

### Navigation

```rust
// Navigate to URL
goto(&page, "https://example.com", None).await?;

// Navigate with options
let nav_options = NavigationOptions {
    wait_until: WaitUntil::NetworkIdle,
    timeout: Some(30000),
};
goto(&page, "https://example.com", Some(nav_options)).await?;

// Wait for URL to match condition
wait_for_url_condition(&page, |url| url.contains("success")).await?;
```

### Element Interactions

```rust
// Click a button
click_button(&page, "button.submit", None).await?;

// Click with options
let click_options = ClickOptions {
    scroll_into_view: true,
    wait_for_navigation: true,
    ..Default::default()
};
click_button(&page, "button.submit", Some(click_options)).await?;

// Fill text area
fill_text_area(&page, "textarea.message", "Hello world", None).await?;

// Scroll element into view
scroll_into_view(&page, ".target-element", None).await?;

// Keyboard interactions
press_key(&engine, "Escape").await?;
press_key(&engine, "Enter").await?;
type_text(&engine, "Hello World").await?;
key_down(&engine, "Control").await?;
key_up(&engine, "Control").await?;
```

### Element Queries

```rust
// Check visibility
let visible = is_visible(&page, ".element").await?;

// Check if enabled
let enabled = is_enabled(&page, "button.submit").await?;

// Get text content
let text = text_content(&page, ".message").await?;

// Get attribute value
let href = get_attribute(&page, "a.link", "href").await?;

// Count matching elements
let count = count(&page, ".item").await?;
```

### Managed Downloads

A download that only exists while the browser is open is not a download. Ask for
`downloads` at any entry point - `launch_browser()`, `connect_browser()` or the
real-browser helpers - and the manager owns the file from then on:

```rust
use browser_commander::browser::{launch_browser, LaunchOptions};
use browser_commander::downloads::{CaptureOptions, DownloadOptions};
use browser_commander::interactions::click_element;

let launched = launch_browser(
    LaunchOptions::chromiumoxide()
        .downloads(DownloadOptions::default().directory("/tmp/reports")),
)
.await?;
let manager = launched.downloads.clone().expect("a manager was requested");
let page = launched.page.clone();

// capture() starts listening before the action runs, so a download that
// finishes in 5ms cannot slip past the registration.
let artifact = manager
    .capture(
        CaptureOptions::named("q3-report.pdf").within(Duration::from_secs(20)),
        async {
            click_element(page.as_ref(), "#export", &Default::default()).await?;
            Ok(())
        },
    )
    .await?;

manager.dispose().await;
drop(launched);
// The file at `artifact.path` is still there: it outlives the browser.
```

Chromiumoxide redirects downloads with `Browser.setDownloadBehavior`, which also
covers a download a person started by hand in a visible browser. The Node bridge
and Fantoccini have no such mechanism, so asking them for downloads fails with
that reason rather than quietly doing nothing.
`examples/managed_download.rs` runs the whole lifecycle against a real Chromium.

### Native Extension Relay

`attach_via_extension(RelayOptions::default())` hosts the companion extension's
relay in Rust, without Node.js. It returns typed tabs and CDP session handles
with bounded event subscriptions. `write_extension_directory(path)` extracts
the bundled extension for Chrome's **Load unpacked** dialog. Configure
`allowed_extension_ids` to restrict the accepted installed extension.
[Native extension relay](https://github.com/link-foundation/browser-commander/blob/main/docs/extension-relay.md) documents startup,
shutdown, resource limits and examples for both native packages.

### Live Profile Snapshots

Copy a selected Chromium profile while its source browser stays open, then
launch the copy through Chromiumoxide, Playwright or Puppeteer:

```rust
use browser_commander::{launch_snapshot, RealBrowserOptions, SnapshotOptions};

let copy = launch_snapshot(
    SnapshotOptions { profile: "Profile 1".into(), ..Default::default() },
    RealBrowserOptions::default(),
).await?;
println!("{:?}", copy.snapshot.copied);
copy.close().await?;
```

`SnapshotOptions::user_data_dir` selects an explicit source root. SQLite
backups retain committed WAL data; caches, locks and open-tab sessions are
excluded and reported. Closing the browser deletes its copy. The original
profile remains untouched. `snapshot_user_data_dir(&source, destination)`
returns the same report without launching; callers own that returned directory.

### Measure browser parity

`measure_parity` compares a driven browser with the same binary started by
hand. The environment reference has no debugger attached. Both captures load
the same probe page; a separate reference launch reads Chrome's actual command
line. The typed report uses the same JSON format and limitations catalogue as
JavaScript and Python, and keeps unexplained differences in `unlisted`.

```rust,no_run
use browser_commander::{measure_parity, LaunchOptions, MeasureParityOptions};

let report = measure_parity(MeasureParityOptions {
    launch: LaunchOptions::chromiumoxide().headless(true),
    ..Default::default()
}).await?;
println!("{}", serde_json::to_string_pretty(&report)?);
```

Use `measure_session_parity(&session, options)` for an existing `LaunchResult`;
the caller retains ownership of that browser. Measurement navigates its page to
the probe, and reads version metadata in a separate tab. In a container that
requires disabling Chrome's sandbox, set `launch.sandbox=false` and explicitly
include `--no-sandbox` in `reference_args` so both captures use the same setting.

### Portable Traces

See [capture, debugging and reusable sessions](https://github.com/link-foundation/browser-commander/blob/main/docs/capture-and-debugging.md)
for screenshots, recordings, full/text DOM links, network/HAR, rotation,
persistent browsers, early trigger readiness and engine capability limits.

A trace is one versioned directory - manifest, ordered NDJSON timeline,
per-checkpoint DOM snapshots and the mutation batches between them. Rust records
the same bundle JavaScript and Python do, over any engine adapter:

```rust
use std::sync::Arc;
use browser_commander::traces::{
    start_trace, write_trace_viewer, AdapterTracePage, TraceMode, TraceOptions,
};

let mut options = TraceOptions::new("/tmp/traces/checkout");
options.mode = TraceMode::CONTINUOUS.into(); // DOM mutations between checkpoints
let trace = start_trace(Arc::new(AdapterTracePage::new(page.clone())), options).await?;

trace.traced("goto", Some("checkout"), page.goto("https://example.com/checkout")).await?;
trace.checkpoint("cart loaded").await?;
let finished = trace.stop().await?;
write_trace_viewer(&finished.path)?; // viewer.html, opens offline
```

`record_scenario` keeps a run's bundle only when the run fails, like
`trace: 'retain-on-failure'` in JavaScript. A bundle reads back the same
whichever language recorded it:

```rust
use browser_commander::traces::{diff_control_state, read_trace};

let trace = read_trace("/tmp/traces/checkout")?;
println!("{} {}", trace.manifest.schema_version, trace.manifest.outcome);

for event in &trace.events {
    println!("{} {}", event["at"], event["kind"]);
}

let before = trace.state(1)?;
let after = trace.state(2)?;
for change in diff_control_state(before.as_ref(), after.as_ref()) {
    println!("{:?} {:?}", change.path, change.change);
}
```

With chromiumoxide, Rust records page activity except downloads, and mutation
batches from the main frame only; `docs/feature-parity.md` lists these gaps
along with the rest.

### Truthful Click Results

`click_element()` reports what was observed, not what was attempted:

```rust
let result = click_element(adapter, "#submit", &ClickOptions::default()).await?;

result.status;   // Succeeded | Failed | TimedOut | Interrupted | Unverified
result.effect;   // Confirmed | NotObserved | Contradicted
result.evidence; // why status and effect say what they say
result.clicked;  // still here: whether the click reached the element
result.verified; // still here, now derived from effect == Confirmed
```

`ClickOptions::activation` carries three independent axes. `ClickScroll`
(`Auto`, `Preserve`, `None`) replaces the deprecated `no_auto_scroll` flag:
`ClickScroll::None` never scrolls, and on an engine that cannot deliver a click
without scrolling it returns `ClickDispatchError::ScrollConstraint` naming the
alternatives rather than scrolling the page and reporting success.

### Utilities

```rust
// Wait for a duration
wait(1000).await;

// Get current URL
let url = get_url(&page).await?;

// Parse URL
let parsed = parse_url("https://example.com/path?query=value")?;

// Evaluate JavaScript
let result: String = evaluate(&page, "document.title").await?;
```

## Modules

- `core` - Core types and traits (constants, engine adapter, logger)
- `elements` - Element operations (selectors, visibility, content)
- `interactions` - User interactions (click, scroll, fill, keyboard)
- `browser` - Browser management (launcher, navigation)
- `utilities` - General utilities (URL handling, wait operations)
- `high_level` - High-level DRY utilities
- `downloads` - Managed downloads that outlive the browser
- `traces` - Recording, reading and exporting portable trace bundles

## Prelude

For convenience, import everything commonly needed with:

```rust
use browser_commander::prelude::*;
```

## Extensibility / Escape Hatch

`browser-commander` cannot anticipate every browser API. When you need an API that is not yet supported, you can access the raw underlying engine objects directly as an **official extensibility escape hatch**.

### Using `LaunchResult` raw fields

`launch_browser()` returns a `LaunchResult` with a `browser` field that contains the engine type and configuration. When using the underlying engine crate (e.g. `chromiumoxide`) directly, the raw browser and page objects are accessible from the engine crate:

```rust
use browser_commander::prelude::*;

let options = LaunchOptions::chromiumoxide().headless(true);
let result = launch_browser(options).await?;

// Access engine metadata
println!("Engine: {:?}", result.browser.engine);
println!("User data dir: {:?}", result.browser.user_data_dir);

// For engine-specific APIs not yet in browser-commander,
// use the underlying engine crate directly alongside browser-commander.
// For example, with chromiumoxide:
//   let (browser, mut handler) = Browser::launch(BrowserConfig::builder()...).await?;
//   let page = browser.new_page("about:blank").await?;
//   // Use page.pdf(), page.emulate_media(), page.keyboard() etc.
```

### Why This Matters

- Users can adopt browser-commander incrementally while retaining access to full engine APIs
- No need for fragile `_page` private-field hacks
- Missing APIs can be [reported as issues](https://github.com/link-foundation/browser-commander/issues) while users remain unblocked

## License

[UNLICENSE](../LICENSE)

See [navigation budgets, launch diagnostics, reusable helpers and sessions](https://github.com/link-foundation/browser-commander/blob/main/docs/navigation-launch-and-sessions.md) for the shared API contracts and engine limitations.
