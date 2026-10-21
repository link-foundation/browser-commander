---
bump: patch
---

### Fixed
- `migrate_from` re-encrypts passwords with the key of the browser that starts: Chrome for Testing keeps "Chromium Safe Storage" rather than "Chrome Safe Storage", and with its default `mock-keychain` restriction (`--use-mock-keychain` on macOS, or `--password-store=basic` on Linux) Chromium's fixed mock key, so migrated passwords decrypt in it (issue #179). `MigrateProfileOptions::target_keystore` and `target_keystore_for` select the keystore.
