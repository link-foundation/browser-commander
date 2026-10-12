---
'browser-commander': patch
---

Preserve native Playwright text selectors and CSS sibling positions. Resolve nonnative text matches to unique ancestor paths so interactions keep their intended target across Playwright, Puppeteer, and Selenium.

Retain sanitized engine failures alongside Chrome stderr in launch error messages. Identify attachment stages and optionally log their timing with verbose mode; verify readiness, cleanup ownership, and fresh-profile startup on macOS in CI.
