//! Privacy rules for recorded traces (issue #87).
//!
//! The same rules as `js/src/traces/redaction.js`: defaults are additive, a
//! listed query parameter is replaced wherever a URL carries it (the fragment
//! included, because implicit OAuth flows put tokens there), and the marker is
//! written back in readable form.

use std::fmt;
use std::sync::Arc;

use regex::{NoExpand, Regex};
use url::{form_urlencoded, Url};

use super::jsonfmt::{Json, JsonObject};

/// What a redacted value is replaced with.
pub const REDACTED: &str = "[redacted]";

/// Elements whose values the in-page capture never reads.
pub const DEFAULT_REDACT_SELECTORS: [&str; 3] =
    ["input[type=password]", "[data-private]", "[data-bc-redact]"];

/// Field and header names whose values are always replaced.
pub const DEFAULT_REDACT_ATTRIBUTES: [&str; 7] = [
    "authorization",
    "proxy-authorization",
    "cookie",
    "set-cookie",
    "x-api-key",
    "x-auth-token",
    "x-csrf-token",
];

/// Query and fragment parameters whose values are always replaced.
pub const DEFAULT_REDACT_QUERY_PARAMS: [&str; 12] = [
    "access_token",
    "api_key",
    "apikey",
    "auth",
    "code",
    "id_token",
    "password",
    "refresh_token",
    "secret",
    "session",
    "signature",
    "token",
];

/// What a custom redaction callback is shown.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RedactContext<'a> {
    /// `field`, `url` or `header`.
    pub kind: &'a str,
    /// The field or header name, when there is one.
    pub name: Option<&'a str>,
    /// The text after the built-in rules ran.
    pub value: &'a str,
}

/// A caller's last word on a piece of text: `Some` replaces it.
pub type RedactCallback = Arc<dyn Fn(&RedactContext<'_>) -> Option<String> + Send + Sync>;

/// Privacy options as a caller writes them.
#[derive(Clone)]
pub struct TracePrivacyOptions {
    /// Extra selectors whose elements are captured without their values.
    pub redact_selectors: Vec<String>,
    /// Extra field and header names whose values are replaced.
    pub redact_attributes: Vec<String>,
    /// Extra query and fragment parameters whose values are replaced.
    pub redact_query_params: Vec<String>,
    /// Regular expressions replaced in every recorded string.
    pub redact_patterns: Vec<String>,
    /// Called for every recorded string after the built-in rules.
    pub redact: Option<RedactCallback>,
    /// Keep the default lists; extras are added to them. Defaults to `true`.
    pub use_defaults: bool,
}

impl Default for TracePrivacyOptions {
    fn default() -> Self {
        Self {
            redact_selectors: Vec::new(),
            redact_attributes: Vec::new(),
            redact_query_params: Vec::new(),
            redact_patterns: Vec::new(),
            redact: None,
            use_defaults: true,
        }
    }
}

impl fmt::Debug for TracePrivacyOptions {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("TracePrivacyOptions")
            .field("redact_selectors", &self.redact_selectors)
            .field("redact_attributes", &self.redact_attributes)
            .field("redact_query_params", &self.redact_query_params)
            .field("redact_patterns", &self.redact_patterns)
            .field("redact", &self.redact.as_ref().map(|_| "<callback>"))
            .field("use_defaults", &self.use_defaults)
            .finish()
    }
}

/// Privacy options with the defaults merged in and the patterns compiled.
#[derive(Clone)]
pub struct NormalizedPrivacy {
    /// Lower-cased, de-duplicated selectors.
    pub redact_selectors: Vec<String>,
    /// Lower-cased, de-duplicated field and header names.
    pub redact_attributes: Vec<String>,
    /// Lower-cased, de-duplicated parameter names.
    pub redact_query_params: Vec<String>,
    /// Compiled patterns.
    pub redact_patterns: Vec<Regex>,
    /// The caller's callback.
    pub redact: Option<RedactCallback>,
}

