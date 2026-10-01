//! Native trace recording against a real Chrome (issue #108). It starts a
//! browser, so it is ignored by default. Run with:
//!
//! ```sh
//! BROWSER_COMMANDER_CHROME=/usr/bin/google-chrome \
//!   cargo test --test trace_record_real_browser -- --ignored --nocapture
//! ```

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use browser_commander::traces::{
    read_trace, start_trace, write_trace_viewer, AdapterTracePage, TraceEvent, TraceFiles,
    TraceLinksOptions, TraceMode, TraceOptions, TraceScreenshots,
};
use browser_commander::{launch_real_browser, RealBrowserOptions};

const FIRST_PAGE: &str = "data:text/html,<title>first</title><h1>first page</h1>";

const APP_PAGE: &str = "data:text/html,<title>app</title>\
    <form><input id=name value=served><input id=password type=password>\
    <textarea id=note></textarea></form><ul id=list></ul><p id=status>ready</p>";

const TYPED: &str = "typed in the browser";

/// Assembled rather than written out, so a secret scanner does not mistake
/// the fixture for a leak.
fn secret() -> String {
    ["hunter2", "never", "persisted"].join("-")
}

/// Everything the bundle holds, as one string to search.
fn bundle_text(dir: &Path) -> String {
    let mut text = String::new();
    let mut pending = vec![dir.to_path_buf()];
    while let Some(next) = pending.pop() {
        for entry in std::fs::read_dir(next).into_iter().flatten().flatten() {
            let path = entry.path();
            if path.is_dir() {
                pending.push(path);
            } else if let Ok(bytes) = std::fs::read(&path) {
                text.push_str(&String::from_utf8_lossy(&bytes));
            }
        }
    }
    text
}

fn chrome() -> PathBuf {
    std::env::var_os("BROWSER_COMMANDER_CHROME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/usr/bin/google-chrome"))
}

fn scratch() -> PathBuf {
    std::env::temp_dir().join(format!(
        "bc-trace-real-browser-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_nanos())
            .unwrap_or_default()
    ))
}

#[tokio::test]
#[ignore]
async fn a_continuous_trace_of_a_real_page_reads_back() -> anyhow::Result<()> {
    let result = launch_real_browser(
        RealBrowserOptions::chromiumoxide()
            .executable_path(chrome())
            .headless(true)
            .startup_timeout(Duration::from_secs(20))
            .with_args(vec![
                "--no-sandbox".to_string(),
                "--disable-dev-shm-usage".to_string(),
            ]),
    )
    .await?;
    result.page.goto(FIRST_PAGE).await?;

    let dir = scratch();
    let mut options = TraceOptions::new(dir.join("bundle"));
    options.mode = TraceMode::CONTINUOUS.into();
    options.screenshots = TraceScreenshots::Off;
    options.links = Some(TraceLinksOptions {
        output: dir.join("trace.lino"),
        include: None,
    });
    let page = Arc::new(AdapterTracePage::new(result.page.clone()));
    let trace = start_trace(page, options).await?;

    // Recording has to survive a real navigation to a new document.
    trace
        .traced("goto", Some("app"), result.page.goto(APP_PAGE))
        .await?;
    trace.checkpoint("loaded").await?;

    result.page.type_text("#note", TYPED).await?;
    result.page.fill("#password", &secret()).await?;
    result
        .page
        .evaluate(
            "const li = document.createElement('li');\
             li.textContent = 'item 1';\
             document.getElementById('list').appendChild(li);\
             document.getElementById('list').setAttribute('data-touched', 'yes');\
             document.getElementById('status').textContent = 'edited';\
             console.warn('careful', 3);\
             setTimeout(() => { throw new Error('boom'); });\
             true",
        )
        .await?;
    // CDP reports console calls and exceptions after the evaluation returns.
    tokio::time::sleep(Duration::from_millis(500)).await;
    trace.checkpoint("edited").await?;
    let finished = trace.stop().await?;
    assert!(finished.problems.is_empty(), "{:?}", finished.problems);

    let viewer = write_trace_viewer(&finished.path)?;
    assert!(viewer.exists());
    let links = finished
        .links
        .clone()
        .expect("a links export was asked for");
    let exported = std::fs::read_to_string(links)?;
    assert!(exported.contains("edited"));
    assert!(!exported.contains(&secret()));

    let read = read_trace(&finished.path)?;
    let names = read
        .checkpoints
        .iter()
        .filter_map(|checkpoint| checkpoint.name.clone())
        .collect::<Vec<_>>();
    assert!(
        names.ends_with(&["loaded".to_string(), "edited".to_string()]),
        "{names:?}"
    );
    let last = u32::try_from(read.checkpoints.len())?;

    let kinds = read
        .events
        .iter()
        .map(|event| event["kind"].as_str().unwrap_or_default().to_string())
        .collect::<Vec<_>>();
    assert_eq!(
        kinds.first().map(String::as_str),
        Some(TraceEvent::TRACE_START)
    );
    assert_eq!(
        kinds.last().map(String::as_str),
        Some(TraceEvent::TRACE_STOP)
    );
    for kind in [
        TraceEvent::NAVIGATION,
        TraceEvent::INTERACTION,
        TraceEvent::CHECKPOINT,
        TraceEvent::MUTATIONS,
    ] {
        assert!(
            kinds.iter().any(|seen| seen == kind),
            "no {kind} in {kinds:?}"
        );
    }
    let sequences = read
        .events
        .iter()
        .filter_map(|event| event["sequence"].as_u64())
        .collect::<Vec<_>>();
    assert_eq!(sequences.len(), read.events.len());
    assert!(
        sequences.windows(2).all(|pair| pair[0] < pair[1]),
        "{sequences:?}"
    );

    let of_kind = |kind: &str| {
        read.events
            .iter()
            .filter(|event| event["kind"] == kind)
            .cloned()
            .collect::<Vec<_>>()
    };
    let console = of_kind(TraceEvent::CONSOLE);
    assert_eq!(console.len(), 1, "{console:?}");
    assert_eq!(console[0]["level"], "warning");
    assert_eq!(console[0]["text"], "careful 3");
    let errors = of_kind(TraceEvent::PAGE_ERROR);
    assert_eq!(errors.len(), 1, "{errors:?}");
    assert_eq!(errors[0]["message"], "boom");

    // The state holds what was typed, not what the page was served with.
    let state = read.state(last)?.expect("the last checkpoint has state");
    let note = state["controls"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|control| {
            control["path"]
                .as_str()
                .is_some_and(|path| path.contains("note"))
        })
        .cloned()
        .expect("the note control is recorded");
    assert_eq!(note["value"], TYPED);
    assert!(read.html(last)?.unwrap_or_default().contains("item 1"));

    // The DOM changes made after "loaded" belong to the interval it began.
    let records = read
        .mutations(last - 1)?
        .iter()
        .flat_map(|batch| batch["records"].as_array().cloned().unwrap_or_default())
        .collect::<Vec<_>>();
    assert!(
        records.iter().any(|record| record["kind"] == "childList"),
        "{records:?}"
    );
    assert!(
        records.iter().any(|record| record["kind"] == "attributes"),
        "{records:?}"
    );

    // A password never reaches the disk, and typed text never reaches the
    // timeline.
    assert!(!bundle_text(&finished.path).contains(&secret()));
    let events_text = std::fs::read_to_string(finished.path.join(TraceFiles::EVENTS))?;
    assert!(!events_text.contains(TYPED));

    std::fs::remove_dir_all(dir).ok();
    result.close().await?;
    Ok(())
}
