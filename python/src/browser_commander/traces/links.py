"""A Links Notation view of a trace bundle (issue #108).

A port of ``js/src/traces/links.js``. The JSON bundle stays authoritative: this
is an adapter over what the reader already produces, not a second recorder.
The export is line oriented - one link per line - so ``grep``, ``diff`` and
``head`` work on a trace the way they work on a log, and a run that was killed
still leaves every line it had finished writing.

Links are formatted here exactly as ``links-notation`` 0.20 formats them in
JavaScript, so an export written by Python is byte-for-byte the export the
JavaScript recorder writes for the same bundle.
"""

from __future__ import annotations

import contextlib
import json
import os
from collections.abc import Iterable, Mapping
from pathlib import Path
from typing import Any

from .bundle import open_private_file
from .jsonfmt import UNDEFINED, coalesce, dumps, is_missing, js_entries, js_truthy
from .reader import Trace, read_trace
from .schema import TraceEvent

#: Version of this representation, independent of the bundle's schema.
TRACE_LINKS_VERSION = 1

#: File name used when an output path names a directory.
TRACE_LINKS_FILE = "trace.lino"

#: Sections a caller can include, in the order they are written.
TRACE_LINKS_SECTIONS = ("trace", "timeline", "checkpoints", "control-diffs")


class TraceLinkIds:
    """Ids of the links this module writes."""

    TRACE = "trace"
    TIMELINE = "timeline"
    CHECKPOINT = "checkpoint"
    CONTROL_DIFF = "control-diff"
    RESULT = "result"


class TraceLinkOutcome:
    """What an event's ``outcome`` field can say."""

    RECORDED = "recorded"
    OK = "ok"
    FAILED = "failed"
    PARTIAL = "partial"
    DROPPED = "dropped"


#: Who caused an event, when the event does not say so itself.
_IMPLIED_ACTOR = {
    TraceEvent.TRACE_START: "recorder",
    TraceEvent.TRACE_STOP: "recorder",
    TraceEvent.MUTATIONS: "recorder",
    TraceEvent.DROPPED: "recorder",
    TraceEvent.INTERACTION: "automation",
    TraceEvent.CHECKPOINT: "automation",
    TraceEvent.NAVIGATION: "browser",
    TraceEvent.CONSOLE: "browser",
    TraceEvent.PAGE_ERROR: "browser",
    TraceEvent.DIALOG: "browser",
    TraceEvent.REQUEST_FAILED: "browser",
    TraceEvent.DOWNLOAD: "browser",
}

#: Fields the head of a timeline link already accounts for.
_HEAD_FIELDS = frozenset(
    {
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
    }
)

_DECODED = {"\\": "\\", "n": "\n", "r": "\r", "t": "\t", "u0022": '"'}


class Link:
    """One link: an id and its values, as ``links-notation`` models it."""

    __slots__ = ("id", "values")

    def __init__(self, id: str | None = None, values: list[Link] | None = None):
        self.id = id
        self.values = list(values or [])

    def __repr__(self) -> str:
        return f"Link({self.format()!r})"

    def __eq__(self, other: object) -> bool:
        return (
            isinstance(other, Link)
            and self.id == other.id
            and self.values == other.values
        )

    def __hash__(self) -> int:
        return hash((self.id, tuple(self.values)))

    def format(self) -> str:
        """Format the link the way ``formatLinks([link])`` does."""
        if self.id is None and not self.values:
            return "()"
        if not self.values:
            return f"({escape_reference(self.id)})"
        values = " ".join(_format_value(value) for value in self.values)
        if self.id is None:
            return f"({values})"
        return f"({escape_reference(self.id)}: {values})"


def _format_value(value: Link) -> str:
    if not value.values:
        return escape_reference(value.id)
    return value.format()


def escape_reference(reference: str | None) -> str:
    """Quote a reference the way ``links-notation`` 0.20 does.

    Args:
        reference: Link id or value

    Returns:
        The reference as it is written
    """
    if reference is None:
        return ""
    if reference == "":
        return '""'
    has_single = "'" in reference
    has_double = '"' in reference
    needs_quoting = (
        reference.startswith("#")
        or any(char in reference for char in ":() \t\n\r")
        or has_single
        or has_double
    )
    if has_single and has_double:
        escaped = reference.replace("'", "\\'")
        return f"'{escaped}'"
    if has_double:
        return f"'{reference}'"
    if has_single:
        return f'"{reference}"'
    if needs_quoting:
        return f"'{reference}'"
    return reference


