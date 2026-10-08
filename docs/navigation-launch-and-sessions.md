# Navigation, launch diagnostics, and reusable sessions

The requirement inventory and implementation choices for issues 134–138 are in
[the investigation plan](../dev/log/issues/138/pulls/139/plan.md). This guide
describes the public contracts shared by JavaScript, Python, and Rust.

## Navigation budgets

`goto` uses one monotonic deadline for engine navigation, redirects, readiness,
and verification. A readiness wait already in progress does not grant a new
caller additional time. Explicit policies apply even when network tracking and
the navigation manager are enabled:

```javascript
const result = await commander.goto({
  url: 'https://example.com/',
  timeout: 4000,
  waitUntil: 'domcontentloaded',
  waitForNetworkIdle: false,
  waitForStableUrlBefore: false,
  waitForStableUrlAfter: false,
  verify: false,
  signal: AbortSignal.timeout(4000),
});
console.log(result.status); // ready, timed_out, interrupted, or failed
```

Omitted flags preserve existing readiness defaults. Prefer a positive readiness
check, such as `selectorExists`, when a page polls continuously. Explicit
`checks` replace the default URL/network checks. `waitUntil` and readiness
checks are separate policies: an engine `networkidle` navigation can still
wait even when `waitForNetworkIdle` is false.

Python uses `timeout` in milliseconds, snake_case flags, and an optional
`asyncio.Event` signal. Rust uses `NavigationOptions.timeout: Duration`,
`WaitUntil`, and an optional `CancellationToken`. Cancellation releases the
operation's listeners and state; an engine may continue an already dispatched
navigation. Classic Selenium calls run in a worker with a page-load timeout.

| Engine                                    | Native navigation readiness                                                              |
| ----------------------------------------- | ---------------------------------------------------------------------------------------- |
| JavaScript Playwright/Puppeteer           | DOM content, load, engine network idle; shared additional checks                         |
| Python Playwright                         | DOM content, load, engine network idle; shared additional checks                         |
| Python Selenium                           | Driver page load plus shared checks; in-flight blocking calls observe the driver timeout |
| Rust Chromiumoxide                        | DOM ready state and tracked network requests, under the caller deadline                  |
| Rust native Playwright / Puppeteer bridge | Engine wait policy and timeout forwarded                                                 |
| Rust Fantoccini                           | BiDi interactive/complete or classic load; network idle explicitly unsupported           |

Local navigation fixtures cover data pages, redirects, stalled responses,
continuous requests, positive selectors, cancellation, and listener cleanup.

## Launch diagnostics

`BrowserLaunchError` preserves bounded, redacted evidence. JavaScript fields are
`phase`, `engine`, `category`, `exitCode`, `signal`, `stderrTail`, and `cause`.
Python and Rust use snake_case names (`exit_code`, `stderr_tail`). Categories
include `missing_executable`, `early_exit`, `startup_timeout`, `port_race`, and
`configuration`. Existing structured errors retain their category when wrapped.

Default scrubbing removes common secret assignments and personal paths. A
`diagnosticRedactor` (Python/Rust `diagnostic_redactor`) can remove additional
application-specific content. It runs before diagnostic text is exposed.
The public tail is limited to 4 KiB. The retained cause is sanitized; raw process
output is forwarded only with explicit verbose logging. Rust command-stream
does not expose a reliable separate termination signal, so its `signal` can be
`None`.

In a container, install the browser's system libraries, give Chromium sufficient
shared memory, and run as a user with a working sandbox. Select a known executable
with `executablePath`/`executable_path` when discovery fails. `--no-sandbox` or
`sandbox(false)` is an explicit caller choice for a controlled container.
The library does not apply it automatically or enable privileged cookie imports.

## Reusable helpers

```javascript
const selector = await commander.findFirst({
  selectors: ['#primary', '[data-action=submit]', 'button'],
  visible: true,
});
await commander.findToggleButton({ texts: ['Add', 'Cover letter'] });
await commander.hasText({ texts: ['Submitted'], normalizeWhitespace: true });
await commander.isEnabled({ selector: 'button', index: 1 });
await commander.scrollIntoView({ selector: 'button', index: 1 });
await commander.clickButton({ selector: 'button', index: 1 });
await commander.check({ selector: 'input[type=checkbox]', checked: true });
const flag = await commander.readFlag({ storageKey: 'submitted' });
await commander.uninstallClickListener({ storageKey: 'submitted' });
const unsubscribe = commander.onUrlChange((url) => console.log(url));
unsubscribe();
```

