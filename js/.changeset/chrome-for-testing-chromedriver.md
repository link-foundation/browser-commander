---
'browser-commander': patch
---

Selenium drives Chrome for Testing with the ChromeDriver of its own release (issue #179): a `chromedriver` on `PATH` belongs to the installed Google Chrome and is skipped, Selenium Manager is asked with `--skip-driver-in-path`, and the real-browser launch and the hand-off reattach give ChromeDriver the browser that started. `defaultRestrictionsFor()` is exported.

`migrateFrom` re-encrypts passwords with the key of the browser that starts (issue #179): Chrome for Testing reads "Chromium Safe Storage", and with its default `mock-keychain` restriction (or `--password-store=basic` on Linux) Chromium's fixed mock password, so migrated passwords decrypt in it. macOS logins are written with the `v10` prefix Chromium uses there.
