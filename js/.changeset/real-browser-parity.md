---
'browser-commander': minor
---

Run a real browser by default, measure parity, migrate profiles and drive
every engine from one CLI (#101, #102, #103, #104, #105).

Launch the installed browser the way a person would, and make every restriction
opt-in (#101, #103).

`launchBrowser()` now starts the installed Chrome (or `channel`/
`executablePath`) itself and attaches over CDP. The whole command line is
`--user-data-dir=<fresh temporary profile> --remote-debugging-port=<reserved
port> about:blank` (a URL in `args` replaces `about:blank`): no `--enable-automation`, no `--disable-blink-features`, so
`navigator.webdriver` is `false` and Chrome shows neither the "controlled by
automated test software" nor the unsupported-flag infobar. The temporary
profile is seeded with the `First Run` sentinel and `Local State` entries that
keep the "What's new" tab and Microsoft Edge's first-run tab from stealing the
foreground, and it is deleted on close. `launch: 'engine'` keeps the Playwright/Puppeteer launcher.

The debugging port is reserved on loopback and its ownership is proven from the
browser's own `DevTools listening on` line, so a port lost to another process is
detected and the launch retried on a new port. Subprocesses are started through
`command-stream`.

Everything the library used to add on its own - `CHROME_ARGS`, the Google API
key override, the Translate preference, `--start-maximized` and `slowMo: 150` -
is gone from the defaults and available as named `restrictions` from the shared
`launch-restrictions.json` (`restrictions: ['legacy-defaults']` restores the old
switches). The host `process.env` is never modified; restriction environment
reaches the browser process only. `LAUNCH_MODES`, `LAUNCH_RESTRICTIONS`,
`LAUNCH_RESTRICTION_PRESETS`, `resolveRestrictions`, `mergeFeatureSwitches`,
`resolveLaunchExecutable`, the profile-directory helpers,
`reserveLoopbackPort` and `PortRaceError` are exported.

Measure how far a driven browser is from the same browser started by hand
(#103).

`measureParity()` starts the binary the way a person would, reads its
chrome://version command line and runs the environment probe in it, then does
the same for the browser Browser Commander launches (or for a `session` you
pass). Every difference in the command line, in the feature switches and in
anything a page can read is tagged with the limitations-catalogue entry that
explains it or marked `requested` when it follows from an option you set; a
report with an unexplained difference is not `ok`. `parseSwitches`,
`compareCommandLines`, `classifyDifferences` and `readBrowserVersionPage` are
exported too. The parity e2e suite measures every installed Chrome-family
browser (Chrome, Chromium, Edge, Brave), headful and headless, through both
engines.

`--headless` is no longer treated as an AutomationControlled trigger, so a
headless launch no longer adds `--disable-blink-features=AutomationControlled`:
Chrome 153 keeps `navigator.webdriver` false for every `--headless` form, and
the extra switch was the one difference `measureParity()` found headless.

Add opt-in profile migration and a no-automation "open in the user's browser"
mode (#102).

The real-browser launch stays clean by default - so signing in with a Google
account works (a nonexistent address shows "Couldn't find your Google Account",
not "This browser or app may not be secure"). New APIs close the gap to the
user's real browser:

- `migrateProfile({ from, to, include, domains, targetBrowser })` copies data
  from an installed browser's main profile into a dedicated target profile. It
  is strictly read-only on the source: SQLite databases (`History`, `Top Sites`,
  cookies, Firefox `places.sqlite`) are copied through the SQLite Online Backup
  API so a running browser is never disturbed, and JSON (`Bookmarks`,
  `Preferences`) is copied as is. Data classes are `cookies`, `bookmarks`,
  `history`, `passwords`, `preferences` and `extensions` (`ALL_DATA_CLASSES`).
  Chromium passwords are re-encrypted with the target profile's OS-keystore key;
  Firefox uses its NSS `key4.db` path. The report explains what was skipped and
  why: DBSC-bound Google cookies (`dbsc-bound`), Windows app-bound `v20`
  (`app-bound-v20`), migrated extensions whose `Secure Preferences` MAC cannot be
  forged (`mac-will-not-validate`), and Firefox primary passwords
  (`primary-password-set`).
- `launchRealBrowser({ migrateFrom })` runs that migration before launch, seeds
  the migrated cookies automatically, and returns a `migration` report on the
  session.
- `openInUserBrowser(url)` opens a URL in the user's own default browser with no
  automation (macOS `open`, Linux `xdg-open`, Windows `start`) for flows that
  only need to show a page, such as an OAuth or CLI web-login screen.

`migrateProfile`, `ALL_DATA_CLASSES`, `openInUserBrowser`, `buildOpenCommand`
and `validateOpenUrl` are exported.

Add the `browser-commander` command line and its `serve --stdio` JSON-RPC
bridge (#104).

The package now installs a `browser-commander` binary. Its commands are
`version`, `launch [--keep-open]`, `open`, `goto`, `click`, `fill`, `eval`,
`screenshot`, `pdf`, `trace start|stop|view`, `cookies import`,
`profile migrate`, `doctor`, `run <script.json>` and `serve --stdio`. Each
command prints exactly one JSON document to stdout. It exits `0` on success,
`1` on error, `2` when `doctor` finds an unlisted difference, and `64` on a
usage error. Page commands either attach to a browser with `--cdp-endpoint` or
launch a temporary one. The Rust and Python CLIs follow the same contract,
`docs/cli-and-bridge.md`.

`run` and `serve --stdio` share one dispatcher. It has the high-level methods
(`session.launch`, `page.goto`, …) and generic handle methods
(`handle.root`, `handle.call`, `handle.get`, `handle.describe`,
`handle.dispose`, `events.subscribe`/`unsubscribe`). The handle methods reach
every public Playwright and Puppeteer method, and an e2e suite checks this
against the engines' shipped `.d.ts` files. Values that are not JSON are
tagged (`$handle`, `$binary`, `$function`, `$date`, …), and handle ids are
deterministic, so `tests/cli-contract/basic.json` gives byte-identical results
in every language. The bridge replaces the 27-operation
`node_engine_bridge.js` used by the Rust crate.

`createCdpSession(page)` and `commander.createCdpSession()` return one raw CDP
surface (`send`, `on`, `once`, `off`, `detach`) for Playwright and Puppeteer
pages. The cookie credential tools now run through `command-stream`, like the
browser launch.

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
