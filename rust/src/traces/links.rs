//! A Links Notation view of a trace bundle (issue #94).
//!
//! The same lines as `js/src/traces/links.js`: one link per line, written while
//! a trace records and again, identically, from a finished bundle. The JSON
//! bundle stays authoritative; this is an adapter over what it holds.

use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

use super::bundle::{open_private, resolve_path, TraceProblem};
use super::jsonfmt::{Json, JsonObject};
use super::raw_reader::{diff_controls, index_of, read_raw_trace, RawTrace};
use super::reader::TraceError;
use super::schema::{TraceEvent, TraceOutcome, TRACE_FORMAT};

/// Version of this representation, independent of the bundle's schema.
pub const TRACE_LINKS_VERSION: u64 = 1;

/// File name used when an output path names a directory.
pub const TRACE_LINKS_FILE: &str = "trace.lino";

/// Sections a caller can include, in the order they are written.
pub const TRACE_LINKS_SECTIONS: [&str; 4] = ["trace", "timeline", "checkpoints", "control-diffs"];

/// Where and what to write as Links Notation alongside a recording.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TraceLinksOptions {
    /// A file, or a directory that receives `trace.lino`.
    pub output: PathBuf,
    /// Sections to write; `None` writes all of [`TRACE_LINKS_SECTIONS`].
    pub include: Option<Vec<String>>,
    /// Include full DOM content (`full`) or visible text changes (`text`).
    pub dom: Option<String>,
}

/// Why an export could not be produced.
#[derive(Debug, thiserror::Error)]
pub enum TraceExportError {
    /// The bundle could not be read.
    #[error(transparent)]
    Read(#[from] TraceError),
    /// The options name something that does not exist.
    #[error("{0}")]
    Invalid(String),
    /// The export could not be written.
    #[error("cannot write {path}: {source}")]
    Io {
        /// File that could not be written.
        path: PathBuf,
        /// What the filesystem reported.
        source: std::io::Error,
    },
}

/// One link: an id and, optionally, values that are links themselves.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Link {
    id: String,
    values: Vec<Link>,
}

impl Link {
    pub(crate) fn new(id: impl Into<String>, values: Vec<Link>) -> Self {
        Self {
            id: id.into(),
            values,
        }
    }

    /// `Link.format(false)` from `links-notation`.
    fn format(&self) -> String {
        let id = escape_reference(&self.id);
        if self.values.is_empty() {
            return format!("({id})");
        }
        let values = self
            .values
            .iter()
            .map(|value| {
                if value.values.is_empty() {
                    escape_reference(&value.id)
                } else {
                    value.format()
                }
            })
            .collect::<Vec<_>>()
            .join(" ");
        format!("({id}: {values})")
    }
}

/// `Link.escapeReference` from `links-notation`.
fn escape_reference(reference: &str) -> String {
    if reference.is_empty() {
        return "\"\"".to_string();
    }
    let single = reference.contains('\'');
    let double = reference.contains('"');
    if single && double {
        return format!("'{}'", reference.replace('\'', "\\'"));
    }
    if double {
        return format!("'{reference}'");
    }
    if single {
        return format!("\"{reference}\"");
    }
    let needs_quoting = reference.starts_with('#')
        || reference
            .chars()
            .any(|c| matches!(c, ':' | '(' | ')' | ' ' | '\t' | '\n' | '\r'));
    if needs_quoting {
        format!("'{reference}'")
    } else {
        reference.to_string()
    }
}

/// Make one value safe to write as a link, reversibly.
pub fn encode_link_text(value: &Json) -> String {
    let text = match value {
        Json::String(text) => text.clone(),
        other => other.to_compact(),
    };
    let escaped = text
        .replace('\\', "\\\\")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace('\t', "\\t");
    if escaped.contains('\'') && escaped.contains('"') {
        escaped.replace('"', "\\u0022")
    } else {
        escaped
    }
}

