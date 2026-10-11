"""Writing a trace bundle to disk (issue #108).

A port of ``js/src/traces/bundle.js``. The bundle is a directory with the
documented layout, which ``zip -r`` turns into the archive form without
re-encoding anything.

Every write is best-effort by default: a trace exists to explain a run, so
failing to record something leaves a visible ``dropped`` event rather than
breaking the automation that was being recorded. With ``strict`` the first
drop raises :class:`TraceDroppedError` instead.

Writes are synchronous. Engine events arrive in listeners that cannot wait,
and a timeline whose lines reach the disk in a different order than the events
happened is not a timeline.
"""

from __future__ import annotations

import contextlib
import hashlib
import os
import time
from collections.abc import Mapping
from pathlib import Path
from typing import Any, Callable

from .jsonfmt import dumps, dumps_pretty, iso_timestamp, js_round, js_string
from .schema import TraceDropReason, TraceEvent, TraceFiles, TraceOutcome, sequence_name

#: Owner-only file mode: a trace may hold form values and page content.
TRACE_FILE_MODE = 0o600

#: Owner-only directory mode for the bundle root.
TRACE_DIRECTORY_MODE = 0o700

#: Default ceiling on a bundle, so a runaway page cannot fill a disk.
DEFAULT_MAX_BUNDLE_BYTES = 256 * 1024 * 1024

#: Default ceiling on any single member of a bundle.
DEFAULT_MAX_RESOURCE_BYTES = 32 * 1024 * 1024

#: How long a single capture may take before it is dropped.
DEFAULT_CAPTURE_TIMEOUT = 15000

_LIMIT_KEYS = {
    "max_bundle_bytes": "maxBundleBytes",
    "max_resource_bytes": "maxResourceBytes",
    "max_event_bytes": "maxEventBytes",
    "max_html_bytes": "maxHtmlBytes",
    "max_queued_mutations": "maxQueuedMutations",
    "max_mutation_bytes": "maxMutationBytes",
}


class TraceDroppedError(RuntimeError):
    """Raised by a strict trace when something could not be written."""


def normalize_limits(limits: Mapping[str, Any] | None) -> dict[str, Any]:
    """Accept snake_case limit names and spell them as the manifest does.

    Args:
        limits: Caller limits, such as ``{"max_queued_mutations": 100}``

    Returns:
        A copy with the documented camelCase names, in the caller's order
    """
    return {_LIMIT_KEYS.get(key, key): value for key, value in (limits or {}).items()}


def default_monotonic() -> float:
    """Milliseconds from a monotonic clock, as ``performance.now()`` gives."""
    return time.perf_counter() * 1000


def default_now() -> float:
    """Milliseconds since the Unix epoch, as ``Date.now()`` gives."""
    return time.time_ns() // 1_000_000


def make_directories(path: Path) -> None:
    """Create a directory and its missing parents, owner-only."""
    missing = []
    current = path
    while not current.exists():
        missing.append(current)
        if current.parent == current:
            break
        current = current.parent
    for directory in reversed(missing):
        with contextlib.suppress(FileExistsError):
            directory.mkdir(mode=TRACE_DIRECTORY_MODE)


def open_private_file(path: str | os.PathLike[str], flags: int) -> int:
    """Open a descriptor for a file readable by its owner only.

    Windows opens a descriptor in text mode unless told otherwise, and then
    writes every ``\n`` as ``\r\n``: a bundle would no longer be the bytes
    every other recorder writes.
    """
    return os.open(path, flags | getattr(os, "O_BINARY", 0), TRACE_FILE_MODE)


def write_private_file(path: Path, data: bytes, *, append: bool = False) -> None:
    """Write a file readable by its owner only."""
    descriptor = open_private_file(
        path, os.O_WRONLY | os.O_CREAT | (os.O_APPEND if append else os.O_TRUNC)
    )
    with os.fdopen(descriptor, "wb") as handle:
        handle.write(data)


def _limit(limits: Mapping[str, Any], name: str, default: Any) -> Any:
    value = limits.get(name)
    return default if value is None else value


