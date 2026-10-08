//! Browser Commander - Universal Browser Automation Library
//!
//! A Rust library for browser automation that provides a unified API
//! for different browser automation engines.
//!
//! # Features
//!
//! - Unified API across multiple browser engines
//! - Built-in navigation safety handling
//! - Element visibility and scroll management
//! - Click, fill, and other interaction support with verification
//! - Async/await support with Tokio
//!
//! # Example
//!
//! ```rust,no_run
//! use browser_commander::browser::{launch_browser, LaunchOptions};
//!
//! #[tokio::main]
//! async fn main() -> anyhow::Result<()> {
//!     // Start the installed browser the way a person would, with a fresh
//!     // temporary profile, and attach the engine to it.
//!     let options = LaunchOptions::chromiumoxide().headless(true);
//!     let result = launch_browser(options).await?;
//!
//!     // The returned `page` is an `Arc<dyn EngineAdapter>` and can be
//!     // passed to any of the crate's navigation / interaction helpers.
//!     let page = result.page.as_ref();
//!     page.goto("https://example.com").await?;
//!     println!("Current URL: {}", page.url().await?);
//!
//!     // Stops the browser and deletes the temporary profile.
//!     result.close().await?;
//!     Ok(())
//! }
//! ```
//!
//! # Modules
//!
//! - [`core`] - Core types and traits (constants, engine adapter, logger)
//! - [`elements`] - Element operations (selectors, visibility, content)
//! - [`interactions`] - User interactions (click, scroll, fill)
//! - [`browser`] - Browser management (launcher, navigation)
//! - [`downloads`] - Managed, persistent downloads (manager, store, sources)
//! - [`fingerprint`] - Fingerprint parity with a hand-started browser (profiles,
//!   presets, automation parity)
//! - [`puppeteer`] - Typed Puppeteer API over the JavaScript CLI's bridge
//! - [`traces`] - Recording, reading and exporting privacy-aware portable trace
//!   bundles
//! - [`utilities`] - General utilities (URL handling, wait operations)
//! - [`high_level`] - High-level DRY utilities

pub mod browser;
pub mod core;
pub mod downloads;
pub mod elements;
pub mod fingerprint;
pub mod high_level;
pub mod interactions;
pub mod playwright;
pub mod puppeteer;
pub mod traces;
pub mod utilities;

pub use browser::extension_relay::{
    attach_via_extension, write_extension_directory, ExtensionRelay, RelayError, RelayEvent,
    RelayExtension, RelayOptions, RelaySession, RelayTab,
};
pub use browser::parity;
pub use browser::webdriver::{
    launch_webdriver, launch_webdriver_snapshot, ManagedWebDriver, WebDriverBrowser,
    WebDriverClient, WebDriverOptions, WebDriverSnapshotResult,
};
pub use browser::{
    clear_cookies, find_site_sessions, read_browser_cookie_session, set_cookies, SessionSource,
    SessionValidator, SiteSession,
};
pub use elements::{check, find_first, has_text, is_checked};
pub use high_level::{
    find_toggle_button_with_texts, read_flag, uninstall_click_listener, FlagRead,
};
pub use parity::{measure_parity, measure_session_parity, MeasureParityOptions, ParityReport};

