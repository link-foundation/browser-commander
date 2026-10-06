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
