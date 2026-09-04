//! Keep `navigator.webdriver` false by disabling the Blink feature behind it.
//!
//! Chrome tells a page that it is automated through exactly one Blink runtime
//! feature: `AutomationControlled`. `navigator.webdriver` is that feature and
//! nothing else, so closing the gap between a hand-started Chrome and a
//! Browser Commander Chrome is a matter of knowing which switches turn it on.
//!
//! `content/child/runtime_features.cc` in Chromium maps switches onto the
//! feature in `SetRuntimeFeaturesFromCommandLine`:
//!
//! ```text
//! {wrf::EnableAutomationControlled, switches::kEnableAutomation, true},
//! {wrf::EnableAutomationControlled, switches::kHeadless, true},
//! {wrf::EnableAutomationControlled, switches::kRemoteDebuggingPipe, true},
//! ```
//!
//! plus a special case directly below it: `--remote-debugging-port=0` also
//! enables the feature, because an ephemeral port is how ChromeDriver launches
//! the browser. A specific port number is left alone on purpose, since that is
//! what a human attaching a debugger passes.
//!
//! <https://chromium.googlesource.com/chromium/src/+/refs/heads/main/content/child/runtime_features.cc>
//!
//! This module is the Rust side of the same table as
//! `js/src/fingerprint/automation-parity.js` and
//! `python/src/browser_commander/fingerprint/automation_parity.py`; the three
//! are kept in step by tests asserting the same switches and the same merge
//! behaviour.

use crate::core::engine::EngineType;

/// Switch that disables the Blink feature regardless of what turned it on.
pub const AUTOMATION_CONTROLLED_OFF_ARG: &str = "--disable-blink-features=AutomationControlled";

const BLINK_FEATURES_SWITCH: &str = "--disable-blink-features";
const REMOTE_DEBUGGING_PORT_SWITCH: &str = "--remote-debugging-port";

/// A Chrome switch that enables the `AutomationControlled` Blink feature.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AutomationTrigger {
    /// The switch as written in `runtime_features.cc`.
    pub switch: &'static str,
    /// Why this switch enables the feature.
    pub reason: &'static str,
}

/// A trigger found in a concrete command line, with the argument that matched.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DetectedTrigger {
    /// The trigger's canonical switch.
    pub switch: &'static str,
    /// The argument exactly as the caller wrote it.
    pub argument: String,
    /// Why this switch enables the feature.
    pub reason: &'static str,
}

/// Chrome switches that enable the `AutomationControlled` Blink feature.
pub const AUTOMATION_CONTROLLED_TRIGGERS: &[AutomationTrigger] = &[
    AutomationTrigger {
        switch: "--enable-automation",
        reason: "Mapped onto AutomationControlled in content/child/runtime_features.cc; also shows the \"controlled by automated test software\" infobar.",
    },
    AutomationTrigger {
        switch: "--headless",
        reason: "Mapped onto AutomationControlled in content/child/runtime_features.cc; covers --headless and --headless=new alike.",
    },
    AutomationTrigger {
        switch: "--remote-debugging-pipe",
        reason: "Mapped onto AutomationControlled in content/child/runtime_features.cc. Playwright always passes it, and Puppeteer passes it whenever pipe transport is selected.",
    },
    AutomationTrigger {
        switch: "--remote-debugging-port=0",
        reason: "An ephemeral debugging port is how ChromeDriver launches Chrome, so runtime_features.cc treats it as automation. A fixed non-zero port is deliberately not treated that way. Puppeteer defaults to port 0.",
    },
];

/// Playwright forces a mouse-like pointer in headless Chrome:
///
/// ```text
/// if (options.headless) {
///   chromeArguments.push("--headless");
///   chromeArguments.push(
///     "--hide-scrollbars",
///     "--mute-audio",
///     "--blink-settings=primaryHoverType=2,availableHoverTypes=2," +
///       "primaryPointerType=4,availablePointerTypes=4");
/// }
/// ```
///
/// -- `packages/playwright-core/src/server/chromium/chromium.ts`. Headless
/// Chrome has no pointing device, so a real headless browser answers
/// `hover: none` and `pointer: none`; with that switch it answers
/// `hover: hover` and `pointer: fine`, a four-media-query giveaway no page
/// script can explain away. Measured in
/// `docs/case-studies/issue-79/analysis-artifacts/parity-headless.json`.
pub const PLAYWRIGHT_HEADLESS_POINTER_ARG: &str =
    "--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4";

/// Return the switch part of `--name=value`, or the argument itself.
fn switch_name(argument: &str) -> &str {
    match argument.find('=') {
        Some(index) => &argument[..index],
        None => argument,
    }
}

fn is_ephemeral_debugging_port(argument: &str) -> bool {
    if switch_name(argument) != REMOTE_DEBUGGING_PORT_SWITCH {
        return false;
    }
    match argument.split_once('=') {
        Some((_, value)) => value.trim().parse::<i64>() == Ok(0),
        None => false,
    }
}

