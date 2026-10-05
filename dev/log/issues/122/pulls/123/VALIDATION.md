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
| Run parallel Rust Safari fixtures with a coarse process wall clock                         | Fixtures share timestamp-only homes; one test deletes another test's source   | Existing Safari integration suite and retained bounded clock probe                           |

Review also reproduced Python accepting short/long password CSV records that
the JS/Rust parsers reject. Two minimal failing cases now raise a record-width
error with a line number; retained source-byte checks cover all three parsers.

The Safari fixture generator and real Chromium acceptance script are retained
under `experiments/issue-122/`. They use synthetic data and never read an actual
user profile. All source fixture imports verify retained source contents.

## Local checks

| Check                                                             | Result                                                                                |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| JS `npm run check`                                                | ESLint, Prettier and no new duplication clones pass                                   |
| JS `npm test`                                                     | 1,559 pass, zero skipped                                                              |
| Python Ruff check/format and `mypy src`                           | Pass; 168 source files type checked                                                   |
| Python `pytest`                                                   | 1,149 pass, eight existing real-browser tests gated by `RUN_E2E`                      |
| Rust format, Clippy all targets/all features with warnings denied | Pass                                                                                  |
| Rust `cargo test --locked`                                        | 709 pass across unit/integration/doc suites; 15 existing browser tests ignored        |
| Rust `cargo test --locked --all-features`                         | 709 pass, zero failures; 15 existing browser tests ignored                            |
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

## Fresh CI investigation

The first pushed commit was `8ee1756b150d30efea226e7b555569d0571ec28b`, committed
at 14:18:27 UTC. All ten workflows started at 14:18:46 UTC with that exact SHA.
Logs were downloaded for each failed workflow before investigating:

- [Python run 37323679634](https://github.com/link-foundation/browser-commander/actions/runs/37323679634):
  `ci-logs/python-37323679634.log:3832` reports PermissionError for
  `/root/google-chrome/Default/Local State`. The existing path-resolution test
  now constructs its synthetic profile beneath `tmp_path`, without probing the
  runner's protected `/root` directory or suppressing actual access errors.
- [Rust run 37323679609](https://github.com/link-foundation/browser-commander/actions/runs/37323679609):
  `ci-logs/rust-37323679609.log:1500` reports `real_browser.rs` at 1,004 lines,
  exceeding Rust's separate 1,000-line gate. The early CDP-family guard is moved
  into the existing system-browser helper; the launcher is now 997 lines and
  its existing early-rejection tests retain the same behavior.
- [CodeQL check 111809191596](https://github.com/link-foundation/browser-commander/runs/111809191596):
  the retained `ci-logs/codeql-111809191596-annotations.json` identifies constant
  cryptographic passwords in `migration/tests/passwords.rs:26` and
  `migration/tests/safari.rs:20`. These added tests now use fresh OS-generated
  AES keys through the existing native `random_bytes` helper; encryption and
  decryption still round-trip without hard-coded cryptographic passwords.

The subsequent PR check status is verified against the subsequent pushed SHA;
the earlier passing jobs alone do not establish that the fixes pass CI.

The next head was `aaca08f5f44666b9e2479d48424e6b23c8908bb3`, committed at
14:41:09 UTC; all ten workflows started at 14:41:23 UTC. Python, repository
quality and Security passed, including the aggregate CodeQL check. The
[Rust macOS job](https://github.com/link-foundation/browser-commander/actions/runs/37326723364/job/111820775375)
failed: `ci-logs/rust-macos-111820775375.log:2174` reports a missing Safari
cookie database at `tests/safari_cookies.rs:145`. The full downloaded run log
records the same error at `ci-logs/rust-37326723364.log:4732`. Linux and Windows
Rust tests passed on that head; only the macOS test caused the workflow failure.

The fixture helper constructed home names from PID and time without reserving
them. Parallel tests with equal timestamps could share, modify and remove one
another's home. The retained Linux probe coarsens only the child process's wall
clock, keeps monotonic time unchanged, limits the test process to 512 MiB, and
runs a finite ten suites. It reproduced the same missing-database error before
the fix in 10/10 runs; after atomic directory reservation, 10/10 pass:

```sh
python experiments/issue-122/safari_fixture_race.py --runs 10 \
  --log /tmp/safari-fixture-race.log
```

Other profile allocators were checked: the production launcher and migration
snapshot helpers already reserve directories atomically. Their behavior stays
intact; the colliding shared-prefix Safari fixture helper now uses a counter and
exclusive `create_dir`, retrying existing names without deleting them.

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
