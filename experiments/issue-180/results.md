# Issue #180: resizes during screenshots

`resize-during-screenshot.mjs`, Linux, Xvfb (no window manager), Chrome for
Testing from Playwright's `chromium-1248`, Playwright 1.64. Each run makes
8 drags of 20 `Browser.setWindowBounds` steps while captures run in a loop,
then compares `innerWidth` with `outerWidth`.

| Capture | Stuck drags before the fix | Stuck drags after the fix |
|---|---|---|
| Playwright `page.screenshot({ type: 'png' })` | 3 of 8 (2 of 8 in a second run) | 3 of 8 (unchanged, engine API) |
| `captureStableViewport` (CDP, no `clip`) | 0 of 8 | 0 of 8 |
| `startTrace` checkpoints | 1 of 8 | 0 of 8 |

With `DEBUG=pw:protocol`, every Playwright capture sends
`Page.captureScreenshot` with `clip: {x: 0, y: 0, width, height, scale: 1}`.
After the fix, the trace checkpoints send
`{format: 'png', fromSurface: false, captureBeyondViewport: false}`.
