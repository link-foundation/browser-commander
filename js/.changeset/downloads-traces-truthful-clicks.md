---
'browser-commander': minor
---

Add managed downloads, portable traces and truthful click results.

`downloads` is now accepted by `launchBrowser()`, `connectBrowser()` and
`launchRealBrowser()`, and by `commander.configureDownloads()` on a browser you
already have. The manager owns the file rather than the page: `capture()` starts
listening before the action runs so a fast download cannot be missed, a caller
can choose the saved name and have a bare UUID given the extension its content
proves, and the file is still there after the context and the browser are gone.
Failed and cancelled downloads report the failure instead of a path, and
`browser-commander/tests` keeps captured files in the run's artifact directory.

`startTrace()` records a session into a schema-versioned bundle - an ordered
NDJSON timeline, named checkpoints with full HTML, live control state and frame
metadata, and the DOM mutation batches between them - which `readTrace()`,
`diffControlState()` and the offline `writeTraceViewer()` read back with scripts
and network disabled. Redaction runs before anything is written, a truncated or
interrupted run still produces a readable partial trace, and
`browser-commander/tests` supports `trace: 'retain-on-failure'` in place of its
own artifact mechanism.

`clickElement()` now reports what was observed: `status` is `succeeded`,
`failed`, `timed_out`, `interrupted` or `unverified`, `effect` is `confirmed`,
`not-observed` or `contradicted`, and `evidence` carries the reason for both.
The `success` and `verified` booleans remain and are derived conservatively, so
a click that changed nothing is no longer reported as verified. `waitForReady()`
composes URL, network, DOM, image and custom checks under one deadline and
returns the same per-check evidence. `noAutoScroll` is deprecated in favour of
the `scroll` axis; `scroll: 'none'` now fails with a `ScrollConstraintError` on
engines that cannot click without scrolling instead of scrolling anyway.
