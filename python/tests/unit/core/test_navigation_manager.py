"""Unit tests for navigation readiness in the navigation manager."""

from __future__ import annotations

import asyncio
from typing import Any, Callable

from browser_commander.core.navigation_manager import create_navigation_manager
from browser_commander.core.readiness import ReadinessStatus
from tests.helpers.mocks import (
    create_mock_logger,
    create_mock_network_tracker,
    create_mock_playwright_page,
)


def create_manager_with_network(
    idle: bool | Callable[..., Any] = True,
    on_idle_wait: Callable[[dict[str, Any]], None] | None = None,
) -> Any:
    """Build a manager whose network idle wait is fully controlled by the test.

    Args:
        idle: Verdict, or a coroutine function producing one
        on_idle_wait: Called with the kwargs the tracker received

    Returns:
        The manager, its page, log, and tracker
    """
    page = create_mock_playwright_page()
    log = create_mock_logger()
    tracker = create_mock_network_tracker()

    async def wait_for_network_idle(**kwargs: Any) -> bool:
        if on_idle_wait:
            on_idle_wait(kwargs)
        if callable(idle):
            return await idle(**kwargs)
        return idle

    tracker.wait_for_network_idle = wait_for_network_idle

    manager = create_navigation_manager(
        page=page,
        engine="playwright",
        log=log,
        network_tracker=tracker,
    )
    manager.configure(redirect_stabilization_time=0)
    return manager, page, log, tracker


class TestWaitForReadiness:
    async def test_never_extends_the_caller_deadline_beyond_the_timeout(self):
        # Regression test for issue #89: the old implementation waited
        # max(60000, timeout - elapsed), so a 500ms budget could block for a
        # full minute.
        timeouts: list[int] = []
        manager, *_ = create_manager_with_network(
            idle=True,
            on_idle_wait=lambda kwargs: timeouts.append(kwargs["timeout"]),
        )

        await manager.wait_for_readiness(timeout=1000, reason="deadline test")

        assert len(timeouts) == 1
        assert timeouts[0] <= 1000

    async def test_reports_timed_out_instead_of_claiming_ready(self):
        # Regression test for issue #89: wait_for_page_ready logged "Page ready"
        # even when the network never became idle.
        async def burn_the_budget(**kwargs: Any) -> bool:
            await asyncio.sleep(kwargs["timeout"] / 1000)
            return False

        manager, *_ = create_manager_with_network(idle=burn_the_budget)

        result = await manager.wait_for_readiness(timeout=600, reason="failure test")

        assert result.ready is False
        assert result.status == ReadinessStatus.TIMED_OUT
        assert "network_idle_for" in result.failed
        assert result.elapsed_ms < 3000

    async def test_reports_failed_when_a_check_fails_before_the_deadline(self):
        manager, *_ = create_manager_with_network(idle=False)

        result = await manager.wait_for_readiness(timeout=5000)

        assert result.ready is False
        assert result.status == ReadinessStatus.FAILED
        assert "network_idle_for" in result.failed

    async def test_does_not_emit_page_ready_after_a_failed_wait(self):
        # Regression test for issue #89: state cleanup and the ready event were
        # owned by the same code path, so failing waits still announced ready.
        manager, *_ = create_manager_with_network(idle=False)
        events: list[str] = []
        manager.on("on_page_ready", lambda _payload: events.append("page_ready"))

        ready = await manager.wait_for_page_ready(timeout=1000)

        assert ready is False
        assert events == []
        assert manager.is_navigating() is False

    async def test_emits_page_ready_exactly_once_when_every_check_passes(self):
        manager, *_ = create_manager_with_network(idle=True)
        events: list[str] = []
        manager.on("on_page_ready", lambda _payload: events.append("page_ready"))

        result = await manager.wait_for_readiness(timeout=2000)

        assert result.ready is True
        assert result.status == ReadinessStatus.READY
        assert events == ["page_ready"]
        assert "network_idle_for" in result.satisfied

    async def test_records_evidence_for_every_check_it_ran(self):
        manager, *_ = create_manager_with_network(idle=True)

        result = await manager.wait_for_readiness(timeout=2000)

        assert len(result.evidence) >= 2
        for record in result.evidence:
            assert isinstance(record.name, str)
            assert isinstance(record.satisfied, bool)
            assert record.elapsed_ms >= 0

    async def test_concurrent_callers_join_the_in_flight_wait(self):
        calls: list[int] = []
        manager, *_ = create_manager_with_network(
            idle=True,
            on_idle_wait=lambda kwargs: calls.append(kwargs["timeout"]),
        )

        first, second = await asyncio.gather(
            manager.wait_for_readiness(timeout=2000),
            manager.wait_for_readiness(timeout=2000),
        )

        assert len(calls) == 1
        assert first.ready is True
        assert second.ready is True

    async def test_abandoning_navigation_never_announces_readiness(self):
        manager, *_ = create_manager_with_network(idle=True)
        events: list[str] = []
        manager.on("on_page_ready", lambda _payload: events.append("page_ready"))
        manager._is_navigating = True

        manager.abandon_navigation("test")

        assert manager.is_navigating() is False
        assert events == []
