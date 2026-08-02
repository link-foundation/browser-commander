# Browser Commander Feature Parity

This matrix tracks the shared API surface across the maintained language implementations. "Supported" means the public helper exists and is covered by unit tests or adapter tests in that language. "Bridge" means the Rust API is implemented by delegating to the official Node.js engine package.

## Engine Matrix

| Engine        | JavaScript                                     | Rust                    | Notes                                                                                                                                                |
| ------------- | ---------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Playwright    | Supported through the official Node.js package | Bridge through Node.js  | Playwright's official language list covers JavaScript/TypeScript, Python, Java, and .NET. Browser Commander uses Node for Rust Playwright execution. |
| Puppeteer     | Supported through the official Node.js package | Bridge through Node.js  | Puppeteer documents itself as a JavaScript library for driving Chrome/Firefox over CDP or WebDriver BiDi.                                            |
| Chromiumoxide | Not applicable                                 | Native Rust             | Rust CDP backend.                                                                                                                                    |
| Fantoccini    | Not applicable                                 | Engine type preserved   | Managed launch is not implemented; keep the variant for compatibility and future WebDriver support.                                                  |
| Selenium      | Not applicable                                 | Not implemented in Rust | Python-specific backend today.                                                                                                                       |

## API Matrix

| Capability                              | JavaScript Playwright | JavaScript Puppeteer | Rust Chromiumoxide | Rust Playwright bridge | Rust Puppeteer bridge |
| --------------------------------------- | --------------------- | -------------------- | ------------------ | ---------------------- | --------------------- |
| Launch browser                          | Supported             | Supported            | Supported          | Supported              | Supported             |
| Connect to running browser over CDP     | Supported             | Supported            | Supported          | Bridge                 | Bridge                |
| Persistent user data directory          | Supported             | Supported            | Supported          | Supported              | Supported             |
| Portable cookie/localStorage state      | Supported             | Supported            | Not implemented    | Not implemented        | Not implemented       |
| Custom Chrome args                      | Supported             | Supported            | Supported          | Supported              | Supported             |
| Headless launch                         | Supported             | Supported            | Supported          | Supported              | Supported             |
| Color scheme at launch                  | Supported             | Supported            | Supported          | Supported              | Supported             |
| Navigate / current URL                  | Supported             | Supported            | Supported          | Supported              | Supported             |
| Query selectors / count                 | Supported             | Supported            | Supported          | Supported              | Supported             |
| Visibility / enabled checks             | Supported             | Supported            | Supported          | Supported              | Supported             |
| Text content / input value / attributes | Supported             | Supported            | Supported          | Supported              | Supported             |
| Click / fill / type text                | Supported             | Supported            | Supported          | Supported              | Supported             |
| Scroll into view                        | Supported             | Supported            | Supported          | Supported              | Supported             |
| Evaluate JavaScript                     | Supported             | Supported            | Supported          | Supported              | Supported             |
| Screenshot                              | Supported             | Supported            | Supported          | Supported              | Supported             |
| PDF                                     | Supported             | Supported            | Supported          | Supported              | Supported             |
| Keyboard press/type/down/up             | Supported             | Supported            | Supported          | Supported              | Supported             |
| Bring page to front                     | Supported             | Supported            | Supported          | Supported              | Supported             |
| Wait for navigation                     | Supported             | Supported            | Supported          | Supported              | Supported             |

## Documentation Outputs

| Output                  | Command                                         | CI/CD                                    |
| ----------------------- | ----------------------------------------------- | ---------------------------------------- |
| JavaScript API docs     | `cd js && npm run docs:api`                     | Built by `.github/workflows/docs.yml`    |
| Rust API docs           | `cd rust && cargo doc --no-deps --all-features` | Built by `.github/workflows/docs.yml`    |
| Combined Pages artifact | Generated from both outputs                     | Uploaded on PRs and deployed from `main` |

## Real-Browser Lifecycle Parity

| Capability                              | JavaScript            | Rust                                 | Python                  |
| --------------------------------------- | --------------------- | ------------------------------------ | ----------------------- |
| Attach to an existing CDP endpoint      | Playwright, Puppeteer | Chromiumoxide, Playwright, Puppeteer | Playwright, Selenium    |
| Discover an installed Chrome-family app | Linux, macOS, Windows | Linux, macOS, Windows                | Linux, macOS, Windows   |
| Launch with a dedicated profile         | `launchRealBrowser()` | `launch_real_browser()`              | `launch_real_browser()` |
| Loopback-only CDP readiness probe       | Supported             | Supported                            | Supported               |
| Seed cookies after connection           | Supported             | Supported                            | Supported               |
| Return browser and page handles         | Raw engine handles    | Shared `EngineAdapter`               | Raw engine handles      |

## Automation-Friendly Launch Defaults

`launchBrowser()`/`launch_browser()` and the real-browser launch helpers add
the following Chromium-family arguments unless the caller opts out. The
defaults are the same on Linux, macOS, and Windows and apply when launching
Chrome, Edge, Brave, or Chromium:

| Default argument                   | Why it is applied                                                                                                    |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `--password-store=basic`           | Uses the isolated profile's built-in password backend instead of opening an OS Keychain/libsecret credential dialog. |
| `--no-first-run`                   | Skips the first-run setup flow that can cover or redirect the first page.                                            |
| `--no-default-browser-check`       | Prevents a default-browser prompt from interrupting automation.                                                      |
| `--disable-infobars`               | Suppresses browser information bars that can obstruct page UI.                                                       |
| `--disable-session-crashed-bubble` | Prevents a killed automation session from offering to restore tabs.                                                  |
| `--hide-crash-restore-bubble`      | Hides the crash-restore surface on browser variants that honor this switch.                                          |
| `--disable-crash-restore`          | Prevents stale tabs from being restored into the isolated profile.                                                   |

The real-browser helpers additionally manage
`--remote-debugging-address=127.0.0.1`, `--remote-debugging-port=<port>`, and
`--user-data-dir=<dedicated profile>`. These three arguments cannot be
overridden or ignored: CDP stays on loopback, and Chrome 136+ refuses remote
debugging on its default profile. Headless mode is opt-in and emits
`--headless=new`.

Use `extraArgs` and `ignoreDefaultArgs` in JavaScript, `extra_args` and
`ignore_default_args` in Python, or the corresponding Rust builder methods to
append arguments or omit individual Browser Commander defaults. Existing
`args`/`with_args()` calls remain supported. Opting out of
`--password-store=basic` can restore operating-system credential prompts.

`connectBrowser()`/`connect_browser()` only attaches to an existing process;
it cannot change that process's command line. Start an externally managed
browser with the defaults above and a dedicated remote-debugging profile, or
use the real-browser launch helper to have Browser Commander apply them.

## Compatibility Notes

- Existing Rust aliases remain compatible: `chromiumoxide` and `cdp` parse as `EngineType::Chromiumoxide`; `fantoccini` and `webdriver` parse as `EngineType::Fantoccini`.
- `playwright` and `puppeteer` now parse as distinct Rust engine types instead of silently mapping to a different backend.
- Rust Playwright/Puppeteer support requires Node.js plus the matching package in `node_working_dir` or normal Node module resolution.
- Python exposes the same CDP attach operation as `connect_browser()` for its Playwright and Selenium engines.
- Chrome 136 and newer require a non-default user data directory before honoring remote-debugging switches.
