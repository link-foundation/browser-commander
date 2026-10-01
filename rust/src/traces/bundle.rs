//! Writing a trace bundle to disk (issue #108).
//!
//! The same layout and the same bytes as `js/src/traces/bundle.js`. Every
//! write is best-effort by default: a trace exists to explain a run, so failing
//! to record something leaves a visible `dropped` record instead of breaking
//! the automation being recorded. Strict mode turns that record into an error.

use std::fmt;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use super::jsonfmt::{Json, JsonObject};
use super::links::LinksSink;
use super::schema::{
    sequence_name, TraceDropReason, TraceEvent, TraceFiles, TraceOutcome, TRACE_FORMAT,
    TRACE_SCHEMA_VERSION,
};

/// Owner-only file mode: a trace may hold form values and page content.
pub const TRACE_FILE_MODE: u32 = 0o600;

/// Owner-only directory mode for the bundle root.
pub const TRACE_DIRECTORY_MODE: u32 = 0o700;

/// Default ceiling for a whole bundle.
pub const DEFAULT_MAX_BUNDLE_BYTES: u64 = 256 * 1024 * 1024;

/// Default ceiling for one member.
pub const DEFAULT_MAX_RESOURCE_BYTES: u64 = 32 * 1024 * 1024;

/// Why recording could not go on.
#[derive(Debug, thiserror::Error)]
pub enum TraceRecordError {
    /// The options cannot describe a trace.
    #[error("{0}")]
    Invalid(String),
    /// The bundle could not be created or finished.
    #[error("{0}")]
    Io(#[from] io::Error),
    /// Something was dropped while the trace was strict.
    #[error("{0}")]
    Dropped(String),
    /// The trace was used after `stop()`.
    #[error("this trace has already been stopped")]
    Stopped,
}

/// Something a trace could not record, as listed in a stopped trace's result.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TraceProblem {
    /// One of [`TraceDropReason`], when the bundle reported it.
    pub reason: Option<String>,
    /// The member or record that is missing.
    pub member: Option<String>,
    /// What went wrong.
    pub detail: Option<String>,
}

/// Size ceilings; `None` keeps the default.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TraceLimits {
    /// Ceiling for the whole bundle (256 MiB).
    pub max_bundle_bytes: Option<u64>,
    /// Ceiling for one member (32 MiB).
    pub max_resource_bytes: Option<u64>,
    /// Ceiling for one timeline line (the resource ceiling).
    pub max_event_bytes: Option<u64>,
    /// Markup kept per checkpoint before it is truncated (unlimited).
    pub max_html_bytes: Option<u64>,
    /// Mutation records the page queues between drains (5000).
    pub max_queued_mutations: Option<u64>,
}

impl TraceLimits {
    /// The limits a caller set, as the manifest records them.
    pub fn to_json(&self) -> JsonObject {
        let mut limits = JsonObject::new();
        for (name, value) in [
            ("maxBundleBytes", self.max_bundle_bytes),
            ("maxResourceBytes", self.max_resource_bytes),
            ("maxEventBytes", self.max_event_bytes),
            ("maxHtmlBytes", self.max_html_bytes),
            ("maxQueuedMutations", self.max_queued_mutations),
        ] {
            if let Some(value) = value {
                limits.insert(name, value);
            }
        }
        limits
    }
}

/// A source of milliseconds.
pub type TraceClockFn = Arc<dyn Fn() -> f64 + Send + Sync>;

/// Where a trace's timestamps come from; replaceable for golden tests.
#[derive(Clone)]
pub struct TraceClock {
    /// Wall-clock milliseconds since the Unix epoch.
    pub now: TraceClockFn,
    /// Monotonic milliseconds since an arbitrary origin.
    pub monotonic: TraceClockFn,
}

impl Default for TraceClock {
    fn default() -> Self {
        static ORIGIN: OnceLock<Instant> = OnceLock::new();
        ORIGIN.get_or_init(Instant::now);
        Self {
            now: Arc::new(|| {
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|elapsed| elapsed.as_millis() as f64)
                    .unwrap_or(0.0)
            }),
            monotonic: Arc::new(|| {
                ORIGIN.get_or_init(Instant::now).elapsed().as_secs_f64() * 1000.0
            }),
        }
    }
}

