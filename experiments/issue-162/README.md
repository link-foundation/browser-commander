# Default recording and user actions (#162)

The original recorder defaulted to checkpoints without network or links. Automatic
debugging required an explicit output option/environment variable and ignored
`debug: false` when `BROWSER_COMMANDER_TRACE` was set. Trusted manual clicks and
non-text keys were absent from the timeline, even in an explicit debug recording.

The regression tests were run before implementation. The defaults tests failed
on continuous mode, missing trace paths, opt-out precedence and launch recording;
the browser regression failed on both engines because it found zero user clicks.

Run the focused regressions from `js/` after `npm ci --ignore-scripts`:

```sh
node scripts/run-tests.mjs --reporter spec tests/unit/traces/issue-162-defaults.test.js tests/unit/traces/issue-162-user-actions.test.js
RUN_E2E=true node scripts/run-tests.mjs --reporter spec tests/e2e/issue-162-recording.e2e.test.js
```

The browser test launches engines sequentially with temporary profiles and a
loopback server. Each case has a 60-second test deadline and closes the browser,
server and recording in `finally`. A trusted Delete click issues a DELETE request
returning HTTP 500, then adds “Something went wrong on our end”. Assertions check
the action's target/name, the failed response, their timeline order and the error
text in the default `trace.lino`. Additional input covers pointerdown, Escape,
submit, contextmenu, synthetic-event exclusion and commander source attribution.
Typed input/textarea sentinels must not appear in action records. Response bodies
remain absent unless requested.

The unit regressions also bound queues to two entries, verify overflow counts,
private-target redaction and listener cleanup, preserve explicit recording
opt-outs, keep launch opt-outs when a commander adopts the page, attribute element
input to the commander, record the first immediate commander call, and prove that
launches and commanders share and finalize one trace. The shared conformance fixture verifies
the additional commander source field across JavaScript, Python and Rust.

The test runner opts ordinary fixtures out of automatic recording. These default
regressions explicitly clear that harness setting, so the production default is
tested without unrelated mock pages opening session files.
