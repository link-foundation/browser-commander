# Safari W3C WebDriver

On macOS, `safari`, `safari-technology-preview` and the `safari-tp` alias select
Apple's installed driver. The shared catalogue declares `controlProtocol:
"webdriver"` and the executables `/usr/bin/safaridriver` and
`/Applications/Safari Technology Preview.app/Contents/MacOS/safaridriver`.
Real and common launchers use native Selenium in JavaScript/Python and
Fantoccini in Rust. JavaScript CLI `--browser safari` and `--browser safari-tp`
select the same route; the optional Python/Rust shared CLI forwards that route.
Install the optional `selenium-webdriver` JavaScript peer or Python `[selenium]`
extra. Rust uses its existing native WebDriver dependency.

## One-time setup

1. Open Safari → Settings → Advanced and enable **Show features for web developers**.
2. In the Develop menu, enable **Allow Remote Automation**.
3. If the driver requires authorization, run `/usr/bin/safaridriver --enable`
   once. macOS may request an admin password. For Technology Preview, use its
   bundled driver path, quoted because it contains spaces.

Recognized authorization failures produce `SafariSetupError`, preserving the
original cause and explaining these steps. Setup is manual. An explicit
`openSafariSettings()` (JavaScript), `await open_safari_settings()` (Python), or
`open_safari_settings(false).await` (Rust, `true` for Technology Preview) opens
Advanced settings. JavaScript and Python setup errors also expose this opener.
Driver output is included in startup failure diagnostics; JavaScript `verbose`
and Rust debug tracing can show driver output during investigation.

## Native commands and common helpers

```javascript
import { launchRealBrowser, makeBrowserCommander } from 'browser-commander';

const session = await launchRealBrowser({ channel: 'safari' });
try {
  await session.page.goto('https://example.com');
  const commander = makeBrowserCommander({ page: session.page });
  // commander.fill({ selector: '#name', text: 'Ada' });
  // commander.click({ selector: '#submit' });
  console.log(await session.page.evaluate(() => document.title));
  console.log(await session.page.evaluateAsync(async () => 'ready'));
  await session.page.screenshot({ path: 'safari.png' });
  const original = await session.driver.getWindowHandle();
  await session.page.newWindow('tab'); // 'window' is also supported
  await session.page.switchToWindow(original);
  await commander.destroy();
} finally {
  await session.close();
}
```

```python
from browser_commander import RealBrowserOptions, launch_real_browser

session = await launch_real_browser(RealBrowserOptions(channel="safari-tp"))
try:
    driver = session.page  # native selenium.webdriver.Safari
    driver.get("https://example.com")
    print(driver.execute_script("return document.title"))
    print(driver.execute_async_script(
        "const done=arguments[arguments.length-1]; Promise.resolve('ready').then(done)"
    ))
    driver.save_screenshot("safari.png")
    driver.switch_to.new_window("tab")
finally:
    await session.close()
```

```rust,no_run
use browser_commander::{launch_real_browser, RealBrowserOptions};

# async fn example() -> anyhow::Result<()> {
let session = launch_real_browser(RealBrowserOptions::default().channel("safari")).await?;
let native = session.webdriver.as_ref().unwrap();
native.client().goto("https://example.com").await?;
let title = native.client().execute("return document.title", vec![]).await?;
let tab = native.client().new_window(true).await?;
native.client().switch_to_window(tab.handle).await?;
session.close().await?;
# Ok(()) }
```

The Rust common page exposes the existing find/click/fill/evaluate and cookie
helpers; `session.webdriver` exposes all typed Fantoccini window, async script,
and screenshot commands. Direct `launch_webdriver(WebDriverOptions { browser:
WebDriverBrowser::Safari, ..Default::default() })` also works. Safari real-launch
metadata has an empty CDP endpoint, port zero and no disk profile. Closing the
session quits WebDriver and stops the owned driver; repeated close is safe.

## Isolated state and explicit Safari imports

Safari automation creates isolated, ephemeral windows. It does not share the
normal Safari profile's cookies, bookmarks, history or extensions, and closing
the session discards its state. Browser Commander creates no persistent Safari
profile. `userDataDir`/`user_data_dir` and profile migration are unsupported.

Explicitly pass importer cookies as `seedCookies`/`seed_cookies`, or use portable
`storageState`/`storage_state`. For example:

```javascript
import { readBrowserCookies, launchRealBrowser } from 'browser-commander';
const imported = await readBrowserCookies({
  browser: 'safari',
  domainFilter: 'example.com',
});
const session = await launchRealBrowser({
  channel: 'safari',
  seedCookies: imported,
});
```

Python's `read_browser_cookies(BrowserCookieReadOptions(...))` and Rust's
`read_browser_cookies` return the corresponding cookie collection. Python accepts that list directly
in `seed_cookies`; Rust uses `serde_json::to_value(cookie)` to convert each
`BrowserCookie` into the `Vec<Value>` accepted by `seed_cookies`. Reading protected Safari stores may require
Full Disk Access, as documented by the importer. Imports are opt-in and do not
modify the source profile. HttpOnly cookies go through WebDriver Add Cookie;
the launcher visits each cookie's domain before setting it and returns to the
original page. A cookie `url` or a matching storage-state origin preserves a
custom port. LocalStorage is restored by visiting each declared origin.

| Operation                           | JavaScript                   | Python                        | Rust                       |
| ----------------------------------- | ---------------------------- | ----------------------------- | -------------------------- |
| Navigate, find, click, fill         | Common helpers / native      | Common helpers / native       | Common helpers / native    |
| Sync / async evaluation             | `evaluate` / `evaluateAsync` | Native execute script / async | Native execute / async     |
| Screenshots, cookies, windows, tabs | W3C facade / native          | Native Selenium               | Native Fantoccini          |
| Network interception                | `SafariUnsupportedError`     | `SafariUnsupportedError`      | `EngineError::Unsupported` |
| Trace recording                     | `SafariUnsupportedError`     | `SafariUnsupportedError`      | `EngineError::Unsupported` |
| PDF printing                        | `SafariUnsupportedError`     | `SafariUnsupportedError`      | `EngineError::Unsupported` |

The native Python/Rust APIs expose `require_safari_feature`/`require_feature`
for typed rejection of unsupported operations such as network interception.
Safari has no supported CDP/BiDi route, headless mode, browser flags, custom
preferences, managed downloads, fingerprint overrides or persistent profile.
Requested unsupported launch settings fail before starting a session.

`Safari WebDriver` CI uses a separate macOS runner per language, enables
safaridriver on that disposable runner, and tests a local page: common/native
input, click, sync/async evaluation, screenshot, HttpOnly cookie seeding, tabs,
windows, teardown and absence of cookies in the next session. Run the JS/Python
smokes with `RUN_SAFARI_E2E=true`; run Rust with `cargo test --test
safari_webdriver safari_local_page_smoke -- --ignored` on an authorized Mac.

Apple documents [setup and isolated automation windows](https://developer.apple.com/documentation/webkit/about-webdriver-for-safari).
The native [Selenium Safari API](https://www.selenium.dev/documentation/webdriver/browsers/safari/)
and [Fantoccini client](https://docs.rs/fantoccini/latest/fantoccini/struct.Client.html)
describe the available W3C commands.
