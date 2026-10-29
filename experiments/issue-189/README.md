# Saved-password refresh regression evidence

Issue: https://github.com/link-foundation/browser-commander/issues/189
PR: https://github.com/link-foundation/browser-commander/pull/190

The old writer copied a source snapshot over `Login Data` before domain pruning.
The new shared fixture has a conflicting source/target identity, an unrelated
target credential, a target-only selected credential, a new selected credential,
an excluded lookalike host, encrypted notes and security associations whose IDs
collide. Source and target use distinct keys.

Before the fix, the JS regression failed with `2 !== 1`: the old writer counted
both selected source records and replaced the target. After the fix, it imports
one new identity, preserves the three target records, rekeys the new password
and note, remaps their associations, preserves target sync state and 64-bit
timestamps, and repeats without changing file bytes. All three languages run
this fixture. The source database stays byte-identical.

Refusal tests cover active markers, live processes, SQLite sidecars, unsupported
columns/metadata, version mismatches, triggers, account stores and wrong keys.
They assert unchanged target bytes. Additional tests cover preparation failure,
concurrent tool writers, a target changed during preparation, and password
checks preceding other data-class writes. Firefox/Safari's common translated
writer has a repeat-refresh regression in all three languages.

A separate CLI regression initially printed the cookie-transfer array, including
its private fixture value. It now verifies that routine `profile migrate`
output retains counts and omits cookie values, including command scripts.
Python/Rust forward this shared
CLI, while the programmatic transfer API retains its existing behavior.

Run the focused suites from the repository root:

```sh
node --test js/tests/unit/browser/migration/password-refresh.test.js js/tests/unit/cli/main.test.js
cd python
pytest tests/unit/browser/migration/test_password_refresh.py
cd ../rust
cargo test --lib browser::migration::tests::password_refresh
```

The real Chromium acceptance script creates isolated profiles, fabricates only
test logins, checks active-target refusal, imports only `live.com`, repeats,
reopens Chromium, and checks both retained records and SQLite integrity. It also
exercises empty account stores, persistent journals and the current Chromium
schema. It uses Linux's basic keystore. Run with installed JS dev dependencies:

```sh
node experiments/issue-189/verify-chromium.mjs
# To use an existing browser installation:
CHROMIUM_EXECUTABLE=/absolute/path/to/chrome node experiments/issue-189/verify-chromium.mjs
```

The full Rust dependency build was stopped at the container's 2.92 GiB memory
limit while compiling `chromiumoxide_cdp`, even with one job and debug info off.
`python experiments/issue-189/verify-rust.py` compiles the actual password,
metadata, encryption and snapshot modules and regression tests without that
dependency. Only the unrelated Firefox cookie reader is stubbed. This focused
harness does not substitute for the full Rust CI suite on larger runners.

Command output is saved as ignored `*.log` files in this directory. This is a
file-level migration change; no frontend visual changes or screenshots apply.

The original PR revision also failed its existing security gate. Preserved logs
are in `ci-logs/security-40960445712.log` (ignored): npm reported vulnerable Zod
through Puppeteer, and Cargo reported RUSTSEC-2026-0385 (ctutils) and
RUSTSEC-2026-0386 (Tokio). The lockfiles now resolve Puppeteer 25.16.0/Zod 4.6.7,
ctutils 0.4.4 and Tokio 1.53.3; the Tokio manifest minimum is also patched.
Both lockfile audits are verified without advisory suppressions.
Puppeteer's generated Rust/Python bindings were refreshed to match the patched
installation. The packed consumer still proves that Browser Commander and its
caller share one current Link type; independent older parsers inside other
dependencies are allowed.

The next CI revision exposed a macOS process guard failure at
`ci-logs/js-macos-40964961388.log:3248`: the running process used `/var` while
the physical target resolved under `/private/var`, and its profile path contained
spaces. A symlinked Linux reproducer also failed before the follow-up fix. The
guard now requests unlimited `ps` width and resolves every possible unquoted
argument boundary, including aliases. JS, Python and Rust have live-process
regressions that terminate and wait for their fixture children.