// Re-export commonly used items at crate root
pub use browser::snapshot::{
    launch_snapshot, snapshot_user_data_dir, SnapshotLaunchResult, SnapshotOptions, SnapshotReport,
};
pub use browser::{
    browser_family, browser_for_identifier, browser_ids, browser_sources, build_real_browser_args,
    clear_browser_cookie_memory_cache, connect_browser, default_browser_identifiers,
    default_run_command, emulate_media, find_browser_source, is_default_browser_keyword,
    is_single_profile_browser, launch_and_connect_real_browser, launch_browser,
    launch_real_browser, launch_restrictions, list_browser_profiles, list_cookie_sources,
    normalize_browser_id, parse_mac_launch_services_handler, parse_windows_prog_id,
    read_browser_cookies, resolve_browser_roots, resolve_default_browser, resolve_import_source,
    resolve_restrictions, resolve_source_browser, safe_storage_identity, save_storage_state,
    Browser, BrowserCookie, BrowserCookieReadOptions, BrowserProcess, BrowserProfile,
    BrowserProfileOptions, BrowserSource, ChromiumoxidePage, ColorScheme, ConnectOptions,
    CookieSourceListing, EmulateMediaOptions, Environment, ImportSource, LaunchMode, LaunchOptions,
    LaunchRestriction, LaunchResult, NodeBridgePage, PlaywrightConnect, PlaywrightDriverPage,
    PlaywrightLaunch, RealBrowserLaunchResult, RealBrowserOptions, RunCommand, SafeStorageIdentity,
    StorageEntry, StorageOrigin, StorageState, StorageStateInput, LAUNCH_MODES,
    SUPPORTED_COOKIE_BROWSERS,
};
pub use core::{
    DialogEvent, DialogManager, DialogType, EngineAdapter, EngineError, EngineType, Logger,
    LoggerOptions, PdfOptions, Timing, CHROME_ARGS, TIMING,
};
pub use downloads::{
    attach_downloads, normalize_download_options, supported_engine, CaptureOptions,
    DownloadArtifact, DownloadConflict, DownloadError, DownloadEvent, DownloadManager,
    DownloadNamer, DownloadNaming, DownloadOptions, DownloadSetting, DownloadValidator,
    DEFAULT_CAPTURE_TIMEOUT,
};
// `fingerprint::ColorScheme` is the CSS preference a page reads, while
// `browser::ColorScheme` is the one `emulate_media` writes, so the fingerprint
// one is re-exported under a qualified name instead of shadowing it.
pub use fingerprint::{
    apply_automation_parity_args, apply_fingerprint, build_cdp_emulation_commands,
    build_fingerprint_init_script, build_init_script_config, create_default_fingerprint_preset,
    create_fingerprint_preset, derive_user_agent_data, detect_automation_controlled_triggers,
    disables_automation_controlled, find_fingerprint_limitation, fingerprint_field_mechanism,
    parity_ignored_default_args, relevant_fingerprint_limitations, resolve_fingerprint_profile,
    AppliedFingerprint, ApplyOptions, AutomationTrigger, BrandVersion, CdpCommand, CdpTransport,
    ColorScheme as FingerprintColorScheme, DetectedTrigger, FieldMechanism, FingerprintLimitation,
    FingerprintProfile, ForcedColors, GeolocationProfile, InitScriptOptions, LimitationContext,
    LimitationEvidence, LimitationSeverity, ReducedMotion, ScreenProfile, UserAgentData,
    ViewportProfile, WebglProfile, AUTOMATION_CONTROLLED_OFF_ARG, AUTOMATION_CONTROLLED_TRIGGERS,
    DEFAULT_CHROME_VERSION, FINGERPRINT_FIELD_MECHANISMS, FINGERPRINT_LIMITATIONS,
    FINGERPRINT_LIMITATIONS_SOURCE, FINGERPRINT_PAYLOAD_SOURCE, FINGERPRINT_PRESET_NAMES,
    PLAYWRIGHT_HEADLESS_POINTER_ARG, PLAYWRIGHT_SOFTWARE_WEBGL_ARG,
};

// Reading trace bundles needs no engine, so the reader is available at the
// crate root like any other pure helper; recording sits beside it.
pub use traces::{
    diff_control_state, parse_ndjson, read_trace, ControlChange, ControlChangeKind, ParsedNdjson,
    Trace, TraceCheckpoint, TraceCheckpointReason, TraceError, TraceEvent, TraceFiles,
    TraceLiveState, TraceManifest, TraceMode, TraceMutationKind, TraceOutcome, TraceReplaySupport,
    TRACE_EVENT_SOURCES, TRACE_FORMAT, TRACE_SCHEMA_VERSION,
};
pub use traces::{
    start_trace, trace_links, write_trace_links, write_trace_viewer, AdapterTracePage,
    TraceCheckpointOptions, TraceLinksOptions, TraceOptions, TraceRecordError, TraceRecorder,
    TraceResult, TraceStopOptions,
};

