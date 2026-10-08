"""Callback registration with an idempotent unsubscribe function."""

from __future__ import annotations

from collections.abc import Callable


def subscribe_callbacks(
    callbacks: list | None, callback: Callable
) -> Callable[[], None]:
    if callbacks is not None:
        callbacks.append(callback)
    removed = False

    def unregister() -> None:
        nonlocal removed
        if removed:
            return
        removed = True
        if callbacks is not None and callback in callbacks:
            callbacks.remove(callback)

    return unregister
