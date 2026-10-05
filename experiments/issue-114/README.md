# Safari cookie import investigation

Before this change, `readBrowserCookies({browser: 'safari'})` failed with
`Unsupported browser: safari`. The catalogue had only Chromium/Firefox families,
and the cookie reader always opened a SQLite database. Safari's conventional
cookie store is instead an unencrypted mixed-endian binarycookies file.

The implementation uses the documented record layout:
https://github.com/libyal/dtformats/blob/main/documentation/Safari%20Cookies.asciidoc
The fixture generator copies no third-party code and includes only synthetic
values. Regenerate it from the repository root:

```sh
python experiments/issue-114/create-fixtures.py
```

The shared fixture contains multiple pages (including an eight-byte empty page), secure and
HttpOnly flags, UTF-8 values, a domain outside the requested filter and a cookie
whose expiry is zero in Apple's epoch (2001-01-01, not a session-cookie sentinel).
The format has no SameSite field, so import uses Lax and reports the loss.

Regression suites compare the three native readers against the same expected
JSON and cover installed/legacy/Technology Preview roots, explicit directories,
read-only metadata counts, default/auto domain migration and unsupported-class
reports. Finite corruptions cover every truncated prefix, forged offsets/counts,
invalid string offsets and non-finite expiry. Permission failures are injected;
the tests identify the application requiring Full Disk Access without accessing
the user's cookie stores or Keychain. The JavaScript suite additionally exercises
the real reader through the CLI and command-stream dispatcher.

```sh
node --test js/tests/unit/browser/safari-cookies.test.js
cd python && python -m pytest tests/unit/browser/test_safari_cookies.py
cd ../rust && cargo test --test safari_cookies
```

An additional regression showed that domain-scoped default-browser resolution
discarded errors from source listing and treated an unreadable store as empty.
JavaScript and Python tests failed before the resolver fix. All three resolvers
now propagate that error when no readable matching default profile exists.

This Linux investigation cannot verify a live macOS Safari store or a real TCC
permission prompt. Portable fixtures exercise the conventional paths only;
modern named profiles/WebsiteDataStore layouts and non-cookie stores are tracked
in [#117](https://github.com/link-foundation/browser-commander/issues/117).
Firefox/WebKit targets and full clones are tracked in
[#118](https://github.com/link-foundation/browser-commander/issues/118), additional
classes in [#119](https://github.com/link-foundation/browser-commander/issues/119),
and the remaining protection/support-matrix/parity work in
[#120](https://github.com/link-foundation/browser-commander/issues/120).
Issue #114 remains open.
