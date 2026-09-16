"""A download source for engines with no download events (issue #88).

Selenium's CDP bridge is request/response only: it can tell Chromium where to
put downloads, but it has no event stream to hear about them on. Watching the
staging directory is what gives Selenium the same managed lifecycle - including
downloads a person started by hand, because ``Browser.setDownloadBehavior`` is
browser-wide.
"""

from __future__ import annotations

import asyncio
import contextlib
from pathlib import Path
from typing import Any, Callable

from browser_commander.downloads.destination import ARTIFACT_DIRECTORY_MODE
from browser_commander.downloads.sources import STAGING_DIRECTORY, SourceHandle
from browser_commander.downloads.store import DownloadSource

#: How often the staging directory is listed.
DEFAULT_POLL_INTERVAL = 0.25

#: Suffixes Chromium uses while a file is still being written.
IN_PROGRESS_SUFFIXES = (".crdownload", ".tmp", ".partial")


def _set_download_behavior(driver: Any, staging_directory: str) -> None:
    """Point a Selenium-driven Chromium at the staging directory.

    Args:
        driver: Selenium WebDriver
        staging_directory: Where Chromium should write downloads
    """
    driver.execute_cdp_cmd(
        "Browser.setDownloadBehavior",
        {"behavior": "allow", "downloadPath": staging_directory},
    )


class DirectoryWatcher:
    """Report files that appear in a staging directory and stop growing.

    A file is only reported once its size has stopped changing: Chromium
    renames ``report.pdf.crdownload`` to ``report.pdf`` when it is done, but a
    file that merely exists is not evidence that its last byte was written.
    """

    def __init__(self, *, directory: str, sink: Any) -> None:
        """Start watching a directory.

        Args:
            directory: Staging directory to watch
            sink: Object with ``started``/``finished``/``failed``/``track``
        """
        self._directory = directory
        self._sink = sink
        self._sizes: dict[str, int] = {}
        self._reported: set[str] = set()

        # Files that were already there belong to an earlier session; claiming
        # them would report downloads this manager never saw.
        for name in self._candidates():
            self._reported.add(name)

    def _candidates(self) -> list[str]:
        """List the files that could be finished downloads.

        Returns:
            File names, in a stable order
        """
        try:
            entries = sorted(Path(self._directory).iterdir())
        except OSError:
            return []

        return [
            entry.name
            for entry in entries
            if entry.is_file()
            and not entry.name.startswith(".")
            and not entry.name.endswith(IN_PROGRESS_SUFFIXES)
        ]

    def poll_once(self) -> list[str]:
        """Report every download that has finished since the last poll.

        Returns:
            Names reported by this poll
        """
        reported = []
        for name in self._candidates():
            if name in self._reported:
                continue

            path = Path(self._directory, name)
            try:
                size = path.stat().st_size
            except OSError:
                continue

            # The first sighting only records the size; a file is claimed on
            # the poll that finds it unchanged.
            if self._sizes.get(name) != size:
                self._sizes[name] = size
                continue

            self._reported.add(name)
            self._sizes.pop(name, None)
            record = self._sink.started(
                engine_handle=str(path),
                url=path.as_uri(),
                suggested_filename=name,
            )
            self._sink.track(
                self._sink.finished(
                    record, DownloadSource(path=str(path), remove_source=True)
                )
            )
            reported.append(name)
        return reported


async def attach_filesystem_watcher(
    *,
    root: str,
    sink: Any,
    driver: Any = None,
    set_behavior: Callable[[str], None] | None = None,
    interval: float = DEFAULT_POLL_INTERVAL,
) -> SourceHandle:
    """Send downloads to a staging directory and watch it for finished files.

    Args:
        root: Managed download directory
        sink: Object with ``started``/``finished``/``failed``/``track``
        driver: Selenium WebDriver used to configure download behavior
        set_behavior: Override for the CDP call, used by tests
        interval: Seconds between directory listings

    Returns:
        A handle that stops the watcher
    """
    staging_directory = str(Path(root, STAGING_DIRECTORY))
    Path(staging_directory).mkdir(
        parents=True, exist_ok=True, mode=ARTIFACT_DIRECTORY_MODE
    )

    configure = set_behavior or (
        (lambda directory: _set_download_behavior(driver, directory))
        if driver is not None
        else None
    )
    if configure is not None:
        configure(staging_directory)

    watcher = DirectoryWatcher(directory=staging_directory, sink=sink)

    async def loop() -> None:
        while True:
            await asyncio.sleep(interval)
            watcher.poll_once()

    task = asyncio.ensure_future(loop())

    async def detach() -> None:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
        # One last look: a download that finished between the final poll and
        # this call is still the caller's file.
        watcher.poll_once()

    return SourceHandle(
        detach=detach, staging_directory=staging_directory, watcher=watcher
    )
