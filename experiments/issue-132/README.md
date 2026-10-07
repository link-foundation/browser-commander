# macOS dedicated-profile regression (#132)

Issue: https://github.com/link-foundation/browser-commander/issues/132

PR: https://github.com/link-foundation/browser-commander/pull/133

In JavaScript 0.26.2, Safari's import-discovery root `~/Library` also acted as
a protected browser profile. All three packages derived their protection list
from import roots, rejecting dedicated app profiles inside macOS's standard
application-data directory.

## Reproduce

Run this from the repository root on the affected revision:

```sh
node --input-type=module <<'JS'
import { assertDedicatedUserDataDir } from './js/src/browser/system-browser.js';
assertDedicatedUserDataDir(
  '/users/test/Library/Application Support/package-registry-manager/browser-profile',
  { platform: 'darwin', homeDir: '/users/test', environment: {} }
);
JS
```

The original code throws `requires a dedicated userDataDir, not a browser
default profile`. The fixed code accepts the path.

## Regression tests

The added tests were run against the original protection logic before the fix.
They fail on the reported application path. They also check that Safari,
Technology Preview, legacy Cookies and Chrome stores and their descendants
remain protected, and that similarly named sibling directories are accepted.
Platform injection lets the macOS cases run on Linux and Windows as well.

```sh
cd js
node scripts/run-tests.mjs --reporter spec tests/unit/browser/catalogue-launch.test.js tests/unit/browser/safari-cookies.test.js tests/unit/browser/safari-profiles.test.js
cd ../python
pytest tests/unit/browser/test_catalogue_launch.py tests/unit/browser/test_safari_cookies.py tests/unit/browser/test_safari_profiles.py
cd ../rust
cargo test --all-features --lib browser::system_browser::tests
cargo test --all-features --test safari_cookies
```

Existing Safari fixtures verify both container and legacy cookie discovery,
named profiles and read-only imports. No real macOS browser is needed for these
path-validation tests.

## Catalogue behavior

The shared catalogue now supports an optional `protectionRoots` map for browsers
whose import discovery searches a broad directory. Protection uses that map
when present and otherwise falls back to `roots`. Import discovery continues
to use `roots`.

Safari protects `~/Library/Safari`, `~/Library/Cookies`, and its entire
`~/Library/Containers/com.apple.Safari` container. Technology Preview protects
`~/Library/Safari Technology Preview` and its own container. Protecting whole
containers includes both the existing `Data/Library` stores and future profile
directories there. Other browsers retain their existing protection roots.