/// Read back what [`encode_link_text`] wrote.
pub fn decode_link_text(text: &str) -> String {
    let mut decoded = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find('\\') {
        decoded.push_str(&rest[..at]);
        let tail = &rest[at + 1..];
        let (replacement, used) = if tail.starts_with('\\') {
            ("\\", 1)
        } else if tail.starts_with('n') {
            ("\n", 1)
        } else if tail.starts_with('r') {
            ("\r", 1)
        } else if tail.starts_with('t') {
            ("\t", 1)
        } else if tail.starts_with("u0022") {
            ("\"", 5)
        } else {
            ("\\", 0)
        };
        decoded.push_str(replacement);
        rest = &tail[used..];
    }
    decoded.push_str(rest);
    decoded
}

fn leaf(value: &Json) -> Link {
    Link::new(encode_link_text(value), Vec::new())
}

pub(crate) fn field(name: &str, value: Option<&Json>) -> Option<Link> {
    match value {
        None | Some(Json::Null) => None,
        Some(value) => Some(Link::new(name, vec![leaf(value)])),
    }
}

/// `a ?? b`: the first value that is neither missing nor `null`.
fn coalesce<'a>(values: &[Option<&'a Json>]) -> Option<&'a Json> {
    values
        .iter()
        .copied()
        .flatten()
        .find(|value| !value.is_null())
}

fn implied_actor(kind: Option<&str>) -> Option<&'static str> {
    Some(match kind? {
        TraceEvent::TRACE_START | TraceEvent::TRACE_STOP => "recorder",
        TraceEvent::MUTATIONS | TraceEvent::DROPPED => "recorder",
        TraceEvent::INTERACTION | TraceEvent::CHECKPOINT => "automation",
        TraceEvent::NAVIGATION | TraceEvent::CONSOLE | TraceEvent::PAGE_ERROR => "browser",
        TraceEvent::DIALOG | TraceEvent::REQUEST_FAILED | TraceEvent::DOWNLOAD => "browser",
        _ => return None,
    })
}

const HEAD_FIELDS: [&str; 13] = [
    "sequence",
    "at",
    "monotonicMs",
    "kind",
    "traceId",
    "browserContextId",
    "pageId",
    "navigationId",
    "frameId",
    "action",
    "actor",
    "target",
    "outcome",
];

fn outcome_of(event: &JsonObject) -> &'static str {
    let truthy = |name: &str| event.get(name).is_some_and(Json::truthy);
    if event.get("kind").and_then(Json::as_str) == Some(TraceEvent::DROPPED) {
        return "dropped";
    }
    if event.get("ok") == Some(&Json::Bool(false)) || truthy("error") || truthy("failure") {
        return "failed";
    }
    if event.get("truncated") == Some(&Json::Bool(true)) {
        return "partial";
    }
    if event.get("ok") == Some(&Json::Bool(true)) {
        return "ok";
    }
    "recorded"
}

/// One timeline event as one link.
pub(crate) fn timeline_link(event: &JsonObject) -> Link {
    let kind = event.get("kind").and_then(Json::as_str);
    let implied = implied_actor(kind).map(Json::from);
    let outcome = Json::from(outcome_of(event));
    let mut values: Vec<Option<Link>> = vec![
        field("sequence", event.get("sequence")),
        field("at", event.get("at")),
        field("monotonicMs", event.get("monotonicMs")),
        field("kind", event.get("kind")),
        field("trace", event.get("traceId")),
        field("context", event.get("browserContextId")),
        field("page", event.get("pageId")),
        field("navigation", event.get("navigationId")),
        field("frame", event.get("frameId")),
        field("actor", coalesce(&[event.get("actor"), implied.as_ref()])),
        field(
            "action",
            coalesce(&[event.get("action"), event.get("phase")]),
        ),
        field(
            "target",
            coalesce(&[event.get("target"), event.get("url"), event.get("member")]),
        ),
        field("outcome", Some(&outcome)),
    ];
    for (name, value) in event.iter() {
        if HEAD_FIELDS.contains(&name.as_str()) || value.is_null() || name == "members" {
            continue;
        }
        values.push(field(name, Some(value)));
    }
    Link::new("timeline", values.into_iter().flatten().collect())
}

