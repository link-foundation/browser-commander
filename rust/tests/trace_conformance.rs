//! Rust records the conformance scenario byte for byte as JavaScript does (issue #108).
//!
//! `js/tests/fixtures/traces/conformance/scenario.json` describes one run: a
//! page, what it emits, what a caller does and the clock. JavaScript recorded it
//! into `expected/` (`scripts/generate-trace-conformance.mjs`); this test replays
//! it with the native Rust recorder against a fake page and requires the same
//! files: the bundle, its viewer, the Links Notation export written while
//! recording, and what `redact_url` makes of a corpus of URLs. Only the
//! manifest's `platform` and `runtime` say which language wrote a bundle, and
//! they are normalized first.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use browser_commander::core::engine::TraceEngineEvent;
use browser_commander::traces::assets::trace_assets;
use browser_commander::traces::{
    normalize_privacy_options, redact_url, reset_trace_identity_counters, start_trace, trace_links,
    write_trace_viewer, Json, JsonObject, TraceCheckpointOptions, TraceClock, TraceLimits,
    TraceLinksOptions, TraceOptions, TracePage, TracePrivacyOptions,
};
use futures::stream::{BoxStream, StreamExt};
use tokio::sync::mpsc;

/// URLs whose redaction every language must agree on; `REDACTION_CORPUS` in
/// `scripts/generate-trace-conformance.mjs`.
const REDACTION_CORPUS: [&str; 21] = [
    "https://example.com/path?token=abc&keep=1",
    "https://EXAMPLE.com:443/a/../b/./c?Token=x#frag",
    "http://example.com",
    "https://name:pw@example.com/?q=1",
    "https://user@example.com/x",
    "https://example.com/?a=1&a=2&code=zz&b=hello%20world",
    "https://example.com/?q=a b&secret=s",
    "https://example.com/?q=a+b&secret=s",
    "https://example.com/?q=a%2Bb&session=1&x=~!*()'",
    "https://example.com/cb#access_token=t&state=s",
    "https://example.com/cb#plain-fragment",
    "https://example.com/p a th/ü?x=ü&password=p",
    "https://example.com/?keep=1",
    "https://example.com/?token",
    "https://example.com/?=token&token=",
    "http://example.com:8080/?api_key=1",
    "about:blank",
    "data:text/html,<p>hi</p>",
    "/relative/path?token=abc",
    "not a url",
    "",
];

const NORMALIZED: &str = "conformance";

fn conformance_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .map(|dir| dir.join("js/tests/fixtures/traces/conformance"))
        .find(|dir| dir.is_dir())
        .expect("the conformance fixtures are in the repository")
}

/// What the fake page holds.
struct PageState {
    snapshot: Json,
    mutations: Vec<Json>,
    dropped: f64,
}

/// A page that answers the recorder the way the scenario says.
struct ConformancePage {
    engine: String,
    state: Mutex<PageState>,
    events: Mutex<Option<mpsc::UnboundedReceiver<TraceEngineEvent>>>,
}

#[async_trait]
impl TracePage for ConformancePage {
    fn engine(&self) -> Option<String> {
        Some(self.engine.clone())
    }

    fn context_key(&self) -> Option<usize> {
        Some(1)
    }

    fn page_key(&self) -> Option<usize> {
        Some(1)
    }

    fn has_context(&self) -> bool {
        true
    }

    async fn evaluate_function(&self, source: &str, _argument: &Json) -> Result<Json, String> {
        let capture = &trace_assets().capture;
        let mut state = self.state.lock().unwrap();
        if source == capture.capture_snapshot {
            return Ok(state.snapshot.clone());
        }
        if source == capture.drain_mutations {
            let batches = state
                .mutations
                .drain(..)
                .map(|batch| {
                    let mut owned = JsonObject::new()
                        .with("frameId", "main")
                        .with("mainFrame", true);
                    owned.extend_from(batch.as_object().expect("a batch is an object"));
                    Json::Object(owned)
                })
                .collect::<Vec<_>>();
            let dropped = std::mem::take(&mut state.dropped);
            return Ok(Json::Object(
                JsonObject::new()
                    .with("batches", batches)
                    .with("dropped", dropped)
                    .with("installed", true)
                    .with("frameId", "main")
                    .with("mainFrame", true),
            ));
        }
        Ok(Json::Bool(true))
    }

