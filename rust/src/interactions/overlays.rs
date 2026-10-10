//! Dismiss only caller-configured visible overlay controls before an interaction.
use crate::core::engine::{EngineAdapter, EngineError};

pub async fn dismiss_overlays(
    adapter: &dyn EngineAdapter,
    selectors: &[&str],
) -> Result<Vec<String>, EngineError> {
    let mut dismissed = Vec::new();
    for selector in selectors {
        if adapter.query_selector(selector).await?.is_some() && adapter.is_visible(selector).await?
        {
            adapter.click(selector).await?;
            dismissed.push((*selector).to_owned());
        }
    }
    Ok(dismissed)
}
