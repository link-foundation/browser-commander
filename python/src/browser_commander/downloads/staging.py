"""Waiting for a staged download to actually be on disk (issue #92).

``Browser.downloadProgress`` with ``state: "completed"`` is the browser saying
it has stopped downloading, not the filesystem saying the bytes are there under
the name we are about to open. Chromium writes into ``<guid>.crdownload`` and
renames it, and the event can reach us before that rename is visible - which is
how a completed download became ``FileNotFoundError`` on
``<root>/.browser-commander-staging/<guid>``.

This module turns "the browser said completed" into "the file is readable and
has stopped growing", within a bounded budget. Running out of that budget is an
explicit failure, never a silent success: issue #88's rule that "a download UI
entry is not completion evidence" is exactly the rule being applied one level
lower down.
"""

from __future__ import annotations

import asyncio
import os
import time
from collections.abc import Sequence
from pathlib import Path
from typing import NamedTuple

#: How long to wait for a completed download's bytes to appear, by default.
DEFAULT_STAGING_TIMEOUT = 10.0

#: How often the staged file is looked at while waiting.
DEFAULT_STAGING_POLL_INTERVAL = 0.025

#: Suffixes Chromium uses for a file it is still writing.
STAGING_IN_PROGRESS_SUFFIXES = (".crdownload", ".partial")


class StagedFile(NamedTuple):
    """What the wait for a staged download ended with."""

    #: Whether the file is readable and has stopped growing.
    ready: bool
    #: Size in bytes, when it is ready.
    bytes: int | None
    #: What the last reading saw, when it is not.
    reason: str | None


class _Reading(NamedTuple):
    """One look at a staged file."""

    size: int | None
    reason: str | None


def _observe(file_path: str, suffixes: Sequence[str]) -> _Reading:
    """Look at a staged file once.

    Args:
        file_path: Path the engine staged the download under
        suffixes: Suffixes that mark a file still being written

    Returns:
        The size, or the reason this is not a finished file yet
    """
    for suffix in suffixes:
        if Path(f"{file_path}{suffix}").exists():
            return _Reading(None, f"a {suffix} file is still being written")

    try:
        # Opening rather than stat'ing is deliberate: "readable" is the
        # property ``save_download`` needs, and a name that resolves is not the
        # same thing as a file this process is allowed to read.
        with Path(file_path).open("rb") as handle:
            return _Reading(os.fstat(handle.fileno()).st_size, None)
    except FileNotFoundError:
        return _Reading(None, "the file has not appeared yet")
    except OSError as error:
        return _Reading(None, f"the file could not be opened: {error}")


async def wait_for_staged_file(
    *,
    path: str,
    timeout: float = DEFAULT_STAGING_TIMEOUT,
    interval: float = DEFAULT_STAGING_POLL_INTERVAL,
    in_progress_suffixes: Sequence[str] = STAGING_IN_PROGRESS_SUFFIXES,
) -> StagedFile:
    """Wait until a staged download is readable and has stopped growing.

    Stability is decided by two consecutive readings of the same size, the same
    evidence :class:`~browser_commander.downloads.watcher.DirectoryWatcher`
    uses: a file that merely exists is not evidence that its last byte was
    written.

    Args:
        path: Path the engine staged the download under
        timeout: Total budget in seconds
        interval: Seconds between readings
        in_progress_suffixes: Suffixes of a file still being written

    Returns:
        Whether the bytes are there, and what was seen when they are not
    """
    # Monotonic on purpose: a wall-clock jump must not turn a ten second budget
    # into a ten minute one.
    deadline = time.monotonic() + timeout
    previous_size: int | None = None
    reason = "the file has not appeared yet"

    while True:
        seen = await asyncio.get_running_loop().run_in_executor(
            None, _observe, path, in_progress_suffixes
        )
        if seen.reason is not None:
            reason = seen.reason
            # A file that vanished has to prove itself stable again.
            previous_size = None
        elif seen.size == previous_size:
            return StagedFile(ready=True, bytes=seen.size, reason=None)
        else:
            previous_size = seen.size
            reason = f"the file was still growing at {seen.size} bytes"

        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return StagedFile(ready=False, bytes=None, reason=reason)
        await asyncio.sleep(min(interval, remaining))


def describe_staging_timeout(*, path: str, timeout: float, reason: str) -> str:
    """The failure text a staged download that never materialized is reported under.

    Args:
        path: Path the engine staged the download under
        timeout: Budget that was exhausted, in seconds
        reason: What the last reading saw

    Returns:
        Message kept verbatim on the artifact
    """
    return (
        "the browser reported the download as completed, but "
        f"{path} was not readable within {timeout}s: {reason}"
    )