    async fn screenshot(&self) -> Result<Option<Vec<u8>>, String> {
        Ok(Some(b"fake-png".to_vec()))
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

fn text(value: &Json, key: &str) -> Option<String> {
    value.get(key).and_then(Json::as_str).map(str::to_string)
}

fn texts(value: Option<&Json>, key: &str) -> Vec<String> {
    value
        .and_then(|value| value.get(key))
        .and_then(Json::as_array)
        .map(|list| {
            list.iter()
                .filter_map(Json::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn number(value: &Json, key: &str) -> Option<f64> {
    value.get(key).and_then(Json::as_f64)
}

fn privacy_options(scenario: &Json) -> TracePrivacyOptions {
    let privacy = scenario
        .get("options")
        .and_then(|options| options.get("privacy"));
    TracePrivacyOptions {
        redact_selectors: texts(privacy, "redactSelectors"),
        redact_attributes: texts(privacy, "redactAttributes"),
        redact_query_params: texts(privacy, "redactQueryParams"),
        redact_patterns: texts(privacy, "redactPatterns"),
        ..TracePrivacyOptions::default()
    }
}

/// The engine event a scenario `emit` step stands for.
fn engine_event(event: &str, data: &Json) -> TraceEngineEvent {
    let field = |key: &str| text(data, key).unwrap_or_default();
    match event {
        "framenavigated" => TraceEngineEvent::Navigated {
            main_frame: data.get("main").is_some_and(Json::truthy),
            url: field("url"),
        },
        "console" => TraceEngineEvent::Console {
            level: field("type"),
            text: field("text"),
        },
        "pageerror" => TraceEngineEvent::PageError {
            message: field("message"),
            stack: text(data, "stack"),
        },
        "requestfailed" => TraceEngineEvent::RequestFailed {
            url: field("url"),
            method: field("method"),
            error_text: text(data, "errorText"),
        },
        other => panic!("unknown engine event {other}"),
    }
}

/// Every file under `dir`, by `/`-separated relative path.
fn read_tree(dir: &Path) -> BTreeMap<String, Vec<u8>> {
    fn walk(root: &Path, current: &Path, files: &mut BTreeMap<String, Vec<u8>>) {
        for entry in fs::read_dir(current).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                walk(root, &path, files);
            } else {
                let name = path
                    .strip_prefix(root)
                    .unwrap()
                    .components()
                    .map(|part| part.as_os_str().to_string_lossy().into_owned())
                    .collect::<Vec<_>>()
                    .join("/");
                files.insert(name, fs::read(&path).unwrap());
            }
        }
    }
    let mut files = BTreeMap::new();
    walk(dir, dir, &mut files);
    files
}

/// Replace what the manifest says about the machine, wherever it appears.
fn normalize_machine(
    files: BTreeMap<String, Vec<u8>>,
    manifest: &Json,
) -> BTreeMap<String, Vec<u8>> {
    let neutral = Json::from(NORMALIZED).to_compact();
    files
        .into_iter()
        .map(|(name, data)| {
            if !(name.ends_with(".json") || name.ends_with(".html")) {
                return (name, data);
            }
            let mut text = String::from_utf8(data).unwrap();
            for key in ["platform", "runtime"] {
                let value = manifest
                    .get(key)
                    .cloned()
                    .unwrap_or(Json::Null)
                    .to_compact();
                for separator in [": ", ":"] {
                    text = text.replace(
                        &format!("\"{key}\"{separator}{value}"),
                        &format!("\"{key}\"{separator}{neutral}"),
                    );
                }
            }
            (name, text.into_bytes())
        })
        .collect()
}

fn options_for(scenario: &Json, output: &Path) -> TraceOptions {
    let options = scenario.get("options").expect("the scenario has options");
    let clock = scenario.get("clock").expect("the scenario has a clock");
    let mut trace = TraceOptions::new(output.join("bundle"));
    trace.mode = text(options, "mode").unwrap_or_else(|| trace.mode.clone());
    trace.commander_version = text(options, "commanderVersion");
    trace.privacy = privacy_options(scenario);
    let limits = options.get("limits");
    trace.limits = TraceLimits {
        max_queued_mutations: limits
            .and_then(|limits| number(limits, "maxQueuedMutations"))
            .map(|limit| limit as u64),
        ..TraceLimits::default()
    };
    if options.get("links").is_some_and(Json::truthy) {
        trace.links = Some(TraceLinksOptions {
            output: output.join("trace.lino"),
            include: None,
        });
    }
    trace.clock = TraceClock::fixed(
        number(clock, "now").unwrap(),
        number(clock, "monotonic").unwrap(),
    );
    trace
}

/// Record the scenario into `output`, as `recordConformanceScenario` does.
async fn record(scenario: &Json, output: &Path) {
    let (emit, received) = mpsc::unbounded_channel();
    let page = Arc::new(ConformancePage {
        engine: text(scenario, "engine").unwrap(),
        state: Mutex::new(PageState {
            snapshot: scenario.get("snapshot").cloned().unwrap(),
            mutations: Vec::new(),
            dropped: 0.0,
        }),
        events: Mutex::new(Some(received)),
    });
    let trace = start_trace(page.clone(), options_for(scenario, output))
        .await
        .expect("the trace starts");

    let steps = scenario.get("steps").and_then(Json::as_array).unwrap();
    for step in steps {
        match text(step, "op").as_deref() {
            Some("queueMutations") => {
                let mut state = page.state.lock().unwrap();
                let batches = step.get("batches").and_then(Json::as_array).unwrap();
                state.mutations.extend(batches.iter().cloned());
                state.dropped += number(step, "dropped").unwrap_or(0.0);
            }
            Some("setSnapshot") => {
                page.state.lock().unwrap().snapshot = step.get("snapshot").cloned().unwrap();
            }
            Some("emit") => {
                let event = engine_event(&text(step, "event").unwrap(), step.get("data").unwrap());
                emit.send(event).unwrap();
            }
            Some("dialog") => {
                let data = step.get("data").unwrap();
                emit.send(TraceEngineEvent::Dialog {
                    dialog_type: text(data, "type").unwrap(),
                    message: text(data, "message").unwrap(),
                })
                .unwrap();
            }
            Some("download") => {
                let artifact = step.get("artifact").unwrap();
                emit.send(TraceEngineEvent::Download {
                    phase: text(step, "phase").unwrap(),
                    id: text(artifact, "id"),
                    suggested_filename: text(artifact, "suggestedFilename"),
                    path: text(artifact, "path"),
                    checksum: text(artifact, "checksum"),
                    bytes: number(artifact, "bytes").map(|bytes| bytes as u64),
                    url: text(artifact, "url"),
                    failure: text(artifact, "failure"),
                })
                .unwrap();
            }
            Some("interaction") => {
                let fail = text(step, "fail");
                let target = text(step, "target");
                let work = async move {
                    match fail {
                        Some(message) => Err(message),
                        None => Ok(true),
                    }
                };
                // The failure is what the trace records.
                let _ = trace
                    .traced(&text(step, "action").unwrap(), target.as_deref(), work)
                    .await;
            }
            Some("checkpoint") => {
                let options = TraceCheckpointOptions {
                    actor: text(step, "actor"),
                    reason: text(step, "reason"),
                };
                trace
                    .checkpoint_with(&text(step, "name").unwrap(), options)
                    .await
                    .expect("the checkpoint is written");
            }
            Some("event") => {
                let data = step.get("data").and_then(Json::as_object).unwrap().clone();
                trace
                    .event(&text(step, "name").unwrap(), data)
                    .await
                    .expect("the event is written");
            }
            Some("stop") => {
                trace.stop().await.expect("the trace stops");
            }
            other => panic!("unknown conformance step {other:?}"),
        }
    }
    write_trace_viewer(output.join("bundle")).expect("the viewer is written");
}

fn redaction_corpus(scenario: &Json) -> Vec<u8> {
    let privacy = normalize_privacy_options(&privacy_options(scenario)).unwrap();
    let corpus = REDACTION_CORPUS
        .iter()
        .map(|url| {
            Json::Object(
                JsonObject::new()
                    .with("url", *url)
                    .with("redacted", redact_url(url, &privacy)),
            )
        })
        .collect::<Vec<_>>();
    format!("{}\n", Json::Array(corpus).to_pretty()).into_bytes()
}

#[tokio::test]
async fn rust_records_the_conformance_scenario_byte_for_byte() {
    // Identifiers count up per process; the golden was recorded in a fresh one.
    reset_trace_identity_counters();
    let fixtures = conformance_dir();
    let scenario = Json::parse(&fs::read_to_string(fixtures.join("scenario.json")).unwrap())
        .expect("the scenario is JSON");

    let output = std::env::temp_dir().join(format!(
        "bc-conformance-rust-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(&output).unwrap();
    record(&scenario, &output).await;

    // The export streamed while recording is the export of the finished bundle.
    let streamed = fs::read_to_string(output.join("trace.lino")).unwrap();
    assert_eq!(streamed, trace_links(output.join("bundle"), None).unwrap());

    let manifest =
        Json::parse(&fs::read_to_string(output.join("bundle/manifest.json")).unwrap()).unwrap();
    let mut actual = normalize_machine(read_tree(&output), &manifest);
    actual.insert("redaction.json".to_string(), redaction_corpus(&scenario));
    let expected = read_tree(&fixtures.join("expected"));
    fs::remove_dir_all(&output).ok();
    for name in [
        "bundle/manifest.json",
        "bundle/events.ndjson",
        "bundle/viewer.html",
        "trace.lino",
    ] {
        assert!(expected.contains_key(name), "the golden has {name}");
    }

    let differ = expected
        .keys()
        .chain(actual.keys())
        .filter(|name| expected.get(*name) != actual.get(*name))
        .cloned()
        .collect::<std::collections::BTreeSet<_>>();
    for name in &differ {
        let show = |files: &BTreeMap<String, Vec<u8>>| {
            files
                .get(name)
                .map(|data| String::from_utf8_lossy(data).into_owned())
        };
        eprintln!(
            "--- {name}\nexpected: {:?}\nactual:   {:?}",
            show(&expected),
            show(&actual)
        );
    }
    assert!(
        differ.is_empty(),
        "files that differ from JavaScript's: {differ:?}"
    );
}
