---
'browser-commander': minor
---

Add emulateMedia API for unified color scheme emulation across all engines

Implements `emulateMedia({ colorScheme })` as a unified API for color scheme emulation (prefers-color-scheme) across Playwright and Puppeteer engines. Also adds `colorScheme` as a launch option to `launchBrowser`.

Fixes #36