Selector and text alternatives retain caller order. Text checks use
`body.textContent`; normalization is opt-in and collapses Unicode whitespace,
including nonbreaking spaces. Indices are zero-based. The generic disabled
class default is `disabled`; callers can supply additional classes. `check` uses
native input and returns `{ checked, changed, verified }`. An already matching
control is untouched; unchecking a radio by clicking is rejected.

`readFlag` returns `{ status: 'observed', set: boolean }` or an interrupted
observation. It never clears the stored value. Rust uses
`FlagRead::Observed(bool)` / `FlagRead::Interrupted`. `checkAndClearFlag` remains
available. Subscription removers are idempotent. Python exposes equivalent
snake_case commander methods; Rust exports reusable functions accepting an
`EngineAdapter`, with optional indices and `find_toggle_button_with_texts`.

## Read an existing session

```javascript
const cookies = await readBrowserCookies({
  browser: 'chrome',
  domainFilter: 'example.com',
  via: 'browser',
});
await commander.setCookies(cookies);
await commander.clearCookies({ domain: 'example.com' });
```

For Chromium-family profiles, browser-backed reads are the macOS default. The
source browser decrypts its own cookie store in a disposable cookie-only copy.
This avoids the library's `security find-generic-password` path; OS policy can
still require consent for the source browser itself. `via: 'database'` opts into
direct database decryption and the OS keystore. A database read resolves its
credential once per call. When macOS offers **Always Allow**, selecting it grants
future access to that calling executable according to Keychain policy.
Firefox and Safari retain their existing database readers.

`attach: { mode: 'snapshot', browser: 'chrome', include: ['cookies'] }` and
`snapshotUserDataDir({ ..., include: ['cookies'] })` copy Local State and the
profile's Cookies database, including committed WAL data through SQLite online
backup. They omit history, credentials, extension data, and caches. Omit
`include` for the existing full supported-profile copy. Source databases remain
read-only and symbolic-link paths are skipped. Snapshot browser/channel aliases
come from the shared Chromium browser catalogue, including `edge` / `msedge`,
Vivaldi, Opera, Arc, and Yandex. An installed matching source executable remains
necessary; a catalogue entry does not install a browser.

For an engine-created profile, use `launch: 'engine'` with that engine and
`saveStorageState`, or `via: 'database', keystore: 'mock'` when supported.
The explicit mock reader supports macOS's mock password and Linux's basic
store. Windows mock encryption varies by Chromium version and is explicitly
unsupported by this database reader; use the matching browser/engine instead.
Real Chrome's OS keystore cannot decrypt mock-keychain cookies from an
engine-created profile. Changing such a profile to `launch: 'real'` can appear
to log it out. No key fallback is guessed.

Runtime cookie APIs preserve HttpOnly, path, domain, secure, and SameSite.
Nonpositive expiry is session state: Playwright uses `-1`; other engines omit
the expiry. Domain deletion matches the exact domain and its subdomains, never
an unrelated suffix such as `notexample.com`.

Playwright and Puppeteer use context cookie APIs. Chromium Selenium uses CDP;
JavaScript WebDriver uses BiDi storage when available. Classic WebDriver can
only enumerate/delete cookies visible to its current origin. Its setter visits
the required origins and restores the page URL; it cannot provide a context-wide
cookie inventory. Rust Fantoccini uses BiDi deletion where available and the
classic origin-scoped fallback otherwise.

## Discover and persist

```javascript
const sessions = await findSiteSessions({
  domains: ['example.com'],
  profiles: [
    {
      browser: 'chromium',
      path: '/dedicated-engine-profile/Default',
      launch: 'engine',
      engine: 'playwright',
    },
  ],
  isLoggedIn: async ({ page }) => {
    await page.goto('https://example.com/account');
    return (await page.locator('[data-signed-in]').count()) > 0;
  },
});
```