def _bytes_of(contents: bytes | bytearray | str) -> bytes:
    if isinstance(contents, (bytes, bytearray)):
        return bytes(contents)
    return contents.encode("utf-8", "surrogatepass")


class TraceBundle:
    """A bundle open for writing. Create it with :func:`open_trace_bundle`."""

    def __init__(
        self,
        output: str | os.PathLike[str],
        *,
        strict: bool = False,
        limits: Mapping[str, Any] | None = None,
        now: Callable[[], float] | None = None,
        monotonic: Callable[[], float] | None = None,
        on_event: Callable[[dict[str, Any]], Any] | None = None,
        next_sequence: Callable[[], int] | None = None,
    ) -> None:
        if not isinstance(output, (str, os.PathLike)) or str(output) == "":
            raise ValueError("trace output must be a path")
        limits = normalize_limits(limits)
        # Like JavaScript's path.resolve: absolute and normalized, but with
        # symbolic links left as they are.
        self.root = os.path.abspath(os.fspath(output))  # noqa: PTH100
        self.strict = strict
        self._now = now or default_now
        self._monotonic = monotonic or default_monotonic
        self._on_event = on_event
        self._sequence_allocator = next_sequence
        self.max_bundle_bytes = _limit(
            limits, "maxBundleBytes", DEFAULT_MAX_BUNDLE_BYTES
        )
        self.max_resource_bytes = _limit(
            limits, "maxResourceBytes", DEFAULT_MAX_RESOURCE_BYTES
        )
        self.max_event_bytes = _limit(limits, "maxEventBytes", self.max_resource_bytes)
        self._max_mutation_bytes = min(
            _limit(limits, "maxMutationBytes", 4 * 1024 * 1024), self.max_resource_bytes
        )
        self._mutation_index: int | None = None
        self._mutation_bytes = 0
        self._mutation_truncated = False

        make_directories(Path(self.root))
        self._events = open_private_file(
            Path(self.root, TraceFiles.EVENTS), os.O_WRONLY | os.O_APPEND | os.O_CREAT
        )
        self._closed = False
        self._written = 0
        self._sequence = 0
        self._dropped = 0
        self._counts = {"checkpoints": 0, "events": 0, "mutationBatches": 0}
        self._problems: list[dict[str, Any]] = []

    @property
    def dropped(self) -> int:
        """How many records could not be written."""
        return self._dropped

    @property
    def bytes_written(self) -> int:
        """Bytes written so far, the manifest excluded."""
        return self._written

    def _fits(self, size: int) -> bool:
        return size <= self.max_resource_bytes and self._written + size <= (
            self.max_bundle_bytes
        )

    def _fits_event(self, size: int, retry: bool) -> bool:
        # A record of something that was dropped is the one write that must not
        # be dropped in turn, so it answers to the bundle budget alone.
        return self._written + size <= self.max_bundle_bytes and (
            not retry or size <= self.max_event_bytes
        )

    def drop(self, record: Mapping[str, Any]) -> None:
        """Record that something could not be written.

        Args:
            record: ``{reason, member, detail}``

        Raises:
            TraceDroppedError: When the trace is strict
        """
        record = dict(record)
        self._dropped += 1
        self.problems.append(record)
        if self.strict:
            member = record.get("member")
            detail = record.get("detail")
            suffix = f" ({js_string(detail)})" if detail else ""
            raise TraceDroppedError(
                f"trace {js_string(member if member is not None else 'record')} "
                f"dropped: {js_string(record.get('reason'))}{suffix}"
            )
        # The drop is itself an event, so a reader sees the gap in the timeline.
        self.append_event({"kind": TraceEvent.DROPPED, **record}, retry=False)

    def append_event(
        self, event: Mapping[str, Any], *, retry: bool = True
    ) -> dict[str, Any] | None:
        """Append one event to the timeline.

        Args:
            event: Event fields; ``sequence``, ``at`` and ``monotonicMs`` are added
            retry: Whether a failure is itself recorded as a drop

        Returns:
            The event as written, or None when it was dropped
        """
        self._sequence += 1
        record: dict[str, Any] = {
            "sequence": self._sequence,
            "at": iso_timestamp(self._now()),
            "monotonicMs": js_round(self._monotonic()),
        }
        record.update(event)
        if self._sequence_allocator is not None:
            record["sequence"] = self._sequence_allocator()
        line = (dumps(record) + "\n").encode("utf-8", "surrogatepass")
        size = len(line)

        if not self._fits_event(size, retry):
            if retry:
                self.drop(
                    {
                        "reason": TraceDropReason.SIZE_LIMIT,
                        "member": TraceFiles.EVENTS,
                        "detail": f"{size} bytes",
                    }
                )
            return None

        try:
            if self._closed:
                raise OSError("the timeline is already closed")
            os.write(self._events, line)
        except OSError as error:
            if retry:
                self.drop(
                    {
                        "reason": TraceDropReason.WRITE_FAILED,
                        "member": TraceFiles.EVENTS,
                        "detail": str(error),
                    }
                )
            return None

        self._written += size
        self.counts["events"] += 1
        if self._on_event is not None:
            try:
                self._on_event(record)
            except Exception as error:
                # A side export that fails is a gap in that export, not in the
                # bundle, so it is noted where a caller can still see it.
                self.problems.append(
                    {
                        "reason": TraceDropReason.WRITE_FAILED,
                        "member": "links",
                        "detail": str(error),
                    }
                )
        return record

    def write_member(
        self, member: str, contents: bytes | bytearray | str, *, append: bool = False
    ) -> dict[str, Any] | None:
        """Write one member of the bundle.

        Args:
            member: Path relative to the bundle root
            contents: What to write

        Returns:
            ``{member, bytes}``, or None when it was dropped
        """
        data = _bytes_of(contents)
        target = Path(self.root, member)
        previous = target.stat().st_size if append and target.exists() else 0
        if not self._fits(len(data)) or previous + len(data) > self.max_resource_bytes:
            self.drop(
                {
                    "reason": TraceDropReason.SIZE_LIMIT,
                    "member": member,
                    "detail": f"{len(data)} bytes",
                }
            )
            return None

        try:
            make_directories(target.parent)
            write_private_file(target, data, append=append)
        except OSError as error:
            self.drop(
                {
                    "reason": TraceDropReason.WRITE_FAILED,
                    "member": member,
                    "detail": str(error),
                }
            )
            return None
        self._written += len(data)
        return {"member": member, "bytes": len(data)}

    def write_checkpoint(
        self,
        index: int,
        html: Any = None,
        state: Mapping[str, Any] | None = None,
        screenshot: bytes | None = None,
    ) -> dict[str, str]:
        """Write a checkpoint's HTML, state and screenshot.

        Args:
            index: 1-based checkpoint number
            html: Serialized document, if one was captured
            state: Live state, if it was captured
            screenshot: PNG bytes, if a screenshot was taken

        Returns:
            What was written, by member name (``html``, ``state``, ``screenshot``)
        """
        name = sequence_name(index)
        members: dict[str, str] = {}
        if isinstance(html, str):
            result = self.write_member(
                f"{TraceFiles.CHECKPOINTS_DIR}/{name}.html", html
            )
            if result:
                members["html"] = result["member"]
        if state:
            result = self.write_member(
                f"{TraceFiles.CHECKPOINTS_DIR}/{name}.state.json", dumps_pretty(state)
            )
            if result:
                members["state"] = result["member"]
        if screenshot:
            result = self.write_member(
                f"{TraceFiles.CHECKPOINTS_DIR}/{name}.png", screenshot
            )
            if result:
                members["screenshot"] = result["member"]
        self.counts["checkpoints"] += 1
        return members

    @property
    def counts(self) -> dict[str, int]:
        return self._counts

    @property
    def problems(self) -> list[dict[str, Any]]:
        return self._problems

    @property
    def mutation_truncated(self) -> bool:
        return self._mutation_truncated

    def write_mutations(self, index: int, batches: list[Any]) -> str | None:
        """Write one checkpoint's mutation batches.

        Args:
            index: Checkpoint the batches follow
            batches: Ordered mutation batches

        Returns:
            The member name, or None when nothing was written
        """
        if not batches:
            return None
        if index != self._mutation_index:
            self._mutation_index = index
            self._mutation_bytes = 0
            self._mutation_truncated = False
        if self.mutation_truncated:
            return None
        member = f"{TraceFiles.MUTATIONS_DIR}/{sequence_name(index)}.ndjson"
        lines = []
        for batch in batches:
            line = dumps(batch) + "\n"
            if (
                self._mutation_bytes + len(line.encode()) + 256
                > self._max_mutation_bytes
            ):
                self._mutation_truncated = True
                marker = (
                    dumps(
                        {
                            "records": [
                                {
                                    "kind": "truncated",
                                    "reason": "mutation interval size limit",
                                }
                            ]
                        }
                    )
                    + "\n"
                )
                if (
                    self._mutation_bytes + len(marker.encode())
                    <= self._max_mutation_bytes
                ):
                    lines.append(marker)
                break
            self._mutation_bytes += len(line.encode())
            lines.append(line)
        if not lines:
            return None
        body = "".join(lines)
        result = self.write_member(member, body, append=True)
        if result:
            self.counts["mutationBatches"] += len(lines)
        return result["member"] if result else None

    def write_artifact(
        self, contents: bytes | str, extension: str = ""
    ) -> dict[str, Any] | None:
        """Store a resource by the hash of its contents.

        Args:
            contents: Resource bytes
            extension: Extension to keep, such as ``.png``

        Returns:
            ``{member, sha256, bytes, deduplicated}``, or None when dropped
        """
        data = _bytes_of(contents)
        sha256 = hashlib.sha256(data).hexdigest()
        member = f"{TraceFiles.ARTIFACTS_DIR}/{sha256}{extension}"
        if Path(self.root, member).exists():
            return {
                "member": member,
                "sha256": sha256,
                "bytes": len(data),
                "deduplicated": True,
            }
        result = self.write_member(member, data)
        if not result:
            return None
        return {**result, "sha256": sha256, "deduplicated": False}

    def abort(self) -> None:
        """Close an unfinished bundle without manufacturing a manifest."""
        if not self._closed:
            self._closed = True
            os.close(self._events)

    def close(self, manifest: Mapping[str, Any]) -> dict[str, Any]:
        """Write the manifest and close the timeline.

        Args:
            manifest: Manifest built by ``create_manifest``

        Returns:
            The manifest as written
        """
        finished = dict(manifest)
        finished["counts"] = dict(self.counts)
        finished["dropped"] = self._dropped
        if self._dropped > 0 and manifest.get("outcome") == TraceOutcome.COMPLETE:
            finished["outcome"] = TraceOutcome.PARTIAL
        else:
            finished["outcome"] = manifest.get("outcome")
        self.abort()
        write_private_file(
            Path(self.root, TraceFiles.MANIFEST),
            dumps_pretty(finished).encode("utf-8", "surrogatepass"),
        )
        return finished


def open_trace_bundle(
    output: str | os.PathLike[str],
    *,
    strict: bool = False,
    limits: Mapping[str, Any] | None = None,
    now: Callable[[], float] | None = None,
    monotonic: Callable[[], float] | None = None,
    on_event: Callable[[dict[str, Any]], Any] | None = None,
) -> TraceBundle:
    """Open a bundle for writing.

    Args:
        output: Bundle directory; created when missing
        strict: Raise on the first dropped record instead of noting it
        limits: ``maxBundleBytes``, ``maxResourceBytes`` and ``maxEventBytes``
            (snake_case spellings are accepted)
        now: Wall clock in epoch milliseconds
        monotonic: Monotonic clock in milliseconds
        on_event: Called with every event as it is written

    Returns:
        The bundle writer
    """
    if (limits or {}).get("rotate"):
        from .rolling_bundle import RollingBundle

        return RollingBundle(
            output,
            limits=normalize_limits(limits),
            strict=strict,
            now=now,
            monotonic=monotonic,
            on_event=on_event,
        )
    return TraceBundle(
        output,
        strict=strict,
        limits=limits,
        now=now,
        monotonic=monotonic,
        on_event=on_event,
    )
