//! Apply a fingerprint profile to a live page.
//!
//! Everything goes through CDP, including the init script, so a page controlled
//! from Rust sees exactly what the JavaScript and Python implementations
//! present. The transport is a trait rather than a concrete page type: this
//! module stays free of any engine, and the recording transport in the tests
//! below checks the exact command sequence without a browser.
//!
//! Unlike the JavaScript implementation there is no "apply to pages opened
//! later" option, because chromiumoxide has no page-created event to hang it
//! on. A page opened later has to be given the profile explicitly; the
//! `Target.setAutoAttach` route is noted in the case study as the way to close
//! that gap.

use anyhow::Result;
use async_trait::async_trait;
use serde_json::{json, Value};

use super::cdp_overrides::{build_cdp_emulation_commands, CdpCommand};
use super::init_script::{build_fingerprint_init_script, InitScriptOptions};
use super::profile::{resolve_fingerprint_profile, FingerprintProfile};

/// Anything that can carry a CDP command to a page.
///
/// [`ChromiumoxidePage`](crate::browser::ChromiumoxidePage) implements this;
/// so does any test double that records what it was asked to send.
#[async_trait]
pub trait CdpTransport {
    /// Send one CDP command and return its result.
    async fn send(&self, method: &str, params: Value) -> Result<Value>;
}

/// How much the page script has to do on top of the browser-side overrides.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ApplyOptions {
    /// Force `navigator.webdriver` to `false` from JavaScript.
    ///
    /// Only needed when attaching to a browser somebody else launched with
    /// automation switches that can no longer be changed; a browser launched by
    /// this library does not need it, because
    /// `--disable-blink-features=AutomationControlled` already covers it.
    pub patch_webdriver: bool,
}

/// What [`apply_fingerprint`] sent.
#[derive(Debug, Clone, PartialEq)]
pub struct AppliedFingerprint {
    /// The resolved profile the page is now presenting.
    pub profile: FingerprintProfile,
    /// The commands that were sent, in the order they were sent.
    pub commands: Vec<CdpCommand>,
    /// The init script that was injected, if any was needed.
    pub init_script: Option<String>,
}

