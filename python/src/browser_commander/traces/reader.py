"""Reading a trace bundle from Python (issue #87).

The reader assumes nothing finished cleanly. A run that was killed leaves a
bundle with no manifest and a half-written last line; that bundle still holds
the evidence someone is looking for, so it is repaired on open rather than
rejected. This mirrors ``js/src/traces/reader.js`` member for member, so the
same bundle answers the same questions in either language.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from browser_commander.traces.schema import (
    TraceEvent,
    TraceFiles,
    TraceMode,
    TraceOutcome,
    assert_readable_manifest,
    create_manifest,
    sequence_name,
)


def _read_if_present(path: Path) -> str | None:
    """Read a bundle member, treating a missing one as absent rather than an error.

    Args:
        path: Member path

    Returns:
        The member's text, or ``None`` when it was never written
    """
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return None


@dataclass
class ParsedNdjson:
    """The records of an NDJSON member, and whether it was cut off."""

    records: list[dict[str, Any]] = field(default_factory=list)
    #: Whether a line could not be parsed, so later lines were not read.
    truncated: bool = False


@dataclass
class TraceCheckpoint:
    """One named moment the recorder captured."""

    index: int | None = None
    name: str | None = None
    actor: str | None = None
    reason: str | None = None
    url: str | None = None
    at: str | None = None
    sequence: int | None = None
    #: Bundle members written for this checkpoint, by kind.
    members: dict[str, Any] = field(default_factory=dict)


@dataclass
class ControlChange:
    """How one form control differs between two checkpoints."""

    path: str
    #: ``added``, ``changed`` or ``removed``.
    change: str
    before: Any = None
    after: Any = None


def parse_ndjson(body: str | None) -> ParsedNdjson:
    """Parse an NDJSON body, keeping everything before the first unreadable line.

    Args:
        body: Member contents

    Returns:
        The records that could be read, and whether reading stopped early
    """
    records: list[dict[str, Any]] = []

    for line in (body or "").split("\n"):
        if line.strip() == "":
            continue
        try:
            records.append(json.loads(line))
        except ValueError:
            # A process killed mid-write leaves one partial line. Everything
            # before it is still true, so the trace is readable up to there.
            return ParsedNdjson(records=records, truncated=True)

    return ParsedNdjson(records=records, truncated=False)


@dataclass
class Trace:
    """An opened trace bundle."""

    path: str
    manifest: dict[str, Any]
    events: list[dict[str, Any]]
    checkpoints: list[TraceCheckpoint]
    #: Whether records are known to be missing from the bundle.
    truncated: bool

    def html(self, index: int) -> str | None:
        """Read one checkpoint's HTML.

        Args:
            index: Checkpoint number

        Returns:
            The captured markup, or ``None`` when it was dropped
        """
        return _read_if_present(
            Path(self.path, TraceFiles.CHECKPOINTS_DIR, f"{sequence_name(index)}.html")
        )

    def state(self, index: int) -> dict[str, Any] | None:
        """Read one checkpoint's live control state.

        Args:
            index: Checkpoint number

        Returns:
            The captured state, or ``None`` when it was dropped
        """
        body = _read_if_present(
            Path(
                self.path,
                TraceFiles.CHECKPOINTS_DIR,
                f"{sequence_name(index)}.state.json",
            )
        )
        return None if body is None else json.loads(body)

    def screenshot(self, index: int) -> bytes | None:
        """Read one checkpoint's screenshot.

        Args:
            index: Checkpoint number

        Returns:
            The PNG bytes, or ``None`` when no screenshot was captured
        """
        path = Path(
            self.path, TraceFiles.CHECKPOINTS_DIR, f"{sequence_name(index)}.png"
        )
        try:
            return path.read_bytes()
        except FileNotFoundError:
            return None

    def mutations(self, index: int) -> list[dict[str, Any]]:
        """Read the mutation batches recorded after one checkpoint.

        Args:
            index: Checkpoint number

        Returns:
            Ordered batches, empty when none were recorded
        """
        body = _read_if_present(
            Path(self.path, TraceFiles.MUTATIONS_DIR, f"{sequence_name(index)}.ndjson")
        )
        return parse_ndjson(body).records


def _rebuild_manifest(events: list[dict[str, Any]]) -> dict[str, Any]:
    """Describe a run that never reached ``stop()``.

    The timeline is the record of what happened, so the manifest is rebuilt
    around it rather than the bundle being refused.

    Args:
        events: The timeline as it was read

    Returns:
        A manifest whose outcome says the bundle was never closed
    """
    started = next(
        (event for event in events if event.get("kind") == TraceEvent.TRACE_START),
        {},
    )

    return create_manifest(
        mode=started.get("mode", TraceMode.CHECKPOINTS),
        started_at=started.get("at"),
        stopped_at=events[-1].get("at") if events else None,
        outcome=TraceOutcome.TRUNCATED,
        engine=started.get("engine"),
        events=started.get("events", []),
        dom=started.get("dom", {}),
        counts={
            "events": len(events),
            "checkpoints": sum(
                1 for event in events if event.get("kind") == TraceEvent.CHECKPOINT
            ),
        },
    )


def read_trace(bundle_path: str | Path) -> Trace:
    """Open a trace bundle.

    Args:
        bundle_path: Path to the bundle directory

    Returns:
        The opened trace

    Raises:
        FileNotFoundError: When the directory holds no trace at all
        ValueError: When the manifest is unreadable or written by a newer format
    """
    root = Path(bundle_path).resolve()
    manifest_body = _read_if_present(root / TraceFiles.MANIFEST)
    events_body = _read_if_present(root / TraceFiles.EVENTS)

    if manifest_body is None and events_body is None:
        msg = f"no trace bundle at {root}"
        raise FileNotFoundError(msg)

    parsed = parse_ndjson(events_body)

    if manifest_body is None:
        manifest = _rebuild_manifest(parsed.records)
    else:
        try:
            manifest = json.loads(manifest_body)
        except ValueError:
            msg = f"{TraceFiles.MANIFEST} in {root} is not readable JSON"
            raise ValueError(msg) from None
        assert_readable_manifest(manifest)

    checkpoints = [
        TraceCheckpoint(
            index=event.get("index"),
            name=event.get("name"),
            actor=event.get("actor"),
            reason=event.get("reason"),
            url=event.get("url"),
            at=event.get("at"),
            sequence=event.get("sequence"),
            members=event.get("members") or {},
        )
        for event in parsed.records
        if event.get("kind") == TraceEvent.CHECKPOINT
    ]

    return Trace(
        path=str(root),
        manifest=manifest,
        events=parsed.records,
        checkpoints=checkpoints,
        truncated=parsed.truncated or manifest.get("outcome") != TraceOutcome.COMPLETE,
    )


def _control_value(control: dict[str, Any]) -> Any:
    """The value a change is reported in terms of.

    A checkbox changes by what it is checked to, not by the value it submits,
    so the reader reports the field the reviewer is actually looking at.

    Args:
        control: One captured control

    Returns:
        The control's checked state, or its value when it has none
    """
    checked = control.get("checked")
    return control.get("value") if checked is None else checked


def diff_control_state(
    before: dict[str, Any] | None, after: dict[str, Any] | None
) -> list[ControlChange]:
    """Diff two checkpoints' control state.

    ``before``/``after`` per control is the shape a reviewer needs to answer
    "what did this step change?" without reading two HTML files side by side.

    Args:
        before: State of the earlier checkpoint
        after: State of the later checkpoint

    Returns:
        One record per changed control
    """
    index = {
        control.get("path"): control for control in (before or {}).get("controls", [])
    }
    changes: list[ControlChange] = []

    for control in (after or {}).get("controls", []):
        previous = index.pop(control.get("path"), None)
        if previous is None:
            changes.append(
                ControlChange(
                    path=control.get("path"),
                    change="added",
                    after=control.get("value"),
                )
            )
            continue
        if previous.get("value") != control.get("value") or previous.get(
            "checked"
        ) != control.get("checked"):
            changes.append(
                ControlChange(
                    path=control.get("path"),
                    change="changed",
                    before=_control_value(previous),
                    after=_control_value(control),
                )
            )

    changes.extend(
        ControlChange(
            path=control.get("path"), change="removed", before=control.get("value")
        )
        for control in index.values()
    )

    return changes
