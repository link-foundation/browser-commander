---
'browser-commander': minor
---

Add a `selenium` engine that drives Chrome and Firefox over W3C WebDriver and
WebDriver BiDi (#104).

`selenium-webdriver` is an optional peer dependency. `makeBrowserCommander()`
detects a selenium `WebDriver` and runs every commander operation through a
Puppeteer-shaped `WebDriverPage` facade and a `SeleniumAdapter` that uses
WebDriver's own Element Click, Element Clear and Element Send Keys. PDFs come
from the W3C Print Page command; options it cannot honour (header/footer
templates, `preferCSSPageSize`) are refused rather than dropped.

`launchWebDriver({ browser, executablePath, driverPath, headless, userDataDir,
bidi })` finds a driver (`driverPath`, then `PATH`, then the Selenium Manager
bundled with `selenium-webdriver`), starts it on a reserved loopback port, waits
for `/status`, and opens a session with a temporary profile that `close()`
removes. Chrome gets the real-browser command line and all 19 switches
chromedriver would add on its own are excluded, so `navigator.webdriver` is
`false` headful and headless (measured with Chrome and chromedriver 153).
`connectWebDriver({ serverUrl, capabilities })` opens a session on a server that
is already running.

With `bidi: true` the session asks for `webSocketUrl`, and console, dialog,
request and frame-navigation events, preload scripts and full-page screenshots
work through WebDriver BiDi. The adapter adds `onConsoleMessage()`,
`onNavigation()`, `onBidiEvent()` and `navigate()` helpers. Media emulation,
fingerprint overrides and managed downloads need CDP and throw a clear error on
this engine. Four new shared limitations (`webdriver-driver-launch-switches`,
`webdriver-no-cdp-emulation`, `webdriver-classic-has-no-events`,
`webdriver-print-options`) record the gaps for JavaScript, Python and Rust.
