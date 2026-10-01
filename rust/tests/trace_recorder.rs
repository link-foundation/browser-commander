//! The native trace recorder (issue #108) against a fake page.
// feature-parity: trace.record@native-typed
//!
//! `trace_conformance.rs` holds Rust to JavaScript's bytes for one full run;
//! these tests cover what that run does not: options that are refused, modes
//! without mutations, failures while capturing, stopping twice, discarding and
//! recording the error a run ended with, and keeping a bundle only when the
//! work it wraps fails.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use browser_commander::core::engine::TraceEngineEvent;
use browser_commander::traces::assets::trace_assets;
use browser_commander::traces::{
    parse_ndjson, read_trace, record_scenario, scenario_trace_options, start_trace, Json,
    JsonObject, TraceCheckpointOptions, TraceFailure, TraceInitialCheckpoint, TraceLinksOptions,
    TraceOptions, TracePage, TraceRecordError, TraceScreenshots, TraceStopOptions,
};
use futures::stream::{BoxStream, StreamExt};
use tokio::sync::mpsc;

/// A page that answers every capture with the same small document.
#[derive(Default)]
struct FakePage {
    capture_error: Mutex<Option<String>>,
    screenshots: AtomicUsize,
    evaluated: Mutex<Vec<String>>,
    events: Mutex<Option<mpsc::UnboundedReceiver<TraceEngineEvent>>>,
}

#[async_trait]
impl TracePage for FakePage {
    fn engine(&self) -> Option<String> {
        Some("chromiumoxide".to_string())
    }

    async fn evaluate_function(&self, source: &str, _argument: &Json) -> Result<Json, String> {
        let capture = &trace_assets().capture;
        if source == capture.capture_snapshot {
            if let Some(message) = self.capture_error.lock().unwrap().clone() {
                return Err(message);
            }
            let state = JsonObject::new()
                .with("url", "https://example.com/?token=secret")
                .with("controls", Vec::<Json>::new());
            return Ok(Json::Object(
                JsonObject::new()
                    .with("html", "<p>hi</p>")
                    .with("truncated", false)
                    .with("state", state),
            ));
        }
        let name = if source == capture.drain_mutations {
            "drain"
        } else if source == capture.install_mutation_recorder {
            "install"
        } else if source == capture.stop_mutation_recorder {
            "stop"
        } else {
            "other"
        };
        self.evaluated.lock().unwrap().push(name.to_string());
        if name == "drain" {
            return Ok(Json::Object(
                JsonObject::new()
                    .with("batches", Vec::<Json>::new())
                    .with("dropped", 0),
            ));
        }
        Ok(Json::Bool(true))
    }

    async fn screenshot(&self) -> Result<Option<Vec<u8>>, String> {
        self.screenshots.fetch_add(1, Ordering::SeqCst);
        Ok(Some(b"png".to_vec()))
    }

    async fn events(&self) -> Option<BoxStream<'static, TraceEngineEvent>> {
        let receiver = self.events.lock().unwrap().take()?;
        Some(
            futures::stream::unfold(receiver, |mut receiver| async move {
                receiver.recv().await.map(|event| (event, receiver))
            })
            .boxed(),
        )
    }
}

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "bc-trace-recorder-{name}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn events_of(bundle: &Path) -> Vec<Json> {
    let text = fs::read_to_string(bundle.join("events.ndjson")).unwrap();
    text.lines()
        .map(|line| Json::parse(line).unwrap())
        .collect()
}

fn kinds(events: &[Json]) -> Vec<String> {
    events
        .iter()
        .map(|event| {
            event
                .get("kind")
                .and_then(Json::as_str)
                .unwrap()
                .to_string()
        })
        .collect()
}

