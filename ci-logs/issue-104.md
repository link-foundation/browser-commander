# Exactly the same features in every language: full Playwright/Puppeteer/WebDriver coverage in Rust and Python, and every engine reachable through a CLI via command-stream
## Requirement
Every programming language (JavaScript/TypeScript, Rust, Python) supports **exactly the same features**. Where a language has no native binding for an engine, it still gets the **full** engine API, directly or indirectly. Every engine and driver is also reachable through a **CLI interface**, and the library drives those CLIs through [command-stream](https://github.com/link-foundation/command-stream) (npm `command-stream`, crate `command-stream` 1.1.0).

## Current state (browser-commander 0.20.0)
- `docs/feature-parity.md` lists **17 rows** marked "Not implemented"/"Not supported". Among them:
  - Portable traces (all 12 trace features) are JS-only; Rust and Python have none.
  - Selenium is not in Rust.
  - Fantoccini has no managed launch.
  - Downloads are unsupported through the Rust Playwright/Puppeteer bridge.
  - Portable cookie/localStorage state is missing for three engines.
- The Rust Playwright/Puppeteer support is a hand-written line-delimited JSON bridge (`rust/src/browser/node_engine_bridge.js`) with **27 operations**: `bringToFront click close connect count evaluate fill getAttribute goto inputValue isEnabled isVisible keyboardDown keyboardPress keyboardType keyboardUp launch pdf querySelector querySelectorAll screenshot scrollIntoView textContent typeText url waitForNavigation waitForSelector`. There are no browser contexts, network routing/interception, frames, dialogs, cookies/storage state, CDP sessions, tracing, downloads, workers, emulation or permissions.
- CLIs: the npm package has no `bin`, Python has no console script, and the Rust binary (`src/main.rs`) only does `launch`.
- Subprocesses (browsers, the Node bridge, credential tools) are spawned with `child_process`/`tokio::process` directly, not through command-stream.

## Proposed approach
**Playwright in every language, with full API coverage.** Use Playwright's own architecture: the official Python, Java and .NET bindings are thin JSON-RPC clients of the **`playwright run-driver`** CLI over stdio, so feature parity comes from upstream. Rust gets the same by adopting or embedding [`playwright-rs`](https://github.com/padamson/playwright-rust) (0.19, "a thin JSON-RPC client to the same server the official bindings use … All Playwright Python classes and methods are implemented"), or by generating a client from Playwright's `protocol.yml`. The driver process is started through command-stream.

**Puppeteer in every language, with full API coverage.** Puppeteer has no driver protocol. Replace the 27-operation bridge with a **generic handle-based RPC bridge** (`browser-commander bridge --engine puppeteer --stdio`): remote object handles, method invocation on any handle, event subscription and binary transfer. That covers every current and future public method, and typed Rust/Python wrappers are generated from Puppeteer's TypeScript declarations. The same generic bridge serves as a fallback for any Node-only engine.

**WebDriver/Selenium and WebDriver BiDi in every language.** Rust: `fantoccini` with managed `chromedriver`/`geckodriver` launch, started through command-stream. JS: `selenium-webdriver`. Python: `selenium`. Add BiDi for Firefox.

**Raw CDP in every language.** Rust already has chromiumoxide/raw CDP. Expose the equivalent `cdpSession` API in JS and Python.

**One CLI, identical in all languages.** Ship a `browser-commander` CLI in the npm package (`bin`), the crate (binary) and the Python package (console script), all with the same commands:
- `launch`, `open`, `goto`, `click`, `fill`, `eval`, `screenshot`, `pdf`;
- `trace start|stop|view`, `cookies import`, `profile migrate`, `doctor` (the parity check from #103);
- **`serve --stdio`**: a JSON-RPC mode, so any language or shell script can drive any engine by starting one CLI through command-stream.

**command-stream everywhere.** All subprocesses go through command-stream in JS and Rust: browsers, `playwright run-driver`, the Node bridge, `chromedriver`/`geckodriver`, and keychain/`security`/`icacls` calls. That gives consistent streaming output, cancellation, errexit and logging. command-stream has no Python port yet. Either request one in link-foundation/command-stream, or wrap Python's `subprocess` behind the same small interface, and note the choice in the parity doc.

## Acceptance
- `docs/feature-parity.md` is **generated from tests**, not hand-written. CI fails if a feature is supported in one language and missing in another without an entry in `limitations.json` that gives a technical reason.
- **API coverage tests:**
  - Rust and Python can reach every public Playwright class and method (checked against `protocol.yml`).
  - Every public Puppeteer method is reachable through the bridge (checked against its `.d.ts`).
  - The main WebDriver commands work in all three languages.
- **CLI tests:** the same command script produces the same results through the JS, Rust and Python CLIs, and a Rust test and a JS test each drive the CLI through command-stream.
- Real-browser parity (#101, #103) and migration/attach (#102) are available identically in all languages.
