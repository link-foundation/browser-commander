"""Keep a run's trace only when the run failed (issue #108).

JavaScript decides this in its test runner (``js/src/tests/tracing.js``):
``trace: 'retain-on-failure'`` records every attempt, and a passing attempt's
bundle is removed when it stops. Python has no runner of its own, so the same
decision is offered as an async context manager that a pytest fixture, or any
script, wraps around the work it wants explained::

    async with traced(commander, output="artifacts/login.bc-trace"):
        await commander.goto("https://example.com/login")

The settings use the JavaScript runner's vocabulary - which is Playwright's -
and a kept bundle gets the offline viewer written next to it.
"""

from __future__ import annotations

import contextlib
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

from browser_commander.traces.recorder import TraceRecorder, start_trace
from browser_commander.traces.schema import TraceMode
from browser_commander.traces.viewer import write_trace_viewer

#: Trace settings a run may ask for, in Playwright's vocabulary.
TEST_TRACE_MODES = ("off", "on", "retain-on-failure", "on-first-retry")

#: Screenshot settings a run may ask for.
TEST_SCREENSHOT_MODES = ("off", "on", "only-on-failure")

#: Suffix that marks a trace bundle directory.
TRACE_BUNDLE_SUFFIX = ".bc-trace"


def normalize_test_trace(trace: bool | str | None = None) -> str:
    """Read a run's ``trace`` setting.

    Args:
        trace: ``True``, ``False``, ``None`` or one of :data:`TEST_TRACE_MODES`

    Returns:
        One of :data:`TEST_TRACE_MODES`

    Raises:
        ValueError: For a setting it does not know
    """
    if trace is None or trace is False:
        return "off"
    if trace is True:
        return "on"
    if trace not in TEST_TRACE_MODES:
        raise ValueError(f"trace must be one of {', '.join(TEST_TRACE_MODES)}")
    return trace


def normalize_test_screenshots(screenshots: bool | str | None = None) -> str:
    """Read a run's ``screenshots`` setting.

    Args:
        screenshots: ``True``, ``False``, ``None`` or one of
            :data:`TEST_SCREENSHOT_MODES`

    Returns:
        One of :data:`TEST_SCREENSHOT_MODES`

    Raises:
        ValueError: For a setting it does not know
    """
    if screenshots is None:
        return "only-on-failure"
    if screenshots is True:
        return "on"
    if screenshots is False:
        return "off"
    if screenshots not in TEST_SCREENSHOT_MODES:
        raise ValueError(
            f"screenshots must be one of {', '.join(TEST_SCREENSHOT_MODES)}"
        )
    return screenshots


def resolve_trace_setting(trace: str, attempt: int = 1) -> dict[str, Any] | None:
    """Decide whether this attempt records, and in which recorder mode.

    Args:
        trace: A value from :func:`normalize_test_trace`
        attempt: 1 for the first run, 2 for the first retry

    Returns:
        ``{"recorder_mode", "retain_on_failure"}``, or ``None`` when this
        attempt does not record
    """
    if trace == "off":
        return None
    if trace == "on-first-retry" and attempt < 2:
        return None
    return {
        "recorder_mode": TraceMode.CONTINUOUS
        if trace == "on"
        else TraceMode.RETAIN_ON_FAILURE,
        "retain_on_failure": trace != "on",
    }


def _recorder_screenshots(screenshots: str) -> bool | str:
    if screenshots == "on":
        return True
    if screenshots == "off":
        return False
    return "only-on-failure"


def trace_output_path(
    artifacts_dir: str | Path, safe_name: str, attempt: int = 1
) -> str:
    """Where one attempt's trace bundle lives.

    Args:
        artifacts_dir: The run's artifact directory
        safe_name: A file-system-safe name for the run
        attempt: 1 for the first run, 2 for the first retry

    Returns:
        The bundle directory
    """
    suffix = f".attempt-{attempt}" if attempt > 1 else ""
    return str(
        Path(artifacts_dir, f"{safe_name}{suffix}{TRACE_BUNDLE_SUFFIX}").resolve()
    )


