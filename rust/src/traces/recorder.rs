//! The trace recorder (issue #87), native in Rust (issue #108).
//!
//! A caller starts a recorder over a page, names checkpoints and stops it, and
//! gets the same bundle `js/src/traces/recorder.js` writes: the same records in
//! the same order with the same fields, the same checkpoint members, the same
//! manifest, and the same Links Notation export written as the trace records.
//!
//! Page activity (navigations, console output, page errors, failed requests,
//! dialogs and downloads) arrives on the engine's [`TraceEngineEvent`] stream
//! and is written by a background task as it happens. Every recorder call first
//! waits for that task to write what had already arrived, so a record written
//! by a call always follows the page activity that came before it.

use std::fmt::Display;
use std::fs;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError, Weak};

use futures::stream::BoxStream;
use futures::StreamExt;
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;

use super::assets::trace_assets;
use super::bundle::{create_manifest, Bundle, ManifestParts, TraceLimits, TraceRecordError};
use super::identity::TraceIdentity;
use super::jsonfmt::{js_number, Json, JsonObject};
use super::links::{LinksHeader, LinksSink};
use super::mutation_stream::{collect_batches, MutationStream};
use super::page::{with_deadline, TracePage};
use super::redaction::{
    normalize_privacy_options, redact_object, redact_url, NormalizedPrivacy, REDACTED,
};
use super::schema::{
    TraceCheckpointReason, TraceDropReason, TraceEvent, TraceMode, TraceOutcome,
    TRACE_EVENT_SOURCES, TRACE_SCHEMA_VERSION,
};
use crate::core::engine::TraceEngineEvent;

pub use super::recorder_options::{
    TraceCheckpointOptions, TraceDomOptions, TraceFailure, TraceInitialCheckpoint, TraceOptions,
    TraceResult, TraceScreenshots, TraceStopOptions, DEFAULT_CAPTURE_TIMEOUT_MS,
};

/// Event sources reported by the engine rather than by the recorder's caller.
const PAGE_SOURCES: [&str; 6] = [
    "navigation",
    "console",
    "pageerror",
    "requestfailed",
    "dialog",
    "download",
];

/// Settled once, when the trace starts.
struct Settings {
    mode: String,
    engine: Option<String>,
    dom: JsonObject,
    mutations: bool,
    live_state: bool,
    capture: Json,
    events: Vec<String>,
    privacy: NormalizedPrivacy,
    limits: TraceLimits,
    screenshots: TraceScreenshots,
    capture_timeout_ms: u64,
    commander_version: Option<String>,
    started_at: String,
    root: PathBuf,
}

/// What changes while the trace runs; never held across an `await`.
struct State {
    bundle: Bundle,
    identity: TraceIdentity,
    stopped: bool,
    result: Option<TraceResult>,
    checkpoint_index: u32,
    checkpoints: Vec<JsonObject>,
    init_script: Option<String>,
}

type FlushRequest = oneshot::Sender<()>;

struct Inner {
    page: Arc<dyn TracePage>,
    settings: Settings,
    mutations: MutationStream,
    state: Mutex<State>,
    operations: tokio::sync::Mutex<()>,
    flush: Option<mpsc::UnboundedSender<FlushRequest>>,
    pump: Mutex<Option<JoinHandle<()>>>,
}

/// A running trace; cheap to clone, and every clone is the same trace.
#[derive(Clone)]
pub struct TraceRecorder {
    inner: Arc<Inner>,
}

fn invalid(message: impl Into<String>) -> TraceRecordError {
    TraceRecordError::Invalid(message.into())
}

fn normalize_mode(mode: &str) -> Result<String, TraceRecordError> {
    let values = [
        TraceMode::OFF,
        TraceMode::CHECKPOINTS,
        TraceMode::CONTINUOUS,
        TraceMode::RETAIN_ON_FAILURE,
    ];
    if values.contains(&mode) {
        Ok(mode.to_string())
    } else {
        Err(invalid(format!(
            "trace mode must be one of {}",
            values.join(", ")
        )))
    }
}

