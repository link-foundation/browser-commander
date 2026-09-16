"""Unit tests for the wait on staged download bytes (issue #92)."""

from __future__ import annotations

import asyncio
from pathlib import Path

from browser_commander.downloads.staging import (
    DEFAULT_STAGING_POLL_INTERVAL,
    DEFAULT_STAGING_TIMEOUT,
    STAGING_IN_PROGRESS_SUFFIXES,
    describe_staging_timeout,
    wait_for_staged_file,
)


class TestWaitForStagedFile:
    """A completion event only becomes an artifact once the bytes are there."""

    async def test_reports_a_file_that_is_already_complete(
        self, tmp_path: Path
    ) -> None:
        staged = tmp_path / "guid-ready"
        staged.write_text("complete body", encoding="utf-8")

        settled = await wait_for_staged_file(path=str(staged), timeout=1.0)

        assert settled.ready is True
        assert settled.bytes == len("complete body")
        assert settled.reason is None

    async def test_waits_for_a_file_that_appears_after_the_event(
        self, tmp_path: Path
    ) -> None:
        # This is issue #92 exactly: the browser says "completed" and the
        # rename Chromium does behind it has not become visible yet.
        staged = tmp_path / "guid-late"

        async def write_later() -> None:
            await asyncio.sleep(0.06)
            staged.write_text("late body", encoding="utf-8")

        writer = asyncio.ensure_future(write_later())
        settled = await wait_for_staged_file(
            path=str(staged), timeout=5.0, interval=0.005
        )
        await writer

        assert settled.ready is True, settled.reason
        assert settled.bytes == len("late body")

    async def test_keeps_waiting_while_the_file_is_still_growing(
        self, tmp_path: Path
    ) -> None:
        staged = tmp_path / "guid-growing"
        staged.write_text("a", encoding="utf-8")

        async def grow() -> None:
            for _ in range(10):
                await asyncio.sleep(0.005)
                with Path(staged).open("ab") as handle:
                    handle.write(b"a")

        grower = asyncio.ensure_future(grow())
        settled = await wait_for_staged_file(
            path=str(staged), timeout=5.0, interval=0.005
        )
        await grower

        assert settled.ready is True, settled.reason
        # Two equal readings are what ends the wait, so the file had stopped
        # growing before it was declared ready.
        assert settled.bytes is not None

    async def test_does_not_claim_a_file_with_a_partial_sibling(
        self, tmp_path: Path
    ) -> None:
        staged = tmp_path / "guid-partial"
        staged.write_text("looks done", encoding="utf-8")
        Path(f"{staged}.crdownload").write_text("still writing", encoding="utf-8")

        settled = await wait_for_staged_file(
            path=str(staged), timeout=0.06, interval=0.005
        )

        assert settled.ready is False
        assert settled.reason is not None
        assert ".crdownload file is still being written" in settled.reason

    async def test_fails_explicitly_when_the_bytes_never_arrive(
        self, tmp_path: Path
    ) -> None:
        settled = await wait_for_staged_file(
            path=str(tmp_path / "guid-missing"), timeout=0.06, interval=0.005
        )

        assert settled.ready is False
        assert settled.bytes is None
        assert settled.reason is not None
        assert "has not appeared" in settled.reason

    def test_names_the_file_the_budget_and_what_it_last_saw(self) -> None:
        message = describe_staging_timeout(
            path="/tmp/root/.browser-commander-staging/guid",
            timeout=0.25,
            reason="the file has not appeared yet",
        )

        assert "reported the download as completed" in message
        assert "guid" in message
        assert "0.25s" in message
        assert "has not appeared yet" in message

    def test_ships_defaults_a_download_can_finish_within(self) -> None:
        assert DEFAULT_STAGING_TIMEOUT >= 1.0
        assert DEFAULT_STAGING_POLL_INTERVAL > 0
        assert DEFAULT_STAGING_POLL_INTERVAL < DEFAULT_STAGING_TIMEOUT
        assert ".crdownload" in STAGING_IN_PROGRESS_SUFFIXES
