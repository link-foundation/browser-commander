# Browser profile settings

`launchRealBrowser()` (and the default `launchBrowser()` path) prepares a
dedicated user data directory before Chrome, Edge, Brave, or Chromium starts.
Settings are merged into JSON on disk without adding automation switches or
changing the user's normal browser profile. The Python and Rust APIs use
`snake_case` option names.

| Default write                                                              | Why                                                            | Opt out                                                                                       |
| -------------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `<userDataDir>/First Run` empty sentinel                                   | Skip Chromium's first-run flow                                 | `firstRun: true` on a new profile (`first_run=True` in Python/Rust, `--first-run` in the CLI) |
| `Local State`: `browser.last_whats_new_version = 9999`                     | Keep the What's New tab from taking focus                      | `localState: { browser: { last_whats_new_version: 0 } }`                                      |
| `Local State`: `fre.has_user_seen_fre = true`                              | Keep Edge's welcome tab from taking focus                      | `localState: { fre: { has_user_seen_fre: false } }`                                           |
| `<profile>/Preferences`: `browser.session_restore_infobar_times_shown = 5` | Keep Chrome 155's "Continue where you left off" infobar closed | An explicit `preferences.browser.session_restore_infobar_times_shown`                         |
| `<profile>/Preferences`: `browser.check_default_browser = false`           | Compatibility with older Chromium's default browser check      | `defaultBrowserCheck: true` or an explicit `preferences.browser.check_default_browser`        |
| `Local State`: `browser.default_browser_infobar_declined_count = 5`        | Suppress the current Chromium infobar                          | `defaultBrowserCheck: true` or an explicit `localState` value                                 |
| `Local State`: `browser.default_browser_declined_count = 5`                | Suppress the current prompt surface experiment                 | `defaultBrowserCheck: true` or an explicit `localState` value                                 |

