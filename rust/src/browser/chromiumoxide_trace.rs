//! Trace recording support for the chromiumoxide adapter (issue #108).
//!
//! Init scripts go through `Page.addScriptToEvaluateOnNewDocument`, and page
//! activity is read from the CDP events chromiumoxide already enables (`Page`,
//! `Runtime` and `Network`), translated by [`super::cdp_trace_events`].

use chromiumoxide::cdp::browser_protocol::network::{EventLoadingFailed, EventRequestWillBeSent};
use chromiumoxide::cdp::browser_protocol::page::{
    EventFrameNavigated, EventJavascriptDialogOpening, RemoveScriptToEvaluateOnNewDocumentParams,
};
use chromiumoxide::cdp::js_protocol::runtime::{EventConsoleApiCalled, EventExceptionThrown};
use chromiumoxide::Page as CdpPage;
use futures::stream::{self, BoxStream};
use futures::StreamExt;

use super::cdp_trace_events::{CdpTraceEvent, CdpTraceTranslator};
use crate::core::engine::{EngineError, TraceEngineEvent};

/// Register `script` for every new document; its CDP identifier.
pub(crate) async fn add_init_script(
    page: &CdpPage,
    script: &str,
) -> Result<Option<String>, EngineError> {
    let identifier = page
        .evaluate_on_new_document(script.to_string())
        .await
        .map_err(|error| EngineError::Browser(error.to_string()))?;
    Ok(Some(identifier.inner().clone()))
}

/// Undo [`add_init_script`].
pub(crate) async fn remove_init_script(
    page: &CdpPage,
    identifier: &str,
) -> Result<(), EngineError> {
    page.execute(RemoveScriptToEvaluateOnNewDocumentParams::new(
        identifier.to_string(),
    ))
    .await
    .map(|_| ())
    .map_err(|error| EngineError::Browser(error.to_string()))
}

/// Every CDP event a trace records, as one stream; `None` when the page would
/// not let us listen.
pub(crate) async fn trace_events(page: &CdpPage) -> Option<BoxStream<'static, TraceEngineEvent>> {
    let navigated = page
        .event_listener::<EventFrameNavigated>()
        .await
        .ok()?
        .map(|event| CdpTraceEvent::FrameNavigated {
            child: event.frame.parent_id.is_some(),
            url: event.frame.url.clone(),
            fragment: event.frame.url_fragment.clone(),
        })
        .boxed();
    let dialogs = page
        .event_listener::<EventJavascriptDialogOpening>()
        .await
        .ok()?
        .map(|event| CdpTraceEvent::Dialog {
            dialog_type: event.r#type.as_ref().to_string(),
            message: event.message.clone(),
        })
        .boxed();
    let requests = page
        .event_listener::<EventRequestWillBeSent>()
        .await
        .ok()?
        .map(|event| CdpTraceEvent::RequestWillBeSent {
            id: event.request_id.inner().clone(),
            url: format!(
                "{}{}",
                event.request.url,
                event.request.url_fragment.clone().unwrap_or_default()
            ),
            method: event.request.method.clone(),
        })
        .boxed();
    let failures = page
        .event_listener::<EventLoadingFailed>()
        .await
        .ok()?
        .map(|event| CdpTraceEvent::LoadingFailed {
            id: event.request_id.inner().clone(),
            error_text: event.error_text.clone(),
        })
        .boxed();
    let console = page
        .event_listener::<EventConsoleApiCalled>()
        .await
        .ok()?
        .map(|event| CdpTraceEvent::Console {
            level: event.r#type.as_ref().to_string(),
            args: event
                .args
                .iter()
                .map(|argument| (argument.value.clone(), argument.description.clone()))
                .collect(),
        })
        .boxed();
    let exceptions = page
        .event_listener::<EventExceptionThrown>()
        .await
        .ok()?
        .map(|event| {
            let details = &event.exception_details;
            let exception = details.exception.as_ref();
            CdpTraceEvent::Exception {
                text: details.text.clone(),
                description: exception.and_then(|object| object.description.clone()),
                value: exception.and_then(|object| object.value.clone()),
            }
        })
        .boxed();
    let events = stream::select_all([navigated, dialogs, requests, failures, console, exceptions])
        .scan(CdpTraceTranslator::default(), |translator, event| {
            futures::future::ready(Some(translator.translate(event)))
        })
        .filter_map(futures::future::ready);
    Some(events.boxed())
}