def encode_link_text(value: Any) -> str:
    """Make one value safe to write as a link.

    Newlines would split one record across lines, and a value holding both
    quote characters cannot be read back, so both are encoded reversibly.

    Args:
        value: Any scalar from a trace record

    Returns:
        Text that survives a format and parse round trip
    """
    text = value if isinstance(value, str) else dumps(value)
    escaped = (
        text.replace("\\", "\\\\")
        .replace("\n", "\\n")
        .replace("\r", "\\r")
        .replace("\t", "\\t")
    )
    if "'" in escaped and '"' in escaped:
        return escaped.replace('"', "\\u0022")
    return escaped


def decode_link_text(text: str) -> str:
    """Read back what :func:`encode_link_text` wrote.

    Args:
        text: A value parsed out of an exported link

    Returns:
        The original text
    """
    out: list[str] = []
    index = 0
    text = str(text)
    while index < len(text):
        char = text[index]
        if char == "\\":
            if text.startswith("u0022", index + 1):
                out.append('"')
                index += 6
                continue
            following = text[index + 1 : index + 2]
            if following in _DECODED:
                out.append(_DECODED[following])
                index += 2
                continue
        out.append(char)
        index += 1
    return "".join(out)


def _leaf(value: Any) -> Link:
    return Link(encode_link_text(value))


def _field(name: str, value: Any) -> Link | None:
    if is_missing(value):
        return None
    return Link(name, [_leaf(value)])


def _get(record: Mapping[str, Any] | None, name: str) -> Any:
    if not isinstance(record, Mapping):
        return UNDEFINED
    return record.get(name, UNDEFINED)


def _links(*values: Link | None) -> list[Link]:
    return [value for value in values if value is not None]


def _outcome_of(event: Mapping[str, Any]) -> str:
    if event.get("kind") == TraceEvent.DROPPED:
        return TraceLinkOutcome.DROPPED
    if (
        event.get("ok", UNDEFINED) is False
        or js_truthy(event.get("error"))
        or js_truthy(event.get("failure"))
    ):
        return TraceLinkOutcome.FAILED
    if event.get("truncated") is True:
        return TraceLinkOutcome.PARTIAL
    if event.get("ok") is True:
        return TraceLinkOutcome.OK
    return TraceLinkOutcome.RECORDED


def timeline_link(event: Mapping[str, Any]) -> Link:
    """Turn one timeline event into one ``(timeline: ...)`` link.

    Args:
        event: An event as written to ``events.ndjson``

    Returns:
        The link
    """
    values = _links(
        _field("sequence", _get(event, "sequence")),
        _field("at", _get(event, "at")),
        _field("monotonicMs", _get(event, "monotonicMs")),
        _field("kind", _get(event, "kind")),
        _field("trace", _get(event, "traceId")),
        _field("context", _get(event, "browserContextId")),
        _field("page", _get(event, "pageId")),
        _field("navigation", _get(event, "navigationId")),
        _field("frame", _get(event, "frameId")),
        _field(
            "actor",
            coalesce(_get(event, "actor"), _IMPLIED_ACTOR.get(str(event.get("kind")))),
        ),
        _field("action", coalesce(_get(event, "action"), _get(event, "phase"))),
        _field(
            "target",
            coalesce(_get(event, "target"), _get(event, "url"), _get(event, "member")),
        ),
        _field("outcome", _outcome_of(event)),
    )
    # Whatever else the event carried is kept under its own name, so a kind
    # this module has never heard of still exports everything it holds.
    for name, value in js_entries(event):
        if name in _HEAD_FIELDS or is_missing(value) or callable(value):
            continue
        if name == "members":
            # The checkpoint link says where the members are.
            continue
        values.append(Link(name, [_leaf(value)]))
    return Link(TraceLinkIds.TIMELINE, values)


def checkpoint_link(event: Mapping[str, Any]) -> Link:
    """Turn one checkpoint event into a link that points at its members.

    Args:
        event: The checkpoint event from the timeline

    Returns:
        The ``(checkpoint: ...)`` link
    """
    members = coalesce(_get(event, "members"), {})
    return Link(
        TraceLinkIds.CHECKPOINT,
        _links(
            _field("index", _get(event, "index")),
            _field("sequence", _get(event, "sequence")),
            _field("at", _get(event, "at")),
            _field("name", _get(event, "name")),
            _field("actor", _get(event, "actor")),
            _field("reason", _get(event, "reason")),
            _field("page", _get(event, "pageId")),
            _field("navigation", _get(event, "navigationId")),
            _field("url", _get(event, "url")),
            _field("outcome", _outcome_of(event)),
            _field("html", _get(members, "html")),
            _field("state", _get(members, "state")),
            _field("screenshot", _get(members, "screenshot")),
        ),
    )


