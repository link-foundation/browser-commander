---
'browser-commander': patch
---

Selenium drives Chrome for Testing with the ChromeDriver of its own release (issue #179): a `chromedriver` on `PATH` belongs to the installed Google Chrome and is skipped, Selenium Manager is asked with `--skip-driver-in-path`, and the real-browser launch and the hand-off reattach give ChromeDriver the browser that started. `defaultRestrictionsFor()` is exported.
