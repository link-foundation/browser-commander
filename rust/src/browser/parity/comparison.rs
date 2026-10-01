//! Shared command-line comparison and probe difference rules.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::fingerprint::find_fingerprint_limitation;

/// One unequal probe value. Missing properties are represented as JSON null.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProbeDifference {
    /// Dot-separated probe path or command-line switch path.
    pub path: String,
    /// Value from the hand-started browser.
    pub reference: Value,
    /// Value from the driven browser.
    pub candidate: Value,
}

/// An explained difference in the portable parity report.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ParityDifference {
    /// Dot-separated probe or command-line path.
    pub path: String,
    /// Reference value.
    pub expected: Value,
    /// Driven value.
    pub actual: Value,
    /// Identifier in the shared fingerprint limitations catalogue, if explained.
    pub limitation: Option<String>,
    /// Whether the caller explicitly requested this difference.
    pub requested: bool,
}

/// Values of a comma-separated feature switch, sorted for comparison.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FeatureComparison {
    /// Reference browser's features.
    pub reference: Vec<String>,
    /// Driven browser's features.
    pub candidate: Vec<String>,
}

/// A switch whose value changed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChangedSwitch {
    /// Switch name, including its leading `--`.
    pub name: String,
    /// Reference value; `None` denotes a flag without a value.
    pub reference: Option<String>,
    /// Driven value.
    pub candidate: Option<String>,
}

/// Browser-reported command-line comparison, compatible with JS and Python.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommandLineComparison {
    /// Switches present only in the driven command line.
    pub extra: Vec<String>,
    /// Switches missing from the driven command line.
    pub missing: Vec<String>,
    /// Unequal values, excluding volatile profile paths.
    pub changed: Vec<ChangedSwitch>,
    /// Fixed debugging-port switches used to attach the engine.
    pub attachment: Vec<String>,
    /// Feature lists from both command lines.
    pub features: BTreeMap<String, FeatureComparison>,
}

/// Context used to explain probe differences without hiding unknown changes.
#[derive(Debug, Clone)]
pub struct ParityContext {
    /// `real` or `engine` launch.
    pub launch: String,
    /// Whether the measured browser was started by somebody else.
    pub attached: bool,
    /// Extra switches reported by the browser.
    pub extra_switches: Vec<String>,
    /// Arguments explicitly requested by the caller.
    pub requested_args: Vec<String>,
}

impl Default for ParityContext {
    fn default() -> Self {
        Self {
            launch: "real".into(),
            attached: false,
            extra_switches: Vec::new(),
            requested_args: Vec::new(),
        }
    }
}

/// Parse exact argv entries into switch names and optional values.
pub fn parse_switch_args(args: &[String]) -> BTreeMap<String, Option<String>> {
    args.iter()
        .filter(|arg| arg.starts_with("--"))
        .map(|arg| match arg.split_once('=') {
            Some((name, value)) => (name.into(), Some(value.into())),
            None => (arg.clone(), None),
        })
        .collect()
}

/// Parse the space-joined command line shown by `chrome://version`.
/// Profile paths containing spaces are regrouped until the next switch.
pub fn parse_switches(command_line: &str) -> BTreeMap<String, Option<String>> {
    let mut words: Vec<&str> = command_line.split_whitespace().collect();
    if words.len() > 1
        && words
            .last()
            .is_some_and(|word| !word.starts_with("--") && url::Url::parse(word).is_ok())
    {
        words.pop();
    }
    let mut args: Vec<String> = Vec::new();
    for word in words {
        if word.starts_with("--") || args.is_empty() {
            args.push(word.into());
        } else if let Some(last) = args.last_mut() {
            last.push(' ');
            last.push_str(word);
        }
    }
    parse_switch_args(&args)
}

fn feature_list(value: Option<&Option<String>>) -> Vec<String> {
    let mut features: Vec<String> = value
        .and_then(Option::as_deref)
        .unwrap_or("")
        .split(',')
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .map(str::to_owned)
        .collect();
    features.sort();
    features
}

fn formatted(name: &str, value: &Option<String>) -> String {
    match value {
        Some(value) => format!("{name}={value}"),
        None => name.into(),
    }
}

/// Compare reported switch presence and values, including engine feature lists.
pub fn compare_command_lines(reference: &str, candidate: &str) -> CommandLineComparison {
    let left = parse_switches(reference);
    let right = parse_switches(candidate);
    let mut comparison = CommandLineComparison::default();
    for name in left.keys().chain(right.keys()).collect::<BTreeSet<_>>() {
        if matches!(
            name.as_str(),
            "--flag-switches-begin" | "--flag-switches-end"
        ) {
            continue;
        }
        if name == "--remote-debugging-port" {
            if let Some(value) = right.get(name) {
                comparison
                    .attachment
                    .push(format!("{name}={}", value.as_deref().unwrap_or("null")));
            }
            continue;
        }
        match (left.get(name), right.get(name)) {
            (None, Some(value)) => comparison.extra.push(formatted(name, value)),
            (Some(value), None) => comparison.missing.push(formatted(name, value)),
            (Some(a), Some(b)) if name != "--user-data-dir" && a != b => {
                comparison.changed.push(ChangedSwitch {
                    name: name.clone(),
                    reference: a.clone(),
                    candidate: b.clone(),
                });
            }
            _ => {}
        }
        if matches!(
            name.as_str(),
            "--enable-features"
                | "--disable-features"
                | "--enable-blink-features"
                | "--disable-blink-features"
        ) {
            comparison.features.insert(
                name.clone(),
                FeatureComparison {
                    reference: feature_list(left.get(name)),
                    candidate: feature_list(right.get(name)),
                },
            );
        }
    }
    comparison
}

