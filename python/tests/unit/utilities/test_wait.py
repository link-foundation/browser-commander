"""Tests for wait utilities."""

import asyncio

import pytest

from browser_commander.utilities.wait import WaitResult, wait


class TestWait:
    """Tests for wait function."""

    @pytest.mark.asyncio
    async def test_waits_for_specified_time(self) -> None:
        """Should wait for specified time."""
        from browser_commander.core.logger import create_logger

        log = create_logger()
        result = await wait(log=log, ms=50, reason="test")

        assert isinstance(result, WaitResult)
        assert result.completed is True
        assert result.aborted is False

    @pytest.mark.asyncio
    async def test_aborts_when_signal_set(self) -> None:
        """Should abort when abort signal is set."""
        from browser_commander.core.logger import create_logger

        log = create_logger()
        abort_signal = asyncio.Event()

        # Set signal before wait
        abort_signal.set()

        result = await wait(log=log, ms=5000, reason="test", abort_signal=abort_signal)

        assert result.completed is False
        assert result.aborted is True

    @pytest.mark.asyncio
    async def test_completes_without_abort_signal(self) -> None:
        """Should complete without abort signal."""
        from browser_commander.core.logger import create_logger

        log = create_logger()
        result = await wait(log=log, ms=10, reason="test")

        assert result.completed is True
        assert result.aborted is False
