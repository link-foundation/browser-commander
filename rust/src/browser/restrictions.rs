//! Named, opt-in launch restrictions (issue #103).
//!
//! By default Browser Commander starts Chrome exactly like a person would:
//! `--user-data-dir=<fresh profile> --remote-debugging-port=<reserved port>`
//! and nothing else. Every switch the library used to add on its own - and
//! every switch an automation engine adds - is available here by name, so a
//! caller who wants one asks for it and the difference from a hand-started
//! Chrome stays visible in their code:
//!
//! ```rust,no_run
//! use browser_commander::browser::RealBrowserOptions;
//!
//! let options = RealBrowserOptions::default().restrictions(["no-extensions", "no-sync"]);
//! ```
//!
//! The catalogue is data, not code. `launch-restrictions.json` next to this
//! module is a byte-for-byte copy of `js/src/browser/launch-restrictions.json`,
//! embedded with `include_str!` and kept in step by
//! `scripts/check-shared-fingerprint-assets.sh`.

use std::collections::{BTreeMap, HashMap};
use std::sync::LazyLock;

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};

/// The shared catalogue source, embedded at compile time.
pub const LAUNCH_RESTRICTIONS_SOURCE: &str = include_str!("launch-restrictions.json");

/// One named launch restriction.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchRestriction {
    /// Stable name used in `restrictions`.
    pub id: String,
    /// What it changes compared with a hand-started browser.
    pub description: String,
    /// Chrome switches.
    #[serde(default)]
    pub args: Vec<String>,
    /// Values merged into one `--disable-features` switch.
    #[serde(default)]
    pub disable_features: Vec<String>,
    /// Environment for the browser process only.
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    /// Preferences seeded before starting the browser.
    #[serde(default)]
    pub preferences: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct Catalogue {
    restrictions: Vec<LaunchRestriction>,
    presets: serde_json::Map<String, serde_json::Value>,
}

/// Named presets in catalogue order.
type Presets = Vec<(String, Vec<String>)>;

static CATALOGUE: LazyLock<(Vec<LaunchRestriction>, Presets)> = LazyLock::new(|| {
    let catalogue: Catalogue = serde_json::from_str(LAUNCH_RESTRICTIONS_SOURCE)
        .expect("launch-restrictions.json is embedded at compile time and has to parse");
    // serde_json keeps object keys sorted, so the preset order follows the
    // catalogue's key order only when it is already alphabetical - which
    // it is; the order is only used in error messages.
    let presets = catalogue
        .presets
        .into_iter()
        .map(|(name, ids)| {
            let ids = serde_json::from_value(ids)
                .expect("launch restriction presets are arrays of restriction ids");
            (name, ids)
        })
        .collect();
    (catalogue.restrictions, presets)
});

/// Every launch restriction, in the order the catalogue declares them.
pub fn launch_restrictions() -> &'static [LaunchRestriction] {
    &CATALOGUE.0
}

/// Named groups of restrictions, such as the pre-#103 defaults
/// (`legacy-defaults`, `legacy-launch-browser`).
pub fn launch_restriction_presets() -> &'static [(String, Vec<String>)] {
    &CATALOGUE.1
}

/// Restriction ids a preset expands to, if `name` is a preset.
pub fn launch_restriction_preset(name: &str) -> Option<&'static [String]> {
    launch_restriction_presets()
        .iter()
        .find(|(preset, _)| preset == name)
        .map(|(_, ids)| ids.as_slice())
}

/// Switches and environment for a set of restrictions.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ResolvedRestrictions {
    /// Restriction ids after preset expansion, without duplicates.
    pub ids: Vec<String>,
    /// Chrome switches, with every `disableFeatures` value in one
    /// `--disable-features` switch at the end.
    pub args: Vec<String>,
    /// Environment for the browser process only.
    pub env: HashMap<String, String>,
    /// Preferences seeded before starting the browser.
    pub preferences: serde_json::Value,
}

fn expand<S: AsRef<str>>(names: &[S]) -> Vec<String> {
    let mut ids: Vec<String> = Vec::new();
    for name in names {
        let name = name.as_ref();
        let expanded = launch_restriction_preset(name)
            .map(<[String]>::to_vec)
            .unwrap_or_else(|| vec![name.to_owned()]);
        for id in expanded {
            if !ids.contains(&id) {
                ids.push(id);
            }
        }
    }
    ids
}

/// Resolve restriction names (and preset names) into switches and environment.
///
/// Unknown names are an error listing every restriction and preset.
pub fn resolve_restrictions<S: AsRef<str>>(names: &[S]) -> Result<ResolvedRestrictions> {
    let ids = expand(names);
    let mut args = Vec::new();
    let mut disable_features = Vec::new();
    let mut env = HashMap::new();
    let mut preferences = serde_json::json!({});
    for id in &ids {
        let Some(restriction) = launch_restrictions().iter().find(|entry| &entry.id == id) else {
            let expected: Vec<&str> = launch_restrictions()
                .iter()
                .map(|entry| entry.id.as_str())
                .chain(
                    launch_restriction_presets()
                        .iter()
                        .map(|(name, _)| name.as_str()),
                )
                .collect();
            return Err(anyhow!(
                "Unknown launch restriction \"{id}\". Expected one of {}",
                expected.join(", ")
            ));
        };
        args.extend(restriction.args.iter().cloned());
        merge_preferences(
            &mut preferences,
            &serde_json::Value::Object(restriction.preferences.clone()),
        );
        disable_features.extend(restriction.disable_features.iter().cloned());
        env.extend(
            restriction
                .env
                .iter()
                .map(|(key, value)| (key.clone(), value.clone())),
        );
    }
    if !disable_features.is_empty() {
        args.push(format!("--disable-features={}", disable_features.join(",")));
    }
    Ok(ResolvedRestrictions {
        ids,
        args,
        env,
        preferences,
    })
}

