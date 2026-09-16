//! Read a trace bundle recorded by the JavaScript package (issue #87).
//!
//! A trace is a portable directory, not a private format: whatever recorded
//! the run, a Rust tool can open the bundle and answer questions about it.
//!
//! Run with: `cargo run --example read_trace -- path/to/bundle`

use std::process::ExitCode;

use browser_commander::traces::read_trace;
use serde_json::json;

fn main() -> ExitCode {
    let Some(bundle) = std::env::args().nth(1) else {
        eprintln!("usage: read_trace <bundle>");
        return ExitCode::FAILURE;
    };

    let trace = match read_trace(&bundle) {
        Ok(trace) => trace,
        Err(error) => {
            eprintln!("{error}");
            return ExitCode::FAILURE;
        }
    };

    let mut kinds: Vec<&str> = trace
        .events
        .iter()
        .filter_map(|event| event.get("kind")?.as_str())
        .collect();
    kinds.sort_unstable();
    kinds.dedup();

    let state = trace.state(1).ok().flatten();
    let typed_name = state
        .as_ref()
        .and_then(|state| state.get("controls"))
        .and_then(|controls| controls.as_array())
        .and_then(|controls| {
            controls.iter().find(|control| {
                control
                    .get("path")
                    .and_then(|path| path.as_str())
                    .is_some_and(|path| path.ends_with("#name"))
            })
        })
        .and_then(|control| control.get("value").cloned());

    println!(
        "{:#}",
        json!({
            "schemaVersion": trace.manifest.schema_version,
            "mode": trace.manifest.mode,
            "outcome": trace.manifest.outcome,
            "engine": trace.manifest.engine,
            "events": trace.events.len(),
            "kinds": kinds,
            "checkpoints": trace
                .checkpoints
                .iter()
                .map(|checkpoint| checkpoint.name.clone())
                .collect::<Vec<_>>(),
            "htmlBytes": trace.html(1).ok().flatten().unwrap_or_default().len(),
            "typedName": typed_name,
            "mutationBatches": trace.mutations(1).map(|batches| batches.len()).unwrap_or(0),
            "screenshotBytes": trace.screenshot(1).ok().flatten().unwrap_or_default().len(),
            "truncated": trace.truncated,
        })
    );

    ExitCode::SUCCESS
}
