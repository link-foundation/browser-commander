# Typed Rust Playwright

`LaunchOptions::playwright()`, `ConnectOptions::playwright()` and
`RealBrowserOptions::playwright()` use the pinned official Playwright 1.63.0
driver by default. The driver package includes its Node executable. It is
resolved by `playwright-rs = 0.19.0`, with Rustls, and runs as a
command-stream-owned process. Browser Commander does not need its npm CLI for
this path. The dependency requires Rust 1.88 or newer.

Use an installed browser with `channel("chrome")` or `executable_path(...)`.
To install Playwright's own browser, run the bundled driver's Node executable
with its `cli.js install chromium` arguments. The two paths are available from
`browser_commander::browser::playwright_driver::api::server::driver::get_driver_executable()`.
An explicit `PlaywrightDriverOptions` can override both driver paths together,
the driver's environment and its initialization deadline. The common
`node_executable` option overrides only the bundled Node executable.

```rust,no_run
use browser_commander::browser::playwright_driver::{
    launch_playwright, PlaywrightDriverOptions, api,
};

# async fn example() -> anyhow::Result<()> {
let driver = launch_playwright(PlaywrightDriverOptions::default()).await?;
let mut options = api::LaunchOptions::default();
options.channel = Some("chrome".into());
options.headless = Some(true);
let browser = driver.client().chromium().launch_with_options(options).await?;
let page = browser.new_page().await?;
page.goto("https://example.com", None).await?;
println!("{}", page.title().await?);
browser.close().await?;
driver.close().await?;
# Ok(()) }
```

The `api` module re-exports the complete typed upstream client. Native common
pages expose `raw_page()`, `context()`, `browser()` and `driver()` through
`result.page.as_playwright()`. For protocol
commands that the convenience client does not wrap, use
`generated::page::PageChannel::new(driver.connection(), guid)` and its
typed parameter/result structs. Channel references carry their object type;
enums and required fields come from the upstream schema. JSON values occur
only where the official protocol explicitly declares `json` or `any`.

`scripts/generate-playwright-protocol.mjs` generates every command, event and
initializer from the pinned official protocol YAML. The upstream version,
commit, Apache license, file inventory and SHA-256 hashes are retained in
`shared/upstream/playwright/1.63.0/`. Coverage currently includes 320 commands,
66 events and 34 initializers. `--check` verifies the source hashes, complete
inventory and generated files in CI; Rust tests also validate required fields
and reject incorrect parameter types.

The official driver uses binary, length-prefixed stdio. Because command-stream
exposes text output and has no interactive binary stdin, a small bootstrap in
that same driver process binds its stdio to an authenticated loopback socket.
It preserves the official frames and translates no browser operations. The
transport handles fragmented UTF-8 and out-of-order replies, limits frames to
64 MiB and outstanding calls to 1,024, and rejects every pending call when the
driver disconnects. Driver diagnostics use tracing at debug level by default.
Closing sends EOF for the official driver's browser cleanup before a bounded
kill fallback. Dropping the owner kills its process group even after Tokio
runtime shutdown.

The shared native adapter supports portable state, snapshot launch, parity,
CDP fingerprint settings, media preferences and managed downloads. Tests run
the full client and both common launch modes against real Chrome. The npm
adapter remains available through `.playwright_bridge(true)` as an explicit
fallback; it requires the npm packages and reports unsupported fingerprint
settings or managed downloads before connecting.
