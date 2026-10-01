//! Harness crate: the real trace sources, plus the engine trait they drive.
#![allow(dead_code)]

#[path = "../../../rust/src/traces/mod.rs"]
pub mod traces;

#[path = "../../../rust/src/core/engine.rs"]
#[doc(hidden)]
pub mod engine_source;

#[path = "../../../rust/src/interactions/click_result.rs"]
#[doc(hidden)]
pub mod click_result_source;

pub mod core {
    pub use super::engine_source as engine;
    pub use super::engine_source::{EngineAdapter, EngineError, TraceEngineEvent};
}

pub mod interactions {
    pub use super::click_result_source as click_result;
}

/// The chromiumoxide adapter's CDP event translation, which holds no CDP types.
#[path = "../../../rust/src/browser/cdp_trace_events.rs"]
mod cdp_trace_events;

/// Stand-ins for the real launcher, with its signatures, so the ignored
/// real-browser trace test type-checks here; they never start a browser.
mod real_browser_stand_in {
    use std::path::PathBuf;
    use std::sync::Arc;
    use std::time::Duration;

    use crate::core::{EngineAdapter, EngineError};

    #[derive(Debug, Default)]
    pub struct RealBrowserOptions;

    impl RealBrowserOptions {
        pub fn chromiumoxide() -> Self {
            Self
        }
        pub fn executable_path(self, _executable_path: impl Into<PathBuf>) -> Self {
            self
        }
        pub fn headless(self, _headless: bool) -> Self {
            self
        }
        pub fn startup_timeout(self, _timeout: Duration) -> Self {
            self
        }
        pub fn with_args(self, _args: Vec<String>) -> Self {
            self
        }
    }

    pub struct RealBrowserLaunchResult {
        pub page: Arc<dyn EngineAdapter>,
    }

    impl RealBrowserLaunchResult {
        pub async fn close(&self) -> Result<(), EngineError> {
            Ok(())
        }
    }

    pub async fn launch_real_browser(
        _options: RealBrowserOptions,
    ) -> Result<RealBrowserLaunchResult, EngineError> {
        Err(EngineError::Browser(
            "the trace harness cannot launch a browser".into(),
        ))
    }
}

pub use real_browser_stand_in::{launch_real_browser, RealBrowserOptions};
