//! Chrome DevTools Protocol events as trace records (issue #108).
//!
//! The chromiumoxide adapter subscribes to the few CDP events a trace records
//! and hands them here as plain data; this module turns them into the
//! [`TraceEngineEvent`](crate::core::engine::TraceEngineEvent)s that
//! `js/src/traces/observers.js` would have recorded from
//! the same page under Playwright. It holds no CDP types, so it is tested
//! without a browser.

use std::collections::HashMap;

use serde_json::Value;

use crate::core::engine::TraceEngineEvent;

/// One CDP event, reduced to what a trace needs.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum CdpTraceEvent {
    /// `Page.frameNavigated`.
    FrameNavigated {
        /// Whether the frame has a parent (it is not the main frame).
        child: bool,
        url: String,
        /// `#...`, kept apart from the URL by CDP.
        fragment: Option<String>,
    },
    /// `Page.javascriptDialogOpening`.
    Dialog {
        dialog_type: String,
        message: String,
    },
    /// `Network.requestWillBeSent`.
    RequestWillBeSent {
        id: String,
        url: String,
        method: String,
    },
    /// `Network.loadingFailed`.
    LoadingFailed { id: String, error_text: String },
    /// `Runtime.consoleAPICalled`; each argument's value and description.
    Console {
        level: String,
        args: Vec<(Option<Value>, Option<String>)>,
    },
    /// `Runtime.exceptionThrown`.
    Exception {
        text: String,
        description: Option<String>,
        value: Option<Value>,
    },
}

/// Requests in flight are remembered until they finish, so a failure can say
/// what failed: `Network.loadingFailed` carries only the request's id.
#[derive(Debug, Default)]
pub(crate) struct CdpTraceTranslator {
    requests: HashMap<String, (String, String)>,
    /// Failures whose request event has not been seen yet.
    failures: HashMap<String, String>,
}

/// How Playwright prints one console argument.
fn console_argument(value: &Option<Value>, description: &Option<String>) -> String {
    match (value, description) {
        (Some(Value::String(text)), _) => text.clone(),
        (Some(Value::Null), _) => "null".to_string(),
        (Some(value), None) if !value.is_object() && !value.is_array() => value.to_string(),
        (_, Some(description)) => description.clone(),
        (Some(value), None) => value.to_string(),
        (None, None) => "undefined".to_string(),
    }
}

/// `Error: message` becomes `message`; anything else is kept whole.
fn error_message(description: &str) -> String {
    let first = description.lines().next().unwrap_or_default();
    match first.split_once(": ") {
        Some((name, message)) if !name.is_empty() && !name.contains(char::is_whitespace) => {
            message.to_string()
        }
        _ => first.to_string(),
    }
}

impl CdpTraceTranslator {
    /// The record `event` stands for, if any.
    pub fn translate(&mut self, event: CdpTraceEvent) -> Option<TraceEngineEvent> {
        match event {
            CdpTraceEvent::FrameNavigated {
                child,
                url,
                fragment,
            } => Some(TraceEngineEvent::Navigated {
                main_frame: !child,
                url: format!("{url}{}", fragment.unwrap_or_default()),
            }),
            CdpTraceEvent::Dialog {
                dialog_type,
                message,
            } => Some(TraceEngineEvent::Dialog {
                dialog_type,
                message,
            }),
            CdpTraceEvent::RequestWillBeSent { id, url, method } => {
                if let Some(error_text) = self.failures.remove(&id) {
                    return Some(TraceEngineEvent::RequestFailed {
                        url,
                        method,
                        error_text: Some(error_text),
                    });
                }
                self.requests.insert(id, (url, method));
                None
            }
            CdpTraceEvent::LoadingFailed { id, error_text } => match self.requests.remove(&id) {
                Some((url, method)) => Some(TraceEngineEvent::RequestFailed {
                    url,
                    method,
                    error_text: Some(error_text),
                }),
                None => {
                    self.failures.insert(id, error_text);
                    None
                }
            },
            CdpTraceEvent::Console { level, args } => Some(TraceEngineEvent::Console {
                level,
                text: args
                    .iter()
                    .map(|(value, description)| console_argument(value, description))
                    .collect::<Vec<_>>()
                    .join(" "),
            }),
            CdpTraceEvent::Exception {
                text,
                description,
                value,
            } => Some(match (description, value) {
                (Some(description), _) => TraceEngineEvent::PageError {
                    message: error_message(&description),
                    stack: Some(description),
                },
                (None, Some(value)) => TraceEngineEvent::PageError {
                    message: console_argument(&Some(value), &None),
                    stack: None,
                },
                (None, None) => TraceEngineEvent::PageError {
                    message: text,
                    stack: None,
                },
            }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn navigations_keep_their_fragment_and_frame() {
        let mut translator = CdpTraceTranslator::default();
        assert_eq!(
            translator.translate(CdpTraceEvent::FrameNavigated {
                child: false,
                url: "https://example.com/a".into(),
                fragment: Some("#top".into()),
            }),
            Some(TraceEngineEvent::Navigated {
                main_frame: true,
                url: "https://example.com/a#top".into(),
            })
        );
    }

    #[test]
    fn failed_requests_name_the_request_in_either_order() {
        let mut translator = CdpTraceTranslator::default();
        let sent = |id: &str| CdpTraceEvent::RequestWillBeSent {
            id: id.into(),
            url: format!("https://example.com/{id}"),
            method: "GET".into(),
        };
        let failed = |id: &str| CdpTraceEvent::LoadingFailed {
            id: id.into(),
            error_text: "net::ERR_FAILED".into(),
        };
        let expected = |id: &str| {
            Some(TraceEngineEvent::RequestFailed {
                url: format!("https://example.com/{id}"),
                method: "GET".into(),
                error_text: Some("net::ERR_FAILED".into()),
            })
        };
        assert_eq!(translator.translate(sent("1")), None);
        assert_eq!(translator.translate(failed("1")), expected("1"));
        assert_eq!(translator.translate(failed("2")), None);
        assert_eq!(translator.translate(sent("2")), expected("2"));
        assert!(translator.requests.is_empty() && translator.failures.is_empty());
    }

    #[test]
    fn console_arguments_print_like_playwright() {
        let mut translator = CdpTraceTranslator::default();
        let event = CdpTraceEvent::Console {
            level: "warning".into(),
            args: vec![
                (Some(json!("count")), None),
                (Some(json!(3)), Some("3".into())),
                (None, Some("Object".into())),
                (Some(Value::Null), None),
                (None, None),
            ],
        };
        assert_eq!(
            translator.translate(event),
            Some(TraceEngineEvent::Console {
                level: "warning".into(),
                text: "count 3 Object null undefined".into(),
            })
        );
    }

    #[test]
    fn exceptions_split_message_and_stack() {
        let mut translator = CdpTraceTranslator::default();
        let thrown = CdpTraceEvent::Exception {
            text: "Uncaught".into(),
            description: Some("TypeError: x is not a function\n    at a.js:1:2".into()),
            value: None,
        };
        assert_eq!(
            translator.translate(thrown),
            Some(TraceEngineEvent::PageError {
                message: "x is not a function".into(),
                stack: Some("TypeError: x is not a function\n    at a.js:1:2".into()),
            })
        );
        let primitive = CdpTraceEvent::Exception {
            text: "Uncaught".into(),
            description: None,
            value: Some(json!("plain")),
        };
        assert_eq!(
            translator.translate(primitive),
            Some(TraceEngineEvent::PageError {
                message: "plain".into(),
                stack: None,
            })
        );
    }
}
