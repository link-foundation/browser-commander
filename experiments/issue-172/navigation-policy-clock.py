"""Bounded reproduction of the CI policy test's sensitivity to scheduler delay."""

import asyncio
import time
from unittest.mock import AsyncMock, MagicMock, patch

from browser_commander.browser.navigation import goto
from browser_commander.core.navigation_manager import NavigationManager
from browser_commander.core.readiness import Deadline


async def probe(fixed_clock: bool) -> None:
    page = MagicMock(url="data:text/html,fixture")

    async def immediate_navigation(*args, **kwargs):
        # A finite pause models CPU scheduling delay, without browser or IO work.
        time.sleep(0.06)

    page.goto = AsyncMock(side_effect=immediate_navigation)
    tracker = MagicMock()
    tracker.wait_for_network_idle = AsyncMock(return_value=True)
    manager = NavigationManager(page, "playwright", MagicMock(), tracker)
    factory = (
        (lambda *, timeout: Deadline(timeout=timeout, now=lambda: 0.0))
        if fixed_clock
        else Deadline
    )

    async def immediate_phase(deadline, operation, signal=None):
        return await operation()

    from contextlib import ExitStack

    with ExitStack() as patches:
        patches.enter_context(
            patch("browser_commander.browser.navigation.Deadline", factory)
        )
        if fixed_clock:
            for module in ["browser", "core"]:
                target = (
                    "browser_commander.browser.navigation.navigation_phase"
                    if module == "browser"
                    else "browser_commander.core.navigation_manager.navigation_phase"
                )
                patches.enter_context(patch(target, immediate_phase))
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
    tracker.wait_for_network_idle.assert_not_called()
    print(f"fixed_clock={fixed_clock}: {result.status}, navigated={result.navigated}")
    assert result.navigated == fixed_clock


async def main() -> None:
    await probe(False)
    await probe(True)


if __name__ == "__main__":
    asyncio.run(main())