impl fmt::Debug for NormalizedPrivacy {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("NormalizedPrivacy")
            .field("redact_selectors", &self.redact_selectors)
            .field("redact_attributes", &self.redact_attributes)
            .field("redact_query_params", &self.redact_query_params)
            .field("redact_patterns", &self.redact_patterns)
            .field("redact", &self.redact.as_ref().map(|_| "<callback>"))
            .finish()
    }
}

impl Default for NormalizedPrivacy {
    fn default() -> Self {
        normalize_privacy_options(&TracePrivacyOptions::default())
            .expect("the default privacy options have no patterns to fail")
    }
}

fn lower_set(defaults: &[&str], use_defaults: bool, extra: &[String]) -> Vec<String> {
    let mut seen = Vec::<String>::new();
    let defaults = defaults.iter().copied().filter(|_| use_defaults);
    for value in defaults.chain(extra.iter().map(String::as_str)) {
        let lowered = value.to_lowercase();
        if !seen.contains(&lowered) {
            seen.push(lowered);
        }
    }
    seen
}

/// Merge the defaults in and compile the patterns.
///
/// # Errors
///
/// Returns the pattern's error when one is not a valid regular expression.
pub fn normalize_privacy_options(
    privacy: &TracePrivacyOptions,
) -> Result<NormalizedPrivacy, regex::Error> {
    let use_defaults = privacy.use_defaults;
    Ok(NormalizedPrivacy {
        redact_selectors: lower_set(
            &DEFAULT_REDACT_SELECTORS,
            use_defaults,
            &privacy.redact_selectors,
        ),
        redact_attributes: lower_set(
            &DEFAULT_REDACT_ATTRIBUTES,
            use_defaults,
            &privacy.redact_attributes,
        ),
        redact_query_params: lower_set(
            &DEFAULT_REDACT_QUERY_PARAMS,
            use_defaults,
            &privacy.redact_query_params,
        ),
        redact_patterns: privacy
            .redact_patterns
            .iter()
            .map(|pattern| Regex::new(pattern))
            .collect::<Result<_, _>>()?,
        redact: privacy.redact.clone(),
    })
}

/// Replace every pattern match, then let the callback have its say.
pub fn redact_text(
    value: &str,
    privacy: &NormalizedPrivacy,
    kind: &str,
    name: Option<&str>,
) -> String {
    if value.is_empty() {
        return String::new();
    }
    let mut text = value.to_string();
    for pattern in &privacy.redact_patterns {
        text = pattern.replace_all(&text, NoExpand(REDACTED)).into_owned();
    }
    if let Some(callback) = &privacy.redact {
        let context = RedactContext {
            kind,
            name,
            value: &text,
        };
        if let Some(replaced) = callback(&context) {
            text = replaced;
        }
    }
    text
}

/// `URLSearchParams.set(key, REDACTED)` for every listed key, serialized again
/// only when one was listed.
fn redact_params(body: &str, privacy: &NormalizedPrivacy) -> Option<String> {
    let mut pairs: Vec<(String, String)> = form_urlencoded::parse(body.as_bytes())
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect();
    let keys: Vec<String> = pairs.iter().map(|(key, _)| key.clone()).collect();
    let mut changed = false;
    for key in keys {
        if !privacy.redact_query_params.contains(&key.to_lowercase()) {
            continue;
        }
        changed = true;
        let mut found = false;
        pairs.retain_mut(|(name, value)| {
            if *name != key {
                return true;
            }
            if found {
                return false;
            }
            found = true;
            *value = REDACTED.to_string();
            true
        });
        if !found {
            pairs.push((key, REDACTED.to_string()));
        }
    }
    if !changed {
        return None;
    }
    Some(
        form_urlencoded::Serializer::new(String::new())
            .extend_pairs(pairs.iter())
            .finish(),
    )
}

