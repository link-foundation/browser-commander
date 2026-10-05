# Implemented changes: reproduction and validation

Validated in a Linux workspace on 2026-10-05. This evidence covers the implemented
changes; it does not complete parent #122 or its five children. The complete
[83-requirement inventory](PLAN.md) distinguishes implemented, partial and pending
requirements. Release fragments prepare the next release without manual version
changes.

## Minimum reproductions

| Reproduction                                                                              | Failure before the change                                                    | Native regression coverage                                                                    |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Migrate Chromium History with `domains=['github.com']` and a second `notgithub.com` visit | Unrelated URL/visit rows remain in the target                                | Shared history SQL fixture; JS/Python domain-isolation tests and Rust migration history tests |
| Migrate Login Data containing selected, unrelated and app-bound v20 passwords             | Unselected logins and unreadable source ciphertext remain copied             | JS/Python domain-isolation tests and Rust password migration tests                            |
| Read binary/XML Safari bookmarks, repeated history visits and a quoted UTF-8/BOM CSV      | Safari classes have unsupported reports                                      | Shared `tests/fixtures/safari-data` and native Safari data tests in all three languages       |
| Back up an exclusively locked SQLite source                                               | Python returns a live-file copy; Rust invokes the reader after failed backup | Native SQLite snapshot tests and existing runtime snapshot regression tests                   |
| Select Firefox preferences/extensions                                                     | Zero counts without an explicit unsupported-class reason                     | Native migration report tests in all three languages                                          |
| Launch a newly created target beneath a symlink to a protected profile root               | JavaScript permits it; Rust leaves the alias unresolved                      | Native catalogue/protection tests; Python's existing behavior already passes                  |
| Request Safe Storage credentials for a declared catalogue alias                           | Python/Rust reject `google-chrome` despite its catalogue identity            | Actual credential readers exercised with every declared identity/alias in all three languages |
| Deny the macOS Keychain request or return an empty result                                 | Missing service-specific retry instructions                                  | Injected native credential-reader tests name the service, Keychain access and `refresh=true`  |

The Safari fixture generator and real Chromium acceptance script are retained
under `experiments/issue-122/`. They use synthetic data and never read an actual
user profile. All source fixture imports verify retained source contents.

## Local checks

| Check                                                             | Result                                                                                |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| JS `npm run check`                                                | ESLint, Prettier and no new duplication clones pass                                   |
| JS `npm test`                                                     | 1,558 pass, zero skipped                                                              |
| Python Ruff check/format and `mypy src`                           | Pass; 168 source files type checked                                                   |
| Python `pytest`                                                   | 1,147 pass, eight existing real-browser tests gated by `RUN_E2E`                      |
| Rust format, Clippy all targets/all features with warnings denied | Pass                                                                                  |
| Rust `cargo test --locked`                                        | 708 pass across unit/integration/doc suites; 15 existing browser tests ignored        |
| Rust `cargo test --locked --all-features`                         | 708 pass, zero failures; 15 existing browser tests ignored                            |
| Full-repository Secretlint and root JavaScript lint               | Pass                                                                                  |
| Shared asset byte comparison                                      | Catalogue, history schema and capability declarations identical in all three packages |
| Generated browser/migration matrix freshness                      | Pass                                                                                  |
| Required documentation, workflow policy and file line limits      | Pass                                                                                  |
| Git staged diff whitespace                                        | Pass; the CSV fixture intentionally preserves CRLF records and quoted LF bytes        |
| npm package and built Python wheel contents                       | Native Safari readers, history schema and capability JSON included                    |

Rust builds run serially with debug information disabled to keep compiler memory
bounded in this workspace. The CI-equivalent all-features test also passes.
Large local logs are saved under `/tmp/issue-122-*`; downloaded failed
workflow logs go under `ci-logs/`. PR status records CI results against the actual
pushed SHA rather than the original prepared-branch runs.

## Real runtime acceptance and remaining limits

```sh
BROWSER_COMMANDER_CHROMIUM_EXECUTABLE=/home/box/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome \
  node experiments/issue-122/chromium_acceptance.mjs
```

The installed Linux Chromium retains both translated Safari bookmark URLs,
including a reading-list URL, and both matching history visits after opening and
closing the persistent profile. Password fixture decryption verifies target-key
encryption; it does not establish real browser password-store acceptance.
macOS Safari/STP and Windows runtime acceptance have not been run here.

Firefox/WebKit target writers, whole-profile migration, the additional storage
classes and automatic installed-browser protocol routing remain unimplemented.
Profile-wide protected-source aggregation and discovery of domains across every
implemented site store also remain unresolved. The native matrix declares these
limits. PR #123 remains draft and contains no issue-closing keywords while those
requirements are incomplete.
