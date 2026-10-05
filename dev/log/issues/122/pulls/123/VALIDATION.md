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
| Resolve `auto` for `github.com` when the default holds `notgithub.com` and another browser holds the actual domain | Substring metadata picks the default; exact migration then imports no cookies | Native discovery and real migration regressions; SQLite family counts and Safari metadata tests |

Review also reproduced Python accepting short/long password CSV records that
the JS/Rust parsers reject. Two minimal failing cases now raise a record-width
error with a line number; retained source-byte checks cover all three parsers.

The Safari fixture generator and real Chromium acceptance script are retained
under `experiments/issue-122/`. They use synthetic data and never read an actual
user profile. All source fixture imports verify retained source contents.

The source-selection regressions failed first in every native implementation.
SQLite discovery also counted `%` and `_` as wildcard patterns; Safari counted
`hub.com` and `github.co` inside `github.com`. Discovery now shares migration's
whole-host/subdomain matcher, including case and trailing-dot normalization.
Public cookie readers retain their documented substring filter. Tests verify
that automatic migration selects the actual holder, returns its cookie, never
exposes cookie values in listing results and preserves source database bytes.

Yandex cookie reading already uses the native Chromium reader. Added Linux
fixtures exercise the declared `yandex-browser` alias, installed-profile
discovery, version-24 host-bound cookie decryption and unchanged source bytes in
JS, Python and Rust. They establish this synthetic source case; they do not
claim installed Yandex or Windows/macOS runtime acceptance. The Ya Passman
password-format limitation remains separately reported.

Final review reproduced another regression in all three native orchestrators:
when a Yandex profile held both `Ya Passman Data` and a supported `Login Data`,
the new diagnostic returned early and skipped the supported passwords as well.
Native regressions first returned zero instead of one. Dispatch now continues
for the separate supported store, verifies target-key password decryption and
unchanged source bytes, and retains the specific unsupported-store report.
Profiles with only Ya Passman Data still return before credential lookup.
Before/after logs are retained at `/tmp/issue-122-yandex-coexisting-*.log`.

The complete Python test run also exposed an existing cancellation-fixture race:
the first run reported `ValueError: invalid literal for int() with base 10: ''` at
`tests/unit/utilities/test_subprocess.py:145`, where an empty PID was read after
the child created the file but before its write completed. The fixture now
renames a completed temporary PID file atomically; cancellation behavior and
the test's finite readiness loop stay intact.

Native regressions for an unreadable SafariTabs database first failed with
`no such table: bookmarks` in every language: browser-wide discovery aborted
before returning readable Safari cookies or Chromium profiles. Discovery now
returns the catalogue diagnostic as a `Profiles` error entry, keeps readable
profiles, and carries the error through cookie-source domain filtering without
manufacturing cookie counts. The fixture verifies unchanged catalogue bytes.
Before/after logs are retained at `/tmp/issue-122-profile-discovery-*.log`.

Upstream Login Data review identified additional copied notes, security records,
statistics and opaque sync metadata. The shared
`tests/fixtures/password-domain-isolation.sql` first failed in all three native
implementations: excluded, undecryptable-parent, dangling and null parent
references remained in the target. The retained native tests now verify linked
record cleanup, exact statistics filtering, UTF-8 note re-keying with dates and
confidential flags preserved, explicit sync/unknown-table warnings, removed
copied bytes after vacuum and unchanged source bytes. The unfiltered variant
preserves both sites' records and unknown metadata while re-keying both notes.
Before/after logs are retained at `/tmp/issue-122-password-metadata-*.log`.

Upstream History review also found derived cluster labels, keywords and
duplicate-visit metadata beyond the visit links. The shared
`tests/fixtures/history-opaque-metadata.sql` first reproduced retained clusters
in every native implementation after filtering to `github.com`. The fixture
includes a mixed-domain cluster and a quoted unknown table name. Filtered
imports now omit records without a safe domain association and report each
nonempty table as `unsupported-history-metadata`. Unfiltered imports retain
them. Native tests verify retained URLs and version metadata, removed marker
bytes after vacuum, named warnings and unchanged source bytes. Logs are retained
at `/tmp/issue-122-history-metadata-{before,after}-*.log`.

