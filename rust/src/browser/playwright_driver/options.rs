//! Native driver configuration builders for real-browser launches.
use super::PlaywrightDriverOptions;
use crate::browser::real_browser::RealBrowserOptions;

impl RealBrowserOptions {
    /// Configure the command-stream-owned official Playwright driver.
    pub fn playwright_driver(mut self, options: PlaywrightDriverOptions) -> Self {
        self.playwright_driver = options;
        self
    }

    /// Explicitly opt into the legacy npm CLI bridge instead of the typed driver.
    pub fn playwright_bridge(mut self, enabled: bool) -> Self {
        self.playwright_bridge = enabled;
        self
    }
}