fn normalize_events(events: Option<&[String]>) -> Result<Vec<String>, TraceRecordError> {
    let Some(events) = events else {
        return Ok(TRACE_EVENT_SOURCES
            .iter()
            .map(|name| name.to_string())
            .collect());
    };
    let mut unique: Vec<String> = Vec::new();
    for name in events {
        if !TRACE_EVENT_SOURCES.contains(&name.as_str()) {
            return Err(invalid(format!(
                "unknown trace event source \"{name}\"; expected one of {}",
                TRACE_EVENT_SOURCES.join(", ")
            )));
        }
        if !unique.contains(name) {
            unique.push(name.clone());
        }
    }
    Ok(unique)
}

fn strings(values: &[String]) -> Json {
    Json::Array(values.iter().map(Json::from).collect())
}

/// Start recording `page`.
///
/// # Errors
///
/// Fails when the options are invalid or the bundle or export cannot be
/// created.
pub async fn start_trace(
    page: Arc<dyn TracePage>,
    options: TraceOptions,
) -> Result<TraceRecorder, TraceRecordError> {
    page.require_feature("tracing")?;
    let mode = normalize_mode(&options.mode)?;
    let dom = options.dom;
    let mutations = match dom.mutations {
        Some(false) => false,
        Some(true) => true,
        None => mode == TraceMode::CONTINUOUS,
    };
    let dom_json = JsonObject::new()
        .with("html", dom.html)
        .with("liveControlState", dom.live_control_state)
        .with("liveState", dom.live_state)
        .with("mutations", mutations)
        .with("openShadowRoots", dom.open_shadow_roots);
    let events = normalize_events(options.events.as_deref())?;
    let privacy =
        normalize_privacy_options(&options.privacy).map_err(|error| invalid(error.to_string()))?;
    if let Some(links) = &options.links {
        if links.output.as_os_str().is_empty() {
            return Err(invalid("trace links require an output path"));
        }
    }
    let engine = options.engine.clone().or_else(|| page.engine());
    let identity = TraceIdentity::new(page.context_key(), page.page_key(), page.has_context());
    let base_checkpoint = match options.initial_checkpoint.clone() {
        Some(TraceInitialCheckpoint::Skip) => None,
        Some(TraceInitialCheckpoint::Take) => Some("initial".to_string()),
        Some(TraceInitialCheckpoint::Named(name)) => Some(name),
        None => (mode == TraceMode::CONTINUOUS).then(|| "initial".to_string()),
    };

    let mut bundle = Bundle::open(
        &options.output,
        &options.limits,
        options.strict,
        options.clock,
    )?;
    let started_at = bundle.now_iso();
    if let Some(links) = &options.links {
        let header = LinksHeader {
            bundle: bundle
                .root
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_default(),
            schema_version: Some(Json::from(TRACE_SCHEMA_VERSION)),
            mode: Some(Json::from(mode.as_str())),
            engine: Some(Json::from(engine.clone())),
            started_at: Some(Json::from(started_at.as_str())),
            commander_version: Some(Json::from(options.commander_version.clone())),
        };
        bundle.links = Some(LinksSink::open(links, header).map_err(invalid)?);
    }

    let capture = JsonObject::new()
        .with("redactSelectors", strings(&privacy.redact_selectors))
        .with("redactAttributes", strings(&privacy.redact_attributes))
        .with("redacted", REDACTED)
        .with("html", dom.html)
        .with("liveControlState", dom.live_control_state)
        .with("openShadowRoots", dom.open_shadow_roots)
        .with("maxHtmlBytes", options.limits.max_html_bytes.unwrap_or(0));
    let stream = MutationStream::new(
        mutations,
        &privacy.redact_selectors,
        options.limits.max_queued_mutations,
        dom.live_state,
        options.capture_timeout_ms,
    );

    // The observers attach before anything is recorded, as in JavaScript.
    let page_events = if PAGE_SOURCES
        .iter()
        .any(|source| events.iter().any(|e| e == source))
    {
        page.events().await
    } else {
        None
    };
    let (flush, flushes) = match page_events {
        Some(_) => {
            let (sender, receiver) = mpsc::unbounded_channel();
            (Some(sender), Some(receiver))
        }
        None => (None, None),
    };

    let root = bundle.root.clone();
    let inner = Arc::new(Inner {
        page,
        settings: Settings {
            mode,
            engine,
            dom: dom_json,
            mutations,
            live_state: dom.live_state,
            capture: Json::Object(capture),
            events,
            privacy,
            limits: options.limits,
            screenshots: options.screenshots,
            capture_timeout_ms: options.capture_timeout_ms,
            commander_version: options.commander_version,
            started_at,
            root,
        },
        mutations: stream,
        state: Mutex::new(State {
            bundle,
            identity,
            stopped: false,
            result: None,
            checkpoint_index: 0,
            checkpoints: Vec::new(),
            init_script: None,
        }),
        operations: tokio::sync::Mutex::new(()),
        flush,
        pump: Mutex::new(None),
    });
    if let (Some(events), Some(flushes)) = (page_events, flushes) {
        let task = tokio::spawn(pump(Arc::downgrade(&inner), events, flushes));
        *inner.pump.lock().unwrap_or_else(PoisonError::into_inner) = Some(task);
    }

    // Registered before the first record, so a navigation that starts in the
    // same moment as the trace is still recorded from its first mutation.
    match inner
        .mutations
        .install_persistent(inner.page.as_ref())
        .await
    {
        Ok(identifier) => inner.lock().init_script = identifier,
        Err(message) => inner.drop_problem(
            TraceDropReason::CAPTURE_FAILED,
            "mutation-recorder-init",
            &message,
        )?,
    }

    let start = JsonObject::new()
        .with("mode", inner.settings.mode.as_str())
        .with("engine", Json::from(inner.settings.engine.clone()))
        .with("dom", inner.settings.dom.clone())
        .with("events", strings(&inner.settings.events))
        .with("initialCheckpoint", base_checkpoint.is_some());
    inner.record(TraceEvent::TRACE_START, &start)?;
    inner.install().await?;

    if let Some(name) = base_checkpoint {
        inner
            .checkpoint(&name, "recorder", TraceCheckpointReason::INITIAL)
            .await?;
    }
    Ok(TraceRecorder { inner })
}