The last two entries are needed because current Chromium's
[prompt manager](https://github.com/chromium/chromium/blob/main/chrome/browser/ui/startup/default_browser_prompt/default_browser_prompt_manager.cc)
uses **Local State** counts. The older profile preference alone did not remove
the infobar in Chrome 153. `defaultBrowserCheck: true` writes zero for both
counts. User supplied `localState` values take precedence. The setting is
applied after migration and snapshot copy so a copied preference cannot restore
the prompt. With snapshot attach, `<profile>` is the selected profile directory.

Chrome 155 shows a session restore infobar ("Continue where you left off:
Chrome can restore your tabs every time you restart") in a new profile until
the profile's `browser.session_restore_infobar_times_shown` count reaches 3
(measured with `experiments/session-restore-infobar/probe.py`; Local State has
no effect). Browser Commander writes 5.

`preferences` and `localState` are JSON objects. They are recursively merged
into `Preferences` and `Local State`; other fields in an existing profile are
kept. `restrictions` and `args` still control the browser command line.

For example:

```js
await launchRealBrowser({
  defaultBrowserCheck: false,
  preferences: { download: { prompt_for_download: false } },
  localState: { fre: { has_user_seen_fre: false } },
});
```

The CLI accepts `--pref download.prompt_for_download=false`,
`--local-state fre.has_user_seen_fre=false`, and `--default-browser-check`.
Values after `=` are parsed as JSON when possible; plain text remains text.

## Session cookies of a persistent profile

With an explicit user data directory,
a profile directory is permanent storage: all cookies, session ones included, survive restarts.
Session cookies are cookies without an expiry date, the kind most logins
set. Chromium deletes them when a profile starts unless the last exit was a
crash or the startup setting is "Continue where you left off"
(`ProfileImpl::ShouldRestoreOldSessionCookies`). A normal `close()` is a clean
exit, so before issue #187 every restart of a persistent profile logged the
user out (`experiments/issue-187/repro.mjs`).

With an explicit `userDataDir` (`user_data_dir` in Python and Rust) every
entry point keeps them in the browser's own encrypted cookie store. No
plaintext file is written:

| Browser                         | Mechanism                                                                                                             | Measured with                                                |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Chrome, Edge, Brave, Chromium   | `--restore-last-session`; `<profile>/Sessions` and the legacy `Current/Last Session/Tabs` files are deleted first     | Chrome for Testing 153, Google Chrome 155 (`raw-chrome.mjs`) |
| Playwright headless             | The full Chromium build (`channel: 'chromium'`): chromium-headless-shell deletes session cookies even with the switch | Playwright chromium-1243 (`playwright-channel.mjs`)          |
| Firefox (selenium / fantoccini) | `browser.startup.page = 3` ("Open previous windows and tabs"); the restored tabs are closed after launch              | Firefox 158, geckodriver 0.37.1 (`firefox.mjs`)              |
| Safari                          | None: safaridriver has no profile directory. The result carries a `safari-no-profile-directory` warning               | -                                                            |

Deleting the session files drops only the tabs: cookies live in
`<profile>/Cookies`. The launch therefore still starts with its one driven
tab. `restoreTabs: true` (`restore_tabs`) keeps the files and reopens the last
session's tabs.

| Option                                        | Default                         | Effect                                                                                 |
| --------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------- |
| `keepSessionCookies` / `keep_session_cookies` | `true` with an explicit profile | `false` adds `--disable-features=SessionRestoreInfobar` so Chromium deletes them again |
| `restoreTabs` / `restore_tabs`                | `false`                         | Reopen the last session's tabs                                                         |
| CLI                                           | -                               | `--keep-session-cookies`, `--no-keep-session-cookies`, `--restore-tabs`                |

The opt-out also disables the `SessionRestoreInfobar` field trial, which makes
Chrome for Testing continue the last session by default. It is merged into any
other `--disable-features` list. A temporary profile gets no extra switch
unless the option is set explicitly, so its command line is unchanged.

Launch results report `keepSessionCookies` (`keep_session_cookies`) and
`warnings`. Each warning is
`{ item: 'keepSessionCookies', reason, detail }` in JavaScript and
`{ "item": "keep_session_cookies", "reason": ..., "detail": ... }` in Python
and Rust. The reasons are `safari-no-profile-directory` and `headless-shell`
(an explicitly selected chromium-headless-shell); JavaScript also returns
`attached-browser` when the selenium engine attaches to a browser at
`debuggerAddress` that it did not start.

Apps that start Chromium themselves and attach over CDP can use
`persistentProfileArgs()` (`persistent_profile_args()`), which returns
`['--restore-last-session']`, or the opt-out switch with
`keepSessionCookies: false`. `clearRestoredTabs(userDataDir)`
(`clear_restored_tabs()`) deletes the tabs first.

## Enterprise policies

Enterprise policies are outside the user data directory. Chromium reads Linux
managed files from system paths such as `/etc/opt/chrome/policies/managed/`;
Windows reads Group Policy and registry policy keys; macOS reads managed
preferences provided by the OS. These are system or OS-user settings that can
affect other browser windows. Browser Commander inherits installed policies
but does not write them. There is no safe per-launch `managedPolicies` JSON
file inside `<userDataDir>` to create on these platforms. Administrators can
install policies through their normal device management tools and confirm the
effective values at `chrome://policy`. See [Chromium's policy source
documentation](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/enterprise/policies.md)
and [Chrome's policy scopes](https://support.google.com/chrome/a/answer/9037717).

## Browser-window verification

`experiments/issue-110/capture-infobar.py` captures the **X11 browser window**
under Xvfb, rather than a page screenshot, and checks its infobar strip. The
before/after Chrome and Edge captures are in `docs/screenshots/issue-110/`.
The Browser Parity workflow runs this check with real Chrome.
Chrome 155's session restore infobar, before and after the profile pref, is
captured in `docs/screenshots/session-restore-infobar/`.