async def start_scenario_trace(
    commander: Any = None,
    *,
    output: str | Path,
    trace: bool | str | None = "retain-on-failure",
    screenshots: bool | str | None = None,
    attempt: int = 1,
    page: Any = None,
    **trace_options: Any,
) -> dict[str, Any] | None:
    """Start a trace for one attempt.

    Args:
        commander: The commander to record
        output: The bundle directory
        trace: One of :data:`TEST_TRACE_MODES`, ``True`` or ``False``
        screenshots: One of :data:`TEST_SCREENSHOT_MODES`, ``True`` or ``False``
        attempt: 1 for the first run, 2 for the first retry
        page: The page to record, when there is no commander
        **trace_options: Further :func:`~browser_commander.traces.start_trace`
            options, which take precedence

    Returns:
        ``{"trace", "path", "retain_on_failure"}``, or ``None`` when this
        attempt does not record
    """
    setting = resolve_trace_setting(normalize_test_trace(trace), attempt)
    if setting is None:
        return None
    options: dict[str, Any] = {
        "output": str(output),
        "mode": setting["recorder_mode"],
        "screenshots": _recorder_screenshots(normalize_test_screenshots(screenshots)),
        # A run that fails halfway is exactly where ordered DOM mutations pay
        # for themselves, so they are on whenever a run is recorded.
        "dom": {"mutations": True},
    }
    options.update(trace_options)
    running = await start_trace(commander, page=page, **options)
    return {
        "trace": running,
        "path": running.path,
        "retain_on_failure": setting["retain_on_failure"],
    }


async def finish_scenario_trace(
    started: dict[str, Any] | None, error: BaseException | None = None
) -> dict[str, Any] | None:
    """Stop an attempt's trace, keeping it only when it is worth keeping.

    Args:
        started: What :func:`start_scenario_trace` returned
        error: The failure that ended the attempt, if it failed

    Returns:
        The stopped trace, or ``None`` when nothing was recorded
    """
    if started is None:
        return None
    recorder: TraceRecorder = started["trace"]
    reason = "failure" if error is not None else "final"
    try:
        await recorder.checkpoint(reason, actor="runner", reason=reason)
    except Exception as checkpoint_error:
        recorder.note(f"could not capture the final checkpoint: {checkpoint_error}")

    discard = bool(started["retain_on_failure"]) and error is None
    stopped = await recorder.stop(discard=discard, error=error)
    if not discard:
        try:
            write_trace_viewer(stopped["path"])
        except Exception as viewer_error:
            recorder.note(f"could not write the viewer: {viewer_error}")
    return stopped


@contextlib.asynccontextmanager
async def traced(
    commander: Any = None,
    *,
    output: str | Path,
    trace: bool | str | None = "retain-on-failure",
    screenshots: bool | str | None = None,
    attempt: int = 1,
    page: Any = None,
    **trace_options: Any,
) -> AsyncIterator[TraceRecorder | None]:
    """Record the block, keeping the trace as the ``trace`` setting asks.

    With the default ``retain-on-failure`` a block that raises leaves a bundle
    (ending in a ``failure`` checkpoint, with the error recorded and the
    offline viewer written) and a block that returns leaves nothing. The
    exception is never swallowed.

    Args:
        commander: The commander to record
        output: The bundle directory
        trace: One of :data:`TEST_TRACE_MODES`, ``True`` or ``False``
        screenshots: One of :data:`TEST_SCREENSHOT_MODES`, ``True`` or ``False``
        attempt: 1 for the first run, 2 for the first retry
        page: The page to record, when there is no commander
        **trace_options: Further :func:`~browser_commander.traces.start_trace`
            options

    Yields:
        The running recorder, or ``None`` when this attempt does not record
    """
    started = await start_scenario_trace(
        commander,
        output=output,
        trace=trace,
        screenshots=screenshots,
        attempt=attempt,
        page=page,
        **trace_options,
    )
    try:
        yield started["trace"] if started else None
    except BaseException as error:
        await finish_scenario_trace(started, error)
        raise
    await finish_scenario_trace(started)
