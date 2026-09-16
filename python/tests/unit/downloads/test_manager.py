"""Unit tests for the managed download lifecycle (issue #88)."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import pytest

from browser_commander.downloads.manager import (
    DownloadEvent,
    DownloadManager,
    create_download_manager,
    download_context,
)
from browser_commander.downloads.sources import STAGING_DIRECTORY
from tests.helpers.download_fixtures import (
    FakeBrowser,
    FakeCdpSession,
    FakeContext,
    FakeDownload,
    FakePage,
)


class DownloadHarness:
    """A manager over a fake Playwright context, with its staging directory."""

    def __init__(self, root: Path, staging: Path) -> None:
        """Prepare the directories the manager and the engine each own.

        Args:
            root: Managed download directory
            staging: Directory the fake engine stages bytes in
        """
        self.root = root
        self.staging = staging
        self.staging.mkdir(parents=True, exist_ok=True)
        self.context = FakeContext()
        self.manager: DownloadManager | None = None

    async def start(self, **options: Any) -> DownloadManager:
        """Start a manager over the fake context.

        Args:
            **options: Extra manager options

        Returns:
            The manager
        """
        self.manager = await create_download_manager(
            engine="playwright",
            context=self.context,
            **{"directory": str(self.root), **options},
        )
        return self.manager

    async def emit(self, **options: Any) -> FakeDownload:
        """Announce a download through the fake context.

        Args:
            **options: Fake download options

        Returns:
            The download that was announced
        """
        download = FakeDownload(
            directory=str(self.staging),
            suggested_filename=options.pop("suggested_filename", "report.pdf"),
            **options,
        )
        await self.context.emit_download(download)
        # Engine download events are fire-and-forget; the save they start is not.
        assert self.manager is not None
        await self.manager.idle()
        return download

    def collect(self, event: str) -> list[Any]:
        """Record every artifact published under one lifecycle event.

        Args:
            event: Lifecycle event to listen for

        Returns:
            The list that fills as artifacts are published
        """
        assert self.manager is not None
        published: list[Any] = []
        self.manager.on(event, published.append)
        return published

    def listing(self) -> list[str]:
        """List the managed directory, ignoring engine staging.

        Returns:
            Sorted entry names
        """
        return sorted(
            entry.name
            for entry in self.root.iterdir()
            if entry.name != STAGING_DIRECTORY
        )


@pytest.fixture
async def harness(tmp_path: Path) -> Any:
    """Provide a manager harness that disposes itself.

    Args:
        tmp_path: Per-test temporary directory

    Yields:
        The harness
    """
    created = DownloadHarness(tmp_path / "downloads", tmp_path / "staging")
    yield created
    if created.manager is not None:
        await created.manager.dispose()


class TestSavingDownloads:
    """The bytes outlive the page, the context and the browser."""

    async def test_prepares_the_directory_before_any_download_arrives(
        self, harness: DownloadHarness
    ) -> None:
        nested = harness.root / "nested"

        manager = await harness.start(directory=str(nested))

        assert manager.directory == str(nested)
        assert nested.is_dir()

    async def test_saves_a_download_and_reports_it_as_completed(
        self, harness: DownloadHarness
    ) -> None:
        await harness.start()
        completed = harness.collect(DownloadEvent.COMPLETED)

        await harness.emit(body="report body")

        assert len(completed) == 1
        artifact = completed[0]
        assert artifact.state == DownloadEvent.COMPLETED
        assert Path(artifact.path).name == "report.pdf"
        assert artifact.bytes == 11
        assert len(artifact.checksum) == 64
        assert artifact.id.startswith("dl-")
        assert artifact.completed_at
        assert Path(artifact.path).read_text(encoding="utf-8") == "report body"

    async def test_keeps_the_file_after_the_browser_is_gone(
        self, harness: DownloadHarness
    ) -> None:
        manager = await harness.start()
        await harness.emit(body="persisted")
        artifact = manager.list()[0]

        await manager.dispose()
        harness.manager = None

        assert Path(artifact.path).read_text(encoding="utf-8") == "persisted"

    async def test_resolves_a_collision_without_replacing_the_earlier_file(
        self, harness: DownloadHarness
    ) -> None:
        manager = await harness.start()

        await harness.emit(body="first")
        await harness.emit(body="second")

        assert harness.listing() == ["report (2).pdf", "report.pdf"]
        assert len(manager.list()) == 2

    async def test_lists_every_download_in_the_order_it_started(
        self, harness: DownloadHarness
    ) -> None:
        manager = await harness.start()

        await harness.emit(suggested_filename="a.txt")
        await harness.emit(suggested_filename="b.txt")

        assert [artifact.suggested_filename for artifact in manager.list()] == [
            "a.txt",
            "b.txt",
        ]


class TestFailures:
    """A download that produced no file never looks like one that did."""

    async def test_preserves_the_reason_the_engine_gave(
        self, harness: DownloadHarness
    ) -> None:
        await harness.start()
        failed = harness.collect(DownloadEvent.FAILED)

        await harness.emit(failure="net::ERR_CONNECTION_RESET")

        assert len(failed) == 1
        assert failed[0].failure == "net::ERR_CONNECTION_RESET"
        assert failed[0].path is None
        assert harness.listing() == []

    async def test_reports_a_cancelled_download_as_cancelled(
        self, harness: DownloadHarness
    ) -> None:
        await harness.start()
        events: list[str] = []
        harness.manager.on(DownloadEvent.CANCELLED, lambda _a: events.append("c"))
        harness.manager.on(DownloadEvent.FAILED, lambda _a: events.append("f"))

        await harness.emit(failure="canceled")

        assert events == ["c"]

    async def test_a_listener_that_raises_cannot_lose_a_download(
        self, harness: DownloadHarness
    ) -> None:
        manager = await harness.start()

        def explode(_artifact: Any) -> None:
            msg = "the listener is broken"
            raise RuntimeError(msg)

        manager.on(DownloadEvent.COMPLETED, explode)
        completed = harness.collect(DownloadEvent.COMPLETED)

        await harness.emit(body="kept")

        assert len(completed) == 1
        assert Path(completed[0].path).exists()


class TestCapture:
    """One download is saved once and reported once."""

    async def test_reports_once_when_a_listener_and_a_capture_both_watch(
        self, harness: DownloadHarness
    ) -> None:
        # Issue #88: "a download that a global listener and an awaited
        # capture() both see must be saved once and reported once".
        manager = await harness.start()
        completed = harness.collect(DownloadEvent.COMPLETED)

        captured = await manager.capture(action=lambda: harness.emit(body="once"))

        assert len(completed) == 1
        assert completed[0] is captured
        assert len(manager.list()) == 1
        assert harness.listing() == ["report.pdf"]

    async def test_catches_a_download_that_starts_inside_the_action(
        self, harness: DownloadHarness
    ) -> None:
        # Arming after the action would lose this one: the race the issue
        # calls out.
        manager = await harness.start()

        artifact = await manager.capture(action=lambda: harness.emit(body="raced"))

        assert artifact.state == DownloadEvent.COMPLETED

    async def test_names_a_capture_without_losing_the_safety_rules(
        self, harness: DownloadHarness
    ) -> None:
        manager = await harness.start()

        artifact = await manager.capture(
            action=lambda: harness.emit(
                suggested_filename="8d0f9e2c-4a11-4b22-9f00-1d2e3f405162",
                body="%PDF-1.7 invoice",
            ),
            filename=lambda **_kwargs: "../invoice.pdf",
        )

        assert artifact.path == str(harness.root / "invoice.pdf")

    async def test_accepts_a_plain_name_for_the_captured_download(
        self, harness: DownloadHarness
    ) -> None:
        manager = await harness.start()

        artifact = await manager.capture(
            action=lambda: harness.emit(
                suggested_filename="8d0f9e2c-4a11-4b22-9f00-1d2e3f405162",
                body="%PDF-1.7 invoice",
            ),
            filename="invoice.pdf",
        )

        assert Path(artifact.path).name == "invoice.pdf"

    async def test_fails_a_capture_whose_download_does_not_validate(
        self, harness: DownloadHarness
    ) -> None:
        manager = await harness.start()

        def validate(**kwargs: Any) -> None:
            if kwargs["bytes"] < 1000:
                msg = "expected a PDF, got a login page"
                raise ValueError(msg)

        with pytest.raises(RuntimeError, match="expected a PDF"):
            await manager.capture(
                action=lambda: harness.emit(body="<html>login</html>"),
                validate=validate,
            )

        assert harness.listing() == []

    async def test_times_out_rather_than_waiting_forever(
        self, harness: DownloadHarness
    ) -> None:
        manager = await harness.start()

        with pytest.raises(TimeoutError, match="no download completed within 50ms"):
            await manager.capture(action=lambda: None, timeout=50)

    async def test_propagates_an_error_from_the_triggering_action(
        self, harness: DownloadHarness
    ) -> None:
        manager = await harness.start()

        def action() -> None:
            msg = "the button was not there"
            raise RuntimeError(msg)

        with pytest.raises(RuntimeError, match="the button was not there"):
            await manager.capture(action=action)

    async def test_waits_for_a_download_nothing_triggered(
        self, harness: DownloadHarness
    ) -> None:
        manager = await harness.start()
        captured = asyncio.ensure_future(manager.capture(timeout=5000))
        await asyncio.sleep(0)

        await harness.emit(body="later")

        artifact = await captured
        assert artifact.state == DownloadEvent.COMPLETED


class TestManualDownloadsOverCdp:
    """A download a person started is observed exactly like an automated one."""

    @staticmethod
    async def cdp_manager(root: Path, session: FakeCdpSession) -> DownloadManager:
        """Start a manager whose only source is a fake CDP session.

        Args:
            root: Managed download directory
            session: Fake CDP session

        Returns:
            The manager
        """
        return await create_download_manager(
            engine="playwright",
            browser=FakeBrowser(session),
            directory=str(root),
        )

    async def test_asks_chromium_to_report_downloads_it_did_not_automate(
        self, tmp_path: Path
    ) -> None:
        session = FakeCdpSession()
        manager = await self.cdp_manager(tmp_path, session)

        assert session.sent == [
            {
                "method": "Browser.setDownloadBehavior",
                "params": {
                    "behavior": "allowAndName",
                    "downloadPath": str(tmp_path / STAGING_DIRECTORY),
                    "eventsEnabled": True,
                },
            }
        ]
        await manager.dispose()
        assert session.detached is True

    async def test_places_a_manual_download_like_an_automated_one(
        self, tmp_path: Path
    ) -> None:
        session = FakeCdpSession()
        manager = await self.cdp_manager(tmp_path, session)
        completed: list[Any] = []
        manager.on(DownloadEvent.COMPLETED, completed.append)

        guid = "guid-0001"
        session.emit(
            "Browser.downloadWillBegin",
            {
                "guid": guid,
                "url": "https://example.com/manual.pdf",
                "suggestedFilename": "manual.pdf",
            },
        )
        Path(tmp_path, STAGING_DIRECTORY, guid).write_text(
            "manual body", encoding="utf-8"
        )
        session.emit("Browser.downloadProgress", {"guid": guid, "state": "completed"})
        await manager.idle()

        assert len(completed) == 1
        assert completed[0].path == str(tmp_path / "manual.pdf")
        assert Path(completed[0].path).read_text(encoding="utf-8") == "manual body"
        # The staged copy is the engine's, not the user's: it does not linger.
        assert list(Path(tmp_path, STAGING_DIRECTORY).iterdir()) == []
        await manager.dispose()

    async def test_reports_a_download_the_browser_refused(self, tmp_path: Path) -> None:
        session = FakeCdpSession()
        manager = await self.cdp_manager(tmp_path, session)
        cancelled: list[Any] = []
        manager.on(DownloadEvent.CANCELLED, cancelled.append)

        session.emit(
            "Browser.downloadWillBegin",
            {
                "guid": "guid-0002",
                "url": "https://example.com/blocked.exe",
                "suggestedFilename": "blocked.exe",
            },
        )
        session.emit(
            "Browser.downloadProgress", {"guid": "guid-0002", "state": "canceled"}
        )
        await asyncio.sleep(0)

        assert len(cancelled) == 1
        assert "canceled" in cancelled[0].failure
        await manager.dispose()

    async def test_ignores_progress_for_a_download_it_never_saw_start(
        self, tmp_path: Path
    ) -> None:
        session = FakeCdpSession()
        manager = await self.cdp_manager(tmp_path, session)

        session.emit(
            "Browser.downloadProgress", {"guid": "unknown", "state": "completed"}
        )
        await asyncio.sleep(0)

        assert manager.list() == []
        await manager.dispose()

    async def test_falls_back_to_the_context_event_without_cdp(
        self, tmp_path: Path
    ) -> None:
        # An attached browser that refuses Browser-domain access still manages
        # every download the automation itself starts.
        context = FakeContext()
        manager = await create_download_manager(
            engine="playwright",
            page=FakePage(context),
            directory=str(tmp_path),
        )

        assert context.listener_count("download") == 1
        await manager.dispose()
        assert context.listener_count("download") == 0


class TestDownloadContext:
    """Playwright emits ``download`` on the context, never on the browser."""

    def test_prefers_the_page_context(self) -> None:
        context = FakeContext()
        page = FakePage(context)

        assert download_context(browser=object(), page=page) is context

    def test_falls_back_to_a_persistent_context_handle(self) -> None:
        context = FakeContext()

        assert download_context(browser=context, page=None) is context
