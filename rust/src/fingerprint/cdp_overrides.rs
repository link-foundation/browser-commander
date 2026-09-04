//! Translate a fingerprint profile into CDP `Emulation` commands.
//!
//! These are the overrides Chrome itself enforces. They apply to workers and to
//! outgoing HTTP headers, not only to the main world, which is what makes them
//! strictly better than patching JavaScript properties. Anything that has no
//! command here needs a page init script instead; [`super::init_script`]
//! carries the weaker half and `docs/case-studies/issue-79/requirements.md`
//! records why.
//!
//! This is the Rust side of `js/src/fingerprint/cdp-overrides.js`; the command
//! list is asserted field by field in every language so the three cannot drift.

use serde::Serialize;
use serde_json::{json, Map, Value};

use super::profile::{FingerprintProfile, UserAgentData};

/// One protocol call: a method name and its parameters.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CdpCommand {
    /// The CDP method, for example `Emulation.setUserAgentOverride`.
    pub method: &'static str,
    /// The parameters, shaped exactly as the protocol expects them.
    pub params: Value,
}

impl CdpCommand {
    fn new(method: &'static str, params: Value) -> Self {
        Self { method, params }
    }
}

fn insert_if_some<T: Serialize>(params: &mut Map<String, Value>, key: &str, value: &Option<T>) {
    if let Some(value) = value {
        params.insert(key.to_string(), json!(value));
    }
}

fn user_agent_metadata(data: &UserAgentData) -> Value {
    // platform, platformVersion, architecture, model and mobile are required by
    // the protocol; Chrome rejects the command when any of them is missing.
    let mut metadata = Map::new();
    metadata.insert(
        "platform".to_string(),
        json!(data.platform.clone().unwrap_or_default()),
    );
    metadata.insert(
        "platformVersion".to_string(),
        json!(data.platform_version.clone().unwrap_or_default()),
    );
    metadata.insert(
        "architecture".to_string(),
        json!(data.architecture.clone().unwrap_or_default()),
    );
    metadata.insert(
        "model".to_string(),
        json!(data.model.clone().unwrap_or_default()),
    );
    metadata.insert("mobile".to_string(), json!(data.mobile.unwrap_or(false)));
    insert_if_some(&mut metadata, "brands", &data.brands);
    insert_if_some(&mut metadata, "fullVersionList", &data.full_version_list);
    insert_if_some(&mut metadata, "bitness", &data.bitness);
    // Deprecated in the protocol, but `fullVersionList` does not cover the
    // `uaFullVersion` hint: without this the page still reads the real Chrome
    // build number.
    insert_if_some(&mut metadata, "fullVersion", &data.full_version);
    insert_if_some(&mut metadata, "wow64", &data.wow64);
    insert_if_some(&mut metadata, "formFactors", &data.form_factors);
    Value::Object(metadata)
}

fn user_agent_command(profile: &FingerprintProfile) -> Option<CdpCommand> {
    if profile.user_agent.is_none() && profile.accept_language.is_none() {
        return None;
    }
    let mut params = Map::new();
    // userAgent is a required parameter even when only the language changes.
    params.insert(
        "userAgent".to_string(),
        json!(profile.user_agent.clone().unwrap_or_default()),
    );
    insert_if_some(&mut params, "acceptLanguage", &profile.accept_language);
    insert_if_some(&mut params, "platform", &profile.platform);
    if let Some(data) = &profile.user_agent_data {
        params.insert("userAgentMetadata".to_string(), user_agent_metadata(data));
    }
    Some(CdpCommand::new(
        "Emulation.setUserAgentOverride",
        Value::Object(params),
    ))
}

