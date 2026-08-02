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

## Installed-Browser Cookie Parity

| Capability                                                        | JavaScript | Rust      | Python    |
| ----------------------------------------------------------------- | ---------- | --------- | --------- |
| Discover Chrome, Edge, Brave, Chromium, and Firefox profiles      | Supported  | Supported | Supported |
| Read Playwright-compatible cookie fields                          | Supported  | Supported | Supported |
| Filter by domain and choose a named profile                       | Supported  | Supported | Supported |
| Chromium version-24 host-hash validation and timestamp conversion | Supported  | Supported | Supported |
| macOS Keychain + AES-128-CBC                                      | Supported  | Supported | Supported |
| Linux libsecret/KWallet + AES-128-CBC                             | Supported  | Supported | Supported |
| Windows DPAPI key + legacy AES-256-GCM                            | Supported  | Supported | Supported |
| Firefox `cookies.sqlite`                                          | Supported  | Supported | Supported |
| Owner-only derived-key/result cache with TTL and refresh controls | Supported  | Supported | Supported |
| Cross-process credential-read lock                                | Supported  | Supported | Supported |

Current Windows Chromium app-bound `v20` values require Chromium's privileged
service and are intentionally reported as unsupported for ordinary external
processes. All three APIs can skip those individual values when partial import
is acceptable. The shared derived-key cache uses one schema and lock identity,
so JavaScript, Rust, and Python processes do not independently prompt within a
TTL window.

## Compatibility Notes

- Existing Rust aliases remain compatible: `chromiumoxide` and `cdp` parse as `EngineType::Chromiumoxide`; `fantoccini` and `webdriver` parse as `EngineType::Fantoccini`.
- `playwright` and `puppeteer` now parse as distinct Rust engine types instead of silently mapping to a different backend.
- Rust Playwright/Puppeteer support requires Node.js plus the matching package in `node_working_dir` or normal Node module resolution.
- Python exposes the same CDP attach operation as `connect_browser()` for its Playwright and Selenium engines.
- Chrome 136 and newer require a non-default user data directory before honoring remote-debugging switches.
