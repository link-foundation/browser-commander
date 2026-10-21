---
bump: patch
---

### Fixed
- Trace checkpoint screenshots and default `screenshot()` calls on pages without a fixed viewport now capture the view with CDP `Page.captureScreenshot` without a clip, so resizing a headful window during a capture no longer leaves the page at the emulated size (issue #180). Engines without CDP keep their own capture.