def control_diff_link(change: Mapping[str, Any], context: Mapping[str, Any]) -> Link:
    """Turn one control change into one ``(control-diff: ...)`` link.

    Args:
        change: A record from :func:`js_diff_control_state`
        context: ``{checkpoint, previous, actor}``

    Returns:
        The link
    """
    return Link(
        TraceLinkIds.CONTROL_DIFF,
        _links(
            _field("checkpoint", _get(context, "checkpoint")),
            _field("previous", _get(context, "previous")),
            _field("path", _get(change, "path")),
            _field("change", _get(change, "change")),
            _field("before", _get(change, "before")),
            _field("after", _get(change, "after")),
            _field("actor", _get(context, "actor")),
        ),
    )


def trace_header_link(about: Mapping[str, Any]) -> Link:
    """The link that opens an export.

    Args:
        about: ``{bundle, schemaVersion, mode, engine, startedAt, commanderVersion}``

    Returns:
        The ``(trace: ...)`` link
    """
    return Link(
        TraceLinkIds.TRACE,
        _links(
            _field("format", "browser-commander-trace"),
            _field("links", TRACE_LINKS_VERSION),
            _field("schema", _get(about, "schemaVersion")),
            _field("bundle", _get(about, "bundle")),
            _field("mode", _get(about, "mode")),
            _field("engine", _get(about, "engine")),
            _field("started", _get(about, "startedAt")),
            _field("commander", _get(about, "commanderVersion")),
        ),
    )


def trace_result_link(
    manifest: Mapping[str, Any] | None, truncated: bool = False
) -> Link:
    """The link that closes an export.

    Args:
        manifest: The bundle's manifest
        truncated: Whether the reader judged the bundle incomplete

    Returns:
        The ``(result: ...)`` link
    """
    counts = coalesce(_get(manifest, "counts"), {})
    replay_support = coalesce(_get(manifest, "replay"), {})
    replay = [
        _leaf(name)
        for name, supported in js_entries(replay_support)
        if js_truthy(supported)
    ]
    return Link(
        TraceLinkIds.RESULT,
        _links(
            _field("outcome", _get(manifest, "outcome")),
            _field("stopped", _get(manifest, "stoppedAt")),
            _field("events", _get(counts, "events")),
            _field("checkpoints", _get(counts, "checkpoints")),
            _field("mutationBatches", _get(counts, "mutationBatches")),
            _field("dropped", _get(manifest, "dropped")),
            _field("truncated", truncated),
            Link("replay", replay) if replay else None,
        ),
    )


def format_trace_links(links: Iterable[Link]) -> str:
    """Format links as the lines of an export.

    Args:
        links: Links to write, in order

    Returns:
        One link per line, newline terminated
    """
    return "".join(f"{link.format()}\n" for link in links)


def chosen_sections(include: Any = None) -> set[str]:
    """Validate the sections a caller asked for.

    Args:
        include: Section names, or None for all of them

    Returns:
        The chosen sections

    Raises:
        TypeError: When ``include`` is not a list of known section names
    """
    if include is None or include is UNDEFINED:
        return set(TRACE_LINKS_SECTIONS)
    if not isinstance(include, (list, tuple)):
        raise TypeError("trace links include must be an array of section names")
    for name in include:
        if name not in TRACE_LINKS_SECTIONS:
            raise ValueError(
                f'unknown trace links section "{name}"; expected one of '
                f"{', '.join(TRACE_LINKS_SECTIONS)}"
            )
    return set(include)


def _links_for_event(event: Mapping[str, Any], sections: set[str]) -> list[Link]:
    links = []
    if "timeline" in sections:
        links.append(timeline_link(event))
    if event.get("kind") == TraceEvent.CHECKPOINT and "checkpoints" in sections:
        links.append(checkpoint_link(event))
    return links


def _strictly_differ(left: Any, right: Any) -> bool:
    """JavaScript's ``!==`` on two parsed JSON values."""
    if isinstance(left, (Mapping, list)) or isinstance(right, (Mapping, list)):
        return left is not right
    if isinstance(left, bool) or isinstance(right, bool):
        return type(left) is not type(right) or left != right
    if is_missing(left) or is_missing(right):
        return left is not right
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        return left != right
    return type(left) is not type(right) or left != right


