---
'browser-commander': patch
---

Parse Playwright `:has-text("…")` and `:text-is("…")` selectors with string
operations instead of a backtracking regular expression. A long selector that
did not match took quadratic time (16 seconds for 550,000 characters); it is
now rejected in linear time. CodeQL reported it as `js/polynomial-redos`.
