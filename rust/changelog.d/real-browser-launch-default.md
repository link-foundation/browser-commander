---
bump: minor
---

### Added
- A `browser-commander` binary with the shared JSON command and `serve
  --stdio` protocols. Browser commands use the companion JavaScript CLI
  through `command-stream`; `version` reports the crate version locally.
- Read-only profile migration before `launch_real_browser`, including a
  migration report and cookie seeding, plus `open_in_user_browser()` for
  opening a URL without automation.
- `LaunchMode` (`Real`, the default, or `Engine`) and `LAUNCH_MODES`, selected with `LaunchOptions::launch` (issue #103). A real launch starts the installed Chrome itself and attaches the engine over CDP, so the browser behaves like one a person started and `navigator.webdriver` stays false. Without a `channel` or `executable_path` the installed Google Chrome is preferred and the engine's own browser is the fallback.
- `LaunchOptions::restrictions`, `LaunchOptions::env` and `LaunchOptions::remote_debugging_port`. Restrictions come from the shared catalogue (the old defaults are the `legacy-defaults` preset). Their environment and `env` go to the browser process only; the caller's environment is never modified.
- `LaunchResult::close()` closes a launched browser and deletes its temporary profile. It does nothing for a browser attached with `connect_browser`.
- New `LaunchResult` metadata: `launch`, `temporary_profile`, `args`, `cdp_endpoint`, `remote_debugging_port`, `executable_path` and `browser_process`.
- `launch_real_browser` uses a fresh temporary profile unless `user_data_dir` is given (issue #101). The profile's `Local State` keeps Chrome's What's New tab and Edge's welcome tab closed.
- `connect_browser` and the real launch pick the visible tab rather than the first one, and apply `color_scheme` to it.

### Changed
- `launch_browser` starts every launch, in both modes, with a fresh temporary profile unless `user_data_dir` is set, instead of `~/.browser-commander/<engine>-data`.
- `CHROME_ARGS` are no longer added to every launch. The constant is kept and equals the `legacy-defaults` restriction preset.
- `LaunchOptions::playwright()` no longer sets `slow_mo` to 150; it is 0 for every engine.
- `LaunchOptions::all_chrome_args()` returns `anyhow::Result<Vec<String>>` (an unknown restriction is an error), and `ignore_default_args` no longer filters it.
- A real launch uses a reserved fixed DevTools port: port 0 is refused because it turns `navigator.webdriver` on.
- `RealBrowserOptions::remote_debugging_port` is an `Option<u16>`, and `build_real_browser_args` requires `user_data_dir` and `remote_debugging_port` to be set on the options (`launch_real_browser` picks both itself when they are unset).
- `--headless` is no longer treated as an AutomationControlled trigger, so a headless real launch has exactly `--user-data-dir`, `--remote-debugging-port`, `--headless=new` and the start URL.
- A real launch opens `about:blank`, as Puppeteer and Playwright do, unless the caller's arguments contain a URL (`START_URL`). Without it Microsoft Edge opened its new-profile welcome flow, which closed the window and exited the browser a few seconds after launch.
- `BrowserProcess::kill` returns whether a signal was sent, and `try_wait` was removed in favour of `is_running`, `wait_timeout` and `exited`.
- The Playwright and Puppeteer bridge no longer sets `GOOGLE_API_KEY`, `GOOGLE_DEFAULT_CLIENT_ID` or `GOOGLE_DEFAULT_CLIENT_SECRET` in its own environment, and no longer passes `--start-maximized`.

### Deprecated
- `LaunchOptions::get_user_data_dir`: `launch_browser` no longer uses that directory. Read `LaunchResult::browser.user_data_dir` instead.
