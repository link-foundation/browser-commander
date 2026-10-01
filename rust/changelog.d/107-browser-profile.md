---
bump: patch
---

### Fixed

- Fresh real-browser launches seed Chromium's profile settings so the disposable window does not ask to become the system default browser. Callers can configure `default_browser_check`, `first_run`, `preferences`, and `local_state` without adding launch switches.
