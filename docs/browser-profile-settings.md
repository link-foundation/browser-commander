# Browser profile settings

`launchRealBrowser()` (and the default `launchBrowser()` path) prepares a
dedicated user data directory before Chrome, Edge, Brave, or Chromium starts.
Settings are merged into JSON on disk without adding automation switches or
changing the user's normal browser profile. The Python and Rust APIs use
`snake_case` option names.

| Default write                                                       | Why                                                       | Opt out                                                                                       |
| ------------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `<userDataDir>/First Run` empty sentinel                            | Skip Chromium's first-run flow                            | `firstRun: true` on a new profile (`first_run=True` in Python/Rust, `--first-run` in the CLI) |
| `Local State`: `browser.last_whats_new_version = 9999`              | Keep the What's New tab from taking focus                 | `localState: { browser: { last_whats_new_version: 0 } }`                                      |
| `Local State`: `fre.has_user_seen_fre = true`                       | Keep Edge's welcome tab from taking focus                 | `localState: { fre: { has_user_seen_fre: false } }`                                           |
| `<profile>/Preferences`: `browser.check_default_browser = false`    | Compatibility with older Chromium's default browser check | `defaultBrowserCheck: true` or an explicit `preferences.browser.check_default_browser`        |
| `Local State`: `browser.default_browser_infobar_declined_count = 5` | Suppress the current Chromium infobar                     | `defaultBrowserCheck: true` or an explicit `localState` value                                 |
| `Local State`: `browser.default_browser_declined_count = 5`         | Suppress the current prompt surface experiment            | `defaultBrowserCheck: true` or an explicit `localState` value                                 |

The last two entries are needed because current Chromium's
[prompt manager](https://github.com/chromium/chromium/blob/main/chrome/browser/ui/startup/default_browser_prompt/default_browser_prompt_manager.cc)
uses **Local State** counts. The older profile preference alone did not remove
the infobar in Chrome 153. `defaultBrowserCheck: true` writes zero for both
counts. User supplied `localState` values take precedence. The setting is
applied after migration and snapshot copy so a copied preference cannot restore
the prompt. With snapshot attach, `<profile>` is the selected profile directory.

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