/// Write page activity as it arrives, and answer flushes once everything that
/// had arrived is written.
async fn pump(
    inner: Weak<Inner>,
    mut events: BoxStream<'static, TraceEngineEvent>,
    mut flushes: mpsc::UnboundedReceiver<FlushRequest>,
) {
    let mut open = true;
    loop {
        tokio::select! {
            biased;
            event = events.next(), if open => match event {
                Some(event) => match inner.upgrade() {
                    Some(inner) => inner.on_page_event(event),
                    None => return,
                },
                None => open = false,
            },
            request = flushes.recv() => match request {
                Some(done) => {
                    let _ = done.send(());
                }
                None => return,
            },
        }
    }
}

impl Inner {
    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn records(&self, source: &str) -> bool {
        self.settings.events.iter().any(|name| name == source)
    }

    /// Wait until every page event that has arrived is written.
    async fn flush(&self) {
        if let Some(sender) = &self.flush {
            let (done, written) = oneshot::channel();
            if sender.send(done).is_ok() {
                let _ = written.await;
            }
        }
    }

    fn stop_pump(&self) {
        let task = self
            .pump
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take();
        if let Some(task) = task {
            task.abort();
        }
    }

    fn record_locked(
        &self,
        state: &mut State,
        kind: &str,
        payload: &JsonObject,
    ) -> Result<Option<JsonObject>, TraceRecordError> {
        if state.stopped && kind != TraceEvent::TRACE_STOP {
            return Ok(None);
        }
        // Who this happened to comes first, so a payload that knows better can
        // say so without moving the field.
        let mut event = JsonObject::new().with("kind", kind);
        event.extend_from(&state.identity.owner());
        event.extend_from(&redact_object(payload, &self.settings.privacy));
        state.bundle.append_event(event, true)
    }

