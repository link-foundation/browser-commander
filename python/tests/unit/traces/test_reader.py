"""Unit tests for reading a trace bundle from Python (issue #87).

The bundles here are written by hand, byte for byte as the JavaScript recorder
writes them, so a change on either side that breaks the agreement fails here.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from browser_commander.traces.reader import (
    ControlChange,
    diff_control_state,
    parse_ndjson,
    read_trace,
)
from browser_commander.traces.schema import (
    TraceCheckpointReason,
    TraceEvent,
    TraceFiles,
    TraceLiveState,
    TraceMode,
    TraceMutationKind,
    TraceOutcome,
    create_manifest,
)


def ndjson(records: list[dict[str, Any]]) -> str:
    """Render records the way the recorder appends them.

    Args:
        records: Records to render

    Returns:
        One JSON object per line, with a trailing newline
    """
    return "".join(f"{json.dumps(record)}\n" for record in records)


def write_bundle(root: Path, *, close: bool = True) -> Path:
    """Write a small bundle the tests can read back.

    Args:
        root: Directory to write the bundle into
        close: Whether the run reached ``stop()``; a bundle that was not closed
            has no manifest, exactly like a run that was killed

    Returns:
        The bundle directory
    """
    (root / TraceFiles.CHECKPOINTS_DIR).mkdir(parents=True, exist_ok=True)
    (root / TraceFiles.MUTATIONS_DIR).mkdir(parents=True, exist_ok=True)

    (root / TraceFiles.CHECKPOINTS_DIR / "0001.html").write_text(
        "<html><body>one</body></html>", encoding="utf-8"
    )
    (root / TraceFiles.CHECKPOINTS_DIR / "0001.state.json").write_text(
        json.dumps(
            {
                "url": "https://example.com/one",
                "controls": [{"path": "input", "value": "before"}],
            }
        ),
        encoding="utf-8",
    )
    (root / TraceFiles.MUTATIONS_DIR / "0001.ndjson").write_text(
        ndjson([{"records": [{"type": "childList"}]}]), encoding="utf-8"
    )
    (root / TraceFiles.EVENTS).write_text(
        ndjson(
            [
                {
                    "kind": TraceEvent.TRACE_START,
                    "sequence": 1,
                    "at": "2026-01-01T00:00:00.000Z",
                    "mode": TraceMode.CHECKPOINTS,
                    "engine": "playwright",
                    "events": ["console"],
                },
                {
                    "kind": TraceEvent.CHECKPOINT,
                    "sequence": 2,
                    "at": "2026-01-01T00:00:01.000Z",
                    "index": 1,
                    "name": "start",
                    "actor": "automation",
                    "reason": "checkpoint",
                    "url": "https://example.com/one",
                    "members": {
                        "html": "checkpoints/0001.html",
                        "state": "checkpoints/0001.state.json",
                    },
                },
            ]
        ),
        encoding="utf-8",
    )

    if close:
        (root / TraceFiles.MANIFEST).write_text(
            json.dumps(
                create_manifest(
                    mode=TraceMode.CHECKPOINTS,
                    engine="playwright",
                    counts={"checkpoints": 1, "events": 2, "mutationBatches": 1},
                )
            ),
            encoding="utf-8",
        )

    return root


class TestParseNdjson:
    """A timeline is readable up to the first line that is not."""

    def test_keeps_everything_before_a_half_written_line(self) -> None:
        parsed = parse_ndjson('{"a":1}\n{"b":2}\n{"c":')

        assert parsed.records == [{"a": 1}, {"b": 2}]
        assert parsed.truncated is True

    def test_reads_an_empty_body_as_an_empty_timeline(self) -> None:
        parsed = parse_ndjson(None)

        assert parsed.records == []
        assert parsed.truncated is False


class TestReadTrace:
    """A bundle answers the same questions in Python as in JavaScript."""

    def test_reads_the_manifest_timeline_and_checkpoint_members(
        self, tmp_path: Path
    ) -> None:
        trace = read_trace(write_bundle(tmp_path / "run"))

        assert trace.manifest["outcome"] == TraceOutcome.COMPLETE
        assert len(trace.checkpoints) == 1
        assert trace.checkpoints[0].name == "start"
        assert trace.checkpoints[0].members["html"] == "checkpoints/0001.html"
        assert "one" in trace.html(1)
        assert trace.state(1)["url"] == "https://example.com/one"
        assert len(trace.mutations(1)) == 1
        assert trace.truncated is False

    def test_returns_nothing_for_a_checkpoint_member_that_was_dropped(
        self, tmp_path: Path
    ) -> None:
        trace = read_trace(write_bundle(tmp_path / "run"))

        assert trace.html(2) is None
        assert trace.state(2) is None
        assert trace.screenshot(1) is None
        assert trace.mutations(2) == []

    def test_rebuilds_a_manifest_for_a_run_that_never_stopped(
        self, tmp_path: Path
    ) -> None:
        trace = read_trace(write_bundle(tmp_path / "run", close=False))

        assert trace.manifest["outcome"] == TraceOutcome.TRUNCATED
        assert trace.manifest["engine"] == "playwright"
        assert trace.manifest["counts"]["checkpoints"] == 1
        assert trace.truncated is True
        assert "one" in trace.html(1)

    def test_reads_a_timeline_whose_last_line_was_cut_off(self, tmp_path: Path) -> None:
        root = write_bundle(tmp_path / "run", close=False)
        with (root / TraceFiles.EVENTS).open("a", encoding="utf-8") as events:
            events.write('{"kind":"console","text":"half')

        trace = read_trace(root)

        assert trace.truncated is True
        assert len(trace.events) == 2

    def test_refuses_a_directory_that_holds_no_trace(self, tmp_path: Path) -> None:
        with pytest.raises(FileNotFoundError, match="no trace bundle at"):
            read_trace(tmp_path / "nothing-here")

    def test_refuses_a_manifest_that_is_not_readable_json(self, tmp_path: Path) -> None:
        root = write_bundle(tmp_path / "run")
        (root / TraceFiles.MANIFEST).write_text("not json", encoding="utf-8")

        with pytest.raises(ValueError, match="is not readable JSON"):
            read_trace(root)

    def test_refuses_a_bundle_written_by_a_newer_format(self, tmp_path: Path) -> None:
        root = write_bundle(tmp_path / "run")
        (root / TraceFiles.MANIFEST).write_text(
            json.dumps({"format": "browser-commander-trace", "schemaVersion": 99}),
            encoding="utf-8",
        )

        with pytest.raises(ValueError, match="newer than this reader"):
            read_trace(root)

    def test_refuses_a_directory_that_holds_something_else(
        self, tmp_path: Path
    ) -> None:
        root = write_bundle(tmp_path / "run")
        (root / TraceFiles.MANIFEST).write_text(
            json.dumps({"format": "something-else"}), encoding="utf-8"
        )

        with pytest.raises(ValueError, match="not a Browser Commander trace bundle"):
            read_trace(root)


class TestDiffControlState:
    """What a step changed, without reading two HTML files side by side."""

    def test_reports_what_a_step_changed_added_and_removed(self) -> None:
        changes = diff_control_state(
            {
                "controls": [
                    {"path": "input#name", "value": "before"},
                    {"path": "input#gone", "value": "x"},
                    {"path": "input#same", "value": "stable"},
                ]
            },
            {
                "controls": [
                    {"path": "input#name", "value": "after"},
                    {"path": "input#same", "value": "stable"},
                    {"path": "input#new", "value": "fresh"},
                ]
            },
        )

        assert changes == [
            ControlChange(
                path="input#name", change="changed", before="before", after="after"
            ),
            ControlChange(path="input#new", change="added", after="fresh"),
            ControlChange(path="input#gone", change="removed", before="x"),
        ]

    def test_reports_a_checkbox_by_what_it_is_checked_to(self) -> None:
        changes = diff_control_state(
            {"controls": [{"path": "input", "checked": False, "value": "on"}]},
            {"controls": [{"path": "input", "checked": True, "value": "on"}]},
        )

        assert changes == [
            ControlChange(path="input", change="changed", before=False, after=True)
        ]

    def test_reads_a_missing_state_as_no_controls_at_all(self) -> None:
        assert diff_control_state(None, None) == []


def write_continuous_bundle(root: Path) -> Path:
    """Write a bundle holding the records schema 2 added (issue #93).

    The records are the ones ``page-capture.js`` builds in the page: a
    ``live-state`` entry for a control nothing in the DOM reflects, a
    ``childList`` entry carrying where each node went, and owner identifiers on
    every timeline record. A reader that only understood schema 1 would return
    them as unlabelled dictionaries, so this asserts what a caller can actually
    get at.

    Args:
        root: Directory to write the bundle into

    Returns:
        The bundle directory
    """
    (root / TraceFiles.CHECKPOINTS_DIR).mkdir(parents=True, exist_ok=True)
    (root / TraceFiles.MUTATIONS_DIR).mkdir(parents=True, exist_ok=True)

    (root / TraceFiles.CHECKPOINTS_DIR / "0001.html").write_text(
        "<html><body><ul id='list'><li>b</li></ul></body></html>", encoding="utf-8"
    )
    (root / TraceFiles.CHECKPOINTS_DIR / "0001.state.json").write_text(
        json.dumps({"url": "https://example.com/app", "controls": []}),
        encoding="utf-8",
    )
    (root / TraceFiles.MUTATIONS_DIR / "0001.ndjson").write_text(
        ndjson(
            [
                {
                    "sequence": 1,
                    "at": 1,
                    "url": "https://example.com/app",
                    "frameId": "frame-1",
                    "mainFrame": True,
                    "records": [
                        {
                            "kind": TraceMutationKind.CHILD_LIST,
                            "target": {"path": "ul#list"},
                            "added": [{"path": "ul#list > li", "index": 0}],
                            "removed": [],
                            "previous": None,
                            "next": {"path": "ul#list > li"},
                        }
                    ],
                },
                {
                    "sequence": 2,
                    "at": 2,
                    "url": "https://example.com/app",
                    "frameId": "frame-2",
                    "mainFrame": False,
                    "records": [
                        {
                            "kind": TraceMutationKind.LIVE_STATE,
                            "property": TraceLiveState.VALUE,
                            "target": {"path": "input#name"},
                            "before": "",
                            "after": "ada",
                        }
                    ],
                },
            ]
        ),
        encoding="utf-8",
    )
    (root / TraceFiles.EVENTS).write_text(
        ndjson(
            [
                {
                    "kind": TraceEvent.TRACE_START,
                    "sequence": 1,
                    "at": "2026-01-01T00:00:00.000Z",
                    "mode": TraceMode.CONTINUOUS,
                    "engine": "playwright",
                    "events": ["navigation"],
                    "traceId": "trace-1",
                    "browserContextId": "context-1",
                    "pageId": "page-1",
                    "navigationId": "nav-1",
                },
                {
                    "kind": TraceEvent.CHECKPOINT,
                    "sequence": 2,
                    "at": "2026-01-01T00:00:01.000Z",
                    "index": 1,
                    "name": "initial",
                    "actor": "automation",
                    "reason": TraceCheckpointReason.INITIAL,
                    "url": "https://example.com/app",
                    "traceId": "trace-1",
                    "browserContextId": "context-1",
                    "pageId": "page-1",
                    "navigationId": "nav-1",
                    "members": {
                        "html": "checkpoints/0001.html",
                        "state": "checkpoints/0001.state.json",
                    },
                },
            ]
        ),
        encoding="utf-8",
    )
    (root / TraceFiles.MANIFEST).write_text(
        json.dumps(
            create_manifest(
                mode=TraceMode.CONTINUOUS,
                engine="playwright",
                replay={
                    "mutations": True,
                    "childListPositions": True,
                    "liveState": True,
                    "identifiers": True,
                },
                counts={"checkpoints": 1, "events": 2, "mutationBatches": 2},
            )
        ),
        encoding="utf-8",
    )

    return root


class TestReadsSchemaTwo:
    """What the recorder gained in issue #93 survives the trip to Python."""

    def test_reads_a_child_list_record_with_the_position_a_node_went_to(
        self, tmp_path: Path
    ) -> None:
        trace = read_trace(write_continuous_bundle(tmp_path / "run"))

        batches = trace.mutations(1)
        assert len(batches) == 2
        child_list = batches[0]["records"][0]
        assert child_list["kind"] == TraceMutationKind.CHILD_LIST
        # Appending would put the new item after the existing one; index 0 is
        # the difference between replaying the insertion and guessing at it.
        assert child_list["added"][0]["index"] == 0
        assert child_list["next"]["path"] == "ul#list > li"

    def test_reads_a_live_state_record_no_mutation_would_report(
        self, tmp_path: Path
    ) -> None:
        trace = read_trace(write_continuous_bundle(tmp_path / "run"))

        live = trace.mutations(1)[1]["records"][0]
        assert live["kind"] == TraceMutationKind.LIVE_STATE
        assert live["property"] == TraceLiveState.VALUE
        assert (live["before"], live["after"]) == ("", "ada")

    def test_keeps_the_frame_each_batch_came_from(self, tmp_path: Path) -> None:
        trace = read_trace(write_continuous_bundle(tmp_path / "run"))

        frames = [batch["frameId"] for batch in trace.mutations(1)]
        assert frames == ["frame-1", "frame-2"]

    def test_keeps_the_owner_identifiers_on_every_record(self, tmp_path: Path) -> None:
        trace = read_trace(write_continuous_bundle(tmp_path / "run"))

        for event in trace.events:
            assert event["traceId"] == "trace-1"
            assert event["browserContextId"] == "context-1"
            assert event["pageId"] == "page-1"
            assert event["navigationId"] == "nav-1"

    def test_reports_what_the_bundle_can_replay_rather_than_assuming(
        self, tmp_path: Path
    ) -> None:
        trace = read_trace(write_continuous_bundle(tmp_path / "run"))

        assert trace.manifest["replay"] == {
            "checkpoints": True,
            "mutations": True,
            "childListPositions": True,
            "liveState": True,
            "identifiers": True,
        }
        assert trace.checkpoints[0].reason == TraceCheckpointReason.INITIAL