fn device_metrics(profile: &FingerprintProfile) -> Option<Value> {
    if profile.viewport.is_none() && profile.screen.is_none() {
        return None;
    }
    let viewport = profile.viewport.clone().unwrap_or_default();
    let mut params = Map::new();
    // 0 means "no override" for the viewport, so a profile that only sets
    // screen dimensions still leaves the real window size alone.
    params.insert("width".to_string(), json!(viewport.width.unwrap_or(0)));
    params.insert("height".to_string(), json!(viewport.height.unwrap_or(0)));
    params.insert(
        "deviceScaleFactor".to_string(),
        json!(viewport.device_scale_factor.unwrap_or(0.0)),
    );
    params.insert(
        "mobile".to_string(),
        json!(viewport.mobile.unwrap_or(false)),
    );
    // The profile guarantees width and height come as a pair, so the page never
    // sees a screen with one dimension overridden and the other real.
    if let Some(screen) = &profile.screen {
        if let (Some(width), Some(height)) = (screen.width, screen.height) {
            params.insert("screenWidth".to_string(), json!(width));
            params.insert("screenHeight".to_string(), json!(height));
        }
    }
    Some(Value::Object(params))
}

fn emulated_media_features(profile: &FingerprintProfile) -> Vec<Value> {
    let mut features = Vec::new();
    if let Some(value) = &profile.reduced_motion {
        features.push(json!({"name": "prefers-reduced-motion", "value": value}));
    }
    if let Some(value) = &profile.forced_colors {
        features.push(json!({"name": "forced-colors", "value": value}));
    }
    if let Some(value) = &profile.color_scheme {
        features.push(json!({"name": "prefers-color-scheme", "value": value}));
    }
    features
}