    fn record(
        &self,
        kind: &str,
        payload: &JsonObject,
    ) -> Result<Option<JsonObject>, TraceRecordError> {
        self.record_locked(&mut self.lock(), kind, payload)
    }

    fn drop_problem(
        &self,
        reason: &str,
        member: &str,
        detail: &str,
    ) -> Result<(), TraceRecordError> {
        self.lock()
            .bundle
            .drop_record(reason, Some(member), Some(detail))
    }

    fn on_page_event(&self, event: TraceEngineEvent) {
        let mut state = self.lock();
        let (source, kind, payload) = match event {
            TraceEngineEvent::Navigated { main_frame, url } => {
                if !self.records("navigation") {
                    return;
                }
                // A record's navigation is the one it happened during, so the
                // counter moves on before the record of the move is written.
                let navigation = if main_frame {
                    state.identity.navigated()
                } else {
                    state.identity.navigation_id()
                };
                let payload = JsonObject::new()
                    .with("phase", "framenavigated")
                    .with("navigationId", navigation)
                    .with("mainFrame", main_frame)
                    .with("url", url);
                ("navigation", TraceEvent::NAVIGATION, payload)
            }
            TraceEngineEvent::Console { level, text } => (
                "console",
                TraceEvent::CONSOLE,
                JsonObject::new().with("level", level).with("text", text),
            ),
            TraceEngineEvent::PageError { message, stack } => (
                "pageerror",
                TraceEvent::PAGE_ERROR,
                JsonObject::new()
                    .with("message", message)
                    .with("stack", Json::from(stack)),
            ),
            TraceEngineEvent::RequestFailed {
                url,
                method,
                error_text,
            } => (
                "requestfailed",
                TraceEvent::REQUEST_FAILED,
                JsonObject::new()
                    .with("url", url)
                    .with("method", method)
                    .with("failure", Json::from(error_text)),
            ),
            TraceEngineEvent::Dialog {
                dialog_type,
                message,
            } => (
                "dialog",
                TraceEvent::DIALOG,
                JsonObject::new()
                    .with("type", dialog_type)
                    .with("message", message),
            ),
            TraceEngineEvent::Download {
                phase,
                id,
                suggested_filename,
                path,
                checksum,
                bytes,
                url,
                failure,
            } => (
                "download",
                TraceEvent::DOWNLOAD,
                JsonObject::new()
                    .with("phase", phase)
                    .with("id", Json::from(id))
                    .with("suggestedFilename", Json::from(suggested_filename))
                    .with("path", Json::from(path))
                    .with("checksum", Json::from(checksum))
                    .with("bytes", Json::from(bytes))
                    .with("url", Json::from(url))
                    .with("failure", Json::from(failure)),
            ),
        };
        if self.records(source) {
            // Nobody is waiting on an observer's record; a strict trace's
            // failure surfaces at the next checkpoint or at stop.
            let _ = self.record_locked(&mut state, kind, &payload);
        }
    }

    async fn install(&self) -> Result<(), TraceRecordError> {
        match self.mutations.install(self.page.as_ref()).await {
            Ok(()) => Ok(()),
            Err(message) => self.drop_problem(
                TraceDropReason::CAPTURE_FAILED,
                "mutation-recorder",
                &message,
            ),
        }
    }

    /// Write what the page queued as the interval that ends at `index`.
    async fn drain(&self, index: u32) -> Result<(), TraceRecordError> {
        let frames = match self.mutations.drain(self.page.as_ref()).await {
            Ok(None) => return Ok(()),
            Ok(Some(frames)) => frames,
            Err(message) => {
                return self.drop_problem(TraceDropReason::CAPTURE_FAILED, "mutations", &message)
            }
        };
        let mut state = self.lock();
        let drained = collect_batches(&frames, &state.identity.owner());
        if drained.over != 0.0 && !drained.over.is_nan() {
            let detail = format!(
                "{} records over the in-page queue limit",
                js_number(drained.over)
            );
            state.bundle.drop_record(
                TraceDropReason::SIZE_LIMIT,
                Some("mutations"),
                Some(&detail),
            )?;
        }
        if let Some(member) = state.bundle.write_mutations(index, &drained.batches)? {
            let payload = JsonObject::new()
                .with("member", member)
                .with("batches", drained.batches.len())
                .with("checkpoint", index)
                .with("frames", drained.frames);
            self.record_locked(&mut state, TraceEvent::MUTATIONS, &payload)?;
        }
        Ok(())
    }

