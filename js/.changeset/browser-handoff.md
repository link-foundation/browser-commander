---
'browser-commander': minor
---

Let an embedding supervisor own Ctrl+C and keep a launched browser across its own restarts (#174). `interruption: 'caller'` on `launchBrowser`, `launchRealBrowser`, `launchWebDriver` and `startProcess` stops SIGINT from being forwarded to the browser and its ChromeDriver and turns off the engines' `handleSIGINT`. A real launch's `detach()` and `handoff()` return a JSON hand-off naming the exact browser instance and tab, and `reconnectBrowser(handoff)` reattaches to that tab without launching or navigating, refusing a replaced browser or a closed tab with `BrowserHandoffError`. `close()` on either session closes the browser, waits for its process to exit and removes a temporary profile.
