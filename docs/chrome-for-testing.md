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

| Engine                      | Chrome for Testing it starts                                                                                                       |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Playwright, Puppeteer (JS)  | The engine's own `executablePath()`, else the newest build in its download cache.                                                  |
| Selenium (JS)               | Playwright's, then Puppeteer's, then the newest cached build, then the one Selenium Manager downloads.                             |
| Playwright (Python)         | Playwright's `chromium.executable_path`, else the newest build in its download cache.                                              |
| Selenium (Python)           | Playwright's, then the Playwright, Puppeteer and Selenium Manager caches, then the one Selenium Manager downloads.                 |
| Rust Playwright, Puppeteer  | The one the Node engine reports, else the newest build in its download cache.                                                      |
| Rust chromiumoxide          | The newest build in the Playwright, Puppeteer and Selenium Manager caches; chromiumoxide's own detection would find Google Chrome. |
| Rust fantoccini (WebDriver) | The newest cached build whose chromedriver is cached too, else the newest cached build.                                            |

When no engine has one, the launch fails with the command that installs it, or
says to pass `channel: 'chrome'`; it never falls back to Google Chrome
silently. The caches are `ms-playwright` (moved by `PLAYWRIGHT_BROWSERS_PATH`),
`~/.cache/puppeteer` (moved by `PUPPETEER_CACHE_DIR`) and `~/.cache/selenium`
(moved by `SE_CACHE_PATH`).

## The matching ChromeDriver

Selenium and fantoccini attach through a ChromeDriver, and a ChromeDriver
drives only the Chrome major version it was built for. A `chromedriver` on
`PATH` belongs to the installed Google Chrome, so it is not used for Chrome
for Testing; with another release, the session fails with "This version of
ChromeDriver only supports Chrome version …".

- **Selenium (JS and Python)** asks Selenium Manager for the driver of the
  browser that was started (`--browser-path`) and passes
  `--skip-driver-in-path`, because Selenium Manager would otherwise return the
  driver on `PATH` whatever its release. Reattaching to a handed-off browser
  passes its executable again.
- **Rust fantoccini** uses the chromedriver Selenium Manager or
  `@puppeteer/browsers` downloaded for the same release, else the newest
  cached one of the same major version. Playwright downloads no driver: with
  only Playwright's Chrome for Testing and no cached driver of that major
  version, the `chromedriver` on `PATH` is used, and must then be of the same
  major version. `WebDriverOptions::driver_executable` names the driver
  explicitly.

`cargo run --example engine_chrome_for_testing -- fantoccini` (or
`chromiumoxide`) starts an engine launch without a channel and prints the
executable, whether it is Chrome for Testing, the default restrictions and the
user agent.

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
CI runner - or pass `args: ['--no-sandbox']` (Rust: `.sandbox(false)`) where
the sandbox is not wanted.

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
restriction. The session reports what was added as `defaultRestrictions`
(`default_restrictions` in Python and Rust), and `measureParity()` counts these
switches as requested. `defaultRestrictions: []` opts out, and any other list
replaces the preset.

## Profile migration

`migrateFrom` (`migrate_from`) re-encrypts passwords with the key of the
browser that starts. Chrome for Testing reads "Chromium Safe Storage", not
Google Chrome's "Chrome Safe Storage". With the default `mock-keychain`
restriction on macOS it uses Chromium's fixed mock key (the public
`mock_password`) instead, as it uses the fixed `peanuts` key on Linux with
`--password-store=basic`, so migrated passwords decrypt in it.
`targetKeystoreFor(args, platform)` / `target_keystore_for` decide which
keystore a command line uses.

## Verifying it

`js/tests/e2e/chrome-for-testing.e2e.test.js` launches each JavaScript engine,
reads `chrome://version` to check the executable and both switches. The
`Browser Parity` workflow installs every engine's Chrome for Testing and runs
it, alongside the Python and Rust default launches.
