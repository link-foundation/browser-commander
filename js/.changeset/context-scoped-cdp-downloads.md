---
'browser-commander': patch
---

Persist managed downloads from Playwright pages in non-default Chromium browser
contexts. Browser Commander now resolves the page target's `browserContextId`
and applies its staging directory to that context while retaining browser-wide
download lifecycle events.