def js_diff_control_state(before: Any, after: Any) -> list[dict[str, Any]]:
    """Diff two checkpoints' control state exactly as ``diffControlState`` does.

    The reader's :func:`~browser_commander.traces.reader.diff_control_state`
    answers the same question with dataclasses; this one keeps JavaScript's
    shape - a missing ``before`` or ``after`` is absent, not ``None`` - so
    exports and the viewer are byte-for-byte what JavaScript writes.

    Args:
        before: State of the earlier checkpoint
        after: State of the later checkpoint

    Returns:
        One record per changed control
    """
    index: dict[Any, Any] = {}
    for control in coalesce(_get(before, "controls"), []):
        # Like a Map, a later control with the same path replaces the
        # earlier one but keeps its place.
        index[_hashable(_get(control, "path"))] = control
    changes: list[dict[str, Any]] = []
    for control in coalesce(_get(after, "controls"), []):
        key = _hashable(_get(control, "path"))
        previous = index.pop(key, UNDEFINED)
        if not js_truthy(previous):
            changes.append(
                {
                    "path": _get(control, "path"),
                    "change": "added",
                    "after": _get(control, "value"),
                }
            )
            continue
        if _strictly_differ(
            _get(previous, "value"), _get(control, "value")
        ) or _strictly_differ(_get(previous, "checked"), _get(control, "checked")):
            before_checked = _get(previous, "checked")
            after_checked = _get(control, "checked")
            changes.append(
                {
                    "path": _get(control, "path"),
                    "change": "changed",
                    "before": _get(previous, "value")
                    if before_checked is UNDEFINED
                    else before_checked,
                    "after": _get(control, "value")
                    if after_checked is UNDEFINED
                    else after_checked,
                }
            )
    for control in index.values():
        changes.append(
            {
                "path": _get(control, "path"),
                "change": "removed",
                "before": _get(control, "value"),
            }
        )
    return changes


def _hashable(value: Any) -> Any:
    try:
        hash(value)
    except TypeError:
        return ("unhashable", id(value))
    if value is UNDEFINED:
        return ("undefined",)
    return value


def checkpoint_events(trace: Trace) -> list[dict[str, Any]]:
    """The checkpoints of a trace, shaped as the JavaScript reader shapes them.

    Args:
        trace: An open trace

    Returns:
        ``{index, name, actor, reason, url, at, sequence, members}`` per
        checkpoint, with absent fields left out
    """
    return [
        {
            "index": event.get("index", UNDEFINED),
            "name": event.get("name", UNDEFINED),
            "actor": event.get("actor", UNDEFINED),
            "reason": event.get("reason", UNDEFINED),
            "url": event.get("url", UNDEFINED),
            "at": event.get("at", UNDEFINED),
            "sequence": event.get("sequence", UNDEFINED),
            "members": coalesce(event.get("members", UNDEFINED), {}),
        }
        for event in trace.events
        if event.get("kind") == TraceEvent.CHECKPOINT
    ]


def _control_diff_links(trace: Trace) -> list[Link]:
    links: list[Link] = []
    previous: dict[str, Any] | None = None
    for checkpoint in checkpoint_events(trace):
        index = checkpoint["index"]
        state = trace.state(index)
        if previous and js_truthy(state):
            for change in js_diff_control_state(previous["state"], state):
                links.append(
                    control_diff_link(
                        change,
                        {
                            "checkpoint": index,
                            "previous": previous["index"],
                            "actor": checkpoint["actor"],
                        },
                    )
                )
        if js_truthy(state):
            previous = {"index": index, "state": state}
    return links


def _open(trace: Trace | str | os.PathLike[str]) -> Trace:
    if isinstance(trace, Trace):
        return trace
    return read_trace(trace)


def trace_links(
    trace: Trace | str | os.PathLike[str],
    include: Iterable[str] | None = None,
    dom: Any = None,
) -> list[Link]:
    """Build the links of a whole trace, in the order they are written.

    Args:
        trace: An open trace, or a path to a bundle
        include: Sections to write; all of them by default

    Returns:
        Every link of the export
    """
    opened = _open(trace)
    sections = chosen_sections(list(include) if include is not None else None)
    manifest = opened.manifest
    links: list[Link] = []
    if "trace" in sections:
        links.append(
            trace_header_link(
                {
                    "bundle": Path(opened.path).name,
                    "schemaVersion": _get(manifest, "schemaVersion"),
                    "mode": _get(manifest, "mode"),
                    "engine": _get(manifest, "engine"),
                    "startedAt": _get(manifest, "startedAt"),
                    "commanderVersion": _get(manifest, "commanderVersion"),
                }
            )
        )
    for event in opened.events:
        links.extend(_links_for_event(event, sections))
    links.extend(dom_links(opened, dom))
    if "control-diffs" in sections:
        links.extend(_control_diff_links(opened))
    if "trace" in sections:
        links.append(trace_result_link(manifest, truncated=opened.truncated))
    return links