impl TraceClock {
    /// A clock that always says the same thing.
    pub fn fixed(now: f64, monotonic: f64) -> Self {
        Self {
            now: Arc::new(move || now),
            monotonic: Arc::new(move || monotonic),
        }
    }
}

impl fmt::Debug for TraceClock {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("TraceClock").finish_non_exhaustive()
    }
}

/// `new Date(ms).toISOString()`.
pub fn iso_timestamp(ms: f64) -> String {
    let ms = if ms.is_finite() { ms.trunc() as i64 } else { 0 };
    let days = ms.div_euclid(86_400_000);
    let in_day = ms.rem_euclid(86_400_000);
    // Howard Hinnant's civil-from-days.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        in_day / 3_600_000,
        in_day / 60_000 % 60,
        in_day / 1000 % 60,
        in_day % 1000
    )
}

/// `{os} {arch}` of the running process.
pub fn trace_platform() -> String {
    format!("{} {}", std::env::consts::OS, std::env::consts::ARCH)
}

/// `rust {version}` of this crate.
pub fn trace_runtime() -> String {
    format!("rust {}", env!("CARGO_PKG_VERSION"))
}

/// The parts of a manifest that vary; everything else has a fixed value.
#[derive(Debug, Clone, Default)]
pub(crate) struct ManifestParts {
    pub mode: String,
    pub outcome: String,
    pub started_at: Option<String>,
    pub stopped_at: Option<String>,
    pub commander_version: Option<String>,
    pub engine: Option<String>,
    pub events: Vec<Json>,
    pub dom: JsonObject,
    pub replay: JsonObject,
    pub privacy: JsonObject,
    pub limits: JsonObject,
    pub counts: JsonObject,
}

/// `createManifest` from `js/src/traces/schema.js`, key for key.
pub(crate) fn create_manifest(parts: ManifestParts) -> JsonObject {
    let mut replay = JsonObject::new();
    for name in [
        "checkpoints",
        "mutations",
        "childListPositions",
        "liveState",
        "identifiers",
    ] {
        replay.insert(name, false);
    }
    replay.extend_from(&parts.replay);
    let mut counts = JsonObject::new()
        .with("checkpoints", 0)
        .with("events", 0)
        .with("mutationBatches", 0);
    counts.extend_from(&parts.counts);
    JsonObject::new()
        .with("schemaVersion", TRACE_SCHEMA_VERSION)
        .with("format", TRACE_FORMAT)
        .with("mode", parts.mode)
        .with("outcome", parts.outcome)
        .with("startedAt", parts.started_at)
        .with("stoppedAt", parts.stopped_at)
        .with("commanderVersion", parts.commander_version)
        .with("engine", parts.engine)
        .with("browser", Json::Null)
        .with("platform", trace_platform())
        .with("runtime", trace_runtime())
        .with("events", parts.events)
        .with("dom", parts.dom)
        .with("replay", replay)
        .with("privacy", parts.privacy)
        .with("limits", parts.limits)
        .with("counts", counts)
        .with("dropped", 0)
}

pub(crate) fn create_dir(path: &Path) -> io::Result<()> {
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(TRACE_DIRECTORY_MODE);
    }
    builder.create(path)
}

pub(crate) fn open_private(path: &Path, append: bool) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.create(true);
    if append {
        options.append(true);
    } else {
        options.write(true).truncate(true);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(TRACE_FILE_MODE);
    }
    options.open(path)
}

pub(crate) fn write_private(path: &Path, data: &[u8]) -> io::Result<()> {
    open_private(path, false)?.write_all(data)
}

/// `path.resolve`: absolute, with `.` and `..` folded away.
pub(crate) fn resolve_path(path: &Path) -> PathBuf {
    let joined = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("/"))
            .join(path)
    };
    let mut resolved = PathBuf::new();
    for part in joined.components() {
        match part {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                resolved.pop();
            }
            other => resolved.push(other),
        }
    }
    resolved
}

/// The bundle being written.
pub(crate) struct Bundle {
    pub root: PathBuf,
    events: Option<File>,
    written: u64,
    sequence: u64,
    dropped: u64,
    checkpoints: u64,
    event_count: u64,
    mutation_batches: u64,
    pub problems: Vec<TraceProblem>,
    strict: bool,
    max_bundle: u64,
    max_resource: u64,
    max_event: u64,
    clock: TraceClock,
    pub links: Option<LinksSink>,
}

