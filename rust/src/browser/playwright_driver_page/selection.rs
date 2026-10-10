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
            .await?;
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
    if options.target_id.is_some() || options.url.is_some() {
        for page in &pages {
            if options
                .target_id
                .as_ref()
                .is_some_and(|id| targets.get(page.guid()) != Some(id))
            {
                continue;
            }
            let frame: Frame = connection.object(&page.initializer()?.main_frame)?;
            let url = evaluate(&frame, "location.href", None, &Value::Null).await?;
            if options
                .url
                .as_ref()
                .is_some_and(|expected| url.as_str() != Some(expected.as_str()))
            {
                continue;
            }
            if options.single_tab {
                for other in &pages {
                    if other.guid() != page.guid() {
                        other.close(PageCloseParams::default()).await?;
                    }
                }
            }
            return Ok(Some(page.clone()));
        }
        return Err(ProtocolError::Driver(
            "No tab matches the requested targetId/URL".into(),
        ));
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
