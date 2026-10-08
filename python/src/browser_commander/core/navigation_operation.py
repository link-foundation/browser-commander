"""One operation budget and caller cancellation for navigation phases."""

import asyncio
import contextlib
from typing import Any


class NavigationStoppedError(Exception):
    """Distinguish an interrupted operation from an exhausted deadline."""

    def __init__(self, status: str):
        super().__init__(status)
        self.status = status


async def navigation_phase(deadline, operation, signal=None) -> Any:
    """Cancel and drain phase tasks and event waiters on every exit."""
    if signal is not None and signal.is_set():
        raise NavigationStoppedError("interrupted")
    remaining = deadline.remaining_ms()
    if remaining <= 0:
        raise NavigationStoppedError("timed_out")
    task = asyncio.ensure_future(operation())
    cancellation = asyncio.create_task(signal.wait()) if signal is not None else None
    tasks = [task] + ([cancellation] if cancellation is not None else [])
    try:
        done, _ = await asyncio.wait(
            tasks, timeout=remaining / 1000, return_when=asyncio.FIRST_COMPLETED
        )
        if cancellation is not None and cancellation in done:
            raise NavigationStoppedError("interrupted")
        if task not in done:
            raise NavigationStoppedError("timed_out")
        return await task
    finally:
        for pending in tasks:
            if not pending.done():
                pending.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                if pending.cancelled() or not pending.done():
                    await pending