/// One checkpoint as one link that points at its members.
pub(crate) fn checkpoint_link(event: &JsonObject) -> Link {
    let members = event.get("members").filter(|members| !members.is_null());
    let member = |name: &str| members.and_then(|members| members.get(name));
    let outcome = Json::from(outcome_of(event));
    let values = [
        field("index", event.get("index")),
        field("sequence", event.get("sequence")),
        field("at", event.get("at")),
        field("name", event.get("name")),
        field("actor", event.get("actor")),
        field("reason", event.get("reason")),
        field("page", event.get("pageId")),
        field("navigation", event.get("navigationId")),
        field("url", event.get("url")),
        field("outcome", Some(&outcome)),
        field("html", member("html")),
        field("state", member("state")),
        field("screenshot", member("screenshot")),
    ];
    Link::new("checkpoint", values.into_iter().flatten().collect())
}

fn control_diff_link(
    change: &JsonObject,
    checkpoint: &Json,
    previous: &Json,
    actor: Option<&Json>,
) -> Link {
    let values = [
        field("checkpoint", Some(checkpoint)),
        field("previous", Some(previous)),
        field("path", change.get("path")),
        field("change", change.get("change")),
        field("before", change.get("before")),
        field("after", change.get("after")),
        field("actor", actor),
    ];
    Link::new("control-diff", values.into_iter().flatten().collect())
}

/// What the opening link says about a trace.
#[derive(Debug, Clone, Default)]
pub(crate) struct LinksHeader {
    pub bundle: String,
    pub schema_version: Option<Json>,
    pub mode: Option<Json>,
    pub engine: Option<Json>,
    pub started_at: Option<Json>,
    pub commander_version: Option<Json>,
}

fn header_link(about: &LinksHeader) -> Link {
    let values = [
        field("format", Some(&Json::from(TRACE_FORMAT))),
        field("links", Some(&Json::from(TRACE_LINKS_VERSION))),
        field("schema", about.schema_version.as_ref()),
        field("bundle", Some(&Json::from(about.bundle.as_str()))),
        field("mode", about.mode.as_ref()),
        field("engine", about.engine.as_ref()),
        field("started", about.started_at.as_ref()),
        field("commander", about.commander_version.as_ref()),
    ];
    Link::new("trace", values.into_iter().flatten().collect())
}

fn result_link(manifest: &JsonObject, truncated: bool) -> Link {
    let counts = manifest.get("counts");
    let count = |name: &str| counts.and_then(|counts| counts.get(name));
    let replay: Vec<Link> = manifest
        .get("replay")
        .and_then(Json::as_object)
        .map(|replay| {
            replay
                .iter()
                .filter(|(_, supported)| supported.truthy())
                .map(|(name, _)| leaf(&Json::from(name.as_str())))
                .collect()
        })
        .unwrap_or_default();
    let mut values: Vec<Link> = [
        field("outcome", manifest.get("outcome")),
        field("stopped", manifest.get("stoppedAt")),
        field("events", count("events")),
        field("checkpoints", count("checkpoints")),
        field("mutationBatches", count("mutationBatches")),
        field("dropped", manifest.get("dropped")),
        field("truncated", Some(&Json::Bool(truncated))),
    ]
    .into_iter()
    .flatten()
    .collect();
    if !replay.is_empty() {
        values.push(Link::new("replay", replay));
    }
    Link::new("result", values)
}

/// One link per line, newline terminated.
pub(crate) fn format_trace_links(links: &[Link]) -> String {
    links
        .iter()
        .map(|link| format!("{}\n", link.format()))
        .collect()
}

/// Check `include` and return the sections it names.
pub(crate) fn chosen_sections(include: Option<&[String]>) -> Result<Vec<String>, String> {
    let Some(include) = include else {
        return Ok(TRACE_LINKS_SECTIONS
            .iter()
            .map(|name| name.to_string())
            .collect());
    };
    for name in include {
        if !TRACE_LINKS_SECTIONS.contains(&name.as_str()) {
            return Err(format!(
                "unknown trace links section \"{name}\"; expected one of {}",
                TRACE_LINKS_SECTIONS.join(", ")
            ));
        }
    }
    Ok(include.to_vec())
}

fn has(sections: &[String], name: &str) -> bool {
    sections.iter().any(|section| section == name)
}

