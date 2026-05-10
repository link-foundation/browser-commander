# Issue 51 Case Study: JavaScript and Rust Engine Parity

## Request

Issue 51 asked for a parity review across JavaScript and Rust, with explicit support for Playwright and Puppeteer from both languages, generated documentation, GitHub Pages output, comparison against the Link Foundation language templates, and a case study.

## Findings

- JavaScript already supported Playwright and Puppeteer directly through the official Node.js packages.
- Rust accepted `playwright` and `puppeteer` as strings, but parsed them as aliases for `Chromiumoxide` and `Fantoccini`. That preserved some input compatibility but did not preserve engine identity.
- Rust had a native Chromiumoxide launcher, while Fantoccini launch remained intentionally unimplemented as a managed WebDriver launcher.
- The root README and per-language READMEs did not document the real support boundaries or generated API docs workflow.

## Online Research

- [Playwright supported languages](https://playwright.dev/docs/languages) list JavaScript/TypeScript, Python, Java, and .NET as official language bindings. Rust is not listed there, so direct native Rust Playwright support would require an unofficial crate or a bridge.
- [Playwright `launchPersistentContext`](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context) supports persistent user data directories and launch options such as `args`, `headless`, `slowMo`, and `chromiumSandbox`.
- [Puppeteer documentation](https://pptr.dev/) describes Puppeteer as a JavaScript library for controlling Chrome or Firefox over the DevTools Protocol or WebDriver BiDi.
- [Puppeteer `LaunchOptions`](https://pptr.dev/api/puppeteer.launchoptions) includes `args`, `headless`, and related browser launch configuration.
- [chromiumoxide docs](https://docs.rs/chromiumoxide/latest/chromiumoxide/) describe a high-level Rust API for the Chrome DevTools Protocol.
- [fantoccini docs](https://docs.rs/fantoccini/latest/fantoccini/) describe a Rust API for interacting with browsers through WebDriver.

## Template Comparison

The issue called out these references:

- `link-foundation/js-ai-driven-development-pipeline-template`
- `link-foundation/rust-ai-driven-development-pipeline-template`
- `link-foundation/python-ai-driven-development-pipeline-template`
- `link-foundation/csharp-ai-driven-development-pipeline-template`

Relevant patterns compared:

| Template pattern                     | Browser Commander state                                                       | Action in this PR                                                                                                    |
| ------------------------------------ | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Release metadata for package changes | JS uses Changesets; Rust uses `changelog.d` fragments                         | Added one JS changeset and one Rust changelog fragment.                                                              |
| Generated docs in CI/CD              | No combined JS/Rust docs workflow existed                                     | Added `.github/workflows/docs.yml` to build JSDoc and `cargo doc`, upload an artifact, and deploy Pages from `main`. |
| CI timeouts                          | Existing JS/Rust/Python jobs already use explicit timeouts                    | New docs workflow uses job timeouts.                                                                                 |
| Docs-only handling                   | Existing change detection skips changelog/changeset checks for docs-only work | Kept the established repository-specific change detection instead of replacing workflows wholesale.                  |
| Link checking and file-size checks   | Some template checks are not fully present in this repository                 | Documented for follow-up; not required to solve the engine parity bug.                                               |

## Implementation

- Added first-class Rust `EngineType::Playwright` and `EngineType::Puppeteer` variants.
- Preserved existing Rust aliases for `chromiumoxide`, `cdp`, `fantoccini`, and `webdriver`.
- Added `NodeBridgePage`, a Rust `EngineAdapter` that starts Node.js and speaks a line-delimited JSON protocol to a small bridge script.
- Added bridge operations for launch, navigation, selector queries, visibility, click, fill, typing, evaluate, screenshot, PDF, media color scheme setup, keyboard operations, and cleanup.
- Added `LaunchOptions::playwright()`, `LaunchOptions::puppeteer()`, `LaunchOptions::engine(...)`, `node_executable(...)`, and `node_working_dir(...)`.
- Updated the Rust CLI `launch` command with `--engine <name>`.
- Added JavaScript JSDoc generation with `npm run docs:api`.
- Added combined documentation workflow output and GitHub Pages deployment from `main`.
- Added root README, JavaScript README, Rust README, and feature parity documentation updates.

## Reproduction Test

Before the fix, a Rust parser test expecting `playwright` and `puppeteer` to round-trip as their own engine names failed because both strings were aliases to other backends.

After the fix:

```text
cargo test engine_type_from_str
cargo test launch_options
cargo test launch_playwright_reports_missing_node_executable
```

The targeted tests pass and verify that engine identity is preserved and that missing Node executables produce a clear launch error.

## Remaining Follow-Ups

- Add a managed Fantoccini/WebDriver launcher when the project is ready to own WebDriver process management.
- Add optional Rust bridge smoke tests that run only when Node packages and browser binaries are available in CI.
- Consider adopting a dedicated link-check workflow from the JavaScript template if repository-wide external link health becomes a release gate.
