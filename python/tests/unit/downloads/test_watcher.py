"""Unit tests for the filesystem download source (issue #88)."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

from browser_commander.downloads.manager import DownloadManager
from browser_commander.downloads.sources import STAGING_DIRECTORY
from browser_commander.downloads.watcher import (
    DirectoryWatcher,
    attach_filesystem_watcher,
)


def staging_of(root: Path) -> Path:
    """Return the staging directory inside a download directory.

    Args:
        root: Managed download directory

    Returns:
        The staging directory
    """
    return root / STAGING_DIRECTORY


def watcher_for(directory: Path, manager: DownloadManager) -> DirectoryWatcher:
    """Create a watcher over a directory that exists.

    Args:
        directory: Staging directory to watch
        manager: Sink the watcher reports to

    Returns:
        A watcher
    """
    directory.mkdir(parents=True, exist_ok=True)
    return DirectoryWatcher(directory=str(directory), sink=manager)


def manager_for(root: Path) -> DownloadManager:
    """Create a manager writing into a directory.

    Args:
        root: Managed download directory

    Returns:
        A manager with no sources attached
    """
    root.mkdir(parents=True, exist_ok=True)
    return DownloadManager(directory=str(root))


class TestDirectoryWatcher:
    """A file that merely exists is not evidence a download finished."""

    def test_ignores_files_that_were_there_before_it_started(
        self, tmp_path: Path
    ) -> None:
        # They belong to an earlier session; claiming them would report
        # downloads this manager never saw.
        staging = staging_of(tmp_path)
        staging.mkdir(parents=True)
        (staging / "older.pdf").write_bytes(b"from last time")

        watcher = watcher_for(staging, manager_for(tmp_path))

        assert watcher.poll_once() == []
        assert watcher.poll_once() == []

    async def test_claims_a_file_only_once_its_size_has_settled(
        self, tmp_path: Path
    ) -> None:
        staging = staging_of(tmp_path)
        watcher = watcher_for(staging, manager_for(tmp_path))
        target = staging / "report.pdf"
        target.write_bytes(b"first half")

        assert watcher.poll_once() == []

        target.write_bytes(b"first half and second half")
        assert watcher.poll_once() == []
        assert watcher.poll_once() == ["report.pdf"]

    async def test_never_claims_the_same_file_twice(self, tmp_path: Path) -> None:
        staging = staging_of(tmp_path)
        watcher = watcher_for(staging, manager_for(tmp_path))
        (staging / "report.pdf").write_bytes(b"body")

        watcher.poll_once()
        assert watcher.poll_once() == ["report.pdf"]
        assert watcher.poll_once() == []

    def test_ignores_a_file_chromium_is_still_writing(self, tmp_path: Path) -> None:
        staging = staging_of(tmp_path)
        watcher = watcher_for(staging, manager_for(tmp_path))
        (staging / "report.pdf.crdownload").write_bytes(b"half")

        assert watcher.poll_once() == []
        assert watcher.poll_once() == []

    def test_ignores_a_directory(self, tmp_path: Path) -> None:
        staging = staging_of(tmp_path)
        watcher = watcher_for(staging, manager_for(tmp_path))
        (staging / "nested").mkdir()

        assert watcher.poll_once() == []

    def test_reports_nothing_when_the_directory_is_gone(self, tmp_path: Path) -> None:
        manager = manager_for(tmp_path)
        watcher = DirectoryWatcher(directory=str(tmp_path / "missing"), sink=manager)

        assert watcher.poll_once() == []

    async def test_a_claimed_file_is_saved_under_the_managed_directory(
        self, tmp_path: Path
    ) -> None:
        manager = manager_for(tmp_path)
        staging = staging_of(tmp_path)
        watcher = watcher_for(staging, manager)
        (staging / "report.pdf").write_bytes(b"%PDF-1.7 body")

        watcher.poll_once()
        watcher.poll_once()
        await manager.idle()

        artifact = manager.list()[0]
        assert artifact.path == str(tmp_path / "report.pdf")
        assert Path(artifact.path).read_bytes() == b"%PDF-1.7 body"
        # The staged copy is the engine's, not the caller's.
        assert not (staging / "report.pdf").exists()


class TestAttachFilesystemWatcher:
    """The engine is told where to write before anything is watched."""

    async def test_points_the_browser_at_the_staging_directory(
        self, tmp_path: Path
    ) -> None:
        manager = manager_for(tmp_path)
        asked: list[str] = []

        handle = await attach_filesystem_watcher(
            root=str(tmp_path),
            sink=manager,
            set_behavior=asked.append,
            interval=0.01,
        )

        assert asked == [str(staging_of(tmp_path))]
        assert handle.staging_directory == str(staging_of(tmp_path))
        assert staging_of(tmp_path).is_dir()
        await handle.detach()

    async def test_sends_the_cdp_command_through_a_selenium_driver(
        self, tmp_path: Path
    ) -> None:
        sent: list[tuple[str, dict[str, Any]]] = []

        class FakeDriver:
            def execute_cdp_cmd(self, method: str, params: dict[str, Any]) -> None:
                sent.append((method, params))

        handle = await attach_filesystem_watcher(
            root=str(tmp_path),
            sink=manager_for(tmp_path),
            driver=FakeDriver(),
            interval=0.01,
        )

        assert sent == [
            (
                "Browser.setDownloadBehavior",
                {
                    "behavior": "allow",
                    "downloadPath": str(staging_of(tmp_path)),
                },
            )
        ]
        await handle.detach()

    async def test_polls_until_it_is_detached(self, tmp_path: Path) -> None:
        manager = manager_for(tmp_path)
        handle = await attach_filesystem_watcher(
            root=str(tmp_path), sink=manager, interval=0.01
        )

        (staging_of(tmp_path) / "report.pdf").write_bytes(b"body")
        await asyncio.sleep(0.05)
        await handle.detach()
        await manager.idle()

        assert [artifact.suggested_filename for artifact in manager.list()] == [
            "report.pdf"
        ]

    async def test_detaching_takes_one_last_look(self, tmp_path: Path) -> None:
        # A download that finished between the final poll and detach is still
        # the caller's file.
        manager = manager_for(tmp_path)
        handle = await attach_filesystem_watcher(
            root=str(tmp_path), sink=manager, interval=3600
        )

        (staging_of(tmp_path) / "report.pdf").write_bytes(b"body")
        handle.watcher.poll_once()
        await handle.detach()
        await manager.idle()

        assert len(manager.list()) == 1
