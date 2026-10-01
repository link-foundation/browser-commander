---
bump: minor
---

### Added
- Playwright-compatible cookie and origin-scoped localStorage import/export
  through `StorageState`, `LaunchOptions::storage_state`,
  `ConnectOptions::storage_state`, and `save_storage_state` for Chromiumoxide,
  Playwright, and Puppeteer.
