//! The offline trace viewer (issue #87), written by Rust.
//!
//! One static HTML file inside the bundle, byte for byte what
//! `js/src/traces/viewer.js` writes: the same template, and the same stylesheet
//! and script, which come from the generated `assets.json`. Captured markup is
//! shown in a sandboxed frame under a `default-src 'none'` policy.

use std::io::Write;
use std::path::{Path, PathBuf};

use super::assets::trace_assets;
use super::bundle::open_private;
use super::jsonfmt::{js_string, utf16_len, Json, JsonObject};
use super::raw_reader::{diff_controls, index_of, read_raw_trace, RawTrace};
use super::reader::TraceError;
use super::schema::TraceFiles;

/// How much captured HTML is embedded per checkpoint before it is elided.
pub const DEFAULT_MAX_INLINE_BYTES: usize = 8 * 1024 * 1024;

/// One line saying how much of the run the viewer can replay.
pub fn replay_summary(manifest: &JsonObject) -> String {
    let replay = manifest.get("replay");
    let on = |name: &str| {
        replay
            .and_then(|replay| replay.get(name))
            .is_some_and(Json::truthy)
    };
    let covered: Vec<&str> = [
        ("mutations", "DOM mutations"),
        ("childListPositions", "insertion positions and removals"),
        ("liveState", "live control state"),
        ("identifiers", "page and frame identities"),
    ]
    .into_iter()
    .filter(|(name, _)| on(name))
    .map(|(_, label)| label)
    .collect();
    if covered.is_empty() {
        "partial diagnostic replay: checkpoints only, nothing between them".to_string()
    } else {
        format!(
            "partial diagnostic replay: checkpoints, {}",
            covered.join(", ")
        )
    }
}

/// JSON that can sit inside `<script type="application/json">`.
fn embed(data: &Json) -> String {
    data.to_compact()
        .replace('<', "\\u003c")
        .replace('>', "\\u003e")
        .replace('\u{2028}', "\\u2028")
        .replace('\u{2029}', "\\u2029")
}

fn collect_viewer_data(opened: &RawTrace, max_inline: usize) -> Result<Json, TraceError> {
    let mut html = JsonObject::new();
    let mut state = JsonObject::new();
    let mut mutations = JsonObject::new();
    let mut diffs = JsonObject::new();
    let mut elided = Vec::new();

    for checkpoint in &opened.checkpoints {
        let key = js_string(checkpoint.get("index"));
        let index = index_of(checkpoint);
        let body = match index {
            Some(index) => opened.html(index)?,
            None => None,
        };
        match body {
            Some(body) if utf16_len(&body) > max_inline => {
                elided.push(checkpoint.get("index").cloned().unwrap_or(Json::Null));
                html.insert(key.clone(), Json::Null);
            }
            body => html.insert(key.clone(), Json::from(body)),
        }
        let captured = match index {
            Some(index) => opened.state(index)?,
            None => None,
        };
        state.insert(key.clone(), captured.unwrap_or(Json::Null));
        let batches = match index {
            Some(index) => opened.mutations(index)?,
            None => Vec::new(),
        };
        mutations.insert(key, Json::Array(batches));
    }

    for checkpoint in &opened.checkpoints {
        let key = js_string(checkpoint.get("index"));
        let previous = checkpoint
            .get("index")
            .and_then(Json::as_f64)
            .map(|index| js_string(Some(&Json::Number(index - 1.0))))
            .and_then(|previous| state.get(&previous))
            .filter(|previous| previous.truthy());
        let changes = match previous {
            Some(previous) => diff_controls(Some(previous), state.get(&key))
                .into_iter()
                .map(Json::Object)
                .collect(),
            None => Vec::new(),
        };
        diffs.insert(key, Json::Array(changes));
    }

    let checkpoints = opened
        .checkpoints
        .iter()
        .cloned()
        .map(Json::Object)
        .collect::<Vec<_>>();
    Ok(Json::Object(
        JsonObject::new()
            .with("manifest", opened.manifest.clone())
            .with("events", opened.events.clone())
            .with("checkpoints", checkpoints)
            .with("html", html)
            .with("state", state)
            .with("mutations", mutations)
            .with("diffs", diffs)
            .with("elided", elided),
    ))
}