/// Build the ordered CDP command list for a normalized profile.
pub fn build_cdp_emulation_commands(profile: &FingerprintProfile) -> Vec<CdpCommand> {
    let mut commands = Vec::new();

    if let Some(command) = user_agent_command(profile) {
        commands.push(command);
    }

    if let Some(timezone_id) = &profile.timezone_id {
        commands.push(CdpCommand::new(
            "Emulation.setTimezoneOverride",
            json!({ "timezoneId": timezone_id }),
        ));
    }

    if let Some(locale) = &profile.locale {
        commands.push(CdpCommand::new(
            "Emulation.setLocaleOverride",
            json!({ "locale": locale }),
        ));
    }

    if let Some(hardware_concurrency) = profile.hardware_concurrency {
        commands.push(CdpCommand::new(
            "Emulation.setHardwareConcurrencyOverride",
            json!({ "hardwareConcurrency": hardware_concurrency }),
        ));
    }

    if let Some(metrics) = device_metrics(profile) {
        commands.push(CdpCommand::new(
            "Emulation.setDeviceMetricsOverride",
            metrics,
        ));
    }

    if let Some(max_touch_points) = profile.max_touch_points {
        commands.push(CdpCommand::new(
            "Emulation.setTouchEmulationEnabled",
            json!({
                "enabled": max_touch_points > 0,
                "maxTouchPoints": max_touch_points.max(1),
            }),
        ));
    }

    let features = emulated_media_features(profile);
    if !features.is_empty() {
        commands.push(CdpCommand::new(
            "Emulation.setEmulatedMedia",
            json!({ "features": features }),
        ));
    }

    if let Some(geolocation) = &profile.geolocation {
        commands.push(CdpCommand::new(
            "Emulation.setGeolocationOverride",
            json!(geolocation),
        ));
    }

    commands
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fingerprint::presets::create_default_fingerprint_preset;
    use crate::fingerprint::profile::{
        ColorScheme, ForcedColors, GeolocationProfile, ReducedMotion, ScreenProfile,
        ViewportProfile,
    };

    const WINDOWS_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) \
         AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.7000.55 Safari/537.36";

    fn commands(profile: FingerprintProfile) -> Vec<CdpCommand> {
        build_cdp_emulation_commands(&profile.resolve().expect("profile resolves"))
    }

    fn methods(profile: FingerprintProfile) -> Vec<&'static str> {
        commands(profile)
            .into_iter()
            .map(|command| command.method)
            .collect()
    }

    fn params(profile: FingerprintProfile, method: &str) -> Value {
        commands(profile)
            .into_iter()
            .find(|command| command.method == method)
            .unwrap_or_else(|| panic!("{method} was not sent"))
            .params
    }

    #[test]
    fn emits_nothing_for_an_empty_profile() {
        assert!(commands(FingerprintProfile::default()).is_empty());
    }

    #[test]
    fn sends_only_the_commands_the_profile_asks_for() {
        assert_eq!(
            methods(FingerprintProfile::default().timezone_id("Europe/Berlin")),
            vec!["Emulation.setTimezoneOverride"]
        );
        assert_eq!(
            methods(FingerprintProfile::default().hardware_concurrency(4)),
            vec!["Emulation.setHardwareConcurrencyOverride"]
        );
    }

    #[test]
    fn keeps_a_stable_command_order_for_a_full_profile() {
        let profile = FingerprintProfile::default()
            .user_agent(WINDOWS_USER_AGENT)
            .timezone_id("Europe/Berlin")
            .locale("de-DE")
            .hardware_concurrency(12)
            .screen(ScreenProfile {
                width: Some(2560),
                height: Some(1440),
                ..ScreenProfile::default()
            })
            .viewport(ViewportProfile {
                width: Some(1280),
                height: Some(720),
                ..ViewportProfile::default()
            })
            .max_touch_points(0)
            .color_scheme(ColorScheme::Dark)
            .geolocation(GeolocationProfile {
                latitude: 52.52,
                longitude: 13.405,
                accuracy: Some(20.0),
            });

        assert_eq!(
            methods(profile),
            vec![
                "Emulation.setUserAgentOverride",
                "Emulation.setTimezoneOverride",
                "Emulation.setLocaleOverride",
                "Emulation.setHardwareConcurrencyOverride",
                "Emulation.setDeviceMetricsOverride",
                "Emulation.setTouchEmulationEnabled",
                "Emulation.setEmulatedMedia",
                "Emulation.setGeolocationOverride",
            ]
        );
    }

    #[test]
    fn supplies_the_required_empty_user_agent_when_only_the_language_changes() {
        let params = params(
            FingerprintProfile::default().languages(["fr-FR", "fr"]),
            "Emulation.setUserAgentOverride",
        );

        // userAgent is a required protocol parameter; an empty string means
        // "leave it alone" while acceptLanguage still takes effect.
        assert_eq!(params["userAgent"], json!(""));
        assert_eq!(params["acceptLanguage"], json!("fr-FR,fr"));
    }

    #[test]
    fn carries_the_client_hints_including_the_deprecated_full_version() {
        let params = params(
            FingerprintProfile::default()
                .user_agent(WINDOWS_USER_AGENT)
                .platform("Win32"),
            "Emulation.setUserAgentOverride",
        );
        let metadata = &params["userAgentMetadata"];

        assert_eq!(params["platform"], json!("Win32"));
        assert_eq!(metadata["platform"], json!("Windows"));
        // fullVersionList does not cover the uaFullVersion hint, so the
        // deprecated fullVersion field has to travel with it.
        assert_eq!(metadata["fullVersion"], json!("140.0.7000.55"));
        assert_eq!(metadata["bitness"], json!("64"));
        assert_eq!(metadata["wow64"], json!(false));
        assert_eq!(metadata["formFactors"], json!(["Desktop"]));
    }

    #[test]
    fn always_fills_the_protocol_required_metadata_fields() {
        let params = params(
            FingerprintProfile::default()
                .user_agent("custom agent")
                .user_agent_data(UserAgentData {
                    brands: Some(vec![crate::fingerprint::profile::BrandVersion {
                        brand: "Custom".to_string(),
                        version: "1".to_string(),
                    }]),
                    ..UserAgentData::default()
                }),
            "Emulation.setUserAgentOverride",
        );
        let metadata = params["userAgentMetadata"]
            .as_object()
            .expect("metadata object");

        // Chrome rejects setUserAgentOverride when any of these is missing.
        for field in [
            "platform",
            "platformVersion",
            "architecture",
            "model",
            "mobile",
        ] {
            assert!(metadata.contains_key(field), "{field} must be present");
        }
        assert_eq!(metadata["mobile"], json!(false));
        assert!(!metadata.contains_key("bitness"));
    }

    #[test]
    fn leaves_the_window_size_alone_when_only_the_screen_is_described() {
        let params = params(
            FingerprintProfile::default().screen(ScreenProfile {
                width: Some(2560),
                height: Some(1440),
                ..ScreenProfile::default()
            }),
            "Emulation.setDeviceMetricsOverride",
        );

        // Zeroes mean "no override" for the viewport, so a screen-only profile
        // does not resize the window it was applied to.
        assert_eq!(
            params,
            json!({
                "width": 0,
                "height": 0,
                "deviceScaleFactor": 0.0,
                "mobile": false,
                "screenWidth": 2560,
                "screenHeight": 1440,
            })
        );
    }

    #[test]
    fn sends_the_viewport_without_screen_dimensions_when_no_screen_is_set() {
        let params = params(
            FingerprintProfile::default().viewport(ViewportProfile {
                width: Some(1280),
                height: Some(720),
                device_scale_factor: Some(2.0),
                mobile: Some(true),
            }),
            "Emulation.setDeviceMetricsOverride",
        );

        assert_eq!(
            params,
            json!({
                "width": 1280,
                "height": 720,
                "deviceScaleFactor": 2.0,
                "mobile": true,
            })
        );
    }

    #[test]
    fn disables_touch_emulation_for_a_profile_that_names_zero_touch_points() {
        // maxTouchPoints must stay at least 1 because the protocol rejects 0,
        // so "no touch" is expressed through enabled instead.
        assert_eq!(
            params(
                FingerprintProfile::default().max_touch_points(0),
                "Emulation.setTouchEmulationEnabled"
            ),
            json!({ "enabled": false, "maxTouchPoints": 1 })
        );
        assert_eq!(
            params(
                FingerprintProfile::default().max_touch_points(5),
                "Emulation.setTouchEmulationEnabled"
            ),
            json!({ "enabled": true, "maxTouchPoints": 5 })
        );
    }

    #[test]
    fn collects_every_media_preference_into_a_single_command() {
        assert_eq!(
            params(
                FingerprintProfile::default()
                    .color_scheme(ColorScheme::Dark)
                    .reduced_motion(ReducedMotion::Reduce)
                    .forced_colors(ForcedColors::Active),
                "Emulation.setEmulatedMedia"
            ),
            json!({
                "features": [
                    { "name": "prefers-reduced-motion", "value": "reduce" },
                    { "name": "forced-colors", "value": "active" },
                    { "name": "prefers-color-scheme", "value": "dark" },
                ]
            })
        );
    }

    #[test]
    fn passes_geolocation_through_as_the_protocol_spells_it() {
        assert_eq!(
            params(
                FingerprintProfile::default().geolocation(GeolocationProfile {
                    latitude: 48.85,
                    longitude: 2.35,
                    accuracy: Some(10.0),
                }),
                "Emulation.setGeolocationOverride"
            ),
            json!({ "latitude": 48.85, "longitude": 2.35, "accuracy": 10.0 })
        );
    }

    // A preset is the shape most callers send, so the whole command list for one
    // is worth pinning: a field that silently stops being emulated is exactly
    // the regression this module exists to prevent.
    #[test]
    fn sends_every_browser_enforced_field_of_a_preset() {
        let profile = create_default_fingerprint_preset("android-chrome").expect("preset builds");
        let commands = build_cdp_emulation_commands(&profile);
        let methods: Vec<_> = commands.iter().map(|command| command.method).collect();

        assert_eq!(
            methods,
            vec![
                "Emulation.setUserAgentOverride",
                "Emulation.setTimezoneOverride",
                "Emulation.setLocaleOverride",
                "Emulation.setHardwareConcurrencyOverride",
                "Emulation.setDeviceMetricsOverride",
                "Emulation.setTouchEmulationEnabled",
            ]
        );
        assert_eq!(
            commands[0].params["userAgentMetadata"]["mobile"],
            json!(true)
        );
    }
}
