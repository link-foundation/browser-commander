# Chrome for Testing by default

Without a `channel` or an `executablePath` (`executable_path` in Python and
Rust), every engine starts **Chrome for Testing**: the browser
`npx playwright install chromium`, `npx puppeteer browsers install chrome`,
`python -m playwright install chromium` or Selenium Manager downloads. It is
never the user's own Google Chrome, so automation does not share an
application, a Dock icon or a keychain entry with the browser the person uses
(issue #179). The installed Google Chrome is started only on request:

| Language   | Chrome for Testing (default)  | The installed Google Chrome                     |
| ---------- | ----------------------------- | ----------------------------------------------- |
| JavaScript | `launchBrowser({ engine })`   | `launchBrowser({ engine, channel: 'chrome' })`  |
| Python     | `launch_browser(engine=...)`  | `launch_browser(engine=..., channel="chrome")`  |
| Rust       | `LaunchOptions::playwright()` | `LaunchOptions::playwright().channel("chrome")` |

## Which download each engine uses

| Engine                  | Chrome for Testing it starts                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| Playwright (JS, Python) | Playwright's `chromium.executablePath()` / `chromium.executable_path`.                        |
| Puppeteer (JS)          | Puppeteer's `executablePath()`.                                                               |
| Selenium (JS)           | Playwright's, then Puppeteer's.                                                               |
| Selenium (Python)       | Playwright's, else the one Selenium Manager downloads.                                        |
| Rust engines            | The one Playwright or Puppeteer reports through Node, else the newest in the download caches. |

When no engine has one, the launch fails with the command that installs it, or
says to pass `channel: 'chrome'`; it never falls back to Google Chrome
silently.

Selenium attaches through a ChromeDriver, and ChromeDriver drives only the
Chrome release it was built for. The driver is resolved for the Chrome for
Testing that was started, through Selenium Manager's `--browser-path`; a
`chromedriver` on `PATH`, which belongs to the installed Google Chrome, is
not used for Chrome for Testing.

## The Linux sandbox on Ubuntu 23.10 and newer

Ubuntu 23.10 and newer restrict the unprivileged user namespaces Chromium's
sandbox needs (`kernel.apparmor_restrict_unprivileged_userns=1`). Google
Chrome's package installs an AppArmor profile that exempts it; Chrome for
Testing has none, so it exits with "No usable sandbox!" and the launch fails
with that line in its stderr. Browser Commander does not add `--no-sandbox` on
its own, because the command line stays the one a person would type. Fix the
host the way
[Chromium describes](https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md) -
an AppArmor profile for the Chrome for Testing directory, or
`sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0` on a disposable
CI runner - or pass `args: ['--no-sandbox']` where the sandbox is not wanted.

## Default restrictions: no infobar, no keychain prompt

Chrome for Testing shows a "Chrome for Testing is only for automated testing"
bar under the toolbar, and on macOS it asks for the keychain password the first
time it encrypts cookies or passwords. A launch of Chrome for Testing therefore
adds the `chrome-for-testing` preset of
[launch restrictions](feature-parity.md#launch-command-line-and-opt-in-restrictions):

| Restriction                     | Switch                | Effect                                                                                                                                        |
| ------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `no-chrome-for-testing-infobar` | `--test-type=gpu`     | Hides the bar. Chromium skips it only for this test type, which also skips the unsupported-flag and other startup infobars, and nothing else. |
| `mock-keychain`                 | `--use-mock-keychain` | Encrypts with a fixed key instead of a "Chromium Safe Storage" keychain entry, so macOS never prompts.                                        |

Any other browser - Google Chrome, Edge, Brave, Chromium - gets no default
restriction: its command line stays the one a person would type. The session
reports what was added as `defaultRestrictions` (`default_restrictions` in
Python and Rust), and `measureParity()` counts these switches as requested.

`defaultRestrictions: []` opts out, and any other list replaces the preset:

```js
await launchBrowser({ engine: 'playwright', defaultRestrictions: [] });
```

```python
await launch_browser(engine="playwright", default_restrictions=[])
```

```rust
launch_browser(LaunchOptions::playwright().default_restrictions(Vec::<String>::new())).await?;
```

`isChromeForTesting(path)` / `is_chrome_for_testing(path)` and
`defaultRestrictionsFor(path, requested)` / `default_restrictions_for(path,
requested)` expose the same decision. A path is Chrome for Testing when it is
inside a `chrome-linux64`, `chrome-win64`, `chrome-win32`, `chrome-mac-x64` or
`chrome-mac-arm64` directory, inside Selenium Manager's
`selenium/chrome/<platform>/<version>` cache, or names a
`Google Chrome for Testing` application.

## Profile migration

`migrateFrom` encrypts passwords and cookies with the key of the browser that
starts. With the default `mock-keychain` that is Chromium's fixed mock key;
without it, Chrome for Testing uses its own "Chromium Safe Storage" keychain
item rather than Google Chrome's "Chrome Safe Storage".

## Verifying it

`js/tests/e2e/chrome-for-testing.e2e.test.js` launches each JavaScript engine
headfully, reads `chrome://version` to check the executable and both switches,
and measures that the opt-out window is taller by the infobar. The
`Browser Parity` workflow installs every engine's Chrome for Testing and runs
it, alongside the Python and Rust default launches.