    async fn screenshot(&self, reason: &str) -> Result<Option<Vec<u8>>, TraceRecordError> {
        let wanted = match self.settings.screenshots {
            TraceScreenshots::Off => false,
            TraceScreenshots::Checkpoints => true,
            TraceScreenshots::OnlyOnFailure => reason == TraceCheckpointReason::FAILURE,
        };
        if !wanted {
            return Ok(None);
        }
        let shot = with_deadline(
            self.page.screenshot(),
            self.settings.capture_timeout_ms,
            "trace screenshot",
        )
        .await;
        match shot {
            Ok(shot) => Ok(shot),
            Err(message) => {
                self.drop_problem(TraceDropReason::CAPTURE_FAILED, "screenshot", &message)?;
                Ok(None)
            }
        }
    }

    async fn checkpoint(
        &self,
        name: &str,
        actor: &str,
        reason: &str,
    ) -> Result<JsonObject, TraceRecordError> {
        let index = {
            let mut state = self.lock();
            if state.stopped {
                return Err(TraceRecordError::Stopped);
            }
            state.checkpoint_index += 1;
            state.checkpoint_index
        };

        // Drained first, so the batches belong to the interval that ended here.
        self.drain(index.saturating_sub(1)).await?;

        let capture = with_deadline(
            self.page.evaluate_function(
                &trace_assets().capture.capture_snapshot,
                &self.settings.capture,
            ),
            self.settings.capture_timeout_ms,
            "trace checkpoint capture",
        )
        .await;
        let captured = match capture {
            Ok(captured) => Some(captured),
            Err(message) => {
                let dropped = if message.to_lowercase().contains("closed") {
                    TraceDropReason::PAGE_CLOSED
                } else {
                    TraceDropReason::CAPTURE_FAILED
                };
                self.drop_problem(dropped, &format!("checkpoints/{index}"), &message)?;
                None
            }
        };

        let shot = self.screenshot(reason).await?;
        let privacy = &self.settings.privacy;
        let state = captured
            .as_ref()
            .and_then(|captured| captured.get("state"))
            .filter(|state| state.truthy())
            .and_then(Json::as_object)
            .map(|state| redact_object(state, privacy));
        let html = captured
            .as_ref()
            .and_then(|captured| captured.get("html"))
            .and_then(Json::as_str);
        let named = state.as_ref().map(|state| {
            let mut named = state.clone();
            named.insert("name", name);
            named.insert("actor", actor);
            named.insert("reason", reason);
            named
        });

        // A block, not `drop()`: the guard must be gone before the `await`.
        let entry = {
            let mut locked = self.lock();
            let members =
                locked
                    .bundle
                    .write_checkpoint(index, html, named.as_ref(), shot.as_deref())?;
            let mut entry = JsonObject::new()
                .with("index", index)
                .with("name", name)
                .with("actor", actor)
                .with("reason", reason);
            match state.as_ref().map(|state| state.get("url")) {
                None => entry.insert("url", Json::Null),
                Some(Some(Json::String(url))) => entry.insert("url", redact_url(url, privacy)),
                Some(Some(other)) => entry.insert("url", other.clone()),
                // `url: undefined`, which JSON leaves out.
                Some(None) => {}
            }
            entry.insert(
                "truncated",
                captured
                    .as_ref()
                    .and_then(|captured| captured.get("truncated"))
                    .is_some_and(Json::truthy),
            );
            entry.insert("members", members);
            locked.checkpoints.push(entry.clone());
            self.record_locked(&mut locked, TraceEvent::CHECKPOINT, &entry)?;
            entry
        };

        // The init script covers every document created from here on; this
        // covers one that was created without it.
        self.install().await?;
        Ok(entry)
    }