/// Apply a fingerprint profile to the page behind a transport.
pub async fn apply_fingerprint(
    transport: &(impl CdpTransport + ?Sized),
    profile: &FingerprintProfile,
    options: ApplyOptions,
) -> Result<AppliedFingerprint> {
    // Resolving is idempotent -- every derived field is also an accepted input
    // field -- so an already-resolved profile can be passed straight back in.
    let profile = resolve_fingerprint_profile(profile)?;
    let commands = build_cdp_emulation_commands(&profile);
    let init_script = build_fingerprint_init_script(
        &profile,
        InitScriptOptions {
            patch_webdriver: options.patch_webdriver,
            patch_languages: false,
        },
    );

    for command in &commands {
        transport
            .send(command.method, command.params.clone())
            .await?;
    }

    if let Some(ref script) = init_script {
        // Measured: without Page.enable on this session, Chrome accepts
        // addScriptToEvaluateOnNewDocument and returns an identifier, but never
        // runs the script on any subsequent document. Enabling the domain is
        // what makes the instrumentation take effect.
        transport.send("Page.enable", json!({})).await?;
        transport
            .send(
                "Page.addScriptToEvaluateOnNewDocument",
                json!({ "source": script }),
            )
            .await?;
        // A page that has already navigated will not replay the init script, so
        // patch the current document too. The payload guards against running
        // twice, which makes this safe on a brand new about:blank as well.
        transport
            .send(
                "Runtime.evaluate",
                json!({ "expression": script, "returnByValue": true }),
            )
            .await?;
    }

    Ok(AppliedFingerprint {
        profile,
        commands,
        init_script,
    })
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;
    use crate::fingerprint::presets::create_default_fingerprint_preset;

    /// A transport that records what was sent instead of talking to Chrome.
    #[derive(Default)]
    struct RecordingTransport {
        sent: Mutex<Vec<(String, Value)>>,
        fail_on: Option<&'static str>,
    }

    impl RecordingTransport {
        fn methods(&self) -> Vec<String> {
            self.sent
                .lock()
                .expect("lock")
                .iter()
                .map(|(method, _)| method.clone())
                .collect()
        }

        fn params(&self, method: &str) -> Value {
            self.sent
                .lock()
                .expect("lock")
                .iter()
                .find(|(sent, _)| sent == method)
                .map(|(_, params)| params.clone())
                .unwrap_or_else(|| panic!("{method} was not sent"))
        }
    }

    #[async_trait]
    impl CdpTransport for RecordingTransport {
        async fn send(&self, method: &str, params: Value) -> Result<Value> {
            if self.fail_on == Some(method) {
                anyhow::bail!("Target closed");
            }
            self.sent
                .lock()
                .expect("lock")
                .push((method.to_string(), params));
            Ok(json!({}))
        }
    }

    fn preset() -> FingerprintProfile {
        create_default_fingerprint_preset("windows-chrome").expect("preset")
    }

    #[tokio::test]
    async fn sends_the_emulation_commands_before_installing_the_init_script() {
        let transport = RecordingTransport::default();

        apply_fingerprint(&transport, &preset(), ApplyOptions::default())
            .await
            .expect("apply");

        let methods = transport.methods();
        let first_script_index = methods
            .iter()
            .position(|method| method == "Page.enable")
            .expect("Page.enable was not sent");
        assert!(first_script_index > 0);
        assert!(methods[..first_script_index]
            .iter()
            .all(|method| method.starts_with("Emulation.")));
    }

    #[tokio::test]
    async fn enables_the_page_domain_then_patches_the_open_document() {
        let transport = RecordingTransport::default();

        let applied = apply_fingerprint(
            &transport,
            &preset(),
            ApplyOptions {
                patch_webdriver: true,
            },
        )
        .await
        .expect("apply");

        let script_methods: Vec<String> = transport
            .methods()
            .into_iter()
            .filter(|method| !method.starts_with("Emulation."))
            .collect();
        assert_eq!(
            script_methods,
            vec![
                "Page.enable",
                "Page.addScriptToEvaluateOnNewDocument",
                "Runtime.evaluate",
            ]
        );
        let script = applied.init_script.expect("init script");
        assert_eq!(
            transport.params("Page.addScriptToEvaluateOnNewDocument"),
            json!({ "source": script })
        );
        assert_eq!(
            transport.params("Runtime.evaluate"),
            json!({ "expression": script, "returnByValue": true })
        );
    }

    #[tokio::test]
    async fn reports_the_commands_it_sent() {
        let transport = RecordingTransport::default();
        let profile: FingerprintProfile =
            serde_json::from_value(json!({ "timezoneId": "Europe/Berlin", "deviceMemory": 8 }))
                .expect("profile");

        let applied = apply_fingerprint(&transport, &profile, ApplyOptions::default())
            .await
            .expect("apply");

        assert_eq!(
            applied.commands,
            build_cdp_emulation_commands(&profile),
            "the report has to be what was sent"
        );
        assert_eq!(
            applied.profile.timezone_id.as_deref(),
            Some("Europe/Berlin")
        );
        assert_eq!(transport.methods()[0], "Emulation.setTimezoneOverride");
        assert!(applied
            .init_script
            .expect("script")
            .contains("deviceMemory"));
    }

    #[tokio::test]
    async fn skips_the_script_commands_when_the_browser_covers_everything() {
        let transport = RecordingTransport::default();
        let profile: FingerprintProfile =
            serde_json::from_value(json!({ "timezoneId": "UTC" })).expect("profile");

        let applied = apply_fingerprint(&transport, &profile, ApplyOptions::default())
            .await
            .expect("apply");

        assert_eq!(applied.init_script, None);
        assert_eq!(transport.methods(), vec!["Emulation.setTimezoneOverride"]);
    }

    #[tokio::test]
    async fn sends_nothing_for_a_profile_that_describes_nothing() {
        let transport = RecordingTransport::default();
        let profile = FingerprintProfile::default();

        let applied = apply_fingerprint(&transport, &profile, ApplyOptions::default())
            .await
            .expect("apply");

        assert_eq!(applied.commands, Vec::new());
        assert_eq!(applied.init_script, None);
        assert!(transport.methods().is_empty());
    }

    #[tokio::test]
    async fn refuses_a_profile_that_does_not_describe_a_real_machine() {
        // Sending a broken profile would leave the page half-overridden, so the
        // validation the profile module owns has to run before the first send.
        let transport = RecordingTransport::default();
        let profile: FingerprintProfile =
            serde_json::from_value(json!({ "hardwareConcurrency": 0 })).expect("profile");

        let error = apply_fingerprint(&transport, &profile, ApplyOptions::default())
            .await
            .expect_err("apply must fail");

        assert!(error.to_string().contains("hardwareConcurrency"));
        assert!(transport.methods().is_empty());
    }

    #[tokio::test]
    async fn stops_at_the_first_command_the_page_rejects() {
        // A half-applied profile is worse than a failed one: the page would
        // report a machine that does not exist, so the error has to surface.
        let transport = RecordingTransport {
            fail_on: Some("Emulation.setTimezoneOverride"),
            ..Default::default()
        };

        let error = apply_fingerprint(&transport, &preset(), ApplyOptions::default())
            .await
            .expect_err("apply must fail");

        assert!(error.to_string().contains("Target closed"));
        assert!(!transport.methods().contains(&"Page.enable".to_string()));
    }
}
