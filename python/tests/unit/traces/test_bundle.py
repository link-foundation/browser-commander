"""Tests for the trace bundle writer (issue #108).

A port of ``js/tests/unit/traces/bundle.test.js``.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path
from typing import Any

import pytest

from browser_commander.traces import (
    TraceDroppedError,
    TraceDropReason,
    TraceEvent,
    TraceFiles,
    TraceMode,
    TraceOutcome,
    create_manifest,
    open_trace_bundle,
    write_trace_links,
)
from browser_commander.traces.bundle import TRACE_FILE_MODE, TraceBundle


def _open(tmp_path: Path, **options: Any) -> TraceBundle:
    return open_trace_bundle(tmp_path / "run", **options)


def _members(root: str) -> list[str]:
    base = Path(root)
    return sorted(path.relative_to(base).as_posix() for path in base.rglob("*"))


def _timeline(root: str) -> list[dict[str, Any]]:
    text = Path(root, TraceFiles.EVENTS).read_text(encoding="utf-8")
    return [json.loads(line) for line in text.split("\n") if line]


def _first_drop(root: str) -> dict[str, Any] | None:
    return next(
        (e for e in _timeline(root) if e["kind"] == TraceEvent.DROPPED),
        None,
    )


@pytest.mark.parametrize("output", [None, "", 42])
def test_refuses_to_open_without_an_output_path(output: Any) -> None:
    with pytest.raises(ValueError, match="trace output must be a path"):
        open_trace_bundle(output)


def test_aborts_an_unfinished_bundle_without_writing_a_manifest(
    tmp_path: Path,
) -> None:
    bundle = _open(tmp_path)
    bundle.append_event({"kind": TraceEvent.CHECKPOINT})

    bundle.abort()
    bundle.abort()

    assert not Path(bundle.root, TraceFiles.MANIFEST).exists()


def test_writes_the_layout_the_format_documents(tmp_path: Path) -> None:
    bundle = _open(tmp_path)

    bundle.write_checkpoint(
        1,
        html="<html></html>",
        state={"url": "https://example.com"},
        screenshot=b"png",
    )
    bundle.write_mutations(1, [{"records": []}])
    bundle.write_artifact("report body", ".txt")
    bundle.close(create_manifest(mode=TraceMode.CHECKPOINTS))

    digest = hashlib.sha256(b"report body").hexdigest()
    assert _members(bundle.root) == [
        "artifacts",
        f"artifacts/{digest}.txt",
        "checkpoints",
        "checkpoints/0001.html",
        "checkpoints/0001.png",
        "checkpoints/0001.state.json",
        "events.ndjson",
        "manifest.json",
        "mutations",
        "mutations/0001.ndjson",
    ]


def test_numbers_events_and_stamps_them_with_both_clocks(tmp_path: Path) -> None:
    ticks = iter([5.4, 7.6])
    bundle = _open(
        tmp_path, now=lambda: 1_767_225_600_000, monotonic=lambda: next(ticks)
    )

    first = bundle.append_event({"kind": TraceEvent.CHECKPOINT})
    second = bundle.append_event({"kind": TraceEvent.CONSOLE})
    bundle.abort()

    assert first is not None and second is not None
    assert (first["sequence"], second["sequence"]) == (1, 2)
    assert first["at"] == "2026-01-01T00:00:00.000Z"
    assert (first["monotonicMs"], second["monotonicMs"]) == (5, 8)
    assert list(first)[:3] == ["sequence", "at", "monotonicMs"]


@pytest.mark.skipif(sys.platform == "win32", reason="POSIX permissions")
def test_keeps_a_trace_readable_for_its_owner_only(tmp_path: Path) -> None:
    bundle = _open(tmp_path)
    bundle.append_event({"kind": TraceEvent.CHECKPOINT})
    bundle.write_checkpoint(1, html="<html></html>")
    bundle.close(create_manifest(mode=TraceMode.CHECKPOINTS))

    for member in (TraceFiles.MANIFEST, TraceFiles.EVENTS, "checkpoints/0001.html"):
        assert Path(bundle.root, member).stat().st_mode & 0o777 == TRACE_FILE_MODE
    assert Path(bundle.root).stat().st_mode & 0o777 == 0o700


def test_opens_every_member_in_binary_mode(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Windows writes "\n" as "\r\n" through a descriptor opened without
    # O_BINARY, so a bundle recorded there differed from every other
    # recorder's. The flag is 0 elsewhere; a stand-in bit shows it is passed.
    binary = 1 << 30
    real_open = os.open
    opened: dict[str, int] = {}

    def recording_open(path: Any, flags: int, *args: Any) -> int:
        opened[Path(path).name] = flags
        return real_open(path, flags & ~binary, *args)

    monkeypatch.setattr(os, "O_BINARY", binary, raising=False)
    monkeypatch.setattr(os, "open", recording_open)
    bundle = _open(tmp_path)
    bundle.append_event({"kind": TraceEvent.CHECKPOINT})
    bundle.write_checkpoint(1, html="<html>\n</html>")
    bundle.close(create_manifest(mode=TraceMode.CHECKPOINTS))
    write_trace_links(bundle.root, tmp_path / "run.lino")

    assert set(opened) >= {
        TraceFiles.EVENTS,
        TraceFiles.MANIFEST,
        "0001.html",
        "run.lino",
    }
    assert all(flags & binary for flags in opened.values()), opened


def test_stores_one_resource_once(tmp_path: Path) -> None:
    bundle = _open(tmp_path)

    first = bundle.write_artifact("same bytes", ".txt")
    second = bundle.write_artifact("same bytes", ".txt")
    bundle.abort()

    assert first is not None and second is not None
    assert first["member"] == second["member"]
    assert first["deduplicated"] is False
    assert second["deduplicated"] is True
    assert len(list(Path(bundle.root, TraceFiles.ARTIFACTS_DIR).iterdir())) == 1


def test_drops_a_member_over_the_per_resource_limit_and_says_so(
    tmp_path: Path,
) -> None:
    bundle = _open(tmp_path, limits={"maxResourceBytes": 16})

    result = bundle.write_member("checkpoints/0001.html", "x" * 64)
    bundle.close(create_manifest(mode=TraceMode.CHECKPOINTS))

    assert result is None
    assert bundle.dropped == 1
    dropped = _first_drop(bundle.root)
    assert dropped is not None
    assert dropped["reason"] == TraceDropReason.SIZE_LIMIT
    assert dropped["member"] == "checkpoints/0001.html"
    assert dropped["detail"] == "64 bytes"


def test_accepts_snake_case_limits(tmp_path: Path) -> None:
    bundle = _open(tmp_path, limits={"max_resource_bytes": 16})

    assert bundle.write_member("checkpoints/0001.html", "x" * 64) is None
    bundle.abort()


def test_reports_a_partial_trace_once_anything_was_dropped(tmp_path: Path) -> None:
    bundle = _open(tmp_path, limits={"maxResourceBytes": 4})

    bundle.write_member("checkpoints/0001.html", "over the limit")
    manifest = bundle.close(create_manifest(mode=TraceMode.CHECKPOINTS))

    assert manifest["outcome"] == TraceOutcome.PARTIAL
    assert manifest["dropped"] == 1
    on_disk = json.loads(Path(bundle.root, TraceFiles.MANIFEST).read_text("utf-8"))
    assert on_disk == manifest


def test_raises_the_first_problem_in_strict_mode(tmp_path: Path) -> None:
    bundle = _open(tmp_path, strict=True, limits={"maxResourceBytes": 4})

    with pytest.raises(TraceDroppedError, match="dropped: size-limit"):
        bundle.write_member("checkpoints/0001.html", "over the limit")
    bundle.abort()


def test_records_a_write_it_could_not_perform(tmp_path: Path) -> None:
    bundle = _open(tmp_path)
    # A member whose parent is a file, not a directory, cannot be written.
    bundle.write_member("blocked", "i am a file")

    result = bundle.write_member("blocked/0001.html", "content")
    bundle.abort()

    assert result is None
    assert bundle.problems[0]["reason"] == TraceDropReason.WRITE_FAILED


def test_writes_nothing_for_an_empty_batch_of_mutations(tmp_path: Path) -> None:
    bundle = _open(tmp_path)

    assert bundle.write_mutations(1, []) is None
    assert bundle.write_mutations(1, None) is None  # type: ignore[arg-type]
    assert bundle.counts["mutationBatches"] == 0
    bundle.abort()


def test_counts_what_it_wrote_in_the_manifest(tmp_path: Path) -> None:
    bundle = _open(tmp_path)

    bundle.write_checkpoint(1, html="<html></html>")
    bundle.write_mutations(1, [{"records": [1]}, {"records": [2]}])
    manifest = bundle.close(create_manifest(mode=TraceMode.CONTINUOUS))

    assert manifest["counts"]["checkpoints"] == 1
    assert manifest["counts"]["mutationBatches"] == 2
    assert manifest["outcome"] == TraceOutcome.COMPLETE


def test_records_a_dropped_member_even_under_a_tiny_resource_limit(
    tmp_path: Path,
) -> None:
    # The record of a gap must not be the next thing that falls through it.
    bundle = _open(tmp_path, limits={"maxResourceBytes": 16})

    bundle.write_member("checkpoints/0001.html", "x" * 64)
    bundle.abort()

    dropped = _first_drop(bundle.root)
    assert dropped is not None
    assert dropped["reason"] == TraceDropReason.SIZE_LIMIT


def test_writes_the_timeline_in_the_order_the_events_happened(
    tmp_path: Path,
) -> None:
    bundle = _open(tmp_path)

    for index in range(50):
        bundle.append_event({"kind": TraceEvent.CONSOLE, "index": index})
    bundle.abort()

    written = _timeline(bundle.root)
    assert [event["index"] for event in written] == list(range(50))
    assert [event["sequence"] for event in written] == list(range(1, 51))


def test_stops_appending_once_the_bundle_limit_is_reached(tmp_path: Path) -> None:
    bundle = _open(tmp_path, limits={"maxBundleBytes": 220})

    accepted = sum(
        1
        for index in range(20)
        if bundle.append_event({"kind": TraceEvent.CONSOLE, "index": index})
    )
    bundle.abort()

    assert 0 < accepted < 20
    assert bundle.bytes_written <= 220


def test_reports_a_failing_side_export_without_losing_the_event(
    tmp_path: Path,
) -> None:
    def explode(_event: dict[str, Any]) -> None:
        raise OSError("disk full")

    bundle = _open(tmp_path, on_event=explode)

    written = bundle.append_event({"kind": TraceEvent.CONSOLE})
    bundle.abort()

    assert written is not None
    assert bundle.dropped == 0
    assert bundle.problems == [
        {"reason": "write-failed", "member": "links", "detail": "disk full"}
    ]