def resolve_links_output(output: Any) -> str:
    """Resolve where an export should be written.

    Args:
        output: A file path, or a directory to write inside

    Returns:
        The file to write
    """
    if not isinstance(output, (str, os.PathLike)) or os.fspath(output) == "":
        raise ValueError("trace links output must be a path")
    # Like JavaScript's path.resolve: symbolic links are left as they are.
    resolved = os.path.abspath(os.fspath(output))  # noqa: PTH100
    if Path(resolved).is_dir():
        return str(Path(resolved, TRACE_LINKS_FILE))
    return resolved


def _write_text(handle: int, text: str) -> None:
    data = text.encode("utf-8", "surrogatepass")
    while data:
        written = os.write(handle, data)
        data = data[written:]


def write_trace_links(
    trace: Trace | str | os.PathLike[str],
    output: str | os.PathLike[str],
    include: Iterable[str] | None = None,
) -> str:
    """Write a trace as Links Notation.

    Args:
        trace: An open trace, or a path to a bundle
        output: Where to write; a directory receives ``trace.lino``
        include: Sections to write; all of them by default

    Returns:
        The file that was written
    """
    file = resolve_links_output(output)
    links = trace_links(trace, include)
    Path(file).parent.mkdir(parents=True, exist_ok=True)
    handle = open_private_file(file, os.O_WRONLY | os.O_CREAT | os.O_TRUNC)
    try:
        _write_text(handle, format_trace_links(links))
    finally:
        os.close(handle)
    return file


class TraceLinksSink:
    """Links written as a run happens. Create it with :func:`open_trace_links`.

    Every record that reached the bundle reaches this file too, so a trace that
    is killed still leaves a readable export. Control diffs are the one thing
    that cannot stream - a diff needs the next checkpoint - so they are
    appended from the finished bundle when the trace stops.
    """

    def __init__(
        self,
        output: str | os.PathLike[str],
        *,
        include: Iterable[str] | None = None,
        bundle_path: str | None = None,
        about: Mapping[str, Any] | None = None,
        dom: Any = None,
    ) -> None:
        self._dom, self._bundle_path = dom, bundle_path
        self._mutation_member: str | None = None
        self._mutation_offset = 0
        self.path = resolve_links_output(output)
        self._sections = chosen_sections(list(include) if include is not None else None)
        self.problems: list[dict[str, Any]] = []
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self._handle = open_private_file(
            self.path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC
        )
        self._closed = False
        if "trace" in self._sections:
            self._append(
                [
                    trace_header_link(
                        {
                            **dict(about or {}),
                            "bundle": Path(bundle_path or "").name,
                        }
                    )
                ]
            )

    def _append(self, links: list[Link]) -> None:
        if self._closed or not links:
            return
        try:
            _write_text(self._handle, format_trace_links(links))
        except OSError as error:
            # A failed export must not take the run down with it; the bundle
            # is the authoritative record and it is still being written.
            self.problems.append({"member": self.path, "detail": str(error)})

    def event(self, event: Mapping[str, Any] | None) -> None:
        """Write the links of one event as it is recorded."""
        if not event:
            return
        self._append(_links_for_event(event, self._sections))
        if (
            self._dom
            and self._bundle_path
            and event.get("kind") in {"checkpoint", "mutations"}
        ):
            from types import SimpleNamespace

            root = Path(self._bundle_path)
            batches = []
            if event.get("kind") == "mutations":
                member = str(root / event["member"])
                if member != self._mutation_member:
                    self._mutation_member, self._mutation_offset = member, 0
                with Path(member).open("rb") as source:
                    source.seek(self._mutation_offset)
                    body = source.read()
                    self._mutation_offset = source.tell()
                batches = [json.loads(line) for line in body.splitlines() if line]

            def read_member(name):
                member = event.get("members", {}).get(name)
                if not member:
                    return None
                body = (root / member).read_text()
                return json.loads(body) if name == "state" else body

            opened = SimpleNamespace(
                checkpoints=[SimpleNamespace(index=event["index"])]
                if event.get("kind") == "checkpoint"
                else [],
                events=[event] if event.get("kind") == "mutations" else [],
                state=lambda _index: read_member("state"),
                html=lambda _index: read_member("html"),
                mutations=lambda _index: batches,
            )
            self._append(dom_links(opened, self._dom))

    def close(
        self,
        manifest: Mapping[str, Any] | None = None,
        bundle_path: str | None = None,
    ) -> str:
        """Finish the export with the control diffs and the result link.

        Args:
            manifest: The manifest the bundle settled on
            bundle_path: The bundle to read the control diffs from

        Returns:
            The file that was written
        """
        if self._closed:
            return self.path
        links: list[Link] = []
        if "control-diffs" in self._sections and bundle_path:
            try:
                links.extend(_control_diff_links(read_trace(bundle_path)))
            except Exception as error:
                self.problems.append({"member": self.path, "detail": str(error)})
        if "trace" in self._sections:
            outcome = _get(manifest, "outcome")
            links.append(trace_result_link(manifest, truncated=outcome != "complete"))
        self._append(links)
        self._closed = True
        os.close(self._handle)
        return self.path

    def discard(self) -> None:
        """Remove the export, for a run whose bundle was discarded."""
        if not self._closed:
            self._closed = True
            os.close(self._handle)
        with contextlib.suppress(FileNotFoundError):
            Path(self.path).unlink()