/// Redact a URL's credentials and listed parameters, then its text.
///
/// A relative or malformed URL is kept unparsed and only its text is redacted.
pub fn redact_url(url: &str, privacy: &NormalizedPrivacy) -> String {
    if url.is_empty() {
        return String::new();
    }
    let mut text = url.to_string();
    if let Ok(mut parsed) = Url::parse(url) {
        let has_user = !parsed.username().is_empty();
        let has_password = parsed
            .password()
            .is_some_and(|password| !password.is_empty());
        if has_user || has_password {
            let _ = parsed.set_username(if has_user { REDACTED } else { "" });
            let _ = parsed.set_password(if has_password { Some(REDACTED) } else { None });
        }
        if let Some(query) = parsed.query().map(str::to_string) {
            if let Some(redacted) = redact_params(&query, privacy) {
                parsed.set_query(Some(&redacted));
            }
        }
        if let Some(fragment) = parsed.fragment().map(str::to_string) {
            if !fragment.is_empty() {
                let body = fragment.strip_prefix('?').unwrap_or(&fragment);
                if let Some(redacted) = redact_params(body, privacy) {
                    parsed.set_fragment(Some(&redacted));
                }
            }
        }
        text = parsed.to_string().replace("%5Bredacted%5D", REDACTED);
    }
    redact_text(&text, privacy, "url", None)
}

/// Whether a field name ends in `url`, which is how JavaScript decides a value
/// is a URL (`/url$/i`).
fn names_a_url(key: &str) -> bool {
    key.len() >= 3
        && key
            .get(key.len() - 3..)
            .is_some_and(|tail| tail.eq_ignore_ascii_case("url"))
}

/// Redact every string inside a value, by the name of the field holding it.
pub fn redact_value(value: &Json, privacy: &NormalizedPrivacy, key: &str) -> Json {
    match value {
        Json::String(text) => {
            if privacy.redact_attributes.contains(&key.to_lowercase()) {
                Json::from(REDACTED)
            } else if names_a_url(key) {
                Json::String(redact_url(text, privacy))
            } else {
                Json::String(redact_text(text, privacy, "field", Some(key)))
            }
        }
        Json::Array(items) => Json::Array(
            items
                .iter()
                .map(|item| redact_value(item, privacy, key))
                .collect(),
        ),
        Json::Object(object) => Json::Object(redact_object(object, privacy)),
        other => other.clone(),
    }
}

/// [`redact_value`] for an object's fields.
pub fn redact_object(object: &JsonObject, privacy: &NormalizedPrivacy) -> JsonObject {
    object
        .iter()
        .map(|(name, entry)| (name.clone(), redact_value(entry, privacy, name)))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn privacy() -> NormalizedPrivacy {
        normalize_privacy_options(&TracePrivacyOptions {
            redact_patterns: vec!["sk-[a-z0-9]+".to_string()],
            redact_query_params: vec!["Ticket".to_string()],
            ..TracePrivacyOptions::default()
        })
        .unwrap()
    }

    #[test]
    fn defaults_are_additive_and_lower_cased() {
        let privacy = privacy();
        assert_eq!(privacy.redact_query_params.last().unwrap(), "ticket");
        assert_eq!(privacy.redact_query_params.len(), 13);
    }

    #[test]
    fn urls_lose_credentials_and_listed_parameters() {
        let privacy = privacy();
        assert_eq!(
            redact_url(
                "https://user:pw@example.com/start?ticket=t-1&lang=en#access_token=abc&view=1",
                &privacy
            ),
            "https://[redacted]:[redacted]@example.com/start?ticket=[redacted]&lang=en#access_token=[redacted]&view=1"
        );
        assert_eq!(
            redact_url("not a url sk-abc", &privacy),
            "not a url [redacted]"
        );
    }

    #[test]
    fn values_are_redacted_by_field_name() {
        let privacy = privacy();
        let value = Json::parse(
            r#"{"authorization":"Bearer x","pageUrl":"https://a.example/?token=1","list":["sk-a1"]}"#,
        )
        .unwrap();
        assert_eq!(
            redact_value(&value, &privacy, "").to_compact(),
            r#"{"authorization":"[redacted]","pageUrl":"https://a.example/?token=[redacted]","list":["[redacted]"]}"#
        );
    }
}
