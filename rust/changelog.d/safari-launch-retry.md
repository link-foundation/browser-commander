---
bump: patch
---

### Fixed

- A Safari launch right after a previous Safari session closed starts a fresh `safaridriver`, up to three attempts, when the driver exits before it is ready or refuses the connection. safaridriver serves one automation session at a time, and CI saw both failures on back-to-back launches. Authorization errors are still reported at once. Set `VERBOSE=1` to log each retry.