/// Prelude module for convenient imports.
///
/// Import everything commonly needed with:
/// ```rust
/// use browser_commander::prelude::*;
/// ```
pub mod prelude {
    pub use crate::browser::{
        clear_browser_cookie_memory_cache, connect_browser, emulate_media, goto,
        launch_and_connect_real_browser, launch_browser, launch_real_browser,
        list_browser_profiles, read_browser_cookies, verify_navigation, wait_for_navigation,
        wait_for_url_stabilization, Browser, BrowserCookie, BrowserCookieReadOptions,
        BrowserProcess, BrowserProfile, BrowserProfileOptions, ColorScheme, ConnectOptions,
        EmulateMediaOptions, LaunchMode, LaunchOptions, LaunchResult, NavigationOptions,
        NavigationResult, RealBrowserLaunchResult, RealBrowserOptions, WaitUntil,
    };
    pub use crate::core::{
        is_navigation_error, is_timeout_error, DialogEvent, DialogManager, DialogType,
        EngineAdapter, EngineError, EngineType, Logger, LoggerOptions, PdfOptions, Timing,
        CHROME_ARGS, TIMING,
    };
    pub use crate::downloads::{
        attach_downloads, normalize_download_options, CaptureOptions, DownloadArtifact,
        DownloadConflict, DownloadError, DownloadEvent, DownloadManager, DownloadOptions,
        DownloadSetting,
    };
    pub use crate::elements::{
        count, get_attribute, input_value, is_enabled, is_visible, normalize_selector,
        text_content, ParsedSelector,
    };
    pub use crate::fingerprint::{
        apply_automation_parity_args, apply_fingerprint, build_cdp_emulation_commands,
        build_fingerprint_init_script, build_init_script_config, create_default_fingerprint_preset,
        create_fingerprint_preset, derive_user_agent_data, detect_automation_controlled_triggers,
        disables_automation_controlled, find_fingerprint_limitation, fingerprint_field_mechanism,
        parity_ignored_default_args, relevant_fingerprint_limitations, resolve_fingerprint_profile,
        AppliedFingerprint, ApplyOptions, AutomationTrigger, BrandVersion, CdpCommand,
        CdpTransport, ColorScheme as FingerprintColorScheme, DetectedTrigger, FieldMechanism,
        FingerprintLimitation, FingerprintProfile, ForcedColors, GeolocationProfile,
        InitScriptOptions, LimitationContext, LimitationEvidence, LimitationSeverity,
        ReducedMotion, ScreenProfile, UserAgentData, ViewportProfile, WebglProfile,
        AUTOMATION_CONTROLLED_OFF_ARG, AUTOMATION_CONTROLLED_TRIGGERS, DEFAULT_CHROME_VERSION,
        FINGERPRINT_FIELD_MECHANISMS, FINGERPRINT_LIMITATIONS, FINGERPRINT_LIMITATIONS_SOURCE,
        FINGERPRINT_PAYLOAD_SOURCE, FINGERPRINT_PRESET_NAMES, PLAYWRIGHT_HEADLESS_POINTER_ARG,
        PLAYWRIGHT_SOFTWARE_WEBGL_ARG,
    };
    pub use crate::high_level::{
        check_and_clear_flag, find_toggle_button, install_click_listener, wait_for_url_condition,
    };
    pub use crate::interactions::{
        click_button, click_element, fill_text_area, key_down, key_up, perform_fill, press_key,
        scroll_into_view, scroll_into_view_if_needed, type_text, ActivationOptions,
        ClickActionability, ClickActivation, ClickDispatchError, ClickEffect, ClickOptions,
        ClickResult, ClickScroll, ClickStatus, Evidence, FillOptions, FillResult, ScrollBehavior,
        ScrollOptions, ScrollResult,
    };
    pub use crate::traces::{
        diff_control_state, parse_ndjson, read_trace, start_trace, write_trace_viewer,
        AdapterTracePage, ControlChange, ControlChangeKind, Trace, TraceCheckpoint,
        TraceCheckpointReason, TraceError, TraceEvent, TraceFiles, TraceLiveState, TraceManifest,
        TraceMode, TraceMutationKind, TraceOptions, TraceOutcome, TraceRecorder,
        TraceReplaySupport, TRACE_SCHEMA_VERSION,
    };
    pub use crate::utilities::{
        evaluate, get_domain, get_url, parse_url, safe_evaluate, same_origin, unfocus_address_bar,
        wait, wait_with_cancel, WaitResult,
    };
}

pub use browser::launch_diagnostics::{BrowserLaunchError, DiagnosticRedactor};
pub use elements::visibility::is_enabled_at;
