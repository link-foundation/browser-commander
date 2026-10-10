//! Dismiss only caller-configured visible overlay controls before an interaction.
use crate::core::engine::{EngineAdapter, EngineError};
use std::time::Duration;

#[derive(Debug, Clone)]
pub struct OverlayReport {
    pub selector: String,
    pub dismissed: bool,
    pub error: Option<String>,
}

/// Errors are reported and isolated; dismissal must not block the requested action.
pub async fn dismiss_overlays_with_report(
    adapter: &dyn EngineAdapter,
    selectors: &[&str],
    on_dismiss: Option<&(dyn Fn(&OverlayReport) + Send + Sync)>,
) -> Vec<OverlayReport> {
    let mut reports = Vec::new();
    for selector in selectors {
        let source = format!(
            r#"(() => {{
          const matches = Array.from(document.querySelectorAll({}));
          const element = matches.find(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
          if (!element) return null;
          const steps = [];
          for (let node = element; node; node = node.parentElement) {{
            let index = 1;
            for (let previous = node.previousElementSibling; previous; previous = previous.previousElementSibling) {{ if (previous.localName === node.localName) index++; }}
            steps.unshift(node.localName + ':nth-of-type(' + index + ')');
          }}
          return steps.join(' > ');
        }})()"#,
            serde_json::to_string(selector).unwrap()
        );
        let result = tokio::time::timeout(Duration::from_secs(1), async {
            let target = adapter.evaluate(&source).await?;
            if let Some(target) = target.as_str() {
                adapter.click(target).await?;
                return Ok::<_, EngineError>(true);
            }
            Ok(false)
        })
        .await;
        let report = match result {
            Ok(Ok(dismissed)) => OverlayReport {
                selector: (*selector).into(),
                dismissed,
                error: None,
            },
            Ok(Err(error)) => OverlayReport {
                selector: (*selector).into(),
                dismissed: false,
                error: Some(error.to_string()),
            },
            Err(_) => OverlayReport {
                selector: (*selector).into(),
                dismissed: false,
                error: Some("overlay dismissal timed out".into()),
            },
        };
        if let Some(callback) = on_dismiss {
            callback(&report);
        }
        reports.push(report);
    }
    reports
}

pub async fn dismiss_overlays(
    adapter: &dyn EngineAdapter,
    selectors: &[&str],
) -> Result<Vec<String>, EngineError> {
    Ok(dismiss_overlays_with_report(adapter, selectors, None)
        .await
        .into_iter()
        .filter(|report| report.dismissed)
        .map(|report| report.selector)
        .collect())
}
