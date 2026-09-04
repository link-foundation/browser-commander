//! Fingerprint parity between a real Chrome and a controlled one.
//!
//! The measured gap between a hand-started Chrome and an automated one is
//! recorded in `docs/case-studies/issue-79`. This module holds the launch-time
//! half of closing it, which is the half that needs no page script.

pub mod automation_parity;

pub use automation_parity::{
    apply_automation_parity_args, detect_automation_controlled_triggers,
    disables_automation_controlled, parity_ignored_default_args, AutomationTrigger,
    DetectedTrigger, AUTOMATION_CONTROLLED_OFF_ARG, AUTOMATION_CONTROLLED_TRIGGERS,
    PLAYWRIGHT_HEADLESS_POINTER_ARG,
};
