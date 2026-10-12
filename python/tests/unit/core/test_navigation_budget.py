# feature-parity: navigation.budget@native-typed
import asyncio
import time
from unittest.mock import AsyncMock, MagicMock

from browser_commander.browser.navigation import goto
from browser_commander.core.navigation_manager import NavigationManager
from browser_commander.core.readiness import Deadline


async def test_managed_no_wait_has_no_hidden_readiness(monkeypatch):
    # This checks the requested policy, not scheduler speed. Use a fixed clock
    # and immediate phases; the next test covers real expiration/cancellation.
    monkeypatch.setattr(
        "browser_commander.browser.navigation.Deadline",
        lambda *, timeout: Deadline(timeout=timeout, now=lambda: 0.0),
    )

    async def immediate_phase(deadline, operation, signal=None):
        return await operation()

    monkeypatch.setattr(
        "browser_commander.browser.navigation.navigation_phase", immediate_phase
    )
    monkeypatch.setattr(
        "browser_commander.core.navigation_manager.navigation_phase", immediate_phase
    )
    page = MagicMock(url="data:text/html,fixture")
    page.goto = AsyncMock()
    tracker = MagicMock()
    tracker.wait_for_network_idle = AsyncMock(return_value=True)
    manager = NavigationManager(page, "playwright", MagicMock(), tracker)
    result = await goto(
        page,
        page.url,
        navigation_manager=manager,
        timeout=50,
        wait_for_stable_url_before=False,
        wait_for_stable_url_after=False,
        wait_for_network_idle=False,
        verify=False,
    )
    assert result.navigated
    page.goto.assert_awaited_once_with(
        page.url, wait_until="domcontentloaded", timeout=50
    )
    tracker.wait_for_network_idle.assert_not_called()


async def test_navigation_timeout_and_signal_cleanup():
    page = MagicMock(url="data:text/html,fixture")

    async def stalled(*args, **kwargs):
        await asyncio.sleep(0.2)

    page.goto = AsyncMock(side_effect=stalled)
    manager = NavigationManager(page, "playwright", MagicMock())
    started = time.monotonic()
    result = await goto(
        page,
        page.url,
        navigation_manager=manager,
        timeout=30,
        wait_for_stable_url_before=False,
        wait_for_stable_url_after=False,
        wait_for_network_idle=False,
        verify=False,
    )
    assert result.status == "timed_out"
    assert time.monotonic() - started < 0.1
    assert not manager.is_navigating()