fn is_trigger(argument: &str, trigger: &AutomationTrigger) -> bool {
    match trigger.switch {
        "--remote-debugging-port=0" => is_ephemeral_debugging_port(argument),
        "--headless" => switch_name(argument) == "--headless",
        other => switch_name(argument) == other,
    }
}

/// Report which of the supplied switches would make `navigator.webdriver` true.
///
/// Callers use this to explain a parity failure instead of only observing it.
pub fn detect_automation_controlled_triggers(args: &[String]) -> Vec<DetectedTrigger> {
    let mut found = Vec::new();
    for argument in args {
        for trigger in AUTOMATION_CONTROLLED_TRIGGERS {
            if is_trigger(argument, trigger) {
                found.push(DetectedTrigger {
                    switch: trigger.switch,
                    argument: argument.clone(),
                    reason: trigger.reason,
                });
            }
        }
    }
    found
}

/// Whether the switch list already disables the `AutomationControlled` feature.
pub fn disables_automation_controlled(args: &[String]) -> bool {
    args.iter().any(|argument| {
        if switch_name(argument) != BLINK_FEATURES_SWITCH {
            return false;
        }
        match argument.split_once('=') {
            Some((_, features)) => features
                .split(',')
                .any(|feature| feature.trim() == "AutomationControlled"),
            None => false,
        }
    })
}

/// Append the switch that keeps `navigator.webdriver` false.
///
/// The feature is disabled rather than the triggering switches removed: an
/// engine adds `--remote-debugging-pipe` or `--remote-debugging-port=0` after
/// the caller's arguments and needs that transport to work at all, so the only
/// reliable place to intervene is the feature itself.
pub fn apply_automation_parity_args(args: &[String]) -> Vec<String> {
    if disables_automation_controlled(args) {
        return args.to_vec();
    }
    let mut merged = args.to_vec();
    if let Some(existing) = merged
        .iter_mut()
        .find(|argument| switch_name(argument) == BLINK_FEATURES_SWITCH)
    {
        // Chrome keeps only the last --disable-blink-features occurrence, so
        // the existing feature list is extended in place, not duplicated.
        existing.push_str(",AutomationControlled");
        return merged;
    }
    merged.push(AUTOMATION_CONTROLLED_OFF_ARG.to_string());
    merged
}

