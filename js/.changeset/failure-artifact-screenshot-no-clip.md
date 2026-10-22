---
'browser-commander': patch
---

The failure screenshot that `browser-commander/tests` writes for a failed scenario captures the view without a clip for Playwright and Puppeteer pages that have no fixed viewport (issue #180), as trace checkpoints and default screenshots already do. A clipped engine capture could leave a resized headful window drawn at its old size. Pages with a fixed viewport and other engines keep the engine's screenshot.
