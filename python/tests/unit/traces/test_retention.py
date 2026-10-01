"""Tests for keeping a trace only when the run failed (issue #108).

A port of the retain-on-failure half of ``js/tests/unit/tests/tracing.test.js``
for Python, which has no test runner of its own and offers ``traced()``.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from browser_commander.traces import (
    TraceEvent,
    TraceMode,
    TraceOutcome,
    TraceRecorder,
    finish_scenario_trace,
    normalize_test_screenshots,
    normalize_test_trace,
    read_trace,
    resolve_trace_setting,
    start_scenario_trace,
    trace_output_path,
    traced,
)
from tests.helpers.trace_fakes import ActionCommander, FakePage, make_snapshot


def commander() -> ActionCommander:
    return ActionCommander(FakePage(make_snapshot()))


class TestSettings:
    def test_reads_the_runner_vocabulary(self) -> None:
        assert normalize_test_trace() == "off"
        assert normalize_test_trace(False) == "off"
        assert normalize_test_trace(True) == "on"
        assert normalize_test_trace("on-first-retry") == "on-first-retry"
        with pytest.raises(ValueError, match="trace must be one of"):
            normalize_test_trace("sometimes")

        assert normalize_test_screenshots() == "only-on-failure"
        assert normalize_test_screenshots(True) == "on"
        assert normalize_test_screenshots(False) == "off"
        with pytest.raises(ValueError, match="screenshots must be one of"):
            normalize_test_screenshots("always")

    def test_decides_which_attempts_record(self) -> None:
        assert resolve_trace_setting("off") is None
        assert resolve_trace_setting("on-first-retry", 1) is None
        assert resolve_trace_setting("on-first-retry", 2) == {
            "recorder_mode": TraceMode.RETAIN_ON_FAILURE,
            "retain_on_failure": True,
        }
        assert resolve_trace_setting("on") == {
            "recorder_mode": TraceMode.CONTINUOUS,
            "retain_on_failure": False,
        }

    def test_names_a_bundle_per_attempt(self, tmp_path: Path) -> None:
        assert trace_output_path(tmp_path, "login") == str(
            (tmp_path / "login.bc-trace").resolve()
        )
        assert trace_output_path(tmp_path, "login", 2) == str(
            (tmp_path / "login.attempt-2.bc-trace").resolve()
        )


class TestTraced:
    async def test_leaves_nothing_behind_a_run_that_passed(
        self, tmp_path: Path
    ) -> None:
        output = tmp_path / "passed.bc-trace"
        async with traced(commander(), output=output) as trace:
            assert isinstance(trace, TraceRecorder)
            await trace.checkpoint("halfway")

        assert not output.exists()

    async def test_keeps_and_explains_a_run_that_failed(self, tmp_path: Path) -> None:
        output = tmp_path / "failed.bc-trace"
        with pytest.raises(RuntimeError, match="the button never appeared"):
            async with traced(commander(), output=output, screenshots="off"):
                raise RuntimeError("the button never appeared")

        reader = read_trace(output)
        assert reader.manifest["mode"] == TraceMode.RETAIN_ON_FAILURE
        assert reader.manifest["outcome"] == TraceOutcome.COMPLETE
        assert reader.checkpoints[-1].name == "failure"
        fatal = [
            event
            for event in reader.events
            if event["kind"] == TraceEvent.PAGE_ERROR and event.get("fatal")
        ]
        assert fatal[0]["message"] == "the button never appeared"
        assert (output / "viewer.html").is_file()

    async def test_keeps_every_run_when_told_to_trace_on(self, tmp_path: Path) -> None:
        output = tmp_path / "on.bc-trace"
        async with traced(commander(), output=output, trace="on"):
            pass

        reader = read_trace(output)
        assert reader.manifest["mode"] == TraceMode.CONTINUOUS
        assert reader.checkpoints[-1].name == "final"
        assert (output / "viewer.html").is_file()

    async def test_records_nothing_on_an_attempt_it_skips(self, tmp_path: Path) -> None:
        output = tmp_path / "first.bc-trace"
        async with traced(
            commander(), output=output, trace="on-first-retry", attempt=1
        ) as trace:
            assert trace is None

        assert not output.exists()
        assert await finish_scenario_trace(None) is None

    async def test_lets_recorder_options_through(self, tmp_path: Path) -> None:
        started = await start_scenario_trace(
            commander(), output=tmp_path / "run", trace=True, mode=TraceMode.CHECKPOINTS
        )
        assert started is not None
        stopped = await finish_scenario_trace(started)

        assert stopped is not None
        assert stopped["manifest"]["mode"] == TraceMode.CHECKPOINTS