    async fn stop(&self, options: TraceStopOptions) -> Result<TraceResult, TraceRecordError> {
        if let Some(result) = self.lock().result.clone() {
            return Ok(result);
        }
        let index = self.lock().checkpoint_index;
        self.drain(index).await?;
        let init_script = {
            let mut state = self.lock();
            if let Some(error) = &options.error {
                let payload = JsonObject::new()
                    .with("message", error.message.as_str())
                    .with("stack", Json::from(error.stack.clone()))
                    .with("fatal", true);
                self.record_locked(&mut state, TraceEvent::PAGE_ERROR, &payload)?;
            }
            let payload = JsonObject::new().with("discarded", options.discard);
            self.record_locked(&mut state, TraceEvent::TRACE_STOP, &payload)?;
            state.stopped = true;
            state.init_script.take()
        };

        // The documents that exist stop observing; then the observers detach.
        let _ = self.mutations.stop(self.page.as_ref()).await;
        if let Some(identifier) = init_script {
            let _ = self.page.remove_init_script(&identifier).await;
        }
        self.stop_pump();

        let settings = &self.settings;
        let mut state = self.lock();
        let stopped_at = state.bundle.now_iso();
        let manifest = state.bundle.close(create_manifest(ManifestParts {
            mode: settings.mode.clone(),
            outcome: TraceOutcome::COMPLETE.to_string(),
            started_at: Some(settings.started_at.clone()),
            stopped_at: Some(stopped_at),
            commander_version: settings.commander_version.clone(),
            engine: settings.engine.clone(),
            events: settings.events.iter().map(Json::from).collect(),
            dom: settings.dom.clone(),
            replay: JsonObject::new()
                .with("checkpoints", true)
                .with("mutations", settings.mutations)
                .with("childListPositions", settings.mutations)
                .with("liveState", settings.mutations && settings.live_state)
                .with("identifiers", true),
            privacy: JsonObject::new()
                .with(
                    "redactSelectors",
                    strings(&settings.privacy.redact_selectors),
                )
                .with(
                    "redactAttributes",
                    strings(&settings.privacy.redact_attributes),
                )
                .with(
                    "redactQueryParams",
                    strings(&settings.privacy.redact_query_params),
                )
                .with("hasCallback", settings.privacy.redact.is_some()),
            limits: settings.limits.to_json(),
            counts: JsonObject::new(),
        }))?;

        // Closed after the manifest: its last link reports the settled outcome,
        // and the control diffs are read back out of the finished bundle.
        let mut sink = state.bundle.links.take();
        if let Some(sink) = sink.as_mut() {
            sink.close(&manifest, Some(&settings.root));
        }
        let mut problems = state.bundle.problems.clone();
        if let Some(sink) = &sink {
            problems.extend(sink.problems.iter().cloned());
        }
        let mut result = TraceResult {
            path: settings.root.clone(),
            manifest,
            checkpoints: state.checkpoints.clone(),
            problems,
            links: sink.as_ref().map(|sink| sink.path.clone()),
            discarded: false,
        };
        if options.discard {
            let _ = fs::remove_dir_all(&settings.root);
            // An export of a bundle that no longer exists points at nothing.
            if let Some(sink) = sink.as_mut() {
                sink.discard();
            }
            result.discarded = true;
        }
        state.result = Some(result.clone());
        Ok(result)
    }
}

impl TraceRecorder {
    /// The bundle directory.
    pub fn path(&self) -> &Path {
        &self.inner.settings.root
    }

    /// The trace's mode.
    pub fn mode(&self) -> &str {
        &self.inner.settings.mode
    }

    /// The Links Notation export, when one is being written.
    pub fn links(&self) -> Option<PathBuf> {
        let state = self.inner.lock();
        match &state.result {
            Some(result) => result.links.clone(),
            None => state.bundle.links.as_ref().map(|sink| sink.path.clone()),
        }
    }

    /// Whether [`TraceRecorder::stop`] has run.
    pub fn stopped(&self) -> bool {
        self.inner.lock().stopped
    }

    /// The checkpoints taken so far.
    pub fn checkpoints(&self) -> Vec<JsonObject> {
        self.inner.lock().checkpoints.clone()
    }

