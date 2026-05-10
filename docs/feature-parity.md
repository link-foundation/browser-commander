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
| Persistent user data directory          | Supported             | Supported            | Supported          | Supported              | Supported             |
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

## Compatibility Notes

- Existing Rust aliases remain compatible: `chromiumoxide` and `cdp` parse as `EngineType::Chromiumoxide`; `fantoccini` and `webdriver` parse as `EngineType::Fantoccini`.
- `playwright` and `puppeteer` now parse as distinct Rust engine types instead of silently mapping to a different backend.
- Rust Playwright/Puppeteer support requires Node.js plus the matching package in `node_working_dir` or normal Node module resolution.
