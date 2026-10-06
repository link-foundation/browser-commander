# Browser Commander

A universal browser automation library with a unified API across multiple browser engines and programming languages. The key focus is on **stoppable page triggers** - ensuring automation logic is properly mounted/unmounted during page navigation.

## Available Implementations

| Language              | Package                                                              | Status                                                                                                        |
| --------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| JavaScript/TypeScript | [browser-commander](https://www.npmjs.com/package/browser-commander) | [![npm](https://img.shields.io/npm/v/browser-commander)](https://www.npmjs.com/package/browser-commander)     |
| Rust                  | [browser-commander](https://crates.io/crates/browser-commander)      | [![crates.io](https://img.shields.io/crates/v/browser-commander)](https://crates.io/crates/browser-commander) |
| Python                | [browser-commander](python/)                                         | PyPI release pending; [install from source](python/README.md#installation)                                    |

## Engine Support

| Language              | Primary engines                                             | Notes                                                                                                  |
| --------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| JavaScript/TypeScript | Playwright, Puppeteer, Selenium                             | Official native Node APIs through the common launcher and commander.                                   |
| Rust                  | Chromiumoxide, Playwright, Puppeteer, Selenium / Fantoccini | Native CDP, native typed Playwright driver, native WebDriver; Puppeteer uses the explicit Node bridge. |
| Python                | Playwright, Selenium; typed Puppeteer bridge                | Official native Python engines; Puppeteer is available through the explicit typed stdio bridge.        |

All three CLIs support Playwright, Puppeteer, and Selenium. See
[the engine/API matrix](docs/engine-support.md) for native defaults, optional
bridges, browser coverage, and protocol limitations.

See [docs/feature-parity.md](docs/feature-parity.md) for the cross-language feature matrix and [docs/case-studies/issue-51/README.md](docs/case-studies/issue-51/README.md) for the implementation notes.

All three implementations can attach to a running Chrome-family browser over
CDP or find and start an installed Chrome, Edge, Brave, or Chromium with a
safe, dedicated automation profile before attaching. Use
`launchRealBrowser()` in JavaScript and `launch_real_browser()` in Python or
Rust.

All implementations also expose installed-browser profile discovery and local
cookie import for Chrome, Edge, Brave, Chromium, and Firefox. Cookie values are
returned in the automation-engine shape and cached locally with owner-only
permissions so platform credential stores are touched at most once per TTL.

## Importable Browser Sources

Imports read from a shared, data-driven catalogue
([`js/src/browser/browser-sources.json`](js/src/browser/browser-sources.json)),
which the Python and Rust packages ship byte-identical, so the table below
describes every language at once. The matrix is generated from that catalogue
by `scripts/generate-browser-support.mjs` and checked in CI; add a browser to
the JSON and regenerate to change it. `browser: 'default'` (or `'auto'`)
resolves the operating-system default browser to one of these ids. When a
migration is scoped to `domains` and the default browser holds no cookies for
them, it imports from the installed profile that holds the most instead and
reports which one with a `default-browser-fallback` warning.

<!-- browser-support:generated:begin -->

| Browser                   | Family    | macOS | Windows | Linux |
| ------------------------- | --------- | ----- | ------- | ----- |
| chrome                    | Chromium  | Yes   | Yes     | Yes   |
| chrome-beta               | Chromium  | Yes   | Yes     | Yes   |
| chrome-dev                | Chromium  | Yes   | Yes     | Yes   |
| chrome-canary             | Chromium  | Yes   | Yes     | —     |
| chromium                  | Chromium  | Yes   | Yes     | Yes   |
| edge                      | Chromium  | Yes   | Yes     | Yes   |
| edge-beta                 | Chromium  | Yes   | Yes     | Yes   |
| edge-dev                  | Chromium  | Yes   | Yes     | Yes   |
| brave                     | Chromium  | Yes   | Yes     | Yes   |
| vivaldi                   | Chromium  | Yes   | Yes     | Yes   |
| opera                     | Chromium  | Yes   | Yes     | Yes   |
| opera-gx                  | Chromium  | Yes   | Yes     | Yes   |
| yandex                    | Chromium  | Yes   | Yes     | Yes   |
| arc                       | Chromium  | Yes   | Yes     | —     |
| firefox                   | Firefox   | Yes   | Yes     | Yes   |
| firefox-developer         | Firefox   | Yes   | Yes     | Yes   |
| firefox-nightly           | Firefox   | Yes   | Yes     | Yes   |
| librewolf                 | Firefox   | Yes   | Yes     | Yes   |
| waterfox                  | Firefox   | Yes   | Yes     | Yes   |
| zen                       | Firefox   | Yes   | Yes     | Yes   |
| floorp                    | Firefox   | Yes   | Yes     | Yes   |
| safari                    | Safari    | Yes   | —       | —     |
| safari-technology-preview | Safari    | Yes   | —       | —     |
| whale                     | Chromium  | Yes   | Yes     | Yes   |
| 360se                     | Chromium  | —     | Yes     | —     |
| 360chrome                 | Chromium  | —     | Yes     | —     |
| qq                        | Chromium  | —     | Yes     | —     |
| sogou                     | Chromium  | —     | Yes     | —     |
| duckduckgo                | detection | Yes   | Yes     | —     |
| tor                       | Firefox   | Yes   | Yes     | Yes   |
| edge-canary               | Chromium  | Yes   | Yes     | —     |

| Browser                   | macOS control   | Windows control | Linux control   | Source         | Protect roots |
| ------------------------- | --------------- | --------------- | --------------- | -------------- | ------------- |
| chrome                    | CDP             | CDP             | CDP             | chromium       | Yes           |
| chrome-beta               | CDP             | CDP             | CDP             | chromium       | Yes           |
| chrome-dev                | CDP             | CDP             | CDP             | chromium       | Yes           |
| chrome-canary             | CDP             | CDP             | —               | chromium       | Yes           |
| chromium                  | CDP             | CDP             | CDP             | chromium       | Yes           |
| edge                      | CDP             | CDP             | CDP             | chromium       | Yes           |
| edge-beta                 | CDP             | CDP             | CDP             | chromium       | Yes           |
| edge-dev                  | CDP             | CDP             | CDP             | chromium       | Yes           |
| brave                     | CDP             | CDP             | CDP             | chromium       | Yes           |
| vivaldi                   | CDP             | CDP             | CDP             | chromium       | Yes           |
| opera                     | CDP             | CDP             | CDP             | chromium       | Yes           |
| opera-gx                  | CDP             | CDP             | CDP             | chromium       | Yes           |
| yandex                    | CDP             | CDP             | CDP             | chromium       | Yes           |
| arc                       | CDP             | CDP             | —               | chromium       | Yes           |
| firefox                   | WebDriver setup | WebDriver setup | WebDriver setup | firefox        | Yes           |
| firefox-developer         | WebDriver setup | WebDriver setup | WebDriver setup | firefox        | Yes           |
| firefox-nightly           | WebDriver setup | WebDriver setup | WebDriver setup | firefox        | Yes           |
| librewolf                 | WebDriver setup | WebDriver setup | WebDriver setup | firefox        | Yes           |
| waterfox                  | WebDriver setup | WebDriver setup | WebDriver setup | firefox        | Yes           |
| zen                       | WebDriver setup | WebDriver setup | WebDriver setup | firefox        | Yes           |
| floorp                    | WebDriver setup | WebDriver setup | WebDriver setup | firefox        | Yes           |
| safari                    | WebDriver       | —               | —               | safari         | Yes           |
| safari-technology-preview | WebDriver       | —               | —               | safari         | Yes           |
| whale                     | CDP             | CDP             | CDP             | chromium       | Yes           |
| 360se                     | —               | CDP             | —               | chromium       | Yes           |
| 360chrome                 | —               | CDP             | —               | chromium       | Yes           |
| qq                        | —               | CDP             | —               | chromium       | Yes           |
| sogou                     | —               | CDP             | —               | chromium       | Yes           |
| duckduckgo                | unsupported     | unsupported     | —               | detection only | Yes           |
| tor                       | WebDriver setup | WebDriver setup | WebDriver setup | firefox        | Yes           |
| edge-canary               | CDP             | CDP             | —               | chromium       | Yes           |

<!-- browser-support:generated:end -->

The first table records source-root availability; the second records control
routes and profile protection. Firefox forks require explicit WebDriver setup;
Safari and Technology Preview use native W3C WebDriver through the real/common
launchers and CLI. See [Safari setup, isolated state and supported commands](docs/safari-webdriver.md).
DuckDuckGo has detection and protection entries only, with no import writer.

Safari and Safari Technology Preview are **migration sources** on macOS.
They read the conventional container `Cookies.binarycookies`, falling back to
the legacy store. Import supports the existing Chromium target; the table above
describes source availability, not full-profile or target-engine support.
Native imports translate bookmarks and history and encrypt explicitly supplied
Safari/Passwords CSV exports for Chromium targets. Discovery recognizes named
Safari profiles and prefers modern WebKit cookie-store paths. See the generated
[source × target × class matrix](docs/profile-migration.md) for exact limits.

```sh
browser-commander cookies sources --domain github.com
browser-commander profile migrate --from safari --include cookies --domain github.com --to ./imported-profile
```

An installed Safari system default also works with `--from default` or `auto`.
Cookie values are unencrypted in this format; source listings decode only domain
strings and return counts, while import decodes values. Cookie flags and Cocoa
expiry timestamps are preserved. The format has no SameSite attribute, so imported
cookies use `Lax` and the migration report warns `safari-samesite-unavailable`.
Unsupported Safari classes are reported as skipped, including passwords with
`safari-password-export-required`: use Safari or the Passwords app's Export
Passwords to CSV, then pass `--password-csv ./export.csv`. Protected Safari paths
produce Full Disk Access guidance identifying the terminal/app running Browser
Commander and linking to the macOS privacy settings.

The remaining requirements of [#114](https://github.com/link-foundation/browser-commander/issues/114)
are tracked explicitly: [Safari non-cookie stores and modern profiles (#117)](https://github.com/link-foundation/browser-commander/issues/117),
[Firefox/WebKit targets and full clones (#118)](https://github.com/link-foundation/browser-commander/issues/118),
[additional data classes (#119)](https://github.com/link-foundation/browser-commander/issues/119),
and [platform diagnostics and the source × target × class matrix (#120)](https://github.com/link-foundation/browser-commander/issues/120).
Import remains opt-in; a fresh, clean profile remains the default.

## Core Concept: Page State Machine

Browser Commander manages the browser as a state machine with two states:

```
+------------------+                      +------------------+
|                  |   navigation start   |                  |
|  WORKING STATE   | -------------------> |  LOADING STATE   |
|  (action runs)   |                      |  (wait only)     |
|                  |   <-----------------  |                  |
+------------------+     page ready       +------------------+
```

**LOADING STATE**: Page is loading. Only waiting/tracking operations are allowed. No automation logic runs.

**WORKING STATE**: Page is fully loaded (30 seconds of network idle). Page triggers can safely interact with DOM.

## Page Trigger Lifecycle

The library provides a guarantee when navigation is detected:

1. **Action is signaled to stop** (AbortController.abort())
2. **Wait for action to finish** (up to 10 seconds for graceful cleanup)
3. **Only then start waiting for page load**

This ensures:

- No DOM operations on stale/loading pages
- Actions can do proper cleanup (clear intervals, save state)
- No race conditions between action and navigation

## Getting Started

For installation and usage instructions, see the documentation for your preferred language:

- **JavaScript/TypeScript**: See [js/README.md](js/README.md)
- **Rust**: See [rust/README.md](rust/README.md)
- **Python**: See [python/README.md](python/README.md)

## Testing Layer

The JavaScript package now exposes `browser-commander/tests`, a
`test-anywhere`-based browser test layer with Playwright/Puppeteer engine
matrices, fixture cleanup, retries, failure artifacts, historical duration
tracking, longest-first ordering, and balanced shard planning. See
[js/README.md#browser-commander-tests](js/README.md#browser-commander-tests) and
[js/examples/browser-commander-tests.example.js](js/examples/browser-commander-tests.example.js).

## Architecture

See [js/src/ARCHITECTURE.md](js/src/ARCHITECTURE.md) for detailed architecture documentation.

## Generated Documentation

The Documentation workflow builds JavaScript JSDoc output and Rust `cargo doc` output into one artifact. On `main`, the same artifact is published with GitHub Pages when Pages is enabled for the repository.

Local commands:

```bash
cd js && npm run docs:api
cd rust && cargo doc --no-deps --all-features
```

## Local Quality Gates

The same checks CI runs are available as git pre-commit hooks, so a commit that
would fail the pipeline fails on the machine that wrote it instead. Every hook in
[`.pre-commit-config.yaml`](.pre-commit-config.yaml) runs the exact command its
workflow runs, and `js/tests/unit/scripts/pre-commit-config.test.js` fails if the
two ever drift apart.

Install once per clone:

```bash
pip install pre-commit
pre-commit install
```

Run everything by hand, without committing:

```bash
pre-commit run --all-files
```

A hook only runs when a file it covers is staged: editing `python/` never waits
for Clippy. A single slow hook can be skipped for one commit with
`SKIP=rust-clippy git commit ...`, and CI will still run it.

## License

[UNLICENSE](LICENSE)
