# Real-browser sessions: start clean by default, offer opt-in migration from the main browser instance, and a no-automation 'open in the user's browser' mode
## Goal
Browsers spawned by browser-commander should differ from the user's real browser as little as possible:
- **Default:** a clean dedicated profile, where signing in with a Google account works (depends on #101).
- **Opt-in:** migrate data from the main instance of each installed browser into that dedicated profile.
- **When no automation is needed** (a consumer only has to show a URL, for example an OAuth or CLI web-login page): open it in the user's own default browser, where they are already signed in.

## What is technically possible (researched)
- **Driving the default profile directly is impossible by Chrome's design.** Since Chrome 136, `--remote-debugging-port`/`--remote-debugging-pipe` are ignored for the default user data directory; a non-default `--user-data-dir` is required ([Chrome blog](https://developer.chrome.com/blog/remote-debugging-port)). A dedicated profile is therefore the only way to automate. Migration and "open in the default browser" are how to close the gap.
- **Signing in with Google in a clean profile:** works once `navigator.webdriver` is false without the infobar switch (#101). After a Chrome sign-in, sync restores bookmarks, passwords, extensions and settings, so this is the most faithful "real browser" path. It's also what Chrome itself offers ("Make Chrome Your Own → Continue as …").
- **Migrating cookies** already exists (`readBrowserCookies` + `seedCookies`, #69). Caveat: Google has shipped Device Bound Session Credentials (Windows, Chrome 146; macOS with the Secure Enclave in a later release). Bound Google session cookies cannot be refreshed from another profile, because the key cannot leave the original one. So copied **Google** sessions will expire quickly, while most other sites' cookies keep working ([Chrome DBSC docs](https://developer.chrome.com/docs/web-platform/device-bound-session-credentials), [Help Net Security](https://www.helpnetsecurity.com/2026/04/10/google-chrome-device-bound-session-credentials/)). Migration should report this rather than fail silently.
- **Other profile data:**
  - Bookmarks: `Bookmarks` JSON, copy as is.
  - History and top sites: SQLite; copy a consistent snapshot through the SQLite backup API, because the source is locked while Chrome runs.
  - Saved passwords: `Login Data`, encrypted with the same OS-keystore key as cookies. That's the "Chrome Safe Storage" Keychain item on macOS, libsecret/KWallet on Linux, and DPAPI plus app-bound encryption on Windows. Re-encrypt them for the dedicated profile.
  - Preferences such as language, search engine and theme: a selected subset of `Preferences`.
  - Extensions: copy the unpacked `Extensions/<id>/<version>` plus their Preferences entries; policy-installed extensions excluded.
  - Firefox: a separate path for `cookies.sqlite` (plain), `places.sqlite` and `logins.json` (NSS key4.db).

## Proposed API
```js
const session = await launchRealBrowser({
  channel: 'chrome',
  userDataDir,                         // dedicated; clean by default
  migrateFrom: {                       // opt-in, off by default
    browser: 'chrome',                 // chrome | edge | brave | chromium | firefox
    profile: 'Default',
    include: ['cookies', 'bookmarks', 'history', 'passwords', 'preferences', 'extensions'],
    domains: ['npmjs.com', 'github.com'], // optional cookie filter
  },
});
// report: what was migrated, what was skipped and why (e.g. DBSC-bound Google cookies)

await openInUserBrowser(url);          // no automation: macOS `open`, Linux `xdg-open`, Windows `start`
```

## Acceptance
- Default launch is clean and passes a Google sign-in probe (enter an address that doesn't exist and expect "Couldn't find your Google Account", not "This browser or app may not be secure").
- Migration is opt-in, never touches the source profile (read-only snapshots), and works while the source browser is running.
- Tests cover macOS, Linux and Windows key handling, with fixtures for each data class.
- Same API in the JS, Rust and Python implementations.