/// Default switches to suppress so the engine's command line matches a
/// hand-started Chrome.
///
/// These cannot be countered after launch: they have to be kept out of the
/// command line through the engine's own exclusion option. `Chromiumoxide`
/// passes no automation defaults of its own, and `Fantoccini` talks to a
/// WebDriver server that this crate does not spawn, so both return nothing.
pub fn parity_ignored_default_args(engine: EngineType, headless: bool) -> Vec<String> {
    let mut ignored: Vec<String> = Vec::new();
    match engine {
        EngineType::Playwright => {
            ignored.push("--enable-automation".to_string());
            if headless {
                ignored.push(PLAYWRIGHT_HEADLESS_POINTER_ARG.to_string());
            }
        }
        EngineType::Puppeteer => ignored.push("--enable-automation".to_string()),
        EngineType::Chromiumoxide | EngineType::Fantoccini => {}
    }
    ignored
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn trigger_table_covers_every_switch_runtime_features_maps() {
        let switches: Vec<&str> = AUTOMATION_CONTROLLED_TRIGGERS
            .iter()
            .map(|trigger| trigger.switch)
            .collect();
        assert_eq!(
            switches,
            [
                "--enable-automation",
                "--headless",
                "--remote-debugging-pipe",
                "--remote-debugging-port=0",
            ]
        );
    }

    #[test]
    fn every_trigger_explains_itself() {
        for trigger in AUTOMATION_CONTROLLED_TRIGGERS {
            assert!(trigger.reason.contains("runtime_features.cc"));
        }
    }

    #[test]
    fn detects_no_triggers_in_plain_arguments() {
        assert!(detect_automation_controlled_triggers(&args(&["--no-first-run"])).is_empty());
    }

    #[test]
    fn detects_enable_automation() {
        let found = detect_automation_controlled_triggers(&args(&["--enable-automation"]));
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].switch, "--enable-automation");
        assert_eq!(found[0].argument, "--enable-automation");
    }

    #[test]
    fn detects_headless_with_a_value() {
        let found = detect_automation_controlled_triggers(&args(&["--headless=new"]));
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].switch, "--headless");
        assert_eq!(found[0].argument, "--headless=new");
    }

    #[test]
    fn detects_remote_debugging_pipe() {
        let found = detect_automation_controlled_triggers(&args(&["--remote-debugging-pipe"]));
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].switch, "--remote-debugging-pipe");
    }

    #[test]
    fn detects_an_ephemeral_debugging_port() {
        let found = detect_automation_controlled_triggers(&args(&["--remote-debugging-port=0"]));
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].switch, "--remote-debugging-port=0");
    }

    #[test]
    fn leaves_a_fixed_debugging_port_alone() {
        // runtime_features.cc exempts a specific port on purpose: that is what a
        // human attaching a debugger passes.
        assert!(
            detect_automation_controlled_triggers(&args(&["--remote-debugging-port=9222"]))
                .is_empty()
        );
    }

    #[test]
    fn ignores_a_debugging_port_that_is_not_a_number() {
        assert!(
            detect_automation_controlled_triggers(&args(&["--remote-debugging-port=auto"]))
                .is_empty()
        );
    }

    #[test]
    fn does_not_match_a_switch_that_merely_starts_the_same() {
        assert!(
            detect_automation_controlled_triggers(&args(&["--enable-automation-extra"])).is_empty()
        );
    }

    #[test]
    fn reports_every_trigger_in_order() {
        let found = detect_automation_controlled_triggers(&args(&[
            "--headless",
            "--no-first-run",
            "--remote-debugging-pipe",
        ]));
        let switches: Vec<&str> = found.iter().map(|trigger| trigger.switch).collect();
        assert_eq!(switches, ["--headless", "--remote-debugging-pipe"]);
    }

    #[test]
    fn disables_is_false_for_plain_arguments() {
        assert!(!disables_automation_controlled(&args(&["--no-first-run"])));
    }

    #[test]
    fn disables_is_true_for_the_exact_switch() {
        assert!(disables_automation_controlled(&args(&[
            AUTOMATION_CONTROLLED_OFF_ARG
        ])));
    }

    #[test]
    fn disables_is_true_when_listed_among_other_features() {
        assert!(disables_automation_controlled(&args(&[
            "--disable-blink-features=AcceleratedSmallCanvases, AutomationControlled"
        ])));
    }

    #[test]
    fn disables_is_false_for_a_different_feature() {
        assert!(!disables_automation_controlled(&args(&[
            "--disable-blink-features=Foo"
        ])));
    }

    #[test]
    fn disables_is_false_when_the_feature_is_enabled_rather_than_disabled() {
        assert!(!disables_automation_controlled(&args(&[
            "--enable-blink-features=AutomationControlled"
        ])));
    }

    #[test]
    fn appends_the_switch_to_plain_arguments() {
        assert_eq!(
            apply_automation_parity_args(&args(&["--no-first-run"])),
            args(&["--no-first-run", AUTOMATION_CONTROLLED_OFF_ARG])
        );
    }

    #[test]
    fn appends_to_an_empty_list() {
        assert_eq!(
            apply_automation_parity_args(&[]),
            args(&[AUTOMATION_CONTROLLED_OFF_ARG])
        );
    }

    #[test]
    fn applying_parity_is_idempotent() {
        let once = apply_automation_parity_args(&args(&["--no-first-run"]));
        assert_eq!(apply_automation_parity_args(&once), once);
    }

    #[test]
    fn extends_an_existing_blink_feature_list_in_place() {
        // Chrome keeps only the last --disable-blink-features occurrence, so a
        // second one would silently discard the caller's features.
        assert_eq!(
            apply_automation_parity_args(&args(&[
                "--disable-blink-features=Foo",
                "--no-first-run"
            ])),
            args(&[
                "--disable-blink-features=Foo,AutomationControlled",
                "--no-first-run"
            ])
        );
    }

    #[test]
    fn extends_only_the_first_blink_feature_list() {
        assert_eq!(
            apply_automation_parity_args(&args(&[
                "--disable-blink-features=Foo",
                "--disable-blink-features=Bar"
            ])),
            args(&[
                "--disable-blink-features=Foo,AutomationControlled",
                "--disable-blink-features=Bar"
            ])
        );
    }

    #[test]
    fn playwright_headful_excludes_the_automation_switch() {
        assert_eq!(
            parity_ignored_default_args(EngineType::Playwright, false),
            args(&["--enable-automation"])
        );
    }

    #[test]
    fn playwright_headless_also_excludes_the_pointer_switch() {
        // Playwright appends the pointer switch after the caller's arguments, so
        // exclusion is the only mechanism that can remove it.
        assert_eq!(
            parity_ignored_default_args(EngineType::Playwright, true),
            args(&["--enable-automation", PLAYWRIGHT_HEADLESS_POINTER_ARG])
        );
    }

    #[test]
    fn puppeteer_has_no_headless_pointer_switch() {
        assert_eq!(
            parity_ignored_default_args(EngineType::Puppeteer, true),
            args(&["--enable-automation"])
        );
    }

    #[test]
    fn engines_that_add_no_automation_defaults_exclude_nothing() {
        // Chromiumoxide builds its own command line, and this crate does not
        // spawn the WebDriver server fantoccini talks to.
        assert!(parity_ignored_default_args(EngineType::Chromiumoxide, true).is_empty());
        assert!(parity_ignored_default_args(EngineType::Fantoccini, true).is_empty());
    }
}