impl Bundle {
    pub fn open(
        output: &Path,
        limits: &TraceLimits,
        strict: bool,
        clock: TraceClock,
    ) -> Result<Self, TraceRecordError> {
        if output.as_os_str().is_empty() {
            return Err(TraceRecordError::Invalid(
                "trace output must be a path".into(),
            ));
        }
        let root = resolve_path(output);
        let max_resource = limits
            .max_resource_bytes
            .unwrap_or(DEFAULT_MAX_RESOURCE_BYTES);
        create_dir(&root)?;
        let events = open_private(&root.join(TraceFiles::EVENTS), true)?;
        Ok(Self {
            root,
            events: Some(events),
            written: 0,
            sequence: 0,
            dropped: 0,
            checkpoints: 0,
            event_count: 0,
            mutation_batches: 0,
            problems: Vec::new(),
            strict,
            max_bundle: limits.max_bundle_bytes.unwrap_or(DEFAULT_MAX_BUNDLE_BYTES),
            max_resource,
            max_event: limits.max_event_bytes.unwrap_or(max_resource),
            clock,
            links: None,
        })
    }

    pub fn now_iso(&self) -> String {
        iso_timestamp((self.clock.now)())
    }

    pub fn now_ms(&self) -> f64 {
        (self.clock.now)()
    }

    /// Record that something could not be written.
    pub fn drop_record(
        &mut self,
        reason: &str,
        member: Option<&str>,
        detail: Option<&str>,
    ) -> Result<(), TraceRecordError> {
        self.dropped += 1;
        self.problems.push(TraceProblem {
            reason: Some(reason.to_string()),
            member: member.map(str::to_string),
            detail: detail.map(str::to_string),
        });
        if self.strict {
            let detail = detail
                .filter(|detail| !detail.is_empty())
                .map(|detail| format!(" ({detail})"))
                .unwrap_or_default();
            return Err(TraceRecordError::Dropped(format!(
                "trace {} dropped: {reason}{detail}",
                member.unwrap_or("record")
            )));
        }
        let mut record = JsonObject::new()
            .with("kind", TraceEvent::DROPPED)
            .with("reason", reason);
        if let Some(member) = member {
            record.insert("member", member);
        }
        if let Some(detail) = detail {
            record.insert("detail", detail);
        }
        self.append_event(record, false)?;
        Ok(())
    }

    /// Append one event to the timeline; `None` when it was dropped.
    pub fn append_event(
        &mut self,
        event: JsonObject,
        retry: bool,
    ) -> Result<Option<JsonObject>, TraceRecordError> {
        self.sequence += 1;
        let mut record = JsonObject::new()
            .with("sequence", self.sequence)
            .with("at", self.now_iso())
            .with("monotonicMs", ((self.clock.monotonic)() + 0.5).floor());
        record.extend_from(&event);
        let line = format!("{}\n", Json::Object(record.clone()).to_compact());
        let bytes = line.len() as u64;

        let fits = self.written + bytes <= self.max_bundle && (!retry || bytes <= self.max_event);
        if !fits {
            if retry {
                let detail = format!("{bytes} bytes");
                self.drop_record(
                    TraceDropReason::SIZE_LIMIT,
                    Some(TraceFiles::EVENTS),
                    Some(&detail),
                )?;
            }
            return Ok(None);
        }

        let outcome = match self.events.as_mut() {
            Some(file) => file.write_all(line.as_bytes()),
            None => Err(io::Error::other("the timeline is closed")),
        };
        match outcome {
            Ok(()) => {
                self.written += bytes;
                self.event_count += 1;
                if let Some(links) = self.links.as_mut() {
                    links.event(&record);
                }
                Ok(Some(record))
            }
            Err(error) => {
                if retry {
                    self.drop_record(
                        TraceDropReason::WRITE_FAILED,
                        Some(TraceFiles::EVENTS),
                        Some(&error.to_string()),
                    )?;
                }
                Ok(None)
            }
        }
    }

