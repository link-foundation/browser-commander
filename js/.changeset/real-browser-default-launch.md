---
'browser-commander': minor
---

Launch the installed browser the way a person would, and make every restriction
opt-in (#101, #103).

`launchBrowser()` now starts the installed Chrome (or `channel`/
`executablePath`) itself and attaches over CDP. The whole command line is
`--user-data-dir=<fresh temporary profile> --remote-debugging-port=<reserved
port>`: no `--enable-automation`, no `--disable-blink-features`, so
`navigator.webdriver` is `false` and Chrome shows neither the "controlled by
automated test software" nor the unsupported-flag infobar. The temporary
profile is seeded with the `First Run` sentinel and a `Local State` entry that
keeps the "What's new" tab from stealing the foreground, and it is deleted on
close. `launch: 'engine'` keeps the Playwright/Puppeteer launcher.

The debugging port is reserved on loopback and its ownership is proven from the
browser's own `DevTools listening on` line, so a port lost to another process is
detected and the launch retried on a new port. Subprocesses are started through
`command-stream`.

Everything the library used to add on its own - `CHROME_ARGS`, the Google API
key override, the Translate preference, `--start-maximized` and `slowMo: 150` -
is gone from the defaults and available as named `restrictions` from the shared
`launch-restrictions.json` (`restrictions: ['legacy-defaults']` restores the old
switches). The host `process.env` is never modified; restriction environment
reaches the browser process only. `LAUNCH_MODES`, `LAUNCH_RESTRICTIONS`,
`LAUNCH_RESTRICTION_PRESETS`, `resolveRestrictions`, `mergeFeatureSwitches`,
`resolveLaunchExecutable`, the profile-directory helpers,
`reserveLoopbackPort` and `PortRaceError` are exported.
