//! Fingerprint parity between a real Chrome and a controlled one.
//!
//! The modules here are pure data and pure functions: a profile describes the
//! environment a page is allowed to see, the presets are ready-made machines,
//! and automation parity removes the launch-time differences a controlled
//! browser would otherwise show. Nothing here opens a browser, so all of it is
//! unit tested without one. See `docs/case-studies/issue-79` for the
//! measurements these modules are built on.

pub mod apply;
pub mod automation_parity;
pub mod cdp_overrides;
pub mod derive;
pub mod init_script;
pub mod limitations;
pub mod presets;
pub mod profile;

pub use apply::{apply_fingerprint, AppliedFingerprint, ApplyOptions, CdpTransport};
pub use automation_parity::{
    apply_automation_parity_args, detect_automation_controlled_triggers,
    disables_automation_controlled, parity_ignored_default_args, AutomationTrigger,
    DetectedTrigger, AUTOMATION_CONTROLLED_OFF_ARG, AUTOMATION_CONTROLLED_TRIGGERS,
    PLAYWRIGHT_HEADLESS_POINTER_ARG, PLAYWRIGHT_SOFTWARE_WEBGL_ARG,
};
pub use cdp_overrides::{build_cdp_emulation_commands, CdpCommand};
pub use derive::derive_user_agent_data;
pub use init_script::{
    build_fingerprint_init_script, build_init_script_config, InitScriptOptions,
    FINGERPRINT_PAYLOAD_SOURCE,
};
pub use limitations::{
    find_fingerprint_limitation, relevant_fingerprint_limitations, FingerprintLimitation,
    LimitationContext, LimitationEvidence, LimitationSeverity, FINGERPRINT_LIMITATIONS,
    FINGERPRINT_LIMITATIONS_SOURCE,
};
pub use presets::{
    create_default_fingerprint_preset, create_fingerprint_preset, DEFAULT_CHROME_VERSION,
    FINGERPRINT_PRESET_NAMES,
};
pub use profile::{
    fingerprint_field_mechanism, resolve_fingerprint_profile, BrandVersion, ColorScheme,
    FieldMechanism, FingerprintProfile, ForcedColors, GeolocationProfile, ReducedMotion,
    ScreenProfile, UserAgentData, ViewportProfile, WebglProfile, FINGERPRINT_FIELD_MECHANISMS,
};
