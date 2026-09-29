# launchRealBrowser uses --remote-debugging-port=0, so navigator.webdriver is true and Google refuses sign-in
## Problem
`launchAndConnectRealBrowser` / `launchRealBrowser` (`js/src/browser/real-browser.js`, `buildRealBrowserArgs`) always starts Chrome with `--remote-debugging-port=0` and never applies `applyAutomationParityArgs`. The library's own `fingerprint/limitations.json` and `automation-parity.js` state that an **ephemeral port 0** turns on the `AutomationControlled` Blink feature. So the real-browser path, the one meant for a human to sign in, has `navigator.webdriver === true`. The parity work from #79 does not reach it.

Google then rejects sign-in: **"Couldn't sign you in. This browser or app may not be secure."** This blocks every consumer that needs a Google account, such as npm or GitHub sign-in with Google. It was found through link-foundation/package-registry-manager, which calls `launchRealBrowser({ engine: 'playwright', channel, userDataDir, headless: false })`.

## Measurements (macOS, Google Chrome 153, fresh non-default `--user-data-dir`, attached with Playwright `connectOverCDP`)
| Launch | `navigator.webdriver` | Google sign-in | Chrome infobar |
| --- | --- | --- | --- |
| `--remote-debugging-port=0` (current `launchRealBrowser`) | **true** | rejected ("may not be secure") | none |
| `--remote-debugging-port=0 --disable-blink-features=AutomationControlled` | false | sign-in form shown, account picker offered | **"You are using an unsupported command-line flag: --disable-blink-features=AutomationControlled. Stability and security will suffer."** |
| `--remote-debugging-port=<free fixed port>` (no extra switch) | **false** | expected to work, same as above | none |

A fixed non-zero port is exactly the case `runtime_features.cc` deliberately does not treat as automation (see `AUTOMATION_CONTROLLED_TRIGGERS` in `automation-parity.js`).

## Expected
- In the real-browser path, reserve a free loopback port (bind `127.0.0.1:0`, read the port, close, then pass it) instead of `0`. Retry on the rare port race and read `DevToolsActivePort` to confirm. This gives `navigator.webdriver === false` **without** the unsupported switch, so there is no warning infobar, which matters for anything a human sees.
- Keep `--disable-blink-features=AutomationControlled` only for engine-launched sessions (Playwright pipe, headless), where it's the only option. Document that it shows the infobar.
- Add a guard and test: `detectAutomationControlledTriggers(buildRealBrowserArgs(...))` must be empty, and an integration test measures `navigator.webdriver === false` in a real-browser session.
- Same fix in the Rust and Python implementations.
