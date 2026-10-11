# Recording policy and ownership regression

Issue #166 reports that JavaScript 0.30.1 creates retained recordings in a source
checkout during ordinary navigation. The cause is `debugEnabled()` enabling
capture unless explicitly disabled, followed by cwd-relative output resolution.
Continuous recording also automatically rotates at its data threshold, so a
managed byte budget needs a single bundle writer to prevent unbounded segments.

The minimal unit reproducer is
`js/tests/unit/traces/issue-166-policy.test.js`: without a debug request, navigate
with a fake page, inspect `tracePath`, capture scripts/listeners and the temporary
cwd. Before the fix the no-options case creates `browser-commander-traces`; output
hints also start recording. The suite was run before changing implementation and
failed. With the fix the same cases pass without creating files.

Run from `js/`:

```sh
node scripts/run-tests.mjs --reporter spec tests/unit/traces/issue-166-policy.test.js
CHROME_NO_SANDBOX=true CHROME_PATH=/usr/bin/google-chrome node scripts/run-tests.mjs --env RUN_E2E=true --reporter spec tests/e2e/issue-166-policy.e2e.test.js
```

The browser suite uses self-authored data pages, a chmod read-only cwd, and an
independently owned evidence directory. It verifies actual Playwright/Puppeteer
navigation without recording, explicit managed recording, retained read-back,
failed navigation and cleanup preserving neighboring caller evidence. On Unix
it also sends SIGINT/SIGTERM to the managed example and checks successful process
exit and completed cleanup. Unit coverage includes failed launch/startup, finite
byte/duration bounds, explicit stop/discard, launch/commander sharing and unsafe
configuration rejection before writes. Windows skips Unix signal delivery and
checks file absence instead of POSIX write permission semantics.

The public example is `examples/managed-debug-session.mjs`. Signal handlers belong
to the application and await teardown; the recorder does not intercept process
signals. The example keeps `process.on` handlers installed through cleanup so
command-stream's SIGINT forwarding observes the application's handler. A
`process.once` handler disappears before that check and allows an early exit 130;
the real-browser signal test exposed this and verifies the corrected example.
The same test exposed an engine-close RPC that can remain pending after the
browser is interrupted. `real-browser.test.js` reproduces that with a never-settled
engine close; it timed out before the fix. Applying the existing close timeout
to that RPC lets owned-process/profile cleanup finish without increasing budgets.
The policy suite also reproduces repeated debug teardown removing a newer trace's
observer registry, leaving input-label capture active after explicit traces stop.
Cleanup now removes only the registry owned by that observer generation.
Abrupt termination and accumulated retained sessions require the
application's own evidence-root retention policy. Explicit trace features and
the complete action/DOM/network capture tests from issue #162 remain supported.