The helper discovers installed profiles unless explicit `sources` are supplied,
adds caller-provided engine `profiles`, launches disposable cookie-only copies,
filters cookies, and optionally validates the live session. Results retain source
provenance, cookies, `loggedIn` (`null` without validation), and per-source
errors. Firefox-family and Safari cookie sources use their existing database
readers. When validation is requested, those cookies are imported into a fresh
automation context; their personal profiles are never launched. Each launch
closes before discovery proceeds. Cookie presence alone
does not prove that the server still accepts a session.

`persistSessionCookies: true` automatically restores and saves session cookies
for an **explicit dedicated** `userDataDir`; a string selects the state file.
Python accepts `True` or a path. Rust accepts an explicit
`persist_session_cookies: Option<PathBuf>` state file. Persistence is off by
default. It cannot authorize use of a protected daily-browser profile or a
snapshot. The saved state contains session cookies and no local storage, uses
atomic replacement and owner-only permissions on Unix, and closes the browser
even if saving fails. Call the returned `close()` to complete persistence.

macOS default-browser discovery first reads legacy LaunchServices handlers and
then queries AppKit's active HTTPS application. Missing or unknown evidence
continues to return `null`/`None`.

## JavaScript installation and Bun

`better-sqlite3` is optional and lazily loaded. Normal automation imports do not
require its native build. Node's built-in SQLite handles supported reads; online
backup requires Node 22.16 or later. Older runtimes need the optional addon for
SQLite workflows and receive an installation hint when it is unavailable.
`links-notation` uses the compatible `^0.23.0` range.

Use Bun **1.4.2 or later** for real-browser Playwright CDP attachment. The consumer
reported a timeout on Bun 1.2.20 and success on 1.4.2; this is a tested minimum,
not a claim that every upstream Bun CDP issue is closed. Node is the fallback.
Choose `launch: 'engine'` explicitly if that launch mode fits the profile's
encryption provenance.

## Upstream research and component choices

| Source                                                                                                                                            | Finding and decision                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Playwright page API](https://playwright.dev/python/docs/api/class-page)                                                                          | Network idle is discouraged as a universal readiness signal; reuse positive checks and explicit policies.                                                                                                                      |
| [Playwright BrowserContext](https://playwright.dev/python/docs/api/class-browsercontext)                                                          | Reuse add/cookies/clear and portable storage state, preserving HttpOnly and cross-origin scope.                                                                                                                                |
| [Puppeteer Page](https://pptr.dev/api/puppeteer.page)                                                                                             | Page cookie methods are deprecated; prefer BrowserContext cookie methods with compatibility fallback.                                                                                                                          |
| [Node SQLite](https://nodejs.org/api/sqlite.html), [SQLite backup](https://www.sqlite.org/backup.html)                                            | Reuse online backup rather than copying a live WAL independently; make the native addon optional.                                                                                                                              |
| [Apple active URL application](https://developer.apple.com/documentation/appkit/nsworkspace/urlforapplication%28toopen%3A%29-7qkzf?language=objc) | Query the OS's active handler rather than assuming legacy plist entries are present; AppKit supplies the current URL application.                                                                                              |
| [Chromium macOS OS crypt](https://chromium.googlesource.com/chromium/chromium/%2B/trunk/components/os_crypt/os_crypt_mac.mm)                      | macOS mock keychain uses `mock_password`, salt `saltysalt`, PBKDF2-SHA1 with 1,003 iterations. Linux basic-store derivation differs.                                                                                           |
| [browser-cookie3](https://github.com/borisbabic/browser_cookie3)                                                                                  | Existing direct-decryption library still requires OS credential access. Adding it would not solve the prompt requirement; reuse protected browser snapshots.                                                                   |
| [Bun CDP issue](https://github.com/oven-sh/bun/issues/9911), [Bun releases](https://bun.sh/)                                                      | Document the consumer-confirmed runtime minimum and Node fallback; retain explicit launch selection.                                                                                                                           |
| [command-stream](https://www.npmjs.com/package/command-stream)                                                                                    | The prepared lock resolves 1.4.0 and production audit already reports zero vulnerabilities. The reported five highs could not be reproduced in this tree; retain the compatible process-runner API and verify the final graph. |

Automated local browser checks use authored pages and artificial cookies on
Linux. Mocked macOS/Windows tests validate catalogue resolution, derivation, and
diagnostic contracts. They do not demonstrate real Keychain consent behavior
or a live installed macOS browser. The PR's CI results provide the current
platform/runtime matrix; this guide does not promise untested combinations.
