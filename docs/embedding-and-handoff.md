# Embedding: Ctrl+C ownership and browser hand-off

Some applications embed browser-commander inside their own supervisor: a CLI
that opens a real browser, asks a human to sign in or solve a captcha, and must
keep that exact browser and tab open when the supervisor itself is interrupted
or restarted. The default lifetime model (the launch owns the browser, Ctrl+C
closes it) is right for scripts and tests, but it takes the decision away from
such a supervisor. Issue
[#174](https://github.com/link-foundation/browser-commander/issues/174)
describes the case; this page documents the three pieces that solve it.

## 1. Who owns Ctrl+C: `interruption`

```javascript
const session = await launchBrowser({ interruption: 'caller' });
```

| `interruption`        | What Ctrl+C (SIGINT) does to the launched browser                                                                                                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `'managed'` (default) | Unchanged behavior. The browser process is registered with the subprocess layer, which forwards SIGINT to its process group, and an engine launch keeps its own `handleSIGINT` handler. The browser is gone before the application's own handler runs. |
| `'caller'`            | Nothing is forwarded. The browser runs in its own process group, the subprocess layer does not forward SIGINT to it, and engine launches get `handleSIGINT: false`. The application's SIGINT handler decides: `close()`, `detach()`, or nothing.       |

The option is accepted by `launchBrowser()`, `launchRealBrowser()` /
`launchAndConnectRealBrowser()`, `launchWebDriver()` (the ChromeDriver process
the Selenium real launch starts follows the browser), and `startProcess()`.
Anything else throws a `TypeError` listing `INTERRUPTION_MODES`.

`'caller'` only changes signal ownership. The browser is still owned by the
launch: `close()` closes it and waits for the actual process to exit, and the
application is now responsible for calling `close()` or `detach()` on the way
out. SIGTERM and SIGHUP are not affected.

## 2. Leave the browser running: `detach()` and `handoff()`

A real launch (`launch: 'real'`, the default) returns a session with:

- `await session.handoff({ page })` - a JSON-serializable description of the
  exact browser instance and tab, without changing anything;
- `await session.detach({ page })` - stops this controller (the engine
  connection is dropped, the browser process is released so this Node process
  can exit) and returns the same hand-off. It is idempotent; after it,
  `session.detached` is `true`, and `close()` still closes the browser through
  its DevTools WebSocket.

```json
{
  "version": 1,
  "engine": "playwright",
  "cdpEndpoint": "http://127.0.0.1:41235",
  "webSocketDebuggerUrl": "ws://127.0.0.1:41235/devtools/browser/0c5f...",
  "targetId": "8E6A...",
  "pid": 12345,
  "userDataDir": "/tmp/browser-commander-profile-abc",
  "temporaryProfile": true,
  "remoteDebuggingPort": 41235,
  "executablePath": "/usr/bin/google-chrome"
}
```

A detached session is not saved by session persistence: the controller that
reconnects owns the browser, and with it the decision when to save. An engine
launch (`launch: 'engine'`) has no DevTools endpoint another process could
reconnect to, so it has no `detach()`.

## 3. Reattach to the exact tab: `reconnectBrowser(handoff)`

```javascript
import { reconnectBrowser } from 'browser-commander';

const session = await reconnectBrowser('/var/run/my-app/handoff.json', {
  engine: 'puppeteer', // optional; defaults to the engine that handed off
});
// session.page is the tab that was handed off, as it was left.
await session.close(); // closes the browser and waits for the process to exit
```

`reconnectBrowser` accepts the hand-off object, its JSON text or a path to a
JSON file, and any `connectBrowser()` option. It:

- never launches a browser and never creates or navigates a page;
- checks that `cdpEndpoint` still belongs to the same browser instance (the
  `webSocketDebuggerUrl` is compared, so a different browser that reused the
  port is refused) and that the tab still exists; otherwise it throws a
  `BrowserHandoffError`;
- returns `connectBrowser()` handles plus `close()`, `detach()`, `handoff()`,
  `pid`, `cdpEndpoint`, `userDataDir` and `temporaryProfile`.

The returned session owns the browser like the launch did. `close()` sends
`Browser.close`, waits for the browser process to exit (escalating to SIGKILL
on its process group after `closeTimeout`, default 5000 ms), and removes a
temporary profile. `detach()` hands it off again.

## A supervisor, end to end

```javascript
import { writeFileSync } from 'node:fs';
import { launchBrowser } from 'browser-commander';

const session = await launchBrowser({ interruption: 'caller' });
await session.page.goto('https://example.com/login');

process.on('SIGINT', async () => {
  // Keep the tab for the next run instead of losing the human's progress.
  writeFileSync('handoff.json', JSON.stringify(await session.detach()));
  process.exit(130);
});
```

The next run calls `reconnectBrowser('handoff.json')` and continues on the same
tab. [`examples/browser-handoff.mjs`](../examples/browser-handoff.mjs) runs
the whole round trip, and
[`js/tests/e2e/browser-handoff.e2e.test.js`](../js/tests/e2e/browser-handoff.e2e.test.js)
verifies it with Playwright, Puppeteer and Selenium against a real Chrome.

## Why not the existing lifetimes?

- `connectOrLaunch()` / persistent sessions keep a browser alive with a
  heartbeat and a watchdog between runs. That is a second lifetime controller
  with its own policy; an embedder that already supervises its processes
  needs a launch-level switch instead.
- `connectBrowser()` alone attaches to _some_ tab of _some_ browser on a port.
  The hand-off pins the browser instance and the tab, and refuses to attach
  anywhere else.
