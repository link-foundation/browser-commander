### Added

- Native ChromeDriver/geckodriver launch through command-stream, complete typed Fantoccini access, optional BiDi, portable state, copied Chromium profiles and common-launcher integration.
- Managed WebDriver downloads through browser preferences and the native staging watcher, including Firefox `.part` files.

### Fixed

- Abandoned managed process groups are terminated even after their Tokio runtime shuts down.
- Engine launches apply arbitrary Chromium preferences and Local State before starting the browser.
