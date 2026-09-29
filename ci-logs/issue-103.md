# Default launch is still far from a hand-started Chrome: ~35 engine switches, disabled Google services, a mutated host env, and a shared profile
## Requirement
The default mode must be **as close to a real, hand-started browser as possible**, with **no restricted features out of the box**. It must be a **fresh new instance** by default. Migrating data from the user's real browser, or attaching to its data folder, must be available as options (#102). #79 asked for "exactly 0 difference in any configuration between real browser and browser controlled by browser-commander", but the default launch still differs in many ways. Only `--enable-automation` and `--enable-unsafe-swiftshader` are stripped today (`ENGINE_PARITY_IGNORED_DEFAULT_ARGS`).

## Measured
macOS, Google Chrome 153, browser-commander 0.19.0 (the launch code is identical in 0.20.0), `launchBrowser({ engine: 'playwright', channel: 'chrome', userDataDir })`, reading the spawned Chrome's command line from `ps`. A hand-started Chrome has **none** of these switches:

```
--disable-field-trial-config --disable-background-networking --disable-background-timer-throttling
--disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad
--disable-client-side-phishing-detection --disable-component-extensions-with-background-pages
--disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage
--disable-edgeupdater --disable-extensions
--disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,DestroyProfileOnBrowserClose,DialMediaRouteProvider,
  GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,
  BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,...
--enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor
--disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost
--disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb
--metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun
--export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings
--edge-skip-compat-layer-relaunch --disable-sync
--disable-session-crashed-bubble --hide-crash-restore-bubble --disable-infobars (x2) --password-store=basic (x2)
--no-first-run (x2) --no-default-browser-check (x2) --disable-crash-restore
--disable-blink-features=AutomationControlled --remote-debugging-pipe
```

## Differences, grouped by impact
**Restricted features (the user can't do what a real Chrome allows):**
- **No extensions:** `--disable-extensions`, `--disable-component-extensions-with-background-pages`, `--disable-default-apps`.
- **No Chrome sign-in or sync:** `--disable-sync`, **and `launchBrowser` sets `process.env.GOOGLE_API_KEY`, `GOOGLE_DEFAULT_CLIENT_ID` and `GOOGLE_DEFAULT_CLIENT_SECRET` to `'no'`** (`launcher.js`). That overrides the keys built into official Chrome, disables Google services (sign-in, sync, Safe Browsing and others), and **changes the host process's environment**, which every child process then inherits. Measured: `process.env.GOOGLE_API_KEY === 'no'` after launch.
- **No OS keychain:** `--use-mock-keychain` and `--password-store=basic`. The password manager and cookie encryption don't use the Keychain, libsecret or DPAPI. This also makes **migrating** encrypted real-profile data (#102) impossible, because the dedicated profile can't decrypt it.
- **No Translate:** `--disable-features=Translate`, plus `disableTranslateInPreferences()` rewrites `Default/Preferences` on every launch.
- **No component updates:** `--disable-component-update`, which covers Widevine/DRM, CRLSets and Safe Browsing lists.
- **Weaker security:** `--disable-client-side-phishing-detection` and `--disable-features=HttpsUpgrades`.
- Media Router/Cast, global media controls and Lens are disabled.

**Differences a website can observe:**
- Popups are never blocked (`--disable-popup-blocking`).
- No back/forward cache (`--disable-back-forward-cache`): `pageshow.persisted` is always false.
- Third-party storage partitioning is off (`ThirdPartyStoragePartitioning`), so iframe storage behaves like old Chrome.
- Background timers are not throttled (`--disable-background-timer-throttling`, `--disable-renderer-backgrounding`, `--disable-backgrounding-occluded-windows`): hidden tabs keep full-speed timers.
- `--force-color-profile=srgb` changes rendered colours.
- `--disable-field-trial-config`: the browser runs without Chrome's normal variations/field trials.
- `--disable-blink-features=AutomationControlled` shows Chrome's **"You are using an unsupported command-line flag … Stability and security will suffer."** infobar (`--disable-infobars` no longer hides it).

**Defaults that make it harder to use and test:**
- The default profile is `~/.hh-apply/<engine>-data`. That's a leftover consumer name, and it's a **shared, persistent** profile rather than a fresh instance.
- `slowMo` is 150 ms by default for Playwright.
- Puppeteer adds `--start-maximized`.
- `CHROME_ARGS` duplicates engine switches (`--disable-infobars`, `--password-store=basic`, `--no-first-run`, `--no-default-browser-check`).

## Proposed default
1. **Default engine path = the real-browser launch** (spawn the installed Chrome yourself, then `connectOverCDP` / `puppeteer.connect`). The command line should be exactly `--user-data-dir=<fresh temp dir> --remote-debugging-port=<reserved free port>` (#101), and nothing else.
2. **Fresh by default:** a new temporary profile per launch, deleted on close. `userDataDir` is a persistent opt-in, and `migrateFrom`/attach are opt-ins (#102).
3. **Suppress the first-run UI without switches:** write the `First Run` sentinel file (and `Local State` fields, if needed) into the fresh profile instead of passing `--no-first-run`/`--no-default-browser-check`.
4. **Remove** the `process.env.GOOGLE_*` mutation, `disableTranslateInPreferences`, the default `slowMo`, `--start-maximized` and the duplicate `CHROME_ARGS`. Every restriction becomes an explicit, documented opt-in, for example `restrictions: ['no-extensions', 'no-sync', ...]` or the existing `args`.
5. **Playwright/Puppeteer-launched mode** stays available as an opt-in (`launch: 'engine'`) for headless and CI use, with its remaining differences listed in `limitations.json`.
6. **Easy to test:** export `measureParity()` (and a `browser-commander doctor` CLI). It launches a hand-started reference Chrome and a browser-commander Chrome side by side and diffs the command line (from the process list), `chrome://version`, feature state (`chrome://gpu` feature status, extensions, sync, keychain) and the page-visible probes from the fingerprint suite. CI fails on any difference that isn't listed in `limitations.json`. The same checks run for Edge, Brave and Chromium, and for the JS, Rust and Python implementations.

Related: #79 (parity goal), #101 (fixed port and webdriver in real-browser mode), #102 (migration, attach, open in the user's browser).
