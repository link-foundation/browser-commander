# Issue 160 bounded reproductions

Run from the repository root after installing JS and Python development dependencies:

```sh
node experiments/issue-160/verify-package.mjs
cd js
bun test tests/unit/browser/issue-160-connector.test.js
RUN_E2E=true xvfb-run -a node scripts/run-tests.mjs tests/e2e/issue-160.e2e.test.js
```

The browser fixture uses 50 appends, one interrupted navigation, a fixed-port
dedicated profile, a four-second idle period, and a zero-page headed Chrome.
Every test has a 60-second deadline and closes its browser, server and profile.
Unit fixtures cap inputs at kilobytes; no experiment intentionally exhausts
the host. Rust compilation can use `CARGO_BUILD_JOBS=1`,
`CARGO_PROFILE_DEV_DEBUG=0`, and `CARGO_PROFILE_TEST_DEBUG=0` on small hosts.

The permission regression injects EPERM/EACCES under both Node and Bun. Linux
cannot reproduce macOS TCC directly. The package probe extracts an npm tarball
into a temporary directory and supplies the installed dependencies without
changing package contents or publishing it.