def open_trace_links(
    output: str | os.PathLike[str],
    *,
    include: Iterable[str] | None = None,
    bundle_path: str | None = None,
    **about: Any,
) -> TraceLinksSink:
    """Open a sink that writes links as a run happens.

    Args:
        output: Where to write; a directory receives ``trace.lino``
        include: Sections to write; all of them by default
        bundle_path: The bundle the export describes
        **about: ``schemaVersion``, ``mode``, ``engine``, ``startedAt`` and
            ``commanderVersion`` for the header link

    Returns:
        The sink
    """
    return TraceLinksSink(
        output,
        include=include,
        bundle_path=bundle_path,
        about=about,
        dom=about.pop("dom", None),
    )


def dom_links(trace, dom, seen=None):
    def link(name, values):
        return Link(name, _links(*values))

    if not dom:
        return []
    seen = seen if seen is not None else set()
    links = []
    for checkpoint in trace.checkpoints:
        key: tuple[Any, ...] = ("checkpoint", checkpoint.index)
        if key in seen:
            continue
        seen.add(key)
        value = (
            (trace.state(checkpoint.index) or {}).get("text")
            if dom == "text"
            else trace.html(checkpoint.index)
        )
        links.append(
            link(
                "dom-text" if dom == "text" else "dom-snapshot",
                [
                    _field("checkpoint", checkpoint.index),
                    _field("text" if dom == "text" else "html", value),
                ],
            )
        )
    for event in trace.events:
        if event.get("kind") != "mutations":
            continue
        for batch in trace.mutations(event["checkpoint"]):
            key = (
                event.get("member"),
                batch.get("frameId"),
                batch.get("sequence"),
                batch.get("at"),
            )
            if key in seen:
                continue
            seen.add(key)
            for record in batch.get("records", []):
                if dom != "text":
                    links.append(
                        link(
                            "dom-mutation",
                            [
                                _field("at", batch.get("at")),
                                _field("record", dumps(record)),
                            ],
                        )
                    )
                    continue
                target = record.get("target", {})
                if target.get("visible") is False:
                    continue
                if record["kind"] in {"attributes", "characterData"}:
                    links.append(
                        link(
                            "attribute-changed"
                            if record["kind"] == "attributes"
                            else "text-changed",
                            [
                                _field("at", batch.get("at")),
                                _field("path", target.get("path", "")),
                                _field("attribute", record.get("attribute")),
                                _field("before", record.get("before")),
                                _field("after", record.get("after")),
                            ],
                        )
                    )
                if record["kind"] == "childList":
                    for change in ("added", "removed"):
                        for node in record.get(change, []):
                            if node.get("visible") is not False and node.get("text"):
                                links.append(
                                    link(
                                        "text-" + change,
                                        [
                                            _field("at", batch.get("at")),
                                            _field(
                                                "path",
                                                node.get(
                                                    "path", target.get("path", "")
                                                ),
                                            ),
                                            _field("text", node["text"]),
                                        ],
                                    )
                                )
    return links
