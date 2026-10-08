# feature-parity: navigation.budget@native-typed
import asyncio
import time
from unittest.mock import AsyncMock, MagicMock

from browser_commander.browser.navigation import goto
from browser_commander.core.navigation_manager import NavigationManager


async def test_managed_no_wait_has_no_hidden_readiness():
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