All three orchestrators first rejected the twelve additional data-class names.
The shared `tests/fixtures/migration-data-classes.json` now verifies the complete
18-class schema and zero-count skipped entries on Chromium, Firefox and Safari
sources. A deliberately invalid protected card-store fixture remains byte-for-
byte unchanged, and no target card store is created. Tests exercise boolean
consent rejection before writes, consent forwarding through CLI/streams/launch,
consented-but-unsupported card reports and all three named passkey providers.
The existing default Safari test now verifies coverage of every skipped class
instead of assuming the original five entries. A separate Rust regression
first failed with `missing field localStorage`; defaulted count fields now
accept the original six-class serialized report. Reproduction logs are retained
at `/tmp/issue-122-data-classes-before-*.log` and
`/tmp/issue-122-data-classes-legacy-before-rust.log`.

The duplication baseline refresh replaces one fingerprint for the expanded
repeated JSON capability declarations; it accepts no new implementation clone.
The native package helpers are also verified in npm and Python wheel contents.

Firefox history regressions first returned zero visits in each native language
for a Places database with four real visits. The shared
`tests/fixtures/firefox-history.sql` now verifies three exact-domain visits or
four unfiltered visits, excluding bookmark-only URLs. Tests preserve exact
microsecond timestamps beyond JavaScript's safe Number range, nullable titles,
source bytes and native Chromium layout. Missing visit tables leave the target
absent. Five malformed/overflowing date cases and three invalid URL cases have
individual skipped reasons while valid visits import. Before the URL guard,
Python raised TypeError, Rust returned a null-column error, and JS omitted the
row silently. The existing portable SQLite precision helper preserves BigInt
values across Node's SQLite and better-sqlite3 implementations. Logs are retained
at `/tmp/issue-122-firefox-history-{before,url-before}-*.log`.

## Local checks

Upstream Firefox cookie schema review identified another reproduced source bug.
The shared `tests/fixtures/firefox-cookie-expiry.sql` is exercised through both
installed-profile reading and migration, at schema versions 0, 15, 16 and 17.
Before normalization, the modern-version cases returned `2000000001999` as
Unix seconds rather than `2000000001`. Native regressions verify conversion,
legacy seconds, nonpositive session markers, domain exclusion and source bytes.
Before/after logs are retained at `/tmp/issue-122-firefox-expiry-*.log`.

The branch also incorporates main's native Selenium changes and dependency
updates from PR #125, preserving the new Safari parsing dependencies and
Firefox history translator. The first local Rust compilation was killed while
building parallel debug targets; subsequent builds use one compiler job and
disabled debug information, as the earlier local checks did.

| Check                                                             | Result                                                                                |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| JS `npm run check`                                                | ESLint, Prettier and no new duplication clones pass                                   |
| JS `npm test`                                                     | 1,590 pass; one Puppeteer manifest-version check skipped                              |
| Python Ruff check/format and `mypy src`                           | Pass; 172 source files type checked                                                   |
| Python `pytest`                                                   | 1,194 pass; twelve real-browser tests gated by `RUN_E2E`                               |
| Rust format, Clippy all targets/all features with warnings denied | Pass                                                                                  |
| Rust `cargo test --locked`                                        | 729 pass across unit/integration/doc suites; 15 existing browser tests ignored        |
| Rust `cargo test --locked --all-features`                         | 729 pass, zero failures; 15 existing browser tests ignored                            |
| Full-repository Secretlint and root JavaScript lint               | Pass                                                                                  |
| Shared asset byte comparison                                      | Catalogue, history schema and capability declarations identical in all three packages |
| Generated browser/migration matrix freshness                      | Pass                                                                                  |
| Required documentation, workflow policy and file line limits      | Pass                                                                                  |
| Git staged diff whitespace                                        | Pass; the CSV fixture intentionally preserves CRLF records and quoted LF bytes        |
| npm package and built Python wheel contents                       | Native Safari readers, history schema and capability JSON included                    |

Rust builds run serially with debug information disabled to keep compiler memory
bounded in this workspace. The CI-equivalent all-features test also passes.
Main updates puppeteer-core to 25.12.0 while its API manifest records 25.10.0;
the existing manifest-versus-installed-package test therefore skips. Generated
bindings remain consistent with the checked-in manifest. The Python skip count
includes main's four new engine-matrix acceptance tests.
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

All ten workflows passed on `ccd33185a7c560791f9adae1f5617761a928bfc9`,
committed at 15:02:30 UTC; those runs started at 15:02:56–57 UTC with the exact
head SHA. Rust passed on Linux, macOS and Windows, including coverage/package
jobs, and the aggregate CodeQL check passed. Subsequent source-discovery changes
require their own checks; these earlier passes alone do not validate a new head.

