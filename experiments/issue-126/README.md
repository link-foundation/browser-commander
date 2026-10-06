# Issue 126 reproduction and validation

The original catalogue listed Safari as an import source without a control
protocol or driver executable. The new JavaScript/Python/Rust catalogue
regressions failed before adding those fields (`js-before.log`,
`python-before.log`, `rust-before.log`, kept locally and ignored by Git).
JavaScript also rejected Safari at the native driver selection step.

Regression commands:

```sh
cd js && node --test tests/unit/browser/safari.test.js tests/unit/browser/webdriver.test.js
cd python && pytest tests/unit/browser/test_safari_webdriver.py
cd rust && cargo test --test safari_webdriver
```

Tests verify bundled driver selection, canonical Technology Preview capability,
common/real/CLI routing, cookie conversion and restoration, cleanup, setup
messages, typed unsupported errors and asynchronous JavaScript evaluation.
The macOS Safari workflow runs local-page smokes in all three languages;
`docs/safari-webdriver.md` documents how to run them manually.

The initial PR security run 37496961064, created 2026-10-06T16:35:56Z against
f7c308255694017fc66a43563d6a181f13b00bf1, failed npm audit.
The preserved local `ci-logs/security-37496961064.log` identifies vulnerable
shell-quote at lines 3917–3923, advisory GHSA-pqg4-j6r4-53mv. Updating only the
transitive lock entry to 1.11.0 makes the same audit command pass.

Local validation on 2026-10-06: JavaScript 1,603 passed / 1 skipped; Python
1,207 passed / 13 skipped; Rust all-feature unit, integration and 20 doc tests
passed. JavaScript lint/format/duplication, Python Ruff/format/mypy, Rust fmt
and all-target/all-feature Clippy, generated documentation, shared catalogue
consistency and the high-severity npm audit passed. Safari smokes are opt-in
and require macOS; the new workflow provides that verification.
