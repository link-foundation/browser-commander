---
'browser-commander': patch
---

Close the parity probe server only after it stops listening, so a connection
that arrives during shutdown can no longer keep `close()` waiting. Test fixture
servers now drop idle browser preconnections too, which stopped the Safari
smoke test from timing out during cleanup on Node 24.

Parse Playwright `:has-text("…")` and `:text-is("…")` selectors with string
operations instead of a backtracking regular expression. A long selector that
did not match took quadratic time (16 seconds for 550,000 characters); it is
now rejected in linear time. CodeQL reported it as `js/polynomial-redos`.

Failure artifact names are trimmed of leading and trailing dashes by index, so
a test name with a long run of dashes no longer takes quadratic time.

A Safari launch right after a previous Safari session closed starts a fresh
`safaridriver`, up to three attempts, when the driver exits before it is ready
or refuses the connection. safaridriver serves one automation session at a
time, and CI saw both failures on back-to-back launches. A refused connection
now also names the driver server and whether it had exited. Authorization
errors are still reported at once. Set `VERBOSE=1` to log each retry.
