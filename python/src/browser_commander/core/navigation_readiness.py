"""Readiness wiring for the navigation manager.

Kept separate from ``navigation_manager.py`` so the two halves of "the page
stopped navigating" and "the page is actually usable" stay visibly distinct:
this module decides only the second question and reports the evidence behind
its answer.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any, Callable

from browser_commander.core.constants import TIMING
from browser_commander.core.engine_detection import EngineType
from browser_commander.core.readiness import (
    Deadline,
    ReadinessCheck,
    ReadinessResult,
    network_idle_for,
    run_readiness_checks,
    url_stable_for,
)


def default_readiness_checks(
    redirect_stabilization_time: int = TIMING["REDIRECT_STABILIZATION_TIME"],
) -> list[ReadinessCheck]:
    """Build the checks that define "ready" when a caller supplies none.

    Args:
        redirect_stabilization_time: Required URL quiet period in milliseconds

    Returns:
        Ordered readiness checks
    """
    return [
        url_stable_for(stable_for_ms=redirect_stabilization_time, interval_ms=200),
        network_idle_for(),
    ]


class ReadinessWaiter:
    """Runs readiness checks against a single monotonic deadline."""

    def __init__(
        self,
        page: Any,
        engine: EngineType,
        log: Any,
        network_tracker: Any = None,
        get_url: Callable[[], str] | None = None,
        on_url_sample: Callable[[str], None] | None = None,
        on_ready: Callable[[], None] | None = None,
        on_not_ready: Callable[[], None] | None = None,
        redirect_stabilization_time: int = TIMING["REDIRECT_STABILIZATION_TIME"],
    ) -> None:
        """Create the waiter used by the navigation manager.

        Args:
            page: Playwright page or Selenium WebDriver
            engine: Engine type
            log: Logger instance
            network_tracker: Optional NetworkTracker
            get_url: Returns the current page URL
            on_url_sample: Called with every sampled URL
            on_ready: Called when every check passed
            on_not_ready: Called when the wait did not succeed
            redirect_stabilization_time: Required URL quiet period
        """
        self.page = page
        self.engine = engine
        self.log = log
        self.network_tracker = network_tracker
        self.get_url = get_url or (lambda: "")
        self.on_url_sample = on_url_sample
        self.on_ready = on_ready
        self.on_not_ready = on_not_ready
        self.redirect_stabilization_time = redirect_stabilization_time
        self._adapter: Any = None

    async def get_adapter(self) -> Any:
        """Lazily build an engine adapter for checks that evaluate in-page.

        Kept lazy so the default checks never touch a page that cannot evaluate.

        Returns:
            Engine adapter
        """
        if self._adapter is None:
            from browser_commander.core.engine_adapter import create_engine_adapter

            self._adapter = create_engine_adapter(self.page, self.engine)
        return self._adapter

    async def wait_for_ready(
        self,
        timeout: int = TIMING["NETWORK_IDLE_TIMEOUT"],
        reason: str = "page ready",
        checks: Sequence[ReadinessCheck] | None = None,
    ) -> ReadinessResult:
        """Wait for the page to be ready and report exactly what was observed.

        Every check shares one monotonic deadline, so the total wait can never
        exceed ``timeout`` no matter how many checks run or how slow each one
        is. The page-ready event fires only when every check actually passed.

        Args:
            timeout: Total budget in milliseconds
            reason: Reason for waiting (for logging)
            checks: Composable readiness checks to run

        Returns:
            The structured readiness result
        """
        self.log.debug(lambda: f"Waiting for page ready ({reason})...")

        deadline = Deadline(timeout=timeout)
        result = await run_readiness_checks(
            checks=(
                checks
                if checks is not None
                else default_readiness_checks(self.redirect_stabilization_time)
            ),
            deadline=deadline,
            context={
                "page": self.page,
                "engine": self.engine,
                "log": self.log,
                "network_tracker": self.network_tracker,
                "get_adapter": self.get_adapter,
                "get_url": self.get_url,
                "on_url_sample": self.on_url_sample,
            },
        )

        result.reason = reason
        result.url = self.get_url()

        if result.ready:
            if self.on_ready:
                self.on_ready()
            self.log.debug(lambda: f"Page ready after {result.elapsed_ms}ms ({reason})")
        else:
            if self.on_not_ready:
                self.on_not_ready()
            self.log.debug(
                lambda: (
                    f"Page not ready ({reason}): {result.status} after "
                    f"{result.elapsed_ms}ms; failed={result.failed} "
                    f"pending={result.pending}"
                )
            )

        return result


def create_readiness_waiter(**options: Any) -> ReadinessWaiter:
    """Create a :class:`ReadinessWaiter`.

    Args:
        **options: Constructor arguments

    Returns:
        A readiness waiter
    """
    return ReadinessWaiter(**options)