fn links_for_event(event: &JsonObject, sections: &[String]) -> Vec<Link> {
    let mut links = Vec::new();
    if has(sections, "timeline") {
        links.push(timeline_link(event));
    }
    let checkpoint = event.get("kind").and_then(Json::as_str) == Some(TraceEvent::CHECKPOINT);
    if checkpoint && has(sections, "checkpoints") {
        links.push(checkpoint_link(event));
    }
    links
}

fn control_diff_links(opened: &RawTrace) -> Result<Vec<Link>, TraceError> {
    let mut links = Vec::new();
    let mut previous: Option<(Json, Json)> = None;
    for checkpoint in &opened.checkpoints {
        let state = match index_of(checkpoint) {
            Some(index) => opened.state(index)?.filter(Json::truthy),
            None => None,
        };
        let index = checkpoint.get("index").cloned().unwrap_or(Json::Null);
        if let (Some((before_index, before)), Some(state)) = (&previous, &state) {
            for change in diff_controls(Some(before), Some(state)) {
                links.push(control_diff_link(
                    &change,
                    &index,
                    before_index,
                    checkpoint.get("actor"),
                ));
            }
        }
        if let Some(state) = state {
            previous = Some((index, state));
        }
    }
    Ok(links)
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn build_trace_links(opened: &RawTrace, sections: &[String]) -> Result<Vec<Link>, TraceError> {
    let mut links = Vec::new();
    let manifest = &opened.manifest;
    if has(sections, "trace") {
        links.push(header_link(&LinksHeader {
            bundle: file_name(&opened.path),
            schema_version: manifest.get("schemaVersion").cloned(),
            mode: manifest.get("mode").cloned(),
            engine: manifest.get("engine").cloned(),
            started_at: manifest.get("startedAt").cloned(),
            commander_version: manifest.get("commanderVersion").cloned(),
        }));
    }
    for event in &opened.events {
        if let Some(event) = event.as_object() {
            links.extend(links_for_event(event, sections));
        }
    }
    if has(sections, "control-diffs") {
        links.extend(control_diff_links(opened)?);
    }
    if has(sections, "trace") {
        links.push(result_link(manifest, opened.truncated));
    }
    Ok(links)
}

/// A finished (or interrupted) bundle as Links Notation text.
///
/// # Errors
///
/// Fails when the bundle cannot be read or `include` names an unknown section.
pub fn trace_links(
    bundle: impl AsRef<Path>,
    include: Option<&[String]>,
) -> Result<String, TraceExportError> {
    let sections = chosen_sections(include).map_err(TraceExportError::Invalid)?;
    let opened = read_raw_trace(bundle.as_ref())?;
    Ok(format_trace_links(&build_trace_links(&opened, &sections)?))
}

fn resolve_output(output: &Path) -> Result<PathBuf, String> {
    if output.as_os_str().is_empty() {
        return Err("trace links output must be a path".to_string());
    }
    let resolved = resolve_path(output);
    if resolved.is_dir() {
        return Ok(resolved.join(TRACE_LINKS_FILE));
    }
    Ok(resolved)
}

fn create_parent(file: &Path) -> std::io::Result<()> {
    match file.parent() {
        Some(parent) => fs::create_dir_all(parent),
        None => Ok(()),
    }
}

/// Write a bundle as Links Notation; the file that was written.
///
/// # Errors
///
/// Fails when the bundle cannot be read, `include` names an unknown section or
/// the file cannot be written.
pub fn write_trace_links(
    bundle: impl AsRef<Path>,
    output: impl AsRef<Path>,
    include: Option<&[String]>,
) -> Result<PathBuf, TraceExportError> {
    let file = resolve_output(output.as_ref()).map_err(TraceExportError::Invalid)?;
    let text = trace_links(bundle, include)?;
    let io = |source| TraceExportError::Io {
        path: file.clone(),
        source,
    };
    create_parent(&file).map_err(io)?;
    open_private(&file, false)
        .and_then(|mut handle| handle.write_all(text.as_bytes()))
        .map_err(io)?;
    Ok(file)
}

/// The export written while a trace records.
pub(crate) struct LinksSink {
    pub path: PathBuf,
    pub problems: Vec<TraceProblem>,
    sections: Vec<String>,
    file: Option<File>,
    dom: Option<String>,
    root: PathBuf,
    seen_dom: (String, u64),
}

impl LinksSink {
    /// Open the export and write its header.
    pub fn open(
        options: &TraceLinksOptions,
        about: LinksHeader,
        root: &Path,
    ) -> Result<Self, String> {
        let path = resolve_output(&options.output)?;
        let sections = chosen_sections(options.include.as_deref())?;
        create_parent(&path).map_err(|error| error.to_string())?;
        let file = open_private(&path, false).map_err(|error| error.to_string())?;
        let mut sink = Self {
            path,
            problems: Vec::new(),
            sections,
            file: Some(file),
            dom: options.dom.clone(),
            root: root.to_path_buf(),
            seen_dom: (String::new(), 0),
        };
        if has(&sink.sections, "trace") {
            sink.append(&[header_link(&about)]);
        }
        Ok(sink)
    }

    fn append(&mut self, links: &[Link]) {
        if links.is_empty() {
            return;
        }
        let Some(file) = self.file.as_mut() else {
            return;
        };
        if let Err(error) = file.write_all(format_trace_links(links).as_bytes()) {
            self.problems.push(TraceProblem {
                reason: None,
                member: Some(self.path.to_string_lossy().into_owned()),
                detail: Some(error.to_string()),
            });
        }
    }

    /// Write the links of one event as it is recorded.
    pub(crate) fn set_root(&mut self, root: &Path) {
        self.root = root.to_path_buf();
    }

    pub fn event(&mut self, event: &JsonObject) {
        let mut links = links_for_event(event, &self.sections);
        if let Some(dom) = &self.dom {
            links.extend(super::dom_links::event_links(
                &self.root,
                event,
                dom,
                &mut self.seen_dom,
            ));
        }
        self.append(&links);
    }

    /// Append the control diffs and the result, then close the file.
    pub fn close(&mut self, manifest: &JsonObject, bundle_path: Option<&Path>) {
        if self.file.is_none() {
            return;
        }
        let mut links = Vec::new();
        if let (true, Some(bundle_path)) = (has(&self.sections, "control-diffs"), bundle_path) {
            match read_raw_trace(bundle_path).and_then(|opened| control_diff_links(&opened)) {
                Ok(diffs) => links.extend(diffs),
                Err(error) => self.problems.push(TraceProblem {
                    reason: None,
                    member: Some(self.path.to_string_lossy().into_owned()),
                    detail: Some(error.to_string()),
                }),
            }
        }
        if has(&self.sections, "trace") {
            let complete =
                manifest.get("outcome").and_then(Json::as_str) == Some(TraceOutcome::COMPLETE);
            links.push(result_link(manifest, !complete));
        }
        self.append(&links);
        if let Some(mut file) = self.file.take() {
            let _ = file.flush();
        }
    }

    /// Remove the export of a discarded run.
    pub fn discard(&mut self) {
        self.file = None;
        let _ = fs::remove_file(&self.path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn references_are_quoted_like_links_notation() {
        assert_eq!(escape_reference(""), "\"\"");
        assert_eq!(escape_reference("plain"), "plain");
        assert_eq!(escape_reference("a b"), "'a b'");
        assert_eq!(escape_reference("#go"), "'#go'");
        assert_eq!(escape_reference("it's"), "\"it's\"");
        assert_eq!(escape_reference("say \"hi\""), "'say \"hi\"'");
        assert_eq!(escape_reference("'\""), "'\\'\"'");
    }

    #[test]
    fn link_text_round_trips() {
        let text = "a\\b\n\tc \"d\" 'e'";
        let encoded = encode_link_text(&Json::from(text));
        assert_eq!(encoded, "a\\\\b\\n\\tc \\u0022d\\u0022 'e'");
        assert_eq!(decode_link_text(&encoded), text);
        assert_eq!(encode_link_text(&Json::from(2.0)), "2");
    }

    #[test]
    fn unknown_sections_are_rejected() {
        let error = chosen_sections(Some(&["timeline".into(), "nope".into()])).unwrap_err();
        assert_eq!(
            error,
            "unknown trace links section \"nope\"; expected one of trace, timeline, checkpoints, control-diffs"
        );
    }
}
