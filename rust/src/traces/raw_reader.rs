//! An order-preserving view of a bundle, for writing it out again.
//!
//! [`super::reader`] gives callers typed records; the viewer and the Links
//! Notation export have to repeat what the bundle holds byte for byte, field
//! order included, so they read through here instead. The rules are the same:
//! a missing manifest is rebuilt and a half-written last line ends the timeline.

use std::io;
use std::path::{Path, PathBuf};

use super::bundle::{create_manifest, resolve_path, ManifestParts};
use super::jsonfmt::{js_strict_equal, Json, JsonObject};
use super::reader::TraceError;
use super::schema::{
    sequence_name, TraceEvent, TraceFiles, TraceMode, TraceOutcome, TRACE_FORMAT,
    TRACE_SCHEMA_VERSION,
};

/// A bundle as JSON, in the order it was written.
#[derive(Debug, Clone)]
pub(crate) struct RawTrace {
    pub path: PathBuf,
    pub manifest: JsonObject,
    pub events: Vec<Json>,
    pub checkpoints: Vec<JsonObject>,
    pub truncated: bool,
}

fn read_if_present(path: &Path) -> Result<Option<String>, TraceError> {
    match super::storage::read_text(path) {
        Ok(body) => Ok(Some(body)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(source) => Err(TraceError::Io {
            path: path.to_path_buf(),
            source,
        }),
    }
}

/// Parse NDJSON, stopping at the first unreadable line.
pub(crate) fn parse_ndjson_ordered(body: Option<&str>) -> (Vec<Json>, bool) {
    let mut records = Vec::new();
    for line in body.unwrap_or("").split('\n') {
        if line.trim().is_empty() {
            continue;
        }
        match Json::parse(line) {
            Ok(record) => records.push(record),
            Err(_) => return (records, true),
        }
    }
    (records, false)
}

fn kind_is(event: &Json, kind: &str) -> bool {
    event.get("kind").and_then(Json::as_str) == Some(kind)
}

fn rebuild_manifest(events: &[Json]) -> JsonObject {
    let started = events
        .iter()
        .find(|event| kind_is(event, TraceEvent::TRACE_START));
    let field = |name: &str| started.and_then(|event| event.get(name)).cloned();
    let text = |name: &str| field(name).and_then(|value| value.as_str().map(str::to_string));
    create_manifest(ManifestParts {
        mode: text("mode").unwrap_or_else(|| TraceMode::CHECKPOINTS.to_string()),
        outcome: TraceOutcome::TRUNCATED.to_string(),
        started_at: text("at"),
        stopped_at: events
            .last()
            .and_then(|event| event.get("at"))
            .and_then(Json::as_str)
            .map(str::to_string),
        engine: text("engine"),
        events: field("events")
            .and_then(|value| value.as_array().cloned())
            .unwrap_or_default(),
        dom: field("dom")
            .and_then(|value| value.as_object().cloned())
            .unwrap_or_default(),
        counts: JsonObject::new().with("events", events.len()).with(
            "checkpoints",
            events
                .iter()
                .filter(|event| kind_is(event, TraceEvent::CHECKPOINT))
                .count(),
        ),
        ..ManifestParts::default()
    })
}

fn checkpoint_entry(event: &Json) -> JsonObject {
    let mut entry = JsonObject::new();
    for name in ["index", "name", "actor", "reason", "url", "at", "sequence"] {
        if let Some(value) = event.get(name) {
            entry.insert(name, value.clone());
        }
    }
    let members = event
        .get("members")
        .filter(|members| !members.is_null())
        .cloned()
        .unwrap_or_else(|| Json::Object(JsonObject::new()));
    entry.insert("members", members);
    entry
}

/// Open a bundle without interpreting it.
pub(crate) fn read_raw_trace(bundle_path: &Path) -> Result<RawTrace, TraceError> {
    let root = resolve_path(bundle_path);
    let manifest_body = read_if_present(&root.join(TraceFiles::MANIFEST))?;
    let events_body = read_if_present(&root.join(TraceFiles::EVENTS))?;
    if manifest_body.is_none() && events_body.is_none() {
        return Err(TraceError::NotFound { path: root });
    }
    let (events, truncated) = parse_ndjson_ordered(events_body.as_deref());
    let manifest = match manifest_body {
        None => rebuild_manifest(&events),
        Some(body) => {
            let parsed = Json::parse(&body)
                .ok()
                .and_then(|manifest| manifest.as_object().cloned())
                .ok_or_else(|| TraceError::ManifestUnreadable { path: root.clone() })?;
            if parsed.get("format").and_then(Json::as_str) != Some(TRACE_FORMAT) {
                return Err(TraceError::NotATrace);
            }
            let version = parsed
                .get("schemaVersion")
                .and_then(Json::as_f64)
                .unwrap_or(0.0);
            if version > TRACE_SCHEMA_VERSION as f64 {
                return Err(TraceError::UnsupportedVersion {
                    found: version as u64,
                });
            }
            parsed
        }
    };
    let checkpoints = events
        .iter()
        .filter(|event| kind_is(event, TraceEvent::CHECKPOINT))
        .map(checkpoint_entry)
        .collect();
    let complete = manifest.get("outcome").and_then(Json::as_str) == Some(TraceOutcome::COMPLETE);
    Ok(RawTrace {
        path: root,
        manifest,
        events,
        checkpoints,
        truncated: truncated || !complete,
    })
}

/// A checkpoint index as the bundle stores it.
pub(crate) fn index_of(entry: &JsonObject) -> Option<u32> {
    entry
        .get("index")
        .and_then(Json::as_f64)
        .filter(|index| index.fract() == 0.0 && *index >= 0.0 && *index <= f64::from(u32::MAX))
        .map(|index| index as u32)
}

impl RawTrace {
    fn member(&self, dir: &str, index: u32, suffix: &str) -> PathBuf {
        self.path
            .join(dir)
            .join(format!("{}{suffix}", sequence_name(index)))
    }

    /// One checkpoint's HTML.
    pub fn html(&self, index: u32) -> Result<Option<String>, TraceError> {
        read_if_present(&self.member(TraceFiles::CHECKPOINTS_DIR, index, ".html"))
    }

    /// One checkpoint's state.
    pub fn state(&self, index: u32) -> Result<Option<Json>, TraceError> {
        let member = self.member(TraceFiles::CHECKPOINTS_DIR, index, ".state.json");
        match read_if_present(&member)? {
            None => Ok(None),
            Some(body) => Json::parse(&body)
                .map(Some)
                .map_err(|_| TraceError::MemberUnreadable { path: member }),
        }
    }

    /// The mutation batches after one checkpoint.
    pub fn mutations(&self, index: u32) -> Result<Vec<Json>, TraceError> {
        let member = self.member(TraceFiles::MUTATIONS_DIR, index, ".ndjson");
        Ok(parse_ndjson_ordered(read_if_present(&member)?.as_deref()).0)
    }
}

fn controls(state: Option<&Json>) -> Vec<&Json> {
    state
        .and_then(|state| state.get("controls"))
        .and_then(Json::as_array)
        .map(|controls| controls.iter().collect())
        .unwrap_or_default()
}

fn path_key(control: &Json) -> Json {
    control.get("path").cloned().unwrap_or(Json::Null)
}

fn reported(control: &Json) -> Option<Json> {
    match control.get("checked") {
        Some(checked) => Some(checked.clone()),
        None => control.get("value").cloned(),
    }
}

fn change(path: Json, kind: &str, before: Option<Json>, after: Option<Json>) -> JsonObject {
    let mut record = JsonObject::new().with("path", path).with("change", kind);
    if let Some(before) = before {
        record.insert("before", before);
    }
    if let Some(after) = after {
        record.insert("after", after);
    }
    record
}

/// `diffControlState` from `js/src/traces/reader.js`, keeping field order.
///
/// Controls are matched by path; a path that appears twice keeps the position
/// of its first appearance and the value of its last, as a JavaScript `Map`.
pub(crate) fn diff_controls(before: Option<&Json>, after: Option<&Json>) -> Vec<JsonObject> {
    let mut index: Vec<(Json, &Json)> = Vec::new();
    for control in controls(before) {
        let key = path_key(control);
        match index.iter_mut().find(|(path, _)| *path == key) {
            Some(slot) => slot.1 = control,
            None => index.push((key, control)),
        }
    }
    let mut changes = Vec::new();
    for control in controls(after) {
        let key = path_key(control);
        let previous = index
            .iter()
            .position(|(path, _)| *path == key)
            .map(|at| index.remove(at).1);
        let Some(previous) = previous else {
            changes.push(change(key, "added", None, control.get("value").cloned()));
            continue;
        };
        let differs = !js_strict_equal(previous.get("value"), control.get("value"))
            || !js_strict_equal(previous.get("checked"), control.get("checked"));
        if differs {
            changes.push(change(
                key,
                "changed",
                reported(previous),
                reported(control),
            ));
        }
    }
    for (key, control) in index {
        changes.push(change(key, "removed", control.get("value").cloned(), None));
    }
    changes
}