All ten workflows and the aggregate CodeQL check also passed on
`bd8062fa49225e9e1b0c2c3f8048b3db39a8a482`, committed at 15:42:37 UTC.
Those runs started at 15:42:45 UTC with the exact head SHA. Subsequent Safari
catalogue-error changes require a new CI verification after they are pushed.

All ten workflows and aggregate CodeQL also passed on
`cd857345b557936a1375083c6a6e227fe19cccbf`, committed at 16:10:54 UTC.
Those runs started at 16:14:17–18 UTC with the exact head SHA. Subsequent Login
Data metadata changes require their own CI verification after they are pushed.

All ten workflows and aggregate CodeQL also passed on
`08ab20fff9821c2f47bdd72077087c0b62df04f0`, committed at 16:36:50 UTC.
Those runs started at 16:37:36–37 UTC with the exact head SHA. The subsequent
18-class schema requires its own CI verification after pushing.

All ten workflows and aggregate CodeQL also passed on
`941a20fe779f84cab720d866e39b14cfba2a884f`, committed at 17:10:58 UTC.
Those runs started at 17:11:06 UTC with the exact head SHA. Subsequent Firefox
history and main synchronization require their own fresh CI verification.

Head `9f5cada0ced0f1beb0451e18ad787feeb5984cbc` was committed at 18:25:56 UTC;
all ten workflows started at 18:26:03 UTC with that SHA. The
[Python Windows job](https://github.com/link-foundation/browser-commander/actions/runs/37355906039)
failed two Firefox history cases. The downloaded log
`ci-logs/python-37355906039.log:2056` (also line 2115) records a Unicode title
misdecoded by the fixture loader's platform-default text encoding. A local
non-UTF-8 locale run reproduced a collection-time UnicodeDecodeError before
the fix. Every newly added migration text-fixture loader now names UTF-8; all
20 relevant history/domain-isolation/data-class cases pass with UTF-8 mode off:

```sh
cd python
LC_ALL=C PYTHONUTF8=0 PYTHONCOERCECLOCALE=0 python3 -m pytest \
  tests/unit/browser/migration/test_firefox_history.py \
  tests/unit/browser/migration/test_domain_isolation.py \
  tests/unit/browser/migration/test_data_classes.py -q
```

The test preserves the expected Unicode title; it does not relax the assertion
or change migration's database decoding. The final corrected head requires its
own Windows CI confirmation.

The aggregate CodeQL check also failed on this head even though the Security
workflow's analysis jobs succeeded. Its
[new Rust alert](https://github.com/link-foundation/browser-commander/pull/123#discussion_r4187427395)
identified `rust/tests/firefox_cookie_expiry.rs:86`, where an assertion's custom
failure message printed a cookie name from the migration report. The fixture
uses synthetic cookies and selects only the cookies class. The assertion now
compares expiry without formatting any returned cookie fields; a failing case
still names its schema version. Both public read-path regressions pass with
default and all features, and Clippy passes with warnings denied. The downloaded
`ci-logs/security-37355905924.log:6115` records successful CodeQL upload, while
`ci-logs/codeql-9f5cada-check.json` preserves the failing aggregate result. The
corrected head requires a fresh aggregate CodeQL check, not just successful
workflow jobs.

## Real runtime acceptance and remaining limits

```sh
BROWSER_COMMANDER_CHROMIUM_EXECUTABLE=/home/box/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome \
  node experiments/issue-122/chromium_acceptance.mjs
```

The installed Linux Chromium retains both translated Safari bookmark URLs,
including a reading-list URL, and both matching history visits after opening and
closing the persistent profile. The Firefox acceptance experiment,
`experiments/issue-122/firefox_history_acceptance.mjs`, verifies that the same
runtime retains all three domain-matching Firefox visits with exact microsecond
timestamps after opening/closing the persistent profile. Source bytes remain
unchanged. The additional
`experiments/issue-122/chromium_history_metadata_acceptance.mjs` creates a
synthetic profile with the installed Chromium's actual History schema, seeds
selected/excluded visits and derived metadata, and verifies that the selected
visit survives restart after metadata omissions. Warnings name the emptied
tables and source bytes remain unchanged. Password fixture decryption verifies target-key
encryption; it does not establish real browser password-store acceptance.
macOS Safari/STP and Windows runtime acceptance have not been run here.

Firefox/WebKit target writers, whole-profile migration, the additional storage
classes and automatic installed-browser protocol routing remain unimplemented.
Complete protected-root aggregation and discovery of domains across every
implemented site store also remain unresolved. The native matrix declares these
limits. PR #123 retains the parent's required closing-reference block and
remains draft while those requirements are incomplete.
