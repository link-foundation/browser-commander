"""The portable browser trace format, as Python knows it (issue #87).

A trace is written by the JavaScript recorder and read by JavaScript, Python
and Rust. The layout is the contract between them, so every name and value a
reader has to agree on lives here, mirroring ``js/src/traces/schema.js``.
"""

from __future__ import annotations

import platform as platform_module
import sys
from collections.abc import Iterable, Mapping
from typing import Any

#: Schema version of the bundle.
#:
#: Readers refuse a major version they were not written for rather than
#: guessing at the meaning of unknown records.
TRACE_SCHEMA_VERSION = 1

#: Value of ``manifest.json``'s ``format`` field, for every version.
TRACE_FORMAT = "browser-commander-trace"


class TraceFiles:
    """Names every reader looks for inside a bundle."""

    MANIFEST = "manifest.json"
    EVENTS = "events.ndjson"
    CHECKPOINTS_DIR = "checkpoints"
    MUTATIONS_DIR = "mutations"
    ARTIFACTS_DIR = "artifacts"
    VIEWER = "viewer.html"


class TraceMode:
    """What the recorder captures."""

    OFF = "off"
    CHECKPOINTS = "checkpoints"
    CONTINUOUS = "continuous"
    RETAIN_ON_FAILURE = "retain-on-failure"


class TraceEvent:
    """Event kinds that share the one ordered timeline."""

    TRACE_START = "trace.start"
    TRACE_STOP = "trace.stop"
    CHECKPOINT = "checkpoint"
    MUTATIONS = "mutations"
    NAVIGATION = "navigation"
    INTERACTION = "interaction"
    CONSOLE = "console"
    PAGE_ERROR = "pageerror"
    DIALOG = "dialog"
    REQUEST_FAILED = "requestfailed"
    DOWNLOAD = "download"
    #: Something could not be recorded. The run continues; the gap is visible.
    DROPPED = "dropped"


#: Event families a caller can subscribe the recorder to.
TRACE_EVENT_SOURCES = (
    "navigation",
    "interaction",
    "console",
    "pageerror",
    "dialog",
    "requestfailed",
    "download",
)


class TraceDropReason:
    """Why a record was dropped."""

    SIZE_LIMIT = "size-limit"
    WRITE_FAILED = "write-failed"
    CAPTURE_FAILED = "capture-failed"
    PAGE_CLOSED = "page-closed"
    TIMEOUT = "timeout"


class TraceOutcome:
    """How a trace ended, recorded in the manifest."""

    #: ``stop()`` was called and every record was written.
    COMPLETE = "complete"
    #: The trace is readable but records are missing.
    PARTIAL = "partial"
    #: No manifest was ever written; readers repair this on open.
    TRUNCATED = "truncated"


def sequence_name(index: int) -> str:
    """Format a bundle member's sequence number.

    Zero padding keeps ``ls`` and any reader that sorts lexically in the same
    order as the sequence itself.

    Args:
        index: 1-based sequence number

    Returns:
        Zero-padded name, such as ``0001``
    """
    return str(index).zfill(4)


def create_manifest(
    *,
    mode: str | None = None,
    started_at: str | None = None,
    stopped_at: str | None = None,
    outcome: str = TraceOutcome.COMPLETE,
    commander_version: str | None = None,
    engine: str | None = None,
    browser: str | None = None,
    platform: str | None = None,
    runtime: str | None = None,
    counts: Mapping[str, Any] | None = None,
    limits: Mapping[str, Any] | None = None,
    privacy: Mapping[str, Any] | None = None,
    dom: Mapping[str, Any] | None = None,
    events: Iterable[str] | None = None,
    dropped: int = 0,
) -> dict[str, Any]:
    """Build the manifest of a trace.

    Args:
        mode: What the recorder captured
        started_at: ISO timestamp of the first event
        stopped_at: ISO timestamp of the last event
        outcome: One of :class:`TraceOutcome`
        commander_version: Version of the library that recorded the run
        engine: Engine the run drove
        browser: Browser name and version
        platform: Operating system the run happened on
        runtime: Language runtime that recorded the run
        counts: Members written, by kind
        limits: Size ceilings the recorder applied
        privacy: Redaction settings the recorder applied
        dom: DOM capture settings the recorder applied
        events: Event families the recorder subscribed to
        dropped: Number of records that could not be written

    Returns:
        The manifest as it is written to disk
    """
    return {
        "schemaVersion": TRACE_SCHEMA_VERSION,
        "format": TRACE_FORMAT,
        "mode": mode,
        "outcome": outcome,
        "startedAt": started_at,
        "stoppedAt": stopped_at,
        "commanderVersion": commander_version,
        "engine": engine,
        "browser": browser,
        "platform": platform
        if platform is not None
        else f"{sys.platform} {platform_module.machine()}",
        "runtime": runtime
        if runtime is not None
        else f"python {platform_module.python_version()}",
        "events": list(events or []),
        "dom": dict(dom or {}),
        "privacy": dict(privacy or {}),
        "limits": dict(limits or {}),
        "counts": {
            "checkpoints": 0,
            "events": 0,
            "mutationBatches": 0,
            **dict(counts or {}),
        },
        "dropped": dropped,
    }


def assert_readable_manifest(manifest: Any) -> None:
    """Check that a manifest can be read by this version of the format.

    Args:
        manifest: Parsed manifest

    Raises:
        ValueError: When the bundle is not a trace this reader understands
    """
    if not isinstance(manifest, dict) or manifest.get("format") != TRACE_FORMAT:
        msg = "not a Browser Commander trace bundle"
        raise ValueError(msg)

    version = manifest.get("schemaVersion", 0)
    if isinstance(version, (int, float)) and version > TRACE_SCHEMA_VERSION:
        msg = (
            f"trace schema version {version} is newer than this reader "
            f"({TRACE_SCHEMA_VERSION})"
        )
        raise ValueError(msg)
