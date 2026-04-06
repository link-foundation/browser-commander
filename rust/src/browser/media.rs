//! Media emulation for browser automation.
//!
//! Provides unified color scheme emulation across browser engines.

use crate::core::engine::EngineType;

/// Supported color scheme values for media emulation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ColorScheme {
    /// Light color scheme (`prefers-color-scheme: light`).
    Light,
    /// Dark color scheme (`prefers-color-scheme: dark`).
    Dark,
    /// No preference (`prefers-color-scheme: no-preference`).
    NoPreference,
}

impl ColorScheme {
    /// Returns the string value used in CDP and browser APIs.
    pub fn as_str(&self) -> &'static str {
        match self {
            ColorScheme::Light => "light",
            ColorScheme::Dark => "dark",
            ColorScheme::NoPreference => "no-preference",
        }
    }
}

impl std::fmt::Display for ColorScheme {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

impl std::str::FromStr for ColorScheme {
    type Err = anyhow::Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "light" => Ok(ColorScheme::Light),
            "dark" => Ok(ColorScheme::Dark),
            "no-preference" => Ok(ColorScheme::NoPreference),
            _ => Err(anyhow::anyhow!(
                "Invalid color scheme: \"{}\". Expected one of: light, dark, no-preference",
                s
            )),
        }
    }
}

/// Options for media emulation.
#[derive(Debug, Clone)]
pub struct EmulateMediaOptions {
    /// The color scheme to emulate. `None` resets the emulation.
    pub color_scheme: Option<ColorScheme>,
    /// The engine type to use.
    pub engine: EngineType,
}

impl EmulateMediaOptions {
    /// Create options with a specific color scheme for the given engine.
    pub fn new(engine: EngineType, color_scheme: Option<ColorScheme>) -> Self {
        Self {
            color_scheme,
            engine,
        }
    }

    /// Create options for dark color scheme.
    pub fn dark(engine: EngineType) -> Self {
        Self::new(engine, Some(ColorScheme::Dark))
    }

    /// Create options for light color scheme.
    pub fn light(engine: EngineType) -> Self {
        Self::new(engine, Some(ColorScheme::Light))
    }

    /// Create options for no-preference color scheme.
    pub fn no_preference(engine: EngineType) -> Self {
        Self::new(engine, Some(ColorScheme::NoPreference))
    }

    /// Create options to reset color scheme emulation.
    pub fn reset(engine: EngineType) -> Self {
        Self::new(engine, None)
    }
}

/// Emulate media features (e.g. `prefers-color-scheme`) for a browser page.
///
/// # Note
///
/// This is a placeholder implementation. The actual implementation requires
/// integration with a live browser page object from chromiumoxide or fantoccini.
///
/// For chromiumoxide, use `Page::emulate_media` or send a CDP command:
/// ```text
/// Emulation.setEmulatedMedia with features: [{name: "prefers-color-scheme", value: "dark"}]
/// ```
///
/// For fantoccini (WebDriver), use Chrome DevTools Protocol via the session:
/// ```text
/// session.issue_cmd(Command::CustomCommand("Emulation.setEmulatedMedia", params))
/// ```
///
/// # Arguments
///
/// * `options` - The emulate media options
///
/// # Errors
///
/// Returns an error if the engine is unsupported.
pub async fn emulate_media(options: EmulateMediaOptions) -> Result<(), anyhow::Error> {
    match options.engine {
        EngineType::Chromiumoxide | EngineType::Fantoccini => {
            // Placeholder: actual implementation would send CDP command to the page:
            // Emulation.setEmulatedMedia with features: [{ name: "prefers-color-scheme", value: ... }]
            tracing::debug!(
                "emulate_media: engine={}, color_scheme={:?}",
                options.engine,
                options.color_scheme.as_ref().map(|cs| cs.as_str())
            );
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    #[test]
    fn color_scheme_as_str() {
        assert_eq!(ColorScheme::Light.as_str(), "light");
        assert_eq!(ColorScheme::Dark.as_str(), "dark");
        assert_eq!(ColorScheme::NoPreference.as_str(), "no-preference");
    }

    #[test]
    fn color_scheme_display() {
        assert_eq!(ColorScheme::Light.to_string(), "light");
        assert_eq!(ColorScheme::Dark.to_string(), "dark");
        assert_eq!(ColorScheme::NoPreference.to_string(), "no-preference");
    }

    #[test]
    fn color_scheme_from_str_valid() {
        assert_eq!(ColorScheme::from_str("light").unwrap(), ColorScheme::Light);
        assert_eq!(ColorScheme::from_str("dark").unwrap(), ColorScheme::Dark);
        assert_eq!(
            ColorScheme::from_str("no-preference").unwrap(),
            ColorScheme::NoPreference
        );
    }

    #[test]
    fn color_scheme_from_str_invalid() {
        assert!(ColorScheme::from_str("invalid").is_err());
        assert!(ColorScheme::from_str("").is_err());
        assert!(ColorScheme::from_str("DARK").is_err());
    }

    #[test]
    fn emulate_media_options_dark() {
        let opts = EmulateMediaOptions::dark(EngineType::Chromiumoxide);
        assert_eq!(opts.color_scheme, Some(ColorScheme::Dark));
        assert_eq!(opts.engine, EngineType::Chromiumoxide);
    }

    #[test]
    fn emulate_media_options_light() {
        let opts = EmulateMediaOptions::light(EngineType::Chromiumoxide);
        assert_eq!(opts.color_scheme, Some(ColorScheme::Light));
    }

    #[test]
    fn emulate_media_options_no_preference() {
        let opts = EmulateMediaOptions::no_preference(EngineType::Chromiumoxide);
        assert_eq!(opts.color_scheme, Some(ColorScheme::NoPreference));
    }

    #[test]
    fn emulate_media_options_reset() {
        let opts = EmulateMediaOptions::reset(EngineType::Chromiumoxide);
        assert_eq!(opts.color_scheme, None);
    }

    #[tokio::test]
    async fn emulate_media_chromiumoxide() {
        let opts = EmulateMediaOptions::dark(EngineType::Chromiumoxide);
        assert!(emulate_media(opts).await.is_ok());
    }

    #[tokio::test]
    async fn emulate_media_fantoccini() {
        let opts = EmulateMediaOptions::light(EngineType::Fantoccini);
        assert!(emulate_media(opts).await.is_ok());
    }
}
