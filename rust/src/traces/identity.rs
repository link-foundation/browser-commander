//! Who a trace record belongs to (issue #93).
//!
//! Mirrors `js/src/traces/identity.js`: trace, context and page identifiers
//! count up per process, and the same context or page keeps the identifier it
//! was given first, so two traces of one page say so.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

use super::jsonfmt::{Json, JsonObject};

static TRACES: AtomicU64 = AtomicU64::new(0);
static CONTEXTS: AtomicU64 = AtomicU64::new(0);
static PAGES: AtomicU64 = AtomicU64::new(0);

fn registry() -> &'static Mutex<HashMap<(&'static str, usize), String>> {
    static ASSIGNED: OnceLock<Mutex<HashMap<(&'static str, usize), String>>> = OnceLock::new();
    ASSIGNED.get_or_init(|| Mutex::new(HashMap::new()))
}

fn identify(kind: &'static str, counter: &AtomicU64, key: Option<usize>) -> String {
    let fresh = || format!("{kind}-{}", counter.fetch_add(1, Ordering::SeqCst) + 1);
    let Some(key) = key else {
        return fresh();
    };
    let mut assigned = registry()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    assigned.entry((kind, key)).or_insert_with(fresh).clone()
}

/// Start every identifier counter at 1 again and forget assigned identities.
///
/// Only for tests that compare a recording against a golden one, which is
/// always recorded in a fresh process.
#[doc(hidden)]
pub fn reset_trace_identity_counters() {
    TRACES.store(0, Ordering::SeqCst);
    CONTEXTS.store(0, Ordering::SeqCst);
    PAGES.store(0, Ordering::SeqCst);
    registry()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clear();
}

/// The identifiers every record of one trace carries.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TraceIdentity {
    /// `trace-N`.
    pub trace_id: String,
    /// `context-N`, or `None` when the page has no context to name.
    pub browser_context_id: Option<String>,
    /// `page-N`.
    pub page_id: String,
    navigation: u64,
    actions: u64,
}

impl TraceIdentity {
    /// Name a new trace of the page identified by `page_key`.
    ///
    /// A key is any value that stays the same for the same object, such as the
    /// address of the `Arc` holding it; without one the page gets a new name.
    pub fn new(context_key: Option<usize>, page_key: Option<usize>, has_context: bool) -> Self {
        let trace_id = format!("trace-{}", TRACES.fetch_add(1, Ordering::SeqCst) + 1);
        let browser_context_id = has_context.then(|| identify("context", &CONTEXTS, context_key));
        let page_id = identify("page", &PAGES, page_key);
        Self {
            trace_id,
            browser_context_id,
            page_id,
            navigation: 1,
            actions: 0,
        }
    }

    /// The document records are currently attributed to.
    pub fn navigation_id(&self) -> String {
        format!("nav-{}", self.navigation)
    }

    /// Move on to the next document.
    pub fn navigated(&mut self) -> String {
        self.navigation += 1;
        self.navigation_id()
    }

    /// Name the next interaction.
    pub fn next_action_id(&mut self) -> String {
        self.actions += 1;
        format!("{}-action-{}", self.trace_id, self.actions)
    }

    /// `{traceId, browserContextId, pageId, navigationId}`.
    pub fn owner(&self) -> JsonObject {
        JsonObject::new()
            .with("traceId", self.trace_id.as_str())
            .with(
                "browserContextId",
                Json::from(self.browser_context_id.clone()),
            )
            .with("pageId", self.page_id.as_str())
            .with("navigationId", self.navigation_id())
    }
}
