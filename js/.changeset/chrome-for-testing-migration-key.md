---
'browser-commander': patch
---

`migrateFrom` re-encrypts passwords with the key of the browser that starts (issue #179): Chrome for Testing reads "Chromium Safe Storage", and with its default `mock-keychain` restriction (or `--password-store=basic` on Linux) Chromium's fixed mock password, so migrated passwords decrypt in it. macOS logins are written with the `v10` prefix Chromium uses there.
