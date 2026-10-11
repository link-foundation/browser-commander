# Fresh consumer audit and subprocess compatibility

Issue [#164](https://github.com/link-foundation/browser-commander/issues/164)
reports that `command-stream: ^1.4.0` selects 1.6.2 in fresh consumer installs,
bringing in ShellJS, fast-glob, micromatch and braces. The repository lock
pins 1.4.0, so auditing that lock alone misses
[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).

Run from the repository root:

```sh
bash experiments/issue-164/audit-consumer.sh
```

The script packs the local JavaScript package, installs its tarball into a
temporary consumer without copying the repository lock, and audits the newly
resolved production dependencies. It disables lifecycle scripts, uses a lock-only
install to avoid native builds, fails on high or critical findings, and removes
the temporary directory even on failure. The Security workflow runs the same
check alongside its committed-lock audit.

Before the fix, this check selected Command Stream 1.6.2 and exited 1 with five
high findings through the reported braces chain; `npm ci --ignore-scripts`
against the repository lock reported zero vulnerabilities. This demonstrates
the dependency-resolution regression without running a stack-exhaustion payload.

After changing the manifest to `command-stream: ^2.0.2` and regenerating the
lock, the same fresh-consumer check selects 2.0.2, exits 0 and reports zero
vulnerabilities. Both the original locked 1.4.0 and the updated 2.0.2 pass all
seven subprocess contracts. These results were obtained on 2026-10-11 with
Node 26.11.1 and npm 11.20.0.

Command Stream [2.0.2 registry metadata](https://registry.npmjs.org/command-stream/2.0.2)
omits ShellJS and preserves `command-stream/process-runner`. Its Node >=22.0.0
requirement fits Browser Commander's existing >=22.12.0 minimum. Inspection of
the published runner confirms that its noninteractive spawn still creates a
process group on Unix and that `_cleanup()` removes the runner from the active
cancellation registry. The existing detached adapter therefore retains its
behavior; upgrading the dependency does not require a new process implementation.

Run the seven actual process contracts from `js/`:

```sh
node scripts/run-tests.mjs --reporter tap tests/unit/utilities/subprocess.test.js
```

They cover exact argv, stdin and environment isolation, nonzero exits, output
streaming, cancellation, missing executables, and detached-child survival. The
last test uses `detached-launcher.mjs` to exercise the shipped adapter in a
separate launcher process. A finite Node child writes a marker after three
seconds: the launcher must exit before the marker exists, and the child must
still create it afterwards. Tests have ten-second suite limits, clean up child
processes and temporary files, and never access a browser or website.

Detached-child survival is a Unix contract: both the original Command Stream
1.4.0 and 2.0.2 hardcode `detached: process.platform !== 'win32'` in their
noninteractive spawn. The new fixture initially failed on Windows because it
assumed detachment there. It now explicitly skips that Unix assertion on Windows;
the other six subprocess contracts still run. This preserves the existing
adapter's platform behavior. [Node's detached-process documentation](https://nodejs.org/api/child_process.html#optionsdetached)
explains why Windows requires `detached: true` for a child to survive its parent.

The browser-backed capture fixture runs through the existing E2E framework:

```sh
cd js
RUN_E2E=true CHROME_PATH=/usr/bin/google-chrome CHROME_NO_SANDBOX=true \
  node scripts/run-tests.mjs --reporter tap tests/e2e/capture.e2e.test.js
```

It launches Playwright, Puppeteer and Selenium sequentially and checks stable
viewport focus/scroll preservation, PNG/JPEG/WebP screenshots, GIF/APNG/animated
WebP, and browser-native WebM. Each recording is limited to two 120×100 frames,
one MiB and three seconds; each engine case has a sixty-second test limit and
always closes its browser. The Browser Parity workflow includes this fixture in
its engine suite. `CHROME_NO_SANDBOX` is needed only in containers without a
usable sandbox, following the existing shared browser helper.
Selenium enables BiDi explicitly so its documented JPEG capture path is
exercised as well as PNG and WebP.