/// `a ?? fallback` as JavaScript would interpolate it.
fn or_text(value: Option<&Json>, fallback: &str) -> String {
    match value {
        None | Some(Json::Null) => fallback.to_string(),
        value => js_string(value),
    }
}

pub(crate) fn render_raw_viewer(
    opened: &RawTrace,
    max_inline: usize,
) -> Result<String, TraceError> {
    let data = collect_viewer_data(opened, max_inline)?;
    let manifest = &opened.manifest;
    let counts = manifest.get("counts");
    let count = |name: &str| or_text(counts.and_then(|counts| counts.get(name)), "0");
    let assets = &trace_assets().viewer;
    Ok(format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<!-- Inert by default: no network, no captured scripts, images only from data URLs. -->
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; frame-src 'self' data:;">
<title>Browser Commander trace</title>
<style>{style}</style>
</head>
<body>
<header>
  <h1>Browser Commander trace</h1>
  <div class="meta">
    mode {mode} · outcome {outcome} · engine {engine} ·
    {checkpoints} checkpoints · {events} events ·
    {dropped} dropped · started {started}
  </div>
  <div class="meta replay">{replay}</div>
</header>
<aside><ol id="timeline"></ol></aside>
<main>
  <div class="controls">
    <button id="play" type="button">Replay mutations</button>
    <button id="step-forward" type="button">Step</button>
    <button id="reset" type="button">Reset</button>
    <span id="step"></span>
  </div>
  <iframe id="stage" sandbox referrerpolicy="no-referrer" title="captured page"></iframe>
  <div class="panel" id="details"></div>
  <div class="panel" id="diff"></div>
</main>
<script id="trace-data" type="application/json">{data}</script>
<script>{script}</script>
</body>
</html>
"#,
        style = assets.style,
        mode = js_string(manifest.get("mode")),
        outcome = js_string(manifest.get("outcome")),
        engine = or_text(manifest.get("engine"), "unknown"),
        checkpoints = count("checkpoints"),
        events = count("events"),
        dropped = or_text(manifest.get("dropped"), "0"),
        started = or_text(manifest.get("startedAt"), "unknown"),
        replay = replay_summary(manifest),
        data = embed(&data),
        script = assets.script,
    ))
}

/// Render the viewer for a bundle.
///
/// HTML longer than `max_inline_bytes` UTF-16 units is left out and listed as
/// elided; [`DEFAULT_MAX_INLINE_BYTES`] is what JavaScript uses.
///
/// # Errors
///
/// Fails when the bundle or one of its members cannot be read.
pub fn render_trace_viewer(
    bundle: impl AsRef<Path>,
    max_inline_bytes: usize,
) -> Result<String, TraceError> {
    render_raw_viewer(&read_raw_trace(bundle.as_ref())?, max_inline_bytes)
}

/// Write `viewer.html` into a bundle; the file that was written.
///
/// # Errors
///
/// Fails when the bundle cannot be read or the viewer cannot be written.
pub fn write_trace_viewer(bundle: impl AsRef<Path>) -> Result<PathBuf, TraceError> {
    let opened = read_raw_trace(bundle.as_ref())?;
    let document = render_raw_viewer(&opened, DEFAULT_MAX_INLINE_BYTES)?;
    let target = opened.path.join(TraceFiles::VIEWER);
    open_private(&target, false)
        .and_then(|mut file| file.write_all(document.as_bytes()))
        .map_err(|source| TraceError::Io {
            path: target.clone(),
            source,
        })?;
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replay_summary_names_what_is_covered() {
        let none = JsonObject::new();
        assert_eq!(
            replay_summary(&none),
            "partial diagnostic replay: checkpoints only, nothing between them"
        );
        let some = JsonObject::new().with(
            "replay",
            JsonObject::new()
                .with("mutations", true)
                .with("identifiers", true),
        );
        assert_eq!(
            replay_summary(&some),
            "partial diagnostic replay: checkpoints, DOM mutations, page and frame identities"
        );
    }

    #[test]
    fn embedded_data_cannot_close_its_script() {
        let data = Json::from("</script>\u{2028}");
        assert_eq!(embed(&data), "\"\\u003c/script\\u003e\\u2028\"");
    }
}
