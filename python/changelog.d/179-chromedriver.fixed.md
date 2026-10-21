### Fixed

- Selenium starts or attaches to Chrome for Testing with the ChromeDriver of its own release (issue #179): a `chromedriver` on `PATH` belongs to the installed Google Chrome and refuses another release, yet Selenium Manager returns it even for a `--browser-path`, so it is now asked with `--skip-driver-in-path`. `ConnectOptions.executable_path` names the browser behind a Selenium `cdp_endpoint`, and the real-browser launch passes the browser it started.