/// Deep merge Chrome preference objects; caller values take precedence.
pub fn merge_preferences(target: &mut serde_json::Value, source: &serde_json::Value) {
    match (target, source) {
        (serde_json::Value::Object(target), serde_json::Value::Object(source)) => {
            for (key, value) in source {
                merge_preferences(
                    target.entry(key.clone()).or_insert(serde_json::Value::Null),
                    value,
                );
            }
        }
        (target, source) => *target = source.clone(),
    }
}

/// Resolve restrictions with extra feature names, deduplicating the resulting switch.
pub fn resolve_restrictions_with_features<S: AsRef<str>>(
    names: &[S],
    features: &[String],
) -> Result<ResolvedRestrictions> {
    let mut resolved = resolve_restrictions(names)?;
    if !features.is_empty() {
        resolved
            .args
            .push(format!("--disable-features={}", features.join(",")));
    }
    resolved.args = merge_feature_switches(&resolved.args);
    Ok(resolved)
}

const LIST_SWITCHES: &[&str] = &[
    "--disable-features",
    "--enable-features",
    "--disable-blink-features",
    "--enable-blink-features",
];

fn list_switch_of(argument: &str) -> Option<&'static str> {
    LIST_SWITCHES.iter().copied().find(|prefix| {
        argument
            .strip_prefix(prefix)
            .is_some_and(|rest| rest.starts_with('='))
    })
}

/// Merge repeated feature-list switches into one occurrence each.
///
/// Chrome keeps only the last `--disable-features` (and friends), so two
/// sources that each add one would silently cancel each other. The merged
/// switch takes the place of the first occurrence.
pub fn merge_feature_switches<S: AsRef<str>>(args: &[S]) -> Vec<String> {
    let mut values: HashMap<&'static str, Vec<String>> = HashMap::new();
    for argument in args {
        let argument = argument.as_ref();
        if let Some(name) = list_switch_of(argument) {
            let list = values.entry(name).or_default();
            for feature in argument[name.len() + 1..].split(',') {
                if !feature.is_empty() && !list.iter().any(|existing| existing == feature) {
                    list.push(feature.to_owned());
                }
            }
        }
    }
    let mut emitted = Vec::new();
    let mut merged = Vec::new();
    for argument in args {
        let argument = argument.as_ref();
        match list_switch_of(argument) {
            None => merged.push(argument.to_owned()),
            Some(name) if !emitted.contains(&name) => {
                emitted.push(name);
                merged.push(format!("{name}={}", values[name].join(",")));
            }
            Some(_) => {}
        }
    }
    merged
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quiet_ui_merges_features_and_seeds_preferences() {
        let result = resolve_restrictions_with_features(
            &["quiet-ui"],
            &["Custom".into(), "Translate".into()],
        )
        .unwrap();
        let features: Vec<_> = result
            .args
            .iter()
            .filter(|arg| arg.starts_with("--disable-features="))
            .collect();
        assert_eq!(features.len(), 1);
        assert!(features[0].contains("SessionRestoreInfobar"));
        assert!(features[0].contains("Custom"));
        assert_eq!(features[0].matches("Translate").count(), 1);
        assert_eq!(result.preferences["translate"]["enabled"], false);
    }

    #[test]
    fn resolves_restrictions_and_presets() {
        let resolved = resolve_restrictions(&["no-sync", "no-translate", "no-sync"]).unwrap();
        assert_eq!(resolved.ids, ["no-sync", "no-translate"]);
        assert_eq!(
            resolved.args.last().unwrap(),
            "--disable-features=Translate"
        );

        let legacy = resolve_restrictions(&["legacy-launch-browser"]).unwrap();
        assert_eq!(
            legacy.env.get("GOOGLE_API_KEY").map(String::as_str),
            Some("no")
        );
        assert_eq!(
            legacy
                .env
                .get("GOOGLE_DEFAULT_CLIENT_ID")
                .map(String::as_str),
            Some("no")
        );
        assert_eq!(
            legacy
                .env
                .get("GOOGLE_DEFAULT_CLIENT_SECRET")
                .map(String::as_str),
            Some("no")
        );
        assert!(legacy.args.contains(&"--password-store=basic".to_owned()));
    }

    #[test]
    fn legacy_defaults_match_the_chrome_args_constant() {
        let legacy = resolve_restrictions(&["legacy-defaults"]).unwrap();
        let mut expected: Vec<String> = crate::core::CHROME_ARGS
            .iter()
            .map(|argument| (*argument).to_owned())
            .collect();
        let mut actual = legacy.args;
        expected.sort();
        actual.sort();
        assert_eq!(actual, expected);
    }

    #[test]
    fn rejects_unknown_restrictions() {
        let error = resolve_restrictions(&["no-such-thing"])
            .unwrap_err()
            .to_string();
        assert!(
            error.starts_with(
                "Unknown launch restriction \"no-such-thing\". Expected one of no-first-run"
            ),
            "{error}"
        );
        assert!(error.contains("legacy-defaults"), "{error}");
    }

    #[test]
    fn merges_repeated_feature_switches() {
        assert_eq!(
            merge_feature_switches(&[
                "--disable-features=A,B",
                "--lang=en-US",
                "--disable-features=B,,C",
                "--enable-blink-features=X",
                "--disable-featuresX=1",
            ]),
            [
                "--disable-features=A,B,C",
                "--lang=en-US",
                "--enable-blink-features=X",
                "--disable-featuresX=1",
            ]
        );
    }
}