#[tokio::test]
async fn refuses_options_javascript_refuses() {
    let dir = scratch("refused");
    let page: Arc<dyn TracePage> = Arc::new(FakePage::default());

    let mut options = TraceOptions::new(dir.join("bundle"));
    options.mode = "sometimes".into();
    let error = start_trace(page.clone(), options).await.unwrap_err();
    assert_eq!(
        error.to_string(),
        "trace mode must be one of off, checkpoints, continuous, retain-on-failure"
    );

    let mut options = TraceOptions::new(dir.join("bundle"));
    options.events = Some(vec!["navigation".into(), "keyboard".into()]);
    let error = start_trace(page.clone(), options).await.unwrap_err();
    assert_eq!(
        error.to_string(),
        "unknown trace event source \"keyboard\"; expected one of navigation, interaction, \
         console, pageerror, dialog, requestfailed, download"
    );

    let error = start_trace(page, TraceOptions::new("")).await.unwrap_err();
    assert_eq!(error.to_string(), "trace output must be a path");
    fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn a_checkpoints_trace_records_no_mutations_and_reads_back() {
    let dir = scratch("checkpoints");
    let page = Arc::new(FakePage::default());
    let trace = start_trace(page.clone(), TraceOptions::new(dir.join("bundle")))
        .await
        .unwrap();
    let entry = trace.checkpoint("first").await.unwrap();
    assert_eq!(
        entry.get("url").and_then(Json::as_str),
        Some("https://example.com/?token=[redacted]")
    );
    let result = trace.stop().await.unwrap();

    // Nothing is installed in the page when mutations are off.
    assert!(page.evaluated.lock().unwrap().is_empty());
    assert_eq!(
        kinds(&events_of(&result.path)),
        ["trace.start", "checkpoint", "trace.stop"]
    );
    let manifest = Json::Object(result.manifest.clone());
    assert_eq!(
        manifest.get("dom").and_then(|dom| dom.get("mutations")),
        Some(&Json::Bool(false))
    );
    assert_eq!(
        manifest.get("engine").and_then(Json::as_str),
        Some("chromiumoxide")
    );

    let read = read_trace(&result.path).unwrap();
    assert_eq!(read.checkpoints.len(), 1);
    assert!(read.manifest.is_complete());
    fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn a_continuous_trace_installs_drains_and_stops_the_page_recorder() {
    let dir = scratch("continuous");
    let page = Arc::new(FakePage::default());
    let mut options = TraceOptions::new(dir.join("bundle"));
    options.mode = "continuous".into();
    options.screenshots = TraceScreenshots::OnlyOnFailure;
    let trace = start_trace(page.clone(), options).await.unwrap();
    trace
        .checkpoint_with(
            "broken",
            TraceCheckpointOptions {
                actor: Some("caller".into()),
                reason: Some("failure".into()),
            },
        )
        .await
        .unwrap();
    let result = trace.stop().await.unwrap();

    // The initial checkpoint took no screenshot; the failure did.
    assert_eq!(page.screenshots.load(Ordering::SeqCst), 1);
    assert_eq!(result.checkpoints.len(), 2);
    assert_eq!(
        *page.evaluated.lock().unwrap(),
        ["install", "drain", "install", "drain", "install", "drain", "stop"]
    );
    fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn page_events_are_written_before_the_next_call_records() {
    let dir = scratch("events");
    let (emit, received) = mpsc::unbounded_channel();
    let page = Arc::new(FakePage {
        events: Mutex::new(Some(received)),
        ..FakePage::default()
    });
    let trace = start_trace(page, TraceOptions::new(dir.join("bundle")))
        .await
        .unwrap();
    emit.send(TraceEngineEvent::Navigated {
        main_frame: true,
        url: "https://example.com/next?password=p".into(),
    })
    .unwrap();
    emit.send(TraceEngineEvent::Console {
        level: "warning".into(),
        text: "careful".into(),
    })
    .unwrap();
    trace
        .event("note", JsonObject::new().with("count", 1))
        .await
        .unwrap();
    let outcome = trace
        .traced("clickButton", Some("#go"), async {
            Err::<(), _>("button #go is not visible")
        })
        .await;
    assert_eq!(outcome, Err("button #go is not visible"));
    let result = trace.stop().await.unwrap();

    let events = events_of(&result.path);
    assert_eq!(
        kinds(&events),
        [
            "trace.start",
            "navigation",
            "console",
            "interaction",
            "interaction",
            "trace.stop"
        ]
    );
    assert_eq!(
        events[1].get("url").and_then(Json::as_str),
        Some("https://example.com/next?password=[redacted]")
    );
    assert_eq!(events[1].get("navigationId"), events[2].get("navigationId"));
    assert_eq!(events[4].get("ok"), Some(&Json::Bool(false)));
    assert_eq!(
        events[4].get("error").and_then(Json::as_str),
        Some("button #go is not visible")
    );
    fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn sources_that_are_not_chosen_are_not_recorded() {
    let dir = scratch("sources");
    let (emit, received) = mpsc::unbounded_channel();
    let page = Arc::new(FakePage {
        events: Mutex::new(Some(received)),
        ..FakePage::default()
    });
    let mut options = TraceOptions::new(dir.join("bundle"));
    options.events = Some(Vec::new());
    let trace = start_trace(page, options).await.unwrap();
    emit.send(TraceEngineEvent::Console {
        level: "log".into(),
        text: "ignored".into(),
    })
    .ok();
    let value = trace
        .traced("goto", Some("https://example.com"), async {
            Ok::<_, String>(7)
        })
        .await;
    assert_eq!(value, Ok(7));
    let result = trace.stop().await.unwrap();
    assert_eq!(
        kinds(&events_of(&result.path)),
        ["trace.start", "trace.stop"]
    );
    fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn capture_failures_are_dropped_or_fail_a_strict_trace() {
    let dir = scratch("failures");
    let page = Arc::new(FakePage::default());
    *page.capture_error.lock().unwrap() = Some("Target page has been closed".into());
    let trace = start_trace(page.clone(), TraceOptions::new(dir.join("loose")))
        .await
        .unwrap();
    let entry = trace.checkpoint("gone").await.unwrap();
    assert_eq!(entry.get("url"), Some(&Json::Null));
    let result = trace.stop().await.unwrap();
    assert_eq!(result.problems.len(), 1);
    assert_eq!(result.problems[0].reason.as_deref(), Some("page-closed"));
    assert_eq!(result.problems[0].member.as_deref(), Some("checkpoints/1"));
    assert_eq!(
        result.manifest.get("outcome").and_then(Json::as_str),
        Some("partial")
    );

    *page.capture_error.lock().unwrap() = Some("no document".into());
    let mut options = TraceOptions::new(dir.join("strict"));
    options.strict = true;
    let trace = start_trace(page, options).await.unwrap();
    let error = trace.checkpoint("gone").await.unwrap_err();
    assert!(matches!(error, TraceRecordError::Dropped(_)), "{error:?}");
    fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn stopping_records_the_error_and_happens_once() {
    let dir = scratch("stop");
    let page = Arc::new(FakePage::default());
    let mut options = TraceOptions::new(dir.join("bundle"));
    options.initial_checkpoint = Some(TraceInitialCheckpoint::Named("start".into()));
    let trace = start_trace(page, options).await.unwrap();
    let first = trace
        .stop_with(TraceStopOptions {
            discard: false,
            error: Some(TraceFailure::new("assertion failed")),
        })
        .await
        .unwrap();
    let again = trace.stop().await.unwrap();
    assert_eq!(first, again);
    assert!(trace.stopped());
    assert!(matches!(
        trace.checkpoint("late").await,
        Err(TraceRecordError::Stopped)
    ));
    assert_eq!(trace.event("late", JsonObject::new()).await.unwrap(), None);

    let events = events_of(&first.path);
    assert_eq!(
        kinds(&events),
        ["trace.start", "checkpoint", "pageerror", "trace.stop"]
    );
    assert_eq!(events[2].get("fatal"), Some(&Json::Bool(true)));
    assert_eq!(events[2].get("stack"), Some(&Json::Null));
    let parsed = parse_ndjson(Some(
        &fs::read_to_string(first.path.join("events.ndjson")).unwrap(),
    ));
    assert_eq!(parsed.records.len(), 4);
    fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn discarding_removes_the_bundle_and_its_export() {
    let dir = scratch("discard");
    let page = Arc::new(FakePage::default());
    let mut options = TraceOptions::new(dir.join("bundle"));
    options.links = Some(TraceLinksOptions {
        output: dir.join("trace.lino"),
        include: None,
    });
    let trace = start_trace(page, options).await.unwrap();
    assert_eq!(trace.links(), Some(dir.join("trace.lino")));
    trace.checkpoint("one").await.unwrap();
    let result = trace
        .stop_with(TraceStopOptions {
            discard: true,
            error: None,
        })
        .await
        .unwrap();
    assert!(result.discarded);
    assert!(!dir.join("bundle").exists());
    assert!(!dir.join("trace.lino").exists());
    fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn retain_on_failure_discards_a_passing_run() {
    let dir = scratch("retain-pass");
    let page = Arc::new(FakePage::default());
    let bundle = dir.join("login.bc-trace");
    let run = record_scenario(
        page.clone(),
        "retain-on-failure",
        1,
        scenario_trace_options(&bundle),
        |recorder| async move {
            recorder.unwrap().checkpoint("logged-in").await.unwrap();
            Ok::<_, String>(7)
        },
    )
    .await
    .unwrap();
    assert_eq!(run.outcome, Ok(7));
    assert!(run.trace.unwrap().unwrap().discarded);
    assert!(!bundle.exists());
    // Screenshots are kept for the failure checkpoint only.
    assert_eq!(page.screenshots.load(Ordering::SeqCst), 0);
    fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn retain_on_failure_keeps_a_failing_run_with_its_viewer() {
    let dir = scratch("retain-fail");
    let page = Arc::new(FakePage::default());
    let bundle = dir.join("login.bc-trace");
    let run = record_scenario(
        page.clone(),
        "retain-on-failure",
        1,
        scenario_trace_options(&bundle),
        |_recorder| async { Err::<(), _>("button never enabled") },
    )
    .await
    .unwrap();
    assert_eq!(run.outcome, Err("button never enabled"));
    let result = run.trace.unwrap().unwrap();
    assert!(!result.discarded);
    assert!(result.problems.is_empty(), "{:?}", result.problems);
    assert!(bundle.join("viewer.html").is_file());
    assert_eq!(page.screenshots.load(Ordering::SeqCst), 1);

    let events = events_of(&bundle);
    assert_eq!(
        kinds(&events),
        ["trace.start", "checkpoint", "pageerror", "trace.stop"]
    );
    assert_eq!(events[1].get("reason"), Some(&Json::from("failure")));
    assert_eq!(events[1].get("actor"), Some(&Json::from("runner")));
    assert_eq!(
        events[2].get("message"),
        Some(&Json::from("button never enabled"))
    );
    let trace = read_trace(&bundle).unwrap();
    assert_eq!(trace.checkpoints.len(), 1);
    fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn trace_settings_that_do_not_record_still_run_the_work() {
    let dir = scratch("retain-off");
    for (trace, attempt) in [("off", 1), ("on-first-retry", 1)] {
        let bundle = dir.join(format!("{trace}.bc-trace"));
        let run = record_scenario(
            Arc::new(FakePage::default()),
            trace,
            attempt,
            scenario_trace_options(&bundle),
            |recorder| async move { Ok::<_, String>(recorder.is_none()) },
        )
        .await
        .unwrap();
        assert_eq!(run.outcome, Ok(true));
        assert!(run.trace.unwrap().is_none());
        assert!(!bundle.exists());
    }
    let refused = record_scenario(
        Arc::new(FakePage::default()),
        "sometimes",
        1,
        scenario_trace_options(dir.join("never")),
        |_recorder| async { Ok::<_, String>(()) },
    )
    .await;
    assert!(matches!(refused, Err(TraceRecordError::Invalid(_))));
    fs::remove_dir_all(dir).ok();
}
