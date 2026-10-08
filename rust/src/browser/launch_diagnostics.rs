//! Stable launch failures with bounded, scrubbed evidence.
// feature-parity: launch.diagnostics@native-typed
use std::fmt;
use std::sync::Arc;

use crate::core::engine::EngineType;

#[derive(Clone)]
pub struct DiagnosticRedactor(pub Arc<dyn Fn(&str) -> String + Send + Sync>);
impl fmt::Debug for DiagnosticRedactor {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("DiagnosticRedactor(..)")
    }
}

pub fn redact_launch_evidence(value: &str, redactor: Option<&DiagnosticRedactor>) -> String {
    let urls = regex::Regex::new(r#"(?i)\b(?:https?|wss?)://[^\s"'<>]+"#).unwrap();
    let paths = regex::Regex::new(r#"(?:[A-Za-z]:\\|/)[^\s:;"'<>]+"#).unwrap();
    let secrets =
        regex::Regex::new(r"(?i)\b(token|password|secret|authorization|cookie)\s*[=:]\s*[^\s,;]+")
            .unwrap();
    let value = secrets
        .replace_all(
            &paths.replace_all(&urls.replace_all(value, "[url]"), "[path]"),
            "$1=[redacted]",
        )
        .into_owned();
    let value = match redactor {
        Some(redactor) => (redactor.0)(&value),
        None => value,
    };
    let mut start = value.len().saturating_sub(4096);
    while !value.is_char_boundary(start) {
        start += 1;
    }
    value[start..].to_string()
}

#[derive(Debug)]
pub struct BrowserLaunchError {
    pub phase: &'static str,
    pub engine: EngineType,
    pub category: &'static str,
    pub exit_code: Option<i32>,
    /// Unavailable when command-stream only reports a combined exit status.
    pub signal: Option<String>,
    pub stderr_tail: String,
    pub cause: anyhow::Error,
}
impl fmt::Display for BrowserLaunchError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "Browser launch failed ({}: {}): {}",
            self.phase,
            self.category,
            if self.stderr_tail.is_empty() {
                self.cause.to_string()
            } else {
                self.stderr_tail.clone()
            }
        )
    }
}
impl std::error::Error for BrowserLaunchError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(self.cause.as_ref())
    }
}

pub(crate) fn launch_failure(
    error: anyhow::Error,
    phase: &'static str,
    options: &super::real_browser::RealBrowserOptions,
    process: Option<&super::BrowserProcess>,
) -> anyhow::Error {
    if error.is::<BrowserLaunchError>() {
        return error;
    }
    let text = error.to_string();
    let lower = text.to_lowercase();
    let category = if error.downcast_ref::<super::PortRaceError>().is_some() {
        "port_race"
    } else if [
        "not found",
        "does not exist",
        "not an executable",
        "not accessible",
        "no such file",
        "no installed",
        "could not find",
    ]
    .iter()
    .any(|p| lower.contains(p))
    {
        "missing_executable"
    } else if lower.contains("timed out") || lower.contains("timeout") {
        "startup_timeout"
    } else if process.and_then(|p| p.exit_code()).is_some() {
        "early_exit"
    } else {
        "configuration"
    };
    BrowserLaunchError {
        phase,
        engine: options.engine,
        category,
        exit_code: process.and_then(|p| p.exit_code()),
        signal: None,
        stderr_tail: redact_launch_evidence(
            &process.map(|p| p.stderr_tail()).unwrap_or_default(),
            options.diagnostic_redactor.as_ref(),
        ),
        cause: anyhow::anyhow!(redact_launch_evidence(
            &text,
            options.diagnostic_redactor.as_ref()
        )),
    }
    .into()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn scrubs_url_credentials_and_bounds_multibyte_evidence() {
        let value = redact_launch_evidence(
            &[
                "https://",
                "user:",
                "private@example.test/secret?access=private",
            ]
            .concat(),
            None,
        );
        assert!(!value.contains("private") && !value.contains("example.test"));
        assert!(redact_launch_evidence(&"😀".repeat(4096), None).len() <= 4096);
    }
    #[test]
    fn bounds_and_scrubs_evidence_and_preserves_safe_cause() {
        let options = super::super::real_browser::RealBrowserOptions::default();
        let error = launch_failure(
            anyhow::anyhow!("not found /private/profile token=secret"),
            "discovery",
            &options,
            None,
        );
        let typed = error.downcast_ref::<BrowserLaunchError>().unwrap();
        assert_eq!(typed.category, "missing_executable");
        assert!(!typed.to_string().contains("/private"));
        assert!(!typed.cause.to_string().contains("token=secret"));
        assert_eq!(redact_launch_evidence(&"x".repeat(8192), None).len(), 4096);
    }
}