pub(super) fn command_line_differences(comparison: &CommandLineComparison) -> Vec<ProbeDifference> {
    let mut differences = Vec::new();
    for (kind, entries) in [
        ("extra", &comparison.extra),
        ("missing", &comparison.missing),
    ] {
        for entry in entries {
            let value = Value::String(entry.clone());
            differences.push(ProbeDifference {
                path: format!(
                    "commandLine.{kind}.{}",
                    entry.split('=').next().unwrap_or(entry)
                ),
                reference: if kind == "missing" {
                    value.clone()
                } else {
                    Value::Null
                },
                candidate: if kind == "extra" { value } else { Value::Null },
            });
        }
    }
    differences.extend(comparison.changed.iter().map(|switch| ProbeDifference {
        path: format!("commandLine.changed.{}", switch.name),
        reference: switch.reference.clone().map_or(Value::Null, Value::String),
        candidate: switch.candidate.clone().map_or(Value::Null, Value::String),
    }));
    differences
}

fn ignored(path: &str) -> bool {
    matches!(
        path,
        "window.innerWidth"
            | "window.innerHeight"
            | "window.outerWidth"
            | "window.outerHeight"
            | "window.screenX"
            | "window.screenY"
            | "window.screenLeft"
            | "window.screenTop"
            | "document.referrer"
            | "document.hasFocus"
            | "document.bodyClientHeightIsPositive"
            | "connection.downlink"
            | "connection.rtt"
    ) || path.starts_with("viewportRelation.")
        || path.starts_with("probeErrors.")
}

/// Deep-diff objects in sorted key order. Arrays and scalars compare whole.
/// Missing values remain distinct from present JSON null while comparing.
pub fn diff_reports(reference: &Value, candidate: &Value) -> Vec<ProbeDifference> {
    fn walk(
        left: Option<&Value>,
        right: Option<&Value>,
        path: &str,
        output: &mut Vec<ProbeDifference>,
    ) {
        if ignored(path) {
            return;
        }
        if let (Some(Value::Object(a)), Some(Value::Object(b))) = (left, right) {
            for key in a.keys().chain(b.keys()).collect::<BTreeSet<_>>() {
                let trail = if path.is_empty() {
                    key.clone()
                } else {
                    format!("{path}.{key}")
                };
                walk(a.get(key), b.get(key), &trail, output);
            }
        } else if left != right {
            output.push(ProbeDifference {
                path: path.into(),
                reference: left.cloned().unwrap_or(Value::Null),
                candidate: right.cloned().unwrap_or(Value::Null),
            });
        }
    }
    let mut output = Vec::new();
    walk(Some(reference), Some(candidate), "", &mut output);
    output
}

/// Tag differences using the shared catalogue and return the unexplained subset.
pub fn classify_differences(
    differences: &[ProbeDifference],
    context: &ParityContext,
) -> (Vec<ParityDifference>, Vec<ParityDifference>) {
    let tagged: Vec<ParityDifference> = differences
        .iter()
        .map(|difference| {
            let command_line = difference.path.starts_with("commandLine.");
            let requested = command_line
                && difference
                    .candidate
                    .as_str()
                    .or(difference.reference.as_str())
                    .is_some_and(|value| context.requested_args.iter().any(|arg| arg == value));
            let feature_config = context.extra_switches.iter().any(|arg| {
                matches!(
                    arg.split('=').next(),
                    Some(
                        "--disable-field-trial-config" | "--disable-features" | "--enable-features"
                    )
                )
            });
            let limitation = if requested {
                None
            } else if context.launch == "engine"
                && (command_line
                    || (feature_config
                        && (difference.path.ends_with(".keys")
                            || difference.path.ends_with(".languages"))))
            {
                Some("engine-launch-switches")
            } else if difference
                .path
                .starts_with("navigator.userAgentData.brands")
            {
                Some("grease-brand-not-reproduced")
            } else if difference.path == "navigator.webdriver" && context.attached {
                Some("automation-controlled-is-launch-only")
            } else {
                None
            };
            ParityDifference {
                path: difference.path.clone(),
                expected: difference.reference.clone(),
                actual: difference.candidate.clone(),
                limitation: limitation
                    .filter(|id| find_fingerprint_limitation(id).is_some())
                    .map(str::to_owned),
                requested,
            }
        })
        .collect();
    let unlisted = tagged
        .iter()
        .filter(|entry| entry.limitation.is_none() && !entry.requested)
        .cloned()
        .collect();
    (tagged, unlisted)
}
