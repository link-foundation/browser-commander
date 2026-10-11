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
