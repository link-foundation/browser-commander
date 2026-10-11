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
    #[error(transparent)]
    Engine(#[from] crate::core::engine::EngineError),
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
    /// Markup kept per checkpoint before it is truncated (4 MiB).
    pub max_html_bytes: Option<u64>,
    /// Mutation records the page queues between drains (5000).
    pub max_queued_mutations: Option<u64>,
    /// Mutation bytes kept per checkpoint interval (4 MiB).
    pub max_mutation_bytes: Option<u64>,
    /// Rotate before writes; zero max_segments retains all segments.
    pub rotation: Option<super::rolling::RotationOptions>,
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
            ("maxMutationBytes", self.max_mutation_bytes),
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

type BaseCheckpoint = (u32, Option<String>, Option<JsonObject>, Option<Vec<u8>>);

/// The bundle being written.
pub(crate) struct Bundle {
    pub root: PathBuf,
    pub active_root: PathBuf,
    rotation: Option<super::rolling::RotationOptions>,
    pub segments: Vec<String>,
    segment_number: u64,
    pinned: Option<&'static str>,
    base: Option<BaseCheckpoint>,
    base_event: Option<JsonObject>,
    mutation_interval: Option<u32>,
    mutation_bytes: u64,
    pub mutation_truncated: bool,
    max_mutation: u64,
    events: Option<File>,
    pub(crate) written: u64,
    sequence: u64,
    dropped: u64,
    checkpoints: u64,
    event_count: u64,
    mutation_batches: u64,
    segment_start: (u64, u64, u64, u64),
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
        lazy_rotation: bool,
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
        let active_root = if limits.rotation.is_some() && !lazy_rotation {
            root.join("segment-000001")
        } else {
            root.clone()
        };
        create_dir(&active_root)?;
        let segments = if limits.rotation.is_some() && !lazy_rotation {
            vec!["segment-000001".to_string()]
        } else {
            Vec::new()
        };
        if !segments.is_empty() {
            write_private(
                &root.join("segments.json"),
                serde_json::json!({"segments":segments})
                    .to_string()
                    .as_bytes(),
            )?;
        }
        let events = open_private(&active_root.join(TraceFiles::EVENTS), true)?;
        Ok(Self {
            root,
            active_root,
            rotation: limits.rotation,
            segments,
            segment_number: 1,
            pinned: None,
            base: None,
            base_event: None,
            mutation_interval: None,
            mutation_bytes: 0,
            mutation_truncated: false,
            max_mutation: limits
                .max_mutation_bytes
                .unwrap_or(4 * 1024 * 1024)
                .min(max_resource),
            events: Some(events),
            written: 0,
            sequence: 0,
            dropped: 0,
            checkpoints: 0,
            event_count: 0,
            mutation_batches: 0,
            segment_start: (0, 0, 0, 0),
            problems: Vec::new(),
            strict,
            max_bundle: if limits.rotation.is_some() {
                u64::MAX
            } else {
                limits.max_bundle_bytes.unwrap_or(DEFAULT_MAX_BUNDLE_BYTES)
            },
            max_resource,
            max_event: limits.max_event_bytes.unwrap_or(max_resource),
            clock,
            links: None,
        })
    }

    fn prepare(&mut self, bytes: u64, carry: bool) -> Result<(), TraceRecordError> {
        let Some(bounds) = self.rotation else {
            return Ok(());
        };
        if self.pinned.is_some()
            || self.written == 0
            || self.written.saturating_add(bytes) <= bounds.max_bytes
        {
            return Ok(());
        }
        let manifest = create_manifest(ManifestParts {
            mode: "continuous".into(),
            outcome: "complete".into(),
            stopped_at: Some(self.now_iso()),
            ..ManifestParts::default()
        });
        self.close_segment(&manifest)?;
        if self.segments.is_empty() {
            let name = "segment-000001";
            let destination = self.root.join(name);
            create_dir(&destination)?;
            for member in [
                "events.ndjson",
                "manifest.json",
                "checkpoints",
                "mutations",
                "artifacts",
                "viewer.html",
            ] {
                let source = self.root.join(member);
                if source.exists() {
                    fs::rename(source, destination.join(member))?;
                }
            }
            self.segments.push(name.into());
        }
        self.segment_number += 1;
        let name = format!("segment-{:06}", self.segment_number);
        self.active_root = self.root.join(&name);
        create_dir(&self.active_root)?;
        self.events = Some(open_private(
            &self.active_root.join(TraceFiles::EVENTS),
            true,
        )?);
        self.written = 0;
        self.segment_start = (
            self.checkpoints,
            self.event_count,
            self.mutation_batches,
            self.dropped,
        );
        self.mutation_interval = None;
        self.segments.push(name);
        if bounds.max_segments > 0 && self.segments.len() > bounds.max_segments {
            fs::remove_dir_all(self.root.join(self.segments.remove(0)))?;
        }
        let temporary = self.root.join("segments.json.tmp");
        write_private(
            &temporary,
            serde_json::json!({"segments":self.segments})
                .to_string()
                .as_bytes(),
        )?;
        fs::rename(temporary, self.root.join("segments.json"))?;
        if carry {
            if let (Some((index, html, state, shot)), Some(mut event)) =
                (self.base.clone(), self.base_event.clone())
            {
                let members =
                    self.write_checkpoint(index, html.as_deref(), state.as_ref(), shot.as_deref())?;
                event.insert("members", members);
                event.insert("reason", "rotation-base");
                self.append_event(event, true)?;
            }
        }
        Ok(())
    }

    fn close_segment(&mut self, manifest: &JsonObject) -> Result<(), TraceRecordError> {
        if let Some(mut file) = self.events.take() {
            file.flush()?;
        }
        let mut manifest = manifest.clone();
        manifest.insert(
            "counts",
            JsonObject::new()
                .with("checkpoints", self.checkpoints - self.segment_start.0)
                .with("events", self.event_count - self.segment_start.1)
                .with(
                    "mutationBatches",
                    self.mutation_batches - self.segment_start.2,
                ),
        );
        manifest.insert("dropped", self.dropped - self.segment_start.3);
        write_private(
            &self.active_root.join(TraceFiles::MANIFEST),
            format!("{}\n", Json::Object(manifest).to_pretty()).as_bytes(),
        )?;
        Ok(())
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
        self.prepare(
            Json::Object(event.clone()).to_compact().len() as u64 + 256,
            true,
        )?;
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
                    links.set_root(&self.active_root);
                    links.event(&record);
                }
                let kind = record.get("kind").and_then(Json::as_str).unwrap_or("");
                if kind == "checkpoint" {
                    self.base_event = Some(record.clone());
                }
                if kind == "checkpoint" || (kind == "mutations" && self.pinned == Some("mutations"))
                {
                    self.pinned = None;
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
        self.write_member_mode(member, data, false)
    }

    fn write_member_mode(
        &mut self,
        member: &str,
        data: &[u8],
        append: bool,
    ) -> Result<Option<String>, TraceRecordError> {
        let length = data.len() as u64;
        self.prepare(length, true)?;
        let target = self.active_root.join(member);
        let previous = if append {
            fs::metadata(&target).map(|value| value.len()).unwrap_or(0)
        } else {
            0
        };
        if previous + length > self.max_resource || self.written + length > self.max_bundle {
            let detail = format!("{length} bytes");
            self.drop_record(TraceDropReason::SIZE_LIMIT, Some(member), Some(&detail))?;
            return Ok(None);
        }
        let outcome = target
            .parent()
            .map_or(Ok(()), create_dir)
            .and_then(|()| open_private(&target, append)?.write_all(data));
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
        let size = html.map_or(0, str::len)
            + state.map_or(0, |state| Json::Object(state.clone()).to_compact().len())
            + screenshot.map_or(0, <[u8]>::len)
            + 1024;
        self.prepare(size as u64, false)?;
        self.pinned = Some("checkpoint");
        self.base = Some((
            index,
            html.map(str::to_owned),
            state.cloned(),
            screenshot.map(<[u8]>::to_vec),
        ));
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
        self.prepare(
            batches
                .iter()
                .map(|batch| batch.to_compact().len() as u64 + 1)
                .sum::<u64>()
                + 256,
            true,
        )?;
        if self.mutation_interval != Some(index) {
            self.mutation_interval = Some(index);
            self.mutation_bytes = 0;
            self.mutation_truncated = false;
        }
        if self.mutation_truncated {
            return Ok(None);
        }
        let mut body = String::new();
        for batch in batches {
            let line = format!("{}\n", batch.to_compact());
            if self.mutation_bytes + line.len() as u64 + 256 > self.max_mutation {
                self.mutation_truncated = true;
                let marker = "{\"records\":[{\"kind\":\"truncated\",\"reason\":\"mutation interval size limit\"}]}\n";
                if self.mutation_bytes + marker.len() as u64 <= self.max_mutation {
                    body.push_str(marker);
                }
                break;
            }
            self.mutation_bytes += line.len() as u64;
            body.push_str(&line);
        }
        if body.is_empty() {
            return Ok(None);
        }
        if self.pinned != Some("checkpoint") {
            self.pinned = Some("mutations");
        }
        let written = self.write_member_mode(&member, body.as_bytes(), true)?;
        if written.is_some() {
            self.mutation_batches += body.lines().count() as u64;
        }
        Ok(written)
    }

    /// Write the manifest and close the timeline.
    pub(crate) fn abort(&mut self) {
        self.events.take();
    }

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
        self.close_segment(&manifest)?;
        for name in &self.segments {
            let file = self.root.join(name).join(TraceFiles::MANIFEST);
            let prior = Json::parse(&fs::read_to_string(&file)?).map_err(|error| {
                TraceRecordError::Invalid(format!("invalid segment manifest: {error}"))
            })?;
            let mut segment = manifest.clone();
            if let Some(prior) = prior.as_object() {
                for key in ["counts", "dropped"] {
                    if let Some(value) = prior.get(key) {
                        segment.insert(key, value.clone());
                    }
                }
            }
            write_private(
                &file,
                format!("{}\n", Json::Object(segment).to_pretty()).as_bytes(),
            )?;
        }
        Ok(manifest)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retains_periodic_drains_in_the_same_interval() {
        let dir = std::env::temp_dir().join(format!(
            "bc-periodic-{}-{}",
            std::process::id(),
            iso_timestamp((TraceClock::default().now)()).replace(':', "")
        ));
        let mut bundle = Bundle::open(
            &dir,
            &TraceLimits::default(),
            false,
            TraceClock::default(),
            false,
        )
        .unwrap();
        bundle
            .write_mutations(1, &[Json::String("first".into())])
            .unwrap();
        bundle
            .write_mutations(1, &[Json::String("second".into())])
            .unwrap();
        assert_eq!(
            fs::read_to_string(dir.join("mutations/0001.ndjson")).unwrap(),
            "\"first\"\n\"second\"\n"
        );
        bundle.abort();
        fs::remove_dir_all(dir).unwrap();
    }

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
    fn interval_truncation_keeps_marker_and_next_interval() {
        let dir = std::env::temp_dir().join(format!(
            "bc-bundle-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let mut bundle = Bundle::open(
            &dir,
            &TraceLimits {
                max_mutation_bytes: Some(512),
                ..TraceLimits::default()
            },
            false,
            TraceClock::default(),
            false,
        )
        .unwrap();
        bundle
            .write_mutations(
                1,
                &[Json::String("first".into()), Json::String("x".repeat(1000))],
            )
            .unwrap();
        assert!(bundle.mutation_truncated);
        assert!(bundle
            .write_mutations(1, &[Json::String("ignored".into())])
            .unwrap()
            .is_none());
        let first = fs::read_to_string(dir.join("mutations/0001.ndjson")).unwrap();
        assert!(first.len() <= 512);
        assert!(first.contains("truncated"));
        bundle
            .write_mutations(2, &[Json::String("next".into())])
            .unwrap();
        assert!(!bundle.mutation_truncated);
        assert!(fs::read_to_string(dir.join("mutations/0002.ndjson"))
            .unwrap()
            .contains("next"));
        bundle.abort();
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn rotated_manifests_count_their_own_events() {
        let dir = std::env::temp_dir().join(format!(
            "bc-bundle-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let mut bundle = Bundle::open(
            &dir,
            &TraceLimits {
                rotation: Some(super::super::rolling::RotationOptions {
                    max_bytes: 1024,
                    max_segments: 0,
                }),
                ..TraceLimits::default()
            },
            false,
            TraceClock::default(),
            false,
        )
        .unwrap();
        for index in 0..8 {
            bundle
                .append_event(
                    JsonObject::new()
                        .with("kind", "test")
                        .with("index", index)
                        .with("payload", "x".repeat(1500)),
                    true,
                )
                .unwrap();
        }
        let aggregate = bundle
            .close(create_manifest(ManifestParts {
                outcome: "complete".into(),
                ..ManifestParts::default()
            }))
            .unwrap();
        assert_eq!(
            aggregate
                .get("counts")
                .unwrap()
                .as_object()
                .unwrap()
                .get("events"),
            Some(&Json::from(8))
        );
        assert_eq!(bundle.segments.len(), 8);
        for name in &bundle.segments {
            let value =
                Json::parse(&fs::read_to_string(dir.join(name).join("manifest.json")).unwrap())
                    .unwrap();
            assert_eq!(
                value
                    .as_object()
                    .unwrap()
                    .get("counts")
                    .unwrap()
                    .as_object()
                    .unwrap()
                    .get("events"),
                Some(&Json::from(1))
            );
        }
        fs::remove_dir_all(dir).unwrap();
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
