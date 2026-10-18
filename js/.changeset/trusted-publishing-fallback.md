---
'browser-commander': patch
---

CI/CD: crates.io publishing tries trusted publishing (OIDC) first and falls back to the token secret, and the release preflight verifies that fallback.

Prepared profiles keep Chrome 155's "Continue where you left off" session restore infobar closed by writing `browser.session_restore_infobar_times_shown` to the profile's `Preferences`.
