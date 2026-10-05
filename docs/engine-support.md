# Engine support and the shared API

The language libraries launch their native engines by default. The optional
`browser-commander` CLI provides the same command script and JSON-RPC interface
in JavaScript, Python, and Rust, with `--engine playwright`, `puppeteer`, or
`selenium`. Python and Rust forward these explicit CLI commands to the companion
npm package. Install that package and the selected JavaScript engine, or set
`BROWSER_COMMANDER_JS_CLI` and `BROWSER_COMMANDER_NODE`.

| Engine               | JavaScript library                                       | Python library                                        | Rust library                                                              | CLI in all languages                            |
| -------------------- | -------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------- |
| Playwright           | Official native Node API                                 | Official native Python API                            | Native typed driver protocol; optional Node fallback                      | Yes                                             |
| Puppeteer            | Official native Node API                                 | Generated typed API through the explicit stdio bridge | Generated typed API / commander adapter through the Node bridge           | Yes                                             |
| Selenium / WebDriver | Official native `selenium-webdriver`, Chrome and Firefox | Official native Selenium, Chrome                      | Native Fantoccini, Chrome and Firefox; `selenium` and `webdriver` aliases | Yes                                             |
| Chromiumoxide        | Use Playwright or Puppeteer for CDP                      | Use Playwright for CDP                                | Native Rust CDP, the default Rust engine                                  | Use the shared Playwright or Puppeteer commands |

JavaScript's common `launchBrowser({engine: 'selenium'})` returns the WebDriver
page facade, raw `driver` (also `browser`), and an idempotent `close()`. Its default
`launch: 'real'` attaches ChromeDriver to the Chrome process Browser Commander
started. Set `launch: 'engine'` to let ChromeDriver or GeckoDriver launch Chrome
or Firefox. `connectBrowser({engine: 'selenium', serverUrl, capabilities})`
creates a session on an existing driver server or Selenium Grid. `driverPath`
selects a driver explicitly; otherwise PATH and Selenium Manager are used.

The common commander API covers navigation, selectors, input, clicking,
evaluation, keyboard operations, and PDF printing. Python Selenium invokes
JavaScript function probes in the same way as Playwright and reads DOM
`textContent`, including hidden text. Python PDF options use snake case,
as in the existing Playwright API; WebDriver paper and margin sizes are converted
to centimetres and the returned base64 PDF is decoded to bytes.

Engine capabilities still apply. Classic WebDriver has no event stream;
JavaScript's event subscriptions and origin-state preload scripts require
`bidi: true` / `webSocketUrl: true`. Restoring classic cookies visits their
origins and returns to the original page. JavaScript WebDriver fingerprint,
media, and managed-download features retain their documented CDP limitation.
Python's Chrome-specific helpers use Selenium's native CDP escape hatch.
WebDriver Print Page cannot express header/footer templates or CSS page-size
preferences, so those PDF options raise an explicit error. Chrome PDF printing
requires headless mode. The raw native handles remain available for engine
features outside the common API.

The stdio bridge exposes `handle.root` for all three engines. Selenium session
roots include a raw `driver`, whose full native API is reachable through
`handle.call`, alongside the common `page` facade. `handle.get` obtains engine
constructors such as `Builder`, and `handle.construct` instantiates them.
See [the bridge contract](cli-and-bridge.md) for value encoding and errors.

## Dependency and release compatibility

All direct npm, Python, and Cargo dependencies were audited against the current
stable registry releases. The reproducible registry snapshot and audit scripts
are in `experiments/issue-124/`. CLI subprocesses use the latest published
`command-stream` for their language: JavaScript 1.4.0 and Rust 1.3.0. Upstream
does not publish a Python package; Python retains its native subprocess helper.
Puppeteer bindings and the vendored Playwright protocol are regenerated from
the upgraded engines. The declaration generator uses TypeScript 7's native API.

Python 3.9 remains supported with interpreter markers selecting the latest
compatible release where upstream dropped 3.9. Current interpreters install
the latest versions. Mypy 2 checks the source using its supported 3.10 target;
Ruff and the Python 3.9 CI job continue checking the package's 3.9 compatibility.
Node.js 22.12 or later is required by the upgraded engine packages.

## Verification

- JavaScript unit tests reproduce the common Selenium launch/connection,
  portable-state restoration, raw-handle access, and constructor gaps.
- `js/tests/e2e/engine-matrix.e2e.test.js` exercises each native JavaScript
  engine with both launch modes, native handles, input, clicking, PDF, and cleanup.
- `python/tests/e2e/test_engine_matrix.py` exercises native Playwright and
  Selenium with both launch modes, callable probes, hidden text, input, clicking,
  and native PDF bytes/file output.
- Rust verifies the Selenium aliases and exercises its native WebDriver
  common launcher in `rust/tests/webdriver.rs`.
- `node tests/cli-contract/check.mjs` exercises all nine language/engine
  combinations with one shared command script and generic native handles.
- The Browser Parity workflow runs these browser contracts alongside the
  existing native engine, generated API, snapshot, and trace tests.
