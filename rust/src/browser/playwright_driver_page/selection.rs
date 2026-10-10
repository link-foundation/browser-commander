//! Tab selection for the native Playwright adapter.
use super::{evaluate, PlaywrightConnect};
use crate::playwright::{protocol::*, ChannelType, Connection, ProtocolError};
use serde_json::{json, Value};
use std::collections::HashMap;

/// A fresh profile can open a tab that takes the foreground after startup,
/// so the visible tab wins over the first one.
pub(super) async fn pick_foreground_page(
    connection: &Connection,
    context: &BrowserContext,
    pages: Vec<Page>,
    options: &PlaywrightConnect,
) -> Result<Option<Page>, ProtocolError> {
    let mut targets = HashMap::new();
    for page in &pages {
        let created = context
            .new_cdp_session(BrowserContextNewCDPSessionParams {
                page: Some(page.into()),
                frame: None,
            })
            .await?;
        let session: CDPSession = connection.object(&created.session)?;
        let info = session
            .send(CDPSessionSendParams {
                method: "Target.getTargetInfo".into(),
                params: None,
            })
            .await;
        if info.is_err() {
            let _ = session.detach().await;
        }
        let info = info?;
        targets.insert(
            page.guid().to_string(),
            info.result["targetInfo"]["targetId"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
        );
        let result = session
            .send(CDPSessionSendParams {
                method: "Emulation.setFocusEmulationEnabled".into(),
                params: Some(json!({"enabled": false})),
            })
            .await;
        session.detach().await?;
        result?;
    }
    let mut matchers = options.url_matchers.clone();
    if let Some(url) = &options.url {
        matchers.insert(0, url.clone());
    }
    if options.target_id.is_some() || !matchers.is_empty() {
        let target_exists = pages
            .iter()
            .any(|page| targets.get(page.guid()) == options.target_id.as_ref());
        let eligible: Vec<_> = pages
            .iter()
            .filter(|page| {
                options.target_id.is_none()
                    || (options.fallback && !target_exists)
                    || targets.get(page.guid()) == options.target_id.as_ref()
            })
            .collect();
        let mut candidates = Vec::new();
        for page in eligible {
            let frame: Frame = connection.object(&page.initializer()?.main_frame)?;
            let url = evaluate(&frame, "location.href", None, &Value::Null).await?;
            let rank = if matchers.is_empty() {
                Some(0)
            } else {
                matchers
                    .iter()
                    .position(|expected| url.as_str() == Some(expected.as_str()))
            };
            if let Some(rank) = rank {
                candidates.push((rank, page));
            }
        }
        candidates.sort_by_key(|(rank, _)| *rank);
        if let Some((_, page)) = candidates.first() {
            close_other_pages(&pages, page, options.single_tab).await?;
            return Ok(Some((*page).clone()));
        }
        if !options.fallback {
            return Err(ProtocolError::Driver(
                "No tab matches the requested targetId/URL".into(),
            ));
        }
    }
    for page in &pages {
        let frame: Frame = connection.object(&page.initializer()?.main_frame)?;
        match evaluate(&frame, "document.visibilityState", None, &Value::Null).await {
            Ok(state) if state == "visible" => {
                close_other_pages(&pages, page, options.single_tab).await?;
                return Ok(Some(page.clone()));
            }
            Ok(_) => {}
            Err(error) => tracing::debug!(%error, "visibilityState failed"),
        }
    }
    if let Some(page) = pages.first() {
        close_other_pages(&pages, page, options.single_tab).await?;
    }
    Ok(pages.into_iter().next())
}
async fn close_other_pages(
    pages: &[Page],
    selected: &Page,
    single_tab: bool,
) -> Result<(), ProtocolError> {
    if single_tab {
        for page in pages {
            if page.guid() != selected.guid() {
                page.close(PageCloseParams::default()).await?;
            }
        }
    }
    Ok(())
}

/// Retry only the unsupported existing-context override when the option was omitted.
pub(super) async fn connect_over_cdp(
    driver: &crate::playwright::PlaywrightDriver,
    options: &PlaywrightConnect,
) -> Result<BrowserTypeConnectOverCDPResult, ProtocolError> {
    let chromium = super::chromium(driver)?;
    let mut params = BrowserTypeConnectOverCDPParams {
        endpoint_url: Some(options.endpoint.clone()),
        slow_mo: (options.slow_mo > 0).then_some(options.slow_mo as f64),
        no_defaults: options.no_defaults,
        ..Default::default()
    };
    let timeout = options
        .timeout
        .map(super::millis)
        .unwrap_or(super::ACTION_TIMEOUT_MS);
    let attempt = chromium
        .channel()
        .send_with_timeout::<_, BrowserTypeConnectOverCDPResult>(
            "connectOverCDP",
            &params,
            Some(timeout),
        )
        .await;
    let result = match attempt {
        Err(error)
            if options.no_defaults.is_none()
                && error.to_string().contains("Browser.setDownloadBehavior")
                && error
                    .to_string()
                    .contains("Browser context management is not supported") =>
        {
            params.no_defaults = Some(true);
            chromium
                .channel()
                .send_with_timeout("connectOverCDP", &params, Some(timeout))
                .await?
        }
        result => result?,
    };
    Ok(result)
}