    /// Capture a checkpoint taken by the automation.
    ///
    /// # Errors
    ///
    /// Fails after [`TraceRecorder::stop`], or when a strict trace drops
    /// something.
    pub async fn checkpoint(&self, name: &str) -> Result<JsonObject, TraceRecordError> {
        self.checkpoint_with(name, TraceCheckpointOptions::default())
            .await
    }

    /// Capture a checkpoint; `{index, name, actor, reason, url, truncated, members}`.
    ///
    /// # Errors
    ///
    /// As [`TraceRecorder::checkpoint`].
    pub async fn checkpoint_with(
        &self,
        name: &str,
        options: TraceCheckpointOptions,
    ) -> Result<JsonObject, TraceRecordError> {
        let _operation = self.inner.operations.lock().await;
        self.inner.flush().await;
        let actor = options.actor.as_deref().unwrap_or("automation");
        let reason = options
            .reason
            .as_deref()
            .unwrap_or(TraceCheckpointReason::CHECKPOINT);
        self.inner.checkpoint(name, actor, reason).await
    }

    /// Record something a caller cares about on the same timeline; the record
    /// written, or `None` once the trace has stopped.
    ///
    /// # Errors
    ///
    /// Fails when a strict trace drops the record.
    pub async fn event(
        &self,
        name: &str,
        data: JsonObject,
    ) -> Result<Option<JsonObject>, TraceRecordError> {
        let _operation = self.inner.operations.lock().await;
        self.inner.flush().await;
        let mut payload = JsonObject::new()
            .with("action", name)
            .with("actor", "caller");
        payload.extend_from(&data);
        self.inner.record(TraceEvent::INTERACTION, &payload)
    }

    /// Run one interaction and record it, as a traced commander method is.
    ///
    /// `target` is the selector or URL acted on; typed text never belongs
    /// there. The interaction is recorded only when the trace records the
    /// `interaction` source, and the work's own outcome is returned unchanged.
    pub async fn traced<T, E, F>(&self, action: &str, target: Option<&str>, work: F) -> Result<T, E>
    where
        E: Display,
        F: Future<Output = Result<T, E>>,
    {
        if !self.inner.records("interaction") {
            return work.await;
        }
        let (started, action_id) = {
            let mut state = self.inner.lock();
            (state.bundle.now_ms(), state.identity.next_action_id())
        };
        let outcome = work.await;
        self.inner.flush().await;
        let mut state = self.inner.lock();
        let duration = state.bundle.now_ms() - started;
        let mut payload = JsonObject::new()
            .with("actionId", action_id)
            .with("action", action)
            .with("target", Json::from(target))
            .with("durationMs", duration)
            .with("ok", outcome.is_ok());
        if let Err(error) = &outcome {
            payload.insert("error", error.to_string());
        }
        // The interaction's own result matters more than its record.
        let _ = self
            .inner
            .record_locked(&mut state, TraceEvent::INTERACTION, &payload);
        outcome
    }

    /// Stop recording and write the manifest; calling it again returns the
    /// first result.
    ///
    /// # Errors
    ///
    /// Fails when the manifest cannot be written or a strict trace drops
    /// something.
    pub async fn stop(&self) -> Result<TraceResult, TraceRecordError> {
        self.stop_with(TraceStopOptions::default()).await
    }

    /// [`TraceRecorder::stop`], discarding the bundle or recording the error
    /// the run ended with.
    ///
    /// # Errors
    ///
    /// As [`TraceRecorder::stop`].
    pub async fn stop_with(
        &self,
        options: TraceStopOptions,
    ) -> Result<TraceResult, TraceRecordError> {
        let _operation = self.inner.operations.lock().await;
        self.inner.flush().await;
        self.inner.stop(options).await
    }
}

impl std::fmt::Debug for TraceRecorder {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TraceRecorder")
            .field("path", &self.inner.settings.root)
            .field("mode", &self.inner.settings.mode)
            .field("stopped", &self.stopped())
            .finish()
    }
}

impl Drop for Inner {
    fn drop(&mut self) {
        self.stop_pump();
    }
}
