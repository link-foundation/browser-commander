//! Ordered fallbacks, text matching, and indexed form controls.
use crate::core::engine::{EngineAdapter, EngineError};
use serde_json::{json, Value};

/// Resolve a zero-based CSS match to its actual DOM path without changing the DOM.
pub async fn indexed_selector(
    adapter: &dyn EngineAdapter,
    selector: &str,
    index: Option<usize>,
) -> Result<String, EngineError> {
    let Some(index) = index else {
        return Ok(selector.into());
    };
    let value = adapter.evaluate(&format!(r#"(() => {{
        let el = document.querySelectorAll({selector})[{index}];
        if (!el) return null;
        const path = [];
        while (el) {{
            const position = el.parentElement ? Array.from(el.parentElement.children).indexOf(el) + 1 : 1;
            path.unshift(el.localName + ':nth-child(' + position + ')');
            el = el.parentElement;
        }}
        return path.join(' > ');
    }})()"#, selector=json!(selector))).await?;
    value
        .as_str()
        .map(String::from)
        .ok_or_else(|| EngineError::ElementNotFound(format!("{selector}[{index}]")))
}

pub async fn find_first(
    adapter: &dyn EngineAdapter,
    selectors: &[&str],
    visible: bool,
) -> Result<Option<String>, EngineError> {
    for selector in selectors {
        if adapter.count(selector).await? > 0 && (!visible || adapter.is_visible(selector).await?) {
            return Ok(Some((*selector).into()));
        }
    }
    Ok(None)
}

pub async fn has_text(
    adapter: &dyn EngineAdapter,
    texts: &[&str],
    normalize_whitespace: bool,
) -> Result<bool, EngineError> {
    let value = adapter
        .evaluate(&format!(
            r#"(() => {{
        const clean = value => {normalize_whitespace} ? value.replace(/\s+/gu, ' ').trim() : value;
        const body = clean(document.body?.textContent ?? '');
        return {texts}.some(text => body.includes(clean(text)));
    }})()"#,
            texts = json!(texts)
        ))
        .await?;
    Ok(value.as_bool().unwrap_or(false))
}

pub async fn is_checked(
    adapter: &dyn EngineAdapter,
    selector: &str,
    index: Option<usize>,
) -> Result<bool, EngineError> {
    let selector = indexed_selector(adapter, selector, index).await?;
    Ok(adapter
        .evaluate(&format!(
            "Boolean(document.querySelector({})?.checked)",
            json!(selector)
        ))
        .await?
        .as_bool()
        .unwrap_or(false))
}

pub async fn check(
    adapter: &dyn EngineAdapter,
    selector: &str,
    checked: bool,
    index: Option<usize>,
) -> Result<Value, EngineError> {
    let selector = indexed_selector(adapter, selector, index).await?;
    let kind = adapter
        .evaluate(&format!(
            "document.querySelector({})?.type",
            json!(selector)
        ))
        .await?;
    if !matches!(kind.as_str(), Some("checkbox" | "radio")) || (kind == "radio" && !checked) {
        return Err(EngineError::Browser(
            "check requires a checkbox or a radio being checked".into(),
        ));
    }
    let before = is_checked(adapter, &selector, None).await?;
    if before != checked {
        adapter.click(&selector).await?;
    }
    let after = is_checked(adapter, &selector, None).await?;
    Ok(json!({"checked": after, "changed": before != after, "verified": after == checked}))
}
