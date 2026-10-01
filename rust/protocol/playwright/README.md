# Vendored Playwright protocol spec

These YAML files are copied verbatim from
[`microsoft/playwright` `packages/protocol/spec/`](https://github.com/microsoft/playwright/tree/v1.62.1/packages/protocol/spec)
at tag `v1.62.1`. They are licensed under the Apache License 2.0 by
Microsoft Corporation (see the header of every file).

`scripts/generate-playwright-protocol.mjs` turns them into the typed Rust
bindings in `rust/src/playwright/protocol/`. Those bindings are what the Rust
`playwright` engine uses to drive the official Playwright driver
(`playwright run-driver`) directly, with no Node.js bridge script in between.

To move to a newer Playwright release:

1. Copy `packages/protocol/spec/*.yml` from the new tag into this directory.
2. Update `VERSION`.
3. Run `node scripts/generate-playwright-protocol.mjs` and commit the result.

The JavaScript test `js/tests/unit/playwright-protocol-coverage.test.js`
fails when the generated bindings are stale or miss any interface, command or
event from the spec.
