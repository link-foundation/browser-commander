//! Stable native-view capture without Playwright's full-page capture path.
use super::PlaywrightDriverPage;
use crate::capture::{ScreenshotOptions, ScreenshotScale};
use crate::core::engine::EngineError;
use crate::playwright::protocol::*;
use crate::playwright::ChannelType;
use serde_json::json;

pub(super) async fn stable_viewport(
    page: &PlaywrightDriverPage,
    options: &ScreenshotOptions,
) -> Result<Option<Vec<u8>>, EngineError> {
    if options.scale == ScreenshotScale::Css {
        return Err(crate::capture::unsupported(
            page,
            "stable viewport CSS scale",
        ));
    }
    // The native browser view bypasses the driver's viewport/pixel-density emulation.
    if page
        .page
        .initializer()
        .map_err(super::engine_error)?
        .viewport_size
        .is_some()
    {
        return Ok(None);
    }
    let created = page
        .context
        .new_cdp_session(BrowserContextNewCDPSessionParams {
            page: Some((&page.page).into()),
            frame: None,
        })
        .await
        .map_err(super::engine_error)?;
    let session: CDPSession = page
        .driver
        .connection()
        .object(&created.session)
        .map_err(super::engine_error)?;
    let mut params =
        json!({"format": options.format, "fromSurface": false, "captureBeyondViewport": false});
    if let Some(quality) = options.quality {
        params["quality"] = json!(quality);
    }
    let result = session
        .send(CDPSessionSendParams {
            method: "Page.captureScreenshot".into(),
            params: Some(params),
        })
        .await;
    session.detach().await.map_err(super::engine_error)?;
    match result {
        Ok(result) => super::decode_binary(
            result.result["data"]
                .as_str()
                .ok_or_else(|| EngineError::Browser("missing screenshot data".into()))?,
        )
        .map(Some),
        Err(error) if error.to_string().contains("Unable to capture screenshot") => Ok(None),
        Err(error) => Err(super::engine_error(error)),
    }
}
