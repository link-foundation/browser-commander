# CI signal classification

This audit distinguishes a real failure, a warning-only false negative, an
intentional visible degradation, expected test output, and a legitimate skip.
Text such as `DEPRECATED` inside a downloaded tool schema is not itself a CI
warning.

| Workflow / signal | Classification | Disposition |
| --- | --- | --- |
| JS macOS staged bytes `actual: 1`, `expected: 2` | Real failure | Quiet-period algorithm and regression test. |
| JS `DEP0137` / descriptors closed by GC on all OSes | Warning-only real defect | Explicit lifecycle cleanup; deprecations now throw. |
| JS/docs/quality `prebuild-install@7.1.3` | Warning-only real defect | better-sqlite3 13, Node 22, reviewed npm scripts. |
| Test cases printing navigation/stop warning glyphs | Expected scenario output | They exercise graceful recovery; no GitHub annotation or unhandled warning. |
| JS Windows six skipped tests | Legitimate | POSIX mode bits and absolute-path rules are not available on Windows; exact tests are archived in `research/js-skips.txt`. |
| Python duplicate Scriv version | Real failure | Idempotent retry preserves newer fragments. |
| Python PyPI `invalid-publisher` | Real external blocker | Maintainer configuration required; keep hard failure. |
| Python `download-artifact@v7` Node `DEP0005` | Warning-only real defect | v8 plus repository policy. |
| Python mypy unused Playwright/Selenium overrides | False-positive note | Suppressed only for scripts-only pass. |
| Python Windows three skips | Legitimate | XDG, POSIX/root permission semantics; archived in `research/python-skips.txt`. |
| Codecov token absent | Intentional visible degradation | Tests and local coverage gate still run; notice remains until optional secret is configured. |
| Recovered main-push race | Intentional warning | Retry succeeded; visibility is necessary for concurrent release diagnosis. |
| Rustdoc unresolved links with success | False-negative workflow | Correct links and `-D warnings`. |
| CodeQL archival Rust “no manifest” | Warning-only scope defect | Ignore immutable snapshots in no-build analysis. |
| CodeQL live Rust macro expansion | Warning-only real defect | One common assertion outside platform selection. |
| Broken Links summary notice | Informational | Zero errors and `failIfEmpty`; no change. |
| Release/deploy jobs skipped on PR/nonmatching paths | Legitimate | Event/path conditions; pipeline-status validates allowed skips. |
| Tool help/schema containing warning/error words | Lexical false positive | Excluded after contextual inspection; no executable warning. |

The full raw scan is retained in `research/log-signal-scan.txt`; the table is
the contextual result, not a grep-only conclusion.
