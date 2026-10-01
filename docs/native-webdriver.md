# Native Rust WebDriver

Rust starts ChromeDriver or geckodriver through command-stream on a loopback
port. It exposes the complete typed [Fantoccini client](https://docs.rs/fantoccini/latest/fantoccini/struct.Client.html)
and connects WebDriver BiDi when the driver supplies `webSocketUrl`.

```rust,no_run
use browser_commander::{launch_webdriver, WebDriverOptions, DownloadOptions};

# async fn example() -> anyhow::Result<()> {
let browser = launch_webdriver(WebDriverOptions {
    driver_executable: Some("/path/to/chromedriver".into()),
    browser_executable: Some("/path/to/chrome".into()),
    downloads: DownloadOptions::default().directory("./downloads").into(),
    ..Default::default()
}).await?;
browser.client().goto("https://example.com").await?;
if let Some(bidi) = browser.bidi() {
    let tree = bidi.get_tree().await?;
    println!("{} contexts", tree.contexts.len());
}
browser.close().await?;
# Ok(()) }
```

The driver must match the browser. `driver_executable` falls back to
`chromedriver` or `geckodriver` in PATH. Set `browser: WebDriverBrowser::Firefox`
for Firefox. Custom W3C capabilities and browser preferences are preserved;
owned profile and managed download settings take precedence. Use `user_data_dir`
instead of capability or argument profile overrides. Existing dedicated profiles
are retained. Temporary profiles are removed after explicit close; final process
ownership also kills abandoned drivers if their Tokio runtime has already ended.

`LaunchOptions::fantoccini()` selects the same native implementation through the
common launcher. Configure its `webdriver` field for driver, browser and
capabilities; common launch fields control headless mode, environment, arguments,
profile, preferences and downloads. All shared page helpers use native WebDriver.
`launch_webdriver_snapshot` copies a live Chromium profile without writing its
source and deletes the copy on close or failure. Firefox cannot consume Chromium
profile copies.

Chrome's profile settings control first-run and default-browser UI. The measured
ChromeDriver default switches are excluded and Chrome receives a fixed debugging
port; `automation_parity: false` restores the driver's switch layer. Firefox uses
a system-allocated BiDi port, avoiding geckodriver's shared default port 9222.
`sandbox: false` passes `MOZ_DISABLE_CONTENT_SANDBOX=1` to Firefox's driver process.

Managed downloads use [Chrome preferences](https://developer.chrome.com/docs/chromedriver/capabilities)
or Firefox preferences before session creation and the existing native download
manager's staging-directory watcher. `.crdownload`, `.tmp`, `.partial` and Firefox
`.part` files remain pending. Completed downloads support capture, naming,
validation, persistence and cleanup. A filesystem watcher cannot report browser
download percentages or source URLs.

BiDi exposes typed context trees, navigation and script results, event
subscriptions and a dynamic command fallback. The connection permits 64 pending
requests, 4 MiB messages and 1,024 retained events. Dropped requests release their
slots; explicit close sends a WebSocket close frame. Debug driver output uses
`tracing` and is disabled unless a subscriber enables the debug level.

Portable state imports HttpOnly cookies through BiDi without navigating to cookie
domains. Classic WebDriver falls back to domain navigation and uses matching
origin ports where available. Export covers all browser cookies through BiDi;
classic WebDriver can only export cookies for the current domain. LocalStorage
is origin scoped. Chrome version metadata is read in a temporary tab for native
parity measurement, preserving the caller's current tab.

`rust/tests/webdriver.rs` runs against real Chrome and Firefox and verifies BiDi
events, typed input, portable cookies/localStorage, completed downloads and
driver/profile cleanup. Chrome also verifies copied-profile ownership and the
common launcher. `rust/tests/webdriver_bidi.rs` tests out-of-order responses,
events, errors and cancellation without a browser. The runtime-shutdown regression
failed with an owned process still alive before synchronous final cleanup.