    /// Write one member; the member name, or `None` when it was dropped.
    pub fn write_member(
        &mut self,
        member: &str,
        data: &[u8],
    ) -> Result<Option<String>, TraceRecordError> {
        let length = data.len() as u64;
        if length > self.max_resource || self.written + length > self.max_bundle {
            let detail = format!("{length} bytes");
            self.drop_record(TraceDropReason::SIZE_LIMIT, Some(member), Some(&detail))?;
            return Ok(None);
        }
        let target = self.root.join(member);
        let outcome = target
            .parent()
            .map_or(Ok(()), create_dir)
            .and_then(|()| write_private(&target, data));
        match outcome {
            Ok(()) => {
                self.written += length;
                Ok(Some(member.to_string()))
            }
            Err(error) => {
                self.drop_record(
                    TraceDropReason::WRITE_FAILED,
                    Some(member),
                    Some(&error.to_string()),
                )?;
                Ok(None)
            }
        }
    }

    /// Write a checkpoint's HTML, state and screenshot; what was written.
    pub fn write_checkpoint(
        &mut self,
        index: u32,
        html: Option<&str>,
        state: Option<&JsonObject>,
        screenshot: Option<&[u8]>,
    ) -> Result<JsonObject, TraceRecordError> {
        let name = sequence_name(index);
        let dir = TraceFiles::CHECKPOINTS_DIR;
        let mut members = JsonObject::new();
        if let Some(html) = html {
            if let Some(member) =
                self.write_member(&format!("{dir}/{name}.html"), html.as_bytes())?
            {
                members.insert("html", member);
            }
        }
        if let Some(state) = state {
            let body = format!("{}\n", Json::Object(state.clone()).to_pretty());
            if let Some(member) =
                self.write_member(&format!("{dir}/{name}.state.json"), body.as_bytes())?
            {
                members.insert("state", member);
            }
        }
        if let Some(shot) = screenshot {
            if let Some(member) = self.write_member(&format!("{dir}/{name}.png"), shot)? {
                members.insert("screenshot", member);
            }
        }
        self.checkpoints += 1;
        Ok(members)
    }

    /// Write one checkpoint's mutation batches; the member, when written.
    pub fn write_mutations(
        &mut self,
        index: u32,
        batches: &[Json],
    ) -> Result<Option<String>, TraceRecordError> {
        if batches.is_empty() {
            return Ok(None);
        }
        let member = format!(
            "{}/{}.ndjson",
            TraceFiles::MUTATIONS_DIR,
            sequence_name(index)
        );
        let mut body = batches
            .iter()
            .map(Json::to_compact)
            .collect::<Vec<_>>()
            .join("\n");
        body.push('\n');
        let written = self.write_member(&member, body.as_bytes())?;
        if written.is_some() {
            self.mutation_batches += batches.len() as u64;
        }
        Ok(written)
    }

    /// Write the manifest and close the timeline.
    pub fn close(&mut self, mut manifest: JsonObject) -> Result<JsonObject, TraceRecordError> {
        let counts = JsonObject::new()
            .with("checkpoints", self.checkpoints)
            .with("events", self.event_count)
            .with("mutationBatches", self.mutation_batches);
        manifest.insert("counts", counts);
        manifest.insert("dropped", self.dropped);
        let complete =
            manifest.get("outcome").and_then(Json::as_str) == Some(TraceOutcome::COMPLETE);
        if self.dropped > 0 && complete {
            manifest.insert("outcome", TraceOutcome::PARTIAL);
        }
        if let Some(mut file) = self.events.take() {
            file.flush()?;
        }
        let body = format!("{}\n", Json::Object(manifest.clone()).to_pretty());
        write_private(&self.root.join(TraceFiles::MANIFEST), body.as_bytes())?;
        Ok(manifest)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timestamps_match_javascript() {
        assert_eq!(
            iso_timestamp(1_767_225_600_000.0),
            "2026-01-01T00:00:00.000Z"
        );
        assert_eq!(iso_timestamp(0.0), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso_timestamp(951_782_400_123.9), "2000-02-29T00:00:00.123Z");
        assert_eq!(iso_timestamp(-1.0), "1969-12-31T23:59:59.999Z");
    }

    #[test]
    fn limits_record_only_what_was_set() {
        let limits = TraceLimits {
            max_queued_mutations: Some(100),
            max_bundle_bytes: Some(1),
            ..TraceLimits::default()
        };
        assert_eq!(
            Json::Object(limits.to_json()).to_compact(),
            r#"{"maxBundleBytes":1,"maxQueuedMutations":100}"#
        );
    }
}
