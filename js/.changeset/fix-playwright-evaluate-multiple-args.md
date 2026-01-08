---
'browser-commander': patch
---

Fix PlaywrightAdapter.evaluateOnPage() to spread multiple arguments correctly

When using `evaluateOnPage()` with multiple arguments, the arguments are now properly spread to the function in the browser context, matching Puppeteer's behavior.

Previously, the function would receive the entire array as its first parameter instead of spread arguments, causing issues like invalid selectors when passing selector + array combinations.
